import { useRef, useState } from 'react';
import { Button, Empty, Form, Popover, Spin, Table, Toast, Tooltip, Typography, useFormState } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { QRCodeSVG } from 'qrcode.react';
import { Copy, Droplets, Inbox, KeyRound, Link2, Pencil, Plus, QrCode, Scissors, ShieldCheck, Trash2, Undo2 } from 'lucide-react';
import { formatBytes } from '@zenith/shared/core';
import {
  describeShareCapabilities,
  DRIVE_SHARE_CAPABILITY_OPTIONS,
  DRIVE_SHARE_KIND_LABELS,
  isIpOrCidr,
  type CreateDriveShareLinkInput,
  type DriveCollectSubmission,
  type DriveNode,
  type DriveShareKind,
  type DriveShareLink,
} from '@zenith/shared/drive';
import { AppModal } from '@/components/AppModal';
import {
  useCreateDriveShareLink, useDeleteDriveShareLink, useDriveCollectSubmissions, useDriveNodeShareLinks, useEnsureDriveShareShortLink,
  useRevokeDriveShareLink, useUpdateDriveShareLink,
} from '@/hooks/queries/drive';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import { copyTextWithToast } from '@/utils/clipboard';
import { confirmDanger, confirmDelete } from '@/utils/confirm';
import { formatDateTimeForApi } from '@/utils/date';
import { dateTimeColumn, EMPTY_PLACEHOLDER, renderEllipsis } from '@/utils/table-columns';
import { roleAtLeast, shareLinkAbsoluteUrl, shareLinkStateTag } from '../drive-utils';

interface ShareLinkFormValues {
  kind: DriveShareKind;
  capability: 'preview' | 'download';
  /** 收集链接是否允许提交人浏览文件夹现有内容 */
  collectPreview?: boolean;
  password?: string;
  /** 编辑带密码的外链时勾选：移除访问密码 */
  clearPassword?: boolean;
  expireAt?: Date | null;
  maxAccessCount?: number | null;
  maxDownloadCount?: number | null;
  allowedIps?: string[];
  watermark?: boolean;
  collectMaxFileSizeMb?: number | null;
  collectAllowedExtensions?: string[];
  collectRequireSubmitter?: boolean;
  collectMaxUploads?: number | null;
  remark?: string;
}

interface DriveShareLinksPanelProps {
  readonly node: DriveNode;
  readonly allowExternalShare: boolean;
}

/** 收集链接的提交记录 */
function CollectSubmissionsModal({ link, onClose }: { readonly link: DriveShareLink | null; readonly onClose: () => void }) {
  const { page, pageSize, buildPagination } = usePagination(10);
  const query = useDriveCollectSubmissions(link?.id, { page, pageSize }, !!link);
  const columns: ColumnProps<DriveCollectSubmission>[] = [
    { title: '文件', dataIndex: 'fileName', ellipsis: { showTitle: false }, render: renderEllipsis },
    { title: '大小', dataIndex: 'size', width: 90, render: (v: number) => <span className="drive-nowrap">{formatBytes(v)}</span> },
    { title: '提交人', dataIndex: 'submitterName', width: 120, render: (v: string | null) => v ?? EMPTY_PLACEHOLDER },
    { title: '备注', dataIndex: 'submitterNote', ellipsis: { showTitle: false }, render: renderEllipsis },
    { title: 'IP', dataIndex: 'clientIp', width: 130, render: (v: string | null) => v ?? EMPTY_PLACEHOLDER },
    dateTimeColumn<DriveCollectSubmission>('提交时间', 'createdAt'),
  ];
  return (
    <AppModal visible={!!link} title={`收集记录 · ${link?.nodeName ?? ''}`} onCancel={onClose} footer={null} width={760} closeOnEsc>
      <Table<DriveCollectSubmission> size="small" rowKey="id" columns={columns} dataSource={query.data?.list ?? []} loading={query.isFetching}
        pagination={buildPagination(query.data?.total ?? 0)}
        empty={<Empty description="还没有收到文件" />} />
    </AppModal>
  );
}

