/**
 * 显式执行 Token 运行时 — 数据库集成测试（默认跳过）。
 *
 * 需要可用的 PostgreSQL（默认连接见 .env）。为避免普通 `npm test` 触库，
 * 仅在显式 opt-in 时运行：
 *   PowerShell:  $env:WORKFLOW_DB_IT='1'; npx vitest run src/services/workflow-token-runtime.it.test.ts
 *
 * 覆盖：发起 seed → fork/join 汇聚、token 只读视图、驳回清场、仿真与运行态 join 一致性。
 */
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import type { WorkflowFlowData } from '@zenith/shared';
import type { JwtPayload } from './../middleware/auth';
import { runWithCurrentUser } from '../lib/context';

const RUN = process.env.WORKFLOW_DB_IT === '1';

describe.runIf(RUN)('workflow token runtime (DB integration)', () => {
  let db: typeof import('../db')['db'];
  let schema: typeof import('../db/schema');
  let svc: typeof import('./workflow-instances.service');
  let sim: typeof import('./workflow-simulation.service');

  let initiatorId = 0;
  let approverId = 0;
  let defId = 0;
  const createdInstanceIds: number[] = [];

  const makeParallelFlow = (): WorkflowFlowData => ({
    nodes: [
      { id: 'n1', position: { x: 0, y: 0 }, data: { key: 'start', type: 'start', label: '发起' } },
      { id: 'nf', position: { x: 1, y: 0 }, data: { key: 'fork1', type: 'parallelGateway', label: '分叉' } },
      { id: 'nfin', position: { x: 2, y: 0 }, data: { key: 'a-finance', type: 'approve', label: '财务', assigneeId: approverId } },
      { id: 'nleg', position: { x: 2, y: 1 }, data: { key: 'a-legal', type: 'approve', label: '法务', assigneeId: approverId } },
      { id: 'nj', position: { x: 3, y: 0 }, data: { key: 'join1', type: 'parallelGateway', label: '汇聚' } },
      { id: 'ne', position: { x: 4, y: 0 }, data: { key: 'end', type: 'end', label: '结束' } },
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'nf' },
      { id: 'e2', source: 'nf', target: 'nfin' },
      { id: 'e3', source: 'nf', target: 'nleg' },
      { id: 'e4', source: 'nfin', target: 'nj' },
      { id: 'e5', source: 'nleg', target: 'nj' },
      { id: 'e6', source: 'nj', target: 'ne' },
    ],
  });

  const asUser = (): JwtPayload => ({ userId: initiatorId, username: 'it-user', roles: ['super_admin'], tenantId: null });

  async function activeTokens(instanceId: number) {
    return db.select().from(schema.workflowTokens)
      .where(and(eq(schema.workflowTokens.instanceId, instanceId), eq(schema.workflowTokens.status, 'active')));
  }
  async function startParallel(title: string) {
    const inst = await svc.createInstance(
      { definitionId: defId, title },
      { userId: initiatorId, username: 'it-user', tenantId: null, roles: ['super_admin'] },
    );
    createdInstanceIds.push(inst.id);
    return inst;
  }
  async function pendingTasks(instanceId: number) {
    return db.select().from(schema.workflowTasks)
      .where(and(eq(schema.workflowTasks.instanceId, instanceId), eq(schema.workflowTasks.status, 'pending')));
  }

  beforeAll(async () => {
    db = (await import('../db')).db;
    schema = await import('../db/schema');
    svc = await import('./workflow-instances.service');
    sim = await import('./workflow-simulation.service');

    const users = await db.select({ id: schema.users.id }).from(schema.users).orderBy(schema.users.id).limit(2);
    if (users.length < 2) throw new Error('需要至少 2 个用户');
    initiatorId = users[0].id;
    approverId = users[1].id;

    const [def] = await db.insert(schema.workflowDefinitions).values({
      name: 'IT 并行 Token', code: `it_token_${Date.now()}`, flowData: makeParallelFlow(),
      formType: 'designer', status: 'published', tenantId: null, initiatorScopeType: 'all',
    }).returning();
    defId = def.id;
  });

  afterAll(async () => {
    if (createdInstanceIds.length) {
      await db.delete(schema.workflowInstances).where(inArray(schema.workflowInstances.id, createdInstanceIds));
    }
    if (defId) await db.delete(schema.workflowDefinitions).where(eq(schema.workflowDefinitions.id, defId));
  });

  it('seeds two branch tokens with a shared fork group', async () => {
    const inst = await startParallel('seed');
    const toks = await activeTokens(inst.id);
    expect(toks).toHaveLength(2);
    expect(toks.every((t) => Array.isArray(t.branchPath) && (t.branchPath as unknown[]).length === 1)).toBe(true);
    const groupIds = new Set(toks.map((t) => (t.branchPath as Array<{ id: string }>)[0].id));
    expect(groupIds.size).toBe(1);
  });

  it('parks at join on partial completion, finishes only when all branches arrive', async () => {
    const inst = await startParallel('join');
    const [instRow] = await db.select().from(schema.workflowInstances).where(eq(schema.workflowInstances.id, inst.id)).limit(1);
    const tasks = await pendingTasks(inst.id);
    expect(tasks).toHaveLength(2);

    await svc.approveTaskCore(tasks[0], instRow, 'IT-branch1', { userId: approverId, name: 'it' });
    const [after1] = await db.select({ status: schema.workflowInstances.status }).from(schema.workflowInstances).where(eq(schema.workflowInstances.id, inst.id)).limit(1);
    expect(after1.status).toBe('running');
    const mid = await activeTokens(inst.id);
    expect(mid.some((t) => t.nodeKey === 'join1')).toBe(true);

    await svc.approveTaskCore(tasks[1], instRow, 'IT-branch2', { userId: approverId, name: 'it' });
    const [after2] = await db.select({ status: schema.workflowInstances.status }).from(schema.workflowInstances).where(eq(schema.workflowInstances.id, inst.id)).limit(1);
    expect(after2.status).toBe('approved');
    expect(await activeTokens(inst.id)).toHaveLength(0);
  });

  it('exposes the execution-token view (active/parked counts)', async () => {
    const inst = await startParallel('token-view');
    const [instRow] = await db.select().from(schema.workflowInstances).where(eq(schema.workflowInstances.id, inst.id)).limit(1);
    const tasks = await pendingTasks(inst.id);
    await svc.approveTaskCore(tasks[0], instRow, 'IT', { userId: approverId, name: 'it' });

    const view = await runWithCurrentUser(asUser(), () => svc.getInstanceExecutionTokens(inst.id));
    expect(view.instanceId).toBe(inst.id);
    expect(view.parkedCount).toBe(1);      // join1 parked
    expect(view.activeCount).toBe(1);      // a-legal frontier
    expect(view.consumedCount).toBeGreaterThanOrEqual(1);
    expect(view.tokens.some((t) => t.nodeKey === 'join1' && t.parkedAtJoin)).toBe(true);
  });

  it('reject terminates the instance and kills all tokens', async () => {
    const inst = await startParallel('reject');
    const [instRow] = await db.select().from(schema.workflowInstances).where(eq(schema.workflowInstances.id, inst.id)).limit(1);
    const tasks = await pendingTasks(inst.id);
    await svc.rejectTaskCore(tasks[0], instRow, 'IT 驳回', { userId: approverId, name: 'it' });
    const [row] = await db.select({ status: schema.workflowInstances.status }).from(schema.workflowInstances).where(eq(schema.workflowInstances.id, inst.id)).limit(1);
    expect(row.status).toBe('rejected');
    expect(await activeTokens(inst.id)).toHaveLength(0);
  });

  it('simulation join/finish matches the token runtime (所见即所得)', async () => {
    const result = await runWithCurrentUser(asUser(), () => sim.simulateWorkflow({ flowData: makeParallelFlow(), starterUserId: initiatorId }));
    // 并行双分支默认通过 → 汇聚后结束（与运行态一致，token 引擎驱动）
    expect(result.result).toBe('finished');
    expect(result.timeline.some((t) => t.nodeKey === 'a-finance')).toBe(true);
    expect(result.timeline.some((t) => t.nodeKey === 'a-legal')).toBe(true);
  });
});
