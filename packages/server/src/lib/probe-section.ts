import type { ProbeSection } from '@zenith/shared/core';

/** A failed or timed-out source must not hide the remaining probes. */
export async function section<T>(probe: () => Promise<T>, timeoutMs = 8000): Promise<ProbeSection<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const data = await Promise.race([
      Promise.resolve().then(probe),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('探测超时')), timeoutMs); }),
    ]);
    return { available: true, reason: null, data };
  } catch (err) {
    return { available: false, reason: err instanceof Error ? err.message : String(err), data: null };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
