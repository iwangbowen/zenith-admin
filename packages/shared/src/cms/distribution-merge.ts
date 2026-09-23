import { stableStringify } from '../core/json';

/** A source change is safe when the target still equals the last accepted source value. */
export function mergeCmsDistributionFields(base: Record<string, unknown>, target: Record<string, unknown>, incoming: Record<string, unknown>, targetOwnedFields: readonly string[] = []) {
  const patch: Record<string, unknown> = {};
  const conflicts: Array<{ field: string; base: unknown; target: unknown; incoming: unknown }> = [];
  for (const [field, value] of Object.entries(incoming)) {
    if (value === undefined || targetOwnedFields.includes(field)) continue;
    const before = base[field] ?? null;
    const current = target[field] ?? null;
    if (stableStringify(current) === stableStringify(before) || stableStringify(current) === stableStringify(value)) patch[field] = value;
    else if (stableStringify(value) !== stableStringify(before)) conflicts.push({ field, base: before, target: current, incoming: value });
  }
  return { patch, conflicts };
}
