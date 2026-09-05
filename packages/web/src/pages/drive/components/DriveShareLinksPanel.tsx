import { useState } from 'react';
import { Button, Form, Table, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Link2, Plus } from 'lucide-react';
import {
  DRIVE_SHARE_PERMISSION_LABELS,
  DRIVE_SHARE_PERMISSION_OPTIONS,
  type CreateDriveShareLinkInput,
  type DriveNode,
  type DriveShareLink,
  type DriveShareLinkState,
} from '@zenith/shared/drive';
import { AppModal } from '@/components/AppModal';
import { createOperationColumn, type ResponsiveTableAction } from '@/components/ResponsiveTableActions';
import { useCreateDriveShareLink, useDeleteDriveShareLink, useDriveNodeShareLinks, useRevokeDriveShareLink, useUpdateDriveShareLink } from '@/hooks/queries/drive';
import { usePermission } from '@/hooks/usePermission';
import { copyTextWithToast } from '@/utils/clipboard';
import { confirmDanger, confirmDelete } from '@/utils/confirm';
import { formatDateTimeForApi } from '@/utils/date';
import { dateTimeColumn } from '@/utils/table-columns';
import { roleAtLeast, shareLinkAbsoluteUrl, shareLinkStateTag } from '../drive-utils';

interface ShareLinkFormValues {
  permission: 'preview' | 'download';
  password?: string;
  expireAt?: Date | null;
  maxAccessCount?: number | null;
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
  const formApiRef = { current: null as FormApi<ShareLinkFormValues> | null };
  const canCreate = allowExternalShare && hasPermission('drive:link:create') && roleAtLeast(node.myRole, 'editor');

  const handleOk = async () => {
    const api = formApiRef.current;
    if (!api) return;
    const values = await api.validate();
    const payload: CreateDriveShareLinkInput = {
      permission: values.permission,
      password: values.password || undefined,
      expireAt: values.expireAt ? formatDateTimeForApi(values.expireAt) : null,
      maxAccessCount: values.maxAccessCount ?? null,
      remark: values.remark || undefined,
    };
    if (editing === 'new') {
      const link = await create.mutateAsync({ params: { id: node.id }, body: payload });
      setEditing(null);
      await copyTextWithToast(shareLinkAbsoluteUrl(link), { success: '外链已创建并复制到剪贴板' });
    } else if (editing) {
      await update.mutateAsync({ params: { id: editing.id }, body: { ...payload, clearPassword: editing.hasPassword && !values.password ? undefined : undefined } });
      setEditing(null);
      Toast.success('外链已更新');
    }
  };

  const columns: ColumnProps<DriveShareLink>[] = [
    {
      title: '链接', dataIndex: 'url', minWidth: 200,
      render: (_: unknown, r: DriveShareLink) => (
        <Typography.Text ellipsis={{ showTooltip: true }} link={{ href: shareLinkAbsoluteUrl(r), target: '_blank', rel: 'noopener noreferrer' }}>
          {shareLinkAbsoluteUrl(r)}
        </Typography.Text>
      ),
    },
    { title: '权限', dataIndex: 'permission', width: 90, render: (v: DriveShareLink['permission']) => DRIVE_SHARE_PERMISSION_LABELS[v] },
    { title: '密码', dataIndex: 'hasPassword', width: 70, render: (v: boolean) => (v ? '有' : '无') },
    { title: '访问 / 下载', dataIndex: 'accessCount', width: 110, render: (_: unknown, r: DriveShareLink) => `${r.accessCount}${r.maxAccessCount ? `/${r.maxAccessCount}` : ''} · ${r.downloadCount}` },
    dateTimeColumn('有效期至', 'expireAt', { empty: '永久' }),
    { title: '状态', dataIndex: 'state', width: 90, fixed: 'right', render: (v: DriveShareLinkState) => shareLinkStateTag(v) },
    createOperationColumn<DriveShareLink>({
      width: 180,
      desktopInlineKeys: ['copy', 'edit'],
      actions: (r): ResponsiveTableAction[] => [
        { key: 'copy', label: '复制', onClick: () => void copyTextWithToast(shareLinkAbsoluteUrl(r)) },
        { key: 'edit', label: '编辑', hidden: r.state === 'revoked', onClick: () => setEditing(r) },
        {
          key: 'revoke', label: '撤销', danger: true, hidden: r.state === 'revoked',
          onClick: () => { confirmDanger({ title: '撤销该外链？', content: '撤销后所有已签发的访问会话立即失效，记录保留以便审计。', onOk: () => revoke.mutateAsync({ id: r.id, nodeId: node.id }).then(() => Toast.success('已撤销')) }); },
        },
        { key: 'delete', label: '删除记录', danger: true, onClick: () => { confirmDelete({ title: '删除该外链记录？', content: '访问日志将一并删除。', onOk: () => remove.mutateAsync({ id: r.id, nodeId: node.id }).then(() => Toast.success('已删除')) }); } },
      ],
    }),
  ];

  const initValues: ShareLinkFormValues = editing && editing !== 'new'
    ? { permission: editing.permission, expireAt: editing.expireAt ? new Date(editing.expireAt) : null, maxAccessCount: editing.maxAccessCount, remark: editing.remark ?? '' }
    : { permission: 'preview', expireAt: new Date(Date.now() + 7 * 86_400_000), maxAccessCount: null, remark: '' };

  return (
    <div className="drive-panel">
      <div className="drive-panel__section-head">
        <Typography.Text type="tertiary" size="small">
          {allowExternalShare ? '外链可匿名访问，请谨慎设置有效期与密码。' : '该空间已关闭外链分享。'}
        </Typography.Text>
        {canCreate && <Button size="small" theme="solid" icon={<Plus size={14} />} onClick={() => setEditing('new')}>创建外链</Button>}
      </div>
      <Table<DriveShareLink> size="small" columns={columns} dataSource={query.data ?? []} loading={query.isFetching} pagination={false} rowKey="id"
        empty={<span><Link2 size={14} style={{ verticalAlign: 'text-bottom' }} /> 暂无外链</span>} />

      <AppModal visible={!!editing} title={editing === 'new' ? '创建外链' : '编辑外链'} onCancel={() => setEditing(null)} onOk={handleOk}
        okButtonProps={{ loading: create.isPending || update.isPending }} width={520} closeOnEsc>
        <Form<ShareLinkFormValues> key={editing === 'new' ? 'new' : editing?.id ?? 'none'} getFormApi={(api) => { formApiRef.current = api; }} initValues={initValues} labelPosition="left" labelWidth={90}>
          <Form.RadioGroup field="permission" label="权限" options={DRIVE_SHARE_PERMISSION_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} />
          <Form.Input field="password" label="访问密码" placeholder={editing && editing !== 'new' && editing.hasPassword ? '留空保持原密码' : '留空则无需密码'} mode="password" rules={[{ min: 4, message: '密码至少 4 位' }]} />
          <Form.DatePicker field="expireAt" label="有效期至" type="dateTime" style={{ width: '100%' }} placeholder="留空表示永久（受管理员策略约束）" />
          <Form.InputNumber field="maxAccessCount" label="访问次数" min={1} style={{ width: '100%' }} placeholder="留空不限" />
          <Form.Input field="remark" label="备注" placeholder="可选" maxLength={256} />
        </Form>
      </AppModal>
    </div>
  );
}
