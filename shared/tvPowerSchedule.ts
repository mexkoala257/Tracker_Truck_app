export interface TvPowerScheduleConfig {
  enabled: boolean;
  /** 24-hour "HH:MM" local wake time (e.g., "06:30") */
  onTime: string;
  /** 24-hour "HH:MM" local sleep/standby time (e.g., "18:00") */
  offTime: string;
  /** Active days of week: 0 = Sunday .. 6 = Saturday */
  activeDays: number[];
  /** IANA timezone identifier (e.g., "America/Chicago") */
  timezone: string;
}

export type UnitPowerScheduleMode = "company" | "custom" | "always_on";

export interface UnitPowerOverride {
  state: "awake" | "sleep";
  /** ISO timestamp when this temporary manual override expires (next scheduled boundary) */
  untilIso: string;
  setAtIso?: string;
}

export interface UnitPowerConfigLike {
  powerScheduleMode?: UnitPowerScheduleMode;
  powerSchedule?: Partial<TvPowerScheduleConfig> | null;
  powerOverride?: UnitPowerOverride | null;
}

export interface TvPowerEvaluation {
  mode: UnitPowerScheduleMode;
  scheduleActive: boolean;
  effectiveSchedule: TvPowerScheduleConfig;
  scheduledShouldBeOn: boolean;
  shouldBeOn: boolean;
  isScheduledSleep: boolean;
  hasManualOverride: boolean;
  overrideState: "awake" | "sleep" | null;
  overrideUntilIso: string | null;
  nextTransitionIso: string | null;
  nextTransitionLabel: string | null;
  statusSummary: string;
}

export const DEFAULT_TV_POWER_SCHEDULE: TvPowerScheduleConfig = {
  enabled: false,
  onTime: "06:30",
  offTime: "18:00",
  activeDays: [1, 2, 3, 4, 5], // Mon–Fri
  timezone: "America/Chicago",
};

export const TV_POWER_TIMEZONES: Array<{ id: string; label: string }> = [
  { id: "America/Chicago", label: "Central Time (Sioux Falls / CT)" },
  { id: "America/Denver", label: "Mountain Time (Rapid City / MT)" },
  { id: "America/New_York", label: "Eastern Time (ET)" },
  { id: "America/Los_Angeles", label: "Pacific Time (PT)" },
  { id: "UTC", label: "UTC" },
];

export const TV_POWER_WEEKDAYS: Array<{ day: number; short: string; label: string }> = [
  { day: 1, short: "Mon", label: "Monday" },
  { day: 2, short: "Tue", label: "Tuesday" },
  { day: 3, short: "Wed", label: "Wednesday" },
  { day: 4, short: "Thu", label: "Thursday" },
  { day: 5, short: "Fri", label: "Friday" },
  { day: 6, short: "Sat", label: "Saturday" },
  { day: 0, short: "Sun", label: "Sunday" },
];

const SHORT_WEEKDAY_TO_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const INDEX_TO_SHORT_WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function isValidTimeHhMm(val: unknown): val is string {
  if (typeof val !== "string") return false;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(val.trim());
  return Boolean(m);
}

export function parseTimeMinutes(hhmm: string, fallbackMinutes: number): number {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec((hhmm || "").trim());
  if (!m) return fallbackMinutes;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function formatTime12h(hhmm: string): string {
  const mins = parseTimeMinutes(hhmm, 390);
  const h24 = Math.floor(mins / 60);
  const m = mins % 60;
  const period = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

export function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz.trim()) return false;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: tz.trim() });
    return true;
  } catch {
    return false;
  }
}

export function normalizeTvPowerSchedule(
  raw?: Partial<TvPowerScheduleConfig> | null,
  fallback: TvPowerScheduleConfig = DEFAULT_TV_POWER_SCHEDULE,
): TvPowerScheduleConfig {
  const enabled = typeof raw?.enabled === "boolean" ? raw.enabled : fallback.enabled;
  const onTime = isValidTimeHhMm(raw?.onTime) ? raw!.onTime.trim() : fallback.onTime;
  const offTime = isValidTimeHhMm(raw?.offTime) ? raw!.offTime.trim() : fallback.offTime;
  const timezone = isValidTimezone(raw?.timezone) ? raw!.timezone.trim() : fallback.timezone;

  let activeDays: number[];
  if (Array.isArray(raw?.activeDays)) {
    const uniq = Array.from(
      new Set(
        raw!.activeDays
          .map((d) => Number(d))
          .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6),
      ),
    ).sort((a, b) => a - b);
    activeDays = uniq;
  } else {
    activeDays = [...fallback.activeDays];
  }

  return {
    enabled,
    onTime,
    offTime,
    activeDays,
    timezone,
  };
}

