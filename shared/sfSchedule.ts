import {
  type ScheduleDayHeader,
  formatIsoDate,
  parseIsoDate,
  formatUsDate,
  formatShortUsDate,
  parseSlashDateToMondayIso,
  shiftMondayIso,
  getMondaysForMonth,
  isHolidayCellValue,
  isDayColumnHoliday,
} from "./truckSchedule";

export { shiftMondayIso, getMondaysForMonth, isHolidayCellValue, isDayColumnHoliday };

export interface SfScheduleRow {
  name: string;
  color: string;
  days: string[];
}

export interface SfWeekBlock {
  /** Monday ISO date "YYYY-MM-DD" */
  weekStartISO?: string;
  label: string;
  days: ScheduleDayHeader[];
  rows: SfScheduleRow[];
  /** Bottom red banner line in the weekly email graphic (e.g. "Nick Kreger") */
  footerNote?: string;
}

export interface SfMemberRosterItem {
  name: string;
  color: string;
}

export interface SfScheduleState {
  /** Keyed by Monday ISO date "YYYY-MM-DD" — preserves past history, current week, and future monthly schedules */
  weeks: Record<string, SfWeekBlock>;
  /** Master pool of saved shift / role presets */
  shiftOptions: string[];
  /** Optional per-member assigned shift subsets keyed by team member name */
  memberShifts: Record<string, string[]>;
  /** Default team roster carried forward when opening an uninitialized week */
  memberRoster: SfMemberRosterItem[];
  /** Synced active week fields for backward compatibility */
  currentWeek?: SfWeekBlock;
  label: string;
  days: ScheduleDayHeader[];
  rows: SfScheduleRow[];
}

export const DEFAULT_SF_SHIFT_OPTIONS: string[] = [
  "7:15-4:15",
  "8:00-5:00",
  "8:30-5:30",
  "9:00-6:00",
  "Bomgaars",
  "OFF",
  "PTO",
  "HOLIDAY",
  "Crafts",
  "Ice Cream",
  "Floors",
  "Will Text",
];

export const CORE_WAREHOUSE_SHIFTS: string[] = [
  "7:15-4:15",
  "8:00-5:00",
  "8:30-5:30",
  "9:00-6:00",
  "Bomgaars",
];

export const DEFAULT_SF_ROSTER: SfMemberRosterItem[] = [
  { name: "Nick Kreger", color: "#fca5a5" },
  { name: "Jason Bonebrake", color: "#d8b4fe" },
  { name: "Jorge Ramirez", color: "#f87171" },
  { name: "Randy Schilling", color: "#fde047" },
  { name: "Terran Chapin", color: "#67e8f9" },
  { name: "Jacob Duman", color: "#cbd5e1" },
  { name: "Matthew Roberts", color: "#fdba74" },
  { name: "Michael DeWeerd", color: "#86efac" },
  { name: "Kaden Mellema", color: "#93c5fd" },
  { name: "Ian Klinski", color: "#c4b5fd" },
  { name: "Dan Mathiowetz", color: "#fcd34d" },
  { name: "Kasey Iverson", color: "#f9a8d4" },
  { name: "Jon Baker", color: "#5eead4" },
];

export const DEFAULT_SF_MEMBER_SHIFTS: Record<string, string[]> = {
  "Nick Kreger": [...CORE_WAREHOUSE_SHIFTS],
  "Jason Bonebrake": [...CORE_WAREHOUSE_SHIFTS],
  "Jorge Ramirez": [...CORE_WAREHOUSE_SHIFTS],
  "Randy Schilling": [...CORE_WAREHOUSE_SHIFTS],
  "Terran Chapin": [...CORE_WAREHOUSE_SHIFTS],
  "Jacob Duman": [...CORE_WAREHOUSE_SHIFTS],
  "Matthew Roberts": [...CORE_WAREHOUSE_SHIFTS],
  "Michael DeWeerd": [...CORE_WAREHOUSE_SHIFTS],
  "Kaden Mellema": [...CORE_WAREHOUSE_SHIFTS],
  "Ian Klinski": [...CORE_WAREHOUSE_SHIFTS],
  "Dan Mathiowetz": ["Crafts", ...CORE_WAREHOUSE_SHIFTS],
  "Kasey Iverson": ["Ice Cream", ...CORE_WAREHOUSE_SHIFTS],
  "Jon Baker": ["Floors", "Will Text", ...CORE_WAREHOUSE_SHIFTS],
};

