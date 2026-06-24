import { useState, useEffect } from "react";
import TrackingMap from "@/components/TrackingMap";
import { useWebSocket } from "@/hooks/useWebSocket";
import {
  Radio, MapPin, ZoomIn, ZoomOut, Lock, Home,
  ChevronLeft, ChevronRight, Check
} from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";

const SIOUX_FALLS_BOUNDS = {
  southwest: [43.43, -96.96] as [number, number],
  northeast: [43.65, -96.55] as [number, number],
};

const SIOUX_FALLS_CENTER: [number, number] = [43.54, -96.75];
const DEFAULT_HOME_OFFICE: [number, number] = [43.5446, -96.7311];

const STORAGE_KEY = "regional-sf-zoom";
const VISIBLE_VEHICLES_KEY = "regional-sf-visible-vehicles";
const DEFAULT_ZOOM = 12;
const MIN_ZOOM = 11;
const MAX_ZOOM = 17;

function getSavedZoom(): number {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const zoom = parseInt(saved, 10);
      if (zoom >= MIN_ZOOM && zoom <= MAX_ZOOM) return zoom;
    }
  } catch (e) {}
  return DEFAULT_ZOOM;
}

function saveZoom(zoom: number) {
  try {
    localStorage.setItem(STORAGE_KEY, zoom.toString());
  } catch (e) {}
}

function getSavedVisibleVehicles(): string[] | null {
  try {
    const saved = localStorage.getItem(VISIBLE_VEHICLES_KEY);
    if (saved) return JSON.parse(saved);
  } catch (e) {}
  return null;
}

function saveVisibleVehicles(ids: string[]) {
  try {
    localStorage.setItem(VISIBLE_VEHICLES_KEY, JSON.stringify(ids));
  } catch (e) {}
}

