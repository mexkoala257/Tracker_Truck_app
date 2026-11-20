import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage } from "node:http";
import type { Express, Request, Response, NextFunction, RequestHandler } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import createMemoryStore from "memorystore";
import { db, hasDatabase, pool } from "../db";
import { displayStore, type User } from "@shared/schema";
import { eq } from "drizzle-orm";
import { storage } from "./storage";
import { getDisplayState } from "./displayService";
import { log } from "./app";

declare module "express-session" {
  interface SessionData {
    userId?: string;
  }
}

export type UserRole = "admin" | "staff" | "viewer";
export type AuthScope = "admin" | "staff" | "viewer" | "kiosk" | "embed";

export function normalizeUserRole(raw?: string | null): UserRole {
  if (raw === "viewer") return "viewer";
  if (raw === "staff") return "staff";
  return "admin";
}

export interface AuthPrincipal {
  scope: AuthScope;
  userId?: string;
  username?: string;
  displayName?: string | null;
  displayId?: string;
}

declare global {
  namespace Express {
    interface Request {
      principal?: AuthPrincipal | null;
    }
  }
}

const AUTH_SECRETS_FILE = path.resolve(process.cwd(), "data", "auth-secrets.json");
const BOOTSTRAP_CREDENTIALS_FILE = path.resolve(process.cwd(), "data", "bootstrap-admin.txt");
const AUTH_SECRETS_DB_KEY = "auth_secrets";
const KIOSK_COOKIE_NAME = "tv_kiosk_auth";

let cachedSessionSecret: string | null = null;
let activeSessionMiddleware: RequestHandler | null = null;

// ---------------------------------------------------------------------------
// Timing-safe & Password Utilities
// ---------------------------------------------------------------------------
export function timingSafeEqualString(a: string, b: string): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export async function hashPassword(plain: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(plain, salt, 64, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
  return `scrypt:${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  try {
    if (!stored.startsWith("scrypt:")) return false;
    const parts = stored.split(":");
    if (parts.length !== 3) return false;
    const [, salt, expectedHex] = parts;
    const derived = await new Promise<Buffer>((resolve, reject) => {
      crypto.scrypt(plain, salt, 64, (err, key) => {
        if (err) reject(err);
        else resolve(key);
      });
    });
    const expectedBuf = Buffer.from(expectedHex, "hex");
    if (derived.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(derived, expectedBuf);
  } catch {
    return false;
  }
}

export function sanitizeUser(user: User) {
  return {
    id: user.id,
    username: user.username,
    role: normalizeUserRole(user.role),
    displayName: user.displayName || user.username,
    createdAt: user.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Session Secret Management
// ---------------------------------------------------------------------------
export async function getSessionSecret(): Promise<string> {
  if (cachedSessionSecret) return cachedSessionSecret;

  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.trim().length >= 16) {
    cachedSessionSecret = process.env.SESSION_SECRET.trim();
    return cachedSessionSecret;
  }

  if (hasDatabase && db) {
    try {
      const [row] = await db
        .select()
        .from(displayStore)
        .where(eq(displayStore.key, AUTH_SECRETS_DB_KEY));
      const val = row?.value as { sessionSecret?: string } | undefined;
      if (val?.sessionSecret && val.sessionSecret.length >= 32) {
        cachedSessionSecret = val.sessionSecret;
        return cachedSessionSecret;
      }
    } catch {}
  }

  try {
    if (fs.existsSync(AUTH_SECRETS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(AUTH_SECRETS_FILE, "utf8"));
      if (parsed?.sessionSecret && parsed.sessionSecret.length >= 32) {
        cachedSessionSecret = parsed.sessionSecret;
        return cachedSessionSecret!;
      }
    }
  } catch {}

  cachedSessionSecret = crypto.randomBytes(48).toString("hex");

  try {
    fs.mkdirSync(path.dirname(AUTH_SECRETS_FILE), { recursive: true });
    fs.writeFileSync(
      AUTH_SECRETS_FILE,
      JSON.stringify({ sessionSecret: cachedSessionSecret }, null, 2),
      "utf8",
    );
  } catch {}

  if (hasDatabase && db) {
    try {
      await db
        .insert(displayStore)
        .values({
          key: AUTH_SECRETS_DB_KEY,
          value: { sessionSecret: cachedSessionSecret },
          updatedAt: new Date(),
        })
        .onConflictDoNothing();
    } catch {}
  }

  return cachedSessionSecret;
}

// ---------------------------------------------------------------------------
// Signed Kiosk Device Cookie (bound to unit's current deviceToken)
// ---------------------------------------------------------------------------
function hashDisplayToken(deviceToken: string): string {
  return crypto.createHash("sha256").update(deviceToken).digest("hex").slice(0, 24);
}

function parseCookies(cookieHeader?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const pair of cookieHeader.split(";")) {
    const idx = pair.indexOf("=");
    if (idx < 0) continue;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

export async function createSignedKioskCookieValue(
  displayId: string,
  deviceToken: string,
): Promise<string> {
  const secret = await getSessionSecret();
  const payload = `${displayId}.${hashDisplayToken(deviceToken)}.${Date.now()}`;
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${Buffer.from(payload, "utf8").toString("base64url")}.${sig}`;
}

export async function setKioskAuthCookie(
  req: Request,
  res: Response,
  displayId: string,
  deviceToken: string,
): Promise<void> {
  const value = await createSignedKioskCookieValue(displayId, deviceToken);
  const isSecure =
    req.secure ||
    (req.headers["x-forwarded-proto"] as string)?.split(",")[0]?.trim() === "https";
  res.cookie(KIOSK_COOKIE_NAME, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecure,
    maxAge: 365 * 24 * 60 * 60 * 1000, // 1 year for unattended Raspberry Pi kiosks
    path: "/",
  });
}

