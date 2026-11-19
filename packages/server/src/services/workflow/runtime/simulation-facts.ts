import { and, eq } from 'drizzle-orm';
import { db } from '../../../db';
import { workflowDefinitions } from '../../../db/schema';
import { currentUser } from '../../../lib/context';
import { tenantCondition } from '../../../lib/tenant';
import { requireTenantUser, resolveUserNames } from '../../../lib/user-nicknames';
import { decide } from '../../platform/rules-runtime.service';
import { buildStarterContext, resolveAssigneeIds, resolveAdminUserId, filterSelectedApproverIds, searchSelectableApprovers, resolveUserManagerId, resolveUserDeptHeadId } from '../workflow-assignee-resolver.service';
import { resolveActiveDelegate } from '../workflow-delegations.service';
import { resolveFormSnapshot } from '../workflow-forms.service';
import type { WorkflowFlowData } from '@zenith/shared/workflow';
import type { MemoryRuntimeFacts } from './memory';

/** Reads current organization and published assets; it cannot write runtime instances or effects. */
export function createSimulationFacts(): MemoryRuntimeFacts {
  return {
    resolve: (config, context) => resolveAssigneeIds(config, { ...context, recordRuleExecution: false }),
    filterSelected: (config, ids) => filterSelectedApproverIds(config, ids),
    candidates: async config => (await searchSelectableApprovers(config, { limit: 200 })).items.map(user => user.id),
    starter: async id => { await requireTenantUser(id, '发起人不存在', { enabledOnly: true }); return buildStarterContext(id); },
    names: resolveUserNames,
    validateUsers: async ids => { for (const id of ids) await requireTenantUser(id, '协作成员不存在', { enabledOnly: true }); },
    admin: resolveAdminUserId,
    timeoutTarget: async (id, level) => {
      const manager = id ? await resolveUserManagerId(id, level) : null;
      if (manager && manager !== id) return manager;
      const head = id ? await resolveUserDeptHeadId(id) : null;
      if (head && head !== id) return head;
      const admin = await resolveAdminUserId();
      return admin !== id ? admin : null;
    },
    delegate: (id, definitionId, now) => definitionId ? resolveActiveDelegate(db, id, definitionId, new Date(now)) : Promise.resolve(null),
    decide: async (ref, form, starter) => (await decide(ref, { form, starter }, { caller: 'workflow.simulation', record: false })).outputs,
    definition: async id => {
      const [definition] = await db.select({ id: workflowDefinitions.id, flowData: workflowDefinitions.flowData, formId: workflowDefinitions.formId })
        .from(workflowDefinitions).where(and(eq(workflowDefinitions.id, id), eq(workflowDefinitions.status, 'published'), tenantCondition(workflowDefinitions, currentUser()))).limit(1);
      if (!definition?.flowData) return null;
      return { id, flowData: definition.flowData as WorkflowFlowData, fields: (await resolveFormSnapshot(definition.formId))?.fields ?? [] };
    },
  };
}