const SF_DAY_NAMES = ["MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;

/**
 * Returns the Monday "YYYY-MM-DD" of the active SF Mon–Sat workweek.
 * Since SF Team Schedule includes Saturday, Mon–Sat stay on the current week
 * and Sunday advances to the upcoming Monday when `autoAdvanceOnSunday` is true.
 */
export function getSfWorkweekMondayIso(now = new Date(), autoAdvanceOnSunday = true): string {
  const dt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
  const dow = dt.getDay(); // 0=Sun .. 6=Sat
  if (dow === 0) {
    dt.setDate(dt.getDate() + (autoAdvanceOnSunday ? 1 : -6));
  } else {
    dt.setDate(dt.getDate() - (dow - 1));
  }
  return formatIsoDate(dt.getFullYear(), dt.getMonth(), dt.getDate());
}

export function buildSfWeekDays(mondayIso: string): ScheduleDayHeader[] {
  const mon = parseIsoDate(mondayIso);
  return SF_DAY_NAMES.map((day, idx) => {
    const d = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + idx, 12, 0, 0);
    return {
      day,
      date: formatUsDate(d),
    };
  });
}

export function buildSfWeekLabel(mondayIso: string): string {
  const mon = parseIsoDate(mondayIso);
  const sat = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 5, 12, 0, 0);
  return `Sioux Falls (SF) Team Schedule — ${formatUsDate(mon)} to ${formatUsDate(sat)}`;
}

export function buildShortSfWeekRange(mondayIso: string): string {
  const mon = parseIsoDate(mondayIso);
  const sat = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 5, 12, 0, 0);
  return `${formatShortUsDate(mon)} – ${formatShortUsDate(sat)}`;
}

export function createBlankSfWeekBlock(
  mondayIso: string,
  roster: SfMemberRosterItem[] = DEFAULT_SF_ROSTER,
): SfWeekBlock {
  return {
    weekStartISO: mondayIso,
    label: buildSfWeekLabel(mondayIso),
    days: buildSfWeekDays(mondayIso),
    rows: roster.map((r) => ({
      name: r.name,
      color: r.color,
      days: ["", "", "", "", "", "OFF"],
    })),
    footerNote: "Nick Kreger",
  };
}

export function normalizeSfWeekBlock(
  block: Partial<SfWeekBlock> | undefined,
  fallbackMondayIso: string,
  roster: SfMemberRosterItem[],
): SfWeekBlock {
  const inferredIso =
    (block?.weekStartISO && /^\d{4}-\d{2}-\d{2}$/.test(block.weekStartISO)
      ? block.weekStartISO
      : null) ||
    parseSlashDateToMondayIso(block?.days?.[0]?.date) ||
    fallbackMondayIso;

  const canonicalDays = buildSfWeekDays(inferredIso).map((d, dIdx) => {
    const incomingDay = block?.days?.[dIdx];
    return {
      ...d,
      ...(incomingDay?.isHoliday ? { isHoliday: true } : {}),
      ...(incomingDay?.holidayLabel ? { holidayLabel: String(incomingDay.holidayLabel) } : {}),
    };
  });
  const rows: SfScheduleRow[] =
    Array.isArray(block?.rows) && block!.rows.length > 0
      ? block!.rows.map((r, i) => ({
          name: r.name ?? roster[i]?.name ?? `Member ${i + 1}`,
          color: r.color || roster[i]?.color || "#93c5fd",
          days: Array.from({ length: 6 }, (_, dIdx) => String(r.days?.[dIdx] ?? (dIdx === 5 ? "OFF" : ""))),
        }))
      : roster.map((r) => ({
          name: r.name,
          color: r.color,
          days: ["", "", "", "", "", "OFF"],
        }));

  return {
    weekStartISO: inferredIso,
    label: buildSfWeekLabel(inferredIso),
    days: canonicalDays,
    rows,
    footerNote: typeof block?.footerNote === "string" ? block.footerNote : "Nick Kreger",
  };
}

