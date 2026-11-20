import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { db, hasDatabase } from "../db";
import { displayStore } from "@shared/schema";
import { eq } from "drizzle-orm";
import {
  type ScheduleDayHeader,
  type TruckScheduleRow,
  type TruckWeekBlock,
  type TruckScheduleState,
  normalizeTruckScheduleState,
} from "@shared/truckSchedule";
import {
  type SfScheduleRow,
  type SfWeekBlock,
  type SfScheduleState,
  normalizeSfScheduleState,
} from "@shared/sfSchedule";
import {
  parseFlexibleDateToLocal,
  dateToIsoLocal,
  isPastDueForMoreThanOneFullDay,
} from "@shared/displayUrgency";
import {
  type CustomScreenDefinition,
  type PlaylistEntry,
  type NwsAlertItem,
  DEFAULT_CUSTOM_SCREENS,
  DEFAULT_COMPANY_PLAYLIST,
  normalizePlaylistEntries,
} from "@shared/customScreens";
import { generateRaspberryPiKioskScript } from "@shared/piKioskScript";
import {
  type TvPowerScheduleConfig,
  type UnitPowerScheduleMode,
  type UnitPowerOverride,
  type TvPowerEvaluation,
  DEFAULT_TV_POWER_SCHEDULE,
  normalizeTvPowerSchedule,
  normalizeUnitPowerOverride,
  evaluateTvPowerSchedule,
} from "@shared/tvPowerSchedule";
import {
  type MapBoundingBox,
  type SavedMapRegion,
  type MapEtaHubMode,
  isValidMapBoundingBox,
  normalizeMapBoundingBox,
  normalizeSavedMapRegions,
} from "@shared/mapRegions";
import {
  type RouteTerritoryDefinition,
  DEFAULT_ROUTE_TERRITORIES,
  normalizeRouteTerritories,
} from "@shared/routeTerritories";
import {
  type PhotoGalleryState,
  DEFAULT_PHOTO_GALLERY_STATE,
  normalizePhotoGalleryState,
} from "@shared/photoGallery";
import {
  type HotShotRoute,
  normalizeHotShotRoutes,
} from "@shared/hotshots";
import {
  type WeatherOverlayMode,
  type WeatherDemoScenarioId,
  normalizeWeatherOverlayMode,
  normalizeWeatherDemoScenario,
  summarizeAlertArea,
} from "@shared/weatherOverlay";

export interface DisplayGroup {
  id: string;
  name: string;
  color: string;
  description?: string;
  playlist?: PlaylistEntry[];
}

export interface DisplayTelemetry {
  lastBrowserPingAt: string | null;
  browserFps: number | null;
  maxFrameGapMs: number | null;
  visibilityState: string | null;
  viewport: string | null;
  currentScreenIdx: number | null;
  browserUptimeSec: number | null;
  piAgentInstalled: boolean;
  lastPiPingAt: string | null;
  tvPowerState: "on" | "standby" | "off" | "disconnected" | "unknown";
  cpuTempC: number | null;
  loadAvg: number | null;
  memUsedPct: number | null;
  piUptimeSec: number | null;
  ipAddress: string | null;
  chromiumRunning: boolean | null;
  pendingCommand: string | null;
  consecutiveStallPings?: number;
  lastKnownHealth?: DisplayHealthStatus;
  lastScheduledPowerTarget?: "on" | "standby" | null;
  lastScheduledCommandAtMs?: number | null;
}

export type DisplayHealthStatus =
  | "healthy"
  | "scheduled_sleep"
  | "tv_off"
  | "browser_frozen"
  | "pi_offline"
  | "awaiting_connection";

export interface DisplayProfileConfig {
  id: string;
  name: string;
  groupId: string;
  locationNote?: string;
  uiScale: number;
  leftColumnWidthPct: number;
  sfRowsPerPage: number;
  highContrast: boolean;
  activePanel: string; // "auto" | "screen-1".."screen-4" | custom screen id
  rotationIntervalSec?: number;
  theme?: string; // "inherit" | DisplayThemeId
  playlistMode?: "group" | "custom";
  playlist?: PlaylistEntry[];
  powerScheduleMode?: UnitPowerScheduleMode; // "company" | "custom" | "always_on"
  powerSchedule?: TvPowerScheduleConfig;
  powerOverride?: UnitPowerOverride | null;
  mapRegionMode?: string; // "auto" | "auto-fit" | "corridor" | "sioux-falls" | ... | "custom" | "region:<id>"
  customMapBounds?: MapBoundingBox | null;
  mapEtaHub?: MapEtaHubMode;
  deviceToken: string;
}

export function generateDisplayToken(): string {
  return `dtk_${crypto.randomBytes(18).toString("hex")}`;
}

export function generateWebhookApiKey(): string {
  return `crm_${crypto.randomBytes(18).toString("hex")}`;
}

export function generateEmbedToken(): string {
  return `emb_${crypto.randomBytes(18).toString("hex")}`;
}

export interface DisplayAlertItem {
  id: string;
  displayId: string;
  displayName: string;
  groupName: string;
  severity: "critical" | "warning" | "recovered" | "info";
  status: DisplayHealthStatus;
  message: string;
  occurredAt: string;
  acknowledged?: boolean;
}

export interface DisplaySettings {
  companyName: string;
  companySubtitle?: string;
  companyLogoUrl?: string;
  rotationIntervalSec: number;
  activePanel: string;
  uiScale: number;
  leftColumnWidthPct: number;
  defaultProfile: string;
  webhookApiKey: string;
  embedEnabled: boolean;
  embedToken: string;
  icsCalendarUrl: string;
  tickerEnabled: boolean;
  complimentsEnabled: boolean;
  pingTimeoutSec: number;
  defaultTheme?: string;
  defaultPlaylist?: PlaylistEntry[];
  powerSchedule?: TvPowerScheduleConfig;
  savedMapRegions?: SavedMapRegion[];
  weatherOverlayMode?: WeatherOverlayMode;
  weatherDemoScenario?: WeatherDemoScenarioId;
  displayGroups: DisplayGroup[];
  displayProfiles: Record<string, DisplayProfileConfig>;
}

export interface AnnouncementItem {
  id: string;
  author: string;
  message: string;
  timestamp: string;
  createdAt: string;
  source: string;
  priority: "normal" | "important" | "urgent";
  pinned: boolean;
  active: boolean;
  /** Optional target / deadline date "YYYY-MM-DD" for live TV countdowns */
  eventDateISO?: string;
  /** Optional short label for the countdown (e.g. "RSVP Deadline", "Event Date") */
  eventLabel?: string;
  /** Automatically archive off active TV rotation once the date passes (default true) */
  autoArchive?: boolean;
}

export type {
  ScheduleDayHeader,
  TruckScheduleRow,
  TruckWeekBlock,
  TruckScheduleState,
  SfScheduleRow,
  SfWeekBlock,
  SfScheduleState,
};

export interface RenewalReminderItem {
  entity: string;
  licenseDue: string;
  medCardDue: string;
  truckDotDue: string;
}

export interface WeatherForecastDay {
  day: string;
  icon: string;
  high: number;
  low: number;
}

export interface WeatherCityItem {
  city: string;
  lat: number;
  lon: number;
  temp: number;
  condition: string;
  wind: string;
  forecast: WeatherForecastDay[];
}

export interface CalendarEventItem {
  id: string;
  title: string;
  dateISO: string;
  dayLabel: string;
  time: string;
  color: string;
  source: "admin" | "ics";
}

export interface NewsHeadlineItem {
  source: string;
  title: string;
  publishedAt?: string;
}

export interface DisplayState {
  settings: DisplaySettings;
  displayAlerts: DisplayAlertItem[];
  messages: AnnouncementItem[];
  webhookLogs: Array<{
    id: string;
    receivedAt: string;
    source: string;
    status: string;
    payload: any;
  }>;
  truckSchedule: TruckScheduleState;
  sfSchedule: SfScheduleState;
  renewalReminders: RenewalReminderItem[];
  weatherLocations: WeatherCityItem[];
  calendarEvents: CalendarEventItem[];
  newsHeadlines: NewsHeadlineItem[];
  nwsAlerts: NwsAlertItem[];
  nwsLastCheckedAt: string | null;
  customScreens: CustomScreenDefinition[];
  routeTerritories: RouteTerritoryDefinition[];
  photoGallery: PhotoGalleryState;
  hotShotRoutes: HotShotRoute[];
  compliments: string[];
  updatedAt: string;
}

