import { useState, useEffect } from "react";
import { Link } from "wouter";
import { useWebSocket } from "@/hooks/useWebSocket";
import {
  Home, MapPin, Check, ArrowLeft, ExternalLink
} from "lucide-react";
import { Button } from "@/components/ui/button";

const DEFAULT_HOME_OFFICE: [number, number] = [43.5446, -96.7311];
const VISIBLE_VEHICLES_KEY = "regional-sf-visible-vehicles";

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
  lat1: number, lon1: number,
  lat2: number, lon2: number
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
    case "moving":   return "text-green-500";
    case "stopped":  return "text-red-400";
    case "idle":
    case "idling":   return "text-yellow-400";
    default:         return "text-muted-foreground";
  }
}

function getStatusDot(status: string) {
  switch (status?.toLowerCase()) {
    case "moving":   return "bg-green-500";
    case "stopped":  return "bg-red-400";
    case "idle":
    case "idling":   return "bg-yellow-400";
    default:         return "bg-muted-foreground";
  }
}

export default function RegionalSFSettings() {
  const [vehicleData, setVehicleData] = useState<VehicleEntry[]>([]);
  const [homeOffice, setHomeOffice] = useState<[number, number]>(DEFAULT_HOME_OFFICE);
  const [homeOfficeName, setHomeOfficeName] = useState<string>("Home Office");
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set());
  const [initialized, setInitialized] = useState(false);

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
          setVisibleIds(saved ? new Set(saved) : new Set(vehicles.map((v) => v.id)));
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

  useWebSocket((data) => {
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
      return [...prev, {
        id: data.id, name: data.name, color: data.color,
        location: data.location, speed: data.speed,
        status: data.status, timestamp: data.timestamp, heading: data.heading,
      }];
    });
  });

  const toggleVehicle = (id: string) => {
    setVisibleIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveVisibleVehicles(Array.from(next));
      return next;
    });
  };

  const toggleAll = (show: boolean) => {
    const ids = show ? new Set(vehicleData.map((v) => v.id)) : new Set<string>();
    setVisibleIds(ids);
    saveVisibleVehicles(Array.from(ids));
  };

  const sortedVehicles = [...vehicleData].sort((a, b) => {
    const da = distanceMiles(homeOffice[0], homeOffice[1], a.location.lat, a.location.lon);
    const db = distanceMiles(homeOffice[0], homeOffice[1], b.location.lat, b.location.lon);
    return da - db;
  });

  const visibleCount = vehicleData.filter((v) => visibleIds.has(v.id)).length;

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <div className="border-b border-border bg-background/95 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/">
              <Button variant="ghost" size="icon" className="h-8 w-8" data-testid="button-back">
                <ArrowLeft className="w-4 h-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-sm font-semibold flex items-center gap-2">
                <MapPin className="w-4 h-4 text-primary" />
                SF Regional — Settings
              </h1>
              <p className="text-[11px] text-muted-foreground">
                Choose which vehicles appear on the display board map
              </p>
            </div>
          </div>
          <Link href="/regional-sf" target="_blank">
            <Button variant="outline" size="sm" className="gap-1.5 text-xs" data-testid="button-open-map">
              <ExternalLink className="w-3 h-3" />
              Open Map
            </Button>
          </Link>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* Home office info card */}
        <div className="rounded-lg border border-border bg-muted/30 p-4 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <Home className="w-4 h-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-medium">{homeOfficeName}</p>
            <p className="text-[11px] font-mono text-muted-foreground">
              {homeOffice[0].toFixed(5)}, {homeOffice[1].toFixed(5)}
            </p>
          </div>
          <p className="ml-auto text-[11px] text-muted-foreground text-right">
            Distances are calculated<br />from this location
          </p>
        </div>

        {/* Vehicle list */}
        <div className="rounded-lg border border-border overflow-hidden">
          {/* List header */}
          <div className="bg-muted/40 px-4 py-2.5 flex items-center justify-between border-b border-border">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Vehicles &amp; Assets
            </span>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">{visibleCount}</span>
                {" of "}{vehicleData.length} shown on map
              </span>
              <div className="flex gap-1">
                <button
                  className="text-xs text-primary hover:underline px-1"
                  onClick={() => toggleAll(true)}
                  data-testid="button-show-all"
                >
                  All
                </button>
                <span className="text-xs text-muted-foreground">·</span>
                <button
                  className="text-xs text-muted-foreground hover:text-foreground hover:underline px-1"
                  onClick={() => toggleAll(false)}
                  data-testid="button-hide-all"
                >
                  None
                </button>
              </div>
            </div>
          </div>

          {/* Rows */}
          {sortedVehicles.length === 0 && (
            <div className="py-12 text-center text-muted-foreground text-sm">
              No vehicles tracked yet. Data will appear once polling starts.
            </div>
          )}
          {sortedVehicles.map((v, i) => {
            const dist = distanceMiles(homeOffice[0], homeOffice[1], v.location.lat, v.location.lon);
            const isVisible = visibleIds.has(v.id);
            return (
              <div
                key={v.id}
                className={`flex items-center gap-4 px-4 py-3 cursor-pointer transition-colors select-none ${
                  i !== 0 ? "border-t border-border/60" : ""
                } ${isVisible ? "hover:bg-muted/40" : "opacity-50 hover:opacity-70 hover:bg-muted/20"}`}
                onClick={() => toggleVehicle(v.id)}
                data-testid={`vehicle-row-${v.id}`}
              >
                {/* Checkbox */}
                <div
                  className={`shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                    isVisible
                      ? "bg-primary border-primary"
                      : "border-border bg-background"
                  }`}
                  data-testid={`checkbox-vehicle-${v.id}`}
                >
                  {isVisible && <Check className="w-3 h-3 text-primary-foreground" strokeWidth={3} />}
                </div>

                {/* Color dot */}
                <div
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: v.color || "#3b82f6" }}
                />

                {/* Name + status */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{v.name || v.id}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <div className={`w-1.5 h-1.5 rounded-full ${getStatusDot(v.status)}`} />
                    <span className={`text-xs font-mono capitalize ${getStatusColor(v.status)}`}>
                      {v.status || "unknown"}
                    </span>
                    <span className="text-xs text-muted-foreground">·</span>
                    <span className="text-xs font-mono text-muted-foreground">
                      {v.speed != null ? Math.round(v.speed) : 0} mph
                    </span>
                  </div>
                </div>

                {/* Coordinates */}
                <div className="hidden sm:block text-right text-[10px] font-mono text-muted-foreground">
                  <div>{v.location.lat.toFixed(4)}</div>
                  <div>{v.location.lon.toFixed(4)}</div>
                </div>

                {/* Distance */}
                <div className="text-right shrink-0 w-20">
                  <p className="text-lg font-mono font-bold text-primary leading-none">
                    {dist.toFixed(1)}
                  </p>
                  <p className="text-[10px] text-muted-foreground">mi from office</p>
                </div>
              </div>
            );
          })}
        </div>

        <p className="text-center text-xs text-muted-foreground pb-4">
          Changes save instantly — the map display updates automatically.
        </p>
      </div>
    </div>
  );
}
