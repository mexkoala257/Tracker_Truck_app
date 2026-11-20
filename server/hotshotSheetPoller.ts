import {
  type HotShotRoute,
  type HotShotStop,
  type HotShotOpenOrder,
  type HotShotDeliveryAlert,
  type HotShotOriginHub,
  DEFAULT_HOTSHOT_HUBS,
  HOTSHOT_COLOR_PALETTE,
  getCentralDateISO,
  parseHotShotDateToISO,
  matchHotShotDriverToRoster,
  stripLocationPrefix,
  buildHotShotTownSequenceLabel,
  haversineMiles,
  normalizeHotShotRoutes,
  normalizeHotShotRoute,
} from "@shared/hotshots";
import { geocodeStreetOrTown } from "./hotshotParser";
import { getDisplayState, saveDisplayState } from "./displayService";
import { ingestDeliveriesPayload } from "./hotshotHistoryService";
import { log } from "./app";

const DEFAULT_HSS_BASE_URL = "https://www.hotshotsheet.com";
const DEFAULT_HSS_API_KEY = "";
const POLL_INTERVAL_MS = 60 * 1000;
const FETCH_TIMEOUT_MS = 18 * 1000;

let pollingTimer: ReturnType<typeof setInterval> | null = null;
let isPolling = false;
let hasSeededInitialIds = false;

const knownSheetStopKeys = new Set<string>();
const knownOpenOrderIds = new Set<number>();
const seededPollDates = new Set<string>();

let latestOpenOrders: HotShotOpenOrder[] = [];
const recentDeliveryAlerts: HotShotDeliveryAlert[] = [];
const MAX_RECENT_ALERTS = 25;

export interface HotShotSyncStatus {
  enabled: boolean;
  isPolling: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
  todaySheetCount: number;
  upcomingSheetCount: number;
  openOrderCount: number;
  pollIntervalSec: number;
}

let syncStatus: HotShotSyncStatus = {
  enabled: true,
  isPolling: false,
  lastSyncedAt: null,
  lastError: null,
  todaySheetCount: 0,
  upcomingSheetCount: 0,
  openOrderCount: 0,
  pollIntervalSec: Math.round(POLL_INTERVAL_MS / 1000),
};

type OnSyncHook = (params: {
  routesMutated: boolean;
  openOrdersChanged: boolean;
  newAlerts: HotShotDeliveryAlert[];
}) => Promise<void> | void;

let onSyncHook: OnSyncHook | null = null;

export function setHotShotSyncHook(fn: OnSyncHook) {
  onSyncHook = fn;
}

export function getHotShotSyncStatus(): HotShotSyncStatus {
  return { ...syncStatus };
}

export function getHotShotOpenOrders(): HotShotOpenOrder[] {
  return latestOpenOrders;
}

export function getRecentHotShotAlerts(): HotShotDeliveryAlert[] {
  return recentDeliveryAlerts;
}

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

