import { useState, useEffect } from "react";
import TrackingMap from "@/components/TrackingMap";
import { useWebSocket } from "@/hooks/useWebSocket";
import { Radio, Satellite } from "lucide-react";

export default function MapEmbed() {
  // Parse URL parameters for configuration
  const params = new URLSearchParams(window.location.search);
  const showControls = params.get('controls') !== 'false';
  const showStatus = params.get('status') !== 'false';
  const vehicleFilter = params.get('vehicles')?.split(',').filter(Boolean) || [];

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
        let vehicles = await response.json();
        // Filter by vehicle IDs if specified
        if (vehicleFilter.length > 0) {
          vehicles = vehicles.filter((v: any) => vehicleFilter.includes(v.id));
        }
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
    // Skip if filtering and this vehicle isn't in the filter
    if (vehicleFilter.length > 0 && !vehicleFilter.includes(data.id)) {
      return;
    }
    
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

  // Read-only version - no vehicle editing
  const noOpUpdate = () => {};

  return (
    <div className="h-screen w-screen relative bg-background">
      {vehicleData.length > 0 ? (
        <TrackingMap 
          data={vehicleData} 
          onVehicleUpdate={noOpUpdate} 
          readOnly={true}
        />
      ) : (
        <div className="h-full w-full flex flex-col items-center justify-center bg-background text-muted-foreground">
          <Satellite className="w-12 h-12 mb-3 animate-pulse text-primary/50" />
          <p className="text-sm">Waiting for vehicle data...</p>
        </div>
      )}

      {/* Status indicator */}
      {showStatus && (
        <div className="absolute top-3 left-3 z-[1000] flex items-center gap-2">
          <div className={`flex items-center gap-2 px-2.5 py-1 rounded-full border bg-background/90 backdrop-blur-sm shadow-lg text-[10px] ${
            isConnected 
              ? 'border-green-500/30' 
              : 'border-yellow-500/30'
          }`}>
            <Radio className={`w-2.5 h-2.5 ${isConnected ? 'text-green-500 animate-pulse' : 'text-yellow-500'}`} />
            <span className={`font-mono font-bold uppercase ${
              isConnected ? 'text-green-500' : 'text-yellow-500'
            }`}>
              {isConnected ? 'Live' : '...'}
            </span>
          </div>
        </div>
      )}

      {/* Vehicle count */}
      {showControls && vehicleData.length > 0 && (
        <div className="absolute top-3 right-3 z-[1000] px-2.5 py-1 rounded-full bg-background/90 backdrop-blur-sm border border-border shadow-lg">
          <span className="text-[10px] font-mono">
            <span className="text-primary font-bold">{vehicleData.length}</span>
            <span className="text-muted-foreground"> vehicle{vehicleData.length !== 1 ? 's' : ''}</span>
          </span>
        </div>
      )}
    </div>
  );
}
