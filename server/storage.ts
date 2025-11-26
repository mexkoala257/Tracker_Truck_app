import { 
  type User, 
  type InsertUser, 
  type VehicleLocation, 
  type InsertVehicleLocation,
  users,
  vehicleLocations
} from "@shared/schema";
import { db } from "../db";
import { eq, desc } from "drizzle-orm";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  // Vehicle location methods
  insertVehicleLocation(location: InsertVehicleLocation): Promise<VehicleLocation>;
  getLatestVehicleLocation(vehicleId: string): Promise<VehicleLocation | undefined>;
  getVehicleLocationHistory(vehicleId: string, limit?: number): Promise<VehicleLocation[]>;
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
}

export const storage = new DatabaseStorage();
