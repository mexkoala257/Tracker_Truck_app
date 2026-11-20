import { useEffect, useState } from "react";
import { Clock3, Warehouse, Zap } from "lucide-react";
import {
  type HotShotRoute,
  getActiveTodayHotShots,
  estimateHotShotTiming,
  inferWarehouseHubKind,
  normalizeHotShotOriginHub,
} from "@shared/hotshots";

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
  key: string;
  label: string;
  subLabel?: string;
  color: string;
  eta: Date | null;
  etaText: string;
  isAtWarehouse: boolean;
  isStale: boolean;
  isHotShot?: boolean;
};

type ReturnEtaPanelProps = {
  vehicles: ReturnEtaVehicle[];
  warehouse: ReturnEtaWarehouse;
  hotShotRoutes?: HotShotRoute[];
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
  const windingFactor =
    straightLineMiles > 30 ? 1.17 : straightLineMiles > 12 ? 1.2 : 1.22;
  const roadMiles = straightLineMiles * windingFactor;
  const timestamp = new Date(vehicle.timestamp).getTime();
  const ageMinutes = Number.isFinite(timestamp)
    ? Math.max(0, (now.getTime() - timestamp) / 60000)
    : Infinity;
  const isStale = ageMinutes > STALE_LOCATION_MINUTES;
  const isAtWarehouse = roadMiles < 0.75;

  if (isAtWarehouse) {
    return {
      key: vehicle.id,
      label: vehicle.name || vehicle.id,
      color: vehicle.color || "#E59A23",
      eta: null,
      etaText: "—",
      isAtWarehouse,
      isStale,
    };
  }

  const averageSpeedMph =
    roadMiles > 35 ? 60 : roadMiles > 12 ? 54 : roadMiles > 3 ? 44 : 28;
  const minutes = Math.max(3, Math.round((roadMiles / averageSpeedMph) * 60));
  const eta = new Date(now.getTime() + minutes * 60000);

  return {
    key: vehicle.id,
    label: vehicle.name || vehicle.id,
    color: vehicle.color || "#E59A23",
    eta,
    etaText: formatCentralTime(eta),
    isAtWarehouse,
    isStale,
  };
}

