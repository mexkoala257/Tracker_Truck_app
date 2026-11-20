import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import CustomScreenCanvas from "@/components/CustomScreenCanvas";
import MapAreaSelectorModal from "@/components/MapAreaSelectorModal";
import { type ReturnEtaWarehouse } from "@/components/ReturnEtaPanel";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BUILTIN_SCREENS,
  WIDGET_CATALOG,
  LAYOUT_TEMPLATES,
  SCREEN_BLUEPRINTS,
  DEFAULT_COMPANY_PLAYLIST,
  DISPLAY_THEMES,
  clampWidgetBox,
  getCatalogEntry,
  normalizePlaylistEntries,
  resolveEffectivePlaylist,
  resolveEffectiveDisplayTheme,
  isBuiltInScreenId,
  createDefaultBuiltInScreenDefinition,
  type CustomScreenDefinition,
  type ScreenWidgetInstance,
  type ScreenWidgetType,
  type PlaylistEntry,
  type LayoutTemplatePreset,
  type BlueprintScreenPreset,
  type DisplayThemeId,
} from "@shared/customScreens";
import {
  BUILTIN_MAP_PRESETS,
  formatBoundsSummary,
  isValidMapBoundingBox,
  resolveMapViewSpec,
  type SavedMapRegion,
} from "@shared/mapRegions";
import {
  ROUTE_FILTER_OPTIONS,
  normalizeRouteTerritories,
  DEFAULT_ROUTE_TERRITORIES,
} from "@shared/routeTerritories";
import {
  normalizePhotoGalleryState,
  resolveActiveGalleryPhotos,
} from "@shared/photoGallery";
import { WEATHER_OVERLAY_MODES } from "@shared/weatherOverlay";
import {
  LayoutGrid,
  Plus,
  Copy,
  Trash2,
  Save,
  Sparkles,
  Tv,
  ArrowUp,
  ArrowDown,
  Upload,
  RefreshCw,
  Play,
  Pin,
  Layers,
  CheckCircle2,
  ListOrdered,
  Move,
  Maximize2,
  Eye,
  EyeOff,
  FolderOpen,
  RotateCcw,
  Palette,
  Crop,
  Pencil,
} from "lucide-react";

export interface ScreenDesignerStudioProps {
  displayState: any;
  mapHomeLocations?: any;
  editScreenRequest?: { screenId: string; nonce: number } | null;
  onStateUpdated: (nextState: any) => void;
  onRemoteControl: (
    activePanel: string | undefined,
    targetScope: "all" | "group" | "display",
    targetId: string,
    action?: string,
  ) => Promise<void> | void;
}

const ACCENT_PRESETS = [
  { label: "Highway Amber", hex: "#E59A23" },
  { label: "Signal Green", hex: "#22A06B" },
  { label: "Dispatch Rust", hex: "#D97736" },
  { label: "Alert Crimson", hex: "#E05252" },
  { label: "Rail Brass", hex: "#C8A24B" },
  { label: "Steel Slate", hex: "#6B93B8" },
];

const WIDGET_PALETTE_COLORS: Record<ScreenWidgetType, string> = {
  today_snapshot: "border-amber-500/75 bg-amber-500/20 text-amber-100",
  sf_daily_shift: "border-cyan-400/80 bg-cyan-500/20 text-cyan-100",
  hotshot_board: "border-amber-400/80 bg-amber-500/25 text-amber-100",
  nws_alerts: "border-orange-500/75 bg-orange-500/20 text-orange-100",
  safety_streak: "border-emerald-500/75 bg-emerald-500/20 text-emerald-100",
  big_countdown: "border-yellow-500/75 bg-yellow-500/20 text-yellow-100",
  media_qr: "border-stone-400/75 bg-stone-500/25 text-stone-100",
  custom_info: "border-amber-400/75 bg-amber-600/20 text-amber-100",
  live_map: "border-emerald-400/75 bg-emerald-600/20 text-emerald-100",
  truck_schedule: "border-amber-500/70 bg-amber-500/15 text-amber-100",
  sf_schedule: "border-teal-500/70 bg-teal-500/20 text-teal-100",
  announcements: "border-orange-400/75 bg-orange-600/20 text-orange-100",
  calendar: "border-stone-400/70 bg-stone-600/25 text-stone-100",
  renewals: "border-red-500/75 bg-red-500/20 text-red-100",
  weather_multi: "border-slate-400/75 bg-slate-500/25 text-slate-100",
  photo_gallery: "border-pink-400/75 bg-pink-500/20 text-pink-100",
};

