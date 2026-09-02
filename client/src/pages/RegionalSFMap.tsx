import { useState, useEffect } from "react";
import TrackingMap from "@/components/TrackingMap";
import { useWebSocket } from "@/hooks/useWebSocket";
import { Clock3, MapPin, Radio, Warehouse } from "lucide-react";

const SIOUX_FALLS_BOUNDS = {
  southwest: [43.43, -96.96] as [number, number],
  northeast: [43.65, -96.55] as [number, number],
};

const SIOUX_FALLS_CENTER: [number, number] = [43.54, -96.75];
const STORAGE_KEY = "regional-sf-zoom";
const VISIBLE_VEHICLES_KEY = "regional-sf-visible-vehicles";
const DARK_MODE_KEY = "regional-sf-dark-mode";
const DEFAULT_ZOOM = 12;
const MIN_ZOOM = 11;
const MAX_ZOOM = 17;
const CENTRAL_TIME_ZONE = "America/Chicago";
const RETURN_ETA_CUTOFF_HOUR = 15;
const DEFAULT_WAREHOUSE = {
  name: "Main Warehouse",
  latitude: 43.55,
  longitude: -96.73,
};
const STALE_LOCATION_MS = 10 * 60 * 1000;

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

function getSavedVisibleVehicles(): Set<string> | null {
  try {
    const saved = localStorage.getItem(VISIBLE_VEHICLES_KEY);
    if (saved) return new Set(JSON.parse(saved));
  } catch (e) {}
  return null;
}

