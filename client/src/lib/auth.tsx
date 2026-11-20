import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

export type UserRole = "admin" | "staff" | "viewer";
export type AuthScope = "admin" | "staff" | "viewer" | "kiosk" | "embed" | null;

export interface AuthUser {
  id: string;
  username: string;
  role: UserRole;
  displayName: string;
}

export interface AuthMeResponse {
  authenticated: boolean;
  scope: AuthScope;
  user?: AuthUser;
  displayId?: string;
}

interface AuthContextValue {
  loading: boolean;
  authenticated: boolean;
  scope: AuthScope;
  user: AuthUser | null;
  displayId: string | null;
  refreshAuth: () => Promise<AuthMeResponse>;
  login: (username: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
}

const EMBED_STORAGE_KEY = "fleet_embed_token";
const DISPLAY_TOKEN_STORAGE_KEY = "fleet_display_token";
const DISPLAY_ID_STORAGE_KEY = "fleet_display_id";

let activeEmbedToken: string | null = null;
let activeDisplayToken: string | null = null;
let activeDisplayId: string | null = null;
let initialExchangePromise: Promise<void> | null = null;
let fetchPatched = false;

function readSessionValue(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSessionValue(key: string, value: string | null) {
  try {
    if (value) {
      sessionStorage.setItem(key, value);
    } else {
      sessionStorage.removeItem(key);
    }
  } catch {
    // Ignore storage errors in restricted kiosk/iframe contexts
  }
}

function bootstrapUrlTokensAndFetchInterceptor() {
  if (typeof window === "undefined" || fetchPatched) return;
  fetchPatched = true;

  activeEmbedToken = readSessionValue(EMBED_STORAGE_KEY);
  activeDisplayToken = readSessionValue(DISPLAY_TOKEN_STORAGE_KEY);
  activeDisplayId = readSessionValue(DISPLAY_ID_STORAGE_KEY);

  const rawFetch = window.fetch.bind(window);

  try {
    const url = new URL(window.location.href);
    const urlEmbed = url.searchParams.get("embed_token");
    const urlDisplayToken = url.searchParams.get("token");
    const urlDisplayId = url.searchParams.get("display");
    let urlChanged = false;

    if (urlEmbed) {
      activeEmbedToken = urlEmbed.trim();
      writeSessionValue(EMBED_STORAGE_KEY, activeEmbedToken);
      url.searchParams.delete("embed_token");
      urlChanged = true;
    }

    if (urlDisplayId) {
      activeDisplayId = urlDisplayId.trim();
      writeSessionValue(DISPLAY_ID_STORAGE_KEY, activeDisplayId);
    }

    if (urlDisplayToken) {
      activeDisplayToken = urlDisplayToken.trim();
      writeSessionValue(DISPLAY_TOKEN_STORAGE_KEY, activeDisplayToken);
      url.searchParams.delete("token");
      urlChanged = true;

      initialExchangePromise = rawFetch("/api/display/kiosk-exchange", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayId: activeDisplayId || undefined,
          token: activeDisplayToken,
        }),
      })
        .then(async (res) => {
          if (res.ok) {
            const data = await res.json().catch(() => null);
            if (data?.displayId) {
              activeDisplayId = data.displayId;
              writeSessionValue(DISPLAY_ID_STORAGE_KEY, data.displayId);
            }
          }
        })
        .catch(() => {});
    }

