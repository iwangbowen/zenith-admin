import { CMS_SECRET_MASK } from '@zenith/shared';

export { CMS_SECRET_MASK };

const SENSITIVE_SETTING_KEY = /(?:secret|token|password|private[_-]?key|api[_-]?key|access[_-]?key|indexnow[_-]?key|credential)/i;

export function isSensitiveCmsSettingKey(key: string): boolean {
  return SENSITIVE_SETTING_KEY.test(key);
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return structuredClone(value);
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue);
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSensitiveCmsSettingKey(key)
      ? CMS_SECRET_MASK
      : redactValue(nested);
  }
  return out;
}

/** API/export boundary: secrets are represented only by a non-reversible sentinel. */
export function redactCmsSiteSettings(
  settings: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  return redactValue(settings ?? {}) as Record<string, unknown>;
}

function mergeValue(existing: unknown, incoming: unknown, key: string): unknown {
  if (isSensitiveCmsSettingKey(key)) {
    if (incoming === undefined || incoming === '' || incoming === CMS_SECRET_MASK) return existing;
    if (incoming === null) return undefined;
    return incoming;
  }
  if (incoming && typeof incoming === 'object' && !Array.isArray(incoming)) {
    const existingRecord = existing && typeof existing === 'object' && !Array.isArray(existing)
      ? existing as Record<string, unknown>
      : {};
    return mergeCmsSiteSettings(
      existingRecord,
      incoming as Record<string, unknown>,
    );
  }
  return incoming;
}

/**
 * Write-only settings merge.
 * Sensitive empty/sentinel values retain the stored value; explicit null clears it.
 */
export function mergeCmsSiteSettings(
  existing: Record<string, unknown> | null | undefined,
  incoming: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const out = cloneRecord(existing ?? {});
  if (!incoming) return out;
  for (const [key, value] of Object.entries(incoming)) {
    const next = mergeValue(out[key], value, key);
    if (next === undefined) delete out[key];
    else out[key] = next;
  }
  return out;
}

/** Creation/import boundary: sentinel and blank secret placeholders never become stored secrets. */
export function normalizeNewCmsSiteSettings(
  incoming: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  return mergeCmsSiteSettings({}, incoming);
}
