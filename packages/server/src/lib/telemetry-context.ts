import {
  context,
  isSpanContextValid,
  propagation,
  ROOT_CONTEXT,
  SpanStatusCode,
  trace,
  type AttributeValue,
  type Attributes,
} from '@opentelemetry/api';

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

const ASYNC_SPAN_ATTRIBUTE_LIMIT = 12;
const ASYNC_SPAN_VALUE_LIMIT = 128;

function boundedAttributes(attributes: Attributes | undefined): Attributes {
  if (!attributes) return {};
  return Object.fromEntries(Object.entries(attributes).slice(0, ASYNC_SPAN_ATTRIBUTE_LIMIT).flatMap(([key, value]): Array<[string, AttributeValue]> => {
    if (value === undefined) return [];
    if (typeof value === 'string') return [[key, value.slice(0, ASYNC_SPAN_VALUE_LIMIT)]];
    if (typeof value === 'number' || typeof value === 'boolean') return [[key, value]];
    if (Array.isArray(value)) {
      return [[key, value.slice(0, 8).map((item) => typeof item === 'string' ? item.slice(0, ASYNC_SPAN_VALUE_LIMIT) : item) as AttributeValue]];
    }
    return [];
  }));
}

/**
 * Run an asynchronous boundary in a bounded manual child span.
 * The caller must first restore any persisted remote context and business context;
 * this helper only creates the child span and keeps the handler as its active scope.
 */
export function withAsyncSpan<T>(
  name: string,
  fn: () => T | Promise<T>,
  attributes?: Attributes,
): Promise<T> {
  const tracer = trace.getTracer('zenith.server');
  return Promise.resolve(tracer.startActiveSpan(name, { attributes: boundedAttributes(attributes) }, async (span) => {
    try {
      return await fn();
    } catch (error) {
      span.recordException(error instanceof Error ? error : String(error));
      span.setStatus({ code: SpanStatusCode.ERROR, message: error instanceof Error ? error.message.slice(0, ASYNC_SPAN_VALUE_LIMIT) : 'async_operation_failed' });
      throw error;
    } finally {
      span.end();
    }
  }));
}

/** Inject the configured W3C propagation context into a Fetch Headers carrier. */
export function injectOtelHeaders(headers: Headers): void {
  propagation.inject(context.active(), headers, {
    set(carrier, key, value) {
      carrier.set(key, value);
    },
  });
}
