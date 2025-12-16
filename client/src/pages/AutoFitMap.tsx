import { useState, useEffect, useMemo } from "react";
import TrackingMap from "@/components/TrackingMap";
import { useWebSocket } from "@/hooks/useWebSocket";
import { Radio, Satellite, Maximize2 } from "lucide-react";

export default function AutoFitMap() {
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

  const dynamicBounds = useMemo(() => {
    if (vehicleData.length === 0) {
      return {
        southwest: [43.0, -100.5] as [number, number],
        northeast: [45.5, -96.0] as [number, number]
      };
    }

    const lats = vehicleData.map(v => v.location.lat);
    const lons = vehicleData.map(v => v.location.lon);
    
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);
    
    const latPadding = Math.max((maxLat - minLat) * 0.3, 0.05);
    const lonPadding = Math.max((maxLon - minLon) * 0.3, 0.05);
    
    return {
      southwest: [minLat - latPadding, minLon - lonPadding] as [number, number],
      northeast: [maxLat + latPadding, maxLon + lonPadding] as [number, number]
    };
  }, [vehicleData]);

  const dynamicCenter = useMemo((): [number, number] => {
    if (vehicleData.length === 0) {
      return [44.25, -98.25];
    }
    const avgLat = vehicleData.reduce((sum, v) => sum + v.location.lat, 0) / vehicleData.length;
    const avgLon = vehicleData.reduce((sum, v) => sum + v.location.lon, 0) / vehicleData.length;
    return [avgLat, avgLon];
  }, [vehicleData]);

  return (
    <div className="h-screen w-screen relative bg-background">
      {vehicleData.length > 0 ? (
        <TrackingMap 
          data={vehicleData} 
          onVehicleUpdate={loadVehicles}
          center={dynamicCenter}
          bounds={dynamicBounds}
          zoom={10}
          minZoom={5}
          maxZoom={18}
          autoFitBounds={true}
        />
      ) : (
        <div className="h-full w-full flex flex-col items-center justify-center bg-background text-muted-foreground">
          <Satellite className="w-16 h-16 mb-4 animate-pulse text-primary/50" />
          <h2 className="text-lg font-semibold mb-2">Waiting for Vehicle Data</h2>
          <p className="text-sm text-center max-w-md">
            No vehicles tracked yet. Data will appear here when Motive sends GPS updates.
          </p>
        </div>
      )}

      <div className="absolute top-4 left-4 z-[1000] flex items-center gap-3">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-primary/30 bg-background/90 backdrop-blur-sm shadow-lg">
          <Maximize2 className="w-3 h-3 text-primary" />
          <span className="text-[10px] font-mono font-bold uppercase text-primary">
            Auto-Fit
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
            <span className="text-muted-foreground"> vehicle{vehicleData.length !== 1 ? 's' : ''}</span>
          </span>
        </div>
      )}
    </div>
  );
}
