import {
  type RouteStopPoint,
  type ResolvedRouteOverlay,
  computeRouteTerritoryPolygon,
} from "./routeTerritories";
import type { MapBoundingBox } from "./mapRegions";

export const HOTSHOT_CENTRAL_TZ = "America/Chicago";

/** Geofence radius in miles to auto-complete a Hot Shot stop via Motive GPS */
export const HOTSHOT_STOP_GEOFENCE_MILES = 2.0;

/** Town-center stops (without exact street coordinates) allow 3.5 mi to cover highway-strip dealerships */
export function getHotShotStopGeofenceMiles(stop?: {
  geocodePrecision?: "street" | "town" | "manual";
}): number {
  return stop?.geocodePrecision === "street" ? HOTSHOT_STOP_GEOFENCE_MILES : 3.5;
}

export const HOTSHOT_COLOR_PALETTE = [
  "#f59e0b", // Highway Amber
  "#ec4899", // Signal Magenta
  "#14b8a6", // Dispatch Teal
  "#a855f7", // Corridor Violet
  "#38bdf8", // Sky Blue
  "#fb7185", // Coral Rose
] as const;

export type HotShotOriginHub = "sioux_falls" | "arlington";

export const DEFAULT_HOTSHOT_HUBS: Record<
  HotShotOriginHub,
  {
    id: HotShotOriginHub;
    shortLabel: string;
    code: "SF" | "ARL";
    name: string;
    latitude: number;
    longitude: number;
  }
> = {
  sioux_falls: {
    id: "sioux_falls",
    shortLabel: "Sioux Falls",
    code: "SF",
    name: "Sioux Falls Warehouse",
    latitude: 43.5446,
    longitude: -96.7311,
  },
  arlington: {
    id: "arlington",
    shortLabel: "Arlington",
    code: "ARL",
    name: "Arlington Warehouse",
    latitude: 44.3792,
    longitude: -97.1406,
  },
};

export interface HotShotWarehousePair {
  sfWarehouse?: { name: string; latitude: number; longitude: number };
  mainWarehouse?: { name: string; latitude: number; longitude: number };
}

export function inferHotShotOriginHub(rawHint?: string | null): HotShotOriginHub {
  const s = String(rawHint || "").trim();
  if (/(?:^|\b)(?:arl|arlington)(?:\b|$)/i.test(s)) {
    return "arlington";
  }
  return "sioux_falls";
}

export function normalizeHotShotOriginHub(
  raw: unknown,
  fallbackHint?: string | null,
): HotShotOriginHub {
  if (typeof raw === "string") {
    const clean = raw.trim().toLowerCase();
    if (clean === "arlington" || clean === "arl" || clean === "main") {
      return "arlington";
    }
    if (clean === "sioux_falls" || clean === "sioux falls" || clean === "sf") {
      return "sioux_falls";
    }
  }
  return inferHotShotOriginHub(fallbackHint);
}

export function getHotShotHubMeta(originHub?: HotShotOriginHub | null) {
  return originHub === "arlington"
    ? DEFAULT_HOTSHOT_HUBS.arlington
    : DEFAULT_HOTSHOT_HUBS.sioux_falls;
}

export function resolveHotShotWarehouse(
  originHub: HotShotOriginHub | undefined | null,
  warehouses?: HotShotWarehousePair,
): { name: string; latitude: number; longitude: number } {
  if (originHub === "arlington") {
    return warehouses?.mainWarehouse || {
      name: DEFAULT_HOTSHOT_HUBS.arlington.name,
      latitude: DEFAULT_HOTSHOT_HUBS.arlington.latitude,
      longitude: DEFAULT_HOTSHOT_HUBS.arlington.longitude,
    };
  }
  return warehouses?.sfWarehouse || {
    name: DEFAULT_HOTSHOT_HUBS.sioux_falls.name,
    latitude: DEFAULT_HOTSHOT_HUBS.sioux_falls.latitude,
    longitude: DEFAULT_HOTSHOT_HUBS.sioux_falls.longitude,
  };
}

export function inferWarehouseHubKind(warehouse: {
  name?: string;
  latitude: number;
  longitude: number;
}): HotShotOriginHub {
  const label = String(warehouse?.name || "");
  if (/arlington/i.test(label)) return "arlington";
  if (/sioux\s*falls/i.test(label)) return "sioux_falls";
  return warehouse.latitude >= 44.05 ? "arlington" : "sioux_falls";
}

export interface HotShotPartLine {
  partNumber: string;
  orderedQty: number;
  pickedQty: number | null;
}

export interface HotShotStop {
  id: string;
  order: number;
  accountName: string;
  accountCode?: string;
  address: string;
  city: string;
  state: string;
  zip?: string;
  phone?: string;
  poNumber?: string;
  enteredBy?: string;
  orderedBy?: string;
  pickedBy?: string;
  receivedBy?: string;
  priority?: string;
  partsSummary?: string;
  parts?: HotShotPartLine[];
  piecesCount?: number;
  notes?: string;
  lat: number;
  lon: number;
  geocodePrecision?: "street" | "town" | "manual";
  completedAt?: string | null;
  completedBy?: "gps" | "manual" | null;
  externalDeliveryId?: number;
  externalSheetId?: number;
  createdAt?: string;
}

export interface HotShotOpenOrder {
  deliveryId: number;
  driverId: number;
  driverName: string;
  originHub: HotShotOriginHub;
  accountName: string;
  accountCode?: string;
  address: string;
  city: string;
  state: string;
  zip?: string;
  phone?: string;
  poNumber?: string;
  enteredBy?: string;
  orderedBy?: string;
  priority?: string;
  partsSummary?: string;
  piecesCount?: number;
  notes?: string;
  lat: number;
  lon: number;
  createdAt?: string;
}

export interface HotShotDeliveryAlert {
  id: string;
  kind: "tomorrow_sheet_stop" | "today_sheet_stop" | "open_order";
  deliveryId: number;
  deliveryDateISO: string;
  driverName: string;
  originHub: HotShotOriginHub;
  accountName: string;
  accountCode?: string;
  city: string;
  state: string;
  partsSummary?: string;
  piecesCount?: number;
  enteredBy?: string;
  poNumber?: string;
  notes?: string;
  timestamp: string;
}

export interface HotShotRoute {
  id: string;
  /** Target delivery date in Central Time: "YYYY-MM-DD" */
  deliveryDateISO: string;
  /** Origination & return warehouse hub ("sioux_falls" | "arlington") */
  originHub?: HotShotOriginHub;
  /** Assigned Hot Shot driver (any SF employee or off-schedule company employee) */
  driverName: string;
  /** Raw driver string extracted from HotShotSheet PDF header (e.g. "SF Matt") */
  rawPdfDriver?: string;
  /** Assigned Motive vehicle ID (e.g. "asset-946502") — optional if keys not grabbed yet */
  vehicleId?: string;
  /** Human-readable vehicle name (e.g. "Van GO - SF") */
  vehicleName?: string;
  /** How the vehicle was linked: manual human pick vs automatic GPS route matching */
  vehicleAssignedBy?: "manual" | "auto_gps" | null;
  /** Confidence 0-99 when auto-matched via GPS history */
  autoMatchConfidence?: number | null;
  /** Short explanation of why GPS history selected this van */
  autoMatchReason?: string | null;
  /** Accent hex color for map corridor & badges */
  color: string;
  /** Planned departure time in Central Time "HH:MM" (defaults to "08:00") */
  departureTimeHHMM?: string;
  /** Auto-stamped ISO time when assigned van departs >1.2 mi from warehouse */
  departedAt?: string | null;
  /** Auto-stamped ISO time when assigned van returns to warehouse after completing stops */
  returnedAt?: string | null;
  /** Optional custom route label */
  title?: string;
  /** Original uploaded PDF filename */
  sourceFileName?: string;
  /** Source of route ("api" | "pdf" | "manual") */
  sourceType?: "api" | "pdf" | "manual";
  externalDriverId?: number;
  externalSheetNum?: number;
  lastSyncedAt?: string;
  /** True when a dispatcher manually reordered or applied 2-Opt sequence in the tracker */
  customStopOrder?: boolean;
  active: boolean;
  stops: HotShotStop[];
  createdAt: string;
  updatedAt: string;
}

export interface HotShotTimingEstimate {
  status: "planned" | "en_route" | "returning" | "completed";
  statusLabel: string;
  totalLoopRoadMiles: number;
  remainingRoadMiles: number;
  estimatedTotalDurationLabel: string;
  /** Generous arrival Date (used for ReturnEtaPanel sorting & display) */
  etaDate: Date | null;
  /** Friendly generous window e.g. "~2:30 – 3:00 PM" */
  etaWindowLabel: string;
  /** Single generous time e.g. "~2:45 PM" */
  etaShortLabel: string;
  completedCount: number;
  totalCount: number;
  remainingStopsCount: number;
  isLiveGpsTracking: boolean;
  isAwayFromWarehouse: boolean;
}

/** Returns "YYYY-MM-DD" in America/Chicago Central Time */
export function getCentralDateISO(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: HOTSHOT_CENTRAL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const y = parts.find((p) => p.type === "year")?.value || String(now.getFullYear());
  const m = parts.find((p) => p.type === "month")?.value || "01";
  const d = parts.find((p) => p.type === "day")?.value || "01";
  return `${y}-${m}-${d}`;
}

