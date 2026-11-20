import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  type User,
  type InsertUser,
  type Vehicle,
  type InsertVehicle,
  type VehicleLocation,
  type InsertVehicleLocation,
  type CustomLocation,
  type InsertCustomLocation,
  users,
  vehicles,
  vehicleLocations,
  customLocations,
  mapHomeLocations,
} from "@shared/schema";
import { db, hasDatabase } from "../db";
import { eq, desc, gte, lte, and, sql } from "drizzle-orm";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getAllUsers(): Promise<User[]>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, updates: Partial<Pick<User, "username" | "password" | "role" | "displayName">>): Promise<User | undefined>;
  deleteUser(id: string): Promise<void>;

  // Vehicle metadata methods
  upsertVehicle(vehicle: InsertVehicle): Promise<Vehicle>;
  getVehicle(vehicleId: string): Promise<Vehicle | undefined>;
  getAllVehicles(): Promise<Vehicle[]>;
  deleteVehicle(vehicleId: string): Promise<void>;

  // Vehicle location methods
  insertVehicleLocation(location: InsertVehicleLocation): Promise<VehicleLocation>;
  getLatestVehicleLocation(vehicleId: string): Promise<VehicleLocation | undefined>;
  getVehicleLocationHistory(vehicleId: string, limit?: number): Promise<VehicleLocation[]>;
  getAllVehicleLatestLocations(): Promise<VehicleLocation[]>;
  getAllVehicleLocations(filters?: { startDate?: Date; endDate?: Date; vehicleId?: string }): Promise<VehicleLocation[]>;

  // Custom location methods
  createCustomLocation(location: InsertCustomLocation): Promise<CustomLocation>;
  updateCustomLocation(id: number, location: Partial<InsertCustomLocation>): Promise<CustomLocation | undefined>;
  deleteCustomLocation(id: number): Promise<void>;
  getAllCustomLocations(): Promise<CustomLocation[]>;

  // Map home-location assignment methods
  getMapHomeLocations(): Promise<Array<{
    mapKey: string;
    locationId: number;
    location: CustomLocation;
  }>>;
  setMapHomeLocation(mapKey: string, locationId: number): Promise<{
    mapKey: string;
    locationId: number;
    location: CustomLocation;
  }>;
  clearMapHomeLocation(mapKey: string): Promise<void>;

  // Optional local-demo-only read-only live telemetry pull (undefined on production DatabaseStorage)
  syncReadOnlySnapshotFromLiveVps?(): Promise<{
    synced: boolean;
    vehicleCount: number;
    vehicles: Array<{
      id: string;
      name: string;
      color: string;
      location: { lat: number; lon: number };
      speed: number;
      heading: number;
      status: string;
      timestamp: string;
    }>;
  }>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const normalized = username.trim().toLowerCase();
    const [user] = await db
      .select()
      .from(users)
      .where(sql`lower(${users.username}) = ${normalized}`);
    return user;
  }

  async getAllUsers(): Promise<User[]> {
    return db.select().from(users).orderBy(users.createdAt);
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values({
        ...insertUser,
        username: insertUser.username.trim(),
        role: insertUser.role || "admin",
        displayName: insertUser.displayName ?? null,
      })
      .returning();
    return user;
  }

  async updateUser(
    id: string,
    updates: Partial<Pick<User, "username" | "password" | "role" | "displayName">>,
  ): Promise<User | undefined> {
    const [user] = await db
      .update(users)
      .set(updates)
      .where(eq(users.id, id))
      .returning();
    return user;
  }

  async deleteUser(id: string): Promise<void> {
    await db.delete(users).where(eq(users.id, id));
  }

  async upsertVehicle(vehicle: InsertVehicle): Promise<Vehicle> {
    const metadataUpdates = {
      name: vehicle.name,
      color: vehicle.color,
      ...(vehicle.homeLocationId !== undefined ? { homeLocationId: vehicle.homeLocationId } : {}),
    };
    const [result] = await db
      .insert(vehicles)
      .values(vehicle)
      .onConflictDoUpdate({
        target: vehicles.vehicleId,
        set: metadataUpdates,
      })
      .returning();
    return result;
  }

  async getVehicle(vehicleId: string): Promise<Vehicle | undefined> {
    const [vehicle] = await db.select().from(vehicles).where(eq(vehicles.vehicleId, vehicleId));
    return vehicle;
  }

  async getAllVehicles(): Promise<Vehicle[]> {
    return db.select().from(vehicles);
  }

  async deleteVehicle(vehicleId: string): Promise<void> {
    await db.delete(vehicleLocations).where(eq(vehicleLocations.vehicleId, vehicleId));
    await db.delete(vehicles).where(eq(vehicles.vehicleId, vehicleId));
  }

  async insertVehicleLocation(location: InsertVehicleLocation): Promise<VehicleLocation> {
    const [inserted] = await db.insert(vehicleLocations).values(location).returning();
    return inserted;
  }

  async getLatestVehicleLocation(vehicleId: string): Promise<VehicleLocation | undefined> {
    const [location] = await db
      .select()
      .from(vehicleLocations)
      .where(eq(vehicleLocations.vehicleId, vehicleId))
      .orderBy(desc(vehicleLocations.timestamp))
      .limit(1);
    return location;
  }

  async getVehicleLocationHistory(vehicleId: string, limit: number = 100): Promise<VehicleLocation[]> {
    return db
      .select()
      .from(vehicleLocations)
      .where(eq(vehicleLocations.vehicleId, vehicleId))
      .orderBy(desc(vehicleLocations.timestamp))
      .limit(limit);
  }

  async getAllVehicleLatestLocations(): Promise<VehicleLocation[]> {
    // Loose B-tree index scan over (vehicle_id ASC, timestamp DESC):
    // Hops once per distinct vehicle (~18 lookups = <1ms even on millions of rows)
    const result = await db.execute(sql`
      WITH RECURSIVE latest AS (
        (
          SELECT vl.*
          FROM vehicle_locations vl
          ORDER BY vl.vehicle_id ASC, vl.timestamp DESC
          LIMIT 1
        )
        UNION ALL
        SELECT next_vl.*
        FROM latest l
        CROSS JOIN LATERAL (
          SELECT vl.*
          FROM vehicle_locations vl
          WHERE vl.vehicle_id > l.vehicle_id
          ORDER BY vl.vehicle_id ASC, vl.timestamp DESC
          LIMIT 1
        ) next_vl
      )
      SELECT * FROM latest
    `);

    return result.rows.map((row: any) => ({
      id: row.id,
      vehicleId: row.vehicle_id,
      latitude: row.latitude,
      longitude: row.longitude,
      speed: row.speed,
      heading: row.heading,
      status: row.status,
      timestamp: new Date(row.timestamp),
      receivedAt: row.received_at ? new Date(row.received_at) : new Date(),
    }));
  }

  async getAllVehicleLocations(filters?: { startDate?: Date; endDate?: Date; vehicleId?: string }): Promise<VehicleLocation[]> {
    const conditions = [];

    if (filters?.startDate) {
      conditions.push(gte(vehicleLocations.timestamp, filters.startDate));
    }
    if (filters?.endDate) {
      conditions.push(lte(vehicleLocations.timestamp, filters.endDate));
    }
    if (filters?.vehicleId) {
      conditions.push(eq(vehicleLocations.vehicleId, filters.vehicleId));
    }

    const query = db
      .select()
      .from(vehicleLocations)
      .orderBy(desc(vehicleLocations.timestamp));

    if (conditions.length > 0) {
      return query.where(and(...conditions));
    }

    return query;
  }

  async createCustomLocation(location: InsertCustomLocation): Promise<CustomLocation> {
    const [result] = await db.insert(customLocations).values(location).returning();
    return result;
  }

  async updateCustomLocation(id: number, location: Partial<InsertCustomLocation>): Promise<CustomLocation | undefined> {
    const [result] = await db
      .update(customLocations)
      .set(location)
      .where(eq(customLocations.id, id))
      .returning();
    return result;
  }

  async deleteCustomLocation(id: number): Promise<void> {
    await db.delete(customLocations).where(eq(customLocations.id, id));
  }

  async getAllCustomLocations(): Promise<CustomLocation[]> {
    return db.select().from(customLocations);
  }

  async getMapHomeLocations(): Promise<Array<{
    mapKey: string;
    locationId: number;
    location: CustomLocation;
  }>> {
    const rows = await db
      .select({
        mapKey: mapHomeLocations.mapKey,
        locationId: mapHomeLocations.locationId,
        location: customLocations,
      })
      .from(mapHomeLocations)
      .innerJoin(customLocations, eq(mapHomeLocations.locationId, customLocations.id));

    return rows;
  }

  async setMapHomeLocation(mapKey: string, locationId: number): Promise<{
    mapKey: string;
    locationId: number;
    location: CustomLocation;
  }> {
    await db
      .insert(mapHomeLocations)
      .values({ mapKey, locationId })
      .onConflictDoUpdate({
        target: mapHomeLocations.mapKey,
        set: { locationId, updatedAt: new Date() },
      });

    const [result] = await db
      .select({
        mapKey: mapHomeLocations.mapKey,
        locationId: mapHomeLocations.locationId,
        location: customLocations,
      })
      .from(mapHomeLocations)
      .innerJoin(customLocations, eq(mapHomeLocations.locationId, customLocations.id))
      .where(eq(mapHomeLocations.mapKey, mapKey));

    return result;
  }

  async clearMapHomeLocation(mapKey: string): Promise<void> {
    await db.delete(mapHomeLocations).where(eq(mapHomeLocations.mapKey, mapKey));
  }
}

