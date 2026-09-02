import { useMemo, useState } from "react";
import { ChevronDown, MapPin, Truck } from "lucide-react";

type ActiveVehicle = {
  id: string;
  name?: string;
  color?: string;
  location: { lat: number; lon: number };
  speed: number;
  status: string;
  timestamp: string;
};

type Warehouse = {
  name: string;
  latitude: number;
  longitude: number;
};

type ReferenceLocation = Warehouse;

type ActiveVehiclesPanelProps = {
  vehicles: ActiveVehicle[];
  warehouse: Warehouse;
  locations: ReferenceLocation[];
};

const AT_WAREHOUSE_MILES = 0.75;

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

function formatDistance(miles: number): string {
  if (miles < 0.1) return "< 0.1 mi";
  if (miles < 10) return `${miles.toFixed(1)} mi`;
  return `${Math.round(miles)} mi`;
}

function formatLastUpdate(timestamp: string): string {
  const ageMinutes = Math.max(
    0,
    Math.round((Date.now() - new Date(timestamp).getTime()) / 60000),
  );

  if (!Number.isFinite(ageMinutes)) return "unknown update";
  if (ageMinutes < 1) return "updated just now";
  if (ageMinutes === 1) return "updated 1 min ago";
  if (ageMinutes < 60) return `updated ${ageMinutes} min ago`;

  const hours = Math.floor(ageMinutes / 60);
  return `updated ${hours}h ago`;
}

function statusLabel(status: string): string {
  return status.replace(/[_-]+/g, " ");
}

export default function ActiveVehiclesPanel({
  vehicles,
  warehouse,
  locations,
}: ActiveVehiclesPanelProps) {
  const [expanded, setExpanded] = useState(true);

  const referenceLocations = useMemo(() => {
    const allLocations = [warehouse, ...locations];
    return allLocations.filter(
      (location, index, all) =>
        all.findIndex(
          (candidate) =>
            candidate.name === location.name &&
            candidate.latitude === location.latitude &&
            candidate.longitude === location.longitude,
        ) === index,
    );
  }, [locations, warehouse]);

  const vehiclesAway = useMemo(
    () =>
      vehicles
        .map((vehicle) => ({
          vehicle,
          nearestLocation: referenceLocations.reduce(
            (nearest, location) => {
              const distance = distanceMiles(
                location.latitude,
                location.longitude,
                vehicle.location.lat,
                vehicle.location.lon,
              );
              return distance < nearest.distance
                ? { location, distance }
                : nearest;
            },
            {
              location: referenceLocations[0],
              distance: Number.POSITIVE_INFINITY,
            },
          ),
        }))
        .filter(({ nearestLocation }) => nearestLocation.distance >= AT_WAREHOUSE_MILES)
        .sort((a, b) => b.nearestLocation.distance - a.nearestLocation.distance),
    [referenceLocations, vehicles],
  );

  return (
    <section className="absolute top-16 right-4 z-[1000] w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-primary/25 bg-background/90 shadow-2xl backdrop-blur-md">
      <button
        type="button"
        className="flex w-full items-center gap-3 border-b border-border/70 px-4 py-3 text-left transition-colors hover:bg-primary/5"
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={expanded}
        aria-controls="dispatch-active-vehicles"
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15">
          <Truck className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary">
            Active vehicles
          </p>
          <p className="mt-0.5 truncate text-sm font-semibold">
            {vehiclesAway.length} outside saved locations
          </p>
        </div>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
            expanded ? "rotate-180" : ""
          }`}
        />
      </button>

      {expanded && (
        <div id="dispatch-active-vehicles" className="max-h-[60vh] overflow-y-auto p-3">
          {vehiclesAway.length === 0 ? (
            <div className="px-3 py-5 text-center">
              <MapPin className="mx-auto h-5 w-5 text-emerald-400" />
              <p className="mt-2 text-sm font-medium">All vehicles are at a saved location</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Trucks will appear here when they leave a warehouse or saved location.
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {vehiclesAway.map(({ vehicle, nearestLocation }) => (
                <div
                  key={vehicle.id}
                  className="rounded-lg border border-border/60 bg-background/55 px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: vehicle.color || "#3b82f6" }}
                      />
                      <span className="truncate text-sm font-semibold">
                        {vehicle.name || vehicle.id}
                      </span>
                    </div>
                    <span className="shrink-0 text-sm font-bold text-primary">
                      {formatDistance(nearestLocation.distance)}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between gap-3 text-[10px] uppercase tracking-wide text-muted-foreground">
                    <span className="min-w-0 truncate capitalize">
                      {statusLabel(vehicle.status)} · {nearestLocation.location.name}
                    </span>
                    <span>{formatLastUpdate(vehicle.timestamp)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}