export function formatCentralClockTime(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: HOTSHOT_CENTRAL_TZ,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

/** Converts "11/03/26", "11/3/2026", or "2026-11-03" -> "YYYY-MM-DD" */
export function parseHotShotDateToISO(raw: string | undefined | null, fallbackNow = new Date()): string {
  const clean = String(raw || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;

  const slash = clean.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slash) {
    const month = Number(slash[1]);
    const day = Number(slash[2]);
    let year = Number(slash[3]);
    if (year < 100) year += 2000;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  return getCentralDateISO(fallbackNow);
}

/** Converts "YYYY-MM-DD" -> "11/3/2026" (matching ScheduleDayHeader.date format) */
export function isoToScheduleDateString(iso: string): string {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${Number(m[2])}/${Number(m[3])}/${Number(m[1])}`;
}

export function formatHotShotDateHuman(iso: string): string {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
  return dt.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
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

const COMMON_NICKNAME_GROUPS: string[][] = [
  ["matt", "matthew"],
  ["mike", "mikey", "michael"],
  ["dan", "daniel", "danny"],
  ["jon", "jonathan", "john"],
  ["nate", "nathan", "nathaniel"],
  ["dave", "david"],
  ["chris", "christopher"],
  ["josh", "joshua"],
  ["jake", "jacob"],
  ["jabone", "jason"],
  ["nick", "nicholas"],
  ["ron", "ronald"],
  ["tom", "thomas"],
  ["ben", "benjamin"],
];

export function stripLocationPrefix(raw: string): string {
  return String(raw || "")
    .trim()
    .replace(/^(?:sf|sioux\s+falls|arl|arlington|hs|hot\s*shot)\s*[-:•]?\s+/i, "")
    .replace(/\s*[-–]\s*(?:sf|arl)$/i, "")
    .trim();
}

function areFirstNamesEquivalent(a: string, b: string): boolean {
  const al = a.toLowerCase();
  const bl = b.toLowerCase();
  if (!al || !bl) return false;
  if (al === bl) return true;
  if (al.length >= 3 && bl.startsWith(al)) return true;
  if (bl.length >= 3 && al.startsWith(bl)) return true;
  return COMMON_NICKNAME_GROUPS.some((grp) => grp.includes(al) && grp.includes(bl));
}

/**
 * Matches a raw PDF driver hint (e.g. "SF Matt") to an employee on the SF Schedule roster if possible.
 * If the person is an off-schedule employee, returns the cleaned driver string so any employee works!
 */
export function matchHotShotDriverToRoster(
  rawPdfDriver: string | undefined | null,
  rosterNames: string[],
): string {
  const raw = String(rawPdfDriver || "").trim();
  if (!raw) return "";
  const cleaned = stripLocationPrefix(raw);
  if (!cleaned) return raw;

  const cleanLower = cleaned.toLowerCase();

  // 1. Exact full name match
  const exact = rosterNames.find((n) => n.trim().toLowerCase() === cleanLower);
  if (exact) return exact;

  // 2. First + Last initial or nickname match against roster
  const tokens = cleanLower.split(/\s+/).filter(Boolean);
  const firstTok = tokens[0] || "";
  const secondTok = tokens[1] || "";

  const candidates = rosterNames.filter((full) => {
    const parts = full.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const rFirst = parts[0] || "";
    const rLast = parts.slice(1).join(" ");
    if (!areFirstNamesEquivalent(firstTok, rFirst)) return false;
    if (!secondTok) return true;
    return rLast.startsWith(secondTok) || secondTok.startsWith(rLast);
  });

  if (candidates.length === 1) {
    return candidates[0];
  }

  return cleaned;
}

/**
 * Checks whether an assigned Hot Shot driver corresponds to a specific SF Schedule row member
 * so we can display the ⚡ lightning bolt next to their name on that day's SF schedule.
 */
export function doesHotShotDriverMatchMember(
  hotShotDriverName: string | undefined | null,
  sfMemberName: string | undefined | null,
  originHub?: HotShotOriginHub | null,
): boolean {
  if (originHub === "arlington") return false;
  const hsClean = stripLocationPrefix(String(hotShotDriverName || "")).toLowerCase();
  const sfClean = stripLocationPrefix(String(sfMemberName || "")).toLowerCase();
  if (!hsClean || !sfClean) return false;
  if (hsClean === sfClean) return true;

  const hsParts = hsClean.split(/\s+/).filter(Boolean);
  const sfParts = sfClean.split(/\s+/).filter(Boolean);
  if (hsParts.length === 0 || sfParts.length === 0) return false;

  // If Hot Shot has a last name, require last name prefix match too
  if (hsParts.length >= 2 && sfParts.length >= 2) {
    const lastMatch =
      sfParts[sfParts.length - 1].startsWith(hsParts[hsParts.length - 1]) ||
      hsParts[hsParts.length - 1].startsWith(sfParts[sfParts.length - 1]);
    return lastMatch && areFirstNamesEquivalent(hsParts[0], sfParts[0]);
  }

  // Single-token Hot Shot driver (e.g. "Matt" or "SF Matt") matches first name
  if (hsParts.length === 1) {
    return areFirstNamesEquivalent(hsParts[0], sfParts[0]);
  }

  return false;
}

export function buildHotShotTownSequenceLabel(stops: HotShotStop[], maxTowns = 6): string {
  const uniqueTowns: string[] = [];
  for (const s of stops || []) {
    const city = String(s.city || "").trim();
    if (!city) continue;
    const prev = uniqueTowns[uniqueTowns.length - 1];
    if (!prev || prev.toLowerCase() !== city.toLowerCase()) {
      uniqueTowns.push(city);
    }
  }
  if (uniqueTowns.length === 0) return "Out-of-Town Hot Shot";
  if (uniqueTowns.length <= maxTowns) return uniqueTowns.join(" → ");
  return `${uniqueTowns.slice(0, maxTowns).join(" → ")} +${uniqueTowns.length - maxTowns}`;
}

export function normalizeHotShotStop(
  raw: any,
  index: number,
  originHub: HotShotOriginHub = "sioux_falls",
): HotShotStop {
  const lat = Number(raw?.lat);
  const lon = Number(raw?.lon);
  const fallbackHub = getHotShotHubMeta(originHub);
  return {
    id: String(raw?.id || `hs-stop-${index + 1}`),
    order: Number.isFinite(Number(raw?.order)) ? Number(raw.order) : index + 1,
    accountName: String(raw?.accountName || "Customer Stop").trim(),
    ...(raw?.accountCode ? { accountCode: String(raw.accountCode).trim() } : {}),
    address: String(raw?.address || "").trim(),
    city: String(raw?.city || "").trim(),
    state: String(raw?.state || "SD").trim().toUpperCase(),
    ...(raw?.zip ? { zip: String(raw.zip).trim() } : {}),
    ...(raw?.phone ? { phone: String(raw.phone).trim() } : {}),
    ...(raw?.poNumber ? { poNumber: String(raw.poNumber).trim() } : {}),
    ...(raw?.enteredBy ? { enteredBy: String(raw.enteredBy).trim() } : {}),
    ...(raw?.orderedBy ? { orderedBy: String(raw.orderedBy).trim() } : {}),
    ...(raw?.pickedBy ? { pickedBy: String(raw.pickedBy).trim() } : {}),
    ...(raw?.receivedBy ? { receivedBy: String(raw.receivedBy).trim() } : {}),
    ...(raw?.priority ? { priority: String(raw.priority).trim() } : {}),
    ...(raw?.partsSummary ? { partsSummary: String(raw.partsSummary).trim() } : {}),
    ...(Array.isArray(raw?.parts) && raw.parts.length > 0
      ? {
          parts: raw.parts.map((p: any) => ({
            partNumber: String(p?.partNumber || "Part").trim(),
            orderedQty: Number(p?.orderedQty) || 0,
            pickedQty:
              p?.pickedQty !== null &&
              p?.pickedQty !== undefined &&
              Number.isFinite(Number(p.pickedQty))
                ? Number(p.pickedQty)
                : null,
          })),
        }
      : {}),
    ...(Number.isFinite(Number(raw?.piecesCount)) && Number(raw.piecesCount) > 0
      ? { piecesCount: Math.round(Number(raw.piecesCount)) }
      : {}),
    ...(raw?.notes ? { notes: String(raw.notes).trim() } : {}),
    lat: Number.isFinite(lat) ? lat : fallbackHub.latitude,
    lon: Number.isFinite(lon) ? lon : fallbackHub.longitude,
    geocodePrecision:
      raw?.geocodePrecision === "street" || raw?.geocodePrecision === "manual"
        ? raw.geocodePrecision
        : "town",
    completedAt: raw?.completedAt ? String(raw.completedAt) : null,
    completedBy:
      raw?.completedBy === "gps" || raw?.completedBy === "manual" ? raw.completedBy : null,
    ...(Number.isFinite(Number(raw?.externalDeliveryId))
      ? { externalDeliveryId: Number(raw.externalDeliveryId) }
      : {}),
    ...(Number.isFinite(Number(raw?.externalSheetId))
      ? { externalSheetId: Number(raw.externalSheetId) }
      : {}),
    ...(raw?.createdAt ? { createdAt: String(raw.createdAt) } : {}),
  };
}

export function normalizeHotShotRoute(raw: any, index = 0): HotShotRoute {
  const nowIso = new Date().toISOString();
  const originHub = normalizeHotShotOriginHub(
    raw?.originHub,
    raw?.rawPdfDriver || raw?.driverName,
  );
  const stops = Array.isArray(raw?.stops)
    ? raw.stops.map((s: any, i: number) => normalizeHotShotStop(s, i, originHub))
    : [];
  stops.sort((a: HotShotStop, b: HotShotStop) => a.order - b.order);
  stops.forEach((s: HotShotStop, idx: number) => {
    s.order = idx + 1;
  });

  const paletteColor = HOTSHOT_COLOR_PALETTE[index % HOTSHOT_COLOR_PALETTE.length];
  return {
    id: String(raw?.id || `hotshot-${Date.now()}-${index}`),
    deliveryDateISO: parseHotShotDateToISO(raw?.deliveryDateISO),
    originHub,
    driverName: String(raw?.driverName || "TBD Driver").trim() || "TBD Driver",
    ...(raw?.rawPdfDriver ? { rawPdfDriver: String(raw.rawPdfDriver).trim() } : {}),
    vehicleId: raw?.vehicleId ? String(raw.vehicleId).trim() : "",
    vehicleName: raw?.vehicleName ? String(raw.vehicleName).trim() : "",
    vehicleAssignedBy:
      raw?.vehicleAssignedBy === "manual" || raw?.vehicleAssignedBy === "auto_gps"
        ? raw.vehicleAssignedBy
        : raw?.vehicleId
          ? "manual"
          : null,
    autoMatchConfidence:
      Number.isFinite(Number(raw?.autoMatchConfidence)) && Number(raw?.autoMatchConfidence) > 0
        ? Math.min(99, Math.max(1, Math.round(Number(raw.autoMatchConfidence))))
        : null,
    autoMatchReason: raw?.autoMatchReason ? String(raw.autoMatchReason).trim() : null,
    color:
      typeof raw?.color === "string" && raw.color.trim().startsWith("#")
        ? raw.color.trim()
        : paletteColor,
    departureTimeHHMM:
      typeof raw?.departureTimeHHMM === "string" && /^\d{2}:\d{2}$/.test(raw.departureTimeHHMM)
        ? raw.departureTimeHHMM
        : "08:00",
    departedAt: raw?.departedAt ? String(raw.departedAt) : null,
    returnedAt: raw?.returnedAt ? String(raw.returnedAt) : null,
    title: raw?.title ? String(raw.title).trim() : buildHotShotTownSequenceLabel(stops, 5),
    ...(raw?.sourceFileName ? { sourceFileName: String(raw.sourceFileName).trim() } : {}),
    ...(raw?.sourceType === "api" || raw?.sourceType === "pdf" || raw?.sourceType === "manual"
      ? { sourceType: raw.sourceType }
      : {}),
    ...(Number.isFinite(Number(raw?.externalDriverId))
      ? { externalDriverId: Number(raw.externalDriverId) }
      : {}),
    ...(Number.isFinite(Number(raw?.externalSheetNum))
      ? { externalSheetNum: Number(raw.externalSheetNum) }
      : {}),
    ...(raw?.lastSyncedAt ? { lastSyncedAt: String(raw.lastSyncedAt) } : {}),
    ...(raw?.customStopOrder ? { customStopOrder: true } : {}),
    active: raw?.active !== false,
    stops,
    createdAt: raw?.createdAt ? String(raw.createdAt) : nowIso,
    updatedAt: raw?.updatedAt ? String(raw.updatedAt) : nowIso,
  };
}

export function normalizeHotShotRoutes(rawList: unknown): HotShotRoute[] {
  if (!Array.isArray(rawList)) return [];
  return rawList
    .filter((item) => item && typeof item === "object")
    .map((item, idx) => normalizeHotShotRoute(item, idx));
}

export function getActiveHotShotsForDate(
  routes: HotShotRoute[] | undefined | null,
  dateISO: string,
): HotShotRoute[] {
  if (!Array.isArray(routes) || !dateISO) return [];
  return routes.filter((r) => r.active !== false && r.deliveryDateISO === dateISO);
}

export function getActiveTodayHotShots(
  routes: HotShotRoute[] | undefined | null,
  now = new Date(),
): HotShotRoute[] {
  return getActiveHotShotsForDate(routes, getCentralDateISO(now));
}

/** Matches ScheduleDayHeader.date ("11/3/2026" or "11/03/2026") to Hot Shot routes for that day */
export function getHotShotsForScheduleHeaderDate(
  routes: HotShotRoute[] | undefined | null,
  headerDateStr: string | undefined,
): HotShotRoute[] {
  if (!Array.isArray(routes) || !headerDateStr) return [];
  const iso = parseHotShotDateToISO(headerDateStr);
  if (!iso) return [];
  return routes.filter((r) => r.active !== false && r.deliveryDateISO === iso);
}

function legDriveMinutesGenerous(lat1: number, lon1: number, lat2: number, lon2: number): {
  roadMiles: number;
  minutes: number;
} {
  const straight = haversineMiles(lat1, lon1, lat2, lon2);
  if (straight < 0.15) {
    return { roadMiles: straight * 1.15, minutes: 1 };
  }

  // Calibrated SD/MN/IA highway & county-grid road factor (1.17x on highway corridors, 1.22x local)
  const windingFactor = straight > 30 ? 1.17 : straight > 12 ? 1.2 : 1.22;
  const roadMiles = straight * windingFactor;

  if (roadMiles < 0.5) {
    return { roadMiles, minutes: 1.5 };
  }

  // Calibrated Midwest speeds (I-90 / I-29 / US-14 / US-81 / MN-60 / IA-60):
  // - Long highway legs (>35 road mi): ~60 mph effective door-to-door
  // - Regional legs (12–35 road mi): ~54 mph effective
  // - Short town-to-town (3–12 road mi): ~44 mph effective
  // - In-town hop (<3 road mi): ~28 mph effective
  const speedMph =
    roadMiles > 35 ? 60 : roadMiles > 12 ? 54 : roadMiles > 3 ? 44 : 28;

  return {
    roadMiles,
    minutes: (roadMiles / speedMph) * 60,
  };
}

/**
 * Estimates realistic on-site stop dwell time in minutes:
 * - Consecutive PO at the exact same dealer/location (<0.15 mi): 2 mins (already parked)
 * - "DRIVE BY" check-in: 1 min
 * - Standard delivery: 7 mins base + 0.35 min per battery piece (capped at 16 mins)
 */
function estimateStopDwellMinutes(
  stop: HotShotStop,
  prevStop?: HotShotStop | null,
): number {
  const summaryUpper = String(stop.partsSummary || "").toUpperCase();
  if (summaryUpper.includes("DRIVE BY") && (stop.piecesCount || 0) <= 1) {
    return 1.5;
  }

  if (prevStop) {
    const sameAccount =
      (stop.accountCode &&
        prevStop.accountCode &&
        stop.accountCode === prevStop.accountCode) ||
      stop.accountName.trim().toLowerCase() === prevStop.accountName.trim().toLowerCase();
    const distFromPrev = haversineMiles(prevStop.lat, prevStop.lon, stop.lat, stop.lon);
    if (sameAccount || distFromPrev < 0.12) {
      return 2;
    }
  }

  const pcs = Math.max(1, Number(stop.piecesCount) || 2);
  return Math.min(16, 7 + pcs * 0.35);
}

function roundToNearestMinutes(d: Date, stepMin: number): Date {
  const ms = stepMin * 60_000;
  return new Date(Math.round(d.getTime() / ms) * ms);
}

function buildCentralDepartureDate(deliveryDateISO: string, hhmm = "08:00", fallbackNow = new Date()): Date {
  const m = String(deliveryDateISO || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const [hhRaw, mmRaw] = String(hhmm || "08:00").split(":");
  const hh = Number.isFinite(Number(hhRaw)) ? Number(hhRaw) : 8;
  const mm = Number.isFinite(Number(mmRaw)) ? Number(mmRaw) : 0;
  if (!m) return fallbackNow;

  const candidate = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hh, mm, 0);
  return candidate;
}

function formatDurationGenerous(lowMin: number, highMin: number): string {
  const avg = Math.max(5, Math.round((lowMin + highMin) / 2 / 5) * 5);
  const h = Math.floor(avg / 60);
  const m = avg % 60;
  if (h === 0) return `~${m}m`;
  if (m === 0) return `~${h}h`;
  return `~${h}h ${m}m`;
}

/**
 * Calibrated precision warehouse return & route duration estimator:
 * - 1.17x–1.22x SD/MN/IA highway & grid road multiplier
 * - Realistic 60 / 54 / 44 / 28 mph highway & town speed tiers
 * - Smart per-stop dwell time (7–16 mins based on piece count; 2 mins for duplicate PO at same dealer)
 * - Live GPS position & speed awareness when van is en route
 */
export function estimateHotShotTiming(
  route: HotShotRoute,
  warehouse: { latitude: number; longitude: number; name?: string },
  liveVehicle?: {
    location: { lat: number; lon: number };
    speed?: number;
    status?: string;
    timestamp?: string;
  } | null,
  now = new Date(),
): HotShotTimingEstimate {
  const stops = route.stops || [];
  const totalCount = stops.length;
  const uncompletedStops = stops.filter((s) => !s.completedAt);
  const completedCount = totalCount - uncompletedStops.length;

  // 1. Always compute full planned loop mileage (Warehouse -> all stops -> Warehouse)
  let fullLoopMiles = 0;
  if (stops.length > 0) {
    let prevLat = warehouse.latitude;
    let prevLon = warehouse.longitude;
    for (const s of stops) {
      fullLoopMiles += legDriveMinutesGenerous(prevLat, prevLon, s.lat, s.lon).roadMiles;
      prevLat = s.lat;
      prevLon = s.lon;
    }
    fullLoopMiles += legDriveMinutesGenerous(prevLat, prevLon, warehouse.latitude, warehouse.longitude).roadMiles;
  }

  // Check live GPS freshness (within 45 mins) and distance from warehouse
  let isLiveGpsTracking = false;
  let isAwayFromWarehouse = false;
  if (liveVehicle && liveVehicle.location) {
    const ts = liveVehicle.timestamp ? new Date(liveVehicle.timestamp).getTime() : now.getTime();
    const ageMin = Number.isFinite(ts) ? (now.getTime() - ts) / 60_000 : 999;
    if (ageMin <= 45) {
      isLiveGpsTracking = true;
      const distFromHubRoad =
        haversineMiles(
          warehouse.latitude,
          warehouse.longitude,
          liveVehicle.location.lat,
          liveVehicle.location.lon,
        ) * 1.2;
      isAwayFromWarehouse = distFromHubRoad >= 0.85;
    }
  }

  const isToday = route.deliveryDateISO === getCentralDateISO(now);

  // Completed & returned to hub
  if (
    totalCount > 0 &&
    uncompletedStops.length === 0 &&
    (Boolean(route.returnedAt) || (Boolean(route.departedAt) && isLiveGpsTracking && !isAwayFromWarehouse))
  ) {
    return {
      status: "completed",
      statusLabel: "Route Complete • At Hub",
      totalLoopRoadMiles: Math.round(fullLoopMiles),
      remainingRoadMiles: 0,
      estimatedTotalDurationLabel: "Completed",
      etaDate: null,
      etaWindowLabel: "Returned ✓",
      etaShortLabel: "Back ✓",
      completedCount,
      totalCount,
      remainingStopsCount: 0,
      isLiveGpsTracking,
      isAwayFromWarehouse: false,
    };
  }

  // All stops completed, currently driving back to warehouse
  if (totalCount > 0 && uncompletedStops.length === 0 && isToday && isAwayFromWarehouse && liveVehicle) {
    const homeLeg = legDriveMinutesGenerous(
      liveVehicle.location.lat,
      liveVehicle.location.lon,
      warehouse.latitude,
      warehouse.longitude,
    );
    // Blend live highway speed if vehicle is actively moving > 35 mph
    const liveSpeed = Number(liveVehicle.speed) || 0;
    const driveMins =
      liveSpeed > 35
        ? (homeLeg.roadMiles / ((liveSpeed * 0.45) + 32)) * 60
        : homeLeg.minutes;

    const exactDate = roundToNearestMinutes(new Date(now.getTime() + driveMins * 60_000), 5);
    const lowDate = roundToNearestMinutes(
      new Date(now.getTime() + Math.max(3, driveMins - 4) * 60_000),
      5,
    );
    const highDate = roundToNearestMinutes(
      new Date(now.getTime() + (driveMins + 6) * 60_000),
      5,
    );
    const lowStr = formatCentralClockTime(lowDate);
    const highStr = formatCentralClockTime(highDate);
    const exactStr = formatCentralClockTime(exactDate);

    return {
      status: "returning",
      statusLabel: "All Stops Done • Returning",
      totalLoopRoadMiles: Math.round(fullLoopMiles),
      remainingRoadMiles: Math.max(1, Math.round(homeLeg.roadMiles)),
      estimatedTotalDurationLabel: formatDurationGenerous(driveMins, driveMins),
      etaDate: exactDate,
      etaWindowLabel: lowStr === highStr ? `~${exactStr}` : `${lowStr} – ${highStr}`,
      etaShortLabel: `~${exactStr}`,
      completedCount,
      totalCount,
      remainingStopsCount: 0,
      isLiveGpsTracking,
      isAwayFromWarehouse: true,
    };
  }

  // Stops remaining (either Live En-Route today OR Planned schedule)
  const useLiveOrigin = isToday && isAwayFromWarehouse && Boolean(liveVehicle);

  // Determine starting coordinates and anchor timestamp
  let curLat = warehouse.latitude;
  let curLon = warehouse.longitude;
  let anchorTime = buildCentralDepartureDate(
    route.deliveryDateISO,
    route.departureTimeHHMM || "08:00",
    now,
  );
  let targetStops: HotShotStop[] = stops;

  if (useLiveOrigin && liveVehicle) {
    curLat = liveVehicle.location.lat;
    curLon = liveVehicle.location.lon;
    anchorTime = now;
    targetStops = uncompletedStops.length > 0 ? uncompletedStops : stops;
  } else if (completedCount > 0 && uncompletedStops.length > 0) {
    // Some stops were already marked completed: anchor from the most recently completed stop
    const completedStops = stops.filter((s) => Boolean(s.completedAt));
    const lastCompleted = completedStops[completedStops.length - 1];
    const lastDoneMs = lastCompleted?.completedAt
      ? new Date(lastCompleted.completedAt).getTime()
      : NaN;
    if (lastCompleted && Number.isFinite(lastDoneMs)) {
      curLat = lastCompleted.lat;
      curLon = lastCompleted.lon;
      anchorTime = new Date(lastDoneMs);
      targetStops = uncompletedStops;
    }
  } else if (route.departedAt) {
    const depMs = new Date(route.departedAt).getTime();
    if (Number.isFinite(depMs)) {
      anchorTime = new Date(depMs);
    }
  }

  let driveMinutes = 0;
  let remainingRoadMiles = 0;
  let stopBufferMinutes = 0;
  let prevStop: HotShotStop | null = null;

  for (const s of targetStops) {
    const leg = legDriveMinutesGenerous(curLat, curLon, s.lat, s.lon);
    driveMinutes += leg.minutes;
    remainingRoadMiles += leg.roadMiles;
    stopBufferMinutes += estimateStopDwellMinutes(s, prevStop);
    curLat = s.lat;
    curLon = s.lon;
    prevStop = s;
  }
  if (targetStops.length > 0) {
    const backLeg = legDriveMinutesGenerous(curLat, curLon, warehouse.latitude, warehouse.longitude);
    driveMinutes += backLeg.minutes;
    remainingRoadMiles += backLeg.roadMiles;
  }

  const expectedRemainingMinutes = driveMinutes + stopBufferMinutes;

  // Guard for active Today routes without live GPS: never display a Return ETA that is already in the past
  if (
    isToday &&
    !useLiveOrigin &&
    anchorTime.getTime() + expectedRemainingMinutes * 60_000 < now.getTime() + 15 * 60_000
  ) {
    const lastStop = targetStops[targetStops.length - 1];
    const minReturnMins = lastStop
      ? Math.max(
          20,
          legDriveMinutesGenerous(
            lastStop.lat,
            lastStop.lon,
            warehouse.latitude,
            warehouse.longitude,
          ).minutes + 10,
        )
      : 25;
    anchorTime = new Date(
      now.getTime() - Math.max(0, expectedRemainingMinutes - minReturnMins) * 60_000,
    );
  }

  const lowTotalMin = Math.max(10, expectedRemainingMinutes - 6);
  const highTotalMin = Math.max(15, expectedRemainingMinutes + 8);

  const exactEta = roundToNearestMinutes(
    new Date(anchorTime.getTime() + expectedRemainingMinutes * 60_000),
    5,
  );
  const etaLow = roundToNearestMinutes(
    new Date(anchorTime.getTime() + lowTotalMin * 60_000),
    5,
  );
  const etaHigh = roundToNearestMinutes(
    new Date(anchorTime.getTime() + highTotalMin * 60_000),
    5,
  );
  const lowStr = formatCentralClockTime(etaLow);
  const highStr = formatCentralClockTime(etaHigh);
  const exactStr = formatCentralClockTime(exactEta);

  const inProgress = useLiveOrigin || completedCount > 0 || Boolean(route.departedAt);

  return {
    status: inProgress ? "en_route" : "planned",
    statusLabel: inProgress
      ? `En Route (${completedCount}/${totalCount} Done)`
      : isToday
        ? `Scheduled Today (${route.departureTimeHHMM || "08:00"})`
        : `Scheduled ${formatHotShotDateHuman(route.deliveryDateISO)}`,
    totalLoopRoadMiles: Math.round(fullLoopMiles),
    remainingRoadMiles: Math.round(remainingRoadMiles),
    estimatedTotalDurationLabel: formatDurationGenerous(
      expectedRemainingMinutes,
      expectedRemainingMinutes,
    ),
    etaDate: exactEta,
    etaWindowLabel: lowStr === highStr ? `~${exactStr}` : `${lowStr} – ${highStr}`,
    etaShortLabel: `~${exactStr}`,
    completedCount,
    totalCount,
    remainingStopsCount: uncompletedStops.length,
    isLiveGpsTracking,
    isAwayFromWarehouse,
  };
}

/**
 * Converts active HotShotRoutes into ResolvedRouteOverlays so TrackingMap renders
 * the numbered corridor + emerald-green completed checkmarks.
 */
export function buildHotShotRouteOverlays(
  hotShots: HotShotRoute[] | undefined | null,
  warehouses?: HotShotWarehousePair,
): ResolvedRouteOverlay[] {
  if (!Array.isArray(hotShots) || hotShots.length === 0) return [];
  return hotShots
    .filter((hs) => hs.active !== false && Array.isArray(hs.stops) && hs.stops.length > 0)
    .map((hs) => {
      const hubMeta = getHotShotHubMeta(hs.originHub);
      const hubLoc = resolveHotShotWarehouse(hs.originHub, warehouses);
      const stopPoints: RouteStopPoint[] = hs.stops.map((s, idx) => ({
        name: s.city || s.accountName,
        state: s.state || "SD",
        lat: s.lat,
        lon: s.lon,
        anchor: idx === hs.stops.length - 1,
        completed: Boolean(s.completedAt),
        completedAt: s.completedAt || null,
        accountName: s.accountName,
        address: s.address,
        piecesCount: s.piecesCount,
        notes: s.notes,
        stopOrder: idx + 1,
      }));
      const { polygon, centroid } = computeRouteTerritoryPolygon(stopPoints);
      const vehSuffix = hs.vehicleName ? ` (${hs.vehicleName})` : "";
      return {
        id: hs.id,
        name: `⚡ [${hubMeta.code}] ${hs.title || buildHotShotTownSequenceLabel(hs.stops, 4)}`,
        truckGroup: `Hot Shot • ${hubMeta.shortLabel}${vehSuffix}`,
        assignedDriver: `⚡ ${hs.driverName}${vehSuffix}`,
        scheduleCellText: `HOT SHOT • ${hubMeta.code}`,
        color: hs.color || "#f59e0b",
        stops: stopPoints,
        polygon,
        centroid,
        isHotShot: true,
        originLocation: {
          name: hubLoc.name,
          lat: hubLoc.latitude,
          lon: hubLoc.longitude,
        },
      };
    });
}

/**
 * Computes a clean padded MapBoundingBox framing the warehouse + all Hot Shot stops + assigned live vans.
 */
export function computeHotShotMapBounds(
  hotShots: HotShotRoute[],
  warehouse: { latitude: number; longitude: number },
  liveVehicles: Array<{ id: string; name?: string; location: { lat: number; lon: number } }> = [],
  warehouses?: HotShotWarehousePair,
): MapBoundingBox | null {
  const pts: Array<[number, number]> = [];
  if (hotShots.length === 0) {
    pts.push([warehouse.latitude, warehouse.longitude]);
  }

  for (const hs of hotShots) {
    const hsHub = warehouses
      ? resolveHotShotWarehouse(hs.originHub, warehouses)
      : warehouse;
    if (Number.isFinite(hsHub.latitude) && Number.isFinite(hsHub.longitude)) {
      pts.push([hsHub.latitude, hsHub.longitude]);
    }
    for (const s of hs.stops || []) {
      if (Number.isFinite(s.lat) && Number.isFinite(s.lon)) {
        pts.push([s.lat, s.lon]);
      }
    }
    if (hs.vehicleId || hs.vehicleName) {
      const veh = liveVehicles.find(
        (v) =>
          (hs.vehicleId && v.id === hs.vehicleId) ||
          (hs.vehicleName && v.name === hs.vehicleName),
      );
      if (veh && Number.isFinite(veh.location.lat) && Number.isFinite(veh.location.lon)) {
        pts.push([veh.location.lat, veh.location.lon]);
      }
    }
  }

  if (pts.length < 2) {
    return {
      south: warehouse.latitude - 0.55,
      west: warehouse.longitude - 0.85,
      north: warehouse.latitude + 0.55,
      east: warehouse.longitude + 0.85,
    };
  }

  let south = Infinity;
  let north = -Infinity;
  let west = Infinity;
  let east = -Infinity;
  for (const [lat, lon] of pts) {
    if (lat < south) south = lat;
    if (lat > north) north = lat;
    if (lon < west) west = lon;
    if (lon > east) east = lon;
  }

  const latSpan = Math.max(0.14, north - south);
  const lonSpan = Math.max(0.20, east - west);
  const padLat = latSpan * 0.14;
  const padLon = lonSpan * 0.14;

  return {
    south: Number((south - padLat).toFixed(4)),
    west: Number((west - padLon).toFixed(4)),
    north: Number((north + padLat).toFixed(4)),
    east: Number((east + padLon).toFixed(4)),
  };
}

// ============================================================================
// GPS HISTORY ROUTE-CORRIDOR VAN ESTIMATOR & RETROACTIVE STOP BACKFILL
// ============================================================================

export interface HotShotGpsFix {
  vehicleId: string;
  latitude: number;
  longitude: number;
  speed: number;
  heading?: number;
  status?: string;
  timestamp: Date | string;
}

export interface HotShotVehicleCandidate {
  vehicleId: string;
  vehicleName: string;
  score: number;
  confidence: number;
  matchedStopCount: number;
  totalStops: number;
  matchedTowns: string[];
  onCorridorPct: number;
  maxDistFromHubMiles: number;
  reason: string;
}

const REGULAR_DAILY_ROUTE_TRUCKS = new Set([
  "T01",
  "T02",
  "T22",
  "T03",
  "T04",
  "T05",
  "48087",
  "BIG BETTY",
  "RON'S TRUCK",
  "RONS TRUCK",
]);

function pointToSegmentMiles(
  pLat: number,
  pLon: number,
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const cosLat = Math.cos((((aLat + bLat + pLat) / 3) * Math.PI) / 180);
  const milesPerLat = 69.0;
  const milesPerLon = 69.0 * cosLat;

  const px = (pLon - aLon) * milesPerLon;
  const py = (pLat - aLat) * milesPerLat;
  const bx = (bLon - aLon) * milesPerLon;
  const by = (bLat - aLat) * milesPerLat;

  const segLenSq = bx * bx + by * by;
  if (segLenSq < 1e-6) {
    return Math.hypot(px, py);
  }
  const t = Math.max(0, Math.min(1, (px * bx + py * by) / segLenSq));
  const projX = t * bx;
  const projY = t * by;
  return Math.hypot(px - projX, py - projY);
}

function minDistanceToCorridorMiles(
  lat: number,
  lon: number,
  corridorVertices: Array<[number, number]>,
): number {
  if (corridorVertices.length === 0) return Infinity;
  if (corridorVertices.length === 1) {
    return haversineMiles(lat, lon, corridorVertices[0][0], corridorVertices[0][1]);
  }
  let best = Infinity;
  for (let i = 0; i < corridorVertices.length - 1; i++) {
    const [aLat, aLon] = corridorVertices[i];
    const [bLat, bLon] = corridorVertices[i + 1];
    const d = pointToSegmentMiles(lat, lon, aLat, aLon, bLat, bLon);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Ranks fleet vans against a Hot Shot route using their chronological Motive GPS breadcrumb trail
 * on `deliveryDateISO` (comparing origin hub departure, stop geofence/dwell hits, stop ordering,
 * corridor alignment, and off-corridor overshoot).
 */
export function estimateHotShotVehicleCandidates(params: {
  stops: Array<
    Pick<HotShotStop, "city" | "accountName" | "lat" | "lon"> & {
      geocodePrecision?: "street" | "town" | "manual";
    }
  >;
  originHub: HotShotOriginHub;
  deliveryDateISO: string;
  warehouses?: HotShotWarehousePair;
  vehiclesMeta: Array<{ vehicleId: string; name?: string | null }>;
  gpsLocations: HotShotGpsFix[];
  excludedVehicleIds?: Set<string>;
}): HotShotVehicleCandidate[] {
  const {
    stops,
    originHub,
    deliveryDateISO,
    warehouses,
    vehiclesMeta,
    gpsLocations,
    excludedVehicleIds,
  } = params;

  const validStops = (stops || []).filter(
    (s) =>
      Number.isFinite(s.lat) &&
      Number.isFinite(s.lon) &&
      !(Math.abs(s.lat) < 0.01 && Math.abs(s.lon) < 0.01),
  );
  if (validStops.length === 0) return [];

  const hub = resolveHotShotWarehouse(originHub, warehouses);
  const corridorVertices: Array<[number, number]> = [
    [hub.latitude, hub.longitude],
    ...validStops.map((s): [number, number] => [s.lat, s.lon]),
    [hub.latitude, hub.longitude],
  ];

  // Group GPS fixes by vehicle for the target delivery date in Central Time
  const fixesByVeh = new Map<string, Array<{ lat: number; lon: number; speed: number; ms: number }>>();
  for (const rawFix of gpsLocations) {
    if (!rawFix?.vehicleId) continue;
    const dt = rawFix.timestamp instanceof Date ? rawFix.timestamp : new Date(rawFix.timestamp);
    const ms = dt.getTime();
    if (!Number.isFinite(ms)) continue;
    if (getCentralDateISO(dt) !== deliveryDateISO) continue;
    if (!Number.isFinite(rawFix.latitude) || !Number.isFinite(rawFix.longitude)) continue;

    let arr = fixesByVeh.get(rawFix.vehicleId);
    if (!arr) {
      arr = [];
      fixesByVeh.set(rawFix.vehicleId, arr);
    }
    arr.push({
      lat: rawFix.latitude,
      lon: rawFix.longitude,
      speed: Number(rawFix.speed || 0),
      ms,
    });
  }

  const candidates: HotShotVehicleCandidate[] = [];

  for (const veh of vehiclesMeta) {
    const vid = veh.vehicleId;
    const vName = String(veh.name || vid).trim();
    if (!vid) continue;
    if (excludedVehicleIds?.has(vid)) continue;
    if (REGULAR_DAILY_ROUTE_TRUCKS.has(vName.toUpperCase())) continue;

    const trail = fixesByVeh.get(vid);
    if (!trail || trail.length === 0) continue;
    trail.sort((a, b) => a.ms - b.ms);

    let maxDistFromHub = 0;
    let minPreTripDistFromHub = Infinity;
    let firstDepartIdx = -1;

    for (let i = 0; i < trail.length; i++) {
      const dHub = haversineMiles(hub.latitude, hub.longitude, trail[i].lat, trail[i].lon);
      if (dHub > maxDistFromHub) maxDistFromHub = dHub;
      if (firstDepartIdx < 0) {
        if (dHub < minPreTripDistFromHub) minPreTripDistFromHub = dHub;
        if (dHub > 1.5) firstDepartIdx = i;
      }
    }

    // Ignore vans still parked at the hub all day
    if (maxDistFromHub < 1.8) continue;

    const startedNearHub = minPreTripDistFromHub <= 6.5;
    const isSfNamed = /(?:^|[\s-])sf$/i.test(vName);
    const isArlNamed = /(?:^|[\s-])a$/i.test(vName) || /arlington/i.test(vName);

    let score = 0;
    if (startedNearHub) {
      score += 14;
    }
    if (originHub === "sioux_falls") {
      if (isSfNamed) score += 6;
      else if (isArlNamed && !startedNearHub) score -= 35;
    } else {
      if (isArlNamed) score += 6;
      else if (isSfNamed && !startedNearHub) score -= 35;
    }

    // Evaluate per-stop hits after leaving hub (or across full trail if history started mid-route)
    const activeTrail = firstDepartIdx >= 0 ? trail.slice(firstDepartIdx) : trail;
    let matchedStopCount = 0;
    const matchedTowns: string[] = [];
    const matchedHitTimes: number[] = [];

    for (const stop of validStops) {
      const stopGeofenceMi = getHotShotStopGeofenceMiles(stop);
      const dwellRadiusMi = stop.geocodePrecision === "street" ? 1.35 : 2.6;
      const stopDistFromHub = haversineMiles(hub.latitude, hub.longitude, stop.lat, stop.lon);
      let bestDist = Infinity;
      let slowFixNearStop = 0;
      let firstHitMs = 0;

      for (const pt of activeTrail) {
        // Don't credit sitting inside the warehouse if a stop happens to be in the hub city
        const ptDistHub = haversineMiles(hub.latitude, hub.longitude, pt.lat, pt.lon);
        if (stopDistFromHub > 2.5 && ptDistHub < 0.9) continue;

        const d = haversineMiles(pt.lat, pt.lon, stop.lat, stop.lon);
        if (d < bestDist) bestDist = d;
        if (d <= stopGeofenceMi && !firstHitMs) {
          firstHitMs = pt.ms;
        }
        if (d <= dwellRadiusMi && pt.speed <= 20) {
          slowFixNearStop++;
        }
      }

      const townLabel = stop.city || stop.accountName;
      if (bestDist <= dwellRadiusMi && slowFixNearStop >= 1) {
        // Strong delivery dwell (slowed/stopped right at dealer/town)
        score += 42;
        matchedStopCount++;
        if (townLabel && !matchedTowns.includes(townLabel)) matchedTowns.push(townLabel);
        matchedHitTimes.push(firstHitMs);
      } else if (bestDist <= stopGeofenceMi) {
        // Direct geofence hit
        score += 28;
        matchedStopCount++;
        if (townLabel && !matchedTowns.includes(townLabel)) matchedTowns.push(townLabel);
        matchedHitTimes.push(firstHitMs);
      } else if (bestDist <= 5.0 && stopDistFromHub > 6) {
        // Close highway/town approach
        score += 9;
      }
    }

    // Chronological stop sequence bonus when 2+ stops were visited in planned order
    if (matchedHitTimes.length >= 2) {
      let orderedPairs = 0;
      for (let i = 0; i < matchedHitTimes.length - 1; i++) {
        if (matchedHitTimes[i + 1] >= matchedHitTimes[i] - 5 * 60_000) {
          orderedPairs++;
        }
      }
      if (orderedPairs > 0) {
        score += Math.min(14, orderedPairs * 7);
      }
    }

    // Corridor alignment & off-corridor overshoot penalty
    const awayFixes = activeTrail.filter(
      (pt) => haversineMiles(hub.latitude, hub.longitude, pt.lat, pt.lon) >= 3.0,
    );
    let onCorridorPct = 0;
    let maxOffCorridorMiles = 0;

    if (awayFixes.length > 0) {
      let onCorridorCount = 0;
      for (const pt of awayFixes) {
        const dCorr = minDistanceToCorridorMiles(pt.lat, pt.lon, corridorVertices);
        if (dCorr <= 5.5) onCorridorCount++;
        if (dCorr > maxOffCorridorMiles) maxOffCorridorMiles = dCorr;
      }
      onCorridorPct = Math.round((onCorridorCount / awayFixes.length) * 100);
      score += (onCorridorPct / 100) * 22;

      // Penalize vans that drove far beyond or off this route's corridor (disambiguates short vs long highway runs!)
      if (maxOffCorridorMiles > 8.5) {
        score -= Math.min(48, (maxOffCorridorMiles - 8.5) * 1.45);
      }
    }

    // Early en-route detection: departed hub & making clear progress down the Stop #1 corridor before reaching Stop #1
    let earlyHeadingTowardFirstStop = false;
    if (matchedStopCount === 0 && validStops.length > 0 && awayFixes.length > 0) {
      const stop1 = validStops[0];
      const hubToStop1 = haversineMiles(hub.latitude, hub.longitude, stop1.lat, stop1.lon);
      const latestPt = awayFixes[awayFixes.length - 1];
      const latestToStop1 = haversineMiles(latestPt.lat, latestPt.lon, stop1.lat, stop1.lon);
      const dSeg1 = pointToSegmentMiles(
        latestPt.lat,
        latestPt.lon,
        hub.latitude,
        hub.longitude,
        stop1.lat,
        stop1.lon,
      );
      const milesCloser = hubToStop1 - latestToStop1;
      const minClearHubMiles = Math.min(9.0, hubToStop1 * 0.45);
      if (
        hubToStop1 >= 6 &&
        maxDistFromHub >= minClearHubMiles &&
        milesCloser >= 3.5 &&
        dSeg1 <= 5.0 &&
        maxOffCorridorMiles <= 7.0
      ) {
        earlyHeadingTowardFirstStop = true;
        score += 20 + Math.min(10, milesCloser * 0.4);
      }
    }

    const roundedScore = Math.round(score);
    if (roundedScore < 20) continue;

    // Convert score into an intuitive 0-99% confidence
    const rawConf =
      matchedStopCount >= 2
        ? 78 + Math.min(20, matchedStopCount * 6 + (onCorridorPct >= 80 ? 5 : 0))
        : matchedStopCount === 1
          ? 64 + Math.min(24, Math.round(onCorridorPct * 0.2))
          : earlyHeadingTowardFirstStop
            ? 56 + Math.min(18, Math.round(onCorridorPct * 0.15))
            : Math.min(52, Math.max(25, roundedScore));
    const confidence = Math.max(25, Math.min(99, Math.round(rawConf)));

    const hubShort = getHotShotHubMeta(originHub).shortLabel;
    const reason =
      matchedStopCount > 0
        ? `Matched ${matchedStopCount}/${validStops.length} route stop${
            matchedStopCount === 1 ? "" : "s"
          } (${matchedTowns.slice(0, 3).join(", ")}) • ${onCorridorPct}% on corridor`
        : earlyHeadingTowardFirstStop
          ? `Departed ${hubShort} heading on corridor toward ${validStops[0].city || validStops[0].accountName}`
          : `${onCorridorPct}% GPS trail aligned with ${hubShort} route corridor`;

    candidates.push({
      vehicleId: vid,
      vehicleName: vName,
      score: roundedScore,
      confidence,
      matchedStopCount,
      totalStops: validStops.length,
      matchedTowns,
      onCorridorPct,
      maxDistFromHubMiles: Math.round(maxDistFromHub),
      reason,
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

/**
 * Replays a vehicle's chronological GPS trail from `deliveryDateISO` onto a Hot Shot route,
 * retroactively stamping `departedAt`, `stop.completedAt` (with actual arrival timestamp), and `returnedAt`.
 */
export function replayVehicleHistoryOnHotShotRoute(
  route: HotShotRoute,
  warehouse: { latitude: number; longitude: number },
  vehicleTrail: HotShotGpsFix[],
): boolean {
  if (!Array.isArray(vehicleTrail) || vehicleTrail.length === 0) return false;

  const dayPoints = vehicleTrail
    .map((pt) => {
      const dt = pt.timestamp instanceof Date ? pt.timestamp : new Date(pt.timestamp);
      return {
        lat: pt.latitude,
        lon: pt.longitude,
        ms: dt.getTime(),
        iso: Number.isFinite(dt.getTime()) ? dt.toISOString() : "",
        dateISO: Number.isFinite(dt.getTime()) ? getCentralDateISO(dt) : "",
      };
    })
    .filter(
      (pt) =>
        pt.dateISO === route.deliveryDateISO &&
        Number.isFinite(pt.lat) &&
        Number.isFinite(pt.lon),
    )
    .sort((a, b) => a.ms - b.ms);

  if (dayPoints.length === 0) return false;

  let mutated = false;
  let departedMs = route.departedAt ? new Date(route.departedAt).getTime() : 0;

  for (const pt of dayPoints) {
    const distFromHub = haversineMiles(warehouse.latitude, warehouse.longitude, pt.lat, pt.lon);

    if (!departedMs && distFromHub > 1.2) {
      route.departedAt = pt.iso;
      departedMs = pt.ms;
      mutated = true;
    }

    for (const stop of route.stops) {
      if (stop.completedAt) continue;
      // If stop is right near hub city, wait until van actually left the hub
      const stopDistFromHub = haversineMiles(
        warehouse.latitude,
        warehouse.longitude,
        stop.lat,
        stop.lon,
      );
      if (stopDistFromHub > 2.5 && distFromHub < 0.9) continue;

      const dStop = haversineMiles(pt.lat, pt.lon, stop.lat, stop.lon);
      if (dStop <= getHotShotStopGeofenceMiles(stop)) {
        stop.completedAt = pt.iso;
        stop.completedBy = "gps";
        if (!departedMs) {
          route.departedAt = pt.iso;
          departedMs = pt.ms;
        }
        mutated = true;
      }
    }
  }

  // Check if all stops are done and a fix AFTER the final stop completion returned to hub
  const allDone = route.stops.length > 0 && route.stops.every((s) => Boolean(s.completedAt));
  if (allDone && departedMs && !route.returnedAt) {
    const latestStopDoneMs = Math.max(
      ...route.stops.map((s) => (s.completedAt ? new Date(s.completedAt).getTime() : 0)),
    );
    const returnFix = dayPoints.find(
      (pt) =>
        pt.ms > latestStopDoneMs + 3 * 60_000 &&
        haversineMiles(warehouse.latitude, warehouse.longitude, pt.lat, pt.lon) <= 0.75,
    );
    if (returnFix) {
      route.returnedAt = returnFix.iso;
      mutated = true;
    }
  }

  if (mutated) {
    route.updatedAt = new Date().toISOString();
  }
  return mutated;
}

// -----------------------------------------------------------------------------
// BCI Battery Weight Estimator, 2-Opt Stop Optimizer & Dispatch Route Matcher
// -----------------------------------------------------------------------------

/**
 * Estimates single-unit weight (in lbs) of an Interstate / commercial / OEM / dry-cell part code
 * calibrated against IBS of South Dakota's actual inventory & BCI group sizes.
 */
export function estimateSinglePartWeightLbs(rawPartCode: string): number {
  const s = String(rawPartCode || "").trim().toUpperCase();
  if (!s) return 40;

  // 1. Non-battery service / check-in / core pickup lines (0 lbs)
  if (
    /DRIVE\s*BY|PICK\s*UP\s*JUNK|CALL\s*&\s*GET|ACCESSOR|BOOK|RACK|SIGN/i.test(s)
  ) {
    return 0;
  }

  // 2. Dry-Cell / Alkaline / Coin / Boxed Flashlight Batteries (AA, AAA, C, D, 9V, CR123) (~2 lbs/pack)
  if (/^DRY\d|^LIT0/i.test(s)) {
    return 2;
  }

  // 3. Tools & Portable Jump Starters (GB150, JMP3500A, TOL2603, REBUILD-TOOL)
  if (/^TOL\d|REBUILD-TOOL/i.test(s)) return 3;
  if (/^GB\d|^JMP\d/i.test(s)) return 7;

  // 4. Small Sealed Lead Acid (SLA / HSL / FAS Fire & Security Alarm Batteries)
  //    - SLA1079 / HSL1079 / FAS1075 (12V 7-8Ah): ~5.5 lbs
  //    - SLA1116 (12V 18Ah): ~13 lbs
  if (/^(?:SLA|HSL)107\d|^FAS107/i.test(s)) return 5.5;
  if (/^(?:SLA|HSL)111\d/i.test(s)) return 13;
  if (/^(?:SLA|HSL|FAS)\d/i.test(s)) return 8;

  // 5. Deep-Cycle Mobility / Wheelchair AGM (DCM0035 = 24 lbs, DCM0055 = 39 lbs)
  if (/^DCM0035/i.test(s)) return 24;
  if (/^DCM0055/i.test(s)) return 39;
  if (/^DCM\d/i.test(s)) return 30;

  // 6. Powersports / Motorcycle / Stop-Start Auxiliary (FAITX, CITX, YTX, MTX-AUX14) (~11 lbs)
  if (/^(?:FAITX|CITX|YTX)|AUX14/i.test(s)) return 11;

  // 7. Lawn & Garden / Small Power / Utility Tractor (SP-70 = 28 lbs, SP-35 / U1 = 20 lbs)
  if (/\bSP-70\b/i.test(s)) return 28;
  if (/\bSP-35\b|\bSP-40\b|U-?1|U1L/i.test(s)) return 20;

  // 8. Lithium Marine (Li27M12V100 = 28 lbs)
  if (/^LI27M/i.test(s)) return 28;

  // 9. Compact Automotive BCI Groups 51, 51R, 45, 22NF (~29 lbs)
  if (
    /\bMT-51R?\b|60-51|40-45|6-22NF|\b22NF\b|\b51R?\b/i.test(s)
  ) {
    return 29;
  }

  // 10. Heavy Commercial / Ag: 8D (~130 lbs) & 4D / 4DLT / 5D (~105 lbs)
  if (/\b8D\b|8D-|RECON-HV/i.test(s)) return 130;
  if (/\b4DLT\b|\b4D\b|\b5D\b|4D-|4DLT-|\(4D\)|\(5D\)/i.test(s)) return 105;

  // 11. Group 31 Commercial Truck / Ag & John Deere 31MHD (TY24546B, TY25879B) (~62 lbs)
  if (
    /\b31\b|31-|31M|31P|M-31|PV-31|SRM-31|7-31|TY24546B|TY25879B/i.test(s)
  ) {
    return 62;
  }

  // 12. Golf Cart GC2 (63 lbs) & Commercial 3ET (60 lbs)
  if (/\bGC2\b|GC2-/i.test(s)) return 63;
  if (/\b3ET\b|TY24341B/i.test(s)) return 60;

  // 13. Large European / Marine / Commercial Automotive:
  //     - Group 49 / H8 (58 lbs)
  //     - Group 94R / H7 (52 lbs)
  //     - Group 27 / 27M / 29 / 902 / 921 (51 lbs)
  if (/49\/H8|\bH8\b|-49\b/i.test(s)) return 58;
  if (/94R|\/H7|\bH7\b/i.test(s)) return 52;
  if (/\b27M?\b|-27|27-|SRM-29|902-S|921-S/i.test(s)) return 51;

  // 14. Medium-Heavy Automotive: Group 65 (45 lbs), Group 48 / H6 / Nissan H6 (45 lbs), Group 78/79 (43 lbs)
  if (/65HD|-65\b|60-65|TY24932B/i.test(s)) return 45;
  if (/48\/H6|\bH6\b|-48\b|TY27473B|NCH6A/i.test(s)) return 45;
  if (/-78|-79|78DT/i.test(s)) return 43;

  // 15. Standard Automotive / Marine: Group 24, 24F, 24M, 34, 124R, Blem A/H (~41 lbs)
  if (/-24F?|-24M|24M-|-34\b|-124R|BLEM\s*[AH]/i.test(s)) {
    return 41;
  }

  // 16. Mid-Compact Automotive / Ag: Group 47/H5/H4 (38 lbs), Group 35, 26, 75, 86, 4-XHD, 7-D4/D5 (36 lbs)
  if (/47\/H5|\bH5\b|H4470|TY27472B/i.test(s)) return 38;
  if (/-35\b|35060|-26\b|-75\b|-86-|4-XHD|7-D[45]|TY26783B/i.test(s)) {
    return 36;
  }

  // Default mixed battery piece average (e.g. "Weekly PO")
  return 42;
}

/**
 * Estimates total battery weight (in lbs) and battery piece count for a single stop or open order.
 */
export function estimateStopWeightAndPieces(stop: {
  partsSummary?: string;
  piecesCount?: number;
}): { pieces: number; weightLbs: number } {
  const summary = String(stop.partsSummary || "").trim();
  if (summary) {
    const tokens = summary
      .split(/\s*•\s*/)
      .map((t) => t.trim())
      .filter(Boolean);
    let totalPieces = 0;
    let totalWeight = 0;

    for (const tok of tokens) {
      const m = tok.match(/^(.*?)\s*\((\d+)\)\s*$/);
      if (m) {
        const partCode = m[1].trim();
        const qty = Number(m[2]) || 0;
        const unitLbs = estimateSinglePartWeightLbs(partCode);
        if (unitLbs > 0) {
          totalPieces += qty;
          totalWeight += qty * unitLbs;
        }
      } else {
        const unitLbs = estimateSinglePartWeightLbs(tok);
        if (unitLbs > 0) {
          totalPieces += 1;
          totalWeight += unitLbs;
        }
      }
    }

    if (tokens.length > 0) {
      return { pieces: totalPieces, weightLbs: Math.round(totalWeight) };
    }
  }

  const fallbackPcs = Math.max(0, Math.round(Number(stop.piecesCount) || 0));
  return {
    pieces: fallbackPcs,
    weightLbs: Math.round(fallbackPcs * 42),
  };
}

export interface HotShotLoadMetrics {
  totalBatteries: number;
  deliveredBatteries: number;
  remainingBatteries: number;
  totalWeightLbs: number;
  deliveredWeightLbs: number;
  remainingVanWeightLbs: number;
}

export function computeHotShotRouteLoadMetrics(
  stops: Array<{
    partsSummary?: string;
    piecesCount?: number;
    completedAt?: string | null;
  }>,
): HotShotLoadMetrics {
  let totalBatteries = 0;
  let deliveredBatteries = 0;
  let totalWeightLbs = 0;
  let deliveredWeightLbs = 0;

  for (const s of stops || []) {
    const { pieces, weightLbs } = estimateStopWeightAndPieces(s);
    totalBatteries += pieces;
    totalWeightLbs += weightLbs;
    if (s.completedAt) {
      deliveredBatteries += pieces;
      deliveredWeightLbs += weightLbs;
    }
  }

  return {
    totalBatteries,
    deliveredBatteries,
    remainingBatteries: Math.max(0, totalBatteries - deliveredBatteries),
    totalWeightLbs,
    deliveredWeightLbs,
    remainingVanWeightLbs: Math.max(0, totalWeightLbs - deliveredWeightLbs),
  };
}

export interface StopSequenceOptimizationResult {
  currentStops: HotShotStop[];
  optimizedStops: HotShotStop[];
  currentRoadMiles: number;
  optimizedRoadMiles: number;
  savedRoadMiles: number;
  savedMinutes: number;
  isImproved: boolean;
}

function computeLoopRoadMilesAndMinutes(
  stops: Array<{ lat: number; lon: number }>,
  warehouse: { latitude: number; longitude: number },
): { roadMiles: number; driveMinutes: number } {
  if (stops.length === 0) return { roadMiles: 0, driveMinutes: 0 };
  let roadMiles = 0;
  let driveMinutes = 0;
  let curLat = warehouse.latitude;
  let curLon = warehouse.longitude;

  for (const s of stops) {
    const leg = legDriveMinutesGenerous(curLat, curLon, s.lat, s.lon);
    roadMiles += leg.roadMiles;
    driveMinutes += leg.minutes;
    curLat = s.lat;
    curLon = s.lon;
  }
  const backLeg = legDriveMinutesGenerous(
    curLat,
    curLon,
    warehouse.latitude,
    warehouse.longitude,
  );
  roadMiles += backLeg.roadMiles;
  driveMinutes += backLeg.minutes;
  return { roadMiles, driveMinutes };
}

/**
 * Computes the optimal stop sequence (Warehouse -> all stops -> Warehouse)
 * using Nearest-Neighbor initialization + 2-Opt loop uncrossing.
 * Completed stops (if any) stay locked at the start of the sequence in the order completed.
 */
export function optimizeHotShotStopSequence(
  stops: HotShotStop[],
  warehouse: { latitude: number; longitude: number },
): StopSequenceOptimizationResult {
  const current = (stops || []).map((s, idx) => ({ ...s, order: idx + 1 }));
  const currentMetrics = computeLoopRoadMilesAndMinutes(current, warehouse);

  if (current.length <= 2) {
    return {
      currentStops: current,
      optimizedStops: current,
      currentRoadMiles: Math.round(currentMetrics.roadMiles),
      optimizedRoadMiles: Math.round(currentMetrics.roadMiles),
      savedRoadMiles: 0,
      savedMinutes: 0,
      isImproved: false,
    };
  }

  // Keep already-completed stops locked at the front of the route
  const completedPrefix = current.filter((s) => Boolean(s.completedAt));
  const pending = current.filter((s) => !s.completedAt);

  if (pending.length <= 1) {
    return {
      currentStops: current,
      optimizedStops: current,
      currentRoadMiles: Math.round(currentMetrics.roadMiles),
      optimizedRoadMiles: Math.round(currentMetrics.roadMiles),
      savedRoadMiles: 0,
      savedMinutes: 0,
      isImproved: false,
    };
  }

  // 1. Nearest-Neighbor seed from last completed stop (or warehouse)
  const anchorLat =
    completedPrefix.length > 0
      ? completedPrefix[completedPrefix.length - 1].lat
      : warehouse.latitude;
  const anchorLon =
    completedPrefix.length > 0
      ? completedPrefix[completedPrefix.length - 1].lon
      : warehouse.longitude;

  const remaining = [...pending];
  const nnOrder: HotShotStop[] = [];
  let curLat = anchorLat;
  let curLon = anchorLon;

  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineMiles(curLat, curLon, remaining[i].lat, remaining[i].lon);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    const [picked] = remaining.splice(bestIdx, 1);
    nnOrder.push(picked);
    curLat = picked.lat;
    curLon = picked.lon;
  }

  // 2. 2-Opt Loop Uncrossing on pending stops
  let bestPending = nnOrder;
  let bestCandidate = [...completedPrefix, ...bestPending];
  let bestMiles = computeLoopRoadMilesAndMinutes(bestCandidate, warehouse).roadMiles;

  // If current order is already better than Nearest-Neighbor seed, start 2-Opt from current
  if (currentMetrics.roadMiles < bestMiles) {
    bestPending = [...pending];
    bestCandidate = [...completedPrefix, ...bestPending];
    bestMiles = currentMetrics.roadMiles;
  }

  let improved = true;
  let iter = 0;
  while (improved && iter < 40) {
    improved = false;
    iter++;
    for (let i = 0; i < bestPending.length - 1; i++) {
      for (let k = i + 1; k < bestPending.length; k++) {
        const candidatePending = [
          ...bestPending.slice(0, i),
          ...bestPending.slice(i, k + 1).reverse(),
          ...bestPending.slice(k + 1),
        ];
        const candidateFull = [...completedPrefix, ...candidatePending];
        const m = computeLoopRoadMilesAndMinutes(candidateFull, warehouse).roadMiles;
        if (m + 0.25 < bestMiles) {
          bestPending = candidatePending;
          bestCandidate = candidateFull;
          bestMiles = m;
          improved = true;
        }
      }
    }
  }

  const optMetrics = computeLoopRoadMilesAndMinutes(bestCandidate, warehouse);
  const savedMiles = Math.max(0, Math.round(currentMetrics.roadMiles - optMetrics.roadMiles));
  const savedMinutes = Math.max(
    0,
    Math.round(currentMetrics.driveMinutes - optMetrics.driveMinutes),
  );
  const reindexed = bestCandidate.map((s, idx) => ({ ...s, order: idx + 1 }));

  return {
    currentStops: current,
    optimizedStops: savedMiles >= 2 ? reindexed : current,
    currentRoadMiles: Math.round(currentMetrics.roadMiles),
    optimizedRoadMiles:
      savedMiles >= 2 ? Math.round(optMetrics.roadMiles) : Math.round(currentMetrics.roadMiles),
    savedRoadMiles: savedMiles >= 2 ? savedMiles : 0,
    savedMinutes: savedMiles >= 2 ? savedMinutes : 0,
    isImproved: savedMiles >= 2,
  };
}

export interface OpenOrderRouteSuggestion {
  order: HotShotOpenOrder;
  pieces: number;
  weightLbs: number;
  bestMatch: {
    routeId: string;
    driverName: string;
    deliveryDateISO: string;
    originHub: HotShotOriginHub;
    insertAfterStopOrder: number;
    insertAfterLabel: string;
    addedRoadMiles: number;
    addedMinutes: number;
    tier: "same_town" | "corridor" | "far";
  } | null;
  matchingRouteTrucks: Array<{
    routeId: string;
    routeName: string;
    truckGroup: string;
  }>;
}

/**
 * Evaluates all Open Orders (/API/Orders) against active Today & Upcoming Hot Shot sheets
 * and Regular Route Truck territories to recommend where each open order fits best.
 */
export function evaluateOpenOrderSuggestions(
  openOrders: HotShotOpenOrder[],
  activeRoutes: HotShotRoute[],
  warehouses?: HotShotWarehousePair,
  routeTerritories?: Array<{
    id: string;
    name: string;
    truckGroup: string;
    stops: Array<{ name: string; state: string }>;
  }>,
): OpenOrderRouteSuggestion[] {
  const results: OpenOrderRouteSuggestion[] = [];

  for (const ord of openOrders || []) {
    const { pieces, weightLbs } = estimateStopWeightAndPieces(ord);
    const hasCoords =
      Number.isFinite(ord.lat) && Number.isFinite(ord.lon) && Math.abs(ord.lat) > 1;

    let bestMatch: OpenOrderRouteSuggestion["bestMatch"] = null;

    if (hasCoords && activeRoutes.length > 0) {
      for (const route of activeRoutes) {
        if (!route.stops || route.stops.length === 0) continue;
        const routeHub = normalizeHotShotOriginHub(
          route.originHub,
          route.rawPdfDriver || route.driverName,
        );
        const wh = resolveHotShotWarehouse(routeHub, warehouses);

        // Check if route already visits this exact city/state
        const exactCityStopIdx = route.stops.findIndex(
          (s) =>
            s.city.trim().toLowerCase() === ord.city.trim().toLowerCase() &&
            s.state.trim().toUpperCase() === ord.state.trim().toUpperCase(),
        );

        // Build chain of points: [Warehouse, Stop 1, Stop 2, ..., Stop N, Warehouse]
        const points: Array<{ lat: number; lon: number; label: string; stopOrder: number }> = [
          { lat: wh.latitude, lon: wh.longitude, label: wh.name, stopOrder: 0 },
          ...route.stops.map((s, idx) => ({
            lat: s.lat,
            lon: s.lon,
            label: `Stop #${idx + 1} (${s.city})`,
            stopOrder: idx + 1,
          })),
          {
            lat: wh.latitude,
            lon: wh.longitude,
            label: wh.name,
            stopOrder: route.stops.length,
          },
        ];

        for (let i = 0; i < points.length - 1; i++) {
          const pA = points[i];
          const pB = points[i + 1];
          const baseLeg = legDriveMinutesGenerous(pA.lat, pA.lon, pB.lat, pB.lon);
          const leg1 = legDriveMinutesGenerous(pA.lat, pA.lon, ord.lat, ord.lon);
          const leg2 = legDriveMinutesGenerous(ord.lat, ord.lon, pB.lat, pB.lon);

          let addedMiles = Math.max(0, leg1.roadMiles + leg2.roadMiles - baseLeg.roadMiles);
          if (exactCityStopIdx >= 0 && i === exactCityStopIdx + 1) {
            addedMiles = Math.min(addedMiles, 0.5);
          }
          const addedMin = Math.round(
            Math.max(0, leg1.minutes + leg2.minutes - baseLeg.minutes) + 20,
          );

          const tier: "same_town" | "corridor" | "far" =
            exactCityStopIdx >= 0 || addedMiles <= 2.5
              ? "same_town"
              : addedMiles <= 18
                ? "corridor"
                : "far";

          if (
            !bestMatch ||
            addedMiles < bestMatch.addedRoadMiles - 0.2 ||
            (Math.abs(addedMiles - bestMatch.addedRoadMiles) <= 0.2 &&
              tier === "same_town" &&
              bestMatch.tier !== "same_town")
          ) {
            bestMatch = {
              routeId: route.id,
              driverName: route.driverName,
              deliveryDateISO: route.deliveryDateISO,
              originHub: routeHub,
              insertAfterStopOrder: pA.stopOrder,
              insertAfterLabel:
                pA.stopOrder === 0 ? `Departing ${wh.name}` : `After ${pA.label}`,
              addedRoadMiles: Number(addedMiles.toFixed(1)),
              addedMinutes: addedMin,
              tier,
            };
          }
        }
      }
    }

    // Check matching Regular Route Truck territories (T01-T22)
    const matchingRouteTrucks: OpenOrderRouteSuggestion["matchingRouteTrucks"] = [];
    const ordCityLower = ord.city.trim().toLowerCase();
    const ordStateUpper = ord.state.trim().toUpperCase();
    for (const terr of routeTerritories || []) {
      const hitsTown = (terr.stops || []).some(
        (st) =>
          st.name.trim().toLowerCase() === ordCityLower &&
          st.state.trim().toUpperCase() === ordStateUpper,
      );
      if (hitsTown) {
        matchingRouteTrucks.push({
          routeId: terr.id,
          routeName: terr.name,
          truckGroup: terr.truckGroup,
        });
      }
    }

    results.push({
      order: ord,
      pieces,
      weightLbs,
      bestMatch,
      matchingRouteTrucks,
    });
  }

  // Sort: same_town first, then corridor by lowest added miles, then far
  const tierRank = { same_town: 0, corridor: 1, far: 2 };
  results.sort((a, b) => {
    const rA = a.bestMatch ? tierRank[a.bestMatch.tier] : 3;
    const rB = b.bestMatch ? tierRank[b.bestMatch.tier] : 3;
    if (rA !== rB) return rA - rB;
    const mA = a.bestMatch?.addedRoadMiles ?? 9999;
    const mB = b.bestMatch?.addedRoadMiles ?? 9999;
    return mA - mB;
  });

  return results;
}