function makeWidgetId() {
  return `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function makeScreenId(name: string, existingIds: Set<string>): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 28) || "screen";
  let candidate = `custom-${slug}`;
  let n = 2;
  while (existingIds.has(candidate)) {
    candidate = `custom-${slug}-${n++}`;
  }
  return candidate;
}

/**
 * Finds an unoccupied rectangle of size (w, h) on the 12x6 grid if one exists;
 * otherwise cascades neatly near the bottom-right.
 */
function findOpenGridSlot(
  widgets: ScreenWidgetInstance[],
  desiredW: number,
  desiredH: number,
): { x: number; y: number; w: number; h: number } {
  const w = Math.max(2, Math.min(12, desiredW));
  const h = Math.max(1, Math.min(6, desiredH));

  const occupied = Array.from({ length: 6 }, () => Array(12).fill(false));
  for (const item of widgets) {
    const box = clampWidgetBox(item);
    for (let r = box.y; r < box.y + box.h; r++) {
      for (let c = box.x; c < box.x + box.w; c++) {
        if (r >= 0 && r < 6 && c >= 0 && c < 12) {
          occupied[r][c] = true;
        }
      }
    }
  }

  for (let r = 0; r <= 6 - h; r++) {
    for (let c = 0; c <= 12 - w; c++) {
      let fits = true;
      for (let dr = 0; dr < h && fits; dr++) {
        for (let dc = 0; dc < w; dc++) {
          if (occupied[r + dr][c + dc]) {
            fits = false;
            break;
          }
        }
      }
      if (fits) {
        return { x: c, y: r, w, h };
      }
    }
  }

  // Try a compact 4x3 slot if default was larger
  if (w > 4 || h > 2) {
    const compactW = Math.min(w, 4);
    const compactH = Math.min(h, 3);
    for (let r = 0; r <= 6 - compactH; r++) {
      for (let c = 0; c <= 12 - compactW; c++) {
        let fits = true;
        for (let dr = 0; dr < compactH && fits; dr++) {
          for (let dc = 0; dc < compactW; dc++) {
            if (occupied[r + dr][c + dc]) {
              fits = false;
              break;
            }
          }
        }
        if (fits) {
          return { x: c, y: r, w: compactW, h: compactH };
        }
      }
    }
  }

  return clampWidgetBox({ x: 12 - w, y: 6 - h, w, h });
}

export default function ScreenDesignerStudio({
  displayState,
  mapHomeLocations,
  editScreenRequest,
  onStateUpdated,
  onRemoteControl,
}: ScreenDesignerStudioProps) {
  const { toast } = useToast();

  // Sub-navigation: Designer vs Playlists
  const [studioTab, setStudioTab] = useState<"designer" | "playlists">("designer");
  const [showCreateBar, setShowCreateBar] = useState<boolean>(false);

  // Local editable drafts initialized from displayState
  const [screensDraft, setScreensDraft] = useState<CustomScreenDefinition[]>([]);
  const [defaultPlaylistDraft, setDefaultPlaylistDraft] = useState<PlaylistEntry[]>([]);
  const [groupPlaylistsDraft, setGroupPlaylistsDraft] = useState<Record<string, PlaylistEntry[] | null>>({});
  const [unitPlaylistsDraft, setUnitPlaylistsDraft] = useState<
    Record<string, { playlistMode: "group" | "custom"; playlist: PlaylistEntry[] }>
  >({});

  const [selectedScreenId, setSelectedScreenId] = useState<string>("");
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [syncingNws, setSyncingNws] = useState(false);
  const [widgetPickerCategory, setWidgetPickerCategory] = useState<string>("all");
  const [pinScopeValue, setPinScopeValue] = useState<string>("all");

  // Playlist manager selected target: "default" | "group:<id>" | "unit:<id>"
  const [playlistTarget, setPlaylistTarget] = useState<string>("default");

  // Live vehicles for accurate map & route MPH preview
  const [liveVehicles, setLiveVehicles] = useState<any[]>([]);

  // Interactive 12x6 grid drag state
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [dragState, setDragState] = useState<{
    widgetId: string;
    mode: "move" | "resize";
    startClientX: number;
    startClientY: number;
    origBox: { x: number; y: number; w: number; h: number };
  } | null>(null);

  // Hydrate drafts from displayState whenever not dirty (or on initial load)
  const hydrateFromServerState = useCallback((st: any) => {
    if (!st) return;
    const incomingScreens: CustomScreenDefinition[] = Array.isArray(st.customScreens)
      ? JSON.parse(JSON.stringify(st.customScreens))
      : [];
    setScreensDraft(incomingScreens);

    const defPl = normalizePlaylistEntries(
      st.settings?.defaultPlaylist || DEFAULT_COMPANY_PLAYLIST,
      incomingScreens,
      true,
    );
    setDefaultPlaylistDraft(defPl);

    const grpMap: Record<string, PlaylistEntry[] | null> = {};
    for (const g of st.settings?.displayGroups || []) {
      grpMap[g.id] = Array.isArray(g.playlist) && g.playlist.length > 0
        ? normalizePlaylistEntries(g.playlist, incomingScreens, false)
        : null;
    }
    setGroupPlaylistsDraft(grpMap);

    const unitMap: Record<string, { playlistMode: "group" | "custom"; playlist: PlaylistEntry[] }> = {};
    for (const [id, prof] of Object.entries((st.settings?.displayProfiles || {}) as Record<string, any>)) {
      unitMap[id] = {
        playlistMode: prof.playlistMode === "custom" ? "custom" : "group",
        playlist: normalizePlaylistEntries(
          prof.playlist || defPl,
          incomingScreens,
          false,
        ),
      };
    }
    setUnitPlaylistsDraft(unitMap);
    setIsDirty(false);

    setSelectedScreenId((prev) => {
      if (
        prev &&
        (isBuiltInScreenId(prev) || incomingScreens.some((s) => s.id === prev))
      ) {
        return prev;
      }
      const firstCustom = incomingScreens.find((s) => !isBuiltInScreenId(s.id));
      return firstCustom?.id || "screen-1";
    });
  }, []);

  const initializedRef = useRef(false);
  useEffect(() => {
    if (!displayState) return;
    if (!initializedRef.current || !isDirty) {
      hydrateFromServerState(displayState);
      initializedRef.current = true;
    }
  }, [displayState, isDirty, hydrateFromServerState]);

  useEffect(() => {
    fetch("/api/vehicles")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => {
        if (Array.isArray(d)) setLiveVehicles(d);
      })
      .catch(() => {});
  }, []);

  const [mapSelectorOpen, setMapSelectorOpen] = useState(false);
  const savedMapRegions: SavedMapRegion[] = useMemo(
    () => (Array.isArray(displayState?.settings?.savedMapRegions) ? displayState.settings.savedMapRegions : []),
    [displayState?.settings?.savedMapRegions],
  );

  const handlePersistSavedMapRegions = async (nextRegions: SavedMapRegion[]) => {
    try {
      const res = await fetch("/api/display/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(displayState?.settings || {}),
          savedMapRegions: nextRegions,
        }),
      });
      const data = await res.json();
      if (data.state) onStateUpdated(data.state);
      toast({ title: "Saved reusable map area!" });
    } catch {
      toast({ title: "Failed saving reusable map area", variant: "destructive" });
    }
  };

  // Unified list of all editable screens: Built-In Screens S1-S4 (edited in-place) + Custom Screens
  const editableScreensList: CustomScreenDefinition[] = useMemo(() => {
    const builtInItems = BUILTIN_SCREENS.map((b) => {
      const savedOverride = screensDraft.find((s) => s.id === b.id);
      return savedOverride || createDefaultBuiltInScreenDefinition(b.id);
    });
    const customItems = screensDraft.filter((s) => !isBuiltInScreenId(s.id));
    return [...builtInItems, ...customItems];
  }, [screensDraft]);

  const selectedScreen = useMemo(
    () =>
      editableScreensList.find((s) => s.id === selectedScreenId) ||
      editableScreensList[0] ||
      null,
    [editableScreensList, selectedScreenId],
  );

  useEffect(() => {
    if (!selectedScreen) {
      setSelectedWidgetId(null);
      return;
    }
    if (!selectedWidgetId || !selectedScreen.widgets.some((w) => w.id === selectedWidgetId)) {
      setSelectedWidgetId(selectedScreen.widgets[0]?.id || null);
    }
  }, [selectedScreen, selectedWidgetId]);

  const selectedWidget = useMemo(
    () => selectedScreen?.widgets.find((w) => w.id === selectedWidgetId) || null,
    [selectedScreen, selectedWidgetId],
  );

  const mainWarehouse: ReturnEtaWarehouse = useMemo(() => {
    const loc = mapHomeLocations?.map?.location;
    return loc
      ? { name: loc.name, latitude: loc.latitude, longitude: loc.longitude }
      : { name: "Huron Hub", latitude: 44.3683, longitude: -98.2136 };
  }, [mapHomeLocations]);

  const sfWarehouse: ReturnEtaWarehouse = useMemo(() => {
    const loc = mapHomeLocations?.["regional-sf"]?.location;
    return loc
      ? { name: loc.name, latitude: loc.latitude, longitude: loc.longitude }
      : { name: "Sioux Falls Warehouse", latitude: 43.5446, longitude: -96.7311 };
  }, [mapHomeLocations]);

  // Helpers to mutate current screen IN-PLACE (never creating duplicate IDs) & mark dirty
  const updateScreen = useCallback(
    (screenId: string, updater: (prev: CustomScreenDefinition) => CustomScreenDefinition) => {
      setScreensDraft((prev) => {
        const exists = prev.some((s) => s.id === screenId);
        if (exists) {
          return prev.map((s) =>
            s.id === screenId
              ? {
                  ...updater(s),
                  id: screenId,
                  updatedAt: new Date().toISOString(),
                }
              : s,
          );
        }
        if (isBuiltInScreenId(screenId)) {
          const base = createDefaultBuiltInScreenDefinition(screenId);
          const updated: CustomScreenDefinition = {
            ...updater(base),
            id: screenId,
            updatedAt: new Date().toISOString(),
          };
          return [...prev, updated];
        }
        return prev;
      });
      setIsDirty(true);
    },
    [],
  );

  const updateSelectedWidget = useCallback(
    (updater: (w: ScreenWidgetInstance) => ScreenWidgetInstance) => {
      if (!selectedScreen || !selectedWidgetId) return;
      updateScreen(selectedScreen.id, (scr) => ({
        ...scr,
        widgets: scr.widgets.map((w) => (w.id === selectedWidgetId ? updater(w) : w)),
      }));
    },
    [selectedScreen, selectedWidgetId, updateScreen],
  );

  // Interactive 12x6 Grid Pointer Dragging
  useEffect(() => {
    if (!dragState || !selectedScreen) return;

    const handleMove = (e: PointerEvent) => {
      const el = gridRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const deltaCols = Math.round(((e.clientX - dragState.startClientX) / rect.width) * 12);
      const deltaRows = Math.round(((e.clientY - dragState.startClientY) / rect.height) * 6);

      const nextBox =
        dragState.mode === "move"
          ? clampWidgetBox({
              x: dragState.origBox.x + deltaCols,
              y: dragState.origBox.y + deltaRows,
              w: dragState.origBox.w,
              h: dragState.origBox.h,
            })
          : clampWidgetBox({
              x: dragState.origBox.x,
              y: dragState.origBox.y,
              w: dragState.origBox.w + deltaCols,
              h: dragState.origBox.h + deltaRows,
            });

      updateScreen(selectedScreen.id, (scr) => ({
        ...scr,
        widgets: scr.widgets.map((w) =>
          w.id === dragState.widgetId ? { ...w, ...nextBox } : w,
        ),
      }));
    };

    const handleUp = () => {
      setDragState(null);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [dragState, selectedScreen, updateScreen]);

  // Create Blank Screen or Blueprint Screen
  const handleCreateBlankScreen = () => {
    const existingIds = new Set(editableScreensList.map((s) => s.id));
    const customCount = screensDraft.filter((s) => !isBuiltInScreenId(s.id)).length;
    const name = `Custom TV Screen ${customCount + 1}`;
    const id = makeScreenId(name, existingIds);
    const now = new Date().toISOString();
    const firstWidgetId = makeWidgetId();
    const secondWidgetId = makeWidgetId();

    const created: CustomScreenDefinition = {
      id,
      name,
      badgeLabel: `Custom ${customCount + 1}`,
      templateId: "two-column",
      widgets: [
        {
          id: firstWidgetId,
          type: "today_snapshot",
          x: 0,
          y: 0,
          w: 6,
          h: 6,
          config: { ...getCatalogEntry("today_snapshot").defaultConfig },
        },
        {
          id: secondWidgetId,
          type: "custom_info",
          x: 6,
          y: 0,
          w: 6,
          h: 6,
          config: { ...getCatalogEntry("custom_info").defaultConfig },
        },
      ],
      createdAt: now,
      updatedAt: now,
    };

    const nextScreens = [...screensDraft, created];
    setScreensDraft(nextScreens);
    setDefaultPlaylistDraft((pl) => normalizePlaylistEntries(pl, nextScreens, true));
    setSelectedScreenId(created.id);
    setSelectedWidgetId(firstWidgetId);
    setIsDirty(true);
    toast({ title: `Created "${created.name}" — customize widgets and click Save!` });
  };

  const handleCreateFromBlueprint = (bp: BlueprintScreenPreset) => {
    const existingIds = new Set(editableScreensList.map((s) => s.id));
    const id = makeScreenId(bp.name, existingIds);
    const now = new Date().toISOString();
    const widgets: ScreenWidgetInstance[] = bp.widgets.map((w) => ({
      ...JSON.parse(JSON.stringify(w)),
      id: makeWidgetId(),
    }));
    const created: CustomScreenDefinition = {
      id,
      name: bp.name,
      badgeLabel: bp.badgeLabel,
      templateId: bp.templateId,
      widgets,
      createdAt: now,
      updatedAt: now,
    };
    const nextScreens = [...screensDraft, created];
    setScreensDraft(nextScreens);
    setDefaultPlaylistDraft((pl) => normalizePlaylistEntries(pl, nextScreens, true));
    setSelectedScreenId(created.id);
    setSelectedWidgetId(widgets[0]?.id || null);
    setShowCreateBar(false);
    setIsDirty(true);
    toast({ title: `Added "${bp.name}" blueprint — ready to customize & save!` });
  };

  useEffect(() => {
    if (!editScreenRequest?.screenId) return;
    setStudioTab("designer");
    setShowCreateBar(false);
    setSelectedScreenId(editScreenRequest.screenId);
  }, [editScreenRequest?.nonce, editScreenRequest?.screenId]);

  const handleDuplicateScreen = () => {
    if (!selectedScreen) return;
    const existingIds = new Set(editableScreensList.map((s) => s.id));
    const copyName = `${selectedScreen.name} (Copy)`;
    const id = makeScreenId(copyName, existingIds);
    const now = new Date().toISOString();
    const clonedWidgets: ScreenWidgetInstance[] = selectedScreen.widgets.map((w) => ({
      ...JSON.parse(JSON.stringify(w)),
      id: makeWidgetId(),
    }));
    const copy: CustomScreenDefinition = {
      ...selectedScreen,
      id,
      name: copyName,
      badgeLabel: selectedScreen.badgeLabel ? `${selectedScreen.badgeLabel} 2` : "Custom",
      widgets: clonedWidgets,
      createdAt: now,
      updatedAt: now,
    };
    const nextScreens = [...screensDraft, copy];
    setScreensDraft(nextScreens);
    setDefaultPlaylistDraft((pl) => normalizePlaylistEntries(pl, nextScreens, true));
    setSelectedScreenId(copy.id);
    setSelectedWidgetId(clonedWidgets[0]?.id || null);
    setIsDirty(true);
    toast({ title: `Duplicated "${selectedScreen.name}"` });
  };

  const [screenPendingDelete, setScreenPendingDelete] = useState<CustomScreenDefinition | null>(
    null,
  );
  const [screenPendingReset, setScreenPendingReset] = useState<CustomScreenDefinition | null>(null);

  const persistStudioPayload = async (
    nextScreens: CustomScreenDefinition[],
    nextDefaultPl: PlaylistEntry[],
    nextGroupPls: Record<string, PlaylistEntry[] | null>,
    nextUnitPls: Record<string, { playlistMode: "group" | "custom"; playlist: PlaylistEntry[] }>,
    successTitle: string,
  ): Promise<boolean> => {
    setSaving(true);
    try {
      const normalizedDefault = normalizePlaylistEntries(nextDefaultPl, nextScreens, true);
      const normalizedGroups: Record<string, PlaylistEntry[] | null> = {};
      for (const [gid, pl] of Object.entries(nextGroupPls)) {
        normalizedGroups[gid] = pl ? normalizePlaylistEntries(pl, nextScreens, false) : null;
      }
      const normalizedUnits: Record<
        string,
        { playlistMode: "group" | "custom"; playlist: PlaylistEntry[] }
      > = {};
      for (const [uid, cfg] of Object.entries(nextUnitPls)) {
        normalizedUnits[uid] = {
          playlistMode: cfg.playlistMode,
          playlist: normalizePlaylistEntries(cfg.playlist, nextScreens, false),
        };
      }

      const res = await fetch("/api/display/screens", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customScreens: nextScreens,
          defaultPlaylist: normalizedDefault,
          groupPlaylists: normalizedGroups,
          unitPlaylists: normalizedUnits,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed saving screens & playlists");
      }
      setIsDirty(false);
      if (data.state) {
        onStateUpdated(data.state);
        hydrateFromServerState(data.state);
      }
      toast({ title: successTitle });
      setSaving(false);
      return true;
    } catch (err: any) {
      toast({
        title: err.message || "Error saving screen studio",
        variant: "destructive",
      });
      setSaving(false);
      return false;
    }
  };

  const handleResetBuiltInScreen = () => {
    if (!selectedScreen || !isBuiltInScreenId(selectedScreen.id)) return;
    setScreenPendingReset(selectedScreen);
  };

  const confirmResetBuiltInScreen = async () => {
    if (!screenPendingReset || !isBuiltInScreenId(screenPendingReset.id)) return;
    const targetId = screenPendingReset.id;
    const nextScreens = screensDraft.filter((s) => s.id !== targetId);
    setScreensDraft(nextScreens);
    setScreenPendingReset(null);
    await persistStudioPayload(
      nextScreens,
      defaultPlaylistDraft,
      groupPlaylistsDraft,
      unitPlaylistsDraft,
      `Reset ${targetId.replace("screen-", "Screen ")} back to its original default layout!`,
    );
  };

  const handleDeleteScreen = (target?: CustomScreenDefinition) => {
    const scr = target || selectedScreen;
    if (!scr || isBuiltInScreenId(scr.id)) return;
    setScreenPendingDelete(scr);
  };

  const confirmDeleteScreen = async () => {
    if (!screenPendingDelete || isBuiltInScreenId(screenPendingDelete.id)) return;
    const deletedId = screenPendingDelete.id;
    const deletedName = screenPendingDelete.name;
    const nextScreens = screensDraft.filter((s) => s.id !== deletedId);
    const nextDefault = defaultPlaylistDraft.filter((e) => e.screenId !== deletedId);
    const nextGroups: Record<string, PlaylistEntry[] | null> = {};
    for (const [gid, pl] of Object.entries(groupPlaylistsDraft)) {
      nextGroups[gid] = pl ? pl.filter((e) => e.screenId !== deletedId) : null;
    }
    const nextUnits: Record<
      string,
      { playlistMode: "group" | "custom"; playlist: PlaylistEntry[] }
    > = {};
    for (const [uid, cfg] of Object.entries(unitPlaylistsDraft)) {
      nextUnits[uid] = {
        playlistMode: cfg.playlistMode,
        playlist: cfg.playlist.filter((e) => e.screenId !== deletedId),
      };
    }

    setScreensDraft(nextScreens);
    setDefaultPlaylistDraft(nextDefault);
    setGroupPlaylistsDraft(nextGroups);
    setUnitPlaylistsDraft(nextUnits);
    if (selectedScreenId === deletedId) {
      const nextFallback =
        nextScreens.find((s) => !isBuiltInScreenId(s.id))?.id || "screen-1";
      setSelectedScreenId(nextFallback);
    }
    setScreenPendingDelete(null);

    await persistStudioPayload(
      nextScreens,
      nextDefault,
      nextGroups,
      nextUnits,
      `Deleted screen "${deletedName}" and removed it from all TV playlists!`,
    );
  };

  const handleToggleBuiltInRotation = async (builtInId: string) => {
    const normalized = normalizePlaylistEntries(defaultPlaylistDraft, screensDraft, true);
    const currentEntry = normalized.find((e) => e.screenId === builtInId);
    const nextEnabled = !(currentEntry?.enabled ?? true);
    const enabledCount = normalized.filter((e) => e.enabled).length;
    if (!nextEnabled && enabledCount <= 1) {
      toast({
        title: "At least one screen must remain enabled in TV rotation",
        variant: "destructive",
      });
      return;
    }
    const nextDefault = normalized.map((e) =>
      e.screenId === builtInId ? { ...e, enabled: nextEnabled } : e,
    );
    setDefaultPlaylistDraft(nextDefault);
    await persistStudioPayload(
      screensDraft,
      nextDefault,
      groupPlaylistsDraft,
      unitPlaylistsDraft,
      nextEnabled
        ? `Added ${builtInId.replace("screen-", "Screen ")} back into TV rotation!`
        : `Removed ${builtInId.replace("screen-", "Screen ")} from TV rotation!`,
    );
  };

  const handleApplyLayoutTemplate = (tpl: LayoutTemplatePreset) => {
    if (!selectedScreen) return;
    if (
      selectedScreen.widgets.length > tpl.slots.length &&
      !window.confirm(
        `Apply "${tpl.name}"? This layout has ${tpl.slots.length} panel slot(s) and your screen currently has ${selectedScreen.widgets.length} widgets (extra widgets beyond slot ${tpl.slots.length} will be trimmed).`,
      )
    ) {
      return;
    }

    const nextWidgets: ScreenWidgetInstance[] = tpl.slots.map((slot, idx) => {
      const existing = selectedScreen.widgets[idx];
      if (existing) {
        return {
          ...existing,
          x: slot.x,
          y: slot.y,
          w: slot.w,
          h: slot.h,
        };
      }
      const cat = getCatalogEntry(slot.suggestedWidget);
      return {
        id: makeWidgetId(),
        type: slot.suggestedWidget,
        x: slot.x,
        y: slot.y,
        w: slot.w,
        h: slot.h,
        config: { ...cat.defaultConfig },
      };
    });

    updateScreen(selectedScreen.id, (scr) => ({
      ...scr,
      templateId: tpl.id,
      widgets: nextWidgets,
    }));
    setSelectedWidgetId(nextWidgets[0]?.id || null);
    toast({ title: `Applied "${tpl.name}" layout` });
  };

  const handleAddWidget = (type: ScreenWidgetType) => {
    if (!selectedScreen) return;
    const cat = getCatalogEntry(type);
    const box = findOpenGridSlot(selectedScreen.widgets, cat.defaultW, cat.defaultH);
    const newWidget: ScreenWidgetInstance = {
      id: makeWidgetId(),
      type,
      ...box,
      config: JSON.parse(JSON.stringify(cat.defaultConfig)),
    };
    updateScreen(selectedScreen.id, (scr) => ({
      ...scr,
      widgets: [...scr.widgets, newWidget],
    }));
    setSelectedWidgetId(newWidget.id);
    toast({ title: `Added "${cat.label}" widget` });
  };

  const handleDeleteWidget = (widgetId: string) => {
    if (!selectedScreen) return;
    updateScreen(selectedScreen.id, (scr) => ({
      ...scr,
      widgets: scr.widgets.filter((w) => w.id !== widgetId),
    }));
  };

  const handleUploadFlyerMedia = async (file: File) => {
    if (!file || !selectedWidget) return;
    setUploadingMedia(true);
    try {
      const buf = await file.arrayBuffer();
      const res = await fetch("/api/display/upload-media", {
        method: "POST",
        headers: {
          "Content-Type": file.type || "image/png",
        },
        body: buf,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok || !data.url) {
        throw new Error(data.error || "Failed uploading image");
      }
      updateSelectedWidget((w) => ({
        ...w,
        config: {
          ...w.config,
          imageUrl: data.url,
        },
      }));
      toast({ title: "Flyer graphic uploaded! Remember to Save Studio to publish to TVs." });
    } catch (err: any) {
      toast({
        title: err.message || "Error uploading flyer image",
        variant: "destructive",
      });
    }
    setUploadingMedia(false);
  };

  const handleSyncNwsNow = async () => {
    setSyncingNws(true);
    try {
      const res = await fetch("/api/display/refresh-feeds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || "Feed sync failed");
      if (data.state) onStateUpdated(data.state);
      toast({ title: "Synced live South Dakota NWS alerts & corridor weather!" });
    } catch (err: any) {
      toast({ title: err.message || "Failed syncing NWS feed", variant: "destructive" });
    }
    setSyncingNws(false);
  };

  const handleSaveAll = async (): Promise<boolean> => {
    return persistStudioPayload(
      screensDraft,
      defaultPlaylistDraft,
      groupPlaylistsDraft,
      unitPlaylistsDraft,
      "Saved Custom Screens & TV Playlists — live on all connected TVs!",
    );
  };

  const handlePinScreenToTarget = async (screenId: string, scopeStr: string) => {
    if (isDirty) {
      const ok = await handleSaveAll();
      if (!ok) return;
    }
    if (scopeStr === "all") {
      await onRemoteControl(screenId, "all", "all");
    } else if (scopeStr.startsWith("group:")) {
      await onRemoteControl(screenId, "group", scopeStr.slice("group:".length));
    } else if (scopeStr.startsWith("unit:")) {
      await onRemoteControl(screenId, "display", scopeStr.slice("unit:".length));
    }
  };

  // Preview state merges unsaved customScreens & playlists so WYSIWYG preview reflects live edits immediately
  const previewDisplayState = useMemo(
    () => ({
      ...(displayState || {}),
      customScreens: screensDraft,
    }),
    [displayState, screensDraft],
  );

  // Playlist helper functions
  const groups: any[] = displayState?.settings?.displayGroups || [];
  const units: any[] = displayState?.displayUnits || [];

  const getScreenMetaLabel = (screenId: string) => {
    const custom = screensDraft.find((c) => c.id === screenId);
    const builtIn = BUILTIN_SCREENS.find((b) => b.id === screenId);
    if (custom && builtIn) {
      return {
        title: custom.name,
        badge: custom.badgeLabel || builtIn.shortTab,
        description: `Customized ${builtIn.id.replace("screen-", "Screen ")} • ${custom.widgets.length} widget${custom.widgets.length === 1 ? "" : "s"}`,
        isCustom: false,
      };
    }
    if (builtIn) {
      return {
        title: builtIn.name,
        badge: builtIn.shortTab,
        description: builtIn.description,
        isCustom: false,
      };
    }
    if (custom) {
      return {
        title: custom.name,
        badge: custom.badgeLabel || "Custom",
        description: `Custom 16:9 screen • ${custom.widgets.length} widget${custom.widgets.length === 1 ? "" : "s"}`,
        isCustom: true,
      };
    }
    return {
      title: screenId,
      badge: "Screen",
      description: "",
      isCustom: true,
    };
  };

  const activePlaylistContext = useMemo(() => {
    if (playlistTarget.startsWith("group:")) {
      const groupId = playlistTarget.slice("group:".length);
      const group = groups.find((g) => g.id === groupId);
      const customPl = groupPlaylistsDraft[groupId] ?? null;
      return {
        kind: "group" as const,
        id: groupId,
        label: group ? `${group.name} (Group)` : groupId,
        inherits: customPl === null,
        entries: normalizePlaylistEntries(customPl || defaultPlaylistDraft, screensDraft, true),
        baseDurationSec: Number(displayState?.settings?.rotationIntervalSec || 22),
      };
    }
    if (playlistTarget.startsWith("unit:")) {
      const unitId = playlistTarget.slice("unit:".length);
      const unit = units.find((u) => u.id === unitId);
      const prof = displayState?.settings?.displayProfiles?.[unitId];
      const cfg = unitPlaylistsDraft[unitId] || {
        playlistMode: "group" as const,
        playlist: defaultPlaylistDraft,
      };
      const parentGroupPl = prof?.groupId ? groupPlaylistsDraft[prof.groupId] : null;
      const inheritedEntries = normalizePlaylistEntries(
        parentGroupPl || defaultPlaylistDraft,
        screensDraft,
        true,
      );
      return {
        kind: "unit" as const,
        id: unitId,
        label: unit ? `${unit.name} (?display=${unit.id})` : unitId,
        inherits: cfg.playlistMode !== "custom",
        entries:
          cfg.playlistMode === "custom"
            ? normalizePlaylistEntries(cfg.playlist, screensDraft, false)
            : inheritedEntries,
        baseDurationSec: Number(
          prof?.rotationIntervalSec || displayState?.settings?.rotationIntervalSec || 22,
        ),
      };
    }
    return {
      kind: "default" as const,
      id: "default",
      label: "Default Company-Wide Playlist",
      inherits: false,
      entries: normalizePlaylistEntries(defaultPlaylistDraft, screensDraft, true),
      baseDurationSec: Number(displayState?.settings?.rotationIntervalSec || 22),
    };
  }, [
    playlistTarget,
    groups,
    units,
    groupPlaylistsDraft,
    unitPlaylistsDraft,
    defaultPlaylistDraft,
    screensDraft,
    displayState?.settings,
  ]);

  const setActivePlaylistEntries = (nextEntries: PlaylistEntry[]) => {
    setIsDirty(true);
    if (activePlaylistContext.kind === "default") {
      setDefaultPlaylistDraft(nextEntries);
    } else if (activePlaylistContext.kind === "group") {
      setGroupPlaylistsDraft((prev) => ({
        ...prev,
        [activePlaylistContext.id]: nextEntries,
      }));
    } else if (activePlaylistContext.kind === "unit") {
      setUnitPlaylistsDraft((prev) => ({
        ...prev,
        [activePlaylistContext.id]: {
          playlistMode: "custom",
          playlist: nextEntries,
        },
      }));
    }
  };

  const handleTogglePlaylistInheritance = (inheritMode: boolean) => {
    setIsDirty(true);
    if (activePlaylistContext.kind === "group") {
      setGroupPlaylistsDraft((prev) => ({
        ...prev,
        [activePlaylistContext.id]: inheritMode
          ? null
          : normalizePlaylistEntries(defaultPlaylistDraft, screensDraft, true),
      }));
    } else if (activePlaylistContext.kind === "unit") {
      const unitId = activePlaylistContext.id;
      const prof = displayState?.settings?.displayProfiles?.[unitId];
      const parentGroupPl = prof?.groupId ? groupPlaylistsDraft[prof.groupId] : null;
      setUnitPlaylistsDraft((prev) => ({
        ...prev,
        [unitId]: {
          playlistMode: inheritMode ? "group" : "custom",
          playlist: normalizePlaylistEntries(
            prev[unitId]?.playlist || parentGroupPl || defaultPlaylistDraft,
            screensDraft,
            true,
          ),
        },
      }));
    }
  };

  const filteredCatalog = useMemo(
    () =>
      widgetPickerCategory === "all"
        ? WIDGET_CATALOG
        : WIDGET_CATALOG.filter((w) => w.category === widgetPickerCategory),
    [widgetPickerCategory],
  );

  const previewTheme: DisplayThemeId = useMemo(
    () =>
      resolveEffectiveDisplayTheme(
        displayState?.settings,
        undefined,
        selectedScreen?.theme === "inherit" ? undefined : selectedScreen?.theme,
      ),
    [displayState?.settings, selectedScreen?.theme],
  );

  return (
    <div className="space-y-5">
      {/* STUDIO HEADER BAR */}
      <div className="rounded-sm border border-border bg-card p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <LayoutGrid className="w-5 h-5 text-primary shrink-0" />
            <h2 className="text-lg sm:text-xl font-display font-bold uppercase tracking-wide">
              TV Screen Designer & Playlist Studio
            </h2>
            {isDirty ? (
              <span className="px-2 py-0.5 rounded-sm font-mono text-[10px] font-bold uppercase bg-primary/15 text-primary border border-primary/40">
                Unsaved Changes
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded-sm font-mono text-[10px] font-bold uppercase bg-emerald-500/15 text-emerald-400 border border-emerald-500/35 inline-flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" />
                Synced with TVs
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Design custom 16:9 operational boards on a 12×6 snap grid, assign visual themes, and control slide playlists per Display Group or TV.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-sm border border-border bg-background p-1 gap-1">
            <button
              type="button"
              onClick={() => setStudioTab("designer")}
              className={`px-3 py-1.5 rounded-sm text-xs font-bold inline-flex items-center gap-1.5 transition-colors ${
                studioTab === "designer"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              data-testid="button-studio-mode-designer"
            >
              <Layers className="w-3.5 h-3.5" />
              Screen Designer ({editableScreensList.length})
            </button>
            <button
              type="button"
              onClick={() => setStudioTab("playlists")}
              className={`px-3 py-1.5 rounded-sm text-xs font-bold inline-flex items-center gap-1.5 transition-colors ${
                studioTab === "playlists"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              data-testid="button-studio-mode-playlists"
            >
              <ListOrdered className="w-3.5 h-3.5" />
              TV & Group Playlists
            </button>
          </div>

          {isDirty && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => hydrateFromServerState(displayState)}
              disabled={saving}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Discard
            </Button>
          )}

          <Button
            size="sm"
            onClick={handleSaveAll}
            disabled={saving}
            className="gap-1.5 font-bold"
            data-testid="button-save-screen-studio"
          >
            <Save className="w-4 h-4" />
            {saving ? "Publishing..." : "Save Studio & Push to TVs"}
          </Button>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* SUB-MODE 1: VISUAL 16:9 SCREEN DESIGNER                               */}
      {/* ===================================================================== */}
      {studioTab === "designer" && (
        <div className="space-y-5">
          {/* ALL SCREENS (BUILT-IN S1-S4 + CUSTOM) — SELECT ANY SCREEN TO EDIT IN PLACE */}
          <div className="rounded-sm border border-border bg-card p-4 space-y-3.5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-0.5 min-w-0">
                <div className="flex items-center gap-2">
                  <Pencil className="w-4 h-4 text-primary shrink-0" />
                  <span className="text-xs sm:text-sm font-display font-bold uppercase tracking-wider text-foreground">
                    Screens — Select Any Screen to Edit In Place ({editableScreensList.length})
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Click any screen below (Screens 1–4 or your Custom Screens) to edit it directly in place — no duplicates created.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={selectedScreen?.id || "screen-1"}
                  onValueChange={(val) => {
                    setSelectedScreenId(val);
                    setShowCreateBar(false);
                  }}
                >
                  <SelectTrigger
                    className="h-8 w-[260px] text-xs font-semibold"
                    data-testid="select-saved-screen-to-edit"
                  >
                    <SelectValue placeholder="Jump to screen..." />
                  </SelectTrigger>
                  <SelectContent>
                    {editableScreensList.map((scr) => {
                      const isBuiltIn = isBuiltInScreenId(scr.id);
                      const prefix = isBuiltIn ? `${scr.id.replace("screen-", "S")}: ` : "Custom: ";
                      return (
                        <SelectItem key={scr.id} value={scr.id}>
                          ✎ {prefix}
                          {scr.name} ({scr.widgets.length} panels)
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>

                <Button
                  size="sm"
                  variant={showCreateBar ? "default" : "outline"}
                  onClick={() => setShowCreateBar((prev) => !prev)}
                  className="gap-1.5 font-semibold"
                  data-testid="button-toggle-create-new-screen"
                >
                  <Plus className="w-4 h-4" />
                  {showCreateBar ? "Hide New Screen Options" : "Create New Screen"}
                </Button>
              </div>
            </div>

            {/* Unified Screen Cards (S1-S4 + Custom Screens) */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {editableScreensList.map((scr) => {
                const active = selectedScreen?.id === scr.id;
                const isBuiltIn = isBuiltInScreenId(scr.id);
                const isCustomizedBuiltIn = isBuiltIn && screensDraft.some((s) => s.id === scr.id);
                const shortLabel = isBuiltIn
                  ? `${scr.id.replace("screen-", "S")} • ${scr.badgeLabel || scr.name}`
                  : scr.name;
                return (
                  <div key={scr.id} className="inline-flex items-stretch">
                    <button
                      type="button"
                      data-testid={`button-edit-screen-${scr.id}`}
                      onClick={() => {
                        setSelectedScreenId(scr.id);
                        setShowCreateBar(false);
                      }}
                      className={`px-3 py-2 border text-xs font-bold inline-flex items-center gap-2 transition-all ${
                        isBuiltIn ? "rounded-sm" : "rounded-l-sm"
                      } ${
                        active
                          ? "border-primary bg-primary/15 text-foreground ring-1 ring-primary/35 shadow-sm"
                          : "border-border bg-background/60 text-muted-foreground hover:text-foreground hover:border-primary/45"
                      }`}
                    >
                      <Pencil
                        className={`w-3.5 h-3.5 shrink-0 ${
                          active ? "text-primary" : "text-muted-foreground"
                        }`}
                      />
                      <span className="truncate max-w-[220px]">{shortLabel}</span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                          active
                            ? "bg-primary text-primary-foreground"
                            : isCustomizedBuiltIn
                              ? "bg-amber-500/20 text-amber-300"
                              : "bg-secondary text-muted-foreground"
                        }`}
                      >
                        {active
                          ? "EDITING"
                          : isCustomizedBuiltIn
                            ? `Edited (${scr.widgets.length})`
                            : `Edit (${scr.widgets.length})`}
                      </span>
                    </button>
                    {!isBuiltIn && (
                      <button
                        type="button"
                        data-testid={`button-quick-delete-screen-${scr.id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteScreen(scr);
                        }}
                        title={`Delete custom screen "${scr.name}"`}
                        className={`px-2 rounded-r-sm border border-l-0 inline-flex items-center justify-center transition-colors ${
                          active
                            ? "border-primary bg-primary/10 text-destructive hover:bg-destructive/20"
                            : "border-border bg-background/60 text-muted-foreground hover:text-destructive hover:bg-destructive/15"
                        }`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Collapsible "Create New Screen" Bar (Blank or Blueprints) */}
            {showCreateBar && (
              <div className="rounded-sm border border-primary/35 bg-primary/5 p-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] font-display font-bold uppercase tracking-wider text-primary inline-flex items-center gap-1 mr-1">
                    <Sparkles className="w-3.5 h-3.5" />
                    Create Brand-New Screen:
                  </span>
                  <Button
                    size="xs"
                    variant="default"
                    onClick={() => {
                      handleCreateBlankScreen();
                      setShowCreateBar(false);
                    }}
                    className="gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Blank 12×6 Screen
                  </Button>
                  {SCREEN_BLUEPRINTS.map((bp) => (
                    <Button
                      key={bp.id}
                      size="xs"
                      variant="secondary"
                      onClick={() => handleCreateFromBlueprint(bp)}
                      title={bp.description}
                    >
                      + {bp.badgeLabel} Blueprint
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {/* SELECTED SCREEN SETTINGS & LIVE PIN BAR */}
            {selectedScreen && (
              <div className="pt-3 border-t border-border/70 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="inline-flex items-center gap-2 text-xs font-bold text-primary uppercase font-display tracking-wider">
                    <Pencil className="w-3.5 h-3.5" />
                    Currently Editing: {selectedScreen.name}
                  </div>
                  {isDirty && (
                    <Button
                      size="xs"
                      onClick={handleSaveAll}
                      disabled={saving}
                      className="gap-1 font-bold"
                    >
                      <Save className="w-3.5 h-3.5" />
                      {saving ? "Saving..." : "Save Screen Changes"}
                    </Button>
                  )}
                </div>
                <div className="grid gap-3 lg:grid-cols-12 items-end">
                <div className="lg:col-span-3 space-y-1">
                  <Label className="text-xs">Screen Title</Label>
                  <Input
                    value={selectedScreen.name}
                    onChange={(e) =>
                      updateScreen(selectedScreen.id, (s) => ({ ...s, name: e.target.value }))
                    }
                    placeholder="e.g., Morning Ops & Road Alerts"
                    className="h-8 text-xs"
                  />
                </div>
                <div className="lg:col-span-2 space-y-1">
                  <Label className="text-xs">TV Header Tab</Label>
                  <Input
                    value={selectedScreen.badgeLabel || ""}
                    onChange={(e) =>
                      updateScreen(selectedScreen.id, (s) => ({
                        ...s,
                        badgeLabel: e.target.value,
                      }))
                    }
                    placeholder="e.g., Ops & Safety"
                    maxLength={22}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="lg:col-span-2 space-y-1">
                  <Label className="text-xs">Duration (s)</Label>
                  <Input
                    type="number"
                    min={5}
                    max={300}
                    value={selectedScreen.durationSec ?? ""}
                    onChange={(e) => {
                      const val = e.target.value ? Number(e.target.value) : undefined;
                      updateScreen(selectedScreen.id, (s) => ({
                        ...s,
                        durationSec: val && val >= 5 ? val : undefined,
                      }));
                    }}
                    placeholder={`Default (${displayState?.settings?.rotationIntervalSec ?? 22}s)`}
                    className="h-8 text-xs font-mono"
                  />
                </div>
                <div className="lg:col-span-2 space-y-1">
                  <Label className="text-xs inline-flex items-center gap-1">
                    <Palette className="w-3 h-3 text-primary" />
                    Screen Theme
                  </Label>
                  <Select
                    value={selectedScreen.theme || "inherit"}
                    onValueChange={(val) =>
                      updateScreen(selectedScreen.id, (s) => ({
                        ...s,
                        theme: val === "inherit" ? "inherit" : (val as DisplayThemeId),
                      }))
                    }
                  >
                    <SelectTrigger className="h-8 text-xs" data-testid="select-custom-screen-theme">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="inherit">Inherit TV Theme</SelectItem>
                      {DISPLAY_THEMES.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          <span className="inline-flex items-center gap-2">
                            <span
                              className="w-2.5 h-2.5 rounded-[2px] border border-border inline-block shrink-0"
                              style={{ backgroundColor: t.swatchBg, boxShadow: `inset 0 0 0 2px ${t.swatchAccent}` }}
                            />
                            {t.shortLabel}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="lg:col-span-3 flex flex-wrap items-center justify-end gap-1.5">
                  <Select value={pinScopeValue} onValueChange={setPinScopeValue}>
                    <SelectTrigger className="h-8 w-[135px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Company TVs</SelectItem>
                      {groups.map((g) => (
                        <SelectItem key={g.id} value={`group:${g.id}`}>
                          Group: {g.name}
                        </SelectItem>
                      ))}
                      {units.map((u) => (
                        <SelectItem key={u.id} value={`unit:${u.id}`}>
                          TV: {u.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="xs"
                    variant="outline"
                    className="h-8 gap-1 border-primary/45 text-primary hover:bg-primary/15"
                    onClick={() => handlePinScreenToTarget(selectedScreen.id, pinScopeValue)}
                    title="Save if needed and immediately lock target TV(s) onto this screen"
                  >
                    <Pin className="w-3.5 h-3.5" />
                    Pin Live
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    className="h-8 px-2"
                    onClick={handleDuplicateScreen}
                    title="Duplicate as a separate new screen"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </Button>
                  {isBuiltInScreenId(selectedScreen.id) ? (
                    <>
                      {(() => {
                        const inRot =
                          normalizePlaylistEntries(defaultPlaylistDraft, screensDraft, true).find(
                            (e) => e.screenId === selectedScreen.id,
                          )?.enabled ?? true;
                        return (
                          <Button
                            size="xs"
                            variant="outline"
                            disabled={saving}
                            className={`h-8 gap-1 ${
                              inRot
                                ? "border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/15"
                                : "border-border text-muted-foreground hover:text-foreground"
                            }`}
                            onClick={() => handleToggleBuiltInRotation(selectedScreen.id)}
                            title={
                              inRot
                                ? "Click to remove this built-in screen from TV rotation"
                                : "Click to re-enable this built-in screen in TV rotation"
                            }
                            data-testid={`button-toggle-rotation-${selectedScreen.id}`}
                          >
                            {inRot ? (
                              <>
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                In Rotation
                              </>
                            ) : (
                              <>
                                <EyeOff className="w-3.5 h-3.5" />
                                Hidden
                              </>
                            )}
                          </Button>
                        );
                      })()}
                      {screensDraft.some((s) => s.id === selectedScreen.id) && (
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={saving}
                          className="h-8 gap-1 text-amber-300 border-amber-500/40 hover:bg-amber-500/15"
                          onClick={handleResetBuiltInScreen}
                          title="Restore this built-in screen back to its original default layout"
                          data-testid={`button-reset-builtin-${selectedScreen.id}`}
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          Reset
                        </Button>
                      )}
                    </>
                  ) : (
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={saving}
                      className="h-8 gap-1 px-2.5 border-destructive/45 text-destructive hover:text-destructive hover:bg-destructive/15"
                      onClick={() => handleDeleteScreen(selectedScreen)}
                      title="Permanently delete this custom screen"
                      data-testid={`button-delete-screen-${selectedScreen.id}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Delete
                    </Button>
                  )}
                </div>
                </div>
              </div>
            )}
          </div>

          {!selectedScreen ? (
            <div className="rounded-sm border border-dashed border-border p-12 text-center space-y-3">
              <LayoutGrid className="w-10 h-10 text-muted-foreground mx-auto" />
              <div className="font-display font-bold uppercase text-base">No Custom Screens Yet</div>
              <p className="text-xs text-muted-foreground max-w-md mx-auto">
                Click one of the 1-Click Blueprints above or create a Blank Screen to design a custom 16:9 TV layout.
              </p>
              <Button size="sm" onClick={handleCreateBlankScreen}>
                <Plus className="w-4 h-4 mr-1.5" />
                Create First Custom Screen
              </Button>
            </div>
          ) : (
            <>
              {/* STARTER 16:9 LAYOUT TEMPLATES STRIP */}
              <div className="rounded-sm border border-border bg-card p-3.5 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-display font-bold uppercase tracking-wider text-muted-foreground">
                    16:9 Layout Presets (Click to Reflow Grid):
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    Start with any preset below, then freely drag or resize widgets on the 12×6 grid.
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                  {LAYOUT_TEMPLATES.map((tpl) => {
                    const isCurrent = selectedScreen.templateId === tpl.id;
                    return (
                      <button
                        key={tpl.id}
                        type="button"
                        onClick={() => handleApplyLayoutTemplate(tpl)}
                        title={tpl.description}
                        className={`rounded-sm border p-2.5 text-left transition-all flex flex-col gap-2 ${
                          isCurrent
                            ? "border-primary bg-primary/15"
                            : "border-border bg-background/50 hover:border-primary/50 hover:bg-secondary/40"
                        }`}
                      >
                        {/* Mini 12x6 schematic */}
                        <div className="w-full aspect-video rounded-[2px] bg-[#121311] border border-stone-800 p-1 relative">
                          <div
                            className="w-full h-full grid gap-0.5"
                            style={{
                              gridTemplateColumns: "repeat(12, minmax(0, 1fr))",
                              gridTemplateRows: "repeat(6, minmax(0, 1fr))",
                            }}
                          >
                            {tpl.slots.map((s, idx) => (
                              <div
                                key={idx}
                                className="rounded-[1px] bg-primary/30 border border-primary/70"
                                style={{
                                  gridColumn: `${s.x + 1} / span ${s.w}`,
                                  gridRow: `${s.y + 1} / span ${s.h}`,
                                }}
                              />
                            ))}
                          </div>
                        </div>
                        <div className="text-[11px] font-bold leading-tight truncate">
                          {tpl.name}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* MAIN STUDIO WORKBENCH: LEFT 8 COLS = LIVE TV PREVIEW + 12x6 SNAP GRID, RIGHT 4 COLS = INSPECTOR & CATALOG */}
              <div className="grid gap-5 xl:grid-cols-12 items-start">
                {/* LEFT COLUMN: WYSIWYG 16:9 TV PREVIEW + INTERACTIVE 12x6 SNAP GRID */}
                <div className="xl:col-span-8 space-y-4 min-w-0">
                  {/* LIVE 16:9 TV MONITOR PREVIEW */}
                  <div className="rounded-sm border border-border bg-card p-3 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                      <div className="flex items-center gap-2 text-xs font-bold text-foreground">
                        <Eye className="w-4 h-4 text-primary" />
                        <span className="font-display uppercase tracking-wide text-sm">
                          Live 16:9 TV Preview — {selectedScreen.name}
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-sm bg-secondary border border-border text-primary">
                          TAB: {selectedScreen.badgeLabel || selectedScreen.name}
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-sm bg-background border border-border text-muted-foreground">
                          THEME: {DISPLAY_THEMES.find((t) => t.id === previewTheme)?.shortLabel || previewTheme}
                        </span>
                      </div>
                      <span className="text-[11px] text-muted-foreground">
                        Click any widget on the TV screen or grid below to configure it
                      </span>
                    </div>

                    <div
                      data-theme={previewTheme}
                      className="w-full aspect-video rounded-sm overflow-hidden border-2 border-border bg-background relative"
                    >
                      <CustomScreenCanvas
                        screen={selectedScreen}
                        displayState={previewDisplayState}
                        vehicles={liveVehicles}
                        mainWarehouse={mainWarehouse}
                        sfWarehouse={sfWarehouse}
                        themeId={previewTheme}
                        previewMode
                        selectedWidgetId={selectedWidgetId}
                        onSelectWidget={(id) => setSelectedWidgetId(id)}
                      />
                    </div>
                  </div>

                  {/* INTERACTIVE 12x6 SNAP-GRID LAYOUT EDITOR */}
                  <div className="rounded-sm border border-border bg-card p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs font-bold">
                        <Move className="w-4 h-4 text-primary" />
                        <span className="font-display uppercase tracking-wide text-sm">
                          Interactive 12×6 Snap-Grid Layout Map
                        </span>
                      </div>
                      <span className="text-[11px] text-muted-foreground">
                        Drag any widget block to move • Drag bottom-right corner handle to resize
                      </span>
                    </div>

                    <div
                      ref={gridRef}
                      className="w-full aspect-[12/4.2] sm:aspect-[12/3.6] rounded-sm bg-[#121311] border border-stone-800 relative select-none overflow-hidden touch-none"
                    >
                      {/* Background 12x6 subtle cells */}
                      <div
                        className="absolute inset-0 grid"
                        style={{
                          gridTemplateColumns: "repeat(12, minmax(0, 1fr))",
                          gridTemplateRows: "repeat(6, minmax(0, 1fr))",
                        }}
                      >
                        {Array.from({ length: 72 }).map((_, idx) => {
                          const col = idx % 12;
                          const row = Math.floor(idx / 12);
                          return (
                            <div
                              key={idx}
                              className="border border-slate-900/90 flex items-start justify-start p-0.5 text-[9px] font-mono text-slate-700"
                            >
                              {row === 0 ? `C${col + 1}` : col === 0 ? `R${row + 1}` : ""}
                            </div>
                          );
                        })}
                      </div>

                      {/* Placed Widget Footprints */}
                      <div
                        className="absolute inset-0 grid p-1 gap-1"
                        style={{
                          gridTemplateColumns: "repeat(12, minmax(0, 1fr))",
                          gridTemplateRows: "repeat(6, minmax(0, 1fr))",
                        }}
                      >
                        {selectedScreen.widgets.map((w) => {
                          const box = clampWidgetBox(w);
                          const cat = getCatalogEntry(w.type);
                          const isSelected = w.id === selectedWidgetId;
                          const colorCls =
                            WIDGET_PALETTE_COLORS[w.type] ||
                            "border-sky-400/70 bg-sky-500/20 text-sky-200";
                          return (
                            <div
                              key={w.id}
                              style={{
                                gridColumn: `${box.x + 1} / span ${box.w}`,
                                gridRow: `${box.y + 1} / span ${box.h}`,
                                zIndex: isSelected ? 20 : 10,
                              }}
                              onPointerDown={(e) => {
                                e.stopPropagation();
                                setSelectedWidgetId(w.id);
                                setDragState({
                                  widgetId: w.id,
                                  mode: "move",
                                  startClientX: e.clientX,
                                  startClientY: e.clientY,
                                  origBox: box,
                                });
                              }}
                              className={`relative rounded-lg border-2 px-2 py-1.5 cursor-grab active:cursor-grabbing flex flex-col justify-between overflow-hidden transition-shadow ${colorCls} ${
                                isSelected ? "ring-2 ring-white shadow-lg" : "opacity-90 hover:opacity-100"
                              }`}
                            >
                              <div className="flex items-center justify-between gap-1 min-w-0">
                                <span className="text-[11px] font-extrabold truncate">
                                  {w.titleOverride || cat.label}
                                </span>
                                <span className="text-[9px] font-mono px-1 rounded bg-slate-950/70 shrink-0">
                                  {box.w}×{box.h}
                                </span>
                              </div>
                              <div className="text-[9px] font-mono opacity-80">
                                Col {box.x + 1}–{box.x + box.w}, Row {box.y + 1}–{box.y + box.h}
                              </div>

                              {/* Bottom-right resize handle */}
                              <div
                                onPointerDown={(e) => {
                                  e.stopPropagation();
                                  setSelectedWidgetId(w.id);
                                  setDragState({
                                    widgetId: w.id,
                                    mode: "resize",
                                    startClientX: e.clientX,
                                    startClientY: e.clientY,
                                    origBox: box,
                                  });
                                }}
                                title="Drag to resize widget width & height"
                                className="absolute bottom-0.5 right-0.5 w-4 h-4 rounded bg-slate-950/85 border border-white/40 flex items-center justify-center cursor-nwse-resize hover:bg-white hover:text-slate-950"
                              >
                                <Maximize2 className="w-2.5 h-2.5" />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>

                {/* RIGHT COLUMN: WIDGET LAYER LIST + SELECTED WIDGET INSPECTOR + ADD WIDGET LIBRARY */}
                <div className="xl:col-span-4 space-y-4 min-w-0">
                  {/* WIDGETS ON THIS SCREEN SWITCHER */}
                  <div className="rounded-xl border border-border bg-card p-4 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-sm flex items-center gap-1.5">
                        <Layers className="w-4 h-4 text-primary" />
                        Panels on This Screen ({selectedScreen.widgets.length})
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        Click a panel to edit
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {selectedScreen.widgets.map((w, idx) => {
                        const cat = getCatalogEntry(w.type);
                        const active = w.id === selectedWidgetId;
                        return (
                          <div
                            key={w.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => setSelectedWidgetId(w.id)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                setSelectedWidgetId(w.id);
                              }
                            }}
                            className={`rounded-lg border px-2.5 py-2 flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                              active
                                ? "border-primary bg-primary/15 text-foreground"
                                : "border-border bg-background/50 hover:bg-secondary/40 text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-secondary text-foreground shrink-0">
                                #{idx + 1}
                              </span>
                              <div className="min-w-0">
                                <div className="text-xs font-bold truncate">
                                  {w.titleOverride || cat.label}
                                </div>
                                <div className="text-[10px] font-mono text-muted-foreground">
                                  {w.w}×{w.h} grid (Col {w.x + 1}, Row {w.y + 1})
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <span
                                className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                                  active
                                    ? "bg-primary text-primary-foreground"
                                    : "bg-secondary text-muted-foreground"
                                }`}
                              >
                                {active ? "Editing" : "Edit"}
                              </span>
                              <button
                                type="button"
                                title="Remove panel from screen"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteWidget(w.id);
                                }}
                                className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/15"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* SELECTED WIDGET INSPECTOR */}
                  <div className="rounded-xl border border-border bg-card p-4 space-y-4">
                    <div className="flex items-center justify-between gap-2 pb-2 border-b border-border/70">
                      <div className="font-bold text-sm">
                        {selectedWidget ? "Selected Widget Settings" : "Select a Widget"}
                      </div>
                      {selectedWidget && (
                        <Button
                          size="xs"
                          variant="ghost"
                          className="text-destructive hover:text-destructive hover:bg-destructive/15 gap-1"
                          onClick={() => handleDeleteWidget(selectedWidget.id)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Remove
                        </Button>
                      )}
                    </div>

                    {!selectedWidget ? (
                      <p className="text-xs text-muted-foreground">
                        Click a widget on the preview or add a new widget below to configure its content and size.
                      </p>
                    ) : (
                      <div className="space-y-3.5">
                        {/* Widget Type Switcher */}
                        <div className="space-y-1">
                          <Label className="text-xs">Widget Type</Label>
                          <Select
                            value={selectedWidget.type}
                            onValueChange={(nextType: ScreenWidgetType) => {
                              const cat = getCatalogEntry(nextType);
                              updateSelectedWidget((w) => ({
                                ...w,
                                type: nextType,
                                titleOverride: undefined,
                                config: JSON.parse(JSON.stringify(cat.defaultConfig)),
                              }));
                            }}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {WIDGET_CATALOG.map((item) => (
                                <SelectItem key={item.type} value={item.type}>
                                  {item.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        {/* Custom Header Title Override */}
                        <div className="space-y-1">
                          <Label className="text-xs">Custom Header Title (Optional)</Label>
                          <Input
                            value={selectedWidget.titleOverride || ""}
                            onChange={(e) =>
                              updateSelectedWidget((w) => ({
                                ...w,
                                titleOverride: e.target.value || undefined,
                              }))
                            }
                            placeholder={getCatalogEntry(selectedWidget.type).label}
                            className="h-8 text-xs"
                          />
                        </div>

                        {/* Precision Grid Coordinates (1-based for humans) */}
                        <div className="grid grid-cols-4 gap-2 p-2.5 rounded-lg bg-secondary/25 border border-border/60">
                          <div className="space-y-1">
                            <Label className="text-[10px] uppercase text-muted-foreground">
                              Col (1–11)
                            </Label>
                            <Input
                              type="number"
                              min={1}
                              max={11}
                              value={selectedWidget.x + 1}
                              onChange={(e) => {
                                const box = clampWidgetBox({
                                  ...selectedWidget,
                                  x: (Number(e.target.value) || 1) - 1,
                                });
                                updateSelectedWidget((w) => ({ ...w, ...box }));
                              }}
                              className="h-7 text-xs px-2"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-[10px] uppercase text-muted-foreground">
                              Row (1–6)
                            </Label>
                            <Input
                              type="number"
                              min={1}
                              max={6}
                              value={selectedWidget.y + 1}
                              onChange={(e) => {
                                const box = clampWidgetBox({
                                  ...selectedWidget,
                                  y: (Number(e.target.value) || 1) - 1,
                                });
                                updateSelectedWidget((w) => ({ ...w, ...box }));
                              }}
                              className="h-7 text-xs px-2"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-[10px] uppercase text-muted-foreground">
                              Width (2–12)
                            </Label>
                            <Input
                              type="number"
                              min={2}
                              max={12}
                              value={selectedWidget.w}
                              onChange={(e) => {
                                const box = clampWidgetBox({
                                  ...selectedWidget,
                                  w: Number(e.target.value) || 6,
                                });
                                updateSelectedWidget((w) => ({ ...w, ...box }));
                              }}
                              className="h-7 text-xs px-2"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-[10px] uppercase text-muted-foreground">
                              Height (1–6)
                            </Label>
                            <Input
                              type="number"
                              min={1}
                              max={6}
                              value={selectedWidget.h}
                              onChange={(e) => {
                                const box = clampWidgetBox({
                                  ...selectedWidget,
                                  h: Number(e.target.value) || 3,
                                });
                                updateSelectedWidget((w) => ({ ...w, ...box }));
                              }}
                              className="h-7 text-xs px-2"
                            />
                          </div>
                        </div>

                        {/* TYPE-SPECIFIC CONFIGURATION CONTROLS */}
                        {selectedWidget.type === "today_snapshot" && (
                          <div className="space-y-3 pt-1">
                            <div className="space-y-1">
                              <Label className="text-xs">Sections Shown</Label>
                              <Select
                                value={selectedWidget.config.mode || "both"}
                                onValueChange={(val) =>
                                  updateSelectedWidget((w) => ({
                                    ...w,
                                    config: { ...w.config, mode: val },
                                  }))
                                }
                              >
                                <SelectTrigger className="h-8 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="both">
                                    Both Today's Truck Routes & Sioux Falls Crew
                                  </SelectItem>
                                  <SelectItem value="trucks">Today's Truck Routes Only</SelectItem>
                                  <SelectItem value="sf">Today's Sioux Falls Crew Only</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <label className="flex items-center gap-2 text-xs cursor-pointer">
                              <input
                                type="checkbox"
                                checked={Boolean(selectedWidget.config.showOffStaff)}
                                onChange={(e) =>
                                  updateSelectedWidget((w) => ({
                                    ...w,
                                    config: { ...w.config, showOffStaff: e.target.checked },
                                  }))
                                }
                              />
                              <span>Include OFF / PTO staff chips at bottom</span>
                            </label>
                          </div>
                        )}

                        {selectedWidget.type === "sf_daily_shift" && (
                          <div className="space-y-3 pt-1">
                            <div className="space-y-1">
                              <Label className="text-xs">
                                Next-Day Switchover Time (Default 2:00 PM)
                              </Label>
                              <Input
                                type="time"
                                value={selectedWidget.config.rolloverTime || "14:00"}
                                onChange={(e) =>
                                  updateSelectedWidget((w) => ({
                                    ...w,
                                    config: {
                                      ...w.config,
                                      rolloverTime: e.target.value || "14:00",
                                    },
                                  }))
                                }
                                className="h-8 text-xs font-mono"
                              />
                              <p className="text-[11px] text-muted-foreground leading-snug">
                                Shows today&apos;s SF crew until this time, then flips to the next scheduled workday (skipping Sunday / unscheduled Saturday automatically).
                              </p>
                            </div>

                            <div className="space-y-1">
                              <Label className="text-xs">Crew Layout Style</Label>
                              <Select
                                value={selectedWidget.config.layoutStyle || "spotlight_plus_mid"}
                                onValueChange={(val) =>
                                  updateSelectedWidget((w) => ({
                                    ...w,
                                    config: { ...w.config, layoutStyle: val },
                                  }))
                                }
                              >
                                <SelectTrigger className="h-8 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="spotlight_plus_mid">
                                    Opening & Closing Spotlight + Mid/Specialty Shifts (Recommended)
                                  </SelectItem>
                                  <SelectItem value="full_highlighted_list">
                                    Opening & Closing Spotlight + Full Highlighted Crew List
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                            </div>

                            <div className="space-y-1">
                              <Label className="text-xs">Day Mode / Preview Override</Label>
                              <Select
                                value={selectedWidget.config.dayMode || "auto"}
                                onValueChange={(val) =>
                                  updateSelectedWidget((w) => ({
                                    ...w,
                                    config: { ...w.config, dayMode: val },
                                  }))
                                }
                              >
                                <SelectTrigger className="h-8 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="auto">
                                    Auto — Today until Switchover Time, then Next Workday
                                  </SelectItem>
                                  <SelectItem value="today">Always Show Today</SelectItem>
                                  <SelectItem value="next_workday">
                                    Always Show Next Workday (Preview Tomorrow/Monday)
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                            </div>

                            <label className="flex items-center gap-2 text-xs cursor-pointer">
                              <input
                                type="checkbox"
                                checked={Boolean(selectedWidget.config.showOffStaff)}
                                onChange={(e) =>
                                  updateSelectedWidget((w) => ({
                                    ...w,
                                    config: { ...w.config, showOffStaff: e.target.checked },
                                  }))
                                }
                              />
                              <span>Show OFF / PTO staff strip at bottom</span>
                            </label>
                          </div>
                        )}

                        {selectedWidget.type === "nws_alerts" && (
                          <div className="space-y-3 pt-1">
                            <label className="flex items-center gap-2 text-xs cursor-pointer">
                              <input
                                type="checkbox"
                                checked={Boolean(selectedWidget.config.corridorOnly)}
                                onChange={(e) =>
                                  updateSelectedWidget((w) => ({
                                    ...w,
                                    config: { ...w.config, corridorOnly: e.target.checked },
                                  }))
                                }
                              />
                              <span>Filter strictly to I-29 / I-90 corridor counties</span>
                            </label>
                            <label className="flex items-center gap-2 text-xs cursor-pointer">
                              <input
                                type="checkbox"
                                checked={selectedWidget.config.showForecastWhenClear !== false}
                                onChange={(e) =>
                                  updateSelectedWidget((w) => ({
                                    ...w,
                                    config: {
                                      ...w.config,
                                      showForecastWhenClear: e.target.checked,
                                    },
                                  }))
                                }
                              />
                              <span>Show 3-city temps & wind speeds when corridors are clear</span>
                            </label>
                            <Button
                              size="xs"
                              variant="outline"
                              onClick={handleSyncNwsNow}
                              disabled={syncingNws}
                              className="gap-1.5 w-full"
                            >
                              <RefreshCw
                                className={`w-3.5 h-3.5 ${syncingNws ? "animate-spin" : ""}`}
                              />
                              {syncingNws ? "Syncing NWS Feed..." : "Sync Live NWS Alerts Now"}
                            </Button>
                          </div>
                        )}

                        {selectedWidget.type === "safety_streak" && (
                          <div className="space-y-2.5 pt-1">
                            <div className="space-y-1">
                              <Label className="text-xs">Banner Title</Label>
                              <Input
                                value={selectedWidget.config.title ?? "DAYS INCIDENT-FREE"}
                                onChange={(e) =>
                                  updateSelectedWidget((w) => ({
                                    ...w,
                                    config: { ...w.config, title: e.target.value },
                                  }))
                                }
                                className="h-8 text-xs"
                              />
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div className="space-y-1">
                                <Label className="text-xs">Streak Start Date</Label>
                                <Input
                                  type="date"
                                  value={selectedWidget.config.startDateISO || ""}
                                  onChange={(e) =>
                                    updateSelectedWidget((w) => ({
                                      ...w,
                                      config: { ...w.config, startDateISO: e.target.value },
                                    }))
                                  }
                                  className="h-8 text-xs"
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">All-Time Record (Days)</Label>
                                <Input
                                  type="number"
                                  min={0}
                                  value={selectedWidget.config.bestStreakDays ?? 184}
                                  onChange={(e) =>
                                    updateSelectedWidget((w) => ({
                                      ...w,
                                      config: {
                                        ...w.config,
                                        bestStreakDays: Number(e.target.value) || 0,
                                      },
                                    }))
                                  }
                                  className="h-8 text-xs"
                                />
                              </div>
                            </div>
                            <Button
                              size="xs"
                              variant="secondary"
                              className="w-full"
                              onClick={() => {
                                const today = new Date().toISOString().slice(0, 10);
                                updateSelectedWidget((w) => ({
                                  ...w,
                                  config: { ...w.config, startDateISO: today },
                                }));
                              }}
                            >
                              Reset Streak Start Date to Today
                            </Button>
                            <div className="space-y-1">
                              <Label className="text-xs">Footer Message</Label>
                              <Input
                                value={selectedWidget.config.subtitle ?? ""}
                                onChange={(e) =>
                                  updateSelectedWidget((w) => ({
                                    ...w,
                                    config: { ...w.config, subtitle: e.target.value },
                                  }))
                                }
                                className="h-8 text-xs"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Accent Color</Label>
                              <div className="flex items-center gap-1.5">
                                {ACCENT_PRESETS.map((c) => (
                                  <button
                                    key={c.hex}
                                    type="button"
                                    title={c.label}
                                    onClick={() =>
                                      updateSelectedWidget((w) => ({
                                        ...w,
                                        config: { ...w.config, accentColor: c.hex },
                                      }))
                                    }
                                    className={`w-6 h-6 rounded-full border-2 ${
                                      selectedWidget.config.accentColor === c.hex
                                        ? "border-white scale-110"
                                        : "border-transparent opacity-80"
                                    }`}
                                    style={{ backgroundColor: c.hex }}
                                  />
                                ))}
                              </div>
                            </div>
                          </div>
                        )}

                        {selectedWidget.type === "big_countdown" && (
                          <div className="space-y-2.5 pt-1">
                            <div className="space-y-1">
                              <Label className="text-xs">Event Headline</Label>
                              <Input
                                value={selectedWidget.config.title ?? ""}
                                onChange={(e) =>
                                  updateSelectedWidget((w) => ({
                                    ...w,
                                    config: { ...w.config, title: e.target.value },
                                  }))
                                }
                                placeholder="e.g., COMPANY CHRISTMAS PARTY"
                                className="h-8 text-xs"
                              />
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div className="space-y-1">
                                <Label className="text-xs">Target Date</Label>
                                <Input
                                  type="date"
                                  value={selectedWidget.config.targetDateISO || ""}
                                  onChange={(e) =>
                                    updateSelectedWidget((w) => ({
                                      ...w,
                                      config: { ...w.config, targetDateISO: e.target.value },
                                    }))
                                  }
                                  className="h-8 text-xs"
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">Target Time</Label>
                                <Input
                                  type="time"
                                  value={selectedWidget.config.targetTime || "08:00"}
                                  onChange={(e) =>
                                    updateSelectedWidget((w) => ({
                                      ...w,
                                      config: { ...w.config, targetTime: e.target.value },
                                    }))
                                  }
                                  className="h-8 text-xs"
                                />
                              </div>
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Callout / Action Note</Label>
                              <Input
                                value={selectedWidget.config.subtitle ?? ""}
                                onChange={(e) =>
                                  updateSelectedWidget((w) => ({
                                    ...w,
                                    config: { ...w.config, subtitle: e.target.value },
                                  }))
                                }
                                placeholder="e.g., RSVP to Jackie before Nov 25th"
                                className="h-8 text-xs"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Accent Color</Label>
                              <div className="flex items-center gap-1.5">
                                {ACCENT_PRESETS.map((c) => (
                                  <button
                                    key={c.hex}
                                    type="button"
                                    title={c.label}
                                    onClick={() =>
                                      updateSelectedWidget((w) => ({
                                        ...w,
                                        config: { ...w.config, accentColor: c.hex },
                                      }))
                                    }
                                    className={`w-6 h-6 rounded-full border-2 ${
                                      selectedWidget.config.accentColor === c.hex
                                        ? "border-white scale-110"
                                        : "border-transparent opacity-80"
                                    }`}
                                    style={{ backgroundColor: c.hex }}
                                  />
                                ))}
                              </div>
                            </div>
                          </div>
                        )}

                        {selectedWidget.type === "media_qr" && (
                          <div className="space-y-2.5 pt-1">
                            <div className="space-y-1">
                              <Label className="text-xs">Display Mode</Label>
                              <Select
                                value={selectedWidget.config.mode || "image_with_qr"}
                                onValueChange={(val) =>
                                  updateSelectedWidget((w) => ({
                                    ...w,
                                    config: { ...w.config, mode: val },
                                  }))
                                }
                              >
                                <SelectTrigger className="h-8 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="image_with_qr">
                                    Flyer Graphic + Scannable QR Side-by-Side
                                  </SelectItem>
                                  <SelectItem value="image">Flyer / Image Slide Only</SelectItem>
                                  <SelectItem value="qr">Large Scannable QR Code Only</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>

                            {selectedWidget.config.mode !== "qr" && (
                              <div className="space-y-2 p-2.5 rounded-lg bg-secondary/20 border border-border/70">
                                <div className="flex items-center justify-between gap-2">
                                  <Label className="text-xs font-semibold">
                                    Flyer / Photo Graphic
                                  </Label>
                                  <label className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-sm bg-primary/15 border border-primary/45 text-primary hover:bg-primary/25 text-xs font-bold cursor-pointer">
                                    <Upload className="w-3.5 h-3.5" />
                                    {uploadingMedia ? "Uploading..." : "Upload PNG/JPG"}
                                    <input
                                      type="file"
                                      accept="image/png,image/jpeg,image/webp,image/gif"
                                      className="hidden"
                                      disabled={uploadingMedia}
                                      onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (file) handleUploadFlyerMedia(file);
                                        e.currentTarget.value = "";
                                      }}
                                    />
                                  </label>
                                </div>
                                <Input
                                  value={selectedWidget.config.imageUrl || ""}
                                  onChange={(e) =>
                                    updateSelectedWidget((w) => ({
                                      ...w,
                                      config: { ...w.config, imageUrl: e.target.value },
                                    }))
                                  }
                                  placeholder="Uploaded /api/display/media/... or https:// image URL"
                                  className="h-8 text-xs"
                                />
                                <div className="space-y-1">
                                  <Label className="text-[11px] text-muted-foreground">
                                    Image Scaling
                                  </Label>
                                  <Select
                                    value={selectedWidget.config.imageFit || "contain"}
                                    onValueChange={(val) =>
                                      updateSelectedWidget((w) => ({
                                        ...w,
                                        config: { ...w.config, imageFit: val },
                                      }))
                                    }
                                  >
                                    <SelectTrigger className="h-7 text-xs">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="contain">
                                        Fit Entire Flyer (No Cropping)
                                      </SelectItem>
                                      <SelectItem value="cover">
                                        Fill Panel Edge-to-Edge (Cover)
                                      </SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                              </div>
                            )}

                            {selectedWidget.config.mode !== "image" && (
                              <div className="space-y-2 p-2.5 rounded-lg bg-secondary/20 border border-border/70">
                                <div className="space-y-1">
                                  <Label className="text-xs font-semibold">
                                    QR Code Destination URL (Phone Camera Scan)
                                  </Label>
                                  <Input
                                    value={selectedWidget.config.qrUrl || ""}
                                    onChange={(e) =>
                                      updateSelectedWidget((w) => ({
                                        ...w,
                                        config: { ...w.config, qrUrl: e.target.value },
                                      }))
                                    }
                                    placeholder="https://..."
                                    className="h-8 text-xs font-mono"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-[11px] text-muted-foreground">
                                    QR Badge Caption
                                  </Label>
                                  <Input
                                    value={selectedWidget.config.qrLabel ?? ""}
                                    onChange={(e) =>
                                      updateSelectedWidget((w) => ({
                                        ...w,
                                        config: { ...w.config, qrLabel: e.target.value },
                                      }))
                                    }
                                    placeholder="Scan with Phone"
                                    className="h-7 text-xs"
                                  />
                                </div>
                              </div>
                            )}

                            <div className="grid grid-cols-2 gap-2">
                              <div className="space-y-1">
                                <Label className="text-xs">Headline</Label>
                                <Input
                                  value={selectedWidget.config.title ?? ""}
                                  onChange={(e) =>
                                    updateSelectedWidget((w) => ({
                                      ...w,
                                      config: { ...w.config, title: e.target.value },
                                    }))
                                  }
                                  className="h-8 text-xs"
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">Subtitle</Label>
                                <Input
                                  value={selectedWidget.config.subtitle ?? ""}
                                  onChange={(e) =>
                                    updateSelectedWidget((w) => ({
                                      ...w,
                                      config: { ...w.config, subtitle: e.target.value },
                                    }))
                                  }
                                  className="h-8 text-xs"
                                />
                              </div>
                            </div>
                          </div>
                        )}

                        {selectedWidget.type === "photo_gallery" && (() => {
                          const galleryState = normalizePhotoGalleryState(displayState?.photoGallery);
                          const currentAlbum = selectedWidget.config.albumId || "all";
                          const matchingPhotos = resolveActiveGalleryPhotos(galleryState, currentAlbum);
                          return (
                            <div className="space-y-2.5 pt-1">
                              <div className="rounded bg-primary/10 border border-primary/30 px-2.5 py-2 text-[11px] text-foreground flex items-center justify-between gap-2">
                                <span>
                                  <strong>{matchingPhotos.length}</strong> active photo{matchingPhotos.length === 1 ? "" : "s"} in selection
                                </span>
                                <span className="text-[10px] font-mono text-muted-foreground">
                                  Manage in Photo Gallery tab
                                </span>
                              </div>

                              <div className="space-y-1">
                                <Label className="text-xs">Gallery Album Filter</Label>
                                <Select
                                  value={currentAlbum}
                                  onValueChange={(val) =>
                                    updateSelectedWidget((w) => ({
                                      ...w,
                                      config: { ...w.config, albumId: val },
                                    }))
                                  }
                                >
                                  <SelectTrigger className="h-8 text-xs">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="all">
                                      All Active Photos ({resolveActiveGalleryPhotos(galleryState, "all").length})
                                    </SelectItem>
                                    {galleryState.albums.map((alb) => (
                                      <SelectItem key={alb.id} value={alb.id}>
                                        {alb.name} ({resolveActiveGalleryPhotos(galleryState, alb.id).length})
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>

                              <div className="grid grid-cols-2 gap-2">
                                <div className="space-y-1">
                                  <Label className="text-xs">Display Mode</Label>
                                  <Select
                                    value={selectedWidget.config.displayMode || "slideshow"}
                                    onValueChange={(val) =>
                                      updateSelectedWidget((w) => ({
                                        ...w,
                                        config: { ...w.config, displayMode: val },
                                      }))
                                    }
                                  >
                                    <SelectTrigger className="h-8 text-xs">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="slideshow">Full-Frame Slideshow</SelectItem>
                                      <SelectItem value="collage">4-Photo Collage Grid</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>

                                <div className="space-y-1">
                                  <Label className="text-xs">Seconds / Photo</Label>
                                  <Input
                                    type="number"
                                    min={4}
                                    max={60}
                                    value={selectedWidget.config.slideDurationSec ?? 8}
                                    onChange={(e) =>
                                      updateSelectedWidget((w) => ({
                                        ...w,
                                        config: {
                                          ...w.config,
                                          slideDurationSec: Math.max(4, Math.min(60, Number(e.target.value) || 8)),
                                        },
                                      }))
                                    }
                                    className="h-8 text-xs font-mono"
                                  />
                                </div>
                              </div>

                              <div className="space-y-1">
                                <Label className="text-xs">Banner Headline</Label>
                                <Input
                                  value={selectedWidget.config.title ?? ""}
                                  onChange={(e) =>
                                    updateSelectedWidget((w) => ({
                                      ...w,
                                      config: { ...w.config, title: e.target.value },
                                    }))
                                  }
                                  placeholder="TEAM & FAMILY GALLERY"
                                  className="h-8 text-xs"
                                />
                              </div>

                              <label className="flex items-center gap-2 text-xs cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={selectedWidget.config.showCaptions !== false}
                                  onChange={(e) =>
                                    updateSelectedWidget((w) => ({
                                      ...w,
                                      config: { ...w.config, showCaptions: e.target.checked },
                                    }))
                                  }
                                />
                                <span>Show photo captions, album badge &amp; sender credit</span>
                              </label>
                            </div>
                          );
                        })()}

                        {selectedWidget.type === "custom_info" && (
                          <div className="space-y-2.5 pt-1">
                            <div className="space-y-1">
                              <Label className="text-xs">Board Headline</Label>
                              <Input
                                value={selectedWidget.config.title ?? ""}
                                onChange={(e) =>
                                  updateSelectedWidget((w) => ({
                                    ...w,
                                    config: { ...w.config, title: e.target.value },
                                  }))
                                }
                                placeholder="DAILY DOCK & DISPATCH PRIORITIES"
                                className="h-8 text-xs"
                              />
                            </div>
                            <div className="space-y-1">
                              <div className="flex items-center justify-between">
                                <Label className="text-xs">Bullet Points / Information Lines</Label>
                                <span className="text-[10px] text-muted-foreground">
                                  One item per line
                                </span>
                              </div>
                              <Textarea
                                rows={5}
                                value={selectedWidget.config.body ?? ""}
                                onChange={(e) =>
                                  updateSelectedWidget((w) => ({
                                    ...w,
                                    config: { ...w.config, body: e.target.value },
                                  }))
                                }
                                placeholder={"• Stage Huron pallets in Bay 2\n• Lock dock doors before 5:30 PM"}
                                className="text-xs"
                              />
                            </div>
                            <div className="grid grid-cols-2 gap-2 items-end">
                              <div className="space-y-1">
                                <Label className="text-xs">TV Font Scale</Label>
                                <Select
                                  value={selectedWidget.config.textSize || "normal"}
                                  onValueChange={(val) =>
                                    updateSelectedWidget((w) => ({
                                      ...w,
                                      config: { ...w.config, textSize: val },
                                    }))
                                  }
                                >
                                  <SelectTrigger className="h-8 text-xs">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="normal">Standard List</SelectItem>
                                    <SelectItem value="large">Large Callouts</SelectItem>
                                    <SelectItem value="hero">Extra-Large Hero</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">Accent Color</Label>
                                <div className="flex items-center gap-1">
                                  {ACCENT_PRESETS.map((c) => (
                                    <button
                                      key={c.hex}
                                      type="button"
                                      title={c.label}
                                      onClick={() =>
                                        updateSelectedWidget((w) => ({
                                          ...w,
                                          config: { ...w.config, accentColor: c.hex },
                                        }))
                                      }
                                      className={`w-5 h-5 rounded-full border-2 ${
                                        selectedWidget.config.accentColor === c.hex
                                          ? "border-white scale-110"
                                          : "border-transparent opacity-80"
                                      }`}
                                      style={{ backgroundColor: c.hex }}
                                    />
                                  ))}
                                </div>
                              </div>
                            </div>
                          </div>
                        )}

                        {selectedWidget.type === "live_map" && (() => {
                          const currentPreset = selectedWidget.config.preset || "corridor";
                          const resolvedMap = resolveMapViewSpec(
                            currentPreset,
                            selectedWidget.config.customBounds,
                            savedMapRegions,
                            selectedWidget.config.etaHub,
                          );
                          return (
                            <div className="space-y-2.5 pt-1">
                              <div className="space-y-1">
                                <Label className="text-xs">Map Area / Region</Label>
                                <Select
                                  value={currentPreset}
                                  onValueChange={(val) => {
                                    if (val === "custom" && !isValidMapBoundingBox(selectedWidget.config.customBounds)) {
                                      setMapSelectorOpen(true);
                                      return;
                                    }
                                    updateSelectedWidget((w) => ({
                                      ...w,
                                      config: { ...w.config, preset: val },
                                    }));
                                  }}
                                >
                                  <SelectTrigger className="h-8 text-xs">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {BUILTIN_MAP_PRESETS.map((bp) => (
                                      <SelectItem key={bp.id} value={bp.id}>
                                        {bp.name}
                                      </SelectItem>
                                    ))}
                                    {savedMapRegions.map((reg) => (
                                      <SelectItem key={reg.id} value={`region:${reg.id}`}>
                                        Saved Area: {reg.name}
                                      </SelectItem>
                                    ))}
                                    <SelectItem value="custom">
                                      Custom Drawn / Framed Map Area…
                                    </SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>

                              <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                className="w-full gap-1.5 text-xs font-bold border border-primary/40 text-primary hover:bg-primary/15"
                                onClick={() => setMapSelectorOpen(true)}
                                data-testid="button-open-studio-map-selector"
                              >
                                <Crop className="w-3.5 h-3.5" />
                                Select / Draw Custom Map Area…
                              </Button>

                              {resolvedMap.fitBounds && (
                                <div className="rounded bg-secondary/40 border border-border px-2.5 py-1.5 text-[11px] font-mono text-muted-foreground">
                                  {formatBoundsSummary(resolvedMap.fitBounds)}
                                </div>
                              )}

                              {/* Colored Route Highlighting Controls */}
                              <div className="pt-2 border-t border-border/60 space-y-2">
                                <div className="space-y-1">
                                  <Label className="text-xs flex items-center justify-between">
                                    <span>Colored Route Highlighting</span>
                                    <span className="text-[10px] font-mono text-primary">23 Routes</span>
                                  </Label>
                                  <Select
                                    value={selectedWidget.config.routeFilter || "today"}
                                    onValueChange={(val) =>
                                      updateSelectedWidget((w) => ({
                                        ...w,
                                        config: { ...w.config, routeFilter: val },
                                      }))
                                    }
                                  >
                                    <SelectTrigger className="h-8 text-xs">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {ROUTE_FILTER_OPTIONS.map((opt) => (
                                        <SelectItem key={opt.id} value={opt.id}>
                                          {opt.label}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>

                                {(selectedWidget.config.routeFilter || "today") === "custom" && (() => {
                                  const allTerritories = normalizeRouteTerritories(
                                    displayState?.routeTerritories,
                                    DEFAULT_ROUTE_TERRITORIES,
                                  );
                                  const selectedIds = new Set<string>(
                                    Array.isArray(selectedWidget.config.selectedRouteIds)
                                      ? selectedWidget.config.selectedRouteIds
                                      : [],
                                  );
                                  return (
                                    <div className="rounded border border-border bg-secondary/30 p-2 max-h-40 overflow-y-auto space-y-1">
                                      {allTerritories.map((rt) => {
                                        const checked = selectedIds.has(rt.id);
                                        return (
                                          <label
                                            key={rt.id}
                                            className="flex items-center justify-between gap-2 text-[11px] cursor-pointer hover:bg-secondary/50 px-1 py-0.5 rounded"
                                          >
                                            <span className="flex items-center gap-1.5 min-w-0">
                                              <input
                                                type="checkbox"
                                                checked={checked}
                                                onChange={(e) => {
                                                  const next = new Set(selectedIds);
                                                  if (e.target.checked) next.add(rt.id);
                                                  else next.delete(rt.id);
                                                  updateSelectedWidget((w) => ({
                                                    ...w,
                                                    config: {
                                                      ...w.config,
                                                      selectedRouteIds: Array.from(next),
                                                    },
                                                  }));
                                                }}
                                              />
                                              <span
                                                className="w-2.5 h-2.5 rounded-sm shrink-0"
                                                style={{ backgroundColor: rt.color }}
                                              />
                                              <span className="font-semibold truncate">{rt.name}</span>
                                            </span>
                                            <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                                              {rt.stops.length}t
                                            </span>
                                          </label>
                                        );
                                      })}
                                    </div>
                                  );
                                })()}

                                {(selectedWidget.config.routeFilter || "today") !== "off" && (
                                  <div className="grid grid-cols-2 gap-2">
                                    <div className="space-y-1">
                                      <Label className="text-[11px]">Highlight Style</Label>
                                      <Select
                                        value={selectedWidget.config.routeStyle || "zones_and_sequence"}
                                        onValueChange={(val) =>
                                          updateSelectedWidget((w) => ({
                                            ...w,
                                            config: { ...w.config, routeStyle: val },
                                          }))
                                        }
                                      >
                                        <SelectTrigger className="h-8 text-xs">
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="zones_and_sequence">
                                            Zones + Town Line
                                          </SelectItem>
                                          <SelectItem value="zones_only">Shaded Zones Only</SelectItem>
                                          <SelectItem value="sequence_only">
                                            Town Sequence Only
                                          </SelectItem>
                                        </SelectContent>
                                      </Select>
                                    </div>

                                    <div className="space-y-1">
                                      <Label className="text-[11px]">Route Color Mode</Label>
                                      <Select
                                        value={selectedWidget.config.routeColorMode || "route"}
                                        onValueChange={(val) =>
                                          updateSelectedWidget((w) => ({
                                            ...w,
                                            config: { ...w.config, routeColorMode: val },
                                          }))
                                        }
                                      >
                                        <SelectTrigger className="h-8 text-xs">
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="route">Distinct Route Colors</SelectItem>
                                          <SelectItem value="driver">Match Driver Color</SelectItem>
                                        </SelectContent>
                                      </Select>
                                    </div>
                                  </div>
                                )}
                              </div>

                              <label className="flex items-center gap-2 text-xs cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={selectedWidget.config.showReturnEta !== false}
                                  onChange={(e) =>
                                    updateSelectedWidget((w) => ({
                                      ...w,
                                      config: { ...w.config, showReturnEta: e.target.checked },
                                    }))
                                  }
                                />
                                <span>Show Live Warehouse Return ETA Overlay</span>
                              </label>

                              <div className="pt-2 border-t border-border/60 space-y-1">
                                <Label className="text-xs">Severe Weather Map Zones</Label>
                                <Select
                                  value={selectedWidget.config.weatherOverlayMode || "inherit"}
                                  onValueChange={(val) =>
                                    updateSelectedWidget((w) => ({
                                      ...w,
                                      config: { ...w.config, weatherOverlayMode: val },
                                    }))
                                  }
                                >
                                  <SelectTrigger className="h-8 text-xs">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="inherit">
                                      Inherit Company Default (Warnings Only)
                                    </SelectItem>
                                    {WEATHER_OVERLAY_MODES.map((wm) => (
                                      <SelectItem key={wm.id} value={wm.id}>
                                        {wm.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                          );
                        })()}

                        {selectedWidget.type === "truck_schedule" && (
                          <label className="flex items-center gap-2 text-xs cursor-pointer pt-1">
                            <input
                              type="checkbox"
                              checked={selectedWidget.config.showGpsBadges !== false}
                              onChange={(e) =>
                                updateSelectedWidget((w) => ({
                                  ...w,
                                  config: { ...w.config, showGpsBadges: e.target.checked },
                                }))
                              }
                            />
                            <span>Show Live Motive GPS MPH / HUB badges next to drivers</span>
                          </label>
                        )}

                        {selectedWidget.type === "sf_schedule" && (
                          <div className="space-y-1 pt-1">
                            <Label className="text-xs">Rows Per Auto-Page (4–14)</Label>
                            <Input
                              type="number"
                              min={4}
                              max={14}
                              value={selectedWidget.config.rowsPerPage ?? 7}
                              onChange={(e) =>
                                updateSelectedWidget((w) => ({
                                  ...w,
                                  config: {
                                    ...w.config,
                                    rowsPerPage: Math.max(4, Math.min(14, Number(e.target.value) || 7)),
                                  },
                                }))
                              }
                              className="h-8 text-xs"
                            />
                          </div>
                        )}

                        {selectedWidget.type === "announcements" && (
                          <div className="space-y-1 pt-1">
                            <Label className="text-xs">Max Urgent Announcements Shown (1–6)</Label>
                            <Input
                              type="number"
                              min={1}
                              max={6}
                              value={selectedWidget.config.maxItems ?? 3}
                              onChange={(e) =>
                                updateSelectedWidget((w) => ({
                                  ...w,
                                  config: {
                                    ...w.config,
                                    maxItems: Math.max(1, Math.min(6, Number(e.target.value) || 3)),
                                  },
                                }))
                              }
                              className="h-8 text-xs"
                            />
                          </div>
                        )}

                        {selectedWidget.type === "calendar" && (
                          <div className="space-y-1 pt-1">
                            <Label className="text-xs">Max Upcoming Events Shown (2–10)</Label>
                            <Input
                              type="number"
                              min={2}
                              max={10}
                              value={selectedWidget.config.maxItems ?? 5}
                              onChange={(e) =>
                                updateSelectedWidget((w) => ({
                                  ...w,
                                  config: {
                                    ...w.config,
                                    maxItems: Math.max(2, Math.min(10, Number(e.target.value) || 5)),
                                  },
                                }))
                              }
                              className="h-8 text-xs"
                            />
                          </div>
                        )}

                        {selectedWidget.type === "renewals" && (
                          <div className="space-y-1 pt-1">
                            <Label className="text-xs">Compliance Filter Window</Label>
                            <Select
                              value={String(selectedWidget.config.onlyWithinDays || 0)}
                              onValueChange={(val) =>
                                updateSelectedWidget((w) => ({
                                  ...w,
                                  config: { ...w.config, onlyWithinDays: Number(val) || 0 },
                                }))
                              }
                            >
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="0">Show Full Sorted Roster</SelectItem>
                                <SelectItem value="60">Only Due Within 60 Days</SelectItem>
                                <SelectItem value="45">Only Due Within 45 Days</SelectItem>
                                <SelectItem value="30">Only Urgent Due Within 30 Days</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        )}

                        {selectedWidget.type === "weather_multi" && (
                          <div className="space-y-1 pt-1">
                            <Label className="text-xs">Corridor City Focus</Label>
                            <Select
                              value={selectedWidget.config.cityFilter || "all"}
                              onValueChange={(val) =>
                                updateSelectedWidget((w) => ({
                                  ...w,
                                  config: { ...w.config, cityFilter: val },
                                }))
                              }
                            >
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="all">
                                  All 3 Cities (Sioux Falls, Aberdeen, Huron)
                                </SelectItem>
                                <SelectItem value="Sioux Falls">Sioux Falls Only</SelectItem>
                                <SelectItem value="Aberdeen">Aberdeen Only</SelectItem>
                                <SelectItem value="Huron">Huron Only</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* ADD WIDGET LIBRARY */}
                  <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-sm">Add Widget to Screen</span>
                      <Select
                        value={widgetPickerCategory}
                        onValueChange={setWidgetPickerCategory}
                      >
                        <SelectTrigger className="h-7 w-[155px] text-[11px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Categories (13)</SelectItem>
                          <SelectItem value="Operations & Fleet">Operations & Fleet</SelectItem>
                          <SelectItem value="Safety & Weather">Safety & Weather</SelectItem>
                          <SelectItem value="Team & Communications">
                            Team & Communications
                          </SelectItem>
                          <SelectItem value="Media & Custom">Media & Custom</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="grid gap-2 max-h-[340px] overflow-y-auto pr-1">
                      {filteredCatalog.map((item) => (
                        <div
                          key={item.type}
                          className="rounded-lg border border-border/80 bg-background/60 p-2.5 flex items-center justify-between gap-2.5 hover:border-sky-500/50 transition-colors"
                        >
                          <div className="min-w-0 space-y-0.5">
                            <div className="text-xs font-bold text-foreground flex items-center gap-1.5">
                              <span className="truncate">{item.label}</span>
                              <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                                {item.defaultW}×{item.defaultH}
                              </span>
                            </div>
                            <p className="text-[11px] text-muted-foreground leading-snug line-clamp-2">
                              {item.description}
                            </p>
                          </div>
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={() => handleAddWidget(item.type)}
                            className="shrink-0 gap-1"
                          >
                            <Plus className="w-3 h-3" />
                            Add
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* SUB-MODE 2: PER-GROUP & PER-TV PLAYLIST ROTATION MANAGER              */}
      {/* ===================================================================== */}
      {studioTab === "playlists" && (
        <div className="grid gap-5 lg:grid-cols-12 items-start">
          {/* LEFT 4 COLS: TARGET HIERARCHY SELECTOR */}
          <div className="lg:col-span-4 rounded-sm border border-border bg-card p-4 space-y-4">
            <div>
              <h3 className="text-sm font-display font-bold uppercase tracking-wide flex items-center gap-2">
                <FolderOpen className="w-4 h-4 text-primary" />
                Select Playlist Target
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                TVs automatically inherit their Display Group playlist (or the Company Default) unless given a custom override.
              </p>
            </div>

            <div className="space-y-3">
              {/* Company Default */}
              <div className="space-y-1.5">
                <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-muted-foreground">
                  Company Baseline
                </div>
                <button
                  type="button"
                  onClick={() => setPlaylistTarget("default")}
                  className={`w-full rounded-sm border p-3 text-left transition-colors ${
                    playlistTarget === "default"
                      ? "border-primary bg-primary/15 text-foreground"
                      : "border-border bg-background/50 hover:bg-secondary/40"
                  }`}
                >
                  <div className="text-xs font-bold flex items-center justify-between">
                    <span>Default Company Playlist</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-sm bg-primary/15 text-primary border border-primary/35">
                      {defaultPlaylistDraft.filter((e) => e.enabled).length} ACTIVE
                    </span>
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    Baseline rotation for all groups & TVs
                  </div>
                </button>
              </div>

              {/* Display Groups */}
              <div className="space-y-1.5">
                <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-muted-foreground">
                  Display Groups ({groups.length})
                </div>
                <div className="space-y-1.5">
                  {groups.map((g) => {
                    const key = `group:${g.id}`;
                    const customPl = groupPlaylistsDraft[g.id] ?? null;
                    return (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => setPlaylistTarget(key)}
                        className={`w-full rounded-sm border p-2.5 text-left transition-colors ${
                          playlistTarget === key
                            ? "border-primary bg-primary/15 text-foreground"
                            : "border-border bg-background/50 hover:bg-secondary/40"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className="w-2.5 h-2.5 rounded-[2px] shrink-0"
                              style={{ backgroundColor: g.color || "#E59A23" }}
                            />
                            <span className="text-xs font-bold truncate">{g.name}</span>
                          </div>
                          <span
                            className={`text-[10px] font-mono px-1.5 py-0.5 rounded-sm shrink-0 ${
                              customPl
                                ? "bg-primary/15 text-primary border border-primary/35"
                                : "bg-secondary text-muted-foreground"
                            }`}
                          >
                            {customPl
                              ? `Custom (${customPl.filter((e) => e.enabled).length})`
                              : "Inherits Default"}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Individual TV Units */}
              <div className="space-y-1.5">
                <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-muted-foreground">
                  Individual TV Units ({units.length})
                </div>
                <div className="space-y-1.5">
                  {units.map((u) => {
                    const key = `unit:${u.id}`;
                    const cfg = unitPlaylistsDraft[u.id];
                    const isCustom = cfg?.playlistMode === "custom";
                    return (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => setPlaylistTarget(key)}
                        className={`w-full rounded-sm border p-2.5 text-left transition-colors ${
                          playlistTarget === key
                            ? "border-primary bg-primary/15 text-foreground"
                            : "border-border bg-background/50 hover:bg-secondary/40"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-xs font-bold truncate inline-flex items-center gap-1.5">
                              <Tv className="w-3.5 h-3.5 text-primary shrink-0" />
                              {u.name}
                            </div>
                            <div className="text-[10px] font-mono text-muted-foreground">
                              ?display={u.id}
                            </div>
                          </div>
                          <span
                            className={`text-[10px] font-mono px-1.5 py-0.5 rounded-sm shrink-0 ${
                              isCustom
                                ? "bg-primary/15 text-primary border border-primary/35"
                                : "bg-secondary text-muted-foreground"
                            }`}
                          >
                            {isCustom
                              ? `Custom (${cfg.playlist.filter((e) => e.enabled).length})`
                              : "Inherits Group"}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT 8 COLS: ACTIVE PLAYLIST SLIDE ORDER & OVERRIDES */}
          <div className="lg:col-span-8 rounded-sm border border-border bg-card p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-border/70">
              <div>
                <h3 className="text-base font-display font-bold uppercase tracking-wide">
                  {activePlaylistContext.label}
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Check which built-in and custom screens play in rotation, reorder slides, or set per-slide durations.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {activePlaylistContext.kind !== "default" && (
                  <div className="inline-flex rounded-sm border border-border bg-background p-1 gap-1">
                    <button
                      type="button"
                      onClick={() => handleTogglePlaylistInheritance(true)}
                      className={`px-2.5 py-1 rounded-sm text-xs font-bold transition-colors ${
                        activePlaylistContext.inherits
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {activePlaylistContext.kind === "group"
                        ? "Inherit Default"
                        : "Inherit Group"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleTogglePlaylistInheritance(false)}
                      className={`px-2.5 py-1 rounded-sm text-xs font-bold transition-colors ${
                        !activePlaylistContext.inherits
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      Custom Playlist
                    </button>
                  </div>
                )}

                <Button
                  size="xs"
                  variant="outline"
                  onClick={() =>
                    handlePinScreenToTarget(
                      "auto",
                      activePlaylistContext.kind === "default"
                        ? "all"
                        : `${activePlaylistContext.kind}:${activePlaylistContext.id}`,
                    )
                  }
                  className="gap-1"
                >
                  <Play className="w-3 h-3 text-emerald-400" />
                  Resume Auto-Rotate
                </Button>
              </div>
            </div>

            {activePlaylistContext.inherits && (
              <div className="rounded-sm border border-primary/35 bg-primary/10 p-3 text-xs text-foreground flex items-center justify-between gap-3">
                <span>
                  This {activePlaylistContext.kind === "group" ? "group" : "TV display"} currently inherits its rotation automatically. Switch to <strong>Custom Playlist</strong> above to customize its screen lineup independently.
                </span>
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={() => handleTogglePlaylistInheritance(false)}
                >
                  Customize Lineup
                </Button>
              </div>
            )}

            {/* Slide Checklist & Reorder Rows */}
            <div className="space-y-2">
              {activePlaylistContext.entries.map((entry, idx) => {
                const meta = getScreenMetaLabel(entry.screenId);
                const disabledEditing = activePlaylistContext.inherits;
                const enabledCount = activePlaylistContext.entries.filter((e) => e.enabled).length;

                return (
                  <div
                    key={entry.screenId}
                    className={`rounded-sm border p-3 flex flex-wrap items-center justify-between gap-3 transition-colors ${
                      entry.enabled
                        ? "border-border bg-background/70"
                        : "border-border/50 bg-background/25 opacity-60"
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <input
                        type="checkbox"
                        disabled={disabledEditing || (entry.enabled && enabledCount <= 1)}
                        checked={entry.enabled}
                        onChange={(e) => {
                          const next = activePlaylistContext.entries.map((item) =>
                            item.screenId === entry.screenId
                              ? { ...item, enabled: e.target.checked }
                              : item,
                          );
                          setActivePlaylistEntries(next);
                        }}
                        className="w-4 h-4 accent-amber-500 cursor-pointer"
                      />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold text-xs sm:text-sm truncate">
                            {meta.title}
                          </span>
                          <span
                            className={`text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded-sm ${
                              meta.isCustom
                                ? "bg-primary/15 text-primary border border-primary/35"
                                : "bg-secondary text-foreground border border-border"
                            }`}
                          >
                            {meta.isCustom ? `CUSTOM • ${meta.badge}` : `BUILT-IN • ${meta.badge}`}
                          </span>
                        </div>
                        {meta.description && (
                          <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                            {meta.description}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <div className="inline-flex items-center gap-1">
                        <Label className="text-[11px] text-muted-foreground font-mono">SEC:</Label>
                        <Input
                          type="number"
                          min={5}
                          max={300}
                          disabled={disabledEditing}
                          value={entry.durationSec ?? ""}
                          placeholder={`${activePlaylistContext.baseDurationSec}s`}
                          onChange={(e) => {
                            const val = e.target.value ? Number(e.target.value) : undefined;
                            const next = activePlaylistContext.entries.map((item) =>
                              item.screenId === entry.screenId
                                ? {
                                    ...item,
                                    durationSec: val && val >= 5 ? val : undefined,
                                  }
                                : item,
                            );
                            setActivePlaylistEntries(next);
                          }}
                          className="w-16 h-7 text-xs px-2 font-mono"
                        />
                      </div>

                      <div className="inline-flex items-center gap-1">
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={disabledEditing || idx === 0}
                          onClick={() => {
                            const next = [...activePlaylistContext.entries];
                            const [moved] = next.splice(idx, 1);
                            next.splice(idx - 1, 0, moved);
                            setActivePlaylistEntries(next);
                          }}
                          title="Move earlier in rotation"
                        >
                          <ArrowUp className="w-3 h-3" />
                        </Button>
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={
                            disabledEditing || idx === activePlaylistContext.entries.length - 1
                          }
                          onClick={() => {
                            const next = [...activePlaylistContext.entries];
                            const [moved] = next.splice(idx, 1);
                            next.splice(idx + 1, 0, moved);
                            setActivePlaylistEntries(next);
                          }}
                          title="Move later in rotation"
                        >
                          <ArrowDown className="w-3 h-3" />
                        </Button>
                      </div>

                      <Button
                        size="xs"
                        variant="outline"
                        className="gap-1 border-primary/40 text-primary hover:bg-primary/15"
                        onClick={() => {
                          setSelectedScreenId(entry.screenId);
                          setStudioTab("designer");
                        }}
                        title="Open this screen in the Screen Designer to edit its layout, panels, or title in place"
                        data-testid={`button-playlist-edit-${entry.screenId}`}
                      >
                        <Pencil className="w-3 h-3" />
                        Edit Layout
                      </Button>

                      <Button
                        size="xs"
                        variant="secondary"
                        onClick={() =>
                          handlePinScreenToTarget(
                            entry.screenId,
                            activePlaylistContext.kind === "default"
                              ? "all"
                              : `${activePlaylistContext.kind}:${activePlaylistContext.id}`,
                          )
                        }
                        title="Immediately lock target TV(s) onto this screen"
                        className="gap-1"
                      >
                        <Pin className="w-3 h-3" />
                        Pin
                      </Button>

                      {!isBuiltInScreenId(entry.screenId) && (
                        <Button
                          size="xs"
                          variant="ghost"
                          disabled={saving}
                          onClick={() => {
                            const target = screensDraft.find((s) => s.id === entry.screenId);
                            if (target) handleDeleteScreen(target);
                          }}
                          title="Delete this custom screen permanently"
                          className="px-2 text-destructive hover:text-destructive hover:bg-destructive/15"
                          data-testid={`button-playlist-delete-${entry.screenId}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Effective Loop Summary */}
            {(() => {
              const sampleSettings = {
                ...(displayState?.settings || {}),
                defaultPlaylist: defaultPlaylistDraft,
                displayGroups: (displayState?.settings?.displayGroups || []).map((g: any) => ({
                  ...g,
                  playlist: groupPlaylistsDraft[g.id] ?? undefined,
                })),
                displayProfiles: Object.fromEntries(
                  Object.entries((displayState?.settings?.displayProfiles || {}) as Record<string, any>).map(
                    ([id, p]) => [
                      id,
                      {
                        ...p,
                        playlistMode: unitPlaylistsDraft[id]?.playlistMode || p.playlistMode,
                        playlist: unitPlaylistsDraft[id]?.playlist || p.playlist,
                      },
                    ],
                  ),
                ),
              };
              const sampleProfileId =
                activePlaylistContext.kind === "unit"
                  ? activePlaylistContext.id
                  : activePlaylistContext.kind === "group"
                    ? units.find((u) => u.groupId === activePlaylistContext.id)?.id || "breakroom"
                    : "__default__";

              const resolved =
                sampleProfileId === "__default__"
                  ? resolveEffectivePlaylist(
                      { ...sampleSettings, displayProfiles: {} },
                      screensDraft,
                      "__default__",
                    )
                  : resolveEffectivePlaylist(sampleSettings, screensDraft, sampleProfileId);
              const totalSec = resolved.reduce((acc, s) => acc + s.durationSec, 0);

              return (
                <div className="rounded-sm border border-border bg-secondary/45 p-3.5 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="font-display font-bold uppercase tracking-wide text-primary">
                      Effective Rotation Loop ({resolved.length} slide{resolved.length === 1 ? "" : "s"} • {totalSec}s full cycle)
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      Click "Save Studio & Push to TVs" above to publish playlist updates
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {resolved.map((s) => (
                      <span
                        key={s.screenId}
                        className="px-2.5 py-1 rounded-sm bg-background border border-border text-[11px] font-bold text-foreground"
                      >
                        {s.tabLabel} <span className="text-primary font-mono">({s.durationSec}s)</span>
                      </span>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {selectedWidget?.type === "live_map" && (
        <MapAreaSelectorModal
          open={mapSelectorOpen}
          onOpenChange={setMapSelectorOpen}
          title={`Select Map Area — ${selectedScreen?.name || "Custom Screen"}`}
          initialPreset={selectedWidget.config.preset || "corridor"}
          initialCustomBounds={selectedWidget.config.customBounds || null}
          initialEtaHub={selectedWidget.config.etaHub || "auto"}
          showEtaHubSelector
          savedRegions={savedMapRegions}
          onSaveRegions={handlePersistSavedMapRegions}
          vehicles={liveVehicles}
          onApply={(res) => {
            updateSelectedWidget((w) => ({
              ...w,
              config: {
                ...w.config,
                preset: res.preset,
                customBounds: res.customBounds,
                etaHub: res.etaHub,
                showReturnEta: res.etaHub === "none" ? false : w.config.showReturnEta !== false,
              },
            }));
            toast({ title: "Updated map area on screen — click Save Studio to publish!" });
          }}
        />
      )}

      {/* Delete Custom Screen Confirmation Modal */}
      <Dialog
        open={Boolean(screenPendingDelete)}
        onOpenChange={(open) => {
          if (!open) setScreenPendingDelete(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="w-5 h-5" />
              Delete Screen Layout
            </DialogTitle>
            <DialogDescription>
              Permanently delete custom screen{" "}
              <strong className="text-foreground">"{screenPendingDelete?.name}"</strong>? It will be
              immediately removed from all TV rotation playlists and broadcast controls.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setScreenPendingDelete(null)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDeleteScreen}
              disabled={saving}
              data-testid="button-confirm-delete-screen"
            >
              {saving ? "Deleting..." : "Delete Screen"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Built-In Screen Layout Confirmation Modal */}
      <Dialog
        open={Boolean(screenPendingReset)}
        onOpenChange={(open) => {
          if (!open) setScreenPendingReset(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RotateCcw className="w-5 h-5 text-amber-400" />
              Reset Built-In Screen Layout
            </DialogTitle>
            <DialogDescription>
              Restore{" "}
              <strong className="text-foreground">"{screenPendingReset?.name}"</strong> back to its
              original factory layout?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setScreenPendingReset(null)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              onClick={confirmResetBuiltInScreen}
              disabled={saving}
              data-testid="button-confirm-reset-builtin"
            >
              {saving ? "Resetting..." : "Reset to Default"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
