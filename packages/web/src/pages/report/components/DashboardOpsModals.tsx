import { useState } from 'react';
import { Button, Input, Switch, Toast, Space, Typography, Empty, Tag, List } from '@douyinfe/semi-ui';
import { Copy, Plus, Trash2, RotateCcw } from 'lucide-react';
import AppModal from '@/components/AppModal';
import { formatDateTime } from '@/utils/date';
import type { ReportDashboardShare } from '@zenith/shared';
import {
  useCreateReportDashboardShare,
  useDeleteReportDashboardShare,
  useReportDashboardShares,
  useReportDashboardVersions,
  useRestoreReportDashboardVersion,
  useSaveReportDashboardVersion,
  useToggleReportDashboardShare,
} from '@/hooks/queries/report-dashboards';

// ─── 分享链接弹窗 ────────────────────────────────────────────────────────────
export function ShareModal({ visible, dashboardId, onClose }: Readonly<{ visible: boolean; dashboardId: number | null; onClose: () => void }>) {
  const [password, setPassword] = useState('');
  const sharesQuery = useReportDashboardShares(dashboardId ?? undefined, visible);
  const shares = sharesQuery.data ?? [];
  const createMutation = useCreateReportDashboardShare();
  const toggleMutation = useToggleReportDashboardShare();
  const deleteMutation = useDeleteReportDashboardShare();

  async function create() {
    if (!dashboardId) return;
    await createMutation.mutateAsync({ dashboardId, password });
    Toast.success('已创建分享链接');
    setPassword('');
  }
  async function toggle(s: ReportDashboardShare) {
    await toggleMutation.mutateAsync(s);
  }
  async function remove(share: ReportDashboardShare) {
    await deleteMutation.mutateAsync(share);
    Toast.success('已删除');
  }
  function urlOf(token: string) { return `${window.location.origin}/public/report/${token}`; }
  function copy(token: string) { void navigator.clipboard.writeText(urlOf(token)); Toast.success('已复制分享链接'); }
  function copyIframe(token: string) { void navigator.clipboard.writeText(`<iframe src="${urlOf(token)}" width="100%" height="600" frameborder="0"></iframe>`); Toast.success('已复制 iframe 代码'); }

  return (
    <AppModal title="公开分享" visible={visible} onCancel={onClose} onOk={onClose} okText="完成" width={640} fullscreenable={false}>
      <Space style={{ marginBottom: 12 }}>
        <Input prefix="访问密码" placeholder="可选" value={password} onChange={setPassword} style={{ width: 220 }} mode="password" />
        <Button type="primary" icon={<Plus size={14} />} loading={createMutation.isPending} onClick={create}>生成链接</Button>
      </Space>
      {shares.length === 0 ? <Empty description="还没有分享链接" style={{ padding: '12px 0' }} /> : (
        <List dataSource={shares} loading={sharesQuery.isFetching} renderItem={(s) => (
          <List.Item
            main={(
              <Space vertical align="start" style={{ width: '100%' }}>
                <Space>
                  <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 320 }} copyable={{ content: urlOf(s.token) }}>{urlOf(s.token)}</Typography.Text>
                  {s.hasPassword && <Tag size="small" color="amber">有密码</Tag>}
                  {!s.enabled && <Tag size="small" color="grey">已停用</Tag>}
                </Space>
                <Typography.Text type="tertiary" size="small">创建于 {formatDateTime(s.createdAt)}{s.expireAt ? ` · 过期 ${s.expireAt}` : ''}</Typography.Text>
              </Space>
            )}
            extra={(
              <Space>
                <Button size="small" icon={<Copy size={13} />} onClick={() => copy(s.token)}>链接</Button>
                <Button size="small" onClick={() => copyIframe(s.token)}>iframe</Button>
                <Switch size="small" checked={s.enabled} loading={toggleMutation.isPending && toggleMutation.variables?.id === s.id} onChange={() => void toggle(s)} />
                <Button size="small" theme="borderless" type="danger" icon={<Trash2 size={13} />} loading={deleteMutation.isPending && deleteMutation.variables?.id === s.id} onClick={() => void remove(s)} />
              </Space>
            )}
          />
        )} />
      )}
    </AppModal>
  );
}

// ─── 版本历史弹窗 ────────────────────────────────────────────────────────────
export function VersionModal({ visible, dashboardId, onClose, onRestored }: Readonly<{ visible: boolean; dashboardId: number | null; onClose: () => void; onRestored?: () => void }>) {
  const versionsQuery = useReportDashboardVersions(dashboardId ?? undefined, visible);
  const versions = versionsQuery.data ?? [];
  const saveMutation = useSaveReportDashboardVersion();
  const restoreMutation = useRestoreReportDashboardVersion();

  async function saveSnapshot() {
    if (!dashboardId) return;
    await saveMutation.mutateAsync(dashboardId);
    Toast.success('已保存当前版本');
  }
  async function restore(versionId: number) {
    if (!dashboardId) return;
    await restoreMutation.mutateAsync({ dashboardId, versionId });
    Toast.success('已恢复');
    onRestored?.();
  }

  return (
    <AppModal title="版本历史" visible={visible} onCancel={onClose} onOk={onClose} okText="完成" width={560} fullscreenable={false}>
      <Button type="primary" icon={<Plus size={14} />} loading={saveMutation.isPending} onClick={saveSnapshot} style={{ marginBottom: 12 }}>保存当前为新版本</Button>
      {versions.length === 0 ? <Empty description="还没有版本快照" style={{ padding: '12px 0' }} /> : (
        <List dataSource={versions} loading={versionsQuery.isFetching} renderItem={(v) => (
          <List.Item
            main={<Space vertical align="start"><Typography.Text strong>v{v.version}</Typography.Text><Typography.Text type="tertiary" size="small">{formatDateTime(v.createdAt)}{v.remark ? ` · ${v.remark}` : ''}</Typography.Text></Space>}
            extra={<Button size="small" icon={<RotateCcw size={13} />} loading={restoreMutation.isPending && restoreMutation.variables?.versionId === v.id} onClick={() => restore(v.id)}>恢复</Button>}
          />
        )} />
      )}
    </AppModal>
  );
}
