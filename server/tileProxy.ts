import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { Request, Response } from "express";
import { log } from "./app";

const TILE_CACHE_DIR = path.resolve(process.cwd(), "data", "tile-cache");
const TILE_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days (OSMF recommends >= 7 days)
const FETCH_TIMEOUT_MS = 12 * 1000;
const MAX_CONCURRENT_UPSTREAM = 6;
const MAX_CACHE_BYTES = 500 * 1024 * 1024; // 500 MB hard cap
const PRUNE_TARGET_BYTES = 425 * 1024 * 1024; // Prune down to 85% watermark
const PRUNE_EVERY_WRITES = 250;

const UPSTREAM_USER_AGENT =
  process.env.TILE_PROXY_USER_AGENT ||
  "FleetTrackerDisplay/1.0 (+https://srv1205734.hstgr.cloud; internal-fleet-dispatch-cache)";

const inFlightTiles = new Map<string, Promise<Buffer>>();
let activeUpstreamCount = 0;
const waitQueue: Array<() => void> = [];

let writesSinceLastPrune = 0;
let pruningInProgress = false;
let lastKnownStats = {
  tileCount: 0,
  sizeBytes: 0,
  maxBytes: MAX_CACHE_BYTES,
};

function acquireUpstreamSlot(): Promise<void> {
  if (activeUpstreamCount < MAX_CONCURRENT_UPSTREAM) {
    activeUpstreamCount++;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    waitQueue.push(() => {
      activeUpstreamCount++;
      resolve();
    });
  });
}

function releaseUpstreamSlot(): void {
  activeUpstreamCount = Math.max(0, activeUpstreamCount - 1);
  const next = waitQueue.shift();
  if (next) next();
}

interface CachedFileEntry {
  fullPath: string;
  size: number;
  lastTouchMs: number;
}

async function scanTileDirectory(dir: string, out: CachedFileEntry[]): Promise<void> {
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await scanTileDirectory(fullPath, out);
    } else if (entry.isFile() && entry.name.endsWith(".png")) {
      try {
        const st = await fsp.stat(fullPath);
        out.push({
          fullPath,
          size: st.size,
          lastTouchMs: Math.max(st.atimeMs || 0, st.mtimeMs || 0),
        });
      } catch {
        // Ignore concurrently removed file
      }
    }
  }
}

export async function refreshAndPruneTileCache(): Promise<typeof lastKnownStats> {
  if (pruningInProgress) return lastKnownStats;
  pruningInProgress = true;
  try {
    await fsp.mkdir(TILE_CACHE_DIR, { recursive: true });
    const files: CachedFileEntry[] = [];
    await scanTileDirectory(TILE_CACHE_DIR, files);

    let totalBytes = files.reduce((sum, f) => sum + f.size, 0);
    let tileCount = files.length;

    if (totalBytes > MAX_CACHE_BYTES) {
      // Sort oldest-accessed first
      files.sort((a, b) => a.lastTouchMs - b.lastTouchMs);
      let prunedCount = 0;
      for (const file of files) {
        if (totalBytes <= PRUNE_TARGET_BYTES) break;
        try {
          await fsp.unlink(file.fullPath);
          totalBytes -= file.size;
          tileCount--;
          prunedCount++;
        } catch {
          // Ignore unlink race
        }
      }
      log(
        `Pruned ${prunedCount} old cached map tiles (cache now ${(totalBytes / (1024 * 1024)).toFixed(1)} MB)`,
        "tiles",
      );
    }

    lastKnownStats = {
      tileCount,
      sizeBytes: Math.max(0, totalBytes),
      maxBytes: MAX_CACHE_BYTES,
    };
  } catch (err: any) {
    log(`Tile cache scan warning: ${err.message}`, "tiles");
  } finally {
    pruningInProgress = false;
  }
  return lastKnownStats;
}

export function getTileCacheStats() {
  return lastKnownStats;
}

// Warm initial cache statistics in the background shortly after startup
setTimeout(() => {
  refreshAndPruneTileCache().catch(() => {});
}, 5000).unref?.();

