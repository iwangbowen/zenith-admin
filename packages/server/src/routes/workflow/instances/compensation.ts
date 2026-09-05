// ─── 补偿中心 ───
import { workflowInstanceOpsContract } from '@zenith/shared/workflow';
import { authMiddleware } from '../../../middleware/auth';
import { guard } from '../../../middleware/guard';
import { defineContractRoute } from '../../../lib/contract-route';
import { okBody } from '../../../lib/openapi-schemas';
import { resumeInstanceForCompensation } from '../../../services/workflow/workflow-instances.service';
import { listCompensations, resolveCompensation, getCompensationDetail, addCompensationNote, retryCompensationAction } from '../../../services/workflow/workflow-compensations.service';

const monitor = [authMiddleware, guard({ permission: 'workflow:instance:monitor' })] as const;

export const compensationsRoute = defineContractRoute(workflowInstanceOpsContract.compensations, {
  middleware: monitor,
  handler: async (c) => c.json(okBody(await listCompensations(c.req.valid('query'))), 200),
});

export const compensationResolveRoute = defineContractRoute(workflowInstanceOpsContract.resolveCompensation, {
  middleware: [authMiddleware, guard({ permission: 'workflow:engine:operate', audit: { description: '处理补偿工单', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const b = c.req.valid('json');
    return c.json(okBody(await resolveCompensation(id, b.action, b.resolution), '已处理'), 200);
  },
});

export const compensationDetailRoute = defineContractRoute(workflowInstanceOpsContract.compensationDetail, {
  middleware: monitor,
  handler: async (c) => c.json(okBody(await getCompensationDetail(c.req.valid('param').id)), 200),
});

export const compensationNoteRoute = defineContractRoute(workflowInstanceOpsContract.addCompensationNote, {
  middleware: [authMiddleware, guard({ permission: 'workflow:engine:operate', audit: { description: '补偿工单添加备注', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const b = c.req.valid('json');
    return c.json(okBody(await addCompensationNote(id, b.note, b.attachments), '已记录'), 200);
  },
});

export const compensationRetryRoute = defineContractRoute(workflowInstanceOpsContract.retryCompensation, {
  middleware: [authMiddleware, guard({ permission: 'workflow:engine:operate', audit: { description: '重试补偿动作', module: '工作流管理' } })] as const,
  handler: async (c) => c.json(okBody(await retryCompensationAction(c.req.valid('param').id), '已重新入队'), 200),
});

export const compensationResumeRoute = defineContractRoute(workflowInstanceOpsContract.resumeCompensation, {
  middleware: [authMiddleware, guard({ permission: 'workflow:engine:operate', audit: { description: '恢复流程推进', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await resumeInstanceForCompensation(id);
    return c.json(okBody(await getCompensationDetail(id), '已恢复推进'), 200);
  },
});