export default function ReturnEtaPanel({
  vehicles,
  warehouse,
  hotShotRoutes,
}: ReturnEtaPanelProps) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const todayHotShots = getActiveTodayHotShots(hotShotRoutes, now);
  const panelHubKind = inferWarehouseHubKind(warehouse);
  const hubHotShots = todayHotShots.filter(
    (hs) => normalizeHotShotOriginHub(hs.originHub, hs.rawPdfDriver) === panelHubKind,
  );
  const isPastAfternoonCutoff = getCentralHour(now) >= RETURN_ETA_CUTOFF_HOUR;

  // Show all day when a Hot Shot run is active for this warehouse; otherwise wait until 3:00 PM CT for regular route trucks
  if (!isPastAfternoonCutoff && hubHotShots.length === 0) {
    return null;
  }

  const hotShotVehicleIds = new Set<string>();
  for (const hs of todayHotShots) {
    const anyVeh = vehicles.find(
      (v) =>
        (hs.vehicleId && v.id === hs.vehicleId) ||
        (hs.vehicleName && v.name === hs.vehicleName),
    );
    if (anyVeh) {
      hotShotVehicleIds.add(anyVeh.id);
    }
  }

  const hotShotEstimates: ReturnEstimate[] = [];

  for (const hs of hubHotShots) {
    const matchedVeh = vehicles.find(
      (v) =>
        (hs.vehicleId && v.id === hs.vehicleId) ||
        (hs.vehicleName && v.name === hs.vehicleName),
    );

    const timing = estimateHotShotTiming(hs, warehouse, matchedVeh || null, now);
    const isCompletedAtHub = timing.status === "completed";
    const vehTag = hs.vehicleName || matchedVeh?.name || "Hot Shot";

    hotShotEstimates.push({
      key: `hs-${hs.id}`,
      label: `${vehTag} • ${hs.driverName}`,
      subLabel: `${timing.completedCount}/${timing.totalCount} stops ✓ • ${timing.remainingRoadMiles || timing.totalLoopRoadMiles} mi`,
      color: hs.color || "#f59e0b",
      eta: timing.etaDate,
      etaText: timing.etaWindowLabel,
      isAtWarehouse: isCompletedAtHub,
      isStale: Boolean(matchedVeh && !timing.isLiveGpsTracking),
      isHotShot: true,
    });
  }

  const regularTruckEstimates = isPastAfternoonCutoff
    ? vehicles
        .filter(
          (vehicle) =>
            !vehicle.id.startsWith("asset-") &&
            vehicle.id !== "HOME" &&
            !hotShotVehicleIds.has(vehicle.id),
        )
        .map((vehicle) => estimateReturn(vehicle, warehouse, now))
    : [];

  const allEstimates = [...hotShotEstimates, ...regularTruckEstimates];
  const returnEstimates = allEstimates
    .filter((estimate) => !estimate.isAtWarehouse && (estimate.eta || estimate.isHotShot))
    .sort((a, b) => (a.eta?.getTime() || 0) - (b.eta?.getTime() || 0));
  const atWarehouseCount = allEstimates.filter((estimate) => estimate.isAtWarehouse).length;
  const staleCount = allEstimates.filter(
    (estimate) => !estimate.isAtWarehouse && estimate.isStale,
  ).length;
  const centralTime = formatCentralTime(now);

  return (
    <section className="absolute top-16 left-3 z-[1000] w-[min(22rem,calc(100vw-2rem))] max-h-[62vh] overflow-hidden rounded-sm border border-border bg-card/95 shadow-lg">
      <div className="flex items-start gap-2.5 border-b border-border bg-secondary/75 px-3.5 py-2.5">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-primary/15 border border-primary/35">
          <Clock3 className="h-3.5 w-3.5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-display text-xs font-bold uppercase tracking-wider text-primary">
            Warehouse Return ETA
          </p>
          <p className="truncate text-xs font-bold text-foreground">
            {warehouse.name}
          </p>
          <p className="mt-0.5 font-mono text-[10px] text-muted-foreground uppercase">
            EST. ROAD ARRIVAL · {centralTime} CT
          </p>
        </div>
        <Warehouse className="mt-1 h-4 w-4 shrink-0 text-primary" />
      </div>

      <div className="max-h-[42vh] overflow-y-auto p-2.5">
        {returnEstimates.length === 0 ? (
          <div className="px-3 py-4 text-center">
            <p className="text-xs font-bold uppercase font-mono text-foreground">No units away from hub</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Units out on routes or Hot Shots appear here with generous arrival estimates.
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {returnEstimates.map((estimate) => (
              <div
                key={estimate.key}
                className="rounded-sm border border-border bg-background/85 px-2.5 py-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span
                      className="h-3.5 w-1.5 shrink-0 rounded-[1px]"
                      style={{ backgroundColor: estimate.color }}
                    />
                    {estimate.isHotShot && (
                      <Zap className="h-3 w-3 shrink-0 text-amber-400 fill-amber-400/30" />
                    )}
                    <span className="truncate text-xs font-bold text-foreground">
                      {estimate.label}
                    </span>
                    {estimate.isStale && (
                      <span className="shrink-0 font-mono text-[9px] font-bold uppercase tracking-wide text-primary">
                        LAST GPS
                      </span>
                    )}
                  </div>
                  <span className="shrink-0 font-mono text-xs font-bold tabular-nums text-primary">
                    {estimate.etaText}
                  </span>
                </div>
                {estimate.subLabel && (
                  <div className="mt-0.5 pl-3 font-mono text-[10px] text-muted-foreground">
                    {estimate.subLabel}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border bg-secondary/45 px-3.5 py-2 font-mono text-[10px] text-muted-foreground uppercase">
        <span>
          <span className="font-bold text-foreground">{atWarehouseCount}</span>
          {" AT HUB"}
        </span>
        <span>
          <span className="font-bold text-primary">{staleCount}</span>
          {" STALE GPS"}
        </span>
      </div>
    </section>
  );
}
