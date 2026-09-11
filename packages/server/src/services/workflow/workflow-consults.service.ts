import { and, asc, desc, eq, type SQL } from 'drizzle-orm';
import { db } from '../../db';
import { workflowTaskConsults, workflowTasks, workflowInstances } from '../../db/schema';
import { HTTPException } from 'hono/http-exception';
import { currentUser } from '../../lib/context';
import { tenantCondition } from '../../lib/tenant';
import { pageOffset } from '../../lib/pagination';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import { buildListResult } from '../../lib/list-query';
import { requireRow } from '../../lib/db-assert';
import logger from '../../lib/logger';
import type { WorkflowTaskConsult, CreateWorkflowConsultInput, ReplyWorkflowConsultInput } from '@zenith/shared/workflow';
import { notify } from '../messaging/notification-outbox.service';
import { loadWorkflowUserDisplays } from './workflow-user-helpers';
import { buildWhere } from '../../lib/where-helpers';

type ConsultRow = typeof workflowTaskConsults.$inferSelect;

export function mapConsult(
  row: ConsultRow,
  extras: { nodeName?: string | null; inviterName?: string | null; consulteeName?: string | null; consulteeAvatar?: string | null } = {},
): WorkflowTaskConsult {
  return {
    id: row.id,
    taskId: row.taskId,
    instanceId: row.instanceId,
    nodeName: extras.nodeName ?? null,
    inviterId: row.inviterId,
    inviterName: extras.inviterName ?? null,
    consulteeId: row.consulteeId,
    consulteeName: extras.consulteeName ?? null,
    consulteeAvatar: extras.consulteeAvatar ?? null,
    question: row.question ?? null,
    opinion: row.opinion ?? null,
    status: row.status,
    repliedAt: formatNullableDateTime(row.repliedAt),
    createdAt: formatDateTime(row.createdAt),
  };
}

/** 详情场景：加载实例的协办记录（调用方已完成访问控制） */
export async function loadInstanceConsultsForDetail(instanceId: number): Promise<WorkflowTaskConsult[]> {
  const rows = await db.select({ consult: workflowTaskConsults, nodeName: workflowTasks.nodeName })
    .from(workflowTaskConsults)
    .leftJoin(workflowTasks, eq(workflowTaskConsults.taskId, workflowTasks.id))
    .where(eq(workflowTaskConsults.instanceId, instanceId))
    .orderBy(asc(workflowTaskConsults.id));
  if (rows.length === 0) return [];
  const names = await loadWorkflowUserDisplays(rows.flatMap((r) => [r.consult.inviterId, r.consult.consulteeId]));
  return rows.map((r) => mapConsult(r.consult, {
    nodeName: r.nodeName,
    inviterName: names.get(r.consult.inviterId)?.name ?? null,
    consulteeName: names.get(r.consult.consulteeId)?.name ?? null,
    consulteeAvatar: names.get(r.consult.consulteeId)?.avatar ?? null,
  }));
}

/** 发起协办：当前用户须为该 pending 任务的处理人 */
export async function createConsult(taskId: number, input: CreateWorkflowConsultInput): Promise<WorkflowTaskConsult[]> {
  const user = currentUser();
  const [task] = await db.select().from(workflowTasks).where(eq(workflowTasks.id, taskId)).limit(1);
  requireRow(task, '任务不存在');
  if (task.assigneeId !== user.userId || task.status !== 'pending') {
    throw new HTTPException(403, { message: '只能在自己的待办任务上发起协办' });
  }
  const [inst] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, task.instanceId)).limit(1);
  if (!inst) throw new HTTPException(500, { message: '流程数据异常' });
  const consulteeIds = [...new Set(input.consulteeIds)].filter((v) => v > 0 && v !== user.userId);
  if (consulteeIds.length === 0) throw new HTTPException(400, { message: '请选择有效的协办人' });

  const inserted = await db.insert(workflowTaskConsults).values(consulteeIds.map((cid) => ({
    taskId,
    instanceId: task.instanceId,
    inviterId: user.userId,
    consulteeId: cid,
    question: input.question ?? null,
    status: 'pending' as const,
    tenantId: inst.tenantId,
  }))).returning();

  // 通知协办人：统一走通知中心，渠道与偏好由派发层决定
  try {
    const label = inst.serialNo ? `${inst.title}（${inst.serialNo}）` : inst.title;
    await notify('workflow.consult.invited', {
      recipients: consulteeIds.map((id) => ({ type: 'user' as const, id })),
      vars: {
        instanceId: task.instanceId,
        taskId,
        title: label,
        node: task.nodeName,
        inviter: user.username,
        question: input.question ? `：${input.question}` : '',
      },
      tenantId: inst.tenantId,
      link: '/workflow/pending',
    });
  } catch (err) {
    logger.error('[workflow consult] notify failed', { err, taskId });
  }

  const names = await loadWorkflowUserDisplays([user.userId, ...consulteeIds]);
  return inserted.map((row) => mapConsult(row, {
    nodeName: task.nodeName,
    inviterName: names.get(user.userId)?.name ?? user.username,
    consulteeName: names.get(row.consulteeId)?.name ?? null,
    consulteeAvatar: names.get(row.consulteeId)?.avatar ?? null,
  }));
}

