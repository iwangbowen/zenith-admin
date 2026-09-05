// ─── 任务流转：转办/委派/加签/减签/退回 ───
import { workflowTaskContract } from '@zenith/shared/workflow';
import { authMiddleware } from '../../../middleware/auth';
import { guard, setAuditAfterData, setAuditBeforeData } from '../../../middleware/guard';
import { idempotencyGuard } from '../../../middleware/idempotency';
import { defineContractRoute } from '../../../lib/contract-route';
import { okBody } from '../../../lib/openapi-schemas';
import { getWorkflowTaskBeforeAudit, transferTask, delegateTask, addSignTask, reduceSignTask, returnTask } from '../../../services/workflow/workflow-instances.service';

export const transferRoute = defineContractRoute(workflowTaskContract.transfer, {
  middleware: [authMiddleware, idempotencyGuard({ ttlSeconds: 10 }), guard({ permission: 'workflow:task:handle', audit: { description: '转办任务', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const { taskId } = c.req.valid('param');
    const { targetUserId, comment, attachments } = c.req.valid('json');
    const before = await getWorkflowTaskBeforeAudit(taskId);
    if (before) setAuditBeforeData(c, before);
    const r = await transferTask(taskId, targetUserId, comment, attachments);
    const after = await getWorkflowTaskBeforeAudit(taskId);
    if (after) setAuditAfterData(c, after);
    return c.json(okBody(r, '已转办'), 200);
  },
});

export const delegateRoute = defineContractRoute(workflowTaskContract.delegate, {
  middleware: [authMiddleware, idempotencyGuard({ ttlSeconds: 10 }), guard({ permission: 'workflow:task:handle', audit: { description: '委派任务', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const { taskId } = c.req.valid('param');
    const { targetUserId, comment, attachments } = c.req.valid('json');
    const before = await getWorkflowTaskBeforeAudit(taskId);
    if (before) setAuditBeforeData(c, before);
    const r = await delegateTask(taskId, targetUserId, comment, attachments);
    const after = await getWorkflowTaskBeforeAudit(taskId);
    if (after) setAuditAfterData(c, after);
    return c.json(okBody(r, '已委派'), 200);
  },
});

export const addSignRoute = defineContractRoute(workflowTaskContract.addSign, {
  middleware: [authMiddleware, idempotencyGuard({ ttlSeconds: 10 }), guard({ permission: 'workflow:task:handle', audit: { description: '加签任务', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const { taskId } = c.req.valid('param');
    const { targetUserIds, position, comment, signMode, attachments } = c.req.valid('json');
    const before = await getWorkflowTaskBeforeAudit(taskId);
    if (before) setAuditBeforeData(c, before);
    const r = await addSignTask(taskId, targetUserIds, position, comment, signMode, attachments);
    const after = await getWorkflowTaskBeforeAudit(taskId);
    if (after) setAuditAfterData(c, after);
    return c.json(okBody(null, r.message), 200);
  },
});

export const reduceSignRoute = defineContractRoute(workflowTaskContract.reduceSign, {
  middleware: [authMiddleware, idempotencyGuard({ ttlSeconds: 10 }), guard({ permission: 'workflow:task:handle', audit: { description: '减签任务', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const { taskId } = c.req.valid('param');
    const { targetTaskIds, comment } = c.req.valid('json');
    const before = await getWorkflowTaskBeforeAudit(taskId);
    if (before) setAuditBeforeData(c, before);
    const r = await reduceSignTask(taskId, targetTaskIds, comment);
    const after = await getWorkflowTaskBeforeAudit(taskId);
    if (after) setAuditAfterData(c, after);
    return c.json(okBody(null, r.message), 200);
  },
});

export const returnRoute = defineContractRoute(workflowTaskContract.returnTask, {
  middleware: [authMiddleware, idempotencyGuard({ ttlSeconds: 10 }), guard({ permission: 'workflow:task:handle', audit: { description: '退回任务', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const { taskId } = c.req.valid('param');
    const { targetNodeKeys, comment, attachments } = c.req.valid('json');
    const before = await getWorkflowTaskBeforeAudit(taskId);
    if (before) setAuditBeforeData(c, before);
    const r = await returnTask(taskId, targetNodeKeys, comment, attachments);
    return c.json(okBody(r.instance, r.message), 200);
  },
});
