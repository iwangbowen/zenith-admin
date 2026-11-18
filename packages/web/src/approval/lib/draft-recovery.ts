import { TOKEN_KEY } from '@zenith/shared/core';
import type { WorkflowFormField } from '@zenith/shared/workflow';
import { approvalSessionIdentity } from './session';

const prefix = 'approval-recovery:';
const ttl = 24 * 60 * 60 * 1000;
function key(definitionId: number) { return `${prefix}${approvalSessionIdentity(localStorage.getItem(TOKEN_KEY))}:${definitionId}`; }
export function safeRecoveryValues(fields: readonly WorkflowFormField[], values: Record<string, unknown>): Record<string, unknown> {
  const flatten = (list: readonly WorkflowFormField[]): WorkflowFormField[] => list.flatMap(f => [f, ...flatten(f.children ?? []), ...(f.columns ?? []).flatMap(c => flatten(c.fields)), ...(f.panes ?? []).flatMap(p => flatten(p.fields))]);
  const all = flatten(fields);
  const excluded = new Set(all.filter(f => ['signature', 'password', 'pinCode'].includes(f.type)).map(f => f.key));
  return Object.fromEntries(Object.entries(values).filter(([name]) => !excluded.has(name)).map(([name, value]) => {
    const field = all.find(f => f.key === name);
    return [name, field?.type === 'detail' && Array.isArray(value) ? value.map(v => typeof v === 'object' && v ? safeRecoveryValues(field.children ?? [], v as Record<string, unknown>) : v) : value];
  }));
}
export function saveApprovalRecovery(definitionId: number, fields: readonly WorkflowFormField[], formData: Record<string, unknown>, title: string) {
  try { localStorage.setItem(key(definitionId), JSON.stringify({ expires: Date.now() + ttl, formData: safeRecoveryValues(fields, formData), title })); } catch { /* storage may be full or disabled */ }
}
export function readApprovalRecovery(definitionId: number): { formData: Record<string, unknown>; title: string } | null {
  try { const value = JSON.parse(localStorage.getItem(key(definitionId)) ?? 'null'); if (value?.expires > Date.now() && value.formData && typeof value.title === 'string') return value; } catch { /* malformed data cannot block editing */ }
  return null;
}
export function removeApprovalRecovery(definitionId: number) { localStorage.removeItem(key(definitionId)); }
export function clearApprovalRecoveries() { for (let i = localStorage.length - 1; i >= 0; i--) { const name = localStorage.key(i); if (name?.startsWith(prefix)) localStorage.removeItem(name); } }
