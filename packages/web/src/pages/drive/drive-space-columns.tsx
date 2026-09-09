/**
 * 网盘空间列表共用的表格列：用户侧「我的空间」与管理端「空间治理」渲染同一批基础列，
 * 差异（待接管标记、自定义配额标记、列宽）通过参数表达，其余业务列由页面自行追加。
 */
import { Progress, Tag, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { NavigateFunction } from 'react-router-dom';
import { formatBytes } from '@zenith/shared/core';
import {
  DRIVE_ROLE_LABELS, DRIVE_SPACE_TYPE_LABELS, isOrphanedDriveSpace,
  type DriveRole, type DriveSpace, type DriveSpaceType,
} from '@zenith/shared/drive';
import { renderEllipsis } from '@/utils/table-columns';
import { usagePercent } from './drive-utils';

const SPACE_TYPE_TAG_COLORS: Record<DriveSpaceType, 'grey' | 'green' | 'blue'> = { personal: 'grey', department: 'green', team: 'blue' };

/** 名称列：点击进入该空间的网盘工作台 */
export function driveSpaceNameColumn(navigate: NavigateFunction): ColumnProps<DriveSpace> {
  return {
    title: '名称', dataIndex: 'name', minWidth: 200, ellipsis: { showTitle: false },
    render: (v: string, s: DriveSpace) => (
      <Typography.Text link ellipsis={{ showTooltip: true }} onClick={() => navigate(`/drive?space=${s.id}`)}>{v}</Typography.Text>
    ),
  };
}

export const driveSpaceTypeColumn: ColumnProps<DriveSpace> = {
  title: '类型', dataIndex: 'type', width: 100,
  render: (v: DriveSpaceType) => <Tag size="small" color={SPACE_TYPE_TAG_COLORS[v]}>{DRIVE_SPACE_TYPE_LABELS[v]}</Tag>,
};

/** 所有者 / 部门列；管理端传 `orphanTag` 把无人接管的空间标成「待接管」 */
export function driveSpaceOwnerColumn({ orphanTag = false }: { orphanTag?: boolean } = {}): ColumnProps<DriveSpace> {
  return {
    title: '所有者 / 部门', width: 130,
    render: (_: unknown, s: DriveSpace) => (
      orphanTag && isOrphanedDriveSpace(s) ? <Tag color="orange">待接管</Tag> : renderEllipsis(s.ownerName ?? s.departmentName)
    ),
  };
}

export const driveSpaceDefaultRoleColumn: ColumnProps<DriveSpace> = {
  title: '默认角色', dataIndex: 'defaultMemberRole', width: 90,
  render: (v: DriveRole | null) => (v ? DRIVE_ROLE_LABELS[v] : '不开放'),
};

/** 用量列：已用 / 配额 + 进度条（≥90% 变红）；管理端传 `customQuotaMark` 标出自定义配额的空间 */
export function driveSpaceUsageColumn({ width, customQuotaMark = false }: { width: number; customQuotaMark?: boolean }): ColumnProps<DriveSpace> {
  return {
    title: '用量', width,
    render: (_: unknown, s: DriveSpace) => {
      const pct = usagePercent(s);
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span className="drive-nowrap" style={{ fontSize: 12 }}>
            {formatBytes(s.usedBytes)}{s.quotaBytes ? ` / ${formatBytes(s.quotaBytes)}` : ' · 不限'}
            {customQuotaMark && s.customQuotaBytes !== null && <Typography.Text type="tertiary" size="small">（自定义）</Typography.Text>}
          </span>
          {pct !== null && <Progress percent={pct} size="small" showInfo={false} stroke={pct >= 90 ? 'var(--semi-color-danger)' : undefined} aria-label={`用量 ${pct}%`} />}
        </div>
      );
    },
  };
}
