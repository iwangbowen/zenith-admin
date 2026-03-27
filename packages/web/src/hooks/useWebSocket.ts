import { useEffect, useRef, useCallback } from 'react';
import { TOKEN_KEY } from '@zenith/shared';
import type { WsMessage } from '@zenith/shared';
import { config } from '@/config';

type MessageHandler = (message: WsMessage) => void;

const MAX_RECONNECT_DELAY = 30_000;
const BASE_RECONNECT_DELAY = 1_000;
const listeners = new Set<MessageHandler>();

let sharedSocket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let reconnectRetries = 0;
let manuallyClosed = false;

function clearReconnectTimer() {
  clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
}

function buildWebSocketUrl() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return null;

  let wsBase = config.wsBaseUrl;
  if (!wsBase) {
    const base = config.apiBaseUrl || globalThis.location.origin;
    wsBase = base.replace(/^http/, 'ws');
  }

  return `${wsBase}/api/ws?token=${encodeURIComponent(token)}`;
}

function notifyListeners(message: WsMessage) {
  for (const listener of listeners) {
    listener(message);
  }
}

function connectSharedSocket() {
  if (sharedSocket && (sharedSocket.readyState === WebSocket.OPEN || sharedSocket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const wsUrl = buildWebSocketUrl();
  if (!wsUrl) return;

  manuallyClosed = false;
  clearReconnectTimer();

  const ws = new WebSocket(wsUrl);
  sharedSocket = ws;

  ws.onopen = () => {
    if (sharedSocket !== ws) return;
    reconnectRetries = 0;
  };

  ws.onmessage = (event) => {
    try {
      const msg: WsMessage = JSON.parse(event.data);
      notifyListeners(msg);
    } catch {
      /* ignore malformed messages */
    }
  };

  ws.onclose = (event) => {
    if (sharedSocket === ws) {
      sharedSocket = null;
    }

    if (manuallyClosed || event.code === 1000 || listeners.size === 0) {
      return;
    }

    const delay = Math.min(BASE_RECONNECT_DELAY * 2 ** reconnectRetries, MAX_RECONNECT_DELAY);
    reconnectRetries += 1;
    reconnectTimer = setTimeout(() => connectSharedSocket(), delay);
  };
}

function disconnectSharedSocket() {
  manuallyClosed = true;
  clearReconnectTimer();

  if (sharedSocket) {
    const ws = sharedSocket;
    sharedSocket = null;
    ws.close(1000, 'logout');
  }
}

/**
 * Generic WebSocket hook with auto-reconnect and exponential backoff.
 * Reuses one shared connection per page and fans out messages to subscribers.
 */
export function useWebSocket(onMessage: MessageHandler) {
  const onMessageRef = useRef(onMessage);

  useEffect(() => {
    onMessageRef.current = onMessage;
  });

  const listener = useCallback((message: WsMessage) => {
    onMessageRef.current(message);
  }, []);

  const disconnect = useCallback(() => {
    disconnectSharedSocket();
  }, []);

  useEffect(() => {
    listeners.add(listener);
    connectSharedSocket();

    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        disconnectSharedSocket();
      }
    };
  }, [listener]);

  return { disconnect };
}
