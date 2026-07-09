const SENSITIVE_KEYS = [
  'password', 'secret', 'token', 'authorization', 'cookie', 'webhook',
  'accessKey', 'access_key', 'privateKey', 'private_key', 'apiKey', 'api_key',
  'clientSecret', 'refreshToken', 'x-api-key', 'apiv3', 'credential',
];

/**
 * 深度脱敏，返回原始对象的克隆副本（敏感字段被替换为 '***'）。
 * 与 sanitizeBody 的区别：返回 object 而非 JSON 字符串，适合结构化日志。
 */
export function redactBody(body: unknown): unknown {
  if (body === null || body === undefined) return body;
  try {
    const clone = structuredClone(body);
    redact(clone);
    return clone;
  } catch {
    return body;
  }
}

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
  for (const key of Object.keys(obj)) {
    if (SENSITIVE_KEYS.some((k) => key.toLowerCase().includes(k.toLowerCase()))) {
      (obj as Record<string, unknown>)[key] = '***';
    } else {
      redact((obj as Record<string, unknown>)[key]);
    }
  }
}