/**
 * Parses a shift string like "7:15-4:15", "9:00-6:00", "7:00am - 3:30pm" into
 * minutes from midnight `{ startMin, endMin }`, or `null` if not a time range.
 */
export function parseShiftTimeRange(rawCell: string | undefined): {
  startMin: number;
  endMin: number;
} | null {
  if (!rawCell) return null;
  const trimmed = rawCell.trim();
  if (!trimmed) return null;

  const match = trimmed.match(
    /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*[-–—to]+\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i,
  );
  if (!match) return null;

  let startH = parseInt(match[1], 10);
  const startM = match[2] ? parseInt(match[2], 10) : 0;
  const startMeridiem = match[3]?.toLowerCase();

  let endH = parseInt(match[4], 10);
  const endM = match[5] ? parseInt(match[5], 10) : 0;
  const endMeridiem = match[6]?.toLowerCase();

  if (
    startH < 0 ||
    startH > 23 ||
    endH < 0 ||
    endH > 23 ||
    startM < 0 ||
    startM > 59 ||
    endM < 0 ||
    endM > 59
  ) {
    return null;
  }

  if (startMeridiem === "pm" && startH < 12) startH += 12;
  else if (startMeridiem === "am" && startH === 12) startH = 0;
  else if (!startMeridiem) {
    // Daytime shift convention: 5..11 -> AM, 12 -> 12 PM, 1..4 -> PM
    if (startH >= 1 && startH <= 4) startH += 12;
  }

  if (endMeridiem === "pm" && endH < 12) endH += 12;
  else if (endMeridiem === "am" && endH === 12) endH = 0;
  else if (!endMeridiem) {
    if (endH < startH || (endH >= 1 && endH <= 8 && startH >= 5 && startH <= 12)) {
      if (endH < 12) endH += 12;
    }
  }

  return {
    startMin: startH * 60 + startM,
    endMin: endH * 60 + endM,
  };
}

/** Opening shift: starts at or before 7:15 AM (435 mins) */
export function isOpeningShift(cell: string | undefined): boolean {
  const parsed = parseShiftTimeRange(cell);
  if (!parsed) return false;
  return parsed.startMin <= 7 * 60 + 15;
}

/** Closing shift: ends at or after 6:00 PM (1080 mins) */
export function isClosingShift(cell: string | undefined): boolean {
  const parsed = parseShiftTimeRange(cell);
  if (!parsed) return false;
  return parsed.endMin >= 18 * 60;
}

const NON_WORKING_TOKENS = new Set(["OFF", "PTO", "VACATION", "SICK", "HOLIDAY", "CLOSED", "—", "-"]);

export function isScheduledWorkingCell(cell: string | undefined): boolean {
  const clean = (cell || "").trim();
  if (!clean) return false;
  const upper = clean.toUpperCase();
  if (
    NON_WORKING_TOKENS.has(upper) ||
    upper.startsWith("PTO") ||
    upper.startsWith("OFF") ||
    upper.startsWith("HOLIDAY") ||
    upper.startsWith("CLOSED")
  ) {
    return false;
  }
  return true;
}

export interface SfDayCoverageStatus {
  dayIndex: number;
  dayName: string;
  date: string;
  openers: string[];
  closers: string[];
  workingCount: number;
  isSaturday: boolean;
  isHoliday: boolean;
  /** True when Mon–Fri (and not a Holiday), or on Saturday if at least 1 person is scheduled to work */
  isChecked: boolean;
  missingOpeners: boolean;
  missingClosers: boolean;
  hasWarning: boolean;
}

