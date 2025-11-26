import { sql } from "drizzle-orm";
import { pgTable, text, varchar, serial, timestamp, real, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export const vehicleLocations = pgTable("vehicle_locations", {
  id: serial("id").primaryKey(),
  vehicleId: text("vehicle_id").notNull(),
  latitude: real("latitude").notNull(),
  longitude: real("longitude").notNull(),
  speed: integer("speed").notNull(),
  heading: integer("heading").notNull(),
  status: text("status").notNull(),
  timestamp: timestamp("timestamp").notNull(),
  receivedAt: timestamp("received_at").defaultNow().notNull(),
});

export const insertVehicleLocationSchema = createInsertSchema(vehicleLocations).omit({
  id: true,
  receivedAt: true,
});

export type InsertVehicleLocation = z.infer<typeof insertVehicleLocationSchema>;
export type VehicleLocation = typeof vehicleLocations.$inferSelect;
