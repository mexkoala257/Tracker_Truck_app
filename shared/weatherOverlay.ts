import type { NwsAlertItem } from "./customScreens";

export type WeatherOverlayMode =
  | "warnings_only"
  | "warnings_and_watches"
  | "all_alerts"
  | "off";

export type WeatherDemoScenarioId =
  | "none"
  | "aberdeen_blizzard"
  | "i29_severe_tstorm"
  | "multi_zone_winter";

export interface WeatherOverlayModeMeta {
  id: WeatherOverlayMode;
  label: string;
  shortLabel: string;
  description: string;
}

export const WEATHER_OVERLAY_MODES: WeatherOverlayModeMeta[] = [
  {
    id: "warnings_only",
    label: "Warnings Only (Default — Recommended)",
    shortLabel: "Warnings Only",
    description:
      "Highlights active Blizzard, Winter Storm, Ice Storm, Tornado, Severe T-Storm, High Wind & Flash Flood Warnings only. Keeps maps clean.",
  },
  {
    id: "warnings_and_watches",
    label: "Warnings + Watches",
    shortLabel: "Warnings + Watches",
    description:
      "Shows active Warnings plus regional Severe Weather / Winter Storm / Blizzard Watches.",
  },
  {
    id: "all_alerts",
    label: "All NWS Alerts (Includes Advisories)",
    shortLabel: "All Alerts",
    description:
      "Shows Warnings, Watches, and minor Advisories (Winter Weather Advisory, Wind Advisory, Dense Fog).",
  },
  {
    id: "off",
    label: "Off (Hide Map Weather Zones)",
    shortLabel: "Off",
    description: "Disables shaded weather alert zones on live maps.",
  },
];

export interface WeatherDemoScenarioMeta {
  id: WeatherDemoScenarioId;
  label: string;
  shortBadge: string;
  description: string;
  alerts: NwsAlertItem[];
}

/**
 * Realistic multi-county & storm-corridor demo alerts for testing & live showcases.
 * Coordinates are [lat, lon] matching Leaflet Polygon format.
 */
