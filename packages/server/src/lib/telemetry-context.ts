import { context, isSpanContextValid, propagation, trace } from '@opentelemetry/api';

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

/** Inject the configured W3C propagation context into a Fetch Headers carrier. */
export function injectOtelHeaders(headers: Headers): void {
  propagation.inject(context.active(), headers, {
    set(carrier, key, value) {
      carrier.set(key, value);
    },
  });
}