// -----------------------------------------------------------------------------
// 2-Pallet + Cab Van Load Blueprint & Warehouse Master Rack Pull Generator
// -----------------------------------------------------------------------------

export type VanCargoZone = "cab" | "front_pallet" | "rear_pallet" | "core_bay";

export interface VanPartAllocation {
  partNumber: string;
  qty: number;
  orderedQty: number;
  pickedQty: number | null;
  unitWeightLbs: number;
  totalWeightLbs: number;
  isCabItem: boolean;
  isHeavyBaseLayer: boolean;
  isTopLayerLight: boolean;
  palletLayerFraction: number;
}

export interface VanStopLoadAllocation {
  stop: HotShotStop;
  stopOrder: number;
  zone: "front_pallet" | "rear_pallet" | "cab_only" | "core_only";
  isManualOverride: boolean;
  palletParts: VanPartAllocation[];
  cabParts: VanPartAllocation[];
  isJunkPickup: boolean;
  palletPieces: number;
  palletWeightLbs: number;
  cabPieces: number;
  cabWeightLbs: number;
  palletLayersUsed: number;
  layerPlacementHint: string;
  specialAlerts: string[];
}

export interface MasterPullPartSummary {
  partNumber: string;
  totalQty: number;
  totalOrderedQty: number;
  totalPickedQty: number;
  hasUnpickedStop: boolean;
  unitWeightLbs: number;
  totalWeightLbs: number;
  targetZoneLabel: string;
  stopNumbers: number[];
  isHeavyBaseLayer: boolean;
  isCabItem: boolean;
}