export const WEATHER_DEMO_SCENARIOS: WeatherDemoScenarioMeta[] = [
  {
    id: "none",
    label: "Live NWS Feed Only (Demo Off)",
    shortBadge: "Live NWS",
    description: "Displays only real-time National Weather Service alerts currently in effect.",
    alerts: [],
  },
  {
    id: "aberdeen_blizzard",
    label: "❄️ Demo: Northern SD / Aberdeen Blizzard Warning",
    shortBadge: "Aberdeen Blizzard Demo",
    description:
      "Simulates an active NWS Blizzard Warning zone across Brown, Spink, Edmunds, Day & Marshall Counties (Aberdeen, Groton, Redfield, Ipswich, Webster, Britton).",
    alerts: [
      {
        id: "demo-nws-aberdeen-blizzard",
        event: "Blizzard Warning",
        severity: "Extreme",
        headline:
          "DEMO • Blizzard Warning in effect — whiteout visibility (<1/4 mi) and 55 mph gusts across Aberdeen, US-12 & US-281",
        areaDesc: "Brown, SD; Spink, SD; Edmunds, SD; Day, SD; Marshall, SD",
        shortArea: "Aberdeen • Brown, Spink & Day Co.",
        expires: null,
        instruction:
          "Travel should be restricted to emergencies only along US-12, US-281, and SD-37.",
        isCorridor: true,
        isDemo: true,
        centroid: [45.43, -98.35],
        polygons: [
          [
            // Stepped county-style perimeter covering Brown, Edmunds, Spink, Day & Marshall Counties
            [45.94, -99.22], // NW corner (Edmunds/McPherson line along ND border)
            [45.94, -97.35], // NE corner (Marshall Co along ND border)
            [45.55, -97.35], // East Day Co
            [45.16, -97.35], // SE Day Co (east of Webster/Waubay)
            [45.16, -98.08], // Day/Clark step
            [44.77, -98.08], // SE Spink Co (south of Doland/Redfield)
            [44.77, -98.92], // SW Spink Co
            [45.24, -98.92], // Spink/Edmunds step
            [45.24, -99.22], // SW Edmunds Co (west of Ipswich)
            [45.94, -99.22],
          ],
        ],
      },
    ],
  },
  {
    id: "i29_severe_tstorm",
    label: "⛈️ Demo: I-29 Corridor Severe Thunderstorm Warning",
    shortBadge: "I-29 Storm Demo",
    description:
      "Simulates a storm-based Severe Thunderstorm Warning polygon across Brookings, Arlington & Watertown along I-29 / US-14.",
    alerts: [
      {
        id: "demo-nws-i29-tstorm",
        event: "Severe Thunderstorm Warning",
        severity: "Severe",
        headline:
          "DEMO • Severe Thunderstorm Warning — 65 mph winds & quarter-size hail moving east across US-14 & I-29",
        areaDesc: "Brookings, SD; Hamlin, SD; Codington, SD; Kingsbury, SD",
        shortArea: "Brookings • Arlington • Watertown",
        expires: null,
        instruction: "Expect sudden crosswinds on I-29 between Brookings and Watertown.",
        isCorridor: true,
        isDemo: true,
        centroid: [44.58, -97.02],
        polygons: [
          [
            [44.98, -97.42],
            [45.03, -96.62],
            [44.28, -96.55],
            [44.22, -97.38],
            [44.98, -97.42],
          ],
        ],
      },
    ],
  },
  {
    id: "multi_zone_winter",
    label: "🧊 Demo: Aberdeen Blizzard + Southern Corridor Ice Storm (+ Advisory)",
    shortBadge: "Multi-Zone Winter Demo",
    description:
      "Simulates Aberdeen Blizzard Warning + SE SD / SW MN / NW IA Ice Storm Warning + Central SD Advisory (ideal for testing Alert Filter modes).",
    alerts: [
      {
        id: "demo-nws-multi-aberdeen-blizzard",
        event: "Blizzard Warning",
        severity: "Extreme",
        headline:
          "DEMO • Blizzard Warning — whiteout conditions & 55 mph gusts across Aberdeen & Northern SD",
        areaDesc: "Brown, SD; Spink, SD; Edmunds, SD; Day, SD; Marshall, SD",
        shortArea: "Aberdeen • Brown, Spink & Day Co.",
        expires: null,
        isCorridor: true,
        isDemo: true,
        centroid: [45.43, -98.35],
        polygons: [
          [
            [45.94, -99.22],
            [45.94, -97.35],
            [45.16, -97.35],
            [45.16, -98.08],
            [44.77, -98.08],
            [44.77, -98.92],
            [45.24, -98.92],
            [45.24, -99.22],
            [45.94, -99.22],
          ],
        ],
      },
      {
        id: "demo-nws-multi-se-icestorm",
        event: "Ice Storm Warning",
        severity: "Severe",
        headline:
          "DEMO • Ice Storm Warning — 0.25\" to 0.40\" ice accumulation along I-90, US-75 & IA-9",
        areaDesc: "Lincoln, SD; Rock, MN; Nobles, MN; Lyon, IA; Sioux, IA",
        shortArea: "Canton • Luverne • Rock Rapids",
        expires: null,
        isCorridor: true,
        isDemo: true,
        centroid: [43.36, -96.18],
        polygons: [
          [
            [43.68, -96.82],
            [43.76, -95.45],
            [43.02, -95.45],
            [43.02, -96.65],
            [43.68, -96.82],
          ],
        ],
      },
      {
        id: "demo-nws-multi-huron-advisory",
        event: "Winter Weather Advisory",
        severity: "Moderate",
        headline:
          "DEMO • Winter Weather Advisory — slippery stretches & blowing snow around Huron & US-14",
        areaDesc: "Beadle, SD; Hand, SD; Kingsbury, SD",
        shortArea: "Huron • Miller • De Smet",
        expires: null,
        isCorridor: true,
        isDemo: true,
        centroid: [44.42, -98.28],
        polygons: [
          [
            [44.76, -99.15],
            [44.76, -97.45],
            [44.12, -97.45],
            [44.12, -99.15],
            [44.76, -99.15],
          ],
        ],
      },
    ],
  },
];

