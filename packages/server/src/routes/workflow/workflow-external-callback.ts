/**
 * 外部审批回调路由（公开，无需登录）
 *
 * Headers: X-Zenith-Signature: t={ts},v1={hex}（如果节点配置 signMode=hmacSha256）
 *
 * 流程：
 * 1. 根据 callbackId 找到 waiting 任务
 * 2. 读取节点 externalApproval.secret，校验 HMAC 签名
 * 3. 调用 approveTaskByCallback / rejectTaskByCallback
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { workflowExternalCallbackContract, type WorkflowExternalApprovalConfig } from '@zenith/shared/workflow';
import { db } from '../../db';
import { workflowInstances, workflowTasks } from '../../db/schema';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { approveTaskByCallback, rejectTaskByCallback } from '../../services/workflow/workflow-instances.service';
import { assertWorkflowCallbackSignature, captureWorkflowCallbackRawBody, getWorkflowCallbackRawBody } from '../../lib/workflow-callback-security';

const router = new OpenAPIHono({ defaultHook: validationHook });

const callback = defineContractRoute(workflowExternalCallbackContract.callback, {
  middleware: [captureWorkflowCallbackRawBody] as const,
  handler: async (c) => {
    const { callbackId } = c.req.valid('param');
    const body = c.req.valid('json');

    const [task] = await db.select().from(workflowTasks).where(eq(workflowTasks.externalCallbackId, callbackId)).limit(1);
    if (!task) throw new HTTPException(404, { message: '回调任务不存在' });

    const [inst] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, task.instanceId)).limit(1);
    if (!inst) throw new HTTPException(404, { message: '流程实例不存在' });

    const snapshot = inst.definitionSnapshot;
    const nodeCfg = snapshot?.flowData?.nodes.find((n) => n.data.key === task.nodeKey)?.data;
    const ext: WorkflowExternalApprovalConfig | undefined = nodeCfg?.externalApproval;
    if (!ext?.enabled) throw new HTTPException(400, { message: '当前任务未启用外部审批' });

    // 签名校验（如果配置了 hmacSha256）
    if ((ext.signMode ?? 'hmacSha256') === 'hmacSha256') {
      assertWorkflowCallbackSignature({
        secret: ext.secret,
        signatureHeader: c.req.header('X-Zenith-Signature'),
        rawBody: getWorkflowCallbackRawBody(c.req.raw, body),
        canonicalBody: JSON.stringify(body),
        missingSecretMessage: '外部审批未配置 secret',
      });
    }

    const approver = body.approverName ?? 'unknown';
    if (body.action === 'approve') {
      const result = await approveTaskByCallback(callbackId, body.comment, approver);
      return c.json(okBody({ message: result.message }), 200);
    } else {
      const comment = body.comment ?? '外部审批驳回';
      await rejectTaskByCallback(callbackId, comment, approver);
      return c.json(okBody({ message: '外部审批驳回成功' }), 200);
    }
  },
});

router.openapiRoutes([callback] as const);

export default router;
