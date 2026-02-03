import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { insertVehicleLocationSchema, insertVehicleSchema, insertCustomLocationSchema, type VehicleLocation, type Vehicle, type CustomLocation } from "@shared/schema";
import { log } from "./app";
import crypto from "crypto";

// Store connected WebSocket clients
const wsClients = new Set<WebSocket>();

// Store recent webhook payloads for testing/debugging (last 50)
const recentWebhooks: Array<{ timestamp: string; headers: any; body: any }> = [];

// Vehicle metadata cache to avoid DB lookups on every webhook
const vehicleMetadataCache = new Map<string, { name: string; color: string }>();
let metadataCacheInitialized = false;

// Throttle location updates - track last update time per vehicle
const LOCATION_UPDATE_INTERVAL_MS = 30 * 1000; // 30 seconds (was 90 seconds)
const lastUpdateTime = new Map<string, number>();

// Cache for latest vehicle locations (avoids DB hit on every dashboard load)
const LOCATION_CACHE_TTL_MS = 10 * 1000; // 10 seconds (was 30 seconds)
let locationCache: { data: any[]; timestamp: number } | null = null;

// Cache for last known coordinates (to skip duplicate location inserts)
const lastKnownCoords = new Map<string, { lat: number; lon: number }>();

function shouldProcessLocationUpdate(vehicleId: string): boolean {
  const now = Date.now();
  const lastUpdate = lastUpdateTime.get(vehicleId) || 0;
  
  if (now - lastUpdate >= LOCATION_UPDATE_INTERVAL_MS) {
    lastUpdateTime.set(vehicleId, now);
    return true;
  }
  return false;
}

// Check if location has actually changed (skip duplicate writes)
function hasLocationChanged(vehicleId: string, lat: number, lon: number): boolean {
  const lastCoords = lastKnownCoords.get(vehicleId);
  if (!lastCoords) {
    lastKnownCoords.set(vehicleId, { lat, lon });
    return true;
  }
  // Consider unchanged if within ~10 meters (0.0001 degrees)
  const threshold = 0.0001;
  if (Math.abs(lastCoords.lat - lat) < threshold && Math.abs(lastCoords.lon - lon) < threshold) {
    return false;
  }
  lastKnownCoords.set(vehicleId, { lat, lon });
  return true;
}

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

