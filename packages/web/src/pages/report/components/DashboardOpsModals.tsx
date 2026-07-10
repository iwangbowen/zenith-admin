import { useState } from 'react';
import { Button, Input, Select, Switch, Toast, Space, Typography, Empty, Tag, List } from '@douyinfe/semi-ui';
import { Copy, Plus, Trash2, RotateCcw } from 'lucide-react';
import dayjs from 'dayjs';
import { QRCodeSVG } from 'qrcode.react';
import AppModal from '@/components/AppModal';
import { formatDateTime, formatDateTimeForApi } from '@/utils/date';
import type { ReportDashboardShare } from '@zenith/shared';
import {
  useCreateReportDashboardShare,
  useDeleteReportDashboardShare,
  useReportDashboardDetail,
  useReportDashboardShares,
  useReportDashboardVersionDiff,
  useReportDashboardVersions,
  useRestoreReportDashboardVersion,
  useSaveReportDashboardVersion,
  useUpdateReportDashboardShare,
} from '@/hooks/queries/report-dashboards';

// ─── 分享链接弹窗 ────────────────────────────────────────────────────────────
const EXPIRE_OPTIONS = [
  { value: 7, label: '7 天有效' },
  { value: 30, label: '30 天有效' },
  { value: 90, label: '90 天有效' },
  { value: 0, label: '永久有效' },
];