export const MIN_REQUIRED_OPENERS = 2;
export const MIN_REQUIRED_CLOSERS = 2;

/**
 * Evaluates Opening (<= 7:15 AM) and Closing (>= 6:00 PM) coverage across Mon–Sat.
 * Checks Mon–Fri (unless marked as a closed Holiday), and checks Saturday only if at least one person is scheduled to work Saturday.
 */
export function evaluateSfWeekCoverage(week: SfWeekBlock | undefined): {
  days: SfDayCoverageStatus[];
  warnings: SfDayCoverageStatus[];
  allCovered: boolean;
} {
  if (!week || !Array.isArray(week.days)) {
    return { days: [], warnings: [], allCovered: true };
  }

  const days: SfDayCoverageStatus[] = week.days.map((d, dIdx) => {
    const openers: string[] = [];
    const closers: string[] = [];
    let workingCount = 0;

    for (const row of week.rows || []) {
      const cell = row.days?.[dIdx] ?? "";
      if (isScheduledWorkingCell(cell)) {
        workingCount++;
      }
      if (isOpeningShift(cell)) {
        openers.push(row.name);
      }
      if (isClosingShift(cell)) {
        closers.push(row.name);
      }
    }

    const isSaturday = dIdx === 5 || (d.day || "").toUpperCase().startsWith("SAT");
    const isHoliday = isDayColumnHoliday(week, dIdx);
    const isChecked = isHoliday ? false : isSaturday ? workingCount > 0 : true;
    const missingOpeners = isChecked && openers.length < MIN_REQUIRED_OPENERS;
    const missingClosers = isChecked && closers.length < MIN_REQUIRED_CLOSERS;

    return {
      dayIndex: dIdx,
      dayName: d.day,
      date: d.date,
      openers,
      closers,
      workingCount,
      isSaturday,
      isHoliday,
      isChecked,
      missingOpeners,
      missingClosers,
      hasWarning: missingOpeners || missingClosers,
    };
  });

  const warnings = days.filter((d) => d.hasWarning);
  return {
    days,
    warnings,
    allCovered: warnings.length === 0,
  };
}

/**
 * Migrates legacy single-week `{ label, days, rows }` or normalizes an existing
 * multi-week `SfScheduleState`.
 */
