import fs from "fs";
import path from "path";
import {
  type HotShotOriginHub,
  DEFAULT_HOTSHOT_HUBS,
  getCentralDateISO,
  stripLocationPrefix,
  matchHotShotDriverToRoster,
  haversineMiles,
  estimateSinglePartWeightLbs,
  estimateStopWeightAndPieces,
} from "@shared/hotshots";
import { getDisplayState } from "./displayService";
import { lookupKnownTownCoords } from "@shared/routeTerritories";
import { log } from "./app";

const DEFAULT_HSS_BASE_URL = "https://www.hotshotsheet.com";
const DEFAULT_HSS_API_KEY = "";
const HISTORY_FILE_PATH = path.resolve(process.cwd(), "data", "hotshot-history.json");
const EARLIEST_HSS_DATE_ISO = "2015-07-16";

export type HistoricalDeliveryType = "hotshot" | "route_truck" | "ups_shipping";

export interface HotShotHistoricalPart {
  partNumber: string;
  description: string;
  qty: number;
  unitWeightLbs: number;
}

export interface HotShotHistoricalDelivery {
  key: string;
  deliveryId: number;
  dateISO: string;
  sheetNum: number;
  stopOrder: number;
  dealerId: number;
  dealerNumber: string;
  accountName: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  lat: number | null;
  lon: number | null;
  driverId: number;
  rawDriverName: string;
  driverName: string;
  originHub: HotShotOriginHub;
  deliveryType: HistoricalDeliveryType;
  poNumber: string;
  notes: string;
  partsSummary: string;
  piecesCount: number;
  estimatedWeightLbs: number;
  parts: HotShotHistoricalPart[];
}

export interface HotShotCustomerAccountSummary {
  customerKey: string;
  dealerNumber: string;
  dealerId: number;
  accountName: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  lat: number | null;
  lon: number | null;
  primaryHub: HotShotOriginHub;
  uniqueVisitDays: number;
  allTimeVisitDays: number;
  totalDeliveries: number;
  visitsLast30d: number;
  visitsLast90d: number;
  visitsLast365d: number;
  totalPieces: number;
  totalWeightLbs: number;
  firstVisitDateISO: string;
  lastVisitDateISO: string;
  daysSinceLastVisit: number;
  avgDaysBetweenVisits: number | null;
  maxGapDays: number | null;
  lastDriverName: string;
  deliveryTypeBreakdown: {
    hotshot: number;
    route_truck: number;
    ups_shipping: number;
  };
  topDrivers: Array<{ driverName: string; visits: number }>;
  topParts: Array<{ partNumber: string; description: string; totalQty: number; orderCount: number }>;
}

export interface HotShotHistoryBackfillStatus {
  isBackfilling: boolean;
  activePreset: string | null;
  completedDays: number;
  totalDaysToFetch: number;
  totalIndexedDays: number;
  totalDeliveriesIndexed: number;
  totalUniqueCustomers: number;
  earliestIndexedDateISO: string | null;
  latestIndexedDateISO: string | null;
  lastUpdatedAt: string | null;
  lastError: string | null;
}

interface PersistedHistoryStore {
  version: number;
  indexedDates: string[];
  deliveries: HotShotHistoricalDelivery[];
  updatedAt: string;
}

const indexedDatesSet = new Set<string>();
const deliveriesByKey = new Map<string, HotShotHistoricalDelivery>();

let isLoadedFromDisk = false;
let saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;

let backfillState: {
  isBackfilling: boolean;
  cancelRequested: boolean;
  activePreset: string | null;
  completedDays: number;
  totalDaysToFetch: number;
  lastUpdatedAt: string | null;
  lastError: string | null;
} = {
  isBackfilling: false,
  cancelRequested: false,
  activePreset: null,
  completedDays: 0,
  totalDaysToFetch: 0,
  lastUpdatedAt: null,
  lastError: null,
};

function getApiKey(): string {
  return (process.env.HOTSHOTSHEET_API_KEY || DEFAULT_HSS_API_KEY).trim();
}

function getBaseUrl(): string {
  return (process.env.HOTSHOTSHEET_BASE_URL || DEFAULT_HSS_BASE_URL)
    .trim()
    .replace(/\/+$/, "");
}

function titleCaseCity(raw: string): string {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "";
  if (trimmed === trimmed.toUpperCase()) {
    return trimmed
      .toLowerCase()
      .replace(/\b([a-z])/g, (_, ch: string) => ch.toUpperCase());
  }
  return trimmed;
}

function cleanDealerNameAndNote(rawName: string): {
  accountName: string;
  inlineNote?: string;
} {
  let name = String(rawName || "Customer Delivery").trim();
  let inlineNote: string | undefined;
  const starMatch = name.match(/\*\*([^*]+)\*\*/);
  if (starMatch) {
    inlineNote = starMatch[1].trim();
    name = name.replace(/\*\*[^*]+\*\*/g, "").trim();
  }
  return { accountName: name || "Customer Delivery", inlineNote };
}

function formatCleanPhone(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s || /^n\/?a$/i.test(s)) return "";
  const digits = s.replace(/\D/g, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return s;
}

function classifyDeliveryType(rawDriverName: string): HistoricalDeliveryType {
  const s = String(rawDriverName || "").trim();
  if (/\b(?:ups|fedex|ship|freight|spee-?dee)\b/i.test(s)) {
    return "ups_shipping";
  }
  if (
    /\b(?:bomgaars|monday|tuesday|wednesday|thursday|friday|mon|tue|wed|thu|fri|route)\b/i.test(s) ||
    /\b(?:swede|sonny|brandon\s+prouty|troy\s+casper|ron\s+king|nate\s+chamberlain|erik\s+wuestewald|seth\s+madsen|jerrad\s+swier|glen\s+bakker|tyler\s+dean|justin\s+hoff)\b/i.test(
      s,
    )
  ) {
    return "route_truck";
  }
  return "hotshot";
}

function inferHub(
  rawDriverName: string,
  sfRosterNames: string[],
  coords: { lat: number; lon: number } | null,
): HotShotOriginHub {
  const s = String(rawDriverName || "").trim();
  if (/(?:^|\b)(?:arl|arlington)(?:\b|$)/i.test(s)) return "arlington";
  if (/(?:^|\b)(?:sf|sioux\s+falls)(?:\b|$)/i.test(s)) return "sioux_falls";

  const cleaned = stripLocationPrefix(s).toLowerCase();
  if (
    cleaned &&
    sfRosterNames.some((r) => {
      const rl = r.trim().toLowerCase();
      return rl === cleaned || rl.startsWith(cleaned.split(/\s+/)[0] || "___");
    })
  ) {
    return "sioux_falls";
  }

  if (coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lon) && Math.abs(coords.lat) > 1) {
    const distArl = haversineMiles(
      DEFAULT_HOTSHOT_HUBS.arlington.latitude,
      DEFAULT_HOTSHOT_HUBS.arlington.longitude,
      coords.lat,
      coords.lon,
    );
    const distSf = haversineMiles(
      DEFAULT_HOTSHOT_HUBS.sioux_falls.latitude,
      DEFAULT_HOTSHOT_HUBS.sioux_falls.longitude,
      coords.lat,
      coords.lon,
    );
    if (distArl + 8 < distSf) return "arlington";
  }

  return "sioux_falls";
}