function getSavedDarkMode(): boolean {
  try {
    const saved = localStorage.getItem(DARK_MODE_KEY);
    return saved === null ? true : saved === "true";
  } catch (e) {
    return true;
  }
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

type WarehouseLocation = {
  name: string;
  latitude: number;
  longitude: number;
};

type ReturnEstimate = {
  vehicle: VehicleEntry;
  eta: Date | null;
  roadMiles: number;
  minutes: number;
  isAtWarehouse: boolean;
  isStale: boolean;
  ageMinutes: number;
};

function distanceMiles(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const radiusMiles = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;

  return radiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getCentralTimeParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CENTRAL_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  return {
    hour: Number(parts.find((part) => part.type === "hour")?.value || 0),
    minute: Number(parts.find((part) => part.type === "minute")?.value || 0),
  };
}

function isAfterReturnCutoff(date: Date): boolean {
  return getCentralTimeParts(date).hour >= RETURN_ETA_CUTOFF_HOUR;
}

function formatCentralTime(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: CENTRAL_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatAge(ageMinutes: number): string {
  if (ageMinutes < 1) return "just now";
  if (ageMinutes < 60) return `${Math.round(ageMinutes)} min ago`;

  const hours = Math.floor(ageMinutes / 60);
  const minutes = Math.round(ageMinutes % 60);
  return `${hours}h ${minutes}m ago`;
}

function estimateReturn(
  vehicle: VehicleEntry,
  warehouse: WarehouseLocation,
  now: Date,
): ReturnEstimate {
  const straightLineMiles = distanceMiles(
    warehouse.latitude,
    warehouse.longitude,
    vehicle.location.lat,
    vehicle.location.lon,
  );

  // A 25% road-network adjustment keeps this useful without suggesting
  // that the estimate is a straight-line "birds-eye" distance.
  const roadMiles = straightLineMiles * 1.25;
  const timestamp = new Date(vehicle.timestamp).getTime();
  const ageMinutes = Number.isFinite(timestamp)
    ? Math.max(0, (now.getTime() - timestamp) / 60000)
    : Infinity;
  const isStale = ageMinutes > STALE_LOCATION_MS / 60000;
  const isAtWarehouse = roadMiles < 0.75;

  if (isAtWarehouse || isStale) {
    return {
      vehicle,
      eta: null,
      roadMiles,
      minutes: 0,
      isAtWarehouse,
      isStale,
      ageMinutes,
    };
  }

  // Use practical average road speeds instead of the instantaneous GPS
  // speed, which can be zero while a driver is stopped in traffic.
  const averageSpeedMph =
    roadMiles <= 5 ? 30 :
    roadMiles <= 15 ? 40 :
    50;
  const minutes = Math.max(5, Math.round((roadMiles / averageSpeedMph) * 60));

  return {
    vehicle,
    eta: new Date(now.getTime() + minutes * 60000),
    roadMiles,
    minutes,
    isAtWarehouse,
    isStale,
    ageMinutes,
  };
}

export default function RegionalSFMap() {
  const [zoom] = useState(getSavedZoom);
  const [vehicleData, setVehicleData] = useState<VehicleEntry[]>([]);
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set());
  const [darkMode, setDarkMode] = useState(getSavedDarkMode);
  const [now, setNow] = useState(() => new Date());
  const [warehouse, setWarehouse] = useState<WarehouseLocation>(DEFAULT_WAREHOUSE);
  const [initialized, setInitialized] = useState(false);

  const loadVehicles = async () => {
    try {
      const response = await fetch("/api/vehicles");
      if (response.ok) {
        const vehicles: VehicleEntry[] = await response.json();
        setVehicleData(vehicles);
        if (!initialized) {
          const saved = getSavedVisibleVehicles();
          setVisibleIds(saved ?? new Set(vehicles.map((v) => v.id)));
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

  useEffect(() => {
    const loadWarehouse = async () => {
      try {
        const response = await fetch("/api/custom-locations");
        if (!response.ok) return;

        const locations = await response.json();
        const configuredWarehouse = locations.find(
          (location: any) =>
            location.icon?.toLowerCase() === "warehouse" ||
            location.name?.toLowerCase().includes("warehouse"),
        );

        if (configuredWarehouse) {
          setWarehouse({
            name: configuredWarehouse.name,
            latitude: configuredWarehouse.latitude,
            longitude: configuredWarehouse.longitude,
          });
        }
      } catch (error) {
        console.error("Error loading warehouse location:", error);
      }
    };

    loadWarehouse();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // Re-read visible IDs from localStorage whenever the window regains focus
  // so display board picks up changes made on the settings page
  useEffect(() => {
    const syncDisplaySettings = () => {
      const saved = getSavedVisibleVehicles();
      if (saved) setVisibleIds(saved);
      setDarkMode(getSavedDarkMode());
    };
    window.addEventListener("focus", syncDisplaySettings);
    window.addEventListener("storage", syncDisplaySettings);
    return () => {
      window.removeEventListener("focus", syncDisplaySettings);
      window.removeEventListener("storage", syncDisplaySettings);
    };
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

  const filteredData = vehicleData.filter((v) => visibleIds.has(v.id));
  const showReturnEta = isAfterReturnCutoff(now);
  const allReturnEstimates = filteredData
    .filter((vehicle) => !vehicle.id.startsWith("asset-"))
    .map((vehicle) => estimateReturn(vehicle, warehouse, now))
    .sort((a, b) => {
      if (a.isAtWarehouse !== b.isAtWarehouse) return a.isAtWarehouse ? -1 : 1;
      if (a.isStale !== b.isStale) return a.isStale ? 1 : -1;
      return (a.eta?.getTime() || Number.MAX_SAFE_INTEGER) -
        (b.eta?.getTime() || Number.MAX_SAFE_INTEGER);
    });
  const activeReturnEstimates = allReturnEstimates.filter(
    (estimate) => !estimate.isAtWarehouse && !estimate.isStale && estimate.eta,
  );
  const atWarehouseCount = allReturnEstimates.filter(
    (estimate) => estimate.isAtWarehouse,
  ).length;
  const staleCount = allReturnEstimates.filter(
    (estimate) => !estimate.isAtWarehouse && estimate.isStale,
  ).length;
  const centralTime = formatCentralTime(now);

  return (
    <div className="h-screen w-screen relative bg-background overflow-hidden">
      <TrackingMap
        data={filteredData}
        onVehicleUpdate={loadVehicles}
        center={SIOUX_FALLS_CENTER}
        zoom={zoom}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        bounds={SIOUX_FALLS_BOUNDS}
        onZoomChange={() => {}}
        autoFitBounds={false}
        readOnly
        darkMode={darkMode}
      />

      {/* Minimal status overlay — top left */}
      <div className="absolute top-4 left-4 z-[1000] flex items-center gap-2">
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

        {filteredData.length > 0 && (
          <div className="px-3 py-1.5 rounded-full bg-background/90 backdrop-blur-sm border border-border shadow-lg">
            <span className="text-xs font-mono">
              <span className="text-primary font-bold">{filteredData.length}</span>
              <span className="text-muted-foreground"> tracked</span>
            </span>
          </div>
        )}
      </div>

      {showReturnEta && (
        <section className="absolute top-20 left-4 z-[1000] w-[min(21rem,calc(100vw-2rem))] max-h-[62vh] overflow-hidden rounded-xl border border-primary/25 bg-background/90 shadow-2xl backdrop-blur-md">
          <div className="flex items-start gap-3 border-b border-border/70 px-4 py-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15">
              <Clock3 className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary">
                Return ETA
              </p>
              <p className="mt-0.5 truncate text-sm font-semibold">
                Back to {warehouse.name}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Approximate road return times · {centralTime} Central
              </p>
            </div>
            <Warehouse className="mt-1 h-4 w-4 shrink-0 text-emerald-400" />
          </div>

          <div className="max-h-[42vh] overflow-y-auto p-3">
            {activeReturnEstimates.length === 0 ? (
              <div className="px-3 py-4 text-center">
                <p className="text-sm font-medium">No active return estimates</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Arrival times appear when a truck has a current GPS position away from the warehouse.
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {activeReturnEstimates.map((estimate) => (
                  <div
                    key={estimate.vehicle.id}
                    className="rounded-lg border border-border/60 bg-background/55 px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: estimate.vehicle.color || "#3b82f6" }}
                        />
                        <span className="truncate text-sm font-semibold">
                          {estimate.vehicle.name || estimate.vehicle.id}
                        </span>
                      </div>
                      <span className="shrink-0 text-base font-bold text-primary">
                        {estimate.eta ? formatCentralTime(estimate.eta) : "Unavailable"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-border/70 px-4 py-2.5 text-[10px] text-muted-foreground">
            <span>
              <span className="font-semibold text-emerald-400">{atWarehouseCount}</span>
              {" at warehouse"}
            </span>
            <span>
              <span className="font-semibold text-amber-400">{staleCount}</span>
              {" awaiting current GPS"}
            </span>
          </div>
        </section>
      )}
    </div>
  );
}
