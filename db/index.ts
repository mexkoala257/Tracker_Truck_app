import fs from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

function loadEnvFilesIfNeeded(): void {
  if (process.env.CLOSED_LOOP_DEMO === "1") return;

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
    } catch {
      // Ignore unreadable candidate paths
    }
  }

  // Fallback: check /root/.pm2/dump.pm2 if DATABASE_URL was only stored in PM2 env
  if (!process.env.DATABASE_URL && fs.existsSync("/root/.pm2/dump.pm2")) {
    try {
      const dumpRaw = fs.readFileSync("/root/.pm2/dump.pm2", "utf8");
      const m = dumpRaw.match(/"DATABASE_URL"\s*:\s*"([^"]+)"/);
      if (m && m[1]) {
        process.env.DATABASE_URL = m[1];
      }
      for (const envKey of ["MOTIVE_API_KEY", "MOTIVE_WEBHOOK_SECRET", "HOTSHOTSHEET_API_KEY", "SESSION_SECRET"]) {
        if (!process.env[envKey]) {
          const km = dumpRaw.match(new RegExp(`"${envKey}"\\s*:\\s*"([^"]+)"`));
          if (km && km[1]) process.env[envKey] = km[1];
        }
      }
    } catch {
      // Ignore PM2 dump parse issues
    }
  }
}

loadEnvFilesIfNeeded();

export const hasDatabase = Boolean(process.env.DATABASE_URL);

export const pool = hasDatabase
  ? new pg.Pool({ connectionString: process.env.DATABASE_URL })
  : null;

export const db = (pool ? drizzle(pool) : null) as ReturnType<typeof drizzle>;
