import { useState, useEffect } from "react";
import TrackingMap from "@/components/TrackingMap";
import { useWebSocket } from "@/hooks/useWebSocket";
import { Radio, MapPin } from "lucide-react";

const SIOUX_FALLS_BOUNDS = {
  southwest: [43.43, -96.96] as [number, number],
  northeast: [43.65, -96.55] as [number, number],
};

const SIOUX_FALLS_CENTER: [number, number] = [43.54, -96.75];
const STORAGE_KEY = "regional-sf-zoom";
const VISIBLE_VEHICLES_KEY = "regional-sf-visible-vehicles";
const DEFAULT_ZOOM = 12;
const MIN_ZOOM = 11;
const MAX_ZOOM = 17;

function getSavedZoom(): number {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const zoom = parseInt(saved, 10);
      if (zoom >= MIN_ZOOM && zoom <= MAX_ZOOM) return zoom;
    }
  } catch (e) {}
  return DEFAULT_ZOOM;
}

function getSavedVisibleVehicles(): Set<string> | null {
  try {
    const saved = localStorage.getItem(VISIBLE_VEHICLES_KEY);
    if (saved) return new Set(JSON.parse(saved));
  } catch (e) {}
  return null;
}

type VehicleEntry = {
  id: string;
  name?: string;
  color?: string;
  location: { lat: number; lon: number };
  speed: number;
  status: string;
  timestamp: string;
  heading: number;
};

export default function RegionalSFMap() {
  const [zoom] = useState(getSavedZoom);
  const [vehicleData, setVehicleData] = useState<VehicleEntry[]>([]);
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set());
  const [initialized, setInitialized] = useState(false);

  const loadVehicles = async () => {
    try {
      const response = await fetch("/api/vehicles");
      if (response.ok) {
        const vehicles: VehicleEntry[] = await response.json();
        setVehicleData(vehicles);
        if (!initialized) {
          const saved = getSavedVisibleVehicles();
          setVisibleIds(saved ?? new Set(vehicles.map((v) => v.id)));
          setInitialized(true);
        }
      }
    } catch (error) {
      console.error("Error loading vehicles:", error);
    }
  };

  useEffect(() => {
    loadVehicles();
  }, []);

  // Re-read visible IDs from localStorage whenever the window regains focus
  // so display board picks up changes made on the settings page
  useEffect(() => {
    const onFocus = () => {
      const saved = getSavedVisibleVehicles();
      if (saved) setVisibleIds(saved);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const { isConnected } = useWebSocket((data) => {
    setVehicleData((prev) => {
      const existingIndex = prev.findIndex((v) => v.id === data.id);
      if (existingIndex >= 0) {
        const updated = [...prev];
        updated[existingIndex] = {
          ...updated[existingIndex],
          location: data.location,
          speed: data.speed,
          status: data.status,
          timestamp: data.timestamp,
          heading: data.heading,
        };
        return updated;
      }
      return [
        ...prev,
        {
          id: data.id,
          name: data.name,
          color: data.color,
          location: data.location,
          speed: data.speed,
          status: data.status,
          timestamp: data.timestamp,
          heading: data.heading,
        },
      ];
    });
  });

  const filteredData = vehicleData.filter((v) => visibleIds.has(v.id));

  return (
    <div className="h-screen w-screen relative bg-background overflow-hidden">
      <TrackingMap
        data={filteredData}
        onVehicleUpdate={loadVehicles}
        center={SIOUX_FALLS_CENTER}
        zoom={zoom}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        bounds={SIOUX_FALLS_BOUNDS}
        onZoomChange={() => {}}
        autoFitBounds={false}
        readOnly
      />

      {/* Minimal status overlay — top left */}
      <div className="absolute top-4 left-4 z-[1000] flex items-center gap-2">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border bg-background/90 backdrop-blur-sm shadow-lg border-primary/30">
          <MapPin className="w-3 h-3 text-primary" />
          <span className="text-[10px] font-mono font-bold uppercase text-primary">
            SF Regional
          </span>
        </div>

        <div
          className={`flex items-center gap-2 px-3 py-1.5 rounded-full border bg-background/90 backdrop-blur-sm shadow-lg ${
            isConnected ? "border-green-500/30" : "border-yellow-500/30"
          }`}
        >
          <Radio
            className={`w-3 h-3 ${
              isConnected ? "text-green-500 animate-pulse" : "text-yellow-500"
            }`}
          />
          <span
            className={`text-[10px] font-mono font-bold uppercase ${
              isConnected ? "text-green-500" : "text-yellow-500"
            }`}
          >
            {isConnected ? "Live" : "Connecting..."}
          </span>
        </div>

        {filteredData.length > 0 && (
          <div className="px-3 py-1.5 rounded-full bg-background/90 backdrop-blur-sm border border-border shadow-lg">
            <span className="text-xs font-mono">
              <span className="text-primary font-bold">{filteredData.length}</span>
              <span className="text-muted-foreground"> tracked</span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
