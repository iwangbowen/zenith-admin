import { createHash } from 'node:crypto';
import { HTTPException } from 'hono/http-exception';
import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import {
  DRIVE_SIMPLE_UPLOAD_MAX_BYTES,
  type DriveFileVersion,
  type DriveNode,
  type DriveUploadCompleteInput,
  type DriveUploadInitInput,
  type DriveUploadPrecheck,
  type DriveUploadPrecheckInput,
  type DriveUploadConflictPolicy,
} from '@zenith/shared/drive';
import type { UploadSessionInit } from '@zenith/shared/platform';
import { db } from '../../db';
import type { DbExecutor } from '../../db/types';
import { driveFileVersions, driveNodeRenditions, driveNodeTexts, driveNodes, driveUploadBindings, managedFiles, type DriveNodeRow, type DriveSpaceRow } from '../../db/schema';
import { currentUser, currentUserId } from '../../lib/context';
import { requireRow } from '../../lib/db-assert';
import { formatDateTime } from '../../lib/datetime';
import { getCreateTenantId, tenantCondition } from '../../lib/tenant';
import { uploadManagedFile, assertUploadSizeAllowed } from '../files/files.service';
import { releaseManagedFiles, retainManagedFiles } from '../files/file-gc.service';
import { abortChunkUpload, completeChunkUpload, getUploadStatus, initChunkUpload, uploadChunk } from '../files/upload-sessions.service';
import { ensureNodeRole, loadDriveSubjects, visibleNodeCondition, type DriveSubjectSet } from './drive-access.service';
import { childAclOf } from './drive-acl';
import { assertDriveFileAllowed } from './drive-content-policy';
import { driveVersionContentUrl, extensionOf, resolveUserNames } from './drive-common';
import { logDriveActivity, touchDriveRecent } from './drive-activity.service';
import {
  assertNotLockedByOthers,
  decorateNodes,
  ensureDriveNodeExists,
  pickFreeName,
  resolveWritableParent,
} from './drive-nodes.service';
import { getSpaceQuotaState, releaseSpaceQuota, reserveSpaceQuota } from './drive-spaces.service';
import { getDriveSettings, type DriveSettings } from './drive-settings.service';
import { scheduleNodeRenditions } from './drive-renditions.service';

// ─── 校验 ─────────────────────────────────────────────────────────────────────

export { assertDriveFileAllowed } from './drive-content-policy';

async function assertExtensionAllowed(fileName: string) {
  await assertDriveFileAllowed(fileName);
}

/** 同目录同名未删除节点 */
async function findSibling(executor: DbExecutor, spaceId: number, parentId: number | null, name: string): Promise<DriveNodeRow | null> {
  const [row] = await executor.select().from(driveNodes).where(and(
    eq(driveNodes.spaceId, spaceId),
    parentId === null ? sql`${driveNodes.parentId} is null` : eq(driveNodes.parentId, parentId),
    sql`lower(${driveNodes.name}) = lower(${name})`,
    sql`${driveNodes.deletedAt} is null`,
  )).limit(1);
  return row ?? null;
}

/** 秒传不能把内容哈希变成绕过源文件权限的凭证。 */
async function findFileByHash(contentHash: string, size: number) {
  const subjects = await loadDriveSubjects();
  const readableFiles = db.select({ id: driveNodes.fileId }).from(driveNodes).where(and(
    isNull(driveNodes.deletedAt),
    visibleNodeCondition(subjects, 'downloader'),
    tenantCondition(driveNodes, currentUser()),
  ));
  const [row] = await db.select().from(managedFiles).where(and(
    eq(managedFiles.contentHash, contentHash.toLowerCase()),
    eq(managedFiles.size, size),
    eq(managedFiles.visibility, 'restricted'),
    ne(managedFiles.gcState, 'deleting'),
    inArray(managedFiles.id, readableFiles),
    tenantCondition(managedFiles, currentUser()) ?? sql`true`,
  )).limit(1);
  return row ?? null;
}

// ─── 节点落地（上传完成 / 秒传 / 新版本共用）────────────────────────────────────

