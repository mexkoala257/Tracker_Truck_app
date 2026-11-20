import crypto from "node:crypto";
import {
  type HotShotStop,
  type HotShotOriginHub,
  parseHotShotDateToISO,
  matchHotShotDriverToRoster,
  buildHotShotTownSequenceLabel,
  haversineMiles,
  inferHotShotOriginHub,
  stripLocationPrefix,
  getHotShotHubMeta,
} from "@shared/hotshots";
import {
  type RouteTerritoryDefinition,
  lookupKnownTownCoords,
} from "@shared/routeTerritories";

// Node 20 compatibility polyfill for pdfjs-dist / unpdf (Promise.withResolvers was added in Node 22)
if (typeof (Promise as any).withResolvers !== "function") {
  (Promise as any).withResolvers = function <T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: any) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

interface PositionedTextItem {
  str: string;
  x: number;
  y: number;
}

interface TextLine {
  y: number;
  xMin: number;
  text: string;
}

export interface ParsedHotShotPdfResult {
  rawPdfDriver: string;
  suggestedDriver: string;
  suggestedOriginHub: HotShotOriginHub;
  deliveryDateISO: string;
  rawDeliveryDate: string;
  suggestedTitle: string;
  stops: HotShotStop[];
  totalPieces: number;
  pageCount: number;
}

function titleCaseCity(raw: string): string {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "";
  // If all uppercase (e.g. "GARRETSON" or "SIOUX FALLS"), convert to Title Case
  if (trimmed === trimmed.toUpperCase()) {
    return trimmed
      .toLowerCase()
      .replace(/\b([a-z])/g, (_, ch: string) => ch.toUpperCase());
  }
  return trimmed;
}

function groupItemsIntoLines(items: PositionedTextItem[], yTolerance = 4): TextLine[] {
  const sorted = [...items].sort((a, b) => {
    if (Math.abs(b.y - a.y) > yTolerance) return b.y - a.y;
    return a.x - b.x;
  });

  const clusters: Array<{ ySum: number; items: PositionedTextItem[] }> = [];
  for (const it of sorted) {
    const clean = it.str.replace(/\s+/g, " ").trim();
    if (!clean) continue;
    const matchCluster = clusters.find(
      (c) => Math.abs(c.ySum / c.items.length - it.y) <= yTolerance,
    );
    if (matchCluster) {
      matchCluster.items.push(it);
      matchCluster.ySum += it.y;
    } else {
      clusters.push({ ySum: it.y, items: [it] });
    }
  }

  return clusters
    .map((c) => {
      const rowItems = c.items.sort((a, b) => a.x - b.x);
      let lineText = "";
      for (const part of rowItems) {
        const tok = part.str.replace(/\s+/g, " ").trim();
        if (!tok) continue;
        if (!lineText) {
          lineText = tok;
        } else if (/^[,.;:)\]]/.test(tok)) {
          lineText += tok;
        } else {
          lineText += ` ${tok}`;
        }
      }
      return {
        y: c.ySum / rowItems.length,
        xMin: rowItems[0]?.x ?? 0,
        text: lineText.trim(),
      };
    })
    .sort((a, b) => b.y - a.y);
}

