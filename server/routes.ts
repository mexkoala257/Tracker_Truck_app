import express, { type Express } from "express";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { insertVehicleSchema, insertCustomLocationSchema, type VehicleLocation, type CustomLocation } from "@shared/schema";
import { normalizeTruckScheduleState } from "@shared/truckSchedule";
import { normalizeSfScheduleState } from "@shared/sfSchedule";
import { normalizePlaylistEntries } from "@shared/customScreens";
import {
  DEFAULT_TV_POWER_SCHEDULE,
  normalizeTvPowerSchedule,
  normalizeUnitPowerOverride,
  evaluateTvPowerSchedule,
} from "@shared/tvPowerSchedule";
import {
  isValidMapBoundingBox,
  normalizeMapBoundingBox,
  normalizeSavedMapRegions,
} from "@shared/mapRegions";
import {
  DEFAULT_ROUTE_TERRITORIES,
  normalizeRouteTerritories,
  lookupKnownTownCoords,
} from "@shared/routeTerritories";
import {
  DEFAULT_PHOTO_GALLERY_STATE,
  normalizePhotoGalleryState,
} from "@shared/photoGallery";
import {
  normalizeWeatherOverlayMode,
  normalizeWeatherDemoScenario,
} from "@shared/weatherOverlay";
import {
  type HotShotRoute,
  type HotShotOriginHub,
  normalizeHotShotRoute,
  normalizeHotShotRoutes,
  normalizeHotShotOriginHub,
  getHotShotHubMeta,
  getActiveTodayHotShots,
  getCentralDateISO,
  haversineMiles,
  HOTSHOT_STOP_GEOFENCE_MILES,
  getHotShotStopGeofenceMiles,
  HOTSHOT_COLOR_PALETTE,
  buildHotShotTownSequenceLabel,
  estimateHotShotVehicleCandidates,
  replayVehicleHistoryOnHotShotRoute,
} from "@shared/hotshots";
import { parseHotShotPdfBuffer, geocodeStreetOrTown } from "./hotshotParser";
import {
  startHotShotSheetPolling,
  syncHotShotSheetNow,
  getHotShotSyncStatus,
  getHotShotOpenOrders,
  getRecentHotShotAlerts,
  setHotShotSyncHook,
  buildTestHotShotDeliveryAlert,
} from "./hotshotSheetPoller";
import {
  startAutoHistorySeedOnBoot,
  startHotShotHistoryBackfill,
  stopHotShotHistoryBackfill,
  getHotShotHistoryBackfillStatus,
  queryCustomerHistorySummaries,
  getCustomerDeliveryTimeline,
  queryHistoricalCorridorMapData,
} from "./hotshotHistoryService";
import { log } from "./app";
import { startPolling, pollNow, getPollResults, clearPollResults, setBroadcastFunction } from "./motivePoller";
import { handleTileProxyRequest, getTileCacheStats } from "./tileProxy";
import {
  getDisplayState,
  saveDisplayState,
  resetDisplayStateToCleanBaseline,
  normalizeIncomingMessage,
  refreshLiveWeather,
  refreshLiveNews,
  refreshLiveNwsAlerts,
  syncIcsCalendarFeed,
  getDisplayTelemetry,
  deleteDisplayTelemetry,
  getEnrichedDisplayFleetSnapshot,
  evaluateScheduledPowerActions,
  checkDisplayHealthTransitions,
  slugifyDisplayId,
  generateRaspberryPiAgentScript,
  generateDisplayToken,
  generateWebhookApiKey,
  generateEmbedToken,
  sanitizeDisplayStateForScope,
} from "./displayService";
import {
  type AuthPrincipal,
  setupAuthMiddleware,
  ensureBootstrapAdmin,
  resolveRequestPrincipal,
  resolveUpgradePrincipal,
  requireAdmin,
  requireEditor,
  requireStaff,
  requireDisplayRead,
  requireMapRead,
  requireKioskForDisplayOrAdmin,
  normalizeUserRole,
  hashPassword,
  verifyPassword,
  sanitizeUser,
  timingSafeEqualString,
  checkLoginRateLimit,
  recordFailedLogin,
  clearFailedLogins,
  setKioskAuthCookie,
  clearKioskAuthCookie,
  verifyRawDisplayToken,
  createTvPairingRequest,
  getTvPairingByPairId,
  consumeApprovedPairing,
  listPendingTvPairings,
  approveTvPairingByCode,
  rejectTvPairingByCode,
} from "./auth";

interface AuthenticatedWebSocket extends WebSocket {
  principal?: AuthPrincipal;
}

// Store connected WebSocket clients
const wsClients = new Set<AuthenticatedWebSocket>();

// Vehicle metadata cache to avoid DB lookups on every poll broadcast
const vehicleMetadataCache = new Map<string, { name: string; color: string }>();
let metadataCacheInitialized = false;

// Cache for latest vehicle locations (avoids DB hit on every dashboard load)
const LOCATION_CACHE_TTL_MS = 10 * 1000;
let locationCache: { data: any[]; timestamp: number } | null = null;

function invalidateLocationCache() {
  locationCache = null;
}

async function initVehicleMetadataCache() {
  if (metadataCacheInitialized) return;
  try {
    const vehicles = await storage.getAllVehicles();
    for (const v of vehicles) {
      vehicleMetadataCache.set(v.vehicleId, { name: v.name || v.vehicleId, color: v.color || "#3b82f6" });
    }
    metadataCacheInitialized = true;
    log(`Vehicle metadata cache initialized with ${vehicles.length} vehicles`, "cache");
  } catch (error) {
    log(`Failed to initialize vehicle metadata cache: ${error}`, "cache");
  }
}

function getVehicleMetadata(vehicleId: string): { name: string; color: string } {
  return vehicleMetadataCache.get(vehicleId) || { name: vehicleId, color: "#3b82f6" };
}

function updateVehicleMetadataCache(vehicleId: string, name: string, color: string) {
  vehicleMetadataCache.set(vehicleId, { name, color });
}

