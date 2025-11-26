import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { insertVehicleLocationSchema } from "@shared/schema";
import { log } from "./app";
import crypto from "crypto";

// Store connected WebSocket clients
const wsClients = new Set<WebSocket>();

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
      
      // Verify webhook signature if secret is configured
      const webhookSecret = process.env.MOTIVE_WEBHOOK_SECRET;
      if (webhookSecret) {
        const signature = req.headers['x-kt-webhook-signature'] as string;
        const rawBody = JSON.stringify(req.body);
        
        if (!signature) {
          log("❌ Missing webhook signature header (X-KT-Webhook-Signature)", "webhook");
          return res.status(403).json({ 
            success: false, 
            error: "Missing signature" 
          });
        }
        
        if (!verifyMotiveSignature(rawBody, signature, webhookSecret)) {
          log("❌ Invalid webhook signature", "webhook");
          return res.status(403).json({ 
            success: false, 
            error: "Invalid signature" 
          });
        }
        
        log("✅ Webhook signature verified", "webhook");
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
      
      // Transform Motive payload to our schema
      const locationData = {
        vehicleId: String(webhookData.vehicle_id || webhookData.vehicle_number || "unknown"),
        latitude: webhookData.lat,
        longitude: webhookData.lon,
        speed: webhookData.speed || 0,
        heading: webhookData.bearing || 0,
        status: webhookData.type || "unknown",
        timestamp: new Date(webhookData.located_at || Date.now()),
      };

      log(`Parsed location data: ${JSON.stringify(locationData)}`, "webhook");

      // Validate with Zod
      const validated = insertVehicleLocationSchema.parse(locationData);

      // Store in database
      const inserted = await storage.insertVehicleLocation(validated);
      log(`Stored in database with ID: ${inserted.id}`, "webhook");

      // Broadcast to all connected WebSocket clients
      const message = JSON.stringify({
        type: "location_update",
        data: {
          id: inserted.vehicleId,
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

  // Get all vehicles with their latest locations
  app.get("/api/vehicles", async (req, res) => {
    try {
      const locations = await storage.getAllVehicleLatestLocations();
      
      res.json(locations.map((loc: VehicleLocation) => ({
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

  return httpServer;
}
