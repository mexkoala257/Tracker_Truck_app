import { useState, useEffect, useMemo } from "react";
import { useLocation, Link } from "wouter";
import { Truck, Lock, Eye, EyeOff, Tv, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import {
  IbsBrandHeaderMark,
  DoodleworksLegalFooter,
} from "@/components/IbsBrandComponents";

export default function Login() {
  const { loading, authenticated, scope, displayId, login, logout } = useAuth();
  const [, setLocation] = useLocation();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nextPath = useMemo(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const raw = params.get("next") || "/";
      if (raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/login")) {
        return raw;
      }
    } catch {
      // Ignore query parse error
    }
    return "/";
  }, []);

  useEffect(() => {
    if (!loading && authenticated && (scope === "admin" || scope === "viewer")) {
      setLocation(nextPath);
    }
  }, [loading, authenticated, scope, nextPath, setLocation]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError("Enter both username and password.");
      return;
    }

    setSubmitting(true);
    setError(null);
    const result = await login(username.trim(), password);
    setSubmitting(false);

    if (!result.ok) {
      setError(result.error || "Invalid username or password");
      return;
    }

    setLocation(nextPath);
  };

  return (
    <div className="min-h-screen w-full bg-background text-foreground flex flex-col justify-between">
      <div className="p-6 flex-1 flex flex-col justify-between">
        {/* Top Industrial Rule Bar */}
        <div className="max-w-md w-full mx-auto flex items-center justify-between text-[11px] font-mono uppercase tracking-widest text-muted-foreground border-b border-border pb-3">
          <span>INTERSTATE BATTERIES OF SOUTH DAKOTA</span>
          <span>SIOUX FALLS &amp; ARLINGTON</span>
        </div>

        <div className="w-full max-w-md mx-auto space-y-5 my-8">
          {/* Brand Lockup & Masthead */}
          <div className="space-y-3">
            <IbsBrandHeaderMark
              size="lg"
              subtitle="Sioux Falls & Arlington Hubs • Fleet GPS, Hot Shot Dispatch & TV Departure Boards"
            />
            <div className="space-y-1 border-l-4 border-primary pl-3.5 pt-1">
              <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-primary font-semibold">
                <Truck className="w-4 h-4" />
                <span>Authorized Personnel Sign-In</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Enter Staff, Admin, or Viewer credentials to access live GPS routes, Hot Shot dispatches, delivery history, and TV boards.
              </p>
            </div>
          </div>

        {/* Sign-in Panel */}
        <form
          onSubmit={handleSubmit}
          className="rounded border border-border bg-card shadow-md overflow-hidden"
        >
          <div className="bg-secondary px-5 py-2.5 border-b border-border flex items-center justify-between">
            <span className="text-xs font-display font-bold uppercase tracking-wider text-secondary-foreground">
              Operator Credentials
            </span>
            <span className="text-[10px] font-mono uppercase text-muted-foreground">
              SESSION AUTH
            </span>
          </div>

          <div className="p-5 space-y-4">
            {scope === "kiosk" && (
              <div className="rounded border border-primary/50 bg-primary/10 px-3.5 py-2.5 text-xs text-foreground flex items-center justify-between gap-2">
                <span>
                  Active TV Kiosk cookie detected
                  {displayId ? ` (${displayId})` : ""}. Signing in below switches this browser to Staff mode.
                </span>
                <button
                  type="button"
                  onClick={() => logout()}
                  className="shrink-0 px-2.5 py-1 rounded bg-secondary hover:bg-secondary/80 border border-border text-foreground font-mono text-[11px] font-semibold"
                >
                  Clear Cookie
                </button>
              </div>
            )}

            {error && (
              <div
                role="alert"
                className="rounded border border-destructive/60 bg-destructive/15 px-3.5 py-2.5 text-xs text-foreground flex items-start gap-2"
              >
                <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="login-username" className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                Username
              </Label>
              <Input
                id="login-username"
                data-testid="input-login-username"
                autoComplete="username"
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin"
                className="bg-background border-border font-mono"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="login-password" className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                Password
              </Label>
              <div className="relative">
                <Input
                  id="login-password"
                  data-testid="input-login-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="bg-background border-border pr-10 font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1"
                  tabIndex={-1}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              data-testid="button-login-submit"
              disabled={submitting}
              className="w-full gap-2 font-display uppercase tracking-wider font-bold text-sm h-10"
            >
              <Lock className="w-4 h-4" />
              {submitting ? "Authenticating..." : "Sign In to Terminal"}
            </Button>
          </div>
        </form>

        {/* Unattended TV Pairing Helper */}
        <div className="rounded border border-border bg-card px-4 py-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-2.5 min-w-0">
            <Tv className="w-4 h-4 text-primary shrink-0" />
            <span className="truncate">Commissioning a Breakroom or Warehouse TV?</span>
          </div>
          <Link href="/display">
            <span className="text-primary hover:underline font-mono uppercase text-[11px] font-bold whitespace-nowrap cursor-pointer">
              Pair TV Unit →
            </span>
          </Link>
        </div>
        {/* Doodleworks LLC Ownership & Legal Notice Card on Login */}
        <div className="rounded border border-border bg-secondary/40 px-4 py-2.5 text-[11px] text-muted-foreground leading-relaxed">
          <strong className="text-foreground">Software Ownership &amp; License Notice:</strong>{" "}
          Application software, algorithms, and platform architecture are the exclusive proprietary
          property of <strong className="text-foreground">Doodleworks LLC</strong> (&copy;{" "}
          {new Date().getFullYear()} Doodleworks LLC, All Rights Reserved). Licensed for internal
          operational use by{" "}
          <strong className="text-foreground">Interstate Batteries of South Dakota</strong>.
        </div>
      </div>

      <div className="max-w-md w-full mx-auto text-[11px] font-mono text-muted-foreground border-t border-border pt-3 flex items-center justify-between">
        <span>INTERSTATE BATTERIES OF SD</span>
        <span>SOFTWARE &copy; DOODLEWORKS LLC</span>
      </div>
      </div>
      <DoodleworksLegalFooter compact={false} />
    </div>
  );
}