export interface VanLoadPlan {
  cabAllocations: Array<{
    stop: HotShotStop;
    stopOrder: number;
    parts: VanPartAllocation[];
    totalPieces: number;
    totalWeightLbs: number;
  }>;
  frontPalletStops: VanStopLoadAllocation[];
  rearPalletStops: VanStopLoadAllocation[];
  coreBayStops: HotShotStop[];
  masterPullList: MasterPullPartSummary[];
  specialAlerts: Array<{
    stopOrder: number;
    accountName: string;
    city: string;
    alertText: string;
    kind: "no_cores" | "signature" | "po_ticket" | "short_pick" | "note";
  }>;
  metrics: {
    cabWeightLbs: number;
    cabPieces: number;
    frontPalletWeightLbs: number;
    frontPalletPieces: number;
    frontPalletLayers: number;
    rearPalletWeightLbs: number;
    rearPalletPieces: number;
    rearPalletLayers: number;
    totalWeightLbs: number;
    totalPieces: number;
    totalPalletEquivalents: number;
    isOverflowWarning: boolean;
    overflowReason: string | null;
    pickedStopsCount: number;
    totalBatteryStopsCount: number;
    pickedByNames: string[];
  };
}

/**
 * Items smaller than powersports go up front in the Driver Cab:
 * - Dry-cell / alkaline boxes (DRY..., LIT0...)
 * - Small 7-8Ah alarm SLAs (SLA1079, HSL1079, FAS1075)
 * - Small hand tools / jump packs (TOL..., REBUILD-TOOL, GB150, JMP3500A)
 * Note: Powersports (FAITX, CITX, YTX, AUX14) go on a normal pallet!
 */
