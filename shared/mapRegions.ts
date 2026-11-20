export interface MapBoundingBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export type MapEtaHubMode = "auto" | "main" | "sf" | "none";

export interface SavedMapRegion {
  id: string;
  name: string;
  bounds: MapBoundingBox;
  etaHub?: MapEtaHubMode;
}

export interface BuiltinMapPreset {
  id: string;
  name: string;
  shortLabel: string;
  description: string;
  isAutoFit?: boolean;
  bounds?: MapBoundingBox;
  defaultEtaHub: "main" | "sf";
}

/** Wide multi-state Midwest fallback bounds when Auto-Fit has 0 vehicles reporting */
export const FULL_MIDWEST_OVERVIEW_BOUNDS: MapBoundingBox = {
  south: 41.2,
  west: -104.1,
  north: 47.5,
  east: -91.5,
};

/** Unlocked world/North America pan bounds so custom areas outside SD never hit an invisible wall */
export const UNLOCKED_NORTH_AMERICA_BOUNDS = {
  southwest: [22.0, -130.0] as [number, number],
  northeast: [55.0, -64.0] as [number, number],
};

export const BUILTIN_MAP_PRESETS: BuiltinMapPreset[] = [
  {
    id: "auto-fit",
    name: "Full Map — Auto-Fit All Active Fleet",
    shortLabel: "Full Fleet (Auto-Fit)",
    description: "Automatically zooms and pans to frame every active vehicle across all states.",
    isAutoFit: true,
    bounds: FULL_MIDWEST_OVERVIEW_BOUNDS,
    defaultEtaHub: "main",
  },
  {
    id: "corridor",
    name: "SD & SW MN Full Corridor (I-29 & I-90)",
    shortLabel: "SD/MN Corridor",
    description: "Full regional view covering Sioux Falls, Arlington, Aberdeen, Huron, Mitchell, and SW MN.",
    bounds: {
      south: 43.1,
      west: -99.6,
      north: 45.65,
      east: -95.25,
    },
    defaultEtaHub: "main",
  },
  {
    id: "sioux-falls",
    name: "Sioux Falls Metro & Surrounds",
    shortLabel: "Sioux Falls Metro",
    description: "Tight metro view of Sioux Falls, Brandon, Tea, Harrisburg, and I-29 / I-90 interchanges.",
    bounds: {
      south: 43.43,
      west: -96.96,
      north: 43.65,
      east: -96.55,
    },
    defaultEtaHub: "sf",
  },
  {
    id: "north-corridor",
    name: "North Corridor (Brookings • Watertown • Aberdeen)",
    shortLabel: "North (Aberdeen/Wtn)",
    description: "Northern US-14, US-81, I-29, and US-12 routes from Brookings/Arlington up to Aberdeen.",
    bounds: {
      south: 44.2,
      west: -98.75,
      north: 45.62,
      east: -96.55,
    },
    defaultEtaHub: "main",
  },
  {
    id: "west-corridor",
    name: "Central & West I-90 (Mitchell • Huron • Chamberlain)",
    shortLabel: "West (Huron/Mitchell)",
    description: "Western corridor covering Huron, Mitchell, Springs, and Chamberlain along I-90 & Hwy 37.",
    bounds: {
      south: 43.55,
      west: -99.55,
      north: 44.58,
      east: -97.1,
    },
    defaultEtaHub: "main",
  },
  {
    id: "mn-southwest",
    name: "SW Minnesota (Marshall • Pipestone • Sleepy Eye)",
    shortLabel: "SW Minnesota",
    description: "Eastern routes into Pipestone, Slayton, Marshall, Redwood Falls, and Sleepy Eye.",
    bounds: {
      south: 43.75,
      west: -96.55,
      north: 44.68,
      east: -94.55,
    },
    defaultEtaHub: "main",
  },
];

export function isValidMapBoundingBox(raw: unknown): raw is MapBoundingBox {
  if (!raw || typeof raw !== "object") return false;
  const b = raw as Record<string, unknown>;
  const south = Number(b.south);
  const west = Number(b.west);
  const north = Number(b.north);
  const east = Number(b.east);
  if (
    !Number.isFinite(south) ||
    !Number.isFinite(west) ||
    !Number.isFinite(north) ||
    !Number.isFinite(east)
  ) {
    return false;
  }
  return (
    south >= -85 &&
    north <= 85 &&
    south < north &&
    west >= -180 &&
    east <= 180 &&
    west < east
  );
}

export function normalizeMapBoundingBox(
  raw: unknown,
  fallback: MapBoundingBox = BUILTIN_MAP_PRESETS[1].bounds!,
): MapBoundingBox {
  if (!raw || typeof raw !== "object") return { ...fallback };
  const b = raw as Record<string, unknown>;
  const s = Number(b.south);
  const w = Number(b.west);
  const n = Number(b.north);
  const e = Number(b.east);
  if (!Number.isFinite(s) || !Number.isFinite(w) || !Number.isFinite(n) || !Number.isFinite(e)) {
    return { ...fallback };
  }
  const south = Math.max(-85, Math.min(84.9, Math.min(s, n)));
  const north = Math.min(85, Math.max(south + 0.01, Math.max(s, n)));
  const west = Math.max(-180, Math.min(179.9, Math.min(w, e)));
  const east = Math.min(180, Math.max(west + 0.01, Math.max(w, e)));
  return {
    south: Number(south.toFixed(5)),
    west: Number(west.toFixed(5)),
    north: Number(north.toFixed(5)),
    east: Number(east.toFixed(5)),
  };
}

