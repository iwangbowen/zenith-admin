import { createHmac } from 'node:crypto';
import { HTTPException } from 'hono/http-exception';
import type { WorkflowFlowData, WorkflowNodeConfig } from '@zenith/shared';
import type { workflowInstances } from '../../../db/schema';

/** HMAC-SHA256 签名（webhook / external 共用）：sign(secret, `${ts}.${body}`） */
export function signHmac(secret: string, timestamp: string, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

/** 从实例定义快照中取某节点的配置 */
export function snapshotNodeConfig(
  inst: typeof workflowInstances.$inferSelect,
  nodeKey: string,
): WorkflowNodeConfig | undefined {
  const snapshot = inst.definitionSnapshot;
  return snapshot?.flowData?.nodes.find((n) => n.data.key === nodeKey)?.data;
}

/** 是否为并发乐观锁冲突（HTTP 409）——通常意味着任务已被其它路径推进 */
export function isConflict(err: unknown): boolean {
  return err instanceof HTTPException && err.status === 409;
}

/** payload 中读取必需的数值字段，缺失则抛出（由 handler 转成永久失败） */
export function requireNumber(payload: Record<string, unknown>, key: string): number {
  const v = Number(payload[key]);
  if (!Number.isFinite(v)) throw new Error(`payload.${key} 缺失或非法`);
  return v;
}