export function isCabSmallPart(rawPartCode: string): boolean {
  const s = String(rawPartCode || "").trim().toUpperCase();
  if (!s) return false;
  if (/^DRY\d|^LIT0/i.test(s)) return true;
  if (/^(?:SLA|HSL)107\d|^FAS107/i.test(s)) return true;
  if (/^TOL\d|REBUILD-TOOL|^GB\d|^JMP\d/i.test(s)) return true;
  return false;
}

export function isHeavyBottomLayerPart(rawPartCode: string): boolean {
  const s = String(rawPartCode || "").trim().toUpperCase();
  if (!s) return false;
  return /\b8D\b|8D-|\b4DLT\b|\b4D\b|\b5D\b|\(4D\)|\(5D\)|\b31\b|31-|31M|31P|7-31|TY24546B|TY25879B|\bGC2\b|\b3ET\b|TY24341B|49\/H8|\bH8\b/i.test(
    s,
  );
}

export function isTopLayerLightPalletPart(rawPartCode: string): boolean {
  const s = String(rawPartCode || "").trim().toUpperCase();
  if (!s) return false;
  return /^(?:FAITX|CITX|YTX)|AUX14|\bSP-35\b|\bSP-70\b|U-?1|U1L|\bMT-51/i.test(s);
}

function estimateSinglePartLayerFraction(rawPartCode: string, unitWeightLbs: number): number {
  const s = String(rawPartCode || "").trim().toUpperCase();
  if (unitWeightLbs <= 0) return 0;
  // Oversize 8D / 4D / 5D (~7 per pallet layer)
  if (/\b8D\b|8D-|\b4DLT\b|\b4D\b|\b5D\b|\(4D\)|\(5D\)/i.test(s)) return 1 / 7;
  // Group 31 / GC2 / 3ET / H8 (~14 per pallet layer)
  if (isHeavyBottomLayerPart(s)) return 1 / 14;
  // Powersports / U1 / SP-70 / SP-35 (~24 per pallet layer)
  if (isTopLayerLightPalletPart(s)) return 1 / 24;
  // Standard automotive Group 24/27/34/48/65 (~16 per pallet layer)
  return 1 / 16;
}