async function loadVehicleMetadata(vehicleId: string): Promise<{ name: string; color: string }> {
  const cached = vehicleMetadataCache.get(vehicleId);
  if (cached) return cached;

  try {
    const vehicle = await storage.getVehicle(vehicleId);
    if (vehicle) {
      const metadata = {
        name: vehicle.name || vehicleId,
        color: vehicle.color || "#3b82f6",
      };
      updateVehicleMetadataCache(vehicleId, metadata.name, metadata.color);
      return metadata;
    }
  } catch (error: any) {
    log(`Could not load metadata for ${vehicleId}: ${error.message}`, "cache");
  }

  return { name: vehicleId, color: "#3b82f6" };
}

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);
  
  // Initialize vehicle metadata cache on startup
  await setupAuthMiddleware(app);
  await ensureBootstrapAdmin();
  await initVehicleMetadataCache();

  // Setup WebSocket server
  const wss = new WebSocketServer({ 
    noServer: true,
    // path verified in httpServer upgrade handler below
  });

  httpServer.on("upgrade", async (req, socket, head) => {
    try {
      const pathname = new URL(req.url || "/", "http://localhost").pathname;
      if (pathname !== "/ws") return;

      const principal = await resolveUpgradePrincipal(req);
      if (!principal) {
        socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        const authWs = ws as AuthenticatedWebSocket;
        authWs.principal = principal;
        wss.emit("connection", authWs, req);
      });
    } catch {
      socket.destroy();
    }
  });

  wss.on("connection", (ws: AuthenticatedWebSocket) => {
    log("WebSocket client connected", "ws");
    wsClients.add(ws);

    ws.on("close", () => {
      log("WebSocket client disconnected", "ws");
      wsClients.delete(ws);
    });

    ws.on("error", (error) => {
      log(`WebSocket error: ${error.message}`, "ws");
      wsClients.delete(ws);
    });
  });

  // Set up the broadcast function for the poller
  setBroadcastFunction(async (vehicleId, data) => {
    const vehicleMeta = await loadVehicleMetadata(vehicleId);
    const message = JSON.stringify({
      type: "location_update",
      data: {
        id: vehicleId,
        name: vehicleMeta.name,
        color: vehicleMeta.color,
        location: {
          lat: data.latitude,
          lon: data.longitude,
        },
        speed: data.speed,
        heading: data.heading,
        status: data.status,
        timestamp: data.timestamp.toISOString(),
      }
    });

    wsClients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });

    invalidateLocationCache();
  });

  // Start API polling
  startPolling();

  const isLocalDemoSyncEnabled = () =>
    !process.env.DATABASE_URL &&
    !process.env.MOTIVE_API_KEY &&
    typeof storage.syncReadOnlySnapshotFromLiveVps === "function";

  const runLocalDemoVehicleSync = async () => {
    if (!storage.syncReadOnlySnapshotFromLiveVps) {
      return { synced: false, vehicleCount: 0, vehicles: [] };
    }
    const result = await storage.syncReadOnlySnapshotFromLiveVps();
    for (const v of result.vehicles) {
      updateVehicleMetadataCache(v.id, v.name, v.color);
      const wsMsg = JSON.stringify({
        type: "location_update",
        data: v,
      });
      wsClients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(wsMsg);
        }
      });
    }
    invalidateLocationCache();
    return result;
  };

  app.get("/api/demo/status", requireEditor, (_req, res) => {
    res.json({
      localDemoSyncAvailable: isLocalDemoSyncEnabled(),
    });
  });

  // Get poll results + Motive API key status + Map tile disk cache stats
  app.get("/api/poll/results", requireAdmin, async (_req, res) => {
    res.json({
      apiKeyConfigured: Boolean(process.env.MOTIVE_API_KEY),
      localDemoSyncAvailable: isLocalDemoSyncEnabled(),
      tileCache: getTileCacheStats(),
      count: getPollResults().length,
      results: getPollResults(),
    });
  });

  // On-demand disk-cached OpenStreetMap tile proxy (500 MB auto-pruning cap)
  app.get("/api/tiles/:z/:x/:yPng", requireMapRead, handleTileProxyRequest);

  // Clear poll results
  app.delete("/api/poll/results", requireAdmin, async (_req, res) => {
    clearPollResults();
    res.json({ success: true, message: "Poll results cleared" });
  });

  // Retired inbound Motive webhook (GPS telemetry runs strictly via outbound API polling)
  app.post("/api/webhooks/motive", (_req, res) => {
    res.status(410).json({
      success: false,
      error: "Inbound Motive webhook is retired. Telemetry runs via outbound Motive API polling.",
    });
  });

  // Get latest location for a vehicle
  app.get("/api/vehicles/:vehicleId/location", requireMapRead, async (req, res) => {
    try {
      const { vehicleId } = req.params;
      const location = await storage.getLatestVehicleLocation(vehicleId);
      
      if (!location) {
        return res.status(404).json({ error: "Vehicle not found" });
      }

      res.json({
        id: location.vehicleId,
        location: {
          lat: location.latitude,
          lon: location.longitude,
        },
        speed: location.speed,
        heading: location.heading,
        status: location.status,
        timestamp: location.timestamp.toISOString(),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get location history for a vehicle
  app.get("/api/vehicles/:vehicleId/history", requireMapRead, async (req, res) => {
    try {
      const { vehicleId } = req.params;
      const limit = parseInt(req.query.limit as string) || 100;
      
      const history = await storage.getVehicleLocationHistory(vehicleId, limit);
      
      res.json(history.map(loc => ({
        id: loc.vehicleId,
        location: {
          lat: loc.latitude,
          lon: loc.longitude,
        },
        speed: loc.speed,
        heading: loc.heading,
        status: loc.status,
        timestamp: loc.timestamp.toISOString(),
      })));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Upsert vehicle metadata (name, color, warehouse assignment)
  app.post("/api/vehicles/:vehicleId", requireEditor, async (req, res) => {
    try {
      const { vehicleId } = req.params;
      const { name, color, homeLocationId } = req.body;
      const normalizedHomeLocationId =
        homeLocationId === null || homeLocationId === undefined
          ? homeLocationId
          : Number(homeLocationId);

      if (
        normalizedHomeLocationId !== null &&
        normalizedHomeLocationId !== undefined &&
        (!Number.isInteger(normalizedHomeLocationId) || normalizedHomeLocationId < 1)
      ) {
        return res.status(400).json({ error: "Invalid warehouse location" });
      }

      if (normalizedHomeLocationId !== null && normalizedHomeLocationId !== undefined) {
        const locations = await storage.getAllCustomLocations();
        if (!locations.some((location) => location.id === normalizedHomeLocationId)) {
          return res.status(404).json({ error: "Warehouse location not found" });
        }
      }
      
      const vehicleData = insertVehicleSchema.parse({
        vehicleId,
        name,
        color,
        homeLocationId: normalizedHomeLocationId,
      });
      
      const vehicle = await storage.upsertVehicle(vehicleData);
      
      // Update cache to avoid stale data
      updateVehicleMetadataCache(vehicleId, name || vehicleId, color || "#3b82f6");
      
      // Invalidate location cache so updated name/color is reflected immediately
      locationCache = null;
      
      log(`Updated vehicle metadata cache for ${vehicleId}`, "cache");
      
      res.json(vehicle);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Get all vehicles with metadata
  app.get("/api/vehicles/metadata", requireMapRead, async (req, res) => {
    try {
      const vehiclesMeta = await storage.getAllVehicles();
      res.json(vehiclesMeta);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get all vehicles with their latest locations
  app.get("/api/vehicles", requireMapRead, async (req, res) => {
    try {
      const now = Date.now();
      
      // Return cached data if still valid (30 second TTL)
      if (locationCache && (now - locationCache.timestamp) < LOCATION_CACHE_TTL_MS) {
        return res.json(locationCache.data);
      }
      
       const locations = await storage.getAllVehicleLatestLocations();
       const vehicleMetadata = await storage.getAllVehicles();
       const metadataById = new Map(
         vehicleMetadata.map((vehicle) => [vehicle.vehicleId, vehicle]),
       );

      const result = locations.map((loc: VehicleLocation) => {
         const storedMeta = metadataById.get(loc.vehicleId);
         const meta = storedMeta
           ? {
               name: storedMeta.name || loc.vehicleId,
               color: storedMeta.color || "#3b82f6",
             }
           : getVehicleMetadata(loc.vehicleId);
        return {
          id: loc.vehicleId,
          name: meta.name,
          color: meta.color,
          location: {
            lat: loc.latitude,
            lon: loc.longitude,
          },
          speed: loc.speed,
          heading: loc.heading,
          status: loc.status,
          timestamp: loc.timestamp.toISOString(),
        };
      });
      
      // Cache the result
      locationCache = { data: result, timestamp: now };
      
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Export vehicle location data as CSV
  app.get("/api/vehicles/export/csv", requireAdmin, async (req, res) => {
    try {
      const { startDate, endDate, vehicleId } = req.query;
      
      const filters: { startDate?: Date; endDate?: Date; vehicleId?: string } = {};
      
      if (startDate) {
        const parsed = new Date(startDate as string);
        if (isNaN(parsed.getTime())) {
          return res.status(400).json({ error: "Invalid startDate format" });
        }
        filters.startDate = parsed;
      }
      
      if (endDate) {
        const parsed = new Date(endDate as string);
        if (isNaN(parsed.getTime())) {
          return res.status(400).json({ error: "Invalid endDate format" });
        }
        filters.endDate = parsed;
      }
      
      if (filters.startDate && filters.endDate && filters.startDate > filters.endDate) {
        return res.status(400).json({ error: "startDate must be before endDate" });
      }
      
      if (vehicleId) filters.vehicleId = vehicleId as string;

      const locations = await storage.getAllVehicleLocations(filters);

      const escapeCSV = (value: any): string => {
        const str = String(value ?? '');
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
      };

      const csv = [
        ['Vehicle ID', 'Latitude', 'Longitude', 'Speed (mph)', 'Heading (degrees)', 'Status', 'Timestamp', 'Received At'].join(','),
        ...locations.map(loc => [
          escapeCSV(loc.vehicleId),
          loc.latitude,
          loc.longitude,
          loc.speed,
          loc.heading,
          escapeCSV(loc.status),
          loc.timestamp.toISOString(),
          loc.receivedAt.toISOString()
        ].join(','))
      ].join('\n');

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="vehicle-locations-${new Date().toISOString().split('T')[0]}.csv"`);
      res.send(csv);
    } catch (error: any) {
      log(`❌ Export error: ${error.message}`, "export");
      res.status(500).json({ error: error.message });
    }
  });

  // Delete a vehicle and all its location history
  app.delete("/api/vehicles/:vehicleId", requireAdmin, async (req, res) => {
    try {
      const { vehicleId } = req.params;
      
      await storage.deleteVehicle(vehicleId);
      
      // Remove from metadata cache
      vehicleMetadataCache.delete(vehicleId);
      
      // Invalidate location cache
      locationCache = null;
      
      log(`Deleted vehicle ${vehicleId}`, "admin");
      
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Home-location assignments for the map display pages
  app.get("/api/map-home-locations", requireMapRead, async (req, res) => {
    try {
      const assignments = await storage.getMapHomeLocations();
      const result: Record<string, {
        locationId: number;
        location: CustomLocation;
      } | null> = {
        map: null,
        "regional-sf": null,
      };

      for (const assignment of assignments) {
        if (assignment.mapKey in result) {
          result[assignment.mapKey] = {
            locationId: assignment.locationId,
            location: assignment.location,
          };
        }
      }

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/map-home-locations/:mapKey", requireEditor, async (req, res) => {
    try {
      const { mapKey } = req.params;
      if (mapKey !== "map" && mapKey !== "regional-sf") {
        return res.status(400).json({ error: "Invalid map key" });
      }

      if (req.body?.locationId === null) {
        await storage.clearMapHomeLocation(mapKey);
        return res.json({ mapKey, assignment: null });
      }

      const locationId = Number(req.body?.locationId);
      if (!Number.isInteger(locationId) || locationId < 1) {
        return res.status(400).json({ error: "A valid custom location is required" });
      }

      const location = (await storage.getAllCustomLocations())
        .find((candidate) => candidate.id === locationId);
      if (!location) {
        return res.status(404).json({ error: "Custom location not found" });
      }

      const assignment = await storage.setMapHomeLocation(mapKey, locationId);
      log(`Assigned ${location.name} as the ${mapKey} map home location`, "admin");
      res.json({
        mapKey,
        assignment: {
          locationId: assignment.locationId,
          location: assignment.location,
        },
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Custom locations routes
  app.get("/api/custom-locations", requireMapRead, async (req, res) => {
    try {
      const locations = await storage.getAllCustomLocations();
      res.json(locations);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/custom-locations", requireEditor, async (req, res) => {
    try {
      const locationData = insertCustomLocationSchema.parse(req.body);
      const location = await storage.createCustomLocation(locationData);
      
      log(`Created custom location: ${location.name}`, "admin");
      
      res.json(location);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.put("/api/custom-locations/:id", requireEditor, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid location ID" });
      }
      
      // Validate partial update data
      const partialSchema = insertCustomLocationSchema.partial();
      const locationData = partialSchema.parse(req.body);
      
      const location = await storage.updateCustomLocation(id, locationData);
      
      if (!location) {
        return res.status(404).json({ error: "Custom location not found" });
      }
      
      log(`Updated custom location: ${location.name}`, "admin");
      
      res.json(location);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.delete("/api/custom-locations/:id", requireEditor, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid location ID" });
      }
      
      await storage.deleteCustomLocation(id);
      
      log(`Deleted custom location ${id}`, "admin");
      
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // =========================================================================
  // AUTHENTICATION, USER ROLES, TV PAIRING & SECURITY LAYER
  // =========================================================================
  const disconnectSocketsWhere = (predicate: (p?: AuthPrincipal) => boolean) => {
    wsClients.forEach((client) => {
      if (predicate(client.principal)) {
        try {
          client.close(4001, "Credentials revoked or updated");
        } catch {}
        wsClients.delete(client);
      }
    });
  };

  const broadcastDisplayEvent = (eventType: string, payload: any) => {
    const adminMsg = JSON.stringify({ type: eventType, payload });
    const sanitizedStatePayload =
      eventType === "display_state_update"
        ? JSON.stringify({
            type: eventType,
            payload: sanitizeDisplayStateForScope(payload, false),
          })
        : null;
    const sanitizedFleetTelemetryPayload =
      eventType === "display_fleet_telemetry"
        ? JSON.stringify({
            type: eventType,
            payload: {
              ...payload,
              displayUnits: (payload?.displayUnits || []).map((u: any) => {
                const { deviceToken: _dt, telemetry, ...rest } = u;
                return {
                  ...rest,
                  telemetry: telemetry ? { ...telemetry, ipAddress: null } : telemetry,
                };
              }),
            },
          })
        : null;

    wsClients.forEach((client) => {
      if (client.readyState !== WebSocket.OPEN) return;
      const scope = client.principal?.scope;
      if (!scope || scope === "embed") return; // Embed sockets only receive location_update

      if (eventType === "display_fleet_telemetry") {
        if (scope === "admin") {
          client.send(adminMsg);
        } else if (scope === "staff" && sanitizedFleetTelemetryPayload) {
          client.send(sanitizedFleetTelemetryPayload);
        }
        return;
      }

      if (eventType === "display_pairing_update" || eventType === "display_health_alert") {
        if (scope === "admin") {
          client.send(adminMsg);
        }
        return;
      }

      if (eventType === "display_state_update") {
        client.send(scope === "admin" ? adminMsg : sanitizedStatePayload!);
        return;
      }

      client.send(adminMsg);
    });
  };

  const buildClientDisplayState = async () => {
    const state = await getDisplayState();
    const displayUnits = await getEnrichedDisplayFleetSnapshot();
    return {
      ...state,
      truckSchedule: normalizeTruckScheduleState(state.truckSchedule, new Date()),
      hotShotOpenOrders: getHotShotOpenOrders(),
      hotShotSyncStatus: getHotShotSyncStatus(),
      hotShotRecentAlerts: getRecentHotShotAlerts(),
      displayUnits,
      pendingPairings: listPendingTvPairings(),
      connectedClients: wsClients.size,
      serverTime: new Date().toISOString(),
    };
  };

  // --- Auth Session & Account Endpoints ---
  app.get("/api/auth/me", async (req, res) => {
    const principal = await resolveRequestPrincipal(req);
    if (!principal) {
      return res.json({ authenticated: false, scope: null });
    }
    if (
      principal.scope === "admin" ||
      principal.scope === "staff" ||
      principal.scope === "viewer"
    ) {
      return res.json({
        authenticated: true,
        scope: principal.scope,
        user: {
          id: principal.userId,
          username: principal.username,
          role: principal.scope,
          displayName: principal.displayName || principal.username,
        },
      });
    }
    if (principal.scope === "kiosk") {
      return res.json({
        authenticated: true,
        scope: "kiosk",
        displayId: principal.displayId,
      });
    }
    return res.json({
      authenticated: true,
      scope: "embed",
    });
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const forwarded = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim();
      const clientIp = forwarded || req.ip || req.socket.remoteAddress || "unknown";

      const rateCheck = checkLoginRateLimit(clientIp);
      if (!rateCheck.allowed) {
        return res.status(429).json({
          ok: false,
          error: `Too many failed login attempts. Try again in ${Math.ceil(rateCheck.retryAfterSec / 60)} min.`,
        });
      }

      const { username, password } = req.body || {};
      if (!username || !password) {
        return res.status(400).json({ ok: false, error: "Username and password are required" });
      }

      const user = await storage.getUserByUsername(String(username));
      const valid = user ? await verifyPassword(String(password), user.password) : false;

      if (!user || !valid) {
        recordFailedLogin(clientIp);
        return res.status(401).json({ ok: false, error: "Invalid username or password" });
      }

      clearFailedLogins(clientIp);

      await new Promise<void>((resolve, reject) => {
        req.session.regenerate((err) => {
          if (err) return reject(err);
          req.session.userId = user.id;
          req.session.save((saveErr) => (saveErr ? reject(saveErr) : resolve()));
        });
      });

      // Clear any leftover 365-day TV Kiosk cookie if an admin tested TV pairing in this browser
      clearKioskAuthCookie(res);

      log(`User '${user.username}' (${user.role}) signed in from ${clientIp}`, "auth");
      res.json({ ok: true, user: sanitizeUser(user) });
    } catch (error: any) {
      res.status(500).json({ ok: false, error: "Failed to complete sign in" });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    const userId = req.session?.userId;
    req.session.destroy(() => {
      res.clearCookie("fleet_sid", { path: "/" });
      clearKioskAuthCookie(res);
      if (userId) {
        disconnectSocketsWhere((p) => p?.userId === userId);
      }
      res.json({ ok: true });
    });
  });

  app.put("/api/auth/password", requireStaff, async (req, res) => {
    try {
      const principal = req.principal!;
      const { currentPassword, newPassword } = req.body || {};
      if (!currentPassword || !newPassword || String(newPassword).length < 8) {
        return res.status(400).json({
          ok: false,
          error: "Current password and a new password of at least 8 characters are required",
        });
      }
      const user = await storage.getUser(principal.userId!);
      if (!user) return res.status(404).json({ ok: false, error: "User not found" });

      const matches = await verifyPassword(String(currentPassword), user.password);
      if (!matches) {
        return res.status(401).json({ ok: false, error: "Current password is incorrect" });
      }

      const passwordHash = await hashPassword(String(newPassword));
      await storage.updateUser(user.id, { password: passwordHash });
      log(`User '${user.username}' updated their password`, "auth");
      res.json({ ok: true });
    } catch (error: any) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/auth/users", requireAdmin, async (_req, res) => {
    try {
      const allUsers = await storage.getAllUsers();
      res.json({ ok: true, users: allUsers.map(sanitizeUser) });
    } catch (error: any) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/auth/users", requireAdmin, async (req, res) => {
    try {
      const { username, password, role, displayName } = req.body || {};
      const cleanUser = String(username || "").trim();
      if (!cleanUser || cleanUser.length < 2) {
        return res.status(400).json({ ok: false, error: "Username must be at least 2 characters" });
      }
      if (!password || String(password).length < 8) {
        return res.status(400).json({ ok: false, error: "Password must be at least 8 characters" });
      }
      const existing = await storage.getUserByUsername(cleanUser);
      if (existing) {
        return res.status(409).json({ ok: false, error: "Username already exists" });
      }
      const normalizedRole = normalizeUserRole(role);
      const passwordHash = await hashPassword(String(password));
      const created = await storage.createUser({
        username: cleanUser,
        password: passwordHash,
        role: normalizedRole,
        displayName: displayName ? String(displayName).trim() : cleanUser,
      });

      const allUsers = await storage.getAllUsers();
      log(`Admin created user '${created.username}' (${created.role})`, "auth");
      res.json({ ok: true, user: sanitizeUser(created), users: allUsers.map(sanitizeUser) });
    } catch (error: any) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.put("/api/auth/users/:id", requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const target = await storage.getUser(id);
      if (!target) return res.status(404).json({ ok: false, error: "User not found" });

      const { role, displayName, password } = req.body || {};
      const allUsers = await storage.getAllUsers();
      const adminCount = allUsers.filter((u) => normalizeUserRole(u.role) === "admin").length;

      if (
        role !== undefined &&
        normalizeUserRole(role) !== "admin" &&
        normalizeUserRole(target.role) === "admin" &&
        adminCount <= 1
      ) {
        return res.status(400).json({
          ok: false,
          error: "Cannot demote the last remaining Technical Admin account",
        });
      }

      const updates: Record<string, any> = {};
      if (role === "admin" || role === "staff" || role === "viewer") updates.role = role;
      if (displayName !== undefined) updates.displayName = String(displayName).trim() || target.username;
      if (password && String(password).trim() !== "") {
        if (String(password).length < 8) {
          return res.status(400).json({ ok: false, error: "New password must be at least 8 characters" });
        }
        updates.password = await hashPassword(String(password));
      }

      const updated = await storage.updateUser(id, updates);
      if (updates.role || updates.password) {
        disconnectSocketsWhere((p) => p?.userId === id);
      }

      const refreshed = await storage.getAllUsers();
      log(`Admin updated user '${target.username}'`, "auth");
      res.json({ ok: true, user: updated ? sanitizeUser(updated) : null, users: refreshed.map(sanitizeUser) });
    } catch (error: any) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.delete("/api/auth/users/:id", requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      if (req.principal?.userId === id) {
        return res.status(400).json({ ok: false, error: "You cannot delete your own active account" });
      }
      const target = await storage.getUser(id);
      if (!target) return res.status(404).json({ ok: false, error: "User not found" });

      const allUsers = await storage.getAllUsers();
      const adminCount = allUsers.filter((u) => normalizeUserRole(u.role) === "admin").length;
      if (normalizeUserRole(target.role) === "admin" && adminCount <= 1) {
        return res.status(400).json({ ok: false, error: "Cannot delete the last remaining Technical Admin account" });
      }

      await storage.deleteUser(id);
      disconnectSocketsWhere((p) => p?.userId === id);

      const refreshed = await storage.getAllUsers();
      log(`Admin deleted user '${target.username}'`, "auth");
      res.json({ ok: true, users: refreshed.map(sanitizeUser) });
    } catch (error: any) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  // --- Kiosk Device Token Exchange & 6-Digit On-Screen TV Pairing ---
  app.post("/api/display/kiosk-exchange", async (req, res) => {
    try {
      const { displayId, token } = req.body || {};
      const matched = await verifyRawDisplayToken(token, displayId);
      if (!matched) {
        return res.status(401).json({ ok: false, error: "Invalid or expired TV display token" });
      }
      await setKioskAuthCookie(req, res, matched.displayId, matched.deviceToken);
      res.json({ ok: true, displayId: matched.displayId });
    } catch (error: any) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/display/pair/request", (req, res) => {
    const forwarded = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim();
    const ipAddress = forwarded || req.ip || req.socket.remoteAddress || "unknown";
    const { requestedDisplayId, viewport } = req.body || {};

    const result = createTvPairingRequest({
      requestedDisplayId,
      viewport,
      ipAddress,
      userAgent: req.headers["user-agent"],
    });

    if (!result.ok || !result.session) {
      return res.status(429).json({ ok: false, error: result.error || "Unable to create pairing code" });
    }

    broadcastDisplayEvent("display_pairing_update", {
      pendingPairings: listPendingTvPairings(),
    });
    log(`📺 TV Pairing Code ${result.session.code} requested from ${ipAddress}`, "auth");

    res.json({
      ok: true,
      pairId: result.session.pairId,
      code: result.session.code,
      expiresAt: result.session.expiresAt,
    });
  });

  app.post("/api/display/pair/poll", async (req, res) => {
    try {
      const { pairId } = req.body || {};
      if (!pairId || typeof pairId !== "string") {
        return res.status(400).json({ ok: false, error: "pairId is required" });
      }
      const sess = getTvPairingByPairId(pairId);
      if (!sess) {
        return res.json({ ok: true, status: "expired" });
      }

      if (sess.status === "approved" && sess.assignedDisplayId) {
        const consumed = consumeApprovedPairing(pairId);
        if (!consumed || !consumed.assignedDisplayId) {
          return res.json({ ok: true, status: "expired" });
        }
        const state = await getDisplayState();
        const unit = state.settings.displayProfiles[consumed.assignedDisplayId];
        if (!unit) {
          return res.status(404).json({ ok: false, error: "Assigned display unit no longer exists" });
        }

        await setKioskAuthCookie(req, res, unit.id, unit.deviceToken);
        broadcastDisplayEvent("display_pairing_update", {
          pendingPairings: listPendingTvPairings(),
        });
        log(`✅ TV Pairing completed and cookie issued for '${unit.name}' (${unit.id})`, "auth");

        return res.json({
          ok: true,
          status: "approved",
          displayId: unit.id,
          displayName: unit.name,
        });
      }

      res.json({
        ok: true,
        status: sess.status,
        code: sess.code,
        expiresAt: sess.expiresAt,
      });
    } catch (error: any) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/display/pair/pending", requireAdmin, (_req, res) => {
    res.json({ ok: true, pendingPairings: listPendingTvPairings() });
  });

  app.post("/api/display/pair/approve", requireAdmin, async (req, res) => {
    try {
      const { code, displayId, newDisplayName, groupId } = req.body || {};
      if (!code) {
        return res.status(400).json({ ok: false, error: "Pairing code is required" });
      }

      const cleanCode = String(code).replace(/[^0-9]/g, "");
      const pendingMatch = listPendingTvPairings().find((p) => p.code === cleanCode);
      if (!pendingMatch) {
        return res.status(404).json({ ok: false, error: "Pairing code expired or not found" });
      }

      const state = await getDisplayState();
      let resolvedDisplayId = displayId ? String(displayId).trim() : "__new__";
      let createdUnit: any = null;

      if (!resolvedDisplayId || resolvedDisplayId === "__new__") {
        const existingProfiles = Object.values(state.settings.displayProfiles || {});
        const existingNamesLower = new Set(
          existingProfiles.map((u: any) => String(u.name || "").trim().toLowerCase()),
        );
        const baseLabel =
          (newDisplayName && String(newDisplayName).trim()) ||
          pendingMatch.suggestedName ||
          "TV Display";
        let finalName = baseLabel;
        if (existingNamesLower.has(finalName.toLowerCase())) {
          let n = 2;
          while (existingNamesLower.has(`${baseLabel} ${n}`.toLowerCase())) {
            n += 1;
          }
          finalName = `${baseLabel} ${n}`;
        }

        const existingIds = new Set(Object.keys(state.settings.displayProfiles || {}));
        const newId = slugifyDisplayId(finalName, existingIds);
        const fallbackGroup = state.settings.displayGroups[0]?.id || "grp-sf-office";
        const validGroup =
          groupId && state.settings.displayGroups.some((g) => g.id === String(groupId))
            ? String(groupId)
            : fallbackGroup;

        const vpWidth = parseInt(String(pendingMatch.viewport || "").split(/[x×]/i)[0] || "0", 10);
        const autoScale = vpWidth > 0 && vpWidth <= 900 ? 0.95 : 1.05;

        createdUnit = {
          id: newId,
          name: finalName,
          groupId: validGroup,
          locationNote:
            pendingMatch.viewport && pendingMatch.viewport !== "unknown"
              ? `Paired device (${pendingMatch.viewport})`
              : "Paired display",
          uiScale: autoScale,
          leftColumnWidthPct: 44,
          sfRowsPerPage: 7,
          highContrast: false,
          activePanel: "auto",
          deviceToken: generateDisplayToken(),
        };

        state.settings.displayProfiles[newId] = createdUnit;
        await saveDisplayState(state);
        resolvedDisplayId = newId;
        log(`Created dedicated TV display instance '${finalName}' (${newId}) during pairing`, "display");
      } else if (!state.settings.displayProfiles[resolvedDisplayId]) {
        return res.status(404).json({ ok: false, error: "Selected display unit does not exist" });
      }

      const approved = approveTvPairingByCode(cleanCode, resolvedDisplayId);
      if (!approved) {
        return res.status(404).json({ ok: false, error: "Pairing code expired or not found" });
      }

      const pendingPairings = listPendingTvPairings();
      const clientState = await buildClientDisplayState();
      broadcastDisplayEvent("display_state_update", clientState);
      broadcastDisplayEvent("display_pairing_update", { pendingPairings });

      const assignedUnit = state.settings.displayProfiles[resolvedDisplayId];
      log(
        `Admin approved TV pairing code ${approved.code} -> ${assignedUnit?.name || resolvedDisplayId} (${resolvedDisplayId})`,
        "auth",
      );
      res.json({
        ok: true,
        assignedDisplayId: resolvedDisplayId,
        assignedDisplayName: assignedUnit?.name || resolvedDisplayId,
        createdUnit,
        pendingPairings,
        state: sanitizeDisplayStateForScope(clientState, true),
      });
    } catch (error: any) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/display/pair/reject", requireAdmin, (req, res) => {
    const { code } = req.body || {};
    rejectTvPairingByCode(String(code || ""));
    const pendingPairings = listPendingTvPairings();
    broadcastDisplayEvent("display_pairing_update", { pendingPairings });
    res.json({ ok: true, pendingPairings });
  });

  // --- Token Rotation & Phased Embed Controls ---
  app.post("/api/display/units/:id/rotate-token", requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const state = await getDisplayState();
      const unit = state.settings.displayProfiles[id];
      if (!unit) return res.status(404).json({ ok: false, error: "Display unit not found" });

      unit.deviceToken = generateDisplayToken();
      await saveDisplayState(state);

      disconnectSocketsWhere((p) => p?.scope === "kiosk" && p.displayId === id);

      const clientState = await buildClientDisplayState();
      broadcastDisplayEvent("display_state_update", clientState);
      log(`Rotated device token for TV display '${unit.name}' (${id})`, "auth");
      res.json({ ok: true, deviceToken: unit.deviceToken, state: clientState });
    } catch (error: any) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/display/security/rotate-webhook-key", requireAdmin, async (_req, res) => {
    try {
      const state = await getDisplayState();
      state.settings.webhookApiKey = generateWebhookApiKey();
      await saveDisplayState(state);

      const clientState = await buildClientDisplayState();
      broadcastDisplayEvent("display_state_update", clientState);
      log("Rotated CRM Webhook API Key", "auth");
      res.json({ ok: true, webhookApiKey: state.settings.webhookApiKey, state: clientState });
    } catch (error: any) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/display/security/embed", requireAdmin, async (req, res) => {
    try {
      const state = await getDisplayState();
      const { embedEnabled, rotateToken } = req.body || {};
      if (typeof embedEnabled === "boolean") {
        state.settings.embedEnabled = embedEnabled;
      }
      if (rotateToken === true) {
        state.settings.embedToken = generateEmbedToken();
      }
      await saveDisplayState(state);

      if (embedEnabled === false || rotateToken === true) {
        disconnectSocketsWhere((p) => p?.scope === "embed");
      }

      const clientState = await buildClientDisplayState();
      broadcastDisplayEvent("display_state_update", clientState);
      log(
        `Updated phased embed settings (enabled=${state.settings.embedEnabled}${rotateToken ? ", rotated token" : ""})`,
        "auth",
      );
      res.json({
        ok: true,
        embedEnabled: state.settings.embedEnabled,
        embedToken: state.settings.embedToken,
        state: clientState,
      });
    } catch (error: any) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/display/reset-clean", requireAdmin, async (_req, res) => {
    try {
      await resetDisplayStateToCleanBaseline();
      disconnectSocketsWhere((p) => p?.scope === "kiosk" || p?.scope === "embed");
      await Promise.allSettled([refreshLiveWeather(), refreshLiveNews(), refreshLiveNwsAlerts()]);
      const clientState = await buildClientDisplayState();
      broadcastDisplayEvent("display_state_update", clientState);
      log("Reset Display & Portal state to Clean Production Baseline", "display");
      res.json({
        ok: true,
        state: sanitizeDisplayStateForScope(clientState, true),
      });
    } catch (error: any) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  // Live Motive GPS Geofence Evaluator + Automatic GPS Route-History Van Matcher
  let lastHotShotHistoryScanMs = 0;

  const computeHotShotVehicleSuggestions = async (params: {
    stops: Array<{
      city?: string;
      accountName?: string;
      lat: number;
      lon: number;
      geocodePrecision?: "street" | "town" | "manual";
    }>;
    originHub: HotShotOriginHub;
    deliveryDateISO: string;
    excludeRouteId?: string;
  }) => {
    const [state, vehiclesMeta, homeAssignments, dayHistory] = await Promise.all([
      getDisplayState(),
      storage.getAllVehicles(),
      storage.getMapHomeLocations(),
      storage.getAllVehicleLocations({
        startDate: new Date(Date.now() - 22 * 3600_000),
      }),
    ]);

    const sfAssign = homeAssignments.find((a) => a.mapKey === "regional-sf");
    const arlAssign = homeAssignments.find((a) => a.mapKey === "map");
    const warehouses = {
      sfWarehouse: {
        name: sfAssign?.location?.name || "Sioux Falls Warehouse",
        latitude: sfAssign?.location?.latitude ?? 43.5446,
        longitude: sfAssign?.location?.longitude ?? -96.7311,
      },
      mainWarehouse: {
        name: arlAssign?.location?.name || "Arlington Warehouse",
        latitude: arlAssign?.location?.latitude ?? 44.3792,
        longitude: arlAssign?.location?.longitude ?? -97.1406,
      },
    };

    const existingForDate = normalizeHotShotRoutes(state.hotShotRoutes).filter(
      (r) =>
        r.active !== false &&
        r.deliveryDateISO === params.deliveryDateISO &&
        r.id !== params.excludeRouteId &&
        r.vehicleId &&
        r.vehicleAssignedBy === "manual" &&
        !r.returnedAt,
    );
    const excludedVehicleIds = new Set(
      existingForDate.map((r) => r.vehicleId!).filter(Boolean),
    );

    const candidates = estimateHotShotVehicleCandidates({
      stops: (params.stops || []).map((s) => ({
        city: s.city || "",
        accountName: s.accountName || "",
        lat: Number(s.lat),
        lon: Number(s.lon),
        ...(s.geocodePrecision ? { geocodePrecision: s.geocodePrecision } : {}),
      })),
      originHub: params.originHub,
      deliveryDateISO: params.deliveryDateISO,
      warehouses,
      vehiclesMeta,
      gpsLocations: dayHistory,
      excludedVehicleIds,
    });

    const top = candidates[0] || null;
    const second = candidates[1] || null;
    const isConfidentAutoMatch = Boolean(
      top &&
        top.score >= 34 &&
        (top.matchedStopCount >= 1 ||
          (top.confidence >= 58 && (!second || top.score - second.score >= 10))),
    );

    return {
      topMatch: isConfidentAutoMatch ? top : null,
      candidates: candidates.slice(0, 4),
    };
  };

  const evaluateHotShotGpsCompletions = async (forceHistoryScan = false): Promise<boolean> => {
    try {
      const state = await getDisplayState();
      const todayHotShots = getActiveTodayHotShots(state.hotShotRoutes, new Date());
      if (todayHotShots.length === 0) return false;

      const [latestLocations, vehiclesMeta, homeAssignments] = await Promise.all([
        storage.getAllVehicleLatestLocations(),
        storage.getAllVehicles(),
        storage.getMapHomeLocations(),
      ]);

      const sfAssign = homeAssignments.find((a) => a.mapKey === "regional-sf");
      const arlAssign = homeAssignments.find((a) => a.mapKey === "map");
      const sfHub = {
        name: sfAssign?.location?.name || "Sioux Falls Warehouse",
        latitude: sfAssign?.location?.latitude ?? 43.5446,
        longitude: sfAssign?.location?.longitude ?? -96.7311,
      };
      const arlHub = {
        name: arlAssign?.location?.name || "Arlington Warehouse",
        latitude: arlAssign?.location?.latitude ?? 44.3792,
        longitude: arlAssign?.location?.longitude ?? -97.1406,
      };

      const metaById = new Map(vehiclesMeta.map((v) => [v.vehicleId, v]));
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      let mutated = false;

      // 1. Automatic GPS History Van Estimation + Retroactive Stop Backfill
      const needsAutoEstimation = todayHotShots.some(
        (hs) => !hs.vehicleId || hs.vehicleAssignedBy === "auto_gps",
      );
      const shouldRunHistoryScan =
        forceHistoryScan ||
        (needsAutoEstimation && nowMs - lastHotShotHistoryScanMs >= 25_000);

      if (shouldRunHistoryScan) {
        lastHotShotHistoryScanMs = nowMs;
        const dayHistory = await storage.getAllVehicleLocations({
          startDate: new Date(nowMs - 20 * 3600_000),
        });

        const claimedVehIds = new Set<string>(
          todayHotShots
            .filter((hs) => hs.vehicleId && hs.vehicleAssignedBy === "manual" && !hs.returnedAt)
            .map((hs) => hs.vehicleId!),
        );

        const autoRoutes = todayHotShots.filter(
          (hs) => !hs.vehicleId || hs.vehicleAssignedBy === "auto_gps",
        );

        const rankedByRoute = autoRoutes.map((hs) => {
          const routeOriginHub = normalizeHotShotOriginHub(hs.originHub, hs.rawPdfDriver);
          const cands = estimateHotShotVehicleCandidates({
            stops: hs.stops,
            originHub: routeOriginHub,
            deliveryDateISO: hs.deliveryDateISO,
            warehouses: { sfWarehouse: sfHub, mainWarehouse: arlHub },
            vehiclesMeta,
            gpsLocations: dayHistory,
            excludedVehicleIds: claimedVehIds,
          });
          return { hs, cands };
        });

        // Assign strongest route matches first so two simultaneous Hot Shots never grab the same van
        rankedByRoute.sort(
          (a, b) => (b.cands[0]?.score || 0) - (a.cands[0]?.score || 0),
        );

        const newlyMatchedIds = new Set<string>();

        for (const { hs, cands } of rankedByRoute) {
          const available = cands.filter((c) => !claimedVehIds.has(c.vehicleId));
          const best = available[0];
          const runnerUp = available[1];
          if (!best) continue;

          const clearLead =
            !runnerUp ||
            best.score - runnerUp.score >= 10 ||
            best.matchedStopCount > runnerUp.matchedStopCount;
          const strongEnough =
            best.score >= 34 &&
            (best.matchedStopCount >= 1 || (best.confidence >= 58 && clearLead));
          if (!strongEnough) continue;

          if (!hs.vehicleId) {
            hs.vehicleId = best.vehicleId;
            hs.vehicleName = best.vehicleName;
            hs.vehicleAssignedBy = "auto_gps";
            hs.autoMatchConfidence = best.confidence;
            hs.autoMatchReason = best.reason;
            hs.updatedAt = nowIso;
            claimedVehIds.add(best.vehicleId);
            newlyMatchedIds.add(hs.id);
            mutated = true;
            log(
              `🛰️ Hot Shot Auto-GPS matched van '${best.vehicleName}' (${best.confidence}%) -> ${hs.driverName} (${best.reason})`,
              "hotshot",
            );
          } else if (hs.vehicleAssignedBy === "auto_gps") {
            if (hs.vehicleId === best.vehicleId) {
              claimedVehIds.add(best.vehicleId);
              hs.autoMatchConfidence = best.confidence;
              hs.autoMatchReason = best.reason;
            } else {
              const currentScore =
                available.find((c) => c.vehicleId === hs.vehicleId)?.score || 0;
              // Only self-correct to a different van if the new van beats the prior auto-guess by >= 18 pts
              if (best.score - currentScore >= 18) {
                for (const st of hs.stops) {
                  if (st.completedBy === "gps") {
                    st.completedAt = null;
                    st.completedBy = null;
                  }
                }
                hs.departedAt = null;
                hs.returnedAt = null;
                hs.vehicleId = best.vehicleId;
                hs.vehicleName = best.vehicleName;
                hs.autoMatchConfidence = best.confidence;
                hs.autoMatchReason = best.reason;
                hs.updatedAt = nowIso;
                claimedVehIds.add(best.vehicleId);
                newlyMatchedIds.add(hs.id);
                mutated = true;
                log(
                  `🛰️ Hot Shot Auto-GPS refined van to '${best.vehicleName}' (${best.confidence}%) -> ${hs.driverName}`,
                  "hotshot",
                );
              } else {
                claimedVehIds.add(hs.vehicleId);
              }
            }
          }
        }

        // Backfill stop completions & departure time from today's chronological GPS trail
        for (const hs of todayHotShots) {
          if (!hs.vehicleId) continue;
          if (!forceHistoryScan && !newlyMatchedIds.has(hs.id)) continue;
          const vehTrail = dayHistory.filter((loc) => loc.vehicleId === hs.vehicleId);
          if (vehTrail.length === 0) continue;
          const routeOriginHub = normalizeHotShotOriginHub(hs.originHub, hs.rawPdfDriver);
          const activeHub = routeOriginHub === "arlington" ? arlHub : sfHub;
          if (replayVehicleHistoryOnHotShotRoute(hs, activeHub, vehTrail)) {
            mutated = true;
          }
        }
      }

      // 2. Real-time latest GPS fix geofence check for all assigned today Hot Shots
      const assignedToday = todayHotShots.filter((hs) => hs.vehicleId || hs.vehicleName);
      for (const hs of assignedToday) {
        const matchedLoc = latestLocations.find((loc) => {
          if (hs.vehicleId && loc.vehicleId === hs.vehicleId) return true;
          const vName = metaById.get(loc.vehicleId)?.name || "";
          return Boolean(hs.vehicleName && vName && vName === hs.vehicleName);
        });
        if (!matchedLoc) continue;

        const locAgeMin = (nowMs - new Date(matchedLoc.timestamp).getTime()) / 60_000;
        // Only auto-complete from fresh GPS reports (within last 45 minutes)
        if (!Number.isFinite(locAgeMin) || locAgeMin > 45) continue;

        const routeOriginHub = normalizeHotShotOriginHub(hs.originHub, hs.rawPdfDriver);
        const activeHub = routeOriginHub === "arlington" ? arlHub : sfHub;
        const distFromHubMiles = haversineMiles(
          activeHub.latitude,
          activeHub.longitude,
          matchedLoc.latitude,
          matchedLoc.longitude,
        );

        if (distFromHubMiles > 1.2 && !hs.departedAt) {
          hs.departedAt = nowIso;
          hs.updatedAt = nowIso;
          mutated = true;
        }

        for (const stop of hs.stops) {
          if (stop.completedAt) continue;
          const distToStop = haversineMiles(
            matchedLoc.latitude,
            matchedLoc.longitude,
            stop.lat,
            stop.lon,
          );
          if (distToStop <= getHotShotStopGeofenceMiles(stop)) {
            stop.completedAt = nowIso;
            stop.completedBy = "gps";
            hs.updatedAt = nowIso;
            mutated = true;
            log(
              `⚡ Hot Shot GPS auto-completed stop '${stop.accountName}' (${stop.city}, ${stop.state}) for ${hs.driverName}`,
              "hotshot",
            );
          }
        }

        const allDone = hs.stops.length > 0 && hs.stops.every((s) => Boolean(s.completedAt));
        if (allDone && hs.departedAt && distFromHubMiles <= 0.75 && !hs.returnedAt) {
          hs.returnedAt = nowIso;
          hs.updatedAt = nowIso;
          mutated = true;
          log(`⚡ Hot Shot route '${hs.title || hs.id}' (${hs.driverName}) returned to hub`, "hotshot");
        }
      }

      if (mutated) {
        await saveDisplayState(state);
      }
      return mutated;
    } catch {
      return false;
    }
  };

  // Wire HotShotSheet API poller -> Motive GPS van auto-matching + Live TV WebSocket broadcast
  setHotShotSyncHook(async ({ routesMutated, openOrdersChanged, newAlerts }) => {
    try {
      if (routesMutated) {
        await evaluateHotShotGpsCompletions(true);
      }
      if (routesMutated || openOrdersChanged) {
        const clientState = await buildClientDisplayState();
        broadcastDisplayEvent("display_state_update", clientState);
      }
      if (newAlerts.length > 0) {
        broadcastDisplayEvent("hotshot_delivery_alert", {
          alerts: newAlerts,
        });
        log(
          `🔔 Broadcast ${newAlerts.length} new HotShotSheet delivery alert(s) to TV displays`,
          "hotshot-api",
        );
      }
    } catch (err: any) {
      log(`HotShot sync hook error: ${err?.message}`, "hotshot-api");
    }
  });
  startHotShotSheetPolling();

  app.post("/api/demo/sync-live-vehicles", requireEditor, async (req, res) => {
    if (!isLocalDemoSyncEnabled()) {
      return res.status(403).json({
        ok: false,
        error: "Manual live snapshot sync is only enabled in local demo mode.",
      });
    }
    try {
      const result = await runLocalDemoVehicleSync();
      if (!result.synced || result.vehicleCount === 0) {
        return res.status(502).json({
          ok: false,
          error: "Could not reach live server vehicle feed.",
        });
      }
      // Also evaluate Hot Shot GPS geofences & auto-van matching right away against the fresh positions
      const hsMutated = await evaluateHotShotGpsCompletions(true);
      let updatedState: any = undefined;
      if (hsMutated) {
        const clientState = await buildClientDisplayState();
        broadcastDisplayEvent("display_state_update", clientState);
        updatedState = sanitizeDisplayStateForScope(
          clientState,
          req.principal?.scope === "admin",
        );
      }
      log(
        `🔄 Local Demo GPS Sync pulled ${result.vehicleCount} live vehicles from production feed`,
        "poller",
      );
      res.json({
        ok: true,
        vehicleCount: result.vehicleCount,
        vehicles: result.vehicles,
        ...(updatedState ? { state: updatedState } : {}),
      });
    } catch (error: any) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  // Manual poll trigger endpoint
  app.post("/api/poll/trigger", requireAdmin, async (_req, res) => {
    try {
      if (isLocalDemoSyncEnabled()) {
        const demoRes = await runLocalDemoVehicleSync();
        await evaluateHotShotGpsCompletions(true);
        return res.json({
          success: true,
          vehicleCount: demoRes.vehicleCount,
          message: `Synced ${demoRes.vehicleCount} live vehicles from production feed`,
        });
      }
      await pollNow();
      res.json({ success: true, message: "Poll triggered successfully" });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // 10-second Watchdog & Automated TV Power Scheduler Loop
  setInterval(async () => {
    try {
      const { triggeredActions, stateMutated } = await evaluateScheduledPowerActions();
      const hotShotMutated = await evaluateHotShotGpsCompletions();
      for (const act of triggeredActions) {
        log(
          `🕒 Scheduled TV Power [${act.action.toUpperCase()}] -> ${act.name} (${act.reason})`,
          "watchdog",
        );
        broadcastDisplayEvent("display_control", {
          targetScope: "display",
          targetId: act.displayId,
          targetedDisplayIds: [act.displayId],
          action: act.action,
        });
      }

      const newAlerts = await checkDisplayHealthTransitions();
      const displayUnits = await getEnrichedDisplayFleetSnapshot();
      broadcastDisplayEvent("display_fleet_telemetry", {
        displayUnits,
        serverTime: new Date().toISOString(),
      });
      if (newAlerts.length > 0) {
        for (const alert of newAlerts) {
          log(`⚠️ Display Watchdog [${alert.severity.toUpperCase()}]: ${alert.message}`, "watchdog");
          broadcastDisplayEvent("display_health_alert", alert);
        }
      }
      if (newAlerts.length > 0 || triggeredActions.length > 0 || stateMutated || hotShotMutated) {
        broadcastDisplayEvent("display_state_update", await buildClientDisplayState());
      }
    } catch {}
  }, 10 * 1000);

  // Warm up weather, NWS alerts & RSS feeds in background on startup + periodic refresh
  setTimeout(() => {
    Promise.allSettled([refreshLiveWeather(), refreshLiveNews(), refreshLiveNwsAlerts(), syncIcsCalendarFeed()])
      .then(async (results) => {
        const changed = results.some((r) => r.status === "fulfilled" && r.value);
        if (changed) {
          broadcastDisplayEvent("display_state_update", await buildClientDisplayState());
        }
      })
      .catch(() => {});
  }, 1500);

  setInterval(() => {
    Promise.allSettled([refreshLiveWeather(), refreshLiveNews(), refreshLiveNwsAlerts(), syncIcsCalendarFeed()])
      .then(async (results) => {
        const changed = results.some((r) => r.status === "fulfilled" && r.value);
        if (changed) {
          broadcastDisplayEvent("display_state_update", await buildClientDisplayState());
        }
      })
      .catch(() => {});
  }, 10 * 60 * 1000);

  app.get("/api/display/branding", async (_req, res) => {
    try {
      const state = await getDisplayState();
      const rawName = String(state?.settings?.companyName || "").trim();
      const companyName =
        !rawName || /fleet\s*&\s*operations/i.test(rawName)
          ? "Interstate Batteries of South Dakota"
          : rawName;
      const companySubtitle = String(
        state?.settings?.companySubtitle || "Sioux Falls & Arlington Dispatch",
      ).trim();
      const companyLogoUrl = String(state?.settings?.companyLogoUrl || "").trim();
      res.json({
        ok: true,
        companyName,
        companySubtitle,
        companyLogoUrl,
      });
    } catch (error: any) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/display/state", requireDisplayRead, async (req, res) => {
    try {
      const fullState = await buildClientDisplayState();
      const isAdmin = req.principal?.scope === "admin";
      res.json(sanitizeDisplayStateForScope(fullState, isAdmin));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // -------------------------------------------------------------------------
  // DISPLAY UNITS CRUD (Add, Rename, Move Group, Configure, Delete)
  // -------------------------------------------------------------------------
  app.post("/api/display/units", requireAdmin, async (req, res) => {
    try {
      const state = await getDisplayState();
      const {
        name,
        customId,
        groupId,
        locationNote,
        uiScale,
        leftColumnWidthPct,
        sfRowsPerPage,
        highContrast,
        rotationIntervalSec,
      } = req.body || {};

      if (!name || !String(name).trim()) {
        return res.status(400).json({ ok: false, error: "Display name is required" });
      }

      const existingIds = new Set(Object.keys(state.settings.displayProfiles));
      const id = customId
        ? slugifyDisplayId(String(customId), existingIds)
        : slugifyDisplayId(String(name), existingIds);

      const fallbackGroup = state.settings.displayGroups[0]?.id || "grp-sf-office";
      const unit = {
        id,
        name: String(name).trim(),
        groupId: groupId || fallbackGroup,
        locationNote: locationNote ? String(locationNote).trim() : "",
        uiScale: Number(uiScale ?? 1.05),
        leftColumnWidthPct: Number(leftColumnWidthPct ?? 44),
        sfRowsPerPage: Number(sfRowsPerPage ?? 7),
        highContrast: Boolean(highContrast),
        activePanel: "auto",
        rotationIntervalSec: rotationIntervalSec ? Number(rotationIntervalSec) : undefined,
        deviceToken: generateDisplayToken(),
      };

      state.settings.displayProfiles[id] = unit;
      await saveDisplayState(state);

      const clientState = await buildClientDisplayState();
      broadcastDisplayEvent("display_state_update", clientState);
      log(`Added new TV display unit: ${unit.name} (${unit.id})`, "display");
      res.json({ ok: true, unit, state: clientState });
    } catch (error: any) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.put("/api/display/units/:id", requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const state = await getDisplayState();
      const existing = state.settings.displayProfiles[id];
      if (!existing) {
        return res.status(404).json({ ok: false, error: "Display unit not found" });
      }

      const updated = {
        ...existing,
        ...(req.body.name !== undefined ? { name: String(req.body.name).trim() || existing.name } : {}),
        ...(req.body.groupId !== undefined ? { groupId: String(req.body.groupId) } : {}),
        ...(req.body.locationNote !== undefined ? { locationNote: String(req.body.locationNote) } : {}),
        ...(req.body.uiScale !== undefined ? { uiScale: Number(req.body.uiScale) } : {}),
        ...(req.body.leftColumnWidthPct !== undefined
          ? { leftColumnWidthPct: Number(req.body.leftColumnWidthPct) }
          : {}),
        ...(req.body.sfRowsPerPage !== undefined ? { sfRowsPerPage: Number(req.body.sfRowsPerPage) } : {}),
        ...(req.body.highContrast !== undefined ? { highContrast: Boolean(req.body.highContrast) } : {}),
        ...(req.body.theme !== undefined ? { theme: String(req.body.theme) } : {}),
        ...(req.body.activePanel !== undefined ? { activePanel: String(req.body.activePanel) } : {}),
        ...(req.body.playlistMode !== undefined
          ? {
              playlistMode:
                req.body.playlistMode === "custom" ? ("custom" as const) : ("group" as const),
            }
          : {}),
        ...(Array.isArray(req.body.playlist) ? { playlist: req.body.playlist } : {}),
        ...(req.body.rotationIntervalSec !== undefined
          ? { rotationIntervalSec: req.body.rotationIntervalSec ? Number(req.body.rotationIntervalSec) : undefined }
          : {}),
        ...(req.body.powerScheduleMode !== undefined
          ? {
              powerScheduleMode:
                req.body.powerScheduleMode === "custom" || req.body.powerScheduleMode === "always_on"
                  ? (req.body.powerScheduleMode as "custom" | "always_on")
                  : ("company" as const),
            }
          : {}),
        ...(req.body.powerSchedule !== undefined
          ? {
              powerSchedule: normalizeTvPowerSchedule(
                req.body.powerSchedule,
                existing.powerSchedule || state.settings.powerSchedule || DEFAULT_TV_POWER_SCHEDULE,
              ),
            }
          : {}),
        ...(req.body.powerOverride !== undefined
          ? { powerOverride: normalizeUnitPowerOverride(req.body.powerOverride) }
          : {}),
        ...(req.body.mapRegionMode !== undefined
          ? { mapRegionMode: String(req.body.mapRegionMode) }
          : {}),
        ...(req.body.customMapBounds !== undefined
          ? {
              customMapBounds: isValidMapBoundingBox(req.body.customMapBounds)
                ? normalizeMapBoundingBox(req.body.customMapBounds)
                : null,
            }
          : {}),
        ...(req.body.mapEtaHub !== undefined
          ? {
              mapEtaHub:
                req.body.mapEtaHub === "main" ||
                req.body.mapEtaHub === "sf" ||
                req.body.mapEtaHub === "none"
                  ? req.body.mapEtaHub
                  : ("auto" as const),
            }
          : {}),
        deviceToken: existing.deviceToken || generateDisplayToken(),
      };

      state.settings.displayProfiles[id] = updated;
      await saveDisplayState(state);
      await evaluateScheduledPowerActions();

      const clientState = await buildClientDisplayState();
      broadcastDisplayEvent("display_state_update", clientState);
      res.json({ ok: true, unit: updated, state: clientState });
    } catch (error: any) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.delete("/api/display/units/:id", requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const state = await getDisplayState();
      if (!state.settings.displayProfiles[id]) {
        return res.status(404).json({ ok: false, error: "Display not found" });
      }

      delete state.settings.displayProfiles[id];
      deleteDisplayTelemetry(id);
      await saveDisplayState(state);

      disconnectSocketsWhere((p) => p?.scope === "kiosk" && p.displayId === id);

      const clientState = await buildClientDisplayState();
      broadcastDisplayEvent("display_state_update", clientState);
      log(`Deleted TV display unit: ${id}`, "display");
      res.json({ ok: true, state: clientState });
    } catch (error: any) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  // -------------------------------------------------------------------------
  // DISPLAY GROUPS CRUD (Create, Rename/Color, Delete)
  // -------------------------------------------------------------------------
  app.post("/api/display/groups", requireAdmin, async (req, res) => {
    try {
      const state = await getDisplayState();
      const { name, color, description } = req.body || {};
      if (!name || !String(name).trim()) {
        return res.status(400).json({ ok: false, error: "Group name is required" });
      }
      const existingIds = new Set(state.settings.displayGroups.map((g) => g.id));
      const id = `grp-${slugifyDisplayId(String(name), existingIds)}`;
      const group = {
        id,
        name: String(name).trim(),
        color: color || "#38bdf8",
        description: description ? String(description).trim() : "",
      };
      state.settings.displayGroups.push(group);
      await saveDisplayState(state);

      const clientState = await buildClientDisplayState();
      broadcastDisplayEvent("display_state_update", clientState);
      res.json({ ok: true, group, state: clientState });
    } catch (error: any) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.put("/api/display/groups/:id", requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const state = await getDisplayState();
      const idx = state.settings.displayGroups.findIndex((g) => g.id === id);
      if (idx < 0) return res.status(404).json({ ok: false, error: "Group not found" });

      state.settings.displayGroups[idx] = {
        ...state.settings.displayGroups[idx],
        ...(req.body.name ? { name: String(req.body.name).trim() } : {}),
        ...(req.body.color ? { color: String(req.body.color) } : {}),
        ...(req.body.description !== undefined ? { description: String(req.body.description) } : {}),
        ...(Array.isArray(req.body.playlist) ? { playlist: req.body.playlist } : {}),
      };
      await saveDisplayState(state);

      const clientState = await buildClientDisplayState();
      broadcastDisplayEvent("display_state_update", clientState);
      res.json({ ok: true, group: state.settings.displayGroups[idx], state: clientState });
    } catch (error: any) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.delete("/api/display/groups/:id", requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const state = await getDisplayState();
      if (state.settings.displayGroups.length <= 1) {
        return res.status(400).json({ ok: false, error: "At least one display group must remain" });
      }
      state.settings.displayGroups = state.settings.displayGroups.filter((g) => g.id !== id);
      const fallbackGroupId = state.settings.displayGroups[0].id;
      for (const prof of Object.values(state.settings.displayProfiles)) {
        if (prof.groupId === id) {
          prof.groupId = fallbackGroupId;
        }
      }
      await saveDisplayState(state);

      const clientState = await buildClientDisplayState();
      broadcastDisplayEvent("display_state_update", clientState);
      res.json({ ok: true, state: clientState });
    } catch (error: any) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  // -------------------------------------------------------------------------
  // PINGBACK TELEMETRY (Browser Heartbeat + Raspberry Pi HDMI-CEC Agent)
  // -------------------------------------------------------------------------
  app.post(
    "/api/display/ping",
    requireKioskForDisplayOrAdmin((req) =>
      req.body?.displayId ? String(req.body.displayId) : undefined,
    ),
    async (req, res) => {
      try {
        const {
          displayId,
          fps,
          maxFrameGapMs,
          visibilityState,
          viewport,
          currentScreenIdx,
          uptimeSec,
        } = req.body || {};

        if (!displayId) {
          return res.status(400).json({ ok: false, error: "displayId is required" });
        }

        const telemetry = getDisplayTelemetry(String(displayId));
        telemetry.lastBrowserPingAt = new Date().toISOString();
        if (fps === null) {
          telemetry.browserFps = null;
        } else if (typeof fps === "number") {
          telemetry.browserFps = Math.round(fps);
        }
        const gapMs =
          typeof maxFrameGapMs === "number" ? Math.max(0, Math.round(maxFrameGapMs)) : 0;
        telemetry.maxFrameGapMs = gapMs;
        if (gapMs > 12000 && (visibilityState || "visible") === "visible") {
          telemetry.consecutiveStallPings = (telemetry.consecutiveStallPings || 0) + 1;
        } else {
          telemetry.consecutiveStallPings = 0;
        }
        telemetry.visibilityState = visibilityState || "visible";
        telemetry.viewport = viewport || telemetry.viewport;
        telemetry.currentScreenIdx =
          typeof currentScreenIdx === "number" ? currentScreenIdx : telemetry.currentScreenIdx;
        telemetry.browserUptimeSec =
          typeof uptimeSec === "number" ? Math.round(uptimeSec) : telemetry.browserUptimeSec;

        if (!telemetry.ipAddress) {
          const forwarded = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim();
          telemetry.ipAddress = forwarded || req.socket.remoteAddress || null;
        }

        const newAlerts = await checkDisplayHealthTransitions();
        const displayUnits = await getEnrichedDisplayFleetSnapshot();
        broadcastDisplayEvent("display_fleet_telemetry", {
          displayUnits,
          serverTime: new Date().toISOString(),
        });
        if (newAlerts.length > 0) {
          for (const alert of newAlerts) {
            broadcastDisplayEvent("display_health_alert", alert);
          }
        }

        res.json({ ok: true, serverTime: new Date().toISOString() });
      } catch (error: any) {
        res.status(400).json({ ok: false, error: error.message });
      }
    },
  );

  app.post(
    "/api/display/pi-telemetry",
    requireKioskForDisplayOrAdmin((req) =>
      req.body?.displayId ? String(req.body.displayId) : undefined,
    ),
    async (req, res) => {
      try {
        const {
          displayId,
          tvPowerState,
          cpuTempC,
          loadAvg,
          memUsedPct,
          piUptimeSec,
          ipAddress,
          chromiumRunning,
        } = req.body || {};

        if (!displayId) {
          return res.status(400).json({ ok: false, error: "displayId is required" });
        }

        const telemetry = getDisplayTelemetry(String(displayId));
        telemetry.piAgentInstalled = true;
        telemetry.lastPiPingAt = new Date().toISOString();
        if (tvPowerState) telemetry.tvPowerState = tvPowerState;
        if (typeof cpuTempC === "number") telemetry.cpuTempC = cpuTempC;
        if (typeof loadAvg === "number") telemetry.loadAvg = loadAvg;
        if (typeof memUsedPct === "number") telemetry.memUsedPct = memUsedPct;
        if (typeof piUptimeSec === "number") telemetry.piUptimeSec = piUptimeSec;
        if (ipAddress) telemetry.ipAddress = String(ipAddress);
        if (typeof chromiumRunning === "boolean") telemetry.chromiumRunning = chromiumRunning;

        const queuedCommand = telemetry.pendingCommand;
        telemetry.pendingCommand = null;

        const newAlerts = await checkDisplayHealthTransitions();
        const displayUnits = await getEnrichedDisplayFleetSnapshot();
        broadcastDisplayEvent("display_fleet_telemetry", {
          displayUnits,
          serverTime: new Date().toISOString(),
        });
        if (newAlerts.length > 0) {
          for (const alert of newAlerts) {
            broadcastDisplayEvent("display_health_alert", alert);
          }
        }

        res.json({ ok: true, command: queuedCommand || null });
      } catch (error: any) {
        res.status(400).json({ ok: false, error: error.message });
      }
    },
  );

  // Downloadable 1-line Raspberry Pi HDMI-CEC & Watchdog setup script (Requires Admin session OR matching Display Token)
  app.get("/api/display/pi-agent.sh", async (req, res) => {
    const displayId = String(req.query.display || "breakroom").replace(/[^a-zA-Z0-9_-]/g, "");
    const principal = await resolveRequestPrincipal(req);
    const allowed =
      principal?.scope === "admin" ||
      (principal?.scope === "kiosk" && principal.displayId === displayId);

    if (!allowed) {
      return res.status(401).send("Unauthorized: Valid Admin session or Display token required.\n");
    }

    const state = await getDisplayState();
    const unit = state.settings.displayProfiles[displayId];
    if (!unit) {
      return res.status(404).send("Display unit not found.\n");
    }

    const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol || "http";
    const host = req.headers.host || "localhost:5000";
    const origin = `${proto}://${host}`;
    const script = generateRaspberryPiAgentScript(origin, displayId, unit.deviceToken);
    res.setHeader("Content-Type", "text/x-shellscript; charset=utf-8");
    res.send(script);
  });

  app.delete("/api/display/alerts", requireAdmin, async (_req, res) => {
    try {
      const state = await getDisplayState();
      state.displayAlerts = [];
      await saveDisplayState(state);
      const clientState = await buildClientDisplayState();
      broadcastDisplayEvent("display_state_update", clientState);
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  // -------------------------------------------------------------------------
  // CRM WEBHOOK & ADMIN ANNOUNCEMENTS
  // -------------------------------------------------------------------------
  const publishAnnouncement = async (req: any, res: any, defaultSource: string) => {
    try {
      const state = await getDisplayState();
      const { msg, replaceExisting } = normalizeIncomingMessage(req.body, defaultSource);
      if (!msg.message) {
        return res.status(400).json({
          ok: false,
          error: 'Missing message content. Provide "message", "text", or "body" in JSON.',
        });
      }

      if (replaceExisting) {
        state.messages = [msg];
      } else {
        state.messages = [msg, ...(state.messages || [])];
      }

      const redactedPayload = { ...(req.body || {}) };
      if ("apiKey" in redactedPayload) redactedPayload.apiKey = "[REDACTED]";

      state.webhookLogs = [
        {
          id: `log-${crypto.randomUUID().slice(0, 8)}`,
          receivedAt: new Date().toISOString(),
          source: msg.source === "CRM" ? "CRM Webhook" : "Admin Portal",
          status: "200 OK",
          payload: redactedPayload,
        },
        ...(state.webhookLogs || []).slice(0, 29),
      ];

      await saveDisplayState(state);
      broadcastDisplayEvent("display_state_update", await buildClientDisplayState());
      broadcastDisplayEvent("display_message_toast", msg);

      log(`📢 Announcement published (${msg.source}): ${msg.author} — ${msg.message}`, "display");
      res.json({
        ok: true,
        message: "Announcement published and pushed to all TV displays",
        item: msg,
      });
    } catch (error: any) {
      res.status(400).json({ ok: false, error: error.message });
    }
  };

  const handleCrmWebhookAnnouncement = async (req: any, res: any) => {
    const state = await getDisplayState();
    const configuredKey = (state.settings.webhookApiKey || "").trim();
    const bearerHeader = String(req.headers.authorization || "");
    const bearerToken = bearerHeader.toLowerCase().startsWith("bearer ")
      ? bearerHeader.slice(7).trim()
      : "";
    const providedKey = String(
      req.headers["x-api-key"] || bearerToken || (req.query?.key as string) || req.body?.apiKey || "",
    ).trim();

    // Allow either an authenticated Admin session (for simulator button in /admin) OR a valid CRM API Key
    const principal = await resolveRequestPrincipal(req);
    const isEditorSession = principal?.scope === "admin" || principal?.scope === "staff";

    if (!isEditorSession && (!configuredKey || !timingSafeEqualString(providedKey, configuredKey))) {
      return res.status(401).json({ ok: false, error: "Unauthorized: Valid X-API-Key required" });
    }

    return publishAnnouncement(req, res, "CRM");
  };

  app.post("/api/webhook/messages", handleCrmWebhookAnnouncement);
  app.post("/api/dakboard", handleCrmWebhookAnnouncement);
  app.post("/api/display/messages", requireEditor, (req, res) =>
    publishAnnouncement(req, res, req.principal?.scope === "staff" ? "Staff" : "Admin"),
  );

  app.put("/api/display/messages/:id", requireEditor, async (req, res) => {
    try {
      const { id } = req.params;
      const state = await getDisplayState();
      state.messages = (state.messages || []).map((m) =>
        m.id === id ? { ...m, ...req.body } : m,
      );
      await saveDisplayState(state);
      broadcastDisplayEvent("display_state_update", await buildClientDisplayState());
      res.json({ ok: true, messages: state.messages });
    } catch (error: any) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.delete("/api/display/messages/:id", requireEditor, async (req, res) => {
    try {
      const { id } = req.params;
      const state = await getDisplayState();
      state.messages = (state.messages || []).filter((m) => m.id !== id);
      await saveDisplayState(state);
      broadcastDisplayEvent("display_state_update", await buildClientDisplayState());
      res.json({ ok: true });
    } catch (error: any) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.put("/api/display/schedules", requireEditor, async (req, res) => {
    try {
      const state = await getDisplayState();
      if (req.body.truckSchedule) {
        state.truckSchedule = normalizeTruckScheduleState(req.body.truckSchedule, new Date());
      }
      if (req.body.sfSchedule) {
        state.sfSchedule = normalizeSfScheduleState(req.body.sfSchedule, new Date());
      }
      if (req.body.renewalReminders) state.renewalReminders = req.body.renewalReminders;
      if (req.body.calendarEvents) state.calendarEvents = req.body.calendarEvents;
      if (req.body.compliments) state.compliments = req.body.compliments;
      if (Array.isArray(req.body.routeTerritories)) {
        state.routeTerritories = normalizeRouteTerritories(
          req.body.routeTerritories,
          state.routeTerritories || DEFAULT_ROUTE_TERRITORIES,
        );
      }

      await saveDisplayState(state);
      const clientState = await buildClientDisplayState();
      broadcastDisplayEvent("display_state_update", clientState);
      log("Updated display schedules/calendar via Admin", "display");
      const isAdmin = req.principal?.scope === "admin";
      res.json({ ok: true, state: sanitizeDisplayStateForScope(clientState, isAdmin) });
    } catch (error: any) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.put("/api/display/route-territories", requireEditor, async (req, res) => {
    try {
      const state = await getDisplayState();
      if (req.body?.resetToDefault === true) {
        state.routeTerritories = structuredClone(DEFAULT_ROUTE_TERRITORIES);
      } else if (Array.isArray(req.body?.routeTerritories)) {
        state.routeTerritories = normalizeRouteTerritories(
          req.body.routeTerritories,
          DEFAULT_ROUTE_TERRITORIES,
        );
      } else {
        return res
          .status(400)
          .json({ ok: false, error: "routeTerritories array or resetToDefault flag is required" });
      }

      await saveDisplayState(state);
      const clientState = await buildClientDisplayState();
      broadcastDisplayEvent("display_state_update", clientState);
      log(
        `Updated colored route territories (${state.routeTerritories.length} routes)`,
        "display",
      );
      const isAdmin = req.principal?.scope === "admin";
      res.json({
        ok: true,
        routeTerritories: state.routeTerritories,
        state: sanitizeDisplayStateForScope(clientState, isAdmin),
      });
    } catch (error: any) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/display/geocode-town", requireEditor, async (req, res) => {
    try {
      const rawName = String(req.body?.name || "").trim();
      const rawState = String(req.body?.state || "SD")
        .trim()
        .toUpperCase();
      if (!rawName) {
        return res.status(400).json({ ok: false, error: "Town name is required" });
      }

      const stateFullNames: Record<string, string> = {
        SD: "South Dakota",
        MN: "Minnesota",
        IA: "Iowa",
        ND: "North Dakota",
        NE: "Nebraska",
        WI: "Wisconsin",
        WY: "Wyoming",
        MT: "Montana",
        IL: "Illinois",
        MO: "Missouri",
        KS: "Kansas",
      };
      const targetStateFull = stateFullNames[rawState] || rawState;

      const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
        rawName,
      )}&count=25&language=en&format=json`;
      const geoRes = await fetch(url, { signal: AbortSignal.timeout(6500) });
      if (geoRes.ok) {
        const data: any = await geoRes.json();
        const results: any[] = Array.isArray(data?.results) ? data.results : [];
        const usMatches = results.filter((r) => r.country_code === "US");
        const exactStateMatch = usMatches.find(
          (r) =>
            String(r.admin1 || "").toLowerCase() === targetStateFull.toLowerCase() ||
            String(r.admin1 || "").toUpperCase() === rawState,
        );
        const chosen = exactStateMatch || usMatches[0];
        if (chosen && Number.isFinite(chosen.latitude) && Number.isFinite(chosen.longitude)) {
          return res.json({
            ok: true,
            name: String(chosen.name || rawName),
            state: rawState,
            lat: Number(Number(chosen.latitude).toFixed(4)),
            lon: Number(Number(chosen.longitude).toFixed(4)),
            county: chosen.admin2 ? String(chosen.admin2) : undefined,
          });
        }
      }

      // Fallback to Nominatim if town is a small unincorporated village
      const nomUrl = `https://nominatim.openstreetmap.org/search?city=${encodeURIComponent(
        rawName,
      )}&state=${encodeURIComponent(targetStateFull)}&countrycodes=us&format=json&limit=3`;
      const nomRes = await fetch(nomUrl, {
        headers: { "User-Agent": "FleetOperationsDisplay/1.0" },
        signal: AbortSignal.timeout(6500),
      });
      if (nomRes.ok) {
        const nomList: any[] = await nomRes.json();
        if (Array.isArray(nomList) && nomList.length > 0) {
          const hit = nomList[0];
          const lat = Number(hit.lat);
          const lon = Number(hit.lon);
          if (Number.isFinite(lat) && Number.isFinite(lon)) {
            return res.json({
              ok: true,
              name: rawName,
              state: rawState,
              lat: Number(lat.toFixed(4)),
              lon: Number(lon.toFixed(4)),
            });
          }
        }
      }

      return res.status(404).json({
        ok: false,
        error: `Could not find "${rawName}, ${rawState}". Check spelling or enter Lat/Lon manually.`,
      });
    } catch (error: any) {
      res.status(500).json({ ok: false, error: error.message || "Town lookup failed" });
    }
  });

  app.put("/api/display/settings", requireEditor, async (req, res) => {
    try {
      const state = await getDisplayState();
      const isAdmin = req.principal?.scope === "admin";

      if (!isAdmin) {
        // Standard Staff can only adjust safe day-to-day content flags — never tokens, feeds, or hardware units
        if (typeof req.body.tickerEnabled === "boolean") {
          state.settings.tickerEnabled = req.body.tickerEnabled;
        }
        if (typeof req.body.complimentsEnabled === "boolean") {
          state.settings.complimentsEnabled = req.body.complimentsEnabled;
        }
        if (typeof req.body.companyName === "string" && req.body.companyName.trim()) {
          state.settings.companyName = req.body.companyName.trim();
        }
        if (typeof req.body.companySubtitle === "string") {
          state.settings.companySubtitle = req.body.companySubtitle.trim();
        }
        if (typeof req.body.companyLogoUrl === "string") {
          state.settings.companyLogoUrl = req.body.companyLogoUrl.trim();
        }
        if (Array.isArray(req.body.savedMapRegions)) {
          state.settings.savedMapRegions = normalizeSavedMapRegions(req.body.savedMapRegions);
        }
        if (req.body.weatherOverlayMode !== undefined) {
          state.settings.weatherOverlayMode = normalizeWeatherOverlayMode(
            req.body.weatherOverlayMode,
            state.settings.weatherOverlayMode || "warnings_only",
          );
        }
        if (req.body.weatherDemoScenario !== undefined) {
          state.settings.weatherDemoScenario = normalizeWeatherDemoScenario(
            req.body.weatherDemoScenario,
          );
        }
        await saveDisplayState(state);
        const clientState = await buildClientDisplayState();
        broadcastDisplayEvent("display_state_update", clientState);
        const sanitized = sanitizeDisplayStateForScope(clientState, false);
        return res.json({ ok: true, settings: sanitized.settings, state: sanitized });
      }

      const mergedProfiles = { ...state.settings.displayProfiles };
      if (req.body.displayProfiles && typeof req.body.displayProfiles === "object") {
        for (const [k, incoming] of Object.entries(req.body.displayProfiles as Record<string, any>)) {
          const prev = mergedProfiles[k];
          mergedProfiles[k] = {
            ...(prev || {}),
            ...incoming,
            deviceToken: prev?.deviceToken || incoming?.deviceToken || generateDisplayToken(),
          };
        }
      }

      const incomingWebhookKey =
        typeof req.body.webhookApiKey === "string" && req.body.webhookApiKey.trim().length >= 12
          ? req.body.webhookApiKey.trim()
          : state.settings.webhookApiKey;
      const incomingEmbedToken =
        typeof req.body.embedToken === "string" && req.body.embedToken.trim().length >= 12
          ? req.body.embedToken.trim()
          : state.settings.embedToken;

      state.settings = {
        ...state.settings,
        ...req.body,
        webhookApiKey: incomingWebhookKey,
        embedToken: incomingEmbedToken,
        powerSchedule: req.body.powerSchedule
          ? normalizeTvPowerSchedule(
              req.body.powerSchedule,
              state.settings.powerSchedule || DEFAULT_TV_POWER_SCHEDULE,
            )
          : state.settings.powerSchedule || DEFAULT_TV_POWER_SCHEDULE,
        savedMapRegions: Array.isArray(req.body.savedMapRegions)
          ? normalizeSavedMapRegions(req.body.savedMapRegions)
          : state.settings.savedMapRegions || [],
        weatherOverlayMode:
          req.body.weatherOverlayMode !== undefined
            ? normalizeWeatherOverlayMode(req.body.weatherOverlayMode, "warnings_only")
            : normalizeWeatherOverlayMode(state.settings.weatherOverlayMode, "warnings_only"),
        weatherDemoScenario:
          req.body.weatherDemoScenario !== undefined
            ? normalizeWeatherDemoScenario(req.body.weatherDemoScenario)
            : normalizeWeatherDemoScenario(state.settings.weatherDemoScenario),
        displayGroups: req.body.displayGroups || state.settings.displayGroups,
        displayProfiles: mergedProfiles,
      };
      await saveDisplayState(state);
      await evaluateScheduledPowerActions();
      const clientState = await buildClientDisplayState();
      broadcastDisplayEvent("display_state_update", clientState);
      res.json({ ok: true, settings: state.settings, state: clientState });
    } catch (error: any) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  // Remote-control All TVs, a Display Group, or a Single Display (+ OS/HDMI-CEC commands)
  app.post("/api/display/control", requireEditor, async (req, res) => {
    try {
      const isAdmin = req.principal?.scope === "admin";
      const state = await getDisplayState();
      const {
        activePanel,
        targetProfile,
        targetScope, // "all" | "group" | "display"
        targetId,
        action, // "switch_panel" | "reload" | "tv_on" | "tv_standby" | "clear_power_override" | "restart_browser" | "reboot_pi"
      } = req.body || {};

      const isHardwareAction =
        Boolean(action) &&
        ["tv_on", "tv_standby", "clear_power_override", "restart_browser", "reboot_pi"].includes(
          action,
        );
      if (isHardwareAction && !isAdmin) {
        return res
          .status(403)
          .json({ ok: false, error: "Technical Admin privileges required for hardware TV/Pi commands" });
      }

      const scope = targetScope || (targetProfile && targetProfile !== "all" ? "display" : "all");
      const id = targetId || targetProfile || "all";

      // Resolve which display IDs are targeted
      const targetedDisplayIds = Object.values(state.settings.displayProfiles)
        .filter((p) => {
          if (scope === "all") return true;
          if (scope === "group") return p.groupId === id;
          if (scope === "display") return p.id === id;
          return false;
        })
        .map((p) => p.id);

      let needsSave = false;

      // Persist screen panel lock if switching panels
      if (activePanel) {
        if (scope === "all") {
          state.settings.activePanel = activePanel;
          for (const pid of targetedDisplayIds) {
            state.settings.displayProfiles[pid].activePanel = activePanel;
          }
        } else {
          for (const pid of targetedDisplayIds) {
            state.settings.displayProfiles[pid].activePanel = activePanel;
          }
        }
        needsSave = true;
      }

      const now = new Date();
      if (action === "clear_power_override") {
        for (const pid of targetedDisplayIds) {
          const prof = state.settings.displayProfiles[pid];
          if (prof) {
            prof.powerOverride = null;
            const telemetry = getDisplayTelemetry(pid);
            telemetry.lastScheduledPowerTarget = null;
          }
        }
        needsSave = true;
      } else if (action === "tv_on" || action === "tv_standby") {
        const manualDesiredOn = action === "tv_on";
        for (const pid of targetedDisplayIds) {
          const prof = state.settings.displayProfiles[pid];
          if (!prof) continue;
          const baseEval = evaluateTvPowerSchedule(
            state.settings.powerSchedule,
            { ...prof, powerOverride: null },
            now,
          );
          if (baseEval.scheduleActive && baseEval.scheduledShouldBeOn !== manualDesiredOn) {
            const fallbackUntil = new Date(now.getTime() + 12 * 3600_000).toISOString();
            prof.powerOverride = {
              state: manualDesiredOn ? "awake" : "sleep",
              untilIso: baseEval.nextTransitionIso || fallbackUntil,
              setAtIso: now.toISOString(),
            };
          } else {
            prof.powerOverride = null;
          }
          const telemetry = getDisplayTelemetry(pid);
          telemetry.lastScheduledPowerTarget = manualDesiredOn ? "on" : "standby";
          telemetry.lastScheduledCommandAtMs = now.getTime();
        }
        needsSave = true;
      }

      if (needsSave) {
        await saveDisplayState(state);
      }

      if (action === "clear_power_override") {
        await evaluateScheduledPowerActions(now);
      }

      // Queue hardware/OS command for Raspberry Pi agent if applicable
      if (action && ["tv_on", "tv_standby", "restart_browser", "reboot_pi"].includes(action)) {
        for (const pid of targetedDisplayIds) {
          const telemetry = getDisplayTelemetry(pid);
          telemetry.pendingCommand = action;
        }
      }

      broadcastDisplayEvent("display_control", {
        activePanel,
        targetScope: scope,
        targetId: id,
        targetedDisplayIds,
        action: action || "switch_panel",
      });

      const clientState = await buildClientDisplayState();
      broadcastDisplayEvent("display_state_update", clientState);
      res.json({
        ok: true,
        targetedDisplayIds,
        state: sanitizeDisplayStateForScope(clientState, isAdmin),
      });
    } catch (error: any) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/display/refresh-feeds", requireEditor, async (req, res) => {
    try {
      const isAdmin = req.principal?.scope === "admin";
      const { icsCalendarUrl } = req.body || {};
      if (isAdmin && typeof icsCalendarUrl === "string") {
        const state = await getDisplayState();
        state.settings.icsCalendarUrl = icsCalendarUrl.trim();
        await saveDisplayState(state);
      }
      const [weatherUpdated, newsUpdated, nwsUpdated, icsRes] = await Promise.all([
        refreshLiveWeather(),
        refreshLiveNews(),
        refreshLiveNwsAlerts(),
        syncIcsCalendarFeed(isAdmin ? icsCalendarUrl : undefined),
      ]);
      const clientState = await buildClientDisplayState();
      broadcastDisplayEvent("display_state_update", clientState);
      res.json({
        ok: true,
        weatherUpdated,
        newsUpdated,
        nwsUpdated,
        ics: icsRes,
        state: sanitizeDisplayStateForScope(clientState, isAdmin),
      });
    } catch (error: any) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  // -------------------------------------------------------------------------
  // CUSTOM SCREENS STUDIO, PLAYLISTS & FLYER MEDIA UPLOADS
  // -------------------------------------------------------------------------
  app.put("/api/display/screens", requireEditor, async (req, res) => {
    try {
      const state = await getDisplayState();
      const { customScreens, defaultPlaylist, groupPlaylists, unitPlaylists } = req.body || {};

      if (Array.isArray(customScreens)) {
        state.customScreens = customScreens;
      }

      if (Array.isArray(defaultPlaylist)) {
        state.settings.defaultPlaylist = normalizePlaylistEntries(
          defaultPlaylist,
          state.customScreens,
          true,
        );
      } else {
        state.settings.defaultPlaylist = normalizePlaylistEntries(
          state.settings.defaultPlaylist,
          state.customScreens,
          true,
        );
      }

      if (groupPlaylists && typeof groupPlaylists === "object") {
        state.settings.displayGroups = state.settings.displayGroups.map((g) => {
          const incoming = groupPlaylists[g.id];
          if (incoming === null) {
            const { playlist: _removed, ...rest } = g;
            return rest;
          }
          if (Array.isArray(incoming)) {
            return {
              ...g,
              playlist: normalizePlaylistEntries(incoming, state.customScreens, false),
            };
          }
          return g;
        });
      }

      if (unitPlaylists && typeof unitPlaylists === "object") {
        for (const [unitId, cfg] of Object.entries(unitPlaylists as Record<string, any>)) {
          const prof = state.settings.displayProfiles[unitId];
          if (!prof || !cfg) continue;
          if (cfg.playlistMode === "custom" || cfg.playlistMode === "group") {
            prof.playlistMode = cfg.playlistMode;
          }
          if (Array.isArray(cfg.playlist)) {
            prof.playlist = normalizePlaylistEntries(cfg.playlist, state.customScreens, false);
          }
        }
      }

      // If any TV's locked activePanel points to a deleted custom screen, reset it cleanly to "auto"
      const validCustomIds = new Set(state.customScreens.map((s) => s.id));
      const isValidPanel = (p?: string) =>
        !p ||
        p === "auto" ||
        p === "screen-1" ||
        p === "screen-2" ||
        p === "screen-3" ||
        p === "screen-4" ||
        p === "screen-5" ||
        validCustomIds.has(p);

      if (!isValidPanel(state.settings.activePanel)) {
        state.settings.activePanel = "auto";
      }
      for (const prof of Object.values(state.settings.displayProfiles)) {
        if (!isValidPanel(prof.activePanel)) {
          prof.activePanel = "auto";
        }
      }

      await saveDisplayState(state);
      const clientState = await buildClientDisplayState();
      broadcastDisplayEvent("display_state_update", clientState);
      log(`Saved custom screens (${state.customScreens.length}) & playlists`, "display");
      const isAdmin = req.principal?.scope === "admin";
      res.json({ ok: true, state: sanitizeDisplayStateForScope(clientState, isAdmin) });
    } catch (error: any) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  const DISPLAY_MEDIA_DIR = path.resolve(process.cwd(), "data", "display-media");

  app.post(
    "/api/display/upload-media",
    requireEditor,
    express.raw({
      type: ["image/png", "image/jpeg", "image/webp", "image/gif"],
      limit: "16mb",
    }),
    async (req, res) => {
      try {
        const buf = req.body as Buffer;
        if (!Buffer.isBuffer(buf) || buf.length < 16) {
          return res.status(400).json({ ok: false, error: "Empty or unsupported image payload" });
        }

        // Verify image magic bytes (PNG, JPEG, WEBP, GIF)
        let ext: string | null = null;
        if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
          ext = "png";
        } else if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
          ext = "jpg";
        } else if (
          buf[0] === 0x52 &&
          buf[1] === 0x49 &&
          buf[2] === 0x46 &&
          buf[3] === 0x46 &&
          buf[8] === 0x57 &&
          buf[9] === 0x45 &&
          buf[10] === 0x42 &&
          buf[11] === 0x50
        ) {
          ext = "webp";
        } else if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
          ext = "gif";
        }

        if (!ext) {
          return res.status(400).json({
            ok: false,
            error: "Unsupported image format. Please upload PNG, JPG, WEBP, or GIF.",
          });
        }

        fs.mkdirSync(DISPLAY_MEDIA_DIR, { recursive: true });
        const filename = `flyer-${Date.now()}-${crypto.randomBytes(5).toString("hex")}.${ext}`;
        const filePath = path.join(DISPLAY_MEDIA_DIR, filename);
        fs.writeFileSync(filePath, buf);

        const url = `/api/display/media/${filename}`;
        log(`Uploaded TV flyer graphic: ${filename} (${Math.round(buf.length / 1024)} KB)`, "display");
        res.json({ ok: true, url, filename, bytes: buf.length });
      } catch (error: any) {
        res.status(400).json({ ok: false, error: error.message });
      }
    },
  );

  app.get("/api/display/media/:filename", requireDisplayRead, (req, res) => {
    const rawName = String(req.params.filename || "");
    if (!/^[a-zA-Z0-9._-]+\.(png|jpg|jpeg|webp|gif)$/i.test(rawName) || rawName.includes("..")) {
      return res.status(400).end("Invalid media filename");
    }
    const filePath = path.join(DISPLAY_MEDIA_DIR, rawName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).end("Media not found");
    }
    const ext = path.extname(rawName).toLowerCase();
    const mime =
      ext === ".png"
        ? "image/png"
        : ext === ".webp"
          ? "image/webp"
          : ext === ".gif"
            ? "image/gif"
            : "image/jpeg";
    res.setHeader("Content-Type", mime);
    res.setHeader("Cache-Control", "private, max-age=86400");
    fs.createReadStream(filePath).pipe(res);
  });

  // -------------------------------------------------------------------------
  // TEAM & FAMILY PHOTO GALLERY ENDPOINTS (Admin + Standard Staff)
  // -------------------------------------------------------------------------
  app.put("/api/display/gallery", requireEditor, async (req, res) => {
    try {
      const state = await getDisplayState();
      const current = normalizePhotoGalleryState(
        state.photoGallery,
        DEFAULT_PHOTO_GALLERY_STATE,
      );
      const incoming = req.body?.photoGallery || req.body || {};
      state.photoGallery = normalizePhotoGalleryState(
        {
          ...current,
          ...incoming,
          albums: Array.isArray(incoming.albums) ? incoming.albums : current.albums,
          photos: Array.isArray(incoming.photos) ? incoming.photos : current.photos,
        },
        DEFAULT_PHOTO_GALLERY_STATE,
      );

      await saveDisplayState(state);
      const clientState = await buildClientDisplayState();
      broadcastDisplayEvent("display_state_update", clientState);
      log(
        `Updated photo gallery (${state.photoGallery.photos.length} photos, ${state.photoGallery.albums.length} albums)`,
        "display",
      );
      const isAdmin = req.principal?.scope === "admin";
      res.json({
        ok: true,
        photoGallery: state.photoGallery,
        state: sanitizeDisplayStateForScope(clientState, isAdmin),
      });
    } catch (error: any) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/display/gallery/photos", requireEditor, async (req, res) => {
    try {
      const state = await getDisplayState();
      const current = normalizePhotoGalleryState(
        state.photoGallery,
        DEFAULT_PHOTO_GALLERY_STATE,
      );
      const rawItems = Array.isArray(req.body?.photos)
        ? req.body.photos
        : req.body?.photo
          ? [req.body.photo]
          : [];
      if (rawItems.length === 0) {
        return res.status(400).json({ ok: false, error: "Provide photo or photos array" });
      }

      const defaultAuthor =
        req.principal?.displayName || req.principal?.username || "Team";
      const stamped = rawItems.map((item: any) => ({
        id: `photo-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
        url: String(item.url || "").trim(),
        filename: item.filename ? String(item.filename).trim() : undefined,
        caption: String(item.caption || "").trim(),
        albumId: String(item.albumId || current.albums[0]?.id || "work-events"),
        uploadedBy: String(item.uploadedBy || defaultAuthor).trim(),
        eventDate: item.eventDate ? String(item.eventDate).trim() : undefined,
        active: item.active !== false,
        featured: Boolean(item.featured),
        uploadedAt: new Date().toISOString(),
      }));

      state.photoGallery = normalizePhotoGalleryState(
        {
          ...current,
          photos: [...stamped, ...current.photos],
        },
        DEFAULT_PHOTO_GALLERY_STATE,
      );

      await saveDisplayState(state);
      const clientState = await buildClientDisplayState();
      broadcastDisplayEvent("display_state_update", clientState);
      log(`Added ${stamped.length} photo(s) to Team & Event Gallery`, "display");
      const isAdmin = req.principal?.scope === "admin";
      res.json({
        ok: true,
        photoGallery: state.photoGallery,
        state: sanitizeDisplayStateForScope(clientState, isAdmin),
      });
    } catch (error: any) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.delete("/api/display/gallery/photos/:id", requireEditor, async (req, res) => {
    try {
      const photoId = String(req.params.id || "");
      const state = await getDisplayState();
      const current = normalizePhotoGalleryState(
        state.photoGallery,
        DEFAULT_PHOTO_GALLERY_STATE,
      );
      const target = current.photos.find((p) => p.id === photoId);
      if (!target) {
        return res.status(404).json({ ok: false, error: "Photo not found" });
      }

      const remainingPhotos = current.photos.filter((p) => p.id !== photoId);
      state.photoGallery = {
        ...current,
        photos: remainingPhotos,
      };

      // Clean up local disk file if unreferenced elsewhere
      const fname =
        target.filename ||
        (target.url.startsWith("/api/display/media/")
          ? target.url.slice("/api/display/media/".length)
          : "");
      if (fname && /^[a-zA-Z0-9._-]+\.(png|jpg|jpeg|webp|gif)$/i.test(fname)) {
        const stillUsedInGallery = remainingPhotos.some(
          (p) => p.url.includes(fname) || p.filename === fname,
        );
        const stillUsedInWidgets = (state.customScreens || []).some((sc) =>
          (sc.widgets || []).some((w) => String(w.config?.imageUrl || "").includes(fname)),
        );
        if (!stillUsedInGallery && !stillUsedInWidgets) {
          const diskPath = path.join(DISPLAY_MEDIA_DIR, fname);
          if (fs.existsSync(diskPath)) {
            try {
              fs.unlinkSync(diskPath);
            } catch {}
          }
        }
      }

      await saveDisplayState(state);
      const clientState = await buildClientDisplayState();
      broadcastDisplayEvent("display_state_update", clientState);
      const isAdmin = req.principal?.scope === "admin";
      res.json({
        ok: true,
        photoGallery: state.photoGallery,
        state: sanitizeDisplayStateForScope(clientState, isAdmin),
      });
    } catch (error: any) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  // -------------------------------------------------------------------------
  // HOT SHOT SHEET LIVE API SYNC, TV ALERTS & PDF PARSER ENDPOINTS
  // -------------------------------------------------------------------------
  app.post("/api/display/hotshots/sync-now", requireEditor, async (req, res) => {
    try {
      const result = await syncHotShotSheetNow();
      await evaluateHotShotGpsCompletions(true);
      const clientState = await buildClientDisplayState();
      broadcastDisplayEvent("display_state_update", clientState);
      const isAdmin = req.principal?.scope === "admin";
      res.json({
        ok: result.ok,
        syncStatus: getHotShotSyncStatus(),
        openOrders: getHotShotOpenOrders(),
        newAlerts: result.newAlerts,
        state: sanitizeDisplayStateForScope(clientState, isAdmin),
      });
    } catch (error: any) {
      res.status(500).json({
        ok: false,
        error: error?.message || "Failed syncing with HotShotSheet API",
      });
    }
  });

  app.post("/api/display/hotshots/test-alert", requireEditor, async (_req, res) => {
    try {
      const sampleAlert = await buildTestHotShotDeliveryAlert();
      broadcastDisplayEvent("hotshot_delivery_alert", {
        alerts: [sampleAlert],
      });
      log(
        `🔔 Sent test HotShot delivery alert to TVs: ${sampleAlert.accountName} (${sampleAlert.city}, ${sampleAlert.state})`,
        "hotshot-api",
      );
      res.json({ ok: true, alert: sampleAlert });
    } catch (error: any) {
      res.status(500).json({
        ok: false,
        error: error?.message || "Failed broadcasting test alert",
      });
    }
  });

  app.post(
    "/api/display/hotshots/parse-pdf",
    requireEditor,
    express.raw({
      type: ["application/pdf", "application/octet-stream"],
      limit: "20mb",
    }),
    async (req, res) => {
      try {
        const buf = req.body as Buffer;
        if (!Buffer.isBuffer(buf) || buf.length < 32) {
          return res.status(400).json({ ok: false, error: "Empty or invalid PDF upload" });
        }
        // Check %PDF- magic header
        if (buf[0] !== 0x25 || buf[1] !== 0x50 || buf[2] !== 0x44 || buf[3] !== 0x46) {
          return res.status(400).json({
            ok: false,
            error: "Uploaded file is not a valid PDF document.",
          });
        }

        const state = await getDisplayState();
        const rosterSet = new Set<string>();
        for (const item of state.sfSchedule?.memberRoster || []) {
          if (item?.name) rosterSet.add(String(item.name).trim());
        }
        for (const row of state.sfSchedule?.rows || []) {
          if (row?.name) rosterSet.add(String(row.name).trim());
        }

        const parsed = await parseHotShotPdfBuffer(buf, {
          sfRosterNames: Array.from(rosterSet),
          customTerritories: state.routeTerritories,
        });

        let vehicleEstimate: any = { topMatch: null, candidates: [] };
        if (parsed.deliveryDateISO === getCentralDateISO(new Date())) {
          try {
            vehicleEstimate = await computeHotShotVehicleSuggestions({
              stops: parsed.stops,
              originHub: parsed.suggestedOriginHub,
              deliveryDateISO: parsed.deliveryDateISO,
            });
          } catch {}
        }

        log(
          `Parsed Hot Shot PDF (${parsed.stops.length} stops, date=${parsed.deliveryDateISO}, driver=${parsed.suggestedDriver || parsed.rawPdfDriver}${vehicleEstimate.topMatch ? `, gpsVan=${vehicleEstimate.topMatch.vehicleName}` : ""})`,
          "hotshot",
        );

        res.json({ ok: true, parsed, vehicleEstimate });
      } catch (error: any) {
        res.status(400).json({
          ok: false,
          error: error?.message || "Failed to parse Hot Shot PDF",
        });
      }
    },
  );

  app.post("/api/display/hotshots/estimate-vehicle", requireEditor, async (req, res) => {
    try {
      const body = req.body || {};
      const state = await getDisplayState();
      const originHub = normalizeHotShotOriginHub(body.originHub);
      const deliveryDateISO = String(body.deliveryDateISO || getCentralDateISO(new Date()));
      if (deliveryDateISO !== getCentralDateISO(new Date())) {
        return res.json({ ok: true, topMatch: null, candidates: [] });
      }
      const fallbackHub = getHotShotHubMeta(originHub);
      const rawStops = Array.isArray(body.stops) ? body.stops : [];
      const hydratedStops = await Promise.all(
        rawStops.map(async (s: any) => {
          const latNum = Number(s?.lat);
          const lonNum = Number(s?.lon);
          const hasValidCoords =
            Number.isFinite(latNum) &&
            Number.isFinite(lonNum) &&
            !(Math.abs(latNum) < 0.001 && Math.abs(lonNum) < 0.001);
          if (hasValidCoords) return s;
          const found = lookupKnownTownCoords(
            s?.city || "",
            s?.state || "SD",
            state.routeTerritories,
          );
          if (found && !s?.address) {
            return {
              ...s,
              lat: found.lat,
              lon: found.lon,
              geocodePrecision: "town" as const,
            };
          }
          const geo = await geocodeStreetOrTown(
            String(s?.address || ""),
            String(s?.city || ""),
            String(s?.state || "SD"),
            s?.zip ? String(s.zip) : undefined,
            state.routeTerritories,
            originHub,
          );
          return {
            ...s,
            lat: geo.lat,
            lon: geo.lon,
            geocodePrecision: geo.precision,
          };
        }),
      );

      const estimate = await computeHotShotVehicleSuggestions({
        stops: hydratedStops,
        originHub,
        deliveryDateISO,
        excludeRouteId: body.excludeRouteId ? String(body.excludeRouteId) : undefined,
      });
      res.json({ ok: true, ...estimate });
    } catch (error: any) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/display/hotshots", requireEditor, async (req, res) => {
    try {
      const state = await getDisplayState();
      const existing = normalizeHotShotRoutes(state.hotShotRoutes);
      const rawRoute = req.body?.route || req.body || {};
      const routeOriginHub = normalizeHotShotOriginHub(
        rawRoute.originHub,
        rawRoute.rawPdfDriver || rawRoute.driverName,
      );
      const fallbackHub = getHotShotHubMeta(routeOriginHub);

      // Fill street/town coordinates for any manually added stops that didn't have lat/lon yet
      const rawStops = Array.isArray(rawRoute.stops) ? rawRoute.stops : [];
      const hydratedStops = await Promise.all(
        rawStops.map(async (s: any, idx: number) => {
          const latNum = Number(s?.lat);
          const lonNum = Number(s?.lon);
          const hasValidCoords =
            Number.isFinite(latNum) &&
            Number.isFinite(lonNum) &&
            !(Math.abs(latNum) < 0.001 && Math.abs(lonNum) < 0.001);
          if (hasValidCoords) return s;
          const found = lookupKnownTownCoords(
            s?.city || "",
            s?.state || "SD",
            state.routeTerritories,
          );
          if (found && !s?.address) {
            return {
              ...s,
              order: idx + 1,
              lat: found.lat,
              lon: found.lon,
              state: found.state || s?.state || "SD",
              geocodePrecision: "town",
            };
          }
          const geo = await geocodeStreetOrTown(
            String(s?.address || ""),
            String(s?.city || ""),
            String(s?.state || "SD"),
            s?.zip ? String(s.zip) : undefined,
            state.routeTerritories,
            routeOriginHub,
          );
          return {
            ...s,
            order: idx + 1,
            lat: geo.lat,
            lon: geo.lon,
            state: found?.state || s?.state || "SD",
            geocodePrecision: geo.precision,
          };
        }),
      );

      const nextColor =
        rawRoute.color ||
        HOTSHOT_COLOR_PALETTE[existing.length % HOTSHOT_COLOR_PALETTE.length];

      const explicitVehId = rawRoute.vehicleId ? String(rawRoute.vehicleId).trim() : "";
      const created = normalizeHotShotRoute(
        {
          ...rawRoute,
          originHub: routeOriginHub,
          vehicleId: explicitVehId,
          vehicleAssignedBy: explicitVehId
            ? rawRoute.vehicleAssignedBy === "auto_gps"
              ? "auto_gps"
              : "manual"
            : null,
          ...(explicitVehId ? {} : { autoMatchConfidence: null, autoMatchReason: null }),
          id: `hotshot-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
          color: nextColor,
          stops: hydratedStops,
          title:
            rawRoute.title && String(rawRoute.title).trim()
              ? String(rawRoute.title).trim()
              : buildHotShotTownSequenceLabel(hydratedStops, 5),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        existing.length,
      );

      state.hotShotRoutes = [created, ...existing];
      await saveDisplayState(state);
      await evaluateHotShotGpsCompletions(true);

      const finalState = await getDisplayState();
      const savedRoute =
        normalizeHotShotRoutes(finalState.hotShotRoutes).find((r) => r.id === created.id) ||
        created;

      const clientState = await buildClientDisplayState();
      broadcastDisplayEvent("display_state_update", clientState);
      log(
        `Created Hot Shot route '${savedRoute.title}' for ${savedRoute.deliveryDateISO} -> ${savedRoute.driverName} (${savedRoute.vehicleName || "Auto-GPS Standby"})`,
        "hotshot",
      );

      const isAdmin = req.principal?.scope === "admin";
      res.json({
        ok: true,
        route: savedRoute,
        state: sanitizeDisplayStateForScope(clientState, isAdmin),
      });
    } catch (error: any) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.put("/api/display/hotshots/:id", requireEditor, async (req, res) => {
    try {
      const id = String(req.params.id || "");
      const state = await getDisplayState();
      const existing = normalizeHotShotRoutes(state.hotShotRoutes);
      const idx = existing.findIndex((r) => r.id === id);
      if (idx < 0) {
        return res.status(404).json({ ok: false, error: "Hot Shot route not found" });
      }

      const patch = req.body?.route || req.body || {};
      const prevOriginHub = normalizeHotShotOriginHub(
        existing[idx].originHub,
        existing[idx].rawPdfDriver,
      );
      const nextOriginHub = normalizeHotShotOriginHub(
        patch.originHub !== undefined ? patch.originHub : prevOriginHub,
        patch.rawPdfDriver ?? existing[idx].rawPdfDriver,
      );
      const fallbackHub = getHotShotHubMeta(nextOriginHub);
      const originHubChanged = prevOriginHub !== nextOriginHub;

      const mergedStops = Array.isArray(patch.stops)
        ? await Promise.all(
            patch.stops.map(async (s: any, i: number) => {
              const latNum = Number(s?.lat);
              const lonNum = Number(s?.lon);
              const hasValidCoords =
                Number.isFinite(latNum) &&
                Number.isFinite(lonNum) &&
                !(Math.abs(latNum) < 0.001 && Math.abs(lonNum) < 0.001);
              if (hasValidCoords) return { ...s, order: i + 1 };
              const found = lookupKnownTownCoords(
                s?.city || "",
                s?.state || "SD",
                state.routeTerritories,
              );
              if (found && !s?.address) {
                return {
                  ...s,
                  order: i + 1,
                  lat: found.lat,
                  lon: found.lon,
                  state: found.state || s?.state || "SD",
                  geocodePrecision: "town",
                };
              }
              const geo = await geocodeStreetOrTown(
                String(s?.address || ""),
                String(s?.city || ""),
                String(s?.state || "SD"),
                s?.zip ? String(s.zip) : undefined,
                state.routeTerritories,
                nextOriginHub,
              );
              return {
                ...s,
                order: i + 1,
                lat: geo.lat,
                lon: geo.lon,
                state: found?.state || s?.state || "SD",
                geocodePrecision: geo.precision,
              };
            }),
          )
        : existing[idx].stops;

      const nextVehId =
        patch.vehicleId !== undefined
          ? String(patch.vehicleId || "").trim()
          : existing[idx].vehicleId || "";
      const vehChanged = nextVehId !== (existing[idx].vehicleId || "");
      const nextAssignedBy = !nextVehId
        ? null
        : patch.vehicleAssignedBy === "auto_gps" || patch.vehicleAssignedBy === "manual"
          ? patch.vehicleAssignedBy
          : vehChanged
            ? "manual"
            : existing[idx].vehicleAssignedBy || "manual";

      const updated: HotShotRoute = normalizeHotShotRoute(
        {
          ...existing[idx],
          ...patch,
          originHub: nextOriginHub,
          vehicleId: nextVehId,
          vehicleName: nextVehId ? patch.vehicleName ?? existing[idx].vehicleName ?? "" : "",
          vehicleAssignedBy: nextAssignedBy,
          ...(nextAssignedBy !== "auto_gps"
            ? { autoMatchConfidence: null, autoMatchReason: null }
            : {}),
          ...(originHubChanged || (vehChanged && !nextVehId)
            ? { departedAt: null, returnedAt: null }
            : {}),
          id,
          stops: mergedStops,
          ...(Array.isArray(patch.stops) || existing[idx].customStopOrder
            ? { customStopOrder: true }
            : {}),
          title:
            patch.title !== undefined && String(patch.title).trim()
              ? String(patch.title).trim()
              : buildHotShotTownSequenceLabel(mergedStops, 5),
          updatedAt: new Date().toISOString(),
        },
        idx,
      );

      existing[idx] = updated;
      state.hotShotRoutes = existing;
      await saveDisplayState(state);
      await evaluateHotShotGpsCompletions(true);

      const finalState = await getDisplayState();
      const savedRoute =
        normalizeHotShotRoutes(finalState.hotShotRoutes).find((r) => r.id === id) || updated;

      const clientState = await buildClientDisplayState();
      broadcastDisplayEvent("display_state_update", clientState);
      const isAdmin = req.principal?.scope === "admin";
      res.json({
        ok: true,
        route: savedRoute,
        state: sanitizeDisplayStateForScope(clientState, isAdmin),
      });
    } catch (error: any) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/display/hotshots/:id/stops/:stopId/toggle", requireEditor, async (req, res) => {
    try {
      const id = String(req.params.id || "");
      const stopId = String(req.params.stopId || "");
      const state = await getDisplayState();
      const existing = normalizeHotShotRoutes(state.hotShotRoutes);
      const route = existing.find((r) => r.id === id);
      if (!route) {
        return res.status(404).json({ ok: false, error: "Hot Shot route not found" });
      }
      const stop = route.stops.find((s) => s.id === stopId);
      if (!stop) {
        return res.status(404).json({ ok: false, error: "Stop not found" });
      }

      if (stop.completedAt) {
        stop.completedAt = null;
        stop.completedBy = null;
        route.returnedAt = null;
      } else {
        stop.completedAt = new Date().toISOString();
        stop.completedBy = "manual";
      }
      route.updatedAt = new Date().toISOString();

      state.hotShotRoutes = existing;
      await saveDisplayState(state);

      const clientState = await buildClientDisplayState();
      broadcastDisplayEvent("display_state_update", clientState);
      const isAdmin = req.principal?.scope === "admin";
      res.json({
        ok: true,
        route,
        state: sanitizeDisplayStateForScope(clientState, isAdmin),
      });
    } catch (error: any) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.delete("/api/display/hotshots/:id", requireEditor, async (req, res) => {
    try {
      const id = String(req.params.id || "");
      const state = await getDisplayState();
      const existing = normalizeHotShotRoutes(state.hotShotRoutes);
      const filtered = existing.filter((r) => r.id !== id);
      if (filtered.length === existing.length) {
        return res.status(404).json({ ok: false, error: "Hot Shot route not found" });
      }

      state.hotShotRoutes = filtered;
      await saveDisplayState(state);

      const clientState = await buildClientDisplayState();
      broadcastDisplayEvent("display_state_update", clientState);
      log(`Deleted Hot Shot route ${id}`, "hotshot");

      const isAdmin = req.principal?.scope === "admin";
      res.json({
        ok: true,
        state: sanitizeDisplayStateForScope(clientState, isAdmin),
      });
    } catch (error: any) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  // =========================================================================
  // HOTSHOT DELIVERY HISTORY & SALES CRM INTEGRATION ENDPOINTS
  // =========================================================================
  startAutoHistorySeedOnBoot();

  async function isAuthorizedForCrmOrHistory(req: any): Promise<boolean> {
    const principal = req.principal || (await resolveRequestPrincipal(req));
    if (principal) {
      req.principal = principal;
      return true;
    }
    const providedKey = String(
      req.headers["x-api-key"] ||
        req.headers["apikey"] ||
        req.query?.api_key ||
        req.query?.apiKey ||
        "",
    ).trim();
    if (!providedKey) return false;
    const hssKey = (process.env.HOTSHOTSHEET_API_KEY || "").trim();
    if (hssKey && providedKey === hssKey) return true;
    try {
      const state = await getDisplayState();
      const webhookKey = String(state?.settings?.webhookApiKey || "").trim();
      if (webhookKey && providedKey === webhookKey) return true;
    } catch {}
    return false;
  }

  app.get("/api/hotshot-history/summary", async (req, res) => {
    try {
      if (!(await isAuthorizedForCrmOrHistory(req))) {
        return res.status(401).json({ ok: false, error: "Authentication required" });
      }
      const daysParam = String(req.query.days || "90").trim();
      const days =
        daysParam === "all" ? "all" : Math.max(1, parseInt(daysParam, 10) || 90);
      const hub = String(req.query.hub || "all").trim() as any;
      const deliveryType = String(req.query.deliveryType || "all").trim() as any;
      const search = String(req.query.search || "").trim();
      const sort = String(req.query.sort || "visits").trim() as any;
      const limit = Math.min(2500, Math.max(10, parseInt(String(req.query.limit || "500"), 10) || 500));

      const result = queryCustomerHistorySummaries({
        days,
        hub,
        deliveryType,
        search,
        sort,
        limit,
      });
      res.json({ ok: true, ...result });
    } catch (error: any) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/hotshot-history/corridor-map", async (req, res) => {
    try {
      if (!(await isAuthorizedForCrmOrHistory(req))) {
        return res.status(401).json({ ok: false, error: "Authentication required" });
      }
      const daysParam = String(req.query.days || "365").trim();
      const days =
        daysParam === "all" ? "all" : Math.max(1, parseInt(daysParam, 10) || 365);
      const weekdayRaw = String(req.query.weekday || "all").trim();
      const weekday =
        weekdayRaw === "all"
          ? "all"
          : Math.min(6, Math.max(1, parseInt(weekdayRaw, 10) || 1));
      const hub = String(req.query.hub || "all").trim() as any;
      const driver = String(req.query.driver || "all").trim();
      const deliveryType = String(req.query.deliveryType || "all").trim() as any;
      const groupBy =
        String(req.query.groupBy || "weekday_driver").trim() === "driver"
          ? "driver"
          : "weekday_driver";

      const data = queryHistoricalCorridorMapData({
        days,
        weekday,
        hub,
        driver,
        deliveryType,
        groupBy,
      });
      res.json({ ok: true, ...data });
    } catch (error: any) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/hotshot-history/customer/:id", async (req, res) => {
    try {
      if (!(await isAuthorizedForCrmOrHistory(req))) {
        return res.status(401).json({ ok: false, error: "Authentication required" });
      }
      const id = decodeURIComponent(String(req.params.id || ""));
      const detail = getCustomerDeliveryTimeline(id);
      if (!detail.customer) {
        return res.status(404).json({ ok: false, error: "Customer not found in indexed history" });
      }
      res.json({ ok: true, ...detail });
    } catch (error: any) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/hotshot-history/backfill", async (req, res) => {
    try {
      if (!(await isAuthorizedForCrmOrHistory(req))) {
        return res.status(401).json({ ok: false, error: "Authentication required" });
      }
      const action = String(req.body?.action || "start").trim();
      if (action === "stop") {
        const status = stopHotShotHistoryBackfill();
        return res.json({ ok: true, status });
      }
      const presetRaw = String(req.body?.preset || "90d").trim();
      const preset = (
        ["90d", "1y", "3y", "all_2015"].includes(presetRaw) ? presetRaw : "90d"
      ) as "90d" | "1y" | "3y" | "all_2015";
      const status = await startHotShotHistoryBackfill(preset);
      res.json({ ok: true, status });
    } catch (error: any) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/hotshot-history/export.csv", async (req, res) => {
    try {
      if (!(await isAuthorizedForCrmOrHistory(req))) {
        return res.status(401).json({ ok: false, error: "Authentication required" });
      }
      const daysParam = String(req.query.days || "all").trim();
      const days =
        daysParam === "all" ? "all" : Math.max(1, parseInt(daysParam, 10) || 365);
      const hub = String(req.query.hub || "all").trim() as any;
      const search = String(req.query.search || "").trim();

      const { customers } = queryCustomerHistorySummaries({
        days,
        hub,
        search,
        sort: "visits",
        limit: 10000,
      });

      const escCsv = (val: unknown) => {
        const s = String(val ?? "");
        if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
        return s;
      };

      const headers = [
        "DealerNumber",
        "DealerId",
        "AccountName",
        "City",
        "State",
        "Address",
        "Zip",
        "Phone",
        "PrimaryHub",
        "UniqueVisitDays",
        "TotalDeliveryOrders",
        "VisitsLast30d",
        "VisitsLast90d",
        "VisitsLast365d",
        "AvgDaysBetweenVisits",
        "LastVisitDate",
        "DaysSinceLastVisit",
        "LastDriver",
        "FirstVisitDate",
        "TotalBatteries",
        "EstimatedWeightLbs",
        "HotShotOrders",
        "RouteTruckOrders",
        "UpsShippingOrders",
        "TopDrivers",
        "TopBatteryParts",
      ];

      const lines = [headers.join(",")];
      for (const c of customers) {
        lines.push(
          [
            c.dealerNumber,
            c.dealerId || "",
            c.accountName,
            c.city,
            c.state,
            c.address,
            c.zip,
            c.phone,
            c.primaryHub,
            c.uniqueVisitDays,
            c.totalDeliveries,
            c.visitsLast30d,
            c.visitsLast90d,
            c.visitsLast365d,
            c.avgDaysBetweenVisits ?? "",
            c.lastVisitDateISO,
            c.daysSinceLastVisit,
            c.lastDriverName,
            c.firstVisitDateISO,
            c.totalPieces,
            c.totalWeightLbs,
            c.deliveryTypeBreakdown.hotshot,
            c.deliveryTypeBreakdown.route_truck,
            c.deliveryTypeBreakdown.ups_shipping,
            c.topDrivers.map((d) => `${d.driverName} (${d.visits})`).join("; "),
            c.topParts.map((p) => `${p.partNumber} (${p.totalQty})`).join("; "),
          ]
            .map(escCsv)
            .join(","),
        );
      }

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="ibs-customer-delivery-history-${getCentralDateISO(new Date())}.csv"`,
      );
      res.send(lines.join("\n"));
    } catch (error: any) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/hotshot-history/export.json", async (req, res) => {
    try {
      if (!(await isAuthorizedForCrmOrHistory(req))) {
        return res.status(401).json({ ok: false, error: "Authentication required" });
      }
      const result = queryCustomerHistorySummaries({
        days: "all",
        sort: "visits",
        limit: 10000,
      });
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="ibs-customer-delivery-history-${getCentralDateISO(new Date())}.json"`,
      );
      res.send(JSON.stringify(result, null, 2));
    } catch (error: any) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  // External Sales CRM Feed Endpoints (CORS enabled for VPS-to-VPS or browser integration)
  app.get("/api/crm/customers", async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-API-Key, APIkey");
    if (!(await isAuthorizedForCrmOrHistory(req))) {
      return res.status(401).json({
        ok: false,
        error: "Provide X-API-Key header or ?api_key= query parameter",
      });
    }
    const daysParam = String(req.query.days || "all").trim();
    const days =
      daysParam === "all" ? "all" : Math.max(1, parseInt(daysParam, 10) || 365);
    const search = String(req.query.search || "").trim();
    const result = queryCustomerHistorySummaries({
      days,
      search,
      sort: "visits",
      limit: 10000,
    });
    res.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      status: result.status,
      totals: result.totals,
      customers: result.customers,
    });
  });

  app.get("/api/crm/customers/:dealerNumberOrId", async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-API-Key, APIkey");
    if (!(await isAuthorizedForCrmOrHistory(req))) {
      return res.status(401).json({
        ok: false,
        error: "Provide X-API-Key header or ?api_key= query parameter",
      });
    }
    const id = decodeURIComponent(String(req.params.dealerNumberOrId || ""));
    const detail = getCustomerDeliveryTimeline(id);
    if (!detail.customer) {
      return res.status(404).json({
        ok: false,
        error: `No customer found matching '${id}'`,
      });
    }
    res.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      customer: detail.customer,
      deliveries: detail.deliveries,
    });
  });

  return httpServer;
}
