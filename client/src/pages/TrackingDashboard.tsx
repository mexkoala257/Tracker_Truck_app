import { useState, useEffect, useMemo } from "react";
import TrackingMap from "@/components/TrackingMap";
import {
  IbsBrandHeaderMark,
  DoodleworksLegalFooter,
} from "@/components/IbsBrandComponents";
import ReturnEtaPanel, { type ReturnEtaWarehouse } from "@/components/ReturnEtaPanel";
import ActiveVehiclesPanel from "@/components/ActiveVehiclesPanel";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useAuth } from "@/lib/auth";
import { useOfficeTheme } from "@/lib/theme";
import { resolveActiveTvTruckWeek } from "@shared/truckSchedule";
import {
  resolveRouteOverlays,
  type RouteOverlayFilterMode,
} from "@shared/routeTerritories";
import {
  resolveEffectiveNwsAlerts,
  normalizeWeatherOverlayMode,
} from "@shared/weatherOverlay";
import {
  Radio,
  Satellite,
  Settings,
  Truck,
  MapPin,
  Maximize2,
  Tv,
  LogOut,
  KeyRound,
  ZoomIn,
  ZoomOut,
  Sun,
  Moon,
  SlidersHorizontal,
  Check,
  Zap,
  History,
  Calendar,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Link, useLocation } from "wouter";

export type MapPresetMode = "corridor" | "sioux-falls" | "auto-fit";

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

interface CustomLocation {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
}

const CORRIDOR_BOUNDS = {
  southwest: [41.5, -103.5] as [number, number],
  northeast: [47.0, -93.0] as [number, number],
};
const CORRIDOR_CENTER: [number, number] = [44.25, -98.25];

const SIOUX_FALLS_BOUNDS = {
  southwest: [43.43, -96.96] as [number, number],
  northeast: [43.65, -96.55] as [number, number],
};
const SIOUX_FALLS_CENTER: [number, number] = [43.54, -96.75];

const WIDE_AUTOFIT_BOUNDS = {
  southwest: [24.0, -126.0] as [number, number],
  northeast: [52.0, -66.0] as [number, number],
};

const DEFAULT_ARLINGTON_WAREHOUSE: ReturnEtaWarehouse = {
  name: "Arlington Warehouse",
  latitude: 44.3792,
  longitude: -97.1406,
};

const DEFAULT_SF_WAREHOUSE: ReturnEtaWarehouse = {
  name: "Sioux Falls Warehouse",
  latitude: 43.55,
  longitude: -96.73,
};

const ZOOM_CONFIG: Record<MapPresetMode, { min: number; max: number; def: number; storageKey: string }> = {
  corridor: { min: 5, max: 19, def: 9, storageKey: "dispatch-corridor-zoom" },
  "sioux-falls": { min: 10, max: 19, def: 12, storageKey: "dispatch-sf-zoom" },
  "auto-fit": { min: 5, max: 19, def: 8, storageKey: "dispatch-autofit-zoom" },
};

function loadSavedZoom(mode: MapPresetMode): number {
  const cfg = ZOOM_CONFIG[mode];
  try {
    const raw = localStorage.getItem(cfg.storageKey);
    if (raw) {
      const parsed = parseInt(raw, 10);
      if (parsed >= cfg.min && parsed <= cfg.max) return parsed;
    }
  } catch {}
  return cfg.def;
}

interface TrackingDashboardProps {
  /** When set, renders a chromeless map view for phased DAKboard iframe embeds */
  embedPreset?: "corridor" | "sioux-falls";
}