export function ShareModal({ visible, dashboardId, onClose }: Readonly<{ visible: boolean; dashboardId: number | null; onClose: () => void }>) {
  const [password, setPassword] = useState('');
  const [expireDays, setExpireDays] = useState(30);
  const [maxAccessCount, setMaxAccessCount] = useState('');
  const [allowedIps, setAllowedIps] = useState('');
  const [allowedCidrs, setAllowedCidrs] = useState('');
  const sharesQuery = useReportDashboardShares(dashboardId ?? undefined, visible);
  const shares = sharesQuery.data ?? [];
  const createMutation = useCreateReportDashboardShare();
  const updateMutation = useUpdateReportDashboardShare();
  const deleteMutation = useDeleteReportDashboardShare();

  async function create() {
    if (!dashboardId) return;
    if (password && password.length < 8) {
      Toast.warning('访问密码至少 8 位');
      return;
    }
    const expireAt = expireDays > 0 ? formatDateTimeForApi(dayjs().add(expireDays, 'day').toDate()) : null;
    await createMutation.mutateAsync({
      dashboardId,
      values: {
        enabled: true,
        password: password || undefined,
        expireAt,
        maxAccessCount: maxAccessCount ? Number(maxAccessCount) : null,
        allowedIps: allowedIps ? allowedIps.split(/[\s,]+/).filter(Boolean) : [],
        allowedCidrs: allowedCidrs ? allowedCidrs.split(/[\s,]+/).filter(Boolean) : [],
      },
    });
    Toast.success('已创建分享链接');
    setPassword('');
    setMaxAccessCount('');
    setAllowedIps('');
    setAllowedCidrs('');
  }
  async function toggle(s: ReportDashboardShare) {
    await updateMutation.mutateAsync({ shareId: s.id, dashboardId: s.dashboardId, values: { enabled: !s.enabled } });
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
        <Input prefix="访问密码" placeholder="可选，至少 8 位" value={password} onChange={setPassword} style={{ width: 220 }} mode="password" />
        <Select value={expireDays} onChange={(v) => setExpireDays(Number(v ?? 30))} optionList={EXPIRE_OPTIONS} style={{ width: 130 }} />
        <Input placeholder="最大访问次数（选填）" value={maxAccessCount} onChange={setMaxAccessCount} style={{ width: 160 }} />
        <Button type="primary" icon={<Plus size={14} />} loading={createMutation.isPending} onClick={create}>生成链接</Button>
      </Space>
      <Space style={{ marginBottom: 12 }}>
        <Input placeholder="允许 IP（逗号分隔）" value={allowedIps} onChange={setAllowedIps} style={{ width: 260 }} />
        <Input placeholder="允许 CIDR（逗号分隔）" value={allowedCidrs} onChange={setAllowedCidrs} style={{ width: 260 }} />
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
                <Typography.Text type="tertiary" size="small">
                  创建于 {formatDateTime(s.createdAt)}{s.expireAt ? ` · 过期 ${s.expireAt}` : ' · 永久有效'}
                  {s.maxAccessCount ? ` · 上限 ${s.maxAccessCount} 次` : ''}{` · 访问 ${s.accessCount ?? 0} 次`}{s.lastAccessAt ? `（最近 ${s.lastAccessAt}）` : ''}
                </Typography.Text>
                <Space>
                  {(s.allowedIps?.length ?? 0) > 0 ? <Typography.Text type="tertiary" size="small">IP：{s.allowedIps?.join(', ')}</Typography.Text> : null}
                  {(s.allowedCidrs?.length ?? 0) > 0 ? <Typography.Text type="tertiary" size="small">CIDR：{s.allowedCidrs?.join(', ')}</Typography.Text> : null}
                </Space>
                <QRCodeSVG value={urlOf(s.token)} size={72} />
              </Space>
            )}
            extra={(
              <Space>
                <Button size="small" icon={<Copy size={13} />} onClick={() => copy(s.token)}>链接</Button>
                <Button size="small" onClick={() => copyIframe(s.token)}>iframe</Button>
                <Switch size="small" checked={s.enabled} loading={updateMutation.isPending && updateMutation.variables?.shareId === s.id} onChange={() => void toggle(s)} />
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
  const dashboardQuery = useReportDashboardDetail(dashboardId ?? undefined, visible, 'draft');
  const versions = versionsQuery.data ?? [];
  const saveMutation = useSaveReportDashboardVersion();
  const restoreMutation = useRestoreReportDashboardVersion();
  const [pendingVersionId, setPendingVersionId] = useState<number | null>(null);
  const diffQuery = useReportDashboardVersionDiff(dashboardId ?? undefined, 0, pendingVersionId ?? 0, visible && pendingVersionId !== null);

  async function saveSnapshot() {
    if (!dashboardId) return;
    await saveMutation.mutateAsync({ dashboardId });
    Toast.success('已保存当前版本');
  }
  async function restore(versionId: number) {
    if (!dashboardId || !dashboardQuery.data) return;
    await restoreMutation.mutateAsync({ dashboardId, versionId, expectedRevision: dashboardQuery.data.revision });
    Toast.success('已恢复');
    setPendingVersionId(null);
    onRestored?.();
  }

  return (
    <AppModal title="版本历史" visible={visible} onCancel={onClose} onOk={onClose} okText="完成" width={560} fullscreenable={false}>
      <Button type="primary" icon={<Plus size={14} />} loading={saveMutation.isPending} onClick={saveSnapshot} style={{ marginBottom: 12 }}>保存当前为新版本</Button>
      {versions.length === 0 ? <Empty description="还没有版本快照" style={{ padding: '12px 0' }} /> : (
        <List dataSource={versions} loading={versionsQuery.isFetching} renderItem={(v) => (
          <List.Item
          main={<Space vertical align="start"><Typography.Text strong>v{v.version}</Typography.Text><Typography.Text type="tertiary" size="small">{formatDateTime(v.createdAt)} · {v.source}{v.remark ? ` · ${v.remark}` : ''}</Typography.Text></Space>}
          extra={<Space><Button size="small" onClick={() => setPendingVersionId(v.id)}>查看差异</Button><Button size="small" icon={<RotateCcw size={13} />} loading={restoreMutation.isPending && restoreMutation.variables?.versionId === v.id} onClick={() => restore(v.id)}>恢复</Button></Space>}
          />
        )} />
      )}
      {pendingVersionId && diffQuery.data ? (
        <div style={{ marginTop: 16, padding: 12, border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-medium)' }}>
          <Typography.Text strong>恢复前差异预览</Typography.Text>
          <List
          style={{ marginTop: 8 }}
          dataSource={diffQuery.data.summary}
          renderItem={(item) => <List.Item main={item} />}
          />
        </div>
      ) : null}
    </AppModal>
  );
}
