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
import { runWithCurrentUser, runWithTraceId } from '../lib/context';

const RUN = process.env.WORKFLOW_DB_IT === '1';

describe.runIf(RUN)('workflow token runtime (DB integration)', () => {
  let db: typeof import('../db')['db'];
  let schema: typeof import('../db/schema');
  let svc: typeof import('./workflow-instances.service');
  let sim: typeof import('./workflow-simulation.service');
  let defsSvc: typeof import('./workflow-definitions.service');
  let jobsSvc: typeof import('./workflow-jobs.service');

  let initiatorId = 0;
  let approverId = 0;
  let defId = 0;
  let timeoutDefId = 0;
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

  const makeTimeoutFlow = (): WorkflowFlowData => ({
    nodes: [
      { id: 'n1', position: { x: 0, y: 0 }, data: { key: 'start', type: 'start', label: '发起' } },
      { id: 'na', position: { x: 1, y: 0 }, data: { key: 'a1', type: 'approve', label: '审批', assigneeId: approverId, timeout: { enabled: true, duration: 24, unit: 'hours', action: 'remind' } } },
      { id: 'ne', position: { x: 2, y: 0 }, data: { key: 'end', type: 'end', label: '结束' } },
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'na' },
      { id: 'e2', source: 'na', target: 'ne' },
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
    defsSvc = await import('./workflow-definitions.service');
    jobsSvc = await import('./workflow-jobs.service');

    const users = await db.select({ id: schema.users.id }).from(schema.users).orderBy(schema.users.id).limit(2);
    if (users.length < 2) throw new Error('需要至少 2 个用户');
    initiatorId = users[0].id;
    approverId = users[1].id;

    const [def] = await db.insert(schema.workflowDefinitions).values({
      name: 'IT 并行 Token', code: `it_token_${Date.now()}`, flowData: makeParallelFlow(),
      formType: 'designer', status: 'published', tenantId: null, initiatorScopeType: 'all',
    }).returning();
    defId = def.id;

    const [timeoutDef] = await db.insert(schema.workflowDefinitions).values({
      name: 'IT 超时装配', code: `it_arm_${Date.now()}`, flowData: makeTimeoutFlow(),
      formType: 'designer', status: 'published', tenantId: null, initiatorScopeType: 'all',
    }).returning();
    timeoutDefId = timeoutDef.id;
  });

  afterAll(async () => {
    if (createdInstanceIds.length) {
      await db.delete(schema.workflowInstances).where(inArray(schema.workflowInstances.id, createdInstanceIds));
    }
    if (defId) await db.delete(schema.workflowDefinitions).where(eq(schema.workflowDefinitions.id, defId));
    if (timeoutDefId) await db.delete(schema.workflowDefinitions).where(eq(schema.workflowDefinitions.id, timeoutDefId));
  });

  it('arms the task_timeout job atomically inside the seed transaction', async () => {
    const inst = await svc.createInstance(
      { definitionId: timeoutDefId, title: 'arm' },
      { userId: initiatorId, username: 'it-user', tenantId: null, roles: ['super_admin'] },
    );
    createdInstanceIds.push(inst.id);
    const [task] = await db.select().from(schema.workflowTasks)
      .where(and(eq(schema.workflowTasks.instanceId, inst.id), eq(schema.workflowTasks.nodeKey, 'a1')));
    expect(task).toBeTruthy();
    // 作业与任务行同一事务落库：createInstance 返回后作业即应可见（不依赖提交后补挂）
    const jobs = await db.select().from(schema.workflowJobs)
      .where(and(eq(schema.workflowJobs.instanceId, inst.id), eq(schema.workflowJobs.jobType, 'task_timeout')));
    expect(jobs).toHaveLength(1);
    expect(jobs[0].taskId).toBe(task.id);
    expect(jobs[0].idempotencyKey).toBe(`task_timeout:${task.id}`);
  });

  it('propagates one operation traceId across its whole job/event fan-out', async () => {
    const traceId = `it-trace-${Date.now()}`;
    const inst = await runWithTraceId(traceId, () => svc.createInstance(
      { definitionId: timeoutDefId, title: 'trace' },
      { userId: initiatorId, username: 'it-user', tenantId: null, roles: ['super_admin'] },
    ));
    createdInstanceIds.push(inst.id);
    // seed 装配的 task_timeout 作业 + 发起事件 outbox 作业都应携带同一 traceId
    const jobs = await db.select().from(schema.workflowJobs).where(eq(schema.workflowJobs.instanceId, inst.id));
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs.every((j) => j.traceId === traceId)).toBe(true);
    // 链路 API 返回该 traceId 关联的全部作业
    const chain = await jobsSvc.getWorkflowJobChain(traceId);
    expect(chain.stats.total).toBe(jobs.length);
    expect(chain.stats.instanceIds).toContain(inst.id);
  });

  it('publish hard-gate blocks definitions with critical health issues', async () => {
    const [badDef] = await db.insert(schema.workflowDefinitions).values({
      name: 'IT 体检拦截', code: `it_gate_${Date.now()}`,
      flowData: {
        nodes: [
          { id: 'n1', position: { x: 0, y: 0 }, data: { key: 'start', type: 'start', label: '发起' } },
          { id: 'na', position: { x: 1, y: 0 }, data: { key: 'a1', type: 'approve', label: '审批' } }, // 无审批人来源 → critical
          { id: 'ne', position: { x: 2, y: 0 }, data: { key: 'end', type: 'end', label: '结束' } },
        ],
        edges: [{ id: 'e1', source: 'n1', target: 'na' }, { id: 'e2', source: 'na', target: 'ne' }],
      },
      formType: 'designer', status: 'draft', tenantId: null, initiatorScopeType: 'all',
    }).returning();
    try {
      await expect(
        runWithCurrentUser(asUser(), () => defsSvc.publishDefinition(badDef.id)),
      ).rejects.toThrow(/体检未通过|审批人/);
      const [after] = await db.select({ status: schema.workflowDefinitions.status })
        .from(schema.workflowDefinitions).where(eq(schema.workflowDefinitions.id, badDef.id)).limit(1);
      expect(after.status).toBe('draft'); // 拦截后仍为草稿，未发布
    } finally {
      await db.delete(schema.workflowDefinitions).where(eq(schema.workflowDefinitions.id, badDef.id));
    }
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

  it('batchSkipStuckTokens advances every running instance stuck at a node', async () => {
    const a = await startParallel('batch-skip-a');
    const b = await startParallel('batch-skip-b');
    const res = await runWithCurrentUser(asUser(), () => svc.batchSkipStuckTokens({ definitionId: defId, nodeKey: 'a-finance' }));
    expect(res.total).toBeGreaterThanOrEqual(2);
    expect(res.success).toBe(res.total);
    expect(res.failed).toBe(0);
    // a/b 的财务分支被跳过 → join1 parked，财务前沿消失，实例仍运行
    for (const inst of [a, b]) {
      const toks = await activeTokens(inst.id);
      expect(toks.some((t) => t.nodeKey === 'join1')).toBe(true);
      expect(toks.some((t) => t.nodeKey === 'a-finance')).toBe(false);
      const [row] = await db.select({ status: schema.workflowInstances.status }).from(schema.workflowInstances).where(eq(schema.workflowInstances.id, inst.id)).limit(1);
      expect(row.status).toBe('running');
    }
  });

  it('connector circuit breaker opens after threshold failures, resets on demand', async () => {
    const breaker = await import('../lib/workflow-connector-breaker');
    const redis = (await import('../lib/redis')).default;
    let redisUp = true;
    try { await redis.ping(); } catch { redisUp = false; }
    const cid = 990001; // 合成连接器 id（仅作熔断键）
    const cfg = { enabled: true, failureThreshold: 3, cooldownSec: 30 };
    await breaker.breakerReset(cid);
    expect((await breaker.breakerAllow(cid, cfg)).allowed).toBe(true);
    await breaker.breakerFailure(cid, cfg);
    await breaker.breakerFailure(cid, cfg);
    await breaker.breakerFailure(cid, cfg);
    const after = await breaker.breakerAllow(cid, cfg);
    if (redisUp) {
      expect(after.allowed).toBe(false);
      expect(after.state).toBe('open');
      await breaker.breakerReset(cid);
      expect((await breaker.breakerAllow(cid, cfg)).allowed).toBe(true);
    } else {
      expect(after.allowed).toBe(true); // Redis 不可用时 fail-open，不阻断业务
    }
  });

  it('runtime connector loader + invoke (the path trigger nodes use)', async () => {
    const connectorsSvc = await import('./workflow-connectors.service');
    const created = await runWithCurrentUser(asUser(), () => connectorsSvc.createWorkflowConnector({
      name: 'IT 连接器', code: `it_conn_${Date.now()}`, type: 'http',
      config: { baseUrl: 'http://127.0.0.1:1', method: 'GET', authType: 'none' },
      timeoutMs: 1000, status: 'enabled',
    }));
    try {
      // 运行时按 id 加载（无租户上下文，worker 安全）
      const row = await connectorsSvc.getConnectorRowById(created.id);
      expect(row).toBeTruthy();
      expect(row!.code).toBe(created.code);
      // 调用不可达地址 → ok:false（trigger-dispatch 据此走失败/重试/熔断）
      const result = await connectorsSvc.invokeConnector(row!, { path: '/health' });
      expect(result.ok).toBe(false);
      expect(result.error).toBeTruthy();
    } finally {
      await db.delete(schema.workflowConnectors).where(eq(schema.workflowConnectors.id, created.id));
    }
  });

  it('IM adapter invoke writes an audit row and stats aggregate counts', async () => {
    const connectorsSvc = await import('./workflow-connectors.service');
    const created = await runWithCurrentUser(asUser(), () => connectorsSvc.createWorkflowConnector({
      name: 'IT 企业微信', code: `it_wecom_${Date.now()}`, type: 'wecom',
      config: { baseUrl: 'http://127.0.0.1:1', method: 'POST', authType: 'none' },
      timeoutMs: 1000, status: 'enabled',
    }));
    try {
      const row = await connectorsSvc.getConnectorRowById(created.id);
      // 不可达地址 → 失败，但仍应写入审计流水
      const r = await connectorsSvc.invokeConnector(row!, { source: 'external', message: '审批结果：已通过' });
      expect(r.ok).toBe(false);

      const invocations = await runWithCurrentUser(asUser(), () => connectorsSvc.listConnectorInvocations(created.id, 10));
      expect(invocations.length).toBeGreaterThanOrEqual(1);
      expect(invocations[0]!.source).toBe('external');
      expect(invocations[0]!.ok).toBe(false);

      const stats = await runWithCurrentUser(asUser(), () => connectorsSvc.getConnectorStats(created.id, 7));
      expect(stats.total).toBeGreaterThanOrEqual(1);
      expect(stats.failed).toBeGreaterThanOrEqual(1);
      expect(stats.successRate).toBeLessThanOrEqual(1);
    } finally {
      await db.delete(schema.workflowConnectorInvocations).where(eq(schema.workflowConnectorInvocations.connectorId, created.id));
      await db.delete(schema.workflowConnectors).where(eq(schema.workflowConnectors.id, created.id));
    }
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

  it('skipStuckToken consumes a frontier token and advances past its node', async () => {
    const inst = await startParallel('skip');
    const toks = await activeTokens(inst.id);
    const finTok = toks.find((t) => t.nodeKey === 'a-finance')!;
    await runWithCurrentUser(asUser(), () => svc.skipStuckToken(finTok.id, 'IT skip'));
    const [after] = await db.select({ status: schema.workflowInstances.status }).from(schema.workflowInstances).where(eq(schema.workflowInstances.id, inst.id)).limit(1);
    expect(after.status).toBe('running'); // 财务分支跳过 → join parked，法务分支仍待办
    const mid = await activeTokens(inst.id);
    expect(mid.some((t) => t.nodeKey === 'join1')).toBe(true);
    // 处理剩余法务分支 → 汇聚达成 → 结束
    const [instRow] = await db.select().from(schema.workflowInstances).where(eq(schema.workflowInstances.id, inst.id)).limit(1);
    const legal = (await pendingTasks(inst.id)).find((t) => t.nodeKey === 'a-legal')!;
    await svc.approveTaskCore(legal, instRow, 'IT', { userId: approverId, name: 'it' });
    const [done] = await db.select({ status: schema.workflowInstances.status }).from(schema.workflowInstances).where(eq(schema.workflowInstances.id, inst.id)).limit(1);
    expect(done.status).toBe('approved');
  });

  it('replayFromToken resets the flow to the token node (single frontier)', async () => {
    const inst = await startParallel('replay');
    const toks = await activeTokens(inst.id);
    const finTok = toks.find((t) => t.nodeKey === 'a-finance')!;
    await runWithCurrentUser(asUser(), () => svc.replayFromToken(finTok.id, 'IT replay'));
    const live = await activeTokens(inst.id);
    // 重放清场全部旧 token，仅在目标节点重建单一 frontier
    expect(live).toHaveLength(1);
    expect(live[0].nodeKey).toBe('a-finance');
    const pend = await pendingTasks(inst.id);
    expect(pend.some((t) => t.nodeKey === 'a-finance')).toBe(true);
  });

  it('exportInstanceDiagnosticBundle returns diagnostics + trace + tokens', async () => {
    const inst = await startParallel('bundle');
    const bundle = await runWithCurrentUser(asUser(), () => svc.exportInstanceDiagnosticBundle(inst.id));
    expect(bundle.instanceId).toBe(inst.id);
    expect(bundle.diagnostics.tokens.length).toBeGreaterThan(0);
    expect(bundle.tokens.activeCount).toBeGreaterThan(0);
    expect(Array.isArray(bundle.trace.trace)).toBe(true);
  });
});
