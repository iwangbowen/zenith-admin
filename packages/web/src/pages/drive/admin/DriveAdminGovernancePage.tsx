import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Checkbox, Form, Input, InputNumber, Select, Space, Tabs, TabPane, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Scale } from 'lucide-react';
import { formatBytes } from '@zenith/shared/core';
import {
  DRIVE_ACCESS_REQUEST_STATUS_LABELS, DRIVE_NODE_TYPE_LABELS, DRIVE_ROLE_LABELS, DRIVE_SPACE_TYPE_LABELS,
  type DriveLegalHold, type DriveOpenAppGrant, type DriveQuotaRequest, type DriveQuotaRequestStatus, type DriveShareAccessLog,
} from '@zenith/shared/drive';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import ExportButton from '@/components/ExportButton';
import { FileNameCell } from '@/components/FileNameCell';
import { listTableProps } from '@/components/list-page';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { DateRangeFilter, FilterSelect } from '@/components/search-filters';
import { CreateButton, ResetButton, SearchButton } from '@/components/toolbar-controls';
import { useListSearch } from '@/hooks/useListSearch';
import { usePermission } from '@/hooks/usePermission';
import {
  driveKeys, useCreateDriveLegalHold, useCreateDriveOpenAppGrant, useDecideDriveQuotaRequest, useDriveAdminQuotaRequests,
  useDriveAdminShareAccessLogs, useDriveAdminSpaces, useDriveLegalHolds, useDriveOpenAppGrants, useReleaseDriveLegalHold, useRemoveDriveOpenAppGrant,
} from '@/hooks/queries/drive';
import { useOpenAppOptions } from '@/hooks/queries/open-platform';
import { confirmDanger } from '@/utils/confirm';
import { formatDateTimeRangeForApi } from '@/utils/date';
import { dateTimeColumn, EMPTY_PLACEHOLDER, renderEllipsis } from '@/utils/table-columns';
import { DriveFolderPicker } from '../components/DriveFolderPicker';
import '../drive.css';

/**
 * 合规治理：法律保留 / 扩容审批 / 外链访问日志 / 开放应用授权。
 * Tab 同步到 ?tab=，通知中心的深链（quota / logs）可直接落到对应页签。
 */

const TABS = ['holds', 'quota', 'logs', 'open'] as const;
type TabKey = (typeof TABS)[number];

const STATUS_COLORS: Record<DriveQuotaRequestStatus, 'orange' | 'green' | 'red' | 'grey'> = { pending: 'orange', approved: 'green', rejected: 'red', cancelled: 'grey' };
const STATUS_OPTIONS = Object.entries(DRIVE_ACCESS_REQUEST_STATUS_LABELS).map(([value, label]) => ({ value: value as DriveQuotaRequestStatus, label }));
const LOG_ACTION_LABELS: Record<string, string> = { access: '进入 / 校验', list: '浏览目录', preview: '预览', download: '下载', save: '转存', upload: '收集上传' };
const LOG_ACTION_OPTIONS = Object.entries(LOG_ACTION_LABELS).map(([value, label]) => ({ value, label }));
const GRANT_ROLE_OPTIONS = [
  { value: 'viewer', label: `${DRIVE_ROLE_LABELS.viewer}（只读元数据）` },
  { value: 'downloader', label: `${DRIVE_ROLE_LABELS.downloader}（可下载内容）` },
  { value: 'editor', label: `${DRIVE_ROLE_LABELS.editor}（可上传）` },
] as const;

function useSpaceOptions() {
  const query = useDriveAdminSpaces({ page: 1, pageSize: 200 });
  return useMemo(() => (query.data?.list ?? []).map((s) => ({ value: s.id, label: `${s.name}（${DRIVE_SPACE_TYPE_LABELS[s.type]}）`, type: s.type })), [query.data]);
}

// ─── 法律保留 ─────────────────────────────────────────────────────────────────

interface HoldSearch { spaceId: number | undefined; activeOnly: boolean }

