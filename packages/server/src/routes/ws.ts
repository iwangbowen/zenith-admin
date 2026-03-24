import { Hono } from 'hono';
import jwt from 'jsonwebtoken';
import type { UpgradeWebSocket } from 'hono/ws';
import { config } from '../config';
import type { JwtPayload } from '../middleware/auth';
import { isTokenBlacklisted } from '../lib/session-manager';
import { registerConnection, removeConnection } from '../lib/ws-manager';

/**
 * Create the WebSocket route.
 * Requires `upgradeWebSocket` from `createNodeWebSocket`.
 */
export function createWsRoute(upgradeWebSocket: UpgradeWebSocket) {
  const wsApp = new Hono();

  wsApp.get(
    '/',
    upgradeWebSocket((c) => {
      const token = c.req.query('token');
      let payload: JwtPayload | null = null;

      if (token) {
        try {
          payload = jwt.verify(token, config.jwtSecret) as JwtPayload;
          if (payload.jti && isTokenBlacklisted(payload.jti)) {
            payload = null;
          }
        } catch {
          payload = null;
        }
      }

      return {
        onOpen(_evt, ws) {
          if (!payload) {
            ws.close(4001, 'Unauthorized');
            return;
          }
          registerConnection(payload.userId, ws);
        },
        onClose(_evt, ws) {
          if (payload) {
            removeConnection(payload.userId, ws);
          }
        },
        onError() {
          // handled by node-ws internally
        },
      };
    }),
  );

  return wsApp;
}
