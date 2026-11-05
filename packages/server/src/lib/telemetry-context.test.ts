import { trace } from '@opentelemetry/api';
import { describe, expect, it, vi } from 'vitest';
import { currentOtelSpanId, currentOtelTraceId } from './telemetry-context';

const TRACE_ID = '0123456789abcdef0123456789abcdef';
const SPAN_ID = '0123456789abcdef';

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
});
