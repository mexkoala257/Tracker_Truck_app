import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set before running the schema updater");
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