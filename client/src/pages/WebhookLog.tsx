import { useState, useEffect } from "react";
import { Link } from "wouter";
import { ArrowLeft, RefreshCw, Trash2, Clock, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface WebhookEntry {
  timestamp: string;
  headers: Record<string, string>;
  body: any;
}

interface WebhookResponse {
  count: number;
  webhooks: WebhookEntry[];
}

export default function WebhookLog() {
  const [webhooks, setWebhooks] = useState<WebhookEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const fetchWebhooks = async () => {
    try {
      const response = await fetch("/api/webhooks/debug");
      const data: WebhookResponse = await response.json();
      setWebhooks(data.webhooks);
    } catch (error) {
      console.error("Failed to fetch webhooks:", error);
    } finally {
      setLoading(false);
    }
  };

  const clearWebhooks = async () => {
    try {
      await fetch("/api/webhooks/debug", { method: "DELETE" });
      setWebhooks([]);
    } catch (error) {
      console.error("Failed to clear webhooks:", error);
    }
  };

  useEffect(() => {
    fetchWebhooks();
  }, []);

  useEffect(() => {
    if (autoRefresh) {
      const interval = setInterval(fetchWebhooks, 3000);
      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

  const formatTimestamp = (ts: string) => {
    const date = new Date(ts);
    return date.toLocaleString();
  };

  const getActionBadge = (body: any) => {
    if (Array.isArray(body)) {
      return <Badge variant="outline" className="bg-blue-500/20 text-blue-400">Verification</Badge>;
    }
    const action = body?.action || "unknown";
    if (action.includes("location")) {
      return <Badge variant="outline" className="bg-green-500/20 text-green-400">{action}</Badge>;
    }
    return <Badge variant="outline" className="bg-gray-500/20 text-gray-400">{action}</Badge>;
  };

  const getVehicleInfo = (body: any) => {
    if (Array.isArray(body)) return null;
    const vehicleId = body?.vehicle_id || body?.vehicle?.id || body?.vehicle_number;
    if (!vehicleId) return null;
    return <span className="text-muted-foreground ml-2">Vehicle: {vehicleId}</span>;
  };

  const toggleExpand = (index: number) => {
    setExpandedIndex(expandedIndex === index ? null : index);
  };

  return (
    <div className="min-h-screen bg-background text-foreground p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost" size="sm" data-testid="link-back">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Map
              </Button>
            </Link>
            <h1 className="text-2xl font-bold">Webhook Log</h1>
            <Badge variant="secondary">{webhooks.length} entries</Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant={autoRefresh ? "default" : "outline"}
              size="sm"
              onClick={() => setAutoRefresh(!autoRefresh)}
              data-testid="button-auto-refresh"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${autoRefresh ? "animate-spin" : ""}`} />
              {autoRefresh ? "Auto-Refresh ON" : "Auto-Refresh"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchWebhooks}
              data-testid="button-refresh"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={clearWebhooks}
              data-testid="button-clear"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Clear All
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-64">
            <RefreshCw className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : webhooks.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <Clock className="w-12 h-12 mb-4 opacity-50" />
              <p>No webhooks received yet</p>
              <p className="text-sm">Webhooks will appear here when Motive sends them</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {webhooks.map((webhook, index) => (
              <Card 
                key={index} 
                className="cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => toggleExpand(index)}
                data-testid={`card-webhook-${index}`}
              >
                <CardHeader className="py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {expandedIndex === index ? (
                        <ChevronDown className="w-4 h-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      )}
                      <span className="text-sm font-mono text-muted-foreground">
                        {formatTimestamp(webhook.timestamp)}
                      </span>
                      {getActionBadge(webhook.body)}
                      {getVehicleInfo(webhook.body)}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      #{webhooks.length - index}
                    </span>
                  </div>
                </CardHeader>
                
                {expandedIndex === index && (
                  <CardContent className="pt-0 border-t border-border">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
                      <div>
                        <h4 className="text-sm font-semibold mb-2 text-muted-foreground">Headers</h4>
                        <pre className="bg-muted/50 p-3 rounded-lg text-xs overflow-x-auto max-h-64 overflow-y-auto">
                          {JSON.stringify(webhook.headers, null, 2)}
                        </pre>
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold mb-2 text-muted-foreground">Body</h4>
                        <pre className="bg-muted/50 p-3 rounded-lg text-xs overflow-x-auto max-h-64 overflow-y-auto">
                          {JSON.stringify(webhook.body, null, 2)}
                        </pre>
                      </div>
                    </div>
                    
                    {!Array.isArray(webhook.body) && webhook.body?.lat && (
                      <div className="mt-4 p-3 bg-primary/10 rounded-lg">
                        <h4 className="text-sm font-semibold mb-2">Extracted Location Data</h4>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                          <div>
                            <span className="text-muted-foreground">Lat:</span>{" "}
                            <span className="font-mono">{webhook.body.lat}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Lon:</span>{" "}
                            <span className="font-mono">{webhook.body.lon}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Speed:</span>{" "}
                            <span className="font-mono">{webhook.body.speed || 0} mph</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Heading:</span>{" "}
                            <span className="font-mono">{webhook.body.bearing || 0}°</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </CardContent>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
