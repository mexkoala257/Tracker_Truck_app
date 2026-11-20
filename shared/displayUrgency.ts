export type UrgencyTier =
  | "overdue"
  | "today"
  | "imminent" // 1-3 days or explicit "urgent" priority
  | "this_week" // 4-7 days
  | "approaching" // 8-21 days
  | "scheduled" // >21 days or undated
  | "past";

export interface ParsedCountdownInfo {
  targetDateISO: string | null;
  inferredFromText: boolean;
  /** Final date in message when multiple dates exist (used so multi-date messages don't archive early) */
  archiveAfterDateISO: string | null;
  daysUntil: number | null;
  tier: UrgencyTier;
  badgeText: string;
  shortCountdown: string;
  formattedDate: string | null;
  isAutoArchived: boolean;
}

const MONTH_NAME_MAP: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

export function toStartOfLocalDay(dt: Date): Date {
  return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 0, 0, 0, 0);
}

export function dateToIsoLocal(dt: Date): string {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function parseFlexibleDateToLocal(raw: string | undefined | null, now = new Date()): Date | null {
  if (!raw || !raw.trim()) return null;
  const s = raw.trim();

  // 1. ISO "YYYY-MM-DD"
  const isoMatch = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    const dt = new Date(
      parseInt(isoMatch[1], 10),
      parseInt(isoMatch[2], 10) - 1,
      parseInt(isoMatch[3], 10),
    );
    return isNaN(dt.getTime()) ? null : dt;
  }

  // 2. Slash "M/D/YYYY" or "M/D/YY"
  const slashMatch = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (slashMatch) {
    const m = parseInt(slashMatch[1], 10) - 1;
    const d = parseInt(slashMatch[2], 10);
    let y = slashMatch[3] ? parseInt(slashMatch[3], 10) : now.getFullYear();
    if (y < 100) y += 2000;
    const dt = new Date(y, m, d);
    return isNaN(dt.getTime()) ? null : dt;
  }

  // 3. "Month YYYY" (e.g., "November 2026", "May 2027" for Truck DOT renewals -> 1st of month)
  const monthYearMatch = s.match(/^([a-zA-Z]+)\.?\s+(\d{4})$/);
  if (monthYearMatch) {
    const m = MONTH_NAME_MAP[monthYearMatch[1].toLowerCase()];
    const y = parseInt(monthYearMatch[2], 10);
    if (m !== undefined) {
      return new Date(y, m, 1);
    }
  }

  const fallback = new Date(s);
  if (!isNaN(fallback.getTime())) {
    return new Date(fallback.getFullYear(), fallback.getMonth(), fallback.getDate());
  }
  return null;
}

export function diffCalendarDays(target: Date, now = new Date()): number {
  const t0 = toStartOfLocalDay(target).getTime();
  const n0 = toStartOfLocalDay(now).getTime();
  return Math.round((t0 - n0) / 86_400_000);
}

export function formatShortHumanDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const dt = parseFlexibleDateToLocal(iso);
  if (!dt) return null;
  return dt.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * Extracts any natural-language dates mentioned inside an announcement message
 * (e.g. "Christmas Party Friday December 4th BOOK ROOMS BEFORE NOV. 25TH").
 */
export function extractDatesFromMessageText(text: string | undefined, refDate = new Date()): string[] {
  if (!text) return [];
  const found: Date[] = [];
  const refStart = toStartOfLocalDay(refDate);

  // Pattern A: Month Name + Day (+ optional Year), e.g. "December 4th", "NOV. 25TH", "Jan 15, 2027"
  const monthRegex =
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?\b/gi;
  let match: RegExpExecArray | null;
  while ((match = monthRegex.exec(text)) !== null) {
    const monthIdx = MONTH_NAME_MAP[match[1].toLowerCase().replace(/\.$/, "")];
    const day = parseInt(match[2], 10);
    if (monthIdx === undefined || day < 1 || day > 31) continue;

    let year = match[3] ? parseInt(match[3], 10) : refStart.getFullYear();
    let candidate = new Date(year, monthIdx, day);
    // If no explicit year was written and date is >90 days in the past, assume next calendar year (e.g. Jan date posted in Dec)
    if (!match[3] && diffCalendarDays(candidate, refStart) < -90) {
      candidate = new Date(year + 1, monthIdx, day);
    }
    if (!isNaN(candidate.getTime())) {
      found.push(candidate);
    }
  }

  // Pattern B: Numeric M/D/YY or M/D/YYYY inside text (avoiding phone numbers like 605-692-2882)
  const slashRegex = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g;
  while ((match = slashRegex.exec(text)) !== null) {
    const m = parseInt(match[1], 10) - 1;
    const d = parseInt(match[2], 10);
    if (m < 0 || m > 11 || d < 1 || d > 31) continue;
    let y = match[3] ? parseInt(match[3], 10) : refStart.getFullYear();
    if (y < 100) y += 2000;
    let candidate = new Date(y, m, d);
    if (!match[3] && diffCalendarDays(candidate, refStart) < -90) {
      candidate = new Date(y + 1, m, d);
    }
    if (!isNaN(candidate.getTime())) {
      found.push(candidate);
    }
  }

  const uniqueIsos = Array.from(new Set(found.map((d) => dateToIsoLocal(d)))).sort();
  return uniqueIsos;
}

