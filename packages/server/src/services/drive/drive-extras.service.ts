import { HTTPException } from 'hono/http-exception';
import { and, asc, eq, inArray } from 'drizzle-orm';
import {
  DRIVE_LOCK_DEFAULT_MINUTES,
  type CreateDriveNodeCommentInput,
  type CreateDriveTagInput,
  type DriveNode,
  type DriveNodeComment,
  type DriveTag,
  type LockDriveNodeInput,
  type UpdateDriveTagInput,
  type UpdateDriveNodeCommentInput,
} from '@zenith/shared/drive';
import { db } from '../../db';
import { driveNodeComments, driveNodes, driveNodeTags, driveTags } from '../../db/schema';
import { currentUser, currentUserId } from '../../lib/context';
import { requireRow } from '../../lib/db-assert';
import { formatTimestamps } from '../../lib/datetime';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { getCreateTenantId } from '../../lib/tenant';
import { ensureNodeRole, ensureSpaceRole, loadDriveSubjects } from './drive-access.service';
import { mapDriveTag, resolveUserNames } from './drive-common';
import { logDriveActivity } from './drive-activity.service';
import { decorateNodes, ensureDriveNodeExists } from './drive-nodes.service';
import { ensureDriveSpaceExists } from './drive-spaces.service';
import { readableDriveCommentRecipients } from './drive-collaboration.service';
import { notifyWithin } from '../messaging/notification-outbox.service';

// ─── 标签（空间级） ───────────────────────────────────────────────────────────

export async function listDriveTags(spaceId: number): Promise<DriveTag[]> {
  const space = await ensureDriveSpaceExists(spaceId);
  await ensureSpaceRole(space, 'viewer');
  const rows = await db.select().from(driveTags).where(eq(driveTags.spaceId, spaceId)).orderBy(asc(driveTags.name));
  return rows.map(mapDriveTag);
}

export async function createDriveTag(data: CreateDriveTagInput): Promise<DriveTag> {
  const space = await ensureDriveSpaceExists(data.spaceId);
  await ensureSpaceRole(space, 'editor');
  try {
    const [row] = await db.insert(driveTags).values({ ...data, tenantId: getCreateTenantId(currentUser()) }).returning();
    return mapDriveTag(row);
  } catch (err) {
    return rethrowPgUniqueViolation(err, '该空间已存在同名标签');
  }
}

async function ensureTagEditable(id: number) {
  const [row] = await db.select().from(driveTags).where(eq(driveTags.id, id)).limit(1);
  const tag = requireRow(row, '标签不存在');
  const space = await ensureDriveSpaceExists(tag.spaceId);
  await ensureSpaceRole(space, 'editor');
  return tag;
}

export async function updateDriveTag(id: number, data: UpdateDriveTagInput): Promise<DriveTag> {
  await ensureTagEditable(id);
  try {
    const [row] = await db.update(driveTags).set(data).where(eq(driveTags.id, id)).returning();
    return mapDriveTag(row);
  } catch (err) {
    return rethrowPgUniqueViolation(err, '该空间已存在同名标签');
  }
}

export async function deleteDriveTag(id: number): Promise<void> {
  await ensureTagEditable(id);
  await db.delete(driveTags).where(eq(driveTags.id, id));
}

export async function mergeDriveTags(id: number, targetId: number): Promise<void> {
  const source = await ensureTagEditable(id);
  const target = await ensureTagEditable(targetId);
  if (source.spaceId !== target.spaceId || id === targetId) throw new HTTPException(400, { message: '请选择同空间的另一个目标标签' });
  await db.transaction(async (tx) => {
    const links = await tx.select({ nodeId: driveNodeTags.nodeId }).from(driveNodeTags).where(eq(driveNodeTags.tagId, id));
    if (links.length) await tx.insert(driveNodeTags).values(links.map((link) => ({ nodeId: link.nodeId, tagId: targetId }))).onConflictDoNothing();
    await tx.delete(driveTags).where(eq(driveTags.id, id));
  });
}

