import { SpanStatusCode, trace } from '@opentelemetry/api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentOtelSpanId, currentOtelTraceId, withAsyncSpan } from './telemetry-context';

const TRACE_ID = '0123456789abcdef0123456789abcdef';
const SPAN_ID = '0123456789abcdef';

afterEach(() => vi.restoreAllMocks());

describe('telemetry context', () => {
  it('reads the active valid OTel span identifiers', () => {
    const getActiveSpan = vi.spyOn(trace, 'getActiveSpan').mockReturnValue({
      spanContext: () => ({ traceId: TRACE_ID, spanId: SPAN_ID, traceFlags: 1 }),
    } as never);
    expect(currentOtelTraceId()).toBe(TRACE_ID);
    expect(currentOtelSpanId()).toBe(SPAN_ID);
    getActiveSpan.mockRestore();
  });

  it('returns no identifiers outside an active span', () => {
    expect(currentOtelTraceId()).toBeUndefined();
    expect(currentOtelSpanId()).toBeUndefined();
  });

  it('runs the handler in a bounded child span and ends it on success', async () => {
    const span = { end: vi.fn(), recordException: vi.fn(), setStatus: vi.fn() };
    const startActiveSpan = vi.fn((name: string, options: unknown, callback: (span: unknown) => unknown) => {
      expect(name).toBe('test.async');
      expect(options).toMatchObject({ attributes: { short: 'ok', long: 'x'.repeat(128), values: ['a'.repeat(128), 'b'] } });
      return callback(span);
    });
    vi.spyOn(trace, 'getTracer').mockReturnValue({ startActiveSpan } as never);
    await expect(withAsyncSpan('test.async', () => 'done', {
      short: 'ok',
      long: 'x'.repeat(300),
      values: ['a'.repeat(300), 'b'],
      ignored: undefined,
    })).resolves.toBe('done');
    expect(span.end).toHaveBeenCalledOnce();
    expect(span.recordException).not.toHaveBeenCalled();
  });

  it('records failure, marks the span error, ends it, and rethrows', async () => {
    const span = { end: vi.fn(), recordException: vi.fn(), setStatus: vi.fn() };
    vi.spyOn(trace, 'getTracer').mockReturnValue({
      startActiveSpan: vi.fn((_name: string, _options: unknown, callback: (span: unknown) => unknown) => callback(span)),
    } as never);
    const error = new Error('boom');
    await expect(withAsyncSpan('test.async', async () => { throw error; })).rejects.toBe(error);
    expect(span.recordException).toHaveBeenCalledWith(error);
    expect(span.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.ERROR, message: 'boom' });
    expect(span.end).toHaveBeenCalledOnce();
  });
});
