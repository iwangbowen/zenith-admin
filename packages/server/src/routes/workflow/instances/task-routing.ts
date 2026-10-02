import { redactWorkflowSignatureImages } from '../../../services/workflow/instances/signature-audit';
// ─── 任务流转：转办/委派/加签/减签/退回 ───
import { workflowTaskContract } from '@zenith/shared/workflow';
import { setAuditAfterData, setAuditBeforeData } from '../../../middleware/guard';
import { idempotencyGuard } from '../../../middleware/idempotency';
import { defineContractRoute } from '../../../lib/contract-route';
import { okBody } from '../../../lib/openapi-schemas';
import { getWorkflowTaskBeforeAudit, transferTask, delegateTask, addSignTask, reduceSignTask, returnTask } from '../../../services/workflow/workflow-instances.service';

export const transferRoute = defineContractRoute(workflowTaskContract.transfer, {
  middleware: [idempotencyGuard({ ttlSeconds: 10 })],
  handler: async (c) => {
    const { taskId } = c.req.valid('param');
    const { targetUserId, comment, attachments } = c.req.valid('json');
    const before = await getWorkflowTaskBeforeAudit(taskId);
    if (before) setAuditBeforeData(c, before);
    const r = await transferTask(taskId, targetUserId, comment, attachments);
    const after = await getWorkflowTaskBeforeAudit(taskId);
    setAuditAfterData(c, after ?? redactWorkflowSignatureImages(r));
    return c.json(okBody(r, '已转办'), 200);
  },
});

export const delegateRoute = defineContractRoute(workflowTaskContract.delegate, {
  middleware: [idempotencyGuard({ ttlSeconds: 10 })],
  handler: async (c) => {
    const { taskId } = c.req.valid('param');
    const { targetUserId, comment, attachments } = c.req.valid('json');
    const before = await getWorkflowTaskBeforeAudit(taskId);
    if (before) setAuditBeforeData(c, before);
    const r = await delegateTask(taskId, targetUserId, comment, attachments);
    const after = await getWorkflowTaskBeforeAudit(taskId);
    setAuditAfterData(c, after ?? redactWorkflowSignatureImages(r));
    return c.json(okBody(r, '已委派'), 200);
  },
});

export const addSignRoute = defineContractRoute(workflowTaskContract.addSign, {
  middleware: [idempotencyGuard({ ttlSeconds: 10 })],
  handler: async (c) => {
    const { taskId } = c.req.valid('param');
    const { targetUserIds, position, comment, signMode, attachments } = c.req.valid('json');
    const before = await getWorkflowTaskBeforeAudit(taskId);
    if (before) setAuditBeforeData(c, before);
    const r = await addSignTask(taskId, targetUserIds, position, comment, signMode, attachments);
    const after = await getWorkflowTaskBeforeAudit(taskId);
    setAuditAfterData(c, after ?? redactWorkflowSignatureImages(r));
    return c.json(okBody(r, r.message), 200);
  },
});

export const reduceSignRoute = defineContractRoute(workflowTaskContract.reduceSign, {
 middleware: [idempotencyGuard({ ttlSeconds: 10 })],
 handler: async (c) => {
  const { groupId } = c.req.valid('param'); const { targetSlotIds, comment } = c.req.valid('json');
  const result = await reduceSignTask(groupId, targetSlotIds, comment);
  setAuditAfterData(c, redactWorkflowSignatureImages(result));
  return c.json(okBody(result, result.message), 200);
 },
});

export const returnRoute = defineContractRoute(workflowTaskContract.returnTask, {
  middleware: [idempotencyGuard({ ttlSeconds: 10 })],
  handler: async (c) => {
    const { taskId } = c.req.valid('param');
    const { targetNodeKeys, comment, attachments } = c.req.valid('json');
    const before = await getWorkflowTaskBeforeAudit(taskId);
    if (before) setAuditBeforeData(c, before);
    const r = await returnTask(taskId, targetNodeKeys, comment, attachments);
    setAuditAfterData(c, redactWorkflowSignatureImages(r.instance));
    return c.json(okBody(r.instance, r.message), 200);
  },
});
