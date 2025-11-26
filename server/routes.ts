import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { insertVehicleLocationSchema } from "@shared/schema";
import { log } from "./app";

// Store connected WebSocket clients
const wsClients = new Set<WebSocket>();

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
      // Parse the incoming webhook payload
      // Motive webhook structure might vary - adjust as needed
      const webhookData = req.body;
      
      // Transform Motive payload to our schema
      const locationData = {
        vehicleId: webhookData.vehicle_id || webhookData.data?.vehicle_id,
        latitude: webhookData.location?.lat || webhookData.data?.location?.lat,
        longitude: webhookData.location?.lon || webhookData.data?.location?.lon,
        speed: webhookData.speed || webhookData.data?.speed || 0,
        heading: webhookData.heading || webhookData.data?.heading || 0,
        status: webhookData.status || webhookData.data?.status || "unknown",
        timestamp: new Date(webhookData.timestamp || webhookData.data?.timestamp || Date.now()),
      };

      // Validate with Zod
      const validated = insertVehicleLocationSchema.parse(locationData);

      // Store in database
      const inserted = await storage.insertVehicleLocation(validated);

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

      log(`Location update for ${inserted.vehicleId} broadcast to ${wsClients.size} clients`, "webhook");

      res.status(200).json({ success: true, id: inserted.id });
    } catch (error: any) {
      log(`Webhook error: ${error.message}`, "webhook");
      res.status(400).json({ 
        success: false, 
        error: error.message 
      });
    }
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

  return httpServer;
}
