import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '../../db';
import { workflowComments, workflowInstances, workflowTasks, inAppMessages, users } from '../../db/schema';
import { HTTPException } from 'hono/http-exception';
import { currentUser } from '../../lib/context';
import { isSuperAdmin } from '../../lib/permissions';
import { tenantCondition } from '../../lib/tenant';
import { formatDateTime } from '../../lib/datetime';
import logger from '../../lib/logger';
import type { WorkflowComment, CreateWorkflowCommentInput } from '@zenith/shared';

type CommentRow = typeof workflowComments.$inferSelect;

export function mapComment(
  row: CommentRow,
  extras: { userName?: string | null; userAvatar?: string | null; mentionNames?: string[] | null; parentSummary?: { userName: string | null; content: string } | null } = {},
): WorkflowComment {
  return {
    id: row.id,
    instanceId: row.instanceId,
    taskId: row.taskId ?? null,
    parentId: row.parentId ?? null,
    parentSummary: extras.parentSummary ?? null,
    userId: row.userId,
    userName: extras.userName ?? null,
    userAvatar: extras.userAvatar ?? null,
    content: row.content,
    mentions: Array.isArray(row.mentions) ? row.mentions : [],
    mentionNames: extras.mentionNames ?? null,
    attachments: Array.isArray(row.attachments) ? row.attachments : [],
    createdAt: formatDateTime(row.createdAt),
  };
}

/** 校验当前用户是否为实例参与者（发起人 / 任一任务处理人 / 超管），返回实例行 */
async function assertParticipant(instanceId: number): Promise<typeof workflowInstances.$inferSelect> {
  const user = currentUser();
  const tc = tenantCondition(workflowInstances, user);
  const conds = [eq(workflowInstances.id, instanceId)];
  if (tc) conds.push(tc);
  const [inst] = await db.select().from(workflowInstances).where(and(...conds)).limit(1);
  if (!inst) throw new HTTPException(404, { message: '流程实例不存在' });
  if (isSuperAdmin(user.roles) || inst.initiatorId === user.userId) return inst;
  const involved = await db.$count(
    workflowTasks,
    and(eq(workflowTasks.instanceId, instanceId), eq(workflowTasks.assigneeId, user.userId)),
  );
  if (involved === 0) throw new HTTPException(403, { message: '无权操作该流程' });
  return inst;
}

/** 批量加载用户名映射 */
async function loadUserNames(ids: number[]): Promise<Map<number, { name: string; avatar: string | null }>> {
  const map = new Map<number, { name: string; avatar: string | null }>();
  const unique = [...new Set(ids)].filter((v) => v > 0);
  if (unique.length === 0) return map;
  const rows = await db
    .select({ id: users.id, nickname: users.nickname, username: users.username, avatar: users.avatar })
    .from(users)
    .where(inArray(users.id, unique));
  for (const r of rows) map.set(r.id, { name: r.nickname ?? r.username, avatar: r.avatar ?? null });
  return map;
}

/** 详情场景：加载实例评论（调用方已完成访问控制） */
export async function loadInstanceCommentsForDetail(instanceId: number): Promise<WorkflowComment[]> {
  const rows = await db
    .select()
    .from(workflowComments)
    .where(eq(workflowComments.instanceId, instanceId))
    .orderBy(asc(workflowComments.id));
  if (rows.length === 0) return [];
  const nameIds = rows.flatMap((r) => [r.userId, ...(Array.isArray(r.mentions) ? r.mentions : [])]);
  const names = await loadUserNames(nameIds);
  // 回复引用：同实例内自查父评论构建摘要（作者 + 截断内容）
  const byId = new Map(rows.map((r) => [r.id, r]));
  const parentSummaryOf = (r: CommentRow) => {
    if (!r.parentId) return null;
    const parent = byId.get(r.parentId);
    if (!parent) return null;
    return {
      userName: names.get(parent.userId)?.name ?? `用户#${parent.userId}`,
      content: parent.content.length > 60 ? `${parent.content.slice(0, 60)}…` : parent.content,
    };
  };
  return rows.map((r) => mapComment(r, {
    userName: names.get(r.userId)?.name ?? null,
    userAvatar: names.get(r.userId)?.avatar ?? null,
    mentionNames: (Array.isArray(r.mentions) ? r.mentions : []).map((id) => names.get(id)?.name ?? `用户#${id}`),
    parentSummary: parentSummaryOf(r),
  }));
}

export async function listInstanceComments(instanceId: number): Promise<WorkflowComment[]> {
  await assertParticipant(instanceId);
  return loadInstanceCommentsForDetail(instanceId);
}

export async function addInstanceComment(instanceId: number, input: CreateWorkflowCommentInput): Promise<WorkflowComment> {
  const inst = await assertParticipant(instanceId);
  const allowComment = inst.definitionSnapshot?.flowData?.settings?.allowComment;
  if (allowComment === false) {
    throw new HTTPException(403, { message: '该流程已关闭评论' });
  }
  const user = currentUser();
  const mentions = [...new Set(input.mentions ?? [])].filter((v) => v > 0);
  // 回复引用：父评论必须属于同一实例（防跨实例引用泄露）
  let parentRow: CommentRow | null = null;
  if (input.parentId) {
    const [parent] = await db.select().from(workflowComments)
      .where(and(eq(workflowComments.id, input.parentId), eq(workflowComments.instanceId, instanceId)))
      .limit(1);
    if (!parent) throw new HTTPException(400, { message: '被回复的评论不存在' });
    parentRow = parent;
  }
  const [row] = await db.insert(workflowComments).values({
    instanceId,
    taskId: input.taskId ?? null,
    parentId: parentRow?.id ?? null,
    userId: user.userId,
    content: input.content,
    mentions,
    attachments: input.attachments ?? [],
    tenantId: inst.tenantId,
  }).returning();

  // @ 提及：向被提及用户发送站内信（带实例详情深链）
  if (mentions.length > 0) {
    const label = inst.serialNo ? `${inst.title}（${inst.serialNo}）` : inst.title;
    try {
      await db.insert(inAppMessages).values(mentions.map((uid) => ({
        userId: uid,
        title: '有人在流程中@你',
        content: `${user.username} 在流程「${label}」的评论中提到了你：${input.content.slice(0, 80)}`,
        type: 'info' as const,
        source: 'system' as const,
        tenantId: inst.tenantId,
        link: `/workflow/applications?instanceId=${instanceId}`,
      })));
    } catch (err) {
      logger.error('[workflow comment] mention notify failed', { err, instanceId });
    }
  }

  const names = await loadUserNames([user.userId, ...mentions, ...(parentRow ? [parentRow.userId] : [])]);
  return mapComment(row, {
    userName: names.get(user.userId)?.name ?? user.username,
    userAvatar: names.get(user.userId)?.avatar ?? null,
    mentionNames: mentions.map((id) => names.get(id)?.name ?? `用户#${id}`),
    parentSummary: parentRow
      ? {
          userName: names.get(parentRow.userId)?.name ?? `用户#${parentRow.userId}`,
          content: parentRow.content.length > 60 ? `${parentRow.content.slice(0, 60)}…` : parentRow.content,
        }
      : null,
  });
}