interface LocalFleetData {
  users: User[];
  vehicles: Vehicle[];
  locations: VehicleLocation[];
  customLocations: CustomLocation[];
  mapHomeLocations: Record<string, number>;
  nextLocId: number;
  nextCustomLocId: number;
}

const LOCAL_FLEET_PATH = path.resolve(process.cwd(), "data", "local-fleet-cache.json");

const DEFAULT_SEED_VEHICLES = [
  { id: "48047", name: "T01", color: "#22c55e", lat: 45.28, lon: -95.42, speed: 62.4, status: "moving", heading: 90 },
  { id: "1335366", name: "T22", color: "#f73bbb", lat: 43.7021, lon: -98.20707, speed: 59.5, status: "moving", heading: 270 },
  { id: "48082", name: "T03", color: "#3b82f6", lat: 42.98, lon: -97.85, speed: 54.1, status: "moving", heading: 180 },
  { id: "48084", name: "T04", color: "#60a5fa", lat: 43.5442, lon: -96.7644, speed: 0, status: "stopped", heading: 0 },
  { id: "48085", name: "T05", color: "#94a3b8", lat: 43.5442, lon: -96.7644, speed: 0, status: "stopped", heading: 0 },
  { id: "asset-946502", name: "Van GO - SF", color: "#14b8a6", lat: 43.65, lon: -94.46, speed: 64.0, status: "moving", heading: 95 },
  { id: "asset-946462", name: "Milliamp - SF", color: "#14b8a6", lat: 43.71, lon: -98.02, speed: 65.2, status: "moving", heading: 270 },
  { id: "asset-946470", name: "Camry-SF", color: "#14b8a6", lat: 43.42, lon: -96.55, speed: 45.0, status: "moving", heading: 315 },
  { id: "1641591", name: "Big Betty", color: "#f59e0b", lat: 43.5442, lon: -96.7644, speed: 0, status: "stopped", heading: 0 },
  { id: "48071", name: "T02", color: "#fb923c", lat: 43.5442, lon: -96.7644, speed: 0, status: "stopped", heading: 0 },
];

