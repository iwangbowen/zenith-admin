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
import { HTTPException } from 'hono/http-exception';
import { workflowExternalCallbackContract, type WorkflowExternalApprovalConfig } from '@zenith/shared/workflow';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { approveTaskByCallback, rejectTaskByCallback, requireCallbackTaskContext } from '../../services/workflow/workflow-instances.service';
import { assertWorkflowCallbackSignature, captureWorkflowCallbackRawBody, getWorkflowCallbackRawBody } from '../../lib/workflow-callback-security';

const router = new OpenAPIHono({ defaultHook: validationHook });

const callback = defineContractRoute(workflowExternalCallbackContract.callback, {
  middleware: [captureWorkflowCallbackRawBody] as const,
  handler: async (c) => {
    const { callbackId } = c.req.valid('param');
    const body = c.req.valid('json');

    const { nodeConfig } = await requireCallbackTaskContext(callbackId);
    const ext: WorkflowExternalApprovalConfig | undefined = nodeConfig?.externalApproval;
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
