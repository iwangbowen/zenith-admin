export interface IdempotentPayload<T> {
  data: T;
  message: string;
}

export async function resolveIdempotent<T>({
  request,
  cache,
  run,
}: {
  request: Request;
  cache: Map<string, IdempotentPayload<T>>;
  run: () => IdempotentPayload<T> | Promise<IdempotentPayload<T>>;
}): Promise<IdempotentPayload<T>> {
  const idempotencyKey = request.headers.get('X-Idempotency-Key');
  const cached = idempotencyKey ? cache.get(idempotencyKey) : undefined;
  if (cached) return cached;
  const payload = await run();
  if (idempotencyKey) cache.set(idempotencyKey, payload);
  return payload;
}