const LOCAL_STORE_PATH = path.resolve(process.cwd(), "data", "display-store.json");
const DB_KEY = "main_display_state";

// In-memory live telemetry map so 10-second heartbeats don't thrash disk/DB on every tick
const liveTelemetryByDisplay = new Map<string, DisplayTelemetry>();

export function createEmptyTelemetry(): DisplayTelemetry {
  return {
    lastBrowserPingAt: null,
    browserFps: null,
    maxFrameGapMs: null,
    visibilityState: null,
    viewport: null,
    currentScreenIdx: null,
    browserUptimeSec: null,
    piAgentInstalled: false,
    lastPiPingAt: null,
    tvPowerState: "unknown",
    cpuTempC: null,
    loadAvg: null,
    memUsedPct: null,
    piUptimeSec: null,
    ipAddress: null,
    chromiumRunning: null,
    pendingCommand: null,
    consecutiveStallPings: 0,
    lastKnownHealth: "awaiting_connection",
    lastScheduledPowerTarget: null,
    lastScheduledCommandAtMs: null,
  };
}

export function getDisplayTelemetry(displayId: string): DisplayTelemetry {
  let entry = liveTelemetryByDisplay.get(displayId);
  if (!entry) {
    entry = createEmptyTelemetry();
    liveTelemetryByDisplay.set(displayId, entry);
  }
  return entry;
}

export function deleteDisplayTelemetry(displayId: string): void {
  liveTelemetryByDisplay.delete(displayId);
}

export function evaluateDisplayHealth(
  telemetry: DisplayTelemetry,
  timeoutSec = 35,
  nowMs = Date.now(),
  powerEval?: TvPowerEvaluation,
): {
  status: DisplayHealthStatus;
  label: string;
  detail: string;
  browserAgeSec: number | null;
  piAgeSec: number | null;
} {
  const browserAgeSec = telemetry.lastBrowserPingAt
    ? Math.max(0, Math.round((nowMs - new Date(telemetry.lastBrowserPingAt).getTime()) / 1000))
    : null;
  const piAgeSec = telemetry.lastPiPingAt
    ? Math.max(0, Math.round((nowMs - new Date(telemetry.lastPiPingAt).getTime()) / 1000))
    : null;

  // Never connected at all yet
  if (browserAgeSec === null && piAgeSec === null) {
    return {
      status: "awaiting_connection",
      label: "Awaiting First Ping",
      detail: "Open this display's Kiosk URL on its Raspberry Pi to begin live monitoring.",
      browserAgeSec: null,
      piAgeSec: null,
    };
  }

  const browserAlive = browserAgeSec !== null && browserAgeSec <= timeoutSec;
  const piAlive = piAgeSec !== null && piAgeSec <= timeoutSec + 10;

  // If Pi agent is installed and offline AND browser is also silent => Pi Frozen or Powered Off
  if (telemetry.piAgentInstalled && !piAlive && !browserAlive) {
    return {
      status: "pi_offline",
      label: "Pi Offline / Frozen",
      detail: `No ping from Raspberry Pi (${piAgeSec}s ago) or browser. Check Pi power or network.`,
      browserAgeSec,
      piAgeSec,
    };
  }

  // If Pi is alive, check if Chromium is crashed/frozen while Pi OS is still running!
  if (piAlive && (telemetry.chromiumRunning === false || (browserAgeSec !== null && !browserAlive))) {
    return {
      status: "browser_frozen",
      label: "Kiosk Browser Frozen",
      detail:
        telemetry.chromiumRunning === false
          ? "Pi OS is online, but Chromium kiosk process is not running."
          : `Pi OS is online, but browser stopped pinging ${browserAgeSec}s ago.`,
      browserAgeSec,
      piAgeSec,
    };
  }

  // Browser stopped pinging (without Pi agent installed)
  if (!browserAlive && !piAlive) {
    return {
      status: "pi_offline",
      label: "Offline / Frozen",
      detail: `Missed heartbeat — last ping was ${browserAgeSec ?? piAgeSec}s ago (threshold ${timeoutSec}s).`,
      browserAgeSec,
      piAgeSec,
    };
  }

  // Intentional Scheduled Sleep (TV off/standby or DPMS blanked during scheduled off-hours)
  if (powerEval?.isScheduledSleep) {
    return {
      status: "scheduled_sleep",
      label: "Scheduled Sleep",
      detail: powerEval.statusSummary,
      browserAgeSec,
      piAgeSec,
    };
  }

  // Browser is pinging, but main-thread JS event loop is genuinely locked up across >=2 consecutive pings.
  // Never flag low rAF FPS alone, because Chromium throttles rAF to 1 FPS (1s gap) whenever a window is covered/occluded.
  if (
    browserAlive &&
    (telemetry.consecutiveStallPings ?? 0) >= 2 &&
    telemetry.maxFrameGapMs !== null &&
    telemetry.maxFrameGapMs > 12000
  ) {
    return {
      status: "browser_frozen",
      label: "UI Render Stalled",
      detail: `Main thread unresponsive (${Math.round(telemetry.maxFrameGapMs / 1000)}s event-loop freeze).`,
      browserAgeSec,
      piAgeSec,
    };
  }

  // Check TV Power State (from HDMI-CEC / DRM via Pi agent, or page hidden)
  if (
    telemetry.tvPowerState === "standby" ||
    telemetry.tvPowerState === "off" ||
    telemetry.tvPowerState === "disconnected"
  ) {
    return {
      status: "tv_off",
      label: telemetry.tvPowerState === "disconnected" ? "HDMI Disconnected" : "TV Off (Standby)",
      detail: "Raspberry Pi is online, but TV panel reports Standby / Off via HDMI-CEC.",
      browserAgeSec,
      piAgeSec,
    };
  }

  if (browserAlive && telemetry.visibilityState === "hidden") {
    return {
      status: "tv_off",
      label: "Display Hidden / Minimized",
      detail: "Browser is running in background or HDMI output is inactive.",
      browserAgeSec,
      piAgeSec,
    };
  }

  return {
    status: "healthy",
    label: telemetry.tvPowerState === "on" ? "TV ON • Healthy" : "Online • Healthy",
    detail: `Heartbeat ${browserAgeSec ?? 0}s ago${telemetry.browserFps ? ` • ${telemetry.browserFps} FPS` : ""}`,
    browserAgeSec,
    piAgeSec,
  };
}

export const DEFAULT_DISPLAY_GROUPS: DisplayGroup[] = [
  {
    id: "grp-sf-office",
    name: "Sioux Falls Office & Breakroom",
    color: "#38bdf8",
    description: "Main Sioux Falls office & breakroom displays",
  },
  {
    id: "grp-warehouse",
    name: "Warehouse Floor",
    color: "#f59e0b",
    description: "High-visibility warehouse & dock displays",
  },
  {
    id: "grp-regional",
    name: "Regional / Dispatch",
    color: "#a855f7",
    description: "Dispatch & regional hub monitors",
  },
];