export function computeDaysTier(
  daysUntil: number | null,
  priority?: "normal" | "important" | "urgent",
): {
  tier: UrgencyTier;
  badgeText: string;
  shortCountdown: string;
} {
  if (daysUntil !== null) {
    if (daysUntil < 0) {
      const ago = Math.abs(daysUntil);
      return {
        tier: "past",
        badgeText: ago === 1 ? "YESTERDAY" : `${ago}d AGO`,
        shortCountdown: `${ago}d ago`,
      };
    }
    if (daysUntil === 0) {
      return {
        tier: "today",
        badgeText: "TODAY!",
        shortCountdown: "TODAY",
      };
    }
    if (daysUntil === 1) {
      return {
        tier: "imminent",
        badgeText: "TOMORROW!",
        shortCountdown: "1d left",
      };
    }
    if (daysUntil <= 3) {
      return {
        tier: "imminent",
        badgeText: `IN ${daysUntil} DAYS!`,
        shortCountdown: `${daysUntil}d left`,
      };
    }
    if (daysUntil <= 7) {
      return {
        tier: "this_week",
        badgeText: `${daysUntil} DAYS LEFT`,
        shortCountdown: `${daysUntil}d left`,
      };
    }
    if (daysUntil <= 21) {
      return {
        tier: "approaching",
        badgeText: `IN ${daysUntil} DAYS`,
        shortCountdown: `${daysUntil}d`,
      };
    }
    return {
      tier: priority === "urgent" ? "imminent" : "scheduled",
      badgeText: `${daysUntil} DAYS AWAY`,
      shortCountdown: `${daysUntil}d`,
    };
  }

  if (priority === "urgent") {
    return {
      tier: "imminent",
      badgeText: "URGENT",
      shortCountdown: "URGENT",
    };
  }
  return {
    tier: "scheduled",
    badgeText: priority === "important" ? "IMPORTANT" : "BULLETIN",
    shortCountdown: "",
  };
}

/**
 * Evaluates an AnnouncementItem's countdown, urgency escalation tier, and auto-archive status.
 */
export function evaluateAnnouncementUrgency(
  msg: {
    message?: string;
    priority?: "normal" | "important" | "urgent";
    eventDateISO?: string;
    autoArchive?: boolean;
    createdAt?: string;
    active?: boolean;
  },
  now = new Date(),
): ParsedCountdownInfo {
  const explicitIso =
    msg.eventDateISO && /^\d{4}-\d{2}-\d{2}$/.test(msg.eventDateISO.trim())
      ? msg.eventDateISO.trim()
      : null;

  let targetIso: string | null = explicitIso;
  let archiveIso: string | null = explicitIso;
  let inferred = false;

  if (!explicitIso) {
    const refDate = msg.createdAt ? new Date(msg.createdAt) : now;
    const safeRef = isNaN(refDate.getTime()) ? now : refDate;
    const extracted = extractDatesFromMessageText(msg.message, safeRef);
    if (extracted.length > 0) {
      inferred = true;
      archiveIso = extracted[extracted.length - 1];
      // Pick the soonest date that hasn't passed yet (or the last date if all have passed)
      const upcoming = extracted.find((iso) => {
        const dt = parseFlexibleDateToLocal(iso, now);
        return dt ? diffCalendarDays(dt, now) >= 0 : false;
      });
      targetIso = upcoming || archiveIso;
    }
  }

  const targetDt = targetIso ? parseFlexibleDateToLocal(targetIso, now) : null;
  const archiveDt = archiveIso ? parseFlexibleDateToLocal(archiveIso, now) : null;
  const daysUntil = targetDt ? diffCalendarDays(targetDt, now) : null;
  const daysUntilArchive = archiveDt ? diffCalendarDays(archiveDt, now) : null;

  const shouldAutoArchive = msg.autoArchive !== false;
  const isAutoArchived =
    shouldAutoArchive && daysUntilArchive !== null && daysUntilArchive < 0;

  const { tier, badgeText, shortCountdown } = computeDaysTier(daysUntil, msg.priority);

  return {
    targetDateISO: targetIso,
    inferredFromText: inferred,
    archiveAfterDateISO: archiveIso,
    daysUntil,
    tier,
    badgeText,
    shortCountdown,
    formattedDate: formatShortHumanDate(targetIso),
    isAutoArchived,
  };
}