export function buildCustomerKey(record: {
  dealerNumber?: string;
  dealerId?: number;
  accountName?: string;
  city?: string;
}): string {
  if (record.dealerId && Number(record.dealerId) > 0) {
    return `dlr-${Number(record.dealerId)}`;
  }
  const cleanCity = String(record.city || "sd")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const num = String(record.dealerNumber || "")
    .trim()
    .replace(/^n\/?a$/i, "");
  if (num.length >= 4) {
    return `acct-${num}-${cleanCity}`;
  }
  const cleanName = String(record.accountName || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `name-${cleanName}-${cleanCity}`;
}

function isValidUpperMidwestCoord(lat: number | null, lon: number | null): boolean {
  if (lat === null || lon === null) return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  // Upper Midwest delivery territory bounding box (SD, MN, IA, ND, NE, WY, MT, WI)
  return lat >= 40.0 && lat <= 49.5 && lon >= -106.0 && lon <= -89.0;
}

function sanitizeMidwestCoordinates(
  lat: number | null,
  lon: number | null,
  _address: string,
  city: string,
  stateCode: string,
): { lat: number | null; lon: number | null } {
  if (isValidUpperMidwestCoord(lat, lon)) {
    return { lat, lon };
  }
  const fallback = lookupKnownTownCoords(city || "Sioux Falls", stateCode || "SD");
  if (fallback && isValidUpperMidwestCoord(fallback.lat, fallback.lon)) {
    return { lat: fallback.lat, lon: fallback.lon };
  }
  return { lat: null, lon: null };
}

function resolveHistoricalDriverName(
  rawDriverName: string,
  dateISO: string,
  originHub: HotShotOriginHub,
  sfRosterNames: string[],
): string {
  const rawTrimmed = String(rawDriverName || "").trim();
  const strippedDriver = stripLocationPrefix(rawTrimmed);

  // Disambiguate former driver "SF Mike" (2016–2021) from current driver "SF Mikey" (Michael DeWeerd, started July 2026)
  if (/^sf\s+mike$/i.test(rawTrimmed) || (/^mike$/i.test(strippedDriver) && dateISO < "2025-01-01")) {
    return "Mike (2016–2021)";
  }
  if (/^(?:sf\s+)?mikey$/i.test(rawTrimmed)) {
    return "Michael DeWeerd";
  }

  const isGenericBucket = /^(?:hot\s*shot(?:\s*\d+)?)$/i.test(strippedDriver);
  const cleanDriverFallback = isGenericBucket ? rawTrimmed : strippedDriver || rawTrimmed;
  if (originHub === "arlington") {
    return cleanDriverFallback;
  }
  return matchHotShotDriverToRoster(rawTrimmed, sfRosterNames) || cleanDriverFallback;
}

function ensureLoadedFromDisk() {
  if (isLoadedFromDisk) return;
  isLoadedFromDisk = true;
  try {
    if (!fs.existsSync(HISTORY_FILE_PATH)) return;
    const raw = fs.readFileSync(HISTORY_FILE_PATH, "utf-8");
    const parsed = JSON.parse(raw) as PersistedHistoryStore;
    if (Array.isArray(parsed?.indexedDates)) {
      for (const d of parsed.indexedDates) {
        if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
          indexedDatesSet.add(d);
        }
      }
    }
    let repairedRecords = 0;
    if (Array.isArray(parsed?.deliveries)) {
      for (const item of parsed.deliveries) {
        if (item?.key) {
          // Repair historical driver disambiguation ("SF Mike" 2016-2021 vs "SF Mikey" / Michael DeWeerd 2026)
          if (
            /^sf\s+mike$/i.test(item.rawDriverName || "") &&
            item.driverName !== "Mike (2016–2021)"
          ) {
            item.driverName = "Mike (2016–2021)";
            repairedRecords++;
          } else if (
            /^(?:sf\s+)?mikey$/i.test(item.rawDriverName || "") &&
            item.driverName !== "Michael DeWeerd"
          ) {
            item.driverName = "Michael DeWeerd";
            repairedRecords++;
          }

          // Repair out-of-region coordinates (e.g. Seattle WA / Kansas / Oklahoma geocoding errors in HotShotSheet)
          if (!isValidUpperMidwestCoord(item.lat, item.lon)) {
            const cleanCoords = sanitizeMidwestCoordinates(
              item.lat,
              item.lon,
              item.address,
              item.city,
              item.state,
            );
            if (cleanCoords.lat !== item.lat || cleanCoords.lon !== item.lon) {
              item.lat = cleanCoords.lat;
              item.lon = cleanCoords.lon;
              repairedRecords++;
            }
          }

          deliveriesByKey.set(item.key, item);
        }
      }
    }
    log(
      `Loaded HotShot history store: ${deliveriesByKey.size} deliveries across ${indexedDatesSet.size} indexed days${
        repairedRecords > 0 ? ` (repaired ${repairedRecords} driver/coord records)` : ""
      }`,
      "hotshot-history",
    );
    if (repairedRecords > 0) {
      scheduleSaveToDisk();
    }
  } catch (err: any) {
    log(`Warning loading hotshot-history.json: ${err?.message}`, "hotshot-history");
  }
}

function scheduleSaveToDisk() {
  if (saveDebounceTimer) return;
  saveDebounceTimer = setTimeout(() => {
    saveDebounceTimer = null;
    flushSaveToDisk();
  }, 1500);
}