export const DEFAULT_DISPLAY_STATE: DisplayState = {
  settings: {
    companyName: "Interstate Batteries of South Dakota",
    companySubtitle: "Sioux Falls & Arlington Dispatch",
    companyLogoUrl: "",
    rotationIntervalSec: 22,
    activePanel: "auto",
    uiScale: 1,
    leftColumnWidthPct: 44,
    defaultProfile: "breakroom",
    webhookApiKey: generateWebhookApiKey(),
    embedEnabled: false,
    embedToken: generateEmbedToken(),
    icsCalendarUrl: "",
    tickerEnabled: true,
    complimentsEnabled: true,
    pingTimeoutSec: 35,
    defaultPlaylist: DEFAULT_COMPANY_PLAYLIST,
    powerSchedule: DEFAULT_TV_POWER_SCHEDULE,
    savedMapRegions: [],
    weatherOverlayMode: "warnings_only",
    weatherDemoScenario: "none",
    displayGroups: DEFAULT_DISPLAY_GROUPS,
    displayProfiles: {},
  },
  displayAlerts: [],
  messages: [],
  webhookLogs: [],
  truckSchedule: normalizeTruckScheduleState({}),
  sfSchedule: normalizeSfScheduleState({}),
  renewalReminders: [
    { entity: "T01-Sonny", licenseDue: "7/26/29", medCardDue: "2/17/28", truckDotDue: "May 2027" },
    { entity: "T22-Brandon", licenseDue: "8/23/28", medCardDue: "10/16/27", truckDotDue: "August 2027" },
    { entity: "T03-Nate", licenseDue: "1/16/30", medCardDue: "", truckDotDue: "November 2026" },
    { entity: "T04-Troy", licenseDue: "8/9/30", medCardDue: "12/9/27", truckDotDue: "April 2027" },
    { entity: "T55-Ron", licenseDue: "9/25/30", medCardDue: "", truckDotDue: "April 2027" },
    { entity: "Big Betty", licenseDue: "", medCardDue: "", truckDotDue: "May 2027" },
    { entity: "T02", licenseDue: "", medCardDue: "", truckDotDue: "February 2027" },
    { entity: "T05", licenseDue: "", medCardDue: "", truckDotDue: "September 2027" },
    { entity: "T06", licenseDue: "", medCardDue: "", truckDotDue: "July 2027" },
    { entity: "Tyler Dean", licenseDue: "8/1/31", medCardDue: "1/13/27", truckDotDue: "" },
    { entity: "Matthew Roberts", licenseDue: "5/9/30", medCardDue: "2/9/27", truckDotDue: "" },
    { entity: "Jerrad Swier", licenseDue: "4/4/29", medCardDue: "2/26/28", truckDotDue: "" },
    { entity: "Tyler Henriksen", licenseDue: "5/30/30", medCardDue: "4/16/27", truckDotDue: "" },
  ],
  weatherLocations: [
    {
      city: "Sioux Falls, SD",
      lat: 43.5446,
      lon: -96.7311,
      temp: 58,
      condition: "Mostly Sunny",
      wind: "12 mph SSW",
      forecast: [
        { day: "WED", icon: "☀️", high: 61, low: 39 },
        { day: "THU", icon: "⛅", high: 56, low: 34 },
        { day: "FRI", icon: "☀️", high: 54, low: 32 },
        { day: "SAT", icon: "🌤️", high: 59, low: 37 },
        { day: "SUN", icon: "⛅", high: 57, low: 35 },
      ],
    },
    {
      city: "Aberdeen, SD",
      lat: 45.4647,
      lon: -98.4865,
      temp: 53,
      condition: "Partly Cloudy",
      wind: "15 mph NW",
      forecast: [
        { day: "WED", icon: "⛅", high: 55, low: 33 },
        { day: "THU", icon: "🌤️", high: 50, low: 29 },
        { day: "FRI", icon: "☀️", high: 51, low: 30 },
        { day: "SAT", icon: "☀️", high: 56, low: 33 },
        { day: "SUN", icon: "⛅", high: 52, low: 31 },
      ],
    },
    {
      city: "Huron, SD",
      lat: 44.3633,
      lon: -98.2143,
      temp: 56,
      condition: "Clear",
      wind: "14 mph W",
      forecast: [
        { day: "WED", icon: "☀️", high: 59, low: 36 },
        { day: "THU", icon: "⛅", high: 53, low: 31 },
        { day: "FRI", icon: "☀️", high: 53, low: 31 },
        { day: "SAT", icon: "🌤️", high: 58, low: 35 },
        { day: "SUN", icon: "⛅", high: 55, low: 33 },
      ],
    },
  ],
  calendarEvents: [],
  newsHeadlines: [],
  compliments: [
    "Safe miles and smooth routes today, team!",
    "Thank you for keeping Sioux Falls & all regional stops running like clockwork!",
    "Great teamwork makes every delivery count.",
    "Have an awesome week — appreciate everything you do!",
    "Sharp eyes, safe speeds, strong week ahead!",
    "Shoutout to the warehouse and dispatch crew for keeping everything dialed in!",
  ],
  nwsAlerts: [],
  nwsLastCheckedAt: null,
  customScreens: DEFAULT_CUSTOM_SCREENS,
  routeTerritories: DEFAULT_ROUTE_TERRITORIES,
  photoGallery: DEFAULT_PHOTO_GALLERY_STATE,
  hotShotRoutes: [],
  updatedAt: new Date().toISOString(),
};

let cachedState: DisplayState | null = null;

function readLocalFile(): Partial<DisplayState> | null {
  try {
    if (fs.existsSync(LOCAL_STORE_PATH)) {
      return JSON.parse(fs.readFileSync(LOCAL_STORE_PATH, "utf8"));
    }
  } catch (err) {
    console.error("[display] Failed reading local display-store.json:", err);
  }
  return null;
}

function writeLocalFile(state: DisplayState) {
  try {
    fs.mkdirSync(path.dirname(LOCAL_STORE_PATH), { recursive: true });
    fs.writeFileSync(LOCAL_STORE_PATH, JSON.stringify(state, null, 2), "utf8");
  } catch (err) {
    console.error("[display] Failed writing local display-store.json:", err);
  }
}

function normalizeDisplayProfiles(
  rawProfiles: Record<string, any> | undefined,
  groups: DisplayGroup[],
): { profiles: Record<string, DisplayProfileConfig>; generatedAnyToken: boolean } {
  const source =
    rawProfiles && typeof rawProfiles === "object"
      ? rawProfiles
      : DEFAULT_DISPLAY_STATE.settings.displayProfiles;
  const fallbackGroupId = groups[0]?.id || "grp-sf-office";
  const result: Record<string, DisplayProfileConfig> = {};
  let generatedAnyToken = false;

  for (const [key, val] of Object.entries(source)) {
    const defaultGroup =
      key.includes("warehouse")
        ? groups.find((g) => g.id === "grp-warehouse")?.id || fallbackGroupId
        : fallbackGroupId;
    const hasToken = typeof val.deviceToken === "string" && val.deviceToken.trim().length >= 16;
    if (!hasToken) generatedAnyToken = true;
    result[key] = {
      id: val.id || key,
      name: val.name || key,
      groupId: val.groupId || defaultGroup,
      locationNote: val.locationNote || "",
      uiScale: Number(val.uiScale ?? 1.05),
      leftColumnWidthPct: Number(val.leftColumnWidthPct ?? 44),
      sfRowsPerPage: Number(val.sfRowsPerPage ?? 7),
      highContrast: Boolean(val.highContrast),
      activePanel: val.activePanel || "auto",
      rotationIntervalSec: val.rotationIntervalSec ? Number(val.rotationIntervalSec) : undefined,
      ...(val.theme ? { theme: String(val.theme) } : {}),
      playlistMode: val.playlistMode === "custom" ? "custom" : "group",
      ...(Array.isArray(val.playlist) ? { playlist: val.playlist } : {}),
      powerScheduleMode:
        val.powerScheduleMode === "custom" || val.powerScheduleMode === "always_on"
          ? val.powerScheduleMode
          : "company",
      ...(val.powerSchedule
        ? { powerSchedule: normalizeTvPowerSchedule(val.powerSchedule) }
        : {}),
      powerOverride: normalizeUnitPowerOverride(val.powerOverride),
      ...(val.mapRegionMode ? { mapRegionMode: String(val.mapRegionMode) } : {}),
      ...(isValidMapBoundingBox(val.customMapBounds)
        ? { customMapBounds: normalizeMapBoundingBox(val.customMapBounds) }
        : {}),
      ...(val.mapEtaHub === "auto" ||
      val.mapEtaHub === "main" ||
      val.mapEtaHub === "sf" ||
      val.mapEtaHub === "none"
        ? { mapEtaHub: val.mapEtaHub }
        : {}),
      deviceToken: hasToken ? val.deviceToken.trim() : generateDisplayToken(),
    };
  }
  return { profiles: result, generatedAnyToken };
}