/**
 * Evaluates a CalendarEventItem's countdown and urgency escalation tier.
 */
export function evaluateCalendarEventUrgency(
  ev: { dateISO?: string; dayLabel?: string },
  now = new Date(),
): {
  daysUntil: number | null;
  tier: UrgencyTier;
  badgeText: string;
  isPast: boolean;
} {
  const dt = parseFlexibleDateToLocal(ev.dateISO, now);
  const daysUntil = dt ? diffCalendarDays(dt, now) : null;
  const { tier, badgeText } = computeDaysTier(daysUntil, "important");
  return {
    daysUntil,
    tier,
    badgeText,
    isPast: daysUntil !== null && daysUntil < 0,
  };
}

export interface EvaluatedRenewalCell {
  raw: string;
  daysUntil: number | null;
  status: "overdue" | "urgent" | "soon" | "ok" | "empty";
  countdownLabel: string;
}

export function evaluateRenewalDateCell(
  dateStr: string | undefined,
  now = new Date(),
): EvaluatedRenewalCell {
  const clean = (dateStr || "").trim();
  if (!clean) {
    return { raw: "", daysUntil: null, status: "empty", countdownLabel: "" };
  }
  const parsed = parseFlexibleDateToLocal(clean, now);
  if (!parsed) {
    return { raw: clean, daysUntil: null, status: "ok", countdownLabel: "" };
  }
  const days = diffCalendarDays(parsed, now);
  if (days < 0) {
    return {
      raw: clean,
      daysUntil: days,
      status: "overdue",
      countdownLabel: "PAST DUE",
    };
  }
  if (days === 0) {
    return {
      raw: clean,
      daysUntil: 0,
      status: "overdue",
      countdownLabel: "TODAY",
    };
  }
  if (days <= 30) {
    return {
      raw: clean,
      daysUntil: days,
      status: "urgent",
      countdownLabel: `${days}d`,
    };
  }
  if (days <= 90) {
    return {
      raw: clean,
      daysUntil: days,
      status: "soon",
      countdownLabel: `${days}d`,
    };
  }
  return {
    raw: clean,
    daysUntil: days,
    status: "ok",
    countdownLabel: "",
  };
}

export function evaluateAndSortRenewals<
  T extends { entity: string; licenseDue: string; medCardDue: string; truckDotDue: string },
>(
  rows: T[],
  now = new Date(),
): Array<{
  row: T;
  originalIndex: number;
  soonestDays: number;
  license: EvaluatedRenewalCell;
  medCard: EvaluatedRenewalCell;
  truckDot: EvaluatedRenewalCell;
  hasUrgent: boolean;
  hasSoon: boolean;
}> {
  const evaluated = rows.map((row, originalIndex) => {
    const license = evaluateRenewalDateCell(row.licenseDue, now);
    const medCard = evaluateRenewalDateCell(row.medCardDue, now);
    const truckDot = evaluateRenewalDateCell(row.truckDotDue, now);

    const candidates = [license.daysUntil, medCard.daysUntil, truckDot.daysUntil].filter(
      (d): d is number => d !== null,
    );
    const soonestDays = candidates.length > 0 ? Math.min(...candidates) : 99999;

    const statuses = [license.status, medCard.status, truckDot.status];
    const hasUrgent = statuses.includes("overdue") || statuses.includes("urgent");
    const hasSoon = statuses.includes("soon");

    return {
      row,
      originalIndex,
      soonestDays,
      license,
      medCard,
      truckDot,
      hasUrgent,
      hasSoon,
    };
  });

  return evaluated.sort((a, b) => {
    if (a.soonestDays !== b.soonestDays) return a.soonestDays - b.soonestDays;
    return a.originalIndex - b.originalIndex;
  });
}