function LegalHoldsTab() {
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const canEdit = hasPermission('drive:admin:legal-hold:edit');
  const spaceOptions = useSpaceOptions();
  const { page, pageSize, buildPagination, draftParams, setField, bind, submittedParams, handleSearch, handleReset } =
    useListSearch<HoldSearch>({ defaults: { spaceId: undefined, activeOnly: true }, listKey: driveKeys.adminLegalHoldsPrefix });
  const query = useDriveLegalHolds({ page, pageSize, spaceId: submittedParams.spaceId, active: submittedParams.activeOnly ? true : undefined });
  const release = useReleaseDriveLegalHold();
  const create = useCreateDriveLegalHold();
  const [picking, setPicking] = useState(false);
  const [pending, setPending] = useState<{ nodeId: number; label: string } | null>(null);
  const [reason, setReason] = useState('');
  const [releasing, setReleasing] = useState<DriveLegalHold | null>(null);
  const [releaseNote, setReleaseNote] = useState('');

  const columns: ColumnProps<DriveLegalHold>[] = [
    { title: '对象', dataIndex: 'nodeName', minWidth: 220, ellipsis: { showTitle: false },
      render: (_: unknown, h: DriveLegalHold) => (
        <FileNameCell name={h.nodeName} mimeType={h.nodeType === 'folder' ? 'inode/directory' : null}
          onClick={() => navigate(h.nodeType === 'folder' ? `/drive?space=${h.spaceId}&folder=${h.nodeId}` : `/drive?space=${h.spaceId}&node=${h.nodeId}`)} />
      ) },
    { title: '类型', dataIndex: 'nodeType', width: 80, render: (v: DriveLegalHold['nodeType']) => DRIVE_NODE_TYPE_LABELS[v] },
    { title: '空间', dataIndex: 'spaceName', width: 150, render: renderEllipsis },
    { title: '原因', dataIndex: 'reason', minWidth: 180, render: renderEllipsis },
    { title: '状态', dataIndex: 'active', width: 90, render: (v: boolean) => (v ? <Tag size="small" color="red">保留中</Tag> : <Tag size="small" color="grey">已解除</Tag>) },
    { title: '设置人', dataIndex: 'createdByName', width: 110, render: renderEllipsis },
    dateTimeColumn('设置时间', 'createdAt'),
    { title: '解除', width: 200, render: (_: unknown, h: DriveLegalHold) => (h.releasedAt ? renderEllipsis(`${h.releasedByName ?? ''} · ${h.releasedAt}${h.releaseNote ? ` · ${h.releaseNote}` : ''}`) : EMPTY_PLACEHOLDER) },
    createOperationColumn<DriveLegalHold>({ width: 110, desktopInlineKeys: ['release'], actions: (h) => [
      { key: 'release', label: '解除保留', danger: true, hidden: !canEdit || !h.active, onClick: () => { setReleaseNote(''); setReleasing(h); } },
    ] }),
  ];

  return (
    <>
      <SearchToolbar
        filters={(
          <>
            <FilterSelect<number> {...bind('spaceId')} placeholder="全部空间" width={200} items={spaceOptions} />
            <Checkbox checked={draftParams.activeOnly} onChange={(e) => setField('activeOnly')(!!e.target.checked)}>仅保留中</Checkbox>
          </>
        )}
        actions={(
          <>
            <SearchButton onClick={handleSearch} />
            <ResetButton onClick={handleReset} />
            {canEdit && <Button type="primary" icon={<Scale size={14} />} onClick={() => setPicking(true)}>对文件夹设置保留</Button>}
          </>
        )}
      />
      <ConfigurableTable<DriveLegalHold> columns={columns} {...listTableProps(query, { pagination: buildPagination })} />
      {query.data?.total === 0 && <Typography.Text type="tertiary">暂无法律保留记录；对单个文件设置保留请在文件详情抽屉中操作。</Typography.Text>}

      <DriveFolderPicker visible={picking} title="选择要设置法律保留的文件夹" okText="下一步" writableOnly={false}
        onCancel={() => setPicking(false)}
        onOk={(target) => {
          if (target.parentId === null) { Toast.warning('请选择具体文件夹（不能对空间根级设置保留）'); return; }
          setPicking(false);
          setReason('');
          setPending({ nodeId: target.parentId, label: target.label });
        }} />
      <AppModal visible={!!pending} title={`设置法律保留 · ${pending?.label ?? ''}`} width={480} closeOnEsc onCancel={() => setPending(null)} okText="设置保留"
        okButtonProps={{ loading: create.isPending, disabled: !reason.trim() }}
        onOk={async () => {
          if (!pending) return;
          await create.mutateAsync({ body: { nodeId: pending.nodeId, reason: reason.trim() } });
          Toast.success('已设置法律保留');
          setPending(null);
        }}>
        <Typography.Paragraph type="tertiary" size="small">保留期间该文件夹及全部子项不可删除 / 彻底删除 / 删版本 / 跨空间移动，也不参与回收站到期清理与版本修剪。</Typography.Paragraph>
        <Input value={reason} onChange={setReason} placeholder="保留原因（必填）" maxLength={500} showClear />
      </AppModal>
      <AppModal visible={!!releasing} title={`解除法律保留 · ${releasing?.nodeName ?? ''}`} width={460} closeOnEsc onCancel={() => setReleasing(null)} okText="解除"
        okButtonProps={{ loading: release.isPending, type: 'danger' }}
        onOk={async () => {
          if (!releasing) return;
          await release.mutateAsync({ params: { id: releasing.id }, body: { note: releaseNote.trim() || undefined } });
          Toast.success('已解除法律保留');
          setReleasing(null);
        }}>
        <Input value={releaseNote} onChange={setReleaseNote} placeholder="解除说明（可选）" maxLength={200} showClear />
      </AppModal>
    </>
  );
}

