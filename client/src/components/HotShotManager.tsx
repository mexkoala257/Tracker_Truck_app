import { useState, useMemo, useRef, useEffect } from "react";
import {
  Zap,
  Upload,
  FileText,
  Truck,
  User,
  Calendar,
  Clock,
  CheckCircle2,
  Circle,
  Plus,
  Trash2,
  Pencil,
  ArrowUp,
  ArrowDown,
  ExternalLink,
  Tv,
  AlertTriangle,
  MapPin,
  Warehouse,
  Satellite,
  RefreshCw,
  BellRing,
  PackageOpen,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  type HotShotRoute,
  type HotShotStop,
  type HotShotOpenOrder,
  type HotShotOriginHub,
  type HotShotVehicleCandidate,
  HOTSHOT_COLOR_PALETTE,
  normalizeHotShotRoutes,
  normalizeHotShotOriginHub,
  inferHotShotOriginHub,
  getHotShotHubMeta,
  resolveHotShotWarehouse,
  getCentralDateISO,
  formatHotShotDateHuman,
  formatCentralClockTime,
  doesHotShotDriverMatchMember,
  estimateHotShotTiming,
  buildHotShotTownSequenceLabel,
} from "@shared/hotshots";

interface VehicleMetaItem {
  vehicleId: string;
  name: string | null;
  color: string | null;
}

interface DraftStop extends HotShotStop {
  included: boolean;
}

export interface HotShotManagerProps {
  displayState: any;
  vehiclesMeta: VehicleMetaItem[];
  liveVehicles?: Array<{
    id: string;
    name?: string;
    color?: string;
    location: { lat: number; lon: number };
    speed: number;
    status: string;
    timestamp: string;
  }>;
  sfWarehouse?: { name: string; latitude: number; longitude: number };
  mainWarehouse?: { name: string; latitude: number; longitude: number };
  onStateUpdated: (nextState: any) => void;
  onPinHotShotsScreen?: () => void;
}

const REGULAR_ROUTE_TRUCK_NAMES = new Set(["T01", "T02", "T22", "T03", "T04", "T05"]);

