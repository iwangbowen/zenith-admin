import { count, desc, eq, inArray, or } from 'drizzle-orm';
import { workflowTaskContract, workflowMySignGroupItemSchema, type WorkflowNodeActivation } from '@zenith/shared/workflow';
import type { QueryOutputOf } from '@zenith/shared/core';
import { db } from '../../db';
import { workflowSignGroups, workflowNodeActivations, workflowApprovalSlots, workflowInstances } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { tenantCondition } from '../../lib/tenant';
import { buildWhere, withPagination } from '../../lib/where-helpers';
import { buildListResult } from '../../lib/list-query';
import { pickEntity } from '../../lib/entity-map';
import { requireRow } from '../../lib/db-assert';
import { loadApprovalActivations } from './instances/approval-state';

/** 等待或已办锚定任务不在可办理待办列表，组责任人仍须有查看与减签入口。 */
export async function listMyWorkflowSignGroups(query: QueryOutputOf<typeof workflowTaskContract.mySignGroups>) {
  const user = currentUser();
  const where = buildWhere(tenantCondition(workflowNodeActivations, user), eq(workflowNodeActivations.status, 'active'),
    inArray(workflowSignGroups.status, ['waiting', 'active']), inArray(workflowInstances.status, ['running', 'suspended']),
    or(eq(workflowSignGroups.createdBy, user.userId), eq(workflowApprovalSlots.currentAssigneeId, user.userId), eq(workflowApprovalSlots.originalAssigneeId, user.userId)));
  const activationLoads = new Map<number, Promise<WorkflowNodeActivation[]>>();
  return buildListResult({ ...query,
    count: async () => {
      const [row] = await db.select({ total: count() }).from(workflowSignGroups)
        .innerJoin(workflowNodeActivations, eq(workflowSignGroups.activationId, workflowNodeActivations.id))
        .innerJoin(workflowApprovalSlots, eq(workflowSignGroups.anchorSlotId, workflowApprovalSlots.id))
        .innerJoin(workflowInstances, eq(workflowNodeActivations.instanceId, workflowInstances.id)).where(where);
      return Number(row?.total ?? 0);
    },
    rows: () => withPagination(db.select({ groupId: workflowSignGroups.id, activationId: workflowNodeActivations.id,
      instanceId: workflowInstances.id, title: workflowInstances.title, instanceStatus: workflowInstances.status,
      nodeName: workflowNodeActivations.nodeName }).from(workflowSignGroups)
      .innerJoin(workflowNodeActivations, eq(workflowSignGroups.activationId, workflowNodeActivations.id))
      .innerJoin(workflowApprovalSlots, eq(workflowSignGroups.anchorSlotId, workflowApprovalSlots.id))
      .innerJoin(workflowInstances, eq(workflowNodeActivations.instanceId, workflowInstances.id))
      .where(where).orderBy(desc(workflowSignGroups.id)).$dynamic(), query.page, query.pageSize),
    map: async (row) => {
      let load = activationLoads.get(row.instanceId);
      if (!load) { load = loadApprovalActivations(db, row.instanceId, user.userId); activationLoads.set(row.instanceId, load); }
      const activation = requireRow((await load).find((item) => item.id === row.activationId), '审批轮次不存在');
      const group = requireRow(activation.signGroups.find((item) => item.id === row.groupId), '加签组不存在');
      return pickEntity(workflowMySignGroupItemSchema, { ...group, instanceId: row.instanceId, title: row.title,
        nodeName: row.nodeName, instanceStatus: row.instanceStatus });
    },
  });
}