// ─── 扩容审批 ─────────────────────────────────────────────────────────────────

interface QuotaSearch { status: DriveQuotaRequestStatus | undefined; spaceId: number | undefined }

function QuotaRequestsTab() {
  const { hasPermission } = usePermission();
  const canApprove = hasPermission('drive:admin:quota:approve');
  const spaceOptions = useSpaceOptions();
  const { page, pageSize, buildPagination, bind, submittedParams, handleSearch, handleReset } =
    useListSearch<QuotaSearch>({ defaults: { status: 'pending', spaceId: undefined }, listKey: driveKeys.adminQuotaRequestsPrefix });
  const query = useDriveAdminQuotaRequests({ page, pageSize, status: submittedParams.status, spaceId: submittedParams.spaceId });
  const decide = useDecideDriveQuotaRequest();
  const [approving, setApproving] = useState<DriveQuotaRequest | null>(null);
  const [quotaGb, setQuotaGb] = useState<number>(0);
  const [note, setNote] = useState('');

  const reject = (r: DriveQuotaRequest) => {
    confirmDanger({ title: `拒绝「${r.spaceName}」的扩容申请？`, content: '申请人将收到通知，空间配额保持不变。', okText: '拒绝',
      onOk: () => decide.mutateAsync({ params: { id: r.id }, body: { approve: false } }).then(() => Toast.success('已拒绝')) });
  };

  const columns: ColumnProps<DriveQuotaRequest>[] = [
    { title: '空间', dataIndex: 'spaceName', minWidth: 180, render: (v: string, r: DriveQuotaRequest) => <Space spacing={4}>{renderEllipsis(v)}<Tag size="small">{DRIVE_SPACE_TYPE_LABELS[r.spaceType]}</Tag></Space> },
    { title: '申请人', dataIndex: 'requesterName', width: 110, render: renderEllipsis },
    { title: '当前配额 / 已用', width: 180, render: (_: unknown, r: DriveQuotaRequest) => <span className="drive-nowrap">{r.currentQuotaBytes ? formatBytes(r.currentQuotaBytes) : '不限'} / {formatBytes(r.usedBytes)}</span> },
    { title: '申请配额', dataIndex: 'requestedGb', width: 100, render: (v: number) => `${v} GB` },
    { title: '理由', dataIndex: 'reason', minWidth: 160, render: renderEllipsis },
    { title: '状态', dataIndex: 'status', width: 90, render: (v: DriveQuotaRequestStatus) => <Tag size="small" color={STATUS_COLORS[v]}>{DRIVE_ACCESS_REQUEST_STATUS_LABELS[v]}</Tag> },
    { title: '处理', width: 220, render: (_: unknown, r: DriveQuotaRequest) => (r.decidedAt
      ? renderEllipsis(`${r.decidedByName ?? ''} · ${r.decidedAt}${r.approvedGb ? ` · 批准 ${r.approvedGb} GB` : ''}${r.decisionNote ? ` · ${r.decisionNote}` : ''}`)
      : EMPTY_PLACEHOLDER) },
    dateTimeColumn('申请时间', 'createdAt'),
    createOperationColumn<DriveQuotaRequest>({ width: 140, desktopInlineKeys: ['approve', 'reject'], actions: (r) => [
      { key: 'approve', label: '通过', hidden: !canApprove || r.status !== 'pending', onClick: () => { setQuotaGb(r.requestedGb); setNote(''); setApproving(r); } },
      { key: 'reject', label: '拒绝', danger: true, hidden: !canApprove || r.status !== 'pending', onClick: () => reject(r) },
    ] }),
  ];

  return (
    <>
      <SearchToolbar
        filters={(
          <>
            <FilterSelect<DriveQuotaRequestStatus> {...bind('status')} placeholder="全部状态" width={130} items={STATUS_OPTIONS} />
            <FilterSelect<number> {...bind('spaceId')} placeholder="全部空间" width={200} items={spaceOptions} />
          </>
        )}
        actions={(<><SearchButton onClick={handleSearch} /><ResetButton onClick={handleReset} /></>)}
      />
      <ConfigurableTable<DriveQuotaRequest> columns={columns} {...listTableProps(query, { pagination: buildPagination })} />
      {query.data?.total === 0 && <Typography.Text type="tertiary">没有{submittedParams.status ? DRIVE_ACCESS_REQUEST_STATUS_LABELS[submittedParams.status] : ''}的扩容申请。空间管理者可在「共享空间」页对配额有限的空间发起申请。</Typography.Text>}
      <AppModal visible={!!approving} title={`通过扩容申请 · ${approving?.spaceName ?? ''}`} width={480} closeOnEsc onCancel={() => setApproving(null)} okText="通过并写入配额"
        okButtonProps={{ loading: decide.isPending, disabled: !quotaGb || quotaGb < 1 }}
        onOk={async () => {
          if (!approving) return;
          await decide.mutateAsync({ params: { id: approving.id }, body: { approve: true, quotaGb, note: note.trim() || undefined } });
          Toast.success('已通过，空间配额已更新');
          setApproving(null);
        }}>
        <Form labelPosition="left" labelWidth={100}>
          <Form.Slot label="申请配额">{approving?.requestedGb} GB（当前 {approving?.currentQuotaBytes ? formatBytes(approving.currentQuotaBytes) : '不限'}，已用 {approving ? formatBytes(approving.usedBytes) : ''}）</Form.Slot>
          <Form.Slot label="批准配额 (GB)"><InputNumber min={1} max={1_000_000} value={quotaGb} onChange={(v) => setQuotaGb(typeof v === 'number' ? v : 0)} style={{ width: 200 }} /></Form.Slot>
          <Form.Slot label="备注"><Input value={note} onChange={setNote} placeholder="可选，随通知发送给申请人" maxLength={200} /></Form.Slot>
        </Form>
      </AppModal>
    </>
  );
}

