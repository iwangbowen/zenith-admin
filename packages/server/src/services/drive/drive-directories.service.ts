import { and, eq, isNull, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { EnsureDriveDirectoriesInput } from '@zenith/shared/drive';
import { db } from '../../db';
import { driveNodes, type DriveNodeRow } from '../../db/schema';
import { nullableEq } from '../../lib/where-helpers';
import { ensureNodeRole, loadDriveSubjects } from './drive-access.service';
import { logDriveActivity } from './drive-activity.service';
import { childAclOf } from './drive-acl';
import { DRIVE_MAX_DEPTH, resolveWritableParent } from './drive-nodes.service';

export async function ensureDriveUploadDirectories(data: EnsureDriveDirectoriesInput) {
  const { space, parent } = await resolveWritableParent(data.spaceId, data.parentId);
  const paths = new Set<string>();
  for (const path of data.paths) {
    const parts = path.split('/');
    for (let i = 1; i <= parts.length; i++) paths.add(parts.slice(0, i).join('/'));
  }
  const ordered = [...paths].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  const subjects = await loadDriveSubjects();
  return db.transaction(async (tx) => {
    const directoryMap = new Map<string, DriveNodeRow | null>([['', parent]]);
    for (const path of ordered) {
      const parts = path.split('/');
      const name = parts.pop()!;
      const parentNode = directoryMap.get(parts.join('/'));
      if (parentNode === undefined) throw new Error(`Upload parent is missing: ${path}`);
      if (parentNode) await ensureNodeRole(parentNode, 'editor', '没有上传目录的编辑权限', subjects, tx);
      const parentId = parentNode?.id ?? null;
      const ancestors = parentNode ? [...parentNode.ancestorIds, parentNode.id] : [];
      if (ancestors.length >= DRIVE_MAX_DEPTH) throw new HTTPException(400, { message: '上传目录超过最大层级' });
      const where = and(
        eq(driveNodes.spaceId, space.id),
        nullableEq(driveNodes.parentId, parentId),
        sql`lower(${driveNodes.name}) = lower(${name})`, isNull(driveNodes.deletedAt),
      );
      let [node] = await tx.select().from(driveNodes).where(where).limit(1);
      if (!node) {
        const [created] = await tx.insert(driveNodes).values({
          spaceId: space.id, parentId, ancestorIds: ancestors, depth: ancestors.length,
          ...childAclOf(parentNode), type: 'folder', name, tenantId: space.tenantId,
        }).onConflictDoNothing().returning();
        if (created) {
          node = created;
          await logDriveActivity({ spaceId: space.id, nodeId: node.id, nodeName: node.name, nodeType: 'folder', action: 'create_folder' }, tx);
        } else {
          [node] = await tx.select().from(driveNodes).where(where).limit(1);
        }
      }
      if (!node || node.type !== 'folder') throw new HTTPException(409, { message: `「${path}」与现有文件冲突` });
      await ensureNodeRole(node, 'editor', '没有上传目录的编辑权限', subjects, tx);
      directoryMap.set(path, node);
    }
    return data.paths.map((path) => ({ path, nodeId: directoryMap.get(path)!.id }));
  });
}
