import { useRef, useState } from 'react';
import { Button, Empty, Form, Spin, Toast, Tooltip, Typography } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Copy, KeyRound, Link2, Pencil, Plus, Trash2, Undo2 } from 'lucide-react';
import {
  describeShareCapabilities,
  DRIVE_SHARE_CAPABILITY_OPTIONS,
  type CreateDriveShareLinkInput,
  type DriveNode,
  type DriveShareLink,
} from '@zenith/shared/drive';
import { AppModal } from '@/components/AppModal';
import { useCreateDriveShareLink, useDeleteDriveShareLink, useDriveNodeShareLinks, useRevokeDriveShareLink, useUpdateDriveShareLink } from '@/hooks/queries/drive';
import { usePermission } from '@/hooks/usePermission';
import { copyTextWithToast } from '@/utils/clipboard';
import { confirmDanger, confirmDelete } from '@/utils/confirm';
import { formatDateTimeForApi } from '@/utils/date';
import { roleAtLeast, shareLinkAbsoluteUrl, shareLinkStateTag } from '../drive-utils';

interface ShareLinkFormValues {
  capability: 'preview' | 'download';
  password?: string;
  /** 编辑带密码的外链时勾选：移除访问密码 */
  clearPassword?: boolean;
  expireAt?: Date | null;
  maxAccessCount?: number | null;
  maxDownloadCount?: number | null;
  remark?: string;
}

interface DriveShareLinksPanelProps {
  readonly node: DriveNode;
  readonly allowExternalShare: boolean;
}

