import { Hono } from 'hono';
import type { UpgradeWebSocket } from 'hono/ws';
import { verifyToken } from '../lib/jwt';
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
    upgradeWebSocket(async (c) => {
      const token = c.req.query('token');
      let payload: JwtPayload | null = null;

      if (token) {
        try {
          payload = await verifyToken<JwtPayload>(token);
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
          const currentPayload = payload;
          // Check blacklist asynchronously, then register or close
          isTokenBlacklisted(currentPayload.jti ?? '').then((blacklisted) => {
            if (blacklisted) {
              ws.close(4001, 'Session revoked');
              return;
            }
            registerConnection(currentPayload.userId, ws);
          }).catch(() => {
            // On Redis error, allow connection (fail-open for WebSocket)
            registerConnection(currentPayload.userId, ws);
          });
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
