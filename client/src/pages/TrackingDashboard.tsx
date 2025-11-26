import { useState, useEffect } from "react";
import TrackingMap from "@/components/TrackingMap";
import WebhookSimulator from "@/components/WebhookSimulator";
import ExportDialog from "@/components/ExportDialog";
import { useWebSocket } from "@/hooks/useWebSocket";
import { Radio, Satellite, Activity, LayoutDashboard, Settings, Truck, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

export default function TrackingDashboard() {
  const [vehicleData, setVehicleData] = useState<{
    id: string;
    location: { lat: number; lon: number };
    speed: number;
    status: string;
    timestamp: string;
    heading: number;
  } | null>(null);

  // Load existing vehicles from database on mount
  useEffect(() => {
    const loadVehicles = async () => {
      try {
        const response = await fetch("/api/vehicles");
        if (response.ok) {
          const vehicles = await response.json();
          if (vehicles && vehicles.length > 0) {
            console.log("Loaded vehicles from database:", vehicles);
            setVehicleData(vehicles[0]);
          }
        }
      } catch (error) {
        console.error("Error loading vehicles:", error);
      }
    };

    loadVehicles();
  }, []);

  // WebSocket connection for real-time updates from Motive
  const { isConnected } = useWebSocket((data) => {
    console.log("Real-time location update received:", data);
    setVehicleData({
      id: data.id,
      location: data.location,
      speed: data.speed,
      status: data.status,
      timestamp: data.timestamp,
      heading: data.heading
    });
  });

  const handleWebhook = async (payload: any) => {
    console.log("Simulating webhook:", payload);
    
    // Send to our webhook endpoint (simulating Motive)
    try {
      const response = await fetch("/api/webhooks/motive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vehicle_id: payload.vehicle_id,
          location: payload.location,
          speed: payload.speed,
          status: payload.status,
          timestamp: payload.timestamp,
          heading: payload.heading
        })
      });
      
      if (!response.ok) {
        console.error("Failed to send webhook simulation");
      }
    } catch (error) {
      console.error("Error sending webhook:", error);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col md:flex-row overflow-hidden">
      
      {/* Sidebar Navigation (Desktop) */}
      <aside className="hidden md:flex w-16 flex-col items-center py-6 border-r border-border bg-secondary/30 z-20">
        <div className="mb-8 p-2 bg-primary/20 rounded-lg">
          <Satellite className="w-6 h-6 text-primary animate-pulse" />
        </div>
        
        <nav className="flex flex-col gap-4 w-full px-2">
          <Button variant="ghost" size="icon" className="w-full aspect-square rounded-lg bg-primary/10 text-primary">
            <LayoutDashboard className="w-5 h-5" />
          </Button>
          <Button variant="ghost" size="icon" className="w-full aspect-square rounded-lg text-muted-foreground hover:text-foreground">
            <Truck className="w-5 h-5" />
          </Button>
          <Button variant="ghost" size="icon" className="w-full aspect-square rounded-lg text-muted-foreground hover:text-foreground">
            <Activity className="w-5 h-5" />
          </Button>
        </nav>

        <div className="mt-auto">
          <Button variant="ghost" size="icon" className="w-full aspect-square rounded-lg text-muted-foreground hover:text-foreground">
            <Settings className="w-5 h-5" />
          </Button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden relative">
        
        {/* Header */}
        <header className="h-14 border-b border-border bg-background/50 backdrop-blur-sm px-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="md:hidden">
                  <Menu className="w-5 h-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-64 p-0 bg-background border-r border-border">
                 {/* Mobile Nav Content */}
                 <div className="flex flex-col h-full p-4">
                    <div className="flex items-center gap-2 mb-8">
                      <Satellite className="w-6 h-6 text-primary" />
                      <span className="font-bold">Motive Tracker</span>
                    </div>
                 </div>
              </SheetContent>
            </Sheet>
            
            <h1 className="text-sm font-medium tracking-tight flex items-center gap-2">
              <span className="font-bold text-primary">MOTIVE</span> 
              <span className="text-muted-foreground">/</span> 
              FLEET COMMAND
            </h1>
          </div>

          <div className="flex items-center gap-4">
            <ExportDialog />
            <div className={`hidden sm:flex items-center gap-2 px-3 py-1 rounded-full border ${
              isConnected 
                ? 'bg-green-500/10 border-green-500/20' 
                : 'bg-yellow-500/10 border-yellow-500/20'
            }`}>
              <Radio className={`w-3 h-3 ${isConnected ? 'text-green-500 animate-pulse' : 'text-yellow-500'}`} />
              <span className={`text-[10px] font-mono font-bold uppercase ${
                isConnected ? 'text-green-500' : 'text-yellow-500'
              }`}>
                {isConnected ? 'Live Feed' : 'Connecting...'}
              </span>
            </div>
            <div className="h-8 w-8 rounded-full bg-secondary border border-border flex items-center justify-center">
              <span className="text-xs font-bold">JD</span>
            </div>
          </div>
        </header>

        {/* Dashboard Grid */}
        <div className="flex-1 p-4 gap-4 grid grid-cols-1 lg:grid-cols-4 h-full overflow-hidden">
          
          {/* Map Area - Takes up 3 columns */}
          <div className="lg:col-span-3 h-[50vh] lg:h-full min-h-0 rounded-xl overflow-hidden relative shadow-2xl border border-border/50">
             {vehicleData ? (
               <>
                 <TrackingMap data={vehicleData} />
                 
                 {/* Decorative HUD elements */}
                 <div className="absolute top-4 left-4 pointer-events-none z-[400]">
                    <div className="text-[10px] font-mono text-muted-foreground/50">
                      LAT: {vehicleData.location.lat.toFixed(4)}<br/>
                      LON: {vehicleData.location.lon.toFixed(4)}
                    </div>
                 </div>
                 <div className="absolute bottom-4 left-4 pointer-events-none z-[400]">
                    <div className="h-32 w-32 border-l border-b border-primary/20 relative">
                      <div className="absolute bottom-0 left-0 w-2 h-2 bg-primary/50" />
                    </div>
                 </div>
               </>
             ) : (
               <div className="h-full w-full flex flex-col items-center justify-center bg-background text-muted-foreground">
                 <Satellite className="w-16 h-16 mb-4 animate-pulse text-primary/50" />
                 <h2 className="text-lg font-semibold mb-2">Waiting for Vehicle Data</h2>
                 <p className="text-sm text-center max-w-md">
                   No vehicles tracked yet. Data will appear here when Motive sends GPS updates via webhook.
                 </p>
                 <div className="mt-6 p-4 rounded-lg border border-border bg-secondary/20 max-w-lg">
                   <p className="text-xs text-muted-foreground">
                     <strong className="text-foreground">Webhook URL:</strong> {window.location.origin}/api/webhooks/motive
                   </p>
                 </div>
               </div>
             )}
          </div>

          {/* Simulator / Controls Area */}
          <div className="lg:col-span-1 h-full min-h-0 flex flex-col gap-4 overflow-y-auto pb-4">
            {vehicleData && (
              <WebhookSimulator 
                currentData={vehicleData} 
                onWebhookTrigger={handleWebhook} 
              />
            )}
            
            {/* Info Panel */}
            <div className="p-4 rounded-lg border border-blue-500/20 bg-blue-950/10">
              <h3 className="text-xs font-bold text-blue-400 mb-2 uppercase tracking-wider flex items-center gap-2">
                <Activity className="w-3 h-3" />
                Diagnostics
              </h3>
              <div className="space-y-2">
                <div className="flex justify-between text-[10px]">
                  <span className="text-muted-foreground">Engine Load</span>
                  <span className="font-mono text-foreground">42%</span>
                </div>
                <div className="w-full h-1 bg-secondary rounded-full overflow-hidden">
                  <div className="h-full w-[42%] bg-blue-500/50" />
                </div>
                
                <div className="flex justify-between text-[10px] mt-2">
                  <span className="text-muted-foreground">Fuel Level</span>
                  <span className="font-mono text-foreground">78%</span>
                </div>
                <div className="w-full h-1 bg-secondary rounded-full overflow-hidden">
                  <div className="h-full w-[78%] bg-green-500/50" />
                </div>
              </div>
            </div>

          </div>

        </div>
      </main>
    </div>
  );
}
