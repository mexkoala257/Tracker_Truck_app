import { useState, useEffect, useCallback, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useOfficeTheme } from "@/lib/theme";
import { DISPLAY_THEMES, isBuiltInScreenId, type DisplayThemeId } from "@shared/customScreens";
import {
  BUILTIN_MAP_PRESETS,
  resolveMapViewSpec,
  type SavedMapRegion,
} from "@shared/mapRegions";
import {
  DEFAULT_TV_POWER_SCHEDULE,
  TV_POWER_TIMEZONES,
  TV_POWER_WEEKDAYS,
  normalizeTvPowerSchedule,
  evaluateTvPowerSchedule,
  formatTime12h,
  type UnitPowerScheduleMode,
} from "@shared/tvPowerSchedule";
import {
  Satellite,
  Settings,
  Truck,
  MapPin,
  Pencil,
  Trash2,
  Plus,
  ArrowLeft,
  Home,
  Warehouse,
  Star,
  Flag,
  Building,
  Tv,
  Megaphone,
  Calendar,
  ShieldAlert,
  Users,
  RefreshCw,
  ExternalLink,
  Copy,
  Send,
  Play,
  Activity,
  Power,
  AlertTriangle,
  Terminal,
  FolderPlus,
  CheckCircle2,
  WifiOff,
  RotateCcw,
  Lock,
  KeyRound,
  LogOut,
  Eye,
  EyeOff,
  UserPlus,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  ListPlus,
  History,
  Sun,
  Moon,
  Paintbrush,
  Eraser,
  Clock,
  Flame,
  Archive,
  Sparkles,
  LayoutGrid,
  Palette,
  Crop,
  Images,
  Zap,
  CloudSnow,
} from "lucide-react";
import {
  WEATHER_OVERLAY_MODES,
  WEATHER_DEMO_SCENARIOS,
  normalizeWeatherOverlayMode,
  normalizeWeatherDemoScenario,
  getWeatherDemoScenarioMeta,
  type WeatherOverlayMode,
  type WeatherDemoScenarioId,
} from "@shared/weatherOverlay";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import ExportDialog from "@/components/ExportDialog";
import RouteCellPicker from "@/components/RouteCellPicker";
import SfShiftCellPicker from "@/components/SfShiftCellPicker";
import SfEmailExportBar from "@/components/SfEmailExportBar";
import ScreenDesignerStudio from "@/components/ScreenDesignerStudio";
import MapAreaSelectorModal from "@/components/MapAreaSelectorModal";
import RouteTerritoriesEditorDialog from "@/components/RouteTerritoriesEditorDialog";
import PhotoGalleryManager from "@/components/PhotoGalleryManager";
import HotShotManager from "@/components/HotShotManager";
import {
  IbsBrandHeaderMark,
  DoodleworksLegalFooter,
  CompanyBrandingEditorCard,
} from "@/components/IbsBrandComponents";
import {
  normalizeHotShotRoutes,
  getCentralDateISO,
  doesHotShotDriverMatchMember,
} from "@shared/hotshots";
import {
  type TruckWeekBlock,
  normalizeTruckScheduleState,
  getWorkweekMondayIso,
  shiftMondayIso,
  getMondaysForMonth,
  parseIsoDate,
  formatIsoDate,
  buildShortWeekRange,
  createBlankWeekBlock,
  countAssignedCells,
  getRoutesForDriver,
} from "@shared/truckSchedule";
import {
  type SfWeekBlock,
  normalizeSfScheduleState,
  getSfWorkweekMondayIso,
  buildShortSfWeekRange,
  createBlankSfWeekBlock,
  countSfAssignedCells,
  getShiftsForMember,
  evaluateSfWeekCoverage,
  isOpeningShift,
  isClosingShift,
} from "@shared/sfSchedule";
import {
  evaluateAnnouncementUrgency,
  evaluateCalendarEventUrgency,
  evaluateRenewalDateCell,
  extractDatesFromMessageText,
  formatShortHumanDate,
} from "@shared/displayUrgency";
import { useToast } from "@/hooks/use-toast";
import { useWebSocket, type RawWsMessage } from "@/hooks/useWebSocket";

interface Vehicle {
  vehicleId: string;
  name: string;
  color: string | null;
  homeLocationId: number | null;
  createdAt: string;
}

interface CustomLocation {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  icon: string | null;
  color: string | null;
  description: string | null;
}

interface MapHomeAssignment {
  locationId: number;
  location: CustomLocation;
}

const iconOptions = [
  { value: "marker", label: "Marker", icon: MapPin },
  { value: "home", label: "Home Base", icon: Home },
  { value: "warehouse", label: "Warehouse", icon: Warehouse },
  { value: "building", label: "Building", icon: Building },
  { value: "star", label: "Star", icon: Star },
  { value: "flag", label: "Flag", icon: Flag },
];