export async function geocodeStreetOrTown(
  address: string,
  city: string,
  state: string,
  zip: string | undefined,
  extraTerritories?: RouteTerritoryDefinition[],
  originHub: HotShotOriginHub = "sioux_falls",
): Promise<{ lat: number; lon: number; precision: "street" | "town" }> {
  const knownTown = lookupKnownTownCoords(city, state, extraTerritories);

  // 1. Attempt street-level geocoding via Nominatim if we have a street address
  if (address && city) {
    try {
      const q = [address, city, state, zip].filter(Boolean).join(", ");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1800);
      const nomUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
        q,
      )}&format=json&limit=1&countrycodes=us`;
      const res = await fetch(nomUrl, {
        headers: {
          "User-Agent": "FleetOperationsCommand/1.0 (HotShotRouteDispatch)",
          Accept: "application/json",
        },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        const arr: any[] = await res.json();
        if (Array.isArray(arr) && arr.length > 0) {
          const lat = Number(arr[0].lat);
          const lon = Number(arr[0].lon);
          if (Number.isFinite(lat) && Number.isFinite(lon)) {
            // Sanity check: if we know the town center, ensure street result is within 25 miles
            if (!knownTown || haversineMiles(knownTown.lat, knownTown.lon, lat, lon) <= 25) {
              return {
                lat: Number(lat.toFixed(5)),
                lon: Number(lon.toFixed(5)),
                precision: "street",
              };
            }
          }
        }
      }
    } catch {
      // Fall through to fast local/town lookup
    }
  }

  // 2. Fast local routeTerritories town lookup (covers 200+ SD/MN/IA towns instantaneously)
  if (knownTown) {
    return {
      lat: knownTown.lat,
      lon: knownTown.lon,
      precision: "town",
    };
  }

  // 3. Open-Meteo city fallback for out-of-corridor towns
  if (city) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1800);
      const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
        city,
      )}&count=8&language=en&format=json`;
      const res = await fetch(geoUrl, { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) {
        const json: any = await res.json();
        const usResults = (json?.results || []).filter((r: any) => r.country_code === "US");
        const stateCode = state.toUpperCase();
        const stateNames: Record<string, string> = {
          SD: "South Dakota",
          MN: "Minnesota",
          IA: "Iowa",
          ND: "North Dakota",
          NE: "Nebraska",
          WY: "Wyoming",
          WI: "Wisconsin",
        };
        const targetAdmin = stateNames[stateCode]?.toLowerCase();
        const chosen =
          (targetAdmin &&
            usResults.find((r: any) => String(r.admin1 || "").toLowerCase() === targetAdmin)) ||
          usResults[0];
        if (chosen && Number.isFinite(Number(chosen.latitude)) && Number.isFinite(Number(chosen.longitude))) {
          return {
            lat: Number(Number(chosen.latitude).toFixed(4)),
            lon: Number(Number(chosen.longitude).toFixed(4)),
            precision: "town",
          };
        }
      }
    } catch {}
  }

  // Default origination hub fallback if completely unknown
  const fallbackHub = getHotShotHubMeta(originHub);
  return { lat: fallbackHub.latitude, lon: fallbackHub.longitude, precision: "town" };
}