export function normalizeUnitPowerOverride(raw: unknown): UnitPowerOverride | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.state !== "awake" && r.state !== "sleep") return null;
  if (typeof r.untilIso !== "string" || Number.isNaN(new Date(r.untilIso).getTime())) {
    return null;
  }
  return {
    state: r.state,
    untilIso: r.untilIso,
    ...(typeof r.setAtIso === "string" ? { setAtIso: r.setAtIso } : {}),
  };
}

interface ZonedParts {
  weekday: number; // 0..6
  hour: number;
  minute: number;
  minutesOfDay: number;
  dateKey: string; // YYYY-MM-DD in tz
}

function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = fmt.formatToParts(date);
  let wk = "Mon";
  let year = "2026";
  let month = "01";
  let day = "01";
  let hour = 0;
  let minute = 0;
  for (const p of parts) {
    if (p.type === "weekday") wk = p.value;
    else if (p.type === "year") year = p.value;
    else if (p.type === "month") month = p.value;
    else if (p.type === "day") day = p.value;
    else if (p.type === "hour") hour = Number(p.value) % 24;
    else if (p.type === "minute") minute = Number(p.value);
  }
  const weekday = SHORT_WEEKDAY_TO_INDEX[wk] ?? 1;
  return {
    weekday,
    hour,
    minute,
    minutesOfDay: hour * 60 + minute,
    dateKey: `${year}-${month}-${day}`,
  };
}

function isScheduledOnAt(schedule: TvPowerScheduleConfig, parts: ZonedParts): boolean {
  const activeSet = new Set(schedule.activeDays);
  if (activeSet.size === 0) return false;

  const onMins = parseTimeMinutes(schedule.onTime, 390);
  const offMins = parseTimeMinutes(schedule.offTime, 1080);

  if (onMins === offMins) {
    // Full 24h on active days
    return activeSet.has(parts.weekday);
  }

  if (onMins < offMins) {
    // Standard daytime window (e.g. 06:30 -> 18:00)
    return (
      activeSet.has(parts.weekday) &&
      parts.minutesOfDay >= onMins &&
      parts.minutesOfDay < offMins
    );
  }

  // Overnight window (e.g. 18:00 -> 06:30 next morning)
  if (parts.minutesOfDay >= onMins) {
    return activeSet.has(parts.weekday);
  }
  if (parts.minutesOfDay < offMins) {
    const prevWeekday = (parts.weekday + 6) % 7;
    return activeSet.has(prevWeekday);
  }
  return false;
}

/**
 * Finds the next scheduled state change within the next 8 days (exact to the minute).
 */
function findNextScheduledTransition(
  schedule: TvPowerScheduleConfig,
  now: Date,
  currentScheduledOn: boolean,
): { iso: string; label: string } | null {
  if (schedule.activeDays.length === 0) return null;

  // Round up to the start of the next whole minute
  const startMs = Math.ceil((now.getTime() + 1000) / 60000) * 60000;
  const nowParts = getZonedParts(now, schedule.timezone);

  // Coarse scan every 15 minutes up to 8 days, then binary/minute refine
  const maxMinutes = 8 * 24 * 60;
  let prevMs = startMs;
  for (let offsetMin = 0; offsetMin <= maxMinutes; offsetMin += 15) {
    const probeMs = startMs + offsetMin * 60000;
    const probeState = isScheduledOnAt(schedule, getZonedParts(new Date(probeMs), schedule.timezone));
    if (probeState !== currentScheduledOn) {
      // Refine minute-by-minute between prevMs and probeMs
      for (let exactMs = prevMs; exactMs <= probeMs; exactMs += 60000) {
        const exactDate = new Date(exactMs);
        const exactParts = getZonedParts(exactDate, schedule.timezone);
        if (isScheduledOnAt(schedule, exactParts) !== currentScheduledOn) {
          const hhmm = `${String(exactParts.hour).padStart(2, "0")}:${String(exactParts.minute).padStart(2, "0")}`;
          const formattedTime = formatTime12h(hhmm);
          const sameDay = exactParts.dateKey === nowParts.dateKey;
          const label = sameDay
            ? formattedTime
            : `${INDEX_TO_SHORT_WEEKDAY[exactParts.weekday]} ${formattedTime}`;
          return {
            iso: exactDate.toISOString(),
            label,
          };
        }
      }
    }
    prevMs = probeMs;
  }

  return null;
}

