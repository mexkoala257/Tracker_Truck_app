import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const { Pool } = pg;

function loadEnvIfNeeded() {
  const candidates = [
    path.resolve(process.cwd(), ".env"),
    "/var/www/Tracker_Truck_app/.env",
    "/var/www/gps-tracker/.env",
  ];

  for (const envPath of candidates) {
    try {
      if (!fs.existsSync(envPath)) continue;
      const content = fs.readFileSync(envPath, "utf8");
      for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        const eqIdx = line.indexOf("=");
        if (eqIdx <= 0) continue;
        const key = line.slice(0, eqIdx).trim();
        let val = line.slice(eqIdx + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (key && process.env[key] === undefined) {
          process.env[key] = val;
        }
      }
    } catch {}
  }

  if (!process.env.DATABASE_URL && fs.existsSync("/root/.pm2/dump.pm2")) {
    try {
      const dumpRaw = fs.readFileSync("/root/.pm2/dump.pm2", "utf8");
      const m = dumpRaw.match(/"DATABASE_URL"\s*:\s*"([^"]+)"/);
      if (m && m[1]) {
        process.env.DATABASE_URL = m[1];
      }
    } catch {}
  }
}

loadEnvIfNeeded();

if (!process.env.DATABASE_URL) {
  console.warn("[db:ensure] DATABASE_URL not found in environment or .env — skipping PostgreSQL schema check.");
  process.exit(0);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
  // Apply only the additions required by the current application. This avoids
  // Drizzle trying to reconcile unrelated legacy primary-key differences.
  await pool.query(`
    ALTER TABLE "vehicles"
    ADD COLUMN IF NOT EXISTS "home_location_id" integer
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "map_home_locations" (
      "map_key" text PRIMARY KEY NOT NULL,
      "location_id" integer NOT NULL,
      "updated_at" timestamp DEFAULT now() NOT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "users" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "username" text NOT NULL UNIQUE,
      "password" text NOT NULL,
      "role" text NOT NULL DEFAULT 'admin',
      "display_name" text,
      "created_at" timestamp DEFAULT now() NOT NULL
    )
  `);

  await pool.query(`
    ALTER TABLE "users"
    ADD COLUMN IF NOT EXISTS "role" text NOT NULL DEFAULT 'admin'
  `);

  await pool.query(`
    ALTER TABLE "users"
    ADD COLUMN IF NOT EXISTS "display_name" text
  `);

  await pool.query(`
    ALTER TABLE "users"
    ADD COLUMN IF NOT EXISTS "created_at" timestamp DEFAULT now() NOT NULL
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "session" (
      "sid" varchar NOT NULL COLLATE "default",
      "sess" json NOT NULL,
      "expire" timestamp(6) NOT NULL,
      CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire")
  `);

  await pool.query(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_vehicle_locations_vid_ts"
    ON "vehicle_locations" ("vehicle_id", "timestamp" DESC)
  `);

  await pool.query(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_vehicle_locations_ts"
    ON "vehicle_locations" ("timestamp" DESC)
  `);

  await pool.query(`ANALYZE "vehicle_locations"`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "display_store" (
      "key" text PRIMARY KEY NOT NULL,
      "value" jsonb NOT NULL,
      "updated_at" timestamp DEFAULT now() NOT NULL
    )
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'vehicles'::regclass
          AND confrelid = 'custom_locations'::regclass
          AND contype = 'f'
      ) THEN
        ALTER TABLE "vehicles"
        ADD CONSTRAINT "vehicles_home_location_id_custom_locations_id_fk"
        FOREIGN KEY ("home_location_id")
        REFERENCES "custom_locations"("id")
        ON DELETE SET NULL;
      END IF;
    END
    $$;
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'map_home_locations'::regclass
          AND confrelid = 'custom_locations'::regclass
          AND contype = 'f'
      ) THEN
        ALTER TABLE "map_home_locations"
        ADD CONSTRAINT "map_home_locations_location_id_custom_locations_id_fk"
        FOREIGN KEY ("location_id")
        REFERENCES "custom_locations"("id")
        ON DELETE CASCADE;
      END IF;
    END
    $$;
  `);

  console.log("Safe application schema update completed.");
} finally {
  await pool.end();
}
