export interface ScheduleDayHeader {
  day: string;
  date: string;
}

export interface TruckScheduleRow {
  driver: string;
  vehicleKey: string;
  color: string;
  days: string[];
}

export interface TruckWeekBlock {
  /** Monday ISO date "YYYY-MM-DD" */
  weekStartISO?: string;
  label: string;
  days: ScheduleDayHeader[];
  rows: TruckScheduleRow[];
  notes: string;
}

export interface TruckDriverRosterItem {
  driver: string;
  vehicleKey: string;
  color: string;
}

export interface TruckScheduleState {
  /** Keyed by Monday ISO date "YYYY-MM-DD" — preserves past history, current week, and future monthly schedules */
  weeks: Record<string, TruckWeekBlock>;
  /** Master pool of saved route names */
  routeOptions: string[];
  /** Per-driver assigned route subsets keyed by driver label (e.g. "T01-Sonny": ["REDWOOD", "BENSON", ...]) */
  driverRoutes: Record<string, string[]>;
  /** Default driver roster carried forward when opening an uninitialized week */
  driverRoster: TruckDriverRosterItem[];
  /** Kept synced for any external/legacy readers */
  currentWeek?: TruckWeekBlock;
  nextWeek?: TruckWeekBlock;
}

export const DEFAULT_ROUTE_OPTIONS: string[] = [
  "OFF",
  "PTO",
  "WHS",
  "SF",
  "ABERDEEN",
  "BENSON",
  "BROOKINGS",
  "CAN/HAW/LUV",
  "CANTON",
  "CHAMBERLAIN-BOM/CHAMB",
  "FAIR/BOMG-PIPE/SLAY/FAIR/SPIRIT",
  "FAIR/SPIRIT",
  "HURON",
  "IOWA",
  "LENNOX",
  "MARSHALL",
  "MIDWEST",
  "MILLER",
  "MITCHELL",
  "ORTON",
  "PIPESTONE",
  "REDFIELD",
  "REDWOOD",
  "SLEEPY EYE-BOM/PIPE/SLAY",
  "SPRINGS",
  "WATERTOWN",
  "WEBSTER",
  "YAN/WAG/CHAMB",
  "YANK/WAG",
  "YANKTON",
];

export const DEFAULT_DRIVER_ROSTER: TruckDriverRosterItem[] = [
  { driver: "T01-Sonny", vehicleKey: "T01", color: "#38bdf8" },
  { driver: "T02-Brandon", vehicleKey: "T22", color: "#fb923c" },
  { driver: "TO3-Nate", vehicleKey: "T03", color: "#facc15" },
  { driver: "T04-Troy", vehicleKey: "T04", color: "#60a5fa" },
  { driver: "T05-Ron", vehicleKey: "T05", color: "#94a3b8" },
  { driver: "Bomg/SF Hotshot", vehicleKey: "Van GO - SF", color: "#c084fc" },
];

export const DEFAULT_DRIVER_ROUTES: Record<string, string[]> = {
  "T01-Sonny": ["BENSON", "REDFIELD", "REDWOOD", "WEBSTER", "YANKTON"],
  "T02-Brandon": [
    "FAIR/BOMG-PIPE/SLAY/FAIR/SPIRIT",
    "HURON",
    "MITCHELL",
    "SLEEPY EYE-BOM/PIPE/SLAY",
  ],
  "TO3-Nate": [
    "CHAMBERLAIN-BOM/CHAMB",
    "IOWA",
    "MARSHALL",
    "MIDWEST",
    "ORTON",
    "SPRINGS",
  ],
  "T04-Troy": ["ABERDEEN", "BROOKINGS", "MILLER", "PIPESTONE", "WATERTOWN"],
  "T05-Ron": ["CANTON", "LENNOX", "SF", "WHS"],
  "Bomg/SF Hotshot": ["CAN/HAW/LUV", "FAIR/SPIRIT", "SF", "WHS", "YAN/WAG/CHAMB", "YANK/WAG"],
};

const DAY_NAMES = ["MON", "TUE", "WED", "THU", "FRI"] as const;

export function formatIsoDate(year: number, month0: number, day: number): string {
  const dt = new Date(year, month0, day, 12, 0, 0);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0);
}

export function formatUsDate(dt: Date): string {
  return `${dt.getMonth() + 1}/${dt.getDate()}/${dt.getFullYear()}`;
}

export function formatShortUsDate(dt: Date): string {
  return `${dt.getMonth() + 1}/${dt.getDate()}`;
}

/**
 * Parses a legacy M/D/YYYY or M/D/YY string into a Monday "YYYY-MM-DD" ISO key.
 */