/**
 * Evaluates whether a TV display should currently be ON or in Scheduled Standby,
 * factoring in company schedule, per-TV custom/24-7 mode, and temporary manual overrides.
 */
export function evaluateTvPowerSchedule(
  companyRaw?: Partial<TvPowerScheduleConfig> | null,
  unitConfig?: UnitPowerConfigLike | null,
  now: Date = new Date(),
): TvPowerEvaluation {
  const companySchedule = normalizeTvPowerSchedule(companyRaw, DEFAULT_TV_POWER_SCHEDULE);
  const mode: UnitPowerScheduleMode =
    unitConfig?.powerScheduleMode === "custom" || unitConfig?.powerScheduleMode === "always_on"
      ? unitConfig.powerScheduleMode
      : "company";

  const effectiveSchedule =
    mode === "custom"
      ? normalizeTvPowerSchedule(
          { ...(unitConfig?.powerSchedule || {}), enabled: true },
          { ...companySchedule, enabled: true },
        )
      : companySchedule;

  const scheduleActive =
    mode === "always_on" ? false : mode === "custom" ? true : companySchedule.enabled;

  const override = normalizeUnitPowerOverride(unitConfig?.powerOverride);
  const hasManualOverride =
    override !== null && new Date(override.untilIso).getTime() > now.getTime();

  if (!scheduleActive) {
    if (hasManualOverride && override) {
      const shouldBeOn = override.state === "awake";
      return {
        mode,
        scheduleActive: false,
        effectiveSchedule,
        scheduledShouldBeOn: true,
        shouldBeOn,
        isScheduledSleep: !shouldBeOn,
        hasManualOverride: true,
        overrideState: override.state,
        overrideUntilIso: override.untilIso,
        nextTransitionIso: override.untilIso,
        nextTransitionLabel: null,
        statusSummary: shouldBeOn ? "Manual Wake Override" : "Manual Standby",
      };
    }

    return {
      mode,
      scheduleActive: false,
      effectiveSchedule,
      scheduledShouldBeOn: true,
      shouldBeOn: true,
      isScheduledSleep: false,
      hasManualOverride: false,
      overrideState: null,
      overrideUntilIso: null,
      nextTransitionIso: null,
      nextTransitionLabel: null,
      statusSummary: mode === "always_on" ? "Always On (24/7)" : "Schedule Off (24/7)",
    };
  }

  const nowParts = getZonedParts(now, effectiveSchedule.timezone);
  const scheduledShouldBeOn = isScheduledOnAt(effectiveSchedule, nowParts);
  const nextTransition = findNextScheduledTransition(
    effectiveSchedule,
    now,
    scheduledShouldBeOn,
  );

  const shouldBeOn = hasManualOverride && override ? override.state === "awake" : scheduledShouldBeOn;
  const isScheduledSleep = !shouldBeOn;

  let statusSummary: string;
  if (hasManualOverride && override) {
    statusSummary =
      override.state === "awake"
        ? `Manual Wake${nextTransition ? ` • Until ${nextTransition.label}` : ""}`
        : `Manual Sleep${nextTransition ? ` • Until ${nextTransition.label}` : ""}`;
  } else if (shouldBeOn) {
    statusSummary = nextTransition
      ? `Awake • Off ${nextTransition.label}`
      : `Awake (${formatTime12h(effectiveSchedule.onTime)}–${formatTime12h(effectiveSchedule.offTime)})`;
  } else {
    statusSummary = nextTransition
      ? `Scheduled Sleep • Wakes ${nextTransition.label}`
      : "Scheduled Sleep (No active days selected)";
  }

  return {
    mode,
    scheduleActive: true,
    effectiveSchedule,
    scheduledShouldBeOn,
    shouldBeOn,
    isScheduledSleep,
    hasManualOverride,
    overrideState: hasManualOverride && override ? override.state : null,
    overrideUntilIso: hasManualOverride && override ? override.untilIso : null,
    nextTransitionIso: nextTransition?.iso || null,
    nextTransitionLabel: nextTransition?.label || null,
    statusSummary,
  };
}