function formatCleanPhone(raw: unknown): string | undefined {
  const s = String(raw ?? "").trim();
  if (!s || /^n\/?a$/i.test(s)) return undefined;
  const digits = s.replace(/\D/g, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return s;
}

function inferHubFromDriverAndCoords(
  rawDriverName: string,
  sfRosterNames: string[],
  firstStopCoords?: { lat: number; lon: number } | null,
): HotShotOriginHub {
  const s = String(rawDriverName || "").trim();
  if (/(?:^|\b)(?:arl|arlington)(?:\b|$)/i.test(s)) {
    return "arlington";
  }
  if (/(?:^|\b)(?:sf|sioux\s+falls)(?:\b|$)/i.test(s)) {
    return "sioux_falls";
  }

  // Check if driver matches Sioux Falls employee schedule roster
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

  // Fall back to whichever warehouse hub is physically closer to the first stop
  if (
    firstStopCoords &&
    Number.isFinite(firstStopCoords.lat) &&
    Number.isFinite(firstStopCoords.lon) &&
    Math.abs(firstStopCoords.lat) > 1
  ) {
    const distArl = haversineMiles(
      DEFAULT_HOTSHOT_HUBS.arlington.latitude,
      DEFAULT_HOTSHOT_HUBS.arlington.longitude,
      firstStopCoords.lat,
      firstStopCoords.lon,
    );
    const distSf = haversineMiles(
      DEFAULT_HOTSHOT_HUBS.sioux_falls.latitude,
      DEFAULT_HOTSHOT_HUBS.sioux_falls.longitude,
      firstStopCoords.lat,
      firstStopCoords.lon,
    );
    if (distArl + 8 < distSf) {
      return "arlington";
    }
  }

  return "sioux_falls";
}

function extractPartsSummaryAndCount(deliveryParts: any[] | undefined | null): {
  partsSummary?: string;
  piecesCount?: number;
  parts?: Array<{ partNumber: string; orderedQty: number; pickedQty: number | null }>;
} {
  if (!Array.isArray(deliveryParts) || deliveryParts.length === 0) {
    return {};
  }
  let totalPieces = 0;
  const labels: string[] = [];
  const parts: Array<{ partNumber: string; orderedQty: number; pickedQty: number | null }> = [];
  for (const dp of deliveryParts) {
    if (!dp) continue;
    const ordered = Number(dp.DPartOrderQuan) || 0;
    const pickedRaw = dp.DPartPickedQuan;
    const hasPicked =
      pickedRaw !== null && pickedRaw !== undefined && Number.isFinite(Number(pickedRaw));
    const picked = hasPicked ? Number(pickedRaw) : ordered;
    const qty = picked > 0 ? picked : ordered;
    totalPieces += qty;
    const partCode = String(dp.Part?.PartNumber || dp.Part?.PartDesc || "Part").trim();
    if (partCode) {
      labels.push(qty > 0 ? `${partCode} (${qty})` : partCode);
      parts.push({
        partNumber: partCode,
        orderedQty: ordered,
        pickedQty: hasPicked ? Number(pickedRaw) : null,
      });
    }
  }
  return {
    ...(labels.length > 0 ? { partsSummary: labels.join(" • ") } : {}),
    ...(totalPieces > 0 ? { piecesCount: totalPieces } : {}),
    ...(parts.length > 0 ? { parts } : {}),
  };
}

async function fetchHssJson(pathWithQuery: string): Promise<any> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("HOTSHOTSHEET_API_KEY is not configured");
  }
  const url = `${getBaseUrl()}${pathWithQuery}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      APIkey: apiKey,
      Accept: "application/json",
      "User-Agent": "IBS-SouthDakota-FleetTracker/1.0",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`HotShotSheet API ${res.status}: ${errText.slice(0, 180)}`);
  }
  return res.json();
}

function getTargetPollDates(now = new Date()): string[] {
  const todayISO = getCentralDateISO(now);
  const dates = new Set<string>([todayISO]);

  // Always include tomorrow (+1 day)
  const d1 = new Date(now.getTime() + 24 * 3600_000);
  dates.add(getCentralDateISO(d1));

  // On Friday or Saturday, also check +2 and +3 days so Monday sheets added on Friday afternoon are caught
  const dayOfWeek = now.getDay();
  if (dayOfWeek === 5 || dayOfWeek === 6) {
    dates.add(getCentralDateISO(new Date(now.getTime() + 2 * 24 * 3600_000)));
    dates.add(getCentralDateISO(new Date(now.getTime() + 3 * 24 * 3600_000)));
  }

  return Array.from(dates);
}

export async function syncHotShotSheetNow(): Promise<{
  ok: boolean;
  status: HotShotSyncStatus;
  newAlerts: HotShotDeliveryAlert[];
}> {
  if (isPolling) {
    return { ok: true, status: getHotShotSyncStatus(), newAlerts: [] };
  }

  isPolling = true;
  syncStatus.isPolling = true;
  const newAlerts: HotShotDeliveryAlert[] = [];

  try {
    const state = await getDisplayState();
    const sfRosterSet = new Set<string>();
    for (const item of state.sfSchedule?.memberRoster || []) {
      if (item?.name) sfRosterSet.add(String(item.name).trim());
    }
    for (const row of state.sfSchedule?.rows || []) {
      if (row?.name) sfRosterSet.add(String(row.name).trim());
    }
    const sfRosterNames = Array.from(sfRosterSet);

    const now = new Date();
    const todayISO = getCentralDateISO(now);
    const pollDates = getTargetPollDates(now);

    // Fetch Deliveries for each target date + Open Orders in parallel
    const [deliveriesByDate, openOrdersPayload] = await Promise.all([
      Promise.all(
        pollDates.map(async (iso) => {
          const [y, m, d] = iso.split("-").map(Number);
          const payload = await fetchHssJson(
            `/API/Deliveries?Year=${y}&Month=${m}&Day=${d}`,
          );
          return { dateISO: iso, payload };
        }),
      ),
      fetchHssJson("/API/Orders").catch((err) => {
        log(`HotShotSheet /API/Orders warning: ${err.message}`, "hotshot-api");
        return null;
      }),
    ]);

    const existingRoutes = normalizeHotShotRoutes(state.hotShotRoutes);
    const nowIso = now.toISOString();

    // Build all API routes discovered across the polled dates
    const discoveredApiRoutes: HotShotRoute[] = [];
    const matchedLegacyRouteIds = new Set<string>();

    for (const { dateISO, payload } of deliveriesByDate) {
      const isDateAlreadySeeded = hasSeededInitialIds && seededPollDates.has(dateISO);
      try {
        ingestDeliveriesPayload(dateISO, payload, sfRosterNames);
      } catch {}
      const drivers: any[] = Array.isArray(payload?.Drivers) ? payload.Drivers : [];
      for (const drv of drivers) {
        const driverId = Number(drv?.DriverId) || 0;
        const rawDriver = `${drv?.DriverFirstName || ""} ${drv?.DriverLastName || ""}`
          .replace(/\s+/g, " ")
          .trim();
        const rawSheets: any[] = Array.isArray(drv?.Sheets) ? drv.Sheets : [];
        if (rawSheets.length === 0) continue;

        // Group stops by SheetNum
        const bySheetNum = new Map<number, any[]>();
        for (const sh of rawSheets) {
          const sNum = Number(sh?.SheetNum) || 1;
          const list = bySheetNum.get(sNum) || [];
          list.push(sh);
          bySheetNum.set(sNum, list);
        }

        for (const [sheetNum, sheetItems] of Array.from(bySheetNum.entries())) {
          sheetItems.sort(
            (a: any, b: any) =>
              (Number(a?.DeliveryOrder) || 0) - (Number(b?.DeliveryOrder) || 0),
          );

          const firstDealer = sheetItems[0]?.Delivery?.Dealer;
          const firstLat = Number(firstDealer?.DealerLat);
          const firstLon = Number(firstDealer?.DealerLong);
          const firstCoords =
            Number.isFinite(firstLat) && Number.isFinite(firstLon) && Math.abs(firstLat) > 1
              ? { lat: firstLat, lon: firstLon }
              : null;

          const inferredHub = inferHubFromDriverAndCoords(
            rawDriver,
            sfRosterNames,
            firstCoords,
          );

          const strippedDriver = stripLocationPrefix(rawDriver);
          const isGenericBucket = /^(?:hot\s*shot(?:\s*\d+)?)$/i.test(strippedDriver);
          const cleanDriverFallback = isGenericBucket ? rawDriver : strippedDriver || rawDriver;
          const resolvedDriverName =
            inferredHub === "arlington"
              ? cleanDriverFallback
              : matchHotShotDriverToRoster(rawDriver, sfRosterNames) || cleanDriverFallback;

          const apiRouteId = `hss-sheet-${driverId}-${dateISO}-${sheetNum}`;

          // Find existing route by deterministic API ID, or fallback to matching same-day PDF route for same driver
          let existingMatch = existingRoutes.find((r) => r.id === apiRouteId);
          if (!existingMatch) {
            existingMatch = existingRoutes.find(
              (r) =>
                !matchedLegacyRouteIds.has(r.id) &&
                !r.id.startsWith("hss-sheet-") &&
                r.deliveryDateISO === dateISO &&
                (r.rawPdfDriver?.toLowerCase() === rawDriver.toLowerCase() ||
                  r.driverName.toLowerCase() === resolvedDriverName.toLowerCase()),
            );
            if (existingMatch) {
              matchedLegacyRouteIds.add(existingMatch.id);
            }
          }

          const effectiveOriginHub: HotShotOriginHub =
            existingMatch?.originHub || inferredHub;

          const prevStopsByDeliveryId = new Map<number, HotShotStop>();
          const prevStopsByCodeOrName = new Map<string, HotShotStop>();
          for (const ps of existingMatch?.stops || []) {
            if (ps.externalDeliveryId) {
              prevStopsByDeliveryId.set(ps.externalDeliveryId, ps);
            }
            const key = `${(ps.accountCode || "").toLowerCase()}|${ps.accountName.toLowerCase()}`;
            prevStopsByCodeOrName.set(key, ps);
          }

          const builtStops: HotShotStop[] = [];
          for (let i = 0; i < sheetItems.length; i++) {
            const item = sheetItems[i];
            const deliv = item?.Delivery || {};
            const dealer = deliv?.Dealer || {};
            const deliveryId = Number(deliv?.DeliveryId || item?.DeliveryId) || i + 1;
            const sheetId = Number(item?.SheetId) || undefined;

            const { accountName, inlineNote } = cleanDealerNameAndNote(dealer?.DealerName);
            const accountCode = dealer?.DealerNumber
              ? String(dealer.DealerNumber).trim()
              : undefined;
            const city = titleCaseCity(dealer?.DealerCity || "");
            const stateCode = String(dealer?.DealerState || "SD")
              .trim()
              .toUpperCase();
            const address = String(dealer?.DealerAddress || "").trim();
            const zip = dealer?.DealerZip ? String(dealer.DealerZip).trim() : undefined;
            const phone = formatCleanPhone(dealer?.DealerPhone);

            let lat = Number(dealer?.DealerLat);
            let lon = Number(dealer?.DealerLong);
            let geocodePrecision: "street" | "town" | "manual" = "street";

            const prevStop =
              prevStopsByDeliveryId.get(deliveryId) ||
              prevStopsByCodeOrName.get(
                `${(accountCode || "").toLowerCase()}|${accountName.toLowerCase()}`,
              );

            if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) < 1) {
              if (prevStop && Number.isFinite(prevStop.lat) && Math.abs(prevStop.lat) > 1) {
                lat = prevStop.lat;
                lon = prevStop.lon;
                geocodePrecision = prevStop.geocodePrecision || "town";
              } else {
                const geo = await geocodeStreetOrTown(
                  address,
                  city,
                  stateCode,
                  zip,
                  state.routeTerritories,
                  effectiveOriginHub,
                );
                lat = geo.lat;
                lon = geo.lon;
                geocodePrecision = geo.precision;
              }
            } else {
              lat = Number(lat.toFixed(5));
              lon = Number(lon.toFixed(5));
            }

            const { partsSummary, piecesCount, parts } = extractPartsSummaryAndCount(
              deliv?.DeliveryParts,
            );

            const noteParts = [
              inlineNote,
              deliv?.Notes ? String(deliv.Notes).trim() : "",
              deliv?.FulfillmentNotes ? String(deliv.FulfillmentNotes).trim() : "",
            ].filter(Boolean);
            const notes = noteParts.length > 0 ? noteParts.join(" • ") : undefined;

            const poNumber = deliv?.PONum ? String(deliv.PONum).trim() : undefined;
            const enteredBy = deliv?.Initials ? String(deliv.Initials).trim() : undefined;
            const orderedBy = deliv?.OrderedBy ? String(deliv.OrderedBy).trim() : undefined;
            const pickedBy = deliv?.PickedBy ? String(deliv.PickedBy).trim() : undefined;
            const receivedBy = deliv?.ReceivedBy ? String(deliv.ReceivedBy).trim() : undefined;
            const priority = deliv?.DeliveryPriority?.DeliveryPriorityDesc
              ? String(deliv.DeliveryPriority.DeliveryPriorityDesc).trim()
              : undefined;
            const createdAt = deliv?.CreateDate ? String(deliv.CreateDate) : undefined;

            // Fulfillment completion: use HotShotSheet FulfillmentDate if present, otherwise preserve GPS/manual completion
            let completedAt: string | null = null;
            let completedBy: "gps" | "manual" | null = null;
            if (deliv?.FulfillmentDate) {
              const parsedFulfill = new Date(deliv.FulfillmentDate);
              completedAt = Number.isFinite(parsedFulfill.getTime())
                ? parsedFulfill.toISOString()
                : nowIso;
              completedBy = prevStop?.completedBy === "gps" ? "gps" : "manual";
            } else if (prevStop?.completedAt) {
              completedAt = prevStop.completedAt;
              completedBy = prevStop.completedBy || "gps";
            }

            const stopKey = `${dateISO}|${deliveryId}`;
            if (isDateAlreadySeeded && !knownSheetStopKeys.has(stopKey)) {
              newAlerts.push({
                id: `hss-alert-${deliveryId}-${Date.now()}`,
                kind: dateISO > todayISO ? "tomorrow_sheet_stop" : "today_sheet_stop",
                deliveryId,
                deliveryDateISO: dateISO,
                driverName: resolvedDriverName,
                originHub: effectiveOriginHub,
                accountName,
                ...(accountCode ? { accountCode } : {}),
                city: city || accountName,
                state: stateCode,
                ...(partsSummary ? { partsSummary } : {}),
                ...(piecesCount ? { piecesCount } : {}),
                ...(enteredBy ? { enteredBy } : {}),
                ...(poNumber ? { poNumber } : {}),
                ...(notes ? { notes } : {}),
                timestamp: nowIso,
              });
            }
            knownSheetStopKeys.add(stopKey);

            builtStops.push({
              id: `hss-stop-${deliveryId}`,
              order: i + 1,
              accountName,
              ...(accountCode ? { accountCode } : {}),
              address,
              city: city || accountName,
              state: stateCode,
              ...(zip ? { zip } : {}),
              ...(phone ? { phone } : {}),
              ...(poNumber ? { poNumber } : {}),
              ...(enteredBy ? { enteredBy } : {}),
              ...(orderedBy ? { orderedBy } : {}),
              ...(pickedBy ? { pickedBy } : {}),
              ...(receivedBy ? { receivedBy } : {}),
              ...(priority ? { priority } : {}),
              ...(partsSummary ? { partsSummary } : {}),
              ...(parts ? { parts } : {}),
              ...(piecesCount ? { piecesCount } : {}),
              ...(notes ? { notes } : {}),
              lat,
              lon,
              geocodePrecision,
              completedAt,
              completedBy,
              externalDeliveryId: deliveryId,
              ...(sheetId ? { externalSheetId: sheetId } : {}),
              ...(createdAt ? { createdAt } : {}),
            });
          }

          // Preserve any manual / What-If stops saved by dispatcher that aren't in the API sheet yet
          if (existingMatch?.stops?.length) {
            const builtDeliveryIds = new Set(
              builtStops.map((s) => s.externalDeliveryId).filter(Boolean),
            );
            const builtStopIds = new Set(builtStops.map((s) => s.id));
            for (const ps of existingMatch.stops) {
              const isManualOrSim =
                ps.id.startsWith("sim-stop-") ||
                (!ps.externalDeliveryId && !ps.id.startsWith("hss-stop-"));
              if (
                isManualOrSim &&
                !builtStopIds.has(ps.id) &&
                (!ps.externalDeliveryId || !builtDeliveryIds.has(ps.externalDeliveryId))
              ) {
                builtStops.push({ ...ps });
              }
            }
          }

          // If the dispatcher manually optimized or reordered stops in the tracker, preserve their custom sequence
          if (existingMatch?.customStopOrder && existingMatch.stops?.length) {
            const prevOrderByStopId = new Map<string, number>();
            const prevOrderByDelivId = new Map<number, number>();
            existingMatch.stops.forEach((ps, idx) => {
              prevOrderByStopId.set(ps.id, idx);
              if (ps.externalDeliveryId) {
                prevOrderByDelivId.set(ps.externalDeliveryId, idx);
              }
            });
            builtStops.sort((a, b) => {
              const aIdx =
                prevOrderByStopId.get(a.id) ??
                (a.externalDeliveryId ? prevOrderByDelivId.get(a.externalDeliveryId) : undefined) ??
                9999 + a.order;
              const bIdx =
                prevOrderByStopId.get(b.id) ??
                (b.externalDeliveryId ? prevOrderByDelivId.get(b.externalDeliveryId) : undefined) ??
                9999 + b.order;
              return aIdx - bIdx;
            });
            builtStops.forEach((s, idx) => {
              s.order = idx + 1;
            });
          }

          const colorIdx = discoveredApiRoutes.length;
          const routeObj = normalizeHotShotRoute(
            {
              ...(existingMatch || {}),
              id: apiRouteId,
              deliveryDateISO: dateISO,
              originHub: effectiveOriginHub,
              driverName: resolvedDriverName,
              rawPdfDriver: rawDriver,
              color:
                existingMatch?.color ||
                HOTSHOT_COLOR_PALETTE[colorIdx % HOTSHOT_COLOR_PALETTE.length],
              title: buildHotShotTownSequenceLabel(builtStops, 5),
              sourceFileName: `HotShotSheet API (Sheet #${sheetNum})`,
              sourceType: "api",
              externalDriverId: driverId,
              externalSheetNum: sheetNum,
              lastSyncedAt: nowIso,
              ...(existingMatch?.customStopOrder ? { customStopOrder: true } : {}),
              active: existingMatch ? existingMatch.active !== false : true,
              stops: builtStops,
              createdAt: existingMatch?.createdAt || nowIso,
              updatedAt: nowIso,
            },
            colorIdx,
          );

          discoveredApiRoutes.push(routeObj);
        }
      }
      seededPollDates.add(dateISO);
    }

    // Parse Open / Unassigned Orders (/API/Orders)
    const nextOpenOrders: HotShotOpenOrder[] = [];
    if (openOrdersPayload && Array.isArray(openOrdersPayload.Drivers)) {
      for (const drv of openOrdersPayload.Drivers) {
        const driverId = Number(drv?.DriverId) || 0;
        const rawDriver = `${drv?.DriverFirstName || ""} ${drv?.DriverLastName || ""}`
          .replace(/\s+/g, " ")
          .trim();
        const deliveries: any[] = Array.isArray(drv?.Deliveries) ? drv.Deliveries : [];
        for (const deliv of deliveries) {
          const deliveryId = Number(deliv?.DeliveryId) || 0;
          if (!deliveryId) continue;
          const dealer = deliv?.Dealer || {};
          const { accountName, inlineNote } = cleanDealerNameAndNote(dealer?.DealerName);
          const accountCode = dealer?.DealerNumber
            ? String(dealer.DealerNumber).trim()
            : undefined;
          const city = titleCaseCity(dealer?.DealerCity || "");
          const stateCode = String(dealer?.DealerState || "SD")
            .trim()
            .toUpperCase();
          const address = String(dealer?.DealerAddress || "").trim();
          const zip = dealer?.DealerZip ? String(dealer.DealerZip).trim() : undefined;
          const phone = formatCleanPhone(dealer?.DealerPhone);
          const lat = Number(dealer?.DealerLat) || 0;
          const lon = Number(dealer?.DealerLong) || 0;
          const originHub = inferHubFromDriverAndCoords(
            rawDriver,
            sfRosterNames,
            Math.abs(lat) > 1 ? { lat, lon } : null,
          );
          const { partsSummary, piecesCount } = extractPartsSummaryAndCount(
            deliv?.DeliveryParts,
          );
          const noteParts = [
            inlineNote,
            deliv?.Notes ? String(deliv.Notes).trim() : "",
          ].filter(Boolean);
          const notes = noteParts.length > 0 ? noteParts.join(" • ") : undefined;
          const poNumber = deliv?.PONum ? String(deliv.PONum).trim() : undefined;
          const enteredBy = deliv?.Initials ? String(deliv.Initials).trim() : undefined;
          const orderedBy = deliv?.OrderedBy ? String(deliv.OrderedBy).trim() : undefined;
          const priority = deliv?.DeliveryPriority?.DeliveryPriorityDesc
            ? String(deliv.DeliveryPriority.DeliveryPriorityDesc).trim()
            : undefined;

          if (hasSeededInitialIds && !knownOpenOrderIds.has(deliveryId)) {
            newAlerts.push({
              id: `hss-open-alert-${deliveryId}-${Date.now()}`,
              kind: "open_order",
              deliveryId,
              deliveryDateISO: todayISO,
              driverName: rawDriver || "Open Order",
              originHub,
              accountName,
              ...(accountCode ? { accountCode } : {}),
              city: city || accountName,
              state: stateCode,
              ...(partsSummary ? { partsSummary } : {}),
              ...(piecesCount ? { piecesCount } : {}),
              ...(enteredBy ? { enteredBy } : {}),
              ...(poNumber ? { poNumber } : {}),
              ...(notes ? { notes } : {}),
              timestamp: nowIso,
            });
          }
          knownOpenOrderIds.add(deliveryId);

          nextOpenOrders.push({
            deliveryId,
            driverId,
            driverName: rawDriver || "Unassigned",
            originHub,
            accountName,
            ...(accountCode ? { accountCode } : {}),
            address,
            city: city || accountName,
            state: stateCode,
            ...(zip ? { zip } : {}),
            ...(phone ? { phone } : {}),
            ...(poNumber ? { poNumber } : {}),
            ...(enteredBy ? { enteredBy } : {}),
            ...(orderedBy ? { orderedBy } : {}),
            ...(priority ? { priority } : {}),
            ...(partsSummary ? { partsSummary } : {}),
            ...(piecesCount ? { piecesCount } : {}),
            ...(notes ? { notes } : {}),
            lat,
            lon,
            ...(deliv?.CreateDate ? { createdAt: String(deliv.CreateDate) } : {}),
          });
        }
      }
    }

    const prevOpenJson = JSON.stringify(latestOpenOrders.map((o) => o.deliveryId));
    const nextOpenJson = JSON.stringify(nextOpenOrders.map((o) => o.deliveryId));
    const openOrdersChanged = prevOpenJson !== nextOpenJson;
    latestOpenOrders = nextOpenOrders;

    // Merge discovered API routes with any non-API routes (e.g. manual or historical PDF routes)
    const polledDatesSet = new Set(pollDates);
    const discoveredIdsSet = new Set(discoveredApiRoutes.map((r) => r.id));
    // Prune API routes older than 2 days from active state (already archived in data/hotshot-history.json)
    const cutoffRetainISO = getCentralDateISO(new Date(now.getTime() - 2 * 24 * 3600_000));

    const retainedOtherRoutes = existingRoutes.filter((r) => {
      if (matchedLegacyRouteIds.has(r.id)) return false;
      if (discoveredIdsSet.has(r.id)) return false;
      const isApiRoute = r.sourceType === "api" || r.id.startsWith("hss-sheet-");
      if (isApiRoute && r.deliveryDateISO < cutoffRetainISO) {
        return false;
      }
      // If an API route on one of the polled dates was deleted in HotShotSheet, remove it here too
      if (isApiRoute && polledDatesSet.has(r.deliveryDateISO)) {
        return false;
      }
      return true;
    });

    const combinedRoutes = [...discoveredApiRoutes, ...retainedOtherRoutes];

    // Check if routes actually changed before writing to disk/DB
    const signatureOf = (list: HotShotRoute[]) =>
      JSON.stringify(
        list.map((r) => ({
          id: r.id,
          date: r.deliveryDateISO,
          hub: r.originHub,
          drv: r.driverName,
          veh: r.vehicleId,
          stops: r.stops.map((s) => ({
            id: s.id,
            ord: s.order,
            acc: s.accountName,
            pcs: s.piecesCount,
            done: s.completedAt,
            lat: s.lat,
            lon: s.lon,
          })),
        })),
      );

    const routesMutated = signatureOf(existingRoutes) !== signatureOf(combinedRoutes);
    if (routesMutated) {
      state.hotShotRoutes = combinedRoutes;
      await saveDisplayState(state);
    }

    if (newAlerts.length > 0) {
      for (const al of newAlerts) {
        recentDeliveryAlerts.unshift(al);
      }
      while (recentDeliveryAlerts.length > MAX_RECENT_ALERTS) {
        recentDeliveryAlerts.pop();
      }
    }

    hasSeededInitialIds = true;

    syncStatus = {
      enabled: true,
      isPolling: false,
      lastSyncedAt: nowIso,
      lastError: null,
      todaySheetCount: discoveredApiRoutes.filter((r) => r.deliveryDateISO === todayISO)
        .length,
      upcomingSheetCount: discoveredApiRoutes.filter((r) => r.deliveryDateISO > todayISO)
        .length,
      openOrderCount: latestOpenOrders.length,
      pollIntervalSec: Math.round(POLL_INTERVAL_MS / 1000),
    };

    if ((routesMutated || openOrdersChanged || newAlerts.length > 0) && onSyncHook) {
      await onSyncHook({ routesMutated, openOrdersChanged, newAlerts });
    }

    return { ok: true, status: getHotShotSyncStatus(), newAlerts };
  } catch (err: any) {
    const msg = err?.message || "Failed syncing with HotShotSheet API";
    syncStatus.isPolling = false;
    syncStatus.lastError = msg;
    log(`HotShotSheet sync error: ${msg}`, "hotshot-api");
    return { ok: false, status: getHotShotSyncStatus(), newAlerts: [] };
  } finally {
    isPolling = false;
    syncStatus.isPolling = false;
  }
}

