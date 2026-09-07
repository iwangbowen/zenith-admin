import { useEffect, useState } from 'react';
import { listTableProps } from '@/components/list-page';
import { Checkbox, Input, InputNumber, Progress, Spin, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { useNavigate } from 'react-router-dom';
import { formatBytes } from '@zenith/shared/core';
import {
  DRIVE_ACCESS_REQUEST_STATUS_LABELS, DRIVE_ROLE_LABELS, DRIVE_SPACE_TYPE_LABELS, DRIVE_SPACE_TYPE_OPTIONS,
  type DriveRole, type DriveSpace, type DriveSpaceType,
} from '@zenith/shared/drive';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { FilterSelect, KeywordInput } from '@/components/search-filters';
import { CreateButton, ResetButton, SearchButton } from '@/components/toolbar-controls';
import UserSelect from '@/components/UserSelect';
import { useListSearch } from '@/hooks/useListSearch';
import { usePermission } from '@/hooks/usePermission';
import {
  driveKeys, useArchiveDriveSpace, useDeleteDriveSpaces, useDriveSpaceList, useDriveSpaceMembers, useRequestDriveQuota, useSaveDriveSpaceMembers,
  useSpaceQuotaRequests, useTransferDriveSpace, useUnarchiveDriveSpace,
} from '@/hooks/queries/drive';
import { confirmDanger, confirmDelete } from '@/utils/confirm';
import { EMPTY_PLACEHOLDER, renderEllipsis } from '@/utils/table-columns';
import { DriveSpaceFormSheet, type DriveSpaceFormTarget } from '../components/DriveSpaceFormSheet';
import { DriveSubjectPicker, type SubjectGrant } from '../components/DriveSubjectPicker';
import { roleAtLeast, usagePercent } from '../drive-utils';
import { DriveSpaceActivitiesModal, DriveTagsModal } from '../components/DriveCollaborationPanels';
import '../drive.css';

interface SearchParams {
  keyword: string;
  type: DriveSpaceType | undefined;
  archived: boolean;
}

function MembersModal({ space, onClose }: { readonly space: DriveSpace | null; readonly onClose: () => void }) {
  const query = useDriveSpaceMembers(space?.id, !!space);
  const save = useSaveDriveSpaceMembers();
  const [draft, setDraft] = useState<SubjectGrant[]>([]);
  useEffect(() => { setDraft((query.data ?? []).map((m) => ({ subjectType: m.subjectType, subjectId: m.subjectId, role: m.role, subjectName: m.subjectName }))); }, [query.data]);
  const canEdit = roleAtLeast(space?.myRole, 'manager');
  return (
    // 只读时才显式传 footer={null}：Semi 以 `'footer' in props` 判定，传 undefined 也会吞掉默认页脚
    <AppModal visible={!!space} title={`成员管理 · ${space?.name ?? ''}`} width={760} closeOnEsc onCancel={onClose}
      {...(canEdit ? {} : { footer: null })}
      okText="保存" okButtonProps={{ loading: save.isPending }}
      onOk={async () => {
        if (!space) return;
        await save.mutateAsync({ params: { id: space.id }, body: { members: draft.map(({ subjectType, subjectId, role }) => ({ subjectType, subjectId, role })) } });
        Toast.success('成员已更新');
        onClose();
      }}>
      <Spin spinning={query.isPending}>
        {space?.type === 'personal' && <Typography.Text type="tertiary">个人空间不支持添加成员，可通过文件夹授权共享。</Typography.Text>}
        {space?.type !== 'personal' && (
          <>
            <Typography.Paragraph type="tertiary" size="small" style={{ marginBottom: 12 }}>
              {space?.type === 'department'
                ? '部门成员默认按「默认成员角色」访问；此处可为个别用户 / 角色 / 用户组提升角色。'
                : '空间所有者自动为管理者。默认成员角色为空时，仅以下协作者可访问。'}
            </Typography.Paragraph>
            <DriveSubjectPicker value={draft} onChange={setDraft} disabled={!canEdit} />
          </>
        )}
      </Spin>
    </AppModal>
  );
}

function TransferModal({ space, onClose }: { readonly space: DriveSpace | null; readonly onClose: () => void }) {
  const transfer = useTransferDriveSpace();
  const [ownerId, setOwnerId] = useState<number | undefined>();
  return (
    <AppModal visible={!!space} title="转让空间所有权" width={460} closeOnEsc onCancel={onClose} okText="转让"
      okButtonProps={{ loading: transfer.isPending, disabled: !ownerId }}
      onOk={async () => {
        if (!space || !ownerId) return;
        await transfer.mutateAsync({ params: { id: space.id }, body: { ownerId } });
        Toast.success('已转让');
        onClose();
      }}>
      <Typography.Paragraph>将「{space?.name}」的所有权转让给：</Typography.Paragraph>
      <UserSelect value={ownerId} onChange={(v) => setOwnerId(typeof v === 'number' ? v : undefined)} placeholder="选择新所有者" style={{ width: '100%' }} />
      <Typography.Text type="tertiary" size="small">转让后你将降为管理者，可由新所有者调整。</Typography.Text>
    </AppModal>
  );
}

/** 空间管理者申请扩容：展示当前配额 / 用量与历史申请，提交后由网盘管理员审批 */
function QuotaRequestModal({ space, onClose }: { readonly space: DriveSpace | null; readonly onClose: () => void }) {
  const request = useRequestDriveQuota();
  const history = useSpaceQuotaRequests(space?.id, !!space);
  const currentGb = space?.quotaBytes ? Math.ceil(space.quotaBytes / 1024 ** 3) : 0;
  const [requestedGb, setRequestedGb] = useState<number>(0);
  const [reason, setReason] = useState('');
  useEffect(() => { setRequestedGb(currentGb ? currentGb * 2 : 0); setReason(''); }, [currentGb, space?.id]);
  const pending = (history.data ?? []).find((r) => r.status === 'pending');
  const canSubmit = !!space?.quotaBytes && !pending && requestedGb > currentGb;
  return (
    <AppModal visible={!!space} title={`申请扩容 · ${space?.name ?? ''}`} width={520} closeOnEsc onCancel={onClose} okText="提交申请"
      okButtonProps={{ loading: request.isPending, disabled: !canSubmit }}
      onOk={async () => {
        if (!space) return;
        await request.mutateAsync({ params: { id: space.id }, body: { requestedGb, reason: reason.trim() || undefined } });
        Toast.success('扩容申请已提交，网盘管理员审批后生效');
        onClose();
      }}>
      {space && !space.quotaBytes && <Typography.Paragraph type="tertiary">该空间当前不限配额，无需扩容。</Typography.Paragraph>}
      {space && !!space.quotaBytes && (
        <>
          <Typography.Paragraph>当前配额 {formatBytes(space.quotaBytes)}，已用 {formatBytes(space.usedBytes)}。</Typography.Paragraph>
          {pending && <Typography.Paragraph type="warning">已有一条待审批申请（{pending.requestedGb} GB，{pending.createdAt}），处理完成前不能重复提交。</Typography.Paragraph>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <InputNumber prefix="期望配额" suffix="GB" min={currentGb + 1} max={1_000_000} value={requestedGb} onChange={(v) => setRequestedGb(typeof v === 'number' ? v : 0)} style={{ width: 240 }} disabled={!!pending} />
            <Input value={reason} onChange={setReason} placeholder="申请理由（可选，随通知发送给管理员）" maxLength={500} disabled={!!pending} />
          </div>
          {(history.data ?? []).length > 0 && (
            <ul className="drive-quota-history">
              {(history.data ?? []).slice(0, 5).map((r) => (
                <li key={r.id}>
                  <Tag size="small" color={r.status === 'approved' ? 'green' : r.status === 'rejected' ? 'red' : r.status === 'pending' ? 'orange' : 'grey'}>{DRIVE_ACCESS_REQUEST_STATUS_LABELS[r.status]}</Tag>
                  <span>申请 {r.requestedGb} GB{r.approvedGb ? ` · 批准 ${r.approvedGb} GB` : ''} · {r.createdAt}{r.decisionNote ? ` · ${r.decisionNote}` : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </AppModal>
  );
}

export default function DriveSpacesPage() {
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const { page, pageSize, buildPagination, draftParams, setDraftParams, submittedParams, handleSearch, handleReset } =
    useListSearch<SearchParams>({ defaults: { keyword: '', type: undefined, archived: false }, listKey: driveKeys.spaceLists });
  const listQuery = useDriveSpaceList({ page, pageSize, keyword: submittedParams.keyword || undefined, type: submittedParams.type, archived: submittedParams.archived || undefined });
  const remove = useDeleteDriveSpaces();
  const archive = useArchiveDriveSpace();
  const unarchive = useUnarchiveDriveSpace();
  const [membersOf, setMembersOf] = useState<DriveSpace | null>(null);
  const [transferOf, setTransferOf] = useState<DriveSpace | null>(null);
  const [quotaOf, setQuotaOf] = useState<DriveSpace | null>(null);
  const [tagsOf, setTagsOf] = useState<DriveSpace | null>(null);
  const [activitiesOf, setActivitiesOf] = useState<DriveSpace | null>(null);
  const [spaceEditor, setSpaceEditor] = useState<DriveSpaceFormTarget | null>(null);

  const toggleArchive = (s: DriveSpace) => {
    if (s.archivedAt) {
      unarchive.mutate({ params: { id: s.id } }, { onSuccess: () => Toast.success('已恢复归档，空间可正常读写') });
      return;
    }
    confirmDanger({ title: `归档空间「${s.name}」？`, content: '归档后空间只读：不能上传、修改、删除或分享，已有外链仍可访问；空间不再出现在侧栏，可随时恢复。', okText: '归档',
      onOk: () => archive.mutateAsync({ params: { id: s.id } }).then(() => Toast.success('空间已归档（只读）')) });
  };

  // 页面宽约 1190px：去掉低价值的创建时间列、收窄辅助列，让名称列保持可读；打开空间点名称即可
  const columns: ColumnProps<DriveSpace>[] = [
    { title: '名称', dataIndex: 'name', minWidth: 200, ellipsis: { showTitle: false },
      render: (v: string, s: DriveSpace) => (
        <Typography.Text link ellipsis={{ showTooltip: true }} onClick={() => navigate(`/drive?space=${s.id}`)}>{v}</Typography.Text>
      ) },
    { title: '类型', dataIndex: 'type', width: 100, render: (v: DriveSpaceType) => <Tag size="small" color={v === 'personal' ? 'grey' : v === 'department' ? 'green' : 'blue'}>{DRIVE_SPACE_TYPE_LABELS[v]}</Tag> },
    { title: '所有者 / 部门', width: 130, render: (_: unknown, s: DriveSpace) => renderEllipsis(s.ownerName ?? s.departmentName) },
    { title: '我的角色', dataIndex: 'myRole', width: 90, render: (v: DriveRole | null | undefined) => (v ? DRIVE_ROLE_LABELS[v] : EMPTY_PLACEHOLDER) },
    { title: '默认角色', dataIndex: 'defaultMemberRole', width: 90, render: (v: DriveRole | null) => (v ? DRIVE_ROLE_LABELS[v] : '不开放') },
    { title: '成员', dataIndex: 'memberCount', width: 70, render: (v?: number) => v ?? EMPTY_PLACEHOLDER },
    { title: '用量', width: 170, render: (_: unknown, s: DriveSpace) => {
      const pct = usagePercent(s);
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span className="drive-nowrap" style={{ fontSize: 12 }}>{formatBytes(s.usedBytes)}{s.quotaBytes ? ` / ${formatBytes(s.quotaBytes)}` : ' · 不限'}</span>
          {pct !== null && <Progress percent={pct} size="small" showInfo={false} stroke={pct >= 90 ? 'var(--semi-color-danger)' : undefined} aria-label={`用量 ${pct}%`} />}
        </div>
      );
    } },
    { title: '状态', dataIndex: 'status', width: 110, fixed: 'right', render: (v: string, s: DriveSpace) => (
      s.archivedAt ? <Tag size="small" color="grey">已归档 · 只读</Tag> : v === 'enabled' ? <Tag size="small" color="green">启用</Tag> : <Tag size="small" color="grey">停用</Tag>
    ) },
    createOperationColumn<DriveSpace>({ width: 150, desktopInlineKeys: ['members'], actions: (s) => {
      const isManager = roleAtLeast(s.myRole, 'manager');
      const canEditSpace = hasPermission('drive:space:edit');
      return [
        { key: 'members', label: s.type === 'personal' ? '成员' : (isManager ? '成员管理' : '查看成员'), hidden: s.type === 'personal', onClick: () => setMembersOf(s) },
        { key: 'open', label: '打开', onClick: () => navigate(`/drive?space=${s.id}`) },
        { key: 'activities', label: '空间动态', onClick: () => setActivitiesOf(s) },
        { key: 'tags', label: '标签管理', onClick: () => setTagsOf(s) },
        { key: 'edit', label: '编辑', hidden: s.type !== 'team' || !isManager || !canEditSpace || !!s.archivedAt, onClick: () => setSpaceEditor(s) },
        { key: 'transfer', label: '转让', hidden: s.type !== 'team' || !isManager || !!s.archivedAt, onClick: () => setTransferOf(s) },
        { key: 'quota', label: '申请扩容', hidden: !isManager || !canEditSpace || !s.quotaBytes, onClick: () => setQuotaOf(s) },
        { key: 'archive', label: s.archivedAt ? '恢复归档' : '归档（只读）', dividerBefore: true, hidden: s.type === 'personal' || !isManager || !canEditSpace, onClick: () => toggleArchive(s) },
        { key: 'delete', label: '删除', danger: true, hidden: s.type !== 'team' || !isManager || !hasPermission('drive:space:delete'),
          onClick: () => { confirmDelete({ title: `删除协作空间「${s.name}」？`, content: '空间内文件将进入回收站，保留期后彻底清除。',
            onOk: () => remove.mutateAsync([s.id]).then(() => Toast.success('已删除')) }); } },
      ];
    } }),
  ];

  return (
    <div className="page-container">
      <SearchToolbar
        filters={(
          <>
            <KeywordInput value={draftParams.keyword} placeholder="搜索空间名称" onChange={(v) => setDraftParams((p) => ({ ...p, keyword: v }))} onSearch={handleSearch} />
            <FilterSelect<DriveSpaceType> value={draftParams.type} placeholder="全部类型" items={DRIVE_SPACE_TYPE_OPTIONS} onChange={(v) => setDraftParams((p) => ({ ...p, type: v }))} />
            <Checkbox checked={draftParams.archived} onChange={(e) => setDraftParams((p) => ({ ...p, archived: !!e.target.checked }))}>只看已归档</Checkbox>
          </>
        )}
        actions={(
          <>
            <SearchButton onClick={handleSearch} />
            <ResetButton onClick={handleReset} />
            {hasPermission('drive:space:create') && <CreateButton onClick={() => setSpaceEditor('create')}>新建协作空间</CreateButton>}
          </>
        )}
      />
      <ConfigurableTable<DriveSpace> columns={columns}
        {...listTableProps(listQuery, { pagination: buildPagination })}
      />

      <DriveSpaceFormSheet target={spaceEditor} onClose={() => setSpaceEditor(null)} />
      <MembersModal space={membersOf} onClose={() => setMembersOf(null)} />
      <TransferModal space={transferOf} onClose={() => setTransferOf(null)} />
      <QuotaRequestModal space={quotaOf} onClose={() => setQuotaOf(null)} />
      <DriveTagsModal space={tagsOf} onClose={() => setTagsOf(null)} />
      <DriveSpaceActivitiesModal space={activitiesOf} onClose={() => setActivitiesOf(null)} />
      {!hasPermission('drive:space:create') && listQuery.data?.total === 0 && (
        <Typography.Text type="tertiary">你还没有加入任何协作空间。</Typography.Text>
      )}
    </div>
  );
}
