import { useState, useEffect, useMemo, useCallback } from "react";
import TrackingMap from "@/components/TrackingMap";
import {
  IbsBrandHeaderMark,
  DoodleworksLegalFooter,
} from "@/components/IbsBrandComponents";
import { useWebSocket, type RawWsMessage } from "@/hooks/useWebSocket";
import { useAuth } from "@/lib/auth";
import { useOfficeTheme } from "@/lib/theme";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import {
  type HotShotRoute,
  type HotShotStop,
  type HotShotOpenOrder,
  normalizeHotShotRoutes,
  normalizeHotShotOriginHub,
  getHotShotHubMeta,
  resolveHotShotWarehouse,
  getCentralDateISO,
  formatHotShotDateHuman,
  formatCentralClockTime,
  estimateHotShotTiming,
  buildHotShotRouteOverlays,
  computeHotShotMapBounds,
  estimateStopWeightAndPieces,
  computeHotShotRouteLoadMetrics,
  optimizeHotShotStopSequence,
  evaluateOpenOrderSuggestions,
  buildHotShotTownSequenceLabel,
} from "@shared/hotshots";
import {
  Zap,
  Truck,
  MapPin,
  BatteryCharging,
  Scale,
  Route,
  Sparkles,
  CheckCircle2,
  Circle,
  RefreshCw,
  Tv,
  Settings,
  Map as MapIcon,
  Plus,
  Check,
  Satellite,
  RotateCcw,
  Sun,
  Moon,
  Type,
  Calendar,
  ChevronDown,
  ChevronUp,
  Package,
  History,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface VehicleEntry {
  id: string;
  name?: string;
  color?: string;
  location: { lat: number; lon: number };
  speed: number;
  status: string;
  timestamp: string;
  heading: number;
}

const DEFAULT_ARLINGTON_WAREHOUSE = {
  name: "Arlington Warehouse",
  latitude: 44.3792,
  longitude: -97.1406,
};

const DEFAULT_SF_WAREHOUSE = {
  name: "Sioux Falls Warehouse",
  latitude: 43.5446,
  longitude: -96.7311,
};

export default function DispatchPortal() {
  const { scope } = useAuth();
  const canEdit = scope === "admin" || scope === "staff";
  const { officeTheme, setOfficeTheme, themes: officeThemes, isLight } = useOfficeTheme();
  const { toast } = useToast();

  const [displayState, setDisplayState] = useState<any>(null);
  const [vehicles, setVehicles] = useState<VehicleEntry[]>([]);
  const [mainWarehouse, setMainWarehouse] = useState(DEFAULT_ARLINGTON_WAREHOUSE);
  const [sfWarehouse, setSfWarehouse] = useState(DEFAULT_SF_WAREHOUSE);
  const [syncingApi, setSyncingApi] = useState(false);
  const [applyingRouteId, setApplyingRouteId] = useState<string | null>(null);

  // Map Light/Dark & Readable Large Text Toggle
  const [mapDarkMode, setMapDarkMode] = useState<boolean>(() => !isLight);
  const [largeText, setLargeText] = useState<boolean>(() => {
    try {
      return localStorage.getItem("dispatch_portal_large_text") === "true";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    setMapDarkMode(!isLight);
  }, [isLight]);

  const toggleLargeText = () => {
    setLargeText((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("dispatch_portal_large_text", String(next));
      } catch {}
      return next;
    });
  };

  // Filters & Focus State
  const [dateFilter, setDateFilter] = useState<"today" | "tomorrow" | "all">("today");
  const [hubFilter, setHubFilter] = useState<"all" | "sioux_falls" | "arlington">("all");
  const [orderFilter, setOrderFilter] = useState<"all" | "matches" | "sioux_falls" | "arlington">(
    "all",
  );
  const [focusedRouteId, setFocusedRouteId] = useState<string | null>(null);
  const [expandedRouteId, setExpandedRouteId] = useState<string | null>(null);
  const [expandedOrderId, setExpandedOrderId] = useState<number | null>(null);
  const [showRecommendedOrders, setShowRecommendedOrders] = useState<boolean>(true);
  const [showOtherOpenOrders, setShowOtherOpenOrders] = useState<boolean>(false);
  const [showOrdersPanel, setShowOrdersPanel] = useState<boolean>(true);

  // Per-route toggle to preview 2-Opt Optimized Stop Order
  const [previewOptimizedByRoute, setPreviewOptimizedByRoute] = useState<Record<string, boolean>>(
    {},
  );

  // "What-If" Simulator: maps openOrder.deliveryId -> target routeId
  const [simulatedOrderAssignments, setSimulatedOrderAssignments] = useState<
    Record<number, string>
  >({});

  const fetchInitialData = useCallback(async () => {
    try {
      const [stateRes, vehRes, homeRes] = await Promise.all([
        fetch("/api/display/state"),
        fetch("/api/vehicles"),
        fetch("/api/map-home-locations"),
      ]);
      if (stateRes.ok) {
        setDisplayState(await stateRes.json());
      }
      if (vehRes.ok) {
        setVehicles(await vehRes.json());
      }
      if (homeRes.ok) {
        const homes = await homeRes.json();
        if (homes?.map?.location) {
          setMainWarehouse({
            name: homes.map.location.name,
            latitude: homes.map.location.latitude,
            longitude: homes.map.location.longitude,
          });
        }
        if (homes?.["regional-sf"]?.location) {
          setSfWarehouse({
            name: homes["regional-sf"].location.name,
            latitude: homes["regional-sf"].location.latitude,
            longitude: homes["regional-sf"].location.longitude,
          });
        }
      }
    } catch (err) {
      console.error("Failed loading Dispatch Portal data:", err);
    }
  }, []);

  useEffect(() => {
    fetchInitialData();
  }, [fetchInitialData]);

  const handleLocationUpdate = useCallback((data: any) => {
    setVehicles((prev) => {
      const idx = prev.findIndex((v) => v.id === data.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = {
          ...next[idx],
          location: data.location,
          speed: data.speed,
          status: data.status,
          timestamp: data.timestamp,
          heading: data.heading,
        };
        return next;
      }
      return [...prev, data];
    });
  }, []);

  const handleRawWsEvent = useCallback((msg: RawWsMessage) => {
    if (msg.type === "display_state_update" && msg.payload) {
      setDisplayState(msg.payload);
    }
  }, []);

  useWebSocket(handleLocationUpdate, handleRawWsEvent);

  const todayISO = getCentralDateISO(new Date());
  const tomorrowISO = useMemo(() => {
    const d = new Date(Date.now() + 24 * 3600_000);
    return getCentralDateISO(d);
  }, []);

  const allRoutes = useMemo(
    () => normalizeHotShotRoutes(displayState?.hotShotRoutes),
    [displayState?.hotShotRoutes],
  );

  const activeAndUpcomingRoutes = useMemo(() => {
    return allRoutes
      .filter((r) => r.active !== false && r.deliveryDateISO >= todayISO)
      .sort((a, b) => {
        if (a.deliveryDateISO !== b.deliveryDateISO) {
          return a.deliveryDateISO.localeCompare(b.deliveryDateISO);
        }
        return a.driverName.localeCompare(b.driverName);
      });
  }, [allRoutes, todayISO]);

  const openOrders: HotShotOpenOrder[] = useMemo(
    () =>
      Array.isArray(displayState?.hotShotOpenOrders)
        ? displayState.hotShotOpenOrders
        : [],
    [displayState?.hotShotOpenOrders],
  );

  const syncStatus = displayState?.hotShotSyncStatus || null;

  // Build effective routes with any "What-If" simulated open orders injected + optional 2-Opt optimization
  const enrichedRoutes = useMemo(() => {
    return activeAndUpcomingRoutes.map((route) => {
      const originHub = normalizeHotShotOriginHub(
        route.originHub,
        route.rawPdfDriver || route.driverName,
      );
      const warehouse = resolveHotShotWarehouse(originHub, {
        sfWarehouse,
        mainWarehouse,
      });

      const simulatedOrders = openOrders.filter(
        (o) => simulatedOrderAssignments[o.deliveryId] === route.id,
      );

      const baseStops = [...route.stops];
      const combinedStops: HotShotStop[] = [...baseStops];

      for (const simOrd of simulatedOrders) {
        let bestInsertIdx = combinedStops.length;
        let bestAddedMiles = Infinity;
        const chain = [
          { lat: warehouse.latitude, lon: warehouse.longitude },
          ...combinedStops.map((s) => ({ lat: s.lat, lon: s.lon })),
          { lat: warehouse.latitude, lon: warehouse.longitude },
        ];
        for (let i = 0; i < chain.length - 1; i++) {
          const pA = chain[i];
          const pB = chain[i + 1];
          const dBase = Math.hypot(pB.lat - pA.lat, pB.lon - pA.lon);
          const dNew =
            Math.hypot(simOrd.lat - pA.lat, simOrd.lon - pA.lon) +
            Math.hypot(pB.lat - simOrd.lat, pB.lon - simOrd.lon);
          if (dNew - dBase < bestAddedMiles) {
            bestAddedMiles = dNew - dBase;
            bestInsertIdx = i;
          }
        }

        const simStop: HotShotStop = {
          id: `sim-stop-${simOrd.deliveryId}`,
          order: bestInsertIdx + 1,
          accountName: `✨ [WHAT-IF] ${simOrd.accountName}`,
          accountCode: simOrd.accountCode,
          address: simOrd.address,
          city: simOrd.city,
          state: simOrd.state,
          zip: simOrd.zip,
          phone: simOrd.phone,
          poNumber: simOrd.poNumber,
          enteredBy: simOrd.enteredBy,
          partsSummary: simOrd.partsSummary,
          piecesCount: simOrd.piecesCount,
          notes: simOrd.notes,
          lat: simOrd.lat,
          lon: simOrd.lon,
          geocodePrecision: "street",
          completedAt: null,
          completedBy: null,
          externalDeliveryId: simOrd.deliveryId,
        };
        combinedStops.splice(bestInsertIdx, 0, simStop);
      }

      const reindexedCombined = combinedStops.map((s, idx) => ({
        ...s,
        order: idx + 1,
      }));

      const optimization = optimizeHotShotStopSequence(reindexedCombined, warehouse);
      const isPreviewingOptimized = Boolean(previewOptimizedByRoute[route.id]);
      const displayStops = isPreviewingOptimized
        ? optimization.optimizedStops
        : reindexedCombined;

      const effectiveRoute: HotShotRoute = {
        ...route,
        originHub,
        stops: displayStops,
      };

      const matchedLiveVeh =
        vehicles.find(
          (v) =>
            (route.vehicleId && v.id === route.vehicleId) ||
            (route.vehicleName && v.name === route.vehicleName),
        ) || null;

      const baseTiming = estimateHotShotTiming(route, warehouse, matchedLiveVeh, new Date());
      const effectiveTiming = estimateHotShotTiming(
        effectiveRoute,
        warehouse,
        matchedLiveVeh,
        new Date(),
      );

      const baseLoad = computeHotShotRouteLoadMetrics(route.stops);
      const effectiveLoad = computeHotShotRouteLoadMetrics(displayStops);

      return {
        baseRoute: route,
        effectiveRoute,
        originHub,
        warehouse,
        matchedLiveVeh,
        baseTiming,
        effectiveTiming,
        baseLoad,
        effectiveLoad,
        optimization,
        simulatedOrders,
        isPreviewingOptimized,
      };
    });
  }, [
    activeAndUpcomingRoutes,
    openOrders,
    simulatedOrderAssignments,
    previewOptimizedByRoute,
    sfWarehouse,
    mainWarehouse,
    vehicles,
  ]);

  const filteredRoutes = useMemo(() => {
    return enrichedRoutes.filter((item) => {
      if (dateFilter === "today" && item.baseRoute.deliveryDateISO !== todayISO) {
        return false;
      }
      if (dateFilter === "tomorrow" && item.baseRoute.deliveryDateISO !== tomorrowISO) {
        return false;
      }
      if (hubFilter !== "all" && item.originHub !== hubFilter) {
        return false;
      }
      return true;
    });
  }, [enrichedRoutes, dateFilter, hubFilter, todayISO, tomorrowISO]);

  const orderSuggestions = useMemo(() => {
    return evaluateOpenOrderSuggestions(
      openOrders,
      activeAndUpcomingRoutes,
      { sfWarehouse, mainWarehouse },
      displayState?.routeTerritories,
    );
  }, [openOrders, activeAndUpcomingRoutes, sfWarehouse, mainWarehouse, displayState?.routeTerritories]);

  const filteredOrderSuggestions = useMemo(() => {
    return orderSuggestions.filter((item) => {
      if (orderFilter === "matches") {
        return (
          item.bestMatch?.tier === "same_town" || item.bestMatch?.tier === "corridor"
        );
      }
      if (orderFilter === "sioux_falls") {
        return item.order.originHub === "sioux_falls";
      }
      if (orderFilter === "arlington") {
        return item.order.originHub === "arlington";
      }
      return true;
    });
  }, [orderSuggestions, orderFilter]);

  const summaryKpis = useMemo(() => {
    let totalRoadMiles = 0;
    let totalBatteries = 0;
    let deliveredBatteries = 0;
    let totalWeightLbs = 0;
    let remainingVanWeightLbs = 0;
    let totalSavedMilesAvailable = 0;

    for (const r of filteredRoutes) {
      totalRoadMiles += r.effectiveTiming.totalLoopRoadMiles;
      totalBatteries += r.effectiveLoad.totalBatteries;
      deliveredBatteries += r.effectiveLoad.deliveredBatteries;
      totalWeightLbs += r.effectiveLoad.totalWeightLbs;
      remainingVanWeightLbs += r.effectiveLoad.remainingVanWeightLbs;
      if (!r.isPreviewingOptimized) {
        totalSavedMilesAvailable += r.optimization.savedRoadMiles;
      }
    }

    const sameTownMatchesCount = orderSuggestions.filter(
      (s) => s.bestMatch?.tier === "same_town",
    ).length;
    const corridorMatchesCount = orderSuggestions.filter(
      (s) => s.bestMatch?.tier === "corridor",
    ).length;

    return {
      routeCount: filteredRoutes.length,
      totalRoadMiles,
      totalBatteries,
      deliveredBatteries,
      totalWeightLbs,
      remainingVanWeightLbs,
      totalSavedMilesAvailable,
      sameTownMatchesCount,
      corridorMatchesCount,
    };
  }, [filteredRoutes, orderSuggestions]);

  const mapTargetRoutes = useMemo(() => {
    if (focusedRouteId) {
      const found = enrichedRoutes.find((r) => r.baseRoute.id === focusedRouteId);
      if (found) return [found.effectiveRoute];
    }
    return filteredRoutes.map((r) => r.effectiveRoute);
  }, [focusedRouteId, enrichedRoutes, filteredRoutes]);

  const mapOverlays = useMemo(() => {
    return buildHotShotRouteOverlays(mapTargetRoutes, {
      sfWarehouse,
      mainWarehouse,
    });
  }, [mapTargetRoutes, sfWarehouse, mainWarehouse]);

  const mapBounds = useMemo(() => {
    return computeHotShotMapBounds(mapTargetRoutes, sfWarehouse, undefined, {
      sfWarehouse,
      mainWarehouse,
    });
  }, [mapTargetRoutes, sfWarehouse, mainWarehouse]);

  const handleSyncApiNow = async () => {
    setSyncingApi(true);
    try {
      const res = await fetch("/api/display/hotshots/sync-now", {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Sync failed");
      }
      if (data.state) setDisplayState(data.state);
      toast({
        title: "Synced with HotShotSheet API",
        description: `Routes & Open Orders refreshed (${data.openOrders?.length ?? 0} open orders).`,
      });
    } catch (err: any) {
      toast({
        title: "HotShotSheet Sync Failed",
        description: err?.message || "Could not sync with HotShotSheet",
        variant: "destructive",
      });
    } finally {
      setSyncingApi(false);
    }
  };

  const handleToggleSimulateOrder = (deliveryId: number, targetRouteId: string) => {
    setSimulatedOrderAssignments((prev) => {
      const copy = { ...prev };
      if (copy[deliveryId] === targetRouteId) {
        delete copy[deliveryId];
      } else {
        copy[deliveryId] = targetRouteId;
      }
      return copy;
    });
  };

  const handleApplyRouteStops = async (
    baseRoute: HotShotRoute,
    newStops: HotShotStop[],
    label: string,
  ) => {
    if (!canEdit) {
      toast({
        title: "Staff / Admin Login Required",
        description: "Sign in with a Staff or Admin account to save route changes.",
        variant: "destructive",
      });
      return;
    }
    setApplyingRouteId(baseRoute.id);
    try {
      const cleanedStops = newStops.map((s, idx) => ({
        ...s,
        order: idx + 1,
        accountName: s.accountName.replace(/^✨\s*\[WHAT-IF\]\s*/, ""),
      }));
      const res = await fetch(`/api/display/hotshots/${encodeURIComponent(baseRoute.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          route: {
            ...baseRoute,
            stops: cleanedStops,
            title: buildHotShotTownSequenceLabel(cleanedStops, 5),
          },
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Failed updating route");
      }
      if (data.state) setDisplayState(data.state);
      setPreviewOptimizedByRoute((prev) => ({ ...prev, [baseRoute.id]: false }));
      toast({
        title: label,
        description: `Updated ${baseRoute.driverName}'s route (${cleanedStops.length} stops).`,
      });
    } catch (err: any) {
      toast({
        title: "Update Failed",
        description: err?.message || "Could not update route",
        variant: "destructive",
      });
    } finally {
      setApplyingRouteId(null);
    }
  };

  const handleToggleStopDone = async (routeId: string, stopId: string) => {
    if (!canEdit || stopId.startsWith("sim-stop-")) return;
    try {
      const res = await fetch(
        `/api/display/hotshots/${encodeURIComponent(routeId)}/stops/${encodeURIComponent(stopId)}/toggle`,
        { method: "POST" },
      );
      const data = await res.json();
      if (res.ok && data?.state) {
        setDisplayState(data.state);
      }
    } catch {}
  };

  const activeSimCount = Object.keys(simulatedOrderAssignments).length;

  // Auto-expand the first visible route card if none has been explicitly selected yet
  useEffect(() => {
    if (
      filteredRoutes.length > 0 &&
      expandedRouteId === null &&
      focusedRouteId === null
    ) {
      setExpandedRouteId(filteredRoutes[0].baseRoute.id);
    }
  }, [filteredRoutes, expandedRouteId, focusedRouteId]);

  const recommendedOrders = useMemo(
    () =>
      filteredOrderSuggestions.filter(
        (item) =>
          Boolean(simulatedOrderAssignments[item.order.deliveryId]) ||
          item.bestMatch?.tier === "same_town" ||
          item.bestMatch?.tier === "corridor",
      ),
    [filteredOrderSuggestions, simulatedOrderAssignments],
  );

  const otherWaitingOrders = useMemo(
    () =>
      filteredOrderSuggestions.filter(
        (item) =>
          !simulatedOrderAssignments[item.order.deliveryId] &&
          item.bestMatch?.tier !== "same_town" &&
          item.bestMatch?.tier !== "corridor",
      ),
    [filteredOrderSuggestions, simulatedOrderAssignments],
  );

  // High-contrast theme-adaptive badge styles (readable in both Clean Daylight & Dark themes)
  const badgeGreen = isLight
    ? "bg-emerald-100 text-emerald-950 border-emerald-500 font-bold"
    : "bg-emerald-500/20 text-emerald-200 border-emerald-500/50 font-bold";
  const badgeAmber = isLight
    ? "bg-amber-100 text-amber-950 border-amber-500 font-bold"
    : "bg-amber-500/20 text-amber-200 border-amber-500/50 font-bold";
  const badgeSky = isLight
    ? "bg-sky-100 text-sky-950 border-sky-500 font-bold"
    : "bg-sky-500/20 text-sky-200 border-sky-500/50 font-bold";
  const textGreen = isLight ? "text-emerald-800 font-bold" : "text-emerald-400 font-bold";
  const textAmber = isLight ? "text-amber-800 font-bold" : "text-amber-400 font-bold";
  const textSky = isLight ? "text-sky-800 font-bold" : "text-sky-400 font-bold";

  const renderOrderCard = (item: (typeof filteredOrderSuggestions)[number]) => {
    const { order, pieces, weightLbs, bestMatch, matchingRouteTrucks } = item;
    const hubMeta = getHotShotHubMeta(order.originHub);
    const simulatedRouteId = simulatedOrderAssignments[order.deliveryId];
    const isOrderExpanded =
      expandedOrderId === order.deliveryId || Boolean(simulatedRouteId);

    return (
      <div
        key={order.deliveryId}
        className={`rounded-xl border transition-all overflow-hidden ${
          simulatedRouteId
            ? "border-emerald-500 bg-card ring-2 ring-emerald-500/30 shadow-sm"
            : isOrderExpanded
              ? "border-primary bg-card shadow-sm"
              : bestMatch?.tier === "same_town"
                ? "border-emerald-500/50 bg-card/90 hover:bg-card"
                : bestMatch?.tier === "corridor"
                  ? "border-amber-500/50 bg-card/90 hover:bg-card"
                  : "border-border bg-secondary/40 hover:bg-card"
        }`}
      >
        {/* Accordion Summary Header */}
        <div
          onClick={() =>
            setExpandedOrderId((prev) =>
              prev === order.deliveryId ? null : order.deliveryId,
            )
          }
          className="cursor-pointer p-2.5 flex items-center justify-between gap-2"
        >
          <div className="min-w-0 space-y-0.5">
            <div className="font-bold text-xs sm:text-sm text-foreground truncate">
              {order.city}, {order.state} — {order.accountName}
            </div>
            <div className="text-[11px] text-muted-foreground flex items-center gap-1.5 flex-wrap">
              <span>[{hubMeta.code}]</span>
              <span>•</span>
              <span>
                <strong className="text-foreground">{pieces}</strong> pcs (~{weightLbs} lbs)
              </span>
              {bestMatch && (
                <>
                  <span>•</span>
                  <span
                    className={
                      bestMatch.tier === "same_town"
                        ? textGreen
                        : bestMatch.tier === "corridor"
                          ? textAmber
                          : "text-muted-foreground"
                    }
                  >
                    {bestMatch.tier === "same_town"
                      ? `🟢 Same town (${bestMatch.driverName})`
                      : bestMatch.tier === "corridor"
                        ? `🟡 +${bestMatch.addedRoadMiles} mi (${bestMatch.driverName})`
                        : `+${bestMatch.addedRoadMiles} mi`}
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="shrink-0 text-right text-[11px] text-muted-foreground flex items-center gap-1">
            {simulatedRouteId && (
              <span className={`px-1.5 py-0.5 rounded border text-[10px] ${badgeGreen}`}>
                Simulating
              </span>
            )}
            {isOrderExpanded ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </div>
        </div>

        {/* Accordion Expanded Details & What-If Controls */}
        {isOrderExpanded && (
          <div className="border-t border-border p-2.5 bg-card space-y-2 text-xs">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>
                Bucket: <strong className="text-foreground">{order.driverName}</strong>
              </span>
              {order.accountCode && <span>Acct: [{order.accountCode}]</span>}
              {order.poNumber && <span>PO: {order.poNumber}</span>}
            </div>

            {order.partsSummary && (
              <div className="text-xs font-mono font-medium text-foreground/90">
                🔋 {order.partsSummary}
              </div>
            )}
            {order.notes && (
              <div className={`text-xs font-mono ${textAmber}`}>⚠️ {order.notes}</div>
            )}

            {bestMatch && (
              <div
                className={`rounded-lg border p-2 text-xs space-y-1.5 ${
                  bestMatch.tier === "same_town"
                    ? badgeGreen
                    : bestMatch.tier === "corridor"
                      ? badgeAmber
                      : "bg-secondary/50 border-border text-foreground"
                }`}
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span>
                    {bestMatch.tier === "same_town" ? (
                      <>
                        🟢 Same town as <strong>{bestMatch.driverName}</strong>
                      </>
                    ) : bestMatch.tier === "corridor" ? (
                      <>
                        🟡 On corridor for <strong>{bestMatch.driverName}</strong>
                      </>
                    ) : (
                      <>
                        Closest route: <strong>{bestMatch.driverName}</strong>
                      </>
                    )}
                  </span>
                  <span className="font-mono font-bold">
                    +{bestMatch.addedRoadMiles} mi (~{bestMatch.addedMinutes}m)
                  </span>
                </div>

                <div className="flex items-center gap-1.5 pt-0.5">
                  <Button
                    size="sm"
                    variant={simulatedRouteId === bestMatch.routeId ? "default" : "outline"}
                    onClick={() => {
                      handleToggleSimulateOrder(order.deliveryId, bestMatch.routeId);
                      setFocusedRouteId(bestMatch.routeId);
                      setExpandedRouteId(bestMatch.routeId);
                    }}
                    className={`h-7 text-xs font-semibold gap-1 flex-1 ${
                      simulatedRouteId === bestMatch.routeId
                        ? "bg-emerald-600 hover:bg-emerald-500 text-white"
                        : "bg-card text-foreground border-border hover:bg-secondary"
                    }`}
                  >
                    {simulatedRouteId === bestMatch.routeId ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        Added to {bestMatch.driverName} Preview
                      </>
                    ) : (
                      <>
                        <Plus className="w-3.5 h-3.5" />
                        Test Adding to {bestMatch.driverName}&apos;s Route
                      </>
                    )}
                  </Button>

                  <Select
                    value={simulatedRouteId || "__none__"}
                    onValueChange={(val) => {
                      if (val === "__none__") {
                        setSimulatedOrderAssignments((prev) => {
                          const next = { ...prev };
                          delete next[order.deliveryId];
                          return next;
                        });
                      } else {
                        setSimulatedOrderAssignments((prev) => ({
                          ...prev,
                          [order.deliveryId]: val,
                        }));
                        setFocusedRouteId(val);
                        setExpandedRouteId(val);
                      }
                    }}
                  >
                    <SelectTrigger className="h-7 w-[125px] text-xs font-mono bg-card text-foreground">
                      <SelectValue placeholder="Other..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">No Simulation</SelectItem>
                      {activeAndUpcomingRoutes.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.driverName} ({r.deliveryDateISO.slice(5)})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {matchingRouteTrucks.length > 0 && (
              <div className="text-[11px] font-mono text-muted-foreground flex items-center gap-1.5">
                <Truck className="w-3.5 h-3.5 text-primary shrink-0" />
                <span>
                  Territory:{" "}
                  <strong className="text-foreground">
                    {matchingRouteTrucks.map((t) => `${t.routeName} (${t.truckGroup})`).join(", ")}
                  </strong>
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      className={`h-screen w-screen overflow-hidden bg-background text-foreground flex flex-col ${
        largeText ? "text-[105%]" : ""
      }`}
    >
      {/* 1. UNIFIED TOP NAVIGATION BAR */}
      <header className="shrink-0 border-b border-border bg-secondary/70 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <IbsBrandHeaderMark />

          {/* Primary Site Navigation Switcher */}
          <div className="inline-flex rounded-lg bg-card border border-border p-0.5 text-xs">
            <span className="px-3 py-1.5 rounded-md font-bold bg-primary text-primary-foreground shadow-sm flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5" />
              Dispatch & Routes
            </span>
            <Link href="/history">
              <button
                type="button"
                className="px-3 py-1.5 rounded-md font-semibold text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5"
              >
                <History className="w-3.5 h-3.5" />
                Delivery History
              </button>
            </Link>
            {canEdit && (
              <Link href="/admin">
                <button
                  type="button"
                  className="px-3 py-1.5 rounded-md font-semibold text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5"
                >
                  <Calendar className="w-3.5 h-3.5" />
                  Schedules & TV Board
                </button>
              </Link>
            )}
            <Link href="/">
              <button
                type="button"
                className="px-3 py-1.5 rounded-md font-semibold text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5"
              >
                <MapIcon className="w-3.5 h-3.5" />
                Full Fleet Map
              </button>
            </Link>
          </div>
        </div>

        {/* Right Controls: Sync Status, Theme, Readability & Open TV */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button
            type="button"
            disabled={syncingApi}
            onClick={handleSyncApiNow}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border bg-card hover:bg-secondary transition-colors font-medium text-foreground"
            title="Click to sync live deliveries and open orders from HotShotSheet API"
          >
            <span
              className={`w-2 h-2 rounded-full ${
                syncingApi ? "bg-amber-500 animate-ping" : "bg-emerald-500"
              }`}
            />
            <RefreshCw className={`w-3.5 h-3.5 ${syncingApi ? "animate-spin" : ""}`} />
            <span>
              {syncingApi
                ? "Syncing..."
                : syncStatus?.lastSyncedAt
                  ? `Synced ${formatCentralClockTime(new Date(syncStatus.lastSyncedAt))}`
                  : "Sync HotShotSheet"}
            </span>
          </button>

          <select
            value={officeTheme}
            onChange={(e) => setOfficeTheme(e.target.value as any)}
            title="Switch Visual Theme"
            data-testid="dispatch-theme-selector"
            className="h-8 rounded-lg border border-border bg-card px-2.5 text-xs font-semibold text-foreground focus:outline-none cursor-pointer"
          >
            {officeThemes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.shortLabel}
              </option>
            ))}
          </select>

          <Button
            size="sm"
            variant={largeText ? "default" : "outline"}
            onClick={toggleLargeText}
            title="Toggle Larger Text"
            className="h-8 px-2.5 text-xs gap-1 rounded-lg"
          >
            <Type className="w-3.5 h-3.5" />
            {largeText ? "Large Text: ON" : "Large Text"}
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={() => setMapDarkMode((d) => !d)}
            title={mapDarkMode ? "Switch Map Tiles to Daylight Mode" : "Switch Map Tiles to Dark Mode"}
            className="h-8 w-8 p-0 rounded-lg"
          >
            {mapDarkMode ? <Sun className="w-3.5 h-3.5 text-primary" /> : <Moon className="w-3.5 h-3.5" />}
          </Button>

          <Link href="/display?panel=screen-5">
            <Button size="sm" variant="outline" className="h-8 text-xs font-semibold gap-1.5 rounded-lg">
              <Tv className="w-3.5 h-3.5 text-primary" />
              Open TV Screen
            </Button>
          </Link>
        </div>
      </header>

      {/* 2. SIMPLE FILTER & INLINE SUMMARY BAR */}
      <div className="shrink-0 border-b border-border bg-card px-4 py-2 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* Day Filter */}
          <div className="inline-flex rounded-lg border border-border bg-secondary p-0.5">
            <button
              type="button"
              onClick={() => setDateFilter("today")}
              className={`px-3 py-1 rounded-md font-semibold transition-all ${
                dateFilter === "today"
                  ? "bg-foreground text-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Today ({todayISO.slice(5)})
            </button>
            <button
              type="button"
              onClick={() => setDateFilter("tomorrow")}
              className={`px-3 py-1 rounded-md font-semibold transition-all ${
                dateFilter === "tomorrow"
                  ? "bg-foreground text-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Tomorrow ({tomorrowISO.slice(5)})
            </button>
            <button
              type="button"
              onClick={() => setDateFilter("all")}
              className={`px-3 py-1 rounded-md font-semibold transition-all ${
                dateFilter === "all"
                  ? "bg-foreground text-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              All Active
            </button>
          </div>

          {/* Hub Filter */}
          <div className="inline-flex rounded-lg border border-border bg-secondary p-0.5">
            <button
              type="button"
              onClick={() => setHubFilter("all")}
              className={`px-2.5 py-1 rounded-md font-semibold transition-all ${
                hubFilter === "all"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              All Hubs
            </button>
            <button
              type="button"
              onClick={() => setHubFilter("sioux_falls")}
              className={`px-2.5 py-1 rounded-md font-semibold transition-all ${
                hubFilter === "sioux_falls"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Sioux Falls
            </button>
            <button
              type="button"
              onClick={() => setHubFilter("arlington")}
              className={`px-2.5 py-1 rounded-md font-semibold transition-all ${
                hubFilter === "arlington"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Arlington
            </button>
          </div>
        </div>

        {/* Clean Scannable Inline Summary */}
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span>
            <strong className="text-foreground">{summaryKpis.routeCount}</strong> routes
          </span>
          <span>•</span>
          <span>
            <strong className="text-foreground">{summaryKpis.totalBatteries.toLocaleString()}</strong>{" "}
            batteries ({summaryKpis.deliveredBatteries} delivered)
          </span>
          <span>•</span>
          <span>
            <strong className="text-foreground">
              ~{summaryKpis.remainingVanWeightLbs.toLocaleString()} lbs
            </strong>{" "}
            on vans
          </span>
          <span>•</span>
          <span>
            <strong className="text-foreground">~{summaryKpis.totalRoadMiles.toLocaleString()} mi</strong>{" "}
            loop
          </span>
          {(summaryKpis.sameTownMatchesCount + summaryKpis.corridorMatchesCount) > 0 && (
            <>
              <span>•</span>
              <span className={textGreen}>
                {summaryKpis.sameTownMatchesCount + summaryKpis.corridorMatchesCount} open orders match active routes
              </span>
            </>
          )}
        </div>
      </div>

      {/* 3. MAIN 3-COLUMN WORKSPACE */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
        {/* LEFT COLUMN (4 cols): COMPACT ACCORDION DRIVER CARDS */}
        <div className="lg:col-span-4 border-r border-border flex flex-col min-h-0 bg-background">
          <div className="shrink-0 px-4 py-2.5 border-b border-border bg-card flex items-center justify-between gap-2">
            <div className="font-semibold text-xs uppercase tracking-wider flex items-center gap-2 text-muted-foreground">
              <Truck className="w-4 h-4 text-primary" />
              Driver Routes ({filteredRoutes.length}) — Click to Expand
            </div>
            {focusedRouteId && (
              <button
                type="button"
                onClick={() => setFocusedRouteId(null)}
                className="text-xs font-semibold px-2.5 py-1 rounded-md border border-border bg-secondary text-foreground hover:bg-secondary/80"
              >
                Show All on Map
              </button>
            )}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2.5">
            {filteredRoutes.length === 0 ? (
              <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
                No Hot Shot routes match this filter. Try switching to &quot;All Active&quot;.
              </div>
            ) : (
              filteredRoutes.map((item) => {
                const {
                  baseRoute,
                  effectiveRoute,
                  originHub,
                  effectiveTiming,
                  baseTiming,
                  effectiveLoad,
                  baseLoad,
                  optimization,
                  simulatedOrders,
                  isPreviewingOptimized,
                } = item;
                const hubMeta = getHotShotHubMeta(originHub);
                const isExpanded = expandedRouteId === baseRoute.id;
                const isFocused = focusedRouteId === baseRoute.id;
                const isToday = baseRoute.deliveryDateISO === todayISO;
                const heavyLoadWarning = effectiveLoad.totalWeightLbs >= 2800;

                return (
                  <div
                    key={baseRoute.id}
                    className={`rounded-xl border transition-all overflow-hidden ${
                      isExpanded || isFocused
                        ? "border-primary bg-card shadow-sm ring-1 ring-primary/25"
                        : "border-border bg-secondary/40 hover:bg-card"
                    }`}
                    style={{
                      borderLeftWidth: "5px",
                      borderLeftColor: baseRoute.color || "#f59e0b",
                    }}
                  >
                    {/* Compact Scannable Driver Card Header */}
                    <div
                      onClick={() => {
                        setExpandedRouteId((prev) =>
                          prev === baseRoute.id ? null : baseRoute.id,
                        );
                        setFocusedRouteId((prev) =>
                          prev === baseRoute.id ? null : baseRoute.id,
                        );
                      }}
                      className="cursor-pointer p-3 flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-sm text-foreground">
                            {baseRoute.driverName}
                          </span>
                          <span className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-secondary border border-border text-foreground">
                            {hubMeta.shortLabel}
                          </span>
                          {!isToday && (
                            <span className={`text-[11px] px-2 py-0.5 rounded-md border ${badgeSky}`}>
                              {formatHotShotDateHuman(baseRoute.deliveryDateISO)}
                            </span>
                          )}
                          {baseRoute.vehicleName && (
                            <span className="text-[11px] font-mono text-muted-foreground flex items-center gap-1">
                              <Satellite className="w-3 h-3 text-emerald-500" />
                              {baseRoute.vehicleName}
                            </span>
                          )}
                        </div>

                        <div className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
                          <span>
                            <strong className="text-foreground">{effectiveRoute.stops.length}</strong> Stops
                          </span>
                          <span>•</span>
                          <span>
                            <strong className="text-foreground">
                              {effectiveLoad.deliveredBatteries}/{effectiveLoad.totalBatteries}
                            </strong>{" "}
                            Batteries
                          </span>
                          <span>•</span>
                          <span
                            className={
                              heavyLoadWarning
                                ? "text-red-600 dark:text-red-400 font-bold"
                                : ""
                            }
                          >
                            ~{effectiveLoad.remainingVanWeightLbs.toLocaleString()} lbs
                          </span>
                          <span>•</span>
                          <span>~{effectiveTiming.totalLoopRoadMiles} mi</span>
                        </div>
                      </div>

                      <div className="text-right shrink-0 space-y-1">
                        <div className={`text-xs font-mono ${textGreen}`}>
                          {effectiveTiming.etaShortLabel}
                        </div>
                        <div className="text-[11px] text-muted-foreground inline-flex items-center gap-0.5">
                          {isExpanded ? (
                            <>
                              Hide Stops <ChevronUp className="w-3.5 h-3.5" />
                            </>
                          ) : (
                            <>
                              View Stops <ChevronDown className="w-3.5 h-3.5" />
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Expanded Section: What-If Banner, Optimizer & Stop List */}
                    {isExpanded && (
                      <div className="border-t border-border bg-card">
                        {/* "What-If" Simulation Active Banner */}
                        {simulatedOrders.length > 0 && (
                          <div className={`p-2.5 border-b text-xs font-mono space-y-2 ${badgeGreen}`}>
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-bold flex items-center gap-1.5">
                                <Sparkles className="w-3.5 h-3.5" />
                                Testing +{simulatedOrders.length} Open Order
                                {simulatedOrders.length > 1 ? "s" : ""}
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  setSimulatedOrderAssignments((prev) => {
                                    const next = { ...prev };
                                    for (const so of simulatedOrders) {
                                      delete next[so.deliveryId];
                                    }
                                    return next;
                                  })
                                }
                                className="text-xs px-2 py-0.5 rounded border border-current hover:opacity-80 font-bold"
                              >
                                Reset
                              </button>
                            </div>
                            <div className="grid grid-cols-2 gap-1 text-xs">
                              <div>
                                Miles:{" "}
                                <strong>
                                  {baseTiming.totalLoopRoadMiles} → {effectiveTiming.totalLoopRoadMiles} mi
                                </strong>
                              </div>
                              <div>
                                ETA:{" "}
                                <strong>
                                  {baseTiming.etaShortLabel} → {effectiveTiming.etaShortLabel}
                                </strong>
                              </div>
                              <div>
                                Batteries:{" "}
                                <strong>
                                  {baseLoad.totalBatteries} → {effectiveLoad.totalBatteries} pcs
                                </strong>
                              </div>
                              <div>
                                Load:{" "}
                                <strong>
                                  ~{baseLoad.totalWeightLbs.toLocaleString()} → ~
                                  {effectiveLoad.totalWeightLbs.toLocaleString()} lbs
                                </strong>
                              </div>
                            </div>
                            {canEdit && (
                              <Button
                                size="sm"
                                disabled={applyingRouteId === baseRoute.id}
                                onClick={() =>
                                  handleApplyRouteStops(
                                    baseRoute,
                                    effectiveRoute.stops,
                                    "Added Simulated Open Order(s) to Tracker Route",
                                  )
                                }
                                className="w-full h-7 text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-bold"
                              >
                                <Check className="w-3.5 h-3.5 mr-1" />
                                Save What-If Stops to Route
                              </Button>
                            )}
                          </div>
                        )}

                        {/* 2-Opt Stop Sequence Optimizer Banner */}
                        {optimization.isImproved && (
                          <div className={`p-2.5 border-b text-xs space-y-1.5 ${badgeAmber}`}>
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <span className="font-bold flex items-center gap-1">
                                <Sparkles className="w-3.5 h-3.5" />
                                Save ~{optimization.savedRoadMiles} mi (~{optimization.savedMinutes}m)
                              </span>
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setPreviewOptimizedByRoute((prev) => ({
                                      ...prev,
                                      [baseRoute.id]: !prev[baseRoute.id],
                                    }))
                                  }
                                  className="text-xs font-semibold px-2 py-0.5 rounded border border-current bg-card text-foreground hover:opacity-90"
                                >
                                  {isPreviewingOptimized ? "Showing Best Order" : "Preview Best Order"}
                                </button>
                                {isPreviewingOptimized && canEdit && (
                                  <button
                                    type="button"
                                    disabled={applyingRouteId === baseRoute.id}
                                    onClick={() =>
                                      handleApplyRouteStops(
                                        baseRoute,
                                        optimization.optimizedStops,
                                        "Applied Optimized Stop Sequence",
                                      )
                                    }
                                    className="text-xs font-bold px-2 py-0.5 rounded bg-emerald-600 text-white hover:bg-emerald-500"
                                  >
                                    Apply
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Stop-by-Stop List */}
                        <div className="p-2.5 space-y-1.5 max-h-[340px] overflow-y-auto">
                          {effectiveRoute.stops.map((stop, idx) => {
                            const done = Boolean(stop.completedAt);
                            const isSimulated = stop.id.startsWith("sim-stop-");
                            const stopLoad = estimateStopWeightAndPieces(stop);

                            return (
                              <div
                                key={stop.id || idx}
                                onClick={() => handleToggleStopDone(baseRoute.id, stop.id)}
                                className={`rounded-lg border px-2.5 py-2 text-xs flex items-start justify-between gap-2 transition-colors ${
                                  isSimulated
                                    ? badgeGreen
                                    : done
                                      ? "border-emerald-500/60 bg-emerald-500/10 cursor-pointer"
                                      : "border-border bg-secondary/40 hover:bg-secondary/70 cursor-pointer"
                                }`}
                              >
                                <div className="flex items-start gap-2 min-w-0 flex-1">
                                  {done ? (
                                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                                  ) : (
                                    <Circle className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                                  )}
                                  <div className="min-w-0 flex-1 space-y-0.5">
                                    <div className="font-semibold text-foreground">
                                      <span className="font-mono font-bold text-primary mr-1">
                                        #{idx + 1}
                                      </span>
                                      {stop.city}, {stop.state} — {stop.accountName}
                                    </div>
                                    {stop.partsSummary && (
                                      <div className="text-[11px] font-mono text-muted-foreground">
                                        🔋 {stop.partsSummary}
                                      </div>
                                    )}
                                    {stop.notes && (
                                      <div className={`text-[11px] font-mono ${textAmber}`}>
                                        ⚠️ {stop.notes}
                                      </div>
                                    )}
                                  </div>
                                </div>

                                <div className="shrink-0 text-right font-mono text-[11px] text-muted-foreground">
                                  <div className="font-bold text-foreground">
                                    {stopLoad.pieces} pcs
                                  </div>
                                  <div>~{stopLoad.weightLbs} lbs</div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* CENTER COLUMN (4 cols when Open Orders open, 8 cols when closed for full map focus): INTERACTIVE CORRIDOR MAP */}
        <div
          className={`${
            showOrdersPanel ? "lg:col-span-4 border-r border-border" : "lg:col-span-8"
          } flex flex-col min-h-0 relative bg-background transition-all`}
        >
          <div className="shrink-0 px-4 py-2.5 border-b border-border bg-card flex items-center justify-between gap-2 z-10">
            <div className="font-semibold text-xs uppercase tracking-wider flex items-center gap-2 text-muted-foreground">
              <MapPin className="w-4 h-4 text-primary" />
              {focusedRouteId
                ? `Focused Route Map`
                : `Live Corridor Map (${mapTargetRoutes.length} Routes)`}
            </div>
            <div className="flex items-center gap-2">
              {activeSimCount > 0 && (
                <button
                  type="button"
                  onClick={() => setSimulatedOrderAssignments({})}
                  className={`text-xs font-mono px-2.5 py-0.5 rounded border flex items-center gap-1 ${badgeGreen}`}
                >
                  <RotateCcw className="w-3 h-3" />
                  Clear {activeSimCount} Sim{activeSimCount > 1 ? "s" : ""}
                </button>
              )}
              {!showOrdersPanel && (
                <button
                  type="button"
                  onClick={() => setShowOrdersPanel(true)}
                  className="text-xs font-semibold px-3 py-1 rounded-lg border border-primary/50 bg-primary/15 text-foreground hover:bg-primary/25 flex items-center gap-1.5"
                >
                  <Sparkles className="w-3.5 h-3.5 text-primary" />
                  Show Unassigned Deliveries ({filteredOrderSuggestions.length})
                  {recommendedOrders.length > 0 && (
                    <span className={`px-1.5 py-0.2 rounded text-[10px] border ${badgeGreen}`}>
                      {recommendedOrders.length} matches
                    </span>
                  )}
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 min-h-0 relative">
            <TrackingMap
              key={showOrdersPanel ? "dispatch-portal-map-split" : "dispatch-portal-map-wide"}
              data={vehicles}
              onVehicleUpdate={() => {}}
              center={[43.95, -96.85]}
              zoom={8}
              fitRegionBounds={mapBounds || undefined}
              autoFitBounds={!mapBounds}
              unlockMaxBounds
              darkMode={mapDarkMode}
              routeOverlays={mapOverlays}
            />
          </div>
        </div>

        {/* RIGHT COLUMN (4 cols): COLLAPSIBLE UNASSIGNED DELIVERIES ACCORDION */}
        {showOrdersPanel && (
          <div className="lg:col-span-4 flex flex-col min-h-0 bg-background">
            <div className="shrink-0 px-4 py-2.5 border-b border-border bg-card flex items-center justify-between gap-2">
              <div className="font-semibold text-xs uppercase tracking-wider flex items-center gap-2 text-muted-foreground">
                <Sparkles className="w-4 h-4 text-primary" />
                Unassigned Deliveries ({filteredOrderSuggestions.length})
              </div>

              <div className="flex items-center gap-1.5">
                {/* Compact Hub Filter for Open Orders */}
                <div className="inline-flex rounded-md border border-border bg-secondary p-0.5 text-[11px] font-semibold">
                  <button
                    type="button"
                    onClick={() => setOrderFilter("all")}
                    className={`px-2 py-0.5 rounded transition-colors ${
                      orderFilter === "all"
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    All
                  </button>
                  <button
                    type="button"
                    onClick={() => setOrderFilter("sioux_falls")}
                    className={`px-2 py-0.5 rounded transition-colors ${
                      orderFilter === "sioux_falls"
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    SF
                  </button>
                  <button
                    type="button"
                    onClick={() => setOrderFilter("arlington")}
                    className={`px-2 py-0.5 rounded transition-colors ${
                      orderFilter === "arlington"
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    ARL
                  </button>
                </div>

                {/* Close Panel Button to Expand Map */}
                <button
                  type="button"
                  onClick={() => setShowOrdersPanel(false)}
                  title="Close Unassigned Deliveries panel to expand the map"
                  className="text-xs font-semibold px-2.5 py-1 rounded-md border border-border bg-secondary hover:bg-secondary/80 text-foreground"
                >
                  Hide ▸
                </button>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2.5">
              {/* Accordion 1: Recommended Route Add-Ons (Same-Town & Corridor Matches) */}
              <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/5 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowRecommendedOrders((prev) => !prev)}
                  className="w-full px-3.5 py-2.5 text-xs flex items-center justify-between hover:bg-emerald-500/10 transition-colors"
                >
                  <span className={`font-bold flex items-center gap-1.5 ${textGreen}`}>
                    🟢 Recommended Route Add-Ons ({recommendedOrders.length})
                  </span>
                  <span className="text-muted-foreground flex items-center gap-1 font-semibold">
                    {showRecommendedOrders ? (
                      <>
                        Hide <ChevronUp className="w-3.5 h-3.5" />
                      </>
                    ) : (
                      <>
                        Show <ChevronDown className="w-3.5 h-3.5" />
                      </>
                    )}
                  </span>
                </button>

                {showRecommendedOrders && (
                  <div className="p-2.5 pt-0 space-y-2">
                    {recommendedOrders.length === 0 ? (
                      <div className="rounded-lg border border-border bg-card p-3 text-center text-xs text-muted-foreground">
                        No open orders currently overlap active routes for this filter.
                      </div>
                    ) : (
                      recommendedOrders.map((item) => renderOrderCard(item))
                    )}
                  </div>
                )}
              </div>

              {/* Accordion 2: Other Open Orders Waiting for a Sheet */}
              {otherWaitingOrders.length > 0 && (
                <div className="rounded-xl border border-border bg-secondary/30 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setShowOtherOpenOrders((prev) => !prev)}
                    className="w-full px-3.5 py-2.5 text-xs font-semibold flex items-center justify-between text-foreground hover:bg-secondary/60 transition-colors"
                  >
                    <span className="flex items-center gap-2">
                      <Package className="w-4 h-4 text-muted-foreground" />
                      Other Unassigned Deliveries ({otherWaitingOrders.length})
                    </span>
                    <span className="text-muted-foreground flex items-center gap-1">
                      {showOtherOpenOrders ? (
                        <>
                          Hide <ChevronUp className="w-3.5 h-3.5" />
                        </>
                      ) : (
                        <>
                          Show <ChevronDown className="w-3.5 h-3.5" />
                        </>
                      )}
                    </span>
                  </button>

                  {showOtherOpenOrders && (
                    <div className="p-2.5 pt-0 space-y-2">
                      {otherWaitingOrders.map((item) => renderOrderCard(item))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      <DoodleworksLegalFooter />
    </div>
  );
}
