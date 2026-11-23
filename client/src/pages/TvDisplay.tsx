import { useState, useEffect, useMemo, useCallback, useRef, memo } from "react";
import TrackingMap from "@/components/TrackingMap";
import { IbsBatteryLogoSvg } from "@/components/IbsBrandComponents";
import ReturnEtaPanel, { type ReturnEtaWarehouse } from "@/components/ReturnEtaPanel";
import CustomScreenCanvas from "@/components/CustomScreenCanvas";
import { useWebSocket, type RawWsMessage } from "@/hooks/useWebSocket";
import { useAuth } from "@/lib/auth";
import {
  resolveActiveTvTruckWeek,
  isDayColumnHoliday,
  isHolidayCellValue,
} from "@shared/truckSchedule";
import { getActiveTvSfWeek, getContrastTextColorForHex, isValidHexColor } from "@shared/sfSchedule";
import {
  BUILTIN_SCREENS,
  createDefaultBuiltInScreenDefinition,
  resolveEffectivePlaylist,
  resolveEffectiveDisplayTheme,
  adaptScheduleColorForTheme,
  type ResolvedScreenSlide,
  type CustomScreenDefinition,
} from "@shared/customScreens";
import {
  type HotShotDeliveryAlert,
  normalizeHotShotRoutes,
  getActiveTodayHotShots,
  getHotShotsForScheduleHeaderDate,
  doesHotShotDriverMatchMember,
  buildHotShotRouteOverlays,
  formatHotShotDateHuman,
  getHotShotHubMeta,
} from "@shared/hotshots";
import {
  type UrgencyTier,
  evaluateAnnouncementUrgency,
  evaluateCalendarEventUrgency,
  evaluateAndSortRenewals,
  type EvaluatedRenewalCell,
} from "@shared/displayUrgency";
import { evaluateTvPowerSchedule } from "@shared/tvPowerSchedule";
import { resolveMapViewSpec } from "@shared/mapRegions";
import {
  resolveRouteOverlays,
  type RouteOverlayFilterMode,
} from "@shared/routeTerritories";
import {
  normalizePhotoGalleryState,
  resolveActiveGalleryPhotos,
} from "@shared/photoGallery";
import {
  resolveEffectiveNwsAlerts,
  normalizeWeatherOverlayMode,
  filterWeatherAlertsForMap,
  getWeatherAlertMapStyle,
} from "@shared/weatherOverlay";
import { Link } from "wouter";
import {
  Radio,
  Tv,
  Pause,
  Play,
  Settings,
  Megaphone,
  Calendar,
  ShieldAlert,
  CloudSun,
  Truck,
  Users,
  Wind,
  MapPin,
  Lock,
  RefreshCw,
  BellRing,
  Clock,
  Flame,
  Moon,
  Image as ImageIcon,
} from "lucide-react";

const SIOUX_FALLS_CENTER: [number, number] = [43.5442, -96.75];
const SIOUX_FALLS_BOUNDS = {
  southwest: [43.43, -96.96] as [number, number],
  northeast: [43.65, -96.55] as [number, number],
};
const REGIONAL_CENTER: [number, number] = [44.15, -97.1];

interface VehicleEntry {
  id: string;
  name?: string;
  color?: string;
  location: { lat: number; lon: number };
  speed: number;
  status: string;
  timestamp: string;
  heading: number;
}

function getTodayIndex(days?: Array<{ day: string; date: string }>): number {
  if (!days || days.length === 0) return -1;
  const now = new Date();
  const todayStr = now.toLocaleDateString("en-US");
  const exact = days.findIndex((d) => d.date === todayStr);
  if (exact !== -1) return exact;
  const shortDay = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][now.getDay()];
  return days.findIndex((d) => (d.day || "").toUpperCase().startsWith(shortDay));
}

function formatTvClockSnapshot(now: Date) {
  return {
    date: now
      .toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
      .toUpperCase(),
    time: now.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    }),
  };
}

