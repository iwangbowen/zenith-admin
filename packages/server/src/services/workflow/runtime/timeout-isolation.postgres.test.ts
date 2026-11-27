import { randomUUID } from 'node:crypto';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { accessScopeKey, TENANT_ADMIN_CODE } from '@zenith/shared/identity';
import type { WorkflowFlowData, WorkflowTimeoutConfig } from '@zenith/shared/workflow';

const connection = process.env.WORKFLOW_TIMEOUT_TEST_DATABASE_URL;

describe.runIf(Boolean(connection))('workflow timeout isolation on PostgreSQL', () => {
  let database: typeof import('../../../db');
  let tables: typeof import('../../../db/schema');
  let jobs: typeof import('../../../lib/workflow-jobs/engine');
  let eventDelivery: typeof import('../../../lib/domain-events/engine');
  let notification: typeof import('../../messaging/notification-outbox.service');
  let advance: typeof import('../instances/materialize').advanceAndMaterialize;
  let tenantId: number;
  let otherTenantId: number;
  let assigneeId: number;
  let managerId: number;
  let foreignUserId: number;
  let departmentId: number;
  const instanceIds: number[] = [];
  const definitionIds: number[] = [];
  const suffix = randomUUID().slice(0, 8);

  async function createUser(label: string, tenant: number, canHandle = true) {
    const [row] = await database.db.insert(tables.users).values({
      username: `wft-${suffix}-${label}`, nickname: label, password: 'unused-test-fixture', tenantId: tenant,
    }).returning();
    if (canHandle) {
      await database.db.insert(tables.identityUserPermissions).values({
        userId: row.id, permissionCode: 'workflow:task:handle', dataScope: 'all', scopeKey: accessScopeKey('all', []),
      });
    }
    return row.id;
  }

  async function setLeader(leaderId: number | null) {
    await database.db.update(tables.departments).set({ leaderId }).where(eq(tables.departments.id, departmentId));
  }

  beforeAll(async () => {
    const url = new URL(connection!);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/^\/zenith_review_workflow(?:_\d+)?$/.test(url.pathname)) {
      throw new Error('Requires a disposable local zenith_review_workflow database');
    }
    vi.stubEnv('DATABASE_URL', connection!);
    vi.stubEnv('MULTI_TENANT_MODE', 'true');
    vi.stubEnv('LICENSE_MODE', 'off');
    database = await import('../../../db');
    tables = await import('../../../db/schema');
    jobs = await import('../../../lib/workflow-jobs/engine');
    await import('../../../lib/workflow-jobs/handlers/task-timeout');
    ({ advanceAndMaterialize: advance } = await import('../instances/materialize'));
    eventDelivery = await import('../../../lib/domain-events/engine');
    notification = await import('../../messaging/notification-outbox.service');
    const { registerNotificationWorkflowSubscriber } = await import('../../../lib/workflow-subscribers/notification');
    const { sealEventConsumerRegistry } = await import('../../../lib/domain-events/registry');
    const { registerNotificationAdapter } = await import('../../../lib/notification/registry');
    const { inAppAdapter } = await import('../../../lib/notification/adapters/inapp.adapter');
    registerNotificationWorkflowSubscriber();
    sealEventConsumerRegistry();
    registerNotificationAdapter(inAppAdapter);
    const [current] = await database.pgClient<{ name: string }[]>`select current_database() as name`;
    expect(current.name).toBe(url.pathname.slice(1));

    const [own, foreign] = await database.db.insert(tables.tenants).values([
      { name: `Timeout ${suffix} A`, code: `wft-${suffix}-a` },
      { name: `Timeout ${suffix} B`, code: `wft-${suffix}-b` },
    ]).returning();
    tenantId = own.id;
    otherTenantId = foreign.id;
    assigneeId = await createUser('assignee', tenantId);
    managerId = await createUser('manager', tenantId);
    foreignUserId = await createUser('foreign', otherTenantId);
    const [department] = await database.db.insert(tables.departments).values({
      name: 'Review', code: 'review', tenantId, leaderId: managerId,
    }).returning();
    departmentId = department.id;
    await database.db.update(tables.users).set({ departmentId }).where(eq(tables.users.id, assigneeId));
  }, 120_000);

  afterAll(async () => {
    if (database && tables) {
      if (instanceIds.length) await database.db.delete(tables.workflowInstances).where(inArray(tables.workflowInstances.id, instanceIds));
      if (definitionIds.length) await database.db.delete(tables.workflowDefinitions).where(inArray(tables.workflowDefinitions.id, definitionIds));
      if (tenantId && otherTenantId) await database.db.delete(tables.tenants).where(inArray(tables.tenants.id, [tenantId, otherTenantId]));
      await database.closeDb();
    }
    vi.unstubAllEnvs();
  });

  async function fixture(fallback: WorkflowTimeoutConfig['escalateFallbackAction'] = 'none', remindCount = 1, level = 1) {
    const flowData: WorkflowFlowData = {
      nodes: [
        { id: 'start', position: { x: 0, y: 0 }, data: { key: 'start', type: 'start', label: '申请' } },
        { id: 'review', position: { x: 0, y: 0 }, data: { key: 'review', type: 'approve', label: '审批', assigneeType: 'user', assigneeIds: [assigneeId],
          timeout: { enabled: true, duration: 1, unit: 'hours', action: 'remind', remindCount, escalateAction: 'transferToManager', escalateManagerLevel: level, escalateFallbackAction: fallback },
        } },
        { id: 'end', position: { x: 0, y: 0 }, data: { key: 'end', type: 'end', label: '结束' } },
      ],
      edges: [{ id: 'a', source: 'start', target: 'review' }, { id: 'b', source: 'review', target: 'end' }],
    };
    const [definition] = await database.db.insert(tables.workflowDefinitions).values({
      name: `Timeout ${suffix} ${definitionIds.length}`, flowData, status: 'published', tenantId,
    }).returning();
    definitionIds.push(definition.id);
    const [instance] = await database.db.insert(tables.workflowInstances).values({
      definitionId: definition.id, definitionSnapshot: { id: definition.id, name: definition.name, version: 1, flowData },
      title: definition.name, initiatorId: managerId, status: 'running', formData: {}, tenantId,
    }).returning();
    instanceIds.push(instance.id);
    await database.db.transaction(executor => advance({ kind: 'seed' }, {
      instanceId: instance.id, initiatorId: instance.initiatorId, executor, flowData, formData: {}, tenantId,
    }));
    const [task] = await database.db.select().from(tables.workflowTasks).where(eq(tables.workflowTasks.instanceId, instance.id));
    const [job] = await database.db.select().from(tables.workflowJobs).where(and(eq(tables.workflowJobs.taskId, task.id), eq(tables.workflowJobs.jobType, 'task_timeout')));
    return { instance, task, job };
  }

  async function due(jobId: number) {
    await database.db.update(tables.workflowJobs).set({ runAt: new Date(0) }).where(eq(tables.workflowJobs.id, jobId));
  }

  async function taskState(taskId: number) {
    return (await database.db.select().from(tables.workflowTasks).where(eq(tables.workflowTasks.id, taskId)))[0];
  }

  it('hydrates an older job and transfers exactly once, including a fresh reminder cycle', async () => {
    await setLeader(managerId);
    const { instance, task, job } = await fixture('none', 2);
    await database.db.update(tables.workflowJobs).set({ instanceId: null, tenantId: null, nodeKey: null }).where(eq(tables.workflowJobs.id, job.id));
    await due(job.id);
    await jobs.runJob(job.id);
    const [transferJob] = await database.db.select().from(tables.workflowJobs)
      .where(and(eq(tables.workflowJobs.taskId, task.id), ne(tables.workflowJobs.id, job.id)));
    expect(transferJob).toMatchObject({ instanceId: instance.id, tenantId, nodeKey: task.nodeKey, payload: { remindCount: 1 } });
    await due(transferJob.id);
    await Promise.all([jobs.runJob(transferJob.id), jobs.runJob(transferJob.id)]);
    expect(await taskState(task.id)).toMatchObject({ assigneeId: managerId, status: 'pending' });
    const [slot] = await database.db.select().from(tables.workflowApprovalSlots).where(eq(tables.workflowApprovalSlots.id, task.slotId!));
    expect(slot).toMatchObject({ currentAssigneeId: managerId, tenantId });
    const transfers = await database.db.select().from(tables.workflowTaskTransfers).where(eq(tables.workflowTaskTransfers.taskId, task.id));
    expect(transfers).toMatchObject([{ fromUserId: assigneeId, toUserId: managerId, action: 'timeout', tenantId }]);
    expect(await database.db.$count(tables.workflowJobEffects, eq(tables.workflowJobEffects.jobId, transferJob.id))).toBe(1);
    const [repeat] = await database.db.select().from(tables.workflowJobs).where(and(eq(tables.workflowJobs.taskId, task.id), eq(tables.workflowJobs.status, 'pending')));
    expect(repeat).toMatchObject({ instanceId: instance.id, tenantId, payload: { remindCount: 0 } });
    await due(repeat.id);
    await jobs.runJob(repeat.id);
    const [next] = await database.db.select().from(tables.workflowJobs).where(and(eq(tables.workflowJobs.taskId, task.id), eq(tables.workflowJobs.status, 'pending')));
    expect(next).toMatchObject({ instanceId: instance.id, tenantId, payload: { remindCount: 1 } });
    expect(await database.db.$count(tables.workflowTaskTransfers, eq(tables.workflowTaskTransfers.taskId, task.id))).toBe(1);
  });

  it('stays inside the department tree and skips a disabled higher-level target', async () => {
    const unavailable = await createUser('unavailable', tenantId);
    const senior = await createUser('senior', tenantId);
    const [parent] = await database.db.insert(tables.departments).values({ name: 'Parent', code: 'parent', tenantId, leaderId: senior }).returning();
    await database.db.update(tables.departments).set({ parentId: parent.id }).where(eq(tables.departments.id, departmentId));
    await setLeader(managerId);
    const first = await fixture('none', 1, 2);
    await due(first.job.id);
    await jobs.runJob(first.job.id);
    expect(await taskState(first.task.id)).toMatchObject({ assigneeId: senior });

    await database.db.update(tables.users).set({ status: 'disabled' }).where(eq(tables.users.id, unavailable));
    await database.db.update(tables.departments).set({ leaderId: unavailable }).where(eq(tables.departments.id, parent.id));
    const second = await fixture('none', 1, 2);
    await due(second.job.id);
    await jobs.runJob(second.job.id);
    expect(await taskState(second.task.id)).toMatchObject({ assigneeId: managerId });
  });

  const noTargetCases = [['none', 'pending'], ['autoApprove', 'approved'], ['autoReject', 'rejected']] as const;
  it.each(noTargetCases)('applies the configured %s fallback with no in-scope leader or administrator', async (fallback, status) => {
      await setLeader(foreignUserId);
      const { task, job } = await fixture(fallback);
      await due(job.id);
      await jobs.runJob(job.id);
      expect(await taskState(task.id)).toMatchObject({ assigneeId, status });
      expect(await database.db.$count(tables.workflowTaskTransfers, eq(tables.workflowTaskTransfers.taskId, task.id))).toBe(0);
  });

  it('selects an enabled tenant administrator with handling permission', async () => {
    const unusableLeader = await createUser('no-permission', tenantId, false);
    await setLeader(unusableLeader);
    const tenantAdmin = await createUser('tenant-admin', tenantId);
    const [role] = await database.db.insert(tables.roles).values({
      name: 'Tenant Admin', code: TENANT_ADMIN_CODE, tenantId, status: 'enabled',
    }).returning();
    await database.db.insert(tables.userRoles).values({ userId: tenantAdmin, roleId: role.id });
    const { task, job } = await fixture();
    await due(job.id);
    await jobs.runJob(job.id);
    expect(await taskState(task.id)).toMatchObject({ assigneeId: tenantAdmin });
  });

  it('leaves the task unchanged when recorded job scope disagrees with the owning instance', async () => {
    const { task, job } = await fixture();
    await database.db.update(tables.workflowJobs).set({ tenantId: otherTenantId }).where(eq(tables.workflowJobs.id, job.id));
    await due(job.id);
    await jobs.runJob(job.id);
    expect(await taskState(task.id)).toMatchObject({ assigneeId, status: 'pending', breachedAt: null });
    const [invalid] = await database.db.select().from(tables.workflowJobs).where(eq(tables.workflowJobs.id, job.id));
    expect(invalid.status).toBe('dead');
  });

  it('leaves a suspended instance and its pending task alone when a legacy job is picked up', async () => {
    const { instance, task, job } = await fixture('autoApprove');
    await database.db.update(tables.workflowJobs).set({ instanceId: null, tenantId: null, nodeKey: null }).where(eq(tables.workflowJobs.id, job.id));
    await database.db.update(tables.workflowInstances).set({ status: 'suspended' }).where(eq(tables.workflowInstances.id, instance.id));
    await due(job.id);
    await jobs.runJob(job.id);
    expect(await taskState(task.id)).toMatchObject({ assigneeId, status: 'pending', breachedAt: null });
    const [execution] = await database.db.select().from(tables.workflowJobExecutions).where(eq(tables.workflowJobExecutions.jobId, job.id));
    expect(execution).toMatchObject({ status: 'skipped', tenantId });
  });

  it('pauses and resumes a pending continuation with only a task ID', async () => {
    const { instance, job } = await fixture();
    await database.db.update(tables.workflowJobs).set({ instanceId: null, tenantId: null, nodeKey: null }).where(eq(tables.workflowJobs.id, job.id));
    await database.db.transaction(tx => jobs.pauseInstanceJobs(tx, instance.id, ['task_timeout']));
    const [paused] = await database.db.select().from(tables.workflowJobs).where(eq(tables.workflowJobs.id, job.id));
    expect(paused.status).toBe('paused');
    const restored = await database.db.transaction(tx => jobs.resumeInstanceJobs(tx, instance.id, ['task_timeout']));
    expect(restored).toMatchObject([{ id: job.id }]);
    await due(job.id);
    await jobs.runJob(job.id);
    const [completed] = await database.db.select().from(tables.workflowJobs).where(eq(tables.workflowJobs.id, job.id));
    expect(completed).toMatchObject({ instanceId: instance.id, tenantId, status: 'succeeded' });
  });

  it('blocks a legacy misassigned task at the processing boundary', async () => {
    const { task } = await fixture();
    const { runWithCurrentUser } = await import('../../../lib/context');
    const { getOwnPendingTask } = await import('../instances/task-actions');
    const { batchApproveTasks, batchRejectTasks } = await import('../instances/batch');
    await runWithCurrentUser({ userId: assigneeId, username: 'assignee', roles: [], tenantId }, async () => {
      expect((await getOwnPendingTask(task.id)).task.id).toBe(task.id);
    });
    await database.db.update(tables.workflowTasks).set({ assigneeId: foreignUserId }).where(eq(tables.workflowTasks.id, task.id));
    await runWithCurrentUser({ userId: foreignUserId, username: 'foreign', roles: [], tenantId: otherTenantId }, async () => {
      await expect(getOwnPendingTask(task.id)).rejects.toMatchObject({ status: 404 });
      const denied = [{ taskId: task.id, success: false, message: '任务不存在、无权操作或已处理' }];
      await expect(batchApproveTasks([task.id])).resolves.toEqual(denied);
      await expect(batchRejectTasks([task.id], '测试')).resolves.toEqual(denied);
    });
    expect((await taskState(task.id)).status).toBe('pending');
  });

  it('delivers a valid transfer once and suppresses a previously queued notification with a foreign recipient', async () => {
    await setLeader(managerId);
    const { instance, task, job } = await fixture();
    await due(job.id);
    await jobs.runJob(job.id);
    const [fact] = await database.db.select().from(tables.eventOutbox).where(and(
      eq(tables.eventOutbox.orderingKey, `workflow:${instance.id}`), eq(tables.eventOutbox.eventType, 'workflow.task.transferred'),
    ));
    expect(fact.tenantId).toBe(tenantId);
    // Earlier events in this instance must be consumed before its transfer notification.
    for (let cycle = 0; cycle < 5; cycle++) {
      for (const delivery of await eventDelivery.claimEventConsumers(64)) await eventDelivery.executeEventConsumer(delivery);
    }
    const [valid] = await database.db.select().from(tables.notificationOutbox).where(eq(tables.notificationOutbox.dedupeKey, `workflow-event:${fact.eventId}`));
    expect(valid.recipients).toEqual([{ type: 'user', id: managerId }]);
    const [old] = await database.db.insert(tables.notificationOutbox).values({
      eventKey: 'workflow.task.transferred', recipients: [{ type: 'user', id: foreignUserId }], tenantId,
      vars: { instanceId: instance.id, taskId: task.id, title: instance.title, node: task.nodeName },
    }).returning();
    await notification.processNotificationOutbox(valid.id);
    await notification.processNotificationOutbox(valid.id);
    await notification.processNotificationOutbox(old.id);
    const ownMessages = await database.db.$count(tables.inAppMessages, and(eq(tables.inAppMessages.userId, managerId),
      eq(tables.inAppMessages.tenantId, tenantId), eq(tables.inAppMessages.eventKey, 'workflow.task.transferred')));
    expect(ownMessages).toBe(1);
    const [foreignDelivery] = await database.db.select().from(tables.notificationDispatches).where(eq(tables.notificationDispatches.outboxId, old.id));
    expect(foreignDelivery).toMatchObject({ decision: 'suppressed', reasonCode: 'source_unavailable' });
    expect(await database.db.$count(tables.inAppMessages, and(eq(tables.inAppMessages.userId, foreignUserId), eq(tables.inAppMessages.tenantId, tenantId)))).toBe(0);
  });
});
