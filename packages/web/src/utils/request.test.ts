import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TOKEN_KEY } from '@zenith/shared/core';
import { paymentRefundContract, paymentSharingContract, paymentTransferContract } from '@zenith/shared/payment';
import { api, type ApiCallOptions } from '@/lib/contract-query';
import { request } from './request';

vi.mock('@/config', () => ({ config: { apiBaseUrl: '' } }));
vi.mock('./request-toast', () => ({ showRequestErrorToast: vi.fn(), showRequestWarningToast: vi.fn() }));

const fetchMock = vi.fn<typeof fetch>();
const intentHeaders = { 'x-idempotency-key': 'payment-intent-0001' };

class UploadXhr extends EventTarget {
  static instances: UploadXhr[] = [];
  readonly headers = new Headers();
  readonly upload = new EventTarget();
  readonly responseText = JSON.stringify({ code: 0, message: 'ok', data: { id: 1 } });
  open = vi.fn();
  setRequestHeader = vi.fn((name: string, value: string) => this.headers.append(name, value));
  send = vi.fn((_body: BodyInit) => {
    this.upload.dispatchEvent(new ProgressEvent('progress', { lengthComputable: true, loaded: 1, total: 2 }));
    queueMicrotask(() => this.dispatchEvent(new Event('load')));
  });

  constructor() {
    super();
    UploadXhr.instances.push(this);
  }
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(TOKEN_KEY, 'admin-token');
  UploadXhr.instances = [];
  fetchMock.mockReset().mockImplementation(async () => Response.json({ code: 0, message: 'ok', data: null }));
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('XMLHttpRequest', UploadXhr);
});

afterEach(() => vi.unstubAllGlobals());

describe('payment contracts through the real request client', () => {
  it.each([
    {
      name: 'refund', contract: paymentRefundContract.createRefund, url: '/api/payment/refunds',
      send: (options: ApiCallOptions) => api(paymentRefundContract.createRefund, {
        headers: intentHeaders, body: { orderNo: 'PAY-1', refundAmount: 100 },
      }, options),
    },
    {
      name: 'transfer', contract: paymentTransferContract.create, url: '/api/payment/transfers',
      send: (options: ApiCallOptions) => api(paymentTransferContract.create, {
        headers: intentHeaders,
        body: { applicationId: 1, channel: 'wechat', receiverAccount: 'receiver', amount: 100, remark: 'transfer' },
      }, options),
    },
    {
      name: 'sharing reversal', contract: paymentSharingContract.reverse, url: '/api/payment/sharing/orders/1/reverse',
      send: (options: ApiCallOptions) => api(paymentSharingContract.reverse, {
        params: { id: 1 }, headers: intentHeaders, body: { reason: 'reversal' },
      }, options),
    },
  ])('sends valid $name headers and lets contract values override request options', async ({ contract, url, send }) => {
    const headers = new Headers({
      'X-Idempotency-Key': 'request-option-intent', 'X-Trace': 'trace-1', Authorization: 'Bearer snapshot',
    });

    await send({ headers });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [actualUrl, options] = fetchMock.mock.calls[0];
    expect(actualUrl).toBe(url);
    expect(options?.method).toBe('POST');
    const actualHeaders = Object.fromEntries(new Headers(options?.headers));
    expect(actualHeaders).toEqual({
      ...intentHeaders, authorization: 'Bearer admin-token', 'content-type': 'application/json', 'x-trace': 'trace-1',
    });
    expect(contract.headers.safeParse(actualHeaders).success).toBe(true);
    expect(headers.get('x-idempotency-key')).toBe('request-option-intent');
    expect(headers.get('authorization')).toBe('Bearer snapshot');
  });
});

describe('request.postForm headers', () => {
  it.each([
    { name: 'object', create: (values: Record<string, string>): HeadersInit => ({ ...values }) },
    { name: 'Headers', create: (values: Record<string, string>): HeadersInit => new Headers(values) },
    { name: 'tuples', create: (values: Record<string, string>): HeadersInit => Object.entries(values) },
  ])('sends $name business headers consistently with and without upload progress', async ({ create }) => {
    const headers = create({ 'X-Upload': 'upload-1', 'Content-Type': 'multipart/form-data', authorization: 'Bearer snapshot' });
    const original = Array.from(new Headers(headers));
    const body = new FormData();
    body.append('description', 'upload');
    const onProgress = vi.fn();

    await request.postForm('/upload', body, { headers });
    const result = await request.postForm('/upload', body, { headers, onProgress });

    const xhr = UploadXhr.instances[0];
    expect(xhr.open).toHaveBeenCalledWith('POST', '/upload');
    expect(xhr.send).toHaveBeenCalledWith(body);
    expect(Object.fromEntries(xhr.headers)).toEqual({ authorization: 'Bearer admin-token', 'x-upload': 'upload-1' });
    expect(Object.fromEntries(new Headers(fetchMock.mock.calls[0][1]?.headers))).toEqual(Object.fromEntries(xhr.headers));
    expect(result.data).toEqual({ id: 1 });
    expect(onProgress).toHaveBeenCalledWith(50);
    expect(Array.from(new Headers(headers))).toEqual(original);
  });

  it('reads the current token for each upload and drops caller credentials after logout', async () => {
    const options = { onProgress: vi.fn(), headers: { Authorization: 'Bearer snapshot' } };
    await request.postForm('/upload', new FormData(), options);
    localStorage.setItem(TOKEN_KEY, 'new-admin-token');
    await request.postForm('/upload', new FormData(), options);
    localStorage.removeItem(TOKEN_KEY);
    await request.postForm('/upload', new FormData(), options);

    expect(UploadXhr.instances.map((xhr) => xhr.headers.get('authorization')))
      .toEqual(['Bearer admin-token', 'Bearer new-admin-token', null]);
  });
});