export function parseSlashDateToMondayIso(slashDate: string | undefined): string | null {
  if (!slashDate) return null;
  const parts = slashDate.trim().split("/");
  if (parts.length < 2) return null;
  const month = Number(parts[0]);
  const day = Number(parts[1]);
  let year = parts[2] ? Number(parts[2]) : new Date().getFullYear();
  if (year < 100) year += 2000;
  if (!Number.isFinite(month) || !Number.isFinite(day) || !Number.isFinite(year)) return null;
  const dt = new Date(year, month - 1, day, 12, 0, 0);
  if (isNaN(dt.getTime())) return null;
  return getWorkweekMondayIso(dt, false);
}

/**
 * Returns the Monday ISO date ("YYYY-MM-DD") for a given Date.
 * When `advanceOnWeekend` is true (used by TV Display), Saturday & Sunday
 * automatically advance to the upcoming Monday so Monday's routes show over the weekend.
 */
export function getWorkweekMondayIso(now = new Date(), advanceOnWeekend = true): string {
  // Resolve calendar date in America/Chicago so server UTC timezone never shifts midnight early
  let year = now.getFullYear();
  let month0 = now.getMonth();
  let day = now.getDate();
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "numeric",
      day: "numeric",
    }).formatToParts(now);
    const y = Number(parts.find((p) => p.type === "year")?.value);
    const m = Number(parts.find((p) => p.type === "month")?.value);
    const d = Number(parts.find((p) => p.type === "day")?.value);
    if (y && m && d) {
      year = y;
      month0 = m - 1;
      day = d;
    }
  } catch {
    // Fallback to local system time
  }

  const localNoon = new Date(year, month0, day, 12, 0, 0);
  const dow = localNoon.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat

  if (dow === 6) {
    // Saturday: +2 days if advancing to upcoming workweek, else -5 days to current week's Monday
    localNoon.setDate(localNoon.getDate() + (advanceOnWeekend ? 2 : -5));
  } else if (dow === 0) {
    // Sunday: +1 day if advancing to upcoming workweek, else -6 days
    localNoon.setDate(localNoon.getDate() + (advanceOnWeekend ? 1 : -6));
  } else {
    localNoon.setDate(localNoon.getDate() - (dow - 1));
  }

  return formatIsoDate(localNoon.getFullYear(), localNoon.getMonth(), localNoon.getDate());
}

export function shiftMondayIso(mondayIso: string, deltaWeeks: number): string {
  const dt = parseIsoDate(mondayIso);
  dt.setDate(dt.getDate() + deltaWeeks * 7);
  return formatIsoDate(dt.getFullYear(), dt.getMonth(), dt.getDate());
}

/**
 * Returns all Monday ISO dates ("YYYY-MM-DD") whose Mon–Fri workweek falls in or overlaps
 * the given calendar month (`month0` = 0..11).
 */
export function getMondaysForMonth(year: number, month0: number): string[] {
  const firstOfMonth = new Date(year, month0, 1, 12, 0, 0);
  const lastOfMonth = new Date(year, month0 + 1, 0, 12, 0, 0);

  // Find Monday on or before the 1st of the month
  const cursor = new Date(firstOfMonth);
  const dow = cursor.getDay();
  const offsetToMonday = dow === 0 ? -6 : 1 - dow;
  cursor.setDate(cursor.getDate() + offsetToMonday);

  const mondays: string[] = [];
  while (cursor <= lastOfMonth) {
    const friday = new Date(cursor);
    friday.setDate(friday.getDate() + 4);
    // Include this workweek if at least one weekday (Mon–Fri) is inside the target month
    if (cursor.getMonth() === month0 || friday.getMonth() === month0) {
      mondays.push(formatIsoDate(cursor.getFullYear(), cursor.getMonth(), cursor.getDate()));
    }
    cursor.setDate(cursor.getDate() + 7);
  }
  return mondays;
}

export function buildDaysForMonday(mondayIso: string): ScheduleDayHeader[] {
  const start = parseIsoDate(mondayIso);
  return DAY_NAMES.map((dayName, idx) => {
    const d = new Date(start);
    d.setDate(start.getDate() + idx);
    return {
      day: dayName,
      date: formatUsDate(d),
    };
  });
}

export function buildWeekLabel(mondayIso: string): string {
  const days = buildDaysForMonday(mondayIso);
  return `Week of ${days[0].date} – ${days[4].date}`;
}

export function buildShortWeekRange(mondayIso: string): string {
  const mon = parseIsoDate(mondayIso);
  const fri = new Date(mon);
  fri.setDate(mon.getDate() + 4);
  return `${formatShortUsDate(mon)} – ${formatShortUsDate(fri)}`;
}