async function fetchUpstreamTile(z: number, x: number, y: number, cacheFile: string): Promise<Buffer> {
  await acquireUpstreamSlot();
  try {
    const upstreamUrl = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
    const response = await fetch(upstreamUrl, {
      headers: {
        "User-Agent": UPSTREAM_USER_AGENT,
        Accept: "image/png,image/*;q=0.8",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Upstream tile HTTP ${response.status}`);
    }

    const arrayBuf = await response.arrayBuffer();
    const buf = Buffer.from(arrayBuf);
    if (buf.length === 0) {
      throw new Error("Empty upstream tile payload");
    }

    // Persist asynchronously via atomic rename so concurrent readers never see half-written files
    const dir = path.dirname(cacheFile);
    await fsp.mkdir(dir, { recursive: true });
    const tmpFile = `${cacheFile}.${process.pid}.${Date.now()}.tmp`;
    try {
      await fsp.writeFile(tmpFile, buf);
      await fsp.rename(tmpFile, cacheFile);
    } catch {
      await fsp.writeFile(cacheFile, buf).catch(() => {});
      await fsp.unlink(tmpFile).catch(() => {});
    }

    lastKnownStats.tileCount += 1;
    lastKnownStats.sizeBytes += buf.length;
    writesSinceLastPrune++;
    if (writesSinceLastPrune >= PRUNE_EVERY_WRITES || lastKnownStats.sizeBytes > MAX_CACHE_BYTES) {
      writesSinceLastPrune = 0;
      refreshAndPruneTileCache().catch(() => {});
    }

    return buf;
  } finally {
    releaseUpstreamSlot();
  }
}

export async function handleTileProxyRequest(req: Request, res: Response): Promise<void> {
  const zRaw = req.params.z;
  const xRaw = req.params.x;
  const yPngRaw = req.params.yPng;

  if (!/^\d+$/.test(zRaw) || !/^\d+$/.test(xRaw) || !/^\d+\.png$/.test(yPngRaw)) {
    res.status(400).send("Invalid tile path");
    return;
  }

  const z = Number(zRaw);
  const x = Number(xRaw);
  const y = Number(yPngRaw.slice(0, -4));
  const maxIndex = 1 << z; // Safe bitwise up to z=19 (2^19 = 524,288)

  if (z < 0 || z > 19 || x < 0 || x >= maxIndex || y < 0 || y >= maxIndex) {
    res.status(400).send("Tile coordinates out of range");
    return;
  }

  const cacheFile = path.join(TILE_CACHE_DIR, String(z), String(x), `${y}.png`);
  let staleBuffer: Buffer | null = null;

  try {
    const st = await fsp.stat(cacheFile);
    const now = Date.now();
    const ageMs = now - st.mtimeMs;
    if (ageMs < TILE_TTL_MS && st.size > 0) {
      const buf = await fsp.readFile(cacheFile);
      // Lightly bump access timestamp at most once per hour for accurate LRU pruning
      if (now - (st.atimeMs || 0) > 60 * 60 * 1000) {
        const nowDate = new Date(now);
        fsp.utimes(cacheFile, nowDate, st.mtime).catch(() => {});
      }
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "private, max-age=86400, stale-while-revalidate=604800");
      res.setHeader("X-Tile-Cache", "HIT");
      res.send(buf);
      return;
    }
    if (st.size > 0) {
      staleBuffer = await fsp.readFile(cacheFile).catch(() => null);
    }
  } catch {
    // Cache miss — proceed to upstream fetch
  }

  const key = `${z}/${x}/${y}`;
  let inflight = inFlightTiles.get(key);
  if (!inflight) {
    inflight = fetchUpstreamTile(z, x, y, cacheFile).finally(() => {
      inFlightTiles.delete(key);
    });
    inFlightTiles.set(key, inflight);
  }

  try {
    const buf = await inflight;
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "private, max-age=86400, stale-while-revalidate=604800");
    res.setHeader("X-Tile-Cache", "MISS");
    res.send(buf);
  } catch (err: any) {
    if (staleBuffer) {
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.setHeader("X-Tile-Cache", "STALE");
      res.send(staleBuffer);
      return;
    }
    log(`Tile proxy error (${key}): ${err.message}`, "tiles");
    res.status(502).send("Tile temporarily unavailable");
  }
}
