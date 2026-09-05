import { useEffect, useState } from 'react';
import { Form, Progress, Spin, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { formatBytes } from '@zenith/shared/core';
import {
  DRIVE_ROLE_LABELS, DRIVE_ROLE_OPTIONS, DRIVE_SPACE_TYPE_LABELS, DRIVE_SPACE_TYPE_OPTIONS,
  type CreateDriveSpaceInput, type DriveRole, type DriveSpace, type DriveSpaceType, type UpdateDriveSpaceInput,
} from '@zenith/shared/drive';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { FilterSelect, KeywordInput } from '@/components/search-filters';
import { CreateButton, ResetButton, SearchButton } from '@/components/toolbar-controls';
import UserSelect from '@/components/UserSelect';
import { useEditModal } from '@/hooks/useEditModal';
import { useListSearch } from '@/hooks/useListSearch';
import { usePermission } from '@/hooks/usePermission';
import {
  driveKeys, useDeleteDriveSpaces, useDriveSpaceDetail, useDriveSpaceList, useDriveSpaceMembers, useSaveDriveSpace, useSaveDriveSpaceMembers, useTransferDriveSpace,
} from '@/hooks/queries/drive';
import { confirmDelete } from '@/utils/confirm';
import { dateTimeColumn, EMPTY_PLACEHOLDER } from '@/utils/table-columns';
import { DriveSubjectPicker, type SubjectGrant } from '../components/DriveSubjectPicker';
import { roleAtLeast, usagePercent } from '../drive-utils';
import '../drive.css';

interface SearchParams {
  keyword: string;
  type: DriveSpaceType | undefined;
}

interface SpaceFormValues {
  name: string;
  description?: string;
  defaultMemberRole: DriveRole | null;
  quotaGb: number | null;
  maxVersions: number | null;
  allowExternalShare: boolean;
  status: 'enabled' | 'disabled';
}

const ROLE_OPTIONS_WITH_NONE = [{ value: '', label: '不开放（仅成员可访问）' }, ...DRIVE_ROLE_OPTIONS];

function MembersModal({ space, onClose }: { readonly space: DriveSpace | null; readonly onClose: () => void }) {
  const query = useDriveSpaceMembers(space?.id, !!space);
  const save = useSaveDriveSpaceMembers();
  const [draft, setDraft] = useState<SubjectGrant[]>([]);
  useEffect(() => { setDraft((query.data ?? []).map((m) => ({ subjectType: m.subjectType, subjectId: m.subjectId, role: m.role, subjectName: m.subjectName }))); }, [query.data]);
  const canEdit = roleAtLeast(space?.myRole, 'manager');
  return (
    <AppModal visible={!!space} title={`成员管理 · ${space?.name ?? ''}`} width={760} closeOnEsc onCancel={onClose}
      footer={canEdit ? undefined : null}
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
  const [searchParams, setSearchParams] = useSearchParams();
  const { page, pageSize, buildPagination, draftParams, setDraftParams, submittedParams, handleSearch, handleReset } =
    useListSearch<SearchParams>({ defaults: { keyword: '', type: undefined }, listKey: driveKeys.spaceLists });
  const listQuery = useDriveSpaceList({ page, pageSize, keyword: submittedParams.keyword || undefined, type: submittedParams.type });
  const save = useSaveDriveSpace();
  const remove = useDeleteDriveSpaces();
  const [membersOf, setMembersOf] = useState<DriveSpace | null>(null);
  const [transferOf, setTransferOf] = useState<DriveSpace | null>(null);
  const [newMembers, setNewMembers] = useState<SubjectGrant[]>([]);

  const modal = useEditModal<DriveSpace, SpaceFormValues, CreateDriveSpaceInput | UpdateDriveSpaceInput>({
    entityName: '协作空间',
    save,
    useDetail: useDriveSpaceDetail,
    defaults: { defaultMemberRole: null, quotaGb: null, maxVersions: null, allowExternalShare: true, status: 'enabled' },
    toValues: (s) => ({
      name: s.name, description: s.description ?? undefined, defaultMemberRole: s.defaultMemberRole,
      quotaGb: s.customQuotaBytes === null ? null : Math.round(s.customQuotaBytes / 1024 ** 3 * 100) / 100,
      maxVersions: s.maxVersions, allowExternalShare: s.allowExternalShare, status: s.status as 'enabled' | 'disabled',
    }),
    beforeSave: (values, ctx) => {
      const payload = {
        ...values,
        description: values.description || undefined,
        defaultMemberRole: (values.defaultMemberRole as DriveRole | '' | null) || null,
        quotaGb: values.quotaGb ?? null,
        maxVersions: values.maxVersions ?? null,
      };
      return ctx.isEdit ? payload : { ...payload, sort: 0, members: newMembers.map(({ subjectType, subjectId, role }) => ({ subjectType, subjectId, role })) };
    },
    onSaved: () => setNewMembers([]),
    labelWidth: 110,
  });

  // 工作台「+」深链：?create=1 打开新建弹窗（消费即焚）
  useEffect(() => {
    if (searchParams.get('create') === '1' && hasPermission('drive:space:create')) {
      modal.openCreate();
      const next = new URLSearchParams(searchParams);
      next.delete('create');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const columns: ColumnProps<DriveSpace>[] = [
    { title: '名称', dataIndex: 'name', minWidth: 200, ellipsis: { showTitle: false },
      render: (v: string, s: DriveSpace) => (
        <Typography.Text link ellipsis={{ showTooltip: true }} onClick={() => navigate(`/drive?space=${s.id}`)}>{v}</Typography.Text>
      ) },
    { title: '类型', dataIndex: 'type', width: 100, render: (v: DriveSpaceType) => <Tag size="small" color={v === 'personal' ? 'grey' : v === 'department' ? 'green' : 'blue'}>{DRIVE_SPACE_TYPE_LABELS[v]}</Tag> },
    { title: '所有者 / 部门', width: 140, render: (_: unknown, s: DriveSpace) => s.ownerName ?? s.departmentName ?? EMPTY_PLACEHOLDER },
    { title: '我的角色', dataIndex: 'myRole', width: 90, render: (v: DriveRole | null | undefined) => (v ? DRIVE_ROLE_LABELS[v] : EMPTY_PLACEHOLDER) },
    { title: '默认成员角色', dataIndex: 'defaultMemberRole', width: 110, render: (v: DriveRole | null) => (v ? DRIVE_ROLE_LABELS[v] : '不开放') },
    { title: '成员', dataIndex: 'memberCount', width: 70, render: (v?: number) => v ?? EMPTY_PLACEHOLDER },
    { title: '用量', width: 200, render: (_: unknown, s: DriveSpace) => {
      const pct = usagePercent(s);
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 12 }}>{formatBytes(s.usedBytes)}{s.quotaBytes ? ` / ${formatBytes(s.quotaBytes)}` : ' · 不限'}</span>
          {pct !== null && <Progress percent={pct} size="small" showInfo={false} stroke={pct >= 90 ? 'var(--semi-color-danger)' : undefined} aria-label={`用量 ${pct}%`} />}
        </div>
      );
    } },
    { title: '状态', dataIndex: 'status', width: 80, render: (v: string) => (v === 'enabled' ? <Tag size="small" color="green">启用</Tag> : <Tag size="small" color="grey">停用</Tag>) },
    dateTimeColumn('创建时间', 'createdAt'),
    createOperationColumn<DriveSpace>({ width: 190, desktopInlineKeys: ['open', 'members'], actions: (s) => {
      const isManager = roleAtLeast(s.myRole, 'manager');
      return [
        { key: 'open', label: '打开', onClick: () => navigate(`/drive?space=${s.id}`) },
        { key: 'members', label: s.type === 'personal' ? '成员' : (isManager ? '成员管理' : '查看成员'), hidden: s.type === 'personal', onClick: () => setMembersOf(s) },
        { key: 'edit', label: '编辑', hidden: s.type !== 'team' || !isManager || !hasPermission('drive:space:edit'), onClick: () => modal.openEdit(s) },
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
            {hasPermission('drive:space:create') && <CreateButton onClick={() => { setNewMembers([]); modal.openCreate(); }}>新建协作空间</CreateButton>}
          </>
        )}
      />
      <ConfigurableTable<DriveSpace> bordered rowKey="id" columns={columns} dataSource={listQuery.data?.list ?? []}
        loading={listQuery.isFetching} onRefresh={() => void listQuery.refetch()} refreshLoading={listQuery.isFetching}
        pagination={buildPagination(listQuery.data?.total ?? 0)} />

      <AppModal {...modal.modalProps} width={640}>
        <Spin spinning={modal.detailLoading}>
          <Form key={modal.formKey} {...modal.formProps}>
            <Form.Input field="name" label="空间名称" rules={[{ required: true, message: '请输入空间名称' }, { max: 100 }]} />
            <Form.TextArea field="description" label="描述" maxCount={300} rows={2} />
            <Form.Select field="defaultMemberRole" label="默认成员角色" optionList={ROLE_OPTIONS_WITH_NONE} style={{ width: '100%' }}
              extraText="为空表示只有下方协作者可访问；设置后全体登录用户按该角色访问" />
            <Form.InputNumber field="quotaGb" label="配额 (GB)" min={0} precision={2} placeholder="留空跟随系统默认" style={{ width: 200 }} />
            <Form.InputNumber field="maxVersions" label="最多版本数" min={1} max={200} placeholder="留空跟随系统默认" style={{ width: 200 }} />
            <Form.Switch field="allowExternalShare" label="允许外链分享" />
            {modal.isEdit && <Form.RadioGroup field="status" label="状态" type="button"><Form.Radio value="enabled">启用</Form.Radio><Form.Radio value="disabled">停用</Form.Radio></Form.RadioGroup>}
          </Form>
          {!modal.isEdit && (
            <div style={{ marginTop: 8 }}>
              <Typography.Title heading={6} style={{ margin: '8px 0' }}>初始协作者</Typography.Title>
              <DriveSubjectPicker value={newMembers} onChange={setNewMembers} emptyText="可稍后在「成员管理」中添加" />
            </div>
          )}
        </Spin>
      </AppModal>

      <MembersModal space={membersOf} onClose={() => setMembersOf(null)} />
      <TransferModal space={transferOf} onClose={() => setTransferOf(null)} />
      {!hasPermission('drive:space:create') && listQuery.data?.total === 0 && (
        <Typography.Text type="tertiary">你还没有加入任何协作空间。</Typography.Text>
      )}
    </div>
  );
}
