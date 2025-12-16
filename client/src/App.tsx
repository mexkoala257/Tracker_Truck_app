import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import TrackingDashboard from "@/pages/TrackingDashboard";
import MapView from "@/pages/MapView";
import MapEmbed from "@/pages/MapEmbed";
import SiouxFallsMap from "@/pages/SiouxFallsMap";
import AutoFitMap from "@/pages/AutoFitMap";

function Router() {
  return (
    <Switch>
      <Route path="/" component={TrackingDashboard} />
      <Route path="/map" component={MapView} />
      <Route path="/auto-fit" component={AutoFitMap} />
      <Route path="/sioux-falls" component={SiouxFallsMap} />
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