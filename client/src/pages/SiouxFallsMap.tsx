import { useState, useEffect } from "react";
import TrackingMap from "@/components/TrackingMap";
import { useWebSocket } from "@/hooks/useWebSocket";
import { Radio, Satellite, MapPin } from "lucide-react";

const SIOUX_FALLS_BOUNDS = {
  southwest: [43.12, -97.33] as [number, number],
  northeast: [43.98, -96.13] as [number, number]
};

const SIOUX_FALLS_CENTER: [number, number] = [43.55, -96.73];

export default function SiouxFallsMap() {
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
        const inRegion = vehicles.filter((v: any) => {
          const lat = v.location.lat;
          const lon = v.location.lon;
          return lat >= SIOUX_FALLS_BOUNDS.southwest[0] && 
                 lat <= SIOUX_FALLS_BOUNDS.northeast[0] &&
                 lon >= SIOUX_FALLS_BOUNDS.southwest[1] && 
                 lon <= SIOUX_FALLS_BOUNDS.northeast[1];
        });
        setVehicleData(inRegion);
      }
    } catch (error) {
      console.error("Error loading vehicles:", error);
    }
  };

  useEffect(() => {
    loadVehicles();
  }, []);

  const { isConnected } = useWebSocket((data) => {
    const lat = data.location.lat;
    const lon = data.location.lon;
    const inRegion = lat >= SIOUX_FALLS_BOUNDS.southwest[0] && 
                     lat <= SIOUX_FALLS_BOUNDS.northeast[0] &&
                     lon >= SIOUX_FALLS_BOUNDS.southwest[1] && 
                     lon <= SIOUX_FALLS_BOUNDS.northeast[1];
    
    if (!inRegion) return;

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
        <TrackingMap 
          data={vehicleData} 
          onVehicleUpdate={loadVehicles}
          center={SIOUX_FALLS_CENTER}
          zoom={10}
          minZoom={9}
          maxZoom={17}
          bounds={SIOUX_FALLS_BOUNDS}
        />
      ) : (
        <div className="h-full w-full flex flex-col items-center justify-center bg-background text-muted-foreground">
          <Satellite className="w-16 h-16 mb-4 animate-pulse text-primary/50" />
          <h2 className="text-lg font-semibold mb-2">Sioux Falls Region</h2>
          <p className="text-sm text-center max-w-md">
            No vehicles in the Sioux Falls area. Vehicles will appear when they enter this region.
          </p>
        </div>
      )}

      <div className="absolute top-4 left-4 z-[1000] flex items-center gap-3">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border bg-background/90 backdrop-blur-sm shadow-lg border-primary/30">
          <MapPin className="w-3 h-3 text-primary" />
          <span className="text-[10px] font-mono font-bold uppercase text-primary">
            Sioux Falls
          </span>
        </div>
        
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

      {vehicleData.length > 0 && (
        <div className="absolute top-4 right-4 z-[1000] px-3 py-1.5 rounded-full bg-background/90 backdrop-blur-sm border border-border shadow-lg">
          <span className="text-xs font-mono">
            <span className="text-primary font-bold">{vehicleData.length}</span>
            <span className="text-muted-foreground"> in region</span>
          </span>
        </div>
      )}
    </div>
  );
}