export function createBlankWeekBlock(
  mondayIso: string,
  roster: TruckDriverRosterItem[] = DEFAULT_DRIVER_ROSTER,
  notes = "Have a great week!",
): TruckWeekBlock {
  const days = buildDaysForMonday(mondayIso);
  return {
    weekStartISO: mondayIso,
    label: `Week of ${days[0].date} – ${days[4].date}`,
    days,
    rows: roster.map((r) => ({
      driver: r.driver,
      vehicleKey: r.vehicleKey,
      color: r.color || "#38bdf8",
      days: ["", "", "", "", ""],
    })),
    notes,
  };
}

export function countAssignedCells(week: TruckWeekBlock | undefined): number {
  if (!week?.rows) return 0;
  let count = 0;
  for (const row of week.rows) {
    for (const cell of row.days || []) {
      if (cell && cell.trim()) count++;
    }
  }
  return count;
}

/**
 * Normalizes any legacy `{ currentWeek, nextWeek }` or modern `{ weeks, routeOptions, driverRoster }`
 * truckSchedule object into a complete, backward-compatible `TruckScheduleState`.
 */
export function normalizeTruckScheduleState(raw: any, now = new Date()): TruckScheduleState {
  const weeks: Record<string, TruckWeekBlock> = {};

  // 1. Copy existing weeks map if present
  if (raw?.weeks && typeof raw.weeks === "object") {
    for (const [isoKey, block] of Object.entries(raw.weeks as Record<string, any>)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(isoKey) && block && Array.isArray(block.rows)) {
        const expectedDays = buildDaysForMonday(isoKey);
        weeks[isoKey] = {
          weekStartISO: isoKey,
          label: block.label || `Week of ${expectedDays[0].date} – ${expectedDays[4].date}`,
          days: Array.isArray(block.days) && block.days.length === 5 ? block.days : expectedDays,
          rows: block.rows.map((r: any) => ({
            driver: String(r.driver || ""),
            vehicleKey: String(r.vehicleKey || ""),
            color: String(r.color || "#38bdf8"),
            days: Array.from({ length: 5 }, (_, i) => String(r.days?.[i] ?? "")),
          })),
          notes: typeof block.notes === "string" ? block.notes : "Have a great week!",
        };
      }
    }
  }

  // 2. Migrate legacy currentWeek / nextWeek if not already in `weeks`
  for (const legacyBlock of [raw?.currentWeek, raw?.nextWeek]) {
    if (legacyBlock && Array.isArray(legacyBlock.rows)) {
      const iso = parseSlashDateToMondayIso(legacyBlock.days?.[0]?.date);
      if (iso && !weeks[iso]) {
        const expectedDays = buildDaysForMonday(iso);
        weeks[iso] = {
          weekStartISO: iso,
          label: legacyBlock.label || `Week of ${expectedDays[0].date} – ${expectedDays[4].date}`,
          days:
            Array.isArray(legacyBlock.days) && legacyBlock.days.length === 5
              ? legacyBlock.days
              : expectedDays,
          rows: legacyBlock.rows.map((r: any) => ({
            driver: String(r.driver || ""),
            vehicleKey: String(r.vehicleKey || ""),
            color: String(r.color || "#38bdf8"),
            days: Array.from({ length: 5 }, (_, i) => String(r.days?.[i] ?? "")),
          })),
          notes: typeof legacyBlock.notes === "string" ? legacyBlock.notes : "Have a great week!",
        };
      }
    }
  }

  // 3. Determine driver roster (explicit roster -> latest populated week -> default)
  let driverRoster: TruckDriverRosterItem[] = [];
  if (Array.isArray(raw?.driverRoster) && raw.driverRoster.length > 0) {
    driverRoster = raw.driverRoster.map((r: any) => ({
      driver: String(r.driver || ""),
      vehicleKey: String(r.vehicleKey || ""),
      color: String(r.color || "#38bdf8"),
    }));
  } else {
    const sortedKeys = Object.keys(weeks).sort();
    const latestWeek = sortedKeys.length > 0 ? weeks[sortedKeys[sortedKeys.length - 1]] : null;
    if (latestWeek && latestWeek.rows.length > 0) {
      driverRoster = latestWeek.rows.map((r) => ({
        driver: r.driver,
        vehicleKey: r.vehicleKey,
        color: r.color || "#38bdf8",
      }));
    } else {
      driverRoster = structuredClone(DEFAULT_DRIVER_ROSTER);
    }
  }

  // 4. Build routeOptions (preserve explicit user list if saved, otherwise seed defaults + any existing cell routes)
  let routeOptions: string[];
  if (Array.isArray(raw?.routeOptions) && raw.routeOptions.length > 0) {
    const seen = new Set<string>();
    routeOptions = [];
    for (const item of raw.routeOptions) {
      const trimmed = String(item || "").trim();
      if (trimmed && !seen.has(trimmed)) {
        seen.add(trimmed);
        routeOptions.push(trimmed);
      }
    }
  } else {
    const specialTop = ["OFF", "PTO", "WHS", "SF"];
    const dynamicSet = new Set<string>(DEFAULT_ROUTE_OPTIONS);
    for (const wk of Object.values(weeks)) {
      for (const r of wk.rows) {
        for (const c of r.days) {
          const trimmed = (c || "").trim();
          if (trimmed && trimmed !== "!") dynamicSet.add(trimmed);
        }
      }
    }
    const rest = Array.from(dynamicSet)
      .filter((x) => !specialTop.includes(x))
      .sort((a, b) => a.localeCompare(b));
    routeOptions = [...specialTop, ...rest];
  }

  // 5. Build per-driver route assignments (preserve saved map, or auto-seed from defaults + historical driver cells)
  const driverRoutes: Record<string, string[]> = {};
  if (raw?.driverRoutes && typeof raw.driverRoutes === "object") {
    for (const [drv, list] of Object.entries(raw.driverRoutes as Record<string, any>)) {
      if (Array.isArray(list)) {
        const seen = new Set<string>();
        const cleaned: string[] = [];
        for (const item of list) {
          const t = String(item || "").trim();
          if (t && !seen.has(t)) {
            seen.add(t);
            cleaned.push(t);
          }
        }
        driverRoutes[drv] = cleaned;
      }
    }
  } else {
    for (const [drv, list] of Object.entries(DEFAULT_DRIVER_ROUTES)) {
      driverRoutes[drv] = [...list];
    }
    for (const wk of Object.values(weeks)) {
      for (const r of wk.rows) {
        const drv = (r.driver || "").trim();
        if (!drv) continue;
        const set = new Set<string>(driverRoutes[drv] || []);
        for (const c of r.days) {
          const trimmed = (c || "").trim();
          if (trimmed && trimmed !== "!" && trimmed.toUpperCase() !== "OFF" && trimmed.toUpperCase() !== "PTO") {
            set.add(trimmed);
          }
        }
        if (set.size > 0) {
          driverRoutes[drv] = Array.from(set).sort((a, b) => a.localeCompare(b));
        }
      }
    }
  }

  // 6. Compute active TV currentWeek + nextWeek snapshots for live TV convenience
  const activeMondayIso = getWorkweekMondayIso(now, true);
  const nextMondayIso = shiftMondayIso(activeMondayIso, 1);
  const currentWeek = weeks[activeMondayIso] || createBlankWeekBlock(activeMondayIso, driverRoster);
  const nextWeek = weeks[nextMondayIso] || createBlankWeekBlock(nextMondayIso, driverRoster);

  return {
    weeks,
    routeOptions,
    driverRoutes,
    driverRoster,
    currentWeek,
    nextWeek,
  };
}

