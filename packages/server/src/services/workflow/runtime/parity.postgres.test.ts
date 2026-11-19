import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { db, closeDb } from '../../../db';
import { users, workflowDefinitions, workflowInstances, workflowTasks } from '../../../db/schema';
import { runWithCurrentUser } from '../../../lib/context';
import { advanceAndMaterialize, checkNodeCompletion } from '../instances/materialize';
import { recordSlotOutcome } from '../instances/approval-state';
import { MemoryWorkflowRuntime } from './memory';
import { createSimulationFacts } from './simulation-facts';
import { registerEventConsumer, sealEventConsumerRegistry } from '../../../lib/domain-events/registry';
import type { WorkflowFlowData, WorkflowDefinitionSnapshot } from '@zenith/shared/workflow';

const url = process.env.WORKFLOW_TEST_DATABASE_URL;
const integration = url && /^\/zenith_workflow_qa_[0-9]+$/.test(new URL(url).pathname) ? describe : describe.skip;

integration('PostgreSQL and memory execution parity', () => {
  let ids: number[];
  const fixtures: number[] = [];
  beforeAll(async () => {
    registerEventConsumer({ key: 'runtime-parity-receipt', matches: () => true, handle: async () => ({ outcome: 'completed' }) });
    sealEventConsumerRegistry();
    ids = (await db.insert(users).values(['initiator','first','second','next'].map((key, index) => ({ username: 'rp-' + key + '-' + Date.now().toString(36), nickname: '运行时对照' + index, password: 'unused-test-fixture' }))).returning()).map(row => row.id);
  });
  afterAll(async () => {
    if (fixtures.length) await db.delete(workflowInstances).where(inArray(workflowInstances.definitionId, fixtures));
    if (fixtures.length) await db.delete(workflowDefinitions).where(inArray(workflowDefinitions.id, fixtures));
    if (ids?.length) await db.delete(users).where(inArray(users.id, ids));
    await closeDb();
  });
  it.each(['and', 'or', 'sequential', 'ratio'] as const)('matches task states and next frontier after every %s vote', async method => runWithCurrentUser({ userId: ids[0], username: 'runtime-parity', roles: ['super_admin'], tenantId: null }, async () => {
    const flow: WorkflowFlowData = {
      settings: { approverDedupMode: 'none' },
      nodes: [
        { id: 'start', position: { x: 0, y: 0 }, data: { key: 'start', type: 'start', label: '发起' } },
        { id: 'review', position: { x: 0, y: 0 }, data: { key: 'review', type: 'approve', label: '财务会审', assigneeType: 'user', assigneeIds: [ids[1], ids[2]], approveMethod: method, approveRatio: 100 } },
        { id: 'next', position: { x: 0, y: 0 }, data: { key: 'next', type: 'approve', label: '总监审批', assigneeType: 'user', assigneeIds: [ids[3]] } },
        { id: 'end', position: { x: 0, y: 0 }, data: { key: 'end', type: 'end', label: '结束' } },
      ], edges: [{ id: 'a', source: 'start', target: 'review' }, { id: 'b', source: 'review', target: 'next' }, { id: 'c', source: 'next', target: 'end' }],
    };
    const [definition] = await db.insert(workflowDefinitions).values({ name: '同运行时对照-' + method, flowData: flow, status: 'published' }).returning(); fixtures.push(definition.id);
    const [instance] = await db.insert(workflowInstances).values({ definitionId: definition.id, definitionSnapshot: { id: definition.id, name: definition.name, version: 1, flowData: flow } as WorkflowDefinitionSnapshot,
      title: '真实数据库对照', initiatorId: ids[0], status: 'running', formData: {} }).returning();
    await db.transaction(tx => advanceAndMaterialize({ kind: 'seed' }, { instanceId: instance.id, initiatorId: ids[0], executor: tx, flowData: flow, formData: {}, settings: flow.settings }));
    const memory = await new MemoryWorkflowRuntime(createSimulationFacts(), { seed: 1 }).start({ id: definition.id, flowData: flow, fields: [] }, {}, ids[0]);
    const compare = async () => {
      const actual = await db.select().from(workflowTasks).where(and(eq(workflowTasks.instanceId, instance.id), inArray(workflowTasks.status, ['pending','waiting'])));
      const project = (tasks: Array<{ nodeKey: string; assigneeId: number | null; status: string; waitReason: string | null }>) => tasks.map(task => ({ nodeKey: task.nodeKey, assigneeId: task.assigneeId, status: task.status, waitReason: task.waitReason })).sort((a,b) => a.nodeKey.localeCompare(b.nodeKey) || (a.assigneeId ?? 0) - (b.assigneeId ?? 0));
      expect(project((await memory.snapshot()).tasks)).toEqual(project(actual));
    };
    await compare();
    for (const id of method === 'or' ? [ids[1]] : [ids[1], ids[2]]) {
      const [task] = await db.select().from(workflowTasks).where(and(eq(workflowTasks.instanceId, instance.id), eq(workflowTasks.nodeKey, 'review'), eq(workflowTasks.assigneeId, id), eq(workflowTasks.status, 'pending')));
      expect(task).toBeDefined();
      await db.transaction(async tx => {
        const [updated] = await tx.update(workflowTasks).set({ status: 'approved', actionAt: new Date() }).where(eq(workflowTasks.id, task.id)).returning();
        await recordSlotOutcome(tx, updated, 'approved');
        const complete = await checkNodeCompletion(tx, instance, 'review', flow, task.activationId);
        if (complete.completed) await advanceAndMaterialize({ kind: 'advanceNode', nodeKey: 'review' }, { instanceId: instance.id, initiatorId: ids[0], executor: tx, flowData: flow, formData: {}, settings: flow.settings });
      });
      await memory.command({ nodeKey: 'review', assigneeId: id, action: 'approve' });
      await compare();
    }
  }));
});