export async function setDriveNodeTags(nodeId: number, tagIds: number[]): Promise<DriveNode> {
  const node = await ensureDriveNodeExists(nodeId);
  const role = await ensureNodeRole(node, 'editor', '没有该文件的编辑权限');
  const uniq = [...new Set(tagIds)];
  if (uniq.length) {
    const valid = await db.select({ id: driveTags.id }).from(driveTags).where(and(inArray(driveTags.id, uniq), eq(driveTags.spaceId, node.spaceId)));
    if (valid.length !== uniq.length) throw new HTTPException(400, { message: '存在不属于该空间的标签' });
  }
  await db.transaction(async (tx) => {
    await tx.delete(driveNodeTags).where(eq(driveNodeTags.nodeId, nodeId));
    if (uniq.length) await tx.insert(driveNodeTags).values(uniq.map((tagId) => ({ nodeId, tagId })));
    await logDriveActivity({ spaceId: node.spaceId, nodeId, nodeName: node.name, nodeType: node.type, action: 'tag', detail: { tagIds: uniq } }, tx);
  });
  const [dto] = await decorateNodes([node], new Map([[node.id, role]]));
  return dto;
}

// ─── 评论 ─────────────────────────────────────────────────────────────────────

export async function listDriveNodeComments(nodeId: number): Promise<DriveNodeComment[]> {
  const node = await ensureDriveNodeExists(nodeId, { allowDeleted: true });
  await ensureNodeRole(node, 'viewer', '没有该文件的访问权限');
  const rows = await db.select().from(driveNodeComments).where(eq(driveNodeComments.nodeId, nodeId)).orderBy(asc(driveNodeComments.id));
  const names = await resolveUserNames(rows.map((r) => r.authorId));
  return rows.map((r) => ({
    id: r.id,
    nodeId: r.nodeId,
    parentId: r.parentId ?? null,
    content: r.content,
    mentionUserIds: r.mentionUserIds,
    authorId: r.authorId ?? null,
    authorName: r.authorId ? names.get(r.authorId) ?? null : null,
    ...formatTimestamps(r),
  }));
}

export async function createDriveNodeComment(nodeId: number, data: CreateDriveNodeCommentInput): Promise<DriveNodeComment> {
  const node = await ensureDriveNodeExists(nodeId);
  await ensureNodeRole(node, 'viewer', '没有该文件的访问权限');
  if (data.parentId) {
    const [parent] = await db.select({ id: driveNodeComments.id }).from(driveNodeComments)
      .where(and(eq(driveNodeComments.id, data.parentId), eq(driveNodeComments.nodeId, nodeId))).limit(1);
    requireRow(parent, '回复的评论不存在', 400);
  }
  const uid = currentUserId();
  const recipients = await readableDriveCommentRecipients(node, [...data.mentionUserIds, ...(node.createdBy ? [node.createdBy] : [])]);
  const names = await resolveUserNames([uid]);
  const [row] = await db.transaction(async (tx) => {
    const inserted = await tx.insert(driveNodeComments).values({
      nodeId, parentId: data.parentId, content: data.content, mentionUserIds: data.mentionUserIds, authorId: uid, tenantId: getCreateTenantId(currentUser()),
    }).returning();
    await logDriveActivity({ spaceId: node.spaceId, nodeId, nodeName: node.name, nodeType: node.type, action: 'comment', detail: { commentId: inserted[0].id } }, tx);
    if (recipients.length) await notifyWithin(tx, 'drive.comment.created', {
      recipients: recipients.map((id) => ({ type: 'user', id })),
      vars: { nodeId, nodeName: node.name, authorName: names.get(uid) ?? '', comment: data.content },
      tenantId: node.tenantId, link: `/drive?space=${node.spaceId}&node=${nodeId}`,
      dedupeKey: `drive-comment:${inserted[0].id}`,
    });
    return inserted;
  });
  return {
    id: row.id, nodeId, parentId: row.parentId ?? null, content: row.content, mentionUserIds: row.mentionUserIds, authorId: uid, authorName: names.get(uid) ?? null,
    ...formatTimestamps(row),
  };
}