// Verify Motive webhook signature (uses SHA-1 per Motive docs)
function verifyMotiveSignature(payload: string, signature: string, secret: string): boolean {
  const hmac = crypto.createHmac('sha1', secret);
  const expectedSignature = hmac.update(payload).digest('hex');
  
  // Timing-safe comparison
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch {
    return false;
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);
  
  // Initialize vehicle metadata cache on startup
  await initVehicleMetadataCache();

  // Setup WebSocket server
  const wss = new WebSocketServer({ 
    server: httpServer,
    path: "/ws"
  });

  wss.on("connection", (ws) => {
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

  // Webhook endpoint for Motive GPS data
  app.post("/api/webhooks/motive", async (req, res) => {
    try {
      log(`🚨 WEBHOOK RECEIVED from Motive!`, "webhook");
      log(`Headers: ${JSON.stringify(req.headers)}`, "webhook");
      log(`Body: ${JSON.stringify(req.body)}`, "webhook");
      
      // Store for debugging - keep last 20 webhooks
      recentWebhooks.unshift({
        timestamp: new Date().toISOString(),
        headers: req.headers,
        body: req.body
      });
      if (recentWebhooks.length > 50) {
        recentWebhooks.pop();
      }
      
      // TEMPORARILY DISABLED: Verify webhook signature for debugging
      // TODO: Re-enable signature verification after confirming webhooks work
      const webhookSecret = process.env.MOTIVE_WEBHOOK_SECRET;
      if (webhookSecret) {
        const signature = req.headers['x-kt-webhook-signature'] as string;
        log(`Signature header received: ${signature || 'NONE'}`, "webhook");
        
        if (signature) {
          const rawBody = JSON.stringify(req.body);
          const isValid = verifyMotiveSignature(rawBody, signature, webhookSecret);
          log(`Signature validation: ${isValid ? '✅ VALID' : '❌ INVALID'}`, "webhook");
          // Temporarily accepting all requests to debug
          log("⚠️ Accepting request anyway for debugging", "webhook");
        } else {
          log("⚠️ No signature provided - accepting anyway for debugging", "webhook");
        }
      } else {
        log("⚠️ No webhook secret configured - skipping signature verification", "webhook");
      }
      
      const webhookData = req.body;
      
      // Handle Motive's test/verification requests (array payload like ["vehicle_location_updated"])
      if (Array.isArray(webhookData)) {
        log(`Test/verification request detected: ${JSON.stringify(webhookData)}`, "webhook");
        return res.status(200).json({ 
          success: true, 
          message: "Webhook endpoint verified" 
        });
      }
      
      // Handle empty payloads
      if (!webhookData || Object.keys(webhookData).length === 0) {
        log("Empty webhook payload - responding with success", "webhook");
        return res.status(200).json({ 
          success: true, 
          message: "Webhook received" 
        });
      }
      
      // Check if this is a vehicle location webhook
      if (webhookData.action !== "vehicle_location_received" && webhookData.action !== "vehicle_location_updated") {
        log(`Ignoring webhook action: ${webhookData.action}`, "webhook");
        return res.status(200).json({ 
          success: true, 
          message: "Webhook received but not a location update" 
        });
      }
      
      // Transform Motive payload to our schema - handle multiple payload formats
      // Format 1: { vehicle_id, lat, lon, ... }
      // Format 2: { vehicle: { id }, location: { lat, lon }, ... }
      // Format 3: { vehicle: { id }, current_location: { lat, lon }, ... }
      
      let vehicleId: string;
      let lat: number;
      let lon: number;
      
      // Extract vehicle ID
      if (webhookData.vehicle_id) {
        vehicleId = String(webhookData.vehicle_id);
      } else if (webhookData.vehicle_number) {
        vehicleId = String(webhookData.vehicle_number);
      } else if (webhookData.vehicle?.id) {
        vehicleId = String(webhookData.vehicle.id);
      } else if (webhookData.vehicle?.number) {
        vehicleId = String(webhookData.vehicle.number);
      } else {
        vehicleId = "unknown";
      }
      
      // Extract lat/lon from different possible locations
      if (typeof webhookData.lat === 'number' && typeof webhookData.lon === 'number') {
        lat = webhookData.lat;
        lon = webhookData.lon;
      } else if (webhookData.location?.lat !== undefined && webhookData.location?.lon !== undefined) {
        lat = Number(webhookData.location.lat);
        lon = Number(webhookData.location.lon);
      } else if (webhookData.current_location?.lat !== undefined && webhookData.current_location?.lon !== undefined) {
        lat = Number(webhookData.current_location.lat);
        lon = Number(webhookData.current_location.lon);
      } else if (webhookData.current_location?.latitude !== undefined && webhookData.current_location?.longitude !== undefined) {
        lat = Number(webhookData.current_location.latitude);
        lon = Number(webhookData.current_location.longitude);
      } else if (webhookData.latitude !== undefined && webhookData.longitude !== undefined) {
        lat = Number(webhookData.latitude);
        lon = Number(webhookData.longitude);
      } else {
        log(`Could not extract lat/lon from payload: ${JSON.stringify(webhookData)}`, "webhook");
        return res.status(400).json({ 
          success: false, 
          error: "Could not find latitude/longitude in payload" 
        });
      }
      
      log(`Extracted: vehicleId=${vehicleId}, lat=${lat}, lon=${lon}`, "webhook");
      
      // Throttle: Only process if 30 seconds have passed since last update for this vehicle
      if (!shouldProcessLocationUpdate(vehicleId)) {
        if (process.env.NODE_ENV !== 'production') {
          log(`Throttled update for vehicle ${vehicleId}`, "webhook");
        }
        return res.status(200).json({ 
          success: true, 
          message: "Update throttled" 
        });
      }
      
      // Validate lat/lon before dedup check
      if (typeof lat !== 'number' || typeof lon !== 'number' || !isFinite(lat) || !isFinite(lon)) {
        log(`Invalid lat/lon for vehicle ${vehicleId}: lat=${lat}, lon=${lon}`, "webhook");
        return res.status(400).json({ 
          success: false, 
          error: "Invalid latitude or longitude" 
        });
      }
      
      // Skip if location hasn't changed significantly (saves DB writes)
      if (!hasLocationChanged(vehicleId, lat, lon)) {
        if (process.env.NODE_ENV !== 'production') {
          log(`Skipped duplicate location for vehicle ${vehicleId}`, "webhook");
        }
        return res.status(200).json({ 
          success: true, 
          message: "Location unchanged - skipped" 
        });
      }
      
      // Extract speed, heading, status, and timestamp from various payload formats
      const speed = webhookData.speed ?? webhookData.current_location?.speed ?? 0;
      const heading = webhookData.bearing ?? webhookData.heading ?? webhookData.current_location?.bearing ?? webhookData.current_location?.heading ?? 0;
      const status = webhookData.type ?? webhookData.event_type ?? webhookData.status ?? "unknown";
      const timestamp = webhookData.located_at ?? webhookData.timestamp ?? webhookData.current_location?.located_at ?? Date.now();
      
      const locationData = {
        vehicleId,
        latitude: lat,
        longitude: lon,
        speed: Number(speed) || 0,
        heading: Number(heading) || 0,
        status: String(status),
        timestamp: new Date(timestamp),
      };

      if (process.env.NODE_ENV !== 'production') {
        log(`Parsed location data: ${JSON.stringify(locationData)}`, "webhook");
      }

      // Validate with Zod
      const validated = insertVehicleLocationSchema.parse(locationData);

      // Ensure vehicle exists in vehicles table (auto-create if new)
      const existingMeta = getVehicleMetadata(vehicleId);
      if (existingMeta.name === vehicleId) {
        // Vehicle not in cache with a custom name, create/update entry
        await storage.upsertVehicle({
          vehicleId,
          name: vehicleId, // Default name is the ID
          color: "#3b82f6", // Default blue color
        });
        updateVehicleMetadataCache(vehicleId, vehicleId, "#3b82f6");
      }

      // Store in database
      const inserted = await storage.insertVehicleLocation(validated);
      
      // Invalidate location cache since we have new data
      invalidateLocationCache();
      
      if (process.env.NODE_ENV !== 'production') {
        log(`Stored in database with ID: ${inserted.id}`, "webhook");
      }

      // Get vehicle metadata from cache (no DB lookup!)
      const vehicleMeta = getVehicleMetadata(inserted.vehicleId);

      // Broadcast to all connected WebSocket clients
      const message = JSON.stringify({
        type: "location_update",
        data: {
          id: inserted.vehicleId,
          name: vehicleMeta.name,
          color: vehicleMeta.color,
          location: {
            lat: inserted.latitude,
            lon: inserted.longitude,
          },
          speed: inserted.speed,
          heading: inserted.heading,
          status: inserted.status,
          timestamp: inserted.timestamp.toISOString(),
        }
      });

      wsClients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message);
        }
      });

      log(`Location update broadcast to ${wsClients.size} clients`, "webhook");

      res.status(200).json({ success: true, id: inserted.id });
    } catch (error: any) {
      log(`❌ Webhook error: ${error.message}`, "webhook");
      log(`Error stack: ${error.stack}`, "webhook");
      res.status(400).json({ 
        success: false, 
        error: error.message 
      });
    }
  });

  // Test endpoint to verify webhook is accessible
  app.get("/api/webhooks/motive/test", async (req, res) => {
    log("Test endpoint called", "webhook");
    res.json({ 
      status: "ok", 
      message: "Webhook endpoint is accessible",
      timestamp: new Date().toISOString()
    });
  });

  // Debug endpoint to view recent webhook payloads
  app.get("/api/webhooks/debug", async (req, res) => {
    res.json({
      count: recentWebhooks.length,
      webhooks: recentWebhooks
    });
  });

  // Clear stored webhooks
  app.delete("/api/webhooks/debug", async (req, res) => {
    recentWebhooks.length = 0;
    res.json({ success: true, message: "Webhook history cleared" });
  });

  // Get latest location for a vehicle
  app.get("/api/vehicles/:vehicleId/location", async (req, res) => {
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
  app.get("/api/vehicles/:vehicleId/history", async (req, res) => {
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

  // Upsert vehicle metadata (name, color)
  app.post("/api/vehicles/:vehicleId", async (req, res) => {
    try {
      const { vehicleId } = req.params;
      const { name, color } = req.body;
      
      const vehicleData = insertVehicleSchema.parse({
        vehicleId,
        name,
        color,
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
  app.get("/api/vehicles/metadata", async (req, res) => {
    try {
      const vehiclesMeta = await storage.getAllVehicles();
      res.json(vehiclesMeta);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get all vehicles with their latest locations
  app.get("/api/vehicles", async (req, res) => {
    try {
      const now = Date.now();
      
      // Return cached data if still valid (30 second TTL)
      if (locationCache && (now - locationCache.timestamp) < LOCATION_CACHE_TTL_MS) {
        return res.json(locationCache.data);
      }
      
      const locations = await storage.getAllVehicleLatestLocations();
      
      // Use metadata cache instead of DB query
      const result = locations.map((loc: VehicleLocation) => {
        const meta = getVehicleMetadata(loc.vehicleId);
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
  app.get("/api/vehicles/export/csv", async (req, res) => {
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
  app.delete("/api/vehicles/:vehicleId", async (req, res) => {
    try {
      const { vehicleId } = req.params;
      
      await storage.deleteVehicle(vehicleId);
      
      // Remove from metadata cache
      vehicleMetadataCache.delete(vehicleId);
      lastKnownCoords.delete(vehicleId);
      lastUpdateTime.delete(vehicleId);
      
      // Invalidate location cache
      locationCache = null;
      
      log(`Deleted vehicle ${vehicleId}`, "admin");
      
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Custom locations routes
  app.get("/api/custom-locations", async (req, res) => {
    try {
      const locations = await storage.getAllCustomLocations();
      res.json(locations);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/custom-locations", async (req, res) => {
    try {
      const locationData = insertCustomLocationSchema.parse(req.body);
      const location = await storage.createCustomLocation(locationData);
      
      log(`Created custom location: ${location.name}`, "admin");
      
      res.json(location);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.put("/api/custom-locations/:id", async (req, res) => {
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

  app.delete("/api/custom-locations/:id", async (req, res) => {
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

  return httpServer;
}
