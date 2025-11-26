import { useEffect, useRef } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
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
  location: Location;
  speed: number;
  status: string;
  timestamp: string;
  heading?: number;
}

interface TrackingMapProps {
  data: VehicleData;
}

// Component to update map center when vehicle moves
function MapUpdater({ center }: { center: Location }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo([center.lat, center.lon], map.getZoom());
  }, [center, map]);
  return null;
}

// Custom Truck Icon
const createTruckIcon = (heading: number = 0) => {
  const iconHtml = renderToString(
    <div className="relative flex items-center justify-center w-12 h-12">
      <div className="absolute inset-0 bg-primary/20 rounded-full animate-ping" />
      <div className="relative w-10 h-10 bg-background border-2 border-primary rounded-full flex items-center justify-center shadow-lg shadow-primary/20" 
           style={{ transform: `rotate(${heading}deg)` }}>
        <Truck className="w-5 h-5 text-primary fill-primary/20" />
      </div>
      <div className="absolute -bottom-2 bg-background/90 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border border-border shadow-sm whitespace-nowrap">
        TRUCK-101
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
  const markerRef = useRef<L.Marker>(null);

  return (
    <div className="h-full w-full rounded-xl overflow-hidden border border-border shadow-2xl relative z-0 group">
      <MapContainer
        center={[data.location.lat, data.location.lon]}
        zoom={13}
        scrollWheelZoom={true}
        className="h-full w-full bg-background"
        zoomControl={false}
      >
        {/* Dark Mode Tiles */}
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />

        <MapUpdater center={data.location} />

        <Marker 
          position={[data.location.lat, data.location.lon]} 
          icon={createTruckIcon(data.heading)}
          ref={markerRef}
        >
          <Popup className="custom-popup">
            <div className="p-2 min-w-[200px]">
              <div className="flex items-center gap-2 mb-2 pb-2 border-b border-border">
                <Truck className="w-4 h-4 text-primary" />
                <span className="font-bold text-sm">Vehicle Status</span>
              </div>
              <div className="grid grid-cols-2 gap-y-2 text-xs">
                <div className="text-muted-foreground">ID</div>
                <div className="font-mono text-right">{data.id}</div>
                
                <div className="text-muted-foreground">Speed</div>
                <div className="font-mono text-right">{data.speed} mph</div>
                
                <div className="text-muted-foreground">Status</div>
                <div className="font-mono text-right uppercase text-primary">{data.status}</div>
                
                <div className="text-muted-foreground">Lat/Lon</div>
                <div className="font-mono text-right text-[10px]">
                  {data.location.lat.toFixed(4)}, {data.location.lon.toFixed(4)}
                </div>
              </div>
            </div>
          </Popup>
        </Marker>
      </MapContainer>
      
      {/* Overlay Status Card */}
      <div className="absolute top-4 right-4 z-[1000] bg-card/90 backdrop-blur-md border border-border p-4 rounded-lg shadow-xl w-64 transition-all duration-300 group-hover:translate-y-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-xs font-bold tracking-wider text-muted-foreground uppercase">Live Feed</span>
          </div>
          <span className="text-[10px] font-mono text-muted-foreground opacity-70">
            {new Date(data.timestamp).toLocaleTimeString()}
          </span>
        </div>
        
        <div className="space-y-3">
          <div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Current Location</div>
            <div className="flex items-start gap-2">
              <MapPin className="w-4 h-4 text-primary mt-0.5" />
              <div className="font-mono text-sm">
                {data.location.lat.toFixed(4)}° N <br/>
                {data.location.lon.toFixed(4)}° W
              </div>
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-secondary/50 p-2 rounded border border-border/50">
              <div className="text-[10px] text-muted-foreground mb-1">Speed</div>
              <div className="text-lg font-mono font-bold text-foreground">{data.speed} <span className="text-[10px] font-normal text-muted-foreground">MPH</span></div>
            </div>
            <div className="bg-secondary/50 p-2 rounded border border-border/50">
              <div className="text-[10px] text-muted-foreground mb-1">Heading</div>
              <div className="text-lg font-mono font-bold text-foreground">{data.heading}° <span className="text-[10px] font-normal text-muted-foreground">NE</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}