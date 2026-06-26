import { useState, useEffect, useCallback } from 'react';
import { Button, Input, Switch, Toast, Space, Typography, Empty, Tag, List } from '@douyinfe/semi-ui';
import { Copy, Plus, Trash2, RotateCcw } from 'lucide-react';
import AppModal from '@/components/AppModal';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import type { ReportDashboardShare, ReportDashboardVersion } from '@zenith/shared';

// ─── 分享链接弹窗 ────────────────────────────────────────────────────────────
export function ShareModal({ visible, dashboardId, onClose }: Readonly<{ visible: boolean; dashboardId: number | null; onClose: () => void }>) {
  const [shares, setShares] = useState<ReportDashboardShare[]>([]);
  const [loading, setLoading] = useState(false);
  const [password, setPassword] = useState('');

  const load = useCallback(() => {
    if (!dashboardId) return;
    setLoading(true);
    request.get<ReportDashboardShare[]>(`/api/report/dashboards/${dashboardId}/shares`).then((res) => { if (res.code === 0) setShares(res.data); }).finally(() => setLoading(false));
  }, [dashboardId]);
  useEffect(() => { if (visible) load(); }, [visible, load]);

  async function create() {
    if (!dashboardId) return;
    const res = await request.post<ReportDashboardShare>(`/api/report/dashboards/${dashboardId}/shares`, { enabled: true, password: password || undefined });
    if (res.code === 0) { Toast.success('已创建分享链接'); setPassword(''); load(); }
  }
  async function toggle(s: ReportDashboardShare) {
    const res = await request.put(`/api/report/dashboards/shares/${s.id}`, { enabled: !s.enabled });
    if (res.code === 0) load();
  }
  async function remove(id: number) {
    const res = await request.delete(`/api/report/dashboards/shares/${id}`);
    if (res.code === 0) { Toast.success('已删除'); load(); }
  }
  function urlOf(token: string) { return `${window.location.origin}/public/report/${token}`; }
  function copy(token: string) { void navigator.clipboard.writeText(urlOf(token)); Toast.success('已复制分享链接'); }
  function copyIframe(token: string) { void navigator.clipboard.writeText(`<iframe src="${urlOf(token)}" width="100%" height="600" frameborder="0"></iframe>`); Toast.success('已复制 iframe 代码'); }

  return (
    <AppModal title="公开分享" visible={visible} onCancel={onClose} onOk={onClose} okText="完成" width={640} fullscreenable={false}>
      <Space style={{ marginBottom: 12 }}>
        <Input prefix="访问密码" placeholder="可选" value={password} onChange={setPassword} style={{ width: 220 }} mode="password" />
        <Button type="primary" icon={<Plus size={14} />} onClick={create}>生成链接</Button>
      </Space>
      {shares.length === 0 ? <Empty description="还没有分享链接" style={{ padding: '12px 0' }} /> : (
        <List dataSource={shares} loading={loading} renderItem={(s) => (
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
                <Switch size="small" checked={s.enabled} onChange={() => toggle(s)} />
                <Button size="small" theme="borderless" type="danger" icon={<Trash2 size={13} />} onClick={() => remove(s.id)} />
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
  const [versions, setVersions] = useState<ReportDashboardVersion[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    if (!dashboardId) return;
    setLoading(true);
    request.get<ReportDashboardVersion[]>(`/api/report/dashboards/${dashboardId}/versions`).then((res) => { if (res.code === 0) setVersions(res.data); }).finally(() => setLoading(false));
  }, [dashboardId]);
  useEffect(() => { if (visible) load(); }, [visible, load]);

  async function saveSnapshot() {
    if (!dashboardId) return;
    const res = await request.post(`/api/report/dashboards/${dashboardId}/versions`, {});
    if (res.code === 0) { Toast.success('已保存当前版本'); load(); }
  }
  async function restore(versionId: number) {
    if (!dashboardId) return;
    const res = await request.post(`/api/report/dashboards/${dashboardId}/versions/${versionId}/restore`);
    if (res.code === 0) { Toast.success('已恢复'); onRestored?.(); }
  }

  return (
    <AppModal title="版本历史" visible={visible} onCancel={onClose} onOk={onClose} okText="完成" width={560} fullscreenable={false}>
      <Button type="primary" icon={<Plus size={14} />} onClick={saveSnapshot} style={{ marginBottom: 12 }}>保存当前为新版本</Button>
      {versions.length === 0 ? <Empty description="还没有版本快照" style={{ padding: '12px 0' }} /> : (
        <List dataSource={versions} loading={loading} renderItem={(v) => (
          <List.Item
            main={<Space vertical align="start"><Typography.Text strong>v{v.version}</Typography.Text><Typography.Text type="tertiary" size="small">{formatDateTime(v.createdAt)}{v.remark ? ` · ${v.remark}` : ''}</Typography.Text></Space>}
            extra={<Button size="small" icon={<RotateCcw size={13} />} onClick={() => restore(v.id)}>恢复</Button>}
          />
        )} />
      )}
    </AppModal>
  );
}