export function startHotShotSheetPolling(): void {
  if (pollingTimer) return;
  log(
    `Starting HotShotSheet API poller (every ${Math.round(POLL_INTERVAL_MS / 1000)}s)`,
    "hotshot-api",
  );
  void syncHotShotSheetNow();
  pollingTimer = setInterval(() => {
    void syncHotShotSheetNow();
  }, POLL_INTERVAL_MS);
}

export async function buildTestHotShotDeliveryAlert(): Promise<HotShotDeliveryAlert> {
  const state = await getDisplayState();
  const routes = normalizeHotShotRoutes(state.hotShotRoutes);
  const todayISO = getCentralDateISO(new Date());
  const tomorrowDate = new Date(Date.now() + 24 * 3600_000);
  const tomorrowISO = getCentralDateISO(tomorrowDate);

  // Prefer a real stop from tomorrow's scheduled sheet, or today's sheet, or open orders
  const upcomingRoute =
    routes.find((r) => r.deliveryDateISO > todayISO && r.stops.length > 0) ||
    routes.find((r) => r.deliveryDateISO === todayISO && r.stops.length > 0);

  if (upcomingRoute && upcomingRoute.stops[0]) {
    const s = upcomingRoute.stops[0];
    return {
      id: `hss-test-alert-${Date.now()}`,
      kind:
        upcomingRoute.deliveryDateISO > todayISO
          ? "tomorrow_sheet_stop"
          : "today_sheet_stop",
      deliveryId: s.externalDeliveryId || 999999,
      deliveryDateISO: upcomingRoute.deliveryDateISO,
      driverName: upcomingRoute.driverName,
      originHub: upcomingRoute.originHub || "sioux_falls",
      accountName: s.accountName,
      ...(s.accountCode ? { accountCode: s.accountCode } : {}),
      city: s.city,
      state: s.state,
      partsSummary: s.partsSummary || "2x MTP-48/H6",
      piecesCount: s.piecesCount || 2,
      enteredBy: s.enteredBy || "Dispatch",
      poNumber: s.poNumber,
      notes: s.notes,
      timestamp: new Date().toISOString(),
    };
  }

  return {
    id: `hss-test-alert-${Date.now()}`,
    kind: "tomorrow_sheet_stop",
    deliveryId: 999999,
    deliveryDateISO: tomorrowISO,
    driverName: "SF Matt",
    originHub: "sioux_falls",
    accountName: "KIBBLE EQUIPMENT-GARRETSON",
    accountCode: "4849",
    city: "Garretson",
    state: "SD",
    partsSummary: "TY24932B (2) • TY25221B (1)",
    piecesCount: 3,
    enteredBy: "Dispatch",
    poNumber: "2005887463",
    timestamp: new Date().toISOString(),
  };
}