// ─── 外链访问日志 ─────────────────────────────────────────────────────────────

interface LogSearch { spaceId: number | undefined; shareId: number | undefined; action: string | undefined; ok: 'true' | 'false' | undefined; timeRange: [Date, Date] | null }

function ShareAccessLogsTab() {
  const navigate = useNavigate();
  const spaceOptions = useSpaceOptions();
  const { page, pageSize, buildPagination, bind, submittedParams, handleSearch, handleReset } =
    useListSearch<LogSearch>({ defaults: { spaceId: undefined, shareId: undefined, action: undefined, ok: undefined, timeRange: null }, listKey: driveKeys.adminShareAccessLogsPrefix });
  const listParams = {
    spaceId: submittedParams.spaceId, shareId: submittedParams.shareId, action: submittedParams.action,
    ok: submittedParams.ok === undefined ? undefined : submittedParams.ok === 'true', ...formatDateTimeRangeForApi(submittedParams.timeRange),
  };
  const query = useDriveAdminShareAccessLogs({ page, pageSize, ...listParams });

  const columns: ColumnProps<DriveShareAccessLog>[] = [
    dateTimeColumn('时间', 'createdAt'),
    { title: '外链', dataIndex: 'shareId', width: 90, render: (v: number) => <Typography.Text link onClick={() => navigate(`/drive/admin/share-links?keyword=${v}`)}>#{v}</Typography.Text> },
    { title: '对象', dataIndex: 'nodeName', minWidth: 200, ellipsis: { showTitle: false },
      render: (v: string | null | undefined, l: DriveShareAccessLog) => (v ? <FileNameCell name={v} mimeType={null} onClick={l.spaceId ? () => navigate(`/drive?space=${l.spaceId}&node=${l.nodeId}`) : undefined} /> : <Typography.Text type="tertiary">已彻底删除 #{l.nodeId}</Typography.Text>) },
    { title: '空间', dataIndex: 'spaceName', width: 140, render: renderEllipsis },
    { title: '动作', dataIndex: 'action', width: 110, render: (v: string) => <Tag size="small" color="blue">{LOG_ACTION_LABELS[v] ?? v}</Tag> },
    { title: '结果', dataIndex: 'ok', width: 80, render: (v: boolean) => (v ? <Tag size="small" color="green">通过</Tag> : <Tag size="small" color="red">拒绝</Tag>) },
    { title: 'IP', dataIndex: 'clientIp', width: 150, render: renderEllipsis },
  ];

  const exportButton = <ExportButton entity="drive.share_access_logs" permission="drive:admin:link:export" query={listParams as Record<string, unknown>} />;

  return (
    <>
      <SearchToolbar
        filters={(
          <>
            <FilterSelect<number> {...bind('spaceId')} placeholder="全部空间" width={200} items={spaceOptions} />
            <InputNumber min={1} placeholder="外链 ID" {...bind('shareId', (v) => typeof v === 'number' ? v : undefined)} style={{ width: 120 }} hideButtons />
            <FilterSelect<string> {...bind('action')} placeholder="全部动作" width={130} items={LOG_ACTION_OPTIONS} />
            <FilterSelect<'true' | 'false'> {...bind('ok')} placeholder="全部结果" width={110} items={[{ value: 'true', label: '通过' }, { value: 'false', label: '拒绝' }]} />
            <DateRangeFilter {...bind('timeRange')} />
          </>
        )}
        actions={(<><SearchButton onClick={handleSearch} /><ResetButton onClick={handleReset} />{exportButton}</>)}
      />
      <ConfigurableTable<DriveShareAccessLog> columns={columns} {...listTableProps(query, { pagination: buildPagination })} />
      {query.data?.total === 0 && <Typography.Text type="tertiary">暂无外链访问记录。被拒绝的尝试（密码错误 / 过期 / IP 拦截）同样留痕，可用于排查外链爆破。</Typography.Text>}
    </>
  );
}

// ─── 开放应用授权 ─────────────────────────────────────────────────────────────

function OpenGrantsTab() {
  const { hasPermission } = usePermission();
  const canEdit = hasPermission('drive:admin:open-grant:edit');
  const spaceOptions = useSpaceOptions();
  const appsQuery = useOpenAppOptions();
  const [spaceId, setSpaceId] = useState<number | undefined>();
  const query = useDriveOpenAppGrants({ spaceId });
  const create = useCreateDriveOpenAppGrant();
  const remove = useRemoveDriveOpenAppGrant();
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<{ clientId?: string; spaceId?: number; role: 'viewer' | 'downloader' | 'editor'; remark: string }>({ role: 'downloader', remark: '' });

  const columns: ColumnProps<DriveOpenAppGrant>[] = [
    { title: '应用', dataIndex: 'appName', minWidth: 160, render: (v: string | null, g: DriveOpenAppGrant) => <Space vertical align="start" spacing={0}><Typography.Text>{v ?? '（应用已删除）'}</Typography.Text><Typography.Text type="tertiary" size="small" code>{g.clientId}</Typography.Text></Space> },
    { title: '空间', dataIndex: 'spaceName', minWidth: 160, render: renderEllipsis },
    { title: '授权角色', dataIndex: 'role', width: 110, render: (v: DriveOpenAppGrant['role']) => <Tag size="small" color={v === 'editor' ? 'orange' : 'blue'}>{DRIVE_ROLE_LABELS[v]}</Tag> },
    { title: '备注', dataIndex: 'remark', minWidth: 140, render: renderEllipsis },
    dateTimeColumn('授权时间', 'createdAt'),
    createOperationColumn<DriveOpenAppGrant>({ width: 110, desktopInlineKeys: ['remove'], actions: (g) => [
      { key: 'remove', label: '撤销授权', danger: true, hidden: !canEdit, onClick: () => { confirmDanger({ title: `撤销「${g.appName ?? g.clientId}」对「${g.spaceName}」的授权？`, content: '撤销后该应用立即无法通过开放 API 与 Webhook 访问此空间。', okText: '撤销',
        onOk: () => remove.mutateAsync({ params: { id: g.id } }).then(() => Toast.success('已撤销授权')) }); } },
    ] }),
  ];

  const grantableSpaces = spaceOptions.filter((s) => s.type !== 'personal');

  return (
    <>
      <SearchToolbar
        filters={<FilterSelect<number> value={spaceId} placeholder="全部空间" width={200} items={spaceOptions} onChange={setSpaceId} />}
        actions={canEdit ? <CreateButton onClick={() => { setDraft({ role: 'downloader', remark: '' }); setCreating(true); }}>授权应用</CreateButton> : undefined}
      />
      <ConfigurableTable<DriveOpenAppGrant> columns={columns} {...listTableProps(query)} />
      <Typography.Paragraph type="tertiary" size="small" style={{ marginTop: 8 }}>
        开放应用只能通过开放 API（/api/open/v1/drive/*，scope drive:read / drive:write）访问此处授权的空间；Webhook 的 drive.* 事件也只投递给被授权空间的应用，且必须使用 HMAC 签名。个人空间不可授权。
      </Typography.Paragraph>
      <AppModal visible={creating} title="授权开放应用访问空间" width={520} closeOnEsc onCancel={() => setCreating(false)} okText="授权"
        okButtonProps={{ loading: create.isPending, disabled: !draft.clientId || !draft.spaceId }}
        onOk={async () => {
          if (!draft.clientId || !draft.spaceId) return;
          await create.mutateAsync({ body: { clientId: draft.clientId, spaceId: draft.spaceId, role: draft.role, remark: draft.remark.trim() || undefined } });
          Toast.success('已授权');
          setCreating(false);
        }}>
        <Form labelPosition="left" labelWidth={90}>
          <Form.Slot label="应用">
            <Select filter placeholder="选择开放应用" value={draft.clientId} style={{ width: '100%' }} loading={appsQuery.isPending}
              optionList={(appsQuery.data ?? []).map((a) => ({ value: a.clientId, label: a.name }))} onChange={(v) => setDraft((d) => ({ ...d, clientId: v as string }))} />
          </Form.Slot>
          <Form.Slot label="空间">
            <Select filter placeholder="选择部门 / 协作空间" value={draft.spaceId} style={{ width: '100%' }}
              optionList={grantableSpaces.map(({ value, label }) => ({ value, label }))} onChange={(v) => setDraft((d) => ({ ...d, spaceId: v as number }))} />
          </Form.Slot>
          <Form.Slot label="授权角色">
            <Select value={draft.role} style={{ width: '100%' }} optionList={GRANT_ROLE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} onChange={(v) => setDraft((d) => ({ ...d, role: v as typeof d.role }))} />
          </Form.Slot>
          <Form.Slot label="备注"><Input value={draft.remark} onChange={(v) => setDraft((d) => ({ ...d, remark: v }))} maxLength={200} placeholder="可选" /></Form.Slot>
        </Form>
      </AppModal>
    </>
  );
}

// ─── 页面 ─────────────────────────────────────────────────────────────────────

export default function DriveAdminGovernancePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initial = searchParams.get('tab');
  const [tab, setTab] = useState<TabKey>(initial && (TABS as readonly string[]).includes(initial) ? initial as TabKey : 'holds');
  const { hasPermission } = usePermission();
  const canSeeLogs = hasPermission('drive:admin:link:list');

  const change = (key: string) => {
    setTab(key as TabKey);
    setSearchParams((prev) => { const next = new URLSearchParams(prev); next.set('tab', key); return next; }, { replace: true });
  };

  return (
    <div className="page-container">
      <Tabs type="line" activeKey={tab} onChange={change} lazyRender keepDOM={false}>
        <TabPane tab="法律保留" itemKey="holds"><LegalHoldsTab /></TabPane>
        <TabPane tab="扩容审批" itemKey="quota"><QuotaRequestsTab /></TabPane>
        {canSeeLogs && <TabPane tab="外链访问日志" itemKey="logs"><ShareAccessLogsTab /></TabPane>}
        <TabPane tab="开放应用授权" itemKey="open"><OpenGrantsTab /></TabPane>
      </Tabs>
    </div>
  );
}