export function clearKioskAuthCookie(res: Response): void {
  res.clearCookie(KIOSK_COOKIE_NAME, { path: "/" });
}

async function verifySignedKioskCookie(cookieVal?: string): Promise<string | null> {
  if (!cookieVal) return null;
  const dotIdx = cookieVal.indexOf(".");
  if (dotIdx <= 0) return null;
  const encodedPayload = cookieVal.slice(0, dotIdx);
  const providedSig = cookieVal.slice(dotIdx + 1);

  try {
    const secret = await getSessionSecret();
    const payload = Buffer.from(encodedPayload, "base64url").toString("utf8");
    const expectedSig = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
    if (!timingSafeEqualString(providedSig, expectedSig)) return null;

    const [displayId, tokenHash] = payload.split(".");
    if (!displayId || !tokenHash) return null;

    const state = await getDisplayState();
    const unit = state.settings.displayProfiles[displayId];
    if (!unit || !unit.deviceToken) return null;

    const currentHash = hashDisplayToken(unit.deviceToken);
    if (!timingSafeEqualString(tokenHash, currentHash)) {
      return null; // Token was rotated — immediately invalidate cookie!
    }
    return displayId;
  } catch {
    return null;
  }
}

async function verifyRawDisplayToken(
  rawToken?: string | null,
  hintDisplayId?: string | null,
): Promise<{ displayId: string; deviceToken: string } | null> {
  if (!rawToken || typeof rawToken !== "string" || rawToken.trim().length < 12) return null;
  const trimmed = rawToken.trim();
  const state = await getDisplayState();
  const profiles = state.settings.displayProfiles || {};

  if (hintDisplayId && profiles[hintDisplayId]) {
    const p = profiles[hintDisplayId];
    if (timingSafeEqualString(trimmed, p.deviceToken)) {
      return { displayId: p.id, deviceToken: p.deviceToken };
    }
  }

  for (const prof of Object.values(profiles)) {
    if (prof.deviceToken && timingSafeEqualString(trimmed, prof.deviceToken)) {
      return { displayId: prof.id, deviceToken: prof.deviceToken };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Principal Resolution (HTTP & WebSocket)
// ---------------------------------------------------------------------------
export async function resolveRequestPrincipal(req: Request): Promise<AuthPrincipal | null> {
  if (req.principal !== undefined) return req.principal;

  // 1. Check authenticated staff session (Admin / Staff / Viewer)
  const sessionUserId = req.session?.userId;
  if (sessionUserId) {
    const user = await storage.getUser(sessionUserId);
    if (user) {
      req.principal = {
        scope: normalizeUserRole(user.role),
        userId: user.id,
        username: user.username,
        displayName: user.displayName || user.username,
      };
      return req.principal;
    }
  }

  // 2. Check Kiosk token in header or query string
  const headerOrQueryToken =
    (req.headers["x-display-token"] as string | undefined) ||
    (typeof req.query?.token === "string" ? req.query.token : undefined);
  const hintDisplayId =
    (req.headers["x-display-id"] as string | undefined) ||
    (typeof req.query?.display === "string" ? req.query.display : undefined) ||
    (typeof req.body?.displayId === "string" ? req.body.displayId : undefined);

  if (headerOrQueryToken) {
    const matched = await verifyRawDisplayToken(headerOrQueryToken, hintDisplayId);
    if (matched) {
      req.principal = { scope: "kiosk", displayId: matched.displayId };
      return req.principal;
    }
  }

  // 3. Check signed Kiosk cookie
  const cookies = parseCookies(req.headers.cookie);
  const cookieDisplayId = await verifySignedKioskCookie(cookies[KIOSK_COOKIE_NAME]);
  if (cookieDisplayId) {
    req.principal = { scope: "kiosk", displayId: cookieDisplayId };
    return req.principal;
  }

  // 4. Check Phased Rollout Embed Token (when enabled in Admin)
  const embedCandidate =
    (req.headers["x-embed-token"] as string | undefined) ||
    (typeof req.query?.embed_token === "string" ? req.query.embed_token : undefined);
  if (embedCandidate) {
    const state = await getDisplayState();
    if (
      state.settings.embedEnabled &&
      state.settings.embedToken &&
      timingSafeEqualString(embedCandidate.trim(), state.settings.embedToken)
    ) {
      req.principal = { scope: "embed" };
      return req.principal;
    }
  }

  req.principal = null;
  return null;
}

export async function resolveUpgradePrincipal(req: IncomingMessage): Promise<AuthPrincipal | null> {
  // Parse session via activeSessionMiddleware if available
  if (activeSessionMiddleware) {
    await new Promise<void>((resolve) => {
      const dummyRes = {
        getHeader: () => undefined,
        setHeader: () => dummyRes,
        writeHead: () => dummyRes,
        end: () => undefined,
      } as unknown as Response;
      activeSessionMiddleware!(req as unknown as Request, dummyRes, () => resolve());
    });
  }

  const sessionUserId = (req as any).session?.userId as string | undefined;
  if (sessionUserId) {
    const user = await storage.getUser(sessionUserId);
    if (user) {
      return {
        scope: normalizeUserRole(user.role),
        userId: user.id,
        username: user.username,
        displayName: user.displayName || user.username,
      };
    }
  }

  const parsedUrl = new URL(req.url || "/ws", "http://localhost");
  const queryToken = parsedUrl.searchParams.get("token");
  const queryDisplay = parsedUrl.searchParams.get("display");
  if (queryToken) {
    const matched = await verifyRawDisplayToken(queryToken, queryDisplay);
    if (matched) {
      return { scope: "kiosk", displayId: matched.displayId };
    }
  }

  const cookies = parseCookies(req.headers.cookie);
  const cookieDisplayId = await verifySignedKioskCookie(cookies[KIOSK_COOKIE_NAME]);
  if (cookieDisplayId) {
    return { scope: "kiosk", displayId: cookieDisplayId };
  }

  const queryEmbed = parsedUrl.searchParams.get("embed_token");
  if (queryEmbed) {
    const state = await getDisplayState();
    if (
      state.settings.embedEnabled &&
      state.settings.embedToken &&
      timingSafeEqualString(queryEmbed.trim(), state.settings.embedToken)
    ) {
      return { scope: "embed" };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Express Middleware & Route Guards
// ---------------------------------------------------------------------------
export async function setupAuthMiddleware(app: Express): Promise<void> {
  app.set("trust proxy", 1);

  const secret = await getSessionSecret();
  let store: session.Store;

  if (hasDatabase && pool) {
    const PgStore = connectPgSimple(session);
    store = new PgStore({
      pool,
      tableName: "session",
      createTableIfMissing: true,
    });
  } else {
    const MemoryStore = createMemoryStore(session);
    store = new MemoryStore({
      checkPeriod: 24 * 60 * 60 * 1000,
    });
  }

  activeSessionMiddleware = session({
    name: "fleet_sid",
    secret,
    store,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: "auto",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  });

  app.use(activeSessionMiddleware);

  // Security headers + Dynamic iframe CSP for phased DAKboard rollout
  app.use(async (req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    // Sends bare origin only (never URL paths or query tokens) to cross-origin tile servers
    // like tile.openstreetmap.org, which block requests missing a Referer header (OSMF policy).
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

    const p = req.path;
    const isEmbedCandidateRoute = p === "/map" || p === "/regional-sf";

    if (isEmbedCandidateRoute) {
      try {
        const state = await getDisplayState();
        if (state.settings.embedEnabled) {
          res.setHeader(
            "Content-Security-Policy",
            "frame-ancestors 'self' https://dakboard.com https://*.dakboard.com",
          );
          return next();
        }
      } catch {}
    }

    if (p.startsWith("/admin") || p.startsWith("/login")) {
      res.setHeader("X-Frame-Options", "DENY");
      res.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
    } else {
      res.setHeader("X-Frame-Options", "SAMEORIGIN");
      res.setHeader("Content-Security-Policy", "frame-ancestors 'self'");
    }
    next();
  });
}

export const requireAdmin: RequestHandler = async (req, res, next) => {
  const principal = await resolveRequestPrincipal(req);
  if (!principal) {
    return res.status(401).json({ error: "Authentication required" });
  }
  if (principal.scope !== "admin") {
    return res.status(403).json({ error: "Technical Admin privileges required" });
  }
  next();
};

export const requireEditor: RequestHandler = async (req, res, next) => {
  const principal = await resolveRequestPrincipal(req);
  if (!principal) {
    return res.status(401).json({ error: "Authentication required" });
  }
  if (principal.scope !== "admin" && principal.scope !== "staff") {
    return res.status(403).json({ error: "Staff or Admin privileges required" });
  }
  next();
};

export const requireStaff: RequestHandler = async (req, res, next) => {
  const principal = await resolveRequestPrincipal(req);
  if (!principal) {
    return res.status(401).json({ error: "Authentication required" });
  }
  if (
    principal.scope !== "admin" &&
    principal.scope !== "staff" &&
    principal.scope !== "viewer"
  ) {
    return res.status(403).json({ error: "Staff login required" });
  }
  next();
};

export const requireDisplayRead: RequestHandler = async (req, res, next) => {
  const principal = await resolveRequestPrincipal(req);
  if (!principal) {
    return res.status(401).json({ error: "Authentication required" });
  }
  if (
    principal.scope !== "admin" &&
    principal.scope !== "staff" &&
    principal.scope !== "viewer" &&
    principal.scope !== "kiosk"
  ) {
    return res.status(403).json({ error: "Display access denied" });
  }
  next();
};

export const requireMapRead: RequestHandler = async (req, res, next) => {
  const principal = await resolveRequestPrincipal(req);
  if (!principal) {
    return res.status(401).json({ error: "Authentication required" });
  }
  next();
};

export function requireKioskForDisplayOrAdmin(
  getTargetDisplayId: (req: Request) => string | undefined,
): RequestHandler {
  return async (req, res, next) => {
    const principal = await resolveRequestPrincipal(req);
    if (!principal) {
      return res.status(401).json({ ok: false, error: "Authentication required" });
    }
    if (
      principal.scope === "admin" ||
      principal.scope === "staff" ||
      principal.scope === "viewer"
    ) {
      return next();
    }
    const targetId = getTargetDisplayId(req);
    if (principal.scope === "kiosk" && targetId && principal.displayId === targetId) {
      return next();
    }
    return res.status(403).json({ ok: false, error: "Display token mismatch or forbidden" });
  };
}

// ---------------------------------------------------------------------------
// Login Brute-Force Rate Limiting
// ---------------------------------------------------------------------------
interface AttemptBucket {
  count: number;
  resetAt: number;
}
const loginAttemptsByIp = new Map<string, AttemptBucket>();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;

export function checkLoginRateLimit(ip: string): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const entry = loginAttemptsByIp.get(ip);
  if (!entry || now >= entry.resetAt) {
    return { allowed: true, retryAfterSec: 0 };
  }
  if (entry.count >= LOGIN_MAX_ATTEMPTS) {
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
    };
  }
  return { allowed: true, retryAfterSec: 0 };
}

export function recordFailedLogin(ip: string): void {
  const now = Date.now();
  const entry = loginAttemptsByIp.get(ip);
  if (!entry || now >= entry.resetAt) {
    loginAttemptsByIp.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
  } else {
    entry.count += 1;
  }
}

export function clearFailedLogins(ip: string): void {
  loginAttemptsByIp.delete(ip);
}

// ---------------------------------------------------------------------------
// Bootstrap First Admin Account
// ---------------------------------------------------------------------------
export async function ensureBootstrapAdmin(): Promise<void> {
  const existingUsers = await storage.getAllUsers();
  if (existingUsers.length > 0) return;

  const username = (process.env.ADMIN_USERNAME || "admin").trim();
  const rawPassword =
    (process.env.ADMIN_PASSWORD || "").trim() ||
    `Fleet-${crypto.randomBytes(4).toString("hex")}`;

  const passwordHash = await hashPassword(rawPassword);
  await storage.createUser({
    username,
    password: passwordHash,
    role: "admin",
    displayName: "System Administrator",
  });

  if (!process.env.ADMIN_PASSWORD) {
    try {
      fs.mkdirSync(path.dirname(BOOTSTRAP_CREDENTIALS_FILE), { recursive: true });
      fs.writeFileSync(
        BOOTSTRAP_CREDENTIALS_FILE,
        `Initial Admin Login (change immediately in /admin -> Security & Users):\nUsername: ${username}\nPassword: ${rawPassword}\nGenerated: ${new Date().toISOString()}\n`,
        "utf8",
      );
    } catch {}
    log(
      `🔐 Bootstrapped initial admin user '${username}' (see data/bootstrap-admin.txt or set ADMIN_PASSWORD env var)`,
      "auth",
    );
  } else {
    log(`🔐 Bootstrapped initial admin user '${username}' from ADMIN_PASSWORD`, "auth");
  }
}

// ---------------------------------------------------------------------------
// 6-Digit On-Screen Raspberry Pi TV Pairing Manager
// ---------------------------------------------------------------------------
export interface TvPairingSession {
  pairId: string;
  code: string;
  requestedDisplayId: string;
  suggestedName: string;
  viewport: string;
  ipAddress: string;
  userAgent: string;
  createdAt: string;
  expiresAt: string;
  status: "pending" | "approved" | "rejected";
  assignedDisplayId?: string;
}

function inferSuggestedDisplayName(userAgent?: string, viewport?: string): string {
  const ua = (userAgent || "").toLowerCase();
  if (ua.includes("iphone")) return "iPhone Screen";
  if (ua.includes("ipad")) return "iPad Screen";
  if (ua.includes("android")) {
    const width = parseInt(String(viewport || "").split(/[x×]/i)[0] || "0", 10);
    return width > 0 && width < 650 ? "Android Phone" : "Android Display";
  }
  if (ua.includes("cros")) return "Chromebox TV";
  if (
    ua.includes("aarch64") ||
    ua.includes("armv") ||
    ua.includes("raspbian") ||
    (ua.includes("x11; linux") && !ua.includes("x86_64"))
  ) {
    return "Raspberry Pi TV";
  }
  if (ua.includes("x11; linux")) return "Linux Kiosk TV";
  return "TV Display";
}

const pairingSessionsByPairId = new Map<string, TvPairingSession>();
const PAIRING_TTL_MS = 15 * 60 * 1000;
const pairingRateByIp = new Map<string, AttemptBucket>();

function cleanupExpiredPairings() {
  const now = Date.now();
  for (const [id, sess] of Array.from(pairingSessionsByPairId.entries())) {
    if (new Date(sess.expiresAt).getTime() <= now) {
      pairingSessionsByPairId.delete(id);
    }
  }
}

export function createTvPairingRequest(opts: {
  requestedDisplayId?: string;
  viewport?: string;
  ipAddress: string;
  userAgent?: string;
}): { ok: boolean; error?: string; session?: TvPairingSession } {
  cleanupExpiredPairings();

  const now = Date.now();
  const rate = pairingRateByIp.get(opts.ipAddress);
  if (rate && now < rate.resetAt && rate.count >= 25) {
    return { ok: false, error: "Too many pairing requests from this IP. Please wait a few minutes." };
  }
  if (!rate || now >= rate.resetAt) {
    pairingRateByIp.set(opts.ipAddress, { count: 1, resetAt: now + 10 * 60 * 1000 });
  } else {
    rate.count += 1;
  }

  const activeCodes = new Set(Array.from(pairingSessionsByPairId.values()).map((s) => s.code));
  let code = "";
  do {
    code = String(crypto.randomInt(100000, 999999));
  } while (activeCodes.has(code));

  const pairId = crypto.randomBytes(24).toString("hex");
  const sessionObj: TvPairingSession = {
    pairId,
    code,
    requestedDisplayId: (opts.requestedDisplayId || "").trim().slice(0, 40),
    suggestedName: inferSuggestedDisplayName(opts.userAgent, opts.viewport),
    viewport: (opts.viewport || "unknown").slice(0, 32),
    ipAddress: opts.ipAddress,
    userAgent: (opts.userAgent || "").slice(0, 120),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + PAIRING_TTL_MS).toISOString(),
    status: "pending",
  };

  pairingSessionsByPairId.set(pairId, sessionObj);
  return { ok: true, session: sessionObj };
}

export function getTvPairingByPairId(pairId: string): TvPairingSession | null {
  cleanupExpiredPairings();
  return pairingSessionsByPairId.get(pairId) || null;
}

export function consumeApprovedPairing(pairId: string): TvPairingSession | null {
  const sess = pairingSessionsByPairId.get(pairId);
  if (!sess || sess.status !== "approved" || !sess.assignedDisplayId) return null;
  pairingSessionsByPairId.delete(pairId);
  return sess;
}

export function listPendingTvPairings() {
  cleanupExpiredPairings();
  return Array.from(pairingSessionsByPairId.values())
    .filter((s) => s.status === "pending")
    .map(({ pairId: _secret, ...publicFields }) => publicFields);
}

export function approveTvPairingByCode(code: string, targetDisplayId: string): TvPairingSession | null {
  cleanupExpiredPairings();
  const cleanCode = code.replace(/[^0-9]/g, "");
  for (const sess of Array.from(pairingSessionsByPairId.values())) {
    if (sess.status === "pending" && sess.code === cleanCode) {
      sess.status = "approved";
      sess.assignedDisplayId = targetDisplayId;
      return sess;
    }
  }
  return null;
}

export function rejectTvPairingByCode(code: string): boolean {
  cleanupExpiredPairings();
  const cleanCode = code.replace(/[^0-9]/g, "");
  for (const [id, sess] of Array.from(pairingSessionsByPairId.entries())) {
    if (sess.code === cleanCode) {
      sess.status = "rejected";
      pairingSessionsByPairId.delete(id);
      return true;
    }
  }
  return false;
}

export { verifyRawDisplayToken };
