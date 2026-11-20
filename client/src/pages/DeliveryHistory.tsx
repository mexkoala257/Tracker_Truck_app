import { useState, useEffect, useCallback, useMemo } from "react";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { useOfficeTheme } from "@/lib/theme";
import { useToast } from "@/hooks/use-toast";
import TrackingMap from "@/components/TrackingMap";
import {
  IbsBrandHeaderMark,
  DoodleworksLegalFooter,
} from "@/components/IbsBrandComponents";
import {
  type HotShotRoute,
  buildHotShotRouteOverlays,
  computeHotShotMapBounds,
} from "@shared/hotshots";
import {
  Zap,
  Calendar,
  Map as MapIcon,
  History,
  Search,
  Download,
  RefreshCw,
  Database,
  Building2,
  MapPin,
  Phone,
  Truck,
  BatteryCharging,
  Clock,
  Copy,
  Code2,
  ChevronDown,
  ChevronUp,
  Tv,
  Square,
  Compass,
  Sun,
  Moon,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface CustomerAccountSummary {
  customerKey: string;
  dealerNumber: string;
  dealerId: number;
  accountName: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  lat: number | null;
  lon: number | null;
  primaryHub: "sioux_falls" | "arlington";
  uniqueVisitDays: number;
  allTimeVisitDays?: number;
  totalDeliveries: number;
  visitsLast30d: number;
  visitsLast90d: number;
  visitsLast365d: number;
  totalPieces: number;
  totalWeightLbs: number;
  firstVisitDateISO: string;
  lastVisitDateISO: string;
  daysSinceLastVisit: number;
  avgDaysBetweenVisits: number | null;
  maxGapDays?: number | null;
  lastDriverName: string;
  deliveryTypeBreakdown: {
    hotshot: number;
    route_truck: number;
    ups_shipping: number;
  };
  topDrivers: Array<{ driverName: string; visits: number }>;
  topParts: Array<{
    partNumber: string;
    description: string;
    totalQty: number;
    orderCount: number;
  }>;
}

interface HistoricalDeliveryRecord {
  key: string;
  deliveryId: number;
  dateISO: string;
  sheetNum: number;
  stopOrder: number;
  dealerId: number;
  dealerNumber: string;
  accountName: string;
  city: string;
  state: string;
  driverName: string;
  rawDriverName: string;
  originHub: "sioux_falls" | "arlington";
  deliveryType: "hotshot" | "route_truck" | "ups_shipping";
  poNumber: string;
  notes: string;
  partsSummary: string;
  piecesCount: number;
  estimatedWeightLbs: number;
}

interface BackfillStatus {
  isBackfilling: boolean;
  activePreset: string | null;
  completedDays: number;
  totalDaysToFetch: number;
  totalIndexedDays: number;
  totalDeliveriesIndexed: number;
  totalUniqueCustomers: number;
  earliestIndexedDateISO: string | null;
  latestIndexedDateISO: string | null;
  lastUpdatedAt: string | null;
  lastError: string | null;
}

interface HistoricalCorridorTownNode {
  city: string;
  state: string;
  visits: number;
  stops: number;
  batteries: number;
  weightLbs: number;
  lat: number;
  lon: number;
  avgStopOrder: number;
  topAccounts: string[];
}

interface HistoricalCorridorRun {
  dateISO: string;
  stopsCount: number;
  batteries: number;
  weightLbs: number;
  estimatedMiles?: number;
  townsLabel: string;
  stops: Array<{
    order: number;
    accountName: string;
    dealerNumber: string;
    city: string;
    state: string;
    lat: number;
    lon: number;
    pieces: number;
    weightLbs: number;
    partsSummary: string;
  }>;
}

interface HistoricalWeekdayCorridor {
  id: string;
  dayOfWeek: number;
  dayLabel: string;
  dayShort: string;
  driverName: string;
  originHub: "sioux_falls" | "arlington";
  deliveryType: "hotshot" | "route_truck" | "ups_shipping";
  color: string;
  compassDirection: string;
  corridorHeadline: string;
  runsCount: number;
  totalStops: number;
  totalBatteries: number;
  totalWeightLbs: number;
  totalEstimatedMiles?: number;
  avgMilesPerRun?: number;
  avgStopsPerRun: number;
  weekdayRunCounts?: Array<{
    dayOfWeek: number;
    dayShort: string;
    runs: number;
    stops: number;
    miles?: number;
  }>;
  topTowns: HistoricalCorridorTownNode[];
  recentRuns: HistoricalCorridorRun[];
}

interface WeekdayBreakdownItem {
  dayOfWeek: number;
  dayLabel: string;
  dayShort: string;
  activeDatesCount: number;
  totalStops: number;
  totalBatteries: number;
  drivers: string[];
  topCities: Array<{ city: string; count: number }>;
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

export default function DeliveryHistory() {
  const { scope } = useAuth();
  const canEdit = scope === "admin" || scope === "staff";
  const { officeTheme, setOfficeTheme, themes: officeThemes, isLight } = useOfficeTheme();
  const { toast } = useToast();

  // Primary View Mode: "corridor_map" (Direction & Weekday Map) vs "customer_crm" (Customer Accounts & CRM)
  const [activeSubView, setActiveSubView] = useState<"corridor_map" | "customer_crm">(
    "corridor_map",
  );
  const [mapDarkMode, setMapDarkMode] = useState<boolean>(() => !isLight);

  useEffect(() => {
    setMapDarkMode(!isLight);
  }, [isLight]);

  // Shared Window & Hub Filter States (Defaulting to 12 Months / 365 days)
  const [daysWindow, setDaysWindow] = useState<"30" | "90" | "180" | "365" | "all">("365");
  const [hubFilter, setHubFilter] = useState<"all" | "sioux_falls" | "arlington">("all");
  const [deliveryTypeFilter, setDeliveryTypeFilter] = useState<
    "all" | "hotshot" | "route_truck" | "ups_shipping"
  >("all");

  // Corridor Map Specific Filters
  const [corridorGroupBy, setCorridorGroupBy] = useState<"weekday_driver" | "driver">(
    "weekday_driver",
  );
  const [selectedWeekday, setSelectedWeekday] = useState<"all" | number>("all");
  const [selectedDriverFilter, setSelectedDriverFilter] = useState<string>("all");
  const [corridors, setCorridors] = useState<HistoricalWeekdayCorridor[]>([]);
  const [weekdayBreakdown, setWeekdayBreakdown] = useState<WeekdayBreakdownItem[]>([]);
  const [allHistoryDrivers, setAllHistoryDrivers] = useState<string[]>([]);
  const [focusedCorridorId, setFocusedCorridorId] = useState<string | null>(null);
  const [selectedRunDateByCorridor, setSelectedRunDateByCorridor] = useState<
    Record<string, string>
  >({});
  const [loadingMapData, setLoadingMapData] = useState<boolean>(true);

  // Customer CRM Specific Filters & States
  const [sortBy, setSortBy] = useState<"visits" | "recent" | "batteries" | "frequency">(
    "visits",
  );
  const [searchInput, setSearchInput] = useState<string>("");
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");

  const [loadingCustomers, setLoadingCustomers] = useState<boolean>(true);
  const [status, setStatus] = useState<BackfillStatus | null>(null);
  const [totals, setTotals] = useState<{
    matchingCustomers: number;
    matchingDeliveries: number;
    matchingBatteries: number;
    matchingWeightLbs: number;
    topCities: Array<{ city: string; state: string; visits: number; customers: number }>;
  } | null>(null);
  const [customers, setCustomers] = useState<CustomerAccountSummary[]>([]);

  // Selected Customer Detail Timeline
  const [selectedCustomerKey, setSelectedCustomerKey] = useState<string | null>(null);
  const [selectedCustomerDetail, setSelectedCustomerDetail] = useState<{
    customer: CustomerAccountSummary;
    deliveries: HistoricalDeliveryRecord[];
  } | null>(null);
  const [loadingDetail, setLoadingDetail] = useState<boolean>(false);
  const [showCrmApiDrawer, setShowCrmApiDrawer] = useState<boolean>(false);

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput.trim()), 220);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Fetch Corridor Map Data
  const fetchCorridorMapData = useCallback(
    async (silent = false) => {
      if (!silent) setLoadingMapData(true);
      try {
        const params = new URLSearchParams({
          days: daysWindow,
          weekday: String(selectedWeekday),
          hub: hubFilter,
          driver: selectedDriverFilter,
          deliveryType: deliveryTypeFilter === "ups_shipping" ? "all" : deliveryTypeFilter,
          groupBy: corridorGroupBy,
        });
        const res = await fetch(`/api/hotshot-history/corridor-map?${params.toString()}`);
        if (!res.ok) throw new Error("Failed loading historical corridor map");
        const data = await res.json();
        if (data.status) setStatus(data.status);
        if (Array.isArray(data.weekdayBreakdown)) setWeekdayBreakdown(data.weekdayBreakdown);
        if (Array.isArray(data.drivers)) setAllHistoryDrivers(data.drivers);
        if (Array.isArray(data.corridors)) {
          setCorridors(data.corridors);
          setFocusedCorridorId((prev) => {
            if (prev && data.corridors.some((c: HistoricalWeekdayCorridor) => c.id === prev)) {
              return prev;
            }
            return null;
          });
        }
      } catch (err: any) {
        if (!silent) {
          toast({
            title: "Could not load corridor map",
            description: err?.message,
            variant: "destructive",
          });
        }
      } finally {
        if (!silent) setLoadingMapData(false);
      }
    },
    [
      daysWindow,
      selectedWeekday,
      hubFilter,
      selectedDriverFilter,
      deliveryTypeFilter,
      corridorGroupBy,
    ],
  );

  // Fetch Customer Summary Data
  const fetchCustomerSummary = useCallback(
    async (silent = false) => {
      if (!silent) setLoadingCustomers(true);
      try {
        const params = new URLSearchParams({
          days: daysWindow,
          hub: hubFilter,
          deliveryType: deliveryTypeFilter,
          sort: sortBy,
          search: debouncedSearch,
          limit: "500",
        });
        const res = await fetch(`/api/hotshot-history/summary?${params.toString()}`);
        if (!res.ok) throw new Error("Failed loading delivery history");
        const data = await res.json();
        if (data.status) setStatus(data.status);
        if (data.totals) setTotals(data.totals);
        if (Array.isArray(data.customers)) {
          setCustomers(data.customers);
          setSelectedCustomerKey((prev) => {
            if (
              prev &&
              data.customers.some((c: CustomerAccountSummary) => c.customerKey === prev)
            ) {
              return prev;
            }
            return data.customers[0]?.customerKey || null;
          });
        }
      } catch (err: any) {
        if (!silent) {
          toast({
            title: "Could not load history",
            description: err?.message,
            variant: "destructive",
          });
        }
      } finally {
        if (!silent) setLoadingCustomers(false);
      }
    },
    [daysWindow, hubFilter, deliveryTypeFilter, sortBy, debouncedSearch],
  );

  useEffect(() => {
    fetchCorridorMapData();
    fetchCustomerSummary();
  }, [fetchCorridorMapData, fetchCustomerSummary]);

  // Poll every 2.5 seconds while background backfill is actively running
  useEffect(() => {
    if (!status?.isBackfilling) return;
    const timer = setInterval(() => {
      fetchCorridorMapData(true);
      fetchCustomerSummary(true);
    }, 2500);
    return () => clearInterval(timer);
  }, [status?.isBackfilling, fetchCorridorMapData, fetchCustomerSummary]);

  // Fetch full delivery timeline when selectedCustomerKey changes
  useEffect(() => {
    if (!selectedCustomerKey) {
      setSelectedCustomerDetail(null);
      return;
    }
    let cancelled = false;
    setLoadingDetail(true);
    fetch(`/api/hotshot-history/customer/${encodeURIComponent(selectedCustomerKey)}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.ok && data.customer) {
          setSelectedCustomerDetail({
            customer: data.customer,
            deliveries: Array.isArray(data.deliveries) ? data.deliveries : [],
          });
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedCustomerKey, status?.totalDeliveriesIndexed]);

  // Convert visible corridors (or focused corridor) into synthetic HotShotRoute objects for <TrackingMap>
  const syntheticMapRoutes = useMemo((): HotShotRoute[] => {
    const targetCorridors = focusedCorridorId
      ? corridors.filter((c) => c.id === focusedCorridorId)
      : corridors.slice(0, 8); // Show top 8 corridors when viewing all so map stays clean and readable

    return targetCorridors.map((c) => {
      const selectedDate = selectedRunDateByCorridor[c.id] || "__typical__";
      const matchedRun =
        selectedDate !== "__typical__"
          ? c.recentRuns.find((r) => r.dateISO === selectedDate)
          : null;

      if (matchedRun && matchedRun.stops.length > 0) {
        return {
          id: `${c.id}-${matchedRun.dateISO}`,
          title: `${c.dayShort} (${matchedRun.dateISO}) — ${matchedRun.townsLabel}`,
          driverName: `${c.driverName} (${c.dayShort} ${matchedRun.dateISO})`,
          deliveryDateISO: matchedRun.dateISO,
          originHub: c.originHub,
          color: c.color,
          active: true,
          createdAt: matchedRun.dateISO,
          updatedAt: matchedRun.dateISO,
          stops: matchedRun.stops.map((s, idx) => ({
            id: `${c.id}-${matchedRun.dateISO}-${idx}`,
            order: idx + 1,
            accountName: s.accountName,
            accountCode: s.dealerNumber,
            address: `${s.city}, ${s.state}`,
            city: s.city,
            state: s.state,
            lat: s.lat,
            lon: s.lon,
            piecesCount: s.pieces,
            partsSummary: s.partsSummary,
            notes: `~${s.weightLbs} lbs`,
            completedAt: null,
            completedBy: null,
          })),
        };
      }

      // Default: Typical Aggregated Corridor Loop across top towns visited on this weekday
      const mapOrderedTowns = [...c.topTowns].sort((a, b) => a.avgStopOrder - b.avgStopOrder);
      return {
        id: c.id,
        title: `${c.dayShort}s — ${c.compassDirection} (${c.corridorHeadline})`,
        driverName: `${c.driverName} • ${c.dayLabel}s (${c.runsCount} runs)`,
        deliveryDateISO: "2026-01-01",
        originHub: c.originHub,
        color: c.color,
        active: true,
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
        stops: mapOrderedTowns.map((t, idx) => ({
          id: `${c.id}-town-${idx}`,
          order: idx + 1,
          accountName: `${t.city} (${t.visits}x visited • ${t.stops} stops)`,
          address: `${t.city}, ${t.state}`,
          city: t.city,
          state: t.state,
          lat: t.lat,
          lon: t.lon,
          piecesCount: t.batteries,
          notes: `Top accounts: ${t.topAccounts.join(", ")}`,
          completedAt: null,
          completedBy: null,
        })),
      };
    });
  }, [corridors, focusedCorridorId, selectedRunDateByCorridor]);

  const mapOverlays = useMemo(() => {
    return buildHotShotRouteOverlays(syntheticMapRoutes, {
      sfWarehouse: DEFAULT_SF_WAREHOUSE,
      mainWarehouse: DEFAULT_ARLINGTON_WAREHOUSE,
    });
  }, [syntheticMapRoutes]);

  const mapBounds = useMemo(() => {
    return computeHotShotMapBounds(syntheticMapRoutes, DEFAULT_SF_WAREHOUSE, undefined, {
      sfWarehouse: DEFAULT_SF_WAREHOUSE,
      mainWarehouse: DEFAULT_ARLINGTON_WAREHOUSE,
    });
  }, [syntheticMapRoutes]);

  const handleTriggerBackfill = async (preset: "90d" | "1y" | "3y" | "all_2015") => {
    try {
      const res = await fetch("/api/hotshot-history/backfill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", preset }),
      });
      const data = await res.json();
      if (data?.status) setStatus(data.status);
      toast({
        title: "Historical Collection Started",
        description:
          data?.status?.totalDaysToFetch > 0
            ? `Fetching ${data.status.totalDaysToFetch} unindexed days in the background...`
            : "All days in that window are already indexed!",
      });
      fetchCorridorMapData(true);
      fetchCustomerSummary(true);
    } catch (err: any) {
      toast({
        title: "Backfill Failed",
        description: err?.message,
        variant: "destructive",
      });
    }
  };

  const handleStopBackfill = async () => {
    try {
      const res = await fetch("/api/hotshot-history/backfill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop" }),
      });
      const data = await res.json();
      if (data?.status) setStatus(data.status);
    } catch {}
  };

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

  const formatCadenceBadge = (avgDays: number | null, totalVisits: number) => {
    if (avgDays === null) {
      return `Occasional (${totalVisits} visit${totalVisits === 1 ? "" : "s"})`;
    }
    if (avgDays >= 60) {
      const mos = Math.round((avgDays / 30.4375) * 10) / 10;
      return `Every ~${mos} mos (${Math.round(avgDays)}d)`;
    }
    return `Every ~${avgDays}d`;
  };

  const originUrl =
    typeof window !== "undefined" ? window.location.origin : "https://srv1205734.hstgr.cloud";

  return (
    <div className="h-screen w-screen overflow-hidden bg-background text-foreground flex flex-col">
      {/* 1. UNIFIED TOP NAVIGATION BAR */}
      <header className="shrink-0 border-b border-border bg-secondary/70 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <IbsBrandHeaderMark />

          <div className="inline-flex rounded-lg bg-card border border-border p-0.5 text-xs">
            <Link href="/dispatch">
              <button
                type="button"
                className="px-3 py-1.5 rounded-md font-semibold text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5"
              >
                <Zap className="w-3.5 h-3.5" />
                Dispatch & Routes
              </button>
            </Link>
            <span className="px-3 py-1.5 rounded-md font-bold bg-primary text-primary-foreground shadow-sm flex items-center gap-1.5">
              <History className="w-3.5 h-3.5" />
              Delivery History
            </span>
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

        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* Primary Sub-View Switcher: Historical Direction Map vs Customer CRM List */}
          <div className="inline-flex rounded-lg border border-primary/50 bg-card p-0.5">
            <button
              type="button"
              onClick={() => setActiveSubView("corridor_map")}
              className={`px-3 py-1 rounded-md font-bold transition-all flex items-center gap-1.5 ${
                activeSubView === "corridor_map"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Compass className="w-3.5 h-3.5" />
              Weekday & Direction Map
            </button>
            <button
              type="button"
              onClick={() => setActiveSubView("customer_crm")}
              className={`px-3 py-1 rounded-md font-bold transition-all flex items-center gap-1.5 ${
                activeSubView === "customer_crm"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Building2 className="w-3.5 h-3.5" />
              Customer Accounts & CRM ({totals?.matchingCustomers || customers.length})
            </button>
          </div>

          <a
            href={`/api/hotshot-history/export.csv?days=${daysWindow}&hub=${hubFilter}&search=${encodeURIComponent(
              debouncedSearch,
            )}`}
            download
          >
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs font-semibold gap-1.5 rounded-lg"
            >
              <Download className="w-3.5 h-3.5 text-primary" />
              Export CSV for CRM
            </Button>
          </a>

          <Button
            size="sm"
            variant={showCrmApiDrawer ? "default" : "outline"}
            onClick={() => setShowCrmApiDrawer((prev) => !prev)}
            className="h-8 text-xs font-semibold gap-1.5 rounded-lg"
          >
            <Code2 className="w-3.5 h-3.5" />
            Sales CRM API
          </Button>

          <select
            value={officeTheme}
            onChange={(e) => setOfficeTheme(e.target.value as any)}
            className="h-8 rounded-lg border border-border bg-card px-2.5 text-xs font-semibold text-foreground focus:outline-none cursor-pointer"
          >
            {officeThemes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.shortLabel}
              </option>
            ))}
          </select>

          <Link href="/display?panel=screen-5">
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs font-semibold gap-1.5 rounded-lg"
            >
              <Tv className="w-3.5 h-3.5 text-primary" />
              Open TV Screen
            </Button>
          </Link>
        </div>
      </header>

      {/* OPTIONAL COLLAPSIBLE SALES CRM API INTEGRATION DRAWER */}
      {showCrmApiDrawer && (
        <div className="shrink-0 border-b border-primary/40 bg-primary/5 px-4 py-3 text-xs space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-bold text-foreground flex items-center gap-2">
              <Code2 className="w-4 h-4 text-primary" />
              Direct VPS Sales CRM Endpoints (CORS-Enabled JSON Feeds)
            </div>
            <a href="/api/hotshot-history/export.json" download>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5">
                <Download className="w-3.5 h-3.5" />
                Download Full JSON Snapshot
              </Button>
            </a>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 font-mono text-[11px]">
            <div className="rounded-lg border border-border bg-card p-2.5 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-muted-foreground font-sans font-semibold">
                  1. All Sorted Customer Accounts & Visit Frequencies (Keyed by DealerNumber):
                </div>
                <div className="text-foreground truncate mt-0.5">
                  GET {originUrl}/api/crm/customers?days=all
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 shrink-0"
                onClick={() => {
                  navigator.clipboard.writeText(`${originUrl}/api/crm/customers?days=all`);
                  toast({ title: "Copied CRM Customers Endpoint!" });
                }}
              >
                <Copy className="w-3.5 h-3.5" />
              </Button>
            </div>
            <div className="rounded-lg border border-border bg-card p-2.5 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-muted-foreground font-sans font-semibold">
                  2. Single Account Delivery Timeline (Pass IBS Account # or DealerId):
                </div>
                <div className="text-foreground truncate mt-0.5">
                  GET {originUrl}/api/crm/customers/90720000000093
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 shrink-0"
                onClick={() => {
                  navigator.clipboard.writeText(
                    `${originUrl}/api/crm/customers/90720000000093`,
                  );
                  toast({ title: "Copied Single Account CRM Endpoint!" });
                }}
              >
                <Copy className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 2. HISTORICAL DATA COLLECTOR & BACKFILL BAR */}
      <div className="shrink-0 border-b border-border bg-card px-4 py-2 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="inline-flex items-center gap-1.5 font-semibold text-foreground">
            <Database className="w-3.5 h-3.5 text-primary" />
            Indexed Archive:
          </span>
          <span className="px-2.5 py-0.5 rounded-md bg-secondary border border-border font-mono">
            <strong>{status?.totalIndexedDays?.toLocaleString() || 0}</strong> days
            {status?.earliestIndexedDateISO && status?.latestIndexedDateISO
              ? ` (${status.earliestIndexedDateISO} → ${status.latestIndexedDateISO})`
              : ""}
          </span>
          <span className="text-muted-foreground">
            •{" "}
            <strong className="text-foreground">
              {status?.totalDeliveriesIndexed?.toLocaleString() || 0}
            </strong>{" "}
            deliveries sorted across{" "}
            <strong className="text-foreground">
              {status?.totalUniqueCustomers?.toLocaleString() || 0}
            </strong>{" "}
            customer accounts
          </span>
        </div>

        {/* Backfill Action Buttons or Live Progress Indicator */}
        <div className="flex flex-wrap items-center gap-1.5">
          {status?.isBackfilling ? (
            <div className="flex items-center gap-2 px-3 py-1 rounded-lg border border-amber-500/50 bg-amber-500/10">
              <RefreshCw className="w-3.5 h-3.5 text-amber-500 animate-spin" />
              <span className="font-mono font-bold text-foreground">
                Collecting History ({status.activePreset}): {status.completedDays} /{" "}
                {status.totalDaysToFetch} days
              </span>
              <button
                type="button"
                onClick={handleStopBackfill}
                className="px-2 py-0.5 rounded bg-card border border-border text-xs font-semibold hover:bg-secondary flex items-center gap-1"
              >
                <Square className="w-3 h-3" />
                Stop
              </button>
            </div>
          ) : (
            <>
              <span className="text-muted-foreground mr-1">Expand Archive:</span>
              <button
                type="button"
                onClick={() => handleTriggerBackfill("90d")}
                className="px-2.5 py-1 rounded-md border border-border bg-secondary hover:bg-secondary/80 font-semibold transition-colors"
              >
                + Last 90 Days
              </button>
              <button
                type="button"
                onClick={() => handleTriggerBackfill("1y")}
                className="px-2.5 py-1 rounded-md border border-border bg-secondary hover:bg-secondary/80 font-semibold transition-colors"
              >
                + Last 12 Months
              </button>
              <button
                type="button"
                onClick={() => handleTriggerBackfill("3y")}
                className="px-2.5 py-1 rounded-md border border-border bg-secondary hover:bg-secondary/80 font-semibold transition-colors"
              >
                + Last 3 Years
              </button>
              <button
                type="button"
                onClick={() => handleTriggerBackfill("all_2015")}
                className="px-2.5 py-1 rounded-md border border-primary/40 bg-primary/10 hover:bg-primary/20 text-foreground font-semibold transition-colors"
              >
                + Full Archive (Back to 2015)
              </button>
            </>
          )}
        </div>
      </div>

      {/* ===================================================================== */}
      {/* VIEW A: HISTORICAL WEEKDAY & DIRECTION CORRIDOR MAP (12 MONTHS)       */}
      {/* ===================================================================== */}
      {activeSubView === "corridor_map" ? (
        <>
          {/* Weekday & Corridor Filter Strip */}
          <div className="shrink-0 border-b border-border bg-secondary/35 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2.5 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              {/* Group By Mode Toggle: By Weekday & Direction vs Total Runs by Driver */}
              <div className="inline-flex rounded-lg border border-primary/50 bg-card p-0.5">
                <button
                  type="button"
                  onClick={() => {
                    setCorridorGroupBy("weekday_driver");
                    setFocusedCorridorId(null);
                  }}
                  className={`px-3 py-1 rounded-md font-bold transition-all flex items-center gap-1.5 ${
                    corridorGroupBy === "weekday_driver"
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Calendar className="w-3.5 h-3.5" />
                  By Weekday & Direction
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCorridorGroupBy("driver");
                    setSelectedWeekday("all");
                    setFocusedCorridorId(null);
                  }}
                  className={`px-3 py-1 rounded-md font-bold transition-all flex items-center gap-1.5 ${
                    corridorGroupBy === "driver"
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <User className="w-3.5 h-3.5" />
                  Total Runs by Driver
                </button>
              </div>

              {/* Day of Week Selector Pills */}
              <div className="inline-flex rounded-lg border border-border bg-secondary p-0.5">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedWeekday("all");
                    setFocusedCorridorId(null);
                  }}
                  className={`px-3 py-1 rounded-md font-bold transition-all ${
                    selectedWeekday === "all"
                      ? "bg-foreground text-background shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  All Days (Mon–Fri)
                </button>
                {[
                  { dow: 1, label: "Monday" },
                  { dow: 2, label: "Tuesday" },
                  { dow: 3, label: "Wednesday" },
                  { dow: 4, label: "Thursday" },
                  { dow: 5, label: "Friday" },
                ].map((d) => {
                  const stat = weekdayBreakdown.find((w) => w.dayOfWeek === d.dow);
                  return (
                    <button
                      key={d.dow}
                      type="button"
                      onClick={() => {
                        setSelectedWeekday(d.dow);
                        setFocusedCorridorId(null);
                      }}
                      className={`px-3 py-1 rounded-md font-bold transition-all flex items-center gap-1.5 ${
                        selectedWeekday === d.dow
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <span>{d.label}</span>
                      {stat && stat.totalStops > 0 && (
                        <span className="opacity-75 font-mono text-[10px]">
                          ({stat.totalStops})
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Driver Filter */}
              <select
                value={selectedDriverFilter}
                onChange={(e) => {
                  setSelectedDriverFilter(e.target.value);
                  setFocusedCorridorId(null);
                }}
                className="h-8 rounded-lg border border-border bg-card px-2.5 text-xs font-semibold text-foreground focus:outline-none cursor-pointer"
              >
                <option value="all">👤 All Drivers ({allHistoryDrivers.length})</option>
                {allHistoryDrivers.map((drv) => (
                  <option key={drv} value={drv}>
                    👤 {drv}
                  </option>
                ))}
              </select>

              {/* Hub Filter */}
              <div className="inline-flex rounded-lg border border-border bg-secondary p-0.5">
                {(
                  [
                    { id: "all", label: "All Hubs" },
                    { id: "sioux_falls", label: "Sioux Falls" },
                    { id: "arlington", label: "Arlington" },
                  ] as const
                ).map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => {
                      setHubFilter(h.id);
                      setFocusedCorridorId(null);
                    }}
                    className={`px-2.5 py-1 rounded-md font-semibold transition-all ${
                      hubFilter === h.id
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {h.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Historical Window Selector (Default 12 Months) */}
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground font-medium">History Window:</span>
              <div className="inline-flex rounded-lg border border-border bg-secondary p-0.5">
                {(
                  [
                    { id: "90", label: "90 Days" },
                    { id: "180", label: "6 Months" },
                    { id: "365", label: "12 Months" },
                    { id: "all", label: "All Indexed" },
                  ] as const
                ).map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => setDaysWindow(w.id)}
                    className={`px-2.5 py-1 rounded-md font-semibold transition-all ${
                      daysWindow === w.id
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {w.label}
                  </button>
                ))}
              </div>

              <Button
                size="sm"
                variant="outline"
                onClick={() => setMapDarkMode((d) => !d)}
                title="Toggle Map Light / Dark Mode"
                className="h-8 w-8 p-0 rounded-lg"
              >
                {mapDarkMode ? (
                  <Sun className="w-3.5 h-3.5 text-primary" />
                ) : (
                  <Moon className="w-3.5 h-3.5" />
                )}
              </Button>
            </div>
          </div>

          {/* 2-Column Workspace: Left Corridor Cards by Weekday & Driver (4 cols) + Right Interactive Map (8 cols) */}
          <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
            {/* LEFT (4 cols): HISTORICAL DRIVER & DIRECTION CORRIDORS */}
            <div className="lg:col-span-4 border-r border-border flex flex-col min-h-0 bg-background">
              <div className="shrink-0 px-4 py-2.5 border-b border-border bg-card flex items-center justify-between gap-2 text-xs">
                <div className="font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                  <Compass className="w-4 h-4 text-primary" />
                  {corridorGroupBy === "driver"
                    ? `Drivers Ranked by Total Runs (${corridors.length})`
                    : `Historical Corridors (${corridors.length})`}
                </div>
                {focusedCorridorId && (
                  <button
                    type="button"
                    onClick={() => setFocusedCorridorId(null)}
                    className="text-xs font-semibold px-2.5 py-1 rounded-md border border-border bg-secondary text-foreground hover:bg-secondary/80"
                  >
                    Show All on Map
                  </button>
                )}
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2.5">
                {loadingMapData && corridors.length === 0 ? (
                  <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
                    Analyzing historical weekday directions & drivers...
                  </div>
                ) : corridors.length === 0 ? (
                  <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
                    No historical routes match this weekday/driver filter.
                  </div>
                ) : (
                  corridors.map((c, corridorIdx) => {
                    const isFocused = focusedCorridorId === c.id;
                    const selectedDate = selectedRunDateByCorridor[c.id] || "__typical__";
                    const isDriverTotalMode = corridorGroupBy === "driver" || c.dayOfWeek === 0;

                    return (
                      <div
                        key={c.id}
                        className={`rounded-xl border transition-all overflow-hidden ${
                          isFocused
                            ? "border-primary bg-card shadow-sm ring-1 ring-primary/30"
                            : "border-border bg-secondary/40 hover:bg-card"
                        }`}
                        style={{
                          borderLeftWidth: "6px",
                          borderLeftColor: c.color,
                        }}
                      >
                        <div
                          onClick={() =>
                            setFocusedCorridorId((prev) => (prev === c.id ? null : c.id))
                          }
                          className="cursor-pointer p-3 space-y-1.5"
                        >
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span
                                className="px-2 py-0.5 rounded-md font-mono font-bold text-xs text-white"
                                style={{ backgroundColor: c.color }}
                              >
                                {isDriverTotalMode ? `#${corridorIdx + 1}` : `${c.dayLabel}s`}
                              </span>
                              <span className="font-bold text-sm text-foreground">
                                {c.driverName}
                              </span>
                              <span className="text-[11px] px-2 py-0.5 rounded bg-secondary border border-border text-muted-foreground">
                                {c.originHub === "arlington" ? "Arlington" : "Sioux Falls"}
                              </span>
                            </div>

                            <div className="flex items-center gap-1.5">
                              {typeof c.totalEstimatedMiles === "number" &&
                                c.totalEstimatedMiles > 0 && (
                                  <span
                                    className={`text-xs font-mono px-2 py-0.5 rounded border ${badgeGreen}`}
                                    title={`Estimated round-trip road miles (~${c.avgMilesPerRun || 0} mi/run)`}
                                  >
                                    ~{c.totalEstimatedMiles.toLocaleString()} mi
                                  </span>
                                )}
                              <span
                                className={`text-xs font-mono px-2 py-0.5 rounded border ${badgeAmber}`}
                              >
                                {c.runsCount} {isDriverTotalMode ? "Total " : ""}
                                {c.runsCount === 1 ? "Run" : "Runs"}
                              </span>
                            </div>
                          </div>

                          {/* Per-Weekday Run Breakdown Pills when grouped by driver */}
                          {isDriverTotalMode &&
                            Array.isArray(c.weekdayRunCounts) &&
                            c.weekdayRunCounts.length > 0 && (
                              <div className="flex flex-wrap items-center gap-1 pt-0.5">
                                {c.weekdayRunCounts.map((w) => (
                                  <span
                                    key={w.dayOfWeek}
                                    className="px-1.5 py-0.5 rounded bg-card border border-border font-mono text-[10px] text-foreground"
                                    title={`${w.runs} runs (${w.stops} total stops${
                                      w.miles ? ` • ~${w.miles.toLocaleString()} est. mi` : ""
                                    }) on ${w.dayShort}`}
                                  >
                                    <strong className="text-primary">{w.dayShort}:</strong> {w.runs}r
                                  </span>
                                ))}
                              </div>
                            )}

                          {/* Compass Direction & Typical Towns Headline */}
                          <div className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                            <Compass className="w-3.5 h-3.5 text-primary shrink-0" />
                            <span>
                              {c.compassDirection}:{" "}
                              <span className="text-muted-foreground font-normal">
                                {c.corridorHeadline}
                              </span>
                            </span>
                          </div>

                          <div className="text-[11px] text-muted-foreground flex items-center justify-between pt-0.5 gap-2 flex-wrap">
                            <span>
                              <strong className="text-foreground">{c.totalStops}</strong> stops (~
                              {c.avgStopsPerRun}/run) •{" "}
                              <strong className="text-foreground">
                                {c.totalBatteries.toLocaleString()}
                              </strong>{" "}
                              pcs
                              {typeof c.totalEstimatedMiles === "number" &&
                                c.totalEstimatedMiles > 0 && (
                                  <>
                                    {" "}
                                    •{" "}
                                    <strong className={textGreen}>
                                      ~{c.totalEstimatedMiles.toLocaleString()} est. mi
                                    </strong>{" "}
                                    (~{c.avgMilesPerRun || 0} mi/run)
                                  </>
                                )}
                            </span>
                            <span className="inline-flex items-center gap-0.5">
                              {isFocused ? (
                                <>
                                  Hide <ChevronUp className="w-3.5 h-3.5" />
                                </>
                              ) : (
                                <>
                                  Details <ChevronDown className="w-3.5 h-3.5" />
                                </>
                              )}
                            </span>
                          </div>
                        </div>

                        {/* Expanded Section: Typical Town Loop Order + Past Sheet Date Picker */}
                        {isFocused && (
                          <div className="border-t border-border p-3 bg-card space-y-2.5 text-xs">
                            {/* Switch between Typical Aggregated Loop vs Specific Historical Run Date */}
                            <div className="space-y-1">
                              <div className="text-[11px] font-semibold text-muted-foreground">
                                Map Display Mode for {c.driverName} (
                                {isDriverTotalMode ? "All Days" : `${c.dayLabel}s`}):
                              </div>
                              <select
                                value={selectedDate}
                                onChange={(e) =>
                                  setSelectedRunDateByCorridor((prev) => ({
                                    ...prev,
                                    [c.id]: e.target.value,
                                  }))
                                }
                                className="w-full h-8 rounded-lg border border-border bg-secondary px-2.5 text-xs font-semibold text-foreground focus:outline-none cursor-pointer"
                              >
                                <option value="__typical__">
                                  🧭 Typical {isDriverTotalMode ? "Overall" : c.dayLabel} Corridor
                                  Loop ({c.topTowns.length} Core Towns)
                                </option>
                                {c.recentRuns.map((r) => (
                                  <option key={r.dateISO} value={r.dateISO}>
                                    📅 {r.dateISO} — {r.stopsCount} stops
                                    {r.estimatedMiles ? ` • ~${r.estimatedMiles} mi` : ""} (
                                    {r.batteries} pcs): {r.townsLabel}
                                  </option>
                                ))}
                              </select>
                            </div>

                            {/* Top Visited Towns List (Sorted by Most Visited) */}
                            <div className="space-y-1">
                              <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                                Top Visited Towns for {c.driverName} (Sorted by Most Visited):
                              </div>
                              <div className="space-y-1 max-h-[240px] overflow-y-auto pr-1">
                                {[...c.topTowns]
                                  .sort(
                                    (a, b) =>
                                      b.visits - a.visits ||
                                      b.stops - a.stops ||
                                      b.batteries - a.batteries,
                                  )
                                  .map((t, idx) => (
                                  <div
                                    key={`${t.city}-${t.state}`}
                                    className="rounded-lg border border-border bg-secondary/40 px-2.5 py-1.5 flex items-start justify-between gap-2"
                                  >
                                    <div className="min-w-0">
                                      <div className="font-semibold text-foreground">
                                        <span className="font-mono font-bold text-primary mr-1">
                                          #{idx + 1}
                                        </span>
                                        {t.city}, {t.state}
                                      </div>
                                      <div className="text-[11px] text-muted-foreground truncate">
                                        {t.topAccounts.slice(0, 2).join(" • ")}
                                      </div>
                                    </div>
                                    <div className="shrink-0 text-right font-mono text-[11px]">
                                      <div className={textGreen}>{t.visits}x visited</div>
                                      <div className="text-muted-foreground">
                                        {t.batteries} pcs
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* RIGHT (8 cols): INTERACTIVE HISTORICAL CORRIDOR MAP */}
            <div className="lg:col-span-8 flex flex-col min-h-0 relative bg-background">
              <div className="shrink-0 px-4 py-2.5 border-b border-border bg-card flex flex-wrap items-center justify-between gap-2 z-10 text-xs">
                <div className="font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-primary" />
                  {focusedCorridorId
                    ? (() => {
                        const fc = corridors.find((c) => c.id === focusedCorridorId);
                        return fc
                          ? `${fc.dayLabel}s — ${fc.driverName} (${fc.compassDirection})`
                          : "Focused Historical Corridor";
                      })()
                    : selectedWeekday === "all"
                      ? `Top Historical Weekday Corridors (Showing ${syntheticMapRoutes.length} of ${corridors.length} Corridors)`
                      : `${
                          weekdayBreakdown.find((w) => w.dayOfWeek === selectedWeekday)?.dayLabel ||
                          "Weekday"
                        } Routes & Directions (${syntheticMapRoutes.length} Drivers)`}
                </div>
                <span className="text-muted-foreground">
                  Click any weekday tab above or driver card on the left to isolate their direction
                </span>
              </div>

              <div className="flex-1 min-h-0 relative">
                <TrackingMap
                  key={`history-corridor-map-${selectedWeekday}-${focusedCorridorId || "all"}`}
                  data={[]}
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
          </div>
        </>
      ) : (
        /* =================================================================== */
        /* VIEW B: CUSTOMER ACCOUNTS & SALES CRM FREQUENCY LIST                */
        /* =================================================================== */
        <>
          {/* Filter, Search & Sort Row */}
          <div className="shrink-0 border-b border-border bg-secondary/35 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2.5 text-xs">
            <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[260px]">
              <div className="relative flex-1 max-w-md">
                <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                <Input
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Search customer, account # (9072...), city, driver, or battery part..."
                  className="h-8 pl-8 text-xs bg-card rounded-lg"
                />
              </div>

              {/* Time Window Pills */}
              <div className="inline-flex rounded-lg border border-border bg-secondary p-0.5">
                {(
                  [
                    { id: "30", label: "30 Days" },
                    { id: "90", label: "90 Days" },
                    { id: "365", label: "12 Months" },
                    { id: "all", label: "All Indexed" },
                  ] as const
                ).map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => setDaysWindow(w.id)}
                    className={`px-2.5 py-1 rounded-md font-semibold transition-all ${
                      daysWindow === w.id
                        ? "bg-foreground text-background shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {w.label}
                  </button>
                ))}
              </div>

              {/* Hub Filter */}
              <div className="inline-flex rounded-lg border border-border bg-secondary p-0.5">
                {(
                  [
                    { id: "all", label: "All Hubs" },
                    { id: "sioux_falls", label: "Sioux Falls" },
                    { id: "arlington", label: "Arlington" },
                  ] as const
                ).map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => setHubFilter(h.id)}
                    className={`px-2.5 py-1 rounded-md font-semibold transition-all ${
                      hubFilter === h.id
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {h.label}
                  </button>
                ))}
              </div>

              {/* Delivery Type Filter */}
              <select
                value={deliveryTypeFilter}
                onChange={(e) => setDeliveryTypeFilter(e.target.value as any)}
                className="h-8 rounded-lg border border-border bg-card px-2.5 text-xs font-semibold text-foreground focus:outline-none cursor-pointer"
              >
                <option value="all">All Delivery Types</option>
                <option value="hotshot">⚡ Hot Shot Vans Only</option>
                <option value="route_truck">🚛 Route Trucks Only</option>
                <option value="ups_shipping">📦 UPS / Shipping Only</option>
              </select>
            </div>

            {/* Sort Selector */}
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground font-medium">Sort by:</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="h-8 rounded-lg border border-border bg-card px-2.5 text-xs font-semibold text-foreground focus:outline-none cursor-pointer"
              >
                <option value="visits">Most Visits First</option>
                <option value="recent">Most Recent Delivery</option>
                <option value="batteries">Most Batteries Delivered</option>
                <option value="frequency">Shortest Interval (Days Between Visits)</option>
              </select>
            </div>
          </div>

          {/* 2-Pane Customer Frequency & Timeline Workspace */}
          <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
            {/* LEFT PANE (7 cols): SORTED CUSTOMER ACCOUNTS & VISIT FREQUENCY */}
            <div className="lg:col-span-7 border-r border-border flex flex-col min-h-0 bg-background">
              <div className="shrink-0 px-4 py-2.5 border-b border-border bg-card flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-primary" />
                  Customer Accounts (
                  {totals?.matchingCustomers?.toLocaleString() || customers.length})
                </div>
                {totals && (
                  <div className="text-muted-foreground flex items-center gap-2">
                    <span>
                      <strong className="text-foreground">
                        {totals.matchingDeliveries.toLocaleString()}
                      </strong>{" "}
                      deliveries
                    </span>
                    <span>•</span>
                    <span>
                      <strong className="text-foreground">
                        {totals.matchingBatteries.toLocaleString()}
                      </strong>{" "}
                      batteries
                    </span>
                    <span>•</span>
                    <span>
                      <strong className="text-foreground">
                        ~{totals.matchingWeightLbs.toLocaleString()} lbs
                      </strong>
                    </span>
                  </div>
                )}
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
                {loadingCustomers && customers.length === 0 ? (
                  <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
                    Loading indexed customer delivery history...
                  </div>
                ) : customers.length === 0 ? (
                  <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground space-y-2">
                    <div>No customer deliveries match this filter yet.</div>
                    <div className="text-xs">
                      Click <strong>+ Last 12 Months</strong> above to expand the indexed archive.
                    </div>
                  </div>
                ) : (
                  customers.map((c) => {
                    const isSelected = c.customerKey === selectedCustomerKey;
                    return (
                      <div
                        key={c.customerKey}
                        onClick={() => setSelectedCustomerKey(c.customerKey)}
                        className={`cursor-pointer rounded-xl border p-3 transition-all ${
                          isSelected
                            ? "border-primary bg-card shadow-sm ring-1 ring-primary/30"
                            : "border-border bg-secondary/35 hover:bg-card"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-sm text-foreground">
                                {c.accountName}
                              </span>
                              <span className="text-xs font-medium px-2 py-0.5 rounded-md bg-secondary border border-border text-foreground">
                                {c.city}, {c.state}
                              </span>
                              {c.dealerNumber && (
                                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-primary/10 border border-primary/30 text-primary font-semibold">
                                  Acct #{c.dealerNumber}
                                </span>
                              )}
                            </div>

                            <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                              <span>
                                Last visit:{" "}
                                <strong className="text-foreground">{c.lastVisitDateISO}</strong> (
                                {c.daysSinceLastVisit === 0
                                  ? "Today"
                                  : `${c.daysSinceLastVisit}d ago`}{" "}
                                • {c.lastDriverName})
                              </span>
                              {c.topParts.length > 0 && (
                                <>
                                  <span>•</span>
                                  <span className="font-mono text-[11px]">
                                    Top:{" "}
                                    {c.topParts
                                      .slice(0, 3)
                                      .map((p) => `${p.partNumber} (${p.totalQty})`)
                                      .join(", ")}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>

                          <div className="shrink-0 text-right space-y-1">
                            <div className="flex items-center justify-end gap-1.5">
                              <span
                                className={`text-xs font-mono px-2.5 py-0.5 rounded-md border ${badgeAmber}`}
                              >
                                {c.uniqueVisitDays} Visit{c.uniqueVisitDays === 1 ? "" : "s"}
                                {c.allTimeVisitDays && c.allTimeVisitDays > c.uniqueVisitDays
                                  ? ` (${c.allTimeVisitDays} all-time)`
                                  : ""}
                              </span>
                              <span
                                className={`text-xs font-mono px-2 py-0.5 rounded-md border ${
                                  c.avgDaysBetweenVisits !== null && c.avgDaysBetweenVisits < 60
                                    ? badgeGreen
                                    : "bg-secondary border-border text-muted-foreground"
                                }`}
                              >
                                {formatCadenceBadge(
                                  c.avgDaysBetweenVisits,
                                  c.allTimeVisitDays || c.uniqueVisitDays,
                                )}
                              </span>
                            </div>
                            <div className="text-[11px] font-mono text-muted-foreground">
                              <strong className="text-foreground">
                                {c.totalPieces.toLocaleString()}
                              </strong>{" "}
                              pcs • ~{c.totalWeightLbs.toLocaleString()} lbs
                              {c.maxGapDays && c.maxGapDays >= 45
                                ? ` • Max gap: ${c.maxGapDays}d`
                                : ""}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* RIGHT PANE (5 cols): SELECTED CUSTOMER CRM PROFILE & FULL DELIVERY LOG */}
            <div className="lg:col-span-5 flex flex-col min-h-0 bg-background">
              {!selectedCustomerDetail ? (
                <div className="flex-1 flex items-center justify-center p-6 text-center text-sm text-muted-foreground">
                  {loadingDetail
                    ? "Loading customer timeline..."
                    : "Select a customer account on the left to inspect their visit frequency and full delivery log."}
                </div>
              ) : (
                (() => {
                  const { customer: cust, deliveries } = selectedCustomerDetail;
                  return (
                    <>
                      <div className="shrink-0 p-4 border-b border-border bg-card space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-display font-extrabold text-base text-foreground">
                              {cust.accountName}
                            </div>
                            <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap mt-0.5">
                              <span className="inline-flex items-center gap-1">
                                <MapPin className="w-3.5 h-3.5 text-primary" />
                                {cust.address ? `${cust.address}, ` : ""}
                                {cust.city}, {cust.state} {cust.zip}
                              </span>
                              {cust.phone && (
                                <span className="inline-flex items-center gap-1">
                                  <Phone className="w-3.5 h-3.5 text-primary" />
                                  {cust.phone}
                                </span>
                              )}
                            </div>
                          </div>

                          {cust.dealerNumber && (
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard.writeText(cust.dealerNumber);
                                toast({
                                  title: `Copied Account #${cust.dealerNumber}`,
                                });
                              }}
                              title="Click to copy IBS Account Number for CRM"
                              className="shrink-0 px-2.5 py-1 rounded-lg border border-primary/40 bg-primary/10 text-xs font-mono font-bold text-primary flex items-center gap-1.5 hover:bg-primary/20"
                            >
                              <span>#{cust.dealerNumber}</span>
                              <Copy className="w-3 h-3" />
                            </button>
                          )}
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                          <div className="rounded-lg border border-border bg-secondary/50 p-2">
                            <div className="text-[10px] font-bold uppercase text-muted-foreground">
                              30d / 90d / 1Yr
                            </div>
                            <div className="font-mono font-bold text-sm text-foreground mt-0.5">
                              {cust.visitsLast30d} / {cust.visitsLast90d} / {cust.visitsLast365d}
                            </div>
                          </div>
                          <div className="rounded-lg border border-border bg-secondary/50 p-2">
                            <div className="text-[10px] font-bold uppercase text-muted-foreground">
                              True Visit Cadence
                            </div>
                            <div className={`font-mono text-xs sm:text-sm mt-0.5 ${textGreen}`}>
                              {formatCadenceBadge(
                                cust.avgDaysBetweenVisits,
                                cust.allTimeVisitDays || cust.uniqueVisitDays,
                              )}
                            </div>
                            {cust.maxGapDays ? (
                              <div className="text-[10px] font-mono text-muted-foreground">
                                Longest gap: {cust.maxGapDays}d
                              </div>
                            ) : null}
                          </div>
                          <div className="rounded-lg border border-border bg-secondary/50 p-2">
                            <div className="text-[10px] font-bold uppercase text-muted-foreground">
                              Total Batteries
                            </div>
                            <div className={`font-mono text-sm mt-0.5 ${textAmber}`}>
                              {cust.totalPieces.toLocaleString()} pcs
                            </div>
                          </div>
                          <div className="rounded-lg border border-border bg-secondary/50 p-2">
                            <div className="text-[10px] font-bold uppercase text-muted-foreground">
                              Total Weight
                            </div>
                            <div className="font-mono font-bold text-sm text-foreground mt-0.5">
                              ~{cust.totalWeightLbs.toLocaleString()} lbs
                            </div>
                          </div>
                        </div>

                        <div className="space-y-1.5 text-xs">
                          {cust.topDrivers.length > 0 && (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-muted-foreground font-semibold flex items-center gap-1">
                                <Truck className="w-3.5 h-3.5 text-primary" />
                                Drivers:
                              </span>
                              {cust.topDrivers.map((d) => (
                                <span
                                  key={d.driverName}
                                  className="px-2 py-0.5 rounded bg-secondary border border-border font-mono text-[11px]"
                                >
                                  {d.driverName} ({d.visits})
                                </span>
                              ))}
                            </div>
                          )}
                          {cust.topParts.length > 0 && (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-muted-foreground font-semibold flex items-center gap-1">
                                <BatteryCharging className="w-3.5 h-3.5 text-primary" />
                                Top Parts:
                              </span>
                              {cust.topParts.slice(0, 6).map((p) => (
                                <span
                                  key={p.partNumber}
                                  className="px-2 py-0.5 rounded bg-secondary border border-border font-mono text-[11px]"
                                >
                                  {p.partNumber} ({p.totalQty})
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="shrink-0 px-4 py-2 border-b border-border bg-secondary/35 flex items-center justify-between text-xs">
                        <span className="font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-primary" />
                          Delivery Log ({deliveries.length} stops recorded)
                        </span>
                        <span className="text-muted-foreground font-mono text-[11px]">
                          {cust.firstVisitDateISO} → {cust.lastVisitDateISO}
                        </span>
                      </div>

                      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
                        {deliveries.map((del, idx) => {
                          const prevDel = deliveries[idx + 1];
                          const gapFromPrevDays = prevDel
                            ? Math.max(
                                0,
                                Math.round(
                                  (new Date(`${del.dateISO}T12:00:00Z`).getTime() -
                                    new Date(`${prevDel.dateISO}T12:00:00Z`).getTime()) /
                                    (24 * 3600_000),
                                ),
                              )
                            : null;

                          return (
                            <div
                              key={del.key}
                              className="rounded-xl border border-border bg-card p-3 space-y-1.5 text-xs"
                            >
                              <div className="flex items-center justify-between gap-2 flex-wrap">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-mono font-bold text-sm text-foreground">
                                    {del.dateISO}
                                  </span>
                                  <span
                                    className={`text-[11px] font-mono px-2 py-0.5 rounded border ${
                                      del.deliveryType === "hotshot"
                                        ? badgeAmber
                                        : del.deliveryType === "route_truck"
                                          ? badgeSky
                                          : "bg-secondary border-border text-foreground"
                                    }`}
                                  >
                                    {del.driverName}
                                  </span>
                                  {gapFromPrevDays !== null && (
                                    <span
                                      className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                                        gapFromPrevDays >= 45
                                          ? badgeAmber
                                          : "bg-secondary/60 border-border text-muted-foreground"
                                      }`}
                                    >
                                      {gapFromPrevDays === 0
                                        ? "Same day (2nd PO)"
                                        : gapFromPrevDays >= 60
                                          ? `+${gapFromPrevDays}d (~${
                                              Math.round((gapFromPrevDays / 30.4) * 10) / 10
                                            } mos) after prev`
                                          : `+${gapFromPrevDays}d after prev`}
                                    </span>
                                  )}
                                  {del.poNumber && (
                                    <span className="text-[11px] font-mono text-muted-foreground">
                                      PO: {del.poNumber}
                                    </span>
                                  )}
                                </div>
                                <div className="font-mono text-xs">
                                  <strong className="text-foreground">{del.piecesCount} pcs</strong>
                                  <span className="text-muted-foreground">
                                    {" "}
                                    • ~{del.estimatedWeightLbs} lbs
                                  </span>
                                </div>
                              </div>

                              {del.partsSummary && (
                                <div className="font-mono text-[11px] text-foreground/90">
                                  🔋 {del.partsSummary}
                                </div>
                              )}
                              {del.notes && (
                                <div className={`font-mono text-[11px] ${textAmber}`}>
                                  ⚠️ {del.notes}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </>
                  );
                })()
              )}
            </div>
          </div>
        </>
      )}
      <DoodleworksLegalFooter />
    </div>
  );
}
