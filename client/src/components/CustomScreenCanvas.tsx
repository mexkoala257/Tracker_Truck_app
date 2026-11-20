import { useState, useEffect, useMemo, useRef } from "react";
import TrackingMap from "@/components/TrackingMap";
import ReturnEtaPanel, { type ReturnEtaWarehouse } from "@/components/ReturnEtaPanel";
import { encodeQrMatrix } from "@/lib/qrSvg";
import {
  resolveActiveTvTruckWeek,
  isDayColumnHoliday,
  isHolidayCellValue,
} from "@shared/truckSchedule";
import {
  getActiveTvSfWeek,
  isOpeningShift,
  isClosingShift,
  resolveSfDailyShiftView,
} from "@shared/sfSchedule";
import {
  evaluateAnnouncementUrgency,
  evaluateCalendarEventUrgency,
  evaluateAndSortRenewals,
  parseFlexibleDateToLocal,
  diffCalendarDays,
  type EvaluatedRenewalCell,
  type UrgencyTier,
} from "@shared/displayUrgency";
import {
  type CustomScreenDefinition,
  type ScreenWidgetInstance,
  type NwsAlertItem,
  type DisplayThemeId,
  clampWidgetBox,
  getCatalogEntry,
  resolveEffectiveDisplayTheme,
  adaptScheduleColorForTheme,
} from "@shared/customScreens";
import { resolveMapViewSpec } from "@shared/mapRegions";
import {
  resolveRouteOverlays,
  type RouteOverlayFilterMode,
  type RouteOverlayStyleMode,
  type RouteColorMode,
} from "@shared/routeTerritories";
import {
  normalizePhotoGalleryState,
  resolveActiveGalleryPhotos,
} from "@shared/photoGallery";
import {
  type HotShotRoute,
  normalizeHotShotRoutes,
  getActiveTodayHotShots,
  getHotShotsForScheduleHeaderDate,
  doesHotShotDriverMatchMember,
  estimateHotShotTiming,
  buildHotShotRouteOverlays,
  computeHotShotMapBounds,
  buildHotShotTownSequenceLabel,
  formatHotShotDateHuman,
  formatCentralClockTime,
  getCentralDateISO,
  resolveHotShotWarehouse,
  getHotShotHubMeta,
} from "@shared/hotshots";
import {
  type WeatherOverlayMode,
  resolveEffectiveNwsAlerts,
  normalizeWeatherOverlayMode,
  filterWeatherAlertsForMap,
  getWeatherAlertMapStyle,
} from "@shared/weatherOverlay";
import {
  Truck,
  Users,
  CloudSun,
  CloudRain,
  CloudSnow,
  Cloud,
  AlertTriangle,
  ShieldCheck,
  Clock,
  Megaphone,
  Calendar,
  ShieldAlert,
  QrCode,
  Image as ImageIcon,
  FileText,
  MapPin,
  Sun,
  Moon,
  Flame,
  CheckCircle2,
  Wind,
  Building2,
  Award,
  Pencil,
  Zap,
} from "lucide-react";

const CORRIDOR_CENTER: [number, number] = [44.15, -97.1];
const CORRIDOR_BOUNDS = {
  southwest: [41.5, -103.5] as [number, number],
  northeast: [47.0, -93.0] as [number, number],
};
const SIOUX_FALLS_CENTER: [number, number] = [43.5442, -96.75];
const SIOUX_FALLS_BOUNDS = {
  southwest: [43.43, -96.96] as [number, number],
  northeast: [43.65, -96.55] as [number, number],
};

export interface CustomScreenCanvasProps {
  screen: CustomScreenDefinition;
  displayState: any;
  vehicles: Array<{
    id: string;
    name?: string;
    color?: string;
    location: { lat: number; lon: number };
    speed: number;
    status: string;
    timestamp: string;
    heading: number;
  }>;
  mainWarehouse: ReturnEtaWarehouse;
  sfWarehouse: ReturnEtaWarehouse;
  /** Resolved visual theme for the TV or Studio preview */
  themeId?: DisplayThemeId;
  /** True when rendered inside the Admin 16:9 Screen Designer preview */
  previewMode?: boolean;
  selectedWidgetId?: string | null;
  onSelectWidget?: (widgetId: string) => void;
}

function QrCodeSvg({ value, className }: { value: string; className?: string }) {
  const matrix = useMemo(() => encodeQrMatrix(value || "https://localhost"), [value]);
  const n = matrix.length;
  const quiet = 3;
  const total = n + quiet * 2;

  return (
    <svg
      viewBox={`0 0 ${total} ${total}`}
      shapeRendering="crispEdges"
      className={className || "w-full h-full"}
      aria-label="QR Code"
    >
      <rect width={total} height={total} fill="#ffffff" rx={0.75} />
      {matrix.map((row, y) =>
        row.map((dark, x) =>
          dark ? (
            <rect key={`${x}-${y}`} x={x + quiet} y={y + quiet} width={1} height={1} fill="#111311" />
          ) : null,
        ),
      )}
    </svg>
  );
}

function WeatherGlyph({
  condition,
  iconHint,
  sizeUnits = 15,
}: {
  condition?: string;
  iconHint?: string;
  sizeUnits?: number;
}) {
  const txt = `${condition || ""} ${iconHint || ""}`.toLowerCase();
  const st = { width: `calc(${sizeUnits} * var(--u))`, height: `calc(${sizeUnits} * var(--u))` };
  if (txt.includes("snow") || txt.includes("blizzard") || txt.includes("❄") || txt.includes("🌨")) {
    return <CloudSnow style={st} className="text-foreground/85 shrink-0" />;
  }
  if (txt.includes("rain") || txt.includes("shower") || txt.includes("storm") || txt.includes("🌧") || txt.includes("⛈")) {
    return <CloudRain style={st} className="text-primary shrink-0" />;
  }
  if (txt.includes("clear") || txt.includes("sun") || txt.includes("☀")) {
    return <Sun style={st} className="text-primary shrink-0" />;
  }
  if (txt.includes("overcast") || txt.includes("fog") || txt.includes("☁") || txt.includes("🌫")) {
    return <Cloud style={st} className="text-muted-foreground shrink-0" />;
  }
  return <CloudSun style={st} className="text-primary shrink-0" />;
}

function getTodayColIdx(days?: Array<{ day: string; date: string }>, now = new Date()): number {
  if (!days || days.length === 0) return -1;
  const todayStr = now.toLocaleDateString("en-US");
  const exact = days.findIndex((d) => d.date === todayStr);
  if (exact !== -1) return exact;
  const shortDay = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][now.getDay()];
  return days.findIndex((d) => (d.day || "").toUpperCase().startsWith(shortDay));
}

