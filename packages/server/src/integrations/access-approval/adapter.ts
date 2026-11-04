import { HTTPException } from 'hono/http-exception';
import { ACCESS_REQUEST_BIZ_TYPE, accessApprovalPlanSchema, buildAccessApprovalFlow } from '@zenith/shared/identity';
import type { WorkflowBusinessAdapter } from '../../lib/workflow-business-types';

export const accessWorkflowBusinessAdapter: WorkflowBusinessAdapter = {
  businessType: ACCESS_REQUEST_BIZ_TYPE,
  async prepare({ mode, formData, flowData, actor }) {
    const service = await import('../../services/identity/public/access-approval');
    const normalized = mode === 'preview'
      ? await service.previewAccessWorkflowFormData(formData, actor)
      : await service.normalizeAccessWorkflowFormData(formData, actor);
    const plan = accessApprovalPlanSchema.safeParse(normalized.approvalPlan);
    return { formData: normalized, flowData: plan.success ? buildAccessApprovalFlow(plan.data, flowData.settings) : flowData };
  },
  async attachInTransaction(executor, instance) {
    const { attachAccessRequestToWorkflow } = await import('./bridge');
    return attachAccessRequestToWorkflow(executor, instance);
  },
  async onOutcomeInTransaction(executor, instance, actorId) {
    const { bridgeAccessWorkflowOutcome } = await import('./bridge');
    await bridgeAccessWorkflowOutcome(executor, instance, actorId);
  },
  assertDeletable() {
    throw new HTTPException(409, { message: '权限申请流程是授权审计依据，不支持直接删除；请通过授权撤销与归档管理' });
  },
  async prepareApproval({ instance, task, actor, input, formUpdates }) {
    if (!actor.userId) throw new HTTPException(403, { message: '权限审批必须由实名审批人办理' });
    if (Object.keys(formUpdates ?? {}).length) throw new HTTPException(403, { message: '权限申请审批时不能修改已经冻结的申请内容' });
    const { verifyAccessApprovalMfa, assertAccessApprovalInTransaction } = await import('../../services/identity/public/access-approval');
    const code = input?.mfaCode;
    if (code !== undefined && (typeof code !== 'string' || !/^\d{6}$/.test(code))) throw new HTTPException(400, { message: '请输入六位动态验证码' });
    const actorId = actor.userId;
    const evidence = await verifyAccessApprovalMfa(instance, task.id, actorId, code);
    return { assertInTransaction: executor => assertAccessApprovalInTransaction(executor, instance, task, actorId, evidence) };
  },
  async assertTaskAssigneeInTransaction(executor, context) {
    if (!context.nodeKey) throw new HTTPException(409, { message: '权限审批缺少节点关联' });
    const { assertAccessTaskAssigneeInTransaction } = await import('../../services/identity/public/access-approval');
    await assertAccessTaskAssigneeInTransaction(executor, { id: context.instanceId, tenantId: context.tenantId, bizType: context.businessType, bizId: context.businessId }, context.nodeKey, context.toUserId);
  },
};