export function buildCleanBaselineDisplayState(): DisplayState {
  const fresh = structuredClone(DEFAULT_DISPLAY_STATE);
  fresh.settings.webhookApiKey = generateWebhookApiKey();
  fresh.settings.embedToken = generateEmbedToken();
  fresh.settings.displayProfiles = {};
  fresh.truckSchedule = normalizeTruckScheduleState({});
  fresh.sfSchedule = normalizeSfScheduleState({});
  fresh.updatedAt = new Date().toISOString();
  return fresh;
}

function mergeWithDefaults(partial?: Partial<DisplayState> | null): {
  state: DisplayState;
  needsPersist: boolean;
} {
  if (!partial) {
    return { state: buildCleanBaselineDisplayState(), needsPersist: true };
  }
  const groups =
    partial.settings?.displayGroups && partial.settings.displayGroups.length > 0
      ? partial.settings.displayGroups
      : structuredClone(DEFAULT_DISPLAY_GROUPS);

  const hasWebhookKey =
    typeof partial.settings?.webhookApiKey === "string" &&
    partial.settings.webhookApiKey.trim().length >= 12;
  const hasEmbedToken =
    typeof partial.settings?.embedToken === "string" &&
    partial.settings.embedToken.trim().length >= 12;

  const { profiles, generatedAnyToken } = normalizeDisplayProfiles(
    partial.settings?.displayProfiles,
    groups,
  );

  const normalizedSchedule = normalizeTruckScheduleState(
    partial.truckSchedule || DEFAULT_DISPLAY_STATE.truckSchedule,
  );
  const normalizedSfSchedule = normalizeSfScheduleState(
    partial.sfSchedule || DEFAULT_DISPLAY_STATE.sfSchedule,
  );
  const customScreens = Array.isArray(partial.customScreens)
    ? partial.customScreens
    : structuredClone(DEFAULT_CUSTOM_SCREENS);
  const defaultPlaylist = normalizePlaylistEntries(
    partial.settings?.defaultPlaylist,
    customScreens,
    true,
  );
  const migratedLegacySchedule = !partial.truckSchedule?.weeks || !partial.sfSchedule?.weeks;
  const needsPersist = !hasWebhookKey || !hasEmbedToken || generatedAnyToken || migratedLegacySchedule;

  const state: DisplayState = {
    ...DEFAULT_DISPLAY_STATE,
    ...partial,
    settings: {
      ...DEFAULT_DISPLAY_STATE.settings,
      ...(partial.settings || {}),
      webhookApiKey: hasWebhookKey ? partial.settings!.webhookApiKey.trim() : generateWebhookApiKey(),
      embedEnabled: Boolean(partial.settings?.embedEnabled ?? false),
      embedToken: hasEmbedToken ? partial.settings!.embedToken.trim() : generateEmbedToken(),
      pingTimeoutSec: Number(partial.settings?.pingTimeoutSec ?? 35),
      defaultPlaylist,
      powerSchedule: normalizeTvPowerSchedule(
        partial.settings?.powerSchedule,
        DEFAULT_TV_POWER_SCHEDULE,
      ),
      savedMapRegions: normalizeSavedMapRegions(partial.settings?.savedMapRegions),
      weatherOverlayMode: normalizeWeatherOverlayMode(
        partial.settings?.weatherOverlayMode,
        "warnings_only",
      ),
      weatherDemoScenario: normalizeWeatherDemoScenario(partial.settings?.weatherDemoScenario),
      displayGroups: groups,
      displayProfiles: profiles,
    },
    displayAlerts: partial.displayAlerts || [],
    truckSchedule: normalizedSchedule,
    sfSchedule: normalizedSfSchedule,
    renewalReminders: partial.renewalReminders || DEFAULT_DISPLAY_STATE.renewalReminders,
    messages: partial.messages || DEFAULT_DISPLAY_STATE.messages,
    webhookLogs: partial.webhookLogs || DEFAULT_DISPLAY_STATE.webhookLogs,
    weatherLocations: partial.weatherLocations || DEFAULT_DISPLAY_STATE.weatherLocations,
    calendarEvents: partial.calendarEvents || DEFAULT_DISPLAY_STATE.calendarEvents,
    newsHeadlines: partial.newsHeadlines || DEFAULT_DISPLAY_STATE.newsHeadlines,
    nwsAlerts: Array.isArray(partial.nwsAlerts) ? partial.nwsAlerts : [],
    nwsLastCheckedAt: partial.nwsLastCheckedAt || null,
    customScreens,
    routeTerritories: normalizeRouteTerritories(
      partial.routeTerritories,
      DEFAULT_ROUTE_TERRITORIES,
    ),
    photoGallery: normalizePhotoGalleryState(
      partial.photoGallery,
      DEFAULT_PHOTO_GALLERY_STATE,
    ),
    hotShotRoutes: normalizeHotShotRoutes(partial.hotShotRoutes),
    compliments: partial.compliments || DEFAULT_DISPLAY_STATE.compliments,
    updatedAt: partial.updatedAt || new Date().toISOString(),
  };

  return { state, needsPersist };
}

export function purgeExpiredPastDueItems(state: DisplayState, now = new Date()): boolean {
  let mutated = false;

  if (Array.isArray(state.renewalReminders)) {
    state.renewalReminders = state.renewalReminders.map((item) => {
      let rowChanged = false;
      let licenseDue = item.licenseDue || "";
      let medCardDue = item.medCardDue || "";
      let truckDotDue = item.truckDotDue || "";

      if (licenseDue && isPastDueForMoreThanOneFullDay(licenseDue, now)) {
        licenseDue = "";
        rowChanged = true;
      }
      if (medCardDue && isPastDueForMoreThanOneFullDay(medCardDue, now)) {
        medCardDue = "";
        rowChanged = true;
      }
      if (truckDotDue && isPastDueForMoreThanOneFullDay(truckDotDue, now)) {
        truckDotDue = "";
        rowChanged = true;
      }

      if (rowChanged) {
        mutated = true;
        return { ...item, licenseDue, medCardDue, truckDotDue };
      }
      return item;
    });
  }

  if (Array.isArray(state.calendarEvents) && state.calendarEvents.length > 0) {
    const beforeLen = state.calendarEvents.length;
    state.calendarEvents = state.calendarEvents.filter(
      (ev) => !isPastDueForMoreThanOneFullDay(ev.dateISO, now),
    );
    if (state.calendarEvents.length !== beforeLen) {
      mutated = true;
    }
  }

  return mutated;
}

export async function getDisplayState(): Promise<DisplayState> {
  if (cachedState) {
    if (purgeExpiredPastDueItems(cachedState)) {
      await saveDisplayState(cachedState);
    }
    return cachedState;
  }

  if (hasDatabase && db) {
    try {
      const [row] = await db
        .select()
        .from(displayStore)
        .where(eq(displayStore.key, DB_KEY));
      if (row && row.value) {
        const merged = mergeWithDefaults(row.value as Partial<DisplayState>);
        const purged = purgeExpiredPastDueItems(merged.state);
        cachedState = merged.state;
        if (merged.needsPersist || purged) {
          await saveDisplayState(cachedState);
        }
        return cachedState;
      }
    } catch (err) {
      console.warn("[display] DB read fallback to local file:", (err as Error).message);
    }
  }

  const fromDisk = readLocalFile();
  const merged = mergeWithDefaults(fromDisk);
  purgeExpiredPastDueItems(merged.state);
  cachedState = merged.state;
  writeLocalFile(cachedState);

  if (hasDatabase && db) {
    try {
      await db
        .insert(displayStore)
        .values({ key: DB_KEY, value: cachedState, updatedAt: new Date() })
        .onConflictDoNothing();
    } catch {}
  }

  return cachedState;
}