export async function updateDriveNodeComment(nodeId: number, commentId: number, data: UpdateDriveNodeCommentInput): Promise<DriveNodeComment> {
  const node = await ensureDriveNodeExists(nodeId);
  const role = await ensureNodeRole(node, 'viewer');
  const [before] = await db.select().from(driveNodeComments).where(and(eq(driveNodeComments.nodeId, nodeId), eq(driveNodeComments.id, commentId)));
  const comment = requireRow(before, '评论不存在');
  if (comment.authorId !== currentUserId() && role !== 'manager') throw new HTTPException(403, { message: '只能编辑自己的评论' });
  const newMentions = (data.mentionUserIds ?? []).filter((id) => !comment.mentionUserIds.includes(id));
  const recipients = await readableDriveCommentRecipients(node, newMentions);
  const names = await resolveUserNames([currentUserId(), comment.authorId]);
  const [updated] = await db.transaction(async (tx) => {
    const result = await tx.update(driveNodeComments).set(data).where(eq(driveNodeComments.id, commentId)).returning();
    await logDriveActivity({ spaceId: node.spaceId, nodeId, nodeName: node.name, nodeType: node.type, action: 'comment', detail: { commentId, edited: true } }, tx);
    if (recipients.length) await notifyWithin(tx, 'drive.comment.created', {
      recipients: recipients.map((id) => ({ type: 'user', id })),
      vars: { nodeId, nodeName: node.name, authorName: names.get(currentUserId()) ?? '', comment: result[0].content },
      tenantId: node.tenantId, link: `/drive?space=${node.spaceId}&node=${nodeId}`,
      dedupeKey: `drive-comment-edit:${commentId}:${result[0].updatedAt.getTime()}`,
    });
    return result;
  });
  return {
    id: updated.id, nodeId, parentId: updated.parentId, content: updated.content, mentionUserIds: updated.mentionUserIds,
    authorId: updated.authorId, authorName: updated.authorId ? names.get(updated.authorId) ?? null : null,
    ...formatTimestamps(updated),
  };
}

export async function deleteDriveNodeComment(nodeId: number, commentId: number): Promise<void> {
  const node = await ensureDriveNodeExists(nodeId, { allowDeleted: true });
  await ensureNodeRole(node, 'viewer');
  const [comment] = await db.select().from(driveNodeComments).where(and(eq(driveNodeComments.id, commentId), eq(driveNodeComments.nodeId, nodeId))).limit(1);
  const nodeComment = requireRow(comment, '评论不存在');
  const subjects = await loadDriveSubjects();
  if (nodeComment.authorId !== subjects.userId) await ensureNodeRole(node, 'manager', '只能删除自己的评论');
  await db.delete(driveNodeComments).where(eq(driveNodeComments.id, commentId));
}

// ─── 签出锁 ───────────────────────────────────────────────────────────────────

export async function lockDriveNode(nodeId: number, data: LockDriveNodeInput): Promise<DriveNode> {
  const node = await ensureDriveNodeExists(nodeId);
  if (node.type !== 'file') throw new HTTPException(400, { message: '只能锁定文件' });
  const role = await ensureNodeRole(node, 'editor', '没有该文件的编辑权限');
  const uid = currentUserId();
  const active = node.lockedBy && (!node.lockExpiresAt || node.lockExpiresAt.getTime() > Date.now());
  if (active && node.lockedBy !== uid) throw new HTTPException(423, { message: '文件已被他人签出锁定' });
  const minutes = data.minutes ?? DRIVE_LOCK_DEFAULT_MINUTES;
  const [row] = await db.transaction(async (tx) => {
    const updated = await tx.update(driveNodes).set({
      lockedBy: uid, lockedAt: new Date(), lockExpiresAt: new Date(Date.now() + minutes * 60_000),
    }).where(eq(driveNodes.id, nodeId)).returning();
    await logDriveActivity({ spaceId: node.spaceId, nodeId, nodeName: node.name, nodeType: 'file', action: 'lock', detail: { minutes } }, tx);
    return updated;
  });
  const [dto] = await decorateNodes([row], new Map([[row.id, role]]));
  return dto;
}

export async function unlockDriveNode(nodeId: number): Promise<DriveNode> {
  const node = await ensureDriveNodeExists(nodeId);
  const role = await ensureNodeRole(node, 'editor', '没有该文件的编辑权限');
  if (node.lockedBy && node.lockedBy !== currentUserId() && role !== 'manager') {
    throw new HTTPException(403, { message: '只有锁定者或管理者可以解除锁定' });
  }
  const [row] = await db.transaction(async (tx) => {
    const updated = await tx.update(driveNodes).set({ lockedBy: null, lockedAt: null, lockExpiresAt: null }).where(eq(driveNodes.id, nodeId)).returning();
    await logDriveActivity({ spaceId: node.spaceId, nodeId, nodeName: node.name, nodeType: 'file', action: 'unlock' }, tx);
    return updated;
  });
  const [dto] = await decorateNodes([row], new Map([[row.id, role]]));
  return dto;
}
