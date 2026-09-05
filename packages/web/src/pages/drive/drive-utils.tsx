import { Tag } from '@douyinfe/semi-ui';
import { formatBytes } from '@zenith/shared/core';
import type { ManagedFile } from '@zenith/shared/platform';
import { DRIVE_ROLE_RANK, driveNodeContract, type DriveNode, type DriveRole, type DriveShareLink, type DriveShareLinkState, type DriveSpaceType } from '@zenith/shared/drive';
import { urlOf } from '@/lib/contract-query';

export const SHARE_STATE_LABELS: Record<DriveShareLinkState, string> = {
  active: '有效', expired: '已过期', exhausted: '次数用尽', disabled: '已停用', revoked: '已撤销',
};

export const SHARE_STATE_COLORS: Record<DriveShareLinkState, 'green' | 'grey' | 'orange' | 'red'> = {
  active: 'green', expired: 'grey', exhausted: 'orange', disabled: 'grey', revoked: 'red',
};

export function shareLinkStateTag(state: DriveShareLinkState) {
  return <Tag color={SHARE_STATE_COLORS[state]} size="small">{SHARE_STATE_LABELS[state]}</Tag>;
}

/** 外链完整地址（前端公开页） */
export function shareLinkAbsoluteUrl(link: Pick<DriveShareLink, 'url'>): string {
  const base = `${globalThis.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}`;
  return `${base}${link.url}`;
}

/** 节点角色是否达到要求（null = 无权限） */
export function roleAtLeast(role: DriveRole | null | undefined, min: DriveRole): boolean {
  return !!role && DRIVE_ROLE_RANK[role] >= DRIVE_ROLE_RANK[min];
}

/** 把网盘文件节点适配成预览层需要的 ManagedFile 形状（url 为网盘鉴权地址） */
export function nodeToManagedFile(node: DriveNode): ManagedFile {
  return {
    id: String(node.id),
    storageConfigId: 0,
    storageName: '',
    provider: 'local',
    originalName: node.name,
    objectKey: '',
    size: node.size,
    mimeType: node.mimeType ?? undefined,
    extension: node.extension ?? undefined,
    visibility: 'restricted',
    url: node.url ?? '',
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
  };
}

/** 下载地址：附件语义（触发服务端 downloader 校验与 attachment 头） */
export function nodeDownloadUrl(node: Pick<DriveNode, 'id'>): string {
  return urlOf(driveNodeContract.content, { params: { id: node.id }, query: { download: true } });
}

export const SPACE_TYPE_ICON: Record<DriveSpaceType, string> = {
  personal: 'HardDrive',
  department: 'Building2',
  team: 'Users',
};

/** 空间用量百分比（0 配额 = 不限，返回 null） */
export function usagePercent(space: { usedBytes: number; quotaBytes: number }): number | null {
  if (!space.quotaBytes) return null;
  return Math.min(100, Math.round((space.usedBytes / space.quotaBytes) * 1000) / 10);
}

/** 浅比较两个 id 集合 */
export function sameIds(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

/** 动态 detail → 人可读摘要（大小 / 版本 / 来源→目标 / 经外链 / 打包） */
export function describeActivityDetail(detail: Record<string, unknown> | null): string | null {
  if (!detail) return null;
  const parts: string[] = [];
  if (typeof detail.size === 'number') parts.push(formatBytes(detail.size));
  if (typeof detail.version === 'number') parts.push(`v${detail.version}`);
  if (typeof detail.from === 'string' && typeof detail.to === 'string') parts.push(`${detail.from} → ${detail.to}`);
  if (detail.viaShare) parts.push('经外链');
  if (detail.batch) parts.push('打包');
  return parts.length ? parts.join(' · ') : null;
}
