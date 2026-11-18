const RECENT_KEY = 'zenith_approval_recent_defs';
const RECENT_MAX = 5;
import { approvalSessionIdentity } from './session';
const recentKey = () => `${RECENT_KEY}:${approvalSessionIdentity()}`;

/** 最近发起的流程定义 ID（localStorage，最新在前） */
export function getRecentDefinitionIds(): number[] {
  try {
    const raw = localStorage.getItem(recentKey());
    const arr = raw ? JSON.parse(raw) as unknown : [];
    return Array.isArray(arr) ? arr.filter((v): v is number => typeof v === 'number') : [];
  } catch {
    return [];
  }
}

export function recordRecentDefinition(id: number): void {
  const next = [id, ...getRecentDefinitionIds().filter((v) => v !== id)].slice(0, RECENT_MAX);
  localStorage.setItem(recentKey(), JSON.stringify(next));
}