export default function TrackingDashboard({ embedPreset }: TrackingDashboardProps) {
  const isChromelessEmbed = Boolean(embedPreset);
  const { user, scope, logout } = useAuth();
  const { officeTheme, setOfficeTheme, themes: officeThemes } = useOfficeTheme();
  const isAdmin = scope === "admin";
  const canEdit = scope === "admin" || scope === "staff";
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [preset, setPreset] = useState<MapPresetMode>(embedPreset || "corridor");
  const [zoom, setZoom] = useState<number>(() => loadSavedZoom(embedPreset || "corridor"));
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem("dispatch-map-dark-mode");
      return saved === null ? true : saved === "true";
    } catch {
      return true;
    }
  });

  const [vehicleData, setVehicleData] = useState<VehicleEntry[]>([]);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [filterDialogOpen, setFilterDialogOpen] = useState(false);
  const [displayState, setDisplayState] = useState<any>(null);
  const [routeFilter, setRouteFilter] = useState<RouteOverlayFilterMode>(() => {
    try {
      const saved = localStorage.getItem("dispatch-route-filter") as RouteOverlayFilterMode | null;
      return saved || "today";
    } catch {
      return "today";
    }
  });

  const [corridorWarehouse, setCorridorWarehouse] = useState<ReturnEtaWarehouse>(
    DEFAULT_ARLINGTON_WAREHOUSE,
  );
  const [sfWarehouse, setSfWarehouse] = useState<ReturnEtaWarehouse>(DEFAULT_SF_WAREHOUSE);
  const [customLocations, setCustomLocations] = useState<CustomLocation[]>([]);

  // Self-service password modal
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  const switchPreset = (next: MapPresetMode) => {
    setPreset(next);
    setZoom(loadSavedZoom(next));
  };

  const handleZoomChange = (nextZoom: number) => {
    setZoom(nextZoom);
    try {
      localStorage.setItem(ZOOM_CONFIG[preset].storageKey, String(nextZoom));
    } catch {}
  };

  const toggleDarkMode = () => {
    setDarkMode((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("dispatch-map-dark-mode", String(next));
      } catch {}
      return next;
    });
  };

  const loadVehicles = async () => {
    try {
      const response = await fetch("/api/vehicles");
      if (response.ok) {
        const vehicles: VehicleEntry[] = await response.json();
        setVehicleData(vehicles);
      }
    } catch (error) {
      console.error("Error loading vehicles:", error);
    }
  };

  useEffect(() => {
    loadVehicles();
  }, []);

  useEffect(() => {
    const loadWarehousesAndLocations = async () => {
      try {
        const [assignmentsRes, locationsRes, dispRes] = await Promise.all([
          fetch("/api/map-home-locations"),
          fetch("/api/custom-locations"),
          fetch("/api/display/state").catch(() => null),
        ]);

        if (dispRes && dispRes.ok) {
          setDisplayState(await dispRes.json());
        }

        if (locationsRes.ok) {
          setCustomLocations(await locationsRes.json());
        }

        if (assignmentsRes.ok) {
          const assignments = await assignmentsRes.json();
          if (assignments?.map?.location) {
            setCorridorWarehouse({
              name: assignments.map.location.name,
              latitude: assignments.map.location.latitude,
              longitude: assignments.map.location.longitude,
            });
          }
          if (assignments?.["regional-sf"]?.location) {
            setSfWarehouse({
              name: assignments["regional-sf"].location.name,
              latitude: assignments["regional-sf"].location.latitude,
              longitude: assignments["regional-sf"].location.longitude,
            });
          }
        }
      } catch (error) {
        console.error("Error loading map locations:", error);
      }
    };
    loadWarehousesAndLocations();
  }, []);

  const { isConnected } = useWebSocket((data) => {
    setVehicleData((prev) => {
      const idx = prev.findIndex((v) => v.id === data.id);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = {
          ...updated[idx],
          location: data.location,
          speed: data.speed,
          status: data.status,
          timestamp: data.timestamp,
          heading: data.heading,
        };
        return updated;
      }
      return [
        ...prev,
        {
          id: data.id,
          name: data.name,
          color: data.color,
          location: data.location,
          speed: data.speed,
          status: data.status,
          timestamp: data.timestamp,
          heading: data.heading,
        },
      ];
    });
  });

  const activeFleet = useMemo(
    () => vehicleData.filter((v) => v.id !== "HOME" && !hiddenIds.has(v.id)),
    [vehicleData, hiddenIds],
  );

  const displayedVehicles = useMemo(() => {
    if (isChromelessEmbed && preset === "sioux-falls") {
      return activeFleet.filter((v) => {
        const { lat, lon } = v.location;
        return (
          lat >= SIOUX_FALLS_BOUNDS.southwest[0] &&
          lat <= SIOUX_FALLS_BOUNDS.northeast[0] &&
          lon >= SIOUX_FALLS_BOUNDS.southwest[1] &&
          lon <= SIOUX_FALLS_BOUNDS.northeast[1]
        );
      });
    }
    return activeFleet;
  }, [activeFleet, isChromelessEmbed, preset]);

  const activeWarehouse = preset === "sioux-falls" ? sfWarehouse : corridorWarehouse;

  const autoFitCenter = useMemo((): [number, number] => {
    if (displayedVehicles.length === 0) return CORRIDOR_CENTER;
    const avgLat =
      displayedVehicles.reduce((sum, v) => sum + v.location.lat, 0) / displayedVehicles.length;
    const avgLon =
      displayedVehicles.reduce((sum, v) => sum + v.location.lon, 0) / displayedVehicles.length;
    return [avgLat, avgLon];
  }, [displayedVehicles]);

  const movingCount = useMemo(
    () => activeFleet.filter((v) => v.status === "moving" || v.speed > 2).length,
    [activeFleet],
  );

  const activeTruckWeek = useMemo(
    () =>
      displayState?.truckSchedule
        ? resolveActiveTvTruckWeek(displayState.truckSchedule, new Date())
        : null,
    [displayState?.truckSchedule],
  );

  const dashboardRouteOverlays = useMemo(
    () =>
      resolveRouteOverlays(displayState?.routeTerritories, {
        filterMode: routeFilter,
        colorMode: "route",
        activeTruckWeek,
      }),
    [displayState?.routeTerritories, routeFilter, activeTruckWeek],
  );

  const handleSelfPasswordChange = async () => {
    if (!currentPassword || newPassword.length < 8) {
      toast({
        title: "New password must be at least 8 characters",
        variant: "destructive",
      });
      return;
    }
    setSavingPassword(true);
    try {
      const res = await fetch("/api/auth/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Password update failed");
      }
      setPasswordOpen(false);
      setCurrentPassword("");
      setNewPassword("");
      toast({ title: "Password updated successfully!" });
    } catch (err: any) {
      toast({ title: err.message || "Error updating password", variant: "destructive" });
    }
    setSavingPassword(false);
  };

  const initials = (user?.displayName || user?.username || "U")
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const zoomCfg = ZOOM_CONFIG[preset];

  return (
    <div className="h-screen w-screen bg-background text-foreground flex flex-col overflow-hidden">
      {/* Unified Top Command Header (hidden in chromeless DAKboard embed mode) */}
      {!isChromelessEmbed && (
        <header className="min-h-14 py-2 border-b border-border bg-secondary/70 backdrop-blur-md px-3 sm:px-4 flex flex-wrap items-center justify-between gap-2.5 z-20 shrink-0">
          {/* Left: Brand + Unified 4-Tab Site Navigation Switcher */}
          <div className="flex items-center gap-3 flex-wrap min-w-0">
            <IbsBrandHeaderMark />

            <div className="inline-flex rounded-lg bg-card border border-border p-0.5 text-xs">
              <Link href="/dispatch">
                <button
                  type="button"
                  data-testid="link-dispatch-portal"
                  className="px-3 py-1.5 rounded-md font-semibold text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5"
                >
                  <Zap className="w-3.5 h-3.5" />
                  Dispatch & Routes
                </button>
              </Link>
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
                    data-testid="link-admin"
                    className="px-3 py-1.5 rounded-md font-semibold text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5"
                  >
                    <Calendar className="w-3.5 h-3.5" />
                    Schedules & TV Board
                  </button>
                </Link>
              )}
              <span className="px-3 py-1.5 rounded-md font-bold bg-primary text-primary-foreground shadow-sm flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5" />
                Full Fleet Map
              </span>
            </div>
          </div>

          {/* Center: Map Region Preset Switcher */}
          <div className="flex items-center gap-1 p-0.5 rounded-lg bg-card border border-border text-xs">
            <button
              type="button"
              onClick={() => switchPreset("corridor")}
              data-testid="preset-corridor"
              className={`px-2.5 py-1 rounded-md font-semibold inline-flex items-center gap-1.5 transition-colors ${
                preset === "corridor"
                  ? "bg-foreground text-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Truck className="w-3.5 h-3.5" />
              <span>Corridor</span>
            </button>
            <button
              type="button"
              onClick={() => switchPreset("sioux-falls")}
              data-testid="preset-sioux-falls"
              className={`px-2.5 py-1 rounded-md font-semibold inline-flex items-center gap-1.5 transition-colors ${
                preset === "sioux-falls"
                  ? "bg-foreground text-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <MapPin className="w-3.5 h-3.5" />
              <span>Sioux Falls</span>
            </button>
            <button
              type="button"
              onClick={() => switchPreset("auto-fit")}
              data-testid="preset-auto-fit"
              className={`px-2.5 py-1 rounded-md font-semibold inline-flex items-center gap-1.5 transition-colors ${
                preset === "auto-fit"
                  ? "bg-foreground text-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Maximize2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Auto-Fit</span>
            </button>
          </div>

          {/* Right: Inline Filter, Route Colors, Theme, TV Display & User Controls */}
          <div className="flex items-center gap-2">
            <select
              value={routeFilter}
              onChange={(e) => {
                const val = e.target.value as RouteOverlayFilterMode;
                setRouteFilter(val);
                try {
                  localStorage.setItem("dispatch-route-filter", val);
                } catch {}
              }}
              title="Highlight Colored Routes on Map"
              data-testid="select-route-highlights"
              className="h-8 rounded-lg border border-border bg-card px-2 text-xs font-semibold text-foreground focus:outline-none"
            >
              <option value="today">Routes: Today&apos;s Scheduled</option>
              <option value="all">Routes: All 23 Territories</option>
              <option value="truck_1">Routes: Truck #1 (Sonny)</option>
              <option value="truck_2">Routes: Truck #2 (Brandon)</option>
              <option value="truck_3">Routes: Truck #3 (Nathan)</option>
              <option value="truck_4">Routes: Truck #4 (Troy)</option>
              <option value="truck_5">Routes: Truck #5 (Ron)</option>
              <option value="off">Routes: Off (Trucks Only)</option>
            </select>

            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-8 px-2.5 text-xs rounded-lg"
              onClick={() => setFilterDialogOpen(true)}
              title="Filter visible vehicles on map"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span className="hidden md:inline">
                Units ({activeFleet.length}/{vehicleData.filter((v) => v.id !== "HOME").length})
              </span>
            </Button>

            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 rounded-lg"
              onClick={toggleDarkMode}
              title={darkMode ? "Switch to light map tiles" : "Switch to dark map tiles"}
            >
              {darkMode ? <Sun className="w-3.5 h-3.5 text-primary" /> : <Moon className="w-3.5 h-3.5" />}
            </Button>

            <select
              value={officeTheme}
              onChange={(e) => setOfficeTheme(e.target.value as any)}
              title="Switch Console Visual Theme"
              className="h-8 rounded-lg border border-border bg-card px-2 text-xs font-semibold text-foreground focus:outline-none"
            >
              {officeThemes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.shortLabel}
                </option>
              ))}
            </select>

            <Link href="/display">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 h-8 text-xs font-semibold rounded-lg"
                data-testid="link-tv-display"
              >
                <Tv className="w-3.5 h-3.5 text-primary" />
                <span className="hidden sm:inline">Open TV Screen</span>
              </Button>
            </Link>

            <div className="flex items-center gap-1 pl-1.5 border-l border-border">
              <button
                type="button"
                onClick={() => setPasswordOpen(true)}
                title={`Signed in as ${user?.username} (${user?.role}) — Click to change password`}
                className="inline-flex items-center gap-2 px-2 py-1 rounded-lg bg-secondary/60 hover:bg-secondary border border-border transition-colors"
              >
                <span className="h-6 w-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-[11px] font-black">
                  {initials}
                </span>
                <span className="hidden xl:flex flex-col text-left leading-none">
                  <span className="text-xs font-semibold truncate max-w-[100px]">
                    {user?.displayName || user?.username}
                  </span>
                  <span
                    className={`text-[9px] font-mono uppercase font-bold mt-0.5 ${
                      isAdmin
                        ? "text-sky-400"
                        : scope === "staff"
                          ? "text-amber-400"
                          : "text-emerald-400"
                    }`}
                  >
                    {user?.role || scope}
                  </span>
                </span>
              </button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                title="Sign out"
                data-testid="button-logout"
                onClick={async () => {
                  await logout();
                  setLocation("/login");
                }}
              >
                <LogOut className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </header>
      )}

      {/* Full-Screen Operational Map Canvas */}
      <main className="flex-1 relative min-h-0 w-full">
        {vehicleData.length > 0 ? (
          <TrackingMap
            key={preset}
            data={displayedVehicles}
            onVehicleUpdate={loadVehicles}
            readOnly={!canEdit}
            darkMode={darkMode}
            center={
              preset === "sioux-falls"
                ? SIOUX_FALLS_CENTER
                : preset === "auto-fit"
                  ? autoFitCenter
                  : CORRIDOR_CENTER
            }
            zoom={zoom}
            minZoom={zoomCfg.min}
            maxZoom={zoomCfg.max}
            bounds={
              !isChromelessEmbed
                ? WIDE_AUTOFIT_BOUNDS
                : preset === "sioux-falls"
                  ? SIOUX_FALLS_BOUNDS
                  : preset === "auto-fit"
                    ? WIDE_AUTOFIT_BOUNDS
                    : CORRIDOR_BOUNDS
            }
            onZoomChange={handleZoomChange}
            autoFitBounds={preset === "auto-fit"}
            routeOverlays={dashboardRouteOverlays}
            weatherAlerts={resolveEffectiveNwsAlerts(
              displayState?.nwsAlerts,
              displayState?.settings?.weatherDemoScenario,
            )}
            weatherOverlayMode={normalizeWeatherOverlayMode(
              displayState?.settings?.weatherOverlayMode,
              "warnings_only",
            )}
            baseLocation={{
              name: activeWarehouse.name,
              lat: activeWarehouse.latitude,
              lon: activeWarehouse.longitude,
              address: `${activeWarehouse.latitude.toFixed(4)}, ${activeWarehouse.longitude.toFixed(4)}`,
            }}
          />
        ) : (
          <div className="h-full w-full flex flex-col items-center justify-center bg-background text-muted-foreground">
            <Satellite className="w-16 h-16 mb-4 animate-pulse text-primary/50" />
            <h2 className="text-lg font-semibold mb-2">Waiting for Vehicle Telemetry</h2>
            <p className="text-sm text-center max-w-md">
              No vehicles reported yet. Telemetry updates automatically every 60 seconds via outbound Motive API polling.
            </p>
          </div>
        )}

        {/* Chromeless Embed Status Pills (shown only on /map & /regional-sf DAKboard embeds) */}
        {isChromelessEmbed && (
          <>
            <div className="absolute top-4 left-4 z-[1000] flex items-center gap-2">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-primary/30 bg-background/90 backdrop-blur-sm shadow-lg">
                <MapPin className="w-3 h-3 text-primary" />
                <span className="text-[10px] font-mono font-bold uppercase text-primary">
                  {preset === "sioux-falls" ? "Sioux Falls Regional" : "Fleet Map"}
                </span>
              </div>
              <div
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full border bg-background/90 backdrop-blur-sm shadow-lg ${
                  isConnected ? "border-green-500/30" : "border-yellow-500/30"
                }`}
              >
                <Radio
                  className={`w-3 h-3 ${isConnected ? "text-green-500 animate-pulse" : "text-yellow-500"}`}
                />
                <span
                  className={`text-[10px] font-mono font-bold uppercase ${
                    isConnected ? "text-green-500" : "text-yellow-500"
                  }`}
                >
                  {isConnected ? "Live" : "Connecting..."}
                </span>
              </div>
            </div>
            <div className="absolute top-4 right-4 z-[1000] px-3 py-1.5 rounded-full bg-background/90 backdrop-blur-sm border border-border shadow-lg">
              <span className="text-xs font-mono">
                <span className="text-primary font-bold">{displayedVehicles.length}</span>
                <span className="text-muted-foreground">
                  {" "}
                  vehicle{displayedVehicles.length !== 1 ? "s" : ""}
                </span>
              </span>
            </div>
          </>
        )}

        {/* Operational Floating Overlays: Active Fleet Away & Afternoon Warehouse Return ETAs */}
        {!isChromelessEmbed && (
          <ActiveVehiclesPanel
            vehicles={displayedVehicles}
            warehouse={activeWarehouse}
            locations={customLocations}
          />
        )}

        <ReturnEtaPanel vehicles={displayedVehicles} warehouse={activeWarehouse} />

        {/* Bottom Zoom Control Bar */}
        {preset !== "auto-fit" && (
          <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-[1000] bg-background/80 backdrop-blur-md border border-border rounded-xl shadow-xl px-3 py-2 flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => handleZoomChange(Math.max(zoomCfg.min, zoom - 1))}
              disabled={zoom <= zoomCfg.min}
              data-testid="button-zoom-out"
            >
              <ZoomOut className="w-4 h-4" />
            </Button>

            <div className="flex items-center gap-2 w-36 sm:w-44">
              <Slider
                value={[zoom]}
                min={zoomCfg.min}
                max={zoomCfg.max}
                step={1}
                onValueChange={(v) => handleZoomChange(v[0])}
                className="w-full"
                data-testid="slider-zoom"
              />
            </div>

            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => handleZoomChange(Math.min(zoomCfg.max, zoom + 1))}
              disabled={zoom >= zoomCfg.max}
              data-testid="button-zoom-in"
            >
              <ZoomIn className="w-4 h-4" />
            </Button>

            <span className="text-[11px] font-mono text-muted-foreground pl-2 border-l border-border">
              Zoom <strong className="text-primary">{zoom}</strong>
            </span>
          </div>
        )}
      </main>

      {/* Inline Vehicle Visibility Filter Modal (replaces legacy /regional-sf/settings page) */}
      <Dialog open={filterDialogOpen} onOpenChange={setFilterDialogOpen}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4 text-primary" />
              Visible Fleet Units
            </DialogTitle>
            <DialogDescription>
              Show or hide individual trucks and assets on your map view.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-between gap-2 pb-1">
            <span className="text-xs text-muted-foreground">
              {activeFleet.length} visible
            </span>
            <div className="flex gap-1.5">
              <Button variant="outline" size="xs" onClick={() => setHiddenIds(new Set())}>
                Show All
              </Button>
              <Button
                variant="outline"
                size="xs"
                onClick={() =>
                  setHiddenIds(
                    new Set(vehicleData.filter((v) => v.id !== "HOME").map((v) => v.id)),
                  )
                }
              >
                Hide All
              </Button>
            </div>
          </div>
          <div className="max-h-72 overflow-y-auto space-y-1.5 pr-1">
            {vehicleData
              .filter((v) => v.id !== "HOME")
              .map((v) => {
                const visible = !hiddenIds.has(v.id);
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() =>
                      setHiddenIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(v.id)) next.delete(v.id);
                        else next.add(v.id);
                        return next;
                      })
                    }
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border text-left text-xs transition-colors ${
                      visible
                        ? "border-primary/40 bg-primary/5 text-foreground"
                        : "border-border bg-secondary/20 text-muted-foreground opacity-60"
                    }`}
                  >
                    <span className="flex items-center gap-2 font-semibold truncate">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: v.color || "#3b82f6" }}
                      />
                      <span className="truncate">{v.name || v.id}</span>
                    </span>
                    <span className="flex items-center gap-2 shrink-0 font-mono text-[11px]">
                      <span>{Math.round(v.speed)} mph</span>
                      <span
                        className={`w-4 h-4 rounded flex items-center justify-center border ${
                          visible ? "bg-primary border-primary text-primary-foreground" : "border-border"
                        }`}
                      >
                        {visible && <Check className="w-3 h-3" />}
                      </span>
                    </span>
                  </button>
                );
              })}
          </div>
          <DialogFooter>
            <Button onClick={() => setFilterDialogOpen(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Self-Service Password Update Modal */}
      {!isChromelessEmbed && (
        <Dialog open={passwordOpen} onOpenChange={setPasswordOpen}>
          <DialogContent className="sm:max-w-[420px]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-primary" />
                Account & Password ({user?.username})
              </DialogTitle>
              <DialogDescription>
                Signed in with <strong className="uppercase">{user?.role}</strong> permissions. Update your password below (minimum 8 characters).
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 py-2">
              <div className="grid gap-1.5">
                <Label htmlFor="self-cur-pw">Current Password</Label>
                <Input
                  id="self-cur-pw"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="self-new-pw">New Password (8+ chars)</Label>
                <Input
                  id="self-new-pw"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPasswordOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSelfPasswordChange} disabled={savingPassword}>
                {savingPassword ? "Updating..." : "Update Password"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {!isChromelessEmbed && <DoodleworksLegalFooter />}
    </div>
  );
}
