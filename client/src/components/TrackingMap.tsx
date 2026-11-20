import { Fragment, useEffect, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
  Polygon,
  CircleMarker,
  Tooltip,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import { Truck, Navigation, MapPin, Home, Warehouse, Star, Flag, Building, ChevronDown, ChevronUp } from "lucide-react";
import { renderToString } from "react-dom/server";

// Fix for Leaflet icon issues in React
import "leaflet/dist/leaflet.css";
import { getMapTileUrlTemplate } from "@/lib/auth";
import {
  type MapBoundingBox,
  FULL_MIDWEST_OVERVIEW_BOUNDS,
  UNLOCKED_NORTH_AMERICA_BOUNDS,
} from "@shared/mapRegions";
import type {
  ResolvedRouteOverlay,
  RouteOverlayStyleMode,
} from "@shared/routeTerritories";
import type { NwsAlertItem } from "@shared/customScreens";
import {
  type WeatherOverlayMode,
  filterWeatherAlertsForMap,
  getWeatherAlertMapStyle,
} from "@shared/weatherOverlay";

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

export interface TrackingMapBaseLocation {
  lat: number;
  lon: number;
  name: string;
  address: string;
}

interface TrackingMapProps {
  data: VehicleData[];
  onVehicleUpdate?: () => void;
  readOnly?: boolean;
  darkMode?: boolean;
  center?: [number, number];
  zoom?: number;
  minZoom?: number;
  maxZoom?: number;
  bounds?: MapBounds;
  /** Fit the map camera to an exact geographic bounding box across any screen aspect ratio / 4K resolution */
  fitRegionBounds?: MapBoundingBox | null;
  /** Unlock regional pan/zoom clamp so nationwide or multi-state areas can be framed freely */
  unlockMaxBounds?: boolean;
  onZoomChange?: (zoom: number) => void;
  autoFitBounds?: boolean;
  baseLocation?: TrackingMapBaseLocation | null;
  /** Colored route territories + town stop sequences to highlight on the map */
  routeOverlays?: ResolvedRouteOverlay[];
  /** Visual rendering mode for route overlays */
  routeStyle?: RouteOverlayStyleMode;
  /** Show compact color key legend in bottom-left when routeOverlays are active */
  showRouteLegend?: boolean;
  /** Optional NWS / demo weather alerts to render as clean shaded warning zones underneath routes */
  weatherAlerts?: NwsAlertItem[];
  /** Filtering tier for weather overlays ("warnings_only" by default) */
  weatherOverlayMode?: WeatherOverlayMode;
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

// Component to fit map bounds to show all vehicles
function MapBoundsFitter({ vehicles }: { vehicles: VehicleData[] }) {
  const map = useMap();

  useEffect(() => {
    map.invalidateSize();
    if (vehicles.length > 0) {
      const bounds = L.latLngBounds(
        vehicles.map((v) => [v.location.lat, v.location.lon]),
      );
      map.fitBounds(bounds, { padding: [55, 55], maxZoom: 14 });
    } else {
      map.fitBounds(
        [
          [FULL_MIDWEST_OVERVIEW_BOUNDS.south, FULL_MIDWEST_OVERVIEW_BOUNDS.west],
          [FULL_MIDWEST_OVERVIEW_BOUNDS.north, FULL_MIDWEST_OVERVIEW_BOUNDS.east],
        ],
        { padding: [24, 24], maxZoom: 12 },
      );
    }
  }, [vehicles, map]);

  return null;
}

// Component to fit map camera to a configured custom/regional bounding box (responsive to container resize, 4K TVs & dynamic Hot Shot zoom rotation)
function RegionBoundsFitter({ region }: { region: MapBoundingBox }) {
  const map = useMap();
  const { south, west, north, east } = region;
  const hasFittedOnceRef = useRef(false);
  const lastAppliedRef = useRef<{ south: number; west: number; north: number; east: number } | null>(
    null,
  );
  const latestRegionRef = useRef(region);
  latestRegionRef.current = region;

  useEffect(() => {
    const prev = lastAppliedRef.current;
    if (
      prev &&
      Math.abs(prev.south - south) < 0.002 &&
      Math.abs(prev.west - west) < 0.002 &&
      Math.abs(prev.north - north) < 0.002 &&
      Math.abs(prev.east - east) < 0.002
    ) {
      return;
    }
    lastAppliedRef.current = { south, west, north, east };

    const isInitial = !hasFittedOnceRef.current;
    hasFittedOnceRef.current = true;

    const applyFit = (animateTransition: boolean) => {
      try {
        map.invalidateSize({ pan: false });
        const target: L.LatLngBoundsExpression = [
          [south, west],
          [north, east],
        ];
        if (animateTransition) {
          map.flyToBounds(target, {
            padding: [28, 28],
            maxZoom: 13.5,
            duration: 0.65,
            easeLinearity: 0.22,
          });
        } else {
          map.fitBounds(target, { padding: [28, 28], maxZoom: 13.5, animate: false });
        }
      } catch {}
    };

    applyFit(!isInitial);
    const timer = isInitial ? setTimeout(() => applyFit(false), 120) : undefined;
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [map, south, west, north, east]);

  useEffect(() => {
    const container = map.getContainer();
    if (!container || typeof ResizeObserver === "undefined") return;
    let skipFirstResize = true;
    const ro = new ResizeObserver(() => {
      if (skipFirstResize) {
        skipFirstResize = false;
        return;
      }
      try {
        const cur = latestRegionRef.current;
        map.invalidateSize({ pan: false });
        map.fitBounds(
          [
            [cur.south, cur.west],
            [cur.north, cur.east],
          ],
          { padding: [22, 22], maxZoom: 14, animate: false },
        );
      } catch {}
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [map]);

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

function MapTileTheme({ darkMode }: { darkMode: boolean }) {
  const map = useMap();

  useEffect(() => {
    const tilePane = map.getPane("tilePane");
    if (!tilePane) return;

    // Streamlined 3-stage filter (down from 5 stages) for much faster Raspberry Pi GPU compositing
    tilePane.style.filter = darkMode
      ? "invert(0.9) hue-rotate(180deg) brightness(0.84)"
      : "";
    tilePane.style.willChange = "transform";

    return () => {
      tilePane.style.filter = "";
      tilePane.style.willChange = "";
    };
  }, [darkMode, map]);

  return null;
}

// Bounded cache of Leaflet DivIcons so React re-renders reuse the exact same L.DivIcon reference
// (prevents ReactDOMServer.renderToString + Leaflet marker DOM rebuilds on every parent render)
const divIconCache = new Map<string, L.DivIcon>();
function getCachedDivIcon(cacheKey: string, build: () => L.DivIcon): L.DivIcon {
  const hit = divIconCache.get(cacheKey);
  if (hit) return hit;
  if (divIconCache.size >= 400) {
    const oldest = divIconCache.keys().next().value;
    if (oldest !== undefined) divIconCache.delete(oldest);
  }
  const created = build();
  divIconCache.set(cacheKey, created);
  return created;
}

// Home Base location - 107 Opportunity Drive, Arlington, SD 57212
const HOME_BASE = {
  lat: 44.3792,
  lon: -97.1406,
  name: "Home Base",
  address: "107 Opportunity Dr, Arlington, SD"
};

// Home Base Icon
const createHomeBaseIcon = (label: string = HOME_BASE.name) =>
  getCachedDivIcon(`home:${label}`, () => {
    const iconHtml = renderToString(
      <div className="relative flex items-center justify-center w-12 h-12">
        <div
          className="relative w-10 h-10 bg-amber-500 rounded-full flex items-center justify-center shadow-lg border-2 border-amber-300"
          style={{ boxShadow: "0 4px 14px rgba(245, 158, 11, 0.4)" }}
        >
          <Home className="w-5 h-5 text-white" />
        </div>
        <div className="absolute -bottom-2 bg-background/90 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border border-border shadow-sm whitespace-nowrap">
          {label}
        </div>
      </div>,
    );

    return L.divIcon({
      html: iconHtml,
      className: "custom-marker-icon",
      iconSize: [48, 48],
      iconAnchor: [24, 24],
    });
  });

// Custom Truck Icon (avoids continuous 60fps animate-ping layers on parked/kiosk markers for Pi GPU smoothness)
const createTruckIcon = (
  heading: number = 0,
  name: string = "Vehicle",
  color: string = "#3b82f6",
  isMoving: boolean = false,
  readOnly: boolean = false,
) => {
  const quantizedHeading = Math.round((heading || 0) / 5) * 5;
  const key = `truck:${name}:${color}:${quantizedHeading}:${isMoving ? 1 : 0}:${readOnly ? 1 : 0}`;
  return getCachedDivIcon(key, () => {
    const iconHtml = renderToString(
      <div className="relative flex items-center justify-center w-12 h-12">
        {isMoving && !readOnly ? (
          <div
            className="absolute inset-0 rounded-full animate-ping"
            style={{ backgroundColor: `${color}20` }}
          />
        ) : isMoving ? (
          <div
            className="absolute inset-0.5 rounded-full"
            style={{
              backgroundColor: `${color}22`,
              border: `1.5px solid ${color}66`,
            }}
          />
        ) : null}
        <div
          className="relative w-10 h-10 bg-background rounded-full flex items-center justify-center shadow-lg"
          style={{
            transform: `rotate(${quantizedHeading}deg)`,
            borderWidth: "2px",
            borderColor: color,
            boxShadow: `0 4px 12px ${color}33`,
          }}
        >
          <Truck className="w-5 h-5" style={{ color, fill: `${color}33` }} />
        </div>
        <div className="absolute -bottom-2 bg-background/90 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border border-border shadow-sm whitespace-nowrap">
          {name}
        </div>
      </div>,
    );

    return L.divIcon({
      html: iconHtml,
      className: "custom-marker-icon",
      iconSize: [48, 48],
      iconAnchor: [24, 24],
    });
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

const createCustomLocationIcon = (
  name: string,
  iconName: string = "marker",
  color: string = "#ef4444",
) =>
  getCachedDivIcon(`loc:${name}:${iconName}:${color}`, () => {
    const IconComponent = getIconComponent(iconName);
    const iconHtml = renderToString(
      <div className="relative flex items-center justify-center w-12 h-12">
        <div
          className="relative w-10 h-10 rounded-full flex items-center justify-center shadow-lg border-2 border-background"
          style={{ backgroundColor: color, boxShadow: `0 4px 14px ${color}66` }}
        >
          <IconComponent className="w-5 h-5 text-white" />
        </div>
        <div className="absolute -bottom-2 bg-background/90 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border border-border shadow-sm whitespace-nowrap">
          {name}
        </div>
      </div>,
    );

    return L.divIcon({
      html: iconHtml,
      className: "custom-marker-icon",
      iconSize: [48, 48],
      iconAnchor: [24, 24],
    });
  });

const createHotShotStopIcon = (
  order: number,
  cityLabel: string,
  completed: boolean,
  routeColor: string,
  darkMode: boolean,
) =>
  getCachedDivIcon(
    `hs:${order}:${cityLabel}:${completed ? 1 : 0}:${routeColor}:${darkMode ? 1 : 0}`,
    () => {
      const badgeBg = completed ? "#10b981" : routeColor || "#f59e0b";
      const ringBorder = completed ? "#34d399" : "#ffffff";
      const labelBg = completed
        ? darkMode
          ? "rgba(6, 78, 59, 0.94)"
          : "rgba(209, 250, 229, 0.96)"
        : darkMode
          ? "rgba(24, 24, 27, 0.92)"
          : "rgba(255, 255, 255, 0.95)";
      const labelColor = completed
        ? darkMode
          ? "#6ee7b7"
          : "#065f46"
        : darkMode
          ? "#f4f4f5"
          : "#18181b";

      const iconHtml = renderToString(
        <div className="relative flex flex-col items-center justify-center" style={{ width: 96, height: 48 }}>
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center font-mono font-extrabold text-xs text-white shadow-md"
            style={{
              backgroundColor: badgeBg,
              border: `2px solid ${ringBorder}`,
              boxShadow: `0 2px 10px ${badgeBg}88`,
            }}
          >
            {completed ? `✓${order}` : order}
          </div>
          <div
            className="mt-0.5 px-1.5 py-0.2 rounded text-[10px] font-mono font-bold shadow-sm whitespace-nowrap border"
            style={{
              backgroundColor: labelBg,
              color: labelColor,
              borderColor: completed ? "#10b98188" : "rgba(128,128,128,0.35)",
            }}
          >
            {cityLabel}
          </div>
        </div>,
      );

      return L.divIcon({
        html: iconHtml,
        className: "custom-marker-icon",
        iconSize: [96, 48],
        iconAnchor: [48, 16],
      });
    },
  );

const createWeatherZoneCalloutIcon = (alert: NwsAlertItem, darkMode: boolean) =>
  getCachedDivIcon(
    `wx:${alert.id}:${alert.event}:${alert.shortArea || alert.areaDesc}:${alert.isDemo ? 1 : 0}:${darkMode ? 1 : 0}`,
    () => {
      const style = getWeatherAlertMapStyle(alert, darkMode);
      const bg = darkMode ? "rgba(15, 23, 42, 0.88)" : "rgba(255, 255, 255, 0.94)";
      const titleColor = darkMode ? "#ffffff" : "#0f172a";
      const subColor = darkMode ? "rgba(226, 232, 240, 0.88)" : "rgba(51, 65, 85, 0.92)";

      const iconHtml = renderToString(
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
            width: 210,
          }}
        >
          <div
            style={{
              backgroundColor: bg,
              border: `1.5px solid ${style.strokeColor}`,
              boxShadow: `0 3px 12px rgba(0,0,0,0.38)`,
              borderRadius: 6,
              padding: "3px 8px",
              maxWidth: 206,
              textAlign: "center",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 4,
                fontSize: 10.5,
                fontWeight: 800,
                letterSpacing: "0.04em",
                color: titleColor,
                lineHeight: 1.2,
                whiteSpace: "nowrap",
              }}
            >
              <span>{style.icon}</span>
              <span style={{ color: style.strokeColor }}>{style.badgeTitle}</span>
              {alert.isDemo && (
                <span
                  style={{
                    fontSize: 8.5,
                    padding: "0.5px 4px",
                    borderRadius: 3,
                    backgroundColor: style.strokeColor,
                    color: "#ffffff",
                    fontWeight: 800,
                  }}
                >
                  DEMO
                </span>
              )}
            </div>
            {style.badgeSublabel && (
              <div
                style={{
                  fontSize: 9,
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  fontWeight: 600,
                  color: subColor,
                  lineHeight: 1.2,
                  marginTop: 1,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {style.badgeSublabel}
              </div>
            )}
          </div>
        </div>,
      );

      return L.divIcon({
        html: iconHtml,
        className: "custom-marker-icon",
        iconSize: [210, 38],
        iconAnchor: [105, 19],
      });
    },
  );

function computeFallbackAlertCentroid(
  polygons: Array<Array<[number, number]>>,
): [number, number] | null {
  let minLat = 90;
  let maxLat = -90;
  let minLon = 180;
  let maxLon = -180;
  let count = 0;
  for (const ring of polygons) {
    for (const pt of ring) {
      if (!Array.isArray(pt) || pt.length < 2) continue;
      if (pt[0] < minLat) minLat = pt[0];
      if (pt[0] > maxLat) maxLat = pt[0];
      if (pt[1] < minLon) minLon = pt[1];
      if (pt[1] > maxLon) maxLon = pt[1];
      count++;
    }
  }
  return count > 0 ? [(minLat + maxLat) / 2, (minLon + maxLon) / 2] : null;
}

export default function TrackingMap({ 
  data, 
  onVehicleUpdate, 
  readOnly = false,
  darkMode = true,
  center = [44.25, -98.25],
  zoom = 9,
  minZoom = 8,
  maxZoom = 15,
  bounds = DEFAULT_BOUNDS,
  fitRegionBounds = null,
  unlockMaxBounds = false,
  onZoomChange,
  autoFitBounds = true,
  baseLocation = HOME_BASE,
  routeOverlays = [],
  routeStyle = "zones_and_sequence",
  showRouteLegend = true,
  weatherAlerts = [],
  weatherOverlayMode = "warnings_only",
}: TrackingMapProps) {
  const [vehicleTrails, setVehicleTrails] = useState<Record<string, Location[]>>({});
  const [loadingTrails, setLoadingTrails] = useState<Set<string>>(new Set());
  const [customLocations, setCustomLocations] = useState<CustomLocation[]>([]);
  const [legendCollapsed, setLegendCollapsed] = useState(false);

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


  const usesDynamicRegion = Boolean(fitRegionBounds) || autoFitBounds || unlockMaxBounds;
  const effectiveBounds = usesDynamicRegion ? UNLOCKED_NORTH_AMERICA_BOUNDS : bounds;

  const mapBounds: L.LatLngBoundsExpression = [
    effectiveBounds.southwest,
    effectiveBounds.northeast,
  ];

  const responsiveMinZoom = usesDynamicRegion ? 4 : getResponsiveMinZoom(minZoom);
  const responsiveZoom = Math.max(zoom, responsiveMinZoom);

  return (
    <div className="h-full w-full rounded-xl overflow-hidden border border-border shadow-2xl relative z-0 group">
      <MapContainer
        center={center}
        zoom={responsiveZoom}
        minZoom={responsiveMinZoom}
        maxZoom={Math.max(maxZoom, 17)}
        zoomSnap={readOnly ? 0.5 : 0.25}
        zoomDelta={0.5}
        wheelPxPerZoomLevel={110}
        wheelDebounceTime={35}
        zoomAnimation={true}
        fadeAnimation={true}
        markerZoomAnimation={true}
        maxBounds={mapBounds}
        maxBoundsViscosity={usesDynamicRegion ? 0.6 : 1.0}
        scrollWheelZoom={!readOnly}
        preferCanvas={true}
        className="h-full w-full bg-background"
        zoomControl={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url={getMapTileUrlTemplate()}
          maxZoom={19}
          keepBuffer={4}
          updateWhenZooming={false}
        />

        <MapTileTheme darkMode={darkMode} />
        {fitRegionBounds ? (
          <RegionBoundsFitter region={fitRegionBounds} />
        ) : autoFitBounds ? (
          <MapBoundsFitter vehicles={data} />
        ) : (
          <ZoomSetter zoom={zoom} />
        )}
        <ZoomHandler onZoomChange={onZoomChange} />

        {/* Clean Severe Weather Warning Zones (rendered underneath routes & fleet units) */}
        {filterWeatherAlertsForMap(weatherAlerts, weatherOverlayMode).map((alert) => {
          const style = getWeatherAlertMapStyle(alert, darkMode);
          const rings = (alert.polygons || []).filter((r) => Array.isArray(r) && r.length >= 3);
          if (rings.length === 0) return null;
          const badgePos = alert.centroid || computeFallbackAlertCentroid(rings);

          return (
            <Fragment key={`weather-zone-${alert.id}`}>
              {rings.map((ring, rIdx) => (
                <Polygon
                  key={`weather-ring-${alert.id}-${rIdx}`}
                  positions={ring}
                  interactive={false}
                  pathOptions={{
                    color: style.strokeColor,
                    weight: style.weight,
                    opacity: 0.85,
                    fillColor: style.fillColor,
                    fillOpacity: style.fillOpacity,
                    dashArray: style.dashArray,
                  }}
                />
              ))}
              {badgePos && (
                <Marker
                  position={badgePos}
                  icon={createWeatherZoneCalloutIcon(alert, darkMode)}
                  interactive={false}
                  zIndexOffset={-150}
                />
              )}
            </Fragment>
          );
        })}

        {/* Colored Route Territory Zones, Ordered Town Sequences & Stop Markers */}
        {routeOverlays.map((route) => {
          const isHotShot = Boolean(route.isHotShot);
          const showZone = !isHotShot && routeStyle !== "sequence_only" && route.polygon.length >= 3;
          const showSequence =
            isHotShot ? route.stops.length >= 1 : routeStyle !== "zones_only" && route.stops.length >= 2;
          const hotShotOrigin = route.originLocation || baseLocation;
          const polylineCoords: Array<[number, number]> =
            isHotShot && hotShotOrigin
              ? [
                  [hotShotOrigin.lat, hotShotOrigin.lon],
                  ...route.stops.map((s): [number, number] => [s.lat, s.lon]),
                  [hotShotOrigin.lat, hotShotOrigin.lon],
                ]
              : route.stops.map((s): [number, number] => [s.lat, s.lon]);

          return (
            <Fragment key={`route-overlay-${route.id}`}>
              {showZone && (
                <Polygon
                  positions={route.polygon}
                  interactive={!readOnly}
                  pathOptions={{
                    color: route.color,
                    weight: 1.75,
                    opacity: 0.72,
                    fillColor: route.color,
                    fillOpacity: darkMode ? 0.15 : 0.18,
                    dashArray: "6, 4",
                  }}
                >
                  {!readOnly && (
                    <Tooltip sticky>
                      <div className="text-xs leading-snug">
                        <div className="font-bold">{route.name}</div>
                        {route.assignedDriver && (
                          <div className="text-[11px] opacity-80">
                            {route.assignedDriver}
                            {route.scheduleCellText ? ` • ${route.scheduleCellText}` : ""}
                          </div>
                        )}
                        <div className="text-[10px] opacity-70">{route.stops.length} towns in sequence</div>
                      </div>
                    </Tooltip>
                  )}
                </Polygon>
              )}

              {showSequence && polylineCoords.length >= 2 && (
                <Polyline
                  positions={polylineCoords}
                  interactive={false}
                  pathOptions={{
                    color: route.color,
                    weight: isHotShot ? 3.5 : 2.5,
                    opacity: isHotShot ? 0.92 : 0.88,
                    ...(isHotShot ? { dashArray: "8, 6" } : {}),
                  }}
                />
              )}

              {route.stops.map((stop, idx) =>
                isHotShot ? (
                  <Marker
                    key={`hs-stop-${route.id}-${idx}-${stop.name}`}
                    position={[stop.lat, stop.lon]}
                    interactive={!readOnly}
                    icon={createHotShotStopIcon(
                      stop.stopOrder || idx + 1,
                      stop.name,
                      Boolean(stop.completed),
                      route.color,
                      darkMode,
                    )}
                    zIndexOffset={stop.completed ? 650 : 750}
                  >
                    {!readOnly && (
                      <Tooltip direction="top" offset={[0, -10]}>
                        <div className="text-xs leading-snug">
                          <div className="font-bold">
                            #{stop.stopOrder || idx + 1} {stop.name}, {stop.state}
                            {stop.completed ? " ✓ COMPLETED" : ""}
                          </div>
                          {stop.accountName && (
                            <div className="text-[11px] font-semibold">{stop.accountName}</div>
                          )}
                          {stop.address && (
                            <div className="text-[10px] opacity-80">{stop.address}</div>
                          )}
                          <div className="text-[10px] opacity-75 mt-0.5">
                            {route.assignedDriver || route.name}
                          </div>
                        </div>
                      </Tooltip>
                    )}
                  </Marker>
                ) : (
                  <CircleMarker
                    key={`stop-${route.id}-${idx}-${stop.name}`}
                    center={[stop.lat, stop.lon]}
                    radius={stop.anchor ? 5.8 : 3.6}
                    interactive={!readOnly}
                    pathOptions={{
                      color: stop.anchor ? "#fbbf24" : darkMode ? "#0f172a" : "#ffffff",
                      weight: stop.anchor ? 2.2 : 1.4,
                      fillColor: route.color,
                      fillOpacity: 0.96,
                    }}
                  >
                    {!readOnly && (
                      <Tooltip direction="top" offset={[0, -5]}>
                        <div className="text-xs leading-snug">
                          <div className="font-bold">
                            #{idx + 1} {stop.name}, {stop.state}
                            {stop.anchor ? " ★" : ""}
                          </div>
                          <div className="text-[11px] opacity-85">
                            {route.name}
                            {route.assignedDriver ? ` (${route.assignedDriver})` : ""}
                          </div>
                          {stop.anchor && (
                            <div className="text-[10px] text-amber-600 font-semibold">
                              Highlighted Anchor / Turnaround Town
                            </div>
                          )}
                        </div>
                      </Tooltip>
                    )}
                  </CircleMarker>
                ),
              )}
            </Fragment>
          );
        })}

        {data.map((vehicle) => {
          const isVehicleMoving = vehicle.status === "moving" || vehicle.speed > 2;
          return (
            <Fragment key={vehicle.id}>
              {vehicleTrails[vehicle.id] && vehicleTrails[vehicle.id].length > 1 && (
                <Polyline
                  positions={vehicleTrails[vehicle.id].map((loc) => [loc.lat, loc.lon])}
                  interactive={false}
                  pathOptions={{
                    color: vehicle.color || "#3b82f6",
                    weight: 3,
                    opacity: 0.6,
                    dashArray: "5, 10",
                  }}
                />
              )}

              <Marker
                position={[vehicle.location.lat, vehicle.location.lon]}
                interactive={!readOnly}
                icon={createTruckIcon(
                  vehicle.heading,
                  vehicle.name || vehicle.id,
                  vehicle.color,
                  isVehicleMoving,
                  readOnly,
                )}
                eventHandlers={
                  readOnly
                    ? undefined
                    : {
                        click: () => loadTrailForVehicle(vehicle.id),
                      }
                }
              >
                {!readOnly && (
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
                )}
              </Marker>
            </Fragment>
          );
        })}

        {baseLocation && (
          <Marker
            position={[baseLocation.lat, baseLocation.lon]}
            interactive={!readOnly}
            icon={createHomeBaseIcon(baseLocation.name)}
            zIndexOffset={1000}
          >
            {!readOnly && (
              <Popup className="custom-popup">
                <div className="p-2 min-w-[180px]">
                  <div className="flex items-center gap-2 mb-2 pb-2 border-b border-border">
                    <Home className="w-4 h-4 text-amber-500" />
                    <span className="font-bold text-sm">{baseLocation.name}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {baseLocation.address}
                  </div>
                </div>
              </Popup>
            )}
          </Marker>
        )}

        {customLocations.map((location) => {
          const duplicatesBaseLocation =
            baseLocation &&
            Math.abs(location.latitude - baseLocation.lat) < 0.000001 &&
            Math.abs(location.longitude - baseLocation.lon) < 0.000001;
          if (duplicatesBaseLocation) return null;

          const IconComponent = getIconComponent(location.icon || "marker");
          return (
            <Marker
              key={`custom-${location.id}`}
              position={[location.latitude, location.longitude]}
              interactive={!readOnly}
              icon={createCustomLocationIcon(location.name, location.icon || "marker", location.color || "#ef4444")}
              zIndexOffset={500}
            >
              {!readOnly && (
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
              )}
            </Marker>
          );
        })}
      </MapContainer>

      {showRouteLegend && routeOverlays.length > 0 && (
        <div
          className={`absolute bottom-2.5 left-2.5 z-[900] max-w-[270px] rounded-md border px-2.5 py-1.5 shadow-lg backdrop-blur-md transition-all ${
            darkMode
              ? "bg-zinc-950/88 border-zinc-700/80 text-zinc-100"
              : "bg-white/92 border-zinc-300 text-zinc-900"
          }`}
        >
          <button
            type="button"
            onClick={() => setLegendCollapsed((prev) => !prev)}
            className="flex w-full items-center justify-between gap-2 text-left"
          >
            <span className="text-[10px] font-bold uppercase tracking-wider opacity-85">
              Route Color Key ({routeOverlays.length})
            </span>
            {legendCollapsed ? (
              <ChevronUp className="w-3.5 h-3.5 opacity-70" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 opacity-70" />
            )}
          </button>

          {!legendCollapsed && (
            <div className="mt-1.5 max-h-[155px] overflow-y-auto pr-1 space-y-1">
              {routeOverlays.map((r) => (
                <div key={`leg-${r.id}`} className="flex items-center justify-between gap-2 text-[11px] leading-tight">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span
                      className="w-2.5 h-2.5 rounded-sm shrink-0 border border-black/20"
                      style={{ backgroundColor: r.color }}
                    />
                    <span className="font-semibold truncate">
                      {r.name.replace(/\s*\([^)]*\)\s*$/, "")}
                    </span>
                  </div>
                  {r.assignedDriver && (
                    <span className="text-[10px] font-mono opacity-70 shrink-0">
                      {r.assignedDriver.replace(/^T0\d-/, "")}
                    </span>
                  )}
                </div>
              ))}
              <div className="pt-1 mt-1 border-t border-current/10 flex items-center gap-1.5 text-[9.5px] opacity-70">
                <span className="inline-block w-2 h-2 rounded-full border-2 border-amber-400 bg-sky-400" />
                <span>Gold ring = Anchor town</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}