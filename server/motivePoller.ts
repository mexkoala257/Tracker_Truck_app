import { storage } from "./storage";
import { insertVehicleLocationSchema } from "@shared/schema";
import { log } from "./app";

const MOTIVE_BASE_URL = "https://api.gomotive.com";
const POLL_INTERVAL_MS = 60 * 1000;

let pollingTimer: ReturnType<typeof setInterval> | null = null;
let isPolling = false;

const recentPollResults: Array<{
  timestamp: string;
  type: "vehicles" | "assets";
  success: boolean;
  vehicleCount?: number;
  error?: string;
  raw?: any;
}> = [];

const MAX_POLL_RESULTS = 50;

export function getPollResults() {
  return recentPollResults;
}

export function clearPollResults() {
  recentPollResults.length = 0;
}

function addPollResult(result: typeof recentPollResults[0]) {
  recentPollResults.unshift(result);
  if (recentPollResults.length > MAX_POLL_RESULTS) {
    recentPollResults.pop();
  }
}

type BroadcastFn = (vehicleId: string, data: {
  latitude: number;
  longitude: number;
  speed: number;
  heading: number;
  status: string;
  timestamp: Date;
}) => void;

let broadcastLocationUpdate: BroadcastFn | null = null;

export function setBroadcastFunction(fn: BroadcastFn) {
  broadcastLocationUpdate = fn;
}

