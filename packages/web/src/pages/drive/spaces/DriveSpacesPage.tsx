import { useEffect, useState } from 'react';
import { listTableProps } from '@/components/list-page';
import { Progress, Spin, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { useNavigate } from 'react-router-dom';
import { formatBytes } from '@zenith/shared/core';
import {
  DRIVE_ROLE_LABELS, DRIVE_SPACE_TYPE_LABELS, DRIVE_SPACE_TYPE_OPTIONS,
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
  driveKeys, useDeleteDriveSpaces, useDriveSpaceList, useDriveSpaceMembers, useSaveDriveSpaceMembers, useTransferDriveSpace,
} from '@/hooks/queries/drive';
import { confirmDelete } from '@/utils/confirm';
import { EMPTY_PLACEHOLDER, renderEllipsis } from '@/utils/table-columns';
import { DriveSpaceFormSheet, type DriveSpaceFormTarget } from '../components/DriveSpaceFormSheet';
import { DriveSubjectPicker, type SubjectGrant } from '../components/DriveSubjectPicker';
import { roleAtLeast, usagePercent } from '../drive-utils';
import '../drive.css';

interface SearchParams {
  keyword: string;
  type: DriveSpaceType | undefined;
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

export default function DriveSpacesPage() {
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const { page, pageSize, buildPagination, draftParams, setDraftParams, submittedParams, handleSearch, handleReset } =
    useListSearch<SearchParams>({ defaults: { keyword: '', type: undefined }, listKey: driveKeys.spaceLists });
  const listQuery = useDriveSpaceList({ page, pageSize, keyword: submittedParams.keyword || undefined, type: submittedParams.type });
  const remove = useDeleteDriveSpaces();
  const [membersOf, setMembersOf] = useState<DriveSpace | null>(null);
  const [transferOf, setTransferOf] = useState<DriveSpace | null>(null);
  const [spaceEditor, setSpaceEditor] = useState<DriveSpaceFormTarget | null>(null);

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
    { title: '状态', dataIndex: 'status', width: 80, fixed: 'right', render: (v: string) => (v === 'enabled' ? <Tag size="small" color="green">启用</Tag> : <Tag size="small" color="grey">停用</Tag>) },
    createOperationColumn<DriveSpace>({ width: 150, desktopInlineKeys: ['members'], actions: (s) => {
      const isManager = roleAtLeast(s.myRole, 'manager');
      return [
        { key: 'members', label: s.type === 'personal' ? '成员' : (isManager ? '成员管理' : '查看成员'), hidden: s.type === 'personal', onClick: () => setMembersOf(s) },
        { key: 'open', label: '打开', onClick: () => navigate(`/drive?space=${s.id}`) },
        { key: 'edit', label: '编辑', hidden: s.type !== 'team' || !isManager || !hasPermission('drive:space:edit'), onClick: () => setSpaceEditor(s) },
        { key: 'transfer', label: '转让', hidden: s.type !== 'team' || !isManager, onClick: () => setTransferOf(s) },
        { key: 'delete', label: '删除', danger: true, dividerBefore: true, hidden: s.type !== 'team' || !isManager || !hasPermission('drive:space:delete'),
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
      {!hasPermission('drive:space:create') && listQuery.data?.total === 0 && (
        <Typography.Text type="tertiary">你还没有加入任何协作空间。</Typography.Text>
      )}
    </div>
  );
}
