/**
 * 网盘外链列表共用的表格列：用户侧「我的外链」视图与管理端「外链治理」渲染同一批基础列，
 * 差异（文件点击去向、状态列是否固定、操作列内容）由页面自行表达。
 */
import { Space, Tag } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { describeShareCapabilities, type DriveShareLink, type DriveShareLinkState } from '@zenith/shared/drive';
import { FileNameCell } from '@/components/FileNameCell';
import type { ResponsiveTableAction } from '@/components/ResponsiveTableActions';
import { copyTextWithToast } from '@/utils/clipboard';
import { dateTimeColumn } from '@/utils/table-columns';
import { shareLinkAbsoluteUrl, shareLinkStateTag } from './drive-utils';

/** 文件列：文件夹按目录图标渲染；点击去向由页面决定（进入空间 / 打开详情） */
export function shareLinkFileColumn(onOpen: (link: DriveShareLink) => void): ColumnProps<DriveShareLink> {
  return {
    title: '文件', dataIndex: 'nodeName', minWidth: 220, ellipsis: { showTitle: false },
    render: (_: unknown, l: DriveShareLink) => (
      <FileNameCell name={l.nodeName} mimeType={l.nodeType === 'folder' ? 'inode/directory' : null} onClick={() => onOpen(l)} />
    ),
  };
}

/** 权限列：能力描述 + 有密码时的「密码」标记 */
export const shareLinkCapabilitiesColumn: ColumnProps<DriveShareLink> = {
  title: '权限', dataIndex: 'capabilities', width: 110,
  render: (v: DriveShareLink['capabilities'], l: DriveShareLink) => (
    <Space spacing={4} className="drive-nowrap">
      <span>{describeShareCapabilities(v)}</span>
      {l.hasPassword && <Tag size="small" color="orange">密码</Tag>}
    </Space>
  ),
};

/** 访问 / 下载计数列：`已访问[/上限] · 下载数` */
export const shareLinkAccessColumn: ColumnProps<DriveShareLink> = {
  title: '访问 / 下载', width: 110,
  render: (_: unknown, l: DriveShareLink) => (
    <span className="drive-nowrap">{`${l.accessCount}${l.maxAccessCount ? `/${l.maxAccessCount}` : ''} · ${l.downloadCount}`}</span>
  ),
};

export const shareLinkExpireColumn = dateTimeColumn<DriveShareLink>('过期时间', 'expireAt', { empty: '永久' });

export function shareLinkStateColumn({ fixed }: { fixed?: 'right' } = {}): ColumnProps<DriveShareLink> {
  return { title: '状态', dataIndex: 'state', width: 90, fixed, render: (v: DriveShareLinkState) => shareLinkStateTag(v) };
}

/** 「复制链接」操作：仅有效外链可复制，地址经 `shareLinkAbsoluteUrl` 带上部署子路径 */
export function shareLinkCopyAction(link: DriveShareLink): ResponsiveTableAction {
  return {
    key: 'copy',
    label: '复制链接',
    disabled: link.state !== 'active',
    onClick: () => void copyTextWithToast(shareLinkAbsoluteUrl(link), { success: '链接已复制' }),
  };
}
