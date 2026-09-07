import { eq } from 'drizzle-orm';
import { formatBytes } from '@zenith/shared/core';
import { DRIVE_NODE_TYPE_LABELS, DRIVE_ROLE_LABELS, type DriveRole, type DriveSubjectType } from '@zenith/shared/drive';
import { db } from '../../db';
import { driveSpaceMembers, users, type DriveNodeRow, type DriveSpaceRow } from '../../db/schema';
import { currentUserOrNull } from '../../lib/context';
import { formatDateTime } from '../../lib/datetime';
import logger from '../../lib/logger';
import { notify } from '../messaging/notification-outbox.service';
import { effectiveQuotaBytes, getDriveSettings } from './drive-settings.service';

/**
 * 企业网盘通知：全部经 notify() 进通知中心，失败只记日志不阻断业务。
 * 部门 / 角色 / 用户组主体的授权不逐人打扰，只对直接授权给用户的主体发送。
 */

async function currentActorName(): Promise<string> {
  const user = currentUserOrNull();
  if (!user) return '系统';
  const [row] = await db.select({ nickname: users.nickname, username: users.username }).from(users).where(eq(users.id, user.userId)).limit(1);
  return row?.nickname || row?.username || user.username;
}

export async function notifyNodeShared(
  node: Pick<DriveNodeRow, 'id' | 'name' | 'type' | 'tenantId' | 'spaceId'>,
  grants: Array<{ subjectType: DriveSubjectType; subjectId: number; role: DriveRole }>,
): Promise<void> {
  const me = currentUserOrNull()?.userId;
  const userGrants = grants.filter((g) => g.subjectType === 'user' && g.subjectId !== me);
  if (userGrants.length === 0) return;
  try {
    const grantorName = await currentActorName();
    // 同一角色批量一条，避免 N 条重复
    const byRole = new Map<DriveRole, number[]>();
    for (const g of userGrants) byRole.set(g.role, [...(byRole.get(g.role) ?? []), g.subjectId]);
    for (const [role, ids] of byRole) {
      await notify('drive.node.shared', {
        recipients: ids.map((id) => ({ type: 'user' as const, id })),
        vars: {
          nodeId: node.id,
          nodeName: node.name,
          nodeType: DRIVE_NODE_TYPE_LABELS[node.type],
          roleLabel: DRIVE_ROLE_LABELS[role],
          grantorName,
        },
        tenantId: node.tenantId ?? null,
        link: node.type === 'folder' ? `/drive?space=${node.spaceId}&folder=${node.id}` : `/drive?space=${node.spaceId}&node=${node.id}`,
      });
    }
  } catch (err) {
    logger.warn({ err, nodeId: node.id }, 'drive: 授权通知发送失败');
  }
}

export async function notifySpaceMembersAdded(
  space: Pick<DriveSpaceRow, 'id' | 'name' | 'tenantId'>,
  added: Array<{ subjectType: DriveSubjectType; subjectId: number; role: DriveRole }>,
): Promise<void> {
  const me = currentUserOrNull()?.userId;
  const userAdds = added.filter((a) => a.subjectType === 'user' && a.subjectId !== me);
  if (userAdds.length === 0) return;
  try {
    const operatorName = await currentActorName();
    for (const a of userAdds) {
      await notify('drive.space.member_added', {
        recipients: [{ type: 'user', id: a.subjectId }],
        vars: { spaceId: space.id, spaceName: space.name, roleLabel: DRIVE_ROLE_LABELS[a.role], operatorName },
        tenantId: space.tenantId ?? null,
        link: `/drive?space=${space.id}`,
      });
    }
  } catch (err) {
    logger.warn({ err, spaceId: space.id }, 'drive: 空间成员通知发送失败');
  }
}

/** 配额达到预警阈值时通知空间管理者（每空间每天一次） */
export async function maybeNotifyQuotaWarning(space: DriveSpaceRow): Promise<void> {
  try {
    const settings = await getDriveSettings();
    const quota = effectiveQuotaBytes(settings, space);
    if (quota <= 0) return;
    const percent = Math.floor((space.usedBytes / quota) * 100);
    if (percent < settings.quotaWarningPercent) return;
    const managerIds = new Set<number>();
    if (space.ownerId) managerIds.add(space.ownerId);
    // 仅显式 user 主体的 manager 参与（部门 / 角色主体展开成本高且噪声大）
    const managerMembers = await db.select().from(driveSpaceMembers).where(eq(driveSpaceMembers.spaceId, space.id));
    for (const m of managerMembers) if (m.subjectType === 'user' && m.role === 'manager') managerIds.add(m.subjectId);
    if (managerIds.size === 0) return;
    const today = formatDateTime(new Date()).slice(0, 10);
    await notify('drive.space.quota_warning', {
      recipients: [...managerIds].map((id) => ({ type: 'user' as const, id })),
      vars: { spaceId: space.id, spaceName: space.name, usedText: formatBytes(space.usedBytes), quotaText: formatBytes(quota), percent },
      tenantId: space.tenantId ?? null,
      link: `/drive?space=${space.id}`,
      dedupeKey: `drive-quota:${space.id}:${today}`,
    });
  } catch (err) {
    logger.warn({ err, spaceId: space.id }, 'drive: 配额预警通知失败');
  }
}

export async function notifyBatchDownloadReady(userId: number, tenantId: number | null, fileCount: number, bytes: number, downloadUrl: string, dedupeKey: string): Promise<void> {
  try {
    await notify('drive.batch_download.ready', {
      recipients: [{ type: 'user', id: userId }],
      vars: { fileCount, sizeText: formatBytes(bytes) },
      tenantId,
      link: downloadUrl,
      dedupeKey,
    });
  } catch (err) {
    logger.warn({ err, userId }, 'drive: 打包完成通知失败');
  }
}