export default function HotShotManager({
  displayState,
  vehiclesMeta,
  liveVehicles = [],
  sfWarehouse = { name: "Sioux Falls Warehouse", latitude: 43.5446, longitude: -96.7311 },
  mainWarehouse = { name: "Arlington Warehouse", latitude: 44.3792, longitude: -97.1406 },
  onStateUpdated,
  onPinHotShotsScreen,
}: HotShotManagerProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [parsingPdf, setParsingPdf] = useState(false);
  const [syncingApi, setSyncingApi] = useState(false);
  const [testingAlert, setTestingAlert] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  // Draft Editor State (used for both PDF upload confirmation & editing an existing Hot Shot)
  const [draftOpen, setDraftOpen] = useState(false);
  const [editingRouteId, setEditingRouteId] = useState<string | null>(null);
  const [draftDateISO, setDraftDateISO] = useState<string>(() => getCentralDateISO(new Date()));
  const [draftOriginHub, setDraftOriginHub] = useState<HotShotOriginHub>("sioux_falls");
  const [draftDriverName, setDraftDriverName] = useState<string>("");
  const [draftRawPdfDriver, setDraftRawPdfDriver] = useState<string>("");
  const [draftVehicleId, setDraftVehicleId] = useState<string>("__none__");
  const [draftDepartureHHMM, setDraftDepartureHHMM] = useState<string>("08:00");
  const [draftColor, setDraftColor] = useState<string>(HOTSHOT_COLOR_PALETTE[0]);
  const [draftTitle, setDraftTitle] = useState<string>("");
  const [draftSourceFile, setDraftSourceFile] = useState<string>("");
  const [draftStops, setDraftStops] = useState<DraftStop[]>([]);
  const [draftVehicleEstimate, setDraftVehicleEstimate] = useState<{
    topMatch: HotShotVehicleCandidate | null;
    candidates: HotShotVehicleCandidate[];
    loading: boolean;
  }>({ topMatch: null, candidates: [], loading: false });

  // Quick Add Stop inside Draft
  const [newStopCity, setNewStopCity] = useState("");
  const [newStopState, setNewStopState] = useState("SD");
  const [newStopAccount, setNewStopAccount] = useState("");
  const [newStopAddress, setNewStopAddress] = useState("");
  const [newStopPieces, setNewStopPieces] = useState("");

  // Delete confirmation modal
  const [pendingDeleteRoute, setPendingDeleteRoute] = useState<HotShotRoute | null>(null);

  const allRoutes = useMemo(
    () => normalizeHotShotRoutes(displayState?.hotShotRoutes),
    [displayState?.hotShotRoutes],
  );

  const openOrders: HotShotOpenOrder[] = useMemo(
    () =>
      Array.isArray(displayState?.hotShotOpenOrders)
        ? displayState.hotShotOpenOrders
        : [],
    [displayState?.hotShotOpenOrders],
  );

  const syncStatus = displayState?.hotShotSyncStatus || null;

  const handleSyncHotShotApiNow = async () => {
    setSyncingApi(true);
    try {
      const res = await fetch("/api/display/hotshots/sync-now", {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "HotShotSheet API sync failed");
      }
      if (data.state) onStateUpdated(data.state);
      const st = data.syncStatus;
      toast({
        title: "Synced with HotShotSheet API",
        description: `Today: ${st?.todaySheetCount ?? 0} sheets • Upcoming: ${
          st?.upcomingSheetCount ?? 0
        } sheets • Open Orders: ${st?.openOrderCount ?? 0}`,
      });
    } catch (err: any) {
      toast({
        title: "HotShotSheet Sync Error",
        description: err?.message || "Could not reach HotShotSheet API",
        variant: "destructive",
      });
    } finally {
      setSyncingApi(false);
    }
  };

  const handleSendTestTvAlert = async () => {
    setTestingAlert(true);
    try {
      const res = await fetch("/api/display/hotshots/test-alert", {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Could not send test alert");
      }
      toast({
        title: "TV Alert Popup Broadcasted",
        description: `Displayed "${data.alert?.accountName}" (${data.alert?.city}, ${data.alert?.state}) on connected TV screens.`,
      });
    } catch (err: any) {
      toast({
        title: "Test Alert Failed",
        description: err?.message || "Failed sending test alert",
        variant: "destructive",
      });
    } finally {
      setTestingAlert(false);
    }
  };

  const sfRosterNames = useMemo(() => {
    const names = new Set<string>();
    for (const m of displayState?.sfSchedule?.memberRoster || []) {
      if (m?.name) names.add(String(m.name).trim());
    }
    for (const r of displayState?.sfSchedule?.rows || []) {
      if (r?.name) names.add(String(r.name).trim());
    }
    return Array.from(names);
  }, [displayState?.sfSchedule]);

  // Sort vans & secondary fleet units to the top of the vehicle dropdown, then route trucks
  const sortedFleetOptions = useMemo(() => {
    const list = [...(vehiclesMeta || [])].map((v) => ({
      vehicleId: v.vehicleId,
      label: (v.name || v.vehicleId).trim(),
      isRegularRouteTruck: REGULAR_ROUTE_TRUCK_NAMES.has((v.name || "").trim().toUpperCase()),
      isSfPreferred: /sf|van|camry|betty|milliamp|bruno|max/i.test(v.name || ""),
    }));
    list.sort((a, b) => {
      if (a.isRegularRouteTruck !== b.isRegularRouteTruck) {
        return a.isRegularRouteTruck ? 1 : -1;
      }
      if (a.isSfPreferred !== b.isSfPreferred) {
        return a.isSfPreferred ? -1 : 1;
      }
      return a.label.localeCompare(b.label);
    });
    return list;
  }, [vehiclesMeta]);

  const todayISO = getCentralDateISO(new Date());
  const tomorrowISO = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return getCentralDateISO(d);
  }, []);

  const { todayRoutes, upcomingRoutes, pastRoutes } = useMemo(() => {
    const today: HotShotRoute[] = [];
    const upcoming: HotShotRoute[] = [];
    const past: HotShotRoute[] = [];
    for (const r of allRoutes) {
      if (r.deliveryDateISO === todayISO) today.push(r);
      else if (r.deliveryDateISO > todayISO) upcoming.push(r);
      else past.push(r);
    }
    upcoming.sort((a, b) => a.deliveryDateISO.localeCompare(b.deliveryDateISO));
    past.sort((a, b) => b.deliveryDateISO.localeCompare(a.deliveryDateISO));
    return { todayRoutes: today, upcomingRoutes: upcoming, pastRoutes: past };
  }, [allRoutes, todayISO]);

  const matchedSfScheduleMember = useMemo(() => {
    if (!draftDriverName.trim() || draftOriginHub === "arlington") return null;
    return (
      sfRosterNames.find((member) =>
        doesHotShotDriverMatchMember(draftDriverName, member, draftOriginHub),
      ) || null
    );
  }, [draftDriverName, sfRosterNames, draftOriginHub]);

  const includedDraftStops = useMemo(
    () =>
      draftStops
        .filter((s) => s.included)
        .map((s, idx) => ({ ...s, order: idx + 1 })),
    [draftStops],
  );

  const draftHubWarehouse = useMemo(
    () => resolveHotShotWarehouse(draftOriginHub, { sfWarehouse, mainWarehouse }),
    [draftOriginHub, sfWarehouse, mainWarehouse],
  );
  const draftHubMeta = useMemo(() => getHotShotHubMeta(draftOriginHub), [draftOriginHub]);

  // Live GPS History Van Estimator inside Draft Modal (re-evaluates when hub, date, or stops change)
  const draftStopsSignature = useMemo(
    () =>
      includedDraftStops
        .map((s) => `${s.city}|${s.state}|${s.lat}|${s.lon}`)
        .join(";"),
    [includedDraftStops],
  );

  useEffect(() => {
    if (!draftOpen) return;
    if (draftDateISO !== todayISO || includedDraftStops.length === 0) {
      setDraftVehicleEstimate({ topMatch: null, candidates: [], loading: false });
      return;
    }

    let cancelled = false;
    setDraftVehicleEstimate((prev) => ({ ...prev, loading: true }));
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch("/api/display/hotshots/estimate-vehicle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            originHub: draftOriginHub,
            deliveryDateISO: draftDateISO,
            excludeRouteId: editingRouteId || undefined,
            stops: includedDraftStops.map((s) => ({
              city: s.city,
              state: s.state,
              accountName: s.accountName,
              lat: s.lat,
              lon: s.lon,
            })),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok && data?.ok) {
          setDraftVehicleEstimate({
            topMatch: data.topMatch || null,
            candidates: Array.isArray(data.candidates) ? data.candidates : [],
            loading: false,
          });
        } else if (!cancelled) {
          setDraftVehicleEstimate((prev) => ({ ...prev, loading: false }));
        }
      } catch {
        if (!cancelled) {
          setDraftVehicleEstimate((prev) => ({ ...prev, loading: false }));
        }
      }
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [draftOpen, draftDateISO, todayISO, draftOriginHub, draftStopsSignature, editingRouteId]);

  const draftPreviewTiming = useMemo(() => {
    const previewRoute: HotShotRoute = {
      id: "draft-preview",
      deliveryDateISO: draftDateISO,
      originHub: draftOriginHub,
      driverName: draftDriverName || "Driver",
      vehicleId: draftVehicleId === "__none__" ? "" : draftVehicleId,
      color: draftColor,
      departureTimeHHMM: draftDepartureHHMM || "08:00",
      active: true,
      stops: includedDraftStops,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return estimateHotShotTiming(previewRoute, draftHubWarehouse, null, new Date());
  }, [
    draftDateISO,
    draftOriginHub,
    draftDriverName,
    draftVehicleId,
    draftColor,
    draftDepartureHHMM,
    includedDraftStops,
    draftHubWarehouse,
  ]);

  const handleUploadPdfFile = async (file: File) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
      toast({
        title: "PDF Required",
        description: "Please select a .pdf route sheet exported from hotshotsheet.com.",
        variant: "destructive",
      });
      return;
    }

    setParsingPdf(true);
    try {
      const res = await fetch(
        `/api/display/hotshots/parse-pdf?filename=${encodeURIComponent(file.name)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/pdf" },
          body: file,
        },
      );
      const data = await res.json();
      if (!res.ok || !data?.ok || !data?.parsed) {
        throw new Error(data?.error || "Could not parse PDF");
      }

      const parsed = data.parsed;
      const inferredHub = normalizeHotShotOriginHub(
        parsed.suggestedOriginHub,
        parsed.rawPdfDriver,
      );
      setEditingRouteId(null);
      setDraftDateISO(parsed.deliveryDateISO || todayISO);
      setDraftOriginHub(inferredHub);
      setDraftDriverName(parsed.suggestedDriver || parsed.rawPdfDriver || "");
      setDraftRawPdfDriver(parsed.rawPdfDriver || "");
      setDraftVehicleId("__none__");
      setDraftDepartureHHMM("08:00");
      setDraftColor(HOTSHOT_COLOR_PALETTE[allRoutes.length % HOTSHOT_COLOR_PALETTE.length]);
      setDraftTitle(parsed.suggestedTitle || "");
      setDraftSourceFile(file.name);
      setDraftStops(
        (parsed.stops || []).map((s: HotShotStop) => ({
          ...s,
          included: true,
        })),
      );
      if (data.vehicleEstimate) {
        setDraftVehicleEstimate({
          topMatch: data.vehicleEstimate.topMatch || null,
          candidates: Array.isArray(data.vehicleEstimate.candidates)
            ? data.vehicleEstimate.candidates
            : [],
          loading: false,
        });
      }
      setDraftOpen(true);

      const estVan = data.vehicleEstimate?.topMatch;
      toast({
        title: `Extracted ${parsed.stops?.length || 0} Stops from PDF`,
        description: `Date: ${formatHotShotDateHuman(parsed.deliveryDateISO)} • Origin: ${
          getHotShotHubMeta(inferredHub).shortLabel
        }${estVan ? ` • 🛰️ GPS Match: ${estVan.vehicleName}` : ""} • Driver: ${
          parsed.suggestedDriver || parsed.rawPdfDriver || "Select Driver"
        }`,
      });
    } catch (err: any) {
      toast({
        title: "PDF Upload Failed",
        description: err?.message || "Failed reading Hot Shot PDF",
        variant: "destructive",
      });
    } finally {
      setParsingPdf(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleOpenManualDraft = () => {
    setEditingRouteId(null);
    setDraftDateISO(todayISO);
    setDraftOriginHub("sioux_falls");
    setDraftDriverName("");
    setDraftRawPdfDriver("");
    setDraftVehicleId("__none__");
    setDraftDepartureHHMM("08:00");
    setDraftColor(HOTSHOT_COLOR_PALETTE[allRoutes.length % HOTSHOT_COLOR_PALETTE.length]);
    setDraftTitle("");
    setDraftSourceFile("");
    setDraftStops([]);
    setDraftOpen(true);
  };

  const handleOpenEditRoute = (route: HotShotRoute) => {
    setEditingRouteId(route.id);
    setDraftDateISO(route.deliveryDateISO);
    setDraftOriginHub(
      normalizeHotShotOriginHub(route.originHub, route.rawPdfDriver || route.driverName),
    );
    setDraftDriverName(route.driverName);
    setDraftRawPdfDriver(route.rawPdfDriver || "");
    setDraftVehicleId(
      route.vehicleAssignedBy === "auto_gps" ? "__none__" : route.vehicleId || "__none__",
    );
    setDraftDepartureHHMM(route.departureTimeHHMM || "08:00");
    setDraftColor(route.color || HOTSHOT_COLOR_PALETTE[0]);
    setDraftTitle(route.title || "");
    setDraftSourceFile(route.sourceFileName || "");
    setDraftStops(route.stops.map((s) => ({ ...s, included: true })));
    setDraftOpen(true);
  };

  const handleAddManualStopToDraft = () => {
    const city = newStopCity.trim();
    const account = newStopAccount.trim();
    if (!city && !account) return;
    const pcs = parseInt(newStopPieces, 10);
    const added: DraftStop = {
      id: `hs-manual-${Date.now().toString(36)}`,
      order: draftStops.length + 1,
      accountName: account || `${city} Delivery`,
      address: newStopAddress.trim(),
      city: city || account,
      state: (newStopState.trim() || "SD").toUpperCase(),
      ...(Number.isFinite(pcs) && pcs > 0 ? { piecesCount: pcs } : {}),
      lat: 0,
      lon: 0,
      geocodePrecision: "town",
      completedAt: null,
      completedBy: null,
      included: true,
    };
    setDraftStops((prev) => [...prev, added]);
    setNewStopCity("");
    setNewStopAccount("");
    setNewStopAddress("");
    setNewStopPieces("");
  };

  const handleMoveDraftStop = (index: number, dir: -1 | 1) => {
    setDraftStops((prev) => {
      const target = index + dir;
      if (target < 0 || target >= prev.length) return prev;
      const copy = [...prev];
      const [item] = copy.splice(index, 1);
      copy.splice(target, 0, item);
      return copy.map((s, idx) => ({ ...s, order: idx + 1 }));
    });
  };

  const handleSaveDraft = async () => {
    const driver = draftDriverName.trim();
    if (!driver) {
      toast({
        title: "Driver Name Required",
        description: "Pick an employee or type the Hot Shot driver's name.",
        variant: "destructive",
      });
      return;
    }
    if (includedDraftStops.length === 0) {
      toast({
        title: "At Least 1 Stop Required",
        description: "Keep at least one delivery stop checked or add a stop.",
        variant: "destructive",
      });
      return;
    }

    setSavingDraft(true);
    try {
      const selectedFleet = sortedFleetOptions.find((v) => v.vehicleId === draftVehicleId);
      const cleanStops = includedDraftStops.map(({ included: _inc, ...rest }, idx) => ({
        ...rest,
        order: idx + 1,
      }));
      const computedTitle =
        draftTitle.trim() || buildHotShotTownSequenceLabel(cleanStops, 5);

      const payload = {
        deliveryDateISO: draftDateISO,
        originHub: draftOriginHub,
        driverName: driver,
        rawPdfDriver: draftRawPdfDriver || undefined,
        vehicleId: draftVehicleId === "__none__" ? "" : draftVehicleId,
        vehicleName: selectedFleet ? selectedFleet.label : "",
        departureTimeHHMM: draftDepartureHHMM || "08:00",
        color: draftColor,
        title: computedTitle,
        sourceFileName: draftSourceFile || undefined,
        active: true,
        stops: cleanStops,
      };

      const url = editingRouteId
        ? `/api/display/hotshots/${encodeURIComponent(editingRouteId)}`
        : "/api/display/hotshots";
      const method = editingRouteId ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ route: payload }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Failed saving Hot Shot route");
      }

      if (data.state) onStateUpdated(data.state);
      setDraftOpen(false);
      const savedRoute: HotShotRoute | undefined = data.route;
      const resolvedVehLabel = savedRoute?.vehicleName
        ? `${savedRoute.vehicleName}${savedRoute.vehicleAssignedBy === "auto_gps" ? " [Auto-GPS]" : ""}`
        : selectedFleet
          ? selectedFleet.label
          : "Auto-GPS Standby";
      toast({
        title: editingRouteId ? "Hot Shot Updated" : "Hot Shot Dispatched to TVs",
        description: `[${draftHubMeta.code}] ${driver} (${resolvedVehLabel}) • ${formatHotShotDateHuman(
          draftDateISO,
        )} (${cleanStops.length} stops)`,
      });
    } catch (err: any) {
      toast({
        title: "Save Failed",
        description: err?.message || "Could not save Hot Shot route",
        variant: "destructive",
      });
    } finally {
      setSavingDraft(false);
    }
  };

  const handleToggleStopComplete = async (routeId: string, stopId: string) => {
    try {
      const res = await fetch(
        `/api/display/hotshots/${encodeURIComponent(routeId)}/stops/${encodeURIComponent(stopId)}/toggle`,
        { method: "POST" },
      );
      const data = await res.json();
      if (res.ok && data?.state) {
        onStateUpdated(data.state);
      }
    } catch (err: any) {
      toast({
        title: "Could Not Toggle Stop",
        description: err?.message || "Failed updating stop status",
        variant: "destructive",
      });
    }
  };

  const handleQuickAssignVan = async (route: HotShotRoute, nextVehicleId: string) => {
    try {
      const selectedFleet = sortedFleetOptions.find((v) => v.vehicleId === nextVehicleId);
      const res = await fetch(`/api/display/hotshots/${encodeURIComponent(route.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          route: {
            ...route,
            vehicleId: nextVehicleId === "__none__" ? "" : nextVehicleId,
            vehicleName: selectedFleet ? selectedFleet.label : "",
            vehicleAssignedBy: nextVehicleId === "__none__" ? null : "manual",
          },
        }),
      });
      const data = await res.json();
      if (res.ok && data?.state) {
        onStateUpdated(data.state);
        const saved: HotShotRoute | undefined = data.route;
        toast({
          title:
            nextVehicleId === "__none__"
              ? saved?.vehicleName
                ? `🛰️ Auto-Detected ${saved.vehicleName}`
                : "Auto-GPS Van Detection Enabled"
              : "Assigned Van Updated",
          description:
            nextVehicleId === "__none__"
              ? saved?.vehicleName
                ? `${saved.autoMatchReason || "Matched from today's GPS breadcrumb trail"}`
                : `Monitoring Motive GPS to auto-detect which van departs on ${route.driverName}'s route`
              : `${route.driverName} manually locked to ${selectedFleet?.label}`,
        });
      }
    } catch {}
  };

  const handleQuickChangeOriginHub = async (
    route: HotShotRoute,
    nextOriginHub: HotShotOriginHub,
  ) => {
    try {
      const res = await fetch(`/api/display/hotshots/${encodeURIComponent(route.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          route: {
            ...route,
            originHub: nextOriginHub,
          },
        }),
      });
      const data = await res.json();
      if (res.ok && data?.state) {
        onStateUpdated(data.state);
        const hubLabel = getHotShotHubMeta(nextOriginHub).shortLabel;
        toast({
          title: "Origination Spot Updated",
          description: `${route.driverName} now originates & returns to ${hubLabel} Warehouse`,
        });
      }
    } catch {}
  };

  const confirmDeleteRoute = async () => {
    if (!pendingDeleteRoute) return;
    try {
      const res = await fetch(
        `/api/display/hotshots/${encodeURIComponent(pendingDeleteRoute.id)}`,
        { method: "DELETE" },
      );
      const data = await res.json();
      if (res.ok && data?.state) {
        onStateUpdated(data.state);
        toast({
          title: "Hot Shot Removed",
          description: `Deleted ${pendingDeleteRoute.driverName} (${formatHotShotDateHuman(
            pendingDeleteRoute.deliveryDateISO,
          )})`,
        });
      }
    } catch (err: any) {
      toast({
        title: "Delete Failed",
        description: err?.message || "Could not delete Hot Shot route",
        variant: "destructive",
      });
    } finally {
      setPendingDeleteRoute(null);
    }
  };

  const renderRouteCard = (route: HotShotRoute, badgeKind: "today" | "upcoming" | "past") => {
    const matchedLiveVeh =
      liveVehicles.find(
        (v) =>
          (route.vehicleId && v.id === route.vehicleId) ||
          (route.vehicleName && v.name === route.vehicleName),
      ) || null;
    const routeOriginHub = normalizeHotShotOriginHub(route.originHub, route.rawPdfDriver);
    const routeHubMeta = getHotShotHubMeta(routeOriginHub);
    const routeWarehouse = resolveHotShotWarehouse(routeOriginHub, {
      sfWarehouse,
      mainWarehouse,
    });
    const timing = estimateHotShotTiming(route, routeWarehouse, matchedLiveVeh, new Date());
    const sfMemberMatch = sfRosterNames.find((m) =>
      doesHotShotDriverMatchMember(route.driverName, m, routeOriginHub),
    );

    return (
      <div
        key={route.id}
        className="rounded-sm border border-border bg-card overflow-hidden"
        style={{ borderLeftWidth: "4px", borderLeftColor: route.color || "#f59e0b" }}
      >
        <div className="p-4 border-b border-border bg-secondary/35 flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded-sm border ${
                  badgeKind === "today"
                    ? "bg-amber-500/20 text-amber-400 border-amber-500/45"
                    : badgeKind === "upcoming"
                      ? "bg-sky-500/20 text-sky-400 border-sky-500/45"
                      : "bg-secondary text-muted-foreground border-border"
                }`}
              >
                {badgeKind === "today"
                  ? "⚡ ACTIVE TODAY"
                  : badgeKind === "upcoming"
                    ? `SCHEDULED • ${formatHotShotDateHuman(route.deliveryDateISO)}`
                    : `ARCHIVE • ${formatHotShotDateHuman(route.deliveryDateISO)}`}
              </span>
              <span className="text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded-sm border border-primary/40 bg-primary/15 text-primary inline-flex items-center gap-1">
                <Warehouse className="w-3 h-3" />
                ORIGIN: {routeHubMeta.shortLabel}
              </span>
              <span className="font-display font-bold text-base uppercase tracking-wide text-foreground">
                {route.driverName}
              </span>
              {sfMemberMatch ? (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-sm bg-amber-500/15 text-amber-400 border border-amber-500/35">
                  ⚡ Bolt on SF Schedule ({sfMemberMatch})
                </span>
              ) : (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-sm bg-secondary text-muted-foreground border border-border">
                  {routeOriginHub === "arlington" ? "Arlington Dispatch" : "Off-Schedule Employee"}
                </span>
              )}
              {route.vehicleAssignedBy === "auto_gps" && route.vehicleName ? (
                <span
                  title={route.autoMatchReason || "Automatically matched from Motive GPS route history"}
                  className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-sm bg-emerald-500/15 text-emerald-300 border border-emerald-500/45 inline-flex items-center gap-1"
                >
                  <Satellite className="w-3 h-3 text-emerald-400" />
                  AUTO-GPS: {route.vehicleName}
                  {route.autoMatchConfidence ? ` (${route.autoMatchConfidence}%)` : ""}
                </span>
              ) : !route.vehicleId && badgeKind === "today" ? (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-sm bg-sky-500/15 text-sky-300 border border-sky-500/35 inline-flex items-center gap-1">
                  <Satellite className="w-3 h-3 text-sky-400" />
                  Auto-Detecting Van via GPS...
                </span>
              ) : null}
            </div>
            <div className="text-xs font-mono text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>{route.title || buildHotShotTownSequenceLabel(route.stops, 5)}</span>
              <span>•</span>
              <span>
                ~{timing.totalLoopRoadMiles} road mi ({timing.estimatedTotalDurationLabel})
              </span>
              <span>•</span>
              <span className="text-primary font-bold">
                Est. {routeHubMeta.shortLabel} Return: {timing.etaWindowLabel}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Quick Origination Hub Switcher */}
            <Select
              value={routeOriginHub}
              onValueChange={(val) =>
                handleQuickChangeOriginHub(route, val as HotShotOriginHub)
              }
            >
              <SelectTrigger
                className="h-8 w-[155px] text-xs font-mono"
                title="Origination & Return Warehouse"
              >
                <SelectValue placeholder="Origin Hub..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sioux_falls">Origin: Sioux Falls</SelectItem>
                <SelectItem value="arlington">Origin: Arlington</SelectItem>
              </SelectContent>
            </Select>

            {/* Quick Van Selector */}
            <Select
              value={
                route.vehicleAssignedBy === "auto_gps"
                  ? "__none__"
                  : route.vehicleId || "__none__"
              }
              onValueChange={(val) => handleQuickAssignVan(route, val)}
            >
              <SelectTrigger className="h-8 w-[205px] text-xs font-mono">
                <SelectValue placeholder="Auto-Detect via GPS" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">
                  {route.vehicleAssignedBy === "auto_gps" && route.vehicleName
                    ? `✨ Auto-GPS (${route.vehicleName})`
                    : "✨ Auto-Detect Van via GPS"}
                </SelectItem>
                {sortedFleetOptions.map((opt) => (
                  <SelectItem key={opt.vehicleId} value={opt.vehicleId}>
                    {opt.label}
                    {opt.isRegularRouteTruck ? " (Route Truck)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs gap-1"
              onClick={() => handleOpenEditRoute(route)}
            >
              <Pencil className="w-3.5 h-3.5" />
              Edit
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 px-2 text-muted-foreground hover:text-destructive"
              onClick={() => setPendingDeleteRoute(route)}
              title="Delete Hot Shot"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Stops Checklist (Click any stop to manually mark green ✓ or undo; Motive GPS also auto-completes within 2.0 mi!) */}
        <div className="p-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {route.stops.map((stop, idx) => {
            const done = Boolean(stop.completedAt);
            const doneTime = stop.completedAt
              ? formatCentralClockTime(new Date(stop.completedAt))
              : "";
            return (
              <button
                key={stop.id || idx}
                type="button"
                onClick={() => handleToggleStopComplete(route.id, stop.id)}
                title="Click to toggle completed (turns green on TVs). Also turns green automatically via Motive GPS!"
                className={`text-left rounded-sm border p-2.5 transition-all flex items-start justify-between gap-2 ${
                  done
                    ? "border-emerald-500/55 bg-emerald-500/15 hover:bg-emerald-500/20"
                    : "border-border bg-secondary/25 hover:bg-secondary/50"
                }`}
              >
                <div className="flex items-start gap-2 min-w-0">
                  {done ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <Circle className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-foreground flex items-center gap-1.5 flex-wrap">
                      <span className="font-mono text-primary">#{idx + 1}</span>
                      <span>
                        {stop.city}, {stop.state}
                      </span>
                      {stop.piecesCount && (
                        <span className="text-[10px] font-mono px-1.5 rounded bg-background border border-border text-muted-foreground">
                          {stop.piecesCount} pcs
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] font-semibold text-foreground/85 truncate">
                      {stop.accountName}
                    </div>
                    {stop.address && (
                      <div className="text-[10px] font-mono text-muted-foreground truncate">
                        {stop.address}
                      </div>
                    )}
                    {stop.notes && (
                      <div className="text-[10px] font-mono text-amber-400 mt-0.5">
                        {stop.notes}
                      </div>
                    )}
                  </div>
                </div>

                {done && (
                  <span className="shrink-0 text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-500/25 text-emerald-300 border border-emerald-500/40 uppercase">
                    {stop.completedBy === "gps" ? "GPS ✓" : "✓"} {doneTime}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Top Upload & Overview Banner */}
      <div className="rounded-sm border border-border bg-card p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="font-display font-bold text-lg uppercase tracking-wide flex items-center gap-2 text-foreground">
              <Zap className="w-5 h-5 text-amber-400 fill-amber-400/25" />
              Hot Shot Dispatches (`hotshotsheet.com` PDF → Live TV Board)
            </h2>
            <p className="text-xs text-muted-foreground max-w-3xl">
              Upload any route sheet PDF from <span className="font-mono text-foreground">hotshotsheet.com</span> to create a one-time Hot Shot run for the exact delivery day. Assign any employee (even off-schedule staff) and any fleet van — stops turn <span className="text-emerald-400 font-semibold">emerald green ✓</span> automatically via Motive GPS, and generous return ETAs update live.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <a href="/dispatch" target="_blank" rel="noreferrer">
              <Button
                variant="default"
                size="sm"
                className="gap-1.5 text-xs bg-amber-500 hover:bg-amber-400 text-black font-bold"
                data-testid="hotshot-open-dispatch-portal-btn"
              >
                <Zap className="w-3.5 h-3.5" />
                Open Dispatch Portal (/dispatch)
                <ExternalLink className="w-3 h-3 opacity-75" />
              </Button>
            </a>
            <Button
              variant="default"
              size="sm"
              disabled={syncingApi}
              onClick={handleSyncHotShotApiNow}
              className="gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
              data-testid="hotshot-sync-api-btn"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncingApi ? "animate-spin" : ""}`} />
              {syncingApi ? "Syncing API..." : "Sync HotShotSheet API"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={testingAlert}
              onClick={handleSendTestTvAlert}
              className="gap-1.5 text-xs border-amber-500/45 text-amber-300 hover:bg-amber-500/15"
              title="Trigger a 24-second preview of the New Delivery Alert popup on all connected TV displays"
              data-testid="hotshot-test-alert-btn"
            >
              <BellRing className="w-3.5 h-3.5 text-amber-400" />
              Test TV Alert Popup
            </Button>
            <a href="/display?panel=screen-5" target="_blank" rel="noreferrer">
              <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                <Tv className="w-3.5 h-3.5 text-amber-400" />
                Preview Hotshots TV Screen
                <ExternalLink className="w-3 h-3 opacity-65" />
              </Button>
            </a>
            {onPinHotShotsScreen && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs border-amber-500/45 text-amber-400 hover:bg-amber-500/15"
                onClick={onPinHotShotsScreen}
              >
                <Zap className="w-3.5 h-3.5" />
                Pin Hotshots on TVs Now
              </Button>
            )}
            <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={handleOpenManualDraft}>
              <Plus className="w-3.5 h-3.5" />
              Manual Hot Shot
            </Button>
          </div>
        </div>

        {/* Live HotShotSheet API Status Strip */}
        <div className="rounded-sm border border-emerald-500/35 bg-emerald-500/10 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-bold text-emerald-300 uppercase">
              Live HotShotSheet API Connected (Auto-Polls Every {syncStatus?.pollIntervalSec || 60}s)
            </span>
            {syncStatus?.lastSyncedAt && (
              <span className="text-muted-foreground">
                • Last Synced: {formatCentralClockTime(new Date(syncStatus.lastSyncedAt))}
              </span>
            )}
            {syncStatus?.lastError && (
              <span className="text-red-400 font-bold">
                • Warning: {syncStatus.lastError}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 text-[11px] text-foreground/90">
            <span>
              Today Sheets: <strong className="text-amber-300">{todayRoutes.length}</strong>
            </span>
            <span>•</span>
            <span>
              Upcoming Sheets: <strong className="text-sky-300">{upcomingRoutes.length}</strong>
            </span>
            <span>•</span>
            <span>
              Open Orders: <strong className="text-emerald-300">{openOrders.length}</strong>
            </span>
          </div>
        </div>

        {/* Drag & Drop PDF Zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragActive(false);
            const file = e.dataTransfer.files?.[0];
            if (file) handleUploadPdfFile(file);
          }}
          onClick={() => fileInputRef.current?.click()}
          className={`cursor-pointer rounded-sm border-2 border-dashed p-6 text-center transition-colors ${
            dragActive
              ? "border-amber-400 bg-amber-500/15"
              : "border-border hover:border-amber-500/60 bg-secondary/25 hover:bg-secondary/45"
          }`}
          data-testid="hotshot-pdf-dropzone"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleUploadPdfFile(file);
            }}
          />
          <Upload className="w-8 h-8 mx-auto mb-2 text-amber-400" />
          <div className="font-display font-bold uppercase tracking-wide text-sm text-foreground">
            {parsingPdf
              ? "Reading Hot Shot Sheet PDF & Geocoding Stops..."
              : "Drop HotShotSheet PDF Here — or Click to Upload"}
          </div>
          <div className="text-xs text-muted-foreground mt-1 font-mono">
            Auto-extracts Delivery Date, Driver Hint, Towns, Dealer Accounts, Street Addresses & Piece Counts
          </div>
        </div>
      </div>

      {/* Draft Confirmation / Edit Panel */}
      {draftOpen && (
        <div className="rounded-sm border-2 border-amber-500/65 bg-card p-5 space-y-5 shadow-xl">
          <div className="flex items-center justify-between gap-2 border-b border-border pb-3">
            <div>
              <h3 className="font-display font-bold text-base uppercase tracking-wide text-amber-400 flex items-center gap-2">
                <FileText className="w-4 h-4" />
                {editingRouteId
                  ? "Edit Hot Shot Dispatch"
                  : draftSourceFile
                    ? `Confirm Hot Shot PDF: ${draftSourceFile}`
                    : "Create Manual Hot Shot Dispatch"}
              </h3>
              <p className="text-xs text-muted-foreground">
                Verify the delivery date, mark the origination warehouse (Sioux Falls vs Arlington), assign any employee & fleet van, and uncheck any held orders before dispatching.
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDraftOpen(false)}
              className="h-8 w-8 p-0"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>

          {/* Origination / Return Warehouse Selector */}
          <div className="rounded-sm border border-border bg-secondary/35 p-3 flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-0.5">
              <Label className="text-xs font-mono uppercase flex items-center gap-1.5 text-foreground">
                <Warehouse className="w-3.5 h-3.5 text-amber-400" />
                Origination & Return Spot
              </Label>
              <p className="text-[11px] text-muted-foreground">
                Sets where this Hot Shot departs from and returns to on the Live Map, loop mileage & Return ETA panel.
              </p>
            </div>
            <div className="inline-flex rounded-sm border border-border bg-background p-1 gap-1">
              <button
                type="button"
                onClick={() => setDraftOriginHub("sioux_falls")}
                data-testid="hotshot-origin-sioux-falls"
                className={`px-3 py-1.5 rounded-sm text-xs font-mono font-bold uppercase transition-colors flex items-center gap-1.5 ${
                  draftOriginHub === "sioux_falls"
                    ? "bg-amber-500 text-black shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <MapPin className="w-3.5 h-3.5" />
                Sioux Falls Warehouse
              </button>
              <button
                type="button"
                onClick={() => setDraftOriginHub("arlington")}
                data-testid="hotshot-origin-arlington"
                className={`px-3 py-1.5 rounded-sm text-xs font-mono font-bold uppercase transition-colors flex items-center gap-1.5 ${
                  draftOriginHub === "arlington"
                    ? "bg-amber-500 text-black shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <MapPin className="w-3.5 h-3.5" />
                Arlington Warehouse
              </button>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-4">
            {/* Delivery Date */}
            <div className="space-y-1.5">
              <Label className="text-xs font-mono uppercase">Delivery Date</Label>
              <Input
                type="date"
                value={draftDateISO}
                onChange={(e) => setDraftDateISO(e.target.value)}
                className="font-mono text-xs h-9"
              />
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setDraftDateISO(todayISO)}
                  className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                    draftDateISO === todayISO
                      ? "bg-amber-500/20 border-amber-500/50 text-amber-400 font-bold"
                      : "bg-secondary border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Today ({todayISO.slice(5)})
                </button>
                <button
                  type="button"
                  onClick={() => setDraftDateISO(tomorrowISO)}
                  className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                    draftDateISO === tomorrowISO
                      ? "bg-amber-500/20 border-amber-500/50 text-amber-400 font-bold"
                      : "bg-secondary border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Tomorrow ({tomorrowISO.slice(5)})
                </button>
              </div>
            </div>

            {/* Hot Shot Driver (Any Employee!) */}
            <div className="space-y-1.5 md:col-span-2">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs font-mono uppercase">
                  Hot Shot Driver (Any Company Employee)
                </Label>
                {draftRawPdfDriver && (
                  <span className="text-[10px] font-mono text-amber-400">
                    PDF Header: "{draftRawPdfDriver}"
                  </span>
                )}
              </div>
              <Input
                value={draftDriverName}
                onChange={(e) => {
                  const val = e.target.value;
                  setDraftDriverName(val);
                  if (/(?:^|\b)(?:arl|arlington)(?:\b|$)/i.test(val)) {
                    setDraftOriginHub("arlington");
                  } else if (/(?:^|\b)(?:sf|sioux\s+falls)(?:\b|$)/i.test(val)) {
                    setDraftOriginHub("sioux_falls");
                  }
                }}
                placeholder={
                  draftOriginHub === "arlington"
                    ? "Type Arlington driver name..."
                    : "Type any employee name or pick from SF roster below..."
                }
                className="h-9 text-sm font-semibold"
              />
              {draftOriginHub === "sioux_falls" && (
                <div className="flex flex-wrap gap-1 pt-0.5">
                  {sfRosterNames.map((name) => {
                    const active = draftDriverName.trim().toLowerCase() === name.toLowerCase();
                    return (
                      <button
                        key={name}
                        type="button"
                        onClick={() => setDraftDriverName(name)}
                        className={`text-[10px] px-2 py-0.5 rounded-sm border transition-colors ${
                          active
                            ? "bg-amber-500 text-black font-bold border-amber-400"
                            : "bg-secondary/60 border-border text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {name}
                      </button>
                    );
                  })}
                </div>
              )}
              {draftDriverName.trim() && (
                <div className="text-[11px] font-mono pt-0.5">
                  {draftOriginHub === "arlington" ? (
                    <span className="text-amber-300">
                      Originating & returning to <strong>Arlington Warehouse</strong> — draws loop & Return ETA to Arlington without altering SF shifts.
                    </span>
                  ) : matchedSfScheduleMember ? (
                    <span className="text-amber-400">
                      ⚡ Will also display a lightning bolt next to <strong>{matchedSfScheduleMember}</strong> on the SF Team Schedule for {formatHotShotDateHuman(draftDateISO)}.
                    </span>
                  ) : (
                    <span className="text-muted-foreground">
                      Off-schedule employee — will display on the Hotshots TV screen, Map & Return ETA without altering SF shifts.
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Assigned Van / Fleet Unit */}
            <div className="space-y-1.5">
              <Label className="text-xs font-mono uppercase">Assigned Van (Optional)</Label>
              <Select value={draftVehicleId} onValueChange={setDraftVehicleId}>
                <SelectTrigger className="h-9 text-xs font-mono">
                  <SelectValue placeholder="Auto-Detect via GPS..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">
                    ✨ Auto-Detect via GPS (Zero Entry)
                  </SelectItem>
                  {sortedFleetOptions.map((opt) => (
                    <SelectItem key={opt.vehicleId} value={opt.vehicleId}>
                      {opt.label}
                      {opt.isRegularRouteTruck ? " (Route Truck)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {draftVehicleId === "__none__" && (
                <div className="text-[10.5px] font-mono leading-snug pt-0.5">
                  {draftVehicleEstimate.topMatch ? (
                    <div className="rounded-sm border border-emerald-500/45 bg-emerald-500/12 px-2 py-1 text-emerald-300">
                      <div className="font-bold flex items-center gap-1">
                        <Satellite className="w-3 h-3 text-emerald-400 shrink-0" />
                        <span>
                          GPS Match: {draftVehicleEstimate.topMatch.vehicleName} (
                          {draftVehicleEstimate.topMatch.confidence}%)
                        </span>
                      </div>
                      <div className="text-[10px] text-emerald-200/80">
                        {draftVehicleEstimate.topMatch.reason}
                      </div>
                    </div>
                  ) : (
                    <span className="text-muted-foreground inline-flex items-center gap-1">
                      <Satellite className="w-3 h-3 text-sky-400 shrink-0" />
                      {draftVehicleEstimate.loading
                        ? "Checking fleet GPS history..."
                        : "Hands-free: auto-detects which van departs along this route."}
                    </span>
                  )}
                </div>
              )}
              <div className="flex items-center gap-2 pt-0.5">
                <Label className="text-[10px] font-mono uppercase text-muted-foreground shrink-0">
                  Depart:
                </Label>
                <Input
                  type="time"
                  value={draftDepartureHHMM}
                  onChange={(e) => setDraftDepartureHHMM(e.target.value)}
                  className="h-7 text-xs font-mono w-28"
                />
                <div className="flex items-center gap-1 ml-auto">
                  {HOTSHOT_COLOR_PALETTE.map((hex) => (
                    <button
                      key={hex}
                      type="button"
                      onClick={() => setDraftColor(hex)}
                      className={`w-4 h-4 rounded-full border ${
                        draftColor === hex ? "ring-2 ring-white border-black" : "border-border"
                      }`}
                      style={{ backgroundColor: hex }}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Generous Completion & Return ETA Preview Strip */}
          <div className="rounded-sm border border-amber-500/35 bg-amber-500/10 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 font-semibold text-foreground">
              <Clock className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                Generous {draftHubMeta.shortLabel} Loop Estimate:{" "}
                <strong className="font-mono text-amber-300">
                  ~{draftPreviewTiming.totalLoopRoadMiles} road miles
                </strong>{" "}
                •{" "}
                <strong className="font-mono text-amber-300">
                  {includedDraftStops.length} stops
                </strong>{" "}
                ({draftPreviewTiming.estimatedTotalDurationLabel}, includes 25 min/stop + 20% road buffer)
              </span>
            </div>
            <div className="font-mono font-bold text-amber-300">
              Est. {draftHubMeta.shortLabel} Return Window: {draftPreviewTiming.etaWindowLabel}
            </div>
          </div>

          {/* Editable Stops List */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-mono uppercase">
                Route Stops & Accounts ({includedDraftStops.length} included)
              </Label>
              <span className="text-[11px] text-muted-foreground">
                Uncheck any order being held for a different day, or reorder stops with arrows.
              </span>
            </div>

            <div className="space-y-1.5 max-h-[320px] overflow-y-auto pr-1">
              {draftStops.map((stop, idx) => (
                <div
                  key={stop.id}
                  className={`rounded-sm border px-3 py-2 flex items-center justify-between gap-3 ${
                    stop.included
                      ? "border-border bg-secondary/35"
                      : "border-border/50 bg-secondary/10 opacity-50"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <input
                      type="checkbox"
                      checked={stop.included}
                      onChange={(e) =>
                        setDraftStops((prev) =>
                          prev.map((s, i) =>
                            i === idx ? { ...s, included: e.target.checked } : s,
                          ),
                        )
                      }
                      className="h-4 w-4 accent-amber-500 shrink-0"
                    />
                    <span className="font-mono font-bold text-xs text-amber-400 w-6 shrink-0">
                      #{idx + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-xs text-foreground">
                          {stop.city}, {stop.state}
                        </span>
                        <span className="text-xs text-foreground/85 font-semibold truncate">
                          — {stop.accountName}
                        </span>
                        {stop.piecesCount && (
                          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-background border border-border text-muted-foreground">
                            {stop.piecesCount} pcs
                          </span>
                        )}
                        {stop.notes && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold px-2 py-0.2 rounded bg-amber-500/20 border border-amber-500/45 text-amber-300">
                            <AlertTriangle className="w-3 h-3" />
                            {stop.notes}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] font-mono text-muted-foreground truncate">
                        {stop.address || "Town-center GPS geofence"}
                        {stop.partsSummary ? ` • ${stop.partsSummary}` : ""}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      disabled={idx === 0}
                      onClick={() => handleMoveDraftStop(idx, -1)}
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      disabled={idx === draftStops.length - 1}
                      onClick={() => handleMoveDraftStop(idx, 1)}
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            {/* Quick Add Extra Stop Row */}
            <div className="pt-2 grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
              <Input
                placeholder="Town (e.g. Luverne)"
                value={newStopCity}
                onChange={(e) => setNewStopCity(e.target.value)}
                className="h-8 text-xs sm:col-span-3"
              />
              <Input
                placeholder="ST"
                value={newStopState}
                onChange={(e) => setNewStopState(e.target.value)}
                maxLength={2}
                className="h-8 text-xs font-mono uppercase sm:col-span-1"
              />
              <Input
                placeholder="Account / Dealer Name"
                value={newStopAccount}
                onChange={(e) => setNewStopAccount(e.target.value)}
                className="h-8 text-xs sm:col-span-4"
              />
              <Input
                placeholder="Street Address (optional)"
                value={newStopAddress}
                onChange={(e) => setNewStopAddress(e.target.value)}
                className="h-8 text-xs sm:col-span-2"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddManualStopToDraft}
                className="h-8 text-xs gap-1 sm:col-span-2"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Stop
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
            <Button variant="ghost" size="sm" onClick={() => setDraftOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={savingDraft}
              onClick={handleSaveDraft}
              className="gap-1.5 font-bold bg-amber-500 hover:bg-amber-400 text-black"
            >
              <Zap className="w-4 h-4" />
              {savingDraft
                ? "Saving..."
                : editingRouteId
                  ? "Save Hot Shot Changes"
                  : `Dispatch Hot Shot (${formatHotShotDateHuman(draftDateISO)})`}
            </Button>
          </div>
        </div>
      )}

      {/* Active Today Section */}
      <div className="space-y-3">
        <h3 className="font-display font-bold text-sm uppercase tracking-wider text-foreground flex items-center gap-2">
          <Zap className="w-4 h-4 text-amber-400" />
          Today's Active Hot Shots ({todayRoutes.length})
        </h3>
        {todayRoutes.length === 0 ? (
          <div className="rounded-sm border border-border bg-card/60 p-6 text-center text-xs text-muted-foreground font-mono">
            No Hot Shot runs scheduled for today ({formatHotShotDateHuman(todayISO)}). Note: The Hotshots TV screen automatically skips itself in rotation on quiet days and activates automatically when a Hot Shot is scheduled for today!
          </div>
        ) : (
          <div className="space-y-3">
            {todayRoutes.map((r) => renderRouteCard(r, "today"))}
          </div>
        )}
      </div>

      {/* Upcoming Scheduled Hot Shots */}
      {upcomingRoutes.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-display font-bold text-sm uppercase tracking-wider text-sky-400 flex items-center gap-2">
            <Calendar className="w-4 h-4" />
            Upcoming Scheduled Hot Shots ({upcomingRoutes.length})
          </h3>
          <div className="space-y-3">
            {upcomingRoutes.map((r) => renderRouteCard(r, "upcoming"))}
          </div>
        </div>
      )}

      {/* Unassigned / Open Orders (/API/Orders) */}
      {openOrders.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h3 className="font-display font-bold text-sm uppercase tracking-wider text-emerald-400 flex items-center gap-2">
              <PackageOpen className="w-4 h-4" />
              Open Orders Not Yet Assigned to a Delivery Sheet ({openOrders.length})
            </h3>
            <span className="text-[11px] font-mono text-muted-foreground">
              Pulled live from HotShotSheet /API/Orders
            </span>
          </div>
          <div className="rounded-sm border border-border bg-card p-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {openOrders.map((ord) => {
              const hubMeta = getHotShotHubMeta(ord.originHub);
              return (
                <div
                  key={ord.deliveryId}
                  className="rounded-sm border border-border bg-secondary/25 p-2.5 space-y-1 flex flex-col justify-between"
                >
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-1.5 flex-wrap">
                      <span className="text-[10px] font-mono font-bold uppercase px-1.5 py-0.5 rounded bg-primary/15 text-primary border border-primary/35">
                        [{hubMeta.code}] {ord.driverName}
                      </span>
                      {ord.piecesCount ? (
                        <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                          {ord.piecesCount} pcs
                        </span>
                      ) : null}
                    </div>
                    <div className="text-xs font-bold text-foreground">
                      {ord.city}, {ord.state}{" "}
                      <span className="text-muted-foreground font-normal">—</span>{" "}
                      {ord.accountName}
                      {ord.accountCode ? (
                        <span className="text-[10px] font-mono text-amber-400 ml-1">
                          [{ord.accountCode}]
                        </span>
                      ) : null}
                    </div>
                    {ord.partsSummary && (
                      <div className="text-[11px] font-mono text-emerald-300">
                        {ord.partsSummary}
                      </div>
                    )}
                    {ord.notes && (
                      <div className="text-[10px] font-mono text-amber-300">
                        Note: {ord.notes}
                      </div>
                    )}
                  </div>
                  <div className="pt-1 border-t border-border/50 text-[10px] font-mono text-muted-foreground flex items-center justify-between gap-2">
                    <span>{ord.poNumber ? `PO: ${ord.poNumber}` : `ID #${ord.deliveryId}`}</span>
                    {ord.enteredBy ? <span>By: {ord.enteredBy}</span> : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent Past Hot Shots */}
      {pastRoutes.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-display font-bold text-xs uppercase tracking-wider text-muted-foreground">
            Recent Completed / Archived Hot Shots ({Math.min(pastRoutes.length, 5)})
          </h3>
          <div className="space-y-2 opacity-80">
            {pastRoutes.slice(0, 5).map((r) => renderRouteCard(r, "past"))}
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={Boolean(pendingDeleteRoute)}
        onOpenChange={(open) => !open && setPendingDeleteRoute(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Hot Shot Dispatch?</DialogTitle>
            <DialogDescription>
              Remove the Hot Shot route for{" "}
              <strong>{pendingDeleteRoute?.driverName}</strong> scheduled on{" "}
              <strong>
                {pendingDeleteRoute
                  ? formatHotShotDateHuman(pendingDeleteRoute.deliveryDateISO)
                  : ""}
              </strong>
              ? It will immediately disappear from the TVs.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingDeleteRoute(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDeleteRoute}>
              Delete Hot Shot
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
