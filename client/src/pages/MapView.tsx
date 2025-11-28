import { useState, useEffect } from "react";
import TrackingMap from "@/components/TrackingMap";
import { useWebSocket } from "@/hooks/useWebSocket";
import { Radio, Satellite } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function MapView() {
  const [vehicleData, setVehicleData] = useState<{
    id: string;
    name?: string;
    color?: string;
    location: { lat: number; lon: number };
    speed: number;
    status: string;
    timestamp: string;
    heading: number;
  }[]>([]);

  const loadVehicles = async () => {
    try {
      const response = await fetch("/api/vehicles");
      if (response.ok) {
        const vehicles = await response.json();
        setVehicleData(vehicles);
      }
    } catch (error) {
      console.error("Error loading vehicles:", error);
    }
  };

  useEffect(() => {
    loadVehicles();
  }, []);

  const { isConnected } = useWebSocket((data) => {
    setVehicleData(prev => {
      const existingIndex = prev.findIndex(v => v.id === data.id);
      if (existingIndex >= 0) {
        const updated = [...prev];
        updated[existingIndex] = {
          ...updated[existingIndex],
          location: data.location,
          speed: data.speed,
          status: data.status,
          timestamp: data.timestamp,
          heading: data.heading
        };
        return updated;
      } else {
        return [...prev, {
          id: data.id,
          name: data.name,
          color: data.color,
          location: data.location,
          speed: data.speed,
          status: data.status,
          timestamp: data.timestamp,
          heading: data.heading
        }];
      }
    });
  });

  return (
    <div className="h-screen w-screen relative bg-background">
      {vehicleData.length > 0 ? (
        <TrackingMap data={vehicleData} onVehicleUpdate={loadVehicles} />
      ) : (
        <div className="h-full w-full flex flex-col items-center justify-center bg-background text-muted-foreground">
          <Satellite className="w-16 h-16 mb-4 animate-pulse text-primary/50" />
          <h2 className="text-lg font-semibold mb-2">Waiting for Vehicle Data</h2>
          <p className="text-sm text-center max-w-md">
            No vehicles tracked yet. Data will appear here when Motive sends GPS updates.
          </p>
        </div>
      )}

      {/* Minimal overlay controls */}
      <div className="absolute top-4 left-4 z-[1000] flex items-center gap-3">
        <Link href="/">
          <Button 
            variant="secondary" 
            size="sm" 
            className="bg-background/90 backdrop-blur-sm border border-border shadow-lg"
            data-testid="link-dashboard"
          >
            ← Dashboard
          </Button>
        </Link>
        
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border bg-background/90 backdrop-blur-sm shadow-lg ${
          isConnected 
            ? 'border-green-500/30' 
            : 'border-yellow-500/30'
        }`}>
          <Radio className={`w-3 h-3 ${isConnected ? 'text-green-500 animate-pulse' : 'text-yellow-500'}`} />
          <span className={`text-[10px] font-mono font-bold uppercase ${
            isConnected ? 'text-green-500' : 'text-yellow-500'
          }`}>
            {isConnected ? 'Live' : 'Connecting...'}
          </span>
        </div>
      </div>

      {/* Vehicle count badge */}
      {vehicleData.length > 0 && (
        <div className="absolute top-4 right-4 z-[1000] px-3 py-1.5 rounded-full bg-background/90 backdrop-blur-sm border border-border shadow-lg">
          <span className="text-xs font-mono">
            <span className="text-primary font-bold">{vehicleData.length}</span>
            <span className="text-muted-foreground"> vehicle{vehicleData.length !== 1 ? 's' : ''}</span>
          </span>
        </div>
      )}
    </div>
  );
}