export function normalizeSfScheduleState(
  raw: any,
  now = new Date(),
): SfScheduleState {
  const activeMondayIso = getSfWorkweekMondayIso(now, true);

  let roster: SfMemberRosterItem[] =
    Array.isArray(raw?.memberRoster) && raw.memberRoster.length > 0
      ? raw.memberRoster.map((r: any) => ({
          name: String(r.name || "Team Member"),
          color: String(r.color || "#93c5fd"),
        }))
      : [];

  if (roster.length === 0) {
    const seedRows: any[] =
      raw?.currentWeek?.rows ||
      raw?.rows ||
      (raw?.weeks ? (Object.values(raw.weeks)[0] as any)?.rows : null) ||
      [];
    if (Array.isArray(seedRows) && seedRows.length > 0) {
      roster = seedRows.map((r: any) => ({
        name: String(r.name || "Team Member"),
        color: String(r.color || "#93c5fd"),
      }));
    } else {
      roster = structuredClone(DEFAULT_SF_ROSTER);
    }
  }

  const weeks: Record<string, SfWeekBlock> = {};

  if (raw?.weeks && typeof raw.weeks === "object") {
    for (const [key, block] of Object.entries(raw.weeks)) {
      if (!block || typeof block !== "object") continue;
      const iso = /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : activeMondayIso;
      weeks[iso] = normalizeSfWeekBlock(block as Partial<SfWeekBlock>, iso, roster);
    }
  }

  // Migrate legacy single-week `{ label, days, rows }` if not yet inside `weeks`
  if (Array.isArray(raw?.rows) && raw.rows.length > 0) {
    const legacyIso = parseSlashDateToMondayIso(raw?.days?.[0]?.date) || activeMondayIso;
    if (!weeks[legacyIso]) {
      weeks[legacyIso] = normalizeSfWeekBlock(
        { label: raw.label, days: raw.days, rows: raw.rows },
        legacyIso,
        roster,
      );
    }
  }

  if (Object.keys(weeks).length === 0) {
    weeks[activeMondayIso] = createBlankSfWeekBlock(activeMondayIso, roster);
  }

  // Merge shift presets with any custom non-empty values found in stored cells
  const baseShifts =
    Array.isArray(raw?.shiftOptions) && raw.shiftOptions.length > 0
      ? raw.shiftOptions.map((s: any) => String(s).trim()).filter(Boolean)
      : [...DEFAULT_SF_SHIFT_OPTIONS];

  const optionMap = new Map<string, string>();
  for (const s of DEFAULT_SF_SHIFT_OPTIONS) {
    optionMap.set(s.toLowerCase(), s);
  }
  for (const s of baseShifts) {
    if (!optionMap.has(s.toLowerCase())) {
      optionMap.set(s.toLowerCase(), s);
    }
  }
  for (const wk of Object.values(weeks)) {
    for (const row of wk.rows) {
      for (const cell of row.days) {
        const trimmed = (cell || "").trim();
        if (trimmed && !optionMap.has(trimmed.toLowerCase())) {
          optionMap.set(trimmed.toLowerCase(), trimmed);
        }
      }
    }
  }

  const priorityOrder = [
    "7:15-4:15",
    "8:00-5:00",
    "8:30-5:30",
    "9:00-6:00",
    "Bomgaars",
    "OFF",
    "PTO",
  ];
  const allShifts = Array.from(optionMap.values());
  const topShifts = priorityOrder.filter((p) =>
    allShifts.some((x) => x.toLowerCase() === p.toLowerCase()),
  );
  const restShifts = allShifts
    .filter((x) => !priorityOrder.some((p) => p.toLowerCase() === x.toLowerCase()))
    .sort((a, b) => a.localeCompare(b));
  const shiftOptions = [...topShifts, ...restShifts];

  // Normalize per-member shift assignments
  const canonicalByLower = new Map<string, string>();
  for (const opt of shiftOptions) {
    canonicalByLower.set(opt.toLowerCase(), opt);
  }

  const memberShifts: Record<string, string[]> = {};
  if (raw?.memberShifts && typeof raw.memberShifts === "object") {
    for (const [member, list] of Object.entries(raw.memberShifts)) {
      if (!Array.isArray(list)) continue;
      const seen = new Set<string>();
      const cleaned: string[] = [];
      for (const item of list) {
        const trimmed = String(item || "").trim();
        if (!trimmed) continue;
        const upper = trimmed.toUpperCase();
        if (upper === "OFF" || upper === "PTO") continue; // Always included automatically
        const canon = canonicalByLower.get(trimmed.toLowerCase()) || trimmed;
        if (!seen.has(canon.toLowerCase())) {
          seen.add(canon.toLowerCase());
          cleaned.push(canon);
        }
      }
      memberShifts[member] = cleaned;
    }
  } else {
    for (const [member, defaults] of Object.entries(DEFAULT_SF_MEMBER_SHIFTS)) {
      memberShifts[member] = defaults.map(
        (s) => canonicalByLower.get(s.toLowerCase()) || s,
      );
    }
    for (const wk of Object.values(weeks)) {
      for (const row of wk.rows) {
        const name = (row.name || "").trim();
        if (!name) continue;
        const currentSet = new Set((memberShifts[name] || []).map((x) => x.toLowerCase()));
        const list = [...(memberShifts[name] || [])];
        for (const cell of row.days) {
          const trimmed = (cell || "").trim();
          if (!trimmed) continue;
          const upper = trimmed.toUpperCase();
          if (upper === "OFF" || upper === "PTO") continue;
          const canon = canonicalByLower.get(trimmed.toLowerCase()) || trimmed;
          if (!currentSet.has(canon.toLowerCase())) {
            currentSet.add(canon.toLowerCase());
            list.push(canon);
          }
        }
        if (list.length === 0) {
          list.push(...CORE_WAREHOUSE_SHIFTS);
        }
        memberShifts[name] = list;
      }
    }
  }

  const activeBlock = weeks[activeMondayIso] || createBlankSfWeekBlock(activeMondayIso, roster);

  return {
    weeks,
    shiftOptions,
    memberShifts,
    memberRoster: roster,
    currentWeek: activeBlock,
    label: activeBlock.label,
    days: activeBlock.days,
    rows: activeBlock.rows,
  };
}