export class LocalFallbackStorage implements IStorage {
  private state: LocalFleetData;
  private syncedLiveOnce = false;

  constructor() {
    this.state = this.load();
    this.syncReadOnlySnapshotFromLiveVps().catch(() => {});
  }

  private load(): LocalFleetData {
    try {
      if (fs.existsSync(LOCAL_FLEET_PATH)) {
        const raw = JSON.parse(fs.readFileSync(LOCAL_FLEET_PATH, "utf8"));
        return {
          users: (raw.users || []).map((u: any) => ({
            id: u.id || crypto.randomUUID(),
            username: u.username,
            password: u.password,
            role: u.role || "admin",
            displayName: u.displayName ?? null,
            createdAt: new Date(u.createdAt || Date.now()),
          })),
          vehicles: (raw.vehicles || []).map((v: any) => ({ ...v, createdAt: new Date(v.createdAt || Date.now()) })),
          locations: (raw.locations || []).map((l: any) => ({
            ...l,
            timestamp: new Date(l.timestamp || Date.now()),
            receivedAt: new Date(l.receivedAt || Date.now()),
          })),
          customLocations: (raw.customLocations || []).map((c: any) => ({
            ...c,
            createdAt: new Date(c.createdAt || Date.now()),
          })),
          mapHomeLocations: raw.mapHomeLocations || { map: 2, "regional-sf": 1 },
          nextLocId: raw.nextLocId || 50,
          nextCustomLocId: raw.nextCustomLocId || 10,
        };
      }
    } catch {}

    const now = new Date();
    const seededCustomLocations: CustomLocation[] = [
      {
        id: 1,
        name: "Sioux Falls Warehouse",
        latitude: 43.5442,
        longitude: -96.7644,
        icon: "warehouse",
        color: "#38bdf8",
        description: "Sioux Falls Hub",
        createdAt: now,
      },
      {
        id: 2,
        name: "Arlington Warehouse",
        latitude: 44.3792,
        longitude: -97.1406,
        icon: "warehouse",
        color: "#22c55e",
        description: "Arlington Hub",
        createdAt: now,
      },
    ];

    const seededVehicles: Vehicle[] = DEFAULT_SEED_VEHICLES.map((v) => ({
      vehicleId: v.id,
      name: v.name,
      color: v.color,
      homeLocationId: 1,
      createdAt: now,
    }));

    const seededLocations: VehicleLocation[] = DEFAULT_SEED_VEHICLES.map((v, idx) => ({
      id: idx + 1,
      vehicleId: v.id,
      latitude: v.lat,
      longitude: v.lon,
      speed: v.speed,
      heading: v.heading,
      status: v.status,
      timestamp: now,
      receivedAt: now,
    }));

    return {
      users: [],
      vehicles: seededVehicles,
      locations: seededLocations,
      customLocations: seededCustomLocations,
      mapHomeLocations: { map: 2, "regional-sf": 1 },
      nextLocId: seededLocations.length + 1,
      nextCustomLocId: 3,
    };
  }