/** 协办人回复意见 */
export async function replyConsult(consultId: number, input: ReplyWorkflowConsultInput): Promise<WorkflowTaskConsult> {
  const user = currentUser();
  const [row] = await db.select().from(workflowTaskConsults).where(eq(workflowTaskConsults.id, consultId)).limit(1);
  requireRow(row, '协办记录不存在');
  if (row.consulteeId !== user.userId) throw new HTTPException(403, { message: '只能回复邀请给你的协办' });
  if (row.status !== 'pending') throw new HTTPException(400, { message: '该协办已处理' });
  const [updated] = await db.update(workflowTaskConsults)
    .set({ opinion: input.opinion, status: 'replied', repliedAt: new Date() })
    .where(eq(workflowTaskConsults.id, consultId)).returning();

  // 通知发起协办的审批人：统一走通知中心
  try {
    const [inst] = await db.select({ title: workflowInstances.title, serialNo: workflowInstances.serialNo, tenantId: workflowInstances.tenantId })
      .from(workflowInstances).where(eq(workflowInstances.id, row.instanceId)).limit(1);
    const label = inst ? (inst.serialNo ? `${inst.title}（${inst.serialNo}）` : inst.title) : `#${row.instanceId}`;
    await notify('workflow.consult.replied', {
      recipients: [{ type: 'user', id: row.inviterId }],
      vars: {
        instanceId: row.instanceId,
        title: label,
        replier: user.username,
        summary: input.opinion.slice(0, 80),
      },
      tenantId: inst?.tenantId ?? null,
      link: `/workflow/pending?instanceId=${row.instanceId}&taskId=${row.taskId}`,
    });
  } catch (err) {
    logger.error('[workflow consult] reply notify failed', { err, consultId });
  }

  const names = await loadWorkflowUserDisplays([updated.inviterId, updated.consulteeId]);
  return mapConsult(updated, {
    inviterName: names.get(updated.inviterId)?.name ?? null,
    consulteeName: names.get(updated.consulteeId)?.name ?? user.username,
  });
}

export async function getConsultInstanceIdForAudit(consultId: number): Promise<number | null> {
  const user = currentUser();
  const [row] = await db
    .select({ instanceId: workflowTaskConsults.instanceId })
    .from(workflowTaskConsults)
    .where(and(eq(workflowTaskConsults.id, consultId), eq(workflowTaskConsults.consulteeId, user.userId)))
    .limit(1);
  return row?.instanceId ?? null;
}

/** 我收到的协办邀请（待我协办） */
export async function listMyConsults(query: { page?: number; pageSize?: number; status?: string } = {}) {
  const user = currentUser();
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  const tc = tenantCondition(workflowTaskConsults, user);
  const conds: (SQL | undefined)[] = [eq(workflowTaskConsults.consulteeId, user.userId)];
  if (query.status) conds.push(eq(workflowTaskConsults.status, query.status as ConsultRow['status']));
  conds.push(tc);
  const where = buildWhere(...conds);
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(workflowTaskConsults, where),
    rows: async () => {
      const rows = await db.select({ consult: workflowTaskConsults, nodeName: workflowTasks.nodeName, instanceTitle: workflowInstances.title, serialNo: workflowInstances.serialNo })
      .from(workflowTaskConsults)
      .leftJoin(workflowTasks, eq(workflowTaskConsults.taskId, workflowTasks.id))
      .leftJoin(workflowInstances, eq(workflowTaskConsults.instanceId, workflowInstances.id))
      .where(where)
      .orderBy(desc(workflowTaskConsults.id))
      .limit(pageSize).offset(pageOffset(page, pageSize));
      const names = await loadWorkflowUserDisplays(rows.map((r) => r.consult.inviterId));
      return rows.map((r) => ({
        ...mapConsult(r.consult, { nodeName: r.nodeName, inviterName: names.get(r.consult.inviterId)?.name ?? null }),
        instanceTitle: r.instanceTitle ?? '',
        serialNo: r.serialNo ?? null,
      }));
    },
  });
}