/**
 * Returns the focused dropdown options for a specific driver (their assigned routes + OFF/PTO),
 * along with whether they have a dedicated route subset configured.
 */
export function getRoutesForDriver(
  schedule: TruckScheduleState,
  driverName: string,
): { options: string[]; isDriverScoped: boolean; assignedCount: number } {
  const assigned = schedule.driverRoutes?.[driverName] || [];
  if (assigned.length === 0) {
    return {
      options: schedule.routeOptions,
      isDriverScoped: false,
      assignedCount: 0,
    };
  }
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const r of assigned) {
    if (r && !seen.has(r)) {
      seen.add(r);
      ordered.push(r);
    }
  }
  for (const statusOpt of ["OFF", "PTO"]) {
    if (!seen.has(statusOpt)) {
      seen.add(statusOpt);
      ordered.push(statusOpt);
    }
  }
  return {
    options: ordered,
    isDriverScoped: true,
    assignedCount: assigned.length,
  };
}

/**
 * Resolves the active week to display on the TV screen for the given moment in time.
 */
export function resolveActiveTvTruckWeek(
  schedule: TruckScheduleState | any,
  now = new Date(),
): TruckWeekBlock {
  const normalized = normalizeTruckScheduleState(schedule, now);
  const activeMondayIso = getWorkweekMondayIso(now, true);
  return (
    normalized.weeks[activeMondayIso] ||
    createBlankWeekBlock(activeMondayIso, normalized.driverRoster)
  );
}