export async function saveDisplayState(nextState: DisplayState): Promise<DisplayState> {
  nextState.updatedAt = new Date().toISOString();
  cachedState = nextState;
  writeLocalFile(nextState);

  if (hasDatabase && db) {
    try {
      await db
        .insert(displayStore)
        .values({ key: DB_KEY, value: nextState, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: displayStore.key,
          set: { value: nextState, updatedAt: new Date() },
        });
    } catch (err) {
      console.error("[display] Failed saving display state to DB:", (err as Error).message);
    }
  }

  return nextState;
}

export async function resetDisplayStateToCleanBaseline(): Promise<DisplayState> {
  liveTelemetryByDisplay.clear();
  const cleanState = buildCleanBaselineDisplayState();
  return saveDisplayState(cleanState);
}

// Build enriched display telemetry snapshot for Admin & WebSocket clients
export async function getEnrichedDisplayFleetSnapshot() {
  const state = await getDisplayState();
  const timeoutSec = state.settings.pingTimeoutSec || 35;
  const groupsById = new Map(state.settings.displayGroups.map((g) => [g.id, g]));
  const nowMs = Date.now();
  const now = new Date(nowMs);

  const units = Object.values(state.settings.displayProfiles).map((prof) => {
    const telemetry = getDisplayTelemetry(prof.id);
    const powerEval = evaluateTvPowerSchedule(state.settings.powerSchedule, prof, now);
    const health = evaluateDisplayHealth(telemetry, timeoutSec, nowMs, powerEval);
    const group = groupsById.get(prof.groupId) || {
      id: "ungrouped",
      name: "Ungrouped",
      color: "#94a3b8",
    };
    return {
      ...prof,
      groupName: group.name,
      groupColor: group.color,
      telemetry,
      health,
      powerEval,
    };
  });

  return units;
}

// Evaluate scheduled wake/sleep transitions and queue tv_on / tv_standby commands for Raspberry Pis
export async function evaluateScheduledPowerActions(now = new Date()): Promise<{
  triggeredActions: Array<{
    displayId: string;
    name: string;
    action: "tv_on" | "tv_standby";
    reason: string;
  }>;
  stateMutated: boolean;
}> {
  const state = await getDisplayState();
  const nowMs = now.getTime();
  const triggeredActions: Array<{
    displayId: string;
    name: string;
    action: "tv_on" | "tv_standby";
    reason: string;
  }> = [];
  let stateMutated = false;

  for (const prof of Object.values(state.settings.displayProfiles)) {
    const telemetry = getDisplayTelemetry(prof.id);

    // Clear expired manual override cleanly so persisted state stays tidy
    if (prof.powerOverride) {
      const expMs = new Date(prof.powerOverride.untilIso).getTime();
      if (Number.isNaN(expMs) || expMs <= nowMs) {
        prof.powerOverride = null;
        stateMutated = true;
      }
    }

    const powerEval = evaluateTvPowerSchedule(state.settings.powerSchedule, prof, now);
    if (!powerEval.scheduleActive && !powerEval.hasManualOverride) {
      telemetry.lastScheduledPowerTarget = null;
      continue;
    }

    const desired: "on" | "standby" = powerEval.shouldBeOn ? "on" : "standby";
    const desiredCmd: "tv_on" | "tv_standby" = desired === "on" ? "tv_on" : "tv_standby";

    const boundaryChanged = telemetry.lastScheduledPowerTarget !== desired;
    const cooldownElapsed =
      !telemetry.lastScheduledCommandAtMs || nowMs - telemetry.lastScheduledCommandAtMs >= 180_000;
    const hardwareOutOfSync =
      telemetry.piAgentInstalled &&
      !telemetry.pendingCommand &&
      cooldownElapsed &&
      ((desired === "standby" && telemetry.tvPowerState === "on") ||
        (desired === "on" &&
          (telemetry.tvPowerState === "standby" || telemetry.tvPowerState === "off")));

    if (boundaryChanged || hardwareOutOfSync) {
      telemetry.lastScheduledPowerTarget = desired;
      telemetry.lastScheduledCommandAtMs = nowMs;
      if (!telemetry.pendingCommand) {
        telemetry.pendingCommand = desiredCmd;
      }
      triggeredActions.push({
        displayId: prof.id,
        name: prof.name,
        action: desiredCmd,
        reason: boundaryChanged ? powerEval.statusSummary : "Resyncing TV hardware power state",
      });
    }
  }

  if (stateMutated) {
    await saveDisplayState(state);
  }

  return { triggeredActions, stateMutated };
}

// Evaluate transitions and append alerts when a TV turns off, freezes, goes offline, or recovers
export async function checkDisplayHealthTransitions(): Promise<DisplayAlertItem[]> {
  const state = await getDisplayState();
  const timeoutSec = state.settings.pingTimeoutSec || 35;
  const groupsById = new Map(state.settings.displayGroups.map((g) => [g.id, g]));
  const nowMs = Date.now();
  const now = new Date(nowMs);
  const newAlerts: DisplayAlertItem[] = [];

  for (const prof of Object.values(state.settings.displayProfiles)) {
    const telemetry = getDisplayTelemetry(prof.id);
    const prevStatus = telemetry.lastKnownHealth || "awaiting_connection";
    const powerEval = evaluateTvPowerSchedule(state.settings.powerSchedule, prof, now);
    const health = evaluateDisplayHealth(telemetry, timeoutSec, nowMs, powerEval);

    if (health.status !== prevStatus) {
      telemetry.lastKnownHealth = health.status;

      // Skip logging initial connection from awaiting_connection -> healthy as an error, log it as info
      let severity: DisplayAlertItem["severity"] | null = null;
      if (health.status === "pi_offline" || health.status === "browser_frozen") {
        severity = "critical";
      } else if (health.status === "tv_off") {
        severity = "warning";
      } else if (
        health.status === "healthy" &&
        (prevStatus === "pi_offline" || prevStatus === "browser_frozen" || prevStatus === "tv_off")
      ) {
        severity = "recovered";
      }

      if (severity) {
        const groupName = groupsById.get(prof.groupId)?.name || "Displays";
        const alert: DisplayAlertItem = {
          id: `alert-${crypto.randomUUID().slice(0, 8)}`,
          displayId: prof.id,
          displayName: prof.name,
          groupName,
          severity,
          status: health.status,
          message: `${prof.name}: ${health.label} — ${health.detail}`,
          occurredAt: new Date().toISOString(),
          acknowledged: false,
        };
        newAlerts.push(alert);
      }
    }
  }

  if (newAlerts.length > 0) {
    state.displayAlerts = [...newAlerts, ...(state.displayAlerts || [])].slice(0, 50);
    await saveDisplayState(state);
  }

  return newAlerts;
}

export function slugifyDisplayId(name: string, existingIds: Set<string>): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 28) || "display";
  if (!existingIds.has(base)) return base;
  let counter = 2;
  while (existingIds.has(`${base}-${counter}`)) counter++;
  return `${base}-${counter}`;
}

export function sanitizeDisplayStateForScope(clientState: any, isAdmin: boolean) {
  if (isAdmin) return clientState;

  const sanitizedProfiles: Record<string, any> = {};
  for (const [k, prof] of Object.entries(clientState.settings?.displayProfiles || {})) {
    const { deviceToken: _dt, ...safeProf } = prof as any;
    sanitizedProfiles[k] = safeProf;
  }

  const sanitizedUnits = (clientState.displayUnits || []).map((u: any) => {
    const { deviceToken: _dt, telemetry, ...rest } = u;
    return {
      ...rest,
      telemetry: telemetry ? { ...telemetry, ipAddress: null } : telemetry,
    };
  });

  return {
    ...clientState,
    settings: {
      ...clientState.settings,
      webhookApiKey: "",
      embedToken: "",
      icsCalendarUrl: "",
      displayProfiles: sanitizedProfiles,
    },
    webhookLogs: [],
    displayAlerts: [],
    displayUnits: sanitizedUnits,
  };
}

export function generateRaspberryPiAgentScript(
  serverOrigin: string,
  displayId: string,
  deviceToken: string,
): string {
  return generateRaspberryPiKioskScript(serverOrigin, displayId, deviceToken);
}