interface AttachInput {
  space: DriveSpaceRow;
  parentId: number | null;
  ancestorIds: number[];
  fileName: string;
  fileId: string;
  size: number;
  mimeType: string | null;
  contentHash: string | null;
  conflictPolicy: DriveUploadConflictPolicy;
}

/** 落地结果：节点行 + 事务提交后需回收的对象（版本修剪产生） */
interface AttachResult {
  row: DriveNodeRow;
  newVersion: boolean;
  releasedFileIds: string[];
}

/**
 * 把托管文件挂成节点：按冲突策略重命名 / 覆盖为新版本 / 失败；原子占用配额；写版本与动态。
 */
async function attachFileAsNode(input: AttachInput): Promise<AttachResult> {
  const uid = currentUserId();
  const tenantId = getCreateTenantId(currentUser());
  // 设置在事务外读取：事务内不得触发经全局连接池的冷加载（池满即死锁）
  const settings = await getDriveSettings();
  const subjects = await loadDriveSubjects();
  return db.transaction(async (tx) => {
    const existing = await findSibling(tx, input.space.id, input.parentId, input.fileName);
    if (existing) {
      if (input.conflictPolicy === 'fail') throw new HTTPException(409, { message: `「${input.fileName}」已存在` });
      if (input.conflictPolicy === 'version') {
        if (existing.type !== 'file') throw new HTTPException(409, { message: `「${input.fileName}」是文件夹，无法覆盖` });
        assertNotLockedByOthers(existing);
        const appended = await appendVersion(tx, existing, input, '上传覆盖', settings, subjects);
        return { ...appended, newVersion: true };
      }
    }
    const taken = new Set<string>();
    if (existing) {
      const siblings = await tx.select({ name: driveNodes.name }).from(driveNodes).where(and(
        eq(driveNodes.spaceId, input.space.id),
        input.parentId === null ? sql`${driveNodes.parentId} is null` : eq(driveNodes.parentId, input.parentId),
        sql`${driveNodes.deletedAt} is null`,
      ));
      siblings.forEach((s) => taken.add(s.name.toLowerCase()));
    }
    const name = existing ? pickFreeName(input.fileName, taken) : input.fileName;
    const parent = input.parentId === null ? null : requireRow(
      (await tx.select().from(driveNodes).where(and(eq(driveNodes.id, input.parentId), isNull(driveNodes.deletedAt))).limit(1))[0],
      '目标文件夹不存在',
    );
    if (parent) await ensureNodeRole(parent, 'editor', '没有目标文件夹的上传权限', subjects, tx);
    await reserveSpaceQuota(tx, input.space.id, input.size, settings);
    await retainManagedFiles(tx, [input.fileId]);
    const [created] = await tx.insert(driveNodes).values({
      spaceId: input.space.id,
      parentId: input.parentId,
      ancestorIds: input.ancestorIds,
      depth: input.ancestorIds.length,
      ...childAclOf(parent),
      type: 'file',
      name,
      extension: extensionOf(name),
      mimeType: input.mimeType,
      fileId: input.fileId,
      size: input.size,
      contentHash: input.contentHash,
      currentVersion: 1,
      tenantId,
    }).returning();
    await tx.insert(driveFileVersions).values({
      nodeId: created.id, version: 1, fileId: input.fileId, size: input.size, contentHash: input.contentHash, authorId: uid,
    });
    await logDriveActivity({ spaceId: input.space.id, nodeId: created.id, nodeName: name, nodeType: 'file', action: 'upload', detail: { size: input.size } }, tx);
    return { row: created, newVersion: false, releasedFileIds: [] };
  });
}

/**
 * 为已有文件节点追加新版本（事务内）；返回被修剪版本的对象 id，由调用方在事务提交后回收。
 * settings 必须由调用方在开启事务**之前**读取并传入。
 */
