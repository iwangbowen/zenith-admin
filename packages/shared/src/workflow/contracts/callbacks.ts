import * as z from 'zod';
import { defineContract, op } from '../../core/contract';
import { workflowExternalCallbackSchema, workflowTriggerCallbackSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const workflowExternalCallbackResultSchema = z.object({
  message: z.string(),
}).meta({ id: 'WorkflowExternalCallbackResult' });

export type WorkflowExternalCallbackResult = z.infer<typeof workflowExternalCallbackResultSchema>;

export const workflowTriggerCallbackResultSchema = z.object({
  message: z.string(),
  instanceId: z.number(),
  nodeKey: z.string(),
}).meta({ id: 'WorkflowTriggerCallbackResult' });

export type WorkflowTriggerCallbackResult = z.infer<typeof workflowTriggerCallbackResultSchema>;

// ─── 契约（公开：由外部系统以回调 ID + HMAC 签名调用） ────────────────────────

export const workflowCallbackIdParam = z.object({
  callbackId: z.string().min(8).max(128).meta({ description: '回调 ID（任务派发时下发给外部系统）' }),
});

export const workflowExternalCallbackContract = defineContract('/api/public/workflow/external-callback', {
  callback: op.post('/{callbackId}', {
    params: workflowCallbackIdParam,
    body: workflowExternalCallbackSchema,
    response: workflowExternalCallbackResultSchema,
    public: true,
    summary: '外部审批回调（公开，无需登录）',
    description: '节点 externalApproval.signMode=hmacSha256 时须携带 X-Zenith-Signature: t={ts},v1={hex}（基于原始请求体）；回调 ID 在路由处理内校验。',
  }),
}, { tags: ['WorkflowExternalCallback'] });

export const workflowTriggerCallbackContract = defineContract('/api/public/workflow/trigger-callback', {
  callback: op.post('/{callbackId}', {
    params: workflowCallbackIdParam,
    body: workflowTriggerCallbackSchema,
    response: workflowTriggerCallbackResultSchema,
    public: true,
    summary: '触发器回调（公开，无需登录）',
    description: '节点 triggerConfig.callbackSignMode=hmacSha256（默认）时须携带 X-Zenith-Signature: t={ts},v1={hex}（基于原始请求体）；命中后推进等待中的 trigger 节点。',
  }),
}, { tags: ['WorkflowTriggerCallback'] });
