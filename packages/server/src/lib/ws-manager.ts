import type { WSContext } from 'hono/ws';
import type { WsMessage } from '@zenith/shared';

// userId → Set of active WebSocket connections (supports multi-device)
const connections = new Map<number, Set<WSContext>>();

export function registerConnection(userId: number, ws: WSContext) {
  let set = connections.get(userId);
  if (!set) {
    set = new Set();
    connections.set(userId, set);
  }
  set.add(ws);
}

export function removeConnection(userId: number, ws: WSContext) {
  const set = connections.get(userId);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) connections.delete(userId);
}

/** Send a message to all connections of a specific user */
export function sendToUser(userId: number, message: WsMessage) {
  const set = connections.get(userId);
  if (!set) return;
  const data = JSON.stringify(message);
  for (const ws of set) {
    try {
      ws.send(data);
    } catch { /* connection may be stale */ }
  }
}

/** Broadcast a message to all connected users */
export function broadcast(message: WsMessage) {
  const data = JSON.stringify(message);
  for (const set of connections.values()) {
    for (const ws of set) {
      try {
        ws.send(data);
      } catch { /* ignore */ }
    }
  }
}

/** Close all connections for a specific user (e.g. force logout) */
export function closeUserConnections(userId: number, reason?: string) {
  const set = connections.get(userId);
  if (!set) return;
  for (const ws of set) {
    try {
      ws.close(1000, reason ?? 'force-logout');
    } catch { /* ignore */ }
  }
  connections.delete(userId);
}
