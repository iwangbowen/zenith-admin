import { createHmac } from 'node:crypto';
import { HTTPException } from 'hono/http-exception';
import type { WorkflowNodeConfig } from '@zenith/shared/workflow';
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

/**
 * 占位符渲染：`{{form.字段}}` 取表单标量值（空值 / 对象渲染为空串），
 * `{{instanceId}}` / `{{nodeKey}}` / `{{error}}` 等取 extras。反向动作与触发器节点的请求体 / 收件人共用同一口径；
 * URL 请走 `workflow-outbound.renderUrlTemplate`（占位值需百分号编码）。
 */
export function renderWorkflowTemplate(template: string, formData: Record<string, unknown>, extras: Record<string, string> = {}): string {
  return template
    .replace(/\{\{form\.([^}]+)\}\}/g, (_, key: string) => {
      const v = formData[key.trim()];
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
      return '';
    })
    .replace(/\{\{([a-zA-Z_]\w*)\}\}/g, (_, key: string) => extras[key] ?? '');
}