async function appendVersion(
  tx: DbExecutor,
  node: DriveNodeRow,
  input: Pick<AttachInput, 'fileId' | 'size' | 'mimeType' | 'contentHash'>,
  comment: string | null,
  settings: DriveSettings,
  subjects: DriveSubjectSet,
): Promise<{ row: DriveNodeRow; releasedFileIds: string[] }> {
  node = requireRow((await tx.select().from(driveNodes)
    .where(and(eq(driveNodes.id, node.id), isNull(driveNodes.deletedAt))).for('update'))[0], '文件不存在');
  await ensureNodeRole(node, 'editor', '没有该文件的编辑权限', subjects, tx);
  assertNotLockedByOthers(node);
  const { space } = await getSpaceQuotaState(node.spaceId, tx, settings);
  const maxVersions = space.maxVersions ?? settings.maxVersions;
  await reserveSpaceQuota(tx, node.spaceId, input.size, settings);
  const nextVersion = node.currentVersion + 1;
  await retainManagedFiles(tx, [input.fileId]);
  const oldRenditions = await tx.delete(driveNodeRenditions).where(eq(driveNodeRenditions.nodeId, node.id))
    .returning({ fileId: driveNodeRenditions.fileId });
  await releaseManagedFiles(tx, oldRenditions.map((r) => r.fileId));
  await tx.delete(driveNodeTexts).where(eq(driveNodeTexts.nodeId, node.id));
  await tx.insert(driveFileVersions).values({
    nodeId: node.id, version: nextVersion, fileId: input.fileId, size: input.size, contentHash: input.contentHash, comment, authorId: currentUserId(),
  });
  const [updated] = await tx.update(driveNodes).set({
    fileId: input.fileId,
    size: input.size,
    mimeType: input.mimeType,
    contentHash: input.contentHash,
    currentVersion: nextVersion,
  }).where(eq(driveNodes.id, node.id)).returning();
  // 修剪超出上限的最旧版本（对象回收在事务提交后由调用方处理）
  const versions = await tx.select().from(driveFileVersions).where(eq(driveFileVersions.nodeId, node.id)).orderBy(desc(driveFileVersions.version));
  const overflow = versions.slice(maxVersions);
  if (overflow.length) {
    await tx.delete(driveFileVersions).where(inArray(driveFileVersions.id, overflow.map((v) => v.id)));
    await releaseManagedFiles(tx, overflow.map((v) => v.fileId));
    await releaseSpaceQuota(tx, node.spaceId, overflow.reduce((s, v) => s + v.size, 0));
  }
  await logDriveActivity({ spaceId: node.spaceId, nodeId: node.id, nodeName: node.name, nodeType: 'file', action: 'new_version', detail: { version: nextVersion, size: input.size } }, tx);
  return { row: updated, releasedFileIds: overflow.map((v) => v.fileId) };
}

/** 对象引用已在事务中更新；提交后记录最近访问并持久化渲染任务。 */
async function finishNode(result: { row: DriveNodeRow; releasedFileIds: string[] }): Promise<DriveNode> {
  await touchDriveRecent(result.row.id, 'upload');
  await scheduleNodeRenditions(result.row.id);
  const [node] = await decorateNodes([result.row]);
  return node;
}

// ─── 预检 / 秒传 ──────────────────────────────────────────────────────────────

export async function precheckDriveUpload(data: DriveUploadPrecheckInput): Promise<DriveUploadPrecheck> {
  await assertExtensionAllowed(data.fileName);
  await assertUploadSizeAllowed(data.fileSize);
  const { space, ancestorIds } = await resolveWritableParent(data.spaceId, data.parentId);
  const quota = await getSpaceQuotaState(space.id);
  const quotaOk = quota.remaining === null || quota.remaining >= data.fileSize;
  const existing = await findSibling(db, space.id, data.parentId, data.fileName);
  const result: DriveUploadPrecheck = {
    conflict: !!existing,
    existingNodeId: existing?.id ?? null,
    quotaOk,
    quotaRemaining: quota.remaining,
    instant: false,
    node: null,
  };
  if (!quotaOk || !data.contentHash) return result;
  const file = await findFileByHash(data.contentHash, data.fileSize);
  if (!file) return result;
  result.instant = true;
  // 有冲突且策略为 fail 时只报告可秒传，交给前端决定
  if (existing && data.conflictPolicy === 'fail') return result;
  const attached = await attachFileAsNode({
    space, parentId: data.parentId, ancestorIds, fileName: data.fileName,
    fileId: file.id, size: file.size, mimeType: file.mimeType ?? null, contentHash: file.contentHash ?? null,
    conflictPolicy: data.conflictPolicy,
  });
  result.node = await finishNode(attached);
  return result;
}

