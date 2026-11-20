export type ScreenWidgetType =
  | "today_snapshot"
  | "sf_daily_shift"
  | "hotshot_board"
  | "nws_alerts"
  | "safety_streak"
  | "big_countdown"
  | "media_qr"
  | "photo_gallery"
  | "custom_info"
  | "live_map"
  | "truck_schedule"
  | "sf_schedule"
  | "announcements"
  | "calendar"
  | "renewals"
  | "weather_multi";

export interface ScreenWidgetInstance {
  id: string;
  type: ScreenWidgetType;
  titleOverride?: string;
  /** 0-based column index on 12-column grid (0..11) */
  x: number;
  /** 0-based row index on 6-row grid (0..5) */
  y: number;
  /** Width in grid columns (1..12) */
  w: number;
  /** Height in grid rows (1..6) */
  h: number;
  config: Record<string, any>;
}

export type DisplayThemeId =
  | "industrial-dispatch"
  | "daylight-paper"
  | "shop-floor-contrast"
  | "midnight-rail";

export interface DisplayThemeMeta {
  id: DisplayThemeId;
  name: string;
  shortLabel: string;
  description: string;
  isLight: boolean;
  swatchBg: string;
  swatchSurface: string;
  swatchAccent: string;
  swatchText: string;
}

export const DISPLAY_THEMES: DisplayThemeMeta[] = [
  {
    id: "industrial-dispatch",
    name: "Industrial Dispatch (Charcoal & Highway Amber)",
    shortLabel: "Industrial Charcoal",
    description:
      "Warm matte asphalt & graphite surfaces, hairline steel borders, condensed departure-board type, and highway-amber / signal-green indicators.",
    isLight: false,
    swatchBg: "#121311",
    swatchSurface: "#1B1C19",
    swatchAccent: "#E59A23",
    swatchText: "#F2F0EA",
  },
  {
    id: "daylight-paper",
    name: "Clean Daylight (Warm Stone & Carbon Ink)",
    shortLabel: "Clean Daylight",
    description:
      "Crisp warm-stone architectural paper, white data sheets, deep carbon ink, solid 1px rules, and daylight GPS cartography.",
    isLight: true,
    swatchBg: "#F3F1EB",
    swatchSurface: "#FFFFFF",
    swatchAccent: "#C26D12",
    swatchText: "#181816",
  },
  {
    id: "shop-floor-contrast",
    name: "Shop Floor High-Contrast (Pitch Black & Safety Yellow)",
    shortLabel: "Shop Floor Contrast",
    description:
      "Pure pitch-black background with stark borders and safety-yellow callouts engineered for 50+ foot warehouse bay visibility.",
    isLight: false,
    swatchBg: "#050505",
    swatchSurface: "#10100F",
    swatchAccent: "#FACC15",
    swatchText: "#FFFFFF",
  },
  {
    id: "midnight-rail",
    name: "Railroad Timetable (Mineral Slate & Brushed Brass)",
    shortLabel: "Railroad Brass",
    description:
      "Muted mineral control-room dark slate with warm brushed-brass headers and zero neon glow.",
    isLight: false,
    swatchBg: "#0F1417",
    swatchSurface: "#161D21",
    swatchAccent: "#D4A048",
    swatchText: "#ECEAE4",
  },
];

export function isValidDisplayTheme(val: unknown): val is DisplayThemeId {
  return (
    val === "industrial-dispatch" ||
    val === "daylight-paper" ||
    val === "shop-floor-contrast" ||
    val === "midnight-rail"
  );
}

export function resolveEffectiveDisplayTheme(
  settings: any,
  profileKey?: string,
  customScreenTheme?: string,
): DisplayThemeId {
  if (isValidDisplayTheme(customScreenTheme)) return customScreenTheme;
  const prof = profileKey ? settings?.displayProfiles?.[profileKey] : undefined;
  if (prof?.highContrast && !isValidDisplayTheme(prof?.theme)) {
    return "shop-floor-contrast";
  }
  if (isValidDisplayTheme(prof?.theme)) return prof.theme;
  if (isValidDisplayTheme(settings?.defaultTheme)) return settings.defaultTheme;
  return "industrial-dispatch";
}

/**
 * Adapts light-pastel schedule hex colors (originally chosen for dark boards)
 * so they remain crisp and legible when rendered on the Clean Daylight paper theme.
 */