export default function Admin() {
  const { officeTheme, setOfficeTheme } = useOfficeTheme();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [liveVehicles, setLiveVehicles] = useState<any[]>([]);
  const [customLocations, setCustomLocations] = useState<CustomLocation[]>([]);
  const [mapHomeLocations, setMapHomeLocations] = useState<Record<string, MapHomeAssignment | null>>({
    map: null,
    "regional-sf": null,
  });
  const [displayState, setDisplayState] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [savingSchedules, setSavingSchedules] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [refreshingFeeds, setRefreshingFeeds] = useState(false);
  const { toast } = useToast();

  // New announcement form
  const [newAuthor, setNewAuthor] = useState("Jackie");
  const [newMessageText, setNewMessageText] = useState("");
  const [newMsgPriority, setNewMsgPriority] = useState<"normal" | "important" | "urgent">("important");
  const [newMsgEventDate, setNewMsgEventDate] = useState("");
  const [newMsgEventLabel, setNewMsgEventLabel] = useState("");
  const [newMsgAutoArchive, setNewMsgAutoArchive] = useState(true);
  const [replaceExistingMsg, setReplaceExistingMsg] = useState(false);

  // New calendar event form
  const [newCalTitle, setNewCalTitle] = useState("");
  const [newCalDate, setNewCalDate] = useState("");
  const [newCalTime, setNewCalTime] = useState("All Day");
  const [newCalColor, setNewCalColor] = useState("#E59A23");

  // Active shift preset brush for SF Schedule quick-fill (`null` = Dropdown Mode; `""` = Clear/Eraser; string = shift preset)
  const [shiftBrush, setShiftBrush] = useState<string | null>(null);
  const [isDraggingSfBrush, setIsDraggingSfBrush] = useState(false);

  // Display Fleet, Groups & Watchdog Modals
  const [selectedGroupFilter, setSelectedGroupFilter] = useState<string>("all");
  const [addDisplayOpen, setAddDisplayOpen] = useState(false);
  const [newDispName, setNewDispName] = useState("");
  const [newDispGroup, setNewDispGroup] = useState("grp-sf-office");
  const [newDispLocation, setNewDispLocation] = useState("");
  const [newDispPreset, setNewDispPreset] = useState<"55-4k" | "40-4k-warehouse" | "1080p">("55-4k");

  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<any>(null);
  const [groupNameInput, setGroupNameInput] = useState("");
  const [groupColorInput, setGroupColorInput] = useState("#38bdf8");
  const [groupDescInput, setGroupDescInput] = useState("");

  const [piAgentModalUnit, setPiAgentModalUnit] = useState<any>(null);
  const [mapAreaModalUnit, setMapAreaModalUnit] = useState<any>(null);
  const [renamingUnitId, setRenamingUnitId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState<string>("");
  const [expandedDisplayUnitId, setExpandedDisplayUnitId] = useState<string | null>(null);
  const [companyPowerScheduleExpanded, setCompanyPowerScheduleExpanded] = useState<boolean>(false);
  const [deleteDisplayTarget, setDeleteDisplayTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [deletingDisplay, setDeletingDisplay] = useState<boolean>(false);

  // Existing Fleet / Location Dialog states
  const [editVehicle, setEditVehicle] = useState<Vehicle | null>(null);
  const [vehicleName, setVehicleName] = useState("");
  const [vehicleColor, setVehicleColor] = useState("#3b82f6");
  const [vehicleHomeLocationId, setVehicleHomeLocationId] = useState("none");
  const [savingVehicle, setSavingVehicle] = useState(false);

  const [locationDialogOpen, setLocationDialogOpen] = useState(false);
  const [editLocation, setEditLocation] = useState<CustomLocation | null>(null);
  const [locationName, setLocationName] = useState("");
  const [locationLat, setLocationLat] = useState("");
  const [locationLon, setLocationLon] = useState("");
  const [locationIcon, setLocationIcon] = useState("marker");
  const [locationColor, setLocationColor] = useState("#ef4444");
  const [locationDescription, setLocationDescription] = useState("");
  const [savingLocation, setSavingLocation] = useState(false);
  const [savingMapHome, setSavingMapHome] = useState<string | null>(null);

  const [deleteVehicleId, setDeleteVehicleId] = useState<string | null>(null);
  const [deleteLocationId, setDeleteLocationId] = useState<number | null>(null);

  // Security, TV Pairing, Token Rotation & Staff User Management states
  const { user: currentUser, scope, logout } = useAuth();
  const isTechnicalAdmin = scope === "admin";
  const [previewStaffMode, setPreviewStaffMode] = useState(false);
  const showTechnicalControls = isTechnicalAdmin && !previewStaffMode;
  const [activeAdminTab, setActiveAdminTab] = useState<string>("truck-schedule");
  const [editScreenRequest, setEditScreenRequest] = useState<{
    screenId: string;
    nonce: number;
  } | null>(null);
  const handleJumpToEditScreen = useCallback((screenId: string) => {
    setEditScreenRequest({ screenId, nonce: Date.now() });
    setActiveAdminTab("screen-studio");
  }, []);
  const [ownPasswordDialogOpen, setOwnPasswordDialogOpen] = useState(false);
  const [routeTerritoriesDialogOpen, setRouteTerritoriesDialogOpen] = useState(false);

  const [, setLocation] = useLocation();
  const [staffUsers, setStaffUsers] = useState<any[]>([]);
  const [pairingTargetMap, setPairingTargetMap] = useState<Record<string, string>>({});
  const [pairingNewNameMap, setPairingNewNameMap] = useState<Record<string, string>>({});
  const [pairingGroupMap, setPairingGroupMap] = useState<Record<string, string>>({});
  const [revealedTokens, setRevealedTokens] = useState<Record<string, boolean>>({});
  const [showWebhookKey, setShowWebhookKey] = useState(false);
  const [showEmbedToken, setShowEmbedToken] = useState(false);

  const [newUsername, setNewUsername] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState<"admin" | "staff" | "viewer">("staff");
  const [creatingUser, setCreatingUser] = useState(false);

  useEffect(() => {
    if (!showTechnicalControls && (activeAdminTab === "displays" || activeAdminTab === "security")) {
      setActiveAdminTab("announcements");
    }
  }, [showTechnicalControls, activeAdminTab]);

  const [resetPwUser, setResetPwUser] = useState<any | null>(null);
  const [resetPwValue, setResetPwValue] = useState("");
  const [savingResetPw, setSavingResetPw] = useState(false);

  const [ownCurrentPw, setOwnCurrentPw] = useState("");
  const [ownNewPw, setOwnNewPw] = useState("");
  const [savingOwnPw, setSavingOwnPw] = useState(false);

  // Motive API Poller & Tile Cache Diagnostics state
  const [pollDiagnostics, setPollDiagnostics] = useState<{
    apiKeyConfigured: boolean;
    tileCache?: { tileCount: number; sizeBytes: number; maxBytes: number };
    results: Array<{
      timestamp: string;
      type: "vehicles" | "assets";
      success: boolean;
      vehicleCount?: number;
      error?: string;
    }>;
  }>({ apiKeyConfigured: false, results: [] });
  const [pollingMotive, setPollingMotive] = useState(false);
  const [showPollLog, setShowPollLog] = useState(false);
  const [localDemoSyncAvailable, setLocalDemoSyncAvailable] = useState(false);
  const [syncingDemoGps, setSyncingDemoGps] = useState(false);
  const [lastDemoGpsSyncAt, setLastDemoGpsSyncAt] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [vehiclesRes, liveVehRes, locationsRes, mapHomeRes, displayRes, demoRes, usersRes, pollRes] = await Promise.all([
        fetch("/api/vehicles/metadata"),
        fetch("/api/vehicles"),
        fetch("/api/custom-locations"),
        fetch("/api/map-home-locations"),
        fetch("/api/display/state"),
        fetch("/api/demo/status"),
        isTechnicalAdmin ? fetch("/api/auth/users") : Promise.resolve(null),
        isTechnicalAdmin ? fetch("/api/poll/results") : Promise.resolve(null),
      ]);

      if (vehiclesRes.ok) setVehicles(await vehiclesRes.json());
      if (liveVehRes.ok) {
        const lv = await liveVehRes.json();
        if (Array.isArray(lv)) setLiveVehicles(lv);
      }
      if (locationsRes.ok) setCustomLocations(await locationsRes.json());
      if (mapHomeRes.ok) setMapHomeLocations(await mapHomeRes.json());
      if (displayRes.ok) setDisplayState(await displayRes.json());
      if (demoRes.ok) {
        const dJson = await demoRes.json().catch(() => ({}));
        setLocalDemoSyncAvailable(Boolean(dJson?.localDemoSyncAvailable));
      }
      if (usersRes && usersRes.ok) {
        const uData = await usersRes.json();
        if (Array.isArray(uData.users)) setStaffUsers(uData.users);
      }
      if (pollRes && pollRes.ok) {
        const pData = await pollRes.json();
        setPollDiagnostics({
          apiKeyConfigured: Boolean(pData.apiKeyConfigured),
          tileCache: pData.tileCache,
          results: Array.isArray(pData.results) ? pData.results : [],
        });
      }
    } catch (error) {
      console.error("Error loading data:", error);
      toast({ title: "Error loading admin data", variant: "destructive" });
    }
    setLoading(false);
  }, [toast, isTechnicalAdmin]);

  const handleSyncDemoLiveVehicles = async () => {
    setSyncingDemoGps(true);
    try {
      const res = await fetch("/api/demo/sync-live-vehicles", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Failed pulling live GPS locations");
      }
      if (Array.isArray(data.vehicles)) {
        setLiveVehicles(data.vehicles);
      }
      if (data.state) {
        setDisplayState(data.state);
      }
      const metaRes = await fetch("/api/vehicles/metadata");
      if (metaRes.ok) setVehicles(await metaRes.json());

      const stamp = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
      setLastDemoGpsSyncAt(stamp);
      toast({
        title: `Updated ${data.vehicleCount || 0} Vehicle Locations`,
        description: `Pulled latest live Motive GPS positions & pushed to all TVs (${stamp})`,
      });
    } catch (err: any) {
      toast({
        title: "GPS Sync Failed",
        description: err?.message || "Could not reach live vehicle feed",
        variant: "destructive",
      });
    } finally {
      setSyncingDemoGps(false);
    }
  };

  const handleTriggerMotivePoll = async () => {
    setPollingMotive(true);
    try {
      const res = await fetch("/api/poll/trigger", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed triggering Motive poll");
      }
      const [pollRes, vehiclesRes] = await Promise.all([
        fetch("/api/poll/results"),
        fetch("/api/vehicles/metadata"),
      ]);
      if (pollRes.ok) {
        const pData = await pollRes.json();
        setPollDiagnostics({
          apiKeyConfigured: Boolean(pData.apiKeyConfigured),
          tileCache: pData.tileCache,
          results: Array.isArray(pData.results) ? pData.results : [],
        });
      }
      if (vehiclesRes.ok) {
        setVehicles(await vehiclesRes.json());
      }
      toast({
        title: pollDiagnostics.apiKeyConfigured
          ? "Polled Motive API for latest GPS coordinates"
          : "Poll triggered (MOTIVE_API_KEY not set — running from local DB cache)",
      });
    } catch (err: any) {
      toast({ title: err.message || "Error triggering Motive poll", variant: "destructive" });
    }
    setPollingMotive(false);
  };

  const handleClearPollHistory = async () => {
    try {
      const res = await fetch("/api/poll/results", { method: "DELETE" });
      if (res.ok) {
        setPollDiagnostics((prev) => ({ ...prev, results: [] }));
        toast({ title: "Cleared recent Motive poll log" });
      }
    } catch {
      toast({ title: "Error clearing poll log", variant: "destructive" });
    }
  };

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Listen for live GPS updates, CRM webhook arrivals, TV pairing requests & TV Watchdog health telemetry while Admin is open
  useWebSocket(
    (locUpdate) => {
      if (!locUpdate?.id) return;
      setLiveVehicles((prev) => {
        const idx = prev.findIndex((v) => v.id === locUpdate.id);
        if (idx === -1) return [...prev, locUpdate];
        const next = [...prev];
        next[idx] = { ...next[idx], ...locUpdate };
        return next;
      });
    },
    (msg: RawWsMessage) => {
    if (msg.type === "display_message_toast" && msg.payload) {
      toast({
        title: `New Announcement (${msg.payload.author})`,
        description: msg.payload.message,
      });
      fetch("/api/display/state")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && setDisplayState(d))
        .catch(() => {});
    } else if (msg.type === "display_pairing_update" && msg.payload) {
      const incoming = msg.payload.pendingPairings || [];
      setDisplayState((prev: any) =>
        prev ? { ...prev, pendingPairings: incoming } : prev,
      );
      if (incoming.length > 0) {
        toast({
          title: `📺 TV Pairing Requested (${incoming[0].code})`,
          description: "Approve or assign the TV display from the banner above.",
        });
      }
    } else if (msg.type === "display_fleet_telemetry" && msg.payload?.displayUnits) {
      setDisplayState((prev: any) =>
        prev
          ? {
              ...prev,
              displayUnits: msg.payload.displayUnits,
              serverTime: msg.payload.serverTime,
            }
          : prev,
      );
    } else if (msg.type === "display_state_update" && msg.payload) {
      setDisplayState(msg.payload);
    } else if (msg.type === "display_health_alert" && msg.payload) {
      const alert = msg.payload;
      toast({
        title:
          alert.severity === "recovered"
            ? `✅ Display Recovered: ${alert.displayName}`
            : `⚠️ Display Alert: ${alert.displayName}`,
        description: alert.message,
        variant: alert.severity === "critical" ? "destructive" : "default",
      });
    }
  });

  // =========================================================================
  // SECURITY, TV PAIRING & STAFF USER HANDLERS
  // =========================================================================
  const handleApprovePairing = async (
    code: string,
    displayId: string,
    newDisplayName?: string,
    groupId?: string,
  ) => {
    try {
      const res = await fetch("/api/display/pair/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, displayId, newDisplayName, groupId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || "Approval failed");
      if (data.state) {
        setDisplayState(data.state);
      } else {
        setDisplayState((prev: any) =>
          prev ? { ...prev, pendingPairings: data.pendingPairings || [] } : prev,
        );
      }
      if (data.assignedDisplayId) {
        setExpandedDisplayUnitId(data.assignedDisplayId);
      }
      toast({
        title: data.createdUnit
          ? `✅ Created & paired new screen "${data.assignedDisplayName}" (?display=${data.assignedDisplayId})!`
          : `✅ Paired TV (${code}) → ${data.assignedDisplayName || displayId}!`,
      });
    } catch (err: any) {
      toast({ title: err.message || "Error approving TV", variant: "destructive" });
    }
  };

  const handleRejectPairing = async (code: string) => {
    try {
      const res = await fetch("/api/display/pair/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.pendingPairings) {
        setDisplayState((prev: any) =>
          prev ? { ...prev, pendingPairings: data.pendingPairings } : prev,
        );
      }
      toast({ title: `Dismissed pairing code ${code}` });
    } catch {
      toast({ title: "Error dismissing pairing code", variant: "destructive" });
    }
  };

  const handleRotateUnitToken = async (unitId: string, unitName: string) => {
    if (
      !window.confirm(
        `Rotate device token for "${unitName}"? Any browser or Pi script using the old token will need to re-pair or update its token.`,
      )
    ) {
      return;
    }
    try {
      const res = await fetch(`/api/display/units/${encodeURIComponent(unitId)}/rotate-token`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed rotating token");
      if (data.state) setDisplayState(data.state);
      setRevealedTokens((prev) => ({ ...prev, [unitId]: true }));
      toast({ title: `Rotated secret token for "${unitName}"` });
    } catch (err: any) {
      toast({ title: err.message || "Error rotating token", variant: "destructive" });
    }
  };

  const handleRotateWebhookKey = async () => {
    if (
      !window.confirm(
        "Rotate the CRM Webhook API Key? Remember to update the X-API-Key header in your CRM software afterward.",
      )
    ) {
      return;
    }
    try {
      const res = await fetch("/api/display/security/rotate-webhook-key", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed rotating API key");
      if (data.state) setDisplayState(data.state);
      setShowWebhookKey(true);
      toast({ title: "Generated new CRM Webhook X-API-Key!" });
    } catch (err: any) {
      toast({ title: err.message || "Error rotating API key", variant: "destructive" });
    }
  };

  const handleResetToCleanBaseline = async () => {
    if (
      !window.confirm(
        "Reset Display & Portal State to Clean Production Baseline?\n\n• Removes all TV display units, custom screens, announcements, calendar events, and hot shots\n• Resets weekly schedules to a clean current week while keeping your driver/staff rosters & SD route territories\n• Existing Motive GPS vehicles and custom map locations are preserved.",
      )
    ) {
      return;
    }
    try {
      const res = await fetch("/api/display/reset-clean", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed resetting display state");
      if (data.state) setDisplayState(data.state);
      setExpandedDisplayUnitId(null);
      toast({
        title: "Reset to Clean Production Baseline",
        description: "Ready to add your TV displays, custom screens, and weekly schedules.",
      });
    } catch (err: any) {
      toast({ title: err.message || "Error resetting display state", variant: "destructive" });
    }
  };

  const handleUpdateEmbedSecurity = async (embedEnabled: boolean, rotateToken = false) => {
    try {
      const res = await fetch("/api/display/security/embed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ embedEnabled, rotateToken }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed updating embed settings");
      if (data.state) setDisplayState(data.state);
      if (rotateToken) setShowEmbedToken(true);
      toast({
        title: rotateToken
          ? "Rotated Phased DAKboard Embed Token!"
          : embedEnabled
            ? "Phased DAKboard Embed Access ENABLED"
            : "Phased DAKboard Embed Access DISABLED (Locked)",
      });
    } catch (err: any) {
      toast({ title: err.message || "Error updating embed access", variant: "destructive" });
    }
  };

  const handleCreateStaffUser = async () => {
    if (!newUsername.trim() || newUserPassword.length < 8) {
      toast({
        title: "Username and a password of at least 8 characters are required",
        variant: "destructive",
      });
      return;
    }
    setCreatingUser(true);
    try {
      const res = await fetch("/api/auth/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: newUsername.trim(),
          displayName: newDisplayName.trim() || newUsername.trim(),
          password: newUserPassword,
          role: newUserRole,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed creating user");
      setStaffUsers(data.users || []);
      setNewUsername("");
      setNewDisplayName("");
      setNewUserPassword("");
      setNewUserRole("staff");
      toast({ title: `Created ${data.user?.role?.toUpperCase()} account "${data.user?.username}"` });
    } catch (err: any) {
      toast({ title: err.message || "Error creating account", variant: "destructive" });
    }
    setCreatingUser(false);
  };

  const handleChangeUserRole = async (u: any, nextRole: "admin" | "staff" | "viewer") => {
    try {
      const res = await fetch(`/api/auth/users/${encodeURIComponent(u.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: nextRole }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed updating role");
      setStaffUsers(data.users || []);
      toast({ title: `Updated ${u.username} → ${nextRole.toUpperCase()}` });
    } catch (err: any) {
      toast({ title: err.message || "Error updating role", variant: "destructive" });
    }
  };

  const handleSaveResetUserPassword = async () => {
    if (!resetPwUser || resetPwValue.length < 8) {
      toast({ title: "Password must be at least 8 characters", variant: "destructive" });
      return;
    }
    setSavingResetPw(true);
    try {
      const res = await fetch(`/api/auth/users/${encodeURIComponent(resetPwUser.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: resetPwValue }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed resetting password");
      setStaffUsers(data.users || []);
      toast({ title: `Password reset for "${resetPwUser.username}"` });
      setResetPwUser(null);
      setResetPwValue("");
    } catch (err: any) {
      toast({ title: err.message || "Error resetting password", variant: "destructive" });
    }
    setSavingResetPw(false);
  };

  const handleDeleteStaffUser = async (u: any) => {
    if (!window.confirm(`Delete user account "${u.username}"?`)) return;
    try {
      const res = await fetch(`/api/auth/users/${encodeURIComponent(u.id)}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed deleting user");
      setStaffUsers(data.users || []);
      toast({ title: `Deleted user "${u.username}"` });
    } catch (err: any) {
      toast({ title: err.message || "Error deleting user", variant: "destructive" });
    }
  };

  const handleChangeOwnPassword = async () => {
    if (!ownCurrentPw || ownNewPw.length < 8) {
      toast({
        title: "Enter your current password and a new password (8+ chars)",
        variant: "destructive",
      });
      return;
    }
    setSavingOwnPw(true);
    try {
      const res = await fetch("/api/auth/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: ownCurrentPw, newPassword: ownNewPw }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || "Password change failed");
      setOwnCurrentPw("");
      setOwnNewPw("");
      setOwnPasswordDialogOpen(false);
      toast({ title: "Your password has been updated!" });
    } catch (err: any) {
      toast({ title: err.message || "Error changing password", variant: "destructive" });
    }
    setSavingOwnPw(false);
  };

  // =========================================================================
  // DISPLAY DASHBOARD & SCHEDULES HANDLERS
  // =========================================================================
  const handlePostAnnouncement = async () => {
    if (!newMessageText.trim()) return;
    try {
      const res = await fetch("/api/display/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          author: newAuthor.trim() || "Admin",
          message: newMessageText.trim(),
          priority: newMsgPriority,
          eventDateISO: newMsgEventDate || undefined,
          eventLabel: newMsgEventLabel.trim() || undefined,
          autoArchive: newMsgAutoArchive,
          replace: replaceExistingMsg,
        }),
      });
      if (!res.ok) throw new Error("Failed posting announcement");
      setNewMessageText("");
      setNewMsgEventDate("");
      setNewMsgEventLabel("");
      setNewMsgPriority("important");
      const updated = await fetch("/api/display/state").then((r) => r.json());
      setDisplayState(updated);
      toast({ title: "Announcement broadcast to all TV displays!" });
    } catch {
      toast({ title: "Failed to publish announcement", variant: "destructive" });
    }
  };

  const handlePatchMessage = async (id: string, patch: Record<string, any>, successMsg?: string) => {
    try {
      const res = await fetch(`/api/display/messages/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error("Failed updating message");
      const updated = await fetch("/api/display/state").then((r) => r.json());
      setDisplayState(updated);
      if (successMsg) toast({ title: successMsg });
    } catch {
      toast({ title: "Failed updating message", variant: "destructive" });
    }
  };

  const handleToggleMessage = async (msg: any) => {
    await handlePatchMessage(msg.id, { active: !msg.active });
  };

  const handleDeleteMessage = async (id: string) => {
    try {
      await fetch(`/api/display/messages/${encodeURIComponent(id)}`, { method: "DELETE" });
      const updated = await fetch("/api/display/state").then((r) => r.json());
      setDisplayState(updated);
      toast({ title: "Announcement deleted" });
    } catch {
      toast({ title: "Failed deleting message", variant: "destructive" });
    }
  };

  const saveSchedulesPayload = async (partial: any, successTitle = "Schedules saved & pushed to TVs") => {
    setSavingSchedules(true);
    try {
      const res = await fetch("/api/display/schedules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(partial),
      });
      if (!res.ok) throw new Error("Save failed");
      const data = await res.json();
      if (data.state) setDisplayState(data.state);
      toast({ title: successTitle });
    } catch {
      toast({ title: "Error saving schedule changes", variant: "destructive" });
    }
    setSavingSchedules(false);
  };

  // Monthly Truck Schedule Navigator & Route Dropdown Manager state
  const liveMondayIso = useMemo(() => getWorkweekMondayIso(new Date(), true), []);
  const [selectedMondayIso, setSelectedMondayIso] = useState<string>(() =>
    getWorkweekMondayIso(new Date(), true),
  );
  const [viewYear, setViewYear] = useState<number>(() => parseIsoDate(liveMondayIso).getFullYear());
  const [viewMonth0, setViewMonth0] = useState<number>(() => parseIsoDate(liveMondayIso).getMonth());
  const [routeManagerOpen, setRouteManagerOpen] = useState(false);
  const [routeManagerTargetDriver, setRouteManagerTargetDriver] = useState<string>("__ALL__");
  const [newRouteInput, setNewRouteInput] = useState("");

  const normalizedTruckSchedule = useMemo(
    () => normalizeTruckScheduleState(displayState?.truckSchedule),
    [displayState?.truckSchedule],
  );

  const monthMondays = useMemo(
    () => getMondaysForMonth(viewYear, viewMonth0),
    [viewYear, viewMonth0],
  );

  const selectedTruckWeek: TruckWeekBlock = useMemo(() => {
    const existing = normalizedTruckSchedule.weeks[selectedMondayIso];
    if (existing) return existing;
    return createBlankWeekBlock(selectedMondayIso, normalizedTruckSchedule.driverRoster);
  }, [normalizedTruckSchedule, selectedMondayIso]);

  const updateSelectedTruckWeek = useCallback(
    (nextWeekObj: TruckWeekBlock, syncDriverRoster = false) => {
      setDisplayState((prev: any) => {
        const currentNorm = normalizeTruckScheduleState(prev?.truckSchedule);
        const nextWeeks = {
          ...currentNorm.weeks,
          [selectedMondayIso]: {
            ...nextWeekObj,
            weekStartISO: selectedMondayIso,
          },
        };
        const nextRoster = syncDriverRoster
          ? nextWeekObj.rows.map((r) => ({
              driver: r.driver,
              vehicleKey: r.vehicleKey,
              color: r.color || "#38bdf8",
            }))
          : currentNorm.driverRoster;

        return {
          ...prev,
          truckSchedule: normalizeTruckScheduleState({
            ...currentNorm,
            weeks: nextWeeks,
            driverRoster: nextRoster,
          }),
        };
      });
    },
    [selectedMondayIso],
  );

  const handleAddSavedRoute = useCallback(
    (routeText: string, assignToDriver?: string) => {
      const clean = routeText.trim();
      if (!clean) return;
      setDisplayState((prev: any) => {
        const currentNorm = normalizeTruckScheduleState(prev?.truckSchedule);
        const specialTop = ["OFF", "PTO", "WHS", "SF"];
        const existsInPool = currentNorm.routeOptions.some(
          (r) => r.toLowerCase() === clean.toLowerCase(),
        );
        const canonical =
          currentNorm.routeOptions.find((r) => r.toLowerCase() === clean.toLowerCase()) || clean;

        let nextRouteOptions = currentNorm.routeOptions;
        if (!existsInPool) {
          const combined = [...currentNorm.routeOptions, canonical];
          const top = specialTop.filter((s) => combined.includes(s));
          const rest = combined
            .filter((x) => !specialTop.includes(x))
            .sort((a, b) => a.localeCompare(b));
          nextRouteOptions = [...top, ...rest];
        }

        const nextDriverRoutes = { ...currentNorm.driverRoutes };
        if (
          assignToDriver &&
          assignToDriver !== "__ALL__" &&
          canonical.toUpperCase() !== "OFF" &&
          canonical.toUpperCase() !== "PTO"
        ) {
          const existingList = nextDriverRoutes[assignToDriver] || [];
          if (!existingList.includes(canonical)) {
            nextDriverRoutes[assignToDriver] = [...existingList, canonical].sort((a, b) =>
              a.localeCompare(b),
            );
          }
        }

        return {
          ...prev,
          truckSchedule: {
            ...currentNorm,
            routeOptions: nextRouteOptions,
            driverRoutes: nextDriverRoutes,
          },
        };
      });
      toast({
        title:
          assignToDriver && assignToDriver !== "__ALL__"
            ? `Assigned "${clean}" to ${assignToDriver}`
            : `Added "${clean}" to Master Route Pool`,
      });
    },
    [toast],
  );

  const handleToggleDriverRoute = useCallback((driverName: string, routeName: string) => {
    if (!driverName || driverName === "__ALL__") return;
    setDisplayState((prev: any) => {
      const currentNorm = normalizeTruckScheduleState(prev?.truckSchedule);
      const currentList = currentNorm.driverRoutes[driverName] || [];
      const hasIt = currentList.includes(routeName);
      const nextList = hasIt
        ? currentList.filter((r) => r !== routeName)
        : [...currentList, routeName].sort((a, b) => a.localeCompare(b));
      return {
        ...prev,
        truckSchedule: {
          ...currentNorm,
          driverRoutes: {
            ...currentNorm.driverRoutes,
            [driverName]: nextList,
          },
        },
      };
    });
  }, []);

  const handleRemoveSavedRoute = useCallback((routeToDelete: string) => {
    setDisplayState((prev: any) => {
      const currentNorm = normalizeTruckScheduleState(prev?.truckSchedule);
      const cleanedDriverRoutes: Record<string, string[]> = {};
      for (const [drv, list] of Object.entries(currentNorm.driverRoutes)) {
        cleanedDriverRoutes[drv] = list.filter((r) => r !== routeToDelete);
      }
      return {
        ...prev,
        truckSchedule: {
          ...currentNorm,
          routeOptions: currentNorm.routeOptions.filter((r) => r !== routeToDelete),
          driverRoutes: cleanedDriverRoutes,
        },
      };
    });
  }, []);

  const handleSelectMonthYear = (nextYear: number, nextMonth0: number) => {
    setViewYear(nextYear);
    setViewMonth0(nextMonth0);
    const mondays = getMondaysForMonth(nextYear, nextMonth0);
    if (mondays.length > 0 && !mondays.includes(selectedMondayIso)) {
      setSelectedMondayIso(mondays.includes(liveMondayIso) ? liveMondayIso : mondays[0]);
    }
  };

  const handleShiftMonth = (deltaMonths: number) => {
    const dt = new Date(viewYear, viewMonth0 + deltaMonths, 1, 12, 0, 0);
    handleSelectMonthYear(dt.getFullYear(), dt.getMonth());
  };

  const handleStepWeek = (deltaWeeks: number) => {
    const nextIso = shiftMondayIso(selectedMondayIso, deltaWeeks);
    const dt = parseIsoDate(nextIso);
    setSelectedMondayIso(nextIso);
    setViewYear(dt.getFullYear());
    setViewMonth0(dt.getMonth());
  };

  const handleJumpToCurrentWeek = () => {
    const dt = parseIsoDate(liveMondayIso);
    setSelectedMondayIso(liveMondayIso);
    setViewYear(dt.getFullYear());
    setViewMonth0(dt.getMonth());
  };

  const handleCopyPreviousWeekIntoSelected = () => {
    const prevIso = shiftMondayIso(selectedMondayIso, -1);
    const prevWeek = normalizedTruckSchedule.weeks[prevIso];
    if (!prevWeek || !prevWeek.rows?.length) {
      toast({
        title: `No saved routes found in previous week (${buildShortWeekRange(prevIso)})`,
        variant: "destructive",
      });
      return;
    }
    const blankTarget = createBlankWeekBlock(selectedMondayIso, normalizedTruckSchedule.driverRoster);
    const copiedWeek: TruckWeekBlock = {
      ...blankTarget,
      notes: selectedTruckWeek.notes || prevWeek.notes || "Have a great week!",
      rows: prevWeek.rows.map((r) => ({
        driver: r.driver,
        vehicleKey: r.vehicleKey,
        color: r.color || "#38bdf8",
        days: [...(r.days || ["", "", "", "", ""])].slice(0, 5),
      })),
    };
    updateSelectedTruckWeek(copiedWeek, true);
    toast({
      title: `Copied routes from ${buildShortWeekRange(prevIso)} → ${buildShortWeekRange(selectedMondayIso)}`,
    });
  };

  const handleClearSelectedWeekRoutes = () => {
    if (
      countAssignedCells(selectedTruckWeek) > 0 &&
      !window.confirm(`Clear all Monday–Friday routes for ${selectedTruckWeek.label}?`)
    ) {
      return;
    }
    updateSelectedTruckWeek({
      ...selectedTruckWeek,
      rows: selectedTruckWeek.rows.map((r) => ({
        ...r,
        days: ["", "", "", "", ""],
      })),
    });
    toast({ title: `Cleared routes for ${buildShortWeekRange(selectedMondayIso)}` });
  };

  // =========================================================================
  // MONTHLY SIOUX FALLS (SF) TEAM SCHEDULE, COVERAGE & SHIFT PICKER HANDLERS
  // =========================================================================
  const sfLiveMondayIso = useMemo(() => getSfWorkweekMondayIso(new Date(), true), []);
  const [sfSelectedMondayIso, setSfSelectedMondayIso] = useState<string>(() =>
    getSfWorkweekMondayIso(new Date(), true),
  );
  const [sfViewYear, setSfViewYear] = useState<number>(() =>
    parseIsoDate(sfLiveMondayIso).getFullYear(),
  );
  const [sfViewMonth0, setSfViewMonth0] = useState<number>(() =>
    parseIsoDate(sfLiveMondayIso).getMonth(),
  );
  const [sfShiftManagerOpen, setSfShiftManagerOpen] = useState(false);
  const [sfShiftManagerTargetMember, setSfShiftManagerTargetMember] = useState<string>("__ALL__");
  const [newSfShiftInput, setNewSfShiftInput] = useState("");

  useEffect(() => {
    if (!isDraggingSfBrush) return;
    const stopDrag = () => setIsDraggingSfBrush(false);
    window.addEventListener("mouseup", stopDrag);
    return () => window.removeEventListener("mouseup", stopDrag);
  }, [isDraggingSfBrush]);

  useEffect(() => {
    if (shiftBrush === null) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShiftBrush(null);
        setIsDraggingSfBrush(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [shiftBrush]);

  const normalizedSfSchedule = useMemo(
    () => normalizeSfScheduleState(displayState?.sfSchedule),
    [displayState?.sfSchedule],
  );

  const sfMonthMondays = useMemo(
    () => getMondaysForMonth(sfViewYear, sfViewMonth0),
    [sfViewYear, sfViewMonth0],
  );

  const selectedSfWeek: SfWeekBlock = useMemo(() => {
    const existing = normalizedSfSchedule.weeks[sfSelectedMondayIso];
    if (existing) return existing;
    return createBlankSfWeekBlock(sfSelectedMondayIso, normalizedSfSchedule.memberRoster);
  }, [normalizedSfSchedule, sfSelectedMondayIso]);

  const sfWeekCoverage = useMemo(
    () => evaluateSfWeekCoverage(selectedSfWeek),
    [selectedSfWeek],
  );

  const updateSelectedSfWeek = useCallback(
    (nextWeekObj: SfWeekBlock, syncMemberRoster = false) => {
      setDisplayState((prev: any) => {
        const currentNorm = normalizeSfScheduleState(prev?.sfSchedule);
        const nextWeeks = {
          ...currentNorm.weeks,
          [sfSelectedMondayIso]: {
            ...nextWeekObj,
            weekStartISO: sfSelectedMondayIso,
          },
        };
        const nextRoster = syncMemberRoster
          ? nextWeekObj.rows.map((r) => ({
              name: r.name,
              color: r.color || "#93c5fd",
            }))
          : currentNorm.memberRoster;

        return {
          ...prev,
          sfSchedule: normalizeSfScheduleState({
            ...currentNorm,
            weeks: nextWeeks,
            memberRoster: nextRoster,
          }),
        };
      });
    },
    [sfSelectedMondayIso],
  );

  const handleAddSavedSfShift = useCallback(
    (shiftText: string, assignToMember?: string) => {
      const clean = shiftText.trim();
      if (!clean) return;
      setDisplayState((prev: any) => {
        const currentNorm = normalizeSfScheduleState(prev?.sfSchedule);
        const priorityTop = [
          "7:15-4:15",
          "8:00-5:00",
          "8:30-5:30",
          "9:00-6:00",
          "Bomgaars",
          "OFF",
          "PTO",
        ];
        const existsInPool = currentNorm.shiftOptions.some(
          (s) => s.toLowerCase() === clean.toLowerCase(),
        );
        const canonical =
          currentNorm.shiftOptions.find((s) => s.toLowerCase() === clean.toLowerCase()) || clean;

        let nextShiftOptions = currentNorm.shiftOptions;
        if (!existsInPool) {
          const combined = [...currentNorm.shiftOptions, canonical];
          const top = priorityTop.filter((p) =>
            combined.some((x) => x.toLowerCase() === p.toLowerCase()),
          );
          const rest = combined
            .filter((x) => !priorityTop.some((p) => p.toLowerCase() === x.toLowerCase()))
            .sort((a, b) => a.localeCompare(b));
          nextShiftOptions = [...top, ...rest];
        }

        const nextMemberShifts = { ...currentNorm.memberShifts };
        if (
          assignToMember &&
          assignToMember !== "__ALL__" &&
          canonical.toUpperCase() !== "OFF" &&
          canonical.toUpperCase() !== "PTO"
        ) {
          const existingList = nextMemberShifts[assignToMember] || [];
          if (!existingList.includes(canonical)) {
            nextMemberShifts[assignToMember] = [...existingList, canonical];
          }
        }

        return {
          ...prev,
          sfSchedule: {
            ...currentNorm,
            shiftOptions: nextShiftOptions,
            memberShifts: nextMemberShifts,
          },
        };
      });
      toast({
        title:
          assignToMember && assignToMember !== "__ALL__"
            ? `Assigned "${clean}" to ${assignToMember}`
            : `Added "${clean}" to SF Shift Presets`,
      });
    },
    [toast],
  );

  const handleToggleMemberSfShift = useCallback((memberName: string, shiftName: string) => {
    if (!memberName || memberName === "__ALL__") return;
    setDisplayState((prev: any) => {
      const currentNorm = normalizeSfScheduleState(prev?.sfSchedule);
      const currentList = currentNorm.memberShifts[memberName] || [];
      const hasIt = currentList.includes(shiftName);
      const nextList = hasIt
        ? currentList.filter((s) => s !== shiftName)
        : [...currentList, shiftName];
      return {
        ...prev,
        sfSchedule: {
          ...currentNorm,
          memberShifts: {
            ...currentNorm.memberShifts,
            [memberName]: nextList,
          },
        },
      };
    });
  }, []);

  const handleRemoveSavedSfShift = useCallback((shiftToDelete: string) => {
    setDisplayState((prev: any) => {
      const currentNorm = normalizeSfScheduleState(prev?.sfSchedule);
      const cleanedMemberShifts: Record<string, string[]> = {};
      for (const [m, list] of Object.entries(currentNorm.memberShifts)) {
        cleanedMemberShifts[m] = list.filter((s) => s !== shiftToDelete);
      }
      return {
        ...prev,
        sfSchedule: {
          ...currentNorm,
          shiftOptions: currentNorm.shiftOptions.filter((s) => s !== shiftToDelete),
          memberShifts: cleanedMemberShifts,
        },
      };
    });
  }, []);

  const handleSelectSfMonthYear = (nextYear: number, nextMonth0: number) => {
    setSfViewYear(nextYear);
    setSfViewMonth0(nextMonth0);
    const mondays = getMondaysForMonth(nextYear, nextMonth0);
    if (mondays.length > 0 && !mondays.includes(sfSelectedMondayIso)) {
      setSfSelectedMondayIso(mondays.includes(sfLiveMondayIso) ? sfLiveMondayIso : mondays[0]);
    }
  };

  const handleShiftSfMonth = (deltaMonths: number) => {
    const dt = new Date(sfViewYear, sfViewMonth0 + deltaMonths, 1, 12, 0, 0);
    handleSelectSfMonthYear(dt.getFullYear(), dt.getMonth());
  };

  const handleStepSfWeek = (deltaWeeks: number) => {
    const nextIso = shiftMondayIso(sfSelectedMondayIso, deltaWeeks);
    const dt = parseIsoDate(nextIso);
    setSfSelectedMondayIso(nextIso);
    setSfViewYear(dt.getFullYear());
    setSfViewMonth0(dt.getMonth());
  };

  const handleJumpToCurrentSfWeek = () => {
    const dt = parseIsoDate(sfLiveMondayIso);
    setSfSelectedMondayIso(sfLiveMondayIso);
    setSfViewYear(dt.getFullYear());
    setSfViewMonth0(dt.getMonth());
  };

  const handleCopyPrevSfWeekIntoSelected = () => {
    const prevIso = shiftMondayIso(sfSelectedMondayIso, -1);
    const prevWeek = normalizedSfSchedule.weeks[prevIso];
    if (!prevWeek || !prevWeek.rows?.length) {
      toast({
        title: `No saved shifts found in previous week (${buildShortSfWeekRange(prevIso)})`,
        variant: "destructive",
      });
      return;
    }
    const blankTarget = createBlankSfWeekBlock(
      sfSelectedMondayIso,
      normalizedSfSchedule.memberRoster,
    );
    const copiedWeek: SfWeekBlock = {
      ...blankTarget,
      footerNote: selectedSfWeek.footerNote ?? prevWeek.footerNote ?? "Nick Kreger",
      rows: prevWeek.rows.map((r) => ({
        name: r.name,
        color: r.color || "#93c5fd",
        days: Array.from({ length: 6 }, (_, i) => String(r.days?.[i] ?? (i === 5 ? "OFF" : ""))),
      })),
    };
    updateSelectedSfWeek(copiedWeek, true);
    toast({
      title: `Copied shifts from ${buildShortSfWeekRange(prevIso)} → ${buildShortSfWeekRange(sfSelectedMondayIso)}`,
    });
  };

  const handleClearSelectedSfWeek = () => {
    if (
      countSfAssignedCells(selectedSfWeek) > 0 &&
      !window.confirm(`Clear all shifts for ${selectedSfWeek.label}?`)
    ) {
      return;
    }
    updateSelectedSfWeek({
      ...selectedSfWeek,
      rows: selectedSfWeek.rows.map((r) => ({
        ...r,
        days: ["", "", "", "", "", "OFF"],
      })),
    });
    toast({ title: `Cleared shifts for ${buildShortSfWeekRange(sfSelectedMondayIso)}` });
  };

  const handleSaveDisplaySettings = async (overrideSettings?: any, customToastTitle?: string) => {
    const payload = overrideSettings || displayState?.settings;
    if (!payload) return;
    setSavingSettings(true);
    try {
      const res = await fetch("/api/display/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed");
      const data = await res.json().catch(() => null);
      if (data?.state) setDisplayState(data.state);
      toast({ title: customToastTitle || "TV Display settings updated live!" });
    } catch {
      toast({ title: "Error saving display settings", variant: "destructive" });
    }
    setSavingSettings(false);
  };

  const handleUpdateWeatherOverlay = async (
    patch: {
      weatherOverlayMode?: WeatherOverlayMode;
      weatherDemoScenario?: WeatherDemoScenarioId;
    },
    toastMsg?: string,
  ) => {
    const nextSettings = {
      ...(displayState?.settings || {}),
      ...patch,
    };
    setDisplayState((prev: any) =>
      prev ? { ...prev, settings: nextSettings } : prev,
    );
    await handleSaveDisplaySettings(nextSettings, toastMsg);
  };

  const handleRemoteControl = async (
    activePanel: string | undefined,
    targetScope: "all" | "group" | "display" = "all",
    targetId = "all",
    action = "switch_panel",
  ) => {
    try {
      const res = await fetch("/api/display/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activePanel, targetScope, targetId, action }),
      });
      const data = await res.json();
      if (data.state) setDisplayState(data.state);
      const actionLabels: Record<string, string> = {
        reload: "Sent browser reload command",
        tv_on: "Queued Wake TV command (HDMI-CEC + DPMS)",
        tv_standby: "Queued Standby TV command (HDMI-CEC + DPMS)",
        clear_power_override: "Returned TV to automatic power schedule",
        restart_browser: "Queued Chromium restart command",
        reboot_pi: "Queued Raspberry Pi reboot command",
      };
      toast({
        title: actionLabels[action] || `Switched (${targetScope}: ${targetId}) → ${activePanel}`,
      });
    } catch {
      toast({ title: "Remote control command failed", variant: "destructive" });
    }
  };

  const handleCreateDisplayUnit = async () => {
    if (!newDispName.trim()) return;
    const presetConfig =
      newDispPreset === "40-4k-warehouse"
        ? { uiScale: 1.32, leftColumnWidthPct: 48, sfRowsPerPage: 5, highContrast: true }
        : newDispPreset === "1080p"
          ? { uiScale: 0.95, leftColumnWidthPct: 44, sfRowsPerPage: 7, highContrast: false }
          : { uiScale: 1.05, leftColumnWidthPct: 44, sfRowsPerPage: 7, highContrast: false };

    try {
      const res = await fetch("/api/display/units", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newDispName.trim(),
          groupId: newDispGroup,
          locationNote: newDispLocation.trim(),
          ...presetConfig,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setDisplayState(data.state);
      setNewDispName("");
      setNewDispLocation("");
      setAddDisplayOpen(false);
      if (data.unit?.id) {
        setExpandedDisplayUnitId(data.unit.id);
      }
      toast({ title: `Added display "${data.unit.name}" (?display=${data.unit.id})` });
    } catch (err: any) {
      toast({ title: err.message || "Error adding display", variant: "destructive" });
    }
  };

  const handleUpdateDisplayUnit = async (id: string, patch: any, successMsg = "Display updated") => {
    try {
      const res = await fetch(`/api/display/units/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setDisplayState(data.state);
      toast({ title: successMsg });
    } catch (err: any) {
      toast({ title: err.message || "Error updating display", variant: "destructive" });
    }
  };

  const handleDeleteDisplayUnit = (id: string, name: string) => {
    setDeleteDisplayTarget({ id, name });
  };

  const confirmDeleteDisplayUnit = async () => {
    if (!deleteDisplayTarget) return;
    const { id, name } = deleteDisplayTarget;
    setDeletingDisplay(true);
    try {
      const res = await fetch(`/api/display/units/${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setDisplayState(data.state);
      setExpandedDisplayUnitId((prev) => (prev === id ? null : prev));
      setDeleteDisplayTarget(null);
      toast({ title: `Removed TV display "${name}"` });
    } catch (err: any) {
      toast({ title: err.message || "Cannot delete display", variant: "destructive" });
    } finally {
      setDeletingDisplay(false);
    }
  };

  const handleSaveGroup = async () => {
    if (!groupNameInput.trim()) return;
    try {
      const url = editingGroup
        ? `/api/display/groups/${encodeURIComponent(editingGroup.id)}`
        : "/api/display/groups";
      const method = editingGroup ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: groupNameInput.trim(),
          color: groupColorInput,
          description: groupDescInput.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setDisplayState(data.state);
      setGroupDialogOpen(false);
      setEditingGroup(null);
      toast({ title: editingGroup ? "Display group updated" : "Display group created" });
    } catch (err: any) {
      toast({ title: err.message || "Error saving group", variant: "destructive" });
    }
  };

  const handleDeleteGroup = async (group: any) => {
    if (!window.confirm(`Delete group "${group.name}"? Displays inside it will be moved to your primary group.`)) {
      return;
    }
    try {
      const res = await fetch(`/api/display/groups/${encodeURIComponent(group.id)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setDisplayState(data.state);
      if (selectedGroupFilter === group.id) setSelectedGroupFilter("all");
      toast({ title: "Display group deleted" });
    } catch (err: any) {
      toast({ title: err.message || "Cannot delete group", variant: "destructive" });
    }
  };

  const handleSimulatePiState = async (
    displayId: string,
    tvPowerState: "on" | "standby",
    chromiumRunning = true,
  ) => {
    try {
      await fetch("/api/display/pi-telemetry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayId,
          tvPowerState,
          cpuTempC: 47.2,
          loadAvg: 0.34,
          memUsedPct: 41,
          piUptimeSec: 86400,
          ipAddress: "192.168.1.120",
          chromiumRunning,
        }),
      });
      const updated = await fetch("/api/display/state").then((r) => r.json());
      setDisplayState(updated);
      toast({
        title: `Simulated Pi pingback (${displayId})`,
        description: `TV: ${tvPowerState.toUpperCase()} • Chromium: ${chromiumRunning ? "Running" : "Frozen/Stopped"}`,
      });
    } catch {
      toast({ title: "Simulation failed", variant: "destructive" });
    }
  };

  const handleClearAlerts = async () => {
    await fetch("/api/display/alerts", { method: "DELETE" });
    const updated = await fetch("/api/display/state").then((r) => r.json());
    setDisplayState(updated);
  };

  const handleAddCalendarEvent = () => {
    if (!newCalTitle.trim() || !newCalDate) return;
    const dt = new Date(`${newCalDate}T12:00:00`);
    const dayLabel = isNaN(dt.getTime())
      ? newCalDate
      : dt.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
    const created = {
      id: `cal-${Date.now()}`,
      title: newCalTitle.trim(),
      dateISO: newCalDate,
      dayLabel,
      time: newCalTime.trim() || "All Day",
      color: newCalColor,
      source: "admin",
    };
    const nextEvents = [...(displayState?.calendarEvents || []), created].sort((a, b) =>
      (a.dateISO || "").localeCompare(b.dateISO || ""),
    );
    setDisplayState((prev: any) => ({ ...prev, calendarEvents: nextEvents }));
    setNewCalTitle("");
    saveSchedulesPayload({ calendarEvents: nextEvents }, "Calendar event added!");
  };

  const handleDeleteCalendarEvent = (id: string) => {
    const nextEvents = (displayState?.calendarEvents || []).filter((e: any) => e.id !== id);
    setDisplayState((prev: any) => ({ ...prev, calendarEvents: nextEvents }));
    saveSchedulesPayload({ calendarEvents: nextEvents }, "Calendar event removed");
  };

  const handleRefreshLiveFeeds = async () => {
    setRefreshingFeeds(true);
    try {
      const res = await fetch("/api/display/refresh-feeds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          icsCalendarUrl: displayState?.settings?.icsCalendarUrl || "",
        }),
      });
      const data = await res.json();
      if (data.state) setDisplayState(data.state);
      toast({
        title: "Refreshed SD Weather, KELOLAND/ESPN RSS & Calendar",
        description: data.ics?.ok ? `Synced ${data.ics.count} Outlook events` : undefined,
      });
    } catch {
      toast({ title: "Feed refresh failed", variant: "destructive" });
    }
    setRefreshingFeeds(false);
  };

  // =========================================================================
  // EXISTING FLEET VEHICLE & CUSTOM LOCATION HANDLERS
  // =========================================================================
  const handleMapHomeLocationChange = async (mapKey: "map" | "regional-sf", value: string) => {
    setSavingMapHome(mapKey);
    try {
      const response = await fetch(`/api/map-home-locations/${mapKey}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locationId: value === "default" ? null : Number(value),
        }),
      });
      if (!response.ok) throw new Error("Failed to save map home location");
      const result = await response.json();
      setMapHomeLocations((previous) => ({
        ...previous,
        [mapKey]: result.assignment,
      }));
      toast({ title: "Map home location updated" });
    } catch {
      toast({ title: "Error updating map home location", variant: "destructive" });
    } finally {
      setSavingMapHome(null);
    }
  };

  const handleEditVehicle = (vehicle: Vehicle) => {
    setEditVehicle(vehicle);
    setVehicleName(vehicle.name);
    setVehicleColor(vehicle.color || "#3b82f6");
    setVehicleHomeLocationId(vehicle.homeLocationId ? String(vehicle.homeLocationId) : "none");
  };

  const handleSaveVehicle = async () => {
    if (!editVehicle) return;
    setSavingVehicle(true);
    try {
      const response = await fetch(`/api/vehicles/${editVehicle.vehicleId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: vehicleName,
          color: vehicleColor,
          homeLocationId: vehicleHomeLocationId === "none" ? null : Number(vehicleHomeLocationId),
        }),
      });
      if (response.ok) {
        toast({ title: "Vehicle updated successfully" });
        setEditVehicle(null);
        loadData();
      } else {
        throw new Error("Failed to update vehicle");
      }
    } catch {
      toast({ title: "Error updating vehicle", variant: "destructive" });
    }
    setSavingVehicle(false);
  };

  const handleVehicleWarehouseChange = async (vehicle: Vehicle, value: string) => {
    try {
      const response = await fetch(`/api/vehicles/${vehicle.vehicleId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: vehicle.name,
          color: vehicle.color || "#3b82f6",
          homeLocationId: value === "none" ? null : Number(value),
        }),
      });
      if (!response.ok) throw new Error("Failed to update vehicle warehouse");
      const updatedVehicle = await response.json();
      setVehicles((previous) =>
        previous.map((current) =>
          current.vehicleId === vehicle.vehicleId ? updatedVehicle : current,
        ),
      );
      toast({ title: "Vehicle warehouse updated" });
    } catch {
      toast({ title: "Error updating vehicle warehouse", variant: "destructive" });
    }
  };

  const handleDeleteVehicle = async () => {
    if (!deleteVehicleId) return;
    try {
      const response = await fetch(`/api/vehicles/${deleteVehicleId}`, { method: "DELETE" });
      if (response.ok) {
        toast({ title: "Vehicle deleted successfully" });
        setDeleteVehicleId(null);
        loadData();
      } else {
        throw new Error("Failed to delete vehicle");
      }
    } catch {
      toast({ title: "Error deleting vehicle", variant: "destructive" });
    }
  };

  const openAddLocationDialog = () => {
    setEditLocation(null);
    setLocationName("");
    setLocationLat("");
    setLocationLon("");
    setLocationIcon("marker");
    setLocationColor("#ef4444");
    setLocationDescription("");
    setLocationDialogOpen(true);
  };

  const openEditLocationDialog = (location: CustomLocation) => {
    setEditLocation(location);
    setLocationName(location.name);
    setLocationLat(location.latitude.toString());
    setLocationLon(location.longitude.toString());
    setLocationIcon(location.icon || "marker");
    setLocationColor(location.color || "#ef4444");
    setLocationDescription(location.description || "");
    setLocationDialogOpen(true);
  };

  const handleSaveLocation = async () => {
    setSavingLocation(true);
    try {
      const lat = parseFloat(locationLat);
      const lon = parseFloat(locationLon);
      if (isNaN(lat) || isNaN(lon)) {
        toast({ title: "Invalid coordinates", variant: "destructive" });
        setSavingLocation(false);
        return;
      }
      const data = {
        name: locationName,
        latitude: lat,
        longitude: lon,
        icon: locationIcon,
        color: locationColor,
        description: locationDescription || null,
      };
      const url = editLocation ? `/api/custom-locations/${editLocation.id}` : "/api/custom-locations";
      const method = editLocation ? "PUT" : "POST";
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (response.ok) {
        toast({ title: editLocation ? "Location updated" : "Location added" });
        setLocationDialogOpen(false);
        loadData();
      } else {
        throw new Error("Failed to save location");
      }
    } catch {
      toast({ title: "Error saving location", variant: "destructive" });
    }
    setSavingLocation(false);
  };

  const handleDeleteLocation = async () => {
    if (!deleteLocationId) return;
    try {
      const response = await fetch(`/api/custom-locations/${deleteLocationId}`, { method: "DELETE" });
      if (response.ok) {
        toast({ title: "Location deleted" });
        setDeleteLocationId(null);
        loadData();
      } else {
        throw new Error("Failed to delete location");
      }
    } catch {
      toast({ title: "Error deleting location", variant: "destructive" });
    }
  };

  const IconComponent = ({ iconName }: { iconName: string }) => {
    const option = iconOptions.find((o) => o.value === iconName);
    const Icon = option?.icon || MapPin;
    return <Icon className="w-4 h-4" />;
  };

  const originUrl = typeof window !== "undefined" ? window.location.origin : "https://srv1205734.hstgr.cloud";

  const sfWarehouseForHotShots = useMemo(() => {
    const regHome = mapHomeLocations["regional-sf"]?.location;
    if (regHome) {
      return { name: regHome.name, latitude: regHome.latitude, longitude: regHome.longitude };
    }
    const sfLoc = customLocations.find((c) => /sioux\s*falls/i.test(c.name));
    if (sfLoc) {
      return { name: sfLoc.name, latitude: sfLoc.latitude, longitude: sfLoc.longitude };
    }
    return { name: "Sioux Falls Warehouse", latitude: 43.5446, longitude: -96.7311 };
  }, [mapHomeLocations, customLocations]);

  const mainWarehouseForHotShots = useMemo(() => {
    const mainHome = mapHomeLocations["map"]?.location;
    if (mainHome) {
      return { name: mainHome.name, latitude: mainHome.latitude, longitude: mainHome.longitude };
    }
    const arlLoc = customLocations.find((c) => /arlington/i.test(c.name));
    if (arlLoc) {
      return { name: arlLoc.name, latitude: arlLoc.latitude, longitude: arlLoc.longitude };
    }
    return { name: "Arlington Warehouse", latitude: 44.3792, longitude: -97.1406 };
  }, [mapHomeLocations, customLocations]);

  const normalizedHotShots = useMemo(
    () => normalizeHotShotRoutes(displayState?.hotShotRoutes),
    [displayState?.hotShotRoutes],
  );

  const activeOrUpcomingHotShotsCount = useMemo(() => {
    const todayISO = getCentralDateISO(new Date());
    return normalizedHotShots.filter((r) => r.active && r.deliveryDateISO >= todayISO).length;
  }, [normalizedHotShots]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Unified Header */}
      <header className="min-h-14 py-2.5 border-b border-border bg-secondary/70 px-4 sm:px-6 flex flex-wrap items-center justify-between gap-3 sticky top-0 z-20 backdrop-blur-sm">
        <div className="flex items-center gap-3 flex-wrap min-w-0">
          <IbsBrandHeaderMark />

          {/* Primary Site Navigation Switcher */}
          <div className="inline-flex rounded-lg bg-card border border-border p-0.5 text-xs">
            <Link href="/dispatch">
              <button
                type="button"
                className="px-3 py-1.5 rounded-md font-semibold text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5"
              >
                <Zap className="w-3.5 h-3.5" />
                Dispatch & Routes
              </button>
            </Link>
            <Link href="/history">
              <button
                type="button"
                className="px-3 py-1.5 rounded-md font-semibold text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5"
              >
                <History className="w-3.5 h-3.5" />
                Delivery History
              </button>
            </Link>
            <span className="px-3 py-1.5 rounded-md font-bold bg-primary text-primary-foreground shadow-sm flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5" />
              Schedules & TV Board
            </span>
            <Link href="/">
              <button
                type="button"
                data-testid="button-back-dashboard"
                className="px-3 py-1.5 rounded-md font-semibold text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5"
              >
                <MapPin className="w-3.5 h-3.5" />
                Full Fleet Map
              </button>
            </Link>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isTechnicalAdmin && (
            <Button
              variant={previewStaffMode ? "default" : "outline"}
              size="sm"
              className="gap-1.5 h-8 text-xs font-semibold"
              onClick={() => setPreviewStaffMode((prev) => !prev)}
              data-testid="button-toggle-admin-view-mode"
              title="Switch between full Technical Admin controls and the simplified Standard Staff view"
            >
              {previewStaffMode ? (
                <>
                  <Settings className="w-3.5 h-3.5" />
                  Switch to Technical View
                </>
              ) : (
                <>
                  <Eye className="w-3.5 h-3.5 text-primary" />
                  Simplified Staff View
                </>
              )}
            </Button>
          )}

          <div className="inline-flex items-center gap-1.5">
            <Palette className="w-3.5 h-3.5 text-primary shrink-0 hidden md:inline" />
            <Select
              value={officeTheme}
              onValueChange={(val) => setOfficeTheme(val as DisplayThemeId)}
            >
              <SelectTrigger
                className="h-8 w-[178px] text-xs font-semibold"
                data-testid="select-admin-console-theme"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
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

          {localDemoSyncAvailable && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleSyncDemoLiveVehicles}
              disabled={syncingDemoGps}
              title={
                lastDemoGpsSyncAt
                  ? `Local Demo Only (auto-hidden in live build) • Last synced ${lastDemoGpsSyncAt}`
                  : "Pull latest live truck & van GPS positions on demand (Local Demo Only — auto-hidden on live server)"
              }
              data-testid="button-demo-sync-gps"
              className="gap-1.5 border-amber-500/55 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 hover:text-amber-200 font-semibold"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncingDemoGps ? "animate-spin" : ""}`} />
              <span>{syncingDemoGps ? "Syncing GPS..." : "Update Truck GPS"}</span>
              <span className="text-[9px] font-mono font-extrabold uppercase px-1.5 py-0.2 rounded bg-amber-500/25 border border-amber-500/40">
                DEMO
              </span>
            </Button>
          )}

          {showTechnicalControls && (
            <>
              <a href="/display?display=breakroom" target="_blank" rel="noreferrer">
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Tv className="w-4 h-4 text-primary" />
                  Breakroom 55" TV
                  <ExternalLink className="w-3.5 h-3.5 opacity-60" />
                </Button>
              </a>
              <a href="/display?display=warehouse" target="_blank" rel="noreferrer">
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Tv className="w-4 h-4 text-primary" />
                  Warehouse 40" TV
                  <ExternalLink className="w-3.5 h-3.5 opacity-60" />
                </Button>
              </a>
            </>
          )}
          <div className="flex items-center gap-1.5 pl-2 border-l border-border">
            <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-sm bg-secondary border border-border text-xs font-mono font-bold text-foreground uppercase">
              <ShieldCheck className="w-3.5 h-3.5 text-primary" />
              {currentUser?.username || "staff"}
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-primary/15 text-primary">
                {isTechnicalAdmin ? "TECH" : "STAFF"}
              </span>
            </span>
            {!showTechnicalControls && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2.5 gap-1.5 text-xs"
                onClick={() => setOwnPasswordDialogOpen(true)}
                title="Change My Password"
              >
                <KeyRound className="w-3.5 h-3.5 text-primary" />
                <span className="hidden md:inline">Password</span>
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-muted-foreground hover:text-foreground"
              onClick={async () => {
                await logout();
                setLocation("/login");
              }}
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Sign Out</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 sm:p-6 space-y-6">
        {/* SIMPLE GREEN-LIGHT TV STATUS BAR FOR STANDARD STAFF (AND SIMPLIFIED VIEW) */}
        {!showTechnicalControls && (() => {
          const units: any[] = displayState?.displayUnits || [];
          const onlineCount = units.filter((u) => u.health?.status === "healthy").length;
          const sleepCount = units.filter((u) => u.health?.status === "scheduled_sleep").length;
          return (
            <div
              className="rounded-sm border border-border bg-card px-4 py-3 flex flex-wrap items-center justify-between gap-3"
              data-testid="staff-tv-status-strip"
            >
              <div className="flex items-center gap-2.5">
                <Tv className="w-4 h-4 text-primary shrink-0" />
                <span className="text-xs font-display font-bold uppercase tracking-wider text-foreground">
                  TV Screens
                </span>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded-sm bg-secondary border border-border text-muted-foreground">
                  {onlineCount}/{units.length} Online
                  {sleepCount > 0 ? ` • ${sleepCount} Scheduled Sleep` : ""}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {units.map((u) => {
                  const st = u.health?.status;
                  const isOnline = st === "healthy";
                  const isScheduledSleep = st === "scheduled_sleep";
                  const isStandby = st === "tv_off";
                  const dotClass = isOnline
                    ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.75)]"
                    : isScheduledSleep
                      ? "bg-indigo-400"
                      : isStandby
                        ? "bg-amber-400"
                        : "bg-rose-500";
                  const stateWord = isOnline
                    ? "Online"
                    : isScheduledSleep
                      ? "Night Sleep"
                      : isStandby
                        ? "Standby"
                        : "Offline";
                  return (
                    <a
                      key={u.id}
                      href={`/display?display=${encodeURIComponent(u.id)}`}
                      target="_blank"
                      rel="noreferrer"
                      title={`${u.name}: ${stateWord} — Click to preview screen`}
                      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-sm border border-border bg-secondary/40 hover:bg-secondary transition-colors text-xs"
                      data-testid={`staff-tv-pill-${u.id}`}
                    >
                      <span
                        className={`w-2.5 h-2.5 rounded-full shrink-0 ${dotClass} ${
                          isOnline ? "animate-pulse" : ""
                        }`}
                      />
                      <span className="font-semibold text-foreground">{u.name}</span>
                      <span
                        className={`text-[10px] font-mono uppercase ${
                          isOnline
                            ? "text-emerald-400"
                            : isScheduledSleep
                              ? "text-indigo-300"
                              : isStandby
                                ? "text-amber-300"
                                : "text-muted-foreground"
                        }`}
                      >
                        {stateWord}
                      </span>
                    </a>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* LIVE 6-DIGIT TV PAIRING APPROVAL BANNER (Technical Admin Only) */}
        {showTechnicalControls && (displayState?.pendingPairings?.length || 0) > 0 && (
          <div className="rounded-sm border-2 border-primary/60 bg-primary/10 p-4 sm:p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-display font-bold uppercase tracking-wide text-base text-primary">
                <Tv className="w-5 h-5 animate-pulse shrink-0" />
                <span>
                  New Device Waiting for Pairing Approval ({displayState.pendingPairings.length})
                </span>
              </div>
              <span className="text-xs text-muted-foreground">
                Each new device creates its own dedicated screen instance by default (or choose an existing screen to replace).
              </span>
            </div>

            <div className="grid gap-3">
              {displayState.pendingPairings.map((p: any) => {
                const allUnits: any[] = displayState?.displayUnits || [];
                const allGroups: any[] = displayState?.settings?.displayGroups || [];
                // Always default to creating a dedicated new screen instance unless admin explicitly selects an existing one
                const selectedTarget = pairingTargetMap[p.code] || "__new__";
                const suggestedLabel = p.suggestedName || "TV Display";
                const customNameValue =
                  pairingNewNameMap[p.code] !== undefined
                    ? pairingNewNameMap[p.code]
                    : suggestedLabel;
                const selectedGroup =
                  pairingGroupMap[p.code] || allGroups[0]?.id || "grp-sf-office";

                return (
                  <div
                    key={p.pairId || p.code}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-border bg-card p-3.5"
                  >
                    <div className="flex flex-wrap items-center gap-3 min-w-0">
                      <span className="px-3 py-1.5 rounded-sm bg-primary/15 border border-primary/45 font-mono font-bold text-xl tracking-widest text-primary">
                        {p.code.slice(0, 3)}-{p.code.slice(3, 6)}
                      </span>
                      <div className="text-xs space-y-0.5 min-w-0">
                        <div className="font-semibold text-foreground flex flex-wrap items-center gap-1.5">
                          <span>Detected: {suggestedLabel}</span>
                          {p.requestedDisplayId && (
                            <span className="font-mono text-[11px] text-primary">
                              (URL requested ?display={p.requestedDisplayId})
                            </span>
                          )}
                        </div>
                        <div className="text-muted-foreground font-mono">
                          IP: {p.ipAddress || "unknown"}
                          {p.viewport ? ` • Resolution: ${p.viewport}` : ""}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Select
                        value={selectedTarget}
                        onValueChange={(val) =>
                          setPairingTargetMap((prev) => ({ ...prev, [p.code]: val }))
                        }
                      >
                        <SelectTrigger
                          className="h-9 w-[235px] text-xs font-semibold"
                          data-testid={`select-pair-target-${p.code}`}
                        >
                          <SelectValue placeholder="Choose screen mode..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__new__">
                            ✨ Create New Screen Instance
                          </SelectItem>
                          {allUnits.map((u) => (
                            <SelectItem key={u.id} value={u.id}>
                              Replace Existing: {u.name} ({u.id})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      {selectedTarget === "__new__" && (
                        <>
                          <Input
                            value={customNameValue}
                            onChange={(e) =>
                              setPairingNewNameMap((prev) => ({
                                ...prev,
                                [p.code]: e.target.value,
                              }))
                            }
                            placeholder="New screen name (e.g. Lobby TV)"
                            className="h-9 w-[195px] text-xs font-medium"
                            data-testid={`input-pair-new-name-${p.code}`}
                          />
                          {allGroups.length > 1 && (
                            <Select
                              value={selectedGroup}
                              onValueChange={(val) =>
                                setPairingGroupMap((prev) => ({ ...prev, [p.code]: val }))
                              }
                            >
                              <SelectTrigger className="h-9 w-[165px] text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {allGroups.map((g) => (
                                  <SelectItem key={g.id} value={g.id}>
                                    {g.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </>
                      )}

                      <Button
                        size="sm"
                        className="font-bold gap-1.5"
                        onClick={() =>
                          handleApprovePairing(
                            p.code,
                            selectedTarget,
                            customNameValue,
                            selectedGroup,
                          )
                        }
                        data-testid={`button-approve-tv-${p.code}`}
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        {selectedTarget === "__new__"
                          ? "Approve & Create Screen"
                          : "Approve Replacement"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => handleRejectPairing(p.code)}
                      >
                        Dismiss
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ACTIVE SEVERE WEATHER DEMO MODE BANNER */}
        {normalizeWeatherDemoScenario(displayState?.settings?.weatherDemoScenario) !== "none" && (() => {
          const demoMeta = getWeatherDemoScenarioMeta(displayState?.settings?.weatherDemoScenario);
          return (
            <div
              data-testid="active-weather-demo-banner"
              className="rounded-xl border border-rose-500/50 bg-rose-950/25 px-4 py-3 flex flex-wrap items-center justify-between gap-3"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <CloudSnow className="w-5 h-5 text-rose-400 shrink-0 animate-pulse" />
                <div className="min-w-0">
                  <div className="text-xs font-mono font-extrabold uppercase tracking-wider text-rose-300">
                    Severe Weather Demo Mode Active on TVs • {demoMeta.shortBadge}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {demoMeta.description}
                  </div>
                </div>
              </div>
              <Button
                size="sm"
                variant="destructive"
                onClick={() =>
                  handleUpdateWeatherOverlay(
                    { weatherDemoScenario: "none" },
                    "Turned off Severe Weather Demo Mode — back to live NWS feed!",
                  )
                }
                data-testid="button-turn-off-weather-demo"
              >
                Turn Off Weather Demo
              </Button>
            </div>
          );
        })()}

        <Tabs
          value={activeAdminTab}
          onValueChange={setActiveAdminTab}
          className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start"
        >
          {/* LEFT SIDEBAR: 3 CLEAN ORGANIZED GROUPS */}
          <TabsList className="lg:col-span-3 w-full flex flex-col items-stretch h-auto justify-start gap-4 p-3.5 bg-card border border-border rounded-xl lg:sticky lg:top-20">
            {/* Group 1: Daily Operations */}
            <div className="w-full space-y-1">
              <div className="px-2.5 pb-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Daily Operations
              </div>
              <TabsTrigger
                value="truck-schedule"
                className="w-full justify-start gap-2.5 px-3 py-2 text-xs font-semibold data-[state=active]:bg-secondary data-[state=active]:text-foreground rounded-lg"
              >
                <Truck className="w-4 h-4 text-primary shrink-0" />
                <span>Truck Route Schedule</span>
              </TabsTrigger>
              <TabsTrigger
                value="sf-schedule"
                className="w-full justify-start gap-2.5 px-3 py-2 text-xs font-semibold data-[state=active]:bg-secondary data-[state=active]:text-foreground rounded-lg"
              >
                <Users className="w-4 h-4 text-primary shrink-0" />
                <span>SF Team Schedule</span>
              </TabsTrigger>
              <TabsTrigger
                value="hotshots"
                data-testid="tab-hotshots"
                className="w-full justify-start gap-2.5 px-3 py-2 text-xs font-semibold data-[state=active]:bg-secondary data-[state=active]:text-foreground rounded-lg"
              >
                <Zap className="w-4 h-4 text-amber-500 shrink-0" />
                <span className="flex-1 text-left">Hot Shot Dispatches</span>
                {activeOrUpcomingHotShotsCount > 0 && (
                  <span className="rounded-full bg-amber-500/20 px-1.5 py-0.2 text-[10px] font-bold text-amber-400">
                    {activeOrUpcomingHotShotsCount}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger
                value="renewals"
                className="w-full justify-start gap-2.5 px-3 py-2 text-xs font-semibold data-[state=active]:bg-secondary data-[state=active]:text-foreground rounded-lg"
              >
                <ShieldAlert className="w-4 h-4 text-primary shrink-0" />
                <span>DOT & Med Renewals</span>
              </TabsTrigger>
            </div>

            {/* Group 2: TV Board Content */}
            <div className="w-full space-y-1 pt-3 border-t border-border">
              <div className="px-2.5 pb-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                TV Board Content
              </div>
              <TabsTrigger
                value="announcements"
                className="w-full justify-start gap-2.5 px-3 py-2 text-xs font-semibold data-[state=active]:bg-secondary data-[state=active]:text-foreground rounded-lg"
              >
                <Megaphone className="w-4 h-4 text-primary shrink-0" />
                <span>Announcements</span>
              </TabsTrigger>
              <TabsTrigger
                value="calendar"
                className="w-full justify-start gap-2.5 px-3 py-2 text-xs font-semibold data-[state=active]:bg-secondary data-[state=active]:text-foreground rounded-lg"
              >
                <Calendar className="w-4 h-4 text-primary shrink-0" />
                <span>Company Calendar</span>
              </TabsTrigger>
              <TabsTrigger
                value="photo-gallery"
                data-testid="tab-photo-gallery"
                className="w-full justify-start gap-2.5 px-3 py-2 text-xs font-semibold data-[state=active]:bg-secondary data-[state=active]:text-foreground rounded-lg"
              >
                <Images className="w-4 h-4 text-amber-500 shrink-0" />
                <span className="flex-1 text-left">Photo Gallery</span>
                {(displayState?.photoGallery?.photos || []).filter((p: any) => p.active !== false).length > 0 && (
                  <span className="rounded-full bg-amber-500/20 px-1.5 py-0.2 text-[10px] font-bold text-amber-400">
                    {(displayState?.photoGallery?.photos || []).filter((p: any) => p.active !== false).length}
                  </span>
                )}
              </TabsTrigger>
            </div>

            {/* Group 3: IT & TV Setup */}
            <div className="w-full space-y-1 pt-3 border-t border-border">
              <div className="px-2.5 pb-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                IT & TV Setup
              </div>
              {showTechnicalControls && (
                <TabsTrigger
                  value="displays"
                  className="w-full justify-start gap-2.5 px-3 py-2 text-xs font-semibold data-[state=active]:bg-secondary data-[state=active]:text-foreground rounded-lg"
                >
                  <Tv className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span>TV Units & Sleep Hours</span>
                </TabsTrigger>
              )}
              <TabsTrigger
                value="screen-studio"
                data-testid="tab-screen-studio"
                className="w-full justify-start gap-2.5 px-3 py-2 text-xs font-semibold data-[state=active]:bg-secondary data-[state=active]:text-foreground rounded-lg"
              >
                <LayoutGrid className="w-4 h-4 text-muted-foreground shrink-0" />
                <span>Screen Layout Studio</span>
              </TabsTrigger>
              <TabsTrigger
                value="fleet"
                className="w-full justify-start gap-2.5 px-3 py-2 text-xs font-semibold data-[state=active]:bg-secondary data-[state=active]:text-foreground rounded-lg"
              >
                <Satellite className="w-4 h-4 text-muted-foreground shrink-0" />
                <span>Fleet & Map Locations</span>
              </TabsTrigger>
              <TabsTrigger
                value="branding"
                data-testid="tab-branding"
                className="w-full justify-start gap-2.5 px-3 py-2 text-xs font-semibold data-[state=active]:bg-secondary data-[state=active]:text-foreground rounded-lg"
              >
                <Palette className="w-4 h-4 text-primary shrink-0" />
                <span>Branding & Logo</span>
              </TabsTrigger>
              {showTechnicalControls && (
                <TabsTrigger
                  value="security"
                  data-testid="tab-security"
                  className="w-full justify-start gap-2.5 px-3 py-2 text-xs font-semibold data-[state=active]:bg-secondary data-[state=active]:text-foreground rounded-lg"
                >
                  <Lock className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span>Users & Security</span>
                </TabsTrigger>
              )}
            </div>
          </TabsList>

          {/* RIGHT CONTENT AREA (9 cols) */}
          <div className="lg:col-span-9 min-w-0 space-y-6">

          {/* =============================================================== */}
          {/* TAB: COMPANY NAME & CUSTOM LOGO BRANDING                        */}
          {/* =============================================================== */}
          <TabsContent value="branding" className="space-y-6">
            <CompanyBrandingEditorCard
              displayState={displayState}
              onSaved={(next) => setDisplayState(next)}
            />
          </TabsContent>

          {/* =============================================================== */}
          {/* TAB 1: TV DISPLAY FLEET, GROUPS & PINGBACK HEALTH WATCHDOG      */}
          {/* =============================================================== */}
          {showTechnicalControls && (
          <TabsContent value="displays" className="space-y-6">
            <CompanyBrandingEditorCard
              displayState={displayState}
              onSaved={(next) => setDisplayState(next)}
            />
            {(() => {
              const units: any[] = displayState?.displayUnits || [];
              const groups: any[] = displayState?.settings?.displayGroups || [];
              const alerts: any[] = displayState?.displayAlerts || [];

              const healthyCount = units.filter((u) => u.health?.status === "healthy").length;
              const scheduledSleepCount = units.filter(
                (u) => u.health?.status === "scheduled_sleep",
              ).length;
              const tvOffCount = units.filter((u) => u.health?.status === "tv_off").length;
              const frozenCount = units.filter((u) => u.health?.status === "browser_frozen").length;
              const offlineCount = units.filter((u) => u.health?.status === "pi_offline").length;
              const awaitingCount = units.filter((u) => u.health?.status === "awaiting_connection").length;

              const visibleGroups =
                selectedGroupFilter === "all"
                  ? groups
                  : groups.filter((g) => g.id === selectedGroupFilter);

              const statusBadgeStyle = (status: string) => {
                if (status === "healthy")
                  return "bg-emerald-500/15 text-emerald-300 border-emerald-500/40";
                if (status === "scheduled_sleep")
                  return "bg-indigo-500/15 text-indigo-300 border-indigo-500/40";
                if (status === "tv_off")
                  return "bg-amber-500/15 text-amber-300 border-amber-500/40";
                if (status === "browser_frozen")
                  return "bg-orange-500/20 text-orange-300 border-orange-500/50";
                if (status === "pi_offline")
                  return "bg-red-500/20 text-red-300 border-red-500/50";
                return "bg-slate-500/15 text-slate-400 border-slate-600/40";
              };

              return (
                <>
                  {/* TOP FLEET HEALTH WATCHDOG SUMMARY + ACTION BAR */}
                  <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
                    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3.5 min-w-0">
                      <div className="text-xs text-emerald-300 font-semibold flex items-center gap-1.5 truncate">
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">TV ON • Healthy</span>
                      </div>
                      <div className="text-2xl font-black text-emerald-400 mt-1">{healthyCount}</div>
                    </div>
                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3.5 min-w-0">
                      <div className="text-xs text-amber-300 font-semibold flex items-center gap-1.5 truncate">
                        <Power className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">TV Standby / Sleep</span>
                      </div>
                      <div className="flex items-baseline gap-2 mt-1">
                        <span className="text-2xl font-black text-amber-400">
                          {tvOffCount + scheduledSleepCount}
                        </span>
                        {scheduledSleepCount > 0 && (
                          <span className="text-[11px] font-mono text-indigo-300 truncate">
                            ({scheduledSleepCount} scheduled)
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="rounded-xl border border-orange-500/30 bg-orange-500/5 p-3.5 min-w-0">
                      <div className="text-xs text-orange-300 font-semibold flex items-center gap-1.5 truncate">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">Browser Frozen</span>
                      </div>
                      <div className="text-2xl font-black text-orange-400 mt-1">{frozenCount}</div>
                    </div>
                    <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-3.5 min-w-0">
                      <div className="text-xs text-red-300 font-semibold flex items-center gap-1.5 truncate">
                        <WifiOff className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">Pi Offline / Frozen</span>
                      </div>
                      <div className="text-2xl font-black text-red-400 mt-1">{offlineCount}</div>
                    </div>
                    <div className="rounded-xl border border-border bg-card p-3.5 min-w-0 col-span-2 sm:col-span-1">
                      <div className="text-xs text-muted-foreground font-semibold flex items-center gap-1.5 truncate">
                        <Activity className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">Awaiting First Ping</span>
                      </div>
                      <div className="text-2xl font-black text-foreground mt-1">{awaitingCount}</div>
                    </div>
                  </div>

                  {/* RECENT PINGBACK & HARDWARE ALERTS BANNER */}
                  {alerts.length > 0 && (
                    <div className="rounded-xl border border-amber-500/40 bg-amber-950/15 p-4 space-y-2.5 overflow-hidden">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 font-bold text-sm text-amber-300 min-w-0">
                          <AlertTriangle className="w-4 h-4 shrink-0" />
                          <span className="truncate">
                            Recent Display & Raspberry Pi Watchdog Alerts ({alerts.length})
                          </span>
                        </div>
                        <Button variant="outline" size="xs" onClick={handleClearAlerts}>
                          Clear Alert History
                        </Button>
                      </div>
                      <div className="space-y-1.5 max-h-36 overflow-y-auto">
                        {alerts.slice(0, 6).map((a: any) => (
                          <div
                            key={a.id}
                            className="flex flex-wrap items-center justify-between gap-2 text-xs px-3 py-1.5 rounded bg-background/70 border border-border"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span
                                className={`px-1.5 py-0.5 rounded font-mono text-[10px] uppercase font-bold shrink-0 ${
                                  a.severity === "critical"
                                    ? "bg-red-500/20 text-red-300"
                                    : a.severity === "recovered"
                                      ? "bg-emerald-500/20 text-emerald-300"
                                      : "bg-amber-500/20 text-amber-300"
                                }`}
                              >
                                {a.severity}
                              </span>
                              <span className="font-semibold break-words min-w-0">{a.message}</span>
                            </div>
                            <span className="text-muted-foreground font-mono shrink-0">
                              {new Date(a.occurredAt).toLocaleTimeString()}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* DISPLAY GROUPS & GLOBAL ACTIONS TOOLBAR */}
                  <div className="rounded-xl border border-border bg-card p-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                      <span className="text-xs font-bold uppercase text-muted-foreground mr-1">Groups:</span>
                      <Button
                        size="sm"
                        variant={selectedGroupFilter === "all" ? "default" : "outline"}
                        onClick={() => setSelectedGroupFilter("all")}
                      >
                        All Displays ({units.length})
                      </Button>
                      {groups.map((g) => {
                        const count = units.filter((u) => u.groupId === g.id).length;
                        const isActive = selectedGroupFilter === g.id;
                        return (
                          <div
                            key={g.id}
                            className={`inline-flex items-center rounded-md border overflow-hidden transition-colors ${
                              isActive
                                ? "border-primary bg-primary/15 text-foreground"
                                : "border-border bg-background/40 text-foreground"
                            }`}
                          >
                            <button
                              type="button"
                              className={`h-8 px-3 text-xs font-medium inline-flex items-center gap-1.5 transition-colors ${
                                isActive
                                  ? "bg-primary text-primary-foreground font-semibold"
                                  : "hover:bg-secondary/70"
                              }`}
                              onClick={() => setSelectedGroupFilter(g.id)}
                            >
                              <span
                                className="w-2.5 h-2.5 rounded-full shrink-0 border border-black/20"
                                style={{ backgroundColor: g.color || "#38bdf8" }}
                              />
                              <span className="truncate max-w-[180px]">{g.name}</span>
                              <span className="opacity-80">({count})</span>
                            </button>
                            <button
                              type="button"
                              className="h-8 px-2 border-l border-border/80 text-muted-foreground hover:text-foreground hover:bg-secondary/70 inline-flex items-center justify-center transition-colors"
                              title="Rename or edit group"
                              onClick={() => {
                                setEditingGroup(g);
                                setGroupNameInput(g.name);
                                setGroupColorInput(g.color || "#38bdf8");
                                setGroupDescInput(g.description || "");
                                setGroupDialogOpen(true);
                              }}
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                          </div>
                        );
                      })}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {units.length > 0 && (
                        <div className="inline-flex items-center gap-1.5">
                          <span className="text-[11px] font-semibold text-muted-foreground whitespace-nowrap hidden sm:inline">
                            Active TV:
                          </span>
                          <Select
                            value={expandedDisplayUnitId || "__none__"}
                            onValueChange={(val) => {
                              if (val === "__none__") {
                                setExpandedDisplayUnitId(null);
                                return;
                              }
                              const picked = units.find((u) => u.id === val);
                              if (
                                picked &&
                                selectedGroupFilter !== "all" &&
                                picked.groupId !== selectedGroupFilter
                              ) {
                                setSelectedGroupFilter("all");
                              }
                              setExpandedDisplayUnitId(val);
                            }}
                          >
                            <SelectTrigger
                              className="h-8 w-[210px] text-xs font-medium"
                              data-testid="select-active-tv-dropdown"
                            >
                              <SelectValue placeholder="Select a TV to configure..." />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">All TVs Collapsed</SelectItem>
                              {units.map((u) => {
                                const p = displayState?.settings?.displayProfiles?.[u.id] || u;
                                return (
                                  <SelectItem key={u.id} value={u.id}>
                                    {p.name} ({u.id})
                                  </SelectItem>
                                );
                              })}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditingGroup(null);
                          setGroupNameInput("");
                          setGroupColorInput("#38bdf8");
                          setGroupDescInput("");
                          setGroupDialogOpen(true);
                        }}
                      >
                        <FolderPlus className="w-3.5 h-3.5" />
                        New Group
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => {
                          setNewDispGroup(
                            selectedGroupFilter !== "all"
                              ? selectedGroupFilter
                              : groups[0]?.id || "grp-sf-office",
                          );
                          setAddDisplayOpen(true);
                        }}
                      >
                        <Plus className="w-4 h-4" />
                        Add New Display
                      </Button>
                      {showTechnicalControls && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-amber-500/40 text-amber-300 hover:bg-amber-500/15"
                          onClick={handleResetToCleanBaseline}
                          title="Reset TV units, custom screens, announcements & schedules to a clean production baseline (keeps driver/staff rosters & Motive GPS data)"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          Clean Reset
                        </Button>
                      )}
                    </div>
                  </div>

                  {units.length === 0 && (
                    <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-5 flex flex-wrap items-center justify-between gap-4">
                      <div className="space-y-1">
                        <div className="text-sm font-bold text-emerald-300 flex items-center gap-2">
                          <Tv className="w-4 h-4 text-emerald-400" />
                          Clean Production Environment — Ready to Add Your TV Displays
                        </div>
                        <p className="text-xs text-muted-foreground max-w-3xl">
                          No test TV units, custom screens, or sample announcements are loaded. Your Interstate Batteries driver &amp; Sioux Falls staff rosters and SD route territories are pre-loaded. Click <strong>+ Add New Display</strong> to create each Raspberry Pi TV unit and generate its pre-authenticated device token.
                        </p>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => {
                          setNewDispGroup(groups[0]?.id || "grp-sf-office");
                          setAddDisplayOpen(true);
                        }}
                      >
                        <Plus className="w-4 h-4" />
                        Create First TV Display
                      </Button>
                    </div>
                  )}

                  {/* GLOBAL FLEET REMOTE CONTROL BAR */}
                  <div className="rounded-sm border border-border bg-card p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs font-display font-bold uppercase tracking-wider text-primary mr-1.5">
                          Company-Wide Broadcast:
                        </span>
                        <Button size="xs" variant="outline" onClick={() => handleRemoteControl("auto", "all", "all")}>
                          Auto-Rotate All
                        </Button>
                        {[
                          { id: "screen-1", label: "All → Screen 1" },
                          { id: "screen-2", label: "All → Screen 2" },
                          { id: "screen-3", label: "All → Screen 3" },
                          { id: "screen-4", label: "All → Screen 4 (Bulletin)" },
                          { id: "screen-5", label: "All → Screen 5 (Hotshots)" },
                        ].map((b) => (
                          <div key={b.id} className="inline-flex items-center">
                            <Button
                              size="xs"
                              variant="outline"
                              className="rounded-r-none"
                              onClick={() => handleRemoteControl(b.id, "all", "all")}
                            >
                              {b.label}
                            </Button>
                            <Button
                              size="xs"
                              variant="outline"
                              className="rounded-l-none border-l-0 px-1.5 text-muted-foreground hover:text-primary"
                              onClick={() => handleJumpToEditScreen(b.id)}
                              title={`Edit ${b.id.replace("screen-", "Screen ")} layout in place`}
                              data-testid={`button-broadcast-edit-${b.id}`}
                            >
                              <Pencil className="w-3 h-3" />
                            </Button>
                          </div>
                        ))}
                        {(displayState?.customScreens || [])
                          .filter((cs: any) => !isBuiltInScreenId(cs.id))
                          .map((cs: any) => (
                          <div key={cs.id} className="inline-flex items-center">
                            <Button
                              size="xs"
                              variant="outline"
                              className="rounded-r-none border-primary/45 text-primary hover:bg-primary/15"
                              onClick={() => handleRemoteControl(cs.id, "all", "all")}
                              title={`Broadcast custom screen "${cs.name}" to all TVs`}
                            >
                              All → {cs.badgeLabel || cs.name}
                            </Button>
                            <Button
                              size="xs"
                              variant="outline"
                              className="rounded-l-none border-l-0 border-primary/45 px-1.5 text-primary hover:bg-primary/20"
                              onClick={() => handleJumpToEditScreen(cs.id)}
                              title={`Edit screen layout: ${cs.name}`}
                              data-testid={`button-broadcast-edit-screen-${cs.id}`}
                            >
                              <Pencil className="w-3 h-3" />
                            </Button>
                          </div>
                        ))}
                        <Button
                          size="xs"
                          variant="secondary"
                          onClick={() => handleRemoteControl(undefined, "all", "all", "reload")}
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          Reload All Browsers
                        </Button>
                      </div>

                      <div className="flex flex-wrap items-center gap-2.5 pt-2 sm:pt-0">
                        <div className="inline-flex items-center gap-1.5">
                          <Label className="text-xs whitespace-nowrap text-muted-foreground inline-flex items-center gap-1">
                            <Palette className="w-3.5 h-3.5 text-primary" />
                            Default TV Theme:
                          </Label>
                          <Select
                            value={displayState?.settings?.defaultTheme || "industrial-dispatch"}
                            onValueChange={(val) => {
                              const nextSettings = {
                                ...(displayState?.settings || {}),
                                defaultTheme: val,
                              };
                              setDisplayState((prev: any) => ({
                                ...prev,
                                settings: nextSettings,
                              }));
                              handleSaveDisplaySettings(nextSettings);
                            }}
                          >
                            <SelectTrigger
                              className="h-8 w-[180px] text-xs font-semibold"
                              data-testid="select-default-tv-theme"
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
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

                        <div className="inline-flex items-center gap-1.5">
                          <Label className="text-xs whitespace-nowrap text-muted-foreground">
                            Rotation (s):
                          </Label>
                          <Input
                            type="number"
                            min={8}
                            max={180}
                            className="w-16 h-8 text-xs font-mono"
                            value={displayState?.settings?.rotationIntervalSec ?? 22}
                            onChange={(e) =>
                              setDisplayState((prev: any) => ({
                                ...prev,
                                settings: {
                                  ...prev.settings,
                                  rotationIntervalSec: Number(e.target.value) || 22,
                                },
                              }))
                            }
                          />
                        </div>
                        <div className="inline-flex items-center gap-1.5">
                          <Label className="text-xs whitespace-nowrap text-muted-foreground">
                            Freeze Alert (s):
                          </Label>
                          <Input
                            type="number"
                            min={15}
                            max={180}
                            className="w-16 h-8 text-xs font-mono"
                            value={displayState?.settings?.pingTimeoutSec ?? 35}
                            onChange={(e) =>
                              setDisplayState((prev: any) => ({
                                ...prev,
                                settings: {
                                  ...prev.settings,
                                  pingTimeoutSec: Number(e.target.value) || 35,
                                },
                              }))
                            }
                          />
                        </div>
                        <Button
                          size="sm"
                          onClick={() => handleSaveDisplaySettings()}
                          disabled={savingSettings}
                        >
                          Save Defaults
                        </Button>
                      </div>
                    </div>

                    {/* QUICK SEVERE WEATHER MAP OVERLAY & DEMO SHOWCASE BAR */}
                    {(() => {
                      const currentWeatherMode = normalizeWeatherOverlayMode(
                        displayState?.settings?.weatherOverlayMode,
                        "warnings_only",
                      );
                      const currentDemo = normalizeWeatherDemoScenario(
                        displayState?.settings?.weatherDemoScenario,
                      );
                      return (
                        <div
                          className="pt-2.5 border-t border-border/70 flex flex-wrap items-center justify-between gap-3"
                          data-testid="quick-weather-overlay-bar"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-display font-bold uppercase tracking-wider text-rose-400 inline-flex items-center gap-1.5">
                              <CloudSnow className="w-3.5 h-3.5" />
                              Severe Weather Zones:
                            </span>
                            <Select
                              value={currentWeatherMode}
                              onValueChange={(val) =>
                                handleUpdateWeatherOverlay(
                                  { weatherOverlayMode: val as WeatherOverlayMode },
                                  `Weather map filter set to ${
                                    WEATHER_OVERLAY_MODES.find((m) => m.id === val)?.shortLabel || val
                                  }`,
                                )
                              }
                            >
                              <SelectTrigger
                                className="h-8 w-[205px] text-xs font-semibold"
                                data-testid="select-weather-overlay-mode"
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {WEATHER_OVERLAY_MODES.map((m) => (
                                  <SelectItem key={m.id} value={m.id}>
                                    {m.shortLabel}
                                    {m.id === "warnings_only" ? " (Default)" : ""}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[11px] font-mono text-muted-foreground mr-0.5">
                              Showcase Demo:
                            </span>
                            <Button
                              size="xs"
                              variant={currentDemo === "aberdeen_blizzard" ? "destructive" : "outline"}
                              className={
                                currentDemo === "aberdeen_blizzard"
                                  ? ""
                                  : "border-rose-500/40 text-rose-300 hover:bg-rose-500/15"
                              }
                              onClick={() => {
                                const next: WeatherDemoScenarioId =
                                  currentDemo === "aberdeen_blizzard" ? "none" : "aberdeen_blizzard";
                                handleUpdateWeatherOverlay(
                                  {
                                    weatherDemoScenario: next,
                                    ...(next !== "none" && currentWeatherMode === "off"
                                      ? { weatherOverlayMode: "warnings_only" }
                                      : {}),
                                  },
                                  next === "none"
                                    ? "Weather Demo Off (Live NWS)"
                                    : "❄️ Broadcasting Aberdeen Blizzard Warning Demo to TVs!",
                                );
                              }}
                              data-testid="button-demo-aberdeen-blizzard"
                            >
                              ❄️ Demo: Aberdeen Blizzard
                            </Button>
                            <Button
                              size="xs"
                              variant={currentDemo === "i29_severe_tstorm" ? "destructive" : "outline"}
                              className={
                                currentDemo === "i29_severe_tstorm"
                                  ? ""
                                  : "border-orange-500/40 text-orange-300 hover:bg-orange-500/15"
                              }
                              onClick={() => {
                                const next: WeatherDemoScenarioId =
                                  currentDemo === "i29_severe_tstorm" ? "none" : "i29_severe_tstorm";
                                handleUpdateWeatherOverlay(
                                  {
                                    weatherDemoScenario: next,
                                    ...(next !== "none" && currentWeatherMode === "off"
                                      ? { weatherOverlayMode: "warnings_only" }
                                      : {}),
                                  },
                                  next === "none"
                                    ? "Weather Demo Off (Live NWS)"
                                    : "⛈️ Broadcasting I-29 Severe Storm Warning Demo to TVs!",
                                );
                              }}
                              data-testid="button-demo-i29-storm"
                            >
                              ⛈️ Demo: I-29 Storm
                            </Button>
                            <Button
                              size="xs"
                              variant={currentDemo === "multi_zone_winter" ? "destructive" : "outline"}
                              className={
                                currentDemo === "multi_zone_winter"
                                  ? ""
                                  : "border-pink-500/40 text-pink-300 hover:bg-pink-500/15"
                              }
                              onClick={() => {
                                const next: WeatherDemoScenarioId =
                                  currentDemo === "multi_zone_winter" ? "none" : "multi_zone_winter";
                                handleUpdateWeatherOverlay(
                                  {
                                    weatherDemoScenario: next,
                                    ...(next !== "none" && currentWeatherMode === "off"
                                      ? { weatherOverlayMode: "warnings_only" }
                                      : {}),
                                  },
                                  next === "none"
                                    ? "Weather Demo Off (Live NWS)"
                                    : "🧊 Broadcasting Multi-Zone Winter Demo to TVs!",
                                );
                              }}
                              data-testid="button-demo-multi-zone"
                            >
                              🧊 Demo: Multi-Zone
                            </Button>
                            {currentDemo !== "none" && (
                              <Button
                                size="xs"
                                variant="secondary"
                                onClick={() =>
                                  handleUpdateWeatherOverlay(
                                    { weatherDemoScenario: "none" },
                                    "Weather Demo Off — Live NWS Feed Restored",
                                  )
                                }
                              >
                                Demo Off
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  {/* AUTOMATIC TV POWER SCHEDULE CARD (MORNING WAKE / EVENING STANDBY) */}
                  {(() => {
                    const companySchedule = normalizeTvPowerSchedule(
                      displayState?.settings?.powerSchedule,
                      DEFAULT_TV_POWER_SCHEDULE,
                    );
                    const companyEval = evaluateTvPowerSchedule(
                      companySchedule,
                      { powerScheduleMode: "company" },
                      new Date(),
                    );
                    const updateCompanyPowerSchedule = (
                      patch: Partial<typeof companySchedule>,
                      saveImmediately = false,
                    ) => {
                      const nextSchedule = normalizeTvPowerSchedule(
                        { ...companySchedule, ...patch },
                        companySchedule,
                      );
                      const nextSettings = {
                        ...(displayState?.settings || {}),
                        powerSchedule: nextSchedule,
                      };
                      setDisplayState((prev: any) => ({
                        ...prev,
                        settings: nextSettings,
                      }));
                      if (saveImmediately) {
                        handleSaveDisplaySettings(nextSettings);
                      }
                    };
                    const toggleCompanyDay = (dayIndex: number) => {
                      const exists = companySchedule.activeDays.includes(dayIndex);
                      const nextDays = exists
                        ? companySchedule.activeDays.filter((d) => d !== dayIndex)
                        : [...companySchedule.activeDays, dayIndex].sort((a, b) => a - b);
                      updateCompanyPowerSchedule({ activeDays: nextDays });
                    };

                    return (
                      <div
                        className="rounded-sm border border-border bg-card p-4 space-y-3.5"
                        data-testid="company-tv-power-schedule-card"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="space-y-0.5 min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <Clock className="w-4 h-4 text-primary shrink-0" />
                              <span className="text-xs font-display font-bold uppercase tracking-wider text-foreground">
                                Automatic TV Power Schedule (Morning Wake / Evening Sleep)
                              </span>
                              <span
                                data-testid="company-power-schedule-status"
                                className={`text-[11px] font-mono px-2 py-0.5 rounded-sm border ${
                                  !companySchedule.enabled
                                    ? "bg-secondary text-muted-foreground border-border"
                                    : companyEval.shouldBeOn
                                      ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/35"
                                      : "bg-indigo-500/15 text-indigo-300 border-indigo-500/35"
                                }`}
                              >
                                {!companySchedule.enabled
                                  ? "Schedule Off (24/7)"
                                  : companyEval.statusSummary}
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              Automatically wakes company TVs in the morning and puts displays into low-power standby in the evenings (HDMI-CEC + DPMS + Night Blackout). Individual TVs can override below.
                            </p>
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                            <Button
                              size="xs"
                              variant="outline"
                              onClick={() => handleRemoteControl(undefined, "all", "all", "tv_on")}
                              title="Wake all company TVs right now"
                              data-testid="button-all-tvs-on"
                            >
                              <Sun className="w-3.5 h-3.5 text-amber-400" />
                              All TVs On Now
                            </Button>
                            <Button
                              size="xs"
                              variant="outline"
                              onClick={() => handleRemoteControl(undefined, "all", "all", "tv_standby")}
                              title="Put all company TVs into standby right now"
                              data-testid="button-all-tvs-off"
                            >
                              <Moon className="w-3.5 h-3.5 text-indigo-300" />
                              All TVs Off Now
                            </Button>
                            <Button
                              size="xs"
                              variant={companyPowerScheduleExpanded ? "default" : "secondary"}
                              onClick={() => setCompanyPowerScheduleExpanded((prev) => !prev)}
                              data-testid="toggle-company-power-schedule-panel"
                            >
                              {companyPowerScheduleExpanded ? (
                                <>
                                  Hide Schedule
                                  <ChevronUp className="w-3.5 h-3.5" />
                                </>
                              ) : (
                                <>
                                  Edit Schedule
                                  <ChevronDown className="w-3.5 h-3.5" />
                                </>
                              )}
                            </Button>
                          </div>
                        </div>

                        {companyPowerScheduleExpanded && (
                        <div className="flex flex-wrap items-end justify-between gap-3 pt-2.5 border-t border-border/70">
                          <div className="flex flex-wrap items-end gap-3">
                            {/* Enable / Disable Switch */}
                            <div className="space-y-1">
                              <Label className="text-[11px] text-muted-foreground block">
                                Schedule Status
                              </Label>
                              <Button
                                type="button"
                                size="sm"
                                variant={companySchedule.enabled ? "default" : "outline"}
                                className="h-8 gap-1.5 font-semibold text-xs"
                                data-testid="toggle-tv-power-schedule"
                                onClick={() =>
                                  updateCompanyPowerSchedule(
                                    { enabled: !companySchedule.enabled },
                                    true,
                                  )
                                }
                              >
                                <Power className="w-3.5 h-3.5" />
                                {companySchedule.enabled ? "Enabled" : "Disabled"}
                              </Button>
                            </div>

                            {/* Wake Time */}
                            <div className="space-y-1">
                              <Label className="text-[11px] text-muted-foreground block">
                                Turn TVs ON ({formatTime12h(companySchedule.onTime)})
                              </Label>
                              <Input
                                type="time"
                                className="h-8 w-[124px] text-xs font-mono"
                                data-testid="input-tv-on-time"
                                value={companySchedule.onTime}
                                onChange={(e) =>
                                  updateCompanyPowerSchedule({ onTime: e.target.value })
                                }
                              />
                            </div>

                            {/* Sleep Time */}
                            <div className="space-y-1">
                              <Label className="text-[11px] text-muted-foreground block">
                                Turn TVs OFF ({formatTime12h(companySchedule.offTime)})
                              </Label>
                              <Input
                                type="time"
                                className="h-8 w-[124px] text-xs font-mono"
                                data-testid="input-tv-off-time"
                                value={companySchedule.offTime}
                                onChange={(e) =>
                                  updateCompanyPowerSchedule({ offTime: e.target.value })
                                }
                              />
                            </div>

                            {/* Active Days */}
                            <div className="space-y-1">
                              <div className="flex items-center justify-between gap-2">
                                <Label className="text-[11px] text-muted-foreground">
                                  Active Days
                                </Label>
                                <div className="flex items-center gap-1.5 text-[10px] font-mono">
                                  <button
                                    type="button"
                                    className="text-primary hover:underline"
                                    onClick={() =>
                                      updateCompanyPowerSchedule({ activeDays: [1, 2, 3, 4, 5] })
                                    }
                                  >
                                    Mon–Fri
                                  </button>
                                  <span className="text-muted-foreground">•</span>
                                  <button
                                    type="button"
                                    className="text-primary hover:underline"
                                    onClick={() =>
                                      updateCompanyPowerSchedule({ activeDays: [1, 2, 3, 4, 5, 6] })
                                    }
                                  >
                                    Mon–Sat
                                  </button>
                                  <span className="text-muted-foreground">•</span>
                                  <button
                                    type="button"
                                    className="text-primary hover:underline"
                                    onClick={() =>
                                      updateCompanyPowerSchedule({
                                        activeDays: [0, 1, 2, 3, 4, 5, 6],
                                      })
                                    }
                                  >
                                    7 Days
                                  </button>
                                </div>
                              </div>
                              <div className="flex items-center gap-1">
                                {TV_POWER_WEEKDAYS.map((d) => {
                                  const active = companySchedule.activeDays.includes(d.day);
                                  return (
                                    <button
                                      key={d.day}
                                      type="button"
                                      title={d.label}
                                      data-testid={`btn-company-day-${d.short.toLowerCase()}`}
                                      onClick={() => toggleCompanyDay(d.day)}
                                      className={`h-8 px-2 rounded-sm border text-xs font-mono font-bold transition-colors ${
                                        active
                                          ? "bg-primary text-primary-foreground border-primary"
                                          : "bg-secondary/40 text-muted-foreground border-border hover:text-foreground"
                                      }`}
                                    >
                                      {d.short}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>

                            {/* Timezone */}
                            <div className="space-y-1">
                              <Label className="text-[11px] text-muted-foreground block">
                                Timezone
                              </Label>
                              <Select
                                value={companySchedule.timezone}
                                onValueChange={(val) =>
                                  updateCompanyPowerSchedule({ timezone: val })
                                }
                              >
                                <SelectTrigger
                                  className="h-8 w-[225px] text-xs"
                                  data-testid="select-tv-power-timezone"
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {TV_POWER_TIMEZONES.map((tz) => (
                                    <SelectItem key={tz.id} value={tz.id}>
                                      {tz.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>

                          <Button
                            size="sm"
                            onClick={() => handleSaveDisplaySettings()}
                            disabled={savingSettings}
                            data-testid="button-save-tv-power-schedule"
                          >
                            Save Power Schedule
                          </Button>
                        </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* GROUPED DISPLAY SECTIONS */}
                  {visibleGroups.map((group) => {
                    const groupUnits = units.filter((u) => u.groupId === group.id);
                    return (
                      <section
                        key={group.id}
                        className="rounded-2xl border border-border bg-secondary/15 p-4 sm:p-5 space-y-4 overflow-hidden"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-border/70">
                          <div className="flex flex-wrap items-center gap-2 min-w-0">
                            <span
                              className="w-3.5 h-3.5 rounded-full shrink-0"
                              style={{ backgroundColor: group.color || "#38bdf8" }}
                            />
                            <h3 className="font-bold text-base truncate">{group.name}</h3>
                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                              ({groupUnits.length} {groupUnits.length === 1 ? "display" : "displays"})
                            </span>
                            {group.description && (
                              <span className="text-xs text-muted-foreground hidden md:inline truncate">
                                • {group.description}
                              </span>
                            )}
                          </div>

                          {/* Group-Level Remote Controls */}
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[11px] font-medium text-muted-foreground mr-1">
                              Group Control:
                            </span>
                            <Button
                              size="xs"
                              variant="outline"
                              onClick={() => handleRemoteControl("auto", "group", group.id)}
                            >
                              Auto
                            </Button>
                            <Button
                              size="xs"
                              variant="outline"
                              onClick={() => handleRemoteControl("screen-1", "group", group.id)}
                            >
                              S1
                            </Button>
                            <Button
                              size="xs"
                              variant="outline"
                              onClick={() => handleRemoteControl("screen-2", "group", group.id)}
                            >
                              S2
                            </Button>
                            <Button
                              size="xs"
                              variant="outline"
                              onClick={() => handleRemoteControl("screen-3", "group", group.id)}
                            >
                              S3
                            </Button>
                            <Button
                              size="xs"
                              variant="outline"
                              onClick={() => handleRemoteControl("screen-4", "group", group.id)}
                            >
                              S4
                            </Button>
                            <Button
                              size="xs"
                              variant="outline"
                              className="border-amber-500/40 text-amber-300 hover:bg-amber-500/15"
                              onClick={() => handleRemoteControl("screen-5", "group", group.id)}
                              title="Pin group to Screen 5 — Hotshots"
                            >
                              ⚡ S5
                            </Button>
                            {(displayState?.customScreens || [])
                              .filter((cs: any) => !isBuiltInScreenId(cs.id))
                              .map((cs: any) => (
                              <Button
                                key={cs.id}
                                size="xs"
                                variant="outline"
                                className="border-purple-500/40 text-purple-300 hover:bg-purple-500/15"
                                onClick={() => handleRemoteControl(cs.id, "group", group.id)}
                                title={`Pin group to custom screen: ${cs.name}`}
                              >
                                {cs.badgeLabel || cs.name}
                              </Button>
                            ))}
                            <Button
                              size="xs"
                              variant="outline"
                              onClick={() => handleRemoteControl(undefined, "group", group.id, "tv_on")}
                              title="Send HDMI-CEC Wake command to all TVs in this group"
                            >
                              Wake TVs
                            </Button>
                            <Button
                              size="xs"
                              variant="outline"
                              onClick={() => handleRemoteControl(undefined, "group", group.id, "tv_standby")}
                              title="Put all TVs in this group into Standby via HDMI-CEC"
                            >
                              Standby TVs
                            </Button>
                            {groups.length > 1 && (
                              <Button
                                size="xs"
                                variant="ghost"
                                className="px-2 text-destructive hover:text-destructive"
                                onClick={() => handleDeleteGroup(group)}
                                title="Delete group"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            )}
                          </div>
                        </div>

                        {groupUnits.length === 0 ? (
                          <div className="rounded-xl border border-dashed border-border bg-card/50 p-6 text-center text-xs text-muted-foreground">
                            No displays assigned to <strong>{group.name}</strong> yet. Click{" "}
                            <button
                              type="button"
                              className="text-primary underline font-semibold"
                              onClick={() => {
                                setNewDispGroup(group.id);
                                setAddDisplayOpen(true);
                              }}
                            >
                              + Add New Display
                            </button>{" "}
                            or move an existing display here.
                          </div>
                        ) : (
                          <div className="space-y-2.5">
                            {groupUnits.map((unit) => {
                              const prof = displayState?.settings?.displayProfiles?.[unit.id] || unit;
                              const isExpanded = expandedDisplayUnitId === unit.id;
                              const health = unit.health || {
                                status: "awaiting_connection",
                                label: "Awaiting First Ping",
                                detail: "",
                              };
                              const tel = unit.telemetry || {};
                              const deviceToken = prof.deviceToken || unit.deviceToken || "";
                              const kioskPairingUrl = `${originUrl}/display?display=${unit.id}`;
                              const kioskTokenUrl = deviceToken
                                ? `${originUrl}/display?display=${unit.id}&token=${deviceToken}`
                                : kioskPairingUrl;
                              const isTokenRevealed = Boolean(revealedTokens[unit.id]);
                              const displayedKioskUrl =
                                deviceToken && !isTokenRevealed
                                  ? `${originUrl}/display?display=${unit.id}&token=${deviceToken.slice(0, 8)}••••••••••••`
                                  : kioskTokenUrl;

                              const activePanelKey = prof.activePanel || "auto";
                              const pinnedCustomScreen = (displayState?.customScreens || []).find(
                                (cs: any) => cs.id === activePanelKey,
                              );
                              const activePanelSummary =
                                activePanelKey === "auto"
                                  ? "Auto-Rotate"
                                  : pinnedCustomScreen
                                    ? `Pinned: ${pinnedCustomScreen.badgeLabel || pinnedCustomScreen.name}`
                                    : `Pinned: ${String(activePanelKey).replace("screen-", "S")}`;

                              const summaryModeKey = prof.mapRegionMode || "auto";
                              const summarySavedRegs: SavedMapRegion[] =
                                displayState?.settings?.savedMapRegions || [];
                              const summaryMapLabel =
                                summaryModeKey === "auto"
                                  ? null
                                  : resolveMapViewSpec(
                                      summaryModeKey,
                                      prof.customMapBounds,
                                      summarySavedRegs,
                                      prof.mapEtaHub,
                                    ).shortLabel;

                              const statusDotColor =
                                health.status === "healthy"
                                  ? "bg-emerald-400"
                                  : health.status === "scheduled_sleep"
                                    ? "bg-indigo-400"
                                    : health.status === "tv_off"
                                      ? "bg-amber-400"
                                      : health.status === "browser_frozen"
                                        ? "bg-orange-400"
                                        : health.status === "pi_offline"
                                          ? "bg-red-400"
                                          : "bg-slate-400";

                              const updateLocalProf = (patch: any) => {
                                setDisplayState((prev: any) => ({
                                  ...prev,
                                  settings: {
                                    ...prev.settings,
                                    displayProfiles: {
                                      ...prev.settings.displayProfiles,
                                      [unit.id]: { ...prof, ...patch },
                                    },
                                  },
                                }));
                              };

                              return (
                                <div
                                  key={unit.id}
                                  data-testid={`tv-unit-card-${unit.id}`}
                                  className={`rounded-xl border bg-card transition-all min-w-0 overflow-hidden ${
                                    isExpanded
                                      ? "border-primary/70 ring-1 ring-primary/25 shadow-md"
                                      : "border-border hover:border-border/90 shadow-sm"
                                  }`}
                                >
                                  {/* Collapsible Header Bar (Click to open this TV and collapse others) */}
                                  <div
                                    role="button"
                                    tabIndex={0}
                                    aria-expanded={isExpanded}
                                    data-testid={`toggle-tv-unit-${unit.id}`}
                                    onClick={() =>
                                      setExpandedDisplayUnitId((prev) =>
                                        prev === unit.id ? null : unit.id,
                                      )
                                    }
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter" || e.key === " ") {
                                        e.preventDefault();
                                        setExpandedDisplayUnitId((prev) =>
                                          prev === unit.id ? null : unit.id,
                                        );
                                      }
                                    }}
                                    className={`px-4 py-3 flex flex-wrap items-center justify-between gap-3 cursor-pointer select-none transition-colors ${
                                      isExpanded ? "bg-primary/5" : "hover:bg-secondary/35"
                                    }`}
                                  >
                                    <div className="min-w-0 flex-1 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                                      {renamingUnitId === unit.id ? (
                                        <div
                                          className="flex flex-wrap items-center gap-1.5"
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          <Input
                                            value={renameValue}
                                            onChange={(e) => setRenameValue(e.target.value)}
                                            className="h-8 text-sm font-bold min-w-[160px]"
                                            autoFocus
                                          />
                                          <Button
                                            size="xs"
                                            onClick={() => {
                                              handleUpdateDisplayUnit(
                                                unit.id,
                                                { name: renameValue },
                                                "Display renamed!",
                                              );
                                              setRenamingUnitId(null);
                                            }}
                                          >
                                            Save
                                          </Button>
                                          <Button
                                            size="xs"
                                            variant="ghost"
                                            onClick={() => setRenamingUnitId(null)}
                                          >
                                            Cancel
                                          </Button>
                                        </div>
                                      ) : (
                                        <div className="flex items-center gap-2 min-w-0">
                                          <span
                                            className={`w-2.5 h-2.5 rounded-full shrink-0 ${statusDotColor}`}
                                          />
                                          <h4 className="font-bold text-sm sm:text-base truncate">
                                            {prof.name}
                                          </h4>
                                          <button
                                            type="button"
                                            className="text-muted-foreground hover:text-foreground shrink-0 p-1 rounded hover:bg-secondary/60"
                                            title="Rename display"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setRenamingUnitId(unit.id);
                                              setRenameValue(prof.name);
                                            }}
                                          >
                                            <Pencil className="w-3.5 h-3.5" />
                                          </button>
                                        </div>
                                      )}

                                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground min-w-0">
                                        <span className="font-mono text-sky-400">
                                          ?display={unit.id}
                                        </span>
                                        {prof.locationNote && (
                                          <span className="truncate max-w-[200px]">
                                            • {prof.locationNote}
                                          </span>
                                        )}
                                        <span className="px-2 py-0.5 rounded bg-secondary/70 border border-border text-[11px] font-mono text-foreground">
                                          {activePanelSummary}
                                        </span>
                                        {summaryMapLabel && (
                                          <span className="px-2 py-0.5 rounded bg-primary/10 border border-primary/30 text-[11px] font-mono text-primary truncate max-w-[180px]">
                                            Map: {summaryMapLabel}
                                          </span>
                                        )}
                                        {health.browserAgeSec !== null &&
                                          health.browserAgeSec !== undefined && (
                                            <span className="text-[11px] font-mono text-muted-foreground hidden xl:inline">
                                              • Ping {health.browserAgeSec}s ago
                                              {tel.ipAddress ? ` (${tel.ipAddress})` : ""}
                                            </span>
                                          )}
                                      </div>
                                    </div>

                                    <div className="flex items-center gap-2 shrink-0">
                                      <span
                                        className={`px-2.5 py-1 rounded-full border text-[11px] font-extrabold whitespace-nowrap ${statusBadgeStyle(
                                          health.status,
                                        )}`}
                                      >
                                        {health.label}
                                      </span>
                                      <a
                                        href={kioskPairingUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        onClick={(e) => e.stopPropagation()}
                                        title="Open this TV display in a new browser tab"
                                      >
                                        <Button size="xs" variant="ghost" className="px-2">
                                          <ExternalLink className="w-3.5 h-3.5" />
                                        </Button>
                                      </a>
                                      <Button
                                        type="button"
                                        size="xs"
                                        variant={isExpanded ? "default" : "outline"}
                                        className="gap-1 font-semibold"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setExpandedDisplayUnitId((prev) =>
                                            prev === unit.id ? null : unit.id,
                                          );
                                        }}
                                      >
                                        <Settings className="w-3.5 h-3.5" />
                                        {isExpanded ? "Close" : "Configure"}
                                        {isExpanded ? (
                                          <ChevronUp className="w-3.5 h-3.5" />
                                        ) : (
                                          <ChevronDown className="w-3.5 h-3.5" />
                                        )}
                                      </Button>
                                      <Button
                                        type="button"
                                        size="xs"
                                        variant="ghost"
                                        className="px-2 text-destructive hover:text-destructive hover:bg-destructive/15"
                                        title={`Delete TV display "${prof.name}"`}
                                        data-testid={`button-delete-tv-unit-${unit.id}`}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleDeleteDisplayUnit(unit.id, prof.name);
                                        }}
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </Button>
                                    </div>
                                  </div>

                                  {/* Expanded Active TV Controls Dropdown */}
                                  {isExpanded && (
                                    <div className="p-4 sm:p-5 border-t border-border/80 bg-card grid gap-4 xl:grid-cols-2 items-start">
                                      <div className="space-y-3.5 min-w-0">

                                    {/* Live Pingback & Raspberry Pi Diagnostics Strip */}
                                    <div className="rounded-lg bg-secondary/40 border border-border p-3 space-y-2 min-w-0">
                                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                                        <span className="text-muted-foreground break-words min-w-0">
                                          {health.detail || "Waiting for browser or Pi telemetry..."}
                                        </span>
                                        {tel.ipAddress && (
                                          <span className="font-mono text-[11px] text-sky-400 shrink-0">
                                            IP: {tel.ipAddress}
                                          </span>
                                        )}
                                      </div>
                                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-2 border-t border-border/60 text-[11px]">
                                        <div className="min-w-0">
                                          <span className="text-muted-foreground block truncate">Last Ping</span>
                                          <span className="font-mono font-bold block truncate">
                                            {health.browserAgeSec !== null && health.browserAgeSec !== undefined
                                              ? `${health.browserAgeSec}s ago`
                                              : "—"}
                                          </span>
                                        </div>
                                        <div className="min-w-0">
                                          <span className="text-muted-foreground block truncate">Render / Res</span>
                                          <span className="font-mono font-bold block truncate">
                                            {tel.browserFps ? `${tel.browserFps} fps` : "—"}{" "}
                                            {tel.viewport ? `(${tel.viewport})` : ""}
                                          </span>
                                        </div>
                                        <div className="min-w-0">
                                          <span className="text-muted-foreground block truncate">TV Power (CEC)</span>
                                          <span className="font-mono font-bold uppercase block truncate">
                                            {tel.piAgentInstalled
                                              ? tel.tvPowerState || "unknown"
                                              : tel.visibilityState === "visible"
                                                ? "Browser Active"
                                                : "No Pi Agent"}
                                          </span>
                                        </div>
                                        <div className="min-w-0">
                                          <span className="text-muted-foreground block truncate">Pi CPU / Load</span>
                                          <span className="font-mono font-bold block truncate">
                                            {tel.cpuTempC !== null && tel.cpuTempC !== undefined
                                              ? `${tel.cpuTempC}°C • ${tel.loadAvg ?? 0}`
                                              : "—"}
                                          </span>
                                        </div>
                                      </div>
                                    </div>

                                    {/* Headless Kiosk URL (with Secret Token) + Rotate + Open */}
                                    <div className="space-y-1.5 min-w-0">
                                      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                                        <span className="font-semibold flex items-center gap-1">
                                          <KeyRound className="w-3 h-3 text-emerald-400" />
                                          Authenticated Kiosk Boot URL (or open{" "}
                                          <code className="text-sky-400">/display</code> for 6-digit pairing)
                                        </span>
                                        <button
                                          type="button"
                                          onClick={() => handleRotateUnitToken(unit.id, prof.name)}
                                          className="text-amber-400 hover:text-amber-300 font-semibold inline-flex items-center gap-1"
                                          title="Revoke old token/cookie and issue a fresh token for this TV"
                                        >
                                          <RefreshCw className="w-3 h-3" />
                                          Rotate Token
                                        </button>
                                      </div>
                                      <div className="flex flex-wrap sm:flex-nowrap items-center gap-1.5 min-w-0">
                                        <Input
                                          readOnly
                                          value={displayedKioskUrl}
                                          className="h-8 font-mono text-xs min-w-0 flex-1"
                                        />
                                        <div className="flex items-center gap-1.5 shrink-0">
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            className="px-2"
                                            title={isTokenRevealed ? "Hide token" : "Reveal token"}
                                            onClick={() =>
                                              setRevealedTokens((prev) => ({
                                                ...prev,
                                                [unit.id]: !prev[unit.id],
                                              }))
                                            }
                                          >
                                            {isTokenRevealed ? (
                                              <EyeOff className="w-3.5 h-3.5" />
                                            ) : (
                                              <Eye className="w-3.5 h-3.5" />
                                            )}
                                          </Button>
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => {
                                              navigator.clipboard.writeText(kioskTokenUrl);
                                              toast({
                                                title: "Copied Authenticated Kiosk URL (with secret token)!",
                                              });
                                            }}
                                          >
                                            <Copy className="w-3.5 h-3.5" />
                                            Copy
                                          </Button>
                                          <a href={kioskPairingUrl} target="_blank" rel="noreferrer">
                                            <Button size="sm" variant="outline">
                                              <ExternalLink className="w-3.5 h-3.5" />
                                              Open
                                            </Button>
                                          </a>
                                        </div>
                                      </div>
                                    </div>

                                    {/* Per-Display Group, Theme, Scale & Layout Box */}
                                    <div className="rounded-sm bg-secondary/25 border border-border/70 p-3 space-y-2.5 min-w-0">
                                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                                        <div className="space-y-1 min-w-0">
                                          <Label className="text-[11px] block truncate">Display Group</Label>
                                          <Select
                                            value={prof.groupId}
                                            onValueChange={(val) =>
                                              handleUpdateDisplayUnit(
                                                unit.id,
                                                { groupId: val },
                                                "Moved display to group",
                                              )
                                            }
                                          >
                                            <SelectTrigger className="h-8 text-xs w-full min-w-0">
                                              <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                              {groups.map((g) => (
                                                <SelectItem key={g.id} value={g.id}>
                                                  {g.name}
                                                </SelectItem>
                                              ))}
                                            </SelectContent>
                                          </Select>
                                        </div>
                                        <div className="space-y-1 min-w-0">
                                          <Label className="text-[11px] block truncate">Visual Theme</Label>
                                          <Select
                                            value={prof.theme || "inherit"}
                                            onValueChange={(val) =>
                                              handleUpdateDisplayUnit(
                                                unit.id,
                                                { theme: val === "inherit" ? "" : val },
                                                "Updated TV visual theme",
                                              )
                                            }
                                          >
                                            <SelectTrigger
                                              className="h-8 text-xs w-full min-w-0"
                                              data-testid={`select-tv-unit-theme-${unit.id}`}
                                            >
                                              <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                              <SelectItem value="inherit">Inherit Default</SelectItem>
                                              {DISPLAY_THEMES.map((t) => (
                                                <SelectItem key={t.id} value={t.id}>
                                                  <span className="inline-flex items-center gap-1.5">
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
                                        <div className="space-y-1 min-w-0">
                                          <Label className="text-[11px] block truncate">
                                            Text Scale ({Math.round((prof.uiScale || 1) * 100)}%)
                                          </Label>
                                          <Input
                                            type="number"
                                            step="0.05"
                                            min="0.75"
                                            max="1.65"
                                            className="h-8 text-xs w-full font-mono"
                                            value={prof.uiScale}
                                            onChange={(e) =>
                                              updateLocalProf({ uiScale: parseFloat(e.target.value) || 1 })
                                            }
                                          />
                                        </div>
                                        <div className="space-y-1 min-w-0">
                                          <Label className="text-[11px] block truncate">Left Col Width (%)</Label>
                                          <Input
                                            type="number"
                                            min="35"
                                            max="60"
                                            className="h-8 text-xs w-full font-mono"
                                            value={prof.leftColumnWidthPct}
                                            onChange={(e) =>
                                              updateLocalProf({
                                                leftColumnWidthPct: parseInt(e.target.value, 10) || 44,
                                              })
                                            }
                                          />
                                        </div>
                                      </div>

                                      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border/50">
                                        <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                                          <input
                                            type="checkbox"
                                            className="rounded border-border"
                                            checked={Boolean(prof.highContrast)}
                                            onChange={(e) => updateLocalProf({ highContrast: e.target.checked })}
                                          />
                                          <span>High-Contrast Distance Mode</span>
                                        </label>
                                        <Button
                                          size="xs"
                                          onClick={() =>
                                            handleUpdateDisplayUnit(
                                              unit.id,
                                              {
                                                uiScale: prof.uiScale,
                                                leftColumnWidthPct: prof.leftColumnWidthPct,
                                                highContrast: prof.highContrast,
                                              },
                                              `Saved scaling for ${prof.name}`,
                                            )
                                          }
                                        >
                                          Save Layout
                                        </Button>
                                      </div>

                                      {/* Per-TV Map Area Selector (for Built-In Screens S1/S2/S3) */}
                                      {(() => {
                                        const modeKey = prof.mapRegionMode || "auto";
                                        const savedRegs: SavedMapRegion[] =
                                          displayState?.settings?.savedMapRegions || [];
                                        const areaLabel =
                                          modeKey === "auto"
                                            ? "Auto (Corridor / SF Metro)"
                                            : resolveMapViewSpec(
                                                modeKey,
                                                prof.customMapBounds,
                                                savedRegs,
                                                prof.mapEtaHub,
                                              ).shortLabel;
                                        return (
                                          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border/50">
                                            <div className="min-w-0">
                                              <span className="text-[11px] font-semibold text-muted-foreground block">
                                                Map Area (Built-in Screens):
                                              </span>
                                              <span className="text-xs font-mono font-bold text-foreground truncate block">
                                                {areaLabel}
                                              </span>
                                            </div>
                                            <Button
                                              type="button"
                                              size="xs"
                                              variant="secondary"
                                              className="gap-1 border border-primary/40 text-primary hover:bg-primary/15"
                                              onClick={() => setMapAreaModalUnit(unit)}
                                              data-testid={`btn-unit-map-area-${unit.id}`}
                                            >
                                              <Crop className="w-3 h-3" />
                                              Select Map Area…
                                            </Button>
                                          </div>
                                        );
                                      })()}
                                    </div>
                                  </div>

                                  {/* Remote Troubleshooting Box (from SF Office) */}
                                  <div className="rounded-lg bg-secondary/35 border border-border p-3 space-y-2 min-w-0">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                                        Remote Screen & TV Power
                                      </span>
                                      <div className="flex items-center gap-1.5">
                                        <Button
                                          size="xs"
                                          variant="outline"
                                          className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
                                          onClick={() => setPiAgentModalUnit(unit)}
                                        >
                                          <Terminal className="w-3 h-3" />
                                          Pi SSH Deploy
                                        </Button>
                                          <Button
                                            size="xs"
                                            variant="outline"
                                            className="gap-1 px-2 border-destructive/40 text-destructive hover:text-destructive hover:bg-destructive/15"
                                            onClick={() => handleDeleteDisplayUnit(unit.id, prof.name)}
                                            title="Delete display"
                                          >
                                            <Trash2 className="w-3.5 h-3.5" />
                                            Delete TV
                                          </Button>
                                      </div>
                                    </div>

                                    <div className="flex flex-wrap items-center gap-1.5">
                                      <Button
                                        size="xs"
                                        variant={prof.activePanel === "auto" ? "default" : "outline"}
                                        onClick={() => handleRemoteControl("auto", "display", unit.id)}
                                      >
                                        Auto
                                      </Button>
                                      {["screen-1", "screen-2", "screen-3", "screen-4", "screen-5"].map((panelKey) => (
                                        <div key={panelKey} className="inline-flex items-center">
                                          <Button
                                            size="xs"
                                            variant={prof.activePanel === panelKey ? "default" : "outline"}
                                            className="rounded-r-none"
                                            onClick={() =>
                                              handleRemoteControl(panelKey, "display", unit.id)
                                            }
                                            title={`Pin this TV to ${panelKey.replace("screen-", "Screen ")}`}
                                          >
                                            {panelKey.replace("screen-", "S")}
                                          </Button>
                                          <Button
                                            size="xs"
                                            variant={prof.activePanel === panelKey ? "default" : "outline"}
                                            className={`rounded-l-none border-l-0 px-1.5 ${
                                              prof.activePanel === panelKey
                                                ? "border-l border-primary-foreground/25"
                                                : "text-muted-foreground hover:text-primary"
                                            }`}
                                            onClick={() => handleJumpToEditScreen(panelKey)}
                                            title={`Edit ${panelKey.replace("screen-", "Screen ")} layout in place`}
                                            data-testid={`button-tv-edit-${unit.id}-${panelKey}`}
                                          >
                                            <Pencil className="w-3 h-3" />
                                          </Button>
                                        </div>
                                      ))}
                                      {(displayState?.customScreens || [])
                                        .filter((cs: any) => !isBuiltInScreenId(cs.id))
                                        .map((cs: any) => (
                                        <div key={cs.id} className="inline-flex items-center">
                                          <Button
                                            size="xs"
                                            variant={prof.activePanel === cs.id ? "default" : "outline"}
                                            className={`rounded-r-none ${
                                              prof.activePanel === cs.id
                                                ? ""
                                                : "border-purple-500/40 text-purple-300 hover:bg-purple-500/15"
                                            }`}
                                            onClick={() =>
                                              handleRemoteControl(cs.id, "display", unit.id)
                                            }
                                            title={`Pin this TV to custom screen: ${cs.name}`}
                                          >
                                            {cs.badgeLabel || cs.name}
                                          </Button>
                                          <Button
                                            size="xs"
                                            variant={prof.activePanel === cs.id ? "default" : "outline"}
                                            className={`rounded-l-none border-l-0 px-1.5 ${
                                              prof.activePanel === cs.id
                                                ? "border-l border-primary-foreground/25"
                                                : "border-purple-500/40 text-purple-300 hover:bg-purple-500/20"
                                            }`}
                                            onClick={() => handleJumpToEditScreen(cs.id)}
                                            title={`Edit screen layout: ${cs.name}`}
                                            data-testid={`button-tv-edit-screen-${unit.id}-${cs.id}`}
                                          >
                                            <Pencil className="w-3 h-3" />
                                          </Button>
                                        </div>
                                      ))}
                                      <Button
                                        size="xs"
                                        variant="secondary"
                                        onClick={() =>
                                          handleRemoteControl(undefined, "display", unit.id, "reload")
                                        }
                                        title="Reload Chromium browser on this TV"
                                      >
                                        Reload
                                      </Button>
                                      <Button
                                        size="xs"
                                        variant="outline"
                                        onClick={() =>
                                          handleRemoteControl(undefined, "display", unit.id, "tv_on")
                                        }
                                        title="Wake TV via HDMI-CEC + DPMS"
                                      >
                                        TV On
                                      </Button>
                                      <Button
                                        size="xs"
                                        variant="outline"
                                        onClick={() =>
                                          handleRemoteControl(undefined, "display", unit.id, "tv_standby")
                                        }
                                        title="Put TV in Standby via HDMI-CEC + DPMS"
                                      >
                                        TV Off
                                      </Button>
                                    </div>

                                    {/* Per-TV Power Schedule Mode & Optional Custom Hours */}
                                    {(() => {
                                      const unitMode: UnitPowerScheduleMode =
                                        prof.powerScheduleMode === "custom" ||
                                        prof.powerScheduleMode === "always_on"
                                          ? prof.powerScheduleMode
                                          : "company";
                                      const companySched = normalizeTvPowerSchedule(
                                        displayState?.settings?.powerSchedule,
                                        DEFAULT_TV_POWER_SCHEDULE,
                                      );
                                      const unitCustomSched = normalizeTvPowerSchedule(
                                        prof.powerSchedule,
                                        { ...companySched, enabled: true },
                                      );
                                      const liveUnitEval =
                                        unit.powerEval ||
                                        evaluateTvPowerSchedule(companySched, prof, new Date());

                                      const toggleUnitDay = (dayIndex: number) => {
                                        const exists = unitCustomSched.activeDays.includes(dayIndex);
                                        const nextDays = exists
                                          ? unitCustomSched.activeDays.filter((d) => d !== dayIndex)
                                          : [...unitCustomSched.activeDays, dayIndex].sort(
                                              (a, b) => a - b,
                                            );
                                        updateLocalProf({
                                          powerSchedule: { ...unitCustomSched, activeDays: nextDays },
                                        });
                                      };

                                      return (
                                        <div className="pt-2.5 mt-1 border-t border-border/60 space-y-2">
                                          <div className="flex flex-wrap items-center justify-between gap-2">
                                            <div className="flex flex-wrap items-center gap-2 min-w-0">
                                              <span className="text-[11px] font-semibold text-muted-foreground inline-flex items-center gap-1">
                                                <Clock className="w-3 h-3 text-primary" />
                                                Power Schedule:
                                              </span>
                                              <Select
                                                value={unitMode}
                                                onValueChange={(val: UnitPowerScheduleMode) => {
                                                  const seededCustom = normalizeTvPowerSchedule(
                                                    prof.powerSchedule,
                                                    { ...companySched, enabled: true },
                                                  );
                                                  updateLocalProf({
                                                    powerScheduleMode: val,
                                                    ...(val === "custom"
                                                      ? { powerSchedule: seededCustom }
                                                      : {}),
                                                  });
                                                  handleUpdateDisplayUnit(
                                                    unit.id,
                                                    {
                                                      powerScheduleMode: val,
                                                      ...(val === "custom"
                                                        ? { powerSchedule: seededCustom }
                                                        : {}),
                                                      powerOverride: null,
                                                    },
                                                    `Updated power schedule mode for ${prof.name}`,
                                                  );
                                                }}
                                              >
                                                <SelectTrigger
                                                  className="h-7 w-[195px] text-xs font-medium"
                                                  data-testid={`select-unit-power-mode-${unit.id}`}
                                                >
                                                  <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                  <SelectItem value="company">
                                                    Follow Company Schedule
                                                  </SelectItem>
                                                  <SelectItem value="custom">
                                                    Custom Hours for This TV
                                                  </SelectItem>
                                                  <SelectItem value="always_on">
                                                    Always On (24/7)
                                                  </SelectItem>
                                                </SelectContent>
                                              </Select>
                                            </div>

                                            <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono">
                                              <span
                                                className={
                                                  liveUnitEval.isScheduledSleep
                                                    ? "text-indigo-300"
                                                    : "text-muted-foreground"
                                                }
                                              >
                                                {liveUnitEval.statusSummary}
                                              </span>
                                              {liveUnitEval.hasManualOverride && (
                                                <button
                                                  type="button"
                                                  onClick={() =>
                                                    handleRemoteControl(
                                                      undefined,
                                                      "display",
                                                      unit.id,
                                                      "clear_power_override",
                                                    )
                                                  }
                                                  className="px-1.5 py-0.5 rounded border border-amber-500/40 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 font-sans font-semibold text-[10px]"
                                                  title="Clear temporary manual override and resume automatic schedule"
                                                >
                                                  Resume Schedule
                                                </button>
                                              )}
                                            </div>
                                          </div>

                                          {unitMode === "custom" && (
                                            <div className="flex flex-wrap items-center justify-between gap-2 rounded bg-background/60 border border-border p-2">
                                              <div className="flex flex-wrap items-center gap-2">
                                                <div className="inline-flex items-center gap-1">
                                                  <span className="text-[10px] font-mono uppercase text-muted-foreground">
                                                    ON
                                                  </span>
                                                  <Input
                                                    type="time"
                                                    className="h-7 w-[108px] text-xs font-mono px-2"
                                                    value={unitCustomSched.onTime}
                                                    onChange={(e) =>
                                                      updateLocalProf({
                                                        powerSchedule: {
                                                          ...unitCustomSched,
                                                          onTime: e.target.value,
                                                        },
                                                      })
                                                    }
                                                  />
                                                </div>
                                                <div className="inline-flex items-center gap-1">
                                                  <span className="text-[10px] font-mono uppercase text-muted-foreground">
                                                    OFF
                                                  </span>
                                                  <Input
                                                    type="time"
                                                    className="h-7 w-[108px] text-xs font-mono px-2"
                                                    value={unitCustomSched.offTime}
                                                    onChange={(e) =>
                                                      updateLocalProf({
                                                        powerSchedule: {
                                                          ...unitCustomSched,
                                                          offTime: e.target.value,
                                                        },
                                                      })
                                                    }
                                                  />
                                                </div>
                                                <div className="flex items-center gap-0.5">
                                                  {TV_POWER_WEEKDAYS.map((d) => {
                                                    const active = unitCustomSched.activeDays.includes(
                                                      d.day,
                                                    );
                                                    return (
                                                      <button
                                                        key={d.day}
                                                        type="button"
                                                        title={d.label}
                                                        onClick={() => toggleUnitDay(d.day)}
                                                        className={`h-7 px-1.5 rounded-sm border text-[10px] font-mono font-bold transition-colors ${
                                                          active
                                                            ? "bg-primary text-primary-foreground border-primary"
                                                            : "bg-secondary/40 text-muted-foreground border-border"
                                                        }`}
                                                      >
                                                        {d.short.slice(0, 2)}
                                                      </button>
                                                    );
                                                  })}
                                                </div>
                                              </div>

                                              <Button
                                                size="xs"
                                                onClick={() =>
                                                  handleUpdateDisplayUnit(
                                                    unit.id,
                                                    {
                                                      powerScheduleMode: "custom",
                                                      powerSchedule: {
                                                        ...unitCustomSched,
                                                        enabled: true,
                                                        timezone: companySched.timezone,
                                                      },
                                                      powerOverride: null,
                                                    },
                                                    `Saved custom hours for ${prof.name}`,
                                                  )
                                                }
                                              >
                                                Save Hours
                                              </Button>
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })()}
                                  </div>
                                  </div>
                                )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </section>
                    );
                  })}
                </>
              );
            })()}
          </TabsContent>
          )}

          {/* =============================================================== */}
          {/* TAB 1B: CUSTOM SCREEN DESIGNER & PLAYLIST STUDIO                */}
          {/* =============================================================== */}
          <TabsContent value="screen-studio" className="space-y-6">
            <ScreenDesignerStudio
              displayState={displayState}
              mapHomeLocations={mapHomeLocations}
              editScreenRequest={editScreenRequest}
              onStateUpdated={(nextState) => setDisplayState(nextState)}
              onRemoteControl={handleRemoteControl}
            />
          </TabsContent>

          {/* =============================================================== */}
          {/* TAB 1C: TEAM EVENTS & EMPLOYEE FAMILY PHOTO GALLERY             */}
          {/* =============================================================== */}
          <TabsContent value="photo-gallery" className="space-y-6">
            <PhotoGalleryManager
              displayState={displayState}
              defaultAuthorName={currentUser?.displayName || currentUser?.username || "Team"}
              onStateUpdated={(nextState) => setDisplayState(nextState)}
            />
          </TabsContent>

          {/* =============================================================== */}
          {/* TAB 2: ANNOUNCEMENTS & CRM JSON WEBHOOK                         */}
          {/* =============================================================== */}
          <TabsContent value="announcements" className="space-y-6">
            <div className={`grid gap-6 ${showTechnicalControls ? "md:grid-cols-2" : "grid-cols-1"}`}>
              {/* Post New Broadcast */}
              <div className="rounded-xl border border-border bg-card p-5 space-y-4 min-w-0 overflow-hidden">
                <div>
                  <h2 className="text-base font-bold flex items-center gap-2">
                    <Megaphone className="w-4 h-4 text-sky-400 shrink-0" />
                    Post Announcement to All TVs
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Target dates automatically show live countdowns on Screen 4 & announcement cards, escalating to the Cross-Screen Spotlight Ribbon when ≤ 3 days away.
                  </p>
                </div>
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Author / Sender Name</Label>
                      <Input
                        value={newAuthor}
                        onChange={(e) => setNewAuthor(e.target.value)}
                        placeholder="e.g., Jackie, Dispatch, Management"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Priority / Escalation</Label>
                      <Select
                        value={newMsgPriority}
                        onValueChange={(v) => setNewMsgPriority(v as "normal" | "important" | "urgent")}
                      >
                        <SelectTrigger className="h-9 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="normal">Normal Bulletin</SelectItem>
                          <SelectItem value="important">Important (Auto-Escalates Near Date)</SelectItem>
                          <SelectItem value="urgent">🚨 Urgent — Spotlight Across All Screens</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">Announcement Message</Label>
                    <Textarea
                      rows={3}
                      value={newMessageText}
                      onChange={(e) => setNewMessageText(e.target.value)}
                      placeholder="Type announcement to broadcast immediately (e.g., Christmas Party Friday Dec 4th — RSVP by Nov 25th)..."
                    />
                    {(() => {
                      const detected = extractDatesFromMessageText(newMessageText);
                      if (detected.length === 0 || newMsgEventDate) return null;
                      const firstIso = detected[0];
                      const human = formatShortHumanDate(firstIso) || firstIso;
                      return (
                        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sky-500/30 bg-sky-500/10 px-2.5 py-1.5 text-xs text-sky-200">
                          <span className="inline-flex items-center gap-1.5">
                            <Sparkles className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                            <span>
                              Smart Date Detected: <strong>{human}</strong> (TVs will count down automatically)
                            </span>
                          </span>
                          <Button
                            type="button"
                            size="xs"
                            variant="outline"
                            className="h-6 text-[11px] border-sky-400/40 text-sky-200 hover:bg-sky-500/20"
                            onClick={() => setNewMsgEventDate(firstIso)}
                          >
                            Use {human} as Target Date
                          </Button>
                        </div>
                      );
                    })()}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-lg border border-border/70 bg-secondary/20 p-3">
                    <div className="space-y-1">
                      <Label className="text-xs flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-amber-400" />
                        Event / Deadline Date (Optional)
                      </Label>
                      <div className="flex items-center gap-1.5">
                        <Input
                          type="date"
                          value={newMsgEventDate}
                          onChange={(e) => setNewMsgEventDate(e.target.value)}
                          className="h-8 text-xs"
                        />
                        {newMsgEventDate && (
                          <Button
                            type="button"
                            size="xs"
                            variant="ghost"
                            className="h-8 px-2 text-xs text-muted-foreground"
                            onClick={() => setNewMsgEventDate("")}
                          >
                            Clear
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Countdown Label (Optional)</Label>
                      <Input
                        value={newMsgEventLabel}
                        onChange={(e) => setNewMsgEventLabel(e.target.value)}
                        placeholder="e.g., RSVP Deadline, Party Date"
                        className="h-8 text-xs"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                    <div className="flex flex-col gap-1.5">
                      <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={newMsgAutoArchive}
                          onChange={(e) => setNewMsgAutoArchive(e.target.checked)}
                        />
                        Auto-archive off TV rotation once target date passes
                      </label>
                      <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={replaceExistingMsg}
                          onChange={(e) => setReplaceExistingMsg(e.target.checked)}
                        />
                        Replace all existing announcements
                      </label>
                    </div>
                    <Button onClick={handlePostAnnouncement} className="gap-1.5">
                      <Send className="w-4 h-4" />
                      Broadcast Now
                    </Button>
                  </div>
                </div>
              </div>

              {/* CRM JSON Webhook Endpoint Info (Technical Admin Only) */}
              {showTechnicalControls && (
              <div className="rounded-xl border border-border bg-card p-5 space-y-3.5 min-w-0 overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-base font-bold flex items-center gap-2">
                    <Lock className="w-4 h-4 text-emerald-400 shrink-0" />
                    CRM Software JSON Webhook (Protected)
                  </h2>
                  <Button
                    variant="outline"
                    size="xs"
                    className="gap-1 text-amber-400 border-amber-500/30 hover:bg-amber-500/10"
                    onClick={handleRotateWebhookKey}
                  >
                    <RefreshCw className="w-3 h-3" />
                    Rotate API Key
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Requests to <code className="text-sky-400">/api/webhook/messages</code> require your secret{" "}
                  <code className="text-emerald-400">X-API-Key</code> header (unauthorized internet posts are rejected with 401):
                </p>
                <div className="space-y-1.5">
                  <Label className="text-[11px] text-muted-foreground">Endpoint URL</Label>
                  <div className="flex items-center gap-2 min-w-0">
                    <Input
                      readOnly
                      value={`${originUrl}/api/webhook/messages`}
                      className="h-8 font-mono text-xs min-w-0 flex-1"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={() => {
                        navigator.clipboard.writeText(`${originUrl}/api/webhook/messages`);
                        toast({ title: "Copied CRM Webhook URL!" });
                      }}
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[11px] text-muted-foreground">Required Header: X-API-Key</Label>
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Input
                      readOnly
                      value={
                        displayState?.settings?.webhookApiKey
                          ? showWebhookKey
                            ? displayState.settings.webhookApiKey
                            : `${String(displayState.settings.webhookApiKey).slice(0, 8)}••••••••••••••••`
                          : "Loading..."
                      }
                      className="h-8 font-mono text-xs min-w-0 flex-1"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="px-2 shrink-0"
                      onClick={() => setShowWebhookKey((s) => !s)}
                    >
                      {showWebhookKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={() => {
                        if (displayState?.settings?.webhookApiKey) {
                          navigator.clipboard.writeText(displayState.settings.webhookApiKey);
                          toast({ title: "Copied CRM Webhook X-API-Key!" });
                        }
                      }}
                    >
                      <Copy className="w-3.5 h-3.5" />
                      Copy Key
                    </Button>
                  </div>
                </div>

                <pre className="p-3 rounded-lg bg-secondary/60 border border-border text-xs font-mono overflow-x-auto">
{`POST /api/webhook/messages
Content-Type: application/json
X-API-Key: ${showWebhookKey && displayState?.settings?.webhookApiKey ? displayState.settings.webhookApiKey : "<your-x-api-key>"}

{
  "author": "Jackie",
  "message": "Christmas Party Friday Dec 4th...",
  "eventDate": "2026-11-25",
  "eventLabel": "RSVP Deadline",
  "priority": "important",
  "autoArchive": true,
  "replace": false
}`}
                </pre>
              </div>
              )}
            </div>

            {/* Active Announcements List */}
            <div className="rounded-xl border border-border bg-card p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-bold text-sm">Active & Recent Announcements</h3>
                  <p className="text-xs text-muted-foreground">
                    Adjust target countdown dates or priority at any time — changes push live to all TV displays immediately.
                  </p>
                </div>
              </div>
              <div className="space-y-2.5">
                {(displayState?.messages || []).map((m: any) => {
                  const info = evaluateAnnouncementUrgency(m);
                  const isHiddenFromTv = m.active === false || info.isAutoArchived;

                  const badgeStyle = info.isAutoArchived
                    ? "bg-slate-500/20 text-slate-300 border-slate-500/40"
                    : info.tier === "today" || info.tier === "overdue"
                      ? "bg-rose-500/20 text-rose-300 border-rose-500/50"
                      : info.tier === "imminent"
                        ? "bg-amber-500/20 text-amber-300 border-amber-500/50"
                        : info.tier === "this_week"
                          ? "bg-yellow-500/20 text-yellow-200 border-yellow-500/40"
                          : "bg-sky-500/15 text-sky-300 border-sky-500/35";

                  return (
                    <div
                      key={m.id}
                      className={`flex flex-col gap-3 p-3.5 rounded-lg border transition-colors ${
                        isHiddenFromTv
                          ? "border-border/60 bg-secondary/10 opacity-75"
                          : info.tier === "today"
                            ? "border-rose-500/45 bg-rose-500/5"
                            : info.tier === "imminent"
                              ? "border-amber-500/45 bg-amber-500/5"
                              : "border-border bg-secondary/20"
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-bold text-sm">{m.author}</span>
                            <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-primary/15 text-primary">
                              {m.source || "CRM"}
                            </span>
                            <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border ${badgeStyle}`}>
                              {info.isAutoArchived ? (
                                <>
                                  <Archive className="w-3 h-3" />
                                  Auto-Archived (Past {info.formattedDate || "Date"})
                                </>
                              ) : (
                                <>
                                  {(info.tier === "today" || info.tier === "imminent") && (
                                    <Flame className="w-3 h-3" />
                                  )}
                                  {m.eventLabel ? `${m.eventLabel}: ` : ""}
                                  {info.badgeText}
                                  {info.formattedDate ? ` • ${info.formattedDate}` : ""}
                                  {info.inferredFromText ? " (Auto-Detected)" : ""}
                                </>
                              )}
                            </span>
                            {m.active === false && (
                              <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded bg-muted text-muted-foreground">
                                Manually Hidden
                              </span>
                            )}
                            <span className="text-xs text-muted-foreground">{m.timestamp}</span>
                          </div>
                          <p className={`text-sm break-words ${isHiddenFromTv ? "line-through opacity-60" : ""}`}>
                            {m.message}
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          {info.isAutoArchived && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 text-xs border-amber-500/40 text-amber-300 hover:bg-amber-500/15"
                              onClick={() =>
                                handlePatchMessage(
                                  m.id,
                                  { autoArchive: false, active: true },
                                  "Announcement restored to active TV rotation",
                                )
                              }
                            >
                              Keep on TV
                            </Button>
                          )}
                          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => handleToggleMessage(m)}>
                            {m.active === false ? "Show on TV" : "Hide"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive"
                            onClick={() => handleDeleteMessage(m.id)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>

                      {/* Quick Inline Escalation & Target Date Controls */}
                      <div className="flex flex-wrap items-center gap-2.5 pt-2 border-t border-border/50 text-xs">
                        <div className="inline-flex items-center gap-1.5">
                          <span className="text-muted-foreground font-medium">Priority:</span>
                          {(["normal", "important", "urgent"] as const).map((pKey) => {
                            const activeP = (m.priority || "important") === pKey;
                            return (
                              <button
                                key={pKey}
                                type="button"
                                onClick={() =>
                                  handlePatchMessage(m.id, { priority: pKey }, `Priority set to ${pKey}`)
                                }
                                className={`px-2 py-0.5 rounded border text-[11px] font-semibold capitalize transition-colors ${
                                  activeP
                                    ? pKey === "urgent"
                                      ? "bg-rose-500/25 border-rose-500/60 text-rose-200"
                                      : pKey === "important"
                                        ? "bg-sky-500/25 border-sky-500/60 text-sky-200"
                                        : "bg-secondary border-foreground/30 text-foreground"
                                    : "border-border/70 text-muted-foreground hover:text-foreground"
                                }`}
                              >
                                {pKey === "urgent" ? "🚨 Urgent" : pKey}
                              </button>
                            );
                          })}
                        </div>

                        <div className="inline-flex items-center gap-1.5">
                          <span className="text-muted-foreground font-medium">Target Date:</span>
                          <Input
                            type="date"
                            value={m.eventDateISO || ""}
                            onChange={(e) =>
                              handlePatchMessage(
                                m.id,
                                { eventDateISO: e.target.value || "" },
                                e.target.value ? "Updated countdown target date" : "Cleared explicit target date",
                              )
                            }
                            className="h-7 w-36 text-xs px-2"
                          />
                          {m.eventDateISO && (
                            <button
                              type="button"
                              onClick={() =>
                                handlePatchMessage(m.id, { eventDateISO: "" }, "Reverted to smart text date detection")
                              }
                              className="text-[11px] text-muted-foreground hover:text-foreground underline"
                            >
                              Clear
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </TabsContent>

          {/* =============================================================== */}
          {/* TAB 3: MONTHLY TRUCK SCHEDULE EDITOR (1 WEEK VIEW + HISTORY)    */}
          {/* =============================================================== */}
          <TabsContent value="truck-schedule" className="space-y-5">
            {/* Top Header & Save Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
              <div className="min-w-0">
                <h2 className="font-bold text-base flex items-center gap-2">
                  <Truck className="w-5 h-5 text-sky-400" />
                  Monthly Truck Route Schedule & History
                </h2>
                <p className="text-xs text-muted-foreground">
                  Fill out an entire month week-by-week, browse past weeks anytime, and edit live. TV displays automatically show the active week!
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRouteTerritoriesDialogOpen(true)}
                  className="gap-1.5 border-sky-500/40 text-sky-300 hover:bg-sky-500/10"
                  data-testid="button-open-route-territories"
                >
                  <Paintbrush className="w-4 h-4 text-sky-400" />
                  Route Map Colors &amp; Towns ({(displayState?.routeTerritories || []).length || 23})
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const firstDriver = selectedTruckWeek.rows?.[0]?.driver || "__ALL__";
                    setRouteManagerTargetDriver(firstDriver);
                    setRouteManagerOpen(true);
                  }}
                  className="gap-1.5"
                >
                  <ListPlus className="w-4 h-4 text-sky-400" />
                  Driver Routes ({normalizedTruckSchedule.routeOptions.length})
                </Button>
                <Button
                  size="sm"
                  onClick={() =>
                    saveSchedulesPayload(
                      { truckSchedule: normalizedTruckSchedule },
                      "Monthly truck schedule saved & synced to TVs!",
                    )
                  }
                  disabled={savingSchedules}
                >
                  {savingSchedules ? "Saving..." : "Save Schedule Changes"}
                </Button>
              </div>
            </div>

            {/* Month Navigator + Week Pills Strip */}
            <div className="rounded-xl border border-border bg-card p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                {/* Month & Year Controls */}
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => handleShiftMonth(-1)}
                    title="Previous Month"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </Button>

                  <Select
                    value={String(viewMonth0)}
                    onValueChange={(val) => handleSelectMonthYear(viewYear, Number(val))}
                  >
                    <SelectTrigger className="h-8 w-[140px] text-xs font-bold">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[
                        "January",
                        "February",
                        "March",
                        "April",
                        "May",
                        "June",
                        "July",
                        "August",
                        "September",
                        "October",
                        "November",
                        "December",
                      ].map((mName, idx) => (
                        <SelectItem key={mName} value={String(idx)}>
                          {mName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select
                    value={String(viewYear)}
                    onValueChange={(val) => handleSelectMonthYear(Number(val), viewMonth0)}
                  >
                    <SelectTrigger className="h-8 w-[92px] text-xs font-mono font-bold">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 7 }, (_, i) => new Date().getFullYear() - 3 + i).map((yr) => (
                        <SelectItem key={yr} value={String(yr)}>
                          {yr}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => handleShiftMonth(1)}
                    title="Next Month"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>

                {/* History / Today Jump */}
                <div className="flex flex-wrap items-center gap-2">
                  {selectedMondayIso !== liveMondayIso && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={handleJumpToCurrentWeek}
                      className="h-8 gap-1.5 text-xs"
                    >
                      <History className="w-3.5 h-3.5 text-emerald-400" />
                      Jump to Live TV Week ({buildShortWeekRange(liveMondayIso)})
                    </Button>
                  )}
                  <span className="text-xs text-muted-foreground">
                    Showing <strong>1 week at a time</strong> ({monthMondays.length} weeks in month)
                  </span>
                </div>
              </div>

              {/* Week Selector Pills for the Selected Month */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                {monthMondays.map((monIso, wIdx) => {
                  const isSelected = monIso === selectedMondayIso;
                  const isLive = monIso === liveMondayIso;
                  const isPast = monIso < liveMondayIso;
                  const savedBlock = normalizedTruckSchedule.weeks[monIso];
                  const assignedCount = countAssignedCells(savedBlock);

                  return (
                    <button
                      key={monIso}
                      type="button"
                      onClick={() => setSelectedMondayIso(monIso)}
                      className={`rounded-lg border p-2.5 text-left transition-all flex flex-col justify-between gap-1.5 ${
                        isSelected
                          ? "border-primary bg-primary/15 ring-1 ring-primary/40 shadow-sm"
                          : "border-border bg-secondary/20 hover:bg-secondary/40 hover:border-border"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                          Week {wIdx + 1}
                        </span>
                        {isLive ? (
                          <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[9px] font-extrabold uppercase">
                            Live on TV
                          </span>
                        ) : isPast ? (
                          <span className="px-1.5 py-0.5 rounded bg-secondary text-muted-foreground text-[9px] font-mono uppercase">
                            History
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300 text-[9px] font-mono uppercase">
                            Upcoming
                          </span>
                        )}
                      </div>
                      <div className="font-mono font-bold text-xs text-foreground">
                        {buildShortWeekRange(monIso)}
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px]">
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            assignedCount > 0 ? "bg-emerald-400" : "bg-muted-foreground/40"
                          }`}
                        />
                        <span
                          className={
                            assignedCount > 0
                              ? "text-emerald-300 font-medium"
                              : "text-muted-foreground"
                          }
                        >
                          {assignedCount > 0 ? `${assignedCount} routes set` : "Not filled yet"}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Single Active Week Editor Card */}
            <div className="rounded-xl border border-border bg-card p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-border/60">
                <div className="flex flex-wrap items-center gap-2.5">
                  <div className="inline-flex items-center rounded-lg border border-border bg-secondary/30 p-0.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleStepWeek(-1)}
                      className="h-7 px-2 text-xs gap-1"
                      title="View Previous Week"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                      Prev Week
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleStepWeek(1)}
                      className="h-7 px-2 text-xs gap-1"
                      title="View Next Week"
                    >
                      Next Week
                      <ChevronRight className="w-3.5 h-3.5" />
                    </Button>
                  </div>

                  <Input
                    value={selectedTruckWeek.label || ""}
                    onChange={(e) =>
                      updateSelectedTruckWeek({ ...selectedTruckWeek, label: e.target.value })
                    }
                    className="w-64 sm:w-72 h-8 text-sm font-semibold"
                  />

                  {selectedMondayIso === liveMondayIso && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/35 text-emerald-300 text-xs font-bold">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      Active TV Week
                    </span>
                  )}
                  {selectedMondayIso < liveMondayIso && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-secondary border border-border text-muted-foreground text-xs font-medium">
                      Historical Week Archive
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCopyPreviousWeekIntoSelected}
                    className="h-8 text-xs gap-1.5"
                    title="Copy drivers and Mon–Fri routes from the immediately preceding week"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    Copy Prev Week
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleClearSelectedWeekRoutes}
                    className="h-8 text-xs text-muted-foreground hover:text-destructive"
                  >
                    Clear Week
                  </Button>
                </div>
              </div>

              {/* Motive Unit Autocomplete Datalist */}
              <datalist id="motive-fleet-units">
                {vehicles.map((v) => (
                  <option key={v.vehicleId} value={v.name} />
                ))}
              </datalist>

              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border bg-secondary/20">
                      <th className="text-left p-2 w-52 text-xs uppercase tracking-wider text-muted-foreground">
                        Driver & Assigned Routes
                      </th>
                      <th className="text-left p-2 w-28 text-xs uppercase tracking-wider text-muted-foreground">
                        Motive Unit
                      </th>
                      {(selectedTruckWeek.days || []).map((d, dIdx) => (
                        <th key={dIdx} className="p-2 text-center min-w-[145px]">
                          <div className="font-bold text-xs text-foreground">{d.day}</div>
                          <div className="text-[11px] font-mono text-muted-foreground mt-0.5">
                            {d.date}
                          </div>
                        </th>
                      ))}
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {(selectedTruckWeek.rows || []).map((row, rIdx) => {
                      const drvRoutes = getRoutesForDriver(
                        normalizedTruckSchedule,
                        row.driver,
                      );
                      return (
                        <tr key={rIdx} className="border-b border-border/60 hover:bg-secondary/10">
                          <td className="p-1.5">
                            <div className="flex items-center gap-1.5">
                              <input
                                type="color"
                                value={row.color || "#38bdf8"}
                                onChange={(e) => {
                                  const rows = [...selectedTruckWeek.rows];
                                  rows[rIdx] = { ...rows[rIdx], color: e.target.value };
                                  updateSelectedTruckWeek({ ...selectedTruckWeek, rows }, true);
                                }}
                                className="w-6 h-7 rounded cursor-pointer bg-transparent shrink-0"
                              />
                              <Input
                                value={row.driver}
                                onChange={(e) => {
                                  const oldDriver = row.driver;
                                  const newDriver = e.target.value;
                                  const rows = [...selectedTruckWeek.rows];
                                  rows[rIdx] = { ...rows[rIdx], driver: newDriver };
                                  setDisplayState((prev: any) => {
                                    const currentNorm = normalizeTruckScheduleState(prev?.truckSchedule);
                                    const nextDriverRoutes = { ...currentNorm.driverRoutes };
                                    if (
                                      oldDriver &&
                                      newDriver &&
                                      oldDriver !== newDriver &&
                                      nextDriverRoutes[oldDriver] &&
                                      !nextDriverRoutes[newDriver]
                                    ) {
                                      nextDriverRoutes[newDriver] = nextDriverRoutes[oldDriver];
                                      delete nextDriverRoutes[oldDriver];
                                    }
                                    const nextWeeks = {
                                      ...currentNorm.weeks,
                                      [selectedMondayIso]: {
                                        ...selectedTruckWeek,
                                        rows,
                                        weekStartISO: selectedMondayIso,
                                      },
                                    };
                                    return {
                                      ...prev,
                                      truckSchedule: normalizeTruckScheduleState({
                                        ...currentNorm,
                                        weeks: nextWeeks,
                                        driverRoutes: nextDriverRoutes,
                                        driverRoster: rows.map((r) => ({
                                          driver: r.driver,
                                          vehicleKey: r.vehicleKey,
                                          color: r.color || "#38bdf8",
                                        })),
                                      }),
                                    };
                                  });
                                }}
                                className="h-8 text-xs font-bold flex-1 min-w-[105px]"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  setRouteManagerTargetDriver(row.driver);
                                  setRouteManagerOpen(true);
                                }}
                                className={`px-2 py-1 rounded-md border text-[10px] font-mono font-bold shrink-0 transition-colors ${
                                  drvRoutes.isDriverScoped
                                    ? "border-sky-500/35 bg-sky-500/15 text-sky-300 hover:bg-sky-500/25"
                                    : "border-border bg-secondary/40 text-muted-foreground hover:text-foreground"
                                }`}
                                title={`Assign specific routes to ${row.driver}`}
                              >
                                {drvRoutes.isDriverScoped
                                  ? `${drvRoutes.assignedCount} rts`
                                  : "All"}
                              </button>
                            </div>
                          </td>
                          <td className="p-1.5">
                            <Input
                              list="motive-fleet-units"
                              value={row.vehicleKey || ""}
                              onChange={(e) => {
                                const rows = [...selectedTruckWeek.rows];
                                rows[rIdx] = { ...rows[rIdx], vehicleKey: e.target.value };
                                updateSelectedTruckWeek({ ...selectedTruckWeek, rows }, true);
                              }}
                              placeholder="e.g. T01"
                              className="h-8 text-xs font-mono"
                            />
                          </td>
                          {(row.days || []).map((val: string, cIdx: number) => (
                            <td key={cIdx} className="p-1.5">
                              <RouteCellPicker
                                value={val}
                                driverName={row.driver}
                                driverRouteOptions={drvRoutes.options}
                                allRouteOptions={normalizedTruckSchedule.routeOptions}
                                isDriverScoped={drvRoutes.isDriverScoped}
                                accentColor={row.color || "#38bdf8"}
                                onChange={(nextVal) => {
                                  const rows = [...selectedTruckWeek.rows];
                                  const nextCells = [...rows[rIdx].days];
                                  nextCells[cIdx] = nextVal;
                                  rows[rIdx] = { ...rows[rIdx], days: nextCells };
                                  updateSelectedTruckWeek({ ...selectedTruckWeek, rows });
                                }}
                                onAddRouteToDriver={(newRt) => handleAddSavedRoute(newRt, row.driver)}
                                onOpenDriverRoutesModal={() => {
                                  setRouteManagerTargetDriver(row.driver);
                                  setRouteManagerOpen(true);
                                }}
                              />
                            </td>
                          ))}
                          <td className="p-1 text-center">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive"
                              onClick={() => {
                                const rows = selectedTruckWeek.rows.filter((_, i) => i !== rIdx);
                                updateSelectedTruckWeek({ ...selectedTruckWeek, rows }, true);
                              }}
                              title="Remove Driver Row"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const rows = [
                      ...(selectedTruckWeek.rows || []),
                      {
                        driver: "New Driver",
                        vehicleKey: "",
                        color: "#38bdf8",
                        days: ["", "", "", "", ""],
                      },
                    ];
                    updateSelectedTruckWeek({ ...selectedTruckWeek, rows }, true);
                  }}
                  className="gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Driver Row
                </Button>

                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground shrink-0">TV Footer Note:</Label>
                  <Input
                    value={selectedTruckWeek.notes || ""}
                    onChange={(e) =>
                      updateSelectedTruckWeek({ ...selectedTruckWeek, notes: e.target.value })
                    }
                    placeholder="e.g. Have a great week!"
                    className="w-64 h-8 text-xs"
                  />
                </div>
              </div>
            </div>
          </TabsContent>

          {/* =============================================================== */}
          {/* TAB 3B: HOT SHOT SHEET PDF UPLOAD & ONE-TIME DISPATCH ROUTES    */}
          {/* =============================================================== */}
          <TabsContent value="hotshots" className="space-y-6">
            <HotShotManager
              displayState={displayState}
              vehiclesMeta={vehicles}
              liveVehicles={liveVehicles}
              sfWarehouse={sfWarehouseForHotShots}
              mainWarehouse={mainWarehouseForHotShots}
              onStateUpdated={(nextState) => setDisplayState(nextState)}
              onPinHotShotsScreen={() => handleRemoteControl("screen-5", "all", "all")}
            />
          </TabsContent>

          {/* =============================================================== */}
          {/* TAB 4: SIOUX FALLS TEAM SCHEDULE (MONTHLY + DROPDOWNS + BRUSH)  */}
          {/* =============================================================== */}
          <TabsContent value="sf-schedule" className="space-y-6">
            {/* Monthly Navigator & Week Selector Header Card */}
            <div className="rounded-xl border border-border bg-card p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="font-bold text-base flex items-center gap-2">
                    <Users className="w-4 h-4 text-emerald-400" />
                    Monthly Sioux Falls Team Schedule & History (Mon – Sat)
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Plan the full month week-by-week, browse past weeks, use per-box shift dropdowns or Quick-Fill Brush, and track 2+ Opener / 2+ Closer staffing.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const firstMember =
                        selectedSfWeek.rows[0]?.name ||
                        normalizedSfSchedule.memberRoster[0]?.name ||
                        "__ALL__";
                      setSfShiftManagerTargetMember(firstMember);
                      setSfShiftManagerOpen(true);
                    }}
                    className="gap-1.5"
                  >
                    <ListPlus className="w-4 h-4 text-emerald-400" />
                    Member Shifts
                  </Button>
                  <Button
                    onClick={() => {
                      const warnCount = sfWeekCoverage.warnings.length;
                      saveSchedulesPayload(
                        { sfSchedule: normalizedSfSchedule },
                        warnCount > 0
                          ? `SF Schedule saved (${warnCount} day${warnCount > 1 ? "s" : ""} below 2 Openers/Closers)`
                          : "SF Schedule saved & pushed to TVs!",
                      );
                    }}
                    disabled={savingSchedules}
                  >
                    {savingSchedules ? "Saving..." : "Save SF Schedule"}
                  </Button>
                </div>
              </div>

              {/* Month / Year Bar + Quick Jump Controls */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-border/60">
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => handleShiftSfMonth(-1)}
                    title="Previous Month"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </Button>

                  <Select
                    value={String(sfViewMonth0)}
                    onValueChange={(val) => handleSelectSfMonthYear(sfViewYear, Number(val))}
                  >
                    <SelectTrigger className="h-8 w-[132px] text-xs font-bold">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[
                        "January",
                        "February",
                        "March",
                        "April",
                        "May",
                        "June",
                        "July",
                        "August",
                        "September",
                        "October",
                        "November",
                        "December",
                      ].map((mName, idx) => (
                        <SelectItem key={mName} value={String(idx)}>
                          {mName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select
                    value={String(sfViewYear)}
                    onValueChange={(val) => handleSelectSfMonthYear(Number(val), sfViewMonth0)}
                  >
                    <SelectTrigger className="h-8 w-[92px] text-xs font-mono font-bold">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 7 }, (_, i) => new Date().getFullYear() - 3 + i).map((yr) => (
                        <SelectItem key={yr} value={String(yr)}>
                          {yr}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => handleShiftSfMonth(1)}
                    title="Next Month"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {sfSelectedMondayIso !== sfLiveMondayIso && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={handleJumpToCurrentSfWeek}
                      className="h-8 gap-1.5 text-xs"
                    >
                      <History className="w-3.5 h-3.5 text-emerald-400" />
                      Jump to Live TV Week ({buildShortSfWeekRange(sfLiveMondayIso)})
                    </Button>
                  )}
                  <span className="text-xs text-muted-foreground">
                    Showing <strong>1 week at a time</strong> ({sfMonthMondays.length} weeks in month)
                  </span>
                </div>
              </div>

              {/* Week Selector Pills for the Selected Month */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                {sfMonthMondays.map((monIso, wIdx) => {
                  const isSelected = monIso === sfSelectedMondayIso;
                  const isLive = monIso === sfLiveMondayIso;
                  const isPast = monIso < sfLiveMondayIso;
                  const savedBlock = normalizedSfSchedule.weeks[monIso];
                  const assignedCount = countSfAssignedCells(savedBlock);
                  const savedCoverage = savedBlock ? evaluateSfWeekCoverage(savedBlock) : null;
                  const hasSavedCoverageIssue =
                    assignedCount > 0 && savedCoverage && !savedCoverage.allCovered;

                  return (
                    <button
                      key={monIso}
                      type="button"
                      onClick={() => setSfSelectedMondayIso(monIso)}
                      className={`rounded-lg border p-2.5 text-left transition-all flex flex-col justify-between gap-1.5 ${
                        isSelected
                          ? "border-primary bg-primary/15 ring-1 ring-primary/40 shadow-sm"
                          : "border-border bg-secondary/20 hover:bg-secondary/40 hover:border-border"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                          Week {wIdx + 1}
                        </span>
                        {isLive ? (
                          <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[9px] font-extrabold uppercase">
                            Live on TV
                          </span>
                        ) : isPast ? (
                          <span className="px-1.5 py-0.5 rounded bg-secondary text-muted-foreground text-[9px] font-mono uppercase">
                            History
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300 text-[9px] font-mono uppercase">
                            Upcoming
                          </span>
                        )}
                      </div>
                      <div className="font-mono font-bold text-xs text-foreground">
                        {buildShortSfWeekRange(monIso)}
                      </div>
                      <div className="flex items-center justify-between gap-1 text-[11px]">
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              hasSavedCoverageIssue
                                ? "bg-amber-400"
                                : assignedCount > 0
                                  ? "bg-emerald-400"
                                  : "bg-muted-foreground/40"
                            }`}
                          />
                          <span
                            className={
                              hasSavedCoverageIssue
                                ? "text-amber-300 font-medium"
                                : assignedCount > 0
                                  ? "text-emerald-300 font-medium"
                                  : "text-muted-foreground"
                            }
                          >
                            {assignedCount > 0 ? `${assignedCount} shifts` : "Not filled yet"}
                          </span>
                        </span>
                        {hasSavedCoverageIssue && (
                          <span
                            title={`${savedCoverage!.warnings.length} day(s) below 2 Openers/Closers`}
                            className="inline-flex shrink-0"
                          >
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Active SF Week Editor Card */}
            <div className="rounded-xl border border-border bg-card p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-border/60">
                <div className="flex flex-wrap items-center gap-2.5">
                  <div className="inline-flex items-center rounded-lg border border-border bg-secondary/30 p-0.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleStepSfWeek(-1)}
                      className="h-7 px-2 text-xs gap-1"
                      title="View Previous Week"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                      Prev Week
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleStepSfWeek(1)}
                      className="h-7 px-2 text-xs gap-1"
                      title="View Next Week"
                    >
                      Next Week
                      <ChevronRight className="w-3.5 h-3.5" />
                    </Button>
                  </div>

                  <Input
                    value={selectedSfWeek.label || ""}
                    onChange={(e) =>
                      updateSelectedSfWeek({ ...selectedSfWeek, label: e.target.value })
                    }
                    className="w-64 sm:w-80 h-8 text-sm font-semibold"
                  />

                  {sfSelectedMondayIso === sfLiveMondayIso && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/35 text-emerald-300 text-xs font-bold">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      Active TV Week
                    </span>
                  )}
                  {sfSelectedMondayIso < sfLiveMondayIso && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-secondary border border-border text-muted-foreground text-xs font-medium">
                      Historical Week Archive
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCopyPrevSfWeekIntoSelected}
                    className="h-8 text-xs gap-1.5"
                    title="Copy team members and Mon–Sat shifts from the immediately preceding week"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    Copy Prev Week
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleClearSelectedSfWeek}
                    className="h-8 text-xs text-muted-foreground hover:text-destructive"
                  >
                    Clear Week
                  </Button>
                </div>
              </div>

              {/* 1-CLICK WEEKLY EMAIL EXPORT BAR (Matches Nick's Outlook Schedule Graphic) */}
              <SfEmailExportBar
                week={selectedSfWeek}
                onFooterNoteChange={(nextFooter) =>
                  updateSelectedSfWeek({ ...selectedSfWeek, footerNote: nextFooter })
                }
              />

              {/* OPENING & CLOSING COVERAGE WARNING / STATUS BANNER */}
              {sfWeekCoverage.warnings.length > 0 ? (
                <div className="rounded-xl border border-amber-500/50 bg-amber-500/10 p-3.5 flex flex-col gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-amber-300 font-bold text-xs sm:text-sm">
                      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                      <span>
                        Staffing Warning — Less than 2 Opening (≤ 7:15 AM) or Closing (≥ 6:00 PM) shifts scheduled
                      </span>
                    </div>
                    <span className="text-[11px] font-mono text-amber-200/80">
                      {sfWeekCoverage.warnings.length} day{sfWeekCoverage.warnings.length > 1 ? "s" : ""} need coverage
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {sfWeekCoverage.warnings.map((w) => {
                      const issues: string[] = [];
                      if (w.missingOpeners) {
                        issues.push(`${w.openers.length}/2 Openers`);
                      }
                      if (w.missingClosers) {
                        issues.push(`${w.closers.length}/2 Closers`);
                      }
                      return (
                        <span
                          key={w.dayIndex}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-950/60 border border-amber-500/40 text-amber-100 text-xs font-semibold"
                        >
                          <strong className="text-amber-300">
                            {w.dayName} ({(w.date || "").replace(/\/\d{4}$/, "")}):
                          </strong>
                          <span>{issues.join(" • ")}</span>
                        </span>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2 text-emerald-300 font-semibold">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>
                      All scheduled days meet minimum Opening (2+ at ≤ 7:15 AM) and Closing (2+ at ≥ 6:00 PM) coverage!
                    </span>
                  </div>
                  <span className="text-[11px] text-emerald-200/75 font-mono">
                    Mon–Fri checked • Sat checked when staffed
                  </span>
                </div>
              )}

              {/* Dual-Mode Selector: Dropdown Mode vs Mass-Selection Quick-Fill Brush */}
              <div className="rounded-lg bg-secondary/40 border border-border p-2.5 space-y-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button
                    size="sm"
                    variant={shiftBrush === null ? "default" : "outline"}
                    className="h-7 text-xs gap-1.5"
                    onClick={() => {
                      setShiftBrush(null);
                      setIsDraggingSfBrush(false);
                    }}
                  >
                    📋 Dropdown Mode
                  </Button>

                  <span className="text-xs font-bold text-muted-foreground mx-1 inline-flex items-center gap-1">
                    <Paintbrush className="w-3.5 h-3.5" />
                    Quick-Fill Brush:
                  </span>

                  {["7:15-4:15", "8:00-5:00", "8:30-5:30", "9:00-6:00", "Bomgaars", "OFF", "PTO"].map(
                    (preset) => {
                      const active = shiftBrush === preset;
                      const isOp = isOpeningShift(preset);
                      const isCl = isClosingShift(preset);
                      return (
                        <Button
                          key={preset}
                          size="sm"
                          variant={active ? "default" : "outline"}
                          className="h-7 text-xs gap-1"
                          onClick={() => setShiftBrush((prev) => (prev === preset ? null : preset))}
                        >
                          {isOp && <Sun className="w-3 h-3 text-sky-400" />}
                          {isCl && <Moon className="w-3 h-3 text-indigo-400" />}
                          <span>{preset}</span>
                        </Button>
                      );
                    },
                  )}

                  <Button
                    size="sm"
                    variant={shiftBrush === "" ? "destructive" : "outline"}
                    className="h-7 text-xs gap-1"
                    onClick={() => setShiftBrush((prev) => (prev === "" ? null : ""))}
                    title="Mass-clear cells by clicking or dragging"
                  >
                    <Eraser className="w-3 h-3" />
                    Clear
                  </Button>
                </div>

                {shiftBrush !== null ? (
                  <div className="text-[11px] text-sky-300 flex flex-wrap items-center justify-between gap-2 px-0.5">
                    <span>
                      🖌️ <strong>Mass-Fill Active ({shiftBrush || "Clear"}):</strong> Click or{" "}
                      <strong>click-and-drag</strong> across any boxes, click <strong>M–F</strong> on a member row, or click{" "}
                      <strong>Fill Day</strong> on a column header.
                    </span>
                    <button
                      type="button"
                      onClick={() => setShiftBrush(null)}
                      className="underline hover:text-white font-semibold"
                    >
                      Switch back to Dropdowns (Esc)
                    </button>
                  </div>
                ) : (
                  <div className="text-[11px] text-muted-foreground px-0.5">
                    Click any box to open its shift dropdown (or click <strong>M–F</strong> inside the dropdown to fill Monday–Friday at once). Select a Quick-Fill Brush above to mass-paint shifts across boxes.
                  </div>
                )}
              </div>

              {/* SF Team Schedule Grid */}
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border bg-secondary/20">
                      <th className="text-left p-2 w-56 text-xs uppercase tracking-wider text-muted-foreground">
                        Team Member
                      </th>
                      {(selectedSfWeek.days || []).map((d, dIdx) => {
                        const cov = sfWeekCoverage.days[dIdx];
                        return (
                          <th
                            key={dIdx}
                            className={`p-2 text-center min-w-[132px] transition-colors ${
                              cov?.hasWarning ? "bg-amber-500/10" : ""
                            }`}
                          >
                            <div className="flex items-center justify-center gap-1">
                              <span className="font-bold text-xs text-foreground">{d.day}</span>
                              {cov?.hasWarning && (
                                <span
                                  title="Understaffed on Opening or Closing shift"
                                  className="inline-flex shrink-0"
                                >
                                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] font-mono text-muted-foreground mt-0.5">
                              {d.date}
                            </div>

                            {/* Live Opening / Closing Coverage Pills per Day Column */}
                            {cov && (
                              <div className="flex items-center justify-center gap-1 mt-1.5 flex-wrap">
                                {cov.isSaturday && !cov.isChecked ? (
                                  <span className="px-1.5 py-0.5 rounded bg-secondary/70 text-[10px] font-mono text-muted-foreground">
                                    Closed / OFF
                                  </span>
                                ) : (
                                  <>
                                    <span
                                      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border text-[10px] font-mono font-bold ${
                                        cov.missingOpeners
                                          ? "bg-red-500/20 border-red-500/50 text-red-200"
                                          : "bg-sky-500/15 border-sky-500/30 text-sky-300"
                                      }`}
                                      title={
                                        cov.openers.length > 0
                                          ? `Openers (≤ 7:15 AM): ${cov.openers.join(", ")}`
                                          : "No Openers scheduled (need 2+)"
                                      }
                                    >
                                      <Sun className="w-2.5 h-2.5" />
                                      {cov.openers.length}
                                    </span>
                                    <span
                                      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border text-[10px] font-mono font-bold ${
                                        cov.missingClosers
                                          ? "bg-red-500/20 border-red-500/50 text-red-200"
                                          : "bg-indigo-500/15 border-indigo-500/30 text-indigo-300"
                                      }`}
                                      title={
                                        cov.closers.length > 0
                                          ? `Closers (≥ 6:00 PM): ${cov.closers.join(", ")}`
                                          : "No Closers scheduled (need 2+)"
                                      }
                                    >
                                      <Moon className="w-2.5 h-2.5" />
                                      {cov.closers.length}
                                    </span>
                                  </>
                                )}
                              </div>
                            )}

                            {/* Mass-fill entire day column when Quick-Fill Brush is active */}
                            {shiftBrush !== null && (
                              <button
                                type="button"
                                onClick={() => {
                                  const rows = selectedSfWeek.rows.map((r) => {
                                    const nextDays = [...r.days];
                                    nextDays[dIdx] = shiftBrush;
                                    return { ...r, days: nextDays };
                                  });
                                  updateSelectedSfWeek({ ...selectedSfWeek, rows });
                                }}
                                className="mt-1 px-1.5 py-0.5 rounded bg-primary/20 hover:bg-primary hover:text-primary-foreground text-primary text-[9px] font-bold transition-colors"
                                title={`Stamp "${shiftBrush || "Clear"}" down entire ${d.day} column`}
                              >
                                Fill {d.day}
                              </button>
                            )}
                          </th>
                        );
                      })}
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {(selectedSfWeek.rows || []).map((row, rIdx) => {
                      const memberShiftMeta = getShiftsForMember(normalizedSfSchedule, row.name);
                      return (
                        <tr key={rIdx} className="border-b border-border/60 hover:bg-secondary/10">
                          <td className="p-1.5">
                            <div className="flex items-center gap-1.5">
                              <input
                                type="color"
                                value={row.color || "#93c5fd"}
                                onChange={(e) => {
                                  const rows = [...selectedSfWeek.rows];
                                  rows[rIdx] = { ...rows[rIdx], color: e.target.value };
                                  updateSelectedSfWeek({ ...selectedSfWeek, rows }, true);
                                }}
                                className="w-6 h-7 rounded cursor-pointer bg-transparent shrink-0"
                              />
                              <Input
                                value={row.name}
                                onChange={(e) => {
                                  const oldName = row.name;
                                  const newName = e.target.value;
                                  const rows = [...selectedSfWeek.rows];
                                  rows[rIdx] = { ...rows[rIdx], name: newName };
                                  setDisplayState((prev: any) => {
                                    const currentNorm = normalizeSfScheduleState(prev?.sfSchedule);
                                    const nextMemberShifts = { ...currentNorm.memberShifts };
                                    if (
                                      oldName &&
                                      newName &&
                                      oldName !== newName &&
                                      nextMemberShifts[oldName] &&
                                      !nextMemberShifts[newName]
                                    ) {
                                      nextMemberShifts[newName] = nextMemberShifts[oldName];
                                      delete nextMemberShifts[oldName];
                                    }
                                    const nextWeeks = {
                                      ...currentNorm.weeks,
                                      [sfSelectedMondayIso]: {
                                        ...selectedSfWeek,
                                        weekStartISO: sfSelectedMondayIso,
                                        rows,
                                      },
                                    };
                                    return {
                                      ...prev,
                                      sfSchedule: normalizeSfScheduleState({
                                        ...currentNorm,
                                        weeks: nextWeeks,
                                        memberShifts: nextMemberShifts,
                                        memberRoster: rows.map((r) => ({
                                          name: r.name,
                                          color: r.color || "#93c5fd",
                                        })),
                                      }),
                                    };
                                  });
                                }}
                                className="h-8 text-xs font-bold min-w-[110px]"
                              />
                              {shiftBrush !== null ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const rows = [...selectedSfWeek.rows];
                                    const nextDays = [...rows[rIdx].days];
                                    for (let i = 0; i < 5; i++) {
                                      nextDays[i] = shiftBrush;
                                    }
                                    rows[rIdx] = { ...rows[rIdx], days: nextDays };
                                    updateSelectedSfWeek({ ...selectedSfWeek, rows });
                                  }}
                                  className="h-7 px-1.5 rounded border border-primary/50 bg-primary/15 hover:bg-primary hover:text-primary-foreground text-[10px] font-bold text-primary transition-colors shrink-0"
                                  title={`Stamp "${shiftBrush || "Clear"}" across Monday–Friday for ${row.name}`}
                                >
                                  M–F
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSfShiftManagerTargetMember(row.name || "__ALL__");
                                    setSfShiftManagerOpen(true);
                                  }}
                                  className="h-7 px-1.5 rounded border border-border/70 bg-secondary/40 hover:bg-secondary text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors shrink-0"
                                  title={`Assign shifts for ${row.name} (${memberShiftMeta.assignedCount} assigned)`}
                                >
                                  {memberShiftMeta.assignedCount} shf
                                </button>
                              )}
                            </div>
                          </td>

                          {(row.days || []).map((cell: string, cIdx: number) => {
                            const monDt = parseIsoDate(sfSelectedMondayIso);
                            const cellIso = formatIsoDate(
                              monDt.getFullYear(),
                              monDt.getMonth(),
                              monDt.getDate() + cIdx,
                            );
                            const memberHotShot = normalizedHotShots.find(
                              (hs) =>
                                hs.active &&
                                hs.deliveryDateISO === cellIso &&
                                doesHotShotDriverMatchMember(hs.driverName, row.name, hs.originHub),
                            );
                            return (
                              <td
                                key={cIdx}
                                className={`p-1.5 align-top ${
                                  sfWeekCoverage.days[cIdx]?.hasWarning ? "bg-amber-500/[0.04]" : ""
                                }`}
                              >
                                <div className="space-y-1">
                                  <SfShiftCellPicker
                                    value={cell}
                                    memberName={row.name || "Member"}
                                    memberShiftOptions={memberShiftMeta.options}
                                    allShiftOptions={normalizedSfSchedule.shiftOptions}
                                    isMemberScoped={memberShiftMeta.isMemberScoped}
                                    accentColor={row.color || "#93c5fd"}
                                    activeBrush={shiftBrush}
                                    isDraggingBrush={isDraggingSfBrush}
                                    onStartBrushDrag={() => setIsDraggingSfBrush(true)}
                                    onChange={(nextVal) => {
                                      const rows = [...selectedSfWeek.rows];
                                      const nextDays = [...rows[rIdx].days];
                                      nextDays[cIdx] = nextVal;
                                      rows[rIdx] = { ...rows[rIdx], days: nextDays };
                                      updateSelectedSfWeek({ ...selectedSfWeek, rows });
                                    }}
                                    onApplyMonFri={(shiftVal) => {
                                      const rows = [...selectedSfWeek.rows];
                                      const nextDays = [...rows[rIdx].days];
                                      for (let i = 0; i < 5; i++) {
                                        nextDays[i] = shiftVal;
                                      }
                                      rows[rIdx] = { ...rows[rIdx], days: nextDays };
                                      updateSelectedSfWeek({ ...selectedSfWeek, rows });
                                    }}
                                    onAddShiftToMember={(newShift) =>
                                      handleAddSavedSfShift(newShift, row.name)
                                    }
                                    onOpenMemberShiftsModal={() => {
                                      setSfShiftManagerTargetMember(row.name || "__ALL__");
                                      setSfShiftManagerOpen(true);
                                    }}
                                  />
                                  {memberHotShot && (
                                    <button
                                      type="button"
                                      onClick={() => setActiveAdminTab("hotshots")}
                                      title={`Assigned Hot Shot: ${memberHotShot.title}${memberHotShot.vehicleName ? ` (${memberHotShot.vehicleName})` : ""} — click to view`}
                                      className="w-full inline-flex items-center justify-center gap-1 px-1.5 py-0.5 rounded border border-amber-400/55 bg-amber-500/20 hover:bg-amber-500/30 text-[10px] font-bold text-amber-200 truncate transition-colors"
                                    >
                                      <Zap className="w-2.5 h-2.5 text-amber-300 fill-amber-300 shrink-0" />
                                      <span className="truncate">
                                        {memberHotShot.vehicleName || "Hot Shot"} ({memberHotShot.stops.length} stp)
                                      </span>
                                    </button>
                                  )}
                                </div>
                              </td>
                            );
                          })}

                          <td className="p-1 text-center">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive"
                              onClick={() => {
                                const rows = selectedSfWeek.rows.filter((_, i) => i !== rIdx);
                                updateSelectedSfWeek({ ...selectedSfWeek, rows }, true);
                              }}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => {
                    const rows = [
                      ...(selectedSfWeek.rows || []),
                      {
                        name: "New Team Member",
                        color: "#93c5fd",
                        days: ["8:00-5:00", "8:00-5:00", "8:00-5:00", "8:00-5:00", "8:00-5:00", "OFF"],
                      },
                    ];
                    updateSelectedSfWeek({ ...selectedSfWeek, rows }, true);
                  }}
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Staff Member
                </Button>

                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground shrink-0">
                    Email Red Footer:
                  </Label>
                  <Input
                    value={selectedSfWeek.footerNote ?? "Nick Kreger"}
                    onChange={(e) =>
                      updateSelectedSfWeek({ ...selectedSfWeek, footerNote: e.target.value })
                    }
                    placeholder="e.g. Nick Kreger"
                    className="w-52 h-8 text-xs"
                  />
                </div>
              </div>
            </div>
          </TabsContent>

          {/* =============================================================== */}
          {/* TAB 5: DOT, DRIVER'S LICENSE & MED CARD RENEWALS                */}
          {/* =============================================================== */}
          <TabsContent value="renewals" className="space-y-6">
            <div className="rounded-xl border border-border bg-card p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-bold text-base">Driver's License, Med Card & Truck DOT Renewals</h2>
                  <p className="text-xs text-muted-foreground">
                    TV Screen 2 sorts rows by soonest due date to the top; ≤30 days highlights red and surfaces on Screen 4, ≤90 days highlights amber. Past-due items automatically purge 1 full day after becoming past due, or click <strong>✓ Done</strong> on any due item to clear it immediately.
                  </p>
                </div>
                <Button
                  onClick={() => saveSchedulesPayload({ renewalReminders: displayState?.renewalReminders })}
                  disabled={savingSchedules}
                >
                  {savingSchedules ? "Saving..." : "Save Renewals"}
                </Button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th className="p-2">Driver / Truck Unit</th>
                      <th className="p-2">Driver's License Due</th>
                      <th className="p-2">MED CARD Due</th>
                      <th className="p-2">TRUCK DOT Due</th>
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {(displayState?.renewalReminders || []).map((item: any, idx: number) => {
                      const updateRow = (patch: any) => {
                        const next = [...displayState.renewalReminders];
                        next[idx] = { ...next[idx], ...patch };
                        setDisplayState((prev: any) => ({ ...prev, renewalReminders: next }));
                      };
                      const markFieldDone = (field: "licenseDue" | "medCardDue" | "truckDotDue") => {
                        const next = [...displayState.renewalReminders];
                        next[idx] = { ...next[idx], [field]: "" };
                        setDisplayState((prev: any) => ({ ...prev, renewalReminders: next }));
                        saveSchedulesPayload({ renewalReminders: next });
                      };
                      const renderDueBadge = (
                        val: string | undefined,
                        field: "licenseDue" | "medCardDue" | "truckDotDue",
                      ) => {
                        const clean = (val || "").trim();
                        if (!clean) return null;
                        const ev = evaluateRenewalDateCell(clean);
                        const cls =
                          ev.status === "overdue"
                            ? "bg-rose-500/25 text-rose-200 border-rose-500/50"
                            : ev.status === "urgent"
                              ? "bg-rose-500/15 text-rose-300 border-rose-500/40"
                              : "bg-amber-500/15 text-amber-300 border-amber-500/40";
                        const prefix = ev.status === "overdue" ? "🚨 " : ev.status === "urgent" ? "⚠️ " : "⏳ ";
                        return (
                          <div className="flex items-center gap-1 shrink-0">
                            {ev.countdownLabel && (
                              <span className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded border ${cls}`}>
                                {prefix}
                                {ev.countdownLabel}
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => markFieldDone(field)}
                              title="Mark this reminder as Done and remove due alert"
                              className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded border border-emerald-500/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 transition-colors"
                            >
                              ✓ Done
                            </button>
                          </div>
                        );
                      };
                      return (
                        <tr key={idx} className="border-b border-border/60">
                          <td className="p-1.5">
                            <Input
                              value={item.entity}
                              onChange={(e) => updateRow({ entity: e.target.value })}
                              className="h-8 text-xs font-bold"
                            />
                          </td>
                          <td className="p-1.5">
                            <div className="flex items-center gap-1.5">
                              <Input
                                value={item.licenseDue}
                                onChange={(e) => updateRow({ licenseDue: e.target.value })}
                                placeholder="e.g. 7/26/29"
                                className="h-8 text-xs"
                              />
                              {renderDueBadge(item.licenseDue, "licenseDue")}
                            </div>
                          </td>
                          <td className="p-1.5">
                            <div className="flex items-center gap-1.5">
                              <Input
                                value={item.medCardDue}
                                onChange={(e) => updateRow({ medCardDue: e.target.value })}
                                placeholder="e.g. 11/12/26"
                                className="h-8 text-xs"
                              />
                              {renderDueBadge(item.medCardDue, "medCardDue")}
                            </div>
                          </td>
                          <td className="p-1.5">
                            <div className="flex items-center gap-1.5">
                              <Input
                                value={item.truckDotDue}
                                onChange={(e) => updateRow({ truckDotDue: e.target.value })}
                                placeholder="e.g. May 2027"
                                className="h-8 text-xs"
                              />
                              {renderDueBadge(item.truckDotDue, "truckDotDue")}
                            </div>
                          </td>
                          <td className="p-1 text-center">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive"
                              onClick={() => {
                                const next = displayState.renewalReminders.filter((_: any, i: number) => i !== idx);
                                setDisplayState((prev: any) => ({ ...prev, renewalReminders: next }));
                              }}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  const next = [
                    ...(displayState?.renewalReminders || []),
                    { entity: "New Driver / Unit", licenseDue: "", medCardDue: "", truckDotDue: "" },
                  ];
                  setDisplayState((prev: any) => ({ ...prev, renewalReminders: next }));
                }}
              >
                <Plus className="w-3.5 h-3.5" />
                Add Renewal Row
              </Button>
            </div>
          </TabsContent>

          {/* =============================================================== */}
          {/* TAB 6: CALENDAR, OUTLOOK .ICS SYNC & LIVE WEATHER/RSS FEEDS     */}
          {/* =============================================================== */}
          <TabsContent value="calendar" className="space-y-6">
            <div className={`grid gap-6 ${showTechnicalControls ? "md:grid-cols-2" : "grid-cols-1"}`}>
              <div className="rounded-xl border border-border bg-card p-5 space-y-4">
                <h2 className="font-bold text-base">Add Company Milestone / Event</h2>
                <div className="grid gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Event / Anniversary Title</Label>
                    <Input
                      value={newCalTitle}
                      onChange={(e) => setNewCalTitle(e.target.value)}
                      placeholder="e.g., HAPPY WORK ANNIVERSARY ETHAN!"
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Date</Label>
                      <Input type="date" value={newCalDate} onChange={(e) => setNewCalDate(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Time</Label>
                      <Input value={newCalTime} onChange={(e) => setNewCalTime(e.target.value)} placeholder="All Day" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Accent</Label>
                      <Input type="color" value={newCalColor} onChange={(e) => setNewCalColor(e.target.value)} className="h-9" />
                    </div>
                  </div>
                  <Button onClick={handleAddCalendarEvent} className="gap-1.5">
                    <Plus className="w-4 h-4" />
                    Add Event to TV Calendar
                  </Button>
                </div>
              </div>

              {showTechnicalControls && (
              <div className="rounded-xl border border-border bg-card p-5 space-y-4">
                <h2 className="font-bold text-base">Outlook / Office 365 (.ics) & Live Feeds</h2>
                <p className="text-xs text-muted-foreground">
                  Paste your shared Outlook published `.ics` calendar URL to auto-sync upcoming events alongside Sioux Falls/Aberdeen/Huron Weather & KELOLAND/ESPN RSS.
                </p>
                <div className="space-y-2">
                  <Label className="text-xs">Outlook Published .ics Feed URL (Optional)</Label>
                  <Input
                    value={displayState?.settings?.icsCalendarUrl || ""}
                    onChange={(e) =>
                      setDisplayState((prev: any) => ({
                        ...prev,
                        settings: { ...prev.settings, icsCalendarUrl: e.target.value },
                      }))
                    }
                    placeholder="https://outlook.office365.com/owa/calendar/.../reachcalendar.ics"
                    className="font-mono text-xs"
                  />
                </div>
                <div className="flex items-center gap-2.5">
                  <Button onClick={handleRefreshLiveFeeds} disabled={refreshingFeeds} className="gap-1.5">
                    <RefreshCw className={`w-4 h-4 ${refreshingFeeds ? "animate-spin" : ""}`} />
                    {refreshingFeeds ? "Syncing Feeds..." : "Save & Sync Weather, News + .ics Now"}
                  </Button>
                </div>
              </div>
              )}
            </div>

            {/* SEVERE WEATHER WARNING ZONE OVERLAY & DEMO SIMULATOR CARD */}
            {(() => {
              const currentMode = normalizeWeatherOverlayMode(
                displayState?.settings?.weatherOverlayMode,
                "warnings_only",
              );
              const currentDemo = normalizeWeatherDemoScenario(
                displayState?.settings?.weatherDemoScenario,
              );
              const activeModeMeta =
                WEATHER_OVERLAY_MODES.find((m) => m.id === currentMode) || WEATHER_OVERLAY_MODES[0];
              const liveNwsCount = Array.isArray(displayState?.nwsAlerts)
                ? displayState.nwsAlerts.length
                : 0;

              return (
                <div
                  className="rounded-xl border border-border bg-card p-5 space-y-4"
                  data-testid="weather-overlay-settings-card"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <h3 className="font-bold text-base flex items-center gap-2">
                        <CloudSnow className="w-4 h-4 text-rose-400" />
                        Severe Weather Map Warning Zones & Demo Simulator
                      </h3>
                      <p className="text-xs text-muted-foreground max-w-2xl">
                        Highlights active NWS warning polygons cleanly underneath truck routes and Hot Shots without radar clutter. Defaults to{" "}
                        <strong className="text-foreground">Warnings Only</strong> so minor advisories don't crowd the board.
                      </p>
                    </div>
                    <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
                      <span>
                        Live NWS Alerts: <strong className="text-foreground">{liveNwsCount}</strong>
                      </span>
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={handleRefreshLiveFeeds}
                        disabled={refreshingFeeds}
                        className="gap-1"
                      >
                        <RefreshCw className={`w-3 h-3 ${refreshingFeeds ? "animate-spin" : ""}`} />
                        Sync NWS
                      </Button>
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-lg border border-border bg-secondary/20 p-3.5 space-y-2">
                      <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        Company-Wide Map Alert Level
                      </Label>
                      <Select
                        value={currentMode}
                        onValueChange={(val) =>
                          handleUpdateWeatherOverlay(
                            { weatherOverlayMode: val as WeatherOverlayMode },
                            `Updated map weather alert level → ${
                              WEATHER_OVERLAY_MODES.find((m) => m.id === val)?.shortLabel || val
                            }`,
                          )
                        }
                      >
                        <SelectTrigger className="h-9 text-xs font-semibold">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {WEATHER_OVERLAY_MODES.map((m) => (
                            <SelectItem key={m.id} value={m.id}>
                              {m.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        {activeModeMeta.description}
                      </p>
                    </div>

                    <div className="rounded-lg border border-border bg-secondary/20 p-3.5 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                          Live TV Demo Mode (For Testing & Presentations)
                        </Label>
                        {currentDemo !== "none" && (
                          <span className="rounded-full bg-rose-500/20 border border-rose-500/50 px-2 py-0.5 text-[10px] font-mono font-bold text-rose-300">
                            DEMO ACTIVE
                          </span>
                        )}
                      </div>
                      <Select
                        value={currentDemo}
                        onValueChange={(val) =>
                          handleUpdateWeatherOverlay(
                            {
                              weatherDemoScenario: val as WeatherDemoScenarioId,
                              ...(val !== "none" && currentMode === "off"
                                ? { weatherOverlayMode: "warnings_only" }
                                : {}),
                            },
                            val === "none"
                              ? "Demo Mode disabled — showing real-time NWS alerts only"
                              : `Activated ${
                                  WEATHER_DEMO_SCENARIOS.find((s) => s.id === val)?.shortBadge || "Demo"
                                } on TVs!`,
                          )
                        }
                      >
                        <SelectTrigger className="h-9 text-xs font-semibold">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {WEATHER_DEMO_SCENARIOS.map((sc) => (
                            <SelectItem key={sc.id} value={sc.id}>
                              {sc.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        {getWeatherDemoScenarioMeta(currentDemo).description}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })()}

            <div className="rounded-xl border border-border bg-card p-5 space-y-3">
              <div>
                <h3 className="font-bold text-sm">Upcoming Calendar Events (Screen 2 & Screen 4 Bulletin)</h3>
                <p className="text-xs text-muted-foreground">
                  Events within 3 days automatically surface on the Cross-Screen Imminent Spotlight Ribbon across all TVs.
                </p>
              </div>
              <div className="space-y-2">
                {(displayState?.calendarEvents || []).map((ev: any) => {
                  const urg = evaluateCalendarEventUrgency(ev);
                  const badgeCls = urg.isPast
                    ? "bg-muted text-muted-foreground border-border"
                    : urg.tier === "today"
                      ? "bg-rose-500/20 text-rose-300 border-rose-500/50"
                      : urg.tier === "imminent"
                        ? "bg-amber-500/20 text-amber-300 border-amber-500/50"
                        : urg.tier === "this_week"
                          ? "bg-yellow-500/20 text-yellow-200 border-yellow-500/40"
                          : "bg-sky-500/15 text-sky-300 border-sky-500/35";
                  return (
                    <div
                      key={ev.id}
                      className={`flex items-center justify-between gap-3 p-3 rounded-lg border bg-secondary/20 ${
                        urg.isPast ? "border-border/50 opacity-60" : "border-border"
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: ev.color || "#38bdf8" }} />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-bold text-sm">{ev.title}</span>
                            {urg.daysUntil !== null && (
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${badgeCls}`}>
                                {urg.badgeText}
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {ev.dayLabel} {ev.dateISO ? `(${ev.dateISO})` : ""} • {ev.time} ({ev.source === "ics" ? "Outlook .ics" : "Custom"})
                          </div>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive shrink-0"
                        onClick={() => handleDeleteCalendarEvent(ev.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          </TabsContent>

          {/* =============================================================== */}
          {/* TAB 7: EXISTING FLEET VEHICLES & CUSTOM MAP LOCATIONS           */}
          {/* =============================================================== */}
          <TabsContent value="fleet" className="space-y-8">
            {/* Motive GPS Telemetry Poller & CSV History Export (Technical Admin Only) */}
            {showTechnicalControls && (
            <section className="rounded-xl border border-border bg-card p-5 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <h2 className="text-base font-bold flex items-center gap-2">
                      <Satellite className="w-5 h-5 text-primary" />
                      Motive GPS Telemetry Poller & Location Export
                    </h2>
                    {pollDiagnostics.apiKeyConfigured ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/35 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        MOTIVE_API_KEY Active (60s Poll)
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 border border-amber-500/35 px-2.5 py-0.5 text-[11px] font-semibold text-amber-300">
                        Local Cache Mode (MOTIVE_API_KEY Not Set)
                      </span>
                    )}
                    {pollDiagnostics.tileCache && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-500/15 border border-sky-500/35 px-2.5 py-0.5 text-[11px] font-mono font-semibold text-sky-300">
                        Tile Cache: {pollDiagnostics.tileCache.tileCount.toLocaleString()} tiles (
                        {(pollDiagnostics.tileCache.sizeBytes / (1024 * 1024)).toFixed(1)} /{" "}
                        {Math.round(pollDiagnostics.tileCache.maxBytes / (1024 * 1024))} MB)
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Outbound 60-second Motive API poller for trucks and trailer assets, plus historical CSV export for fleet audits.
                    {pollDiagnostics.results[0] && (
                      <span className="ml-1.5 font-mono text-foreground/80">
                        • Last poll:{" "}
                        {new Date(pollDiagnostics.results[0].timestamp).toLocaleTimeString()} (
                        {pollDiagnostics.results[0].type},{" "}
                        {pollDiagnostics.results[0].success
                          ? `${pollDiagnostics.results[0].vehicleCount ?? 0} synced`
                          : "failed"}
                        )
                      </span>
                    )}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="default"
                    size="sm"
                    onClick={handleTriggerMotivePoll}
                    disabled={pollingMotive}
                    className="gap-1.5"
                    data-testid="button-poll-motive-now"
                  >
                    <RefreshCw className={`w-4 h-4 ${pollingMotive ? "animate-spin" : ""}`} />
                    {pollingMotive ? "Polling Motive..." : "Poll Motive Now"}
                  </Button>
                  <ExportDialog />
                  {pollDiagnostics.results.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowPollLog((prev) => !prev)}
                      className="text-xs"
                    >
                      {showPollLog
                        ? "Hide Poll Log"
                        : `View Poll Log (${pollDiagnostics.results.length})`}
                    </Button>
                  )}
                </div>
              </div>

              {showPollLog && pollDiagnostics.results.length > 0 && (
                <div className="border-t border-border/60 pt-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Recent Motive API Poll Runs
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleClearPollHistory}
                      className="h-7 text-xs text-muted-foreground hover:text-destructive"
                    >
                      Clear Log
                    </Button>
                  </div>
                  <div className="max-h-52 overflow-y-auto rounded-lg border border-border bg-secondary/20 divide-y divide-border/60 text-xs font-mono">
                    {pollDiagnostics.results.slice(0, 20).map((entry, idx) => (
                      <div
                        key={`${entry.timestamp}-${idx}`}
                        className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                      >
                        <div className="flex items-center gap-2.5">
                          <span
                            className={`w-2 h-2 rounded-full ${
                              entry.success ? "bg-emerald-400" : "bg-red-400"
                            }`}
                          />
                          <span className="text-muted-foreground">
                            {new Date(entry.timestamp).toLocaleString()}
                          </span>
                          <span className="uppercase px-1.5 py-0.5 rounded bg-secondary text-[10px]">
                            {entry.type}
                          </span>
                        </div>
                        <div>
                          {entry.success ? (
                            <span className="text-emerald-400">
                              OK • {entry.vehicleCount ?? 0} units synced
                            </span>
                          ) : (
                            <span className="text-red-400">
                              Error: {entry.error || "Unknown failure"}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
            )}

            {/* Map Home Locations Section */}
            <section>
              <div className="mb-4">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <Warehouse className="w-5 h-5 text-primary" />
                  Map Home Locations
                </h2>
                <p className="text-sm text-muted-foreground">
                  Choose which saved custom location acts as the home warehouse on each display map
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-lg border border-border bg-card p-4 space-y-3">
                  <div>
                    <h3 className="font-medium">/map Home Location</h3>
                    <p className="text-xs text-muted-foreground">
                      Controls the home marker and Return ETA destination on the main Map page.
                    </p>
                  </div>
                  <Select
                    value={mapHomeLocations.map ? String(mapHomeLocations.map.locationId) : "default"}
                    onValueChange={(value) => handleMapHomeLocationChange("map", value)}
                    disabled={loading || savingMapHome === "map"}
                  >
                    <SelectTrigger data-testid="select-map-home-location">
                      <SelectValue placeholder="Choose a custom location" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">Default (Arlington Warehouse)</SelectItem>
                      {customLocations.map((location) => (
                        <SelectItem key={location.id} value={String(location.id)}>
                          {location.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="rounded-lg border border-border bg-card p-4 space-y-3">
                  <div>
                    <h3 className="font-medium">/regional-sf Home Location</h3>
                    <p className="text-xs text-muted-foreground">
                      Controls the Return ETA destination on the Sioux Falls regional display.
                    </p>
                  </div>
                  <Select
                    value={
                      mapHomeLocations["regional-sf"]
                        ? String(mapHomeLocations["regional-sf"]?.locationId)
                        : "default"
                    }
                    onValueChange={(value) => handleMapHomeLocationChange("regional-sf", value)}
                    disabled={loading || savingMapHome === "regional-sf"}
                  >
                    <SelectTrigger data-testid="select-regional-sf-home-location">
                      <SelectValue placeholder="Choose a custom location" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">Auto-detect warehouse / default</SelectItem>
                      {customLocations.map((location) => (
                        <SelectItem key={location.id} value={String(location.id)}>
                          {location.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </section>

            {/* Vehicles Section */}
            <section>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold flex items-center gap-2">
                    <Truck className="w-5 h-5 text-primary" />
                    Vehicles
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Manage tracked vehicles, customize display names/colors, and assign home warehouses
                  </p>
                </div>
              </div>

              <div className="rounded-lg border border-border bg-card overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">Color</TableHead>
                      <TableHead>Vehicle ID</TableHead>
                      <TableHead>Display Name</TableHead>
                      <TableHead>Warehouse</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                          Loading vehicles...
                        </TableCell>
                      </TableRow>
                    ) : vehicles.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                          No vehicles registered yet.
                        </TableCell>
                      </TableRow>
                    ) : (
                      vehicles.map((vehicle) => (
                        <TableRow key={vehicle.vehicleId} data-testid={`row-vehicle-${vehicle.vehicleId}`}>
                          <TableCell>
                            <div
                              className="w-6 h-6 rounded-full border border-border"
                              style={{ backgroundColor: vehicle.color || "#3b82f6" }}
                            />
                          </TableCell>
                          <TableCell className="font-mono text-sm">{vehicle.vehicleId}</TableCell>
                          <TableCell className="font-medium">{vehicle.name}</TableCell>
                          <TableCell className="min-w-[220px]">
                            <Select
                              value={vehicle.homeLocationId ? String(vehicle.homeLocationId) : "none"}
                              onValueChange={(value) => handleVehicleWarehouseChange(vehicle, value)}
                              disabled={customLocations.length === 0}
                            >
                              <SelectTrigger data-testid={`select-vehicle-warehouse-${vehicle.vehicleId}`}>
                                <SelectValue placeholder="No warehouse assigned" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">No warehouse assigned</SelectItem>
                                {customLocations.map((location) => (
                                  <SelectItem key={location.id} value={String(location.id)}>
                                    {location.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleEditVehicle(vehicle)}
                              data-testid={`button-edit-vehicle-${vehicle.vehicleId}`}
                            >
                              <Pencil className="w-4 h-4" />
                            </Button>
                            {showTechnicalControls && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setDeleteVehicleId(vehicle.vehicleId)}
                                className="text-destructive hover:text-destructive"
                                data-testid={`button-delete-vehicle-${vehicle.vehicleId}`}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </section>

            {/* Custom Locations Section */}
            <section>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold flex items-center gap-2">
                    <MapPin className="w-5 h-5 text-primary" />
                    Custom Map Locations
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Add warehouses, depots, or landmarks to display on the map
                  </p>
                </div>
                <Button onClick={openAddLocationDialog} className="gap-2" data-testid="button-add-location">
                  <Plus className="w-4 h-4" />
                  Add Location
                </Button>
              </div>

              <div className="rounded-lg border border-border bg-card overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">Icon</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Coordinates</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                          Loading locations...
                        </TableCell>
                      </TableRow>
                    ) : customLocations.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                          No custom locations added yet.
                        </TableCell>
                      </TableRow>
                    ) : (
                      customLocations.map((location) => (
                        <TableRow key={location.id} data-testid={`row-location-${location.id}`}>
                          <TableCell>
                            <div
                              className="w-8 h-8 rounded-full flex items-center justify-center"
                              style={{ backgroundColor: location.color || "#ef4444", color: "white" }}
                            >
                              <IconComponent iconName={location.icon || "marker"} />
                            </div>
                          </TableCell>
                          <TableCell className="font-medium">{location.name}</TableCell>
                          <TableCell className="font-mono text-sm text-muted-foreground">
                            {location.latitude.toFixed(4)}, {location.longitude.toFixed(4)}
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm max-w-xs truncate">
                            {location.description || "-"}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openEditLocationDialog(location)}
                              data-testid={`button-edit-location-${location.id}`}
                            >
                              <Pencil className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setDeleteLocationId(location.id)}
                              className="text-destructive hover:text-destructive"
                              data-testid={`button-delete-location-${location.id}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </section>
          </TabsContent>

          {/* =============================================================== */}
          {/* TAB 8: SECURITY, STAFF ACCOUNTS (ADMIN / STAFF / VIEWER)        */}
          {/* =============================================================== */}
          {showTechnicalControls && (
          <TabsContent value="security" className="space-y-6">
            {/* Security Posture Overview */}
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
                <div className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4" />
                  Public Web & API Access
                </div>
                <div className="text-lg font-black text-emerald-400 mt-1">LOCKED (401)</div>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  All GPS feeds, WebSockets, schedules & admin APIs require authentication.
                </p>
              </div>

              <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-4">
                <div className="text-xs font-bold text-sky-300 flex items-center gap-1.5">
                  <Users className="w-4 h-4" />
                  Staff Accounts
                </div>
                <div className="text-lg font-black text-sky-400 mt-1">
                  {staffUsers.length} {staffUsers.length === 1 ? "User" : "Users"}
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {staffUsers.filter((u) => u.role === "admin").length} Tech Admin •{" "}
                  {staffUsers.filter((u) => u.role === "staff").length} Staff •{" "}
                  {staffUsers.filter((u) => u.role === "viewer").length} Viewer
                </p>
              </div>

              <div className="rounded-xl border border-purple-500/30 bg-purple-500/5 p-4">
                <div className="text-xs font-bold text-purple-300 flex items-center gap-1.5">
                  <Satellite className="w-4 h-4" />
                  Inbound Motive Webhook
                </div>
                <div className="text-lg font-black text-purple-300 mt-1">DISABLED (410)</div>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  GPS telemetry runs securely via outbound Motive API polling only.
                </p>
              </div>

              <div
                className={`rounded-xl border p-4 ${
                  displayState?.settings?.embedEnabled
                    ? "border-amber-500/40 bg-amber-500/10"
                    : "border-emerald-500/30 bg-emerald-500/5"
                }`}
              >
                <div className="text-xs font-bold flex items-center gap-1.5">
                  <Lock className="w-4 h-4" />
                  Phased DAKboard Embed
                </div>
                <div
                  className={`text-lg font-black mt-1 ${
                    displayState?.settings?.embedEnabled ? "text-amber-300" : "text-emerald-400"
                  }`}
                >
                  {displayState?.settings?.embedEnabled ? "ENABLED (Rollout)" : "OFF (Locked)"}
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {displayState?.settings?.embedEnabled
                    ? "Scoped map iframe token active during rollout."
                    : "Cross-origin map iframes are blocked."}
                </p>
              </div>
            </div>

            {/* Staff Accounts Creation + Change Own Password */}
            <div className="grid gap-6 lg:grid-cols-3">
              {/* Create Staff Account */}
              <div className="lg:col-span-2 rounded-xl border border-border bg-card p-5 space-y-4">
                <div>
                  <h2 className="text-base font-bold flex items-center gap-2">
                    <UserPlus className="w-4 h-4 text-sky-400" />
                    Add Team Account (Standard Staff, Technical Admin, or Viewer)
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    <strong>Standard Staff</strong> get a simplified hub (green-light TV status bar + schedules, announcements, renewals, calendar, Screen Studio & trucks without technical clutter).{" "}
                    <strong>Technical Admins</strong> see full Raspberry Pi SSH, TV health diagnostics, webhooks, feeds & user controls.
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Username</Label>
                    <Input
                      value={newUsername}
                      onChange={(e) => setNewUsername(e.target.value)}
                      placeholder="e.g., dispatch_sf or jackie"
                      data-testid="input-new-staff-username"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Display Name</Label>
                    <Input
                      value={newDisplayName}
                      onChange={(e) => setNewDisplayName(e.target.value)}
                      placeholder="e.g., Jackie (SF Office)"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Initial Password (min 8 characters)</Label>
                    <Input
                      type="password"
                      value={newUserPassword}
                      onChange={(e) => setNewUserPassword(e.target.value)}
                      placeholder="Minimum 8 characters"
                      data-testid="input-new-staff-password"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Access Role</Label>
                    <Select
                      value={newUserRole}
                      onValueChange={(v: "admin" | "staff" | "viewer") => setNewUserRole(v)}
                    >
                      <SelectTrigger data-testid="select-new-staff-role">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="staff">Standard Staff — Simplified Schedules & TV Content</SelectItem>
                        <SelectItem value="admin">Technical Admin — Full System, Pi SSH & Health</SelectItem>
                        <SelectItem value="viewer">Viewer — Read-Only Maps & TV Only</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button
                    onClick={handleCreateStaffUser}
                    disabled={creatingUser}
                    className="gap-1.5"
                    data-testid="button-create-staff-user"
                  >
                    <UserPlus className="w-4 h-4" />
                    {creatingUser ? "Creating..." : "Create Account"}
                  </Button>
                </div>
              </div>

              {/* Change Your Own Admin Password */}
              <div className="rounded-xl border border-border bg-card p-5 space-y-4">
                <div>
                  <h2 className="text-base font-bold flex items-center gap-2">
                    <KeyRound className="w-4 h-4 text-emerald-400" />
                    Change My Password
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Signed in as <strong>{currentUser?.username}</strong>.
                  </p>
                </div>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Current Password</Label>
                    <Input
                      type="password"
                      value={ownCurrentPw}
                      onChange={(e) => setOwnCurrentPw(e.target.value)}
                      autoComplete="current-password"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">New Password (8+ chars)</Label>
                    <Input
                      type="password"
                      value={ownNewPw}
                      onChange={(e) => setOwnNewPw(e.target.value)}
                      autoComplete="new-password"
                    />
                  </div>
                  <Button
                    variant="secondary"
                    className="w-full"
                    onClick={handleChangeOwnPassword}
                    disabled={savingOwnPw}
                  >
                    {savingOwnPw ? "Updating..." : "Update My Password"}
                  </Button>
                </div>
              </div>
            </div>

            {/* Staff Accounts Table */}
            <div className="rounded-xl border border-border bg-card p-5 space-y-3">
              <h3 className="font-bold text-sm">Active Staff Accounts</h3>
              <div className="border border-border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Username</TableHead>
                      <TableHead>Display Name</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {staffUsers.map((u) => {
                      const isSelf = currentUser?.id === u.id;
                      return (
                        <TableRow key={u.id}>
                          <TableCell className="font-mono font-bold text-sm">
                            {u.username}{" "}
                            {isSelf && (
                              <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300 font-sans">
                                You
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-sm">{u.displayName || u.username}</TableCell>
                          <TableCell>
                            <Select
                              value={
                                u.role === "viewer"
                                  ? "viewer"
                                  : u.role === "staff"
                                    ? "staff"
                                    : "admin"
                              }
                              onValueChange={(val: "admin" | "staff" | "viewer") =>
                                handleChangeUserRole(u, val)
                              }
                            >
                              <SelectTrigger className="h-8 w-[168px] text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="admin">Technical Admin</SelectItem>
                                <SelectItem value="staff">Standard Staff</SelectItem>
                                <SelectItem value="viewer">Viewer (Read-Only)</SelectItem>
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="inline-flex items-center gap-1.5">
                              <Button
                                size="xs"
                                variant="outline"
                                onClick={() => {
                                  setResetPwUser(u);
                                  setResetPwValue("");
                                }}
                              >
                                <KeyRound className="w-3 h-3 mr-1" />
                                Reset Password
                              </Button>
                              {!isSelf && (
                                <Button
                                  size="xs"
                                  variant="ghost"
                                  className="text-destructive hover:text-destructive"
                                  onClick={() => handleDeleteStaffUser(u)}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>

            {/* Phased DAKboard Rollout — Scoped Map Embed Token */}
            <div className="rounded-xl border border-border bg-card p-5 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1 max-w-2xl">
                  <h2 className="text-base font-bold flex items-center gap-2">
                    <Tv className="w-4 h-4 text-amber-400" />
                    Phased DAKboard Rollout — Temporary Map Embed Token
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    While migrating legacy DAKboard screens to direct Raspberry Pi TVs, you can enable a scoped read-only{" "}
                    <code className="text-sky-400">embed_token</code> that grants map-only access inside DAKboard iframes (never admin, schedules, or announcements). Turn it off in 1 click as soon as DAKboard is retired!
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {displayState?.settings?.embedEnabled ? (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleUpdateEmbedSecurity(false, false)}
                    >
                      Disable Embed Access Now
                    </Button>
                  ) : (
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => handleUpdateEmbedSecurity(true, false)}
                    >
                      Enable Phased Embed Token
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() =>
                      handleUpdateEmbedSecurity(
                        Boolean(displayState?.settings?.embedEnabled),
                        true,
                      )
                    }
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Rotate Embed Token
                  </Button>
                </div>
              </div>

              {displayState?.settings?.embedToken && (
                <div className="grid gap-3 md:grid-cols-2 pt-2 border-t border-border/60">
                  {[
                    { label: "Main Fleet Map Embed URL (DAKboard)", path: "/map" },
                    { label: "Sioux Falls Regional Map Embed URL (DAKboard)", path: "/regional-sf" },
                  ].map((item) => {
                    const tok = String(displayState.settings.embedToken);
                    const fullUrl = `${originUrl}${item.path}?embed_token=${tok}`;
                    const maskedUrl = showEmbedToken
                      ? fullUrl
                      : `${originUrl}${item.path}?embed_token=${tok.slice(0, 8)}••••••••••••`;
                    return (
                      <div key={item.path} className="space-y-1 min-w-0">
                        <Label className="text-xs text-muted-foreground">{item.label}</Label>
                        <div className="flex items-center gap-1.5 min-w-0">
                          <Input
                            readOnly
                            value={maskedUrl}
                            className="h-8 font-mono text-xs min-w-0 flex-1"
                          />
                          <Button
                            size="sm"
                            variant="ghost"
                            className="px-2"
                            onClick={() => setShowEmbedToken((s) => !s)}
                          >
                            {showEmbedToken ? (
                              <EyeOff className="w-3.5 h-3.5" />
                            ) : (
                              <Eye className="w-3.5 h-3.5" />
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              navigator.clipboard.writeText(fullUrl);
                              toast({ title: `Copied ${item.label}!` });
                            }}
                          >
                            <Copy className="w-3.5 h-3.5" />
                            Copy
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </TabsContent>
          )}
          </div>
        </Tabs>
      </main>

      {/* Edit Vehicle Dialog */}
      <Dialog open={!!editVehicle} onOpenChange={(open) => !open && setEditVehicle(null)}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Truck className="w-5 h-5" />
              Edit Vehicle
            </DialogTitle>
            <DialogDescription>Vehicle ID: {editVehicle?.vehicleId}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="vehicleName">Display Name</Label>
              <Input
                id="vehicleName"
                data-testid="input-edit-vehicle-name"
                value={vehicleName}
                onChange={(e) => setVehicleName(e.target.value)}
                placeholder="Enter display name"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="vehicleColor">Color</Label>
              <div className="flex gap-2 items-center">
                <Input
                  id="vehicleColor"
                  type="color"
                  data-testid="input-edit-vehicle-color"
                  value={vehicleColor}
                  onChange={(e) => setVehicleColor(e.target.value)}
                  className="w-20 h-10 cursor-pointer"
                />
                <Input
                  type="text"
                  value={vehicleColor}
                  onChange={(e) => setVehicleColor(e.target.value)}
                  className="flex-1 font-mono"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="vehicleHomeLocation">Warehouse Location</Label>
              <Select
                value={vehicleHomeLocationId}
                onValueChange={setVehicleHomeLocationId}
                disabled={customLocations.length === 0}
              >
                <SelectTrigger id="vehicleHomeLocation" data-testid="select-edit-vehicle-warehouse">
                  <SelectValue placeholder="Choose a warehouse" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No warehouse assigned</SelectItem>
                  {customLocations.map((location) => (
                    <SelectItem key={location.id} value={String(location.id)}>
                      {location.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditVehicle(null)} disabled={savingVehicle}>
              Cancel
            </Button>
            <Button onClick={handleSaveVehicle} disabled={savingVehicle} data-testid="button-save-vehicle">
              {savingVehicle ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Custom Location Dialog */}
      <Dialog open={locationDialogOpen} onOpenChange={setLocationDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MapPin className="w-5 h-5" />
              {editLocation ? "Edit Location" : "Add Custom Location"}
            </DialogTitle>
            <DialogDescription>
              Add markers for warehouses, depots, or other important locations on the map.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="locationName">Name</Label>
              <Input
                id="locationName"
                data-testid="input-location-name"
                value={locationName}
                onChange={(e) => setLocationName(e.target.value)}
                placeholder="e.g., Main Warehouse"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="locationLat">Latitude</Label>
                <Input
                  id="locationLat"
                  data-testid="input-location-lat"
                  value={locationLat}
                  onChange={(e) => setLocationLat(e.target.value)}
                  placeholder="43.5460"
                  type="number"
                  step="any"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="locationLon">Longitude</Label>
                <Input
                  id="locationLon"
                  data-testid="input-location-lon"
                  value={locationLon}
                  onChange={(e) => setLocationLon(e.target.value)}
                  placeholder="-96.7313"
                  type="number"
                  step="any"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="locationIcon">Icon</Label>
                <Select value={locationIcon} onValueChange={setLocationIcon}>
                  <SelectTrigger data-testid="select-location-icon">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {iconOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        <div className="flex items-center gap-2">
                          <option.icon className="w-4 h-4" />
                          {option.label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="locationColor">Color</Label>
                <div className="flex gap-2 items-center">
                  <Input
                    id="locationColor"
                    type="color"
                    data-testid="input-location-color"
                    value={locationColor}
                    onChange={(e) => setLocationColor(e.target.value)}
                    className="w-14 h-10 cursor-pointer"
                  />
                  <Input
                    type="text"
                    value={locationColor}
                    onChange={(e) => setLocationColor(e.target.value)}
                    className="flex-1 font-mono text-sm"
                  />
                </div>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="locationDescription">Description (optional)</Label>
              <Textarea
                id="locationDescription"
                data-testid="input-location-description"
                value={locationDescription}
                onChange={(e) => setLocationDescription(e.target.value)}
                placeholder="Additional notes about this location..."
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLocationDialogOpen(false)} disabled={savingLocation}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveLocation}
              disabled={savingLocation || !locationName || !locationLat || !locationLon}
              data-testid="button-save-location"
            >
              {savingLocation ? "Saving..." : editLocation ? "Update" : "Add Location"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Vehicle Confirmation */}
      <Dialog open={!!deleteVehicleId} onOpenChange={(open) => !open && setDeleteVehicleId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Vehicle</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this vehicle? This will also delete all of its location history.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteVehicleId(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteVehicle} data-testid="button-confirm-delete-vehicle">
              Delete Vehicle
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Location Confirmation */}
      <Dialog open={!!deleteLocationId} onOpenChange={(open) => !open && setDeleteLocationId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Location</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this custom location?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteLocationId(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteLocation} data-testid="button-confirm-delete-location">
              Delete Location
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add New TV Display Modal */}
      <Dialog open={addDisplayOpen} onOpenChange={setAddDisplayOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Tv className="w-5 h-5 text-sky-400" />
              Add New TV Display
            </DialogTitle>
            <DialogDescription>
              Register a new Raspberry Pi TV screen, assign it to a group, and generate its Kiosk URL & Watchdog script.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-3">
            <div className="grid gap-1.5">
              <Label>Display Name</Label>
              <Input
                value={newDispName}
                onChange={(e) => setNewDispName(e.target.value)}
                placeholder='e.g., SF Front Office — 55" 4K or Warehouse Dock 2'
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Display Group</Label>
              <Select value={newDispGroup} onValueChange={setNewDispGroup}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(displayState?.settings?.displayGroups || []).map((g: any) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Screen Size & Viewing Distance Preset</Label>
              <Select value={newDispPreset} onValueChange={(v: any) => setNewDispPreset(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="55-4k">55"–65" 4K TV — Breakroom / Office (105% Scale)</SelectItem>
                  <SelectItem value="40-4k-warehouse">40"–43" 4K TV — Warehouse Long Distance (132% + High Contrast)</SelectItem>
                  <SelectItem value="1080p">1080p Monitor / Standard Display (95% Scale)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Location / Mounting Note (Optional)</Label>
              <Input
                value={newDispLocation}
                onChange={(e) => setNewDispLocation(e.target.value)}
                placeholder="e.g., North wall above coffee station"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDisplayOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateDisplayUnit} disabled={!newDispName.trim()}>
              Create Display
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create / Edit Display Group Modal */}
      <Dialog open={groupDialogOpen} onOpenChange={setGroupDialogOpen}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderPlus className="w-5 h-5 text-primary" />
              {editingGroup ? "Edit Display Group" : "Create Display Group"}
            </DialogTitle>
            <DialogDescription>
              Group displays by building, department, or floor so you can control them together from the SF Office.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-3">
            <div className="grid gap-1.5">
              <Label>Group Name</Label>
              <Input
                value={groupNameInput}
                onChange={(e) => setGroupNameInput(e.target.value)}
                placeholder="e.g., Sioux Falls Office, Warehouse Floor, Arlington"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Badge Color</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="color"
                  value={groupColorInput}
                  onChange={(e) => setGroupColorInput(e.target.value)}
                  className="w-16 h-9 cursor-pointer"
                />
                <Input
                  value={groupColorInput}
                  onChange={(e) => setGroupColorInput(e.target.value)}
                  className="font-mono text-xs"
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>Description (Optional)</Label>
              <Input
                value={groupDescInput}
                onChange={(e) => setGroupDescInput(e.target.value)}
                placeholder="Short note for admins"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGroupDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveGroup} disabled={!groupNameInput.trim()}>
              {editingGroup ? "Save Changes" : "Create Group"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Raspberry Pi SSH Kiosk & HDMI-CEC Watchdog Setup Modal */}
      <Dialog open={!!piAgentModalUnit} onOpenChange={(open) => !open && setPiAgentModalUnit(null)}>
        <DialogContent className="sm:max-w-[650px] max-w-[95vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Terminal className="w-5 h-5 text-emerald-400 shrink-0" />
              <span className="truncate">
                Remote SSH Kiosk & Watchdog Deploy — {piAgentModalUnit?.name}
              </span>
            </DialogTitle>
            <DialogDescription>
              Remotely switch an existing DAKboard or Raspberry Pi OS TV over SSH without driving on-site. Backs up original DAKboard startup scripts automatically (1-command rollback included), launches fullscreen Chromium Kiosk, and installs the HDMI-CEC TV Power & CPU Watchdog.
            </DialogDescription>
          </DialogHeader>

          {piAgentModalUnit && (() => {
            const modalToken =
              displayState?.settings?.displayProfiles?.[piAgentModalUnit.id]?.deviceToken ||
              piAgentModalUnit.deviceToken ||
              "";
            const piDeployCmd = `npm run pi:deploy -- ${piAgentModalUnit.id}`;
            const piInspectCmd = `npm run pi:inspect -- ${piAgentModalUnit.id}`;
            const piInventorySnippet = JSON.stringify(
              {
                [piAgentModalUnit.id]: {
                  label: piAgentModalUnit.name,
                  host: "192.168.1.XXX",
                  port: 22,
                  username: "pi",
                  password: "YOUR_PI_SSH_PASSWORD",
                  displayId: piAgentModalUnit.id,
                  deviceToken: modalToken,
                },
              },
              null,
              2,
            );
            const piCurlCmd = `curl -fsSL "${originUrl}/api/display/pi-agent.sh?display=${piAgentModalUnit.id}${modalToken ? `&token=${modalToken}` : ""}" | sudo bash`;
            return (
            <div className="space-y-4 py-2 min-w-0">
              <div className="rounded-lg border border-border bg-secondary/30 p-3.5 space-y-2.5 text-xs min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-foreground">
                    Option A — Push Remotely from Your PC (`scripts/pi-deploy/pi-inventory.json`)
                  </span>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => {
                      navigator.clipboard.writeText(piInventorySnippet);
                      toast({ title: "Copied pi-inventory.json entry snippet!" });
                    }}
                  >
                    <Copy className="w-3 h-3 mr-1" />
                    Copy Inventory Entry
                  </Button>
                </div>
                <p className="text-muted-foreground">
                  Set this Pi&apos;s IP/hostname, SSH username, and password in <code className="text-foreground">scripts/pi-deploy/pi-inventory.json</code> (gitignored), then run one Pi at a time:
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Input readOnly value={piInspectCmd} className="font-mono text-[11px] h-8 min-w-0 flex-1" />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 px-2.5 shrink-0"
                      title="Copy read-only inspect command"
                      onClick={() => {
                        navigator.clipboard.writeText(piInspectCmd);
                        toast({ title: "Copied inspect command!" });
                      }}
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Input readOnly value={piDeployCmd} className="font-mono text-[11px] h-8 min-w-0 flex-1" />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 px-2.5 shrink-0"
                      title="Copy deploy command"
                      onClick={() => {
                        navigator.clipboard.writeText(piDeployCmd);
                        toast({ title: "Copied deploy command!" });
                      }}
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </div>

              <div className="space-y-1.5 min-w-0">
                <Label className="text-xs">Option B — Manual 1-Line SSH Command (Run Directly Inside an SSH Session on the Pi):</Label>
                <div className="flex items-center gap-2 min-w-0">
                  <Input
                    readOnly
                    value={piCurlCmd}
                    className="font-mono text-xs min-w-0 flex-1"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    onClick={() => {
                      navigator.clipboard.writeText(piCurlCmd);
                      toast({ title: "Copied authenticated Pi installer command!" });
                    }}
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              <div className="rounded-lg border border-border bg-secondary/40 p-3.5 space-y-2.5 text-xs min-w-0">
                <div className="font-bold">Test Pingback States Locally (Simulate Pi Telemetry):</div>
                <p className="text-muted-foreground">
                  Want to verify how the SF Office dashboard alerts you before installing on a physical Pi? Trigger a test state below:
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-emerald-400 justify-start"
                    onClick={() => handleSimulatePiState(piAgentModalUnit.id, "on", true)}
                  >
                    Simulate TV ON + Healthy
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-amber-400 justify-start"
                    onClick={() => handleSimulatePiState(piAgentModalUnit.id, "standby", true)}
                  >
                    Simulate TV Turned OFF (Standby)
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-orange-400 justify-start"
                    onClick={() => handleSimulatePiState(piAgentModalUnit.id, "on", false)}
                  >
                    Simulate Chromium Frozen / Crashed
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="justify-start"
                    onClick={() => {
                      if (window.confirm(`Send reboot command to Raspberry Pi (${piAgentModalUnit.name})?`)) {
                        handleRemoteControl(undefined, "display", piAgentModalUnit.id, "reboot_pi");
                      }
                    }}
                  >
                    Queue Remote Pi Reboot
                  </Button>
                </div>
              </div>
            </div>
            );
          })()}

          <DialogFooter>
            <Button onClick={() => setPiAgentModalUnit(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Staff User Password Dialog */}
      <Dialog open={!!resetPwUser} onOpenChange={(open) => !open && setResetPwUser(null)}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-primary" />
              Reset Password — {resetPwUser?.username}
            </DialogTitle>
            <DialogDescription>
              Set a new password (at least 8 characters) for <strong>{resetPwUser?.username}</strong>. Any active sessions for this user will require re-authentication on reconnect.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-2">
            <Label htmlFor="admin-reset-user-pw">New Password</Label>
            <Input
              id="admin-reset-user-pw"
              type="password"
              value={resetPwValue}
              onChange={(e) => setResetPwValue(e.target.value)}
              placeholder="Minimum 8 characters"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetPwUser(null)}>
              Cancel
            </Button>
            <Button onClick={handleSaveResetUserPassword} disabled={savingResetPw}>
              {savingResetPw ? "Saving..." : "Save New Password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manage Per-Driver Route Assignments & Master Route Pool Dialog */}
      <Dialog open={routeManagerOpen} onOpenChange={setRouteManagerOpen}>
        <DialogContent className="sm:max-w-[640px] max-h-[88vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ListPlus className="w-5 h-5 text-sky-400" />
              Driver Route Assignments & Master Route Pool
            </DialogTitle>
            <DialogDescription>
              Select a driver below to check/uncheck which routes appear in their schedule dropdown ({" "}
              <code>OFF</code> and <code>PTO</code> are always included automatically), or switch to{" "}
              <strong>Master Pool</strong> to add/delete fleet-wide routes.
            </DialogDescription>
          </DialogHeader>

          {/* Driver Selector Pills */}
          <div className="flex flex-wrap items-center gap-1.5 py-1 border-b border-border/60 pb-3">
            {Array.from(
              new Set([
                ...selectedTruckWeek.rows.map((r) => r.driver).filter(Boolean),
                ...normalizedTruckSchedule.driverRoster.map((r) => r.driver).filter(Boolean),
              ]),
            ).map((drvName) => {
              const count = (normalizedTruckSchedule.driverRoutes[drvName] || []).length;
              const active = routeManagerTargetDriver === drvName;
              return (
                <button
                  key={drvName}
                  type="button"
                  onClick={() => setRouteManagerTargetDriver(drvName)}
                  className={`px-2.5 py-1 rounded-lg border text-xs font-bold transition-colors flex items-center gap-1.5 ${
                    active
                      ? "border-primary bg-primary/20 text-primary"
                      : "border-border bg-secondary/30 text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                  }`}
                >
                  <span>{drvName}</span>
                  <span className="px-1.5 py-0.2 rounded bg-background/60 font-mono text-[10px]">
                    {count}
                  </span>
                </button>
              );
            })}

            <button
              type="button"
              onClick={() => setRouteManagerTargetDriver("__ALL__")}
              className={`px-2.5 py-1 rounded-lg border text-xs font-bold transition-colors flex items-center gap-1.5 ml-auto ${
                routeManagerTargetDriver === "__ALL__"
                  ? "border-amber-500/50 bg-amber-500/20 text-amber-300"
                  : "border-border bg-secondary/30 text-muted-foreground hover:text-foreground"
              }`}
            >
              <span>Master Pool ({normalizedTruckSchedule.routeOptions.length})</span>
            </button>
          </div>

          {/* Add New Route Input */}
          <div className="flex items-center gap-2 py-1">
            <Input
              value={newRouteInput}
              onChange={(e) => setNewRouteInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newRouteInput.trim()) {
                  e.preventDefault();
                  handleAddSavedRoute(newRouteInput, routeManagerTargetDriver);
                  setNewRouteInput("");
                }
              }}
              placeholder={
                routeManagerTargetDriver === "__ALL__"
                  ? "Add new route to Master Pool (e.g. SIOUX CITY, OMAHA)..."
                  : `Add new route & assign to ${routeManagerTargetDriver}...`
              }
              className="flex-1 text-xs"
            />
            <Button
              size="sm"
              onClick={() => {
                if (newRouteInput.trim()) {
                  handleAddSavedRoute(newRouteInput, routeManagerTargetDriver);
                  setNewRouteInput("");
                }
              }}
              disabled={!newRouteInput.trim()}
              className="gap-1 shrink-0"
            >
              <Plus className="w-4 h-4" />
              {routeManagerTargetDriver === "__ALL__" ? "Add to Pool" : "Add & Assign"}
            </Button>
          </div>

          {/* Route Assignment Checklist (for Selected Driver) OR Master Pool List */}
          {routeManagerTargetDriver === "__ALL__" ? (
            <div className="flex-1 overflow-y-auto rounded-lg border border-border bg-secondary/20 divide-y divide-border/60 min-h-[220px] max-h-[340px]">
              {normalizedTruckSchedule.routeOptions.map((opt) => {
                const assignedDrivers = Object.entries(normalizedTruckSchedule.driverRoutes)
                  .filter(([, list]) => list.includes(opt))
                  .map(([drv]) => drv);
                return (
                  <div
                    key={opt}
                    className="flex items-center justify-between gap-2 px-3 py-2 text-xs hover:bg-secondary/40"
                  >
                    <div className="min-w-0">
                      <span className="font-mono font-semibold">{opt}</span>
                      {assignedDrivers.length > 0 && (
                        <span className="ml-2 text-[10px] text-muted-foreground">
                          ({assignedDrivers.join(", ")})
                        </span>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-destructive shrink-0"
                      onClick={() => handleRemoveSavedRoute(opt)}
                      title={`Delete ${opt} from Master Pool`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                );
              })}
            </div>
          ) : (
            (() => {
              const assignedSet = new Set(
                normalizedTruckSchedule.driverRoutes[routeManagerTargetDriver] || [],
              );
              const assignableRoutes = normalizedTruckSchedule.routeOptions.filter(
                (r) => r.toUpperCase() !== "OFF" && r.toUpperCase() !== "PTO",
              );
              const sortedForDriver = [...assignableRoutes].sort((a, b) => {
                const aHas = assignedSet.has(a) ? 0 : 1;
                const bHas = assignedSet.has(b) ? 0 : 1;
                if (aHas !== bHas) return aHas - bHas;
                return a.localeCompare(b);
              });

              return (
                <div className="flex-1 overflow-y-auto rounded-lg border border-border bg-secondary/20 p-2 min-h-[220px] max-h-[340px]">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {sortedForDriver.map((opt) => {
                      const checked = assignedSet.has(opt);
                      return (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => handleToggleDriverRoute(routeManagerTargetDriver, opt)}
                          className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-xs transition-colors text-left ${
                            checked
                              ? "border-emerald-500/45 bg-emerald-500/15 text-emerald-200 font-bold"
                              : "border-border/60 bg-background/50 text-muted-foreground hover:text-foreground hover:bg-secondary/40"
                          }`}
                        >
                          <span className="font-mono truncate">{opt}</span>
                          {checked ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                          ) : (
                            <Plus className="w-3.5 h-3.5 opacity-40 shrink-0" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })()
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setRouteManagerOpen(false)}>
              Close
            </Button>
            <Button
              onClick={async () => {
                await saveSchedulesPayload(
                  { truckSchedule: normalizedTruckSchedule },
                  "Saved driver route assignments!",
                );
                setRouteManagerOpen(false);
              }}
              disabled={savingSchedules}
            >
              {savingSchedules ? "Saving..." : "Save Route Assignments"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* SF Team Shift Assignments & Master Shift Pool Dialog */}
      <Dialog open={sfShiftManagerOpen} onOpenChange={setSfShiftManagerOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ListPlus className="w-5 h-5 text-emerald-400" />
              SF Team Shift Assignments & Presets
            </DialogTitle>
            <DialogDescription>
              Assign shifts or specialty roles per team member so each member's dropdown stays clean (
              <code>OFF</code> and <code>PTO</code> are always included automatically). Shifts starting{" "}
              <strong>≤ 7:15 AM</strong> count as Openers; shifts ending <strong>≥ 6:00 PM</strong> count as Closers.
            </DialogDescription>
          </DialogHeader>

          {/* Team Member Selector Pills */}
          <div className="flex flex-wrap items-center gap-1.5 py-1 border-b border-border/60 pb-3 max-h-[120px] overflow-y-auto">
            {Array.from(
              new Set([
                ...selectedSfWeek.rows.map((r) => r.name).filter(Boolean),
                ...normalizedSfSchedule.memberRoster.map((r) => r.name).filter(Boolean),
              ]),
            ).map((mName) => {
              const count = (normalizedSfSchedule.memberShifts[mName] || []).length;
              const active = sfShiftManagerTargetMember === mName;
              return (
                <button
                  key={mName}
                  type="button"
                  onClick={() => setSfShiftManagerTargetMember(mName)}
                  className={`px-2.5 py-1 rounded-lg border text-xs font-bold transition-colors flex items-center gap-1.5 ${
                    active
                      ? "border-primary bg-primary/20 text-primary"
                      : "border-border bg-secondary/30 text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                  }`}
                >
                  <span>{mName}</span>
                  <span className="px-1.5 py-0.2 rounded bg-background/60 font-mono text-[10px]">
                    {count}
                  </span>
                </button>
              );
            })}

            <button
              type="button"
              onClick={() => setSfShiftManagerTargetMember("__ALL__")}
              className={`px-2.5 py-1 rounded-lg border text-xs font-bold transition-colors flex items-center gap-1.5 ml-auto ${
                sfShiftManagerTargetMember === "__ALL__"
                  ? "border-amber-500/50 bg-amber-500/20 text-amber-300"
                  : "border-border bg-secondary/30 text-muted-foreground hover:text-foreground"
              }`}
            >
              <span>Master Pool ({normalizedSfSchedule.shiftOptions.length})</span>
            </button>
          </div>

          {/* Add New Shift Preset Input */}
          <div className="flex items-center gap-2 py-1">
            <Input
              value={newSfShiftInput}
              onChange={(e) => setNewSfShiftInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newSfShiftInput.trim()) {
                  e.preventDefault();
                  handleAddSavedSfShift(newSfShiftInput, sfShiftManagerTargetMember);
                  setNewSfShiftInput("");
                }
              }}
              placeholder={
                sfShiftManagerTargetMember === "__ALL__"
                  ? "Add new shift/role to Master Pool (e.g. 7:00-4:00, Receiving)..."
                  : `Add new shift & assign to ${sfShiftManagerTargetMember}...`
              }
              className="flex-1 text-xs"
            />
            <Button
              size="sm"
              onClick={() => {
                if (newSfShiftInput.trim()) {
                  handleAddSavedSfShift(newSfShiftInput, sfShiftManagerTargetMember);
                  setNewSfShiftInput("");
                }
              }}
              disabled={!newSfShiftInput.trim()}
              className="gap-1 shrink-0"
            >
              <Plus className="w-4 h-4" />
              {sfShiftManagerTargetMember === "__ALL__" ? "Add to Pool" : "Add & Assign"}
            </Button>
          </div>

          {/* Shift Assignment Checklist OR Master Shift Pool */}
          {sfShiftManagerTargetMember === "__ALL__" ? (
            <div className="flex-1 overflow-y-auto rounded-lg border border-border bg-secondary/20 divide-y divide-border/60 min-h-[220px] max-h-[320px]">
              {normalizedSfSchedule.shiftOptions.map((opt) => {
                const isOp = isOpeningShift(opt);
                const isCl = isClosingShift(opt);
                return (
                  <div
                    key={opt}
                    className="flex items-center justify-between gap-2 px-3 py-2 text-xs hover:bg-secondary/40"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono font-semibold">{opt}</span>
                      {isOp && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-sky-500/15 border border-sky-500/30 text-[10px] font-bold text-sky-300">
                          <Sun className="w-2.5 h-2.5" />
                          Opener
                        </span>
                      )}
                      {isCl && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-indigo-500/15 border border-indigo-500/30 text-[10px] font-bold text-indigo-300">
                          <Moon className="w-2.5 h-2.5" />
                          Closer
                        </span>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-destructive shrink-0"
                      onClick={() => handleRemoveSavedSfShift(opt)}
                      title={`Delete ${opt} from Master Shift Pool`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                );
              })}
            </div>
          ) : (
            (() => {
              const assignedSet = new Set(
                normalizedSfSchedule.memberShifts[sfShiftManagerTargetMember] || [],
              );
              const assignableShifts = normalizedSfSchedule.shiftOptions.filter(
                (s) => s.toUpperCase() !== "OFF" && s.toUpperCase() !== "PTO",
              );
              const sortedForMember = [...assignableShifts].sort((a, b) => {
                const aHas = assignedSet.has(a) ? 0 : 1;
                const bHas = assignedSet.has(b) ? 0 : 1;
                if (aHas !== bHas) return aHas - bHas;
                return a.localeCompare(b);
              });

              return (
                <div className="flex-1 overflow-y-auto rounded-lg border border-border bg-secondary/20 p-2 min-h-[220px] max-h-[320px]">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {sortedForMember.map((opt) => {
                      const checked = assignedSet.has(opt);
                      const isOp = isOpeningShift(opt);
                      const isCl = isClosingShift(opt);
                      return (
                        <button
                          key={opt}
                          type="button"
                          onClick={() =>
                            handleToggleMemberSfShift(sfShiftManagerTargetMember, opt)
                          }
                          className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-xs transition-colors text-left ${
                            checked
                              ? "border-emerald-500/45 bg-emerald-500/15 text-emerald-200 font-bold"
                              : "border-border/60 bg-background/50 text-muted-foreground hover:text-foreground hover:bg-secondary/40"
                          }`}
                        >
                          <span className="inline-flex items-center gap-1.5 min-w-0">
                            <span className="font-mono truncate">{opt}</span>
                            {isOp && <Sun className="w-3 h-3 text-sky-400 shrink-0" />}
                            {isCl && <Moon className="w-3 h-3 text-indigo-400 shrink-0" />}
                          </span>
                          {checked ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                          ) : (
                            <Plus className="w-3.5 h-3.5 opacity-40 shrink-0" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })()
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setSfShiftManagerOpen(false)}>
              Close
            </Button>
            <Button
              onClick={async () => {
                await saveSchedulesPayload(
                  { sfSchedule: normalizedSfSchedule },
                  "Saved SF shift assignments!",
                );
                setSfShiftManagerOpen(false);
              }}
              disabled={savingSchedules}
            >
              {savingSchedules ? "Saving..." : "Save Shift Assignments"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change Own Password Dialog (Accessible from Header in Simplified Staff View) */}
      <Dialog open={ownPasswordDialogOpen} onOpenChange={setOwnPasswordDialogOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-primary" />
              Change My Password
            </DialogTitle>
            <DialogDescription>
              Signed in as <strong>{currentUser?.username}</strong>. Enter your current password and a new password (8+ characters).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label className="text-xs">Current Password</Label>
              <Input
                type="password"
                value={ownCurrentPw}
                onChange={(e) => setOwnCurrentPw(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">New Password (8+ chars)</Label>
              <Input
                type="password"
                value={ownNewPw}
                onChange={(e) => setOwnNewPw(e.target.value)}
                autoComplete="new-password"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOwnPasswordDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleChangeOwnPassword} disabled={savingOwnPw}>
              {savingOwnPw ? "Updating..." : "Update Password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Per-TV Map Area Selector Modal */}
      {mapAreaModalUnit && (() => {
        const targetProf =
          displayState?.settings?.displayProfiles?.[mapAreaModalUnit.id] || mapAreaModalUnit;
        const savedRegs: SavedMapRegion[] = displayState?.settings?.savedMapRegions || [];
        return (
          <MapAreaSelectorModal
            open={Boolean(mapAreaModalUnit)}
            onOpenChange={(o) => {
              if (!o) setMapAreaModalUnit(null);
            }}
            title={`Customize Map Area — ${targetProf.name || mapAreaModalUnit.id}`}
            initialPreset={targetProf.mapRegionMode || "auto"}
            initialCustomBounds={targetProf.customMapBounds || null}
            initialEtaHub={targetProf.mapEtaHub || "auto"}
            showEtaHubSelector
            allowFollowDefault
            savedRegions={savedRegs}
            onSaveRegions={async (nextRegions) => {
              const nextSettings = {
                ...(displayState?.settings || {}),
                savedMapRegions: nextRegions,
              };
              setDisplayState((prev: any) => ({ ...prev, settings: nextSettings }));
              await handleSaveDisplaySettings(nextSettings);
            }}
            onApply={(res) => {
              handleUpdateDisplayUnit(
                mapAreaModalUnit.id,
                {
                  mapRegionMode: res.preset,
                  customMapBounds: res.preset === "custom" ? res.customBounds : null,
                  mapEtaHub: res.etaHub || "auto",
                },
                `Updated map area for ${targetProf.name || mapAreaModalUnit.id}`,
              );
              setMapAreaModalUnit(null);
            }}
          />
        );
      })()}

      {/* Colored Route Territories & Town Sequence Editor Modal */}
      <RouteTerritoriesEditorDialog
        open={routeTerritoriesDialogOpen}
        onOpenChange={setRouteTerritoriesDialogOpen}
        routeTerritories={displayState?.routeTerritories}
        onSaved={(nextState) => setDisplayState(nextState)}
      />

      {/* Delete TV Display Unit Confirmation Modal */}
      <Dialog
        open={Boolean(deleteDisplayTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteDisplayTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="w-5 h-5" />
              Delete TV Display
            </DialogTitle>
            <DialogDescription>
              Remove TV display{" "}
              <strong className="text-foreground">"{deleteDisplayTarget?.name}"</strong> (
              <code>?display={deleteDisplayTarget?.id}</code>)? Any browser paired to this display
              will be disconnected and return to the pairing screen.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setDeleteDisplayTarget(null)}
              disabled={deletingDisplay}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDeleteDisplayUnit}
              disabled={deletingDisplay}
              data-testid="button-confirm-delete-tv-unit"
            >
              {deletingDisplay ? "Removing..." : "Delete Display"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <DoodleworksLegalFooter compact={false} />
    </div>
  );
}