export function normalizeWeatherOverlayMode(
  raw: unknown,
  fallback: WeatherOverlayMode = "warnings_only",
): WeatherOverlayMode {
  if (
    raw === "warnings_only" ||
    raw === "warnings_and_watches" ||
    raw === "all_alerts" ||
    raw === "off"
  ) {
    return raw;
  }
  return fallback;
}

export function normalizeWeatherDemoScenario(raw: unknown): WeatherDemoScenarioId {
  if (
    raw === "none" ||
    raw === "aberdeen_blizzard" ||
    raw === "i29_severe_tstorm" ||
    raw === "multi_zone_winter"
  ) {
    return raw;
  }
  return "none";
}

export function getWeatherDemoScenarioMeta(
  scenarioId: unknown,
): WeatherDemoScenarioMeta {
  const norm = normalizeWeatherDemoScenario(scenarioId);
  return (
    WEATHER_DEMO_SCENARIOS.find((s) => s.id === norm) || WEATHER_DEMO_SCENARIOS[0]
  );
}

/**
 * Classifies an NWS event title into tier: "warning" | "watch" | "advisory".
 */
export function classifyWeatherAlertTier(
  alert: Pick<NwsAlertItem, "event" | "severity">,
): "warning" | "watch" | "advisory" {
  const ev = String(alert.event || "").toLowerCase();
  if (
    ev.includes("warning") ||
    ev.includes("emergency") ||
    ev.includes("squall") ||
    alert.severity === "Extreme"
  ) {
    return "warning";
  }
  if (ev.includes("watch")) {
    return "watch";
  }
  return "advisory";
}

/**
 * Merges active live NWS alerts with any active demo scenario alerts.
 */
export function resolveEffectiveNwsAlerts(
  liveAlerts: NwsAlertItem[] | undefined | null,
  demoScenarioRaw?: unknown,
): NwsAlertItem[] {
  const live = Array.isArray(liveAlerts) ? liveAlerts : [];
  const scenario = getWeatherDemoScenarioMeta(demoScenarioRaw);
  if (scenario.id === "none" || scenario.alerts.length === 0) {
    return live;
  }
  return [...scenario.alerts, ...live];
}

/**
 * Filters alerts for clean map zone rendering according to the selected customization mode.
 * Caps to at most 4 highest-priority alerts so the map never gets visually overloaded.
 */
export function filterWeatherAlertsForMap(
  alerts: NwsAlertItem[] | undefined | null,
  modeRaw?: unknown,
  nowMs: number = Date.now(),
): NwsAlertItem[] {
  const mode = normalizeWeatherOverlayMode(modeRaw, "warnings_only");
  if (mode === "off" || !Array.isArray(alerts) || alerts.length === 0) {
    return [];
  }

  const tierRank: Record<"warning" | "watch" | "advisory", number> = {
    warning: 0,
    watch: 1,
    advisory: 2,
  };
  const sevRank: Record<string, number> = {
    Extreme: 0,
    Severe: 1,
    Moderate: 2,
    Minor: 3,
    Unknown: 4,
  };

  return alerts
    .filter((a) => {
      if (!a || !Array.isArray(a.polygons) || a.polygons.length === 0) return false;
      const hasValidRing = a.polygons.some((ring) => Array.isArray(ring) && ring.length >= 3);
      if (!hasValidRing) return false;

      if (a.expires) {
        const expMs = Date.parse(a.expires);
        if (Number.isFinite(expMs) && expMs < nowMs) return false;
      }

      const tier = classifyWeatherAlertTier(a);
      if (mode === "warnings_only") return tier === "warning";
      if (mode === "warnings_and_watches") return tier === "warning" || tier === "watch";
      return true;
    })
    .sort((a, b) => {
      if (Boolean(a.isDemo) !== Boolean(b.isDemo)) return a.isDemo ? -1 : 1;
      const tDiff = tierRank[classifyWeatherAlertTier(a)] - tierRank[classifyWeatherAlertTier(b)];
      if (tDiff !== 0) return tDiff;
      return (sevRank[a.severity] ?? 4) - (sevRank[b.severity] ?? 4);
    })
    .slice(0, 4);
}

export interface WeatherAlertMapVisualStyle {
  strokeColor: string;
  fillColor: string;
  fillOpacity: number;
  weight: number;
  dashArray?: string;
  icon: string;
  badgeTitle: string;
  badgeSublabel: string;
}

