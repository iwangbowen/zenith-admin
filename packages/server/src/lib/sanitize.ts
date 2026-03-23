const SENSITIVE_KEYS = ['password', 'secret', 'token', 'accessKey', 'access_key', 'privateKey', 'private_key'];

export function sanitizeBody(body: unknown): string {
  if (body === null || body === undefined) return '';
  try {
    const clone = structuredClone(body);
    redact(clone);
    return JSON.stringify(clone);
  } catch {
    return JSON.stringify(body).slice(0, 512);
  }
}

function redact(obj: unknown): void {
  if (!obj || typeof obj !== 'object') return;
  for (const key of Object.keys(obj as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.some((k) => key.toLowerCase().includes(k.toLowerCase()))) {
      (obj as Record<string, unknown>)[key] = '***';
    } else {
      redact((obj as Record<string, unknown>)[key]);
    }
  }
}
