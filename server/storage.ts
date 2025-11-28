import { 
  type User, 
  type InsertUser, 
  type Vehicle,
  type InsertVehicle,
  type VehicleLocation, 
  type InsertVehicleLocation,
  users,
  vehicles,
  vehicleLocations
} from "@shared/schema";
import { db } from "../db";
import { eq, desc, gte, lte, and, sql } from "drizzle-orm";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  // Vehicle metadata methods
  upsertVehicle(vehicle: InsertVehicle): Promise<Vehicle>;
  getVehicle(vehicleId: string): Promise<Vehicle | undefined>;
  getAllVehicles(): Promise<Vehicle[]>;
  
  // Vehicle location methods
  insertVehicleLocation(location: InsertVehicleLocation): Promise<VehicleLocation>;
  getLatestVehicleLocation(vehicleId: string): Promise<VehicleLocation | undefined>;
  getVehicleLocationHistory(vehicleId: string, limit?: number): Promise<VehicleLocation[]>;
  getAllVehicleLatestLocations(): Promise<VehicleLocation[]>;
  getAllVehicleLocations(filters?: { startDate?: Date; endDate?: Date; vehicleId?: string }): Promise<VehicleLocation[]>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async upsertVehicle(vehicle: InsertVehicle): Promise<Vehicle> {
    const [result] = await db
      .insert(vehicles)
      .values(vehicle)
      .onConflictDoUpdate({
        target: vehicles.vehicleId,
        set: { name: vehicle.name, color: vehicle.color },
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
    // Use PostgreSQL DISTINCT ON to efficiently get latest location per vehicle
    // This is much more efficient than fetching all records and filtering in memory
    const result = await db.execute(sql`
      SELECT DISTINCT ON (vehicle_id) *
      FROM vehicle_locations
      ORDER BY vehicle_id, timestamp DESC
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
}

export const storage = new DatabaseStorage();