/**
 * Produces a clean, high-contrast warning zone style that never clashes with delivery route lines.
 */
export function getWeatherAlertMapStyle(
  alert: NwsAlertItem,
  darkMode: boolean,
): WeatherAlertMapVisualStyle {
  const evLower = String(alert.event || "").toLowerCase();
  const tier = classifyWeatherAlertTier(alert);

  let icon = "⚠️";
  if (evLower.includes("blizzard") || evLower.includes("snow") || evLower.includes("winter")) {
    icon = "❄️";
  } else if (evLower.includes("ice") || evLower.includes("freezing")) {
    icon = "🧊";
  } else if (evLower.includes("tornado")) {
    icon = "🌪️";
  } else if (evLower.includes("thunderstorm") || evLower.includes("lightning")) {
    icon = "⛈️";
  } else if (evLower.includes("wind") || evLower.includes("dust")) {
    icon = "💨";
  } else if (evLower.includes("flood")) {
    icon = "🌊";
  } else if (evLower.includes("cold") || evLower.includes("chill")) {
    icon = "🥶";
  } else if (evLower.includes("fog")) {
    icon = "🌫️";
  }

  // Distinct warning/watch/advisory colors so warning zones stand out cleanly from blue/green/amber route corridors
  let strokeColor = "#ef4444"; // Warning crimson red
  let fillColor = "#ef4444";
  let fillOpacity = darkMode ? 0.16 : 0.14;
  let weight = 2.25;
  let dashArray: string | undefined = "8, 5";

  if (tier === "warning") {
    if (evLower.includes("ice")) {
      strokeColor = "#ec4899"; // High-vis magenta-rose for Ice Storm Warning
      fillColor = "#ec4899";
      fillOpacity = darkMode ? 0.16 : 0.14;
    } else if (evLower.includes("thunderstorm") || evLower.includes("wind")) {
      strokeColor = "#f97316"; // Vivid orange-red for Severe T-Storm / High Wind Warning
      fillColor = "#f97316";
      fillOpacity = darkMode ? 0.15 : 0.13;
    } else {
      // Blizzard, Winter Storm, Tornado, Flash Flood, Extreme Cold -> Warning Crimson
      strokeColor = "#ef4444";
      fillColor = "#ef4444";
      fillOpacity = darkMode ? 0.16 : 0.14;
    }
  } else if (tier === "watch") {
    strokeColor = "#eab308"; // Watch amber-gold
    fillColor = "#eab308";
    fillOpacity = darkMode ? 0.11 : 0.1;
    weight = 1.8;
    dashArray = "6, 6";
  } else {
    strokeColor = "#a855f7"; // Advisory violet
    fillColor = "#a855f7";
    fillOpacity = darkMode ? 0.09 : 0.08;
    weight = 1.5;
    dashArray = "4, 6";
  }

  const badgeTitle = String(alert.event || "Weather Alert").toUpperCase();
  const badgeSublabel = summarizeAlertArea(alert.shortArea || alert.areaDesc);

  return {
    strokeColor,
    fillColor,
    fillOpacity,
    weight,
    dashArray,
    icon,
    badgeTitle,
    badgeSublabel,
  };
}

/**
 * Condenses verbose NWS county strings ("Brown, SD; Spink, SD; Edmunds, SD; Day, SD")
 * into a clean 1-line label ("Brown, Spink +2 Co.") so map badges stay compact.
 */
export function summarizeAlertArea(areaDesc: string): string {
  const raw = String(areaDesc || "").trim();
  if (!raw) return "";
  if (raw.length <= 34) return raw;

  const parts = raw
    .split(/[;]+/)
    .map((p) => p.replace(/,\s*[A-Z]{2}\b/g, "").replace(/\bCounty\b/gi, "").trim())
    .filter(Boolean);

  if (parts.length === 0) return raw.slice(0, 32);
  if (parts.length === 1) return parts[0].slice(0, 32);
  if (parts.length === 2) return `${parts[0]} & ${parts[1]} Co.`;
  return `${parts[0]}, ${parts[1]} +${parts.length - 2} Co.`;
}