export function normalizeSavedMapRegions(raw: unknown): SavedMapRegion[] {
  if (!Array.isArray(raw)) return [];
  const out: SavedMapRegion[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id.trim() : "";
    const name = typeof r.name === "string" ? r.name.trim() : "";
    if (!id || !name || seen.has(id) || !isValidMapBoundingBox(r.bounds)) continue;
    seen.add(id);
    const etaHub: MapEtaHubMode | undefined =
      r.etaHub === "main" || r.etaHub === "sf" || r.etaHub === "none" || r.etaHub === "auto"
        ? r.etaHub
        : undefined;
    out.push({
      id,
      name,
      bounds: normalizeMapBoundingBox(r.bounds),
      ...(etaHub ? { etaHub } : {}),
    });
  }
  return out;
}

export function getBoundsCenter(bounds: MapBoundingBox): [number, number] {
  return [
    Number(((bounds.south + bounds.north) / 2).toFixed(5)),
    Number(((bounds.west + bounds.east) / 2).toFixed(5)),
  ];
}

export function formatBoundsSummary(bounds: MapBoundingBox): string {
  const latSpanMiles = Math.round((bounds.north - bounds.south) * 69);
  const midLatRad = (((bounds.north + bounds.south) / 2) * Math.PI) / 180;
  const lonSpanMiles = Math.round((bounds.east - bounds.west) * 69 * Math.cos(midLatRad));
  return `${Math.max(1, lonSpanMiles)}×${Math.max(1, latSpanMiles)} mi (${bounds.south.toFixed(2)}°N, ${bounds.west.toFixed(2)}°W → ${bounds.north.toFixed(2)}°N, ${bounds.east.toFixed(2)}°W)`;
}

export interface ResolvedMapViewSpec {
  key: string;
  label: string;
  shortLabel: string;
  autoFitFleet: boolean;
  fitBounds: MapBoundingBox | null;
  center: [number, number];
  fallbackZoom: number;
  etaHub: "main" | "sf" | "none";
}

/**
 * Resolves a preset/region key (`"corridor"`, `"sioux-falls"`, `"auto-fit"`, `"custom"`, `"region:<id>"`, etc.)
 * into exact camera parameters for `<TrackingMap />`.
 */
export function resolveMapViewSpec(
  presetKey: string | undefined,
  customBounds?: MapBoundingBox | null,
  savedRegions?: SavedMapRegion[] | null,
  explicitEtaHub?: MapEtaHubMode,
): ResolvedMapViewSpec {
  const key = (presetKey || "corridor").trim();

  const resolveEta = (fallbackHub: "main" | "sf" | "none"): "main" | "sf" | "none" => {
    if (explicitEtaHub === "main" || explicitEtaHub === "sf" || explicitEtaHub === "none") {
      return explicitEtaHub;
    }
    return fallbackHub;
  };

  if (key.startsWith("region:")) {
    const regionId = key.slice("region:".length);
    const match = (savedRegions || []).find((r) => r.id === regionId);
    if (match) {
      const defaultHub =
        match.etaHub && match.etaHub !== "auto" ? match.etaHub : "main";
      return {
        key: `region:${match.id}`,
        label: match.name,
        shortLabel: match.name,
        autoFitFleet: false,
        fitBounds: match.bounds,
        center: getBoundsCenter(match.bounds),
        fallbackZoom: 9,
        etaHub: resolveEta(defaultHub),
      };
    }
  }

  if (key === "custom" && isValidMapBoundingBox(customBounds)) {
    const norm = normalizeMapBoundingBox(customBounds);
    return {
      key: "custom",
      label: "Custom Map Area",
      shortLabel: "Custom Area",
      autoFitFleet: false,
      fitBounds: norm,
      center: getBoundsCenter(norm),
      fallbackZoom: 9,
      etaHub: resolveEta("main"),
    };
  }

  const builtin =
    BUILTIN_MAP_PRESETS.find((p) => p.id === key) ||
    BUILTIN_MAP_PRESETS.find((p) => p.id === "corridor")!;

  if (builtin.isAutoFit) {
    return {
      key: builtin.id,
      label: builtin.name,
      shortLabel: builtin.shortLabel,
      autoFitFleet: true,
      fitBounds: null,
      center: [44.15, -97.1],
      fallbackZoom: 7,
      etaHub: resolveEta(builtin.defaultEtaHub),
    };
  }

  const b = builtin.bounds!;
  return {
    key: builtin.id,
    label: builtin.name,
    shortLabel: builtin.shortLabel,
    autoFitFleet: false,
    fitBounds: b,
    center: getBoundsCenter(b),
    fallbackZoom: builtin.id === "sioux-falls" ? 12 : 8,
    etaHub: resolveEta(builtin.defaultEtaHub),
  };
}