export function getShiftsForMember(
  schedule: SfScheduleState | undefined,
  memberName: string,
): {
  options: string[];
  isMemberScoped: boolean;
  assignedCount: number;
} {
  const allOptions = schedule?.shiftOptions?.length
    ? schedule.shiftOptions
    : DEFAULT_SF_SHIFT_OPTIONS;
  const assigned = schedule?.memberShifts?.[memberName];
  if (!assigned || assigned.length === 0) {
    return {
      options: allOptions,
      isMemberScoped: false,
      assignedCount: 0,
    };
  }
  const priorityOrder = ["7:15-4:15", "8:00-5:00", "8:30-5:30", "9:00-6:00", "Bomgaars"];
  const uniqueAssigned = Array.from(new Set(assigned.filter(Boolean)));
  const orderedCore = priorityOrder.filter((p) => uniqueAssigned.includes(p));
  const extraAssigned = uniqueAssigned
    .filter((x) => !priorityOrder.includes(x) && x !== "OFF" && x !== "PTO" && x !== "HOLIDAY")
    .sort((a, b) => a.localeCompare(b));
  return {
    options: [...orderedCore, ...extraAssigned, "OFF", "PTO", "HOLIDAY"],
    isMemberScoped: true,
    assignedCount: orderedCore.length + extraAssigned.length,
  };
}

export function getActiveTvSfWeek(
  schedule: any,
  now = new Date(),
): SfWeekBlock {
  const normalized = normalizeSfScheduleState(schedule, now);
  const activeIso = getSfWorkweekMondayIso(now, true);
  if (normalized.weeks[activeIso]) {
    return normalized.weeks[activeIso];
  }
  return createBlankSfWeekBlock(activeIso, normalized.memberRoster);
}

export function countSfAssignedCells(block: SfWeekBlock | undefined): number {
  if (!block?.rows) return 0;
  let count = 0;
  for (const r of block.rows) {
    for (let i = 0; i < 6; i++) {
      const val = (r.days?.[i] || "").trim();
      // Don't count default Saturday "OFF" on an otherwise blank week
      if (val && !(i === 5 && val.toUpperCase() === "OFF")) {
        count++;
      }
    }
  }
  return count;
}

export interface SfDailyMemberEntry {
  name: string;
  color: string;
  shift: string;
  isWorking: boolean;
  isOpener: boolean;
  isCloser: boolean;
  startMin: number | null;
  endMin: number | null;
}

export interface SfDailyShiftResolution {
  isNextDayRollover: boolean;
  isTomorrow: boolean;
  dayName: string;
  fullDayName: string;
  dateStr: string;
  shortDateStr: string;
  rolloverTime24: string;
  rolloverLabel: string;
  statusBadge: string;
  openers: SfDailyMemberEntry[];
  closers: SfDailyMemberEntry[];
  midAndRoleCrew: SfDailyMemberEntry[];
  allWorking: SfDailyMemberEntry[];
  offCrew: SfDailyMemberEntry[];
  footerNote?: string;
}

