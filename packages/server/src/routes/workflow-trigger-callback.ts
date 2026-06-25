/**
 * 触发器回调路由（公开，无需登录）
 *
 * POST /api/public/workflow/trigger-callback/:callbackId
 * Body: { comment?: string, callerName?: string, payload?: Record<string, unknown> }
 * Headers: X-Zenith-Signature: t={ts},v1={hex}（如果节点配置 callbackSignMode=hmacSha256）
 *
 * 流程：
 * 1. 根据 callbackId 找到 waiting 的 trigger 任务
 * 2. 读取节点 triggerConfig.callbackSecret，按需校验 HMAC 签名
 * 3. 调用 resumeTriggerTask 推进流程
 */
import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db';
import { workflowInstances, workflowTasks } from '../db/schema';
import type { WorkflowFlowData, WorkflowTriggerNodeConfig } from '@zenith/shared';
import { validationHook, commonErrorResponses, ok, okBody } from '../lib/openapi-schemas';
import { resumeTriggerTask } from '../services/workflow-resume.service';
import { assertWorkflowCallbackSignature, captureWorkflowCallbackRawBody, getWorkflowCallbackRawBody } from '../lib/workflow-callback-security';

const router = new OpenAPIHono({ defaultHook: validationHook });

const CallbackParam = z.object({ callbackId: z.string().min(8).max(128) });
const CallbackBody = z.object({
  comment: z.string().max(1024).optional(),
  callerName: z.string().min(1).max(64).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

const ResultDTO = z.object({
  message: z.string(),
  instanceId: z.number(),
  nodeKey: z.string(),
}).openapi('WorkflowTriggerCallbackResult');

const callback = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/{callbackId}',
    tags: ['WorkflowTriggerCallback'],
    summary: '触发器回调（公开，无需登录）',
    middleware: [captureWorkflowCallbackRawBody] as const,
    request: {
      params: CallbackParam,
      body: { content: { 'application/json': { schema: CallbackBody } } },
    },
    responses: { ...commonErrorResponses, ...ok(ResultDTO, '回调处理结果') },
  }),
  handler: async (c) => {
    const { callbackId } = c.req.valid('param');
    const body = c.req.valid('json');

    const [task] = await db.select().from(workflowTasks).where(eq(workflowTasks.externalCallbackId, callbackId)).limit(1);
    if (!task) throw new HTTPException(404, { message: '回调任务不存在' });
    if (task.nodeType !== 'trigger') throw new HTTPException(400, { message: '该回调不属于触发器任务' });

    const [inst] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, task.instanceId)).limit(1);
    if (!inst) throw new HTTPException(404, { message: '流程实例不存在' });

    const snapshot = inst.definitionSnapshot as { flowData?: WorkflowFlowData } | null;
    const nodeCfg = snapshot?.flowData?.nodes.find((n) => n.data.key === task.nodeKey)?.data;
    const cfg: WorkflowTriggerNodeConfig | undefined = nodeCfg?.triggerConfig;
    if (cfg?.triggerType !== 'callback') {
      throw new HTTPException(400, { message: '当前任务不是回调类型触发器' });
    }

    // 签名校验默认启用；历史流程如显式配置 none 才允许无签名。
    if ((cfg.callbackSignMode ?? 'hmacSha256') === 'hmacSha256') {
      assertWorkflowCallbackSignature({
        secret: cfg.callbackSecret,
        signatureHeader: c.req.header('X-Zenith-Signature'),
        rawBody: getWorkflowCallbackRawBody(c.req.raw, body),
        canonicalBody: JSON.stringify(body),
        missingSecretMessage: '回调未配置 secret',
      });
    }

    const caller = body.callerName ?? 'external';
    const result = await resumeTriggerTask(callbackId, body.comment, caller, body.payload);
    return c.json(okBody({ message: '触发器回调成功', instanceId: result.instanceId, nodeKey: result.nodeKey }), 200);
  },
});

router.openapiRoutes([callback] as const);

export default router;