  private save() {
    try {
      fs.mkdirSync(path.dirname(LOCAL_FLEET_PATH), { recursive: true });
      fs.writeFileSync(LOCAL_FLEET_PATH, JSON.stringify(this.state, null, 2), "utf8");
    } catch {}
  }

  // Pulls a read-only telemetry snapshot from the live VPS for local testing without writing anything to live
  public async syncReadOnlySnapshotFromLiveVps(): Promise<{
    synced: boolean;
    vehicleCount: number;
    vehicles: Array<{
      id: string;
      name: string;
      color: string;
      location: { lat: number; lon: number };
      speed: number;
      heading: number;
      status: string;
      timestamp: string;
    }>;
  }> {
    if (hasDatabase) return { synced: false, vehicleCount: 0, vehicles: [] };
    try {
      const [vehRes, locRes, homeRes] = await Promise.allSettled([
        fetch("https://srv1205734.hstgr.cloud/api/vehicles", { signal: AbortSignal.timeout(6000) }),
        fetch("https://srv1205734.hstgr.cloud/api/custom-locations", { signal: AbortSignal.timeout(6000) }),
        fetch("https://srv1205734.hstgr.cloud/api/map-home-locations", { signal: AbortSignal.timeout(6000) }),
      ]);

      let changed = false;
      const syncedVehicles: Array<{
        id: string;
        name: string;
        color: string;
        location: { lat: number; lon: number };
        speed: number;
        heading: number;
        status: string;
        timestamp: string;
      }> = [];

      if (locRes.status === "fulfilled" && locRes.value.ok) {
        const remoteLocs = await locRes.value.json();
        if (Array.isArray(remoteLocs) && remoteLocs.length > 0 && !this.syncedLiveOnce) {
          this.state.customLocations = remoteLocs.map((c: any) => ({
            ...c,
            createdAt: new Date(c.createdAt || Date.now()),
          }));
          this.state.nextCustomLocId = Math.max(...remoteLocs.map((c: any) => Number(c.id) || 0), 2) + 1;
          changed = true;
        }
      }

      if (homeRes.status === "fulfilled" && homeRes.value.ok && !this.syncedLiveOnce) {
        const remoteHomes = await homeRes.value.json();
        if (remoteHomes && typeof remoteHomes === "object") {
          if (remoteHomes.map?.locationId) this.state.mapHomeLocations.map = remoteHomes.map.locationId;
          if (remoteHomes["regional-sf"]?.locationId) {
            this.state.mapHomeLocations["regional-sf"] = remoteHomes["regional-sf"].locationId;
          }
          changed = true;
        }
      }

      if (vehRes.status === "fulfilled" && vehRes.value.ok) {
        const remoteVehicles = await vehRes.value.json();
        if (Array.isArray(remoteVehicles) && remoteVehicles.length > 0) {
          for (const rv of remoteVehicles) {
            const vid = String(rv.id || "");
            if (!vid) continue;
            const vName = rv.name || vid;
            const vColor = rv.color || "#3b82f6";

            const existing = this.state.vehicles.find((v) => v.vehicleId === vid);
            if (!existing) {
              this.state.vehicles.push({
                vehicleId: vid,
                name: vName,
                color: vColor,
                homeLocationId: null,
                createdAt: new Date(),
              });
            } else {
              if (rv.name) existing.name = rv.name;
              if (rv.color) existing.color = rv.color;
            }

            if (rv.location && typeof rv.location.lat === "number" && typeof rv.location.lon === "number") {
              const fixTs = new Date(rv.timestamp || Date.now());
              // Ensure synthetic startup seed rows with newer local clock timestamps don't shadow real parked fixes
              this.state.locations = this.state.locations.filter(
                (l) => l.vehicleId !== vid || l.timestamp.getTime() <= fixTs.getTime(),
              );
              this.state.locations.push({
                id: this.state.nextLocId++,
                vehicleId: vid,
                latitude: rv.location.lat,
                longitude: rv.location.lon,
                speed: Number(rv.speed || 0),
                heading: Number(rv.heading || 0),
                status: rv.status || "stopped",
                timestamp: fixTs,
                receivedAt: new Date(),
              });
              syncedVehicles.push({
                id: vid,
                name: vName,
                color: vColor,
                location: { lat: rv.location.lat, lon: rv.location.lon },
                speed: Number(rv.speed || 0),
                heading: Number(rv.heading || 0),
                status: rv.status || "stopped",
                timestamp: fixTs.toISOString(),
              });
            }
          }
          // Also pull today's GPS breadcrumb history for candidate Hot Shot vans/cars so local route-matching works identically to Postgres
          const regularSemiNames = new Set(["T01", "T02", "T22", "T03", "T04", "T05"]);
          const candidateVehIds = syncedVehicles
            .filter((sv) => !regularSemiNames.has(sv.name.trim().toUpperCase()))
            .map((sv) => sv.id);

          if (candidateVehIds.length > 0) {
            const existingSig = new Set(
              this.state.locations.map((l) => `${l.vehicleId}|${l.timestamp.getTime()}`),
            );
            const histCutoffMs = Date.now() - 20 * 3600_000;
            const histResponses = await Promise.allSettled(
              candidateVehIds.map((vid) =>
                fetch(
                  `https://srv1205734.hstgr.cloud/api/vehicles/${encodeURIComponent(vid)}/history?limit=320`,
                  { signal: AbortSignal.timeout(5000) },
                ).then((r) => (r.ok ? r.json() : [])),
              ),
            );
            for (let i = 0; i < histResponses.length; i++) {
              const hr = histResponses[i];
              if (hr.status !== "fulfilled" || !Array.isArray(hr.value)) continue;
              const vid = candidateVehIds[i];
              for (const pt of hr.value) {
                const lat = Number(pt?.location?.lat);
                const lon = Number(pt?.location?.lon);
                const ts = new Date(pt?.timestamp || 0);
                const ms = ts.getTime();
                if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(ms)) continue;
                if (ms < histCutoffMs) continue;
                const sig = `${vid}|${ms}`;
                if (existingSig.has(sig)) continue;
                existingSig.add(sig);
                this.state.locations.push({
                  id: this.state.nextLocId++,
                  vehicleId: vid,
                  latitude: lat,
                  longitude: lon,
                  speed: Number(pt.speed || 0),
                  heading: Number(pt.heading || 0),
                  status: pt.status || "stopped",
                  timestamp: ts,
                  receivedAt: new Date(),
                });
              }
            }
          }

          // Trim history in local dev cache while preserving full day breadcrumb trails
          if (this.state.locations.length > 6000) {
            this.state.locations.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
            this.state.locations = this.state.locations.slice(-4500);
          }
          changed = true;
        }
      }

      if (changed) {
        this.syncedLiveOnce = true;
        this.save();
      }
      return {
        synced: syncedVehicles.length > 0 || changed,
        vehicleCount: syncedVehicles.length,
        vehicles: syncedVehicles,
      };
    } catch {
      return { synced: false, vehicleCount: 0, vehicles: [] };
    }
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.state.users.find((u) => u.id === id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const normalized = username.trim().toLowerCase();
    return this.state.users.find((u) => u.username.trim().toLowerCase() === normalized);
  }