export function DriveShareLinksPanel({ node, allowExternalShare }: DriveShareLinksPanelProps) {
  const { hasPermission } = usePermission();
  const query = useDriveNodeShareLinks(node.id);
  const create = useCreateDriveShareLink();
  const update = useUpdateDriveShareLink();
  const revoke = useRevokeDriveShareLink();
  const remove = useDeleteDriveShareLink();
  const [editing, setEditing] = useState<DriveShareLink | null | 'new'>(null);
  const formApiRef = useRef<FormApi<ShareLinkFormValues> | null>(null);
  const canCreate = allowExternalShare && hasPermission('drive:link:create') && roleAtLeast(node.myRole, 'editor');

  const handleOk = async () => {
    const api = formApiRef.current;
    if (!api) return;
    const values = await api.validate();
    const payload: CreateDriveShareLinkInput = {
      kind: 'share',
      capabilities: values.capability === 'download' ? ['preview', 'download'] : ['preview'],
      password: values.password || undefined,
      expireAt: values.expireAt ? formatDateTimeForApi(values.expireAt) : null,
      maxAccessCount: values.maxAccessCount ?? null,
      maxDownloadCount: values.maxDownloadCount ?? null,
      remark: values.remark || undefined,
    };
    if (editing === 'new') {
      const link = await create.mutateAsync({ params: { id: node.id }, body: payload });
      setEditing(null);
      await copyTextWithToast(shareLinkAbsoluteUrl(link), { success: '外链已创建并复制到剪贴板' });
    } else if (editing) {
      await update.mutateAsync({ params: { id: editing.id }, body: { ...payload, clearPassword: editing.hasPassword && !values.password && values.clearPassword ? true : undefined } });
      setEditing(null);
      Toast.success('外链已更新');
    }
  };

  const canManage = hasPermission('drive:link:create') && roleAtLeast(node.myRole, 'editor');

  const revokeLink = (r: DriveShareLink) => {
    confirmDanger({ title: '撤销该外链？', content: '撤销后所有已签发的访问会话立即失效，记录保留以便审计。', onOk: () => revoke.mutateAsync({ id: r.id, nodeId: node.id }).then(() => Toast.success('已撤销')) });
  };
  const deleteLink = (r: DriveShareLink) => {
    confirmDelete({ title: '删除该外链记录？', content: '访问日志将一并删除。', onOk: () => remove.mutateAsync({ id: r.id, nodeId: node.id }).then(() => Toast.success('已删除')) });
  };

  /** 抽屉宽度有限：每条外链一行「状态 · 权限 · 密码 · 次数 · 有效期 | 操作」+ 一行可点击地址，不用多列表格 */
  const renderLink = (r: DriveShareLink) => {
    const url = shareLinkAbsoluteUrl(r);
    return (
      <li key={r.id} className="drive-link-list__item">
        <div className="drive-link-list__head">
          <div className="drive-link-list__meta">
            {shareLinkStateTag(r.state)}
            <span>{describeShareCapabilities(r.capabilities)}</span>
            {r.hasPassword && <Tooltip content="需要访问密码"><KeyRound size={12} aria-label="需要访问密码" /></Tooltip>}
            <span>访问 {r.accessCount}{r.maxAccessCount ? ` / ${r.maxAccessCount}` : ''} · 下载 {r.downloadCount}{r.maxDownloadCount ? ` / ${r.maxDownloadCount}` : ''}</span>
            <span className="drive-nowrap">{r.expireAt ? `${r.expireAt} 到期` : '永久有效'}</span>
          </div>
          <div className="drive-link-list__actions">
            <Tooltip content="复制链接"><Button size="small" theme="borderless" type="tertiary" icon={<Copy size={14} />} aria-label="复制链接" onClick={() => void copyTextWithToast(url)} /></Tooltip>
            {canManage && r.state !== 'revoked' && <Tooltip content="编辑"><Button size="small" theme="borderless" type="tertiary" icon={<Pencil size={14} />} aria-label="编辑外链" onClick={() => setEditing(r)} /></Tooltip>}
            {canManage && r.state !== 'revoked' && <Tooltip content="撤销"><Button size="small" theme="borderless" type="danger" icon={<Undo2 size={14} />} aria-label="撤销外链" onClick={() => revokeLink(r)} /></Tooltip>}
            {canManage && <Tooltip content="删除记录"><Button size="small" theme="borderless" type="danger" icon={<Trash2 size={14} />} aria-label="删除外链记录" onClick={() => deleteLink(r)} /></Tooltip>}
          </div>
        </div>
        <div className="drive-link-list__url">
          <Link2 size={14} style={{ flexShrink: 0, color: 'var(--semi-color-text-2)' }} />
          <Typography.Text className="drive-link-list__url-text" ellipsis={{ showTooltip: true }} link={{ href: url, target: '_blank', rel: 'noopener noreferrer' }}>{url}</Typography.Text>
        </div>
        {r.remark && <Typography.Text className="drive-link-list__remark" ellipsis={{ showTooltip: true }}>{r.remark}</Typography.Text>}
      </li>
    );
  };

  const initValues: ShareLinkFormValues = editing && editing !== 'new'
    ? { capability: editing.capabilities.includes('download') ? 'download' : 'preview', expireAt: editing.expireAt ? new Date(editing.expireAt) : null, maxAccessCount: editing.maxAccessCount, maxDownloadCount: editing.maxDownloadCount, remark: editing.remark ?? '' }
    : { capability: 'preview', expireAt: new Date(Date.now() + 7 * 86_400_000), maxAccessCount: null, maxDownloadCount: null, remark: '' };

  return (
    <div className="drive-panel">
      <div className="drive-panel__section-head">
        <Typography.Text type="tertiary" size="small">
          {allowExternalShare ? '外链可匿名访问，请谨慎设置有效期与密码。' : '该空间已关闭外链分享。'}
        </Typography.Text>
        {canCreate && <Button size="small" theme="solid" icon={<Plus size={14} />} onClick={() => setEditing('new')}>创建外链</Button>}
      </div>
      <Spin spinning={query.isFetching}>
        {(query.data ?? []).length === 0
          ? <Empty description="暂无外链" style={{ padding: '24px 0' }} />
          : <ul className="drive-link-list">{(query.data ?? []).map(renderLink)}</ul>}
      </Spin>

      <AppModal visible={!!editing} title={editing === 'new' ? '创建外链' : '编辑外链'} onCancel={() => setEditing(null)} onOk={handleOk}
        okButtonProps={{ loading: create.isPending || update.isPending }} width={520} closeOnEsc>
        <Form<ShareLinkFormValues> key={editing === 'new' ? 'new' : editing?.id ?? 'none'} getFormApi={(api) => { formApiRef.current = api; }} initValues={initValues} labelPosition="left" labelWidth={90}>
          <Form.RadioGroup field="capability" label="权限" options={DRIVE_SHARE_CAPABILITY_OPTIONS.filter((o) => o.value !== 'upload')} />
          <Form.Input field="password" label="访问密码" placeholder={editing && editing !== 'new' && editing.hasPassword ? '留空保持原密码' : '留空则无需密码'} mode="password" rules={[{ min: 4, message: '密码至少 4 位' }]} />
          {editing && editing !== 'new' && editing.hasPassword && (
            <Form.Checkbox field="clearPassword" noLabel>移除访问密码（改为无需密码即可访问）</Form.Checkbox>
          )}
          <Form.DatePicker field="expireAt" label="有效期至" type="dateTime" style={{ width: '100%' }} placeholder="留空表示永久（受管理员策略约束）" />
          <Form.InputNumber field="maxAccessCount" label="访问次数" min={1} style={{ width: '100%' }} placeholder="留空不限" />
          <Form.InputNumber field="maxDownloadCount" label="下载次数" min={1} style={{ width: '100%' }} placeholder="留空不限" />
          <Form.Input field="remark" label="备注" placeholder="可选" maxLength={256} />
        </Form>
      </AppModal>
    </div>
  );
}