export function extractStopPartLines(stop: HotShotStop): HotShotPartLine[] {
  if (Array.isArray(stop.parts) && stop.parts.length > 0) {
    return stop.parts;
  }
  const summary = String(stop.partsSummary || "").trim();
  if (!summary) {
    if (stop.piecesCount && stop.piecesCount > 0) {
      return [
        {
          partNumber: "Battery Order",
          orderedQty: stop.piecesCount,
          pickedQty: stop.piecesCount,
        },
      ];
    }
    return [];
  }

  return summary
    .split(/\s*•\s*/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((tok) => {
      const m = tok.match(/^(.*?)\s*\((\d+)\)\s*$/);
      if (m) {
        const qty = Number(m[2]) || 1;
        return {
          partNumber: m[1].trim(),
          orderedQty: qty,
          pickedQty: qty,
        };
      }
      return {
        partNumber: tok,
        orderedQty: 1,
        pickedQty: 1,
      };
    });
}

export function buildVanLoadPlan(
  stops: HotShotStop[],
  manualZoneOverrides: Record<string, "front_pallet" | "rear_pallet"> = {},
  completedThroughStopOrder = 0,
): VanLoadPlan {
  const cabAllocations: VanLoadPlan["cabAllocations"] = [];
  const palletStopCandidates: VanStopLoadAllocation[] = [];
  const coreBayStops: HotShotStop[] = [];
  const specialAlerts: VanLoadPlan["specialAlerts"] = [];
  const pickedBySet = new Set<string>();
  let pickedStopsCount = 0;
  let totalBatteryStopsCount = 0;

  for (let i = 0; i < (stops || []).length; i++) {
    const stop = stops[i];
    const stopOrder = i + 1;
    const rawLines = extractStopPartLines(stop);

    const palletParts: VanPartAllocation[] = [];
    const cabParts: VanPartAllocation[] = [];
    let isJunkPickup = false;

    for (const line of rawLines) {
      const upper = line.partNumber.toUpperCase();
      if (/PICK\s*UP\s*JUNK/i.test(upper)) {
        isJunkPickup = true;
      }
      const unitLbs = estimateSinglePartWeightLbs(line.partNumber);
      if (unitLbs <= 0) continue;

      const qty =
        line.pickedQty !== null && line.pickedQty !== undefined && line.pickedQty > 0
          ? line.pickedQty
          : Math.max(1, line.orderedQty || 1);
      const isCab = isCabSmallPart(line.partNumber);
      const isHeavy = !isCab && isHeavyBottomLayerPart(line.partNumber);
      const isLightTop = !isCab && !isHeavy && isTopLayerLightPalletPart(line.partNumber);
      const layerFrac = isCab ? 0 : qty * estimateSinglePartLayerFraction(line.partNumber, unitLbs);

      const alloc: VanPartAllocation = {
        partNumber: line.partNumber,
        qty,
        orderedQty: line.orderedQty || qty,
        pickedQty: line.pickedQty,
        unitWeightLbs: unitLbs,
        totalWeightLbs: Math.round(qty * unitLbs),
        isCabItem: isCab,
        isHeavyBaseLayer: isHeavy,
        isTopLayerLight: isLightTop,
        palletLayerFraction: layerFrac,
      };

      if (isCab) {
        cabParts.push(alloc);
      } else {
        palletParts.push(alloc);
      }

      if (
        line.pickedQty !== null &&
        line.pickedQty !== undefined &&
        line.orderedQty > 0 &&
        line.pickedQty < line.orderedQty
      ) {
        specialAlerts.push({
          stopOrder,
          accountName: stop.accountName,
          city: stop.city,
          alertText: `Short Pick on ${line.partNumber}: Picked ${line.pickedQty} of ${line.orderedQty} ordered`,
          kind: "short_pick",
        });
      }
    }

    if (isJunkPickup) {
      coreBayStops.push({ ...stop, order: stopOrder });
    }

    if (palletParts.length > 0 || cabParts.length > 0) {
      totalBatteryStopsCount++;
      if (stop.pickedBy && stop.pickedBy.trim()) {
        pickedStopsCount++;
        pickedBySet.add(stop.pickedBy.trim());
      }
    }

    // Check special dealer notes / instructions
    const combinedText = `${stop.accountName} ${stop.notes || ""}`;
    if (/DO\s*NOT\s*REC(?:EI|IE)VE\s*CORES|NO\s*CORES/i.test(combinedText)) {
      specialAlerts.push({
        stopOrder,
        accountName: stop.accountName,
        city: stop.city,
        alertText: "DO NOT RECEIVE CORES at this stop",
        kind: "no_cores",
      });
    }
    if (/SIGNATURE/i.test(combinedText)) {
      specialAlerts.push({
        stopOrder,
        accountName: stop.accountName,
        city: stop.city,
        alertText: "Customer signature required on delivery ticket",
        kind: "signature",
      });
    }
    if (/PO\s*#|INCLUDE\s*PO/i.test(combinedText)) {
      specialAlerts.push({
        stopOrder,
        accountName: stop.accountName,
        city: stop.city,
        alertText: `Include PO# on ticket${stop.poNumber ? ` (PO: ${stop.poNumber})` : ""}`,
        kind: "po_ticket",
      });
    }
    if (/ROTATE|RACK/i.test(combinedText)) {
      specialAlerts.push({
        stopOrder,
        accountName: stop.accountName,
        city: stop.city,
        alertText: stop.notes || "Rotate & put batteries on racks",
        kind: "note",
      });
    }

    const cabPieces = cabParts.reduce((s, p) => s + p.qty, 0);
    const cabWeightLbs = cabParts.reduce((s, p) => s + p.totalWeightLbs, 0);
    if (cabParts.length > 0) {
      cabAllocations.push({
        stop: { ...stop, order: stopOrder },
        stopOrder,
        parts: cabParts,
        totalPieces: cabPieces,
        totalWeightLbs: cabWeightLbs,
      });
    }

    if (palletParts.length > 0) {
      const palletPieces = palletParts.reduce((s, p) => s + p.qty, 0);
      const palletWeightLbs = palletParts.reduce((s, p) => s + p.totalWeightLbs, 0);
      const palletLayersUsed = palletParts.reduce((s, p) => s + p.palletLayerFraction, 0);

      const hasHeavy = palletParts.some((p) => p.isHeavyBaseLayer);
      const hasLightTop = palletParts.some((p) => p.isTopLayerLight);
      const layerPlacementHint = hasHeavy
        ? "⬇️ Heavy Commercial (8D/4D/31/GC2) — Load on Bottom Layer"
        : hasLightTop
          ? "⬆️ Compact / Powersports — Stack on Top / Edge Layer"
          : "📦 Standard Automotive Stack";

      palletStopCandidates.push({
        stop: { ...stop, order: stopOrder },
        stopOrder,
        zone: "rear_pallet",
        isManualOverride: false,
        palletParts,
        cabParts,
        isJunkPickup,
        palletPieces,
        palletWeightLbs,
        cabPieces,
        cabWeightLbs,
        palletLayersUsed,
        layerPlacementHint,
        specialAlerts: [],
      });
    }
  }

  // Partition pallet stops between Rear Pallet (Early Stops -> Rear Barn Doors)
  // and Front Pallet (Later Stops -> Passenger Side Sliding Door), balancing weight/layers
  const totalCandidateWeight = palletStopCandidates.reduce(
    (s, c) => s + c.palletWeightLbs,
    0,
  );
  let cumulativeRearWeight = 0;

  for (let idx = 0; idx < palletStopCandidates.length; idx++) {
    const item = palletStopCandidates[idx];
    const manual = manualZoneOverrides[item.stop.id];
    if (manual === "front_pallet" || manual === "rear_pallet") {
      item.zone = manual;
      item.isManualOverride = true;
      continue;
    }

    if (palletStopCandidates.length === 1) {
      item.zone = "rear_pallet";
      continue;
    }

    // Place early stops on Rear Pallet until ~half the route weight or half the stops are on the Rear Pallet
    const isFirstHalfStop = idx < Math.ceil(palletStopCandidates.length / 2);
    const fitsRearWeight =
      idx === 0 || cumulativeRearWeight + item.palletWeightLbs * 0.6 <= totalCandidateWeight * 0.55;

    if (isFirstHalfStop && fitsRearWeight) {
      item.zone = "rear_pallet";
      cumulativeRearWeight += item.palletWeightLbs;
    } else {
      item.zone = "front_pallet";
    }
  }

  const rearPalletStops = palletStopCandidates.filter((c) => c.zone === "rear_pallet");
  const frontPalletStops = palletStopCandidates.filter((c) => c.zone === "front_pallet");

  // Compute active remaining metrics based on completedThroughStopOrder
  const isStopRemaining = (stopOrder: number, stop: HotShotStop) =>
    completedThroughStopOrder > 0
      ? stopOrder > completedThroughStopOrder
      : !stop.completedAt;

  const activeCab = cabAllocations.filter((c) => isStopRemaining(c.stopOrder, c.stop));
  const activeFront = frontPalletStops.filter((c) => isStopRemaining(c.stopOrder, c.stop));
  const activeRear = rearPalletStops.filter((c) => isStopRemaining(c.stopOrder, c.stop));

  const cabWeightLbs = activeCab.reduce((s, c) => s + c.totalWeightLbs, 0);
  const cabPieces = activeCab.reduce((s, c) => s + c.totalPieces, 0);

  const frontPalletWeightLbs = activeFront.reduce((s, c) => s + c.palletWeightLbs, 0);
  const frontPalletPieces = activeFront.reduce((s, c) => s + c.palletPieces, 0);
  const frontPalletLayers = Number(
    activeFront.reduce((s, c) => s + c.palletLayersUsed, 0).toFixed(1),
  );

  const rearPalletWeightLbs = activeRear.reduce((s, c) => s + c.palletWeightLbs, 0);
  const rearPalletPieces = activeRear.reduce((s, c) => s + c.palletPieces, 0);
  const rearPalletLayers = Number(
    activeRear.reduce((s, c) => s + c.palletLayersUsed, 0).toFixed(1),
  );

  const totalWeightLbs = cabWeightLbs + frontPalletWeightLbs + rearPalletWeightLbs;
  const totalPieces = cabPieces + frontPalletPieces + rearPalletPieces;

  // 1 standard pallet holds ~2.0 layers sustainably
  const totalLayersAll = frontPalletLayers + rearPalletLayers;
  const totalPalletEquivalents = Number((totalLayersAll / 2.0).toFixed(1));

  const isOverflowWarning =
    totalWeightLbs > 3300 || frontPalletLayers > 2.6 || rearPalletLayers > 2.6;
  const overflowReason =
    totalWeightLbs > 3300
      ? `Total load (~${totalWeightLbs.toLocaleString()} lbs) exceeds 3,300 lb recommended single-van payload`
      : frontPalletLayers > 2.6
        ? `Front Pallet (~${frontPalletLayers} layers) exceeds standard 2.5-layer pallet height`
        : rearPalletLayers > 2.6
          ? `Rear Pallet (~${rearPalletLayers} layers) exceeds standard 2.5-layer pallet height`
          : null;

  // Build Consolidated Master Warehouse Rack Pull List (grouped by Part Number)
  const pullMap = new Map<string, MasterPullPartSummary>();
  const recordPull = (
    partAlloc: VanPartAllocation,
    stopOrder: number,
    zoneLabel: string,
    stopHasPickedBy: boolean,
  ) => {
    const key = partAlloc.partNumber.toUpperCase();
    const existing = pullMap.get(key);
    const pickedVal =
      partAlloc.pickedQty !== null && partAlloc.pickedQty !== undefined
        ? partAlloc.pickedQty
        : stopHasPickedBy
          ? partAlloc.qty
          : 0;
    if (existing) {
      existing.totalQty += partAlloc.qty;
      existing.totalOrderedQty += partAlloc.orderedQty;
      existing.totalPickedQty += pickedVal;
      if (!stopHasPickedBy) existing.hasUnpickedStop = true;
      existing.totalWeightLbs += partAlloc.totalWeightLbs;
      if (!existing.stopNumbers.includes(stopOrder)) {
        existing.stopNumbers.push(stopOrder);
      }
      if (!existing.targetZoneLabel.includes(zoneLabel)) {
        existing.targetZoneLabel = `${existing.targetZoneLabel} + ${zoneLabel}`;
      }
    } else {
      pullMap.set(key, {
        partNumber: partAlloc.partNumber,
        totalQty: partAlloc.qty,
        totalOrderedQty: partAlloc.orderedQty,
        totalPickedQty: pickedVal,
        hasUnpickedStop: !stopHasPickedBy,
        unitWeightLbs: partAlloc.unitWeightLbs,
        totalWeightLbs: partAlloc.totalWeightLbs,
        targetZoneLabel: zoneLabel,
        stopNumbers: [stopOrder],
        isHeavyBaseLayer: partAlloc.isHeavyBaseLayer,
        isCabItem: partAlloc.isCabItem,
      });
    }
  };

  for (const fStop of frontPalletStops) {
    const hasPicker = Boolean(fStop.stop.pickedBy && fStop.stop.pickedBy.trim());
    for (const p of fStop.palletParts) {
      recordPull(p, fStop.stopOrder, "Front Pallet", hasPicker);
    }
  }
  for (const rStop of rearPalletStops) {
    const hasPicker = Boolean(rStop.stop.pickedBy && rStop.stop.pickedBy.trim());
    for (const p of rStop.palletParts) {
      recordPull(p, rStop.stopOrder, "Rear Pallet", hasPicker);
    }
  }
  for (const cStop of cabAllocations) {
    const hasPicker = Boolean(cStop.stop.pickedBy && cStop.stop.pickedBy.trim());
    for (const p of cStop.parts) {
      recordPull(p, cStop.stopOrder, "Driver Cab", hasPicker);
    }
  }

  // Sort Master Pull List: Heavy Base Layer first, then Standard Pallet parts by quantity, then Cab items
  const masterPullList = Array.from(pullMap.values()).sort((a, b) => {
    if (a.isCabItem !== b.isCabItem) return a.isCabItem ? 1 : -1;
    if (a.isHeavyBaseLayer !== b.isHeavyBaseLayer) return a.isHeavyBaseLayer ? -1 : 1;
    return b.totalWeightLbs - a.totalWeightLbs;
  });

  return {
    cabAllocations,
    frontPalletStops,
    rearPalletStops,
    coreBayStops,
    masterPullList,
    specialAlerts,
    metrics: {
      cabWeightLbs,
      cabPieces,
      frontPalletWeightLbs,
      frontPalletPieces,
      frontPalletLayers,
      rearPalletWeightLbs,
      rearPalletPieces,
      rearPalletLayers,
      totalWeightLbs,
      totalPieces,
      totalPalletEquivalents,
      isOverflowWarning,
      overflowReason,
      pickedStopsCount,
      totalBatteryStopsCount,
      pickedByNames: Array.from(pickedBySet),
    },
  };
}