function distanceMiles(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

type VehicleEntry = {
  id: string;
  name?: string;
  color?: string;
  location: { lat: number; lon: number };
  speed: number;
  status: string;
  timestamp: string;
  heading: number;
};

function getStatusColor(status: string) {
  switch (status?.toLowerCase()) {
    case "moving":
      return "text-green-500";
    case "stopped":
      return "text-red-400";
    case "idle":
    case "idling":
      return "text-yellow-400";
    default:
      return "text-muted-foreground";
  }
}

export default function RegionalSFMap() {
  const [zoom, setZoom] = useState(getSavedZoom);
  const [vehicleData, setVehicleData] = useState<VehicleEntry[]>([]);
  const [homeOffice, setHomeOffice] = useState<[number, number]>(DEFAULT_HOME_OFFICE);
  const [homeOfficeName, setHomeOfficeName] = useState<string>("Home Office");
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set());
  const [initialized, setInitialized] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const handleZoomChange = (newZoom: number) => {
    setZoom(newZoom);
    saveZoom(newZoom);
  };

  // Try to detect home office from custom locations
  useEffect(() => {
    fetch("/api/custom-locations")
      .then((r) => r.json())
      .then((locs: any[]) => {
        const home = locs.find(
          (l) =>
            l.icon === "Home" ||
            l.name?.toLowerCase().includes("office") ||
            l.name?.toLowerCase().includes("home")
        );
        if (home) {
          setHomeOffice([home.latitude, home.longitude]);
          setHomeOfficeName(home.name || "Home Office");
        }
      })
      .catch(() => {});
  }, []);

  const loadVehicles = async () => {
    try {
      const response = await fetch("/api/vehicles");
      if (response.ok) {
        const vehicles: VehicleEntry[] = await response.json();
        setVehicleData(vehicles);
        if (!initialized) {
          const saved = getSavedVisibleVehicles();
          if (saved) {
            setVisibleIds(new Set(saved));
          } else {
            setVisibleIds(new Set(vehicles.map((v) => v.id)));
          }
          setInitialized(true);
        }
      }
    } catch (error) {
      console.error("Error loading vehicles:", error);
    }
  };

  useEffect(() => {
    loadVehicles();
  }, []);

  const { isConnected } = useWebSocket((data) => {
    setVehicleData((prev) => {
      const existingIndex = prev.findIndex((v) => v.id === data.id);
      if (existingIndex >= 0) {
        const updated = [...prev];
        updated[existingIndex] = {
          ...updated[existingIndex],
          location: data.location,
          speed: data.speed,
          status: data.status,
          timestamp: data.timestamp,
          heading: data.heading,
        };
        return updated;
      } else {
        setVisibleIds((prev) => {
          const next = new Set(prev);
          next.add(data.id);
          saveVisibleVehicles([...next]);
          return next;
        });
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
      }
    });
  });

  const toggleVehicle = (id: string) => {
    setVisibleIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveVisibleVehicles([...next]);
      return next;
    });
  };

  const toggleAll = (show: boolean) => {
    const ids = show
      ? new Set(vehicleData.map((v) => v.id))
      : new Set<string>();
    setVisibleIds(ids);
    saveVisibleVehicles([...ids]);
  };

  const filteredData = vehicleData.filter((v) => visibleIds.has(v.id));

  const sortedVehicles = [...vehicleData].sort((a, b) => {
    const da = distanceMiles(homeOffice[0], homeOffice[1], a.location.lat, a.location.lon);
    const db = distanceMiles(homeOffice[0], homeOffice[1], b.location.lat, b.location.lon);
    return da - db;
  });

  return (
    <div className="h-screen w-screen flex bg-background overflow-hidden">
      {/* Collapsible sidebar */}
      <div
        className={`relative z-[1000] flex flex-col shrink-0 transition-all duration-300 ${
          sidebarOpen ? "w-72" : "w-0"
        } bg-background/95 backdrop-blur-sm border-r border-border shadow-xl overflow-hidden`}
      >
        {sidebarOpen && (
          <>
            {/* Header */}
            <div className="p-3 border-b border-border">
              <div className="flex items-center gap-2 mb-1">
                <MapPin className="w-4 h-4 text-primary shrink-0" />
                <span className="text-sm font-semibold">SF Regional View</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Home className="w-3 h-3 text-muted-foreground shrink-0" />
                <span className="text-[10px] font-mono text-muted-foreground truncate">
                  {homeOfficeName}
                </span>
              </div>
            </div>

            {/* Controls row */}
            <div className="px-3 py-2 flex items-center justify-between border-b border-border/50">
              <span className="text-[11px] text-muted-foreground">
                <span className="font-semibold text-foreground">{filteredData.length}</span>
                {" / "}{vehicleData.length} visible
              </span>
              <div className="flex items-center gap-1">
                <button
                  className="text-[10px] text-primary hover:underline px-1"
                  onClick={() => toggleAll(true)}
                  data-testid="button-show-all"
                >
                  All
                </button>
                <span className="text-[10px] text-muted-foreground">·</span>
                <button
                  className="text-[10px] text-muted-foreground hover:text-foreground hover:underline px-1"
                  onClick={() => toggleAll(false)}
                  data-testid="button-hide-all"
                >
                  None
                </button>
              </div>
            </div>

            {/* Vehicle list */}
            <div className="flex-1 overflow-y-auto">
              <div className="p-2 space-y-1">
                {sortedVehicles.length === 0 && (
                  <div className="text-center py-10 text-muted-foreground text-xs">
                    No vehicles tracked yet
                  </div>
                )}
                {sortedVehicles.map((v) => {
                  const dist = distanceMiles(
                    homeOffice[0],
                    homeOffice[1],
                    v.location.lat,
                    v.location.lon
                  );
                  const isVisible = visibleIds.has(v.id);
                  return (
                    <div
                      key={v.id}
                      className={`flex items-center gap-2 p-2 rounded-md cursor-pointer transition-colors select-none ${
                        isVisible
                          ? "bg-muted/40 hover:bg-muted"
                          : "opacity-40 hover:opacity-60 hover:bg-muted/20"
                      }`}
                      onClick={() => toggleVehicle(v.id)}
                      data-testid={`vehicle-row-${v.id}`}
                    >
                      <div
                        className={`shrink-0 w-4 h-4 rounded-sm border flex items-center justify-center transition-colors ${
                          isVisible
                            ? "bg-primary border-primary"
                            : "border-border bg-background"
                        }`}
                        data-testid={`checkbox-vehicle-${v.id}`}
                      >
                        {isVisible && (
                          <Check className="w-3 h-3 text-primary-foreground" />
                        )}
                      </div>
                      <div
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: v.color || "#3b82f6" }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium truncate leading-tight">
                          {v.name || v.id}
                        </div>
                        <div
                          className={`text-[10px] font-mono capitalize leading-tight ${getStatusColor(v.status)}`}
                        >
                          {v.status || "unknown"} ·{" "}
                          {v.speed != null ? Math.round(v.speed) : 0} mph
                        </div>
                      </div>
                      <div className="text-right shrink-0 ml-1">
                        <div className="text-sm font-mono font-bold text-primary leading-tight">
                          {dist.toFixed(1)}
                        </div>
                        <div className="text-[9px] text-muted-foreground leading-tight">
                          mi away
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Footer */}
            <div className="px-3 py-2 border-t border-border/50">
              <p className="text-[9px] text-muted-foreground text-center">
                Distance from{" "}
                <span className="font-semibold">{homeOfficeName}</span>
                {" · "}sorted nearest first
              </p>
            </div>
          </>
        )}
      </div>

      {/* Map area */}
      <div className="flex-1 relative">
        {/* Sidebar toggle */}
        <button
          className="absolute left-0 top-1/2 -translate-y-1/2 z-[1001] bg-background/90 backdrop-blur-sm border border-border border-l-0 rounded-r-md py-3 px-1 shadow-md hover:bg-muted transition-colors"
          onClick={() => setSidebarOpen((s) => !s)}
          data-testid="button-toggle-sidebar"
          title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
        >
          {sidebarOpen ? (
            <ChevronLeft className="w-3 h-3" />
          ) : (
            <ChevronRight className="w-3 h-3" />
          )}
        </button>

        <TrackingMap
          data={filteredData}
          onVehicleUpdate={loadVehicles}
          center={SIOUX_FALLS_CENTER}
          zoom={zoom}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          bounds={SIOUX_FALLS_BOUNDS}
          onZoomChange={handleZoomChange}
          autoFitBounds={false}
        />

        {/* Top status badges */}
        <div className="absolute top-4 left-10 z-[1000] flex items-center gap-2">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border bg-background/90 backdrop-blur-sm shadow-lg border-primary/30">
            <MapPin className="w-3 h-3 text-primary" />
            <span className="text-[10px] font-mono font-bold uppercase text-primary">
              SF Regional
            </span>
          </div>

          <div
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full border bg-background/90 backdrop-blur-sm shadow-lg ${
              isConnected ? "border-green-500/30" : "border-yellow-500/30"
            }`}
          >
            <Radio
              className={`w-3 h-3 ${
                isConnected ? "text-green-500 animate-pulse" : "text-yellow-500"
              }`}
            />
            <span
              className={`text-[10px] font-mono font-bold uppercase ${
                isConnected ? "text-green-500" : "text-yellow-500"
              }`}
            >
              {isConnected ? "Live" : "Connecting..."}
            </span>
          </div>

          {vehicleData.length > 0 && (
            <div className="px-3 py-1.5 rounded-full bg-background/90 backdrop-blur-sm border border-border shadow-lg">
              <span className="text-xs font-mono">
                <span className="text-primary font-bold">{filteredData.length}</span>
                <span className="text-muted-foreground"> shown</span>
              </span>
            </div>
          )}
        </div>

        {/* Zoom controls */}
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[1000] bg-background/50 backdrop-blur-sm border border-border rounded-lg shadow-xl p-3 flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => handleZoomChange(Math.max(MIN_ZOOM, zoom - 1))}
            disabled={zoom <= MIN_ZOOM}
            data-testid="button-zoom-out"
          >
            <ZoomOut className="w-4 h-4" />
          </Button>

          <div className="flex items-center gap-2 w-48">
            <Slider
              value={[zoom]}
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={1}
              onValueChange={(v) => handleZoomChange(v[0])}
              className="w-full"
              data-testid="slider-zoom"
            />
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => handleZoomChange(Math.min(MAX_ZOOM, zoom + 1))}
            disabled={zoom >= MAX_ZOOM}
            data-testid="button-zoom-in"
          >
            <ZoomIn className="w-4 h-4" />
          </Button>

          <div className="flex items-center gap-1.5 pl-2 border-l border-border">
            <Lock className="w-3 h-3 text-green-500" />
            <span className="text-[10px] font-mono text-muted-foreground">
              Zoom: <span className="text-primary font-bold">{zoom}</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
