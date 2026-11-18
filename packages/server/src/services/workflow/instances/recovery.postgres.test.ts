import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db, closeDb } from '../../../db';
import { users, workflowDefinitions, workflowInstances, workflowNodeActivations, workflowTokens, workflowTasks, workflowCompensations, workflowCompensationLogs } from '../../../db/schema';
import { runWithCurrentUser } from '../../../lib/context';
import { handleNodeExecutionError, resumeInstanceForCompensation } from './failure-policy';
import { rejectTaskCore } from './task-actions';
import { registerEventConsumer, sealEventConsumerRegistry } from '../../../lib/domain-events/registry';
import { getWorkflowAnalytics, listOverdueTasks } from '../workflow-analytics.service';
import { suspendInstance, resumeInstance } from './admin-ops';
import { armTaskAsyncJobs } from './async-jobs';
import type { WorkflowDefinitionSnapshot, WorkflowFlowData } from '@zenith/shared/workflow';

const url = process.env.WORKFLOW_TEST_DATABASE_URL;
const integration = url && new RegExp('^/zenith_workflow_qa_[0-9]+$').test(new URL(url).pathname) ? describe : describe.skip;

integration('workflow recovery on real PostgreSQL constraints', () => {
  let userId: number;
  const actor = () => ({ userId, name: 'recovery QA' });
  const asAdmin = <T>(fn: () => Promise<T>) => runWithCurrentUser({ userId, username: 'admin', roles: ['super_admin'], tenantId: null }, fn);
  beforeAll(async () => {
    registerEventConsumer({ key: 'qa-receipt', matches: () => true, handle: async () => ({ outcome: 'completed' }) });
    sealEventConsumerRegistry();
    const [user] = await db.insert(users).values({ username: 'admin', nickname: 'recovery QA', password: 'unused-test-fixture' }).returning();
    userId = user.id;
  });
  afterAll(async () => closeDb());

  async function fixture(type: 'trigger' | 'subProcess') {
    const flowData = { nodes: [{ id: 'failed', data: { key: 'failed', label: '执行节点', type, failurePolicy: { action: 'notify' } } }, { id: 'end', data: { key: 'end', label: '结束', type: 'end' } }], edges: [{ id: 'e', source: 'failed', target: 'end' }] } as WorkflowFlowData;
    const [definition] = await db.insert(workflowDefinitions).values({ name: `QA ${type}`, flowData, status: 'published' }).returning();
    const snapshot = { id: definition.id, name: definition.name, version: 1, flowData } as WorkflowDefinitionSnapshot;
    const [instance] = await db.insert(workflowInstances).values({ definitionId: definition.id, definitionSnapshot: snapshot, title: `QA ${type}`, status: 'running', initiatorId: userId, currentNodeKey: 'failed' }).returning();
    const [token] = await db.insert(workflowTokens).values({ instanceId: instance.id, nodeKey: 'failed', branchPath: [{ id: 'fork', index: 0, total: 2 }], scopeKey: 'parent:item:1' }).returning();
    const [activation] = await db.insert(workflowNodeActivations).values({ id: crypto.randomUUID(), instanceId: instance.id, tokenId: token.id, nodeKey: 'failed', nodeName: '执行节点', kind: 'system', baseTotal: 0, baseRequired: 0 }).returning();
    const [task] = await db.insert(workflowTasks).values({ instanceId: instance.id, nodeKey: 'failed', nodeName: '执行节点', nodeType: type, taskKind: 'system', activationId: activation.id, status: 'waiting' }).returning();
    return { instance, task, token, activation };
  }

  it('creates one repair identity on a new token and resumes it without losing parallel lineage', async () => asAdmin(async () => {
    const f = await fixture('trigger');
    const [sibling] = await db.insert(workflowTokens).values({ instanceId: f.instance.id, nodeKey: 'other', branchPath: [{ id: 'fork', index: 1, total: 2 }] }).returning();
    const fail = () => handleNodeExecutionError({ instance: f.instance, task: f.task, nodeKey: 'failed', errorMessage: 'confirmed failure', actor: actor() });
    expect(await fail()).toBe(true);
    expect(await fail()).toBe(true);
    const tickets = await db.select().from(workflowCompensations).where(eq(workflowCompensations.instanceId, f.instance.id));
    expect(tickets).toHaveLength(1);
    const [repair] = await db.select().from(workflowNodeActivations).where(eq(workflowNodeActivations.id, tickets[0].repairActivationId!));
    expect(repair.kind).toBe('repair');
    expect(repair.tokenId).not.toBe(f.token.id);
    const [token] = await db.select().from(workflowTokens).where(eq(workflowTokens.id, repair.tokenId!));
    expect(token).toMatchObject({ branchPath: f.token.branchPath, scopeKey: 'parent:item:1', parentTokenId: f.token.id });
    await resumeInstanceForCompensation(tickets[0].id);
    await expect(resumeInstanceForCompensation(tickets[0].id)).rejects.toMatchObject({ status: 400 });
    const [remaining] = await db.select().from(workflowTokens).where(eq(workflowTokens.id, sibling.id));
    expect(remaining.status).toBe('active');
    const [closed] = await db.select().from(workflowCompensations).where(eq(workflowCompensations.id, tickets[0].id));
    expect(closed.status).toBe('resolved');
    expect(closed.resolvedAt).toBeInstanceOf(Date);
    expect(await db.$count(workflowCompensationLogs, eq(workflowCompensationLogs.compensationId, closed.id))).toBeGreaterThanOrEqual(2);
  }));

  it('settles a rejected system task without an approval vote and clears the whole execution', async () => asAdmin(async () => {
    const f = await fixture('subProcess');
    await rejectTaskCore(f.task, f.instance, '子流程拒绝', actor());
    const [instance] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, f.instance.id));
    expect(instance.status).toBe('rejected');
    expect(instance.submittedAt).toBeInstanceOf(Date);
    expect(instance.completedAt).toBeInstanceOf(Date);
    expect(instance.currentNodeKey).toBeNull();
    expect(await db.$count(workflowTokens, and(eq(workflowTokens.instanceId, instance.id), eq(workflowTokens.status, 'active')))).toBe(0);
    const [activation] = await db.select().from(workflowNodeActivations).where(eq(workflowNodeActivations.id, f.activation.id));
    expect(activation.status).toBe('rejected');
    const metrics = await getWorkflowAnalytics({ definitionId: instance.definitionId });
    expect(metrics.total).toBe(1);
    expect(metrics.duration.samples).toBe(1);
    expect(metrics.pendingTaskCount).toBe(0);
    expect((await listOverdueTasks({ page: 1, pageSize: 20, definitionId: instance.definitionId })).total).toBe(0);
  }));

  it('retains SLA violations after reminder completion and pauses their clocks with the instance', async () => asAdmin(async () => {
    const f = await fixture('trigger');
    await db.update(workflowTasks).set({ status: 'pending', slaDeadline: new Date(Date.now() - 60_000) }).where(eq(workflowTasks.id, f.task.id));
    // A formal task needs a real slot; use materialization rather than manufacturing votes.
    const { advanceAndMaterialize } = await import('./materialize');
    const flowData = { nodes: [{ id: 'start', data: { key: 'start', type: 'start', label: '开始' } }, { id: 'human', data: { key: 'human', type: 'approve', label: '审批', assigneeType: 'user', sameInitiatorStrategy: 'selfApprove', assigneeId: userId, timeout: { enabled: true, duration: 1, unit: 'minutes', action: 'remind' } } }, { id: 'end', data: { key: 'end', type: 'end', label: '结束' } }], edges: [{ source: 'start', target: 'human' }, { source: 'human', target: 'end' }] } as WorkflowFlowData;
    await db.update(workflowInstances).set({ definitionSnapshot: { ...f.instance.definitionSnapshot, flowData } }).where(eq(workflowInstances.id, f.instance.id));
    await db.transaction(async tx => {
      await tx.update(workflowTokens).set({ status: 'consumed' }).where(eq(workflowTokens.id, f.token.id));
      await advanceAndMaterialize({ kind: 'enterNode', nodeKey: 'human' }, { instanceId: f.instance.id, initiatorId: userId, executor: tx, flowData, formData: {}, tenantId: null });
    });
    const [task] = await db.select().from(workflowTasks).where(and(eq(workflowTasks.instanceId, f.instance.id), eq(workflowTasks.nodeKey, 'human')));
    await armTaskAsyncJobs(task, { id: f.instance.id, flowData, formData: {}, tenantId: null });
    await db.update(workflowTasks).set({ slaDeadline: new Date(Date.now() - 60_000) }).where(eq(workflowTasks.id, task.id));
    expect((await getWorkflowAnalytics({ definitionId: f.instance.definitionId })).overdueTaskCount).toBe(1);
    expect((await listOverdueTasks({ page: 1, pageSize: 20, definitionId: f.instance.definitionId })).total).toBe(1);
    await suspendInstance(f.instance.id, 'QA clock pause');
    expect((await getWorkflowAnalytics({ definitionId: f.instance.definitionId })).pendingTaskCount).toBe(0);
    await resumeInstance(f.instance.id);
    expect((await getWorkflowAnalytics({ definitionId: f.instance.definitionId })).overdueTaskCount).toBe(1);
  }));
});
