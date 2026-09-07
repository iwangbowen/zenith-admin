import { HTTPException } from 'hono/http-exception';
import { and, eq } from 'drizzle-orm';
import { db } from '../../db';
import { driveNodeRenditions } from '../../db/schema';
import type { DriveRole } from '@zenith/shared/drive';
import type { DriveNodeRow, FileStorageConfigRow, ManagedFileRow } from '../../db/schema';
import { formatDateTime } from '../../lib/datetime';
import { readStoredFile, resolveFileAccessUrl } from '../../lib/file-storage';
import type { StoredFileRange } from '../../lib/file-storage';
import { getRestrictedFileForRead } from '../files/files.service';
import { ensureNodeRole } from './drive-access.service';
import { logDriveActivity, touchDriveRecent } from './drive-activity.service';
import { ensureDriveNodeExists } from './drive-nodes.service';
import { ensureVersionExists } from './drive-upload.service';

export interface PreparedContent {
  node: DriveNodeRow;
  file: ManagedFileRow;
  storageConfig: FileStorageConfigRow;
  download: boolean;
  version: number | undefined;
}

/** 解析节点当前（或指定版本）的托管文件 */
async function resolveNodeFile(node: DriveNodeRow, version?: number) {
  if (node.type !== 'file') throw new HTTPException(400, { message: '文件夹没有内容' });
  let fileId = node.fileId;
  if (version !== undefined && version !== node.currentVersion) {
    fileId = (await ensureVersionExists(node.id, version)).fileId;
  }
  if (!fileId) throw new HTTPException(404, { message: '文件内容不存在' });
  return getRestrictedFileForRead(fileId);
}

/** 第一步：ACL 校验 + 定位对象（不打开流，供路由先解析 Range） */
export async function prepareDriveNodeContent(nodeId: number, download: boolean, version?: number): Promise<PreparedContent> {
  const node = await ensureDriveNodeExists(nodeId, { allowDeleted: true });
  const minRole: DriveRole = download ? 'downloader' : 'viewer';
  await ensureNodeRole(node, minRole, download ? '没有该文件的下载权限' : '没有该文件的访问权限');
  const { file, storageConfig } = await resolveNodeFile(node, version);
  return { node, file, storageConfig, download, version };
}

/** 第二步：打开流；预览 / 下载进入动态与最近访问（Range 续传的后续分片不重复记录） */
export async function openDriveNodeContent(prepared: PreparedContent, range: StoredFileRange | null) {
  const { node, file, storageConfig, download, version } = prepared;
  const stored = await readStoredFile(file, storageConfig, range ?? undefined);
  if (!range || range.start === 0) {
    await Promise.all([
      logDriveActivity({
        spaceId: node.spaceId, nodeId: node.id, nodeName: node.name, nodeType: 'file',
        action: download ? 'download' : 'preview', detail: version ? { version } : undefined,
      }),
      touchDriveRecent(node.id, download ? 'download' : 'preview'),
    ]);
  }
  return stored;
}

export async function readDriveNodeThumbnail(nodeId: number) {
  const node = await ensureDriveNodeExists(nodeId, { allowDeleted: true });
  await ensureNodeRole(node, 'viewer', '没有该文件的访问权限');
  const [rendition] = await db.select({ fileId: driveNodeRenditions.fileId }).from(driveNodeRenditions).where(and(
    eq(driveNodeRenditions.nodeId, node.id), eq(driveNodeRenditions.version, node.currentVersion),
    eq(driveNodeRenditions.kind, 'thumbnail'), eq(driveNodeRenditions.status, 'ready'),
  ));
  if (!rendition?.fileId) throw new HTTPException(404, { message: '缩略图不存在' });
  const { file, storageConfig } = await getRestrictedFileForRead(rendition.fileId);
  return { node, file, stored: await readStoredFile(file, storageConfig) };
}

/** 直链（presigned / public）：downloader 及以上；proxy 策略回落到鉴权代理地址 */
export async function getDriveNodeAccessUrl(nodeId: number, purpose: 'preview' | 'download') {
  const node = await ensureDriveNodeExists(nodeId);
  await ensureNodeRole(node, purpose === 'download' ? 'downloader' : 'viewer');
  const { file, storageConfig } = await resolveNodeFile(node);
  const contentDisposition = purpose === 'download'
    ? `attachment; filename*=UTF-8''${encodeURIComponent(node.name)}`
    : undefined;
  const result = await resolveFileAccessUrl(file, storageConfig, { contentDisposition });
  if (result.strategy === 'proxy') {
    return { url: `/api/drive/nodes/${node.id}/content${purpose === 'download' ? '?download=true' : ''}`, strategy: 'proxy' as const, expiresAt: null };
  }
  await logDriveActivity({ spaceId: node.spaceId, nodeId: node.id, nodeName: node.name, nodeType: 'file', action: purpose === 'download' ? 'download' : 'preview', detail: { via: result.strategy } });
  return { url: result.url, strategy: result.strategy, expiresAt: result.expiresAt ? formatDateTime(result.expiresAt) : null };
}
