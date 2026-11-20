import { useEffect, useRef, useState } from "react";
import { buildAuthenticatedWsUrl, useAuth } from "@/lib/auth";

interface LocationUpdate {
  type: "location_update";
  data: {
    id: string;
    name?: string;
    color?: string;
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

export interface RawWsMessage {
  type: string;
  data?: any;
  payload?: any;
}

export function useWebSocket(
  onMessage?: (data: LocationUpdate["data"]) => void,
  onRawEvent?: (message: RawWsMessage) => void,
) {
  const ws = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const reconnectTimeout = useRef<NodeJS.Timeout | undefined>(undefined);
  const onMessageRef = useRef(onMessage);
  const onRawEventRef = useRef(onRawEvent);
  const { authenticated, scope } = useAuth();

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    onRawEventRef.current = onRawEvent;
  }, [onRawEvent]);

  useEffect(() => {
    if (!authenticated) {
      setIsConnected(false);
      return;
    }

    let shouldReconnect = true;

    const connect = () => {
      const wsUrl = buildAuthenticatedWsUrl();

      ws.current = new WebSocket(wsUrl);

      ws.current.onopen = () => {
        setIsConnected(true);
      };

      ws.current.onmessage = (event) => {
        try {
          const message: RawWsMessage = JSON.parse(event.data);
          if (message.type === "location_update" && message.data && onMessageRef.current) {
            onMessageRef.current(message.data);
          }
          if (onRawEventRef.current) {
            onRawEventRef.current(message);
          }
        } catch (error) {
          console.error("Failed to parse WebSocket message:", error);
        }
      };

      ws.current.onclose = () => {
        setIsConnected(false);

        if (shouldReconnect) {
          reconnectTimeout.current = setTimeout(() => {
            connect();
          }, 3000);
        }
      };

      ws.current.onerror = (error) => {
        console.error("WebSocket error:", error);
      };
    };

    connect();

    return () => {
      shouldReconnect = false;
      if (reconnectTimeout.current) {
        clearTimeout(reconnectTimeout.current);
      }
      if (ws.current) {
        ws.current.close();
      }
    };
  }, [authenticated, scope]);

  return { isConnected };
}
