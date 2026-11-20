import { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, Rectangle, CircleMarker, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getMapTileUrlTemplate } from "@/lib/auth";
import {
  type MapBoundingBox,
  type SavedMapRegion,
  type MapEtaHubMode,
  BUILTIN_MAP_PRESETS,
  FULL_MIDWEST_OVERVIEW_BOUNDS,
  UNLOCKED_NORTH_AMERICA_BOUNDS,
  normalizeMapBoundingBox,
  isValidMapBoundingBox,
  formatBoundsSummary,
} from "@shared/mapRegions";
import {
  Crop,
  Move,
  Maximize2,
  BookmarkPlus,
  Trash2,
  Check,
  ZoomIn,
  ZoomOut,
  Crosshair,
  Globe,
} from "lucide-react";

interface VehiclePin {
  id: string;
  name?: string;
  color?: string;
  location: { lat: number; lon: number };
  speed?: number;
}

export interface MapAreaSelectionResult {
  preset: string; // "auto-fit" | "corridor" | "sioux-falls" | ... | "custom" | "region:<id>"
  customBounds: MapBoundingBox | null;
  etaHub?: MapEtaHubMode;
}

interface MapAreaSelectorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  initialPreset?: string;
  initialCustomBounds?: MapBoundingBox | null;
  initialEtaHub?: MapEtaHubMode;
  showEtaHubSelector?: boolean;
  allowFollowDefault?: boolean;
  savedRegions: SavedMapRegion[];
  onSaveRegions?: (nextRegions: SavedMapRegion[]) => Promise<void> | void;
  vehicles?: VehiclePin[];
  onApply: (result: MapAreaSelectionResult) => void;
}

function SelectorMapController({
  mapRef,
  targetFit,
  fitNonce,
  drawMode,
  onBoxDrawn,
}: {
  mapRef: React.MutableRefObject<L.Map | null>;
  targetFit: MapBoundingBox | null;
  fitNonce: number;
  drawMode: boolean;
  onBoxDrawn: (box: MapBoundingBox) => void;
}) {
  const map = useMap();
  const [dragBoxPx, setDragBoxPx] = useState<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  } | null>(null);
  const startPtRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    mapRef.current = map;
    const t = setTimeout(() => {
      map.invalidateSize();
      if (targetFit) {
        map.fitBounds(
          [
            [targetFit.south, targetFit.west],
            [targetFit.north, targetFit.east],
          ],
          { padding: [24, 24], maxZoom: 15, animate: false },
        );
      }
    }, 80);
    return () => clearTimeout(t);
  }, [map]);

  useEffect(() => {
    if (!targetFit || fitNonce === 0) return;
    map.invalidateSize();
    map.fitBounds(
      [
        [targetFit.south, targetFit.west],
        [targetFit.north, targetFit.east],
      ],
      { padding: [24, 24], maxZoom: 15, animate: true },
    );
  }, [fitNonce, map, targetFit]);

  useEffect(() => {
    if (drawMode) {
      map.dragging.disable();
    } else {
      map.dragging.enable();
      setDragBoxPx(null);
      startPtRef.current = null;
    }
  }, [drawMode, map]);

  useEffect(() => {
    if (!drawMode) return;
    const container = map.getContainer();
    if (!container) return;

    const getRelPos = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(rect.width, e.clientX - rect.left)),
        y: Math.max(0, Math.min(rect.height, e.clientY - rect.top)),
      };
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const pt = getRelPos(e);
      startPtRef.current = pt;
      setDragBoxPx({ x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y });
    };

    const onMove = (e: PointerEvent) => {
      if (!startPtRef.current) return;
      const pt = getRelPos(e);
      setDragBoxPx({
        x1: startPtRef.current.x,
        y1: startPtRef.current.y,
        x2: pt.x,
        y2: pt.y,
      });
    };

    const onUp = (e: PointerEvent) => {
      if (!startPtRef.current) return;
      const endPt = getRelPos(e);
      const startPt = startPtRef.current;
      startPtRef.current = null;
      setDragBoxPx(null);

      if (Math.abs(endPt.x - startPt.x) < 14 || Math.abs(endPt.y - startPt.y) < 14) {
        return;
      }

      const ll1 = map.containerPointToLatLng(L.point(startPt.x, startPt.y));
      const ll2 = map.containerPointToLatLng(L.point(endPt.x, endPt.y));
      const drawn = normalizeMapBoundingBox({
        south: Math.min(ll1.lat, ll2.lat),
        north: Math.max(ll1.lat, ll2.lat),
        west: Math.min(ll1.lng, ll2.lng),
        east: Math.max(ll1.lng, ll2.lng),
      });
      onBoxDrawn(drawn);
    };

    container.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      container.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [drawMode, map, onBoxDrawn]);

  if (!dragBoxPx) return null;

  const left = Math.min(dragBoxPx.x1, dragBoxPx.x2);
  const top = Math.min(dragBoxPx.y1, dragBoxPx.y2);
  const width = Math.abs(dragBoxPx.x2 - dragBoxPx.x1);
  const height = Math.abs(dragBoxPx.y2 - dragBoxPx.y1);

  return (
    <div
      className="pointer-events-none absolute z-[1200] border-2 border-amber-400 bg-amber-500/20 shadow-[0_0_0_1px_rgba(0,0,0,0.6)]"
      style={{ left, top, width, height }}
    />
  );
}