  async getAllUsers(): Promise<User[]> {
    return [...this.state.users];
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const user: User = {
      id: crypto.randomUUID(),
      username: insertUser.username.trim(),
      password: insertUser.password,
      role: insertUser.role || "admin",
      displayName: insertUser.displayName ?? null,
      createdAt: new Date(),
    };
    this.state.users.push(user);
    this.save();
    return user;
  }

  async updateUser(
    id: string,
    updates: Partial<Pick<User, "username" | "password" | "role" | "displayName">>,
  ): Promise<User | undefined> {
    const idx = this.state.users.findIndex((u) => u.id === id);
    if (idx < 0) return undefined;
    this.state.users[idx] = {
      ...this.state.users[idx],
      ...updates,
    };
    this.save();
    return this.state.users[idx];
  }

  async deleteUser(id: string): Promise<void> {
    this.state.users = this.state.users.filter((u) => u.id !== id);
    this.save();
  }

  async upsertVehicle(vehicle: InsertVehicle): Promise<Vehicle> {
    const idx = this.state.vehicles.findIndex((v) => v.vehicleId === vehicle.vehicleId);
    if (idx >= 0) {
      this.state.vehicles[idx] = {
        ...this.state.vehicles[idx],
        name: vehicle.name,
        color: vehicle.color ?? this.state.vehicles[idx].color,
        ...(vehicle.homeLocationId !== undefined ? { homeLocationId: vehicle.homeLocationId } : {}),
      };
      this.save();
      return this.state.vehicles[idx];
    }
    const created: Vehicle = {
      vehicleId: vehicle.vehicleId,
      name: vehicle.name,
      color: vehicle.color ?? "#3b82f6",
      homeLocationId: vehicle.homeLocationId ?? null,
      createdAt: new Date(),
    };
    this.state.vehicles.push(created);
    this.save();
    return created;
  }

