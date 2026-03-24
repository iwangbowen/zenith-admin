import { useEffect, useRef, useCallback } from 'react';
import { TOKEN_KEY } from '@zenith/shared';
import type { WsMessage } from '@zenith/shared';
import { config } from '../config';

type MessageHandler = (message: WsMessage) => void;

const MAX_RECONNECT_DELAY = 30_000;
const BASE_RECONNECT_DELAY = 1_000;

/**
 * Generic WebSocket hook with auto-reconnect and exponential backoff.
 * Connects when a valid token exists; disconnects on cleanup.
 */
export function useWebSocket(onMessage: MessageHandler) {
  const wsRef = useRef<WebSocket | null>(null);
  const retriesRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const connect = useCallback(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;

    // Build WebSocket URL from API base
    const base = config.apiBaseUrl || window.location.origin;
    const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const url = new URL(base);
    const wsUrl = `${wsProtocol}://${url.host}/api/ws?token=${encodeURIComponent(token)}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      retriesRef.current = 0;
    };

    ws.onmessage = (event) => {
      try {
        const msg: WsMessage = JSON.parse(event.data);
        onMessageRef.current(msg);
      } catch {
        /* ignore malformed messages */
      }
    };

    ws.onclose = (event) => {
      wsRef.current = null;
      // Don't reconnect if closed cleanly (e.g. user logged out)
      if (event.code === 1000) return;
      // Exponential backoff reconnect
      const delay = Math.min(BASE_RECONNECT_DELAY * 2 ** retriesRef.current, MAX_RECONNECT_DELAY);
      retriesRef.current += 1;
      timerRef.current = setTimeout(() => connect(), delay);
    };
  }, []);

  const disconnect = useCallback(() => {
    clearTimeout(timerRef.current);
    if (wsRef.current) {
      wsRef.current.close(1000, 'logout');
      wsRef.current = null;
    }
  }, []);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  return { disconnect };
}
