import { and, eq } from 'drizzle-orm';
import { db } from '../../../db';
import { workflowDefinitions } from '../../../db/schema';
import { currentUser } from '../../../lib/context';
import { tenantCondition } from '../../../lib/tenant';
import { resolveUserNames } from '../../../lib/user-nicknames';
import { decide } from '../../platform/rules-runtime.service';
import { buildStarterContext, resolveAssigneeIds, resolveAdminUserId, filterSelectedApproverIds, listSelectableApprovers, resolveUserManagerId, resolveUserDeptHeadId } from '../workflow-assignee-resolver.service';
import { resolveActiveDelegate } from '../workflow-delegations.service';
import { resolveFormSnapshot } from '../workflow-forms.service';
import type { WorkflowFlowData } from '@zenith/shared/workflow';
import type { MemoryRuntimeFacts } from './memory';

/** Reads current organization and published assets; it cannot write runtime instances or effects. */
export function createSimulationFacts(): MemoryRuntimeFacts {
  return {
    resolve: (config, context) => resolveAssigneeIds(config, { ...context, recordRuleExecution: false }),
    filterSelected: (config, ids) => filterSelectedApproverIds(config, ids),
    candidates: async config => (await listSelectableApprovers(config)).map(user => user.id),
    starter: buildStarterContext,
    names: resolveUserNames,
    admin: resolveAdminUserId,
    timeoutTarget: async (id, level) => {
      const manager = id ? await resolveUserManagerId(id, level) : null;
      if (manager && manager !== id) return manager;
      const head = id ? await resolveUserDeptHeadId(id) : null;
      if (head && head !== id) return head;
      const admin = await resolveAdminUserId();
      return admin !== id ? admin : null;
    },
    delegate: (id, definitionId) => definitionId ? resolveActiveDelegate(db, id, definitionId) : Promise.resolve(null),
    decide: async (ref, form, starter) => (await decide(ref, { form, starter }, { caller: 'workflow.simulation', record: false, mode: 'required' })).outputs,
    definition: async id => {
      const [definition] = await db.select({ id: workflowDefinitions.id, flowData: workflowDefinitions.flowData, formId: workflowDefinitions.formId })
        .from(workflowDefinitions).where(and(eq(workflowDefinitions.id, id), eq(workflowDefinitions.status, 'published'), tenantCondition(workflowDefinitions, currentUser()))).limit(1);
      if (!definition?.flowData) return null;
      return { id, flowData: definition.flowData as WorkflowFlowData, fields: (await resolveFormSnapshot(definition.formId))?.fields ?? [] };
    },
  };
}
