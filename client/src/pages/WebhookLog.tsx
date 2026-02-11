import { useState, useEffect } from "react";
import { Link } from "wouter";
import { ArrowLeft, RefreshCw, Trash2, Clock, ChevronDown, ChevronRight, Zap, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface WebhookEntry {
  timestamp: string;
  headers: Record<string, string>;
  body: any;
}

interface PollResult {
  timestamp: string;
  type: "vehicles" | "assets";
  success: boolean;
  vehicleCount?: number;
  error?: string;
  raw?: any;
}

type ActiveTab = "polls" | "webhooks";

export default function WebhookLog() {
  const [webhooks, setWebhooks] = useState<WebhookEntry[]>([]);
  const [pollResults, setPollResults] = useState<PollResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>("polls");
  const [triggeringPoll, setTriggeringPoll] = useState(false);

  const fetchData = async () => {
    try {
      const [webhookRes, pollRes] = await Promise.all([
        fetch("/api/webhooks/debug"),
        fetch("/api/poll/results"),
      ]);
      const webhookData = await webhookRes.json();
      const pollData = await pollRes.json();
      setWebhooks(webhookData.webhooks || []);
      setPollResults(pollData.results || []);
    } catch (error) {
      console.error("Failed to fetch data:", error);
    } finally {
      setLoading(false);
    }
  };

  const clearWebhooks = async () => {
    await fetch("/api/webhooks/debug", { method: "DELETE" });
    setWebhooks([]);
  };

  const clearPolls = async () => {
    await fetch("/api/poll/results", { method: "DELETE" });
    setPollResults([]);
  };

  const triggerPoll = async () => {
    setTriggeringPoll(true);
    try {
      await fetch("/api/poll/trigger", { method: "POST" });
      await fetchData();
    } catch (error) {
      console.error("Failed to trigger poll:", error);
    } finally {
      setTriggeringPoll(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (autoRefresh) {
      const interval = setInterval(fetchData, 5000);
      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

  const formatTimestamp = (ts: string) => {
    const date = new Date(ts);
    return date.toLocaleString();
  };

  const toggleExpand = (index: number) => {
    setExpandedIndex(expandedIndex === index ? null : index);
  };

  const getWebhookActionBadge = (body: any) => {
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
            <h1 className="text-2xl font-bold">Data Feed Log</h1>
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
              onClick={fetchData}
              data-testid="button-refresh"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
          </div>
        </div>

        <div className="flex gap-2 mb-6">
          <Button
            variant={activeTab === "polls" ? "default" : "outline"}
            onClick={() => { setActiveTab("polls"); setExpandedIndex(null); }}
            data-testid="tab-polls"
          >
            <Radio className="w-4 h-4 mr-2" />
            API Polls
            <Badge variant="secondary" className="ml-2">{pollResults.length}</Badge>
          </Button>
          <Button
            variant={activeTab === "webhooks" ? "default" : "outline"}
            onClick={() => { setActiveTab("webhooks"); setExpandedIndex(null); }}
            data-testid="tab-webhooks"
          >
            <Zap className="w-4 h-4 mr-2" />
            Webhooks (Legacy)
            <Badge variant="secondary" className="ml-2">{webhooks.length}</Badge>
          </Button>
        </div>

        {activeTab === "polls" && (
          <>
            <div className="flex items-center gap-2 mb-4">
              <Button
                variant="outline"
                size="sm"
                onClick={triggerPoll}
                disabled={triggeringPoll}
                data-testid="button-trigger-poll"
              >
                <Radio className={`w-4 h-4 mr-2 ${triggeringPoll ? "animate-pulse" : ""}`} />
                {triggeringPoll ? "Polling..." : "Poll Now"}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={clearPolls}
                data-testid="button-clear-polls"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Clear
              </Button>
              <span className="text-sm text-muted-foreground ml-2">
                Polls every 60 seconds automatically
              </span>
            </div>

            {loading ? (
              <div className="flex items-center justify-center h-64">
                <RefreshCw className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : pollResults.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                  <Radio className="w-12 h-12 mb-4 opacity-50" />
                  <p>No API poll results yet</p>
                  <p className="text-sm">The app polls Motive every 60 seconds</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {pollResults.map((result, index) => (
                  <Card
                    key={index}
                    className="cursor-pointer hover:border-primary/50 transition-colors"
                    onClick={() => toggleExpand(index)}
                    data-testid={`card-poll-${index}`}
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
                            {formatTimestamp(result.timestamp)}
                          </span>
                          <Badge
                            variant="outline"
                            className={result.type === "vehicles"
                              ? "bg-blue-500/20 text-blue-400"
                              : "bg-emerald-500/20 text-emerald-400"
                            }
                          >
                            {result.type}
                          </Badge>
                          {result.success ? (
                            <Badge variant="outline" className="bg-green-500/20 text-green-400">
                              OK - {result.vehicleCount ?? 0} processed
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-red-500/20 text-red-400">
                              Error
                            </Badge>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground">
                          #{pollResults.length - index}
                        </span>
                      </div>
                    </CardHeader>

                    {expandedIndex === index && (
                      <CardContent className="pt-0 border-t border-border">
                        <div className="mt-4">
                          {result.error && (
                            <div className="bg-red-500/10 border border-red-500/30 p-3 rounded-lg mb-3">
                              <h4 className="text-sm font-semibold text-red-400 mb-1">Error</h4>
                              <pre className="text-xs text-red-300 whitespace-pre-wrap">{result.error}</pre>
                            </div>
                          )}
                          {result.raw && (
                            <div>
                              <h4 className="text-sm font-semibold mb-2 text-muted-foreground">Details</h4>
                              <pre className="bg-muted/50 p-3 rounded-lg text-xs overflow-x-auto max-h-64 overflow-y-auto">
                                {JSON.stringify(result.raw, null, 2)}
                              </pre>
                            </div>
                          )}
                        </div>
                      </CardContent>
                    )}
                  </Card>
                ))}
              </div>
            )}
          </>
        )}

        {activeTab === "webhooks" && (
          <>
            <div className="flex items-center gap-2 mb-4">
              <Button
                variant="destructive"
                size="sm"
                onClick={clearWebhooks}
                data-testid="button-clear-webhooks"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Clear
              </Button>
              <span className="text-sm text-muted-foreground ml-2">
                Legacy webhooks - will stop receiving data when Motive disables webhooks
              </span>
            </div>

            {loading ? (
              <div className="flex items-center justify-center h-64">
                <RefreshCw className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : webhooks.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                  <Clock className="w-12 h-12 mb-4 opacity-50" />
                  <p>No webhooks received</p>
                  <p className="text-sm">Webhooks are being phased out in favor of API polling</p>
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
                          {getWebhookActionBadge(webhook.body)}
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
                      </CardContent>
                    )}
                  </Card>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