function parseRolloverTime(rawTime?: string): {
  hhmm: string;
  totalMinutes: number;
  label12h: string;
} {
  const m = String(rawTime || "14:00")
    .trim()
    .match(/^(\d{1,2}):(\d{2})$/);
  const h = m ? Math.max(0, Math.min(23, parseInt(m[1], 10))) : 14;
  const min = m ? Math.max(0, Math.min(59, parseInt(m[2], 10))) : 0;
  const hhmm = `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const label12h = `${h12}:${String(min).padStart(2, "0")} ${period}`;
  return { hhmm, totalMinutes: h * 60 + min, label12h };
}

/**
 * Resolves the Sioux Falls daily crew view:
 * - Before `rolloverTime` (default "14:00" / 2:00 PM) on a scheduled workday: shows TODAY's crew.
 * - At/after `rolloverTime` (or on Sunday / unscheduled Saturday): automatically switches to the
 *   NEXT scheduled workday (crossing week boundaries cleanly on Friday afternoon -> Monday),
 *   highlighting Openers (<= 7:15 AM) and Closers (>= 6:00 PM).
 */
export function resolveSfDailyShiftView(
  rawSchedule: any,
  now = new Date(),
  opts?: {
    rolloverTime?: string;
    dayMode?: "auto" | "today" | "next_workday";
  },
): SfDailyShiftResolution {
  const normalized = normalizeSfScheduleState(rawSchedule, now);
  const { hhmm, totalMinutes: rolloverMins, label12h } = parseRolloverTime(opts?.rolloverTime);
  const dayMode = opts?.dayMode || "auto";

  const getWeekAndColForDate = (dt: Date): { week: SfWeekBlock; dayIdx: number } => {
    const dow = dt.getDay(); // 1..6 (Mon..Sat)
    const mon = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() - (dow - 1), 12, 0, 0);
    const monIso = formatIsoDate(mon.getFullYear(), mon.getMonth(), mon.getDate());
    const week =
      normalized.weeks[monIso] || createBlankSfWeekBlock(monIso, normalized.memberRoster);
    return { week, dayIdx: Math.max(0, Math.min(5, dow - 1)) };
  };

  const countWorkingOnDate = (dt: Date): number => {
    if (dt.getDay() === 0) return 0;
    const { week, dayIdx } = getWeekAndColForDate(dt);
    let cnt = 0;
    for (const r of week.rows || []) {
      if (isScheduledWorkingCell(r.days?.[dayIdx])) cnt++;
    }
    return cnt;
  };

  const findNextWorkdayAfter = (baseDate: Date): Date => {
    for (let offset = 1; offset <= 7; offset++) {
      const cand = new Date(
        baseDate.getFullYear(),
        baseDate.getMonth(),
        baseDate.getDate() + offset,
        12,
        0,
        0,
      );
      const cDow = cand.getDay();
      if (cDow === 0) continue; // Skip Sunday
      if (cDow === 6) {
        if (countWorkingOnDate(cand) > 0) return cand;
        continue; // Skip Saturday when nobody is scheduled to work Saturday
      }
      return cand; // Mon..Fri
    }
    return new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + 1, 12, 0, 0);
  };

  const todayNoon = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
  const todayDow = todayNoon.getDay();
  const nowMins = now.getHours() * 60 + now.getMinutes();

  let targetDate = todayNoon;
  let isNextDayRollover = false;

  if (dayMode === "next_workday") {
    targetDate = findNextWorkdayAfter(todayNoon);
    isNextDayRollover = true;
  } else if (dayMode === "today") {
    if (todayDow === 0 || (todayDow === 6 && countWorkingOnDate(todayNoon) === 0)) {
      targetDate = findNextWorkdayAfter(todayNoon);
      isNextDayRollover = true;
    } else {
      targetDate = todayNoon;
      isNextDayRollover = false;
    }
  } else {
    // "auto": Today until rolloverTime (default 2:00 PM), then switch to next workday
    if (todayDow === 0) {
      targetDate = findNextWorkdayAfter(todayNoon);
      isNextDayRollover = true;
    } else if (todayDow === 6) {
      if (countWorkingOnDate(todayNoon) > 0 && nowMins < rolloverMins) {
        targetDate = todayNoon;
        isNextDayRollover = false;
      } else {
        targetDate = findNextWorkdayAfter(todayNoon);
        isNextDayRollover = true;
      }
    } else {
      if (nowMins >= rolloverMins) {
        targetDate = findNextWorkdayAfter(todayNoon);
        isNextDayRollover = true;
      } else {
        targetDate = todayNoon;
        isNextDayRollover = false;
      }
    }
  }

  const diffDays = Math.round((targetDate.getTime() - todayNoon.getTime()) / 86400000);
  const isTomorrow = diffDays === 1;
  const fullDayNames = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  const fullDayName = fullDayNames[targetDate.getDay()];

  const { week, dayIdx } = getWeekAndColForDate(targetDate);
  const dayHeader = week.days?.[dayIdx];
  const dayName = dayHeader?.day || SF_DAY_NAMES[dayIdx] || fullDayName.slice(0, 3).toUpperCase();
  const dateStr = dayHeader?.date || formatUsDate(targetDate);
  const shortDateStr = dateStr.replace(/\/\d{4}$/, "");

  const statusBadge = !isNextDayRollover
    ? `TODAY • ${dayName} ${shortDateStr}`
    : isTomorrow
      ? `TOMORROW • ${dayName} ${shortDateStr}`
      : `NEXT SHIFT • ${dayName} ${shortDateStr}`;

  const rawEntries: SfDailyMemberEntry[] = (week.rows || []).map((row) => {
    const shift = (row.days?.[dayIdx] || "").trim();
    const isWorking = isScheduledWorkingCell(shift);
    const parsed = parseShiftTimeRange(shift);
    const isOpener = isWorking && isOpeningShift(shift);
    const isCloser = isWorking && isClosingShift(shift);
    return {
      name: row.name,
      color: row.color || "#93c5fd",
      shift: shift || "OFF",
      isWorking,
      isOpener,
      isCloser,
      startMin: parsed ? parsed.startMin : null,
      endMin: parsed ? parsed.endMin : null,
    };
  });

  const sortByShiftOrder = (a: SfDailyMemberEntry, b: SfDailyMemberEntry): number => {
    const rank = (x: SfDailyMemberEntry) => {
      if (x.isOpener) return 0;
      if (x.isCloser) return 2;
      if (x.startMin !== null) return 1;
      return 3; // Specialty/role shifts like Bomgaars, Crafts, Ice Cream, Floors
    };
    const rDiff = rank(a) - rank(b);
    if (rDiff !== 0) return rDiff;
    if (a.startMin !== null && b.startMin !== null && a.startMin !== b.startMin) {
      return a.startMin - b.startMin;
    }
    if (a.endMin !== null && b.endMin !== null && a.endMin !== b.endMin) {
      return a.endMin - b.endMin;
    }
    return 0;
  };

  const allWorking = rawEntries.filter((e) => e.isWorking).sort(sortByShiftOrder);
  const openers = allWorking.filter((e) => e.isOpener);
  const closers = allWorking.filter((e) => e.isCloser);
  const midAndRoleCrew = allWorking.filter((e) => !e.isOpener && !e.isCloser);
  const offCrew = rawEntries.filter((e) => !e.isWorking);

  return {
    isNextDayRollover,
    isTomorrow,
    dayName,
    fullDayName,
    dateStr,
    shortDateStr,
    rolloverTime24: hhmm,
    rolloverLabel: label12h,
    statusBadge,
    openers,
    closers,
    midAndRoleCrew,
    allWorking,
    offCrew,
    footerNote: week.footerNote,
  };
}