// ─── 简单上传（≤ 5MB 单请求）──────────────────────────────────────────────────

export async function simpleDriveUpload(
  file: File,
  fields: { spaceId: number; parentId: number | null; conflictPolicy: DriveUploadConflictPolicy },
): Promise<DriveNode> {
  if (file.size > DRIVE_SIMPLE_UPLOAD_MAX_BYTES) {
    throw new HTTPException(400, { message: '文件超过简单上传阈值，请使用分片上传' });
  }
  const { space, ancestorIds } = await resolveWritableParent(fields.spaceId, fields.parentId);
  const quota = await getSpaceQuotaState(space.id);
  if (quota.remaining !== null && quota.remaining < file.size) {
    throw new HTTPException(400, { message: '空间配额不足，请清理回收站或联系管理员扩容' });
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  await assertDriveFileAllowed(file.name, buffer);
  const contentHash = createHash('sha256').update(buffer).digest('hex');
  const dedup = await findFileByHash(contentHash, file.size);
  const stored = dedup
    ? { id: dedup.id, size: dedup.size, mimeType: dedup.mimeType ?? null, contentHash: dedup.contentHash ?? null }
    : await uploadManagedFile(new File([buffer], file.name, { type: file.type }), { visibility: 'restricted', contentHash, skipTypeCheck: true })
      .then((f) => ({ id: f.id, size: f.size, mimeType: f.mimeType ?? null, contentHash: f.contentHash ?? null }));
  const attached = await attachFileAsNode({
    space, parentId: fields.parentId, ancestorIds, fileName: file.name,
    fileId: stored.id, size: stored.size, mimeType: stored.mimeType, contentHash: stored.contentHash,
    conflictPolicy: fields.conflictPolicy,
  });
  return finishNode(attached);
}

/** 上传为指定节点的新版本（≤ 5MB 单请求） */
export async function uploadDriveNodeVersion(nodeId: number, file: File, comment?: string): Promise<DriveNode> {
  const node = await ensureDriveNodeExists(nodeId);
  if (node.type !== 'file') throw new HTTPException(400, { message: '只能对文件上传新版本' });
  await ensureNodeRole(node, 'editor', '没有该文件的编辑权限');
  assertNotLockedByOthers(node);
  if (file.size > DRIVE_SIMPLE_UPLOAD_MAX_BYTES) {
    throw new HTTPException(400, { message: '文件超过简单上传阈值，请使用分片上传' });
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  await assertDriveFileAllowed(node.name, buffer);
  const contentHash = createHash('sha256').update(buffer).digest('hex');
  const dedup = await findFileByHash(contentHash, file.size);
  const stored = dedup
    ? { id: dedup.id, size: dedup.size, mimeType: dedup.mimeType ?? null, contentHash: dedup.contentHash ?? null }
    : await uploadManagedFile(new File([buffer], node.name, { type: file.type }), { visibility: 'restricted', contentHash, skipTypeCheck: true })
      .then((f) => ({ id: f.id, size: f.size, mimeType: f.mimeType ?? null, contentHash: f.contentHash ?? null }));
  const settings = await getDriveSettings();
  const subjects = await loadDriveSubjects();
  const appended = await db.transaction((tx) => appendVersion(tx, node, {
    fileId: stored.id, size: stored.size, mimeType: stored.mimeType, contentHash: stored.contentHash,
  }, comment ?? null, settings, subjects));
  return finishNode(appended);
}

// ─── 分片上传（包装通用 upload_sessions）──────────────────────────────────────

export async function initDriveUpload(data: DriveUploadInitInput): Promise<UploadSessionInit> {
  await assertExtensionAllowed(data.fileName);
  let target: { space: DriveSpaceRow; parentId: number | null };
  if (data.nodeId) {
    const node = await ensureDriveNodeExists(data.nodeId);
    if (node.type !== 'file') throw new HTTPException(400, { message: '只能对文件上传新版本' });
    await ensureNodeRole(node, 'editor', '没有该文件的编辑权限');
    assertNotLockedByOthers(node);
    const { space } = await getSpaceQuotaState(node.spaceId);
    target = { space, parentId: node.parentId ?? null };
  } else {
    const { space } = await resolveWritableParent(data.spaceId, data.parentId);
    target = { space, parentId: data.parentId };
  }
  const quota = await getSpaceQuotaState(target.space.id);
  if (quota.remaining !== null && quota.remaining < data.fileSize) {
    throw new HTTPException(400, { message: '空间配额不足，请清理回收站或联系管理员扩容' });
  }
  const session = await initChunkUpload({
    fileName: data.fileName, fileSize: data.fileSize, mimeType: data.mimeType, chunkSize: data.chunkSize,
  });
  await db.insert(driveUploadBindings).values({
    uploadId: session.uploadId,
    spaceId: target.space.id,
    parentId: target.parentId,
    nodeId: data.nodeId ?? null,
    fileName: data.fileName,
    fileSize: data.fileSize,
    conflictPolicy: data.conflictPolicy,
    expectedHash: data.contentHash?.toLowerCase() ?? null,
    tenantId: getCreateTenantId(currentUser()),
    createdBy: currentUserId(),
  });
  return session;
}

async function ensureBinding(uploadId: string) {
  const [binding] = await db.select().from(driveUploadBindings)
    .where(and(eq(driveUploadBindings.uploadId, uploadId), eq(driveUploadBindings.createdBy, currentUserId())))
    .limit(1);
  return requireRow(binding, '上传会话不存在');
}

export async function uploadDriveChunk(uploadId: string, index: number, chunk: File) {
  const binding = await ensureBinding(uploadId);
  // 首片按内容做可执行文件拦截（伪装扩展名也拦得住）
  if (index === 0) await assertDriveFileAllowed(binding.fileName, Buffer.from(await chunk.slice(0, 4100).arrayBuffer()));
  return uploadChunk(uploadId, index, chunk, { skipTypeCheck: true });
}

export async function getDriveUploadStatus(uploadId: string) {
  await ensureBinding(uploadId);
  return getUploadStatus(uploadId);
}

export async function abortDriveUpload(uploadId: string) {
  await ensureBinding(uploadId);
  await abortChunkUpload(uploadId);
  await db.delete(driveUploadBindings).where(eq(driveUploadBindings.uploadId, uploadId));
}

export async function completeDriveUpload(data: DriveUploadCompleteInput): Promise<DriveNode> {
  const binding = await ensureBinding(data.uploadId);
  const targetNode = binding.nodeId ? await ensureDriveNodeExists(binding.nodeId) : null;
  if (targetNode) {
    await ensureNodeRole(targetNode, 'editor', '没有该文件的编辑权限');
    assertNotLockedByOthers(targetNode);
  } else {
    await resolveWritableParent(binding.spaceId, binding.parentId ?? null);
  }
  await assertDriveFileAllowed(targetNode?.name ?? binding.fileName);
  const file = await completeChunkUpload(data.uploadId, { visibility: 'restricted', contentHash: binding.expectedHash, skipTypeCheck: true });
  let result: { row: DriveNodeRow; releasedFileIds: string[] };
  if (binding.nodeId) {
    const node = await ensureDriveNodeExists(binding.nodeId);
    const settings = await getDriveSettings();
    const subjects = await loadDriveSubjects();
    result = await db.transaction((tx) => appendVersion(tx, node, {
      fileId: file.id, size: file.size, mimeType: file.mimeType ?? null, contentHash: file.contentHash ?? null,
    }, '分片上传覆盖', settings, subjects));
  } else {
    const { space, ancestorIds } = await resolveWritableParent(binding.spaceId, binding.parentId ?? null);
    result = await attachFileAsNode({
      space, parentId: binding.parentId ?? null, ancestorIds, fileName: binding.fileName,
      fileId: file.id, size: file.size, mimeType: file.mimeType ?? null, contentHash: file.contentHash ?? null,
      conflictPolicy: binding.conflictPolicy,
    });
  }
  await db.delete(driveUploadBindings).where(eq(driveUploadBindings.uploadId, data.uploadId));
  return finishNode(result);
}

// ─── 版本 ─────────────────────────────────────────────────────────────────────

export async function listDriveNodeVersions(nodeId: number): Promise<DriveFileVersion[]> {
  const node = await ensureDriveNodeExists(nodeId, { allowDeleted: true });
  await ensureNodeRole(node, 'viewer', '没有该文件的访问权限');
  const rows = await db.select().from(driveFileVersions).where(eq(driveFileVersions.nodeId, nodeId)).orderBy(desc(driveFileVersions.version));
  const names = await resolveUserNames(rows.map((r) => r.authorId));
  return rows.map((r) => ({
    id: r.id,
    nodeId: r.nodeId,
    version: r.version,
    fileId: r.fileId,
    size: r.size,
    contentHash: r.contentHash ?? null,
    comment: r.comment ?? null,
    authorId: r.authorId ?? null,
    authorName: r.authorId ? names.get(r.authorId) ?? null : null,
    isCurrent: r.version === node.currentVersion,
    url: driveVersionContentUrl(nodeId, r.version),
    createdAt: formatDateTime(r.createdAt),
  }));
}

export async function ensureVersionExists(nodeId: number, version: number) {
  const [row] = await db.select().from(driveFileVersions)
    .where(and(eq(driveFileVersions.nodeId, nodeId), eq(driveFileVersions.version, version))).limit(1);
  return requireRow(row, '版本不存在');
}

/** 回滚：以历史版本内容生成新版本（不删除历史） */
export async function restoreDriveNodeVersion(nodeId: number, version: number): Promise<DriveNode> {
  const node = await ensureDriveNodeExists(nodeId);
  await ensureNodeRole(node, 'editor', '没有该文件的编辑权限');
  assertNotLockedByOthers(node);
  const target = await ensureVersionExists(nodeId, version);
  if (target.version === node.currentVersion) throw new HTTPException(400, { message: '该版本已是当前版本' });
  const [file] = await db.select().from(managedFiles).where(eq(managedFiles.id, target.fileId)).limit(1);
  const settings = await getDriveSettings();
  const subjects = await loadDriveSubjects();
  const result = await db.transaction(async (tx) => {
    const appended = await appendVersion(tx, node, {
      fileId: target.fileId, size: target.size, mimeType: file?.mimeType ?? node.mimeType, contentHash: target.contentHash,
    }, `回滚到版本 ${version}`, settings, subjects);
    await logDriveActivity({ spaceId: node.spaceId, nodeId: node.id, nodeName: node.name, nodeType: 'file', action: 'version_restore', detail: { from: version, to: appended.row.currentVersion } }, tx);
    return appended;
  });
  return finishNode(result);
}

export async function deleteDriveNodeVersion(nodeId: number, version: number): Promise<void> {
  const node = await ensureDriveNodeExists(nodeId);
  await ensureNodeRole(node, 'manager', '只有管理者可以删除历史版本');
  const target = await ensureVersionExists(nodeId, version);
  if (target.version === node.currentVersion) throw new HTTPException(400, { message: '不能删除当前版本' });
  await db.transaction(async (tx) => {
    const removed = await tx.delete(driveFileVersions).where(eq(driveFileVersions.id, target.id)).returning();
    if (!removed.length) throw new HTTPException(409, { message: '该版本已被删除，请刷新' });
    await releaseManagedFiles(tx, [target.fileId]);
    await releaseSpaceQuota(tx, node.spaceId, target.size);
    await logDriveActivity({ spaceId: node.spaceId, nodeId: node.id, nodeName: node.name, nodeType: 'file', action: 'version_delete', detail: { version } }, tx);
  });
}
