import type { WorkflowLaunchFormData } from './WorkflowLaunchForm';

export interface WorkflowLaunchSnapshot extends WorkflowLaunchFormData {
  definitionId: number;
  dirty: boolean;
}

/** 空字段注册顺序不影响编辑判定，明细和附件仍逐项比较。 */
export function sameLaunchValues(left: unknown, right: unknown): boolean {
  const normalize = (value: unknown): unknown => {
    if (value === undefined || value === null || value === '') return undefined;
    if (Array.isArray(value)) return value.length ? value.map(normalize) : undefined;
    if (value instanceof Date) return value.toISOString();
    if (typeof value !== 'object') return value;
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().flatMap((key) => {
      const normalized = normalize(record[key]);
      return normalized === undefined ? [] : [[key, normalized]];
    }));
  };
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

export function launchSnapshotFromState(state: unknown, definitionId: number): WorkflowLaunchSnapshot | undefined {
  if (!state || typeof state !== 'object') return undefined;
  const snapshot = (state as { launchSnapshot?: WorkflowLaunchSnapshot }).launchSnapshot;
  if (snapshot?.definitionId !== definitionId || !snapshot.values || !snapshot.formData) return undefined;
  return snapshot;
}
