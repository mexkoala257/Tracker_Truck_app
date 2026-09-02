import { useState, useEffect } from "react";
import TrackingMap from "@/components/TrackingMap";
import ReturnEtaPanel, { type ReturnEtaWarehouse } from "@/components/ReturnEtaPanel";
import ActiveVehiclesPanel from "@/components/ActiveVehiclesPanel";
import { useWebSocket } from "@/hooks/useWebSocket";
import { Radio, Satellite, Truck, ZoomIn, ZoomOut, Lock } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "mapview-zoom";
const DEFAULT_ZOOM = 9;
const MIN_ZOOM = 6;
const MAX_ZOOM = 17;
const DEFAULT_ARLINGTON_WAREHOUSE: ReturnEtaWarehouse = {
  name: "Arlington Warehouse",
  latitude: 44.3792,
  longitude: -97.1406,
};
const DISPATCH_BOUNDS = {
  southwest: [41.5, -103.5] as [number, number],
  northeast: [47, -93] as [number, number],
};

function getSavedZoom(): number {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const zoom = parseInt(saved, 10);
      if (zoom >= MIN_ZOOM && zoom <= MAX_ZOOM) {
        return zoom;
      }
    }
  } catch (e) {}
  return DEFAULT_ZOOM;
}

function saveZoom(zoom: number) {
  try {
    localStorage.setItem(STORAGE_KEY, zoom.toString());
  } catch (e) {}
}

type MapViewProps = {
  dispatchOnly?: boolean;
};

export default function MapView({ dispatchOnly = false }: MapViewProps) {
  const [zoom, setZoom] = useState(getSavedZoom);
  const [warehouse, setWarehouse] = useState<ReturnEtaWarehouse>(DEFAULT_ARLINGTON_WAREHOUSE);
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

  const handleZoomChange = (newZoom: number) => {
    setZoom(newZoom);
    saveZoom(newZoom);
  };

  const handleSliderChange = (value: number[]) => {
    handleZoomChange(value[0]);
  };

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

  useEffect(() => {
    fetch("/api/map-home-locations")
      .then((response) => (response.ok ? response.json() : null))
      .then((assignments) => {
        const selected = assignments?.map?.location;
        if (selected) {
          setWarehouse({
            name: selected.name,
            latitude: selected.latitude,
            longitude: selected.longitude,
          });
        }
      })
      .catch((error) => {
        console.error("Error loading Map page home location:", error);
      });
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

  const displayedVehicles = dispatchOnly
    ? vehicleData.filter((vehicle) => !vehicle.id.startsWith("asset-") && vehicle.id !== "HOME")
    : vehicleData;

  return (
    <div className="h-screen w-screen relative bg-background">
      {displayedVehicles.length > 0 ? (
        <TrackingMap 
          data={displayedVehicles}
          onVehicleUpdate={loadVehicles}
          zoom={zoom}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
           bounds={dispatchOnly ? DISPATCH_BOUNDS : undefined}
          onZoomChange={handleZoomChange}
          autoFitBounds={false}
          baseLocation={{
            name: warehouse.name,
            lat: warehouse.latitude,
            lon: warehouse.longitude,
            address: `${warehouse.latitude.toFixed(4)}, ${warehouse.longitude.toFixed(4)}`,
          }}
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
        {dispatchOnly && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border bg-background/90 backdrop-blur-sm shadow-lg border-primary/30">
            <Truck className="w-3 h-3 text-primary" />
            <span className="text-[10px] font-mono font-bold uppercase text-primary">
              Dispatch
            </span>
          </div>
        )}
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

      {displayedVehicles.length > 0 && (
        <div className="absolute top-4 right-4 z-[1000] px-3 py-1.5 rounded-full bg-background/90 backdrop-blur-sm border border-border shadow-lg">
          <span className="text-xs font-mono">
            <span className="text-primary font-bold">{displayedVehicles.length}</span>
            <span className="text-muted-foreground"> vehicle{displayedVehicles.length !== 1 ? 's' : ''}</span>
          </span>
        </div>
      )}

      {dispatchOnly && (
        <ActiveVehiclesPanel vehicles={displayedVehicles} warehouse={warehouse} />
      )}

      <ReturnEtaPanel vehicles={displayedVehicles} warehouse={warehouse} />

      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[1000] bg-background/50 backdrop-blur-sm border border-border rounded-lg shadow-xl p-3 flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => handleZoomChange(Math.max(MIN_ZOOM, zoom - 1))}
          disabled={zoom <= MIN_ZOOM}
          data-testid="button-zoom-out"
        >
          <ZoomOut className="w-4 h-4" />
        </Button>
        
        <div className="flex items-center gap-2 w-48">
          <Slider
            value={[zoom]}
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={1}
            onValueChange={handleSliderChange}
            className="w-full"
            data-testid="slider-zoom"
          />
        </div>
        
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => handleZoomChange(Math.min(MAX_ZOOM, zoom + 1))}
          disabled={zoom >= MAX_ZOOM}
          data-testid="button-zoom-in"
        >
          <ZoomIn className="w-4 h-4" />
        </Button>
        
        <div className="flex items-center gap-1.5 pl-2 border-l border-border">
          <Lock className="w-3 h-3 text-green-500" />
          <span className="text-[10px] font-mono text-muted-foreground">
            Zoom: <span className="text-primary font-bold">{zoom}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

export function DispatchMap() {
  return <MapView dispatchOnly />;
}