export function normalizeIncomingMessage(body: any, defaultSource = "CRM"): {
  msg: AnnouncementItem;
  replaceExisting: boolean;
} {
  const item = Array.isArray(body) ? body[0] || {} : typeof body === "string" ? { message: body } : body || {};
  const author =
    item.author ||
    item.name ||
    item.user ||
    item.sender ||
    item.from ||
    item.postedBy ||
    "Announcement";
  const message =
    item.message ||
    item.text ||
    item.body ||
    item.content ||
    item.description ||
    item.title ||
    "";
  const nowFormatted = new Date().toLocaleString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const timestamp = item.timestamp || item.date || item.time || item.created_at || nowFormatted;
  const rawPriority = String(item.priority || "important").toLowerCase();
  const priority: "normal" | "important" | "urgent" =
    rawPriority === "urgent" ? "urgent" : rawPriority === "normal" ? "normal" : "important";
  const replaceExisting = item.replace === true || item.mode === "replace";

  const rawEventDate =
    item.eventDateISO || item.eventDate || item.deadline || item.targetDate || item.expiresAt || "";
  const parsedEventDt = rawEventDate ? parseFlexibleDateToLocal(String(rawEventDate)) : null;
  const eventDateISO = parsedEventDt ? dateToIsoLocal(parsedEventDt) : undefined;
  const eventLabel = item.eventLabel ? String(item.eventLabel).trim() : undefined;
  const autoArchive = item.autoArchive !== undefined ? Boolean(item.autoArchive) : true;

  return {
    msg: {
      id: item.id || `msg-${crypto.randomUUID().slice(0, 8)}`,
      author: String(author).trim(),
      message: String(message).trim(),
      timestamp: String(timestamp).trim(),
      createdAt: new Date().toISOString(),
      source: item.source || defaultSource,
      priority,
      pinned: item.pinned !== undefined ? Boolean(item.pinned) : true,
      active: item.active !== undefined ? Boolean(item.active) : true,
      ...(eventDateISO ? { eventDateISO } : {}),
      ...(eventLabel ? { eventLabel } : {}),
      autoArchive,
    },
    replaceExisting,
  };
}

function weatherCodeToDisplay(code: number): { condition: string; icon: string } {
  if (code === 0) return { condition: "Clear", icon: "☀️" };
  if (code === 1) return { condition: "Mostly Clear", icon: "🌤️" };
  if (code === 2) return { condition: "Partly Cloudy", icon: "⛅" };
  if (code === 3) return { condition: "Overcast", icon: "☁️" };
  if (code >= 45 && code <= 48) return { condition: "Fog", icon: "🌫️" };
  if (code >= 51 && code <= 67) return { condition: "Rain", icon: "🌧️" };
  if (code >= 71 && code <= 77) return { condition: "Snow", icon: "❄️" };
  if (code >= 80 && code <= 82) return { condition: "Showers", icon: "🌦️" };
  if (code >= 85 && code <= 86) return { condition: "Snow Showers", icon: "🌨️" };
  if (code >= 95) return { condition: "Thunderstorm", icon: "⛈️" };
  return { condition: "Partly Cloudy", icon: "⛅" };
}

function degToCompass(deg: number): string {
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return dirs[Math.round(deg / 22.5) % 16];
}

export async function refreshLiveWeather(): Promise<boolean> {
  const state = await getDisplayState();
  let updatedAny = false;
  const nextLocations: WeatherCityItem[] = [];

  for (const loc of state.weatherLocations) {
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=temperature_2m,weather_code,wind_speed_10m,wind_direction_10m&daily=weather_code,temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America%2FChicago&forecast_days=5`;
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) {
        nextLocations.push(loc);
        continue;
      }
      const data: any = await res.json();
      const curr = data.current;
      const daily = data.daily;
      const currMapped = weatherCodeToDisplay(Number(curr?.weather_code ?? 0));
      const windSpeed = Math.round(Number(curr?.wind_speed_10m ?? 10));
      const windDir = degToCompass(Number(curr?.wind_direction_10m ?? 180));

      const forecast: WeatherForecastDay[] = (daily?.time || []).slice(0, 5).map((dateStr: string, idx: number) => {
        const dt = new Date(`${dateStr}T12:00:00`);
        const day = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][dt.getDay()];
        const mapped = weatherCodeToDisplay(Number(daily.weather_code?.[idx] ?? 0));
        return {
          day,
          icon: mapped.icon,
          high: Math.round(Number(daily.temperature_2m_max?.[idx] ?? 60)),
          low: Math.round(Number(daily.temperature_2m_min?.[idx] ?? 40)),
        };
      });

      nextLocations.push({
        ...loc,
        temp: Math.round(Number(curr?.temperature_2m ?? loc.temp)),
        condition: currMapped.condition,
        wind: `${windSpeed} mph ${windDir}`,
        forecast: forecast.length > 0 ? forecast : loc.forecast,
      });
      updatedAny = true;
    } catch {
      nextLocations.push(loc);
    }
  }

  if (updatedAny) {
    state.weatherLocations = nextLocations;
    await saveDisplayState(state);
  }
  return updatedAny;
}

function extractRssTitles(xml: string, sourceLabel: string, maxItems = 6): NewsHeadlineItem[] {
  const items: NewsHeadlineItem[] = [];
  const itemBlocks = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
  for (const block of itemBlocks.slice(0, maxItems)) {
    const titleMatch =
      block.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/i) ||
      block.match(/<title>([\s\S]*?)<\/title>/i);
    if (titleMatch && titleMatch[1]) {
      const clean = titleMatch[1]
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&#8217;/g, "'")
        .replace(/&#8216;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/<[^>]+>/g, "")
        .trim();
      if (clean) {
        items.push({ source: sourceLabel, title: clean });
      }
    }
  }
  return items;
}

export async function refreshLiveNews(): Promise<boolean> {
  try {
    const [keloRes, espnRes] = await Promise.allSettled([
      fetch("https://www.keloland.com/feed/", { signal: AbortSignal.timeout(6000) }),
      fetch("https://www.espn.com/espn/rss/news", { signal: AbortSignal.timeout(6000) }),
    ]);

    const combined: NewsHeadlineItem[] = [];
    if (keloRes.status === "fulfilled" && keloRes.value.ok) {
      const xml = await keloRes.value.text();
      combined.push(...extractRssTitles(xml, "KELOLAND", 5));
    }
    if (espnRes.status === "fulfilled" && espnRes.value.ok) {
      const xml = await espnRes.value.text();
      combined.push(...extractRssTitles(xml, "ESPN", 5));
    }

    if (combined.length > 0) {
      const interleaved: NewsHeadlineItem[] = [];
      const kelo = combined.filter((i) => i.source === "KELOLAND");
      const espn = combined.filter((i) => i.source === "ESPN");
      const maxLen = Math.max(kelo.length, espn.length);
      for (let i = 0; i < maxLen; i++) {
        if (kelo[i]) interleaved.push(kelo[i]);
        if (espn[i]) interleaved.push(espn[i]);
      }

      const state = await getDisplayState();
      state.newsHeadlines = interleaved;
      await saveDisplayState(state);
      return true;
    }
  } catch {}
  return false;
}

export async function syncIcsCalendarFeed(icsUrl?: string): Promise<{ ok: boolean; count: number; error?: string }> {
  const state = await getDisplayState();
  const rawUrl = (icsUrl ?? state.settings.icsCalendarUrl ?? "").trim();
  if (!rawUrl) {
    return { ok: false, count: 0, error: "No Outlook .ics URL configured" };
  }
  const targetUrl = rawUrl.replace(/^webcals?:\/\//i, "https://");

  try {
    const res = await fetch(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; FleetDisplayCalendarSync/1.0)",
        Accept: "text/calendar, text/plain, */*",
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) {
      return { ok: false, count: 0, error: `HTTP ${res.status} fetching .ics feed` };
    }
    const text = await res.text();
    const unfolded = text.replace(/\r?\n[ \t]/g, "");
    const blocks = unfolded.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/gi) || [];
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const horizon = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);

    const syncedEvents: CalendarEventItem[] = [];
    const seenKeys = new Set<string>();

    for (const block of blocks) {
      if (/^STATUS\s*:\s*CANCELLED/im.test(block)) continue;

      const summaryMatch = block.match(/^SUMMARY(?:;[^:]*)?:(.*)$/im);
      const dtStartMatch = block.match(/^DTSTART(?:;[^:]*)?:(.*)$/im);
      if (!summaryMatch || !dtStartMatch) continue;

      const title = summaryMatch[1]
        .replace(/\\,/g, ",")
        .replace(/\\;/g, ";")
        .replace(/\\n/gi, " ")
        .trim();
      if (!title) continue;

      const rawDt = dtStartMatch[1].trim();
      let eventDate: Date | null = null;
      let isAllDay = false;

      if (/^\d{8}$/.test(rawDt)) {
        const y = Number(rawDt.slice(0, 4));
        const m = Number(rawDt.slice(4, 6)) - 1;
        const d = Number(rawDt.slice(6, 8));
        eventDate = new Date(y, m, d, 12, 0, 0);
        isAllDay = true;
      } else if (/^\d{8}T\d{6}/.test(rawDt)) {
        const y = Number(rawDt.slice(0, 4));
        const m = Number(rawDt.slice(4, 6)) - 1;
        const d = Number(rawDt.slice(6, 8));
        const hr = Number(rawDt.slice(9, 11));
        const min = Number(rawDt.slice(11, 13));
        eventDate = rawDt.endsWith("Z")
          ? new Date(Date.UTC(y, m, d, hr, min))
          : new Date(y, m, d, hr, min);
      }

      if (!eventDate || isNaN(eventDate.getTime())) continue;

      // Project yearly recurring events (birthdays, work anniversaries, annual holidays) into upcoming window
      const rruleMatch = block.match(/^RRULE(?:;[^:]*)?:(.*)$/im);
      if (rruleMatch && /FREQ=YEARLY/i.test(rruleMatch[1])) {
        const untilMatch = rruleMatch[1].match(/UNTIL=(\d{8})/i);
        if (untilMatch) {
          const uy = Number(untilMatch[1].slice(0, 4));
          const um = Number(untilMatch[1].slice(4, 6)) - 1;
          const ud = Number(untilMatch[1].slice(6, 8));
          if (new Date(uy, um, ud, 23, 59, 59) < now) continue;
        }
        const cand = new Date(eventDate);
        cand.setFullYear(now.getFullYear());
        if (cand < now) {
          cand.setFullYear(now.getFullYear() + 1);
        }
        eventDate = cand;
      }

      if (eventDate < now || eventDate > horizon) continue;

      const dateISO = isAllDay
        ? dateToIsoLocal(eventDate)
        : new Intl.DateTimeFormat("en-CA", {
            timeZone: "America/Chicago",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }).format(eventDate);

      const dedupeKey = `${title.toLowerCase()}|${dateISO}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);

      const dayLabel = eventDate.toLocaleDateString("en-US", {
        timeZone: isAllDay ? undefined : "America/Chicago",
        weekday: "long",
        month: "short",
        day: "numeric",
      });
      const time = isAllDay
        ? "All Day"
        : eventDate.toLocaleTimeString("en-US", {
            timeZone: "America/Chicago",
            hour: "numeric",
            minute: "2-digit",
          });

      syncedEvents.push({
        id: `ics-${crypto.createHash("md5").update(`${title}-${dateISO}`).digest("hex").slice(0, 8)}`,
        title,
        dateISO,
        dayLabel,
        time,
        color: "#0078d4",
        source: "ics",
      });
    }

    const manualEvents = state.calendarEvents.filter((e) => e.source !== "ics");
    state.calendarEvents = [...manualEvents, ...syncedEvents].sort((a, b) =>
      a.dateISO.localeCompare(b.dateISO),
    );
    await saveDisplayState(state);
    return { ok: true, count: syncedEvents.length };
  } catch (err: any) {
    return { ok: false, count: 0, error: err.message };
  }
}

