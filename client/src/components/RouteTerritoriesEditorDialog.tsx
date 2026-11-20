import { useState, useEffect, useMemo } from "react";
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
import { useToast } from "@/hooks/use-toast";
import TrackingMap from "@/components/TrackingMap";
import {
  DEFAULT_ROUTE_TERRITORIES,
  normalizeRouteTerritories,
  computeRouteTerritoryPolygon,
  type RouteTerritoryDefinition,
  type ResolvedRouteOverlay,
} from "@shared/routeTerritories";
import type { MapBoundingBox } from "@shared/mapRegions";
import {
  Palette,
  MapPin,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Star,
  RotateCcw,
  Save,
  Search,
  Loader2,
} from "lucide-react";

const COLOR_SWATCHES = [
  "#38bdf8",
  "#22d3ee",
  "#34d399",
  "#4ade80",
  "#a3e635",
  "#facc15",
  "#fb923c",
  "#f97316",
  "#f87171",
  "#f472b6",
  "#c084fc",
  "#818cf8",
];

interface RouteTerritoriesEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  routeTerritories?: RouteTerritoryDefinition[];
  onSaved: (nextState: any) => void;
}

export default function RouteTerritoriesEditorDialog({
  open,
  onOpenChange,
  routeTerritories,
  onSaved,
}: RouteTerritoriesEditorDialogProps) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<RouteTerritoryDefinition[]>(() =>
    normalizeRouteTerritories(routeTerritories, DEFAULT_ROUTE_TERRITORIES),
  );
  const [selectedRouteId, setSelectedRouteId] = useState<string>(
    () => draft[0]?.id || "route-benson",
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [saving, setSaving] = useState(false);

  // Add-town form state
  const [newTownName, setNewTownName] = useState("");
  const [newTownState, setNewTownState] = useState("SD");
  const [newTownAnchor, setNewTownAnchor] = useState(false);
  const [geocoding, setGeocoding] = useState(false);

  // Sync draft when dialog opens
  useEffect(() => {
    if (open) {
      const normalized = structuredClone(
        normalizeRouteTerritories(routeTerritories, DEFAULT_ROUTE_TERRITORIES),
      );
      setDraft(normalized);
      if (!normalized.some((r) => r.id === selectedRouteId)) {
        setSelectedRouteId(normalized[0]?.id || "");
      }
    }
  }, [open, routeTerritories]);

  const selectedRoute = useMemo(
    () => draft.find((r) => r.id === selectedRouteId) || draft[0] || null,
    [draft, selectedRouteId],
  );

  const filteredRoutes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return draft;
    return draft.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.truckGroup.toLowerCase().includes(q) ||
        r.scheduleCodes.some((c) => c.toLowerCase().includes(q)) ||
        r.stops.some((s) => s.name.toLowerCase().includes(q)),
    );
  }, [draft, searchQuery]);

  const updateSelectedRoute = (
    updater: (r: RouteTerritoryDefinition) => RouteTerritoryDefinition,
  ) => {
    if (!selectedRoute) return;
    setDraft((prev) =>
      prev.map((item) => (item.id === selectedRoute.id ? updater(item) : item)),
    );
  };

  // Compute live preview overlay + bounding box for the selected route
  const previewSpec = useMemo((): {
    overlay: ResolvedRouteOverlay | null;
    bounds: MapBoundingBox | null;
  } => {
    if (!selectedRoute || selectedRoute.stops.length === 0) {
      return { overlay: null, bounds: null };
    }
    const { polygon, centroid } = computeRouteTerritoryPolygon(selectedRoute.stops);
    const lats = polygon.length > 0 ? polygon.map((p) => p[0]) : selectedRoute.stops.map((s) => s.lat);
    const lons = polygon.length > 0 ? polygon.map((p) => p[1]) : selectedRoute.stops.map((s) => s.lon);
    const south = Math.min(...lats) - 0.08;
    const north = Math.max(...lats) + 0.08;
    const west = Math.min(...lons) - 0.12;
    const east = Math.max(...lons) + 0.12;

    return {
      overlay: {
        id: selectedRoute.id,
        name: selectedRoute.name,
        truckGroup: selectedRoute.truckGroup,
        assignedDriver: selectedRoute.defaultDriver,
        color: selectedRoute.color,
        stops: selectedRoute.stops,
        polygon,
        centroid,
      },
      bounds: { south, west, north, east },
    };
  }, [selectedRoute]);

  const handleAddTownByGeocode = async () => {
    const cleanName = newTownName.trim();
    if (!cleanName || !selectedRoute) return;

    setGeocoding(true);
    try {
      const res = await fetch("/api/display/geocode-town", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: cleanName, state: newTownState }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `Could not locate ${cleanName}, ${newTownState}`);
      }

      updateSelectedRoute((r) => ({
        ...r,
        stops: [
          ...r.stops,
          {
            name: data.name || cleanName,
            state: data.state || newTownState,
            lat: data.lat,
            lon: data.lon,
            ...(newTownAnchor ? { anchor: true } : {}),
          },
        ],
      }));
      setNewTownName("");
      setNewTownAnchor(false);
      toast({
        title: `Added ${data.name || cleanName}, ${data.state || newTownState}`,
        description: `Coordinates: ${data.lat}, ${data.lon}`,
      });
    } catch (err: any) {
      toast({
        title: "Town Lookup Failed",
        description: err.message || "Check town spelling and state.",
        variant: "destructive",
      });
    } finally {
      setGeocoding(false);
    }
  };

  const handleAddNewRoute = () => {
    const id = `route-custom-${Date.now().toString(36)}`;
    const newRoute: RouteTerritoryDefinition = {
      id,
      name: "New Custom Route (SD)",
      truckGroup: "Custom Fleet Routes",
      defaultDriver: "",
      color: "#38bdf8",
      scheduleCodes: ["CUSTOM"],
      stops: [
        {
          name: "Arlington",
          state: "SD",
          lat: 44.3644,
          lon: -97.1331,
          anchor: true,
        },
      ],
    };
    setDraft((prev) => [newRoute, ...prev]);
    setSelectedRouteId(id);
  };

  const handleDeleteSelectedRoute = () => {
    if (!selectedRoute) return;
    if (draft.length <= 1) {
      toast({ title: "At least one route must remain", variant: "destructive" });
      return;
    }
    const remaining = draft.filter((r) => r.id !== selectedRoute.id);
    setDraft(remaining);
    setSelectedRouteId(remaining[0]?.id || "");
  };

  const handleSaveAll = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/display/route-territories", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ routeTerritories: draft }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to save route territories");
      }
      if (data.state) onSaved(data.state);
      toast({
        title: "Route Map Colors & Town Sequences Saved",
        description: `Synced ${draft.length} colored routes to all live TV & dispatch maps.`,
      });
      onOpenChange(false);
    } catch (err: any) {
      toast({
        title: "Save Failed",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleResetToDefaults = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/display/route-territories", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resetToDefault: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to reset route territories");
      }
      if (data.routeTerritories) {
        setDraft(structuredClone(data.routeTerritories));
        setSelectedRouteId(data.routeTerritories[0]?.id || "");
      }
      if (data.state) onSaved(data.state);
      toast({
        title: "Restored Official 23-Route PDF Defaults",
        description: "All town sequences and colors reset to Route Town Sequence.pdf.",
      });
    } catch (err: any) {
      toast({
        title: "Reset Failed",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[92vh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-5 pb-3 border-b border-border shrink-0">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Palette className="w-5 h-5 text-sky-400" />
            Colored Map Routes &amp; Town Sequences ({draft.length} Routes)
          </DialogTitle>
          <DialogDescription className="text-xs">
            Pre-loaded from <strong>Route Town Sequence.pdf</strong>. Customize route colors, schedule match codes, or town stop order — live TV and dispatch maps highlight matching routes automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-12 overflow-hidden">
          {/* LEFT 4 COLS: ROUTE SELECTOR LIST */}
          <div className="md:col-span-4 border-r border-border flex flex-col min-h-0 bg-secondary/15">
            <div className="p-3 border-b border-border space-y-2 shrink-0">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-2.5" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search route or town..."
                  className="h-8 pl-8 text-xs"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="xs"
                className="w-full gap-1.5 text-xs"
                onClick={handleAddNewRoute}
              >
                <Plus className="w-3.5 h-3.5 text-sky-400" />
                Create New Route Territory
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {filteredRoutes.map((rt) => {
                const active = rt.id === selectedRoute?.id;
                return (
                  <button
                    key={rt.id}
                    type="button"
                    onClick={() => setSelectedRouteId(rt.id)}
                    className={`w-full rounded-lg border px-2.5 py-2 text-left transition-colors ${
                      active
                        ? "border-primary bg-primary/15 text-foreground"
                        : "border-border/60 bg-card/60 hover:bg-secondary/50 text-foreground"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 min-w-0">
                        <span
                          className="w-3 h-3 rounded-sm shrink-0 border border-black/25"
                          style={{ backgroundColor: rt.color }}
                        />
                        <span className="text-xs font-bold truncate">{rt.name}</span>
                      </span>
                      <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                        {rt.stops.length} towns
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                      <span className="truncate">{rt.truckGroup}</span>
                      <span className="font-mono truncate max-w-[110px]">
                        {rt.scheduleCodes[0] || ""}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* RIGHT 8 COLS: SELECTED ROUTE EDITOR + MINI-MAP PREVIEW */}
          {selectedRoute ? (
            <div className="md:col-span-8 flex flex-col min-h-0 overflow-y-auto p-4 space-y-4">
              {/* Route Metadata & Color */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Route Name</Label>
                  <Input
                    value={selectedRoute.name}
                    onChange={(e) =>
                      updateSelectedRoute((r) => ({ ...r, name: e.target.value }))
                    }
                    className="h-8 text-xs font-semibold"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Truck / Driver Group</Label>
                  <Input
                    value={selectedRoute.truckGroup}
                    onChange={(e) =>
                      updateSelectedRoute((r) => ({ ...r, truckGroup: e.target.value }))
                    }
                    className="h-8 text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
                <div className="space-y-1.5">
                  <Label className="text-xs">Map Highlight Color</Label>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <input
                      type="color"
                      value={selectedRoute.color}
                      onChange={(e) =>
                        updateSelectedRoute((r) => ({ ...r, color: e.target.value }))
                      }
                      className="h-7 w-9 rounded border border-border bg-transparent cursor-pointer"
                    />
                    {COLOR_SWATCHES.map((hex) => (
                      <button
                        key={hex}
                        type="button"
                        onClick={() => updateSelectedRoute((r) => ({ ...r, color: hex }))}
                        className={`w-5 h-5 rounded-full border-2 transition-transform ${
                          selectedRoute.color.toLowerCase() === hex.toLowerCase()
                            ? "border-white scale-110"
                            : "border-transparent opacity-80 hover:opacity-100"
                        }`}
                        style={{ backgroundColor: hex }}
                      />
                    ))}
                  </div>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">
                    Schedule Match Codes (comma-separated)
                  </Label>
                  <Input
                    value={selectedRoute.scheduleCodes.join(", ")}
                    onChange={(e) =>
                      updateSelectedRoute((r) => ({
                        ...r,
                        scheduleCodes: e.target.value
                          .split(",")
                          .map((s) => s.trim().toUpperCase())
                          .filter(Boolean),
                      }))
                    }
                    placeholder="e.g., SLEEPY EYE, SLEEPY EYE-BOM/PIPE/SLAY"
                    className="h-8 text-xs font-mono"
                  />
                </div>
              </div>

              {/* Live Territory Mini-Map Preview */}
              {previewSpec.overlay && previewSpec.bounds && (
                <div className="h-44 w-full rounded-lg overflow-hidden border border-border relative shrink-0">
                  <TrackingMap
                    key={`route-editor-preview-${selectedRoute.id}-${selectedRoute.stops.length}`}
                    data={[]}
                    center={previewSpec.overlay.centroid}
                    zoom={8}
                    fitRegionBounds={previewSpec.bounds}
                    autoFitBounds={false}
                    unlockMaxBounds
                    readOnly
                    darkMode
                    baseLocation={null}
                    routeOverlays={[previewSpec.overlay]}
                    showRouteLegend={false}
                  />
                  <div className="absolute top-2 right-2 z-[900] rounded bg-zinc-950/85 border border-zinc-700 px-2 py-0.5 text-[10px] font-mono text-zinc-200">
                    Live Territory Preview • {selectedRoute.stops.length} stops
                  </div>
                </div>
              )}

              {/* Add Town via Auto-Geocode */}
              <div className="rounded-lg border border-border bg-secondary/20 p-3 space-y-2">
                <Label className="text-xs flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-sky-400" />
                  Add Town to Route Sequence (Auto-Locates GPS Coordinates)
                </Label>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    value={newTownName}
                    onChange={(e) => setNewTownName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddTownByGeocode();
                      }
                    }}
                    placeholder="Town name (e.g., Brandon)"
                    className="h-8 text-xs flex-1 min-w-[150px]"
                  />
                  <select
                    value={newTownState}
                    onChange={(e) => setNewTownState(e.target.value)}
                    className="h-8 rounded border border-border bg-background px-2 text-xs font-mono font-bold"
                  >
                    <option value="SD">SD</option>
                    <option value="MN">MN</option>
                    <option value="IA">IA</option>
                    <option value="ND">ND</option>
                    <option value="NE">NE</option>
                  </select>
                  <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer select-none px-1">
                    <input
                      type="checkbox"
                      checked={newTownAnchor}
                      onChange={(e) => setNewTownAnchor(e.target.checked)}
                    />
                    <span className="text-amber-400 font-semibold">★ Anchor</span>
                  </label>
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleAddTownByGeocode}
                    disabled={geocoding || !newTownName.trim()}
                    className="h-8 gap-1.5 text-xs"
                  >
                    {geocoding ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Plus className="w-3.5 h-3.5" />
                    )}
                    Auto-Locate &amp; Add
                  </Button>
                </div>
              </div>

              {/* Ordered Town Stops List */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">
                    Ordered Town Sequence ({selectedRoute.stops.length} Towns)
                  </Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="text-red-400 hover:text-red-300 hover:bg-red-500/10 gap-1 text-[11px]"
                    onClick={handleDeleteSelectedRoute}
                  >
                    <Trash2 className="w-3 h-3" />
                    Delete Entire Route
                  </Button>
                </div>

                <div className="rounded-lg border border-border divide-y divide-border/60 max-h-56 overflow-y-auto bg-card/50">
                  {selectedRoute.stops.map((stop, idx) => (
                    <div
                      key={`${stop.name}-${stop.state}-${idx}`}
                      className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-6 text-[10px] font-mono text-muted-foreground">
                          #{idx + 1}
                        </span>
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{
                            backgroundColor: selectedRoute.color,
                            boxShadow: stop.anchor ? "0 0 0 2px #fbbf24" : undefined,
                          }}
                        />
                        <span className="font-semibold truncate">
                          {stop.name}, {stop.state}
                        </span>
                        {stop.anchor && (
                          <span className="rounded bg-amber-500/20 border border-amber-500/40 text-amber-300 px-1.5 py-0.2 text-[10px] font-semibold">
                            ★ Anchor
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-[10px] font-mono text-muted-foreground hidden sm:inline mr-1">
                          {stop.lat.toFixed(3)}, {stop.lon.toFixed(3)}
                        </span>
                        <button
                          type="button"
                          title="Toggle Highlighted Anchor / Overnight Town"
                          onClick={() =>
                            updateSelectedRoute((r) => ({
                              ...r,
                              stops: r.stops.map((s, i) =>
                                i === idx ? { ...s, anchor: !s.anchor } : s,
                              ),
                            }))
                          }
                          className={`p-1 rounded hover:bg-secondary ${
                            stop.anchor ? "text-amber-400" : "text-muted-foreground"
                          }`}
                        >
                          <Star className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          title="Move Town Up"
                          disabled={idx === 0}
                          onClick={() =>
                            updateSelectedRoute((r) => {
                              const next = [...r.stops];
                              [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                              return { ...r, stops: next };
                            })
                          }
                          className="p-1 rounded hover:bg-secondary disabled:opacity-30"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          title="Move Town Down"
                          disabled={idx === selectedRoute.stops.length - 1}
                          onClick={() =>
                            updateSelectedRoute((r) => {
                              const next = [...r.stops];
                              [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
                              return { ...r, stops: next };
                            })
                          }
                          className="p-1 rounded hover:bg-secondary disabled:opacity-30"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          title="Remove Town from Route"
                          disabled={selectedRoute.stops.length <= 1}
                          onClick={() =>
                            updateSelectedRoute((r) => ({
                              ...r,
                              stops: r.stops.filter((_, i) => i !== idx),
                            }))
                          }
                          className="p-1 rounded text-red-400 hover:bg-red-500/15 disabled:opacity-30"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <DialogFooter className="px-6 py-3 border-t border-border bg-card flex flex-wrap items-center justify-between gap-2 shrink-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleResetToDefaults}
            disabled={saving}
            className="gap-1.5 text-xs"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset to PDF Defaults (23 Routes)
          </Button>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSaveAll}
              disabled={saving}
              className="gap-1.5"
              data-testid="button-save-route-territories"
            >
              <Save className="w-3.5 h-3.5" />
              {saving ? "Saving..." : "Save Route Colors & Sequences"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
