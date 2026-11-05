import { context, isSpanContextValid, propagation, ROOT_CONTEXT, trace } from '@opentelemetry/api';

export interface PersistedOtelContext {
  traceParent: string | null;
  traceState: string | null;
}

/** The active OTel trace ID, if the current execution is inside a valid span. */
export function currentOtelTraceId(): string | undefined {
  const spanContext = trace.getActiveSpan()?.spanContext();
  return spanContext && isSpanContextValid(spanContext) ? spanContext.traceId : undefined;
}

/** The active OTel span ID, if available. */
export function currentOtelSpanId(): string | undefined {
  const spanContext = trace.getActiveSpan()?.spanContext();
  return spanContext && isSpanContextValid(spanContext) ? spanContext.spanId : undefined;
}

/** Capture a serializable W3C parent context for a queued/eventual operation. */
export function currentPersistedOtelContext(): PersistedOtelContext {
  const spanContext = trace.getActiveSpan()?.spanContext();
  if (!spanContext || !isSpanContextValid(spanContext)) return { traceParent: null, traceState: null };
  return {
    traceParent: `00-${spanContext.traceId}-${spanContext.spanId}-${(spanContext.traceFlags & 1).toString(16).padStart(2, '0')}`,
    traceState: spanContext.traceState?.serialize() || null,
  };
}

/** Run a Worker/consumer callback under a persisted remote W3C context. */
export function runWithPersistedOtelContext<T>(
  persisted: PersistedOtelContext | null | undefined,
  fn: () => T | Promise<T>,
): Promise<T> {
  if (!persisted?.traceParent) return Promise.resolve(fn());
  const carrier: Record<string, string> = { traceparent: persisted.traceParent };
  if (persisted.traceState) carrier.tracestate = persisted.traceState;
  const extracted = propagation.extract(ROOT_CONTEXT, carrier, {
    get: (input, key) => input[key],
    keys: (input) => Object.keys(input),
  });
  return Promise.resolve(context.with(extracted, fn));
}

/** Inject the configured W3C propagation context into a Fetch Headers carrier. */
export function injectOtelHeaders(headers: Headers): void {
  propagation.inject(context.active(), headers, {
    set(carrier, key, value) {
      carrier.set(key, value);
    },
  });
}