const REFERENCE_HUBS = [
  { name: "Arlington Warehouse", lat: 44.3792, lon: -97.1406, color: "#f59e0b" },
  { name: "Sioux Falls Warehouse", lat: 43.5442, lon: -96.7644, color: "#38bdf8" },
  { name: "Aberdeen", lat: 45.4647, lon: -98.4865, color: "#a855f7" },
  { name: "Huron", lat: 44.3633, lon: -98.2143, color: "#10b981" },
  { name: "Watertown", lat: 44.8994, lon: -97.115, color: "#f97316" },
  { name: "Mitchell", lat: 43.7094, lon: -98.0298, color: "#eab308" },
];

export default function MapAreaSelectorModal({
  open,
  onOpenChange,
  title = "Customize Screen Map Area",
  initialPreset = "corridor",
  initialCustomBounds = null,
  initialEtaHub = "auto",
  showEtaHubSelector = false,
  allowFollowDefault = false,
  savedRegions,
  onSaveRegions,
  vehicles = [],
  onApply,
}: MapAreaSelectorModalProps) {
  const mapRef = useRef<L.Map | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<string>(initialPreset);
  const [customBounds, setCustomBounds] = useState<MapBoundingBox>(() =>
    isValidMapBoundingBox(initialCustomBounds)
      ? normalizeMapBoundingBox(initialCustomBounds)
      : BUILTIN_MAP_PRESETS[1].bounds!,
  );
  const [etaHub, setEtaHub] = useState<MapEtaHubMode>(initialEtaHub);
  const [toolMode, setToolMode] = useState<"pan" | "draw">("draw");
  const [fitTarget, setFitTarget] = useState<MapBoundingBox | null>(null);
  const [fitNonce, setFitNonce] = useState<number>(0);
  const [newRegionName, setNewRegionName] = useState<string>("");
  const [savingRegion, setSavingRegion] = useState<boolean>(false);
  const [fetchedVehicles, setFetchedVehicles] = useState<VehiclePin[]>([]);

  useEffect(() => {
    if (!open || vehicles.length > 0) return;
    fetch("/api/vehicles")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => {
        if (Array.isArray(d)) setFetchedVehicles(d);
      })
      .catch(() => {});
  }, [open, vehicles.length]);

  const effectiveVehicles = vehicles.length > 0 ? vehicles : fetchedVehicles;

  // Sync draft state whenever modal opens
  useEffect(() => {
    if (!open) return;
    const startPreset = initialPreset || (allowFollowDefault ? "auto" : "corridor");
    setSelectedPreset(startPreset);
    setEtaHub(initialEtaHub || "auto");
    setNewRegionName("");

    let startBounds = BUILTIN_MAP_PRESETS[1].bounds!;
    if (startPreset === "custom" && isValidMapBoundingBox(initialCustomBounds)) {
      startBounds = normalizeMapBoundingBox(initialCustomBounds);
    } else if (startPreset.startsWith("region:")) {
      const reg = savedRegions.find((r) => `region:${r.id}` === startPreset);
      if (reg) startBounds = reg.bounds;
    } else {
      const bp = BUILTIN_MAP_PRESETS.find((p) => p.id === startPreset);
      if (bp?.bounds) startBounds = bp.bounds;
    }

    setCustomBounds(startBounds);
    setFitTarget(startBounds);
    setFitNonce((n) => n + 1);
  }, [open, initialPreset, initialCustomBounds, initialEtaHub, allowFollowDefault, savedRegions]);

  // Active highlighted rectangle on the preview map (null when Auto-Fit / Follow Default)
  const activePreviewBounds: MapBoundingBox | null = (() => {
    if (selectedPreset === "auto" || selectedPreset === "auto-fit") return null;
    if (selectedPreset === "custom") return customBounds;
    if (selectedPreset.startsWith("region:")) {
      const reg = savedRegions.find((r) => `region:${r.id}` === selectedPreset);
      return reg ? reg.bounds : customBounds;
    }
    const bp = BUILTIN_MAP_PRESETS.find((p) => p.id === selectedPreset);
    return bp?.bounds || null;
  })();

  const triggerFitTo = (bounds: MapBoundingBox) => {
    setFitTarget(bounds);
    setFitNonce((n) => n + 1);
  };

  const handleSelectBuiltin = (presetId: string) => {
    setSelectedPreset(presetId);
    if (presetId === "auto") {
      triggerFitTo(BUILTIN_MAP_PRESETS[1].bounds!);
      return;
    }
    const bp = BUILTIN_MAP_PRESETS.find((p) => p.id === presetId);
    if (bp?.bounds) {
      if (!bp.isAutoFit) {
        setCustomBounds(bp.bounds);
      }
      if (bp.isAutoFit && effectiveVehicles.length > 0) {
        const lats = effectiveVehicles.map((v) => v.location.lat);
        const lons = effectiveVehicles.map((v) => v.location.lon);
        triggerFitTo(
          normalizeMapBoundingBox({
            south: Math.min(...lats) - 0.25,
            north: Math.max(...lats) + 0.25,
            west: Math.min(...lons) - 0.35,
            east: Math.max(...lons) + 0.35,
          }),
        );
      } else {
        triggerFitTo(bp.bounds);
      }
    }
  };

  const handleSelectSavedRegion = (reg: SavedMapRegion) => {
    setSelectedPreset(`region:${reg.id}`);
    setCustomBounds(reg.bounds);
    if (reg.etaHub) setEtaHub(reg.etaHub);
    triggerFitTo(reg.bounds);
  };

  const handleCaptureCurrentViewport = () => {
    const map = mapRef.current;
    if (!map) return;
    const b = map.getBounds();
    const captured = normalizeMapBoundingBox({
      south: b.getSouth(),
      west: b.getWest(),
      north: b.getNorth(),
      east: b.getEast(),
    });
    setCustomBounds(captured);
    setSelectedPreset("custom");
  };

  const handleSaveAsReusableRegion = async () => {
    if (!onSaveRegions) return;
    const trimmed = newRegionName.trim();
    if (!trimmed) return;
    const boundsToSave = activePreviewBounds || customBounds;
    const id = `reg-${trimmed
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 24)}-${Date.now().toString(36).slice(-4)}`;
    const created: SavedMapRegion = {
      id,
      name: trimmed,
      bounds: normalizeMapBoundingBox(boundsToSave),
      ...(showEtaHubSelector ? { etaHub } : {}),
    };
    setSavingRegion(true);
    try {
      const next = [...savedRegions, created];
      await onSaveRegions(next);
      setSelectedPreset(`region:${created.id}`);
      setNewRegionName("");
    } finally {
      setSavingRegion(false);
    }
  };

  const handleDeleteSavedRegion = async (regId: string) => {
    if (!onSaveRegions) return;
    const next = savedRegions.filter((r) => r.id !== regId);
    await onSaveRegions(next);
    if (selectedPreset === `region:${regId}`) {
      setSelectedPreset("custom");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-[95vw] max-h-[92vh] overflow-y-auto p-4 sm:p-5 space-y-3.5">
        <DialogHeader className="space-y-1">
          <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
            <Crop className="w-4 h-4 text-primary" />
            {title}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Pick a preset, pan & zoom to frame an area, or drag a custom selection box directly on the map. Every TV will automatically fit your chosen area regardless of 1080p or 4K screen size.
          </DialogDescription>
        </DialogHeader>

        {/* 1. QUICK PRESETS + SAVED COMPANY REGIONS */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-mono uppercase text-muted-foreground mr-1">
              Presets:
            </span>
            {allowFollowDefault && (
              <Button
                type="button"
                size="xs"
                variant={selectedPreset === "auto" ? "default" : "outline"}
                onClick={() => handleSelectBuiltin("auto")}
              >
                Auto (Screen Default)
              </Button>
            )}
            {BUILTIN_MAP_PRESETS.map((p) => (
              <Button
                key={p.id}
                type="button"
                size="xs"
                variant={selectedPreset === p.id ? "default" : "outline"}
                onClick={() => handleSelectBuiltin(p.id)}
                title={p.description}
                data-testid={`map-preset-${p.id}`}
              >
                {p.isAutoFit && <Globe className="w-3 h-3" />}
                {p.shortLabel}
              </Button>
            ))}
          </div>

          {savedRegions.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-mono uppercase text-primary mr-1">
                Saved Areas:
              </span>
              {savedRegions.map((reg) => {
                const isSelected = selectedPreset === `region:${reg.id}`;
                return (
                  <div
                    key={reg.id}
                    className={`inline-flex items-center rounded-sm border overflow-hidden text-xs ${
                      isSelected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-secondary/40 text-foreground"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => handleSelectSavedRegion(reg)}
                      className="px-2.5 py-1 font-semibold hover:opacity-90"
                    >
                      {reg.name}
                    </button>
                    {onSaveRegions && (
                      <button
                        type="button"
                        title={`Delete saved area "${reg.name}"`}
                        onClick={() => handleDeleteSavedRegion(reg.id)}
                        className={`px-1.5 py-1 border-l ${
                          isSelected
                            ? "border-primary-foreground/30 hover:bg-black/20"
                            : "border-border text-muted-foreground hover:text-destructive"
                        }`}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 2. INTERACTIVE MAP TOOLBAR + CANVAS */}
        <div className="rounded-md border border-border overflow-hidden bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-secondary/60 border-b border-border">
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                type="button"
                size="xs"
                variant={toolMode === "draw" ? "default" : "outline"}
                onClick={() => setToolMode("draw")}
                data-testid="btn-map-tool-draw"
              >
                <Crop className="w-3.5 h-3.5" />
                Draw Box on Map
              </Button>
              <Button
                type="button"
                size="xs"
                variant={toolMode === "pan" ? "default" : "outline"}
                onClick={() => setToolMode("pan")}
                data-testid="btn-map-tool-pan"
              >
                <Move className="w-3.5 h-3.5" />
                Pan & Zoom Map
              </Button>
              <Button
                type="button"
                size="xs"
                variant="secondary"
                onClick={handleCaptureCurrentViewport}
                title="Lock the currently visible map frame as your custom area"
                data-testid="btn-capture-map-viewport"
              >
                <Crosshair className="w-3.5 h-3.5" />
                Use Current Map View
              </Button>
              {activePreviewBounds && (
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={() => triggerFitTo(activePreviewBounds)}
                  title="Zoom preview camera to fit the highlighted amber selection box"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                  Zoom to Selection
                </Button>
              )}
            </div>

            <div className="flex items-center gap-1">
              <Button
                type="button"
                size="xs"
                variant="outline"
                className="px-2"
                onClick={() => mapRef.current?.zoomIn()}
                title="Zoom In"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </Button>
              <Button
                type="button"
                size="xs"
                variant="outline"
                className="px-2"
                onClick={() => mapRef.current?.zoomOut()}
                title="Zoom Out"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </Button>
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => triggerFitTo(FULL_MIDWEST_OVERVIEW_BOUNDS)}
                title="Zoom out to multi-state Midwest overview"
              >
                Zoom Out (Midwest)
              </Button>
            </div>
          </div>

          <div
            className={`relative h-[370px] sm:h-[420px] w-full ${
              toolMode === "draw" ? "cursor-crosshair" : "cursor-grab"
            }`}
          >
            <MapContainer
              center={[44.2, -97.3]}
              zoom={7}
              minZoom={4}
              maxZoom={17}
              maxBounds={[
                UNLOCKED_NORTH_AMERICA_BOUNDS.southwest,
                UNLOCKED_NORTH_AMERICA_BOUNDS.northeast,
              ]}
              scrollWheelZoom={true}
              zoomControl={false}
              className="h-full w-full bg-background"
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url={getMapTileUrlTemplate()}
                maxZoom={19}
              />

              <SelectorMapController
                mapRef={mapRef}
                targetFit={fitTarget}
                fitNonce={fitNonce}
                drawMode={toolMode === "draw"}
                onBoxDrawn={(drawn) => {
                  setCustomBounds(drawn);
                  setSelectedPreset("custom");
                }}
              />

              {/* Highlighted Amber Selection Rectangle */}
              {activePreviewBounds && (
                <Rectangle
                  bounds={[
                    [activePreviewBounds.south, activePreviewBounds.west],
                    [activePreviewBounds.north, activePreviewBounds.east],
                  ]}
                  pathOptions={{
                    color: "#f59e0b",
                    weight: 3,
                    fillColor: "#f59e0b",
                    fillOpacity: 0.14,
                    dashArray: selectedPreset === "custom" ? "6, 4" : undefined,
                  }}
                />
              )}

              {/* Reference Company Hubs & Corridor Cities */}
              {REFERENCE_HUBS.map((hub) => (
                <CircleMarker
                  key={hub.name}
                  center={[hub.lat, hub.lon]}
                  radius={5}
                  pathOptions={{
                    color: "#ffffff",
                    weight: 1.5,
                    fillColor: hub.color,
                    fillOpacity: 0.95,
                  }}
                >
                  <Tooltip direction="top" offset={[0, -4]} permanent={false}>
                    <span className="text-xs font-semibold">{hub.name}</span>
                  </Tooltip>
                </CircleMarker>
              ))}

              {/* Live Fleet Vehicles */}
              {effectiveVehicles.map((v) => (
                <CircleMarker
                  key={v.id}
                  center={[v.location.lat, v.location.lon]}
                  radius={6}
                  pathOptions={{
                    color: "#111827",
                    weight: 2,
                    fillColor: v.color || "#10b981",
                    fillOpacity: 1,
                  }}
                >
                  <Tooltip direction="top" offset={[0, -5]}>
                    <span className="text-xs font-mono font-bold">
                      {v.name || v.id} {v.speed ? `(${v.speed} mph)` : ""}
                    </span>
                  </Tooltip>
                </CircleMarker>
              ))}
            </MapContainer>

            {/* Subtle helper pill in bottom-left of map */}
            <div className="pointer-events-none absolute bottom-2.5 left-2.5 z-[1000] rounded bg-background/90 border border-border px-2.5 py-1 text-[11px] font-mono text-foreground shadow">
              {toolMode === "draw"
                ? "Click & drag anywhere on the map to draw your screen's map box (scroll wheel zooms)"
                : "Drag & scroll to frame the map, then click 'Use Current Map View'"}
            </div>
          </div>
        </div>

        {/* 3. SELECTION READOUT + SAVE REUSABLE REGION + OPTIONAL ETA HUB */}
        <div className="grid gap-3 sm:grid-cols-2 items-end rounded-md border border-border bg-secondary/20 p-3">
          <div className="space-y-1 min-w-0">
            <div className="text-[11px] font-mono uppercase text-muted-foreground">
              Selected Screen Map Area
            </div>
            <div className="text-xs font-semibold text-foreground truncate" data-testid="selected-map-area-summary">
              {selectedPreset === "auto"
                ? "Auto (Follow Active Screen Default)"
                : selectedPreset === "auto-fit"
                  ? "Full Map — Auto-Fit All Active Fleet Vehicles"
                  : activePreviewBounds
                    ? formatBoundsSummary(activePreviewBounds)
                    : "Regional View"}
            </div>
            {showEtaHubSelector && (
              <div className="pt-1.5 flex flex-wrap items-center gap-1.5">
                <Label className="text-[11px] text-muted-foreground">Return ETA Hub:</Label>
                {(
                  [
                    { id: "auto", label: "Auto" },
                    { id: "main", label: "Arlington Whs" },
                    { id: "sf", label: "Sioux Falls Whs" },
                    { id: "none", label: "Hide ETA" },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setEtaHub(opt.id)}
                    className={`px-2 py-0.5 rounded-sm border text-[11px] font-mono ${
                      etaHub === opt.id
                        ? "bg-primary text-primary-foreground border-primary font-bold"
                        : "bg-background border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {onSaveRegions && activePreviewBounds && (
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground block">
                Save This Box as a Reusable Company Area (Optional)
              </Label>
              <div className="flex items-center gap-1.5">
                <Input
                  value={newRegionName}
                  onChange={(e) => setNewRegionName(e.target.value)}
                  placeholder='e.g., "Aberdeen Hwy 12" or "SF Metro South"'
                  className="h-8 text-xs"
                  data-testid="input-save-map-region-name"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="h-8 shrink-0 gap-1 text-xs"
                  disabled={!newRegionName.trim() || savingRegion}
                  onClick={handleSaveAsReusableRegion}
                  data-testid="btn-save-reusable-map-region"
                >
                  <BookmarkPlus className="w-3.5 h-3.5" />
                  Save Area
                </Button>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            data-testid="btn-apply-map-area"
            onClick={() => {
              onApply({
                preset: selectedPreset,
                customBounds:
                  selectedPreset === "custom"
                    ? customBounds
                    : activePreviewBounds || customBounds,
                etaHub,
              });
              onOpenChange(false);
            }}
          >
            <Check className="w-4 h-4" />
            Apply Map Area
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