export default function CustomScreenCanvas({
  screen,
  displayState,
  vehicles,
  mainWarehouse,
  sfWarehouse,
  themeId,
  previewMode = false,
  selectedWidgetId,
  onSelectWidget,
}: CustomScreenCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [previewUnitPx, setPreviewUnitPx] = useState<number>(0.55);
  const [now, setNow] = useState<Date>(() => new Date());
  const [rotatorTick, setRotatorTick] = useState<number>(0);
  const [hotShotTick, setHotShotTick] = useState<number>(0);
  const [manualHotShotIdx, setManualHotShotIdx] = useState<number | null>(null);

  const effectiveTheme: DisplayThemeId =
    themeId ||
    resolveEffectiveDisplayTheme(
      displayState?.settings,
      undefined,
      screen.theme === "inherit" ? undefined : screen.theme,
    );
  const isLightTheme = effectiveTheme === "daylight-paper";

  // Only tick every 1s if an active widget actually displays live seconds (big_countdown);
  // otherwise refresh every 30s to avoid re-rendering maps & tables every second on Raspberry Pis.
  const hasLiveSecondsWidget = useMemo(
    () => (screen.widgets || []).some((w) => w.type === "big_countdown"),
    [screen.widgets],
  );

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), hasLiveSecondsWidget ? 1000 : 30000);
    return () => clearInterval(id);
  }, [hasLiveSecondsWidget]);

  // Sub-page rotator for SF schedule paging
  useEffect(() => {
    const id = setInterval(() => setRotatorTick((t) => t + 1), 9000);
    return () => clearInterval(id);
  }, []);

  // Synchronized Hot Shot rotator (steps both map zoom & towns/accounts board every 11s)
  useEffect(() => {
    if (manualHotShotIdx !== null) {
      const resumeTimer = setTimeout(() => {
        setHotShotTick(manualHotShotIdx + 1);
        setManualHotShotIdx(null);
      }, 28000);
      return () => clearTimeout(resumeTimer);
    }
    const id = setInterval(() => setHotShotTick((t) => t + 1), 11000);
    return () => clearInterval(id);
  }, [manualHotShotIdx]);

  // Automatic WYSIWYG --u scaling when inside Admin Studio 16:9 preview box
  useEffect(() => {
    if (!previewMode || !containerRef.current) return;
    const el = containerRef.current;
    const update = () => {
      const h = el.clientHeight || 360;
      setPreviewUnitPx(Math.max(0.22, h / 960));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [previewMode]);

  const activeTruckWeek = useMemo(
    () => resolveActiveTvTruckWeek(displayState?.truckSchedule, now),
    [displayState?.truckSchedule, now.toDateString()],
  );

  const activeSfWeek = useMemo(
    () => getActiveTvSfWeek(displayState?.sfSchedule, now),
    [displayState?.sfSchedule, now.toDateString()],
  );

  const enrichedAnnouncements = useMemo(() => {
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
      .map((m) => ({ msg: m, urgency: evaluateAnnouncementUrgency(m, now) }))
      .filter((item) => !item.urgency.isAutoArchived)
      .sort((a, b) => {
        const diff = tierRank[a.urgency.tier] - tierRank[b.urgency.tier];
        if (diff !== 0) return diff;
        if (a.urgency.daysUntil !== null && b.urgency.daysUntil !== null) {
          return a.urgency.daysUntil - b.urgency.daysUntil;
        }
        return 0;
      });
  }, [displayState?.messages, now.toDateString()]);

  const upcomingEvents = useMemo(() => {
    return ((displayState?.calendarEvents || []) as any[])
      .map((ev) => ({ ev, urgency: evaluateCalendarEventUrgency(ev, now) }))
      .filter((x) => !x.urgency.isPast)
      .sort((a, b) => (a.urgency.daysUntil ?? 9999) - (b.urgency.daysUntil ?? 9999));
  }, [displayState?.calendarEvents, now.toDateString()]);

  const sortedRenewals = useMemo(
    () => evaluateAndSortRenewals(displayState?.renewalReminders || [], now),
    [displayState?.renewalReminders, now.toDateString()],
  );

  const allHotShotRoutes = useMemo(
    () => normalizeHotShotRoutes(displayState?.hotShotRoutes),
    [displayState?.hotShotRoutes],
  );

  const todayHotShots = useMemo(
    () => getActiveTodayHotShots(allHotShotRoutes, now),
    [allHotShotRoutes, now.toDateString()],
  );

  // When previewing/pinning Hotshots on a day with 0 today runs, show the next upcoming scheduled Hot Shot
  const upcomingFallbackHotShots = useMemo(() => {
    if (todayHotShots.length > 0) return todayHotShots;
    const todayIso = getCentralDateISO(now);
    const future = allHotShotRoutes
      .filter((r) => r.active !== false && r.deliveryDateISO >= todayIso)
      .sort((a, b) => a.deliveryDateISO.localeCompare(b.deliveryDateISO));
    if (future.length === 0) return [];
    const nextDate = future[0].deliveryDateISO;
    return future.filter((r) => r.deliveryDateISO === nextDate);
  }, [allHotShotRoutes, todayHotShots, now.toDateString()]);

  const activeHotShotList = todayHotShots.length > 0 ? todayHotShots : upcomingFallbackHotShots;
  const focusedHotShotIdx =
    activeHotShotList.length > 0
      ? (manualHotShotIdx !== null ? manualHotShotIdx : hotShotTick) % activeHotShotList.length
      : 0;
  const focusedHotShot = activeHotShotList[focusedHotShotIdx] || null;

  const findVeh = (vehicleKey: string, driverLabel: string) => {
    const prefix = (driverLabel || "").split("-")[0].replace("TO3", "T03");
    return vehicles.find((v) => v.name === vehicleKey) || vehicles.find((v) => v.name === prefix) || null;
  };

  const findHotShotVeh = (hs: HotShotRoute) => {
    return (
      vehicles.find(
        (v) =>
          (hs.vehicleId && v.id === hs.vehicleId) ||
          (hs.vehicleName && v.name === hs.vehicleName),
      ) || null
    );
  };

  const renderWidgetBody = (w: ScreenWidgetInstance) => {
    const cfg = w.config || {};
    const title = w.titleOverride?.trim() || "";

    switch (w.type) {
      case "today_snapshot": {
        const mode: "both" | "trucks" | "sf" = cfg.mode || "both";
        const showTrucks = mode === "both" || mode === "trucks";
        const showSf = mode === "both" || mode === "sf";

        const truckDays = activeTruckWeek?.days || [];
        let truckCol = getTodayColIdx(truckDays, now);
        const isWeekendFallback = truckCol === -1 && truckDays.length > 0;
        if (isWeekendFallback) truckCol = 0;
        const truckDayLabel = truckDays[truckCol]
          ? `${truckDays[truckCol].day} ${(truckDays[truckCol].date || "").replace(/\/\d{4}$/, "")}${
              isWeekendFallback ? " [NEXT DISPATCH]" : " • TODAY"
            }`
          : "TODAY";

        const sfDays = activeSfWeek?.days || [];
        let sfCol = getTodayColIdx(sfDays, now);
        if (sfCol === -1 && sfDays.length > 0) sfCol = 0;
        const sfDayLabel = sfDays[sfCol]
          ? `${sfDays[sfCol].day} ${(sfDays[sfCol].date || "").replace(/\/\d{4}$/, "")}`
          : "TODAY";

        const snapshotHotShots = truckDays[truckCol]?.date
          ? getHotShotsForScheduleHeaderDate(allHotShotRoutes, truckDays[truckCol].date)
          : todayHotShots;

        const sfDayHotShots = sfDays[sfCol]?.date
          ? getHotShotsForScheduleHeaderDate(allHotShotRoutes, sfDays[sfCol].date)
          : todayHotShots;

        const truckAssignments = (activeTruckWeek?.rows || []).filter((r: any) => {
          const val = (r.days?.[truckCol] || "").trim();
          return cfg.showOffStaff ? true : Boolean(val && val.toUpperCase() !== "OFF");
        });

        const sfWorking = (activeSfWeek?.rows || [])
          .map((r: any) => ({
            person: r.name || r.person || "",
            shift: (r.days?.[sfCol] || "").trim(),
          }))
          .filter((x: any) =>
            cfg.showOffStaff ? true : Boolean(x.shift && x.shift.toUpperCase() !== "OFF"),
          );

        return (
          <div className="flex flex-col h-full min-h-0">
            <div
              className="shrink-0 bg-secondary border-b border-border flex items-center justify-between"
              style={{ padding: `calc(8 * var(--u)) calc(13 * var(--u))` }}
            >
              <span
                className="font-display font-bold uppercase tracking-wider text-foreground flex items-center gap-2"
                style={{ fontSize: `calc(14.5 * var(--u))` }}
              >
                <Truck className="text-primary" style={{ width: `calc(15 * var(--u))`, height: `calc(15 * var(--u))` }} />
                {title || "Today's Active Crew & Routes"}
              </span>
              <span
                className="font-mono font-bold text-primary bg-primary/10 border border-primary/35 rounded-sm uppercase"
                style={{ fontSize: `calc(10.5 * var(--u))`, padding: `calc(2 * var(--u)) calc(8 * var(--u))` }}
              >
                {now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
              </span>
            </div>

            <div
              className={`flex-1 min-h-0 grid ${
                showTrucks && showSf ? "grid-cols-2 divide-x divide-border" : "grid-cols-1"
              } overflow-hidden`}
            >
              {showTrucks && (
                <div className="flex flex-col min-h-0 overflow-hidden" style={{ padding: `calc(10 * var(--u))` }}>
                  <div
                    className="font-display font-bold uppercase tracking-wider text-muted-foreground flex items-center justify-between mb-1.5"
                    style={{ fontSize: `calc(12 * var(--u))` }}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <Truck style={{ width: `calc(12 * var(--u))`, height: `calc(12 * var(--u))` }} className="text-primary" />
                      Truck Routes ({truckAssignments.length + snapshotHotShots.length})
                    </span>
                    <span className="text-primary font-mono" style={{ fontSize: `calc(10.5 * var(--u))` }}>
                      {truckDayLabel}
                    </span>
                  </div>
                  <div className="flex-1 min-h-0 overflow-hidden flex flex-col" style={{ gap: `calc(5.5 * var(--u))` }}>
                    {truckAssignments.length === 0 && snapshotHotShots.length === 0 ? (
                      <div
                        className="flex-1 flex items-center justify-center text-muted-foreground font-mono uppercase"
                        style={{ fontSize: `calc(12 * var(--u))` }}
                      >
                        No scheduled truck routes for this day
                      </div>
                    ) : (
                      <>
                        {truckAssignments.map((r: any, idx: number) => {
                          const routeText = (r.days?.[truckCol] || "—").trim();
                          const veh = findVeh(r.vehicleKey, r.driver);
                          const moving = veh && (veh.status === "moving" || veh.speed > 2);
                          const driverColor = adaptScheduleColorForTheme(r.color || "#E59A23", isLightTheme);
                          return (
                            <div
                              key={idx}
                              className="rounded-sm border border-border bg-secondary/45 flex items-center justify-between gap-2"
                              style={{ padding: `calc(6.5 * var(--u)) calc(10 * var(--u))` }}
                            >
                              <div className="min-w-0 flex items-center gap-2">
                                <span
                                  className="w-1.5 h-4 rounded-[1px] shrink-0"
                                  style={{ backgroundColor: driverColor }}
                                />
                                <span
                                  className="font-bold truncate"
                                  style={{ color: driverColor, fontSize: `calc(14 * var(--u))` }}
                                >
                                  {r.driver}
                                </span>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <span
                                  className="font-mono font-bold text-foreground bg-background border border-border rounded-sm"
                                  style={{
                                    fontSize: `calc(12.5 * var(--u))`,
                                    padding: `calc(2 * var(--u)) calc(8 * var(--u))`,
                                  }}
                                >
                                  {routeText || "OFF"}
                                </span>
                                {veh && (
                                  <span
                                    className={`font-mono font-bold rounded-sm border ${
                                      moving
                                        ? isLightTheme
                                          ? "bg-emerald-600/15 text-emerald-800 border-emerald-600/40"
                                          : "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
                                        : "bg-secondary text-muted-foreground border-border"
                                    }`}
                                    style={{
                                      fontSize: `calc(9.5 * var(--u))`,
                                      padding: `calc(2 * var(--u)) calc(5.5 * var(--u))`,
                                    }}
                                  >
                                    {moving ? `${Math.round(veh.speed)} MPH` : "HUB"}
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}

                        {snapshotHotShots.map((hs) => {
                          const veh = findHotShotVeh(hs);
                          const hsWarehouse = resolveHotShotWarehouse(hs.originHub, {
                            sfWarehouse,
                            mainWarehouse,
                          });
                          const hubMeta = getHotShotHubMeta(hs.originHub);
                          const timing = estimateHotShotTiming(hs, hsWarehouse, veh, now);
                          const hsColor = adaptScheduleColorForTheme(hs.color || "#f59e0b", isLightTheme);
                          return (
                            <div
                              key={hs.id}
                              className="rounded-sm border border-amber-500/45 bg-amber-500/10 flex items-center justify-between gap-2"
                              style={{ padding: `calc(6.5 * var(--u)) calc(10 * var(--u))` }}
                            >
                              <div className="min-w-0 flex items-center gap-1.5">
                                <Zap
                                  className="text-amber-500 shrink-0 fill-amber-500/30"
                                  style={{ width: `calc(13 * var(--u))`, height: `calc(13 * var(--u))` }}
                                />
                                <span
                                  className="font-mono font-extrabold uppercase rounded-sm border border-amber-500/45 bg-amber-500/20 text-amber-400 shrink-0"
                                  style={{
                                    fontSize: `calc(9 * var(--u))`,
                                    padding: `calc(0.5 * var(--u)) calc(4.5 * var(--u))`,
                                  }}
                                >
                                  {hubMeta.code}
                                </span>
                                <span
                                  className="font-bold truncate"
                                  style={{ color: hsColor, fontSize: `calc(13.5 * var(--u))` }}
                                >
                                  {hs.driverName}
                                  {hs.vehicleName ? ` (${hs.vehicleName})` : ""}
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <span
                                  className="font-mono font-bold text-foreground bg-background border border-amber-500/40 rounded-sm truncate"
                                  style={{
                                    maxWidth: `calc(210 * var(--u))`,
                                    fontSize: `calc(11 * var(--u))`,
                                    padding: `calc(2 * var(--u)) calc(7 * var(--u))`,
                                  }}
                                >
                                  {hs.title || buildHotShotTownSequenceLabel(hs.stops, 3)}
                                </span>
                                <span
                                  className="font-mono font-bold rounded-sm bg-emerald-500/15 text-emerald-400 border border-emerald-500/40"
                                  style={{
                                    fontSize: `calc(9.5 * var(--u))`,
                                    padding: `calc(2 * var(--u)) calc(5.5 * var(--u))`,
                                  }}
                                >
                                  {timing.completedCount}/{timing.totalCount} ✓
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </>
                    )}
                  </div>
                </div>
              )}

              {showSf && (
                <div className="flex flex-col min-h-0 overflow-hidden" style={{ padding: `calc(10 * var(--u))` }}>
                  <div
                    className="font-display font-bold uppercase tracking-wider text-muted-foreground flex items-center justify-between mb-1.5"
                    style={{ fontSize: `calc(12 * var(--u))` }}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <Building2 style={{ width: `calc(12 * var(--u))`, height: `calc(12 * var(--u))` }} className="text-primary" />
                      Sioux Falls Crew ({sfWorking.length})
                    </span>
                    <span className="text-foreground font-mono" style={{ fontSize: `calc(10.5 * var(--u))` }}>
                      {sfDayLabel}
                    </span>
                  </div>
                  <div className="flex-1 min-h-0 overflow-hidden flex flex-col" style={{ gap: `calc(5 * var(--u))` }}>
                    {sfWorking.length === 0 ? (
                      <div
                        className="flex-1 flex items-center justify-center text-muted-foreground font-mono uppercase"
                        style={{ fontSize: `calc(12 * var(--u))` }}
                      >
                        No Sioux Falls shifts scheduled today
                      </div>
                    ) : (
                      sfWorking.slice(0, 9).map((item: any, idx: number) => {
                        const opener = isOpeningShift(item.shift);
                        const closer = isClosingShift(item.shift);
                        const memberHotShot = sfDayHotShots.find((hs) =>
                          doesHotShotDriverMatchMember(hs.driverName, item.person, hs.originHub),
                        );
                        return (
                          <div
                            key={idx}
                            className="rounded-sm border border-border bg-secondary/45 flex items-center justify-between gap-2"
                            style={{ padding: `calc(6 * var(--u)) calc(10 * var(--u))` }}
                          >
                            <span
                              className="font-bold text-foreground truncate inline-flex items-center gap-1.5"
                              style={{ fontSize: `calc(13.5 * var(--u))` }}
                            >
                              <span className="truncate">{item.person}</span>
                              {memberHotShot && (
                                <span
                                  className="inline-flex items-center gap-0.5 rounded-sm bg-amber-500/20 border border-amber-500/50 text-amber-500 font-mono font-bold uppercase shrink-0"
                                  style={{
                                    fontSize: `calc(9.5 * var(--u))`,
                                    padding: `calc(1 * var(--u)) calc(5 * var(--u))`,
                                  }}
                                >
                                  ⚡ HOT SHOT
                                </span>
                              )}
                            </span>
                            <span
                              className={`inline-flex items-center gap-1 font-mono font-bold rounded-sm border shrink-0 ${
                                opener
                                  ? "bg-primary/15 border-primary/40 text-primary"
                                  : closer
                                    ? "bg-background border-border text-foreground"
                                    : isLightTheme
                                      ? "bg-emerald-600/12 border-emerald-600/35 text-emerald-800"
                                      : "bg-emerald-500/15 border-emerald-500/35 text-emerald-300"
                              }`}
                              style={{
                                fontSize: `calc(11.5 * var(--u))`,
                                padding: `calc(2 * var(--u)) calc(7.5 * var(--u))`,
                              }}
                            >
                              {opener && <Sun style={{ width: `calc(11 * var(--u))`, height: `calc(11 * var(--u))` }} />}
                              {closer && <Moon style={{ width: `calc(11 * var(--u))`, height: `calc(11 * var(--u))` }} />}
                              {item.shift}
                            </span>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      }

      case "sf_daily_shift": {
        const rolloverTime: string = cfg.rolloverTime || "14:00";
        const dayMode: "auto" | "today" | "next_workday" = cfg.dayMode || "auto";
        const layoutStyle: "spotlight_plus_mid" | "full_highlighted_list" =
          cfg.layoutStyle === "full_highlighted_list"
            ? "full_highlighted_list"
            : "spotlight_plus_mid";
        const showOffStaff = Boolean(cfg.showOffStaff);

        const resolved = resolveSfDailyShiftView(displayState?.sfSchedule, now, {
          rolloverTime,
          dayMode,
        });

        const targetDayHotShots = getHotShotsForScheduleHeaderDate(
          allHotShotRoutes,
          resolved.dateStr,
        );

        const defaultHeading = resolved.isNextDayRollover
          ? resolved.isTomorrow
            ? "Tomorrow's Sioux Falls Crew"
            : `${resolved.fullDayName}'s Sioux Falls Crew`
          : "Today's Sioux Falls Crew";

        const lowerRoster =
          layoutStyle === "full_highlighted_list" ? resolved.allWorking : resolved.midAndRoleCrew;
        const useTwoCols = (w.w || 6) >= 5 && lowerRoster.length >= 4;

        return (
          <div className="flex flex-col h-full min-h-0 overflow-hidden">
            {/* Adaptive Header Bar (flips accent after 2:00 PM to make Next-Day unmistakable) */}
            <div
              className={`shrink-0 border-b flex items-center justify-between gap-2 ${
                resolved.isNextDayRollover
                  ? isLightTheme
                    ? "bg-sky-600/12 border-sky-600/35"
                    : "bg-cyan-500/12 border-cyan-500/35"
                  : "bg-secondary border-border"
              }`}
              style={{ padding: `calc(8 * var(--u)) calc(13 * var(--u))` }}
            >
              <span
                className="font-display font-bold uppercase tracking-wider text-foreground flex items-center gap-2 min-w-0 truncate"
                style={{ fontSize: `calc(14.5 * var(--u))` }}
              >
                <Building2
                  className={
                    resolved.isNextDayRollover
                      ? isLightTheme
                        ? "text-sky-700 shrink-0"
                        : "text-cyan-400 shrink-0"
                      : "text-primary shrink-0"
                  }
                  style={{ width: `calc(15 * var(--u))`, height: `calc(15 * var(--u))` }}
                />
                <span className="truncate">{title || defaultHeading}</span>
              </span>

              <div className="flex items-center gap-1.5 shrink-0">
                {dayMode === "auto" && (
                  <span
                    className="hidden sm:inline-flex items-center gap-1 font-mono text-muted-foreground uppercase"
                    style={{ fontSize: `calc(9.5 * var(--u))` }}
                  >
                    <Clock style={{ width: `calc(10 * var(--u))`, height: `calc(10 * var(--u))` }} />
                    {resolved.isNextDayRollover
                      ? `Switched ${resolved.rolloverLabel}`
                      : `Next Day @ ${resolved.rolloverLabel}`}
                  </span>
                )}
                <span
                  className={`font-mono font-extrabold rounded-sm uppercase border ${
                    resolved.isNextDayRollover
                      ? isLightTheme
                        ? "bg-sky-600 text-white border-sky-700"
                        : "bg-cyan-500/20 text-cyan-300 border-cyan-400/55"
                      : "bg-primary/12 text-primary border-primary/40"
                  }`}
                  style={{
                    fontSize: `calc(10.5 * var(--u))`,
                    padding: `calc(2 * var(--u)) calc(8 * var(--u))`,
                  }}
                >
                  {resolved.statusBadge}
                </span>
              </div>
            </div>

            {resolved.allWorking.length === 0 ? (
              <div
                className="flex-1 flex flex-col items-center justify-center text-center text-muted-foreground font-mono uppercase"
                style={{ padding: `calc(18 * var(--u))`, gap: `calc(6 * var(--u))` }}
              >
                <Users
                  className="opacity-45"
                  style={{ width: `calc(26 * var(--u))`, height: `calc(26 * var(--u))` }}
                />
                <div
                  className="font-display font-bold text-foreground"
                  style={{ fontSize: `calc(15 * var(--u))` }}
                >
                  No Sioux Falls Shifts Posted for {resolved.fullDayName} ({resolved.shortDateStr})
                </div>
                <div style={{ fontSize: `calc(11 * var(--u))` }}>
                  Update SF Team Schedule in Admin Console to populate {resolved.dayName} coverage
                </div>
              </div>
            ) : (
              <div
                className="flex-1 min-h-0 flex flex-col overflow-hidden"
                style={{ padding: `calc(10 * var(--u))`, gap: `calc(8 * var(--u))` }}
              >
                {/* TOP HERO SPOTLIGHT: OPENING & CLOSING HIGHLIGHT CARDS */}
                <div
                  className="shrink-0 grid grid-cols-2"
                  style={{ gap: `calc(8 * var(--u))` }}
                >
                  {/* OPENING CREW CARD */}
                  <div
                    className={`rounded-sm border-2 flex flex-col ${
                      isLightTheme
                        ? "border-amber-600/55 bg-amber-500/10"
                        : "border-amber-500/55 bg-amber-500/[0.11]"
                    }`}
                    style={{ padding: `calc(7.5 * var(--u)) calc(10 * var(--u))` }}
                  >
                    <div
                      className="flex items-center justify-between gap-1.5 border-b border-amber-500/25"
                      style={{ paddingBottom: `calc(4.5 * var(--u))`, marginBottom: `calc(5.5 * var(--u))` }}
                    >
                      <span
                        className={`font-display font-extrabold uppercase tracking-wider inline-flex items-center gap-1.5 ${
                          isLightTheme ? "text-amber-800" : "text-amber-400"
                        }`}
                        style={{ fontSize: `calc(12.5 * var(--u))` }}
                      >
                        <Sun
                          className="shrink-0"
                          style={{ width: `calc(13.5 * var(--u))`, height: `calc(13.5 * var(--u))` }}
                        />
                        Opening ({resolved.openers.length})
                      </span>
                      <span
                        className="font-mono font-bold uppercase opacity-75"
                        style={{ fontSize: `calc(9.5 * var(--u))` }}
                      >
                        ≤ 7:15 AM
                      </span>
                    </div>

                    {resolved.openers.length === 0 ? (
                      <div
                        className="font-mono text-muted-foreground uppercase py-1"
                        style={{ fontSize: `calc(11 * var(--u))` }}
                      >
                        No opener assigned
                      </div>
                    ) : (
                      <div className="flex flex-col" style={{ gap: `calc(4.5 * var(--u))` }}>
                        {resolved.openers.map((m) => {
                          const memberColor = adaptScheduleColorForTheme(m.color, isLightTheme);
                          const hs = targetDayHotShots.find((r) =>
                            doesHotShotDriverMatchMember(r.driverName, m.name, r.originHub),
                          );
                          return (
                            <div
                              key={`open-${m.name}`}
                              className="flex items-center justify-between gap-2 min-w-0"
                            >
                              <div className="min-w-0 flex items-center gap-1.5">
                                <span
                                  className="w-1.5 h-4 rounded-[1px] shrink-0"
                                  style={{ backgroundColor: memberColor }}
                                />
                                <span
                                  className="font-bold truncate"
                                  style={{ color: memberColor, fontSize: `calc(14.5 * var(--u))` }}
                                >
                                  {m.name}
                                </span>
                                {hs && (
                                  <span
                                    className="inline-flex items-center rounded-sm bg-amber-500/25 border border-amber-500/60 text-amber-400 font-mono font-bold shrink-0"
                                    style={{
                                      fontSize: `calc(9 * var(--u))`,
                                      padding: `calc(0.5 * var(--u)) calc(4 * var(--u))`,
                                    }}
                                  >
                                    ⚡
                                  </span>
                                )}
                              </div>
                              <span
                                className={`font-mono font-extrabold rounded-sm border shrink-0 ${
                                  isLightTheme
                                    ? "bg-white/90 border-amber-600/45 text-amber-900"
                                    : "bg-background/90 border-amber-500/50 text-amber-300"
                                }`}
                                style={{
                                  fontSize: `calc(11.5 * var(--u))`,
                                  padding: `calc(1.5 * var(--u)) calc(6.5 * var(--u))`,
                                }}
                              >
                                {m.shift}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* CLOSING CREW CARD */}
                  <div
                    className={`rounded-sm border-2 flex flex-col ${
                      isLightTheme
                        ? "border-sky-600/55 bg-sky-500/10"
                        : "border-sky-400/55 bg-sky-500/[0.11]"
                    }`}
                    style={{ padding: `calc(7.5 * var(--u)) calc(10 * var(--u))` }}
                  >
                    <div
                      className="flex items-center justify-between gap-1.5 border-b border-sky-500/25"
                      style={{ paddingBottom: `calc(4.5 * var(--u))`, marginBottom: `calc(5.5 * var(--u))` }}
                    >
                      <span
                        className={`font-display font-extrabold uppercase tracking-wider inline-flex items-center gap-1.5 ${
                          isLightTheme ? "text-sky-800" : "text-sky-300"
                        }`}
                        style={{ fontSize: `calc(12.5 * var(--u))` }}
                      >
                        <Moon
                          className="shrink-0"
                          style={{ width: `calc(13.5 * var(--u))`, height: `calc(13.5 * var(--u))` }}
                        />
                        Closing ({resolved.closers.length})
                      </span>
                      <span
                        className="font-mono font-bold uppercase opacity-75"
                        style={{ fontSize: `calc(9.5 * var(--u))` }}
                      >
                        ≥ 6:00 PM
                      </span>
                    </div>

                    {resolved.closers.length === 0 ? (
                      <div
                        className="font-mono text-muted-foreground uppercase py-1"
                        style={{ fontSize: `calc(11 * var(--u))` }}
                      >
                        No closer assigned
                      </div>
                    ) : (
                      <div className="flex flex-col" style={{ gap: `calc(4.5 * var(--u))` }}>
                        {resolved.closers.map((m) => {
                          const memberColor = adaptScheduleColorForTheme(m.color, isLightTheme);
                          const hs = targetDayHotShots.find((r) =>
                            doesHotShotDriverMatchMember(r.driverName, m.name, r.originHub),
                          );
                          return (
                            <div
                              key={`close-${m.name}`}
                              className="flex items-center justify-between gap-2 min-w-0"
                            >
                              <div className="min-w-0 flex items-center gap-1.5">
                                <span
                                  className="w-1.5 h-4 rounded-[1px] shrink-0"
                                  style={{ backgroundColor: memberColor }}
                                />
                                <span
                                  className="font-bold truncate"
                                  style={{ color: memberColor, fontSize: `calc(14.5 * var(--u))` }}
                                >
                                  {m.name}
                                </span>
                                {hs && (
                                  <span
                                    className="inline-flex items-center rounded-sm bg-amber-500/25 border border-amber-500/60 text-amber-400 font-mono font-bold shrink-0"
                                    style={{
                                      fontSize: `calc(9 * var(--u))`,
                                      padding: `calc(0.5 * var(--u)) calc(4 * var(--u))`,
                                    }}
                                  >
                                    ⚡
                                  </span>
                                )}
                              </div>
                              <span
                                className={`font-mono font-extrabold rounded-sm border shrink-0 ${
                                  isLightTheme
                                    ? "bg-white/90 border-sky-600/45 text-sky-900"
                                    : "bg-background/90 border-sky-400/50 text-sky-200"
                                }`}
                                style={{
                                  fontSize: `calc(11.5 * var(--u))`,
                                  padding: `calc(1.5 * var(--u)) calc(6.5 * var(--u))`,
                                }}
                              >
                                {m.shift}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                {/* LOWER CREW SECTION: MID-DAY & SPECIALTY SHIFTS (OR FULL HIGHLIGHTED ROSTER) */}
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                  <div
                    className="shrink-0 flex items-center justify-between text-muted-foreground font-display font-bold uppercase tracking-wider"
                    style={{ fontSize: `calc(11 * var(--u))`, marginBottom: `calc(5 * var(--u))` }}
                  >
                    <span>
                      {layoutStyle === "full_highlighted_list"
                        ? `All Scheduled Crew (${resolved.allWorking.length})`
                        : `Mid-Day & Specialty Shifts (${lowerRoster.length})`}
                    </span>
                    <span className="font-mono" style={{ fontSize: `calc(10 * var(--u))` }}>
                      {resolved.allWorking.length} Total On Shift
                    </span>
                  </div>

                  {lowerRoster.length === 0 ? (
                    <div
                      className="flex-1 flex items-center justify-center rounded-sm border border-dashed border-border text-muted-foreground font-mono uppercase"
                      style={{ fontSize: `calc(11 * var(--u))` }}
                    >
                      All scheduled staff are in Opening / Closing roles above
                    </div>
                  ) : (
                    <div
                      className={`flex-1 min-h-0 grid content-start overflow-hidden ${
                        useTwoCols ? "grid-cols-2" : "grid-cols-1"
                      }`}
                      style={{ gap: `calc(5 * var(--u))` }}
                    >
                      {lowerRoster.map((m) => {
                        const memberColor = adaptScheduleColorForTheme(m.color, isLightTheme);
                        const hs = targetDayHotShots.find((r) =>
                          doesHotShotDriverMatchMember(r.driverName, m.name, r.originHub),
                        );
                        const rowHighlightClass =
                          layoutStyle === "full_highlighted_list" && m.isOpener
                            ? "border-amber-500/55 bg-amber-500/10"
                            : layoutStyle === "full_highlighted_list" && m.isCloser
                              ? "border-sky-400/55 bg-sky-500/10"
                              : "border-border bg-secondary/45";

                        return (
                          <div
                            key={`crew-${m.name}`}
                            className={`rounded-sm border flex items-center justify-between gap-2 min-w-0 ${rowHighlightClass}`}
                            style={{ padding: `calc(5.5 * var(--u)) calc(9 * var(--u))` }}
                          >
                            <div className="min-w-0 flex items-center gap-1.5">
                              <span
                                className="w-1.5 h-3.5 rounded-[1px] shrink-0"
                                style={{ backgroundColor: memberColor }}
                              />
                              <span
                                className="font-bold truncate"
                                style={{ color: memberColor, fontSize: `calc(13 * var(--u))` }}
                              >
                                {m.name}
                              </span>
                              {hs && (
                                <span
                                  className="inline-flex items-center gap-0.5 rounded-sm bg-amber-500/20 border border-amber-500/50 text-amber-500 font-mono font-bold uppercase shrink-0"
                                  style={{
                                    fontSize: `calc(8.5 * var(--u))`,
                                    padding: `calc(0.5 * var(--u)) calc(4 * var(--u))`,
                                  }}
                                >
                                  ⚡ HOT SHOT
                                </span>
                              )}
                            </div>

                            <span
                              className={`inline-flex items-center gap-1 font-mono font-bold rounded-sm border shrink-0 ${
                                m.isOpener
                                  ? "bg-amber-500/15 border-amber-500/45 text-amber-400"
                                  : m.isCloser
                                    ? "bg-sky-500/15 border-sky-400/45 text-sky-300"
                                    : isLightTheme
                                      ? "bg-background border-border text-foreground"
                                      : "bg-background/85 border-border text-foreground"
                              }`}
                              style={{
                                fontSize: `calc(11 * var(--u))`,
                                padding: `calc(1.5 * var(--u)) calc(6.5 * var(--u))`,
                              }}
                            >
                              {m.isOpener && (
                                <Sun style={{ width: `calc(10 * var(--u))`, height: `calc(10 * var(--u))` }} />
                              )}
                              {m.isCloser && (
                                <Moon style={{ width: `calc(10 * var(--u))`, height: `calc(10 * var(--u))` }} />
                              )}
                              {m.shift}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* OPTIONAL OFF / PTO FOOTER STRIP */}
                {showOffStaff && resolved.offCrew.length > 0 && (
                  <div
                    className="shrink-0 border-t border-border/70 flex flex-wrap items-center"
                    style={{ paddingTop: `calc(5 * var(--u))`, gap: `calc(4 * var(--u))` }}
                  >
                    <span
                      className="font-mono font-bold uppercase text-muted-foreground mr-1"
                      style={{ fontSize: `calc(9.5 * var(--u))` }}
                    >
                      OFF / PTO:
                    </span>
                    {resolved.offCrew.map((m) => (
                      <span
                        key={`off-${m.name}`}
                        className="rounded-sm border border-border bg-secondary/40 text-muted-foreground font-mono"
                        style={{
                          fontSize: `calc(9.5 * var(--u))`,
                          padding: `calc(1 * var(--u)) calc(5.5 * var(--u))`,
                        }}
                      >
                        {m.name}
                        {m.shift.toUpperCase() !== "OFF" ? ` (${m.shift})` : ""}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      }

      case "hotshot_board": {
        const boardList = activeHotShotList;
        const isShowingUpcoming = todayHotShots.length === 0 && boardList.length > 0;
        const activeIdx = focusedHotShotIdx;
        const currentHs = focusedHotShot;

        return (
          <div className="flex flex-col h-full min-h-0 overflow-hidden">
            <div
              className="shrink-0 bg-secondary border-b border-border flex items-center justify-between gap-2"
              style={{ padding: `calc(8 * var(--u)) calc(13 * var(--u))` }}
            >
              <span
                className="font-display font-bold uppercase tracking-wider text-foreground flex items-center gap-2 truncate"
                style={{ fontSize: `calc(14.5 * var(--u))` }}
              >
                <Zap
                  className="text-amber-500 fill-amber-500/30 shrink-0"
                  style={{ width: `calc(15 * var(--u))`, height: `calc(15 * var(--u))` }}
                />
                <span className="truncate">{title || "Hot Shot Towns & Accounts"}</span>
              </span>
              <div className="flex items-center gap-1.5 shrink-0">
                {boardList.length > 1 && (
                  <span
                    className="font-mono font-bold text-muted-foreground bg-background border border-border rounded-sm uppercase"
                    style={{ fontSize: `calc(9.5 * var(--u))`, padding: `calc(1.5 * var(--u)) calc(6 * var(--u))` }}
                  >
                    RUN {activeIdx + 1}/{boardList.length}
                  </span>
                )}
                <span
                  className={`font-mono font-bold rounded-sm border uppercase ${
                    isShowingUpcoming
                      ? "bg-sky-500/15 border-sky-500/40 text-sky-400"
                      : "bg-amber-500/15 border-amber-500/40 text-amber-500"
                  }`}
                  style={{ fontSize: `calc(10 * var(--u))`, padding: `calc(1.5 * var(--u)) calc(7 * var(--u))` }}
                >
                  {currentHs
                    ? `${isShowingUpcoming ? "UPCOMING • " : ""}${formatHotShotDateHuman(currentHs.deliveryDateISO)}`
                    : "NO ACTIVE RUNS"}
                </span>
              </div>
            </div>

            {boardList.length > 1 && (
              <div
                className="shrink-0 bg-background/75 border-b border-border flex items-center gap-1.5 overflow-x-auto"
                style={{ padding: `calc(5 * var(--u)) calc(10 * var(--u))` }}
              >
                {boardList.map((hsItem, rIdx) => {
                  const isFocused = rIdx === activeIdx;
                  const pillColor = adaptScheduleColorForTheme(hsItem.color || "#f59e0b", isLightTheme);
                  const doneCnt = (hsItem.stops || []).filter((s) => Boolean(s.completedAt)).length;
                  return (
                    <button
                      key={hsItem.id || rIdx}
                      type="button"
                      onClick={() => setManualHotShotIdx(rIdx)}
                      className={`inline-flex items-center gap-1.5 rounded-sm border font-mono font-bold uppercase transition-all shrink-0 ${
                        isFocused
                          ? "bg-secondary text-foreground shadow-sm"
                          : "bg-background/50 text-muted-foreground hover:text-foreground border-border/70 opacity-75"
                      }`}
                      style={{
                        borderColor: isFocused ? pillColor : undefined,
                        fontSize: `calc(9.5 * var(--u))`,
                        padding: `calc(2.5 * var(--u)) calc(7.5 * var(--u))`,
                      }}
                      title="Click to focus map zoom & account list on this Hot Shot"
                    >
                      <span
                        className="rounded-full shrink-0"
                        style={{
                          backgroundColor: pillColor,
                          width: `calc(7 * var(--u))`,
                          height: `calc(7 * var(--u))`,
                        }}
                      />
                      <span className="truncate max-w-[140px]">
                        {rIdx + 1}. {hsItem.driverName}
                      </span>
                      <span className="opacity-75">
                        ({doneCnt}/{hsItem.stops.length})
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {!currentHs ? (
              <div
                className="flex-1 flex flex-col items-center justify-center text-center"
                style={{ padding: `calc(18 * var(--u))` }}
              >
                <Zap
                  className="text-muted-foreground/35 mb-2"
                  style={{ width: `calc(34 * var(--u))`, height: `calc(34 * var(--u))` }}
                />
                <div
                  className="font-display font-bold uppercase text-foreground"
                  style={{ fontSize: `calc(15 * var(--u))` }}
                >
                  No Hot Shot Routes Scheduled Today
                </div>
                <div
                  className="font-mono text-muted-foreground mt-1"
                  style={{ fontSize: `calc(11 * var(--u))` }}
                >
                  Upload a HotShotSheet PDF in Admin to dispatch a driver & van.
                </div>
              </div>
            ) : (
              (() => {
                const veh = findHotShotVeh(currentHs);
                const hsWarehouse = resolveHotShotWarehouse(currentHs.originHub, {
                  sfWarehouse,
                  mainWarehouse,
                });
                const hubMeta = getHotShotHubMeta(currentHs.originHub);
                const timing = estimateHotShotTiming(currentHs, hsWarehouse, veh, now);
                const moving = veh && (veh.status === "moving" || veh.speed > 2);
                const progressPct =
                  timing.totalCount > 0
                    ? Math.round((timing.completedCount / timing.totalCount) * 100)
                    : 0;
                const accent = adaptScheduleColorForTheme(currentHs.color || "#f59e0b", isLightTheme);

                return (
                  <div
                    className="flex-1 min-h-0 flex flex-col overflow-hidden"
                    style={{ padding: `calc(10 * var(--u))`, gap: `calc(8 * var(--u))` }}
                  >
                    {/* Driver, Assigned Van & Generous Return ETA Summary Card */}
                    <div
                      className="shrink-0 rounded-sm border border-border bg-secondary/55 flex flex-col"
                      style={{
                        borderLeftWidth: "4px",
                        borderLeftColor: accent,
                        padding: `calc(8 * var(--u)) calc(11 * var(--u))`,
                        gap: `calc(5 * var(--u))`,
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div
                            className="font-display font-extrabold uppercase tracking-wide truncate flex items-center gap-1.5"
                            style={{ color: accent, fontSize: `calc(16 * var(--u))` }}
                          >
                            <span>⚡ {currentHs.driverName}</span>
                            <span
                              className="font-mono uppercase rounded-sm border border-amber-500/45 bg-amber-500/15 text-amber-400 shrink-0"
                              style={{
                                fontSize: `calc(9.5 * var(--u))`,
                                padding: `calc(1 * var(--u)) calc(5.5 * var(--u))`,
                              }}
                            >
                              ORIGIN: {hubMeta.shortLabel}
                            </span>
                          </div>
                          <div
                            className="font-mono font-semibold text-muted-foreground flex items-center gap-2"
                            style={{ fontSize: `calc(10.5 * var(--u))` }}
                          >
                            <span>
                              {currentHs.vehicleName
                                ? `${currentHs.vehicleName}${
                                    currentHs.vehicleAssignedBy === "auto_gps" ? " • AUTO-GPS" : ""
                                  }`
                                : "🛰️ Auto-Detecting Van via GPS"}
                            </span>
                            {veh && (
                              <span
                                className={
                                  moving
                                    ? isLightTheme
                                      ? "text-emerald-700 font-bold"
                                      : "text-emerald-400 font-bold"
                                    : "text-muted-foreground"
                                }
                              >
                                • {moving ? `LIVE GPS ${Math.round(veh.speed)} MPH` : `AT ${hubMeta.code} HUB / STOPPED`}
                              </span>
                            )}
                          </div>
                        </div>

                        <div
                          className="shrink-0 text-right rounded-sm bg-background border border-border"
                          style={{ padding: `calc(4.5 * var(--u)) calc(9 * var(--u))` }}
                        >
                          <div
                            className="font-mono uppercase text-muted-foreground font-bold"
                            style={{ fontSize: `calc(8.5 * var(--u))` }}
                          >
                            EST. {hubMeta.shortLabel} RETURN
                          </div>
                          <div
                            className="font-mono font-extrabold text-primary tabular-nums"
                            style={{ fontSize: `calc(13.5 * var(--u))` }}
                          >
                            {timing.etaWindowLabel}
                          </div>
                        </div>
                      </div>

                      {/* Progress Bar + Generous Loop Stats */}
                      <div className="flex items-center justify-between gap-2 font-mono" style={{ fontSize: `calc(9.5 * var(--u))` }}>
                        <span className="font-bold text-foreground">
                          {timing.completedCount} OF {timing.totalCount} ACCOUNTS COMPLETED
                        </span>
                        <span className="text-muted-foreground">
                          ~{timing.totalLoopRoadMiles} MI {hubMeta.code} LOOP ({timing.estimatedTotalDurationLabel})
                        </span>
                      </div>
                      <div
                        className="w-full rounded-full bg-background overflow-hidden border border-border/70"
                        style={{ height: `calc(6 * var(--u))` }}
                      >
                        <div
                          className="h-full bg-emerald-500 transition-all duration-500"
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                    </div>

                    {/* Ordered Towns & Accounts Checklist */}
                    <div
                      className="flex-1 min-h-0 overflow-y-auto flex flex-col"
                      style={{ gap: `calc(5.5 * var(--u))` }}
                    >
                      {currentHs.stops.map((stop, idx) => {
                        const done = Boolean(stop.completedAt);
                        const doneTime = stop.completedAt
                          ? formatCentralClockTime(new Date(stop.completedAt))
                          : "";
                        return (
                          <div
                            key={stop.id || idx}
                            className={`rounded-sm border flex items-center justify-between gap-2.5 transition-colors ${
                              done
                                ? isLightTheme
                                  ? "border-emerald-600/55 bg-emerald-600/15"
                                  : "border-emerald-500/55 bg-emerald-500/15"
                                : "border-border bg-secondary/35"
                            }`}
                            style={{ padding: `calc(6.5 * var(--u)) calc(9.5 * var(--u))` }}
                          >
                            <div className="flex items-start gap-2.5 min-w-0 flex-1">
                              <div
                                className={`shrink-0 rounded-full flex items-center justify-center font-mono font-extrabold text-white ${
                                  done ? "bg-emerald-600" : ""
                                }`}
                                style={{
                                  backgroundColor: done ? undefined : accent,
                                  width: `calc(22 * var(--u))`,
                                  height: `calc(22 * var(--u))`,
                                  fontSize: `calc(11 * var(--u))`,
                                }}
                              >
                                {done ? "✓" : idx + 1}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span
                                    className={`font-display font-extrabold uppercase tracking-wide ${
                                      done
                                        ? isLightTheme
                                          ? "text-emerald-900"
                                          : "text-emerald-300"
                                        : "text-foreground"
                                    }`}
                                    style={{ fontSize: `calc(13 * var(--u))` }}
                                  >
                                    {stop.city}, {stop.state}
                                  </span>
                                  {stop.piecesCount && (
                                    <span
                                      className="font-mono font-bold rounded-sm bg-background/80 border border-border text-muted-foreground"
                                      style={{
                                        fontSize: `calc(9 * var(--u))`,
                                        padding: `calc(0.5 * var(--u)) calc(5 * var(--u))`,
                                      }}
                                    >
                                      {stop.piecesCount} PCS
                                    </span>
                                  )}
                                  {cfg.showNotes !== false && stop.notes && (
                                    <span
                                      className="font-mono font-bold rounded-sm bg-amber-500/20 border border-amber-500/45 text-amber-500"
                                      style={{
                                        fontSize: `calc(8.5 * var(--u))`,
                                        padding: `calc(0.5 * var(--u)) calc(5 * var(--u))`,
                                      }}
                                    >
                                      {stop.notes}
                                    </span>
                                  )}
                                </div>
                                <div
                                  className={`font-bold truncate ${
                                    done
                                      ? isLightTheme
                                        ? "text-emerald-800"
                                        : "text-emerald-200"
                                      : "text-foreground/90"
                                  }`}
                                  style={{ fontSize: `calc(11.5 * var(--u))` }}
                                >
                                  {stop.accountName}
                                </div>
                                {stop.address && (
                                  <div
                                    className="font-mono text-muted-foreground truncate"
                                    style={{ fontSize: `calc(9.5 * var(--u))` }}
                                  >
                                    {stop.address}
                                  </div>
                                )}
                              </div>
                            </div>

                            {done ? (
                              <span
                                className={`shrink-0 font-mono font-extrabold uppercase rounded-sm border ${
                                  isLightTheme
                                    ? "bg-emerald-700 text-white border-emerald-800"
                                    : "bg-emerald-500/25 text-emerald-300 border-emerald-400/50"
                                }`}
                                style={{
                                  fontSize: `calc(9.5 * var(--u))`,
                                  padding: `calc(2.5 * var(--u)) calc(6.5 * var(--u))`,
                                }}
                              >
                                ✓ {doneTime || "DONE"}
                              </span>
                            ) : (
                              <span
                                className="shrink-0 font-mono font-semibold uppercase text-muted-foreground"
                                style={{ fontSize: `calc(9.5 * var(--u))` }}
                              >
                                STOP #{idx + 1}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()
            )}
          </div>
        );
      }

      case "nws_alerts": {
        const rawAlerts: NwsAlertItem[] = resolveEffectiveNwsAlerts(
          displayState?.nwsAlerts,
          displayState?.settings?.weatherDemoScenario,
        );
        const alerts = cfg.corridorOnly ? rawAlerts.filter((a) => a.isCorridor) : rawAlerts;
        const cities = displayState?.weatherLocations || [];

        return (
          <div className="flex flex-col h-full min-h-0">
            <div
              className={`shrink-0 border-b flex items-center justify-between ${
                alerts.length > 0
                  ? isLightTheme
                    ? "bg-amber-500/15 border-amber-600/40"
                    : "bg-amber-950/55 border-amber-500/45"
                  : "bg-secondary border-border"
              }`}
              style={{ padding: `calc(8 * var(--u)) calc(13 * var(--u))` }}
            >
              <span
                className={`font-display font-bold uppercase tracking-wider flex items-center gap-2 ${
                  alerts.length > 0 ? "text-primary" : "text-foreground"
                }`}
                style={{ fontSize: `calc(14 * var(--u))` }}
              >
                {alerts.length > 0 ? (
                  <AlertTriangle className="text-primary" style={{ width: `calc(15 * var(--u))`, height: `calc(15 * var(--u))` }} />
                ) : (
                  <CheckCircle2
                    className={isLightTheme ? "text-emerald-700" : "text-emerald-400"}
                    style={{ width: `calc(15 * var(--u))`, height: `calc(15 * var(--u))` }}
                  />
                )}
                {title || "SD Corridor Road & NWS Weather Alerts"}
              </span>
              <span
                className={`font-mono font-bold rounded-sm border uppercase ${
                  alerts.length > 0
                    ? "bg-destructive/15 border-destructive/45 text-destructive"
                    : isLightTheme
                      ? "bg-emerald-600/15 border-emerald-600/40 text-emerald-800"
                      : "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                }`}
                style={{ fontSize: `calc(10 * var(--u))`, padding: `calc(1.5 * var(--u)) calc(7 * var(--u))` }}
              >
                {alerts.length > 0 ? `${alerts.length} ACTIVE` : "ALL CLEAR"}
              </span>
            </div>

            <div
              className="flex-1 min-h-0 overflow-hidden flex flex-col justify-between"
              style={{ padding: `calc(10 * var(--u)) calc(12 * var(--u))`, gap: `calc(8 * var(--u))` }}
            >
              {alerts.length > 0 ? (
                <div className="flex-1 min-h-0 overflow-hidden flex flex-col" style={{ gap: `calc(6.5 * var(--u))` }}>
                  {alerts.slice(0, 3).map((al) => {
                    const isSevere = al.severity === "Extreme" || al.severity === "Severe";
                    return (
                      <div
                        key={al.id}
                        className={`rounded-sm border-l-4 border flex flex-col justify-center ${
                          isSevere
                            ? "border-l-destructive border-destructive/45 bg-destructive/10"
                            : "border-l-primary border-primary/45 bg-primary/10"
                        }`}
                        style={{ padding: `calc(7.5 * var(--u)) calc(11 * var(--u))` }}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`font-display font-bold uppercase tracking-wide ${
                              isSevere ? "text-destructive" : "text-primary"
                            }`}
                            style={{ fontSize: `calc(14.5 * var(--u))` }}
                          >
                            {al.event}
                          </span>
                          {al.isCorridor && (
                            <span
                              className="font-mono font-bold uppercase rounded-sm bg-primary text-primary-foreground shrink-0"
                              style={{
                                fontSize: `calc(9.5 * var(--u))`,
                                padding: `calc(1.5 * var(--u)) calc(6 * var(--u))`,
                              }}
                            >
                              I-29 / I-90 CORRIDOR
                            </span>
                          )}
                        </div>
                        <div
                          className="text-foreground font-semibold line-clamp-2 mt-0.5"
                          style={{ fontSize: `calc(11.5 * var(--u))` }}
                        >
                          {al.headline}
                        </div>
                        <div
                          className="text-muted-foreground font-mono truncate mt-0.5"
                          style={{ fontSize: `calc(9.5 * var(--u))` }}
                        >
                          AREAS: {al.areaDesc}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex-1 min-h-0 flex flex-col justify-between" style={{ gap: `calc(8 * var(--u))` }}>
                  <div
                    className={`rounded-sm border flex items-center gap-3 ${
                      isLightTheme
                        ? "border-emerald-600/35 bg-emerald-600/10"
                        : "border-emerald-500/35 bg-emerald-500/10"
                    }`}
                    style={{ padding: `calc(9 * var(--u)) calc(12 * var(--u))` }}
                  >
                    <CheckCircle2
                      className={isLightTheme ? "text-emerald-700 shrink-0" : "text-emerald-400 shrink-0"}
                      style={{ width: `calc(24 * var(--u))`, height: `calc(24 * var(--u))` }}
                    />
                    <div className="min-w-0">
                      <div
                        className={`font-bold ${isLightTheme ? "text-emerald-900" : "text-emerald-300"}`}
                        style={{ fontSize: `calc(13.5 * var(--u))` }}
                      >
                        No Active NWS Warnings or Advisories in South Dakota
                      </div>
                      <div className="text-muted-foreground font-mono" style={{ fontSize: `calc(10.5 * var(--u))` }}>
                        SIOUX FALLS • ARLINGTON • HURON • ABERDEEN CORRIDORS CLEAR
                      </div>
                    </div>
                  </div>

                  {cfg.showForecastWhenClear !== false && cities.length > 0 && (
                    <div className="grid grid-cols-3" style={{ gap: `calc(6.5 * var(--u))` }}>
                      {cities.slice(0, 3).map((c: any) => (
                        <div
                          key={c.city}
                          className="rounded-sm border border-border bg-secondary/45 flex flex-col justify-between"
                          style={{ padding: `calc(7 * var(--u)) calc(9.5 * var(--u))` }}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span
                              className="font-display font-bold uppercase tracking-wide text-foreground truncate"
                              style={{ fontSize: `calc(12.5 * var(--u))` }}
                            >
                              {c.city}
                            </span>
                            <WeatherGlyph condition={c.condition} iconHint={c.forecast?.[0]?.icon} sizeUnits={14} />
                          </div>
                          <div
                            className="font-mono font-bold text-primary leading-none my-0.5 tabular-nums"
                            style={{ fontSize: `calc(20 * var(--u))` }}
                          >
                            {c.temp}°F
                          </div>
                          <div
                            className="text-muted-foreground font-mono flex items-center gap-1 truncate"
                            style={{ fontSize: `calc(9.5 * var(--u))` }}
                          >
                            <Wind style={{ width: `calc(10.5 * var(--u))`, height: `calc(10.5 * var(--u))` }} />
                            {c.wind}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      }

      case "safety_streak": {
        const startDt = parseFlexibleDateToLocal(cfg.startDateISO || "2026-06-15", now);
        const streakDays = startDt ? Math.max(0, diffCalendarDays(now, startDt)) : 0;
        const recordDays = Math.max(Number(cfg.bestStreakDays || 0), streakDays);
        const isNewRecord = streakDays > 0 && streakDays >= Number(cfg.bestStreakDays || 0);
        const accent = adaptScheduleColorForTheme(cfg.accentColor || "#22A06B", isLightTheme);

        return (
          <div className="h-full w-full flex flex-col min-h-0 overflow-hidden">
            <div
              className="shrink-0 bg-secondary border-b border-border flex items-center justify-between gap-2"
              style={{ padding: `calc(8 * var(--u)) calc(13 * var(--u))` }}
            >
              <span
                className="font-display font-bold uppercase tracking-wider flex items-center gap-2"
                style={{ color: accent, fontSize: `calc(14 * var(--u))` }}
              >
                <ShieldCheck style={{ width: `calc(16 * var(--u))`, height: `calc(16 * var(--u))` }} />
                {title || cfg.title || "DAYS INCIDENT-FREE"}
              </span>
              <span
                className="font-mono font-bold rounded-sm border border-border bg-background text-foreground inline-flex items-center gap-1.5 uppercase"
                style={{ fontSize: `calc(10 * var(--u))`, padding: `calc(2 * var(--u)) calc(8 * var(--u))` }}
              >
                {isNewRecord && <Award style={{ width: `calc(11 * var(--u))`, height: `calc(11 * var(--u))`, color: accent }} />}
                {isNewRecord ? `RECORD STREAK: ${recordDays}D` : `RECORD: ${recordDays} DAYS`}
              </span>
            </div>

            <div
              className="flex-1 min-h-0 flex flex-col justify-between"
              style={{
                padding: `calc(12 * var(--u)) calc(16 * var(--u))`,
                borderLeft: `4px solid ${accent}`,
              }}
            >
              <div className="flex items-baseline gap-3 my-auto">
                <span
                  className="font-mono font-bold tabular-nums leading-none tracking-tight text-foreground"
                  style={{ fontSize: `calc(60 * var(--u))` }}
                >
                  {streakDays}
                </span>
                <span
                  className="font-display font-extrabold uppercase tracking-wider"
                  style={{ color: accent, fontSize: `calc(24 * var(--u))` }}
                >
                  {streakDays === 1 ? "DAY SAFE" : "DAYS SAFE"}
                </span>
              </div>

              <div
                className="text-muted-foreground font-medium line-clamp-2"
                style={{ fontSize: `calc(12 * var(--u))` }}
              >
                {cfg.subtitle || "Zero preventable road or warehouse incidents — pre-trip checks every route."}
              </div>
            </div>
          </div>
        );
      }

      case "big_countdown": {
        const iso = cfg.targetDateISO || "2026-12-04";
        const timePart = /^\d{2}:\d{2}$/.test(cfg.targetTime || "") ? cfg.targetTime : "00:00";
        const target = new Date(`${iso}T${timePart}:00`);
        const diffMs = isNaN(target.getTime()) ? 0 : target.getTime() - now.getTime();
        const accent = adaptScheduleColorForTheme(cfg.accentColor || "#E59A23", isLightTheme);

        const isTodayOrNow = diffMs <= 0 && diffMs > -86_400_000;
        const clampedMs = Math.max(0, diffMs);
        const days = Math.floor(clampedMs / 86_400_000);
        const hrs = Math.floor((clampedMs % 86_400_000) / 3_600_000);
        const mins = Math.floor((clampedMs % 3_600_000) / 60_000);
        const secs = Math.floor((clampedMs % 60_000) / 1000);

        return (
          <div className="h-full w-full flex flex-col min-h-0 overflow-hidden">
            <div
              className="shrink-0 bg-secondary border-b border-border flex items-center justify-between gap-2"
              style={{ padding: `calc(8 * var(--u)) calc(13 * var(--u))` }}
            >
              <span
                className="font-display font-bold uppercase tracking-wider flex items-center gap-2 truncate"
                style={{ color: accent, fontSize: `calc(14 * var(--u))` }}
              >
                <Clock style={{ width: `calc(15 * var(--u))`, height: `calc(15 * var(--u))` }} />
                {title || cfg.title || "UPCOMING EVENT"}
              </span>
              {!isNaN(target.getTime()) && (
                <span
                  className="font-mono font-bold text-foreground bg-background border border-border rounded-sm shrink-0 uppercase"
                  style={{ fontSize: `calc(10 * var(--u))`, padding: `calc(2 * var(--u)) calc(8 * var(--u))` }}
                >
                  {target.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </span>
              )}
            </div>

            <div
              className="flex-1 min-h-0 flex flex-col justify-between"
              style={{ padding: `calc(12 * var(--u)) calc(15 * var(--u))` }}
            >
              {isTodayOrNow ? (
                <div
                  className="font-display font-extrabold uppercase text-foreground my-auto flex items-center gap-2.5 tracking-wide"
                  style={{ fontSize: `calc(34 * var(--u))` }}
                >
                  <Flame style={{ color: accent, width: `calc(32 * var(--u))`, height: `calc(32 * var(--u))` }} />
                  SCHEDULED TODAY
                </div>
              ) : (
                <div className="grid grid-cols-4 my-auto" style={{ gap: `calc(7 * var(--u))` }}>
                  {[
                    { val: String(days), lbl: "DAYS" },
                    { val: String(hrs).padStart(2, "0"), lbl: "HRS" },
                    { val: String(mins).padStart(2, "0"), lbl: "MIN" },
                    { val: String(secs).padStart(2, "0"), lbl: "SEC" },
                  ].map((unit) => (
                    <div
                      key={unit.lbl}
                      className="rounded-sm border border-border bg-secondary/55 flex flex-col items-center justify-center"
                      style={{ padding: `calc(8 * var(--u)) calc(4 * var(--u))` }}
                    >
                      <span
                        className="font-mono font-bold tabular-nums text-foreground leading-none"
                        style={{ fontSize: `calc(31 * var(--u))` }}
                      >
                        {unit.val}
                      </span>
                      <span
                        className="font-mono font-bold uppercase tracking-widest mt-1"
                        style={{ color: accent, fontSize: `calc(9 * var(--u))` }}
                      >
                        {unit.lbl}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {cfg.subtitle && (
                <div
                  className="text-muted-foreground font-medium truncate"
                  style={{ fontSize: `calc(12 * var(--u))` }}
                >
                  {cfg.subtitle}
                </div>
              )}
            </div>
          </div>
        );
      }

      case "media_qr": {
        const mode: "image" | "qr" | "image_with_qr" = cfg.mode || "image_with_qr";
        const imageUrl = (cfg.imageUrl || "").trim();
        const qrUrl = (cfg.qrUrl || "https://localhost").trim();
        const fit = cfg.imageFit === "cover" ? "object-cover" : "object-contain";
        const accent = adaptScheduleColorForTheme(cfg.accentColor || "#E59A23", isLightTheme);

        return (
          <div className="h-full w-full flex flex-col min-h-0 overflow-hidden">
            {(title || cfg.title) && (
              <div
                className="shrink-0 bg-secondary border-b border-border flex items-center justify-between gap-2"
                style={{ padding: `calc(8 * var(--u)) calc(13 * var(--u))` }}
              >
                <span
                  className="font-display font-bold uppercase tracking-wider flex items-center gap-2 truncate"
                  style={{ color: accent, fontSize: `calc(14 * var(--u))` }}
                >
                  {mode === "qr" ? (
                    <QrCode style={{ width: `calc(15 * var(--u))`, height: `calc(15 * var(--u))` }} />
                  ) : (
                    <ImageIcon style={{ width: `calc(15 * var(--u))`, height: `calc(15 * var(--u))` }} />
                  )}
                  {title || cfg.title}
                </span>
                {cfg.subtitle && (
                  <span className="text-muted-foreground font-mono truncate" style={{ fontSize: `calc(10.5 * var(--u))` }}>
                    {cfg.subtitle}
                  </span>
                )}
              </div>
            )}

            <div
              className={`flex-1 min-h-0 flex items-center justify-center overflow-hidden ${
                mode === "image_with_qr" ? "gap-4" : ""
              }`}
              style={{ padding: `calc(12 * var(--u))` }}
            >
              {(mode === "image" || mode === "image_with_qr") && (
                <div className="flex-1 h-full min-w-0 flex items-center justify-center rounded-sm overflow-hidden bg-background border border-border">
                  {imageUrl ? (
                    <img src={imageUrl} alt={cfg.title || "Slide"} className={`w-full h-full ${fit}`} />
                  ) : (
                    <div className="text-center text-muted-foreground p-4 space-y-1">
                      <ImageIcon
                        className="mx-auto opacity-55"
                        style={{ width: `calc(36 * var(--u))`, height: `calc(36 * var(--u))` }}
                      />
                      <div className="font-display font-bold uppercase tracking-wide text-foreground" style={{ fontSize: `calc(14 * var(--u))` }}>
                        Upload Flyer or Graphic in Screen Studio
                      </div>
                      <div className="font-mono" style={{ fontSize: `calc(10.5 * var(--u))` }}>
                        PNG • JPG • WEBP • GIF
                      </div>
                    </div>
                  )}
                </div>
              )}

              {(mode === "qr" || mode === "image_with_qr") && (
                <div
                  className={`flex flex-col items-center justify-center shrink-0 ${
                    mode === "qr" ? "h-full w-full" : "h-full max-w-[38%]"
                  }`}
                  style={{ gap: `calc(8 * var(--u))` }}
                >
                  <div
                    className="aspect-square max-h-[78%] bg-white rounded-sm border-2 border-border p-2 flex items-center justify-center"
                    style={{ width: mode === "qr" ? `calc(210 * var(--u))` : `calc(165 * var(--u))` }}
                  >
                    <QrCodeSvg value={qrUrl} />
                  </div>
                  <div className="text-center">
                    <div
                      className="font-display font-bold uppercase tracking-wider"
                      style={{ color: accent, fontSize: `calc(13.5 * var(--u))` }}
                    >
                      {cfg.qrLabel || "Scan with Phone Camera"}
                    </div>
                    <div
                      className="text-muted-foreground font-mono truncate max-w-[220px]"
                      style={{ fontSize: `calc(9.5 * var(--u))` }}
                    >
                      {qrUrl.replace(/^https?:\/\//, "")}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      }

      case "photo_gallery": {
        const galleryState = normalizePhotoGalleryState(displayState?.photoGallery);
        const albumFilter = cfg.albumId || "all";
        const photos = resolveActiveGalleryPhotos(galleryState, albumFilter);
        const albumsById = new Map(galleryState.albums.map((a) => [a.id, a]));
        const selectedAlbumObj =
          albumFilter !== "all" ? albumsById.get(albumFilter) : undefined;
        const accent = adaptScheduleColorForTheme(
          cfg.accentColor || selectedAlbumObj?.color || "#E59A23",
          isLightTheme,
        );
        const displayMode: "slideshow" | "collage" =
          cfg.displayMode === "collage" ? "collage" : "slideshow";
        const durSec = Math.max(
          4,
          Math.min(60, Number(cfg.slideDurationSec || galleryState.slideDurationSec || 8)),
        );
        const showCaptions = cfg.showCaptions !== false;
        const activeIdx =
          photos.length > 0
            ? Math.floor(now.getTime() / (durSec * 1000)) % photos.length
            : 0;

        return (
          <div className="h-full w-full flex flex-col min-h-0 overflow-hidden">
            <div
              className="shrink-0 bg-secondary border-b border-border flex items-center justify-between gap-2"
              style={{ padding: `calc(7.5 * var(--u)) calc(13 * var(--u))` }}
            >
              <span
                className="font-display font-bold uppercase tracking-wider flex items-center gap-2 truncate"
                style={{ color: accent, fontSize: `calc(14 * var(--u))` }}
              >
                <ImageIcon style={{ width: `calc(15 * var(--u))`, height: `calc(15 * var(--u))` }} />
                <span className="truncate">
                  {title || cfg.title || selectedAlbumObj?.name || "TEAM & FAMILY GALLERY"}
                </span>
              </span>
              {photos.length > 0 && (
                <span
                  className="font-mono font-bold text-muted-foreground shrink-0 tabular-nums"
                  style={{ fontSize: `calc(10.5 * var(--u))` }}
                >
                  {displayMode === "collage"
                    ? `${photos.length} PHOTOS`
                    : `${activeIdx + 1} / ${photos.length}`}
                </span>
              )}
            </div>

            {photos.length === 0 ? (
              <div className="flex-1 min-h-0 flex flex-col items-center justify-center text-center p-6 text-muted-foreground space-y-2">
                <ImageIcon
                  className="opacity-45"
                  style={{ width: `calc(40 * var(--u))`, height: `calc(40 * var(--u))` }}
                />
                <div
                  className="font-display font-bold uppercase tracking-wide text-foreground"
                  style={{ fontSize: `calc(15 * var(--u))` }}
                >
                  No Photos in {selectedAlbumObj ? `"${selectedAlbumObj.name}"` : "Gallery"} Yet
                </div>
                <div className="font-mono" style={{ fontSize: `calc(11 * var(--u))` }}>
                  Upload work event or employee family photos in /admin → Photo Gallery
                </div>
              </div>
            ) : displayMode === "collage" && photos.length >= 2 ? (
              <div
                className="flex-1 min-h-0 grid grid-cols-2 grid-rows-2 bg-background overflow-hidden"
                style={{ gap: `calc(6 * var(--u))`, padding: `calc(8 * var(--u))` }}
              >
                {Array.from({ length: Math.min(4, photos.length) }).map((_, slotIdx) => {
                  const item = photos[(activeIdx * 2 + slotIdx) % photos.length];
                  const alb = albumsById.get(item.albumId);
                  return (
                    <div
                      key={`${item.id}-${slotIdx}`}
                      className="relative rounded-sm overflow-hidden border border-border bg-black flex items-center justify-center"
                    >
                      <img
                        src={item.url}
                        alt=""
                        aria-hidden="true"
                        className="absolute inset-0 w-full h-full object-cover scale-110 blur-md opacity-45"
                      />
                      <img
                        src={item.url}
                        alt={item.caption || alb?.name || "Gallery Photo"}
                        className="relative z-10 w-full h-full object-contain"
                      />
                      {showCaptions && (item.caption || item.uploadedBy) && (
                        <div
                          className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/85 via-black/55 to-transparent text-white flex items-end justify-between gap-2"
                          style={{ padding: `calc(12 * var(--u)) calc(9 * var(--u)) calc(6 * var(--u))` }}
                        >
                          <span
                            className="font-semibold truncate"
                            style={{ fontSize: `calc(11.5 * var(--u))` }}
                          >
                            {item.caption || alb?.name}
                          </span>
                          {item.uploadedBy && (
                            <span
                              className="font-mono opacity-80 shrink-0"
                              style={{ fontSize: `calc(9.5 * var(--u))` }}
                            >
                              {item.uploadedBy}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              (() => {
                const current = photos[activeIdx];
                const alb = albumsById.get(current.albumId);
                return (
                  <div className="flex-1 min-h-0 relative bg-black flex items-center justify-center overflow-hidden">
                    {/* Blurred ambient backdrop so portrait & landscape photos both fill 16:9 cleanly */}
                    <img
                      src={current.url}
                      alt=""
                      aria-hidden="true"
                      className="absolute inset-0 w-full h-full object-cover scale-110 blur-md opacity-45"
                    />
                    <img
                      key={current.id}
                      src={current.url}
                      alt={current.caption || alb?.name || "Team Photo"}
                      className="relative z-10 max-w-full max-h-full w-full h-full object-contain transition-opacity duration-500"
                      style={{ padding: `calc(8 * var(--u))` }}
                    />

                    {showCaptions && (current.caption || alb || current.uploadedBy) && (
                      <div
                        className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/90 via-black/65 to-transparent text-white flex items-end justify-between gap-3"
                        style={{
                          padding: `calc(22 * var(--u)) calc(16 * var(--u)) calc(11 * var(--u))`,
                        }}
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            {alb && (
                              <span
                                className="rounded-sm font-mono font-bold uppercase tracking-wider px-2 py-0.5 text-black"
                                style={{
                                  backgroundColor: alb.color || accent,
                                  fontSize: `calc(9.5 * var(--u))`,
                                }}
                              >
                                {alb.name}
                              </span>
                            )}
                            {current.eventDate && (
                              <span
                                className="font-mono text-zinc-200"
                                style={{ fontSize: `calc(10.5 * var(--u))` }}
                              >
                                {current.eventDate}
                              </span>
                            )}
                          </div>
                          {current.caption && (
                            <div
                              className="font-bold leading-snug text-white drop-shadow"
                              style={{ fontSize: `calc(16 * var(--u))` }}
                            >
                              {current.caption}
                            </div>
                          )}
                        </div>

                        {current.uploadedBy && (
                          <div
                            className="font-mono text-zinc-300 shrink-0 text-right"
                            style={{ fontSize: `calc(10.5 * var(--u))` }}
                          >
                            Shared by <strong className="text-white">{current.uploadedBy}</strong>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()
            )}
          </div>
        );
      }

      case "custom_info": {
        const accent = adaptScheduleColorForTheme(cfg.accentColor || "#E59A23", isLightTheme);
        const lines = String(cfg.body || "")
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean);
        const fontScale = cfg.textSize === "hero" ? 21 : cfg.textSize === "large" ? 17 : 14;

        return (
          <div className="h-full w-full flex flex-col min-h-0">
            <div
              className="shrink-0 bg-secondary border-b border-border flex items-center gap-2"
              style={{ padding: `calc(8 * var(--u)) calc(13 * var(--u))` }}
            >
              <FileText style={{ color: accent, width: `calc(15 * var(--u))`, height: `calc(15 * var(--u))` }} />
              <span
                className="font-display font-bold uppercase tracking-wider truncate"
                style={{ color: accent, fontSize: `calc(14 * var(--u))` }}
              >
                {title || cfg.title || "OPERATIONS BULLETIN"}
              </span>
            </div>
            <div
              className="flex-1 min-h-0 overflow-hidden flex flex-col justify-center"
              style={{ padding: `calc(12 * var(--u)) calc(15 * var(--u))`, gap: `calc(8 * var(--u))` }}
            >
              {lines.map((line, idx) => {
                const clean = line.replace(/^[•*-]\s*/, "");
                const isBullet = /^[•*-]\s*/.test(line);
                return (
                  <div key={idx} className="flex items-start gap-2.5">
                    {isBullet && (
                      <span
                        className="rounded-[1px] shrink-0 mt-2"
                        style={{
                          backgroundColor: accent,
                          width: `calc(6.5 * var(--u))`,
                          height: `calc(6.5 * var(--u))`,
                        }}
                      />
                    )}
                    <p
                      className="font-semibold text-foreground leading-snug"
                      style={{ fontSize: `calc(${fontScale} * var(--u))` }}
                    >
                      {clean}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        );
      }

      case "live_map": {
        const spec = resolveMapViewSpec(
          cfg.preset,
          cfg.customBounds,
          displayState?.settings?.savedMapRegions,
          cfg.etaHub,
        );
        const filterMode = (cfg.routeFilter || "today") as RouteOverlayFilterMode;
        const isHotShotOnlyMap = filterMode === "hotshots_today" || Boolean(cfg.autoFitHotShots);
        const wh = isHotShotOnlyMap
          ? resolveHotShotWarehouse(focusedHotShot?.originHub, { sfWarehouse, mainWarehouse })
          : spec.etaHub === "sf"
            ? sfWarehouse
            : mainWarehouse;
        const showEta = cfg.showReturnEta !== false && spec.etaHub !== "none" && !previewMode;

        // On dedicated Hot Shot maps, focus zoom & corridor on the single currently rotating Hot Shot
        const mapHotShots = isHotShotOnlyMap
          ? focusedHotShot
            ? [focusedHotShot]
            : []
          : todayHotShots;
        const hotShotOverlays = buildHotShotRouteOverlays(mapHotShots, {
          sfWarehouse,
          mainWarehouse,
        });
        const mapRouteOverlays = resolveRouteOverlays(displayState?.routeTerritories, {
          filterMode,
          colorMode: (cfg.routeColorMode || "route") as RouteColorMode,
          selectedRouteIds: Array.isArray(cfg.selectedRouteIds) ? cfg.selectedRouteIds : [],
          activeTruckWeek,
          hotShotOverlays,
          now,
        });

        const hotShotBounds =
          isHotShotOnlyMap && mapHotShots.length > 0
            ? computeHotShotMapBounds(mapHotShots, wh, vehicles, {
                sfWarehouse,
                mainWarehouse,
              })
            : null;
        const effectiveFitBounds = hotShotBounds || spec.fitBounds;

        // On dedicated Hot Shot maps, highlight the focused Hot Shot's assigned van if assigned
        const assignedVehSet = new Set(
          mapHotShots
            .map((hs) => findHotShotVeh(hs)?.id)
            .filter((x): x is string => Boolean(x)),
        );
        const mapVehicles =
          isHotShotOnlyMap && assignedVehSet.size > 0
            ? vehicles.filter((v) => assignedVehSet.has(v.id))
            : vehicles;

        const mapRouteStyle = (cfg.routeStyle || "zones_and_sequence") as RouteOverlayStyleMode;
        const effectiveNwsAlerts = resolveEffectiveNwsAlerts(
          displayState?.nwsAlerts,
          displayState?.settings?.weatherDemoScenario,
        );
        const companyWeatherMode = normalizeWeatherOverlayMode(
          displayState?.settings?.weatherOverlayMode,
          "warnings_only",
        );
        const mapWeatherMode: WeatherOverlayMode =
          cfg.weatherOverlayMode && cfg.weatherOverlayMode !== "inherit"
            ? normalizeWeatherOverlayMode(cfg.weatherOverlayMode, companyWeatherMode)
            : companyWeatherMode;
        const activeWeatherMapAlerts = filterWeatherAlertsForMap(
          effectiveNwsAlerts,
          mapWeatherMode,
          now.getTime(),
        );
        const topWeatherStyle = activeWeatherMapAlerts[0]
          ? getWeatherAlertMapStyle(activeWeatherMapAlerts[0], !isLightTheme)
          : null;

        const focusedHeaderLabel =
          isHotShotOnlyMap && focusedHotShot
            ? `⚡ [${getHotShotHubMeta(focusedHotShot.originHub).code}] ${
                activeHotShotList.length > 1
                  ? `HOT SHOT ${focusedHotShotIdx + 1}/${activeHotShotList.length}: `
                  : ""
              }${focusedHotShot.driverName} — ${
                focusedHotShot.title || buildHotShotTownSequenceLabel(focusedHotShot.stops, 3)
              }`
            : title || spec.label;

        return (
          <div className="h-full w-full flex flex-col min-h-0 relative overflow-hidden">
            <div
              className="shrink-0 bg-secondary border-b border-border flex items-center justify-between gap-2"
              style={{ padding: `calc(7 * var(--u)) calc(13 * var(--u))` }}
            >
              <span
                className="font-display font-bold uppercase tracking-wider text-foreground flex items-center gap-2 truncate"
                style={{ fontSize: `calc(14 * var(--u))` }}
              >
                <MapPin className="text-primary shrink-0" style={{ width: `calc(14 * var(--u))`, height: `calc(14 * var(--u))` }} />
                <span className="truncate">{focusedHeaderLabel}</span>
              </span>
              <div className="flex items-center gap-2 shrink-0">
                {activeWeatherMapAlerts.length > 0 && topWeatherStyle && (
                  <span
                    className="font-mono font-bold uppercase rounded-sm border inline-flex items-center gap-1"
                    style={{
                      fontSize: `calc(9.5 * var(--u))`,
                      padding: `calc(1.5 * var(--u)) calc(6.5 * var(--u))`,
                      borderColor: `${topWeatherStyle.strokeColor}88`,
                      backgroundColor: `${topWeatherStyle.strokeColor}20`,
                      color: topWeatherStyle.strokeColor,
                    }}
                  >
                    <span>{topWeatherStyle.icon}</span>
                    <span>
                      {activeWeatherMapAlerts.length === 1
                        ? activeWeatherMapAlerts[0].event
                        : `${activeWeatherMapAlerts.length} Weather Alerts`}
                    </span>
                    {activeWeatherMapAlerts.some((a) => a.isDemo) && (
                      <span
                        className="rounded-sm text-white font-extrabold"
                        style={{
                          backgroundColor: topWeatherStyle.strokeColor,
                          fontSize: `calc(8 * var(--u))`,
                          padding: `0 calc(3.5 * var(--u))`,
                        }}
                      >
                        DEMO
                      </span>
                    )}
                  </span>
                )}
                <span className="font-mono text-primary font-bold uppercase shrink-0" style={{ fontSize: `calc(10.5 * var(--u))` }}>
                  {isHotShotOnlyMap && activeHotShotList.length > 1
                    ? `AUTO-ROTATING MAP ZOOM (${focusedHotShotIdx + 1}/${activeHotShotList.length})`
                    : `${mapVehicles.filter((v) => v.status === "moving" || v.speed > 2).length} MOVING${
                        mapRouteOverlays.length > 0 ? ` • ${mapRouteOverlays.length} ROUTES` : ""
                      }`}
                </span>
              </div>
            </div>
            <div className="flex-1 min-h-0 relative">
              <TrackingMap
                key={`map-${w.id}-${isHotShotOnlyMap ? "hotshot-rotator" : spec.key}-${isLightTheme ? "light" : "dark"}`}
                data={mapVehicles}
                onVehicleUpdate={() => {}}
                center={spec.center}
                zoom={spec.fallbackZoom}
                fitRegionBounds={effectiveFitBounds}
                autoFitBounds={hotShotBounds ? false : spec.autoFitFleet}
                unlockMaxBounds
                readOnly
                darkMode={!isLightTheme}
                routeOverlays={mapRouteOverlays}
                routeStyle={mapRouteStyle}
                showRouteLegend={!previewMode && cfg.showRouteLegend !== false}
                weatherAlerts={effectiveNwsAlerts}
                weatherOverlayMode={mapWeatherMode}
                baseLocation={{
                  name: wh.name,
                  lat: wh.latitude,
                  lon: wh.longitude,
                  address: `${wh.latitude.toFixed(4)}, ${wh.longitude.toFixed(4)}`,
                }}
              />
              {showEta && (
                <ReturnEtaPanel
                  vehicles={vehicles}
                  warehouse={wh}
                  hotShotRoutes={isHotShotOnlyMap ? mapHotShots : allHotShotRoutes}
                />
              )}
            </div>
          </div>
        );
      }

      case "truck_schedule": {
        const days = activeTruckWeek?.days || [];
        const todayCol = getTodayColIdx(days, now);
        return (
          <div className="h-full w-full flex flex-col min-h-0 overflow-hidden">
            <div
              className="shrink-0 bg-secondary border-b border-border flex items-center justify-between"
              style={{ padding: `calc(7 * var(--u)) calc(13 * var(--u))` }}
            >
              <span
                className="font-display font-bold uppercase tracking-wider text-foreground flex items-center gap-2"
                style={{ fontSize: `calc(14 * var(--u))` }}
              >
                <Truck className="text-primary" style={{ width: `calc(14 * var(--u))`, height: `calc(14 * var(--u))` }} />
                {title || "Truck Route Schedule"}
              </span>
              <span className="font-mono text-muted-foreground font-bold uppercase" style={{ fontSize: `calc(10.5 * var(--u))` }}>
                {activeTruckWeek?.label}
              </span>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              <table className="w-full h-full border-collapse table-fixed text-left">
                <thead>
                  <tr className="bg-secondary/75 border-b border-border">
                    <th
                      className="text-muted-foreground font-display font-bold uppercase tracking-wider"
                      style={{ width: "22%", padding: `calc(6 * var(--u)) calc(8 * var(--u))`, fontSize: `calc(11.5 * var(--u))` }}
                    >
                      Driver / Unit
                    </th>
                    {days.map((d: any, i: number) => {
                      const isColHoliday = isDayColumnHoliday(activeTruckWeek, i);
                      return (
                      <th
                        key={i}
                        className={`text-center font-mono font-bold uppercase ${
                          isColHoliday ? "bg-rose-500/25 text-rose-300" : i === todayCol ? "bg-primary/18 text-primary" : "text-muted-foreground"
                        }`}
                        style={{ padding: `calc(5 * var(--u))`, fontSize: `calc(10.5 * var(--u))` }}
                      >
                        {d.day} {(d.date || "").replace(/\/\d{4}$/, "")}{isColHoliday && <span className="ml-1 text-rose-300">??</span>}
                      </th>
                    );})}
                  </tr>
                </thead>
                <tbody>
                  {(activeTruckWeek?.rows || []).map((r: any, rIdx: number) => {
                    const rowColor = adaptScheduleColorForTheme(r.color || "#E59A23", isLightTheme);
                    return (
                      <tr key={rIdx} className="border-b border-border odd:bg-secondary/25">
                        <td
                          className="font-bold truncate"
                          style={{
                            color: rowColor,
                            padding: `calc(5.5 * var(--u)) calc(8 * var(--u))`,
                            fontSize: `calc(12.5 * var(--u))`,
                          }}
                        >
                          {r.driver}
                        </td>
                        {(r.days || []).map((cell: string, cIdx: number) => {
                          const isColHoliday = isDayColumnHoliday(activeTruckWeek, cIdx);
                          const isHolidayCell = isColHoliday || isHolidayCellValue(cell);
                          return (
                          <td
                            key={cIdx}
                            className={`text-center font-mono font-semibold truncate ${
                              isHolidayCell ? "bg-rose-500/20 text-rose-200 font-extrabold" : cIdx === todayCol ? "bg-primary/10 text-foreground font-bold" : "text-foreground/90"
                            }`}
                            style={{ padding: `calc(5 * var(--u)) calc(4 * var(--u))`, fontSize: `calc(11.5 * var(--u))` }}
                          >
                            {cell || "—"}
                          </td>
                        );})}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      }

      case "sf_schedule": {
        const rows = activeSfWeek?.rows || [];
        const days = activeSfWeek?.days || [];
        const perPage = Math.max(4, Number(cfg.rowsPerPage || 7));
        const totalPages = Math.max(1, Math.ceil(rows.length / perPage));
        const page = rotatorTick % totalPages;
        const slice = rows.slice(page * perPage, (page + 1) * perPage);
        const todayCol = getTodayColIdx(days, now);

        return (
          <div className="h-full w-full flex flex-col min-h-0 overflow-hidden">
            <div
              className="shrink-0 bg-secondary border-b border-border flex items-center justify-between"
              style={{ padding: `calc(7 * var(--u)) calc(13 * var(--u))` }}
            >
              <span
                className="font-display font-bold uppercase tracking-wider text-foreground flex items-center gap-2"
                style={{ fontSize: `calc(14 * var(--u))` }}
              >
                <Users className="text-primary" style={{ width: `calc(14 * var(--u))`, height: `calc(14 * var(--u))` }} />
                {title || "Sioux Falls Team Schedule"}
              </span>
              <span className="font-mono text-muted-foreground font-bold uppercase" style={{ fontSize: `calc(10.5 * var(--u))` }}>
                {totalPages > 1 ? `PAGE ${page + 1}/${totalPages}` : activeSfWeek?.label}
              </span>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              <table className="w-full h-full border-collapse table-fixed text-left">
                <thead>
                  <tr className="bg-secondary/75 border-b border-border">
                    <th
                      className="text-muted-foreground font-display font-bold uppercase tracking-wider"
                      style={{ width: "17%", padding: `calc(5 * var(--u)) calc(8 * var(--u))`, fontSize: `calc(11.5 * var(--u))` }}
                    >
                      Staff
                    </th>
                    {days.map((d: any, i: number) => {
                      const isColHoliday = isDayColumnHoliday(activeSfWeek, i);
                      return (
                      <th
                        key={i}
                        className={`text-center font-mono font-bold uppercase ${
                          isColHoliday ? "bg-rose-500/25 text-rose-300" : i === todayCol ? "bg-primary/18 text-primary" : "text-muted-foreground"
                        }`}
                        style={{ padding: `calc(5 * var(--u)) calc(3 * var(--u))`, fontSize: `calc(10 * var(--u))` }}
                      >
                        {d.day}{isColHoliday && <span className="ml-1 text-rose-300">??</span>}
                      </th>
                    );})}
                  </tr>
                </thead>
                <tbody>
                  {slice.map((r: any, rIdx: number) => {
                    const memberName = r.name || r.person || "";
                    const hasTodayBolt =
                      todayCol >= 0 &&
                      days[todayCol]?.date &&
                      getHotShotsForScheduleHeaderDate(allHotShotRoutes, days[todayCol].date).some(
                        (hs) => doesHotShotDriverMatchMember(hs.driverName, memberName, hs.originHub),
                      );
                    return (
                      <tr key={rIdx} className="border-b border-border odd:bg-secondary/25">
                        <td
                          className="font-bold text-foreground truncate"
                          style={{ padding: `calc(5 * var(--u)) calc(8 * var(--u))`, fontSize: `calc(12.5 * var(--u))` }}
                        >
                          <span className="inline-flex items-center gap-1 truncate max-w-full">
                            {hasTodayBolt && (
                              <span className="text-amber-500 shrink-0" title="Hot Shot Today">
                                ⚡
                              </span>
                            )}
                            <span className="truncate">{memberName}</span>
                          </span>
                        </td>
                        {(r.days || []).map((cell: string, cIdx: number) => {
                          const isColHoliday = isDayColumnHoliday(activeSfWeek, cIdx);
                          const isHolidayCell = isColHoliday || isHolidayCellValue(cell);
                          const isOff = !isHolidayCell && (!cell || cell.toUpperCase() === "OFF");
                          const cellHotShot =
                            days[cIdx]?.date &&
                            getHotShotsForScheduleHeaderDate(allHotShotRoutes, days[cIdx].date).find(
                              (hs) => doesHotShotDriverMatchMember(hs.driverName, memberName, hs.originHub),
                            );
                          return (
                            <td
                              key={cIdx}
                              className={`text-center font-mono font-semibold truncate ${
                                cellHotShot
                                  ? "text-amber-500 bg-amber-500/12 font-bold"
                                  : isHolidayCell
                                    ? "bg-rose-500/20 text-rose-200 font-extrabold"
                                    : isOff
                                      ? "text-muted-foreground/45"
                                    : cIdx === todayCol
                                      ? "text-primary bg-primary/10 font-bold"
                                      : "text-foreground/90"
                              }`}
                              style={{ padding: `calc(4 * var(--u)) calc(3 * var(--u))`, fontSize: `calc(11 * var(--u))` }}
                            >
                              {cellHotShot ? `⚡ ${cell || "HS"}` : cell || "OFF"}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      }

      case "announcements": {
        const maxItems = Math.max(1, Number(cfg.maxItems || 3));
        return (
          <div className="h-full w-full flex flex-col min-h-0 overflow-hidden">
            <div
              className="shrink-0 bg-secondary border-b border-border flex items-center justify-between"
              style={{ padding: `calc(8 * var(--u)) calc(13 * var(--u))` }}
            >
              <span
                className="font-display font-bold uppercase tracking-wider text-foreground flex items-center gap-2"
                style={{ fontSize: `calc(14 * var(--u))` }}
              >
                <Megaphone className="text-primary" style={{ width: `calc(14 * var(--u))`, height: `calc(14 * var(--u))` }} />
                {title || "Team Announcements & Deadlines"}
              </span>
            </div>
            <div
              className="flex-1 min-h-0 overflow-hidden flex flex-col"
              style={{ padding: `calc(10 * var(--u))`, gap: `calc(7.5 * var(--u))` }}
            >
              {enrichedAnnouncements.length === 0 ? (
                <div
                  className="flex-1 flex items-center justify-center text-muted-foreground font-mono uppercase"
                  style={{ fontSize: `calc(12 * var(--u))` }}
                >
                  No active announcements
                </div>
              ) : (
                enrichedAnnouncements.slice(0, maxItems).map(({ msg, urgency }) => (
                  <div
                    key={msg.id}
                    className={`flex-1 min-h-0 rounded-sm border-l-4 border flex items-center justify-between gap-3 ${
                      urgency.tier === "today"
                        ? "border-l-destructive border-destructive/45 bg-destructive/10"
                        : urgency.tier === "imminent"
                          ? "border-l-primary border-primary/45 bg-primary/10"
                          : "border-l-border border-border bg-secondary/45"
                    }`}
                    style={{ padding: `calc(8.5 * var(--u)) calc(12 * var(--u))` }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span
                          className="font-mono font-bold text-primary uppercase"
                          style={{ fontSize: `calc(10 * var(--u))` }}
                        >
                          {msg.author}
                        </span>
                        {urgency.formattedDate && (
                          <span className="font-mono text-muted-foreground" style={{ fontSize: `calc(10 * var(--u))` }}>
                            • {msg.eventLabel ? `${msg.eventLabel}: ` : ""}
                            {urgency.formattedDate}
                          </span>
                        )}
                      </div>
                      <p
                        className="font-bold text-foreground line-clamp-2 leading-snug"
                        style={{ fontSize: `calc(13.5 * var(--u))` }}
                      >
                        {msg.message}
                      </p>
                    </div>
                    {urgency.daysUntil !== null && (
                      <div
                        className="shrink-0 rounded-sm bg-background border border-border text-center"
                        style={{ padding: `calc(5.5 * var(--u)) calc(9.5 * var(--u))` }}
                      >
                        <div
                          className="font-mono font-bold text-primary leading-none tabular-nums"
                          style={{ fontSize: `calc(14.5 * var(--u))` }}
                        >
                          {urgency.daysUntil === 0 ? "TODAY" : `${urgency.daysUntil}D`}
                        </div>
                        <div
                          className="text-muted-foreground font-mono font-bold uppercase mt-0.5"
                          style={{ fontSize: `calc(8 * var(--u))` }}
                        >
                          {urgency.daysUntil === 0 ? "DUE" : "LEFT"}
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        );
      }

      case "calendar": {
        const maxItems = Math.max(1, Number(cfg.maxItems || 5));
        return (
          <div className="h-full w-full flex flex-col min-h-0 overflow-hidden">
            <div
              className="shrink-0 bg-secondary border-b border-border flex items-center gap-2"
              style={{ padding: `calc(8 * var(--u)) calc(13 * var(--u))` }}
            >
              <Calendar style={{ width: `calc(14 * var(--u))`, height: `calc(14 * var(--u))` }} className="text-primary" />
              <span
                className="font-display font-bold uppercase tracking-wider text-foreground"
                style={{ fontSize: `calc(14 * var(--u))` }}
              >
                {title || "Upcoming Events & Milestones"}
              </span>
            </div>
            <div
              className="flex-1 min-h-0 overflow-hidden flex flex-col"
              style={{ padding: `calc(9 * var(--u))`, gap: `calc(6 * var(--u))` }}
            >
              {upcomingEvents.slice(0, maxItems).map(({ ev, urgency }) => {
                const dotColor = adaptScheduleColorForTheme(ev.color || "#E59A23", isLightTheme);
                return (
                  <div
                    key={ev.id}
                    className="rounded-sm border border-border bg-secondary/45 flex items-center justify-between gap-2"
                    style={{ padding: `calc(6.5 * var(--u)) calc(10 * var(--u))` }}
                  >
                    <div className="min-w-0 flex items-center gap-2.5">
                      <span
                        className="w-1.5 h-5 rounded-[1px] shrink-0"
                        style={{ backgroundColor: dotColor }}
                      />
                      <div className="min-w-0">
                        <div className="font-bold text-foreground truncate" style={{ fontSize: `calc(13 * var(--u))` }}>
                          {ev.title}
                        </div>
                        <div className="text-muted-foreground font-mono truncate" style={{ fontSize: `calc(10 * var(--u))` }}>
                          {ev.dayLabel} • {ev.time}
                        </div>
                      </div>
                    </div>
                    {urgency.daysUntil !== null && (
                      <span
                        className={`font-mono font-bold rounded-sm border shrink-0 uppercase ${
                          urgency.daysUntil <= 3
                            ? "bg-primary/15 border-primary/45 text-primary"
                            : "bg-background border-border text-foreground"
                        }`}
                        style={{ fontSize: `calc(9.5 * var(--u))`, padding: `calc(2 * var(--u)) calc(7 * var(--u))` }}
                      >
                        {urgency.badgeText}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      }

      case "renewals": {
        const withinDays = Number(cfg.onlyWithinDays || 0);
        const rows = withinDays > 0 ? sortedRenewals.filter((r) => r.soonestDays <= withinDays) : sortedRenewals;
        const renderCell = (c: EvaluatedRenewalCell) => {
          if (!c.raw) return <span className="text-muted-foreground/45">—</span>;
          const cls =
            c.status === "overdue" || c.status === "urgent"
              ? "text-destructive bg-destructive/15 border border-destructive/45 rounded-sm px-1.5 font-mono"
              : c.status === "soon"
                ? "text-primary bg-primary/15 border border-primary/40 rounded-sm px-1.5 font-mono"
                : "text-foreground/90 font-mono";
          return (
            <span className={cls}>
              {c.raw}
              {c.countdownLabel ? ` (${c.countdownLabel})` : ""}
            </span>
          );
        };

        return (
          <div className="h-full w-full flex flex-col min-h-0 overflow-hidden">
            <div
              className="shrink-0 bg-secondary border-b border-border flex items-center justify-between"
              style={{ padding: `calc(8 * var(--u)) calc(13 * var(--u))` }}
            >
              <span
                className="font-display font-bold uppercase tracking-wider text-foreground flex items-center gap-2"
                style={{ fontSize: `calc(14 * var(--u))` }}
              >
                <ShieldAlert className="text-primary" style={{ width: `calc(14 * var(--u))`, height: `calc(14 * var(--u))` }} />
                {title || (withinDays > 0 ? `Renewals Due Within ${withinDays}d` : "DOT, License & Med Card Renewals")}
              </span>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              <table className="w-full h-full border-collapse table-fixed text-left">
                <thead>
                  <tr
                    className="bg-secondary/75 border-b border-border text-muted-foreground uppercase font-display font-bold tracking-wider"
                    style={{ fontSize: `calc(11 * var(--u))` }}
                  >
                    <th style={{ padding: `calc(5 * var(--u)) calc(9 * var(--u))` }}>Unit / Driver</th>
                    <th className="text-center">License</th>
                    <th className="text-center">Med Card</th>
                    <th className="text-center">Truck DOT</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 10).map((item) => (
                    <tr
                      key={item.originalIndex}
                      className="border-b border-border odd:bg-secondary/25"
                      style={{ fontSize: `calc(11 * var(--u))` }}
                    >
                      <td
                        className="font-bold text-foreground truncate"
                        style={{ padding: `calc(5 * var(--u)) calc(9 * var(--u))` }}
                      >
                        {item.row.entity}
                      </td>
                      <td className="text-center font-semibold">{renderCell(item.license)}</td>
                      <td className="text-center font-semibold">{renderCell(item.medCard)}</td>
                      <td className="text-center font-semibold">{renderCell(item.truckDot)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      }

      case "weather_multi": {
        const allCities = displayState?.weatherLocations || [];
        const cities =
          cfg.cityFilter && cfg.cityFilter !== "all"
            ? allCities.filter((c: any) => c.city === cfg.cityFilter)
            : allCities;

        return (
          <div className="h-full w-full flex flex-col min-h-0 overflow-hidden">
            <div
              className="shrink-0 bg-secondary border-b border-border flex items-center gap-2"
              style={{ padding: `calc(8 * var(--u)) calc(13 * var(--u))` }}
            >
              <CloudSun style={{ width: `calc(15 * var(--u))`, height: `calc(15 * var(--u))` }} className="text-primary" />
              <span
                className="font-display font-bold uppercase tracking-wider text-foreground"
                style={{ fontSize: `calc(14 * var(--u))` }}
              >
                {title || "Corridor Weather Forecast"}
              </span>
            </div>
            <div
              className={`flex-1 min-h-0 grid ${
                cities.length <= 1 ? "grid-cols-1" : cities.length === 2 ? "grid-cols-2" : "grid-cols-3"
              }`}
              style={{ padding: `calc(10 * var(--u))`, gap: `calc(8 * var(--u))` }}
            >
              {cities.map((loc: any) => (
                <div
                  key={loc.city}
                  className="rounded-sm border border-border bg-secondary/45 flex flex-col justify-between overflow-hidden"
                  style={{ padding: `calc(8.5 * var(--u)) calc(10.5 * var(--u))` }}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div
                        className="font-display font-bold uppercase tracking-wide text-foreground"
                        style={{ fontSize: `calc(15 * var(--u))` }}
                      >
                        {loc.city}
                      </div>
                      <div className="text-muted-foreground font-mono" style={{ fontSize: `calc(10 * var(--u))` }}>
                        {loc.condition} • {loc.wind}
                      </div>
                    </div>
                    <div
                      className="font-mono font-bold text-primary leading-none tabular-nums"
                      style={{ fontSize: `calc(24 * var(--u))` }}
                    >
                      {loc.temp}°
                    </div>
                  </div>
                  <div className="grid grid-cols-5 border-t border-border pt-1.5 mt-1 text-center">
                    {(loc.forecast || []).slice(0, 5).map((f: any, idx: number) => (
                      <div key={idx} className="flex flex-col items-center">
                        <div className="text-muted-foreground font-mono font-bold uppercase" style={{ fontSize: `calc(8.5 * var(--u))` }}>
                          {f.day}
                        </div>
                        <div className="my-0.5">
                          <WeatherGlyph iconHint={f.icon} sizeUnits={12} />
                        </div>
                        <div className="font-mono font-bold text-foreground tabular-nums" style={{ fontSize: `calc(10 * var(--u))` }}>
                          {f.high}°
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      }

      default:
        return (
          <div className="h-full w-full flex items-center justify-center text-muted-foreground text-xs font-mono uppercase">
            {getCatalogEntry(w.type).label}
          </div>
        );
    }
  };

  return (
    <div
      ref={containerRef}
      data-theme={effectiveTheme}
      className="flex-1 h-full w-full min-h-0 grid overflow-hidden bg-background text-foreground"
      style={{
        ...(previewMode ? { ["--u" as any]: `${previewUnitPx.toFixed(3)}px` } : {}),
        gridTemplateColumns: "repeat(12, minmax(0, 1fr))",
        gridTemplateRows: "repeat(6, minmax(0, 1fr))",
        padding: `calc(10 * var(--u))`,
        gap: `calc(10 * var(--u))`,
      }}
    >
      {(screen.widgets || []).map((widget) => {
        const box = clampWidgetBox(widget);
        const isSelected = previewMode && selectedWidgetId === widget.id;
        return (
          <section
            key={widget.id}
            onClick={previewMode && onSelectWidget ? () => onSelectWidget(widget.id) : undefined}
            className={`relative min-h-0 min-w-0 rounded-sm border bg-card overflow-hidden flex flex-col transition-all ${
              isSelected
                ? "border-primary ring-2 ring-primary/70"
                : "border-border"
            } ${previewMode ? "cursor-pointer hover:border-primary/65" : ""}`}
            style={{
              gridColumn: `${box.x + 1} / span ${box.w}`,
              gridRow: `${box.y + 1} / span ${box.h}`,
            }}
          >
            {renderWidgetBody(widget)}
            {previewMode && (
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectWidget?.(widget.id);
                }}
                className="group absolute inset-0 z-[1200] bg-transparent"
              >
                <span
                  className={`absolute top-1.5 right-1.5 px-2 py-0.5 rounded-sm font-mono text-[10px] font-bold uppercase inline-flex items-center gap-1 shadow transition-opacity ${
                    isSelected
                      ? "bg-primary text-primary-foreground opacity-100"
                      : "bg-black/80 text-white border border-white/25 opacity-0 group-hover:opacity-100"
                  }`}
                >
                  <Pencil className="w-2.5 h-2.5" />
                  {isSelected ? "Editing Panel" : "Click to Edit"}
                </span>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
