import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Send, Play, Pause, RotateCw, RefreshCw, Code } from "lucide-react";
import { Slider } from "@/components/ui/slider";

interface Location {
  lat: number;
  lon: number;
}

interface WebhookPayload {
  vehicle_id: string;
  location: Location;
  speed: number;
  status: string;
  timestamp: string;
  heading: number;
}

interface WebhookSimulatorProps {
  onWebhookTrigger: (payload: WebhookPayload) => void;
  currentData: any;
}

export default function WebhookSimulator({ onWebhookTrigger, currentData }: WebhookSimulatorProps) {
  const [lat, setLat] = useState<string>(currentData.location.lat.toString());
  const [lon, setLon] = useState<string>(currentData.location.lon.toString());
  const [speed, setSpeed] = useState<string>(currentData.speed.toString());
  const [status, setStatus] = useState<string>(currentData.status);
  const [heading, setHeading] = useState<number>(currentData.heading || 0);
  const [autoPlay, setAutoPlay] = useState(false);

  // Effect to update inputs if currentData changes externally (optional, avoiding loop)
  useEffect(() => {
    setLat(currentData.location.lat.toString());
    setLon(currentData.location.lon.toString());
    setSpeed(currentData.speed.toString());
    setStatus(currentData.status);
    setHeading(currentData.heading || 0);
  }, [currentData.timestamp]); // Only update when timestamp changes to avoid typing conflicts

  const handleSend = () => {
    const payload: WebhookPayload = {
      vehicle_id: "Truck-101",
      location: {
        lat: parseFloat(lat),
        lon: parseFloat(lon)
      },
      speed: parseInt(speed),
      status: status,
      timestamp: new Date().toISOString(),
      heading: heading
    };
    onWebhookTrigger(payload);
  };

  // Simulation loop
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (autoPlay) {
      interval = setInterval(() => {
        setLat(prev => (parseFloat(prev) + 0.0005).toFixed(6));
        setLon(prev => (parseFloat(prev) + 0.0005).toFixed(6));
        setHeading(prev => (prev + 2) % 360);
        // Trigger send automatically in effect? 
        // Better to just call the prop directly here to avoid render loop issues with local state
        const newLat = parseFloat(lat) + 0.0005;
        const newLon = parseFloat(lon) + 0.0005;
        
        onWebhookTrigger({
          vehicle_id: "Truck-101",
          location: { lat: newLat, lon: newLon },
          speed: 65,
          status: "moving",
          timestamp: new Date().toISOString(),
          heading: (heading + 5) % 360
        });
      }, 2000);
    }
    return () => clearInterval(interval);
  }, [autoPlay, lat, lon, heading, onWebhookTrigger]);

  return (
    <div className="h-full flex flex-col gap-4">
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-primary/10 rounded-md text-primary">
                <Code className="w-4 h-4" />
              </div>
              <div>
                <CardTitle className="text-sm font-medium">Motive Webhook Simulator</CardTitle>
                <CardDescription className="text-xs">Simulate incoming GPS events</CardDescription>
              </div>
            </div>
            <div className="flex gap-1">
               <Button 
                variant="outline" 
                size="icon" 
                className={`h-8 w-8 ${autoPlay ? 'bg-green-500/10 text-green-500 border-green-500/20' : ''}`}
                onClick={() => setAutoPlay(!autoPlay)}
                title="Auto-simulate movement"
              >
                {autoPlay ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Latitude</Label>
              <Input 
                value={lat} 
                onChange={(e) => setLat(e.target.value)} 
                className="font-mono text-xs h-8 bg-secondary/50 border-border/50"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Longitude</Label>
              <Input 
                value={lon} 
                onChange={(e) => setLon(e.target.value)} 
                className="font-mono text-xs h-8 bg-secondary/50 border-border/50"
              />
            </div>
          </div>

          <div className="space-y-3">
             <div className="space-y-1.5">
              <div className="flex justify-between">
                <Label className="text-xs text-muted-foreground">Heading ({heading}°)</Label>
              </div>
              <Slider 
                value={[heading]} 
                max={360} 
                step={1} 
                onValueChange={(vals) => setHeading(vals[0])}
                className="py-1"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Speed (mph)</Label>
              <Input 
                value={speed} 
                onChange={(e) => setSpeed(e.target.value)} 
                type="number"
                className="font-mono text-xs h-8 bg-secondary/50 border-border/50"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="h-8 text-xs bg-secondary/50 border-border/50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="moving">Moving</SelectItem>
                  <SelectItem value="idling">Idling</SelectItem>
                  <SelectItem value="stopped">Stopped</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button className="w-full h-9 text-xs font-medium gap-2 mt-2" onClick={handleSend}>
            <Send className="w-3.5 h-3.5" />
            Send Webhook Event
          </Button>
        </CardContent>
      </Card>

      <Card className="flex-1 border-border/50 bg-card/50 backdrop-blur-sm min-h-0 flex flex-col">
        <CardHeader className="py-3 border-b border-border/40">
          <CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Payload Preview</CardTitle>
        </CardHeader>
        <CardContent className="flex-1 p-0 min-h-0 relative overflow-hidden">
          <div className="absolute inset-0 p-3 overflow-auto">
            <pre className="text-[10px] font-mono text-primary/80 leading-relaxed">
{JSON.stringify({
  event_type: "location_update",
  data: {
    vehicle_id: "Truck-101",
    location: {
      lat: parseFloat(lat),
      lon: parseFloat(lon)
    },
    speed: parseInt(speed),
    status: status,
    timestamp: new Date().toISOString(),
    heading: heading
  }
}, null, 2)}
            </pre>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}