import { and, desc, eq, inArray, lt, ne, not, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { workflowAttachmentContract, workflowTaskAttachmentsSchema, mapWorkflowFormAttachments, type WorkflowAttachment, type WorkflowInstanceFormSnapshot } from '@zenith/shared/workflow';
import { db } from '../../db';
import type { DbExecutor } from '../../db/types';
import { managedFiles, workflowAttachmentLinks, workflowAttachmentUploads, workflowComments, workflowInstances, workflowTasks } from '../../db/schema';
import { currentUser, hasPermission } from '../../lib/context';
import { exactTenantCondition, getCreateTenantId, tenantCondition } from '../../lib/tenant';
import { buildWhere } from '../../lib/where-helpers';
import { requireRow } from '../../lib/db-assert';
import { getRestrictedFileForRead, uploadManagedFileFromBody } from '../files/files.service';
import { releaseManagedFiles, retainManagedFiles } from '../files/file-gc.service';
import { workflowVisibility } from '../platform/relations/providers/workflow-file.provider';
import { hiddenWorkflowFieldKeys } from './workflow-form-access';

export type WorkflowAttachmentInput = { fileId: string };
type Instance = Pick<typeof workflowInstances.$inferSelect, 'id' | 'tenantId' | 'formSnapshot'>;
type Source = { source: 'task'; taskId: number } | { source: 'comment'; commentId: number }
  | { source: 'form'; path: string; fieldKeys: string[] };

function sourceValues(source: Source) {
  return { source: source.source,
    sourceKey: source.source === 'form' ? source.path : String(source.source === 'task' ? source.taskId : source.commentId),
    taskId: source.source === 'task' ? source.taskId : null,
    commentId: source.source === 'comment' ? source.commentId : null,
    fieldKeys: source.source === 'form' ? source.fieldKeys : [] };
}

export async function uploadWorkflowAttachment(file: unknown, instanceId?: number) {
  const user = currentUser();
  const tenantId = instanceId === undefined ? getCreateTenantId(user) : (await workflowAttachmentReadScope(instanceId)).instance.tenantId;
  const uploaded = await uploadManagedFileFromBody(file, { visibility: 'restricted', tenantId });
  await db.insert(workflowAttachmentUploads).values({ fileId: uploaded.id, userId: user.userId, tenantId });
  return { ...uploaded, directUrl: null, url: workflowAttachmentContract.uploadContent.fullPath.replace('{fileId}', uploaded.id) };
}

/** Caller has already authorized and locked the workflow action. Retention is in that same transaction. */
export async function bindWorkflowAttachments(
  executor: DbExecutor, instance: Instance, source: Source, input: readonly WorkflowAttachmentInput[] | undefined,
  actorId?: number,
  /** Server-selected source instances only: resubmission or an explicit subprocess mapping. */
  copyFromInstanceIds: readonly number[] = [],
): Promise<WorkflowAttachment[]> {
  if (!input?.length) return [];
  const uploaderId = actorId ?? currentUser().userId;
  const parsed = workflowTaskAttachmentsSchema.safeParse(input);
  if (!parsed.success) throw new HTTPException(400, { message: '附件无效，请重新上传' });
  const fileIds = [...new Set(parsed.data.map((file) => file.fileId))];
  const values = sourceValues(source);
  if (values.sourceKey.length > 512) throw new HTTPException(400, { message: '附件字段路径过长' });
  if (source.source === 'task') {
    requireRow((await executor.select({ id: workflowTasks.id }).from(workflowTasks)
      .where(and(eq(workflowTasks.id, source.taskId), eq(workflowTasks.instanceId, instance.id))).limit(1))[0], '附件所属任务不存在');
  } else if (source.source === 'comment') {
    requireRow((await executor.select({ id: workflowComments.id }).from(workflowComments)
      .where(and(eq(workflowComments.id, source.commentId), eq(workflowComments.instanceId, instance.id))).limit(1))[0], '附件所属评论不存在');
  }
  const existing = await executor.select({ id: workflowAttachmentLinks.id, fileId: workflowAttachmentLinks.fileId })
    .from(workflowAttachmentLinks).where(and(eq(workflowAttachmentLinks.instanceId, instance.id),
      exactTenantCondition(workflowAttachmentLinks.tenantId, instance.tenantId), eq(workflowAttachmentLinks.source, source.source),
      eq(workflowAttachmentLinks.sourceKey, values.sourceKey), inArray(workflowAttachmentLinks.fileId, fileIds)));
  const retained = new Map(existing.map((row) => [row.fileId, row.id]));
  const files = await executor.select({ id: managedFiles.id, name: managedFiles.originalName, size: managedFiles.size,
    mimeType: managedFiles.mimeType, uploaderId: workflowAttachmentUploads.userId })
    .from(managedFiles).innerJoin(workflowAttachmentUploads, eq(workflowAttachmentUploads.fileId, managedFiles.id))
    .where(and(inArray(managedFiles.id, fileIds), exactTenantCondition(managedFiles.tenantId, instance.tenantId),
      exactTenantCondition(workflowAttachmentUploads.tenantId, instance.tenantId), eq(managedFiles.visibility, 'restricted'), ne(managedFiles.gcState, 'deleting')))
    .orderBy(managedFiles.id).for('update', { of: managedFiles });
  // The calling mutation has already restricted editable fields. Reordering a detail row may
  // keep the same declared field's files; knowing an id from a different field grants nothing.
  const reusable = new Set<string>();
  if (source.source === 'form' && files.some((file) => file.uploaderId !== uploaderId && !retained.has(file.id))) {
    const visible = await executor.select({ fileId: workflowAttachmentLinks.fileId }).from(workflowAttachmentLinks)
      .where(buildWhere(eq(workflowAttachmentLinks.instanceId, instance.id), exactTenantCondition(workflowAttachmentLinks.tenantId, instance.tenantId),
        eq(workflowAttachmentLinks.source, 'form'), inArray(workflowAttachmentLinks.fileId, fileIds),
        sql`${workflowAttachmentLinks.fieldKeys} = array[${sql.join(source.fieldKeys.map((key) => sql`${key}`), sql`, `)}]::text[]`));
    for (const row of visible) reusable.add(row.fileId);
  }
  if (source.source === 'form' && copyFromInstanceIds.length) {
    const copied = await executor.select({ fileId: workflowAttachmentLinks.fileId }).from(workflowAttachmentLinks)
      .where(and(inArray(workflowAttachmentLinks.instanceId, [...copyFromInstanceIds]), exactTenantCondition(workflowAttachmentLinks.tenantId, instance.tenantId),
        eq(workflowAttachmentLinks.source, 'form'), inArray(workflowAttachmentLinks.fileId, fileIds)));
    for (const row of copied) reusable.add(row.fileId);
  }
  if (files.length !== fileIds.length || files.some((file) => file.uploaderId !== uploaderId && !retained.has(file.id) && !reusable.has(file.id))) {
    throw new HTTPException(400, { message: '附件不存在或不属于当前上传人，请重新上传' });
  }
  const toInsert = files.filter((file) => !retained.has(file.id));
  if (toInsert.length) {
    const added = await executor.insert(workflowAttachmentLinks).values(toInsert.map((file) => ({
      instanceId: instance.id, tenantId: instance.tenantId, fileId: file.id, ...values,
    }))).onConflictDoNothing().returning({ id: workflowAttachmentLinks.id, fileId: workflowAttachmentLinks.fileId });
    await retainManagedFiles(executor, added.map((row) => row.fileId));
    for (const row of added) retained.set(row.fileId, row.id);
  }
  return fileIds.map((fileId) => {
    const file = files.find((row) => row.id === fileId)!;
    const id = requireRow(retained.get(fileId), '附件绑定状态已变化，请重试', 409);
    return { id, fileId, name: file.name, size: file.size, mimeType: file.mimeType,
      url: workflowAttachmentContract.content.fullPath.replace('{id}', String(id)) };
  });
}

/** Full form state only; arbitrary objects and URL-looking strings never become file references. */
export async function bindWorkflowFormAttachments(executor: DbExecutor, instance: Instance,
  snapshot: WorkflowInstanceFormSnapshot | null | undefined, values: Record<string, unknown>, actorId?: number, copyFromInstanceIds: readonly number[] = []) {
  if (snapshot?.formType !== 'designer') return values;
  const currentIds = new Set<number>();
  const result = await mapWorkflowFormAttachments(snapshot.fields, values, async (value, field, path, fieldKeys) => {
    const parsed = workflowTaskAttachmentsSchema.safeParse(value ?? []);
    if (!parsed.success) throw new HTTPException(400, { message: `「${field.label}」附件无效，请重新上传` });
    if (field.maxCount && parsed.data.length > field.maxCount) throw new HTTPException(400, { message: `「${field.label}」附件数量超限` });
    const attachments = await bindWorkflowAttachments(executor, instance, { source: 'form', path, fieldKeys }, parsed.data, actorId, copyFromInstanceIds);
    if (attachments.some((file) => (field.type === 'image' && !file.mimeType?.startsWith('image/'))
      || (field.maxSize && file.size > field.maxSize * 1024 * 1024))) throw new HTTPException(400, { message: `「${field.label}」附件类型或大小不符合要求` });
    for (const attachment of attachments) currentIds.add(attachment.id);
    return attachments;
  });
  const obsolete = await executor.delete(workflowAttachmentLinks).where(buildWhere(
    eq(workflowAttachmentLinks.instanceId, instance.id), exactTenantCondition(workflowAttachmentLinks.tenantId, instance.tenantId),
    eq(workflowAttachmentLinks.source, 'form'), currentIds.size ? not(inArray(workflowAttachmentLinks.id, [...currentIds])) : undefined,
  )).returning({ fileId: workflowAttachmentLinks.fileId });
  await releaseManagedFiles(executor, obsolete.map((row) => row.fileId));
  return result;
}

export async function releaseWorkflowAttachments(executor: DbExecutor, instance: Instance) {
  const removed = await executor.delete(workflowAttachmentLinks).where(and(eq(workflowAttachmentLinks.instanceId, instance.id),
    exactTenantCondition(workflowAttachmentLinks.tenantId, instance.tenantId))).returning({ fileId: workflowAttachmentLinks.fileId });
  await releaseManagedFiles(executor, removed.map((row) => row.fileId));
}

export async function workflowAttachmentReadScope(instanceId: number, executor: DbExecutor = db) {
  const user = currentUser();
  const [instance] = await executor.select({ id: workflowInstances.id, title: workflowInstances.title, tenantId: workflowInstances.tenantId,
    initiatorId: workflowInstances.initiatorId, definitionSnapshot: workflowInstances.definitionSnapshot }).from(workflowInstances)
    .where(buildWhere(eq(workflowInstances.id, instanceId), tenantCondition(workflowInstances, user),
      await workflowVisibility({ user, db: executor }))).limit(1);
  requireRow(instance, '附件不存在或无权查看');
  const tasks = await executor.select({ assigneeId: workflowTasks.assigneeId, nodeKey: workflowTasks.nodeKey }).from(workflowTasks)
    .where(and(eq(workflowTasks.instanceId, instanceId), eq(workflowTasks.assigneeId, user.userId)));
  const hidden = await hasPermission('workflow:instance:monitor') ? [] : [...hiddenWorkflowFieldKeys({ ...instance, tasks }, user.userId)];
  return { instance, where: buildWhere(eq(workflowAttachmentLinks.instanceId, instanceId),
    exactTenantCondition(workflowAttachmentLinks.tenantId, instance.tenantId),
    hidden.length ? sql`not (${workflowAttachmentLinks.fieldKeys} && array[${sql.join(hidden.map((key) => sql`${key}`), sql`, `)}]::text[])` : undefined) };
}

const summaryColumns = { id: workflowAttachmentLinks.id, instanceId: workflowAttachmentLinks.instanceId, taskId: workflowAttachmentLinks.taskId,
  commentId: workflowAttachmentLinks.commentId, source: workflowAttachmentLinks.source, fileId: managedFiles.id,
  name: managedFiles.originalName, size: managedFiles.size, mimeType: managedFiles.mimeType,
  createdAt: workflowAttachmentLinks.createdAt, tenantId: workflowAttachmentLinks.tenantId };

export async function listWorkflowAttachmentSummaries(instanceId: number, options: { limit: number; beforeId?: number; taskId?: number }, executor: DbExecutor = db) {
  const scope = await workflowAttachmentReadScope(instanceId, executor);
  return executor.select(summaryColumns).from(workflowAttachmentLinks).innerJoin(managedFiles, eq(managedFiles.id, workflowAttachmentLinks.fileId))
    .where(buildWhere(scope.where, options.beforeId ? lt(workflowAttachmentLinks.id, options.beforeId) : undefined,
      options.taskId ? eq(workflowAttachmentLinks.taskId, options.taskId) : undefined, eq(managedFiles.visibility, 'restricted'), sql`${managedFiles.tenantId} is not distinct from ${workflowAttachmentLinks.tenantId}`, ne(managedFiles.gcState, 'deleting')))
    .orderBy(desc(workflowAttachmentLinks.id)).limit(options.limit);
}

export async function getWorkflowAttachmentSummary(id: number, executor: DbExecutor = db) {
  const [source] = await executor.select({ instanceId: workflowAttachmentLinks.instanceId }).from(workflowAttachmentLinks)
    .where(buildWhere(eq(workflowAttachmentLinks.id, id), tenantCondition(workflowAttachmentLinks, currentUser()))).limit(1);
  requireRow(source, '附件不存在或无权查看');
  const scope = await workflowAttachmentReadScope(source.instanceId, executor);
  const [row] = await executor.select(summaryColumns).from(workflowAttachmentLinks)
    .innerJoin(managedFiles, eq(managedFiles.id, workflowAttachmentLinks.fileId))
    .where(buildWhere(scope.where, eq(workflowAttachmentLinks.id, id), eq(managedFiles.visibility, 'restricted'), sql`${managedFiles.tenantId} is not distinct from ${workflowAttachmentLinks.tenantId}`, ne(managedFiles.gcState, 'deleting'))).limit(1);
  return requireRow(row, '附件不存在或无权查看');
}

export async function readWorkflowAttachment(id: number) {
  const row = await getWorkflowAttachmentSummary(id);
  return getRestrictedFileForRead(row.fileId);
}

export async function readWorkflowAttachmentUpload(fileId: string) {
  const user = currentUser();
  const [upload] = await db.select({ fileId: workflowAttachmentUploads.fileId }).from(workflowAttachmentUploads)
    .where(buildWhere(eq(workflowAttachmentUploads.fileId, fileId), eq(workflowAttachmentUploads.userId, user.userId), tenantCondition(workflowAttachmentUploads, user))).limit(1);
  requireRow(upload, '附件不存在或无权查看');
  // Once attached, every read must use its concrete workflow source and field authorization.
  const [bound] = await db.select({ id: workflowAttachmentLinks.id }).from(workflowAttachmentLinks).where(eq(workflowAttachmentLinks.fileId, fileId)).limit(1);
  if (bound) throw new HTTPException(404, { message: '请从所属流程查看附件' });
  return getRestrictedFileForRead(fileId);
}