export async function parseHotShotPdfBuffer(
  pdfBuffer: Buffer | Uint8Array,
  options: {
    sfRosterNames?: string[];
    customTerritories?: RouteTerritoryDefinition[];
  } = {},
): Promise<ParsedHotShotPdfResult> {
  const bytes = new Uint8Array(pdfBuffer);
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  const pageCount = pdf.numPages;

  let rawPdfDriver = "";
  let rawDeliveryDate = "";
  let headerOriginHint = "";
  const rawStops: Array<Omit<HotShotStop, "lat" | "lon" | "geocodePrecision">> = [];

  for (let p = 1; p <= pageCount; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const items: PositionedTextItem[] = [];

    for (const rawItem of tc.items as any[]) {
      if (!rawItem || typeof rawItem.str !== "string") continue;
      const str = rawItem.str.trim();
      if (!str) continue;
      const x = Number(rawItem.transform?.[4] ?? 0);
      const y = Number(rawItem.transform?.[5] ?? 0);
      items.push({ str, x, y });
    }

    const allPageLines = groupItemsIntoLines(items, 4);

    // Extract Driver, Origination Hint & Delivery Date from top header area
    for (const ln of allPageLines) {
      if (!rawPdfDriver) {
        const drvMatch = ln.text.match(/\bDriver\s*[:\-]?\s*(.+)$/i);
        if (drvMatch && drvMatch[1]) {
          const candidate = drvMatch[1].replace(/\bDelivery\s+Date.*$/i, "").trim();
          if (candidate) rawPdfDriver = candidate;
        }
      }
      if (!headerOriginHint) {
        const orgMatch = ln.text.match(/\b(?:Origin|Warehouse|Location|From)\s*[:\-]?\s*(Arlington|ARL|Sioux\s+Falls|SF)\b/i);
        if (orgMatch && orgMatch[1]) {
          headerOriginHint = orgMatch[1].trim();
        }
      }
      if (!rawDeliveryDate) {
        const dtMatch = ln.text.match(/\bDelivery\s+Date\s*[:\-]?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
        if (dtMatch && dtMatch[1]) {
          rawDeliveryDate = dtMatch[1].trim();
        }
      }
    }

    // Detect table header Y & column X boundaries
    const headerAnchor = items.find(
      (it) => /^Dealer$/i.test(it.str) || /^Order$/i.test(it.str),
    );
    const headerMinY = headerAnchor ? headerAnchor.y - 32 : 690;

    // Detect footer Y ("© 2026 - Hot Shot Sheet") so we never absorb footer lines into the last stop
    const footerItem = items.find(
      (it) => it.str.includes("Hot Shot Sheet") || it.str.startsWith("©"),
    );
    const footerY = footerItem ? footerItem.y + 8 : 40;

    const dealerColX = 82;
    const poColX = 262;
    const partsColX = 365;

    const bodyItems = items.filter((it) => it.y < headerMinY && it.y > footerY);

    // Find stop start anchors: standalone integer in the left "Order / Entered By" column (x < dealerColX)
    const stopAnchors = bodyItems
      .filter((it) => it.x < dealerColX && /^\d{1,2}$/.test(it.str))
      .sort((a, b) => b.y - a.y);

    for (let sIdx = 0; sIdx < stopAnchors.length; sIdx++) {
      const anchor = stopAnchors[sIdx];
      const nextAnchor = stopAnchors[sIdx + 1];
      const bandTopY = anchor.y + 6;
      const bandBottomY = nextAnchor ? nextAnchor.y + 6 : footerY;

      const rowItems = bodyItems.filter((it) => it.y <= bandTopY && it.y > bandBottomY);

      const leftLines = groupItemsIntoLines(
        rowItems.filter((it) => it.x < dealerColX),
        4,
      );
      const dealerLines = groupItemsIntoLines(
        rowItems.filter((it) => it.x >= dealerColX && it.x < poColX),
        4,
      );
      const poLines = groupItemsIntoLines(
        rowItems.filter((it) => it.x >= poColX && it.x < partsColX),
        4,
      );
      const partsLines = groupItemsIntoLines(
        rowItems.filter((it) => it.x >= partsColX),
        4,
      );

      const stopOrder = Number(anchor.str) || rawStops.length + 1;
      const enteredByLine = leftLines.find((l) => !/^\d{1,2}$/.test(l.text));
      const enteredBy = enteredByLine?.text || undefined;

      // Parse Dealer Column: Account Name, [AccountCode], Address, City/State/Zip, Phone
      let phone: string | undefined;
      let city = "";
      let state = "SD";
      let zip: string | undefined;
      let accountCode: string | undefined;
      const remainingDealerLines: string[] = [];

      for (const dl of dealerLines) {
        const txt = dl.text.trim();
        if (!txt) continue;

        if (/^Phone\s*:/i.test(txt)) {
          const ph = txt.replace(/^Phone\s*:\s*/i, "").trim();
          if (ph) phone = ph;
          continue;
        }

        // Standalone [4849] account code line
        const standaloneCode = txt.match(/^\[([A-Za-z0-9-]+)\]$/);
        if (standaloneCode) {
          accountCode = standaloneCode[1];
          continue;
        }

        // City, ST ZIP line (e.g. "GARRETSON, SD 57030" or "Luverne, MN 56156")
        const cityMatch = txt.match(
          /^([A-Za-z0-9 .'-]+?)\s*,\s*([A-Z]{2})(?:\s+(\d{5}(?:-\d{4})?))?$/i,
        );
        if (cityMatch) {
          city = titleCaseCity(cityMatch[1]);
          state = cityMatch[2].toUpperCase();
          if (cityMatch[3]) zip = cityMatch[3];
          continue;
        }

        remainingDealerLines.push(txt);
      }

      let accountName = remainingDealerLines[0] || "Customer Delivery";
      // Strip inline [107045] code from accountName if present
      const inlineCode = accountName.match(/\[([A-Za-z0-9-]+)\]/);
      if (inlineCode) {
        if (!accountCode) accountCode = inlineCode[1];
        accountName = accountName.replace(/\s*\[[A-Za-z0-9-]+\]\s*/, " ").trim();
      }

      const address = remainingDealerLines.slice(1).join(", ").trim();

      // Parse PO & Notes Column
      let poNumber: string | undefined;
      const noteParts: string[] = [];
      for (let i = 0; i < poLines.length; i++) {
        const pTxt = poLines[i].text.trim();
        if (!pTxt) continue;
        if (i === 0 && !pTxt.startsWith("*")) {
          poNumber = pTxt;
          continue;
        }
        // Skip Entered Timestamp ("11/02/26 8:59AM") and short enteredBy initials ("mr")
        if (/^\d{1,2}\/\d{1,2}\/\d{2,4}\s+\d{1,2}:\d{2}\s*(?:AM|PM)?$/i.test(pTxt)) {
          continue;
        }
        if (enteredBy && pTxt.toLowerCase() === enteredBy.toLowerCase()) {
          continue;
        }
        if (/^[a-z]{1,4}$/i.test(pTxt) && i <= 2) {
          continue;
        }
        noteParts.push(pTxt);
      }
      const notes = noteParts.length > 0 ? noteParts.join(" ").replace(/\s+/g, " ").trim() : undefined;

      // Parse Parts & Piece Counts Column
      let piecesCount = 0;
      const partDescriptions: string[] = [];
      for (const pl of partsLines) {
        const pt = pl.text.trim();
        if (!pt || /^Picked\s+By\s*:/i.test(pt)) continue;
        const qtyMatch = pt.match(/(\d+)\s*\/\s*(\d+)\s*$/);
        if (qtyMatch) {
          const ordered = Number(qtyMatch[1]) || 0;
          const picked = Number(qtyMatch[2]) || ordered;
          piecesCount += picked || ordered;
          const partLabel = pt.slice(0, qtyMatch.index).trim();
          partDescriptions.push(
            partLabel ? `${partLabel} (${picked || ordered})` : `${picked || ordered} pcs`,
          );
        } else {
          partDescriptions.push(pt);
        }
      }

      rawStops.push({
        id: `hs-stop-${crypto.randomBytes(4).toString("hex")}`,
        order: stopOrder,
        accountName,
        ...(accountCode ? { accountCode } : {}),
        address,
        city: city || accountName,
        state,
        ...(zip ? { zip } : {}),
        ...(phone ? { phone } : {}),
        ...(poNumber ? { poNumber } : {}),
        ...(enteredBy ? { enteredBy } : {}),
        ...(partDescriptions.length > 0 ? { partsSummary: partDescriptions.join(" • ") } : {}),
        ...(piecesCount > 0 ? { piecesCount } : {}),
        ...(notes ? { notes } : {}),
        completedAt: null,
        completedBy: null,
      });
    }
  }

  const suggestedOriginHub = inferHotShotOriginHub(rawPdfDriver || headerOriginHint);

  // Geocode stops (local lookup + fast street check)
  const geocodedStops: HotShotStop[] = [];
  for (const s of rawStops) {
    const geo = await geocodeStreetOrTown(
      s.address,
      s.city,
      s.state,
      s.zip,
      options.customTerritories,
      suggestedOriginHub,
    );
    geocodedStops.push({
      ...s,
      lat: geo.lat,
      lon: geo.lon,
      geocodePrecision: geo.precision,
    });
  }

  const deliveryDateISO = parseHotShotDateToISO(rawDeliveryDate);
  const suggestedDriver =
    suggestedOriginHub === "arlington"
      ? stripLocationPrefix(rawPdfDriver) || rawPdfDriver
      : matchHotShotDriverToRoster(rawPdfDriver, options.sfRosterNames || []);
  const suggestedTitle = buildHotShotTownSequenceLabel(geocodedStops, 5);
  const totalPieces = geocodedStops.reduce((sum, s) => sum + (s.piecesCount || 0), 0);

  return {
    rawPdfDriver,
    suggestedDriver: suggestedDriver || rawPdfDriver || "",
    suggestedOriginHub,
    deliveryDateISO,
    rawDeliveryDate,
    suggestedTitle,
    stops: geocodedStops,
    totalPieces,
    pageCount,
  };
}