export function adaptScheduleColorForTheme(
  hexColor: string | undefined,
  isLightTheme: boolean,
  fallbackDark = "#E59A23",
  fallbackLight = "#181816",
): string {
  const raw = (hexColor || "").trim();
  if (!raw.startsWith("#") || (raw.length !== 7 && raw.length !== 4)) {
    return isLightTheme ? fallbackLight : fallbackDark;
  }
  if (!isLightTheme) return raw;

  const full =
    raw.length === 4
      ? `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`
      : raw;
  const r = parseInt(full.slice(1, 3), 16);
  const g = parseInt(full.slice(3, 5), 16);
  const b = parseInt(full.slice(5, 7), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return fallbackLight;

  // Perceived luminance (0..255). If > 155 on a light background, darken proportionally
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  if (lum <= 145) return full;

  // Near-white / light neutral -> deep carbon ink
  if (Math.max(r, g, b) - Math.min(r, g, b) < 28) {
    return "#1F201D";
  }

  const factor = 0.46;
  const dr = Math.max(0, Math.min(255, Math.round(r * factor)));
  const dg = Math.max(0, Math.min(255, Math.round(g * factor)));
  const db = Math.max(0, Math.min(255, Math.round(b * factor)));
  return `#${dr.toString(16).padStart(2, "0")}${dg.toString(16).padStart(2, "0")}${db
    .toString(16)
    .padStart(2, "0")}`;
}

export interface CustomScreenDefinition {
  id: string;
  name: string;
  badgeLabel?: string;
  templateId?: string;
  durationSec?: number;
  /** Optional per-screen visual theme override ("inherit" or a DisplayThemeId) */
  theme?: DisplayThemeId | "inherit";
  widgets: ScreenWidgetInstance[];
  createdAt: string;
  updatedAt: string;
}

export interface PlaylistEntry {
  /** "screen-1" | "screen-2" | "screen-3" | "screen-4" or a CustomScreenDefinition.id */
  screenId: string;
  enabled: boolean;
  /** Optional per-screen duration override in seconds */
  durationSec?: number;
}

export interface NwsAlertItem {
  id: string;
  event: string;
  severity: "Extreme" | "Severe" | "Moderate" | "Minor" | "Unknown";
  headline: string;
  areaDesc: string;
  shortArea?: string;
  expires: string | null;
  instruction?: string;
  isCorridor: boolean;
  /** Simplified [lat, lon] polygon rings for clean shaded map warning zones */
  polygons?: Array<Array<[number, number]>>;
  /** Center [lat, lon] for placing a single compact callout badge per alert */
  centroid?: [number, number];
  /** True when injected by the Admin Severe Weather Demo Simulator */
  isDemo?: boolean;
}

export interface BuiltInScreenMeta {
  id: "screen-1" | "screen-2" | "screen-3" | "screen-4" | "screen-5";
  name: string;
  shortTab: string;
  description: string;
}

export const BUILTIN_SCREENS: BuiltInScreenMeta[] = [
  {
    id: "screen-1",
    name: "Screen 1 — Live Fleet Map & Truck Routes",
    shortTab: "Routes",
    description: "Live GPS corridor map alongside weekly truck route assignments and announcement card.",
  },
  {
    id: "screen-2",
    name: "Screen 2 — Multi-City Weather, Calendar & DOT",
    shortTab: "Weather & DOT",
    description: "Sioux Falls/Aberdeen/Huron 5-day weather, company milestones, and sorted DOT/License renewals.",
  },
  {
    id: "screen-3",
    name: "Screen 3 — Sioux Falls Team & Return ETAs",
    shortTab: "SF Team & ETA",
    description: "Regional Sioux Falls GPS + warehouse Return ETAs alongside the weekly SF staff schedule.",
  },
  {
    id: "screen-4",
    name: "Screen 4 — Bulletin, Deadlines & Events",
    shortTab: "Bulletin",
    description: "Dedicated large-format announcements with live countdowns, upcoming events, and 45-day renewals.",
  },
  {
    id: "screen-5",
    name: "Screen 5 — Hotshots",
    shortTab: "Hotshots",
    description: "Live Hot Shot GPS route map, town & account checklist with auto-green GPS completion, and generous return ETAs.",
  },
];

export function isBuiltInScreenId(val: unknown): val is BuiltInScreenMeta["id"] {
  return (
    val === "screen-1" ||
    val === "screen-2" ||
    val === "screen-3" ||
    val === "screen-4" ||
    val === "screen-5"
  );
}

export function createDefaultBuiltInScreenDefinition(
  builtInId: BuiltInScreenMeta["id"],
): CustomScreenDefinition {
  const meta = BUILTIN_SCREENS.find((b) => b.id === builtInId) || BUILTIN_SCREENS[0];
  const now = new Date().toISOString();

  if (builtInId === "screen-1") {
    return {
      id: "screen-1",
      name: meta.name,
      badgeLabel: meta.shortTab,
      templateId: "custom",
      widgets: [
        {
          id: "w-s1-truck-sched",
          type: "truck_schedule",
          x: 0,
          y: 0,
          w: 5,
          h: 4,
          config: { showGpsBadges: true },
        },
        {
          id: "w-s1-announcements",
          type: "announcements",
          x: 0,
          y: 4,
          w: 5,
          h: 2,
          config: { maxItems: 2 },
        },
        {
          id: "w-s1-live-map",
          type: "live_map",
          x: 5,
          y: 0,
          w: 7,
          h: 6,
          config: {
            preset: "corridor",
            showReturnEta: true,
            routeFilter: "today",
            routeStyle: "zones_and_sequence",
            routeColorMode: "route",
            selectedRouteIds: [],
          },
        },
      ],
      createdAt: now,
      updatedAt: now,
    };
  }

  if (builtInId === "screen-2") {
    return {
      id: "screen-2",
      name: meta.name,
      badgeLabel: meta.shortTab,
      templateId: "custom",
      widgets: [
        {
          id: "w-s2-truck-sched",
          type: "truck_schedule",
          x: 0,
          y: 0,
          w: 5,
          h: 6,
          config: { showGpsBadges: false },
        },
        {
          id: "w-s2-weather",
          type: "weather_multi",
          x: 5,
          y: 0,
          w: 7,
          h: 2,
          config: { cityFilter: "all" },
        },
        {
          id: "w-s2-renewals",
          type: "renewals",
          x: 5,
          y: 2,
          w: 4,
          h: 4,
          config: { onlyWithinDays: 0 },
        },
        {
          id: "w-s2-calendar",
          type: "calendar",
          x: 9,
          y: 2,
          w: 3,
          h: 4,
          config: { maxItems: 5 },
        },
      ],
      createdAt: now,
      updatedAt: now,
    };
  }

  if (builtInId === "screen-3") {
    return {
      id: "screen-3",
      name: meta.name,
      badgeLabel: meta.shortTab,
      templateId: "custom",
      widgets: [
        {
          id: "w-s3-sf-sched",
          type: "sf_schedule",
          x: 0,
          y: 0,
          w: 5,
          h: 6,
          config: { rowsPerPage: 7 },
        },
        {
          id: "w-s3-live-map",
          type: "live_map",
          x: 5,
          y: 0,
          w: 7,
          h: 6,
          config: {
            preset: "sioux-falls",
            showReturnEta: true,
            routeFilter: "today",
            routeStyle: "zones_and_sequence",
            routeColorMode: "route",
            selectedRouteIds: [],
          },
        },
      ],
      createdAt: now,
      updatedAt: now,
    };
  }

  if (builtInId === "screen-5") {
    return {
      id: "screen-5",
      name: meta.name,
      badgeLabel: meta.shortTab,
      templateId: "custom",
      widgets: [
        {
          id: "w-s5-hotshot-map",
          type: "live_map",
          titleOverride: "Hot Shot Live GPS Route Map",
          x: 0,
          y: 0,
          w: 7,
          h: 6,
          config: {
            preset: "corridor",
            autoFitHotShots: true,
            showReturnEta: true,
            routeFilter: "hotshots_today",
            routeStyle: "sequence_only",
            routeColorMode: "route",
            selectedRouteIds: [],
          },
        },
        {
          id: "w-s5-hotshot-board",
          type: "hotshot_board",
          titleOverride: "Hot Shot Towns & Accounts",
          x: 7,
          y: 0,
          w: 5,
          h: 6,
          config: {
            showCompletedBadge: true,
            showNotes: true,
          },
        },
      ],
      createdAt: now,
      updatedAt: now,
    };
  }

  return {
    id: "screen-4",
    name: meta.name,
    badgeLabel: meta.shortTab,
    templateId: "custom",
    widgets: [
      {
        id: "w-s4-announcements",
        type: "announcements",
        x: 0,
        y: 0,
        w: 6,
        h: 6,
        config: { maxItems: 4 },
      },
      {
        id: "w-s4-gallery",
        type: "photo_gallery",
        x: 6,
        y: 0,
        w: 6,
        h: 3,
        config: { albumId: "all", slideDurationSec: 8, showCaptions: true },
      },
      {
        id: "w-s4-calendar",
        type: "calendar",
        x: 6,
        y: 3,
        w: 3,
        h: 3,
        config: { maxItems: 5 },
      },
      {
        id: "w-s4-renewals",
        type: "renewals",
        x: 9,
        y: 3,
        w: 3,
        h: 3,
        config: { onlyWithinDays: 45 },
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
}

export interface WidgetCatalogEntry {
  type: ScreenWidgetType;
  label: string;
  category: "Operations & Fleet" | "Safety & Weather" | "Team & Communications" | "Media & Custom";
  description: string;
  defaultW: number;
  defaultH: number;
  defaultConfig: Record<string, any>;
}

export const WIDGET_CATALOG: WidgetCatalogEntry[] = [
  {
    type: "today_snapshot",
    label: "Today's Crew & Route Snapshot",
    category: "Operations & Fleet",
    description: "High-visibility single-day view of who's driving which truck routes today + today's SF openers/closers.",
    defaultW: 7,
    defaultH: 6,
    defaultConfig: {
      mode: "both", // "both" | "trucks" | "sf"
      showOffStaff: false,
    },
  },
  {
    type: "sf_daily_shift",
    label: "SF Daily Crew (2 PM Next-Day Open/Close)",
    category: "Operations & Fleet",
    description:
      "Shows today's Sioux Falls schedule until 2:00 PM, then automatically flips to the next workday with Opening & Closing crew highlighted.",
    defaultW: 6,
    defaultH: 6,
    defaultConfig: {
      rolloverTime: "14:00",
      layoutStyle: "spotlight_plus_mid", // "spotlight_plus_mid" | "full_highlighted_list"
      dayMode: "auto", // "auto" | "today" | "next_workday"
      showOffStaff: false,
    },
  },
  {
    type: "hotshot_board",
    label: "Hot Shot Towns, Accounts & Return ETA",
    category: "Operations & Fleet",
    description: "Live checklist of today's Hot Shot dispatches, towns & customer accounts (turning green via GPS), and generous completion/return ETAs.",
    defaultW: 5,
    defaultH: 6,
    defaultConfig: {
      showCompletedBadge: true,
      showNotes: true,
    },
  },
  {
    type: "nws_alerts",
    label: "SD Corridor NWS Weather & Wind Alerts",
    category: "Safety & Weather",
    description: "Live National Weather Service wind, winter storm, fog, and severe alerts along I-29 & I-90.",
    defaultW: 5,
    defaultH: 3,
    defaultConfig: {
      corridorOnly: false,
      showForecastWhenClear: true,
    },
  },
  {
    type: "safety_streak",
    label: "Safety Streak (Days Incident-Free)",
    category: "Safety & Weather",
    description: "Auto-incrementing 'Days Without Incident' counter with all-time company record badge.",
    defaultW: 5,
    defaultH: 3,
    defaultConfig: {
      title: "DAYS INCIDENT-FREE",
      startDateISO: "2026-06-15",
      bestStreakDays: 184,
      subtitle: "Zero preventable road or warehouse incidents — thank you for working safely!",
      accentColor: "#10b981",
    },
  },
  {
    type: "big_countdown",
    label: "Big Event Countdown Clock",
    category: "Team & Communications",
    description: "Large standalone countdown timer (days, hours, minutes) for company parties, audits, or holidays.",
    defaultW: 6,
    defaultH: 3,
    defaultConfig: {
      title: "COMPANY CHRISTMAS PARTY",
      targetDateISO: "2026-12-04",
      targetTime: "18:00",
      subtitle: "Book rooms before Nov 25th • 605-692-2882",
      accentColor: "#f59e0b",
    },
  },
  {
    type: "media_qr",
    label: "Flyer / Image Slide & QR Code",
    category: "Media & Custom",
    description: "Display an uploaded flyer/photo, a scannable vector QR code for phones, or both side-by-side.",
    defaultW: 6,
    defaultH: 6,
    defaultConfig: {
      mode: "image_with_qr", // "image" | "qr" | "image_with_qr"
      title: "Scan for Details",
      subtitle: "Point your phone camera at the QR code",
      imageUrl: "",
      imageFit: "contain", // "contain" | "cover"
      qrUrl: "https://gomotive.com",
      qrLabel: "Open Link on Phone",
      accentColor: "#E59A23",
    },
  },
  {
    type: "photo_gallery",
    label: "Team & Family Photo Gallery",
    category: "Media & Custom",
    description: "Rotating slideshow or 4-up collage of uploaded work events, celebrations, and employee family photos.",
    defaultW: 7,
    defaultH: 6,
    defaultConfig: {
      title: "TEAM & FAMILY GALLERY",
      albumId: "all", // "all" | "work-events" | "family-team" | "fleet-field" | custom album id
      displayMode: "slideshow", // "slideshow" | "collage"
      slideDurationSec: 8,
      showCaptions: true,
      accentColor: "#E59A23",
    },
  },
  {
    type: "custom_info",
    label: "Custom Priorities / KPI Note Board",
    category: "Media & Custom",
    description: "Add custom headlines, bulleted dock instructions, daily goals, or shop reminders.",
    defaultW: 6,
    defaultH: 3,
    defaultConfig: {
      title: "DAILY DOCK & DISPATCH PRIORITIES",
      body: "• Pre-trip inspections & tire pressure checks before rollout\n• Confirm all Huron & Aberdeen pallets staged in Bay 2\n• Lock dock doors & plug in block heaters below 25°F",
      accentColor: "#E59A23",
      textSize: "normal", // "normal" | "large" | "hero"
    },
  },
  {
    type: "live_map",
    label: "Live GPS Fleet Map",
    category: "Operations & Fleet",
    description: "Real-time truck & trailer map with colored route highlighting, custom area framing, and Return ETAs.",
    defaultW: 6,
    defaultH: 6,
    defaultConfig: {
      preset: "corridor", // "corridor" | "sioux-falls" | "auto-fit" | "custom" | saved region id
      showReturnEta: true,
      routeFilter: "today", // "today" | "all" | "truck_1".."truck_5" | "custom" | "off"
      routeStyle: "zones_and_sequence", // "zones_and_sequence" | "zones_only" | "sequence_only"
      routeColorMode: "route", // "route" | "driver"
      selectedRouteIds: [],
    },
  },
  {
    type: "truck_schedule",
    label: "Weekly Truck Route Schedule",
    category: "Operations & Fleet",
    description: "Full Mon–Fri driver route table with live moving MPH badges.",
    defaultW: 6,
    defaultH: 6,
    defaultConfig: {
      showGpsBadges: true,
    },
  },
  {
    type: "sf_schedule",
    label: "Sioux Falls Weekly Team Schedule",
    category: "Operations & Fleet",
    description: "Sioux Falls Mon–Sun shift matrix with auto-paging for large teams.",
    defaultW: 6,
    defaultH: 6,
    defaultConfig: {
      rowsPerPage: 7,
    },
  },
  {
    type: "announcements",
    label: "Team Announcements & Deadlines",
    category: "Team & Communications",
    description: "Active CRM & Admin announcements sorted by urgency with live countdown badges.",
    defaultW: 6,
    defaultH: 4,
    defaultConfig: {
      maxItems: 3,
    },
  },
  {
    type: "calendar",
    label: "Upcoming Milestones & Anniversaries",
    category: "Team & Communications",
    description: "Upcoming work anniversaries, holidays, and Outlook .ics calendar events.",
    defaultW: 6,
    defaultH: 3,
    defaultConfig: {
      maxItems: 5,
    },
  },
  {
    type: "renewals",
    label: "DOT, License & Med Card Renewals",
    category: "Safety & Weather",
    description: "Compliance renewals sorted soonest-first (show all drivers or filter to upcoming due dates).",
    defaultW: 6,
    defaultH: 4,
    defaultConfig: {
      onlyWithinDays: 0, // 0 = show all; >0 = filter to due within N days
    },
  },
  {
    type: "weather_multi",
    label: "3-City Corridor Weather Forecast",
    category: "Safety & Weather",
    description: "Current temps, wind, and 5-day forecast for Sioux Falls, Aberdeen, and Huron.",
    defaultW: 6,
    defaultH: 3,
    defaultConfig: {
      cityFilter: "all", // "all" | "Sioux Falls" | "Aberdeen" | "Huron"
    },
  },
];

export interface LayoutTemplateSlot {
  x: number;
  y: number;
  w: number;
  h: number;
  suggestedWidget: ScreenWidgetType;
}

export interface LayoutTemplatePreset {
  id: string;
  name: string;
  description: string;
  slots: LayoutTemplateSlot[];
}

export const LAYOUT_TEMPLATES: LayoutTemplatePreset[] = [
  {
    id: "hero-split",
    name: "Hero Left + 2 Stacked Right",
    description: "Large main board on the left (7 cols) with two stacked cards on the right (5 cols).",
    slots: [
      { x: 0, y: 0, w: 7, h: 6, suggestedWidget: "today_snapshot" },
      { x: 7, y: 0, w: 5, h: 3, suggestedWidget: "nws_alerts" },
      { x: 7, y: 3, w: 5, h: 3, suggestedWidget: "safety_streak" },
    ],
  },
  {
    id: "two-column",
    name: "50 / 50 Two-Column Split",
    description: "Two equal full-height panels side-by-side.",
    slots: [
      { x: 0, y: 0, w: 6, h: 6, suggestedWidget: "live_map" },
      { x: 6, y: 0, w: 6, h: 6, suggestedWidget: "today_snapshot" },
    ],
  },
  {
    id: "quad-2x2",
    name: "2 × 2 Quad Grid",
    description: "Four equal quadrants for balanced operations, weather, safety, and announcements.",
    slots: [
      { x: 0, y: 0, w: 6, h: 3, suggestedWidget: "today_snapshot" },
      { x: 6, y: 0, w: 6, h: 3, suggestedWidget: "nws_alerts" },
      { x: 0, y: 3, w: 6, h: 3, suggestedWidget: "announcements" },
      { x: 6, y: 3, w: 6, h: 3, suggestedWidget: "safety_streak" },
    ],
  },
  {
    id: "three-column",
    name: "3-Column Command Board",
    description: "Three vertical columns (4 cols each) across the screen.",
    slots: [
      { x: 0, y: 0, w: 4, h: 6, suggestedWidget: "today_snapshot" },
      { x: 4, y: 0, w: 4, h: 6, suggestedWidget: "announcements" },
      { x: 8, y: 0, w: 4, h: 6, suggestedWidget: "media_qr" },
    ],
  },
  {
    id: "banner-two-col",
    name: "Top Banner + 2 Columns",
    description: "Full-width top banner (2 rows) over two side-by-side panels (4 rows).",
    slots: [
      { x: 0, y: 0, w: 12, h: 2, suggestedWidget: "nws_alerts" },
      { x: 0, y: 2, w: 6, h: 4, suggestedWidget: "today_snapshot" },
      { x: 6, y: 2, w: 6, h: 4, suggestedWidget: "custom_info" },
    ],
  },
  {
    id: "fullscreen",
    name: "Fullscreen Spotlight",
    description: "Single full-bleed 16:9 widget (ideal for Event Flyers, Safety Milestones, or Full Maps).",
    slots: [{ x: 0, y: 0, w: 12, h: 6, suggestedWidget: "media_qr" }],
  },
];

export function getCatalogEntry(type: ScreenWidgetType): WidgetCatalogEntry {
  return WIDGET_CATALOG.find((w) => w.type === type) || WIDGET_CATALOG[0];
}

export function clampWidgetBox(box: { x: number; y: number; w: number; h: number }) {
  const w = Math.max(2, Math.min(12, Math.round(box.w || 6)));
  const h = Math.max(1, Math.min(6, Math.round(box.h || 3)));
  const x = Math.max(0, Math.min(12 - w, Math.round(box.x || 0)));
  const y = Math.max(0, Math.min(6 - h, Math.round(box.y || 0)));
  return { x, y, w, h };
}

export const DEFAULT_CUSTOM_SCREENS: CustomScreenDefinition[] = [];

export const DEFAULT_COMPANY_PLAYLIST: PlaylistEntry[] = [
  { screenId: "screen-1", enabled: true },
  { screenId: "screen-2", enabled: true },
  { screenId: "screen-3", enabled: true },
  { screenId: "screen-4", enabled: true },
  { screenId: "screen-5", enabled: true },
];

export interface BlueprintScreenPreset {
  id: string;
  name: string;
  badgeLabel: string;
  description: string;
  templateId: string;
  widgets: Omit<ScreenWidgetInstance, "id">[];
}

export const SCREEN_BLUEPRINTS: BlueprintScreenPreset[] = [
  {
    id: "bp-sf-daily-rollover",
    name: "SF Daily Crew (2 PM Next-Day) & Metro ETA",
    badgeLabel: "SF Next-Day",
    description:
      "Sioux Falls Metro GPS + Return ETAs on the left, paired with today's SF crew until 2:00 PM and tomorrow's highlighted Openers & Closers after 2:00 PM.",
    templateId: "two-column",
    widgets: [
      {
        type: "live_map",
        x: 0,
        y: 0,
        w: 6,
        h: 6,
        config: {
          preset: "sioux-falls",
          showReturnEta: true,
          routeFilter: "today",
          routeStyle: "zones_and_sequence",
          routeColorMode: "route",
          selectedRouteIds: [],
        },
      },
      {
        type: "sf_daily_shift",
        x: 6,
        y: 0,
        w: 6,
        h: 6,
        config: {
          rolloverTime: "14:00",
          layoutStyle: "spotlight_plus_mid",
          dayMode: "auto",
          showOffStaff: false,
        },
      },
    ],
  },
  {
    id: "bp-photo-wall",
    name: "Team & Family Photo Wall",
    badgeLabel: "Team Gallery",
    description: "Showcase work events & employee family photos alongside upcoming birthdays/anniversaries and announcements.",
    templateId: "hero-split",
    widgets: [
      {
        type: "photo_gallery",
        x: 0,
        y: 0,
        w: 8,
        h: 6,
        config: {
          title: "TEAM & FAMILY GALLERY",
          albumId: "all",
          displayMode: "slideshow",
          slideDurationSec: 8,
          showCaptions: true,
          accentColor: "#E59A23",
        },
      },
      { type: "calendar", x: 8, y: 0, w: 4, h: 3, config: { maxItems: 4 } },
      { type: "announcements", x: 8, y: 3, w: 4, h: 3, config: { maxItems: 2 } },
    ],
  },
  {
    id: "bp-morning-ops",
    name: "Morning Ops & SD Road Alerts",
    badgeLabel: "Ops & Safety",
    description: "Today's active truck routes & SF crew + live South Dakota NWS weather alerts + Safety Streak.",
    templateId: "hero-split",
    widgets: [
      { type: "today_snapshot", x: 0, y: 0, w: 7, h: 6, config: { mode: "both", showOffStaff: false } },
      { type: "nws_alerts", x: 7, y: 0, w: 5, h: 3, config: { corridorOnly: false, showForecastWhenClear: true } },
      {
        type: "safety_streak",
        x: 7,
        y: 3,
        w: 5,
        h: 3,
        config: {
          title: "DAYS INCIDENT-FREE",
          startDateISO: "2026-06-15",
          bestStreakDays: 184,
          subtitle: "Zero preventable road or warehouse incidents!",
          accentColor: "#10b981",
        },
      },
    ],
  },
  {
    id: "bp-warehouse-dock",
    name: "Warehouse Dock & Priorities",
    badgeLabel: "Warehouse Hub",
    description: "Today's truck routes on the left with Daily Dock Priorities & NWS Wind/Winter Alerts on the right.",
    templateId: "hero-split",
    widgets: [
      { type: "today_snapshot", x: 0, y: 0, w: 7, h: 6, config: { mode: "trucks", showOffStaff: false } },
      {
        type: "custom_info",
        x: 7,
        y: 0,
        w: 5,
        h: 3,
        config: {
          title: "DAILY DOCK & BAY PRIORITIES",
          body: "• Stage Huron & Aberdeen routes in Bay 2 before 6:30 AM\n• Chock wheels & verify dock lock green light before forklift entry\n• Plug in block heaters when overnight lows drop below 25°F",
          accentColor: "#f59e0b",
          textSize: "normal",
        },
      },
      { type: "nws_alerts", x: 7, y: 3, w: 5, h: 3, config: { corridorOnly: false, showForecastWhenClear: true } },
    ],
  },
  {
    id: "bp-event-flyer",
    name: "Event Flyer, QR & Countdown",
    badgeLabel: "Event Spotlight",
    description: "Showcase an uploaded flyer + scannable phone QR code alongside a Big Event Countdown and Announcements.",
    templateId: "hero-split",
    widgets: [
      {
        type: "media_qr",
        x: 0,
        y: 0,
        w: 7,
        h: 6,
        config: {
          mode: "image_with_qr",
          title: "Company Event & RSVP",
          subtitle: "Scan with your phone camera to RSVP or view details",
          imageUrl: "",
          imageFit: "contain",
          qrUrl: "https://srv1205734.hstgr.cloud",
          qrLabel: "Scan to Open",
          accentColor: "#E59A23",
        },
      },
      {
        type: "big_countdown",
        x: 7,
        y: 0,
        w: 5,
        h: 3,
        config: {
          title: "CHRISTMAS PARTY",
          targetDateISO: "2026-12-04",
          targetTime: "18:00",
          subtitle: "Book rooms before Nov 25th • 605-692-2882",
          accentColor: "#f59e0b",
        },
      },
      { type: "announcements", x: 7, y: 3, w: 5, h: 3, config: { maxItems: 2 } },
    ],
  },
];

/**
 * Ensures playlist entries cover all known built-in & custom screens (preserving user order and enabled flags).
 */
export function normalizePlaylistEntries(
  rawPlaylist: PlaylistEntry[] | undefined,
  customScreens: CustomScreenDefinition[],
  defaultEnableNewCustom = true,
): PlaylistEntry[] {
  const validScreenIds = new Set<string>([
    ...BUILTIN_SCREENS.map((b) => b.id),
    ...customScreens.map((c) => c.id),
  ]);

  const hasExplicitEntries = Array.isArray(rawPlaylist) && rawPlaylist.length > 0;
  const seen = new Set<string>();
  const out: PlaylistEntry[] = [];

  for (const item of rawPlaylist || []) {
    if (!item || !item.screenId || !validScreenIds.has(item.screenId) || seen.has(item.screenId)) {
      continue;
    }
    seen.add(item.screenId);
    out.push({
      screenId: item.screenId,
      enabled: Boolean(item.enabled),
      ...(item.durationSec && item.durationSec >= 5 ? { durationSec: Math.round(item.durationSec) } : {}),
    });
  }

  for (const b of BUILTIN_SCREENS) {
    if (!seen.has(b.id)) {
      seen.add(b.id);
      out.push({
        screenId: b.id,
        enabled: b.id === "screen-5" ? true : hasExplicitEntries ? defaultEnableNewCustom : true,
      });
    }
  }

  for (const c of customScreens) {
    if (!seen.has(c.id)) {
      seen.add(c.id);
      out.push({
        screenId: c.id,
        enabled: defaultEnableNewCustom,
        ...(c.durationSec && c.durationSec >= 5 ? { durationSec: c.durationSec } : {}),
      });
    }
  }

  return out;
}

export interface ResolvedScreenSlide {
  screenId: string;
  isCustom: boolean;
  tabLabel: string;
  fullTitle: string;
  durationSec: number;
  customScreen?: CustomScreenDefinition;
}

/**
 * Resolves the active ordered rotation slides for a given TV Display unit:
 * 1. Unit custom playlist override (if playlistMode === "custom" and >=1 enabled slide)
 * 2. Assigned Display Group playlist (if group has >=1 enabled slide)
 * 3. Default Company Playlist
 */
export function resolveEffectivePlaylist(
  settings: any,
  customScreens: CustomScreenDefinition[] | undefined,
  profileKey: string,
): ResolvedScreenSlide[] {
  const screens = Array.isArray(customScreens) ? customScreens : [];
  const customById = new Map(screens.map((s) => [s.id, s]));
  const builtInById = new Map(BUILTIN_SCREENS.map((b) => [b.id, b]));

  const prof = settings?.displayProfiles?.[profileKey];
  const baseDuration = Number(prof?.rotationIntervalSec || settings?.rotationIntervalSec || 22);
  const group = (settings?.displayGroups || []).find((g: any) => g.id === prof?.groupId);

  let chosenRaw: PlaylistEntry[] | undefined;
  let isScopedOverride = false;
  if (prof?.playlistMode === "custom" && Array.isArray(prof.playlist) && prof.playlist.some((p: any) => p.enabled)) {
    chosenRaw = prof.playlist;
    isScopedOverride = true;
  } else if (group && Array.isArray(group.playlist) && group.playlist.some((p: any) => p.enabled)) {
    chosenRaw = group.playlist;
    isScopedOverride = true;
  } else {
    chosenRaw = settings?.defaultPlaylist || DEFAULT_COMPANY_PLAYLIST;
  }

  const normalized = normalizePlaylistEntries(chosenRaw, screens, !isScopedOverride);
  const enabledEntries = normalized.filter((e) => e.enabled);
  const finalEntries = enabledEntries.length > 0 ? enabledEntries : [{ screenId: "screen-1", enabled: true }];

  return finalEntries
    .map((entry, idx): ResolvedScreenSlide | null => {
      // Check customized screens FIRST so edited Built-In Screens (screen-1..screen-4) render in place!
      const custom = customById.get(entry.screenId);
      if (custom) {
        return {
          screenId: custom.id,
          isCustom: true,
          tabLabel: `${idx + 1} • ${custom.badgeLabel || custom.name}`,
          fullTitle: custom.name,
          durationSec: entry.durationSec || custom.durationSec || baseDuration,
          customScreen: custom,
        };
      }
      const builtIn = builtInById.get(entry.screenId as any);
      if (builtIn) {
        return {
          screenId: builtIn.id,
          isCustom: false,
          tabLabel: `${idx + 1} • ${builtIn.shortTab}`,
          fullTitle: builtIn.name,
          durationSec: entry.durationSec || baseDuration,
        };
      }
      return null;
    })
    .filter((s): s is ResolvedScreenSlide => s !== null);
}
