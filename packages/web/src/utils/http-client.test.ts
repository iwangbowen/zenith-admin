import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpClient } from './http-client';

vi.mock('./request-toast', () => ({ showRequestErrorToast: vi.fn(), showRequestWarningToast: vi.fn() }));

const fetchMock = vi.fn<typeof fetch>();
const headerForms = [
  { name: 'object', create: (values: Record<string, string>): HeadersInit => ({ ...values }) },
  { name: 'Headers', create: (values: Record<string, string>): HeadersInit => new Headers(values) },
  { name: 'tuples', create: (values: Record<string, string>): HeadersInit => Object.entries(values) },
];

function createClient(tokenKey = 'access-token') {
  return new HttpClient({
    baseUrl: '',
    tokenKey,
    refreshTokenKey: 'refresh-token',
    refreshPath: '/refresh',
    loginUrl: () => '/login',
  });
}

function sentOptions(index = 0): RequestInit {
  const options = fetchMock.mock.calls[index]?.[1];
  expect(options).toBeDefined();
  return options!;
}

beforeEach(() => {
  localStorage.clear();
  fetchMock.mockReset().mockImplementation(async () => Response.json({ code: 0, message: 'ok', data: null }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

class TestHttpClient extends HttpClient {
  invalidateAuthentication(): void {
    this.clearAuthAndRedirect();
  }
}

describe('HttpClient unauthorized handling', () => {
  it('clears credentials and delegates navigation to the host callback', () => {
    const onUnauthorized = vi.fn();
    localStorage.setItem('access-token', 'access');
    localStorage.setItem('refresh-token', 'refresh');
    const client = new TestHttpClient({
      baseUrl: '',
      tokenKey: 'access-token',
      refreshTokenKey: 'refresh-token',
      refreshPath: '/refresh',
      loginUrl: () => '/login',
      onUnauthorized,
    });

    client.invalidateAuthentication();

    expect(localStorage.getItem('access-token')).toBeNull();
    expect(localStorage.getItem('refresh-token')).toBeNull();
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });
});

describe.each(['request', 'fetchRaw'] as const)('HttpClient.%s headers', (method) => {
  it.each(headerForms)('accepts $name headers without mutating the input', async ({ create }) => {
    localStorage.setItem('access-token', 'current-token');
    const headers = create({ 'X-Idempotency-Key': 'intent-0001', 'X-Trace': 'trace-1' });
    const original = Array.from(new Headers(headers));

    await createClient()[method]('/resource', { method: 'POST', body: '{}', headers });

    expect(Object.fromEntries(new Headers(sentOptions().headers))).toEqual({
      authorization: 'Bearer current-token',
      'content-type': 'application/json',
      'x-idempotency-key': 'intent-0001',
      'x-trace': 'trace-1',
    });
    expect(Array.from(new Headers(headers))).toEqual(original);
  });

  it('overrides the default content type without a case-sensitive duplicate', async () => {
    await createClient()[method]('/resource', {
      method: 'POST', body: 'plain text', headers: { 'content-type': 'text/plain' },
    });
    expect(new Headers(sentOptions().headers).get('content-type')).toBe('text/plain');
  });

  it('uses only the configured account token, regardless of caller header casing', async () => {
    localStorage.setItem('access-token', 'admin-token');
    localStorage.setItem('member-token', 'member-token');
    await createClient('member-token')[method]('/resource', {
      headers: { Authorization: 'Bearer snapshot-1', authorization: 'Bearer snapshot-2' },
    });
    expect(new Headers(sentOptions().headers).get('authorization')).toBe('Bearer member-token');
  });

  it('does not retain caller credentials when the configured account is logged out', async () => {
    await createClient()[method]('/resource', { headers: { Authorization: 'Bearer snapshot' } });
    expect(new Headers(sentOptions().headers).has('authorization')).toBe(false);
  });

  it('rebuilds authentication after refresh while preserving business headers and body', async () => {
    localStorage.setItem('access-token', 'old-token');
    localStorage.setItem('refresh-token', 'old-refresh');
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ code: 0, data: { accessToken: 'new-token', refreshToken: 'new-refresh' } }));
    const headers = new Headers({ authorization: 'Bearer caller-snapshot', 'X-Idempotency-Key': 'intent-0001' });
    const body = JSON.stringify({ amount: 100 });

    await createClient()[method]('/resource', { method: 'POST', body, headers });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/resource', '/refresh', '/resource']);
    expect(new Headers(sentOptions(0).headers).get('authorization')).toBe('Bearer old-token');
    expect(new Headers(sentOptions(2).headers).get('authorization')).toBe('Bearer new-token');
    for (const index of [0, 2]) {
      expect(new Headers(sentOptions(index).headers).get('x-idempotency-key')).toBe('intent-0001');
      expect(sentOptions(index).body).toBe(body);
    }
    expect(headers.get('authorization')).toBe('Bearer caller-snapshot');
  });

  it.each([undefined, 'multipart/form-data', 'application/json'])('lets FormData generate its boundary with caller content type %s', async (contentType) => {
    const body = new FormData();
    body.append('description', 'upload');
    const headers = new Headers({ 'X-Upload': 'upload-1' });
    if (contentType) headers.set('Content-Type', contentType);

    await createClient()[method]('/upload', { method: 'POST', body, headers });

    expect(sentOptions().body).toBe(body);
    expect(new Headers(sentOptions().headers).has('content-type')).toBe(false);
    expect(new Headers(sentOptions().headers).get('x-upload')).toBe('upload-1');
    const outgoing = new Request('https://api.test/upload', sentOptions());
    expect(outgoing.headers.get('content-type')).toMatch(/^multipart\/form-data; boundary=.+/);
    expect((await outgoing.formData()).get('description')).toBe('upload');
    expect(headers.get('content-type')).toBe(contentType ?? null);
  });
});