function flushSaveToDisk() {
  try {
    const dir = path.dirname(HISTORY_FILE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const payload: PersistedHistoryStore = {
      version: 1,
      indexedDates: Array.from(indexedDatesSet).sort(),
      deliveries: Array.from(deliveriesByKey.values()),
      updatedAt: new Date().toISOString(),
    };
    const tmpPath = `${HISTORY_FILE_PATH}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(payload), "utf-8");
    fs.renameSync(tmpPath, HISTORY_FILE_PATH);
  } catch (err: any) {
    log(`Failed saving hotshot-history.json: ${err?.message}`, "hotshot-history");
  }
}

export function ingestDeliveriesPayload(
  dateISO: string,
  payload: any,
  sfRosterNames: string[] = [],
): number {
  ensureLoadedFromDisk();
  const drivers: any[] = Array.isArray(payload?.Drivers) ? payload.Drivers : [];

  // Remove existing entries for this dateISO before re-inserting so updated stops don't duplicate
  for (const [k, existing] of Array.from(deliveriesByKey.entries())) {
    if (existing.dateISO === dateISO) {
      deliveriesByKey.delete(k);
    }
  }

  let addedCount = 0;

  for (const drv of drivers) {
    const driverId = Number(drv?.DriverId) || 0;
    const rawDriverName = `${drv?.DriverFirstName || ""} ${drv?.DriverLastName || ""}`
      .replace(/\s+/g, " ")
      .trim();
    const sheets: any[] = Array.isArray(drv?.Sheets) ? drv.Sheets : [];
    if (sheets.length === 0) continue;

    for (const sh of sheets) {
      const sheetNum = Number(sh?.SheetNum) || 1;
      const stopOrder = Number(sh?.DeliveryOrder) || 1;
      const del = sh?.Delivery || {};
      const dlr = del?.Dealer || {};
      const deliveryId = Number(del?.DeliveryId || sh?.DeliveryId) || 0;

      const { accountName, inlineNote } = cleanDealerNameAndNote(dlr?.DealerName);
      const dealerId = Number(dlr?.DealerId || del?.DealerId) || 0;
      const rawDealerNumber = String(dlr?.DealerNumber || "")
        .trim()
        .replace(/^n\/?a$/i, "");
      const city = titleCaseCity(dlr?.DealerCity || "Sioux Falls");
      const stateCode = String(dlr?.DealerState || "SD").trim().toUpperCase();
      const address = String(dlr?.DealerAddress || "").trim();
      const zip = String(dlr?.DealerZip || "").trim();
      const phone = formatCleanPhone(dlr?.DealerPhone);

      const latRaw = Number(dlr?.DealerLat);
      const lonRaw = Number(dlr?.DealerLong);
      const rawHasCoords =
        Number.isFinite(latRaw) &&
        Number.isFinite(lonRaw) &&
        Math.abs(latRaw) > 1 &&
        Math.abs(lonRaw) > 1;
      const sanitizedCoords = sanitizeMidwestCoordinates(
        rawHasCoords ? latRaw : null,
        rawHasCoords ? lonRaw : null,
        address,
        city,
        stateCode,
      );

      const originHub = inferHub(
        rawDriverName,
        sfRosterNames,
        sanitizedCoords.lat !== null && sanitizedCoords.lon !== null
          ? { lat: sanitizedCoords.lat, lon: sanitizedCoords.lon }
          : null,
      );

      const driverName = resolveHistoricalDriverName(
        rawDriverName,
        dateISO,
        originHub,
        sfRosterNames,
      );

      const deliveryParts: any[] = Array.isArray(del?.DeliveryParts)
        ? del.DeliveryParts
        : [];
      const parts: HotShotHistoricalPart[] = [];
      const partLabels: string[] = [];
      let totalPieces = 0;

      for (const dp of deliveryParts) {
        if (!dp) continue;
        const ordered = Number(dp.DPartOrderQuan) || 0;
        const pickedRaw = dp.DPartPickedQuan;
        const hasPicked =
          pickedRaw !== null &&
          pickedRaw !== undefined &&
          Number.isFinite(Number(pickedRaw));
        const picked = hasPicked ? Number(pickedRaw) : ordered;
        const qty = picked > 0 ? picked : ordered;
        const partNumber = String(dp.Part?.PartNumber || dp.Part?.PartDesc || "Part").trim();
        const description = String(dp.Part?.PartDesc || partNumber).trim();
        if (partNumber) {
          const unitWeightLbs = Math.round(estimateSinglePartWeightLbs(partNumber) * 10) / 10;
          parts.push({
            partNumber,
            description,
            qty,
            unitWeightLbs,
          });
          partLabels.push(qty > 0 ? `${partNumber} (${qty})` : partNumber);
          totalPieces += qty;
        }
      }

      const partsSummary = partLabels.join(" • ");
      const rawNote = String(
        del?.Notes || del?.DeliveryNotes || del?.FulfillmentNotes || "",
      ).trim();
      const combinedNote = [inlineNote, rawNote].filter(Boolean).join(" • ");
      const poNumber = String(del?.PONum || del?.DeliveryPO || "")
        .trim()
        .replace(/^n\/?a$/i, "");

      const loadEst = estimateStopWeightAndPieces({
        partsSummary,
        piecesCount: totalPieces,
      });

      const key = `${dateISO}:${driverId}:${sheetNum}:${deliveryId || stopOrder}`;

      deliveriesByKey.set(key, {
        key,
        deliveryId,
        dateISO,
        sheetNum,
        stopOrder,
        dealerId,
        dealerNumber: rawDealerNumber,
        accountName,
        address,
        city,
        state: stateCode,
        zip,
        phone,
        lat: sanitizedCoords.lat,
        lon: sanitizedCoords.lon,
        driverId,
        rawDriverName,
        driverName,
        originHub,
        deliveryType: classifyDeliveryType(rawDriverName),
        poNumber,
        notes: combinedNote,
        partsSummary,
        piecesCount: loadEst.pieces,
        estimatedWeightLbs: loadEst.weightLbs,
        parts,
      });
      addedCount++;
    }
  }

  indexedDatesSet.add(dateISO);
  backfillState.lastUpdatedAt = new Date().toISOString();
  scheduleSaveToDisk();
  return addedCount;
}

async function fetchHssDayPayload(dateISO: string): Promise<any> {
  const [y, m, d] = dateISO.split("-").map(Number);
  const url = `${getBaseUrl()}/API/Deliveries?Year=${y}&Month=${m}&Day=${d}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      APIkey: getApiKey(),
      Accept: "application/json",
      "User-Agent": "IBS-SouthDakota-FleetTracker/1.0",
    },
    signal: AbortSignal.timeout(18_000),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

function buildMissingDatesForPreset(
  preset: "90d" | "1y" | "3y" | "all_2015",
  now = new Date(),
): string[] {
  ensureLoadedFromDisk();
  const todayISO = getCentralDateISO(now);
  let daysBack = 90;
  if (preset === "1y") daysBack = 365;
  else if (preset === "3y") daysBack = 365 * 3;
  else if (preset === "all_2015") daysBack = 4200;

  const missing: string[] = [];
  for (let i = 0; i <= daysBack; i++) {
    const dt = new Date(now.getTime() - i * 24 * 3600_000);
    // Skip Sundays (day 0) since IBS HotShotSheet routes run Mon-Fri (and occasional Sat)
    if (dt.getDay() === 0) continue;
    const iso = getCentralDateISO(dt);
    if (iso < EARLIEST_HSS_DATE_ISO) break;
    // Always re-fetch today and yesterday; skip older dates already in indexedDatesSet
    if (i > 1 && indexedDatesSet.has(iso) && iso !== todayISO) {
      continue;
    }
    missing.push(iso);
  }
  return missing;
}

export async function startHotShotHistoryBackfill(
  preset: "90d" | "1y" | "3y" | "all_2015" = "90d",
): Promise<HotShotHistoryBackfillStatus> {
  ensureLoadedFromDisk();
  if (backfillState.isBackfilling) {
    return getHotShotHistoryBackfillStatus();
  }

  const datesToFetch = buildMissingDatesForPreset(preset);
  if (datesToFetch.length === 0) {
    backfillState.lastUpdatedAt = new Date().toISOString();
    return getHotShotHistoryBackfillStatus();
  }

  backfillState.isBackfilling = true;
  backfillState.cancelRequested = false;
  backfillState.activePreset = preset;
  backfillState.completedDays = 0;
  backfillState.totalDaysToFetch = datesToFetch.length;
  backfillState.lastError = null;

  // Run asynchronously in the background
  (async () => {
    try {
      const state = await getDisplayState().catch(() => null);
      const sfRosterSet = new Set<string>();
      for (const item of state?.sfSchedule?.memberRoster || []) {
        if (item?.name) sfRosterSet.add(String(item.name).trim());
      }
      const sfRosterNames = Array.from(sfRosterSet);

      const CONCURRENCY = 4;
      for (let i = 0; i < datesToFetch.length; i += CONCURRENCY) {
        if (backfillState.cancelRequested) break;
        const batch = datesToFetch.slice(i, i + CONCURRENCY);
        await Promise.all(
          batch.map(async (iso) => {
            if (backfillState.cancelRequested) return;
            try {
              const payload = await fetchHssDayPayload(iso);
              ingestDeliveriesPayload(iso, payload, sfRosterNames);
            } catch (err: any) {
              backfillState.lastError = `${iso}: ${err?.message || "fetch error"}`;
            } finally {
              backfillState.completedDays++;
            }
          }),
        );
        // Gentle 120ms pause between batches of 4 days
        await new Promise((r) => setTimeout(r, 120));
      }
      flushSaveToDisk();
      log(
        `HotShot history backfill (${preset}) finished: ${deliveriesByKey.size} deliveries across ${indexedDatesSet.size} days`,
        "hotshot-history",
      );
    } catch (err: any) {
      backfillState.lastError = err?.message || "Backfill error";
    } finally {
      backfillState.isBackfilling = false;
      backfillState.activePreset = null;
      backfillState.lastUpdatedAt = new Date().toISOString();
    }
  })();

  return getHotShotHistoryBackfillStatus();
}

export function stopHotShotHistoryBackfill(): HotShotHistoryBackfillStatus {
  if (backfillState.isBackfilling) {
    backfillState.cancelRequested = true;
  }
  return getHotShotHistoryBackfillStatus();
}

export function getHotShotHistoryBackfillStatus(): HotShotHistoryBackfillStatus {
  ensureLoadedFromDisk();
  const sortedDates = Array.from(indexedDatesSet).sort();
  const customerKeys = new Set<string>();
  for (const d of Array.from(deliveriesByKey.values())) {
    customerKeys.add(buildCustomerKey(d));
  }
  return {
    isBackfilling: backfillState.isBackfilling,
    activePreset: backfillState.activePreset,
    completedDays: backfillState.completedDays,
    totalDaysToFetch: backfillState.totalDaysToFetch,
    totalIndexedDays: indexedDatesSet.size,
    totalDeliveriesIndexed: deliveriesByKey.size,
    totalUniqueCustomers: customerKeys.size,
    earliestIndexedDateISO: sortedDates[0] || null,
    latestIndexedDateISO: sortedDates[sortedDates.length - 1] || null,
    lastUpdatedAt: backfillState.lastUpdatedAt,
    lastError: backfillState.lastError,
  };
}

function diffCalendarDays(dateA: string, dateB: string): number {
  const a = new Date(`${dateA}T12:00:00Z`).getTime();
  const b = new Date(`${dateB}T12:00:00Z`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round(Math.abs(b - a) / (24 * 3600_000)));
}

export interface QueryCustomerHistoryOptions {
  days?: number | "all";
  hub?: "all" | HotShotOriginHub;
  deliveryType?: "all" | HistoricalDeliveryType;
  search?: string;
  sort?: "visits" | "recent" | "batteries" | "frequency";
  limit?: number;
}

export function queryCustomerHistorySummaries(
  options: QueryCustomerHistoryOptions = {},
): {
  status: HotShotHistoryBackfillStatus;
  totals: {
    matchingCustomers: number;
    matchingDeliveries: number;
    matchingBatteries: number;
    matchingWeightLbs: number;
    topCities: Array<{ city: string; state: string; visits: number; customers: number }>;
  };
  customers: HotShotCustomerAccountSummary[];
} {
  ensureLoadedFromDisk();
  const todayISO = getCentralDateISO(new Date());
  const cutoff30ISO = getCentralDateISO(new Date(Date.now() - 30 * 24 * 3600_000));
  const cutoff90ISO = getCentralDateISO(new Date(Date.now() - 90 * 24 * 3600_000));
  const cutoff365ISO = getCentralDateISO(new Date(Date.now() - 365 * 24 * 3600_000));

  const windowCutoffISO =
    typeof options.days === "number" && options.days > 0
      ? getCentralDateISO(new Date(Date.now() - options.days * 24 * 3600_000))
      : null;

  const hubFilter = options.hub && options.hub !== "all" ? options.hub : null;
  const typeFilter =
    options.deliveryType && options.deliveryType !== "all" ? options.deliveryType : null;
  const searchLower = String(options.search || "")
    .trim()
    .toLowerCase();

  // Group deliveries by customerKey
  const byCustomer = new Map<
    string,
    {
      allTime: HotShotHistoricalDelivery[];
      inWindow: HotShotHistoricalDelivery[];
    }
  >();

  for (const del of Array.from(deliveriesByKey.values())) {
    if (hubFilter && del.originHub !== hubFilter) continue;
    if (typeFilter && del.deliveryType !== typeFilter) continue;

    if (searchLower) {
      const hay = `${del.accountName} ${del.dealerNumber} ${del.city} ${del.state} ${del.driverName} ${del.rawDriverName} ${del.partsSummary} ${del.poNumber}`.toLowerCase();
      if (!hay.includes(searchLower)) continue;
    }

    const cKey = buildCustomerKey(del);
    let bucket = byCustomer.get(cKey);
    if (!bucket) {
      bucket = { allTime: [], inWindow: [] };
      byCustomer.set(cKey, bucket);
    }
    bucket.allTime.push(del);
    if (!windowCutoffISO || del.dateISO >= windowCutoffISO) {
      bucket.inWindow.push(del);
    }
  }

  const summaries: HotShotCustomerAccountSummary[] = [];
  let matchingDeliveries = 0;
  let matchingBatteries = 0;
  let matchingWeightLbs = 0;
  const cityStats = new Map<string, { city: string; state: string; visits: number; customers: Set<string> }>();

  for (const [cKey, bucket] of Array.from(byCustomer.entries())) {
    if (bucket.inWindow.length === 0) continue;

    // Sort chronologically descending (newest first)
    const sortedWindow = [...bucket.inWindow].sort((a, b) =>
      b.dateISO.localeCompare(a.dateISO),
    );
    const sortedAll = [...bucket.allTime].sort((a, b) =>
      b.dateISO.localeCompare(a.dateISO),
    );
    const latest = sortedWindow[0];
    const earliest = sortedWindow[sortedWindow.length - 1];

    const uniqueDatesWindow = Array.from(
      new Set(sortedWindow.map((d) => d.dateISO)),
    ).sort();
    const uniqueDatesAll = Array.from(
      new Set(sortedAll.map((d) => d.dateISO)),
    ).sort();
    const uniqueDates30 = new Set(
      sortedAll.filter((d) => d.dateISO >= cutoff30ISO).map((d) => d.dateISO),
    );
    const uniqueDates90 = new Set(
      sortedAll.filter((d) => d.dateISO >= cutoff90ISO).map((d) => d.dateISO),
    );
    const uniqueDates365 = new Set(
      sortedAll.filter((d) => d.dateISO >= cutoff365ISO).map((d) => d.dateISO),
    );

    const latestAll = sortedAll[0];
    const earliestAll = sortedAll[sortedAll.length - 1];
    const daysSinceLastVisit = diffCalendarDays(latestAll.dateISO, todayISO);

    let maxGapDays: number | null = null;
    if (uniqueDatesAll.length >= 2) {
      let maxG = daysSinceLastVisit;
      for (let i = 1; i < uniqueDatesAll.length; i++) {
        const g = diffCalendarDays(uniqueDatesAll[i - 1], uniqueDatesAll[i]);
        if (g > maxG) maxG = g;
      }
      maxGapDays = maxG;
    }

    // Calculate true recurring visit cadence across ALL recorded visits for this customer
    // plus any trailing drought (daysSinceLastVisit) when greater than the between-visit average.
    // Require at least 3 distinct visit days spanning >= 28 days so a 2-visit backorder cluster never shows as "Every 6d".
    let avgDaysBetweenVisits: number | null = null;
    if (uniqueDatesAll.length >= 3) {
      const spanBetweenAllVisits = diffCalendarDays(
        uniqueDatesAll[0],
        uniqueDatesAll[uniqueDatesAll.length - 1],
      );
      if (spanBetweenAllVisits >= 28) {
        const rawAvg = spanBetweenAllVisits / (uniqueDatesAll.length - 1);
        const effectiveAvg =
          daysSinceLastVisit > rawAvg
            ? (spanBetweenAllVisits + daysSinceLastVisit) / uniqueDatesAll.length
            : rawAvg;
        avgDaysBetweenVisits = Math.round(effectiveAvg * 10) / 10;
      }
    }

    let totalPieces = 0;
    let totalWeightLbs = 0;
    let sfCount = 0;
    let arlCount = 0;
    const typeCounts = { hotshot: 0, route_truck: 0, ups_shipping: 0 };
    const driverMap = new Map<string, number>();
    const partMap = new Map<
      string,
      { partNumber: string; description: string; totalQty: number; orderCount: number }
    >();

    for (const d of sortedWindow) {
      totalPieces += d.piecesCount;
      totalWeightLbs += d.estimatedWeightLbs;
      if (d.originHub === "arlington") arlCount++;
      else sfCount++;
      typeCounts[d.deliveryType] = (typeCounts[d.deliveryType] || 0) + 1;
      driverMap.set(d.driverName, (driverMap.get(d.driverName) || 0) + 1);

      for (const p of d.parts) {
        const existingPart = partMap.get(p.partNumber) || {
          partNumber: p.partNumber,
          description: p.description,
          totalQty: 0,
          orderCount: 0,
        };
        existingPart.totalQty += p.qty;
        existingPart.orderCount += 1;
        partMap.set(p.partNumber, existingPart);
      }
    }

    matchingDeliveries += sortedWindow.length;
    matchingBatteries += totalPieces;
    matchingWeightLbs += totalWeightLbs;

    const cityKey = `${latest.city.toLowerCase()}|${latest.state}`;
    const cStat = cityStats.get(cityKey) || {
      city: latest.city,
      state: latest.state,
      visits: 0,
      customers: new Set<string>(),
    };
    cStat.visits += uniqueDatesWindow.length;
    cStat.customers.add(cKey);
    cityStats.set(cityKey, cStat);

    const bestDealerNumber =
      sortedAll.find((d) => d.dealerNumber)?.dealerNumber || "";
    const bestDealerId =
      sortedAll.find((d) => d.dealerId > 0)?.dealerId || 0;
    const bestPhone = sortedAll.find((d) => d.phone)?.phone || "";
    const bestAddress = sortedAll.find((d) => d.address)?.address || "";

    summaries.push({
      customerKey: cKey,
      dealerNumber: bestDealerNumber,
      dealerId: bestDealerId,
      accountName: latest.accountName,
      address: bestAddress,
      city: latest.city,
      state: latest.state,
      zip: latest.zip,
      phone: bestPhone,
      lat: latest.lat,
      lon: latest.lon,
      primaryHub: arlCount > sfCount ? "arlington" : "sioux_falls",
      uniqueVisitDays: uniqueDatesWindow.length,
      allTimeVisitDays: uniqueDatesAll.length,
      totalDeliveries: sortedWindow.length,
      visitsLast30d: uniqueDates30.size,
      visitsLast90d: uniqueDates90.size,
      visitsLast365d: uniqueDates365.size,
      totalPieces,
      totalWeightLbs,
      firstVisitDateISO: earliestAll.dateISO,
      lastVisitDateISO: latestAll.dateISO,
      daysSinceLastVisit,
      avgDaysBetweenVisits,
      maxGapDays,
      lastDriverName: latestAll.driverName,
      deliveryTypeBreakdown: typeCounts,
      topDrivers: Array.from(driverMap.entries())
        .map(([driverName, visits]) => ({ driverName, visits }))
        .sort((a, b) => b.visits - a.visits)
        .slice(0, 5),
      topParts: Array.from(partMap.values())
        .sort((a, b) => b.totalQty - a.totalQty)
        .slice(0, 12),
    });
  }

  const sortMode = options.sort || "visits";
  summaries.sort((a, b) => {
    if (sortMode === "recent") {
      return (
        b.lastVisitDateISO.localeCompare(a.lastVisitDateISO) ||
        b.uniqueVisitDays - a.uniqueVisitDays
      );
    }
    if (sortMode === "batteries") {
      return b.totalPieces - a.totalPieces || b.uniqueVisitDays - a.uniqueVisitDays;
    }
    if (sortMode === "frequency") {
      const aFreq = a.avgDaysBetweenVisits ?? 999999;
      const bFreq = b.avgDaysBetweenVisits ?? 999999;
      return aFreq - bFreq || b.uniqueVisitDays - a.uniqueVisitDays;
    }
    return (
      b.uniqueVisitDays - a.uniqueVisitDays ||
      b.totalDeliveries - a.totalDeliveries ||
      b.totalPieces - a.totalPieces
    );
  });

  const topCities = Array.from(cityStats.values())
    .map((c) => ({
      city: c.city,
      state: c.state,
      visits: c.visits,
      customers: c.customers.size,
    }))
    .sort((a, b) => b.visits - a.visits)
    .slice(0, 12);

  const limit = options.limit && options.limit > 0 ? options.limit : 500;

  return {
    status: getHotShotHistoryBackfillStatus(),
    totals: {
      matchingCustomers: summaries.length,
      matchingDeliveries,
      matchingBatteries,
      matchingWeightLbs,
      topCities,
    },
    customers: summaries.slice(0, limit),
  };
}

export function getCustomerDeliveryTimeline(
  customerIdentifier: string,
): {
  customer: HotShotCustomerAccountSummary | null;
  deliveries: HotShotHistoricalDelivery[];
} {
  ensureLoadedFromDisk();
  const cleanId = String(customerIdentifier || "").trim();
  if (!cleanId) return { customer: null, deliveries: [] };

  const allSummaries = queryCustomerHistorySummaries({
    days: "all",
    limit: 10000,
  }).customers;

  const matchedCustomer =
    allSummaries.find(
      (c) =>
        c.customerKey === cleanId ||
        (c.dealerNumber && c.dealerNumber === cleanId) ||
        (c.dealerId && String(c.dealerId) === cleanId) ||
        c.accountName.toLowerCase() === cleanId.toLowerCase(),
    ) || null;

  if (!matchedCustomer) {
    return { customer: null, deliveries: [] };
  }

  const deliveries = Array.from(deliveriesByKey.values())
    .filter((d) => buildCustomerKey(d) === matchedCustomer.customerKey)
    .sort((a, b) => b.dateISO.localeCompare(a.dateISO) || a.stopOrder - b.stopOrder);

  return {
    customer: matchedCustomer,
    deliveries,
  };
}

export interface HistoricalCorridorTownNode {
  city: string;
  state: string;
  visits: number;
  stops: number;
  batteries: number;
  weightLbs: number;
  lat: number;
  lon: number;
  avgStopOrder: number;
  topAccounts: string[];
}

export interface HistoricalCorridorRun {
  dateISO: string;
  stopsCount: number;
  batteries: number;
  weightLbs: number;
  estimatedMiles: number;
  townsLabel: string;
  stops: Array<{
    order: number;
    accountName: string;
    dealerNumber: string;
    city: string;
    state: string;
    lat: number;
    lon: number;
    pieces: number;
    weightLbs: number;
    partsSummary: string;
  }>;
}

export interface HistoricalWeekdayCorridor {
  id: string;
  dayOfWeek: number;
  dayLabel: string;
  dayShort: string;
  driverName: string;
  originHub: HotShotOriginHub;
  deliveryType: HistoricalDeliveryType;
  color: string;
  compassDirection: string;
  corridorHeadline: string;
  runsCount: number;
  totalStops: number;
  totalBatteries: number;
  totalWeightLbs: number;
  totalEstimatedMiles: number;
  avgMilesPerRun: number;
  avgStopsPerRun: number;
  weekdayRunCounts?: Array<{
    dayOfWeek: number;
    dayShort: string;
    runs: number;
    stops: number;
    miles: number;
  }>;
  topTowns: HistoricalCorridorTownNode[];
  recentRuns: HistoricalCorridorRun[];
}

const CORRIDOR_COLORS = [
  "#f59e0b", // Amber
  "#10b981", // Emerald
  "#38bdf8", // Sky
  "#a855f7", // Purple
  "#f43f5e", // Rose
  "#eab308", // Yellow
  "#06b6d4", // Cyan
  "#ec4899", // Pink
  "#84cc16", // Lime
  "#f97316", // Orange
];

const WEEKDAY_NAMES: Record<number, { label: string; short: string }> = {
  1: { label: "Monday", short: "Mon" },
  2: { label: "Tuesday", short: "Tue" },
  3: { label: "Wednesday", short: "Wed" },
  4: { label: "Thursday", short: "Thu" },
  5: { label: "Friday", short: "Fri" },
  6: { label: "Saturday", short: "Sat" },
};

function computeCompassDirectionLabel(
  originHub: HotShotOriginHub,
  avgLat: number,
  avgLon: number,
): string {
  const hubCoords =
    originHub === "arlington"
      ? DEFAULT_HOTSHOT_HUBS.arlington
      : DEFAULT_HOTSHOT_HUBS.sioux_falls;

  const dLat = avgLat - hubCoords.latitude;
  const dLon = (avgLon - hubCoords.longitude) * Math.cos((hubCoords.latitude * Math.PI) / 180);
  const distMiles = haversineMiles(hubCoords.latitude, hubCoords.longitude, avgLat, avgLon);

  if (distMiles < 14) {
    return originHub === "arlington" ? "Local Area" : "Sioux Falls Metro";
  }

  // Angle in degrees where 0 = East, 90 = North, 180/-180 = West, -90 = South
  const deg = (Math.atan2(dLat, dLon) * 180) / Math.PI;
  if (deg >= -22.5 && deg < 22.5) return "East Corridor";
  if (deg >= 22.5 && deg < 67.5) return "North-East Corridor";
  if (deg >= 67.5 && deg < 112.5) return "North Corridor";
  if (deg >= 112.5 && deg < 157.5) return "North-West Corridor";
  if (deg >= 157.5 || deg < -157.5) return "West Corridor";
  if (deg >= -157.5 && deg < -112.5) return "South-West Corridor";
  if (deg >= -112.5 && deg < -67.5) return "South Corridor";
  return "South-East Corridor";
}

function estimateRunRoundTripMiles(
  orderedStops: HotShotHistoricalDelivery[],
  fallbackHub: HotShotOriginHub,
): number {
  const runHub = orderedStops[0]?.originHub || fallbackHub;
  const hubCoords =
    runHub === "arlington"
      ? DEFAULT_HOTSHOT_HUBS.arlington
      : DEFAULT_HOTSHOT_HUBS.sioux_falls;

  // Group by sheetNum so multiple sheets on the same day don't interleave stops across separate trips
  const bySheet = new Map<number, HotShotHistoricalDelivery[]>();
  for (const s of orderedStops) {
    const sNum = Number(s.sheetNum) || 1;
    const list = bySheet.get(sNum) || [];
    list.push(s);
    bySheet.set(sNum, list);
  }

  let totalRoadMiles = 0;

  for (const sheetStops of Array.from(bySheet.values())) {
    const seq = [...sheetStops].sort((a, b) => a.stopOrder - b.stopOrder);
    let prevLat = hubCoords.latitude;
    let prevLon = hubCoords.longitude;
    let straightMiles = 0;
    let geocodedCount = 0;

    for (const s of seq) {
      if (!isValidUpperMidwestCoord(s.lat, s.lon)) continue;
      const leg = haversineMiles(prevLat, prevLon, s.lat as number, s.lon as number);
      if (leg > 450) continue;
      straightMiles += leg;
      prevLat = s.lat as number;
      prevLon = s.lon as number;
      geocodedCount++;
    }

    if (geocodedCount === 0) continue;

    // Return leg back to origin hub
    const returnLeg = haversineMiles(prevLat, prevLon, hubCoords.latitude, hubCoords.longitude);
    if (returnLeg <= 450) {
      straightMiles += returnLeg;
    }

    // Standard Midwest highway & section-road circuity factor (1.22x straight-line distance)
    const sheetRoadMiles = Math.round(straightMiles * 1.22);
    totalRoadMiles += Math.max(sheetRoadMiles, Math.min(45, seq.length * 4));
  }

  return totalRoadMiles;
}

export function queryHistoricalCorridorMapData(options: {
  days?: number | "all";
  weekday?: "all" | number;
  hub?: "all" | HotShotOriginHub;
  driver?: string;
  deliveryType?: "all" | "hotshot" | "route_truck";
  groupBy?: "weekday_driver" | "driver";
} = {}) {
  ensureLoadedFromDisk();

  const groupByMode = options.groupBy === "driver" ? "driver" : "weekday_driver";

  const daysNum =
    options.days === "all" ? null : Math.max(1, Number(options.days) || 365);
  const cutoffISO = daysNum
    ? getCentralDateISO(new Date(Date.now() - daysNum * 24 * 3600_000))
    : null;

  const hubFilter = options.hub && options.hub !== "all" ? options.hub : null;
  const typeFilter =
    options.deliveryType && options.deliveryType !== "all" ? options.deliveryType : null;
  const driverFilter =
    options.driver && options.driver !== "all" ? options.driver.trim().toLowerCase() : null;
  const weekdayFilter =
    typeof options.weekday === "number" && options.weekday >= 1 && options.weekday <= 6
      ? options.weekday
      : null;

  // Group all physical stops by (dayOfWeek, driverName)
  const groups = new Map<string, HotShotHistoricalDelivery[]>();
  const allDriverNamesSet = new Set<string>();
  const weekdaySummaryMap = new Map<
    number,
    {
      dayOfWeek: number;
      dayLabel: string;
      dayShort: string;
      dates: Set<string>;
      stops: number;
      batteries: number;
      drivers: Set<string>;
      cities: Map<string, number>;
    }
  >();

  for (let d = 1; d <= 5; d++) {
    weekdaySummaryMap.set(d, {
      dayOfWeek: d,
      dayLabel: WEEKDAY_NAMES[d].label,
      dayShort: WEEKDAY_NAMES[d].short,
      dates: new Set(),
      stops: 0,
      batteries: 0,
      drivers: new Set(),
      cities: new Map(),
    });
  }

  for (const del of Array.from(deliveriesByKey.values())) {
    if (del.deliveryType === "ups_shipping") continue;
    if (cutoffISO && del.dateISO < cutoffISO) continue;
    if (hubFilter && del.originHub !== hubFilter) continue;
    if (typeFilter && del.deliveryType !== typeFilter) continue;

    const dt = new Date(`${del.dateISO}T12:00:00Z`);
    const dow = dt.getUTCDay();
    if (dow < 1 || dow > 6) continue;

    allDriverNamesSet.add(del.driverName);

    const wSum = weekdaySummaryMap.get(dow);
    if (wSum) {
      wSum.dates.add(del.dateISO);
      wSum.stops += 1;
      wSum.batteries += del.piecesCount;
      wSum.drivers.add(del.driverName);
      wSum.cities.set(del.city, (wSum.cities.get(del.city) || 0) + 1);
    }

    if (weekdayFilter && dow !== weekdayFilter) continue;
    if (driverFilter && del.driverName.toLowerCase() !== driverFilter) continue;

    const gKey =
      groupByMode === "driver" ? `0:::${del.driverName}` : `${dow}:::${del.driverName}`;
    const list = groups.get(gKey) || [];
    list.push(del);
    groups.set(gKey, list);
  }

  const corridors: HistoricalWeekdayCorridor[] = [];
  let colorIdx = 0;

  for (const [gKey, items] of Array.from(groups.entries())) {
    const [dowStr, driverName] = gKey.split(":::");
    const dayOfWeek = Number(dowStr);
    const dayMeta =
      dayOfWeek === 0
        ? { label: "All Days", short: "All Days" }
        : WEEKDAY_NAMES[dayOfWeek] || { label: "Weekday", short: "Day" };

    // Track per-weekday run counts for this driver
    const weekdayRunsMap = new Map<
      number,
      { dates: Set<string>; stops: number; miles: number }
    >();
    for (let d = 1; d <= 5; d++) {
      weekdayRunsMap.set(d, { dates: new Set(), stops: 0, miles: 0 });
    }

    // Determine primary hub & deliveryType for this driver on this weekday
    let arlCount = 0;
    let sfCount = 0;
    let routeTruckCount = 0;
    let totalBatteries = 0;
    let totalWeightLbs = 0;
    let weightedLatSum = 0;
    let weightedLonSum = 0;
    let coordCount = 0;

    const byDate = new Map<string, HotShotHistoricalDelivery[]>();
    const byCity = new Map<
      string,
      {
        city: string;
        state: string;
        dates: Set<string>;
        stops: number;
        batteries: number;
        weightLbs: number;
        latSum: number;
        lonSum: number;
        coordCount: number;
        stopOrderSum: number;
        accounts: Map<string, number>;
      }
    >();

    for (const del of items) {
      if (del.originHub === "arlington") arlCount++;
      else sfCount++;
      if (del.deliveryType === "route_truck") routeTruckCount++;
      totalBatteries += del.piecesCount;
      totalWeightLbs += del.estimatedWeightLbs;

      if (del.lat !== null && del.lon !== null) {
        weightedLatSum += del.lat;
        weightedLonSum += del.lon;
        coordCount++;
      }

      const dList = byDate.get(del.dateISO) || [];
      dList.push(del);
      byDate.set(del.dateISO, dList);

      const itemDow = new Date(`${del.dateISO}T12:00:00Z`).getUTCDay();
      const wdBucket = weekdayRunsMap.get(itemDow);
      if (wdBucket) {
        wdBucket.dates.add(del.dateISO);
        wdBucket.stops += 1;
      }

      const cityKey = `${del.city.toLowerCase()}|${del.state}`;
      let cNode = byCity.get(cityKey);
      if (!cNode) {
        cNode = {
          city: del.city,
          state: del.state,
          dates: new Set(),
          stops: 0,
          batteries: 0,
          weightLbs: 0,
          latSum: 0,
          lonSum: 0,
          coordCount: 0,
          stopOrderSum: 0,
          accounts: new Map(),
        };
        byCity.set(cityKey, cNode);
      }
      cNode.dates.add(del.dateISO);
      cNode.stops += 1;
      cNode.batteries += del.piecesCount;
      cNode.weightLbs += del.estimatedWeightLbs;
      cNode.stopOrderSum += del.stopOrder;
      cNode.accounts.set(del.accountName, (cNode.accounts.get(del.accountName) || 0) + 1);
      if (del.lat !== null && del.lon !== null) {
        cNode.latSum += del.lat;
        cNode.lonSum += del.lon;
        cNode.coordCount += 1;
      }
    }

    if (coordCount === 0) continue;

    const originHub: HotShotOriginHub = arlCount > sfCount ? "arlington" : "sioux_falls";
    const deliveryType: HistoricalDeliveryType =
      routeTruckCount > items.length / 2 ? "route_truck" : "hotshot";

    // Top towns visited on this weekday by this driver
    const allTownNodes: HistoricalCorridorTownNode[] = Array.from(byCity.values())
      .filter((c) => c.coordCount > 0)
      .map((c) => ({
        city: c.city,
        state: c.state,
        visits: c.dates.size,
        stops: c.stops,
        batteries: c.batteries,
        weightLbs: c.weightLbs,
        lat: c.latSum / c.coordCount,
        lon: c.lonSum / c.coordCount,
        avgStopOrder: Math.round((c.stopOrderSum / c.stops) * 10) / 10,
        topAccounts: Array.from(c.accounts.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 4)
          .map(([acct]) => acct),
      }))
      // Pick the most frequently visited towns for this driver, sorted by most visited first
      .sort((a, b) => b.visits - a.visits || b.stops - a.stops || b.batteries - a.batteries)
      .slice(0, 8);

    const topByVisits = [...allTownNodes].sort((a, b) => b.visits - a.visits);
    const primaryTown = topByVisits[0];
    const compassDirection = primaryTown
      ? computeCompassDirectionLabel(originHub, primaryTown.lat, primaryTown.lon)
      : computeCompassDirectionLabel(
          originHub,
          weightedLatSum / coordCount,
          weightedLonSum / coordCount,
        );
    const corridorHeadline = topByVisits
      .slice(0, 4)
      .map((t) => t.city)
      .join(" • ");

    let totalEstimatedMiles = 0;
    const allSortedRuns = Array.from(byDate.entries()).sort((a, b) =>
      b[0].localeCompare(a[0]),
    );

    const recentRuns: HistoricalCorridorRun[] = [];
    for (const [dateISO, stopsList] of allSortedRuns) {
      const ordered = [...stopsList].sort(
        (a, b) => (a.sheetNum || 1) - (b.sheetNum || 1) || a.stopOrder - b.stopOrder,
      );
      const runMiles = estimateRunRoundTripMiles(ordered, originHub);
      totalEstimatedMiles += runMiles;

      const runDow = new Date(`${dateISO}T12:00:00Z`).getUTCDay();
      const wdBucket = weekdayRunsMap.get(runDow);
      if (wdBucket) {
        wdBucket.miles += runMiles;
      }

      if (recentRuns.length < 15) {
        const uniqueTowns = Array.from(new Set(ordered.map((s) => s.city)));
        recentRuns.push({
          dateISO,
          stopsCount: ordered.length,
          batteries: ordered.reduce((sum, s) => sum + s.piecesCount, 0),
          weightLbs: ordered.reduce((sum, s) => sum + s.estimatedWeightLbs, 0),
          estimatedMiles: runMiles,
          townsLabel: uniqueTowns.slice(0, 5).join(" → "),
          stops: ordered
            .filter((s) => s.lat !== null && s.lon !== null)
            .map((s, idx) => ({
              order: idx + 1,
              accountName: s.accountName,
              dealerNumber: s.dealerNumber,
              city: s.city,
              state: s.state,
              lat: s.lat as number,
              lon: s.lon as number,
              pieces: s.piecesCount,
              weightLbs: s.estimatedWeightLbs,
              partsSummary: s.partsSummary,
            })),
        });
      }
    }

    const runsCount = byDate.size;
    const slugDriver = driverName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const weekdayRunCounts = Array.from(weekdayRunsMap.entries())
      .map(([dow, stat]) => ({
        dayOfWeek: dow,
        dayShort: WEEKDAY_NAMES[dow]?.short || "Day",
        runs: stat.dates.size,
        stops: stat.stops,
        miles: stat.miles,
      }))
      .filter((w) => w.runs > 0);

    corridors.push({
      id: `corridor-${dayOfWeek}-${slugDriver}`,
      dayOfWeek,
      dayLabel: dayMeta.label,
      dayShort: dayMeta.short,
      driverName,
      originHub,
      deliveryType,
      color: CORRIDOR_COLORS[colorIdx % CORRIDOR_COLORS.length],
      compassDirection,
      corridorHeadline,
      runsCount,
      totalStops: items.length,
      totalBatteries,
      totalWeightLbs,
      totalEstimatedMiles,
      avgMilesPerRun: Math.round(totalEstimatedMiles / Math.max(1, runsCount)),
      avgStopsPerRun: Math.round((items.length / Math.max(1, runsCount)) * 10) / 10,
      weekdayRunCounts,
      topTowns: allTownNodes,
      recentRuns,
    });
    colorIdx++;
  }

  // Sort corridors by runsCount descending, then totalStops descending
  corridors.sort((a, b) => b.runsCount - a.runsCount || b.totalStops - a.totalStops);

  // Re-assign palette colors after sorting so top corridors get the most distinct colors
  corridors.forEach((c, idx) => {
    c.color = CORRIDOR_COLORS[idx % CORRIDOR_COLORS.length];
  });

  const weekdayBreakdown = Array.from(weekdaySummaryMap.values()).map((w) => ({
    dayOfWeek: w.dayOfWeek,
    dayLabel: w.dayLabel,
    dayShort: w.dayShort,
    activeDatesCount: w.dates.size,
    totalStops: w.stops,
    totalBatteries: w.batteries,
    drivers: Array.from(w.drivers),
    topCities: Array.from(w.cities.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([city, count]) => ({ city, count })),
  }));

  return {
    status: getHotShotHistoryBackfillStatus(),
    weekdayBreakdown,
    drivers: Array.from(allDriverNamesSet).sort(),
    corridors,
  };
}

export function startAutoHistorySeedOnBoot() {
  ensureLoadedFromDisk();
  // Automatically ensure up to 12 months (1y) of history are collected in the background
  setTimeout(() => {
    startHotShotHistoryBackfill("1y").catch(() => {});
  }, 3500);
}