/** 表单内按种类切换字段：Semi Form 的 useFormState 只能在 Form 子树中使用 */
function ShareLinkFormFields({ node, editing }: { readonly node: DriveNode; readonly editing: DriveShareLink | 'new' }) {
  const { values } = useFormState<ShareLinkFormValues>();
  const isNew = editing === 'new';
  const kind = values?.kind ?? 'share';
  return (
    <>
      {node.type === 'folder' && isNew && (
        <Form.RadioGroup field="kind" label="类型" type="button" options={[
          { value: 'share', label: DRIVE_SHARE_KIND_LABELS.share },
          { value: 'collect', label: DRIVE_SHARE_KIND_LABELS.collect },
        ]} />
      )}
      {kind === 'share'
        ? <Form.RadioGroup field="capability" label="权限" options={DRIVE_SHARE_CAPABILITY_OPTIONS.filter((o) => o.value !== 'upload')} />
        : <Form.Checkbox field="collectPreview" label="浏览" extraText="允许提交人查看该文件夹已有的文件（默认只能上传）">允许浏览文件夹内容</Form.Checkbox>}
      {kind === 'collect' && (
        <>
          <Form.InputNumber field="collectMaxFileSizeMb" label="单文件上限" min={1} max={10_240} suffix="MB" style={{ width: '100%' }} placeholder="留空跟随系统设置" />
          <Form.TagInput field="collectAllowedExtensions" label="允许类型" placeholder="输入扩展名后回车，如 pdf；留空不限" allowDuplicates={false} maxTagCount={8}
            rules={[{ validator: (_rule, v: string[] | undefined) => (v ?? []).every((e) => /^\.?[A-Za-z0-9]+$/.test(e.trim())), message: '扩展名只能包含字母与数字' }]} />
          <Form.InputNumber field="collectMaxUploads" label="收集上限" min={1} style={{ width: '100%' }} placeholder="累计可收集的文件数，留空不限" />
          <Form.Checkbox field="collectRequireSubmitter" noLabel>要求提交人填写姓名</Form.Checkbox>
        </>
      )}
      <Form.Input field="password" label="访问密码" placeholder={!isNew && editing.hasPassword ? '留空保持原密码' : '留空则无需密码'} mode="password" rules={[{ min: 4, message: '密码至少 4 位' }]} />
      {!isNew && editing.hasPassword && (
        <Form.Checkbox field="clearPassword" noLabel>移除访问密码（改为无需密码即可访问）</Form.Checkbox>
      )}
      <Form.DatePicker field="expireAt" label="有效期至" type="dateTime" style={{ width: '100%' }} placeholder="留空表示永久（受管理员策略约束）" />
      <Form.InputNumber field="maxAccessCount" label="访问次数" min={1} style={{ width: '100%' }} placeholder="留空不限" />
      {kind === 'share' && <Form.InputNumber field="maxDownloadCount" label="下载次数" min={1} style={{ width: '100%' }} placeholder="留空不限" />}
      <Form.TagInput field="allowedIps" label="IP 白名单" placeholder="IP 或 CIDR（如 10.0.0.0/8）后回车，留空不限" allowDuplicates={false}
        rules={[{ validator: (_rule, v: string[] | undefined) => (v ?? []).every((ip) => isIpOrCidr(ip.trim())), message: '请输入合法的 IP 或 CIDR' }]} />
      {kind === 'share' && <Form.Switch field="watermark" label="预览水印" extraText="在线预览时叠加「分享人 · 时间 · 访问 IP 尾段」水印，抑制截图外传" />}
      <Form.Input field="remark" label="备注" placeholder="可选" maxLength={256} />
    </>
  );
}

