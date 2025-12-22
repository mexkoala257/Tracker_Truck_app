import { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import { Truck, Navigation, MapPin, Pencil, Home, Warehouse, Star, Flag, Building } from "lucide-react";
import { renderToString } from "react-dom/server";
import { Button } from "@/components/ui/button";
import EditVehicleDialog from "./EditVehicleDialog";

// Fix for Leaflet icon issues in React
import "leaflet/dist/leaflet.css";

interface Location {
  lat: number;
  lon: number;
}

interface VehicleData {
  id: string;
  name?: string;
  color?: string;
  location: Location;
  speed: number;
  status: string;
  timestamp: string;
  heading?: number;
}

interface MapBounds {
  southwest: [number, number];
  northeast: [number, number];
}

interface CustomLocation {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  icon: string | null;
  color: string | null;
  description: string | null;
}

interface TrackingMapProps {
  data: VehicleData[];
  onVehicleUpdate?: () => void;
  readOnly?: boolean;
  center?: [number, number];
  zoom?: number;
  minZoom?: number;
  maxZoom?: number;
  bounds?: MapBounds;
  onZoomChange?: (zoom: number) => void;
  autoFitBounds?: boolean;
}

// Calculate responsive minZoom based on screen size
function getResponsiveMinZoom(baseMinZoom: number): number {
  if (typeof window === 'undefined') return baseMinZoom;
  
  const width = window.innerWidth;
  if (width >= 2560) return baseMinZoom + 2; // 4K displays
  if (width >= 1920) return baseMinZoom + 1; // Large displays
  if (width >= 1440) return baseMinZoom + 1; // Medium-large displays
  return baseMinZoom;
}

// Component to fit map bounds to show all vehicles (within restricted area)
function MapBoundsFitter({ vehicles }: { vehicles: VehicleData[] }) {
  const map = useMap();
  
  useEffect(() => {
    if (vehicles.length > 0) {
      const bounds = L.latLngBounds(
        vehicles.map(v => [v.location.lat, v.location.lon])
      );
      map.fitBounds(bounds, { padding: [80, 80], maxZoom: 14 });
    }
  }, [vehicles, map]);
  
  return null;
}

function ZoomHandler({ onZoomChange }: { onZoomChange?: (zoom: number) => void }) {
  const map = useMap();
  
  useEffect(() => {
    if (!onZoomChange) return;
    
    const handleZoom = () => {
      onZoomChange(map.getZoom());
    };
    
    map.on('zoomend', handleZoom);
    return () => {
      map.off('zoomend', handleZoom);
    };
  }, [map, onZoomChange]);
  
  return null;
}

function ZoomSetter({ zoom }: { zoom: number }) {
  const map = useMap();
  
  useEffect(() => {
    if (map.getZoom() !== zoom) {
      map.setZoom(zoom);
    }
  }, [zoom, map]);
  
  return null;
}

// Home Base location - 107 Opportunity Drive, Arlington, SD 57212
const HOME_BASE = {
  lat: 44.3792,
  lon: -97.1406,
  name: "Home Base",
  address: "107 Opportunity Dr, Arlington, SD"
};

// Home Base Icon
const createHomeBaseIcon = () => {
  const iconHtml = renderToString(
    <div className="relative flex items-center justify-center w-12 h-12">
      <div className="relative w-10 h-10 bg-amber-500 rounded-full flex items-center justify-center shadow-lg border-2 border-amber-300"
           style={{ boxShadow: '0 4px 14px rgba(245, 158, 11, 0.4)' }}>
        <Home className="w-5 h-5 text-white" />
      </div>
      <div className="absolute -bottom-2 bg-background/90 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border border-border shadow-sm whitespace-nowrap">
        Home Base
      </div>
    </div>
  );

  return L.divIcon({
    html: iconHtml,
    className: "custom-marker-icon",
    iconSize: [48, 48],
    iconAnchor: [24, 24],
  });
};

// Custom Truck Icon
const createTruckIcon = (heading: number = 0, name: string = "Vehicle", color: string = "#3b82f6") => {
  const iconHtml = renderToString(
    <div className="relative flex items-center justify-center w-12 h-12">
      <div className="absolute inset-0 rounded-full animate-ping" style={{ backgroundColor: `${color}20` }} />
      <div className="relative w-10 h-10 bg-background rounded-full flex items-center justify-center shadow-lg" 
           style={{ 
             transform: `rotate(${heading}deg)`,
             borderWidth: '2px',
             borderColor: color,
             boxShadow: `0 4px 14px ${color}33`
           }}>
        <Truck className="w-5 h-5" style={{ color, fill: `${color}33` }} />
      </div>
      <div className="absolute -bottom-2 bg-background/90 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border border-border shadow-sm whitespace-nowrap">
        {name}
      </div>
    </div>
  );

  return L.divIcon({
    html: iconHtml,
    className: "custom-marker-icon",
    iconSize: [48, 48],
    iconAnchor: [24, 24],
  });
};

const DEFAULT_BOUNDS: MapBounds = {
  southwest: [43.0, -100.5],
  northeast: [45.5, -96.0]
};

const getIconComponent = (iconName: string) => {
  switch (iconName) {
    case "home": return Home;
    case "warehouse": return Warehouse;
    case "building": return Building;
    case "star": return Star;
    case "flag": return Flag;
    default: return MapPin;
  }
};

const createCustomLocationIcon = (name: string, iconName: string = "marker", color: string = "#ef4444") => {
  const IconComponent = getIconComponent(iconName);
  const iconHtml = renderToString(
    <div className="relative flex items-center justify-center w-12 h-12">
      <div className="relative w-10 h-10 rounded-full flex items-center justify-center shadow-lg border-2 border-background"
           style={{ backgroundColor: color, boxShadow: `0 4px 14px ${color}66` }}>
        <IconComponent className="w-5 h-5 text-white" />
      </div>
      <div className="absolute -bottom-2 bg-background/90 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border border-border shadow-sm whitespace-nowrap">
        {name}
      </div>
    </div>
  );

  return L.divIcon({
    html: iconHtml,
    className: "custom-marker-icon",
    iconSize: [48, 48],
    iconAnchor: [24, 24],
  });
};

export default function TrackingMap({ 
  data, 
  onVehicleUpdate, 
  readOnly = false,
  center = [44.25, -98.25],
  zoom = 9,
  minZoom = 8,
  maxZoom = 15,
  bounds = DEFAULT_BOUNDS,
  onZoomChange,
  autoFitBounds = true
}: TrackingMapProps) {
  const [vehicleTrails, setVehicleTrails] = useState<Record<string, Location[]>>({});
  const [loadingTrails, setLoadingTrails] = useState<Set<string>>(new Set());
  const [editingVehicle, setEditingVehicle] = useState<VehicleData | null>(null);
  const [customLocations, setCustomLocations] = useState<CustomLocation[]>([]);

  // Load custom locations on mount
  useEffect(() => {
    const loadCustomLocations = async () => {
      try {
        const response = await fetch("/api/custom-locations");
        if (response.ok) {
          setCustomLocations(await response.json());
        }
      } catch (error) {
        console.error("Error loading custom locations:", error);
      }
    };
    loadCustomLocations();
  }, []);

  // Lazy-load trail only when user clicks on a vehicle (saves API calls)
  const loadTrailForVehicle = async (vehicleId: string) => {
    // Skip if already loaded or currently loading
    if (vehicleTrails[vehicleId] || loadingTrails.has(vehicleId)) {
      return;
    }
    
    setLoadingTrails(prev => new Set(prev).add(vehicleId));
    
    try {
      const response = await fetch(`/api/vehicles/${vehicleId}/history?limit=20`);
      if (response.ok) {
        const history = await response.json();
        setVehicleTrails(prev => ({
          ...prev,
          [vehicleId]: history.map((h: any) => h.location)
        }));
      }
    } catch (error) {
      console.error(`Failed to load trail for ${vehicleId}:`, error);
    } finally {
      setLoadingTrails(prev => {
        const next = new Set(prev);
        next.delete(vehicleId);
        return next;
      });
    }
  };


  const mapBounds: L.LatLngBoundsExpression = [
    bounds.southwest,
    bounds.northeast
  ];

  const responsiveMinZoom = getResponsiveMinZoom(minZoom);
  const responsiveZoom = Math.max(zoom, responsiveMinZoom);

  const handleSaveVehicle = async (vehicleId: string, name: string, color: string) => {
    try {
      const response = await fetch(`/api/vehicles/${vehicleId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, color }),
      });
      
      if (!response.ok) {
        throw new Error("Failed to update vehicle");
      }
      
      if (onVehicleUpdate) {
        onVehicleUpdate();
      }
    } catch (error) {
      console.error("Error updating vehicle:", error);
      throw error;
    }
  };

  return (
    <div className="h-full w-full rounded-xl overflow-hidden border border-border shadow-2xl relative z-0 group">
      <MapContainer
        center={center}
        zoom={responsiveZoom}
        minZoom={responsiveMinZoom}
        maxZoom={maxZoom}
        maxBounds={mapBounds}
        maxBoundsViscosity={1.0}
        scrollWheelZoom={true}
        className="h-full w-full bg-background"
        zoomControl={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />

        {autoFitBounds && <MapBoundsFitter vehicles={data} />}
        <ZoomHandler onZoomChange={onZoomChange} />
        <ZoomSetter zoom={zoom} />

        {data.map((vehicle) => (
          <div key={vehicle.id}>
            {vehicleTrails[vehicle.id] && vehicleTrails[vehicle.id].length > 1 && (
              <Polyline
                positions={vehicleTrails[vehicle.id].map(loc => [loc.lat, loc.lon])}
                pathOptions={{ 
                  color: vehicle.color || "#3b82f6",
                  weight: 3,
                  opacity: 0.6,
                  dashArray: "5, 10"
                }}
              />
            )}
            
            <Marker 
              position={[vehicle.location.lat, vehicle.location.lon]} 
              icon={createTruckIcon(vehicle.heading, vehicle.name || vehicle.id, vehicle.color)}
              eventHandlers={{
                click: () => loadTrailForVehicle(vehicle.id),
              }}
            >
              <Popup className="custom-popup">
                <div className="p-2 min-w-[200px]">
                  <div className="flex items-center gap-2 mb-2 pb-2 border-b border-border">
                    <Truck className="w-4 h-4" style={{ color: vehicle.color }} />
                    <span className="font-bold text-sm">{vehicle.name || vehicle.id}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-y-2 text-xs">
                    <div className="text-muted-foreground">ID</div>
                    <div className="font-mono text-right">{vehicle.id}</div>
                    
                    <div className="text-muted-foreground">Speed</div>
                    <div className="font-mono text-right">{vehicle.speed} mph</div>
                    
                    <div className="text-muted-foreground">Status</div>
                    <div className="font-mono text-right uppercase">{vehicle.status}</div>
                    
                    <div className="text-muted-foreground">Lat/Lon</div>
                    <div className="font-mono text-right text-[10px]">
                      {vehicle.location.lat.toFixed(4)}, {vehicle.location.lon.toFixed(4)}
                    </div>
                  </div>
                </div>
              </Popup>
            </Marker>
          </div>
        ))}

        <Marker 
          position={[HOME_BASE.lat, HOME_BASE.lon]} 
          icon={createHomeBaseIcon()}
          zIndexOffset={1000}
        >
          <Popup className="custom-popup">
            <div className="p-2 min-w-[180px]">
              <div className="flex items-center gap-2 mb-2 pb-2 border-b border-border">
                <Home className="w-4 h-4 text-amber-500" />
                <span className="font-bold text-sm">{HOME_BASE.name}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                {HOME_BASE.address}
              </div>
            </div>
          </Popup>
        </Marker>

        {customLocations.map((location) => {
          const IconComponent = getIconComponent(location.icon || "marker");
          return (
            <Marker
              key={`custom-${location.id}`}
              position={[location.latitude, location.longitude]}
              icon={createCustomLocationIcon(location.name, location.icon || "marker", location.color || "#ef4444")}
              zIndexOffset={500}
            >
              <Popup className="custom-popup">
                <div className="p-2 min-w-[180px]">
                  <div className="flex items-center gap-2 mb-2 pb-2 border-b border-border">
                    <IconComponent className="w-4 h-4" style={{ color: location.color || "#ef4444" }} />
                    <span className="font-bold text-sm">{location.name}</span>
                  </div>
                  {location.description && (
                    <div className="text-xs text-muted-foreground mb-2">
                      {location.description}
                    </div>
                  )}
                  <div className="text-[10px] font-mono text-muted-foreground">
                    {location.latitude.toFixed(4)}, {location.longitude.toFixed(4)}
                  </div>
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>

      {editingVehicle && (
        <EditVehicleDialog
          vehicle={editingVehicle}
          open={!!editingVehicle}
          onOpenChange={(open) => !open && setEditingVehicle(null)}
          onSave={handleSaveVehicle}
        />
      )}
    </div>
  );
}