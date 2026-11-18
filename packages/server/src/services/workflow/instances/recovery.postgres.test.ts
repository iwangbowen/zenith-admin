import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db, closeDb } from '../../../db';
import { users, workflowDefinitions, workflowInstances, workflowNodeActivations, workflowTokens, workflowTasks, workflowCompensations, workflowCompensationLogs } from '../../../db/schema';
import { runWithCurrentUser } from '../../../lib/context';
import { handleNodeExecutionError, resumeInstanceForCompensation } from './failure-policy';
import { rejectTaskCore } from './task-actions';
import { registerEventConsumer, sealEventConsumerRegistry } from '../../../lib/domain-events/registry';
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
    expect(instance.currentNodeKey).toBeNull();
    expect(await db.$count(workflowTokens, and(eq(workflowTokens.instanceId, instance.id), eq(workflowTokens.status, 'active')))).toBe(0);
    const [activation] = await db.select().from(workflowNodeActivations).where(eq(workflowNodeActivations.id, f.activation.id));
    expect(activation.status).toBe('rejected');
  }));
});
