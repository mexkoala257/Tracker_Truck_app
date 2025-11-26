import { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import { Truck, Navigation, MapPin } from "lucide-react";
import { renderToString } from "react-dom/server";

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

interface TrackingMapProps {
  data: VehicleData[];
}

// Component to fit map bounds to show all vehicles
function MapBoundsFitter({ vehicles }: { vehicles: VehicleData[] }) {
  const map = useMap();
  
  useEffect(() => {
    if (vehicles.length > 0) {
      const bounds = L.latLngBounds(
        vehicles.map(v => [v.location.lat, v.location.lon])
      );
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 13 });
    }
  }, [vehicles, map]);
  
  return null;
}

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

export default function TrackingMap({ data }: TrackingMapProps) {
  const [vehicleTrails, setVehicleTrails] = useState<Record<string, Location[]>>({});
  const loadedVehicles = useRef<Set<string>>(new Set());

  useEffect(() => {
    const loadTrails = async () => {
      const vehiclesToLoad = data.filter(v => !loadedVehicles.current.has(v.id));
      
      for (const vehicle of vehiclesToLoad) {
        try {
          const response = await fetch(`/api/vehicles/${vehicle.id}/history?limit=20`);
          if (response.ok) {
            const history = await response.json();
            setVehicleTrails(prev => ({
              ...prev,
              [vehicle.id]: history.map((h: any) => h.location)
            }));
            loadedVehicles.current.add(vehicle.id);
          }
        } catch (error) {
          console.error(`Failed to load trail for ${vehicle.id}:`, error);
        }
      }
    };

    loadTrails();
  }, [data.map(v => v.id).join(',')]);

  if (data.length === 0) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-background text-muted-foreground">
        <div className="text-center">
          <Truck className="w-16 h-16 mb-4 mx-auto animate-pulse text-primary/50" />
          <p className="text-sm">No vehicles to display</p>
        </div>
      </div>
    );
  }

  const centerLat = data.reduce((sum, v) => sum + v.location.lat, 0) / data.length;
  const centerLon = data.reduce((sum, v) => sum + v.location.lon, 0) / data.length;

  return (
    <div className="h-full w-full rounded-xl overflow-hidden border border-border shadow-2xl relative z-0 group">
      <MapContainer
        center={[centerLat, centerLon]}
        zoom={13}
        scrollWheelZoom={true}
        className="h-full w-full bg-background"
        zoomControl={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />

        <MapBoundsFitter vehicles={data} />

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
      </MapContainer>
      
      <div className="absolute top-4 right-4 z-[1000] bg-card/90 backdrop-blur-md border border-border p-4 rounded-lg shadow-xl w-64">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-xs font-bold tracking-wider text-muted-foreground uppercase">Live Tracking</span>
          </div>
          <span className="text-[10px] font-mono text-muted-foreground opacity-70">
            {data.length} {data.length === 1 ? 'Vehicle' : 'Vehicles'}
          </span>
        </div>
        
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {data.map((vehicle) => (
            <div key={vehicle.id} className="bg-secondary/50 p-2 rounded border border-border/50">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: vehicle.color }} />
                <div className="text-xs font-bold">{vehicle.name || vehicle.id}</div>
              </div>
              <div className="text-[10px] text-muted-foreground">
                {vehicle.speed} mph • {vehicle.status}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}