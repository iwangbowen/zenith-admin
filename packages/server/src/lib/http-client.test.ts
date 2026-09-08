import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { httpRequest } from './http-client';

const servers = new Set<Server>();

async function endpoint(): Promise<string> {
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/fast') {
      res.end('{"ok":true}');
      return;
    }
    res.flushHeaders();
    res.write('{"ok":');
    const timer = setTimeout(() => res.end('true}'), 3000);
    res.once('close', () => clearTimeout(timer));
  });
  servers.add(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test address');
  const base = `http://127.0.0.1:${address.port}`;
  const warm = await httpRequest(`${base}/fast`, { timeout: 2000, circuitBreaker: false });
  await warm.text();
  return base;
}

afterEach(async () => {
  await Promise.all([...servers].map(async (server) => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }));
  servers.clear();
});

describe('outbound response lifetime', () => {
  it('keeps the hard timeout active until the response body completes', async () => {
    const base = await endpoint();
    const response = await httpRequest(`${base}/slow`, { timeout: 500, circuitBreaker: false });
    expect(response.status).toBe(200);
    await expect(response.text()).rejects.toThrow();
  });

  it('propagates a caller lease cancellation after response headers arrive', async () => {
    const base = await endpoint();
    const controller = new AbortController();
    const response = await httpRequest(`${base}/slow`, { signal: controller.signal, circuitBreaker: false });
    const reader = response.raw.body!.getReader();
    expect((await reader.read()).done).toBe(false);
    controller.abort(new Error('lease lost'));
    await expect(reader.read()).rejects.toThrow();
  });

  it('preserves native response metadata and JSON consumption', async () => {
    const base = await endpoint();
    const response = await httpRequest(`${base}/fast`, { timeout: 1000, circuitBreaker: false });
    expect(response.raw.url).toBe(`${base}/fast`);
    expect(response.raw.status).toBe(200);
    expect(response.raw.headers.get('content-type')).toBe('application/json');
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it('supports cancelling the raw stream without waiting for its deadline', async () => {
    const base = await endpoint();
    const response = await httpRequest(`${base}/slow`, { timeout: 10_000, circuitBreaker: false });
    await expect(response.raw.body!.cancel()).resolves.toBeUndefined();
  });
});