export function DriveShareLinksPanel({ node, allowExternalShare }: DriveShareLinksPanelProps) {
  const { hasPermission } = usePermission();
  const query = useDriveNodeShareLinks(node.id);
  const create = useCreateDriveShareLink();
  const update = useUpdateDriveShareLink();
  const revoke = useRevokeDriveShareLink();
  const remove = useDeleteDriveShareLink();
  const shortLink = useEnsureDriveShareShortLink();
  const [editing, setEditing] = useState<DriveShareLink | null | 'new'>(null);
  const [submissionsOf, setSubmissionsOf] = useState<DriveShareLink | null>(null);
  const formApiRef = useRef<FormApi<ShareLinkFormValues> | null>(null);
  const canCreate = allowExternalShare && hasPermission('drive:link:create') && roleAtLeast(node.myRole, 'editor');

  const toPayload = (values: ShareLinkFormValues, kind: DriveShareKind): CreateDriveShareLinkInput => ({
    kind,
    capabilities: kind === 'collect'
      ? (values.collectPreview ? ['preview', 'upload'] : ['upload'])
      : (values.capability === 'download' ? ['preview', 'download'] : ['preview']),
    password: values.password || undefined,
    expireAt: values.expireAt ? formatDateTimeForApi(values.expireAt) : null,
    maxAccessCount: values.maxAccessCount ?? null,
    maxDownloadCount: kind === 'share' ? values.maxDownloadCount ?? null : null,
    remark: values.remark || undefined,
    allowedIps: (values.allowedIps ?? []).map((ip) => ip.trim()).filter(Boolean),
    watermark: kind === 'share' ? !!values.watermark : false,
    collectPolicy: kind === 'collect' ? {
      maxFileSizeMb: values.collectMaxFileSizeMb ?? null,
      allowedExtensions: (values.collectAllowedExtensions ?? []).map((e) => e.trim().replace(/^\./, '').toLowerCase()).filter(Boolean),
      requireSubmitter: values.collectRequireSubmitter ?? true,
      maxUploads: values.collectMaxUploads ?? null,
    } : null,
  });

  const handleOk = async () => {
    const api = formApiRef.current;
    if (!api) return;
    const values = await api.validate();
    if (editing === 'new') {
      const link = await create.mutateAsync({ params: { id: node.id }, body: toPayload(values, values.kind ?? 'share') });
      setEditing(null);
      await copyTextWithToast(shareLinkAbsoluteUrl(link), { success: link.kind === 'collect' ? '收集链接已创建并复制到剪贴板' : '外链已创建并复制到剪贴板' });
    } else if (editing) {
      const { kind: _kind, ...payload } = toPayload(values, editing.kind);
      await update.mutateAsync({ params: { id: editing.id }, body: { ...payload, clearPassword: editing.hasPassword && !values.password && values.clearPassword ? true : undefined } });
      setEditing(null);
      Toast.success('外链已更新');
    }
  };

  const canManage = hasPermission('drive:link:create') && roleAtLeast(node.myRole, 'editor');

  const revokeLink = (r: DriveShareLink) => {
    confirmDanger({ title: '撤销该外链？', content: '撤销后所有已签发的访问会话与短链立即失效，记录保留以便审计。', onOk: () => revoke.mutateAsync({ id: r.id, nodeId: node.id }).then(() => Toast.success('已撤销')) });
  };
  const deleteLink = (r: DriveShareLink) => {
    confirmDelete({ title: '删除该外链记录？', content: '访问日志与收集记录将一并删除。', onOk: () => remove.mutateAsync({ id: r.id, nodeId: node.id }).then(() => Toast.success('已删除')) });
  };
  const makeShortLink = async (r: DriveShareLink) => {
    const result = await shortLink.mutateAsync({ id: r.id, nodeId: node.id });
    await copyTextWithToast(result.shortUrl, { success: '短链已生成并复制到剪贴板' });
  };

  /** 抽屉宽度有限：每条外链一行「状态 · 类型 · 权限 · 密码 · 次数 · 有效期 | 操作」+ 一行可点击地址，不用多列表格 */
  const renderLink = (r: DriveShareLink) => {
    const url = shareLinkAbsoluteUrl(r);
    const isCollect = r.kind === 'collect';
    return (
      <li key={r.id} className="drive-link-list__item">
        <div className="drive-link-list__head">
          <div className="drive-link-list__meta">
            {shareLinkStateTag(r.state)}
            {isCollect && <span className="drive-link-list__kind"><Inbox size={12} aria-hidden /> 文件收集</span>}
            <span>{describeShareCapabilities(r.capabilities)}</span>
            {r.hasPassword && <Tooltip content="需要访问密码"><KeyRound size={12} aria-label="需要访问密码" /></Tooltip>}
            {r.allowedIps.length > 0 && <Tooltip content={`仅允许 ${r.allowedIps.join('、')} 访问`}><ShieldCheck size={12} aria-label="IP 白名单" /></Tooltip>}
            {r.watermark && <Tooltip content="预览带访问者水印"><Droplets size={12} aria-label="预览水印" /></Tooltip>}
            <span>
              访问 {r.accessCount}{r.maxAccessCount ? ` / ${r.maxAccessCount}` : ''}
              {isCollect
                ? ` · 收到 ${r.uploadCount}${r.collectPolicy?.maxUploads ? ` / ${r.collectPolicy.maxUploads}` : ''}`
                : ` · 下载 ${r.downloadCount}${r.maxDownloadCount ? ` / ${r.maxDownloadCount}` : ''}`}
            </span>
            <span className="drive-nowrap">{r.expireAt ? `${r.expireAt} 到期` : '永久有效'}</span>
          </div>
          <div className="drive-link-list__actions">
            <Tooltip content="复制链接"><Button size="small" theme="borderless" type="tertiary" icon={<Copy size={14} />} aria-label="复制链接" onClick={() => void copyTextWithToast(url)} /></Tooltip>
            <Popover position="left" trigger="click" content={(
              <div className="drive-link-qr">
                <QRCodeSVG value={r.shortUrl ?? url} size={168} includeMargin />
                <Typography.Text type="tertiary" size="small">扫码打开{isCollect ? '收集' : '分享'}页{r.shortUrl ? '（短链）' : ''}</Typography.Text>
              </div>
            )}>
              <Button size="small" theme="borderless" type="tertiary" icon={<QrCode size={14} />} aria-label="二维码" />
            </Popover>
            {canManage && r.state !== 'revoked' && (
              <Tooltip content={r.shortUrl ? '复制短链' : '生成短链'}>
                <Button size="small" theme="borderless" type="tertiary" icon={<Scissors size={14} />} aria-label={r.shortUrl ? '复制短链' : '生成短链'} loading={shortLink.isPending && shortLink.variables?.id === r.id}
                  onClick={() => (r.shortUrl ? void copyTextWithToast(r.shortUrl) : void makeShortLink(r))} />
              </Tooltip>
            )}
            {isCollect && canManage && <Tooltip content="收集记录"><Button size="small" theme="borderless" type="tertiary" icon={<Inbox size={14} />} aria-label="收集记录" onClick={() => setSubmissionsOf(r)} /></Tooltip>}
            {canManage && r.state !== 'revoked' && <Tooltip content="编辑"><Button size="small" theme="borderless" type="tertiary" icon={<Pencil size={14} />} aria-label="编辑外链" onClick={() => setEditing(r)} /></Tooltip>}
            {canManage && r.state !== 'revoked' && <Tooltip content="撤销"><Button size="small" theme="borderless" type="danger" icon={<Undo2 size={14} />} aria-label="撤销外链" onClick={() => revokeLink(r)} /></Tooltip>}
            {canManage && <Tooltip content="删除记录"><Button size="small" theme="borderless" type="danger" icon={<Trash2 size={14} />} aria-label="删除外链记录" onClick={() => deleteLink(r)} /></Tooltip>}
          </div>
        </div>
        <div className="drive-link-list__url">
          <Link2 size={14} style={{ flexShrink: 0, color: 'var(--semi-color-text-2)' }} />
          <Typography.Text className="drive-link-list__url-text" ellipsis={{ showTooltip: true }} link={{ href: r.shortUrl ?? url, target: '_blank', rel: 'noopener noreferrer' }}>{r.shortUrl ?? url}</Typography.Text>
        </div>
        {r.remark && <Typography.Text className="drive-link-list__remark" ellipsis={{ showTooltip: true }}>{r.remark}</Typography.Text>}
      </li>
    );
  };

  const initValues: ShareLinkFormValues = editing && editing !== 'new'
    ? {
      kind: editing.kind,
      capability: editing.capabilities.includes('download') ? 'download' : 'preview',
      collectPreview: editing.capabilities.includes('preview'),
      expireAt: editing.expireAt ? new Date(editing.expireAt) : null,
      maxAccessCount: editing.maxAccessCount, maxDownloadCount: editing.maxDownloadCount,
      allowedIps: editing.allowedIps, watermark: editing.watermark,
      collectMaxFileSizeMb: editing.collectPolicy?.maxFileSizeMb ?? null,
      collectAllowedExtensions: editing.collectPolicy?.allowedExtensions ?? [],
      collectRequireSubmitter: editing.collectPolicy?.requireSubmitter ?? true,
      collectMaxUploads: editing.collectPolicy?.maxUploads ?? null,
      remark: editing.remark ?? '',
    }
    : {
      kind: 'share', capability: 'preview', collectPreview: false, expireAt: new Date(Date.now() + 7 * 86_400_000), maxAccessCount: null, maxDownloadCount: null,
      allowedIps: [], watermark: false, collectMaxFileSizeMb: null, collectAllowedExtensions: [], collectRequireSubmitter: true, collectMaxUploads: null, remark: '',
    };

  return (
    <div className="drive-panel">
      <div className="drive-panel__section-head">
        <Typography.Text type="tertiary" size="small">
          {allowExternalShare ? (node.type === 'folder' ? '外链可匿名访问；文件收集链接允许他人向该文件夹提交文件。' : '外链可匿名访问，请谨慎设置有效期与密码。') : '该空间已关闭外链分享。'}
        </Typography.Text>
        {canCreate && <Button size="small" theme="solid" icon={<Plus size={14} />} onClick={() => setEditing('new')}>创建外链</Button>}
      </div>
      <Spin spinning={query.isFetching}>
        {(query.data ?? []).length === 0
          ? <Empty description="暂无外链" style={{ padding: '24px 0' }} />
          : <ul className="drive-link-list">{(query.data ?? []).map(renderLink)}</ul>}
      </Spin>

      <AppModal visible={!!editing} title={editing === 'new' ? '创建外链' : `编辑${editing ? DRIVE_SHARE_KIND_LABELS[editing.kind] : ''}链接`} onCancel={() => setEditing(null)} onOk={handleOk}
        okButtonProps={{ loading: create.isPending || update.isPending }} width={560} closeOnEsc>
        {editing && (
          <Form<ShareLinkFormValues> key={editing === 'new' ? 'new' : editing.id} getFormApi={(api) => { formApiRef.current = api; }} initValues={initValues} labelPosition="left" labelWidth={90}>
            <ShareLinkFormFields node={node} editing={editing} />
          </Form>
        )}
      </AppModal>
      <CollectSubmissionsModal link={submissionsOf} onClose={() => setSubmissionsOf(null)} />
    </div>
  );
}
