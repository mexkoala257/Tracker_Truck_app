import { useEffect, useState } from "react";
import { Clock3, Warehouse } from "lucide-react";

const CENTRAL_TIME_ZONE = "America/Chicago";
const RETURN_ETA_CUTOFF_HOUR = 15;
const STALE_LOCATION_MINUTES = 10;

export type ReturnEtaWarehouse = {
  name: string;
  latitude: number;
  longitude: number;
};

type ReturnEtaVehicle = {
  id: string;
  name?: string;
  color?: string;
  location: { lat: number; lon: number };
  status: string;
  timestamp: string;
};

type ReturnEstimate = {
  vehicle: ReturnEtaVehicle;
  eta: Date | null;
  isAtWarehouse: boolean;
  isStale: boolean;
};

type ReturnEtaPanelProps = {
  vehicles: ReturnEtaVehicle[];
  warehouse: ReturnEtaWarehouse;
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

function getCentralHour(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CENTRAL_TIME_ZONE,
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  return Number(parts.find((part) => part.type === "hour")?.value || 0);
}

function formatCentralTime(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: CENTRAL_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function estimateReturn(
  vehicle: ReturnEtaVehicle,
  warehouse: ReturnEtaWarehouse,
  now: Date,
): ReturnEstimate {
  const straightLineMiles = distanceMiles(
    warehouse.latitude,
    warehouse.longitude,
    vehicle.location.lat,
    vehicle.location.lon,
  );
  const roadMiles = straightLineMiles * 1.25;
  const timestamp = new Date(vehicle.timestamp).getTime();
  const ageMinutes = Number.isFinite(timestamp)
    ? Math.max(0, (now.getTime() - timestamp) / 60000)
    : Infinity;
  const isStale = ageMinutes > STALE_LOCATION_MINUTES;
  const isAtWarehouse = roadMiles < 0.75;

  if (isAtWarehouse || isStale) {
    return { vehicle, eta: null, isAtWarehouse, isStale };
  }

  const averageSpeedMph =
    roadMiles <= 5 ? 30 :
    roadMiles <= 15 ? 40 :
    50;
  const minutes = Math.max(5, Math.round((roadMiles / averageSpeedMph) * 60));

  return {
    vehicle,
    eta: new Date(now.getTime() + minutes * 60000),
    isAtWarehouse,
    isStale,
  };
}

export default function ReturnEtaPanel({
  vehicles,
  warehouse,
}: ReturnEtaPanelProps) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  if (getCentralHour(now) < RETURN_ETA_CUTOFF_HOUR) {
    return null;
  }

  const estimates = vehicles
    .filter((vehicle) => !vehicle.id.startsWith("asset-"))
    .map((vehicle) => estimateReturn(vehicle, warehouse, now));
  const activeEstimates = estimates
    .filter((estimate) => !estimate.isAtWarehouse && !estimate.isStale && estimate.eta)
    .sort((a, b) => (a.eta?.getTime() || 0) - (b.eta?.getTime() || 0));
  const atWarehouseCount = estimates.filter((estimate) => estimate.isAtWarehouse).length;
  const staleCount = estimates.filter(
    (estimate) => !estimate.isAtWarehouse && estimate.isStale,
  ).length;
  const centralTime = formatCentralTime(now);

  return (
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
        {activeEstimates.length === 0 ? (
          <div className="px-3 py-4 text-center">
            <p className="text-sm font-medium">No active return estimates</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Arrival times appear when a truck has a current GPS position away from the warehouse.
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {activeEstimates.map((estimate) => (
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
  );
}