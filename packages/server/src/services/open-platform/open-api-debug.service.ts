import { randomUUID } from 'node:crypto';
import { HTTPException } from 'hono/http-exception';
import {
  OPEN_SIGNATURE_HEADERS,
  type OpenApiDebugResult,
} from '@zenith/shared';
import { config } from '../../config';
import { httpRequest } from '../../lib/http-client';
import { signRequest } from '../../lib/open-signature';
import { getMyOAuth2Client } from './developer-apps.service';
import { getAppSigningSecret } from './oauth2-clients.service';

const ALLOWED_ENDPOINTS: Record<string, readonly string[]> = {
  '/api/open/v1/ping': ['GET'],
  '/api/open/v1/echo': ['GET', 'POST'],
  '/api/open/v1/userinfo': ['GET'],
};

export async function executeOpenApiDebugRequest(
  appId: number,
  input: {
    method: string;
    path: string;
    query?: Record<string, string>;
    body?: unknown;
  },
): Promise<OpenApiDebugResult> {
  const app = await getMyOAuth2Client(appId);
  const method = input.method.toUpperCase();
  const allowedMethods = ALLOWED_ENDPOINTS[input.path];
  if (!allowedMethods?.includes(method)) {
    throw new HTTPException(400, { message: '不支持的调试端点或请求方法' });
  }

  const url = new URL(input.path, config.openPlatform.internalBaseUrl);
  for (const [key, value] of Object.entries(input.query ?? {})) {
    url.searchParams.append(key, value);
  }

  const rawBody = method === 'GET' ? '' : JSON.stringify(input.body ?? {});
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = randomUUID();
  const headers: Record<string, string> = {
    [OPEN_SIGNATURE_HEADERS.appKey]: app.clientId,
    Accept: 'application/json',
  };
  let stringToSign: string | undefined;
  const secret = await getAppSigningSecret(app.clientId);
  if (secret) {
    const signed = signRequest(secret, {
      method,
      path: url.pathname,
      query: url.search,
      timestamp,
      nonce,
      body: rawBody,
    });
    stringToSign = signed.stringToSign;
    headers[OPEN_SIGNATURE_HEADERS.timestamp] = timestamp;
    headers[OPEN_SIGNATURE_HEADERS.nonce] = nonce;
    headers[OPEN_SIGNATURE_HEADERS.signature] = signed.signature;
  }
  if (rawBody) headers['Content-Type'] = 'application/json';

  const startedAt = Date.now();
  const response = await httpRequest(url.toString(), {
    method,
    headers,
    body: rawBody || undefined,
    timeout: 15_000,
    retries: 0,
    ssrfProtection: false,
    circuitBreaker: false,
    httpLog: { level: 'off' },
  });
  const responseBody = (await response.text()).slice(0, 64 * 1024);
  const responseHeaders: Record<string, string> = {};
  for (const key of ['content-type', 'x-request-id', 'x-zenith-environment', 'retry-after']) {
    const value = response.headers.get(key);
    if (value) responseHeaders[key] = value;
  }

  return {
    requestUrl: url.toString(),
    method,
    requestHeaders: headers,
    stringToSign,
    statusCode: response.status,
    responseHeaders,
    responseBody,
    durationMs: Date.now() - startedAt,
  };
}