async function fetchVehicleLocations(): Promise<void> {
  const apiKey = process.env.MOTIVE_API_KEY;
  if (!apiKey) {
    log("MOTIVE_API_KEY not set - skipping vehicle location poll", "poller");
    return;
  }

  try {
    let page = 1;
    let hasMore = true;
    let totalProcessed = 0;
    const allRawVehicles: any[] = [];

    while (hasMore) {
      const url = `${MOTIVE_BASE_URL}/v3/vehicle_locations?per_page=100&page_no=${page}`;
      const response = await fetch(url, {
        headers: {
          "X-Api-Key": apiKey,
          "Accept": "application/json",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        log(`Motive vehicle API error (${response.status}): ${errorText}`, "poller");
        addPollResult({
          timestamp: new Date().toISOString(),
          type: "vehicles",
          success: false,
          error: `HTTP ${response.status}: ${errorText.substring(0, 200)}`,
        });
        return;
      }

      const data = await response.json();
      const vehicles = data.vehicles || data.vehicle_locations || [];

      if (vehicles.length === 0) {
        hasMore = false;
        break;
      }

      for (const entry of vehicles) {
        const vehicle = entry.vehicle || entry;
        allRawVehicles.push(vehicle);

        const vehicleId = String(vehicle.id || vehicle.number || "unknown");
        const currentLocation = vehicle.current_location;

        if (!currentLocation) {
          continue;
        }

        const lat = Number(currentLocation.lat ?? currentLocation.latitude);
        const lon = Number(currentLocation.lon ?? currentLocation.longitude);

        if (!isFinite(lat) || !isFinite(lon) || (lat === 0 && lon === 0)) {
          continue;
        }

        const speed = Number(currentLocation.speed ?? currentLocation.kph ?? 0);
        const heading = Number(currentLocation.bearing ?? currentLocation.heading ?? 0);
        const locatedAt = currentLocation.located_at || new Date().toISOString();

        let status = "unknown";
        if (currentLocation.vehicle_state) {
          status = currentLocation.vehicle_state;
        } else if (speed > 0) {
          status = "moving";
        } else {
          status = "stopped";
        }

        const speedMph = currentLocation.kph ? speed * 0.621371 : speed;

        try {
          const locationData = {
            vehicleId,
            latitude: lat,
            longitude: lon,
            speed: speedMph,
            heading,
            status,
            timestamp: new Date(locatedAt),
          };

          const validated = insertVehicleLocationSchema.parse(locationData);

          const existingVehicle = await storage.getVehicle(vehicleId);
          if (!existingVehicle) {
            const vehicleName = vehicle.number || vehicle.name || vehicleId;
            await storage.upsertVehicle({
              vehicleId,
              name: vehicleName,
              color: "#3b82f6",
            });
          }

          await storage.insertVehicleLocation(validated);
          totalProcessed++;

          if (broadcastLocationUpdate) {
            broadcastLocationUpdate(vehicleId, {
              latitude: lat,
              longitude: lon,
              speed: speedMph,
              heading,
              status,
              timestamp: new Date(locatedAt),
            });
          }
        } catch (err: any) {
          log(`Error processing vehicle ${vehicleId}: ${err.message}`, "poller");
        }
      }

      if (data.pagination) {
        const totalPages = data.pagination.total_pages || 1;
        if (page >= totalPages) {
          hasMore = false;
        } else {
          page++;
        }
      } else if (vehicles.length < 100) {
        hasMore = false;
      } else {
        page++;
      }
    }

    log(`Vehicle poll complete: ${totalProcessed} locations processed from ${allRawVehicles.length} vehicles`, "poller");
    addPollResult({
      timestamp: new Date().toISOString(),
      type: "vehicles",
      success: true,
      vehicleCount: totalProcessed,
      raw: { totalVehicles: allRawVehicles.length, processed: totalProcessed },
    });
  } catch (err: any) {
    log(`Vehicle poll error: ${err.message}`, "poller");
    addPollResult({
      timestamp: new Date().toISOString(),
      type: "vehicles",
      success: false,
      error: err.message,
    });
  }
}

async function fetchAssetLocations(): Promise<void> {
  const apiKey = process.env.MOTIVE_API_KEY;
  if (!apiKey) {
    return;
  }

  try {
    let page = 1;
    let hasMore = true;
    let totalProcessed = 0;
    let totalAssets = 0;

    while (hasMore) {
      const url = `${MOTIVE_BASE_URL}/v1/asset_locations?per_page=100&page_no=${page}`;
      const response = await fetch(url, {
        headers: {
          "X-Api-Key": apiKey,
          "Accept": "application/json",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        if (response.status === 404) {
          log("Asset locations endpoint not available (404) - this is normal if you don't have asset tracking", "poller");
          addPollResult({
            timestamp: new Date().toISOString(),
            type: "assets",
            success: true,
            vehicleCount: 0,
            raw: { message: "Endpoint not available or no assets" },
          });
          return;
        }
        log(`Motive asset API error (${response.status}): ${errorText}`, "poller");
        addPollResult({
          timestamp: new Date().toISOString(),
          type: "assets",
          success: false,
          error: `HTTP ${response.status}: ${errorText.substring(0, 200)}`,
        });
        return;
      }

      const data = await response.json();
      const assets = data.assets || data.asset_locations || [];
      totalAssets += assets.length;

      if (assets.length === 0) {
        hasMore = false;
        break;
      }

      for (const entry of assets) {
        const asset = entry.asset || entry;
        const assetId = String(asset.id || asset.number || "unknown");
        const gateway = asset.asset_gateway || {};
        const currentLocation = gateway.last_location || asset.current_location || asset.last_location || asset.location;

        if (!currentLocation) {
          continue;
        }

        const lat = Number(currentLocation.lat ?? currentLocation.latitude);
        const lon = Number(currentLocation.lon ?? currentLocation.longitude);

        if (!isFinite(lat) || !isFinite(lon) || (lat === 0 && lon === 0)) {
          continue;
        }

        const speedKph = Number(currentLocation.ground_speed_kph ?? currentLocation.speed ?? 0);
        const speed = speedKph * 0.621371;
        const heading = Number(currentLocation.bearing ?? currentLocation.heading ?? 0);
        const locatedAt = currentLocation.located_at || new Date().toISOString();
        const isMoving = currentLocation.moving === true;

        try {
          const locationData = {
            vehicleId: `asset-${assetId}`,
            latitude: lat,
            longitude: lon,
            speed,
            heading,
            status: isMoving ? "moving" : "stopped",
            timestamp: new Date(locatedAt),
          };

          const validated = insertVehicleLocationSchema.parse(locationData);

          const existingAsset = await storage.getVehicle(`asset-${assetId}`);
          if (!existingAsset) {
            const assetName = asset.name || asset.number || `Asset ${assetId}`;
            await storage.upsertVehicle({
              vehicleId: `asset-${assetId}`,
              name: assetName,
              color: "#10b981",
            });
          }

          await storage.insertVehicleLocation(validated);
          totalProcessed++;

          if (broadcastLocationUpdate) {
            broadcastLocationUpdate(`asset-${assetId}`, {
              latitude: lat,
              longitude: lon,
              speed,
              heading,
              status: isMoving ? "moving" : "stopped",
              timestamp: new Date(locatedAt),
            });
          }
        } catch (err: any) {
          log(`Error processing asset ${assetId}: ${err.message}`, "poller");
        }
      }

      if (data.pagination) {
        const totalPages = data.pagination.total_pages || 1;
        if (page >= totalPages) {
          hasMore = false;
        } else {
          page++;
        }
      } else if (assets.length < 100) {
        hasMore = false;
      } else {
        page++;
      }
    }

    log(`Asset poll complete: ${totalProcessed} locations processed from ${totalAssets} assets`, "poller");
    addPollResult({
      timestamp: new Date().toISOString(),
      type: "assets",
      success: true,
      vehicleCount: totalProcessed,
      raw: { totalAssets, processed: totalProcessed },
    });
  } catch (err: any) {
    log(`Asset poll error: ${err.message}`, "poller");
    addPollResult({
      timestamp: new Date().toISOString(),
      type: "assets",
      success: false,
      error: err.message,
    });
  }
}

async function pollAll(): Promise<void> {
  if (isPolling) {
    log("Previous poll still in progress - skipping", "poller");
    return;
  }

  isPolling = true;
  try {
    log("Starting Motive API poll...", "poller");
    await fetchVehicleLocations();
    await fetchAssetLocations();
    log("Motive API poll complete", "poller");
  } finally {
    isPolling = false;
  }
}

export function startPolling(): void {
  if (pollingTimer) {
    log("Polling already running - skipping duplicate start", "poller");
    return;
  }

  const apiKey = process.env.MOTIVE_API_KEY;
  if (!apiKey) {
    log("MOTIVE_API_KEY not set - polling disabled. Set the key in secrets to enable.", "poller");
    return;
  }

  log(`Starting Motive API polling every ${POLL_INTERVAL_MS / 1000} seconds`, "poller");

  pollAll();

  pollingTimer = setInterval(pollAll, POLL_INTERVAL_MS);
}

export function stopPolling(): void {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
    log("Motive API polling stopped", "poller");
  }
}

export async function pollNow(): Promise<void> {
  await pollAll();
}