const SD_CORRIDOR_COUNTIES_REGEX =
  /\b(Minnehaha|Lincoln|Turner|Moody|Brookings|Kingsbury|Lake|Miner|Sanborn|Beadle|Spink|Brown|Codington|Clark|Hamlin|Davison|McCook|Hanson|Deuel|Grant|Marshall|Day|Edmunds|Yankton|Clay|Union|Bon Homme|Charles Mix|Brule|Aurora|Jerauld|Hand|Faulk|Roberts)\b/i;

const BORDER_DELIVERY_COUNTIES_REGEX =
  /\b(Rock,\s*MN|Pipestone,\s*MN|Nobles,\s*MN|Murray,\s*MN|Lyon,\s*MN|Lincoln,\s*MN|Redwood,\s*MN|Brown,\s*MN|Cottonwood,\s*MN|Jackson,\s*MN|Martin,\s*MN|Yellow Medicine,\s*MN|Lac qui Parle,\s*MN|Big Stone,\s*MN|Traverse,\s*MN|Stevens,\s*MN|Swift,\s*MN|Kandiyohi,\s*MN|Chippewa,\s*MN|Lyon,\s*IA|Osceola,\s*IA|Dickinson,\s*IA|Emmet,\s*IA|Sioux,\s*IA|O'Brien,\s*IA|Clay,\s*IA|Plymouth,\s*IA|Cherokee,\s*IA|Woodbury,\s*IA|Boyd,\s*NE|Knox,\s*NE|Cedar,\s*NE|Dixon,\s*NE|Dakota,\s*NE)\b/i;

const NWS_USER_AGENT = "(FleetOperationsDisplay/1.0, ops@fleet-display.local)";
const NWS_ZONE_CACHE_PATH = path.resolve(process.cwd(), "data", "nws-zone-cache.json");
let nwsZoneGeometryCache: Map<string, Array<Array<[number, number]>>> | null = null;

function getNwsZoneCache(): Map<string, Array<Array<[number, number]>>> {
  if (nwsZoneGeometryCache) return nwsZoneGeometryCache;
  nwsZoneGeometryCache = new Map();
  try {
    if (fs.existsSync(NWS_ZONE_CACHE_PATH)) {
      const raw = JSON.parse(fs.readFileSync(NWS_ZONE_CACHE_PATH, "utf8"));
      if (raw && typeof raw === "object") {
        for (const [zoneKey, rings] of Object.entries(raw)) {
          if (Array.isArray(rings) && rings.length > 0) {
            nwsZoneGeometryCache.set(zoneKey, rings as Array<Array<[number, number]>>);
          }
        }
      }
    }
  } catch {
    // Ignore corrupted cache file
  }
  return nwsZoneGeometryCache;
}

function persistNwsZoneCache(): void {
  if (!nwsZoneGeometryCache) return;
  try {
    fs.mkdirSync(path.dirname(NWS_ZONE_CACHE_PATH), { recursive: true });
    const obj: Record<string, Array<Array<[number, number]>>> = {};
    nwsZoneGeometryCache.forEach((v, k) => {
      obj[k] = v;
    });
    fs.writeFileSync(NWS_ZONE_CACHE_PATH, JSON.stringify(obj), "utf8");
  } catch {
    // Non-fatal
  }
}

/**
 * Simplifies a [lon, lat] GeoJSON ring to a lightweight [lat, lon] ring capped at maxPoints
 * so multi-county weather polygons stay crisp without bloating display-store JSON payloads.
 */
function simplifyGeoJsonLonLatRing(
  rawRing: any[],
  maxPoints = 32,
): Array<[number, number]> | null {
  if (!Array.isArray(rawRing) || rawRing.length < 3) return null;
  const pts: Array<[number, number]> = [];
  for (const pt of rawRing) {
    if (!Array.isArray(pt) || pt.length < 2) continue;
    const lon = Number(pt[0]);
    const lat = Number(pt[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    pts.push([Math.round(lat * 10000) / 10000, Math.round(lon * 10000) / 10000]);
  }
  if (pts.length < 3) return null;

  if (pts.length <= maxPoints) return pts;

  const step = (pts.length - 1) / (maxPoints - 1);
  const sampled: Array<[number, number]> = [];
  for (let i = 0; i < maxPoints - 1; i++) {
    sampled.push(pts[Math.round(i * step)]);
  }
  sampled.push(sampled[0]);
  return sampled.length >= 3 ? sampled : null;
}

function extractSimplifiedPolygonsFromGeoJson(
  geom: any,
  maxPointsPerRing = 32,
): Array<Array<[number, number]>> {
  if (!geom || typeof geom !== "object") return [];
  const rings: Array<Array<[number, number]>> = [];
  if (geom.type === "Polygon" && Array.isArray(geom.coordinates)) {
    const outer = simplifyGeoJsonLonLatRing(geom.coordinates[0], maxPointsPerRing);
    if (outer) rings.push(outer);
  } else if (geom.type === "MultiPolygon" && Array.isArray(geom.coordinates)) {
    for (const poly of geom.coordinates.slice(0, 8)) {
      if (Array.isArray(poly) && poly.length > 0) {
        const outer = simplifyGeoJsonLonLatRing(poly[0], maxPointsPerRing);
        if (outer) rings.push(outer);
      }
    }
  }
  return rings;
}

function computePolygonsCentroid(
  polygons: Array<Array<[number, number]>>,
): [number, number] | undefined {
  if (!polygons || polygons.length === 0) return undefined;
  let minLat = 90;
  let maxLat = -90;
  let minLon = 180;
  let maxLon = -180;
  let count = 0;
  for (const ring of polygons) {
    for (const [lat, lon] of ring) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      count++;
    }
  }
  if (count === 0) return undefined;
  return [
    Math.round(((minLat + maxLat) / 2) * 10000) / 10000,
    Math.round(((minLon + maxLon) / 2) * 10000) / 10000,
  ];
}

function polygonsIntersectDeliveryRegion(polygons: Array<Array<[number, number]>>): boolean {
  for (const ring of polygons) {
    for (const [lat, lon] of ring) {
      if (lat >= 42.1 && lat <= 46.25 && lon >= -101.6 && lon <= -94.3) {
        return true;
      }
    }
  }
  return false;
}

async function resolveNwsZonePolygons(
  zoneUrls: string[],
): Promise<{ polygons: Array<Array<[number, number]>>; dirtyCache: boolean }> {
  const cache = getNwsZoneCache();
  const out: Array<Array<[number, number]>> = [];
  let dirtyCache = false;

  const eligibleUrls = zoneUrls
    .filter((u) => typeof u === "string" && /\/(SD|MN|IA|NE)[CZ]\d+$/i.test(u))
    .slice(0, 10);

  const missingUrls: string[] = [];
  for (const url of eligibleUrls) {
    const cached = cache.get(url);
    if (cached) {
      out.push(...cached);
    } else {
      missingUrls.push(url);
    }
  }

  if (missingUrls.length > 0) {
    const fetched = await Promise.all(
      missingUrls.slice(0, 6).map(async (url) => {
        try {
          const zRes = await fetch(url, {
            headers: {
              "User-Agent": NWS_USER_AGENT,
              Accept: "application/geo+json",
            },
            signal: AbortSignal.timeout(4500),
          });
          if (!zRes.ok) return null;
          const zJson: any = await zRes.json();
          const rings = extractSimplifiedPolygonsFromGeoJson(zJson?.geometry, 28);
          return rings.length > 0 ? { url, rings } : null;
        } catch {
          return null;
        }
      }),
    );

    for (const item of fetched) {
      if (item) {
        cache.set(item.url, item.rings);
        out.push(...item.rings);
        dirtyCache = true;
      }
    }
  }

  return { polygons: out.slice(0, 14), dirtyCache };
}

export async function refreshLiveNwsAlerts(): Promise<boolean> {
  try {
    const res = await fetch("https://api.weather.gov/alerts/active?area=SD,MN,IA,NE", {
      headers: {
        "User-Agent": NWS_USER_AGENT,
        Accept: "application/geo+json",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return false;

    const data: any = await res.json();
    const rawFeatures: any[] = Array.isArray(data?.features) ? data.features : [];
    const seenIds = new Set<string>();
    const severityOrder: Record<string, number> = {
      Extreme: 0,
      Severe: 1,
      Moderate: 2,
      Minor: 3,
      Unknown: 4,
    };

    const candidates: Array<{
      feature: any;
      id: string;
      event: string;
      severity: NwsAlertItem["severity"];
      headline: string;
      areaDesc: string;
      expires: string | null;
      instruction?: string;
      isCorridor: boolean;
      directPolygons: Array<Array<[number, number]>>;
      affectedZones: string[];
    }> = [];

    for (const f of rawFeatures) {
      const p = f?.properties;
      if (!p || !p.event) continue;
      const id = String(p.id || f.id || crypto.randomUUID());
      if (seenIds.has(id)) continue;
      seenIds.add(id);

      const areaDesc = String(p.areaDesc || "South Dakota").trim();
      const affectedZones: string[] = Array.isArray(p.affectedZones) ? p.affectedZones : [];
      const hasSdArea =
        /\bSD\b|South Dakota/i.test(areaDesc) ||
        affectedZones.some((z) => /\/SD[CZ]\d+$/i.test(String(z)));
      const hasBorderDeliveryCounty = BORDER_DELIVERY_COUNTIES_REGEX.test(areaDesc);
      const directPolygons = extractSimplifiedPolygonsFromGeoJson(f?.geometry, 34);
      const intersectsDirect =
        directPolygons.length > 0 && polygonsIntersectDeliveryRegion(directPolygons);

      if (!hasSdArea && !hasBorderDeliveryCounty && !intersectsDirect) {
        continue;
      }

      const isCorridor = SD_CORRIDOR_COUNTIES_REGEX.test(areaDesc) || hasBorderDeliveryCounty;
      const sevRaw = String(p.severity || "Unknown");
      const severity: NwsAlertItem["severity"] =
        sevRaw === "Extreme" || sevRaw === "Severe" || sevRaw === "Moderate" || sevRaw === "Minor"
          ? sevRaw
          : "Unknown";

      candidates.push({
        feature: f,
        id,
        event: String(p.event).trim(),
        severity,
        headline: String(p.headline || p.event).trim(),
        areaDesc,
        expires: p.expires ? String(p.expires) : null,
        ...(p.instruction
          ? { instruction: String(p.instruction).replace(/\s+/g, " ").trim().slice(0, 260) }
          : {}),
        isCorridor,
        directPolygons,
        affectedZones,
      });
    }

    candidates.sort((a, b) => {
      if (a.isCorridor !== b.isCorridor) return a.isCorridor ? -1 : 1;
      return (severityOrder[a.severity] ?? 4) - (severityOrder[b.severity] ?? 4);
    });

    const topCandidates = candidates.slice(0, 10);
    let anyZoneCacheDirty = false;
    const parsed: NwsAlertItem[] = [];

    for (const c of topCandidates) {
      let polygons = c.directPolygons;
      if (polygons.length === 0 && c.affectedZones.length > 0) {
        const resolved = await resolveNwsZonePolygons(c.affectedZones);
        polygons = resolved.polygons;
        if (resolved.dirtyCache) anyZoneCacheDirty = true;
      }
      const centroid = computePolygonsCentroid(polygons);
      parsed.push({
        id: c.id,
        event: c.event,
        severity: c.severity,
        headline: c.headline,
        areaDesc: c.areaDesc,
        shortArea: summarizeAlertArea(c.areaDesc),
        expires: c.expires,
        ...(c.instruction ? { instruction: c.instruction } : {}),
        isCorridor: c.isCorridor,
        ...(polygons.length > 0 ? { polygons } : {}),
        ...(centroid ? { centroid } : {}),
      });
    }

    if (anyZoneCacheDirty) {
      persistNwsZoneCache();
    }

    const state = await getDisplayState();
    state.nwsAlerts = parsed;
    state.nwsLastCheckedAt = new Date().toISOString();
    await saveDisplayState(state);
    return true;
  } catch {
    return false;
  }
}
