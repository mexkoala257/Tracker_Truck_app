import { useState, useMemo, useEffect } from "react";
import {
  type HotShotRoute,
  type HotShotOriginHub,
  getHotShotHubMeta,
  formatHotShotDateHuman,
  buildVanLoadPlan,
} from "@shared/hotshots";
import {
  Truck,
  PackageCheck,
  AlertTriangle,
  Printer,
  ArrowLeftRight,
  RotateCcw,
  Layers,
  Recycle,
  CheckCircle2,
  ClipboardList,
  Boxes,
  ArrowLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export interface EnrichedDispatchRouteItem {
  baseRoute: HotShotRoute;
  effectiveRoute: HotShotRoute;
  originHub: HotShotOriginHub;
  effectiveTiming: {
    etaWindowLabel: string;
    totalLoopRoadMiles: number;
    estimatedTotalDurationLabel: string;
  };
  simulatedOrdersCount: number;
  isPreviewingOptimized: boolean;
}

interface VanLoadBlueprintViewProps {
  routes: EnrichedDispatchRouteItem[];
  selectedRouteId: string | null;
  onSelectRoute: (routeId: string) => void;
  onBackToSplitView: () => void;
  isLight: boolean;
  todayISO: string;
}

export default function VanLoadBlueprintView({
  routes,
  selectedRouteId,
  onSelectRoute,
  onBackToSplitView,
  isLight,
  todayISO,
}: VanLoadBlueprintViewProps) {
  const activeItem = useMemo(() => {
    if (selectedRouteId) {
      const found = routes.find((r) => r.baseRoute.id === selectedRouteId);
      if (found) return found;
    }
    return routes[0] || null;
  }, [routes, selectedRouteId]);

  // Manual Front <-> Rear Pallet overrides per stop ID
  const [manualZoneOverrides, setManualZoneOverrides] = useState<
    Record<string, "front_pallet" | "rear_pallet">
  >({});

  // Interactive Unload Progress Slider (0 = At Departure, 1..N = After Stop #k)
  const [unloadStep, setUnloadStep] = useState<number>(0);

  // Right-pane sub-tab ("pull_list" | "load_steps")
  const [rightTab, setRightTab] = useState<"pull_list" | "load_steps">("pull_list");

  useEffect(() => {
    setUnloadStep(0);
  }, [activeItem?.baseRoute.id]);

  const loadPlan = useMemo(() => {
    if (!activeItem) return null;
    return buildVanLoadPlan(
      activeItem.effectiveRoute.stops,
      manualZoneOverrides,
      unloadStep,
    );
  }, [activeItem, manualZoneOverrides, unloadStep]);

  if (!activeItem || !loadPlan) {
    return (
      <div className="p-8 text-center text-sm font-mono text-muted-foreground">
        No active driver routes available to display in Van Load View.
      </div>
    );
  }

  const { baseRoute, effectiveRoute, originHub, effectiveTiming } = activeItem;
  const hubMeta = getHotShotHubMeta(originHub);
  const maxStops = effectiveRoute.stops.length;

  const badgeGreen = isLight
    ? "bg-emerald-100 text-emerald-950 border-emerald-500 font-bold"
    : "bg-emerald-500/20 text-emerald-200 border-emerald-500/50 font-bold";
  const badgeAmber = isLight
    ? "bg-amber-100 text-amber-950 border-amber-500 font-bold"
    : "bg-amber-500/20 text-amber-200 border-amber-500/50 font-bold";
  const badgeSky = isLight
    ? "bg-sky-100 text-sky-950 border-sky-500 font-bold"
    : "bg-sky-500/20 text-sky-200 border-sky-500/50 font-bold";
  const badgeRed = isLight
    ? "bg-red-100 text-red-950 border-red-500 font-bold"
    : "bg-red-500/20 text-red-200 border-red-500/50 font-bold";

  const handleSwapPalletZone = (
    stopId: string,
    currentZone: "front_pallet" | "rear_pallet",
  ) => {
    const nextZone = currentZone === "front_pallet" ? "rear_pallet" : "front_pallet";
    setManualZoneOverrides((prev) => ({
      ...prev,
      [stopId]: nextZone,
    }));
  };

  const hasOverrides = Object.keys(manualZoneOverrides).length > 0;

  // Build ordered loading sequence (Load Front Pallet heavy/last stops first, then Rear Pallet, then Driver Cab)
  const loadingSteps = [
    ...loadPlan.frontPalletStops
      .slice()
      .reverse()
      .map((s) => ({
        zoneLabel: "1. Front Pallet (Side Door)",
        stopOrder: s.stopOrder,
        accountName: s.stop.accountName,
        city: s.stop.city,
        partsText: s.palletParts.map((p) => `${p.partNumber} (${p.qty})`).join(" • "),
        weightLbs: s.palletWeightLbs,
        layerHint: s.layerPlacementHint,
      })),
    ...loadPlan.rearPalletStops
      .slice()
      .reverse()
      .map((s) => ({
        zoneLabel: "2. Rear Pallet (Barn Doors)",
        stopOrder: s.stopOrder,
        accountName: s.stop.accountName,
        city: s.stop.city,
        partsText: s.palletParts.map((p) => `${p.partNumber} (${p.qty})`).join(" • "),
        weightLbs: s.palletWeightLbs,
        layerHint: s.layerPlacementHint,
      })),
    ...loadPlan.cabAllocations.map((c) => ({
      zoneLabel: "3. Driver Cab (Up Front)",
      stopOrder: c.stopOrder,
      accountName: c.stop.accountName,
      city: c.stop.city,
      partsText: c.parts.map((p) => `${p.partNumber} (${p.qty})`).join(" • "),
      weightLbs: c.totalWeightLbs,
      layerHint: "Up front in Driver Cab tote",
    })),
  ];

  const freedRearStopsCount = loadPlan.rearPalletStops.filter(
    (s) => (unloadStep > 0 ? s.stopOrder <= unloadStep : Boolean(s.stop.completedAt)),
  ).length;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 bg-background text-foreground">
      {/* 1. TOP DRIVER SELECTOR & PRINT / BACK BAR */}
      <div className="rounded-lg border-2 border-border bg-card p-3.5 flex flex-wrap items-center justify-between gap-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={onBackToSplitView}
            className="h-9 text-xs font-mono font-bold gap-1.5"
          >
            <ArrowLeft className="w-4 h-4" />
            3-Pane Map View
          </Button>

          <div className="h-6 w-px bg-border mx-1 hidden sm:block" />

          <span className="text-xs font-mono font-bold uppercase text-muted-foreground">
            Select Driver Van:
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {routes.map((r) => {
              const active = r.baseRoute.id === baseRoute.id;
              const isToday = r.baseRoute.deliveryDateISO === todayISO;
              const rHub = getHotShotHubMeta(r.originHub);
              return (
                <button
                  key={r.baseRoute.id}
                  type="button"
                  onClick={() => onSelectRoute(r.baseRoute.id)}
                  className={`px-3 py-1.5 rounded-md text-xs font-mono font-bold border transition-all flex items-center gap-1.5 ${
                    active
                      ? "bg-primary text-primary-foreground border-primary shadow-sm"
                      : "bg-secondary text-foreground border-border hover:opacity-85"
                  }`}
                >
                  <span>[{rHub.code}]</span>
                  <span>{r.baseRoute.driverName}</span>
                  <span className="opacity-80">
                    ({isToday ? "Today" : r.baseRoute.deliveryDateISO.slice(5)})
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {hasOverrides && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setManualZoneOverrides({})}
              className="h-9 text-xs font-mono font-bold gap-1"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset Pallet Swaps
            </Button>
          )}
          <Button
            size="sm"
            variant="default"
            onClick={() => window.print()}
            className="h-9 text-xs font-mono font-bold gap-1.5"
          >
            <Printer className="w-4 h-4" />
            Print Pull & Load Sheet
          </Button>
        </div>
      </div>

      {/* 2. ROUTE SUMMARY, PICKED STATUS & UNLOAD SCRUBBER */}
      <div className="rounded-lg border-2 border-border bg-card p-3.5 flex flex-wrap items-center justify-between gap-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <div className="flex items-center gap-2">
            <Truck className="w-5 h-5 text-primary" />
            <span className="font-display font-extrabold text-base uppercase">
              {baseRoute.driverName}
            </span>
            <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-secondary border border-border">
              [{hubMeta.code}] {hubMeta.name} •{" "}
              {formatHotShotDateHuman(baseRoute.deliveryDateISO)}
            </span>
          </div>

          <span className={`text-xs font-mono px-2.5 py-1 rounded border ${badgeAmber}`}>
            Return ETA: {effectiveTiming.etaWindowLabel} (~
            {effectiveTiming.totalLoopRoadMiles} road mi)
          </span>

          <span className={`text-xs font-mono px-2.5 py-1 rounded border ${badgeSky}`}>
            Total Load: {loadPlan.metrics.totalPieces} pcs • ~
            {loadPlan.metrics.totalWeightLbs.toLocaleString()} lbs (~
            {loadPlan.metrics.totalPalletEquivalents} pallets)
          </span>

          <span
            className={`text-xs font-mono px-2.5 py-1 rounded border flex items-center gap-1.5 ${
              loadPlan.metrics.pickedStopsCount > 0 ? badgeGreen : "bg-secondary border-border text-foreground font-semibold"
            }`}
          >
            <PackageCheck className="w-4 h-4" />
            Picked: {loadPlan.metrics.pickedStopsCount}/
            {loadPlan.metrics.totalBatteryStopsCount} stops
            {loadPlan.metrics.pickedByNames.length > 0
              ? ` (${loadPlan.metrics.pickedByNames.join(", ")})`
              : ""}
          </span>
        </div>

        {/* Unload Progress Slider */}
        <div className="flex items-center gap-2.5 text-xs font-mono bg-secondary px-3 py-1.5 rounded-md border border-border">
          <span className="font-bold uppercase">Simulate Route Unload:</span>
          <input
            type="range"
            min={0}
            max={maxStops}
            value={unloadStep}
            onChange={(e) => setUnloadStep(Number(e.target.value))}
            className="w-32 accent-amber-500 cursor-pointer"
          />
          <span className="font-extrabold px-2 py-0.5 rounded bg-card border border-border">
            {unloadStep === 0
              ? "At Departure (Full Load)"
              : `After Stop #${unloadStep}`}
          </span>
        </div>
      </div>

      {/* 3. OVERFLOW WARNING OR SPECIAL DEALER ALERTS STRIP */}
      {(loadPlan.metrics.isOverflowWarning || loadPlan.specialAlerts.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {loadPlan.metrics.isOverflowWarning && (
            <div
              className={`rounded-lg border-2 p-3 flex items-start gap-2.5 text-xs font-mono ${badgeRed}`}
            >
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <div className="font-extrabold text-sm uppercase">
                  ⚠️ 2-Pallet / Van Payload Capacity Warning
                </div>
                <div className="mt-0.5">{loadPlan.metrics.overflowReason}</div>
              </div>
            </div>
          )}

          {loadPlan.specialAlerts.length > 0 && (
            <div
              className={`rounded-lg border-2 p-3 text-xs font-mono space-y-1 ${badgeAmber} ${
                !loadPlan.metrics.isOverflowWarning ? "md:col-span-2" : ""
              }`}
            >
              <div className="font-extrabold text-sm uppercase flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4" />
                Special Loader & Driver Stop Instructions ({loadPlan.specialAlerts.length})
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                {loadPlan.specialAlerts.map((al, i) => (
                  <span
                    key={i}
                    className="px-2.5 py-1 rounded bg-card text-foreground border border-border font-bold"
                  >
                    Stop #{al.stopOrder} ({al.city} — {al.accountName}):{" "}
                    <span className="underline">{al.alertText}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 4. MAIN WORKSPACE: VAN CHASSIS BLUEPRINT (8 cols) + MASTER RACK PULL / LOAD STEPS (4 cols) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        {/* LEFT 8 COLS: INTERACTIVE 3-ZONE TOP-DOWN CARGO VAN BLUEPRINT */}
        <div className="xl:col-span-8 rounded-2xl border-2 border-border bg-card p-4 shadow-sm space-y-3">
          {/* Top Door Orientation Header */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono border-b border-border pb-2.5">
            <span className="font-extrabold text-foreground uppercase">
              ⬅ FRONT OF VAN (DRIVER CAB)
            </span>
            <span className={`px-3 py-1 rounded-full border ${badgeAmber}`}>
              🚪 PASSENGER-SIDE SLIDING DOOR (Front Pallet Unload Access) ⬇
            </span>
            <span className="font-extrabold text-foreground uppercase">
              REAR BARN DOORS (Unload #1 + Core Returns) ➡
            </span>
          </div>

          {/* 3-ZONE CARGO BED GRID */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-stretch">
            {/* ZONE 1: FRONT DRIVER CAB (Only items smaller than powersports: DRY, LIT, SLA1079, Tools) */}
            <div className="lg:col-span-3 rounded-xl border-2 border-sky-500/70 bg-sky-500/5 p-3 flex flex-col justify-between space-y-3">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-1 border-b border-sky-500/30 pb-1.5">
                  <span className="font-display font-extrabold text-sm uppercase text-foreground">
                    1. Driver Cab
                  </span>
                  <span className={`text-xs font-mono px-2 py-0.5 rounded border ${badgeSky}`}>
                    ~{loadPlan.metrics.cabWeightLbs} lbs
                  </span>
                </div>
                <div className="text-xs font-medium text-muted-foreground">
                  Dry-Cell Packs (`DRY`/`LIT`), Small SLA & Tools (Smaller than Powersports)
                </div>

                <div className="space-y-2">
                  {loadPlan.cabAllocations.length === 0 ? (
                    <div className="rounded border border-dashed border-border bg-background/60 p-3 text-xs text-muted-foreground text-center font-mono">
                      No small cab items on this route
                    </div>
                  ) : (
                    loadPlan.cabAllocations.map((c) => {
                      const isDone =
                        unloadStep > 0
                          ? c.stopOrder <= unloadStep
                          : Boolean(c.stop.completedAt);
                      return (
                        <div
                          key={`cab-${c.stop.id}`}
                          className={`rounded-lg border p-2.5 text-xs space-y-1 transition-all ${
                            isDone
                              ? "border-border bg-secondary/40 opacity-45 line-through"
                              : "border-border bg-background shadow-sm"
                          }`}
                        >
                          <div className="flex items-center justify-between font-bold text-foreground">
                            <span>
                              #{c.stopOrder} {c.stop.city}
                            </span>
                            <span className="font-mono">
                              {c.totalPieces} pcs • {c.totalWeightLbs} lbs
                            </span>
                          </div>
                          <div className="font-semibold text-foreground/90 truncate">
                            {c.stop.accountName}
                          </div>
                          <div className="font-mono text-xs text-primary font-bold">
                            {c.parts.map((p) => `${p.partNumber} (${p.qty})`).join(" • ")}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="pt-2 border-t border-sky-500/30 text-xs font-mono text-muted-foreground">
                Loaded up front with driver
              </div>
            </div>

            {/* ZONE 2: FRONT PALLET SLOT (Passenger Side-Door Access — Later Route Stops) */}
            <div className="lg:col-span-4 rounded-xl border-2 border-amber-500/80 bg-amber-500/5 p-3 flex flex-col justify-between space-y-3">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-1 border-b border-amber-500/30 pb-1.5">
                  <div>
                    <span className="font-display font-extrabold text-sm uppercase text-foreground">
                      2. Front Pallet
                    </span>
                    <span className="block text-xs font-mono text-muted-foreground">
                      Passenger Side-Door Access
                    </span>
                  </div>
                  <div className="text-right font-mono">
                    <span className={`text-xs px-2 py-0.5 rounded border ${badgeAmber}`}>
                      ~{loadPlan.metrics.frontPalletWeightLbs.toLocaleString()} lbs
                    </span>
                    <div className="text-xs font-bold text-muted-foreground mt-0.5">
                      {loadPlan.metrics.frontPalletPieces} pcs • ~
                      {loadPlan.metrics.frontPalletLayers} layers
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  {loadPlan.frontPalletStops.length === 0 ? (
                    <div className="rounded border border-dashed border-border bg-background/60 p-4 text-xs text-muted-foreground text-center font-mono">
                      All pallet stops assigned to Rear Pallet
                    </div>
                  ) : (
                    loadPlan.frontPalletStops.map((item) => {
                      const isDone =
                        unloadStep > 0
                          ? item.stopOrder <= unloadStep
                          : Boolean(item.stop.completedAt);
                      return (
                        <div
                          key={`front-${item.stop.id}`}
                          className={`rounded-lg border-2 p-2.5 text-xs space-y-1.5 transition-all ${
                            isDone
                              ? "border-border bg-secondary/40 opacity-45 line-through"
                              : "border-border bg-background shadow-sm"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-display font-extrabold text-sm text-foreground">
                              #{item.stopOrder} {item.stop.city}, {item.stop.state}
                            </span>
                            <span className="font-mono font-bold text-xs px-2 py-0.5 rounded bg-secondary border border-border">
                              {item.palletPieces} pcs • ~{item.palletWeightLbs} lbs
                            </span>
                          </div>
                          <div className="font-bold text-foreground/90">
                            {item.stop.accountName}
                            {item.stop.accountCode ? ` [${item.stop.accountCode}]` : ""}
                          </div>
                          <div className="font-mono font-bold text-xs text-primary">
                            🔋{" "}
                            {item.palletParts
                              .map((p) => `${p.partNumber} (${p.qty})`)
                              .join(" • ")}
                          </div>
                          <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/60">
                            <span className="font-mono text-xs font-semibold text-muted-foreground">
                              {item.layerPlacementHint}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                handleSwapPalletZone(item.stop.id, "front_pallet")
                              }
                              title="Move this stop to the Rear Pallet (Barn Doors)"
                              className="text-xs font-mono font-bold px-2 py-0.5 rounded border border-border bg-secondary hover:opacity-80 flex items-center gap-1 shrink-0"
                            >
                              <ArrowLeftRight className="w-3 h-3" />
                              To Rear
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="pt-2 border-t border-amber-500/30 text-xs font-mono font-semibold text-muted-foreground flex items-center justify-between">
                <span>Load FIRST • Unload via Side Door</span>
                <span>~{loadPlan.metrics.frontPalletLayers} / 2.5 layers</span>
              </div>
            </div>

            {/* ZONE 3: REAR PALLET SLOT + REAR-DOOR CORE/JUNK RETURN BAY */}
            <div className="lg:col-span-5 rounded-xl border-2 border-emerald-500/80 bg-emerald-500/5 p-3 flex flex-col justify-between space-y-3">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-1 border-b border-emerald-500/30 pb-1.5">
                  <div>
                    <span className="font-display font-extrabold text-sm uppercase text-foreground">
                      3. Rear Pallet (Barn Doors)
                    </span>
                    <span className="block text-xs font-mono text-muted-foreground">
                      First Stops to Unload + Core Bay
                    </span>
                  </div>
                  <div className="text-right font-mono">
                    <span className={`text-xs px-2 py-0.5 rounded border ${badgeGreen}`}>
                      ~{loadPlan.metrics.rearPalletWeightLbs.toLocaleString()} lbs
                    </span>
                    <div className="text-xs font-bold text-muted-foreground mt-0.5">
                      {loadPlan.metrics.rearPalletPieces} pcs • ~
                      {loadPlan.metrics.rearPalletLayers} layers
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  {loadPlan.rearPalletStops.length === 0 ? (
                    <div className="rounded border border-dashed border-border bg-background/60 p-4 text-xs text-muted-foreground text-center font-mono">
                      No stops assigned to Rear Pallet
                    </div>
                  ) : (
                    loadPlan.rearPalletStops.map((item) => {
                      const isDone =
                        unloadStep > 0
                          ? item.stopOrder <= unloadStep
                          : Boolean(item.stop.completedAt);
                      return (
                        <div
                          key={`rear-${item.stop.id}`}
                          className={`rounded-lg border-2 p-2.5 text-xs space-y-1.5 transition-all ${
                            isDone
                              ? "border-border bg-secondary/40 opacity-45 line-through"
                              : "border-border bg-background shadow-sm"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-display font-extrabold text-sm text-foreground">
                              #{item.stopOrder} {item.stop.city}, {item.stop.state}
                            </span>
                            <span className="font-mono font-bold text-xs px-2 py-0.5 rounded bg-secondary border border-border">
                              {item.palletPieces} pcs • ~{item.palletWeightLbs} lbs
                            </span>
                          </div>
                          <div className="font-bold text-foreground/90">
                            {item.stop.accountName}
                            {item.stop.accountCode ? ` [${item.stop.accountCode}]` : ""}
                          </div>
                          <div className="font-mono font-bold text-xs text-primary">
                            🔋{" "}
                            {item.palletParts
                              .map((p) => `${p.partNumber} (${p.qty})`)
                              .join(" • ")}
                          </div>
                          <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/60">
                            <span className="font-mono text-xs font-semibold text-muted-foreground">
                              {item.layerPlacementHint}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                handleSwapPalletZone(item.stop.id, "rear_pallet")
                              }
                              title="Move this stop to the Front Pallet (Passenger Side Door)"
                              className="text-xs font-mono font-bold px-2 py-0.5 rounded border border-border bg-secondary hover:opacity-80 flex items-center gap-1 shrink-0"
                            >
                              <ArrowLeftRight className="w-3 h-3" />
                              To Front
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Dedicated Rear-Door Core / Junk Return Bay */}
              <div className="rounded-lg border-2 border-dashed border-border bg-card p-2.5 text-xs font-mono space-y-1">
                <div className="flex items-center justify-between font-extrabold text-foreground">
                  <span className="flex items-center gap-1.5">
                    <Recycle className="w-4 h-4 text-emerald-500" />
                    REAR-DOOR CORE & JUNK RETURN BAY
                  </span>
                  <span className="px-2 py-0.5 rounded bg-secondary border border-border">
                    {freedRearStopsCount > 0
                      ? `${freedRearStopsCount} Stop Slot(s) Freed for Cores`
                      : "At Rear Doors"}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {loadPlan.coreBayStops.length > 0
                    ? `Scheduled Junk Pickups: ${loadPlan.coreBayStops
                        .map((c) => `#${c.order} ${c.accountName} (${c.city})`)
                        .join(" • ")}`
                    : "Returned dealer cores & junks stack right inside rear barn doors for immediate forklift unload back at warehouse."}
                </div>
              </div>
            </div>
          </div>

          {/* Bottom Axle Balance Footer */}
          <div className="pt-2 border-t border-border flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
            <div className="font-bold text-foreground">
              Axle Weight Distribution: Front Pallet ~
              {loadPlan.metrics.frontPalletWeightLbs.toLocaleString()} lbs • Rear Pallet ~
              {loadPlan.metrics.rearPalletWeightLbs.toLocaleString()} lbs • Driver Cab ~
              {loadPlan.metrics.cabWeightLbs} lbs
            </div>
            <div className="text-muted-foreground font-semibold">
              Powersports (`FAITX`/`CITX`) on Pallets • Small Dry-Cell (`DRY`/`LIT`/Tools) in Cab
            </div>
          </div>
        </div>

        {/* RIGHT 4 COLS: MASTER WAREHOUSE RACK PULL LIST & LOADING SEQUENCE */}
        <div className="xl:col-span-4 rounded-2xl border-2 border-border bg-card p-4 shadow-sm space-y-3">
          {/* Tab Switcher: Master Rack Pull List vs. Step-by-Step Pallet Stack Order */}
          <div className="inline-flex w-full rounded-lg border border-border bg-secondary p-1 text-xs font-mono">
            <button
              type="button"
              onClick={() => setRightTab("pull_list")}
              className={`flex-1 py-1.5 rounded-md font-bold uppercase flex items-center justify-center gap-1.5 transition-colors ${
                rightTab === "pull_list"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-foreground/80 hover:text-foreground"
              }`}
            >
              <Boxes className="w-4 h-4" />
              1. Master Rack Pull ({loadPlan.masterPullList.length} Parts)
            </button>
            <button
              type="button"
              onClick={() => setRightTab("load_steps")}
              className={`flex-1 py-1.5 rounded-md font-bold uppercase flex items-center justify-center gap-1.5 transition-colors ${
                rightTab === "load_steps"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-foreground/80 hover:text-foreground"
              }`}
            >
              <ClipboardList className="w-4 h-4" />
              2. Pallet Stack Order ({loadingSteps.length})
            </button>
          </div>

          {rightTab === "pull_list" ? (
            <div className="space-y-2.5">
              <div className="text-xs text-muted-foreground font-medium">
                Consolidated part totals across all stops so the warehouse picker can pull every battery from the racks in one pass:
              </div>
              <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
                {loadPlan.masterPullList.map((part) => (
                  <div
                    key={part.partNumber}
                    className="rounded-lg border border-border bg-background p-2.5 text-xs flex items-center justify-between gap-2"
                  >
                    <div className="space-y-0.5 min-w-0">
                      <div className="font-mono font-extrabold text-sm text-foreground flex items-center gap-2 flex-wrap">
                        <span>{part.partNumber}</span>
                        <span
                          className={`text-xs px-2 py-0.5 rounded border ${
                            part.isCabItem
                              ? badgeSky
                              : part.isHeavyBaseLayer
                                ? badgeAmber
                                : badgeGreen
                          }`}
                        >
                          {part.targetZoneLabel}
                        </span>
                      </div>
                      <div className="text-xs font-mono text-muted-foreground">
                        Used on Stop{part.stopNumbers.length > 1 ? "s" : ""}:{" "}
                        <strong className="text-foreground">
                          {part.stopNumbers.map((n) => `#${n}`).join(", ")}
                        </strong>{" "}
                        • ~{part.unitWeightLbs} lbs/ea
                      </div>
                    </div>

                    <div className="text-right font-mono shrink-0">
                      <div className="text-sm font-extrabold px-2.5 py-0.5 rounded bg-secondary border border-border text-foreground">
                        Pull: {part.totalQty}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        ~{part.totalWeightLbs} lbs
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-2.5">
              <div className="text-xs text-muted-foreground font-medium">
                Load in this exact sequence so heavy commercial batteries sit on the bottom layer and Stop #1 is right inside the Rear Barn Doors:
              </div>
              <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
                {loadingSteps.map((step, idx) => (
                  <div
                    key={`${step.stopOrder}-${idx}`}
                    className="rounded-lg border border-border bg-background p-2.5 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2 font-mono">
                      <span className="font-extrabold text-primary uppercase">
                        Step {idx + 1} → {step.zoneLabel}
                      </span>
                      <span className="font-bold">~{step.weightLbs} lbs</span>
                    </div>
                    <div className="font-bold text-sm text-foreground">
                      Stop #{step.stopOrder}: {step.accountName} ({step.city})
                    </div>
                    <div className="font-mono font-semibold text-foreground/90">
                      🔋 {step.partsText}
                    </div>
                    <div className="text-xs font-mono text-muted-foreground">
                      {step.layerHint}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