    if (urlChanged) {
      window.history.replaceState({}, "", url.pathname + url.search + url.hash);
    }
  } catch {
    // Ignore URL parsing issues
  }

  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let urlStr = "";
    if (typeof input === "string") {
      urlStr = input;
    } else if (input instanceof URL) {
      urlStr = input.toString();
    } else if (input instanceof Request) {
      urlStr = input.url;
    }

    const isSameOriginApi =
      urlStr.startsWith("/api/") ||
      urlStr === "/api" ||
      urlStr.startsWith(`${window.location.origin}/api/`);

    if (!isSameOriginApi) {
      return rawFetch(input, init);
    }

    const headers = new Headers(
      init?.headers || (input instanceof Request ? input.headers : undefined),
    );

    if (activeDisplayToken && !headers.has("X-Display-Token")) {
      headers.set("X-Display-Token", activeDisplayToken);
      if (activeDisplayId && !headers.has("X-Display-Id")) {
        headers.set("X-Display-Id", activeDisplayId);
      }
    } else if (activeEmbedToken && !headers.has("X-Embed-Token")) {
      headers.set("X-Embed-Token", activeEmbedToken);
    }

    return rawFetch(input, {
      ...init,
      credentials: init?.credentials ?? "include",
      headers,
    });
  };
}

bootstrapUrlTokensAndFetchInterceptor();

export function clearStoredDeviceTokens() {
  activeEmbedToken = null;
  activeDisplayToken = null;
  writeSessionValue(EMBED_STORAGE_KEY, null);
  writeSessionValue(DISPLAY_TOKEN_STORAGE_KEY, null);
}

export function buildAuthenticatedWsUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = new URL(`${protocol}//${window.location.host}/ws`);
  if (activeDisplayToken) {
    url.searchParams.set("token", activeDisplayToken);
    if (activeDisplayId) {
      url.searchParams.set("display", activeDisplayId);
    }
  } else if (activeEmbedToken) {
    url.searchParams.set("embed_token", activeEmbedToken);
  }
  return url.toString();
}

const AuthContext = createContext<AuthContextValue>({
  loading: true,
  authenticated: false,
  scope: null,
  user: null,
  displayId: null,
  refreshAuth: async () => ({ authenticated: false, scope: null }),
  login: async () => ({ ok: false, error: "Auth not initialized" }),
  logout: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [scope, setScope] = useState<AuthScope>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [displayId, setDisplayId] = useState<string | null>(null);

  const refreshAuth = useCallback(async (): Promise<AuthMeResponse> => {
    try {
      if (initialExchangePromise) {
        await initialExchangePromise;
        initialExchangePromise = null;
      }
      const res = await fetch("/api/auth/me", { credentials: "include" });
      if (!res.ok) {
        setAuthenticated(false);
        setScope(null);
        setUser(null);
        setDisplayId(null);
        return { authenticated: false, scope: null };
      }
      const data: AuthMeResponse = await res.json();
      setAuthenticated(Boolean(data.authenticated));
      setScope(data.scope || null);
      setUser(data.user || null);
      setDisplayId(data.displayId || null);
      return data;
    } catch {
      setAuthenticated(false);
      setScope(null);
      setUser(null);
      setDisplayId(null);
      return { authenticated: false, scope: null };
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshAuth();
  }, [refreshAuth]);

  const login = useCallback(
    async (username: string, password: string): Promise<{ ok: boolean; error?: string }> => {
      try {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
          return { ok: false, error: data.error || "Invalid username or password" };
        }
        clearStoredDeviceTokens();
        await refreshAuth();
        return { ok: true };
      } catch {
        return { ok: false, error: "Network error — unable to reach server" };
      }
    },
    [refreshAuth],
  );

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Ignore logout network error
    }
    clearStoredDeviceTokens();
    setAuthenticated(false);
    setScope(null);
    setUser(null);
    setDisplayId(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        loading,
        authenticated,
        scope,
        user,
        displayId,
        refreshAuth,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

/**
 * Returns the Leaflet TileLayer URL template routed through the server's
 * 500 MB disk-cached tile proxy. Appends `embed_token` query param only when
 * running inside a cross-origin DAKboard iframe where cookies are blocked.
 */
export function getMapTileUrlTemplate(): string {
  const token = activeEmbedToken || readSessionValue(EMBED_STORAGE_KEY);
  if (token) {
    return `/api/tiles/{z}/{x}/{y}.png?embed_token=${encodeURIComponent(token)}`;
  }
  return "/api/tiles/{z}/{x}/{y}.png";
}
