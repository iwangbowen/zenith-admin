import type { WorkflowTimeoutConfig } from '@zenith/shared';

const UNIT_MS: Record<NonNullable<WorkflowTimeoutConfig['unit']>, number> = {
  minutes: 60 * 1000,
  hours: 60 * 60 * 1000,
  days: 24 * 60 * 60 * 1000,
};

/** 根据节点超时配置计算截止时间；返回 null 表示不启用 */
export function computeTimeoutAt(cfg: WorkflowTimeoutConfig | undefined | null, from: Date = new Date()): Date | null {
  if (!cfg || !cfg.enabled) return null;
  const duration = Number(cfg.duration);
  if (!Number.isFinite(duration) || duration <= 0) return null;
  const unitMs = UNIT_MS[cfg.unit ?? 'hours'];
  return new Date(from.getTime() + duration * unitMs);
}
