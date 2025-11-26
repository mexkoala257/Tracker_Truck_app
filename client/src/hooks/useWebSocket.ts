import { useEffect, useRef, useState } from "react";

interface LocationUpdate {
  type: "location_update";
  data: {
    id: string;
    location: {
      lat: number;
      lon: number;
    };
    speed: number;
    heading: number;
    status: string;
    timestamp: string;
  };
}

export function useWebSocket(onMessage: (data: LocationUpdate["data"]) => void) {
  const ws = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const reconnectTimeout = useRef<NodeJS.Timeout | undefined>(undefined);

  useEffect(() => {
    const connect = () => {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      
      ws.current = new WebSocket(wsUrl);

      ws.current.onopen = () => {
        console.log("WebSocket connected");
        setIsConnected(true);
      };

      ws.current.onmessage = (event) => {
        try {
          const message: LocationUpdate = JSON.parse(event.data);
          if (message.type === "location_update") {
            onMessage(message.data);
          }
        } catch (error) {
          console.error("Failed to parse WebSocket message:", error);
        }
      };

      ws.current.onclose = () => {
        console.log("WebSocket disconnected");
        setIsConnected(false);
        
        // Attempt to reconnect after 3 seconds
        reconnectTimeout.current = setTimeout(() => {
          console.log("Attempting to reconnect...");
          connect();
        }, 3000);
      };

      ws.current.onerror = (error) => {
        console.error("WebSocket error:", error);
      };
    };

    connect();

    return () => {
      if (reconnectTimeout.current) {
        clearTimeout(reconnectTimeout.current);
      }
      if (ws.current) {
        ws.current.close();
      }
    };
  }, [onMessage]);

  return { isConnected };
}
