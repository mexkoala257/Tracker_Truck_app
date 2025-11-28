import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import TrackingDashboard from "@/pages/TrackingDashboard";
import MapView from "@/pages/MapView";
import MapEmbed from "@/pages/MapEmbed";

function Router() {
  return (
    <Switch>
      <Route path="/" component={TrackingDashboard} />
      <Route path="/map" component={MapView} />
      <Route path="/embed" component={MapEmbed} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;