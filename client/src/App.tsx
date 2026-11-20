import { lazy, Suspense, useEffect } from "react";
import { Switch, Route, Redirect, useLocation, Link } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Satellite, ShieldAlert, LogOut, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AuthProvider, useAuth, type AuthScope } from "@/lib/auth";
import { useOfficeTheme } from "@/lib/theme";
import NotFound from "@/pages/not-found";

const Login = lazy(() => import("@/pages/Login"));
const TrackingDashboard = lazy(() => import("@/pages/TrackingDashboard"));
const DispatchPortal = lazy(() => import("@/pages/DispatchPortal"));
const DeliveryHistory = lazy(() => import("@/pages/DeliveryHistory"));
const TvDisplay = lazy(() => import("@/pages/TvDisplay"));
const Admin = lazy(() => import("@/pages/Admin"));

function AuthLoadingScreen() {
  return (
    <div className="h-screen w-screen bg-background text-foreground flex flex-col items-center justify-center gap-3">
      <Satellite className="w-7 h-7 text-primary animate-pulse" />
      <span className="text-xs font-mono uppercase tracking-[0.2em] text-muted-foreground">
        Initializing Dispatch Terminal...
      </span>
    </div>
  );
}

function GuardedRoute({
  allowed,
  children,
}: {
  allowed: NonNullable<AuthScope>[];
  children: React.ReactNode;
}) {
  const { loading, authenticated, scope, user, logout } = useAuth();
  const [location, setLocation] = useLocation();

  useEffect(() => {
    if (loading) return;
    if (!authenticated || !scope) {
      const next = encodeURIComponent(location + window.location.search);
      setLocation(`/login?next=${next}`);
    } else if ((scope === "kiosk" || scope === "embed") && !allowed.includes(scope)) {
      if (location.startsWith("/admin")) {
        const next = encodeURIComponent(location + window.location.search);
        setLocation(`/login?next=${next}`);
      } else {
        setLocation("/display");
      }
    }
  }, [loading, authenticated, scope, allowed, location, setLocation]);

  if (
    loading ||
    !authenticated ||
    !scope ||
    ((scope === "kiosk" || scope === "embed") && !allowed.includes(scope))
  ) {
    return <AuthLoadingScreen />;
  }

  if (!allowed.includes(scope)) {
    return (
      <div className="min-h-screen w-full bg-background text-foreground flex items-center justify-center p-4">
        <div className="max-w-md w-full rounded border border-border bg-card p-6 space-y-4 text-center shadow-lg">
          <div className="mx-auto w-11 h-11 rounded bg-primary/15 border border-primary/35 flex items-center justify-center">
            <ShieldAlert className="w-5 h-5 text-primary" />
          </div>
          <h2 className="text-xl font-display font-bold uppercase tracking-wide">
            Admin Clearance Required
          </h2>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Signed in as{" "}
            <strong className="text-foreground">{user?.username || scope}</strong> (
            <span className="uppercase font-mono">{scope}</span>) — read-only dispatch & TV access.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
            <Link href="/">
              <Button variant="default" size="sm" className="gap-1.5">
                <ArrowLeft className="w-4 h-4" />
                Back to Live Map
              </Button>
            </Link>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={async () => {
                await logout();
                setLocation("/login");
              }}
            >
              <LogOut className="w-4 h-4" />
              Switch Account
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

function Router() {
  return (
    <Suspense fallback={<AuthLoadingScreen />}>
      <Switch>
        <Route path="/login">
          <Login />
        </Route>
        <Route path="/display">
          <TvDisplay />
        </Route>
        <Route path="/tv">
          <TvDisplay />
        </Route>

        <Route path="/admin">
          <GuardedRoute allowed={["admin", "staff"]}>
            <Admin />
          </GuardedRoute>
        </Route>

        {/* Unified Fleet & Dispatch Hub */}
        <Route path="/">
          <GuardedRoute allowed={["admin", "staff", "viewer"]}>
            <TrackingDashboard />
          </GuardedRoute>
        </Route>

        {/* Chromeless Phased DAKboard / Kiosk Map Aliases */}
        <Route path="/map">
          <GuardedRoute allowed={["admin", "staff", "viewer", "kiosk", "embed"]}>
            <TrackingDashboard embedPreset="corridor" />
          </GuardedRoute>
        </Route>
        <Route path="/regional-sf">
          <GuardedRoute allowed={["admin", "staff", "viewer", "kiosk", "embed"]}>
            <TrackingDashboard embedPreset="sioux-falls" />
          </GuardedRoute>
        </Route>

        {/* Desktop Dispatch & Route Optimizer Command Portal (Open to all logged-in scopes) */}
        <Route path="/dispatch">
          <GuardedRoute allowed={["admin", "staff", "viewer", "kiosk", "embed"]}>
            <DispatchPortal />
          </GuardedRoute>
        </Route>

        {/* Customer Delivery History & Sales CRM Frequency Lookup */}
        <Route path="/history">
          <GuardedRoute allowed={["admin", "staff", "viewer", "kiosk", "embed"]}>
            <DeliveryHistory />
          </GuardedRoute>
        </Route>
        <Route path="/sioux-falls">
          <Redirect to="/" />
        </Route>
        <Route path="/auto-fit">
          <Redirect to="/" />
        </Route>
        <Route path="/webhooks">
          <Redirect to="/admin" />
        </Route>
        <Route path="/regional-sf/settings">
          <Redirect to="/" />
        </Route>

        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function App() {
  useOfficeTheme();
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