const TvLiveClock = memo(function TvLiveClock({
  variant,
  statusSummary,
}: {
  variant: "masthead" | "pairing" | "sleep";
  statusSummary?: string;
}) {
  const [snap, setSnap] = useState(() => formatTvClockSnapshot(new Date()));

  useEffect(() => {
    const tick = () => setSnap(formatTvClockSnapshot(new Date()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  if (variant === "pairing") {
    return (
      <div className="text-right font-mono">
        <div className="text-2xl font-bold tabular-nums text-foreground">{snap.time}</div>
        <div className="text-xs font-semibold text-muted-foreground tracking-wider">{snap.date}</div>
      </div>
    );
  }

  if (variant === "sleep") {
    return (
      <div className="text-[11px] font-mono text-zinc-800">
        {statusSummary} • {snap.time}
      </div>
    );
  }

  return (
    <div className="text-right pl-2.5 border-l border-border shrink-0 font-mono">
      <div className="font-bold text-foreground tabular-nums leading-none" style={{ fontSize: `calc(16 * var(--u))` }}>
        {snap.time}
      </div>
      <div
        className="font-semibold text-primary tracking-wider whitespace-nowrap"
        style={{ fontSize: `calc(9 * var(--u))`, marginTop: `calc(2 * var(--u))` }}
      >
        {snap.date}
      </div>
    </div>
  );
});

export default function TvDisplay() {
  const {
    loading: authLoading,
    authenticated,
    scope,
    displayId: authDisplayId,
    refreshAuth,
  } = useAuth();
  const canViewDisplay =
    authenticated &&
    (scope === "admin" || scope === "staff" || scope === "viewer" || scope === "kiosk");

  const [displayState, setDisplayState] = useState<any>(null);
  const [vehicles, setVehicles] = useState<VehicleEntry[]>([]);
  const [mainWarehouse, setMainWarehouse] = useState<ReturnEtaWarehouse>({
    name: "Arlington Warehouse",
    latitude: 44.3792,
    longitude: -97.1406,
  });
  const [sfWarehouse, setSfWarehouse] = useState<ReturnEtaWarehouse>({
    name: "Sioux Falls Warehouse",
    latitude: 43.5442,
    longitude: -96.7644,
  });

  const explicitUrlDisplay = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return (params.get("display") || "").trim();
  }, []);

  const initialProfile = useMemo(() => {
    return explicitUrlDisplay || localStorage.getItem("tvDisplayProfile") || "breakroom";
  }, [explicitUrlDisplay]);

  const [profileKey, setProfileKey] = useState<string>(initialProfile);
  const [scaleDelta, setScaleDelta] = useState<number>(0);
  const [screenIdx, setScreenIdx] = useState<number>(0);
  const [localPinnedScreenId, setLocalPinnedScreenId] = useState<string | null>(null);
  const [paused, setPaused] = useState<boolean>(false);
  const [slideResetNonce, setSlideResetNonce] = useState<number>(0);
  const [mapMode, setMapMode] = useState<"auto" | "main" | "regional" | "auto-fit">("auto");
  const [newsIdx, setNewsIdx] = useState<number>(0);
  const [msgIdx, setMsgIdx] = useState<number>(0);
  const [clockSync, setClockSync] = useState<{ dateKey: string; minuteKey: string }>(() => {
    const now = new Date();
    return {
      dateKey: now.toDateString(),
      minuteKey: `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`,
    };
  });
  const [toastMsg, setToastMsg] = useState<{ author: string; message: string } | null>(null);
  const [hotShotAlerts, setHotShotAlerts] = useState<HotShotDeliveryAlert[]>([]);
  const hotShotAlertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dismissedSleepPreview, setDismissedSleepPreview] = useState<boolean>(false);

  // 6-Digit On-Screen TV Pairing state (when unauthenticated)
  const [pairSession, setPairSession] = useState<{
    pairId: string;
    code: string;
    expiresAt: string;
  } | null>(null);
  const [pairError, setPairError] = useState<string | null>(null);
  const [pairSecondsLeft, setPairSecondsLeft] = useState<number>(900);

  // Lock kiosk browsers to their server-assigned display unit
  useEffect(() => {
    if (scope === "kiosk" && authDisplayId && authDisplayId !== profileKey) {
      setProfileKey(authDisplayId);
      localStorage.setItem("tvDisplayProfile", authDisplayId);
      const url = new URL(window.location.href);
      url.searchParams.set("display", authDisplayId);
      window.history.replaceState({}, "", url.pathname + url.search);
    }
  }, [scope, authDisplayId, profileKey]);

  const requestNewPairingCode = useCallback(async () => {
    try {
      setPairError(null);
      localStorage.removeItem("tvDisplayProfile");
      const res = await fetch("/api/display/pair/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestedDisplayId: explicitUrlDisplay,
          viewport: `${window.innerWidth}×${window.innerHeight}`,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setPairError(data.error || "Unable to request TV pairing code. Retrying...");
        return;
      }
      setPairSession({
        pairId: data.pairId,
        code: data.code,
        expiresAt: data.expiresAt,
      });
    } catch {
      setPairError("Waiting for network connection to Fleet Server...");
    }
  }, [explicitUrlDisplay]);

  useEffect(() => {
    if (authLoading || canViewDisplay) {
      setPairSession(null);
      return;
    }
    requestNewPairingCode();
  }, [authLoading, canViewDisplay, requestNewPairingCode]);

  useEffect(() => {
    if (!pairSession || canViewDisplay) return;

    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch("/api/display/pair/poll", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pairId: pairSession.pairId }),
        });
        const data = await res.json().catch(() => ({}));
        if (data.status === "approved" && data.displayId) {
          setProfileKey(data.displayId);
          localStorage.setItem("tvDisplayProfile", data.displayId);
          const url = new URL(window.location.href);
          url.searchParams.set("display", data.displayId);
          window.history.replaceState({}, "", url.pathname + url.search);
          await refreshAuth();
        } else if (data.status === "expired" || data.status === "rejected") {
          requestNewPairingCode();
        }
      } catch {
        // Keep polling across temporary Wi-Fi blips
      }
    }, 3000);

    const countdownInterval = setInterval(() => {
      const rem = Math.max(
        0,
        Math.floor((new Date(pairSession.expiresAt).getTime() - Date.now()) / 1000),
      );
      setPairSecondsLeft(rem);
      if (rem <= 0) {
        requestNewPairingCode();
      }
    }, 1000);

    return () => {
      clearInterval(pollInterval);
      clearInterval(countdownInterval);
    };
  }, [pairSession, canViewDisplay, refreshAuth, requestNewPairingCode]);

  const fetchAll = useCallback(async () => {
    if (!canViewDisplay) return;
    try {
      const [stateRes, vehRes, homeRes] = await Promise.all([
        fetch("/api/display/state"),
        fetch("/api/vehicles"),
        fetch("/api/map-home-locations"),
      ]);
      if (stateRes.status === 401) {
        await refreshAuth();
        return;
      }
      if (stateRes.ok) {
        setDisplayState(await stateRes.json());
      }
      if (vehRes.ok) {
        setVehicles(await vehRes.json());
      }
      if (homeRes.ok) {
        const homes = await homeRes.json();
        if (homes?.map?.location) {
          setMainWarehouse({
            name: homes.map.location.name,
            latitude: homes.map.location.latitude,
            longitude: homes.map.location.longitude,
          });
        }
        if (homes?.["regional-sf"]?.location) {
          setSfWarehouse({
            name: homes["regional-sf"].location.name,
            latitude: homes["regional-sf"].location.latitude,
            longitude: homes["regional-sf"].location.longitude,
          });
        }
      }
    } catch (err) {
      console.error("Failed loading TV Display data:", err);
    }
  }, [canViewDisplay, refreshAuth]);

  useEffect(() => {
    if (canViewDisplay) {
      fetchAll();
    }
  }, [canViewDisplay, fetchAll]);

  const handleLocationUpdate = useCallback((data: any) => {
    setVehicles((prev) => {
      const idx = prev.findIndex((v) => v.id === data.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = {
          ...next[idx],
          location: data.location,
          speed: data.speed,
          status: data.status,
          timestamp: data.timestamp,
          heading: data.heading,
        };
        return next;
      }
      return [...prev, data];
    });
  }, []);

  const handleRawWsEvent = useCallback(
    (msg: RawWsMessage) => {
      if (msg.type === "display_state_update" && msg.payload) {
        setDisplayState(msg.payload);
      } else if (msg.type === "display_message_toast" && msg.payload) {
        setToastMsg({
          author: msg.payload.author || "Announcement",
          message: msg.payload.message || "",
        });
        setTimeout(() => setToastMsg(null), 9000);
      } else if (msg.type === "hotshot_delivery_alert" && msg.payload) {
        const incoming: HotShotDeliveryAlert[] = Array.isArray(msg.payload.alerts)
          ? msg.payload.alerts
          : msg.payload.alert
            ? [msg.payload.alert]
            : [];
        if (incoming.length > 0) {
          setHotShotAlerts(incoming.slice(0, 4));
          if (hotShotAlertTimerRef.current) {
            clearTimeout(hotShotAlertTimerRef.current);
          }
          hotShotAlertTimerRef.current = setTimeout(() => {
            setHotShotAlerts([]);
          }, 24000);
        }
      } else if (msg.type === "display_control" && msg.payload) {
        const targetedIds: string[] | undefined = msg.payload.targetedDisplayIds;
        const legacyTarget = msg.payload.targetProfile;
        if (Array.isArray(targetedIds)) {
          if (!targetedIds.includes(profileKey)) return;
        } else if (legacyTarget && legacyTarget !== "all" && legacyTarget !== profileKey) {
          return;
        }
        if (msg.payload.action === "reload" || msg.payload.action === "restart_browser") {
          window.location.reload();
          return;
        }
        if (msg.payload.action === "tv_standby") {
          setDismissedSleepPreview(false);
        }
        const panel = msg.payload.activePanel;
        if (panel === "auto") {
          setLocalPinnedScreenId(null);
          setPaused(false);
          setSlideResetNonce((n) => n + 1);
        } else if (typeof panel === "string" && panel.trim() !== "") {
          setLocalPinnedScreenId(panel);
          setPaused(true);
        }
      }
    },
    [profileKey],
  );

  const { isConnected } = useWebSocket(handleLocationUpdate, handleRawWsEvent);

  // Low-frequency date/minute rollover sync (avoids 1Hz re-renders of maps & tables; <TvLiveClock /> owns live seconds)
  useEffect(() => {
    const sync = () => {
      const now = new Date();
      const dateKey = now.toDateString();
      const minuteKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;
      setClockSync((prev) =>
        prev.dateKey === dateKey && prev.minuteKey === minuteKey ? prev : { dateKey, minuteKey },
      );
    };
    const id = setInterval(sync, 20000);
    return () => clearInterval(id);
  }, []);

  // Resolve active ordered playlist (Default Company -> Display Group -> TV Unit override)
  const rotationSec =
    displayState?.settings?.displayProfiles?.[profileKey]?.rotationIntervalSec ||
    displayState?.settings?.rotationIntervalSec ||
    22;

  const allHotShotRoutes = useMemo(
    () => normalizeHotShotRoutes(displayState?.hotShotRoutes),
    [displayState?.hotShotRoutes],
  );

  const todayHotShots = useMemo(
    () => getActiveTodayHotShots(allHotShotRoutes, new Date()),
    [allHotShotRoutes, clockSync.dateKey],
  );

  const playlistSlides = useMemo(() => {
    const rawSlides = resolveEffectivePlaylist(
      displayState?.settings,
      displayState?.customScreens,
      profileKey,
    );
    // Smart Auto-Skip: skip Screen 5 (Hotshots) in normal rotation on quiet days with 0 active Hot Shots
    const filtered =
      todayHotShots.length === 0 && rawSlides.length > 1
        ? rawSlides.filter((s) => s.screenId !== "screen-5")
        : rawSlides;
    const finalList = filtered.length > 0 ? filtered : rawSlides;
    return finalList.map((s, idx) => {
      const cleanName = s.tabLabel.replace(/^\d+\s*•\s*/, "");
      const hotShotSuffix =
        s.screenId === "screen-5" && todayHotShots.length > 0
          ? `⚡ ${cleanName} [${todayHotShots.length}]`
          : cleanName;
      // Give Screen 5 at least 11s per active Hot Shot (+2s buffer) so every run gets full zoomed map time
      const dynamicDurationSec =
        s.screenId === "screen-5" && todayHotShots.length > 1
          ? Math.max(Number(s.durationSec || rotationSec), todayHotShots.length * 11 + 2)
          : s.durationSec;
      return {
        ...s,
        durationSec: dynamicDurationSec,
        tabLabel: `${idx + 1} • ${hotShotSuffix}`,
      };
    });
  }, [displayState?.settings, displayState?.customScreens, profileKey, todayHotShots]);

  const serverForcedPanel = useMemo(() => {
    const profileForced = displayState?.settings?.displayProfiles?.[profileKey]?.activePanel;
    const globalForced = displayState?.settings?.activePanel;
    if (profileForced && profileForced !== "auto") return String(profileForced);
    if (globalForced && globalForced !== "auto") return String(globalForced);
    return null;
  }, [displayState?.settings, profileKey]);

  // Clear local pin when server explicitly returns to auto
  useEffect(() => {
    if (!serverForcedPanel) {
      setLocalPinnedScreenId(null);
    }
  }, [serverForcedPanel]);

  const effectivePinnedId = localPinnedScreenId || serverForcedPanel;

  const activeSlide: ResolvedScreenSlide = useMemo(() => {
    if (effectivePinnedId) {
      const inPlaylist = playlistSlides.find((s) => s.screenId === effectivePinnedId);
      if (inPlaylist) return inPlaylist;

      const custom = ((displayState?.customScreens || []) as CustomScreenDefinition[]).find(
        (c) => c.id === effectivePinnedId,
      );
      if (custom) {
        return {
          screenId: custom.id,
          isCustom: true,
          tabLabel: `📌 ${custom.badgeLabel || custom.name}`,
          fullTitle: custom.name,
          durationSec: custom.durationSec || rotationSec,
          customScreen: custom,
        };
      }

      const builtIn = BUILTIN_SCREENS.find((b) => b.id === effectivePinnedId);
      if (builtIn) {
        return {
          screenId: builtIn.id,
          isCustom: false,
          tabLabel: `📌 ${builtIn.shortTab}`,
          fullTitle: builtIn.name,
          durationSec: rotationSec,
        };
      }
    }

    return (
      playlistSlides[screenIdx % Math.max(1, playlistSlides.length)] || {
        screenId: "screen-1",
        isCustom: false,
        tabLabel: "1 • Routes",
        fullTitle: "Screen 1",
        durationSec: rotationSec,
      }
    );
  }, [effectivePinnedId, playlistSlides, screenIdx, rotationSec, displayState?.customScreens]);

  const activeScreenId = activeSlide.screenId;
  const activeSlideDurationSec = Math.max(5, Number(activeSlide.durationSec || rotationSec));
  const slideCycleKey = `${screenIdx}-${activeScreenId}-${activeSlideDurationSec}-${slideResetNonce}`;
  const slideProgressRef = useRef<{ key: string; elapsedMs: number }>({
    key: slideCycleKey,
    elapsedMs: 0,
  });

  // Zero-rerender slide advance timer (GPU CSS scaleX handles smooth visual progress)
  useEffect(() => {
    if (slideProgressRef.current.key !== slideCycleKey) {
      slideProgressRef.current = { key: slideCycleKey, elapsedMs: 0 };
    }

    if (effectivePinnedId) {
      const idx = playlistSlides.findIndex((s) => s.screenId === effectivePinnedId);
      if (idx >= 0) setScreenIdx(idx);
      slideProgressRef.current = { key: slideCycleKey, elapsedMs: 0 };
      return;
    }

    if (paused) return;

    const capturedKey = slideCycleKey;
    const totalMs = activeSlideDurationSec * 1000;
    const alreadyElapsed =
      slideProgressRef.current.key === capturedKey ? slideProgressRef.current.elapsedMs : 0;
    const remainingMs = Math.max(250, totalMs - alreadyElapsed);
    const startedAt = performance.now();
    let completed = false;

    const timer = setTimeout(() => {
      completed = true;
      slideProgressRef.current = { key: "", elapsedMs: 0 };
      setScreenIdx((s) => (s + 1) % Math.max(1, playlistSlides.length));
    }, remainingMs);

    return () => {
      clearTimeout(timer);
      if (!completed && slideProgressRef.current.key === capturedKey) {
        slideProgressRef.current = {
          key: capturedKey,
          elapsedMs: Math.min(totalMs, alreadyElapsed + Math.max(0, performance.now() - startedAt)),
        };
      }
    };
  }, [
    paused,
    slideCycleKey,
    activeSlideDurationSec,
    effectivePinnedId,
    playlistSlides.length,
  ]);

  // News & Announcement rotator
  useEffect(() => {
    const id = setInterval(() => {
      setNewsIdx((n) => n + 1);
      setMsgIdx((m) => m + 1);
    }, 9000);
    return () => clearInterval(id);
  }, []);

  const activeProfile = useMemo(() => {
    const profiles = displayState?.settings?.displayProfiles || {};
    const firstProfile = Object.values(profiles)[0] as any;
    return (
      profiles[profileKey] ||
      firstProfile || {
        id: "breakroom",
        name: 'Breakroom — 55" 4K TV',
        uiScale: 1.05,
        leftColumnWidthPct: 44,
        sfRowsPerPage: 7,
        highContrast: false,
      }
    );
  }, [displayState, profileKey]);

  // Main-thread FPS & Freeze Watchdog + 10-second Pingback Heartbeat to SF Office Admin
  const mountTimeRef = useRef<number>(Date.now());
  const screenIdxRef = useRef<number>(screenIdx);
  useEffect(() => {
    screenIdxRef.current = screenIdx;
  }, [screenIdx]);

  useEffect(() => {
    if (
      !canViewDisplay ||
      (scope !== "kiosk" && !(scope === "admin" && Boolean(explicitUrlDisplay)))
    ) {
      return;
    }

    // Measure true JS main-thread event-loop lag (1s tick drift) rather than continuous 60Hz rAF.
    // Note: Chromium OS Window Occlusion throttles requestAnimationFrame to 1 Hz (1 FPS, 1s gap)
    // whenever a window is covered behind another window even while visibilityState === "visible".
    let maxEventLoopLagMs = 0;
    let expectedNextTick = performance.now() + 1000;
    const lagProbeId = setInterval(() => {
      const now = performance.now();
      const drift = Math.max(0, now - expectedNextTick);
      // Ignore drift accumulated while tab was hidden/backgrounded
      if (document.visibilityState === "visible" && drift > maxEventLoopLagMs) {
        maxEventLoopLagMs = drift;
      }
      expectedNextTick = now + 1000;
    }, 1000);

    let sampleRafId = 0;
    let sampleCancelTimer: ReturnType<typeof setTimeout> | null = null;

    const postPing = (sampledFps: number | null, reportedLagMs: number) => {
      fetch("/api/display/ping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayId: scope === "kiosk" && authDisplayId ? authDisplayId : profileKey,
          fps: sampledFps,
          maxFrameGapMs: Math.round(reportedLagMs),
          visibilityState: document.visibilityState,
          viewport: `${window.innerWidth}×${window.innerHeight}`,
          currentScreenIdx: screenIdxRef.current,
          uptimeSec: Math.round((Date.now() - mountTimeRef.current) / 1000),
        }),
      })
        .then((res) => {
          if (res.status === 401) {
            refreshAuth();
          }
        })
        .catch(() => {});
    };

    const sendHeartbeat = () => {
      const reportedLagMs = maxEventLoopLagMs;
      maxEventLoopLagMs = 0;
      expectedNextTick = performance.now() + 1000;

      if (document.visibilityState !== "visible") {
        postPing(null, 0);
        return;
      }

      // Sample compositor FPS briefly (500ms burst every 10s -> 95% fewer CPU/GPU wakeups on Pis)
      cancelAnimationFrame(sampleRafId);
      if (sampleCancelTimer) clearTimeout(sampleCancelTimer);

      let frames = 0;
      const sampleStart = performance.now();
      const countFrame = () => {
        frames++;
        if (performance.now() - sampleStart < 500) {
          sampleRafId = requestAnimationFrame(countFrame);
        }
      };
      sampleRafId = requestAnimationFrame(countFrame);

      sampleCancelTimer = setTimeout(() => {
        cancelAnimationFrame(sampleRafId);
        const elapsed = Math.max(1, performance.now() - sampleStart);
        const rawFps = Math.round((frames * 1000) / elapsed);
        // If rAF is <= 3 FPS while event-loop lag is healthy (< 2.5s), Chromium is simply throttling
        // an occluded/covered window or idle screen — report null instead of a false 1 FPS stall.
        const effectiveFps = rawFps <= 3 && reportedLagMs < 2500 ? null : Math.min(120, rawFps);
        postPing(effectiveFps, reportedLagMs);
      }, 520);
    };

    const onVisibilityChange = () => {
      maxEventLoopLagMs = 0;
      expectedNextTick = performance.now() + 1000;
      sendHeartbeat();
    };

    const initialTimer = setTimeout(sendHeartbeat, 600);
    const intervalId = setInterval(sendHeartbeat, 10000);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      clearInterval(lagProbeId);
      cancelAnimationFrame(sampleRafId);
      if (sampleCancelTimer) clearTimeout(sampleCancelTimer);
      clearTimeout(initialTimer);
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [profileKey, canViewDisplay, scope, authDisplayId, refreshAuth]);

  const effectiveScale = Math.max(0.75, Math.min(1.65, (activeProfile.uiScale || 1.05) + scaleDelta));
  const leftWidthPct = activeProfile.leftColumnWidthPct || 44;
  const highContrast = Boolean(activeProfile.highContrast);

  const cycleProfile = () => {
    if (scope === "kiosk") return;
    const keys = Object.keys(displayState?.settings?.displayProfiles || { breakroom: 1, warehouse: 1 });
    if (keys.length === 0) return;
    const idx = keys.indexOf(profileKey);
    const next = keys[(idx + 1) % keys.length];
    setProfileKey(next);
    setScaleDelta(0);
    localStorage.setItem("tvDisplayProfile", next);
    const url = new URL(window.location.href);
    url.searchParams.set("display", next);
    window.history.replaceState({}, "", url.toString());
  };

  const enrichedAnnouncements = useMemo(() => {
    const now = new Date();
    const tierRank: Record<UrgencyTier, number> = {
      overdue: 0,
      today: 1,
      imminent: 2,
      this_week: 3,
      approaching: 4,
      scheduled: 5,
      past: 9,
    };
    return ((displayState?.messages || []) as any[])
      .filter((m) => m.active !== false)
      .map((m) => ({
        msg: m,
        urgency: evaluateAnnouncementUrgency(m, now),
      }))
      .filter((item) => !item.urgency.isAutoArchived)
      .sort((a, b) => {
        const rDiff = tierRank[a.urgency.tier] - tierRank[b.urgency.tier];
        if (rDiff !== 0) return rDiff;
        if (a.urgency.daysUntil !== null && b.urgency.daysUntil !== null) {
          return a.urgency.daysUntil - b.urgency.daysUntil;
        }
        return 0;
      });
  }, [displayState?.messages, clockSync.dateKey]);

  const activeMessages = useMemo(
    () => enrichedAnnouncements.map((x: any) => x.msg),
    [enrichedAnnouncements],
  );

  const currentEnrichedAnnouncement = enrichedAnnouncements[
    msgIdx % Math.max(1, enrichedAnnouncements.length)
  ] || {
    msg: {
      author: "Operations",
      message: "Have a safe and productive shift!",
      timestamp: "",
      source: "Admin",
      priority: "normal",
    },
    urgency: evaluateAnnouncementUrgency({
      message: "Have a safe and productive shift!",
      priority: "normal",
    }),
  };

  const upcomingCalendarEvents = useMemo(() => {
    const now = new Date();
    return (displayState?.calendarEvents || [])
      .map((ev: any) => ({
        ev,
        urgency: evaluateCalendarEventUrgency(ev, now),
      }))
      .filter((item: any) => !item.urgency.isPast)
      .sort((a: any, b: any) => {
        const da = a.urgency.daysUntil ?? 9999;
        const db = b.urgency.daysUntil ?? 9999;
        return da - db;
      });
  }, [displayState?.calendarEvents, clockSync.dateKey]);

  const sortedRenewals = useMemo(
    () => evaluateAndSortRenewals(displayState?.renewalReminders || [], new Date()),
    [displayState?.renewalReminders, clockSync.dateKey],
  );

  const urgentRenewalsWithin45d = useMemo(() => {
    const alerts: Array<{ entity: string; type: string; raw: string; days: number }> = [];
    for (const item of sortedRenewals) {
      if (item.license.daysUntil !== null && item.license.daysUntil <= 45) {
        alerts.push({
          entity: item.row.entity,
          type: "Driver's License",
          raw: item.license.raw,
          days: item.license.daysUntil,
        });
      }
      if (item.medCard.daysUntil !== null && item.medCard.daysUntil <= 45) {
        alerts.push({
          entity: item.row.entity,
          type: "Med Card",
          raw: item.medCard.raw,
          days: item.medCard.daysUntil,
        });
      }
      if (item.truckDot.daysUntil !== null && item.truckDot.daysUntil <= 45) {
        alerts.push({
          entity: item.row.entity,
          type: "Truck DOT",
          raw: item.truckDot.raw,
          days: item.truckDot.daysUntil,
        });
      }
    }
    return alerts.sort((a, b) => a.days - b.days);
  }, [sortedRenewals]);

  // Imminent Spotlight items (TODAY, TOMORROW, <=3 days away, or URGENT priority) surfaced across Screens 1-3
  const imminentSpotlightItems = useMemo(() => {
    const items: Array<{
      id: string;
      tier: UrgencyTier;
      badge: string;
      title: string;
      sublabel: string;
    }> = [];

    for (const { msg, urgency } of enrichedAnnouncements) {
      if (urgency.tier === "today" || urgency.tier === "imminent") {
        items.push({
          id: `ann-${msg.id}`,
          tier: urgency.tier,
          badge: urgency.badgeText,
          title: msg.message,
          sublabel: msg.eventLabel || urgency.formattedDate || msg.author || "Broadcast",
        });
      }
    }

    for (const { ev, urgency } of upcomingCalendarEvents) {
      if (urgency.tier === "today" || urgency.tier === "imminent") {
        items.push({
          id: `cal-${ev.id}`,
          tier: urgency.tier,
          badge: urgency.badgeText,
          title: ev.title,
          sublabel: `${ev.dayLabel}${ev.time ? ` • ${ev.time}` : ""}`,
        });
      }
    }

    return items;
  }, [enrichedAnnouncements, upcomingCalendarEvents]);

  const findVehicleForScheduleRow = useCallback(
    (vehicleKey: string, driverLabel: string) => {
      const prefix = (driverLabel || "").split("-")[0].replace("TO3", "T03");
      return (
        vehicles.find((v) => v.name === vehicleKey) ||
        vehicles.find((v) => v.name === prefix) ||
        null
      );
    },
    [vehicles],
  );

  const effectiveMapView =
    mapMode !== "auto" ? mapMode : activeScreenId === "screen-3" ? "regional" : "main";

  const movingCount = vehicles.filter((v) => v.status === "moving" || v.speed > 2).length;
  const headlines = displayState?.newsHeadlines || [];
  const activeHeadline = headlines[newsIdx % Math.max(1, headlines.length)];
  const compliments = displayState?.compliments || ["Safe miles and smooth routes today, team!"];
  const activeCompliment = compliments[newsIdx % Math.max(1, compliments.length)];

  const unitCss = `calc((100vmin / 1080) * ${effectiveScale.toFixed(2)})`;

  const [routeFilterMode, setRouteFilterMode] = useState<RouteOverlayFilterMode>("today");

  const activeTruckWeek = useMemo(
    () => resolveActiveTvTruckWeek(displayState?.truckSchedule, new Date()),
    [displayState?.truckSchedule, clockSync.dateKey],
  );

  const activeRouteOverlays = useMemo(
    () =>
      resolveRouteOverlays(displayState?.routeTerritories, {
        filterMode: routeFilterMode,
        colorMode: "route",
        activeTruckWeek,
        hotShotOverlays: buildHotShotRouteOverlays(todayHotShots, {
          sfWarehouse,
          mainWarehouse,
        }),
      }),
    [
      displayState?.routeTerritories,
      routeFilterMode,
      activeTruckWeek,
      todayHotShots,
      sfWarehouse,
      mainWarehouse,
    ],
  );

  const activeSfWeek = useMemo(
    () => getActiveTvSfWeek(displayState?.sfSchedule, new Date()),
    [displayState?.sfSchedule, clockSync.dateKey],
  );

  const effectiveTvTheme = useMemo(
    () =>
      resolveEffectiveDisplayTheme(
        displayState?.settings,
        profileKey,
        activeSlide.customScreen?.theme,
      ),
    [displayState?.settings, profileKey, activeSlide.customScreen?.theme],
  );
  const isLightTheme = effectiveTvTheme === "daylight-paper";

  const powerEval = useMemo(
    () =>
      evaluateTvPowerSchedule(
        displayState?.settings?.powerSchedule,
        activeProfile,
        new Date(),
      ),
    [displayState?.settings?.powerSchedule, activeProfile, clockSync.minuteKey],
  );

  useEffect(() => {
    if (!powerEval.isScheduledSleep && dismissedSleepPreview) {
      setDismissedSleepPreview(false);
    }
  }, [powerEval.isScheduledSleep, dismissedSleepPreview]);

  const renderTruckWeekTable = (weekBlock: any, showGps: boolean) => {
    if (!weekBlock?.days) return null;
    const todayCol = showGps ? getTodayIndex(weekBlock.days) : -1;

    return (
      <div className="w-full h-full overflow-hidden flex flex-col">
        <table className="w-full h-full border-collapse table-fixed text-left">
          <thead>
            <tr className="bg-secondary border-b border-border">
              <th
                className="font-display font-bold uppercase tracking-wider text-muted-foreground border-r border-border"
                style={{ width: "24%", padding: `calc(8 * var(--u)) calc(10 * var(--u))`, fontSize: `calc(13 * var(--u))` }}
              >
                Driver / Unit
              </th>
              {weekBlock.days.map((d: any, i: number) => {
                const isColHoliday = isDayColumnHoliday(weekBlock, i);
                return (
                  <th
                    key={i}
                    className={`text-center font-display font-bold uppercase tracking-wider border-r last:border-r-0 border-border ${
                      isColHoliday
                        ? "bg-rose-500/25 text-rose-300"
                        : i === todayCol
                          ? "bg-primary/20 text-primary"
                          : "text-secondary-foreground"
                    }`}
                    style={{ padding: `calc(7 * var(--u)) calc(5 * var(--u))`, fontSize: `calc(13 * var(--u))` }}
                  >
                    <div>
                      {d.day}
                      {isColHoliday ? " • HOLIDAY" : i === todayCol ? " [TODAY]" : ""}
                    </div>
                    <div className="font-mono font-medium opacity-75" style={{ fontSize: `calc(10 * var(--u))` }}>
                      {(d.date || "").replace(/\/\d{4}$/, "")}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {(weekBlock.rows || []).map((row: any, rIdx: number) => {
              const matchedVeh = showGps ? findVehicleForScheduleRow(row.vehicleKey, row.driver) : null;
              const isMoving = matchedVeh && (matchedVeh.status === "moving" || matchedVeh.speed > 2);
              const driverColor = adaptScheduleColorForTheme(row.color, isLightTheme, "#E59A23", "#181816");
              const routeColor = adaptScheduleColorForTheme(row.color, isLightTheme, "#F2F0EA", "#181816");
              return (
                <tr
                  key={rIdx}
                  className="border-b border-border odd:bg-secondary/25"
                >
                  <td
                    className="font-bold truncate border-r border-border"
                    style={{
                      color: driverColor,
                      padding: `calc(9 * var(--u)) calc(10 * var(--u))`,
                      fontSize: `calc(14 * var(--u))`,
                    }}
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="truncate font-display uppercase tracking-wide">{row.driver}</span>
                      {matchedVeh && (
                        <span
                          className={`rounded font-mono font-bold shrink-0 ${
                            isMoving
                              ? "bg-emerald-600/20 text-emerald-500 border border-emerald-600/40"
                              : "bg-secondary text-muted-foreground border border-border"
                          }`}
                          style={{
                            fontSize: `calc(9.5 * var(--u))`,
                            padding: `calc(1.5 * var(--u)) calc(5 * var(--u))`,
                          }}
                        >
                          {isMoving ? `${Math.round(matchedVeh.speed)} MPH` : "HUB"}
                        </span>
                      )}
                    </div>
                  </td>
                  {(row.days || []).map((cell: string, cIdx: number) => {
                    const isColHoliday = isDayColumnHoliday(weekBlock, cIdx);
                    const isCellHoliday = isColHoliday || isHolidayCellValue(cell);
                    return (
                      <td
                        key={cIdx}
                        className={`text-center font-semibold leading-snug break-words border-r last:border-r-0 border-border/60 ${
                          isCellHoliday
                            ? "bg-rose-500/20 text-rose-200 font-extrabold"
                            : cIdx === todayCol
                              ? "bg-primary/[0.08]"
                              : ""
                        }`}
                        style={{
                          color: isCellHoliday ? undefined : cell ? routeColor : undefined,
                          padding: `calc(9 * var(--u)) calc(6 * var(--u))`,
                          fontSize: `calc(13 * var(--u))`,
                        }}
                      >
                        {isCellHoliday ? (
                          `🎉 ${cell || "HOLIDAY"}`
                        ) : (
                          cell || <span className="text-muted-foreground/50">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  const getTierStyles = (tier: UrgencyTier) => {
    if (tier === "today") {
      return {
        card: "border-border border-l-emerald-500 bg-card",
        badge: "bg-emerald-600 text-white",
        tile: "bg-emerald-600/15 border-emerald-600/45 text-emerald-500",
      };
    }
    if (tier === "imminent" || tier === "overdue") {
      return {
        card: "border-border border-l-red-600 bg-card",
        badge: "bg-red-600 text-white",
        tile: "bg-red-600/15 border-red-600/45 text-red-500",
      };
    }
    if (tier === "this_week") {
      return {
        card: "border-border border-l-amber-500 bg-card",
        badge: "bg-amber-500 text-black",
        tile: "bg-amber-500/15 border-amber-500/45 text-amber-500",
      };
    }
    if (tier === "approaching") {
      return {
        card: "border-border border-l-primary bg-card",
        badge: "bg-primary/20 border border-primary/45 text-primary",
        tile: "bg-secondary border-border text-foreground",
      };
    }
    return {
      card: "border-border border-l-muted-foreground bg-card",
      badge: "bg-secondary border border-border text-secondary-foreground",
      tile: "bg-secondary border-border text-foreground",
    };
  };

  const renderAnnouncementCard = () => {
    const { msg: currentAnnouncement, urgency } = currentEnrichedAnnouncement;
    const styles = getTierStyles(urgency.tier);
    const hasCountdown = urgency.daysUntil !== null;

    return (
      <div
        className={`relative rounded border border-l-4 overflow-hidden shrink-0 ${styles.card}`}
        style={{ padding: `calc(10 * var(--u)) calc(14 * var(--u))` }}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center" style={{ gap: `calc(7 * var(--u))` }}>
                <div
                  className="rounded bg-secondary border border-border text-primary flex items-center justify-center font-mono font-bold shrink-0"
                  style={{
                    width: `calc(22 * var(--u))`,
                    height: `calc(22 * var(--u))`,
                    fontSize: `calc(11 * var(--u))`,
                  }}
                >
                  {(currentAnnouncement.author || "A").charAt(0).toUpperCase()}
                </div>
                <span
                  className="font-display font-bold uppercase tracking-wider text-foreground"
                  style={{ fontSize: `calc(14 * var(--u))` }}
                >
                  {currentAnnouncement.author}
                </span>
                <span
                  className={`rounded font-mono font-bold uppercase tracking-wider ${styles.badge}`}
                  style={{
                    fontSize: `calc(9.5 * var(--u))`,
                    padding: `calc(2 * var(--u)) calc(7 * var(--u))`,
                  }}
                >
                  {urgency.badgeText}
                </span>
                {urgency.formattedDate && (
                  <span
                    className="rounded bg-secondary border border-border text-muted-foreground font-mono font-semibold"
                    style={{
                      fontSize: `calc(9.5 * var(--u))`,
                      padding: `calc(1.5 * var(--u)) calc(6 * var(--u))`,
                    }}
                  >
                    {currentAnnouncement.eventLabel ? `${currentAnnouncement.eventLabel}: ` : ""}
                    {urgency.formattedDate}
                  </span>
                )}
              </div>

              {enrichedAnnouncements.length > 1 && (
                <div className="flex items-center gap-1 shrink-0">
                  {enrichedAnnouncements.map((_: any, i: number) => (
                    <span
                      key={i}
                      className={`transition-all ${
                        i === msgIdx % enrichedAnnouncements.length
                          ? "bg-primary w-4 h-1.5"
                          : "bg-border w-1.5 h-1.5"
                      }`}
                    />
                  ))}
                </div>
              )}
            </div>

            <div
              className="font-semibold text-foreground leading-snug"
              style={{
                fontSize: `calc(15.5 * var(--u))`,
                marginTop: `calc(6 * var(--u))`,
              }}
            >
              {currentAnnouncement.message}
            </div>
          </div>

          {hasCountdown && (
            <div
              className={`rounded border flex flex-col items-center justify-center text-center shrink-0 ${styles.tile}`}
              style={{
                minWidth: `calc(80 * var(--u))`,
                padding: `calc(6 * var(--u)) calc(10 * var(--u))`,
              }}
            >
              <div
                className="font-display font-extrabold leading-none tabular-nums"
                style={{ fontSize: `calc(22 * var(--u))` }}
              >
                {urgency.daysUntil === 0
                  ? "TODAY"
                  : urgency.daysUntil === 1
                    ? "1 DAY"
                    : `${urgency.daysUntil}D`}
              </div>
              <div
                className="font-mono font-bold uppercase tracking-wider opacity-85"
                style={{ fontSize: `calc(8.5 * var(--u))`, marginTop: `calc(2 * var(--u))` }}
              >
                {urgency.daysUntil === 0 ? "ACTIVE" : "REMAINING"}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  if (authLoading) {
    return (
      <div
        data-theme={effectiveTvTheme}
        className="h-screen w-screen bg-background text-foreground flex flex-col items-center justify-center gap-3 select-none"
      >
        <Tv className="w-9 h-9 text-primary animate-pulse" />
        <span className="text-xs font-mono uppercase tracking-[0.2em] text-muted-foreground">
          Initializing Departure Board...
        </span>
      </div>
    );
  }

  if (!canViewDisplay) {
    const formattedCode = pairSession?.code
      ? `${pairSession.code.slice(0, 3)}-${pairSession.code.slice(3, 6)}`
      : "---•---";
    const mins = Math.floor(pairSecondsLeft / 60);
    const secs = String(pairSecondsLeft % 60).padStart(2, "0");

    return (
      <div
        data-theme={effectiveTvTheme}
        className="h-screen w-screen bg-background text-foreground flex flex-col justify-between p-8 relative overflow-hidden select-none"
      >
        {/* Top Bar */}
        <div className="z-10 flex items-center justify-between border-b border-border pb-4">
          <div className="flex items-center gap-3 border-l-4 border-primary pl-3.5">
            <IbsBatteryLogoSvg className="w-10 h-10" />
            <div>
              <div className="font-display font-extrabold text-2xl uppercase tracking-wider text-foreground">
                INTERSTATE BATTERIES OF SOUTH DAKOTA
              </div>
              <div className="text-xs font-mono text-primary flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5" />
                {explicitUrlDisplay
                  ? `Awaiting Admin Pairing Authorization (Requested: ?display=${explicitUrlDisplay})`
                  : "Awaiting Admin Pairing Authorization • Creates Dedicated Screen Instance"}
              </div>
            </div>
          </div>

          <TvLiveClock variant="pairing" />
        </div>

        {/* Center 6-Digit Pairing Panel */}
        <div className="z-10 max-w-xl w-full mx-auto rounded border border-border bg-card overflow-hidden shadow-xl">
          <div className="bg-secondary px-6 py-3 border-b border-border flex items-center justify-between">
            <span className="font-display font-bold uppercase tracking-wider text-sm text-secondary-foreground flex items-center gap-2">
              <Radio className="w-4 h-4 text-primary animate-pulse" />
              Unattended Display Commissioning
            </span>
            <span className="font-mono text-xs text-muted-foreground">
              {explicitUrlDisplay ? `UNIT: ${explicitUrlDisplay.toUpperCase()}` : "NEW DEVICE"}
            </span>
          </div>

          <div className="p-8 text-center space-y-6">
            <div className="space-y-1.5">
              <h1 className="text-2xl sm:text-3xl font-display font-extrabold uppercase tracking-wide text-foreground">
                Authorize Display in Admin Console
              </h1>
              <p className="text-xs sm:text-sm text-muted-foreground max-w-md mx-auto">
                Open <strong className="text-foreground font-mono">/admin</strong> on any office workstation, select{" "}
                <strong className="text-primary">TV Displays & Health</strong>, and approve the 6-digit terminal code below.
              </p>
            </div>

            <div className="py-5 px-8 rounded bg-background border-2 border-border">
              <div className="text-[11px] font-mono uppercase tracking-[0.2em] text-muted-foreground mb-2">
                Terminal Pairing Code
              </div>
              <div
                data-testid="tv-pairing-code"
                className="text-5xl sm:text-7xl font-mono font-bold tracking-widest text-primary tabular-nums"
              >
                {formattedCode}
              </div>
            </div>

            {pairError ? (
              <div className="text-xs text-destructive font-mono">{pairError}</div>
            ) : (
              <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground font-mono">
                <span>
                  ROTATES IN <strong className="text-foreground">{mins}:{secs}</strong>
                </span>
                <span>•</span>
                <button
                  type="button"
                  onClick={requestNewPairingCode}
                  className="inline-flex items-center gap-1 text-primary hover:underline font-semibold"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  RENEW CODE
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="z-10 flex items-center justify-between text-xs font-mono text-muted-foreground border-t border-border pt-3">
          <span>365-DAY HARDWARE TOKEN ISSUED ON APPROVAL</span>
          <Link href="/login?next=/admin">
            <span className="text-foreground hover:text-primary font-semibold cursor-pointer">
              OPERATOR SIGN IN →
            </span>
          </Link>
        </div>
      </div>
    );
  }

  // Night Standby Blackout Screen (active during scheduled off-hours; keeps 10s heartbeat & WS alive while cooling GPU/CPU)
  if (powerEval.isScheduledSleep && !dismissedSleepPreview) {
    const minuteDrift = new Date().getMinutes() % 5;
    const offsetX = (minuteDrift - 2) * 18;
    const offsetY = ((minuteDrift * 2) % 5 - 2) * 14;
    return (
      <div
        data-testid="tv-night-standby-screen"
        className="h-screen w-screen bg-black text-zinc-600 flex flex-col items-center justify-center select-none overflow-hidden relative"
      >
        <div
          className="flex flex-col items-center gap-2 text-center transition-transform duration-1000"
          style={{ transform: `translate(${offsetX}px, ${offsetY}px)` }}
        >
          <div className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-[0.25em] text-zinc-700">
            <Moon className="w-3.5 h-3.5" />
            <span>Night Standby • {activeProfile?.name || profileKey}</span>
          </div>
          <TvLiveClock variant="sleep" statusSummary={powerEval.statusSummary} />
        </div>

        {scope !== "kiosk" && (
          <div className="absolute bottom-6 right-6 flex items-center gap-2">
            <button
              type="button"
              data-testid="button-preview-awake"
              onClick={() => setDismissedSleepPreview(true)}
              className="px-3 py-1.5 rounded border border-zinc-800 bg-zinc-950/90 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700 text-xs font-mono transition-colors"
            >
              Preview Screen While Asleep
            </button>
            <Link href="/admin">
              <span className="px-3 py-1.5 rounded border border-zinc-800 bg-zinc-950/90 text-zinc-400 hover:text-zinc-200 text-xs font-mono cursor-pointer">
                Admin →
              </span>
            </Link>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      data-theme={effectiveTvTheme}
      className="h-screen w-screen overflow-hidden flex flex-col select-none bg-background text-foreground"
      style={{ ["--u" as any]: unitCss }}
    >
      {/* TOP DEPARTURE-BOARD MASTHEAD */}
      <header
        className="shrink-0 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b-2 border-border bg-card px-3.5 py-1.5 z-30 overflow-hidden"
        style={{ minHeight: `calc(50 * var(--u))` }}
      >
        <div className="flex flex-wrap items-center min-w-0" style={{ gap: `calc(12 * var(--u))` }}>
          <div className="flex items-center gap-2.5 min-w-0 border-l-4 border-primary pl-2.5">
            <IbsBatteryLogoSvg className="w-9 h-9" />
            <div className="min-w-0">
              <div
                className="font-display font-extrabold uppercase tracking-wider text-foreground leading-none truncate"
                style={{ fontSize: `calc(17.5 * var(--u))` }}
              >
                {!displayState?.settings?.companyName ||
                /fleet\s*&\s*operations/i.test(displayState.settings.companyName)
                  ? "INTERSTATE BATTERIES OF SOUTH DAKOTA"
                  : displayState.settings.companyName}
              </div>
              <div
                className="flex items-center gap-2 text-muted-foreground font-mono font-medium whitespace-nowrap"
                style={{ fontSize: `calc(9.5 * var(--u))`, marginTop: `calc(2.5 * var(--u))` }}
              >
                <span className="inline-flex items-center gap-1 text-emerald-500 font-semibold">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  {isConnected ? "FEED ONLINE" : "RECONNECTING"}
                </span>
                <span>|</span>
                <span>
                  {movingCount} EN ROUTE / {vehicles.length} UNITS
                </span>
              </div>
            </div>
          </div>

          {/* Departure Board Slide Selector */}
          <div
            className="flex flex-wrap items-center bg-secondary border border-border rounded p-0.5"
            style={{ gap: `calc(2 * var(--u))` }}
          >
            {playlistSlides.map((slide, idx) => {
              const isCurrent = activeScreenId === slide.screenId;
              const pillText =
                slide.screenId === "screen-4" && imminentSpotlightItems.length > 0
                  ? `${slide.tabLabel} [${imminentSpotlightItems.length}]`
                  : slide.tabLabel;
              return (
                <button
                  key={slide.screenId}
                  onClick={() => {
                    setLocalPinnedScreenId(null);
                    setScreenIdx(idx);
                    setSlideResetNonce((n) => n + 1);
                  }}
                  className={`rounded-sm font-display font-bold uppercase tracking-wider whitespace-nowrap transition-colors ${
                    isCurrent
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  style={{
                    fontSize: `calc(12 * var(--u))`,
                    padding: `calc(3 * var(--u)) calc(9 * var(--u))`,
                  }}
                >
                  {pillText}
                </button>
              );
            })}
            {effectivePinnedId &&
              !playlistSlides.some((s) => s.screenId === effectivePinnedId) && (
                <span
                  className="rounded-sm font-display font-bold uppercase tracking-wider whitespace-nowrap bg-primary text-primary-foreground"
                  style={{
                    fontSize: `calc(12 * var(--u))`,
                    padding: `calc(3 * var(--u)) calc(9 * var(--u))`,
                  }}
                >
                  {activeSlide.tabLabel.replace(/^📌\s*/, "PINNED • ")}
                </span>
              )}
            <button
              onClick={() => setPaused((p) => !p)}
              className="rounded-sm text-muted-foreground hover:text-foreground hover:bg-background/60 flex items-center justify-center shrink-0"
              style={{ padding: `calc(3 * var(--u)) calc(6 * var(--u))` }}
              title={paused ? "Resume Rotation" : "Hold Current Board"}
            >
              {paused ? <Play className="w-3.5 h-3.5 text-primary" /> : <Pause className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* Right Controls: Display Unit + Scale + Admin + Tabular Clock */}
        <div className="flex flex-wrap items-center min-w-0" style={{ gap: `calc(8 * var(--u))` }}>
          <div className="inline-flex items-center bg-secondary border border-border rounded overflow-hidden max-w-full font-mono">
            <button
              onClick={cycleProfile}
              className="font-semibold text-secondary-foreground hover:bg-background/50 transition-colors max-w-[200px] truncate"
              style={{ fontSize: `calc(9.5 * var(--u))`, padding: `calc(4 * var(--u)) calc(8 * var(--u))` }}
              title="Cycle assigned TV Display unit"
            >
              {activeProfile.name || profileKey} ({Math.round(effectiveScale * 100)}%)
            </button>
            <button
              onClick={() => setScaleDelta((d) => Math.max(-0.3, d - 0.08))}
              className="border-l border-border text-muted-foreground hover:text-foreground hover:bg-background/50 font-bold shrink-0"
              style={{ fontSize: `calc(9.5 * var(--u))`, padding: `calc(4 * var(--u)) calc(6 * var(--u))` }}
            >
              A-
            </button>
            <button
              onClick={() => setScaleDelta((d) => Math.min(0.4, d + 0.08))}
              className="border-l border-border text-muted-foreground hover:text-foreground hover:bg-background/50 font-bold shrink-0"
              style={{ fontSize: `calc(9.5 * var(--u))`, padding: `calc(4 * var(--u)) calc(6 * var(--u))` }}
            >
              A+
            </button>
          </div>

          {scope === "admin" ? (
            <Link href="/admin">
              <button
                className="rounded border border-border bg-secondary hover:bg-secondary/80 text-secondary-foreground inline-flex items-center gap-1 font-mono uppercase font-semibold whitespace-nowrap shrink-0"
                style={{ fontSize: `calc(9.5 * var(--u))`, padding: `calc(4.5 * var(--u)) calc(8 * var(--u))` }}
                title="Open Unified Admin Console"
              >
                <Settings className="w-3 h-3 shrink-0" />
                Admin
              </button>
            </Link>
          ) : (
            <Link href="/login?next=%2Fadmin">
              <button
                className="rounded border border-border bg-secondary/70 hover:bg-secondary text-muted-foreground hover:text-foreground inline-flex items-center gap-1 font-mono uppercase font-semibold whitespace-nowrap shrink-0 transition-colors"
                style={{ fontSize: `calc(9.5 * var(--u))`, padding: `calc(4.5 * var(--u)) calc(8 * var(--u))` }}
                title="Staff / Admin Sign In (exits TV Kiosk mode on this browser)"
              >
                <Lock className="w-3 h-3 shrink-0" />
                Admin
              </button>
            </Link>
          )}

          <TvLiveClock variant="masthead" />
        </div>
      </header>

      {/* GPU-Composited Precision Progress Rail (Zero JS Re-Renders, Zero Rainbow Gradient) */}
      <div className="w-full bg-border shrink-0 overflow-hidden" style={{ height: "2px" }}>
        {effectivePinnedId ? (
          <div className="h-full w-full bg-primary" />
        ) : (
          <div
            key={slideCycleKey}
            className="h-full w-full bg-primary tv-slide-progress-bar"
            style={{
              animationDuration: `${activeSlideDurationSec}s`,
              animationPlayState: paused ? "paused" : "running",
            }}
          />
        )}
      </div>

      {/* CROSS-SCREEN IMMINENT EVENT / URGENT DEADLINE RIBBON */}
      {activeScreenId !== "screen-4" &&
        !(
          activeSlide.isCustom &&
          activeSlide.customScreen?.widgets?.some((w) => w.type === "announcements")
        ) &&
        imminentSpotlightItems.length > 0 &&
        (() => {
          const spot = imminentSpotlightItems[msgIdx % imminentSpotlightItems.length];
          const isToday = spot.tier === "today";
          return (
            <div
              className={`shrink-0 border-b px-4 flex items-center justify-between gap-3 z-20 ${
                isToday
                  ? "bg-emerald-600/15 border-emerald-600/40"
                  : "bg-red-600/15 border-red-600/40"
              }`}
              style={{ paddingTop: `calc(4 * var(--u))`, paddingBottom: `calc(4 * var(--u))` }}
            >
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <span
                  className={`rounded-sm font-mono font-bold uppercase tracking-wider shrink-0 inline-flex items-center gap-1 ${
                    isToday ? "bg-emerald-600 text-white" : "bg-red-600 text-white"
                  }`}
                  style={{
                    fontSize: `calc(9.5 * var(--u))`,
                    padding: `calc(2 * var(--u)) calc(7 * var(--u))`,
                  }}
                >
                  <Flame className="w-3 h-3 shrink-0" />
                  {spot.badge}
                </span>
                <span
                  className="font-bold text-foreground truncate"
                  style={{ fontSize: `calc(13 * var(--u))` }}
                >
                  {spot.title}
                </span>
              </div>
              <span
                className="font-mono font-semibold text-muted-foreground shrink-0"
                style={{ fontSize: `calc(10.5 * var(--u))` }}
              >
                {spot.sublabel}
              </span>
            </div>
          );
        })()}

      {/* MAIN WORKSPACE: CUSTOM 12x6 STUDIO SCREEN OR BUILT-IN SPLIT SCREEN */}
      {(activeSlide.isCustom && activeSlide.customScreen) || activeScreenId === "screen-5" ? (
        <div className="flex-1 min-h-0 flex overflow-hidden">
          <CustomScreenCanvas
            screen={activeSlide.customScreen || createDefaultBuiltInScreenDefinition("screen-5")}
            displayState={displayState}
            vehicles={vehicles}
            mainWarehouse={mainWarehouse}
            sfWarehouse={sfWarehouse}
            themeId={effectiveTvTheme}
          />
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex overflow-hidden">
          {/* LEFT DYNAMIC ROTATING COLUMN */}
          <div
            className="h-full flex flex-col border-r-2 border-border bg-background overflow-hidden"
            style={{
              width: `${leftWidthPct}%`,
              padding: `calc(10 * var(--u))`,
              gap: `calc(9 * var(--u))`,
            }}
          >
            {/* SCREEN 1: TRUCK SCHEDULE + ANNOUNCEMENT */}
            {activeScreenId === "screen-1" && (
              <>
                <div className="rounded border border-border bg-card flex flex-col overflow-hidden flex-1 min-h-0">
                  <div
                    className="flex items-center justify-between bg-secondary border-b border-border shrink-0"
                    style={{ padding: `calc(7 * var(--u)) calc(12 * var(--u))` }}
                  >
                    <div
                      className="flex items-center gap-2 font-display font-extrabold uppercase tracking-wider text-foreground"
                      style={{ fontSize: `calc(15.5 * var(--u))` }}
                    >
                      <Truck className="w-4 h-4 text-primary" />
                      <span>TRUCK ROUTE DISPATCH BOARD</span>
                    </div>
                    <span
                      className="font-mono font-semibold text-muted-foreground"
                      style={{ fontSize: `calc(11 * var(--u))` }}
                    >
                      {activeTruckWeek?.label}
                    </span>
                  </div>
                  <div className="flex-1 overflow-auto">
                    {renderTruckWeekTable(activeTruckWeek, true)}
                  </div>
                  {activeTruckWeek?.notes && (
                    <div
                      className="bg-primary/10 border-t border-border text-foreground font-semibold flex items-center justify-between shrink-0"
                      style={{ padding: `calc(6 * var(--u)) calc(12 * var(--u))`, fontSize: `calc(11.5 * var(--u))` }}
                    >
                      <span>DISPATCH NOTE: {activeTruckWeek.notes}</span>
                      <span className="font-mono text-muted-foreground uppercase" style={{ fontSize: `calc(9.5 * var(--u))` }}>
                        GPS TELEMETRY LINKED
                      </span>
                    </div>
                  )}
                </div>

                {renderAnnouncementCard()}
              </>
            )}

            {/* SCREEN 2: 3-CITY SD WEATHER + COMPANY CALENDAR + DOT RENEWALS */}
            {activeScreenId === "screen-2" && (
              <>
                <div className="rounded border border-border bg-card flex flex-col overflow-hidden shrink-0">
                  <div
                    className="flex items-center justify-between bg-secondary border-b border-border"
                    style={{ padding: `calc(6 * var(--u)) calc(11 * var(--u))` }}
                  >
                    <div
                      className="flex items-center gap-2 font-display font-extrabold uppercase tracking-wider text-foreground"
                      style={{ fontSize: `calc(14 * var(--u))` }}
                    >
                      <CloudSun className="w-4 h-4 text-primary" />
                      <span>SOUTH DAKOTA CORRIDOR WEATHER (5-DAY)</span>
                    </div>
                    <span className="text-muted-foreground font-mono font-medium" style={{ fontSize: `calc(9.5 * var(--u))` }}>
                      FSD • ABR • HON
                    </span>
                  </div>
                  <div className="flex flex-col" style={{ padding: `calc(7 * var(--u))`, gap: `calc(6 * var(--u))` }}>
                    {(displayState?.weatherLocations || []).map((loc: any, idx: number) => (
                      <div
                        key={idx}
                        className="grid items-center rounded bg-secondary/35 border border-border"
                        style={{
                          gridTemplateColumns: "30% 70%",
                          padding: `calc(5 * var(--u)) calc(9 * var(--u))`,
                        }}
                      >
                        <div>
                          <div
                            className="font-display font-bold uppercase tracking-wider text-primary truncate"
                            style={{ fontSize: `calc(13 * var(--u))` }}
                          >
                            {loc.city}
                          </div>
                          <div className="flex items-baseline gap-2">
                            <span className="font-mono font-bold text-foreground tabular-nums" style={{ fontSize: `calc(19 * var(--u))` }}>
                              {loc.temp}°
                            </span>
                            <span className="font-medium text-muted-foreground truncate" style={{ fontSize: `calc(10.5 * var(--u))` }}>
                              {loc.condition}
                            </span>
                          </div>
                          <div className="text-muted-foreground font-mono flex items-center gap-1" style={{ fontSize: `calc(9.5 * var(--u))` }}>
                            <Wind className="w-3 h-3 shrink-0" />
                            <span>{loc.wind}</span>
                          </div>
                        </div>
                        <div className="grid grid-cols-5 gap-1 text-center">
                          {(loc.forecast || []).map((f: any, fIdx: number) => (
                            <div
                              key={fIdx}
                              className="rounded bg-card border border-border"
                              style={{ padding: `calc(3 * var(--u)) calc(2 * var(--u))` }}
                            >
                              <div className="font-mono font-bold text-muted-foreground uppercase" style={{ fontSize: `calc(8.5 * var(--u))` }}>
                                {f.day}
                              </div>
                              <div
                                className="font-mono font-bold text-foreground tabular-nums"
                                style={{ fontSize: `calc(10.5 * var(--u))`, marginTop: `calc(2 * var(--u))` }}
                              >
                                {f.high}°<span className="text-muted-foreground font-normal">/{f.low}°</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Upcoming Calendar Events */}
                <div className="rounded border border-border bg-card flex flex-col overflow-hidden shrink-0">
                  <div
                    className="flex items-center justify-between bg-secondary border-b border-border"
                    style={{ padding: `calc(5.5 * var(--u)) calc(11 * var(--u))` }}
                  >
                    <div
                      className="flex items-center gap-2 font-display font-extrabold uppercase tracking-wider text-foreground"
                      style={{ fontSize: `calc(13.5 * var(--u))` }}
                    >
                      <Calendar className="w-4 h-4 text-primary" />
                      <span>UPCOMING SCHEDULED MILESTONES</span>
                    </div>
                  </div>
                  <div className="flex flex-col" style={{ padding: `calc(6 * var(--u)) calc(10 * var(--u))`, gap: `calc(5 * var(--u))` }}>
                    {upcomingCalendarEvents.slice(0, 4).map(({ ev, urgency }: any) => {
                      const st = getTierStyles(urgency.tier);
                      return (
                        <div
                          key={ev.id}
                          className={`flex items-center justify-between rounded border border-border border-l-4 ${
                            urgency.tier === "today" || urgency.tier === "imminent"
                              ? "bg-primary/10"
                              : "bg-secondary/30"
                          }`}
                          style={{
                            borderLeftColor: adaptScheduleColorForTheme(ev.color, isLightTheme, "#E59A23", "#B75B10"),
                            padding: `calc(5 * var(--u)) calc(9 * var(--u))`,
                          }}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className={`rounded-sm font-mono font-bold uppercase shrink-0 ${st.badge}`}
                              style={{
                                fontSize: `calc(9 * var(--u))`,
                                padding: `calc(1.5 * var(--u)) calc(6 * var(--u))`,
                              }}
                            >
                              {urgency.badgeText}
                            </span>
                            <span className="font-semibold text-foreground truncate" style={{ fontSize: `calc(12 * var(--u))` }}>
                              {ev.title}
                            </span>
                          </div>
                          <span className="font-mono font-medium text-muted-foreground shrink-0 ml-2" style={{ fontSize: `calc(10 * var(--u))` }}>
                            {ev.dayLabel} • {ev.time || "All Day"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* DOT / License / Med Card Renewals */}
                <div className="rounded border border-border bg-card flex flex-col overflow-hidden flex-1 min-h-0">
                  <div
                    className="flex items-center justify-between bg-secondary border-b border-border shrink-0"
                    style={{ padding: `calc(5.5 * var(--u)) calc(11 * var(--u))` }}
                  >
                    <div
                      className="flex items-center gap-2 font-display font-extrabold uppercase tracking-wider text-foreground"
                      style={{ fontSize: `calc(13.5 * var(--u))` }}
                    >
                      <ShieldAlert className="w-4 h-4 text-primary" />
                      <span>LICENSE, MED CARD & DOT COMPLIANCE</span>
                    </div>
                    <span className="text-muted-foreground font-mono uppercase" style={{ fontSize: `calc(9 * var(--u))` }}>
                      SORTED BY SOONEST DUE
                    </span>
                  </div>
                  <div className="flex-1 overflow-auto">
                    <table className="w-full border-collapse table-fixed text-left">
                      <thead>
                        <tr className="bg-secondary/70 border-b border-border text-muted-foreground font-display font-bold uppercase tracking-wider">
                          <th style={{ padding: `calc(4 * var(--u)) calc(8 * var(--u))`, fontSize: `calc(10.5 * var(--u))` }}>Driver / Unit</th>
                          <th className="text-center" style={{ padding: `calc(4 * var(--u))`, fontSize: `calc(10.5 * var(--u))` }}>License Due</th>
                          <th className="text-center" style={{ padding: `calc(4 * var(--u))`, fontSize: `calc(10.5 * var(--u))` }}>Med Card Due</th>
                          <th className="text-center" style={{ padding: `calc(4 * var(--u))`, fontSize: `calc(10.5 * var(--u))` }}>Truck DOT Due</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedRenewals.map((item, idx) => {
                          const renderCell = (cell: EvaluatedRenewalCell) => {
                            if (cell.status === "empty") return <span className="text-muted-foreground/40">—</span>;
                            if (cell.status === "overdue") {
                              return (
                                <span className="inline-flex items-center gap-1 rounded-sm bg-red-600 text-white px-1.5 py-0.5 font-mono font-bold">
                                  {cell.raw} [{cell.countdownLabel}]
                                </span>
                              );
                            }
                            if (cell.status === "urgent") {
                              return (
                                <span className="inline-flex items-center gap-1 rounded-sm bg-red-600/20 border border-red-600/60 text-red-500 px-1.5 py-0.5 font-mono font-bold">
                                  {cell.raw} ({cell.countdownLabel})
                                </span>
                              );
                            }
                            if (cell.status === "soon") {
                              return (
                                <span className="inline-flex items-center gap-1 rounded-sm bg-amber-500/20 border border-amber-500/50 text-amber-500 px-1.5 py-0.5 font-mono font-bold">
                                  {cell.raw} ({cell.countdownLabel})
                                </span>
                              );
                            }
                            return <span className="font-mono text-foreground/85">{cell.raw}</span>;
                          };
                          return (
                            <tr
                              key={`${item.row.entity}-${idx}`}
                              className={`border-b border-border/70 ${
                                item.hasUrgent
                                  ? "bg-red-600/[0.06]"
                                  : item.hasSoon
                                    ? "bg-amber-500/[0.05]"
                                    : "odd:bg-secondary/20"
                              }`}
                            >
                              <td
                                className={`font-semibold truncate ${
                                  item.hasUrgent
                                    ? "text-red-500"
                                    : item.hasSoon
                                      ? "text-amber-500"
                                      : "text-foreground"
                                }`}
                                style={{ padding: `calc(3.5 * var(--u)) calc(8 * var(--u))`, fontSize: `calc(10.5 * var(--u))` }}
                              >
                                {item.row.entity}
                              </td>
                              <td className="text-center font-medium" style={{ padding: `calc(3.5 * var(--u))`, fontSize: `calc(10 * var(--u))` }}>
                                {renderCell(item.license)}
                              </td>
                              <td className="text-center font-medium" style={{ padding: `calc(3.5 * var(--u))`, fontSize: `calc(10 * var(--u))` }}>
                                {renderCell(item.medCard)}
                              </td>
                              <td className="text-center font-medium" style={{ padding: `calc(3.5 * var(--u))`, fontSize: `calc(10 * var(--u))` }}>
                                {renderCell(item.truckDot)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}

            {/* SCREEN 3: FULL MON-SAT SIOUX FALLS TEAM SCHEDULE + ANNOUNCEMENT */}
            {activeScreenId === "screen-3" && (
              <>
                <div className="rounded border border-border bg-card flex flex-col overflow-hidden flex-1 min-h-0">
                  <div
                    className="flex items-center justify-between bg-secondary border-b border-border shrink-0"
                    style={{ padding: `calc(6 * var(--u)) calc(11 * var(--u))` }}
                  >
                    <div
                      className="flex items-center gap-2 font-display font-extrabold uppercase tracking-wider text-foreground"
                      style={{ fontSize: `calc(14.5 * var(--u))` }}
                    >
                      <Users className="w-4 h-4 text-primary" />
                      <span>SIOUX FALLS ROSTER & SHIFTS (MON – SAT)</span>
                    </div>
                    <span className="text-muted-foreground font-mono font-medium" style={{ fontSize: `calc(10.5 * var(--u))` }}>
                      {(activeSfWeek?.label || "").replace(/^Sioux Falls \(SF\) Team Schedule\s*[—-]\s*/i, "")} • {(activeSfWeek?.rows || []).length} STAFF
                    </span>
                  </div>
                  <div className="flex-1 overflow-auto">
                    {(() => {
                      const sf = activeSfWeek;
                      if (!sf?.days) return null;
                      const todayCol = getTodayIndex(sf.days);
                      return (
                        <table className="w-full border-collapse table-fixed text-left">
                          <thead>
                            <tr className="bg-secondary/80 border-b border-border">
                              <th
                                className="font-display font-bold uppercase tracking-wider text-muted-foreground border-r border-border"
                                style={{ width: "22%", padding: `calc(5 * var(--u)) calc(8 * var(--u))`, fontSize: `calc(11.5 * var(--u))` }}
                              >
                                Team Member
                              </th>
                              {sf.days.map((d: any, i: number) => {
                                const isColHoliday = isDayColumnHoliday(sf, i);
                                return (
                                  <th
                                    key={i}
                                    className={`text-center font-display font-bold uppercase tracking-wider border-r last:border-r-0 border-border ${
                                      isColHoliday
                                        ? "bg-rose-500/25 text-rose-300"
                                        : i === todayCol
                                          ? "bg-primary/20 text-primary"
                                          : "text-secondary-foreground"
                                    }`}
                                    style={{ padding: `calc(4 * var(--u))`, fontSize: `calc(11.5 * var(--u))` }}
                                  >
                                    <div>
                                      {d.day}
                                      {isColHoliday ? " • HOL" : i === todayCol ? " *" : ""}
                                    </div>
                                    <div className="opacity-75 font-mono font-medium" style={{ fontSize: `calc(9 * var(--u))` }}>
                                      {(d.date || "").replace(/\/\d{4}$/, "")}
                                    </div>
                                  </th>
                                );
                              })}
                            </tr>
                          </thead>
                          <tbody>
                            {(sf.rows || []).map((row: any, rIdx: number) => {
                              const memberColor = adaptScheduleColorForTheme(row.color, isLightTheme, "#F2F0EA", "#181816");
                              const hasTodayBolt =
                                todayCol >= 0 &&
                                sf.days?.[todayCol]?.date &&
                                getHotShotsForScheduleHeaderDate(allHotShotRoutes, sf.days[todayCol].date).some(
                                  (hs) => doesHotShotDriverMatchMember(hs.driverName, row.name, hs.originHub),
                                );
                              return (
                                <tr key={rIdx} className="border-b border-border/70 odd:bg-secondary/20">
                                  <td
                                    className="font-bold truncate border-r border-border"
                                    style={{
                                      color: memberColor,
                                      padding: `calc(5.5 * var(--u)) calc(8 * var(--u))`,
                                      fontSize: `calc(12 * var(--u))`,
                                    }}
                                  >
                                    <span className="inline-flex items-center gap-1 truncate max-w-full">
                                      {hasTodayBolt && (
                                        <span className="text-amber-500 shrink-0" title="Hot Shot Today">
                                          ⚡
                                        </span>
                                      )}
                                      <span className="truncate">{row.name}</span>
                                    </span>
                                  </td>
                                  {(row.days || []).map((cell: string, cIdx: number) => {
                                    const customCellColor = row.cellColors?.[cIdx] || "";
                                    const hasCustomColor = isValidHexColor(customCellColor);
                                    const isColHoliday = isDayColumnHoliday(sf, cIdx);
                                    const isCellHoliday = isColHoliday || isHolidayCellValue(cell);
                                    const isOff = !isCellHoliday && !hasCustomColor && (cell || "").trim().toUpperCase() === "OFF";
                                    const cellHotShot =
                                      sf.days?.[cIdx]?.date &&
                                      getHotShotsForScheduleHeaderDate(allHotShotRoutes, sf.days[cIdx].date).find(
                                        (hs) => doesHotShotDriverMatchMember(hs.driverName, row.name, hs.originHub),
                                      );
                                    return (
                                      <td
                                        key={cIdx}
                                        className={`text-center font-mono font-semibold border-r last:border-r-0 border-border/50 ${
                                          cellHotShot
                                            ? "bg-amber-500/15"
                                            : hasCustomColor
                                              ? "font-bold"
                                              : isCellHoliday
                                                ? "bg-rose-500/20 text-rose-200 font-extrabold"
                                                : cIdx === todayCol
                                                  ? "bg-primary/[0.08]"
                                                  : ""
                                        }`}
                                        style={{
                                          backgroundColor:
                                            !cellHotShot && hasCustomColor ? customCellColor : undefined,
                                          color: cellHotShot
                                            ? "#f59e0b"
                                            : hasCustomColor
                                              ? getContrastTextColorForHex(customCellColor, "#0f172a", "#ffffff")
                                              : isCellHoliday
                                                ? undefined
                                                : isOff
                                                  ? undefined
                                                  : memberColor,
                                          opacity: isOff && !cellHotShot ? 0.45 : 1,
                                          padding: `calc(5.5 * var(--u)) calc(4 * var(--u))`,
                                          fontSize: `calc(11 * var(--u))`,
                                        }}
                                      >
                                        {cellHotShot
                                          ? `⚡ ${cell || "HS"}`
                                          : isCellHoliday
                                            ? `🎉 ${cell || "HOLIDAY"}`
                                            : cell || "—"}
                                      </td>
                                    );
                                  })}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      );
                    })()}
                  </div>
                </div>

                {renderAnnouncementCard()}
              </>
            )}

            {/* SCREEN 4: DEDICATED ANNOUNCEMENTS, EVENT COUNTDOWNS & ACTION REMINDERS */}
            {activeScreenId === "screen-4" && (
              <div className="flex-1 min-h-0 flex flex-col overflow-hidden" style={{ gap: `calc(10 * var(--u))` }}>
                {/* 1. TEAM ANNOUNCEMENTS & DEADLINE SPOTLIGHT */}
                <div className="rounded border border-border bg-card flex flex-col overflow-hidden flex-1 min-h-0">
                  <div
                    className="flex items-center justify-between bg-secondary border-b border-border shrink-0"
                    style={{ padding: `calc(7 * var(--u)) calc(12 * var(--u))` }}
                  >
                    <div
                      className="flex items-center gap-2 font-display font-extrabold uppercase tracking-wider text-foreground"
                      style={{ fontSize: `calc(15 * var(--u))` }}
                    >
                      <BellRing className="w-4 h-4 text-primary" />
                      <span>OPERATIONS BULLETIN & ACTIVE DEADLINES</span>
                    </div>
                    <span className="font-mono font-semibold text-muted-foreground" style={{ fontSize: `calc(10.5 * var(--u))` }}>
                      {enrichedAnnouncements.length} POSTED
                    </span>
                  </div>

                  <div
                    className="flex-1 overflow-y-auto flex flex-col"
                    style={{ padding: `calc(10 * var(--u))`, gap: `calc(8 * var(--u))` }}
                  >
                    {enrichedAnnouncements.length === 0 ? (
                      <div
                        className="flex-1 flex flex-col items-center justify-center text-muted-foreground font-semibold text-center"
                        style={{ fontSize: `calc(14 * var(--u))` }}
                      >
                        <span>No active bulletins — safe travels on all routes.</span>
                      </div>
                    ) : (
                      enrichedAnnouncements.slice(0, 4).map(({ msg, urgency }: any) => {
                        const st = getTierStyles(urgency.tier);
                        return (
                          <div
                            key={msg.id}
                            className={`relative rounded border border-l-4 overflow-hidden flex items-stretch justify-between gap-3 ${st.card}`}
                            style={{ padding: `calc(10 * var(--u)) calc(14 * var(--u))` }}
                          >
                            <div className="flex-1 min-w-0 flex flex-col justify-center">
                              <div className="flex flex-wrap items-center" style={{ gap: `calc(7 * var(--u))` }}>
                                <span
                                  className={`rounded-sm font-mono font-bold uppercase tracking-wider ${st.badge}`}
                                  style={{
                                    fontSize: `calc(9.5 * var(--u))`,
                                    padding: `calc(2 * var(--u)) calc(7 * var(--u))`,
                                  }}
                                >
                                  {urgency.badgeText}
                                </span>
                                <span
                                  className="font-display font-bold uppercase tracking-wider text-primary"
                                  style={{ fontSize: `calc(13 * var(--u))` }}
                                >
                                  FROM {msg.author}
                                </span>
                                {urgency.formattedDate && (
                                  <span
                                    className="rounded-sm bg-secondary border border-border text-muted-foreground font-mono font-semibold"
                                    style={{
                                      fontSize: `calc(9.5 * var(--u))`,
                                      padding: `calc(1.5 * var(--u)) calc(7 * var(--u))`,
                                    }}
                                  >
                                    {msg.eventLabel ? `${msg.eventLabel}: ` : ""}
                                    {urgency.formattedDate}
                                  </span>
                                )}
                              </div>

                              <div
                                className="font-bold text-foreground leading-snug break-words"
                                style={{
                                  fontSize: `calc(16.5 * var(--u))`,
                                  marginTop: `calc(5 * var(--u))`,
                                }}
                              >
                                {msg.message}
                              </div>
                            </div>

                            {urgency.daysUntil !== null && (
                              <div
                                className={`rounded border flex flex-col items-center justify-center text-center shrink-0 ${st.tile}`}
                                style={{
                                  minWidth: `calc(86 * var(--u))`,
                                  padding: `calc(7 * var(--u)) calc(11 * var(--u))`,
                                }}
                              >
                                <div
                                  className="font-display font-extrabold leading-none tabular-nums"
                                  style={{ fontSize: `calc(25 * var(--u))` }}
                                >
                                  {urgency.daysUntil === 0
                                    ? "TODAY"
                                    : urgency.daysUntil === 1
                                      ? "1 DAY"
                                      : `${urgency.daysUntil}`}
                                </div>
                                <div
                                  className="font-mono font-bold uppercase tracking-wider opacity-85"
                                  style={{ fontSize: `calc(8.5 * var(--u))`, marginTop: `calc(3 * var(--u))` }}
                                >
                                  {urgency.daysUntil === 0
                                    ? "ACTIVE"
                                    : urgency.daysUntil === 1
                                      ? "TOMORROW"
                                      : "DAYS LEFT"}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* 1B. TEAM & FAMILY PHOTO GALLERY SPOTLIGHT (AUTO-ROTATING WHEN PHOTOS EXIST) */}
                {(() => {
                  const gal = normalizePhotoGalleryState(displayState?.photoGallery);
                  if (!gal.showOnBulletinScreen) return null;
                  const activePhotos = resolveActiveGalleryPhotos(gal, "all");
                  if (activePhotos.length === 0) return null;
                  const dur = Math.max(4, gal.slideDurationSec || 8);
                  const idx = Math.floor(Date.now() / (dur * 1000)) % activePhotos.length;
                  const currentPhoto = activePhotos[idx];
                  const alb = gal.albums.find((a) => a.id === currentPhoto.albumId);

                  return (
                    <div
                      className="rounded border border-border bg-card overflow-hidden shrink-0 flex flex-col"
                      style={{ height: `calc(235 * var(--u))` }}
                    >
                      <div
                        className="flex items-center justify-between bg-secondary border-b border-border shrink-0"
                        style={{ padding: `calc(5.5 * var(--u)) calc(12 * var(--u))` }}
                      >
                        <div
                          className="flex items-center gap-2 font-display font-extrabold uppercase tracking-wider text-foreground"
                          style={{ fontSize: `calc(13.5 * var(--u))` }}
                        >
                          <ImageIcon className="w-4 h-4 text-primary" />
                          <span>TEAM &amp; FAMILY PHOTO GALLERY</span>
                        </div>
                        <span
                          className="font-mono font-semibold text-muted-foreground tabular-nums"
                          style={{ fontSize: `calc(10 * var(--u))` }}
                        >
                          {idx + 1} / {activePhotos.length}
                        </span>
                      </div>

                      <div className="flex-1 min-h-0 relative bg-black flex items-center justify-center overflow-hidden">
                        <img
                          src={currentPhoto.url}
                          alt=""
                          aria-hidden="true"
                          className="absolute inset-0 w-full h-full object-cover scale-110 blur-xl opacity-45"
                        />
                        <img
                          src={currentPhoto.url}
                          alt={currentPhoto.caption || alb?.name || "Team Photo"}
                          className="relative z-10 max-w-full max-h-full w-full h-full object-contain"
                          style={{ padding: `calc(4 * var(--u))` }}
                        />
                        {(currentPhoto.caption || alb || currentPhoto.uploadedBy) && (
                          <div
                            className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/90 via-black/60 to-transparent text-white flex items-end justify-between gap-2"
                            style={{
                              padding: `calc(14 * var(--u)) calc(12 * var(--u)) calc(7 * var(--u))`,
                            }}
                          >
                            <div className="min-w-0 flex items-center gap-2">
                              {alb && (
                                <span
                                  className="rounded-sm font-mono font-bold uppercase px-1.5 py-0.5 text-black shrink-0"
                                  style={{
                                    backgroundColor: alb.color || "#f59e0b",
                                    fontSize: `calc(8.5 * var(--u))`,
                                  }}
                                >
                                  {alb.name}
                                </span>
                              )}
                              {currentPhoto.caption && (
                                <span
                                  className="font-bold truncate"
                                  style={{ fontSize: `calc(12.5 * var(--u))` }}
                                >
                                  {currentPhoto.caption}
                                </span>
                              )}
                            </div>
                            {currentPhoto.uploadedBy && (
                              <span
                                className="font-mono text-zinc-300 shrink-0"
                                style={{ fontSize: `calc(9.5 * var(--u))` }}
                              >
                                {currentPhoto.uploadedBy}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* 2. UPCOMING COMPANY MILESTONES */}
                <div className="rounded border border-border bg-card flex flex-col overflow-hidden shrink-0">
                  <div
                    className="flex items-center justify-between bg-secondary border-b border-border"
                    style={{ padding: `calc(6.5 * var(--u)) calc(12 * var(--u))` }}
                  >
                    <div
                      className="flex items-center gap-2 font-display font-extrabold uppercase tracking-wider text-foreground"
                      style={{ fontSize: `calc(14 * var(--u))` }}
                    >
                      <Calendar className="w-4 h-4 text-primary" />
                      <span>UPCOMING DATES, ANNIVERSARIES & EVENTS</span>
                    </div>
                    <span className="font-mono text-muted-foreground uppercase" style={{ fontSize: `calc(9.5 * var(--u))` }}>
                      COUNTDOWN
                    </span>
                  </div>

                  <div
                    className="flex flex-col"
                    style={{ padding: `calc(8 * var(--u)) calc(10 * var(--u))`, gap: `calc(6 * var(--u))` }}
                  >
                    {upcomingCalendarEvents.slice(0, 4).map(({ ev, urgency }: any) => {
                      const st = getTierStyles(urgency.tier);
                      return (
                        <div
                          key={ev.id}
                          className={`rounded border border-border border-l-4 flex items-center justify-between gap-3 ${
                            urgency.tier === "today" || urgency.tier === "imminent"
                              ? "bg-primary/10"
                              : "bg-secondary/30"
                          }`}
                          style={{
                            borderLeftColor: adaptScheduleColorForTheme(ev.color, isLightTheme, "#E59A23", "#B75B10"),
                            padding: `calc(6.5 * var(--u)) calc(11 * var(--u))`,
                          }}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="font-bold text-foreground truncate" style={{ fontSize: `calc(13.5 * var(--u))` }}>
                              {ev.title}
                            </div>
                            <div className="font-mono text-muted-foreground" style={{ fontSize: `calc(10 * var(--u))` }}>
                              {ev.dayLabel} • {ev.time || "All Day"}
                            </div>
                          </div>
                          <span
                            className={`rounded-sm font-mono font-bold uppercase tracking-wider shrink-0 flex items-center gap-1 ${st.badge}`}
                            style={{
                              fontSize: `calc(10 * var(--u))`,
                              padding: `calc(3.5 * var(--u)) calc(9 * var(--u))`,
                            }}
                          >
                            <Clock className="w-3 h-3 shrink-0" />
                            {urgency.badgeText}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 3. DUE SOON COMPLIANCE CALLOUT (<= 45 DAYS) */}
                {urgentRenewalsWithin45d.length > 0 && (
                  <div className="rounded border border-red-600/50 bg-red-600/[0.07] overflow-hidden shrink-0">
                    <div
                      className="flex items-center justify-between bg-red-600/20 border-b border-red-600/40"
                      style={{ padding: `calc(5.5 * var(--u)) calc(12 * var(--u))` }}
                    >
                      <div
                        className="flex items-center gap-2 font-display font-extrabold uppercase tracking-wider text-foreground"
                        style={{ fontSize: `calc(13 * var(--u))` }}
                      >
                        <ShieldAlert className="w-4 h-4 text-red-500" />
                        <span>COMPLIANCE RENEWALS DUE WITHIN 45 DAYS</span>
                      </div>
                    </div>
                    <div
                      className="flex flex-wrap items-center"
                      style={{ padding: `calc(7 * var(--u)) calc(10 * var(--u))`, gap: `calc(6 * var(--u))` }}
                    >
                      {urgentRenewalsWithin45d.slice(0, 6).map((item, idx) => (
                        <div
                          key={idx}
                          className="rounded bg-card border border-red-600/45 flex items-center gap-2 font-semibold"
                          style={{
                            padding: `calc(4 * var(--u)) calc(8 * var(--u))`,
                            fontSize: `calc(10.5 * var(--u))`,
                          }}
                        >
                          <span className="text-foreground font-bold">{item.entity}</span>
                          <span className="text-muted-foreground">•</span>
                          <span className="text-muted-foreground font-mono">
                            {item.type}: {item.raw}
                          </span>
                          <span
                            className="rounded-sm bg-red-600 text-white px-1.5 py-0.5 font-mono font-bold"
                            style={{ fontSize: `calc(9 * var(--u))` }}
                          >
                            {item.days <= 0 ? "DUE NOW" : `${item.days}D`}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* RIGHT NATIVE LIVE GPS MAP COLUMN */}
          <div className="flex-1 h-full relative bg-background overflow-hidden">
            {(() => {
              const effectiveWeatherAlerts = resolveEffectiveNwsAlerts(
                displayState?.nwsAlerts,
                displayState?.settings?.weatherDemoScenario,
              );
              const effectiveWeatherMode = normalizeWeatherOverlayMode(
                displayState?.settings?.weatherOverlayMode,
                "warnings_only",
              );
              const unitMapRegionMode: string = activeProfile?.mapRegionMode || "auto";
              const usesCustomOrPresetOverride =
                mapMode === "auto-fit" ||
                (mapMode === "auto" && unitMapRegionMode !== "auto");

              if (usesCustomOrPresetOverride) {
                const chosenKey = mapMode === "auto-fit" ? "auto-fit" : unitMapRegionMode;
                const spec = resolveMapViewSpec(
                  chosenKey,
                  activeProfile?.customMapBounds,
                  displayState?.settings?.savedMapRegions,
                  activeProfile?.mapEtaHub,
                );
                const wh = spec.etaHub === "sf" ? sfWarehouse : mainWarehouse;
                const boundsKey = spec.fitBounds
                  ? `${spec.fitBounds.south},${spec.fitBounds.west},${spec.fitBounds.north},${spec.fitBounds.east}`
                  : spec.key;

                return (
                  <>
                    <TrackingMap
                      key={`tv-map-override-${boundsKey}-${isLightTheme ? "light" : "dark"}`}
                      data={vehicles}
                      onVehicleUpdate={fetchAll}
                      center={spec.center}
                      zoom={spec.fallbackZoom}
                      fitRegionBounds={spec.fitBounds}
                      autoFitBounds={spec.autoFitFleet}
                      unlockMaxBounds
                      readOnly
                      darkMode={!isLightTheme}
                      routeOverlays={activeRouteOverlays}
                      weatherAlerts={effectiveWeatherAlerts}
                      weatherOverlayMode={effectiveWeatherMode}
                      baseLocation={
                        spec.etaHub === "sf"
                          ? null
                          : {
                              name: wh.name,
                              lat: wh.latitude,
                              lon: wh.longitude,
                              address: `${wh.latitude.toFixed(4)}, ${wh.longitude.toFixed(4)}`,
                            }
                      }
                    />
                    {spec.etaHub !== "none" && (
                      <ReturnEtaPanel
                        vehicles={vehicles}
                        warehouse={wh}
                        hotShotRoutes={allHotShotRoutes}
                      />
                    )}
                  </>
                );
              }

              return effectiveMapView === "main" ? (
                <>
                  <TrackingMap
                    key={`tv-map-main-${isLightTheme ? "light" : "dark"}`}
                    data={vehicles}
                    onVehicleUpdate={fetchAll}
                    center={REGIONAL_CENTER}
                    zoom={8}
                    minZoom={6}
                    maxZoom={17}
                    autoFitBounds={false}
                    readOnly
                    darkMode={!isLightTheme}
                    routeOverlays={activeRouteOverlays}
                    weatherAlerts={effectiveWeatherAlerts}
                    weatherOverlayMode={effectiveWeatherMode}
                    baseLocation={{
                      name: mainWarehouse.name,
                      lat: mainWarehouse.latitude,
                      lon: mainWarehouse.longitude,
                      address: `${mainWarehouse.latitude.toFixed(4)}, ${mainWarehouse.longitude.toFixed(4)}`,
                    }}
                  />
                  <ReturnEtaPanel
                    vehicles={vehicles}
                    warehouse={mainWarehouse}
                    hotShotRoutes={allHotShotRoutes}
                  />
                </>
              ) : (
                <>
                  <TrackingMap
                    key={`tv-map-regional-sf-${isLightTheme ? "light" : "dark"}`}
                    data={vehicles}
                    onVehicleUpdate={fetchAll}
                    center={SIOUX_FALLS_CENTER}
                    zoom={12}
                    minZoom={11}
                    maxZoom={17}
                    bounds={SIOUX_FALLS_BOUNDS}
                    autoFitBounds={false}
                    readOnly
                    darkMode={!isLightTheme}
                    routeOverlays={activeRouteOverlays}
                    weatherAlerts={effectiveWeatherAlerts}
                    weatherOverlayMode={effectiveWeatherMode}
                    baseLocation={null}
                  />
                  <ReturnEtaPanel
                    vehicles={vehicles}
                    warehouse={sfWarehouse}
                    hotShotRoutes={allHotShotRoutes}
                  />
                </>
              );
            })()}

            {/* Top-Left Map Mode & Colored Route Highlight Switcher Overlay */}
            <div className="absolute top-3 left-3 z-[1000] flex flex-wrap items-center gap-1.5">
              <div className="flex items-center gap-1 bg-card/95 border border-border rounded p-1 shadow-lg">
                <button
                  onClick={() => setMapMode("auto")}
                  className={`px-2.5 py-1 rounded-sm font-display font-bold uppercase tracking-wider text-xs transition-colors ${
                    mapMode === "auto"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {activeProfile?.mapRegionMode && activeProfile.mapRegionMode !== "auto"
                    ? "Screen Area"
                    : "Auto Sync"}
                </button>
                <button
                  onClick={() => setMapMode("auto-fit")}
                  className={`px-2.5 py-1 rounded-sm font-display font-bold uppercase tracking-wider text-xs transition-colors ${
                    mapMode === "auto-fit"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Full Fleet
                </button>
                <button
                  onClick={() => setMapMode("main")}
                  className={`px-2.5 py-1 rounded-sm font-display font-bold uppercase tracking-wider text-xs flex items-center gap-1 transition-colors ${
                    effectiveMapView === "main" && mapMode === "main"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Truck className="w-3 h-3" />
                  Corridor GPS
                </button>
                <button
                  onClick={() => setMapMode("regional")}
                  className={`px-2.5 py-1 rounded-sm font-display font-bold uppercase tracking-wider text-xs flex items-center gap-1 transition-colors ${
                    effectiveMapView === "regional" && mapMode === "regional"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <MapPin className="w-3 h-3" />
                  SF Metro ETA
                </button>
              </div>

              <div className="flex items-center gap-1 bg-card/95 border border-border rounded p-1 shadow-lg">
                <button
                  onClick={() => setRouteFilterMode("today")}
                  className={`px-2 py-1 rounded-sm font-display font-bold uppercase tracking-wider text-xs transition-colors ${
                    routeFilterMode === "today"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  title="Highlight today's scheduled truck routes in color"
                >
                  Today's Routes
                </button>
                <button
                  onClick={() => setRouteFilterMode("all")}
                  className={`px-2 py-1 rounded-sm font-display font-bold uppercase tracking-wider text-xs transition-colors ${
                    routeFilterMode === "all"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  title="Show all 23 colored route territories"
                >
                  All 23 Routes
                </button>
                <button
                  onClick={() => setRouteFilterMode("off")}
                  className={`px-2 py-1 rounded-sm font-display font-bold uppercase tracking-wider text-xs transition-colors ${
                    routeFilterMode === "off"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  title="Hide colored route territories"
                >
                  Routes Off
                </button>
              </div>

              {(() => {
                const activeMapAlerts = filterWeatherAlertsForMap(
                  resolveEffectiveNwsAlerts(
                    displayState?.nwsAlerts,
                    displayState?.settings?.weatherDemoScenario,
                  ),
                  displayState?.settings?.weatherOverlayMode,
                );
                if (activeMapAlerts.length === 0) return null;
                const leadStyle = getWeatherAlertMapStyle(activeMapAlerts[0], !isLightTheme);
                return (
                  <div
                    className="flex items-center gap-1.5 rounded px-2.5 py-1 shadow-lg font-mono font-bold uppercase text-xs border"
                    style={{
                      backgroundColor: isLightTheme ? "rgba(255,255,255,0.95)" : "rgba(15,23,42,0.92)",
                      borderColor: leadStyle.strokeColor,
                      color: leadStyle.strokeColor,
                    }}
                  >
                    <span>{leadStyle.icon}</span>
                    <span>
                      {activeMapAlerts.length === 1
                        ? activeMapAlerts[0].event
                        : `${activeMapAlerts.length} Weather Alerts`}
                    </span>
                    {activeMapAlerts.some((a) => a.isDemo) && (
                      <span
                        className="rounded-sm px-1 text-[10px] text-white font-extrabold"
                        style={{ backgroundColor: leadStyle.strokeColor }}
                      >
                        DEMO
                      </span>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* BOTTOM WIRE & OPERATIONS NOTE BAR */}
      {displayState?.settings?.tickerEnabled !== false && (
        <footer
          className="shrink-0 border-t-2 border-border bg-card px-4 flex items-center justify-between gap-4 z-30"
          style={{ height: `calc(36 * var(--u))` }}
        >
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <span
              className={`rounded-sm font-mono font-bold uppercase shrink-0 ${
                activeHeadline?.source === "ESPN"
                  ? "bg-red-600/20 text-red-500 border border-red-600/40"
                  : "bg-secondary text-primary border border-border"
              }`}
              style={{
                fontSize: `calc(9 * var(--u))`,
                padding: `calc(2 * var(--u)) calc(7 * var(--u))`,
              }}
            >
              {activeHeadline?.source || "WIRE"}
            </span>
            <span className="font-medium text-foreground truncate" style={{ fontSize: `calc(12 * var(--u))` }}>
              {activeHeadline?.title || "Monitoring regional South Dakota & national wire..."}
            </span>
          </div>

          {displayState?.settings?.complimentsEnabled !== false && (
            <div
              className="flex items-center gap-2 text-muted-foreground font-mono font-medium shrink-0 pl-4 border-l border-border"
              style={{ fontSize: `calc(11 * var(--u))` }}
            >
              <span className="text-primary font-bold uppercase">OPS:</span>
              <span className="text-foreground">{activeCompliment}</span>
            </div>
          )}

          <div
            className="flex items-center gap-1.5 text-muted-foreground font-mono shrink-0 pl-3 border-l border-border"
            style={{ fontSize: `calc(10 * var(--u))` }}
          >
            <span>Software &copy; Doodleworks LLC</span>
          </div>
        </footer>
      )}

      {/* LIVE NEW BROADCAST OVERLAY */}
      {toastMsg && (
        <div className="fixed bottom-12 right-6 z-[2000] max-w-md rounded border-2 border-primary bg-card p-4 shadow-2xl">
          <div className="flex items-center gap-2 text-primary font-mono font-bold text-xs uppercase tracking-widest">
            <Megaphone className="w-4 h-4" />
            Incoming Dispatch Bulletin
          </div>
          <div className="font-display font-extrabold uppercase tracking-wide text-foreground text-lg mt-1">
            {toastMsg.author}
          </div>
          <div className="text-foreground/90 font-medium text-sm mt-0.5">{toastMsg.message}</div>
        </div>
      )}

      {/* LIVE HOTSHOTSHEET NEW DELIVERY POP-UP NOTIFICATION */}
      {hotShotAlerts.length > 0 && (
        <div
          className="fixed top-20 right-6 z-[2100] w-[480px] max-w-[92vw] rounded-md border-2 border-amber-400 bg-slate-950/95 text-white p-5 shadow-[0_0_45px_rgba(245,158,11,0.45)] animate-in fade-in slide-in-from-top-4 duration-300"
          data-testid="tv-hotshot-delivery-alert"
        >
          <div className="flex items-center justify-between gap-2 border-b border-amber-500/40 pb-2.5 mb-3">
            <div className="flex items-center gap-2 text-amber-400 font-mono font-extrabold text-xs uppercase tracking-widest">
              <BellRing className="w-4 h-4 animate-bounce text-amber-400" />
              {hotShotAlerts[0].kind === "tomorrow_sheet_stop"
                ? `⚡ NEW HOT SHOT ADDED FOR ${formatHotShotDateHuman(hotShotAlerts[0].deliveryDateISO).toUpperCase()}`
                : hotShotAlerts[0].kind === "open_order"
                  ? "⚡ NEW UNASSIGNED HOT SHOT ORDER ENTERED"
                  : "⚡ NEW STOP ADDED TO TODAY'S HOT SHOT SHEET"}
            </div>
            <button
              type="button"
              onClick={() => setHotShotAlerts([])}
              className="text-[10px] font-mono uppercase px-2 py-0.5 rounded border border-amber-500/40 text-amber-300 hover:bg-amber-500/20"
            >
              Dismiss
            </button>
          </div>

          <div className="space-y-2.5">
            {hotShotAlerts.map((al) => {
              const hubMeta = getHotShotHubMeta(al.originHub);
              return (
                <div
                  key={al.id}
                  className="rounded border border-amber-500/35 bg-amber-500/10 p-3 space-y-1"
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-[11px] font-mono font-bold uppercase px-2 py-0.5 rounded bg-amber-500 text-black">
                      [{hubMeta.code}] {al.driverName}
                    </span>
                    <span className="text-xs font-mono font-bold text-amber-300">
                      {al.kind === "open_order"
                        ? "Pending Sheet Assignment"
                        : `Route Date: ${formatHotShotDateHuman(al.deliveryDateISO)}`}
                    </span>
                  </div>
                  <div className="font-display font-extrabold text-base uppercase tracking-wide text-white pt-0.5">
                    {al.accountName}
                    {al.accountCode ? (
                      <span className="text-amber-400 font-mono text-sm ml-1.5">
                        [{al.accountCode}]
                      </span>
                    ) : null}
                  </div>
                  <div className="text-xs font-mono font-semibold text-amber-200 flex items-center gap-2 flex-wrap">
                    <span>
                      📍 {al.city}, {al.state}
                    </span>
                    {al.piecesCount ? (
                      <span className="px-1.5 py-0.2 rounded bg-slate-900 border border-amber-500/40 text-amber-300">
                        {al.piecesCount} pcs
                      </span>
                    ) : null}
                    {al.enteredBy ? <span>• Entered by {al.enteredBy}</span> : null}
                  </div>
                  {al.partsSummary && (
                    <div className="text-xs font-mono text-slate-200 pt-0.5">
                      🔋 {al.partsSummary}
                    </div>
                  )}
                  {al.notes && (
                    <div className="text-xs font-mono font-bold text-amber-300 pt-0.5">
                      ⚠️ Note: {al.notes}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