  async getVehicle(vehicleId: string): Promise<Vehicle | undefined> {
    return this.state.vehicles.find((v) => v.vehicleId === vehicleId);
  }

  async getAllVehicles(): Promise<Vehicle[]> {
    return [...this.state.vehicles];
  }

  async deleteVehicle(vehicleId: string): Promise<void> {
    this.state.vehicles = this.state.vehicles.filter((v) => v.vehicleId !== vehicleId);
    this.state.locations = this.state.locations.filter((l) => l.vehicleId !== vehicleId);
    this.save();
  }

  async insertVehicleLocation(location: InsertVehicleLocation): Promise<VehicleLocation> {
    const inserted: VehicleLocation = {
      id: this.state.nextLocId++,
      vehicleId: location.vehicleId,
      latitude: location.latitude,
      longitude: location.longitude,
      speed: location.speed,
      heading: location.heading,
      status: location.status,
      timestamp: location.timestamp,
      receivedAt: new Date(),
    };
    this.state.locations.push(inserted);
    this.save();
    return inserted;
  }

  async getLatestVehicleLocation(vehicleId: string): Promise<VehicleLocation | undefined> {
    const matches = this.state.locations
      .filter((l) => l.vehicleId === vehicleId)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    return matches[0];
  }

  async getVehicleLocationHistory(vehicleId: string, limit: number = 100): Promise<VehicleLocation[]> {
    return this.state.locations
      .filter((l) => l.vehicleId === vehicleId)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  async getAllVehicleLatestLocations(): Promise<VehicleLocation[]> {
    const latestByVehicle = new Map<string, VehicleLocation>();
    for (const loc of this.state.locations) {
      const prev = latestByVehicle.get(loc.vehicleId);
      if (!prev || loc.timestamp.getTime() >= prev.timestamp.getTime()) {
        latestByVehicle.set(loc.vehicleId, loc);
      }
    }
    return Array.from(latestByVehicle.values());
  }

  async getAllVehicleLocations(filters?: { startDate?: Date; endDate?: Date; vehicleId?: string }): Promise<VehicleLocation[]> {
    return this.state.locations
      .filter((l) => {
        if (filters?.vehicleId && l.vehicleId !== filters.vehicleId) return false;
        if (filters?.startDate && l.timestamp < filters.startDate) return false;
        if (filters?.endDate && l.timestamp > filters.endDate) return false;
        return true;
      })
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  async createCustomLocation(location: InsertCustomLocation): Promise<CustomLocation> {
    const created: CustomLocation = {
      id: this.state.nextCustomLocId++,
      name: location.name,
      latitude: location.latitude,
      longitude: location.longitude,
      icon: location.icon ?? "marker",
      color: location.color ?? "#ef4444",
      description: location.description ?? null,
      createdAt: new Date(),
    };
    this.state.customLocations.push(created);
    this.save();
    return created;
  }

  async updateCustomLocation(id: number, location: Partial<InsertCustomLocation>): Promise<CustomLocation | undefined> {
    const idx = this.state.customLocations.findIndex((c) => c.id === id);
    if (idx < 0) return undefined;
    this.state.customLocations[idx] = {
      ...this.state.customLocations[idx],
      ...location,
    };
    this.save();
    return this.state.customLocations[idx];
  }

  async deleteCustomLocation(id: number): Promise<void> {
    this.state.customLocations = this.state.customLocations.filter((c) => c.id !== id);
    this.save();
  }

  async getAllCustomLocations(): Promise<CustomLocation[]> {
    return [...this.state.customLocations];
  }

  async getMapHomeLocations(): Promise<Array<{
    mapKey: string;
    locationId: number;
    location: CustomLocation;
  }>> {
    const out: Array<{ mapKey: string; locationId: number; location: CustomLocation }> = [];
    for (const [mapKey, locId] of Object.entries(this.state.mapHomeLocations)) {
      const loc = this.state.customLocations.find((c) => c.id === locId);
      if (loc) {
        out.push({ mapKey, locationId: locId, location: loc });
      }
    }
    return out;
  }

  async setMapHomeLocation(mapKey: string, locationId: number): Promise<{
    mapKey: string;
    locationId: number;
    location: CustomLocation;
  }> {
    const loc = this.state.customLocations.find((c) => c.id === locationId);
    if (!loc) throw new Error("Custom location not found");
    this.state.mapHomeLocations[mapKey] = locationId;
    this.save();
    return { mapKey, locationId, location: loc };
  }

  async clearMapHomeLocation(mapKey: string): Promise<void> {
    delete this.state.mapHomeLocations[mapKey];
    this.save();
  }
}

export const storage: IStorage = hasDatabase
  ? new DatabaseStorage()
  : new LocalFallbackStorage();
