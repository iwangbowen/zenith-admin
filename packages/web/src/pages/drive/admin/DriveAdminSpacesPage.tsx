import { lazy, Suspense, useState } from 'react';
import { Button, Form, Input, InputNumber, Progress, Select, Skeleton, Spin, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { useNavigate } from 'react-router-dom';
import { Building2, Files, HardDrive, Link2, RefreshCcw, Search, Upload } from 'lucide-react';
import { formatBytes } from '@zenith/shared/core';
import {
  DRIVE_ROLE_LABELS, DRIVE_ROLE_OPTIONS, DRIVE_SPACE_TYPE_LABELS, DRIVE_SPACE_TYPE_OPTIONS,
  type AdminUpdateDriveSpaceInput, type CreateDepartmentDriveSpaceInput, type DriveRole, type DriveSpace, type DriveSpaceType,
} from '@zenith/shared/drive';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import DepartmentSelect from '@/components/DepartmentSelect';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';
import { CreateButton, ResetButton, SearchButton } from '@/components/toolbar-controls';
import { StatCard, StatGrid } from '@/components/charts/StatCard';
import UserSelect from '@/components/UserSelect';
import { useEditModal } from '@/hooks/useEditModal';
import { useListSearch } from '@/hooks/useListSearch';
import { usePermission } from '@/hooks/usePermission';
import {
  driveKeys, useAdminDeleteDriveSpace, useAdminUpdateDriveSpace, useCreateDepartmentDriveSpace, useDriveAdminSpaces, useDriveAdminStats, useDriveSpaceDetail, useSubmitDriveAdminTask,
} from '@/hooks/queries/drive';
import { confirmDanger } from '@/utils/confirm';
import { dateTimeColumn, EMPTY_PLACEHOLDER } from '@/utils/table-columns';
import { usagePercent } from '../drive-utils';
import '../drive.css';

const DriveAdminCharts = lazy(() => import('./DriveAdminCharts'));

interface SearchParams {
  keyword: string;
  type: DriveSpaceType | undefined;
  status: 'enabled' | 'disabled' | undefined;
}

interface AdminSpaceFormValues {
  name: string;
  description?: string | null;
  quotaGb: number | null;
  maxVersions: number | null;
  allowExternalShare: boolean;
  defaultMemberRole: DriveRole | '' | null;
  status: 'enabled' | 'disabled';
  ownerId?: number;
}

const STATUS_OPTIONS = [{ value: 'enabled', label: '启用' }, { value: 'disabled', label: '停用' }] as const;
const ROLE_OPTIONS_WITH_NONE = [{ value: '', label: '不开放' }, ...DRIVE_ROLE_OPTIONS];

function DepartmentSpaceModal({ visible, onClose }: { readonly visible: boolean; readonly onClose: () => void }) {
  const create = useCreateDepartmentDriveSpace();
  const [values, setValues] = useState<{ departmentId?: number; name?: string; defaultMemberRole: DriveRole | ''; quotaGb: number | null }>({ defaultMemberRole: 'editor', quotaGb: null });
  return (
    <AppModal visible={visible} title="为部门创建空间" width={520} closeOnEsc onCancel={onClose} okText="创建"
      okButtonProps={{ loading: create.isPending, disabled: !values.departmentId }}
      onOk={async () => {
        if (!values.departmentId) return;
        const payload: CreateDepartmentDriveSpaceInput = {
          departmentId: values.departmentId, name: values.name?.trim() || undefined,
          defaultMemberRole: values.defaultMemberRole || null, quotaGb: values.quotaGb,
        };
        await create.mutateAsync({ body: payload });
        Toast.success('部门空间已创建');
        setValues({ defaultMemberRole: 'editor', quotaGb: null });
        onClose();
      }}>
      <Form labelPosition="left" labelWidth={100}>
        <Form.Slot label="部门">
          <DepartmentSelect value={values.departmentId} onChange={(v) => setValues((p) => ({ ...p, departmentId: typeof v === 'number' ? v : undefined }))} placeholder="选择部门" style={{ width: '100%' }} />
        </Form.Slot>
        <Form.Slot label="空间名称">
          <Input placeholder="留空则使用「部门名 空间」" value={values.name} onChange={(v) => setValues((p) => ({ ...p, name: v }))} maxLength={100} />
        </Form.Slot>
        <Form.Slot label="默认成员角色">
          <Select optionList={ROLE_OPTIONS_WITH_NONE} value={values.defaultMemberRole} onChange={(v) => setValues((p) => ({ ...p, defaultMemberRole: (v as DriveRole | '') ?? '' }))} style={{ width: '100%' }} />
        </Form.Slot>
        <Form.Slot label="配额 (GB)">
          <InputNumber min={0} precision={2} placeholder="留空跟随系统默认" value={values.quotaGb ?? undefined} onChange={(v) => setValues((p) => ({ ...p, quotaGb: typeof v === 'number' ? v : null }))} style={{ width: 200 }} />
        </Form.Slot>
      </Form>
    </AppModal>
  );
}

export default function DriveAdminSpacesPage() {
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const canEdit = hasPermission('drive:admin:space:edit');
  const statsQuery = useDriveAdminStats();
  const { page, pageSize, buildPagination, draftParams, setDraftParams, submittedParams, handleSearch, handleReset } =
    useListSearch<SearchParams>({ defaults: { keyword: '', type: undefined, status: undefined }, listKey: driveKeys.adminSpacesPrefix, extraKeys: [driveKeys.adminStats] });
  const listQuery = useDriveAdminSpaces({ page, pageSize, keyword: submittedParams.keyword || undefined, type: submittedParams.type, status: submittedParams.status });
  const update = useAdminUpdateDriveSpace();
  const remove = useAdminDeleteDriveSpace();
  const submitTask = useSubmitDriveAdminTask();
  const [deptModal, setDeptModal] = useState(false);

  const modal = useEditModal<DriveSpace, AdminSpaceFormValues, AdminUpdateDriveSpaceInput>({
    entityName: '空间',
    save: { mutateAsync: ({ id, values }) => update.mutateAsync({ params: { id: id! }, body: values }), isPending: update.isPending },
    useDetail: useDriveSpaceDetail,
    toValues: (s) => ({
      name: s.name, description: s.description, quotaGb: s.customQuotaBytes === null ? null : Math.round(s.customQuotaBytes / 1024 ** 3 * 100) / 100,
      maxVersions: s.maxVersions, allowExternalShare: s.allowExternalShare, defaultMemberRole: s.defaultMemberRole ?? '', status: s.status as 'enabled' | 'disabled', ownerId: s.ownerId ?? undefined,
    }),
    beforeSave: (values, ctx) => ({
      name: values.name, description: values.description || null, quotaGb: values.quotaGb ?? null, maxVersions: values.maxVersions ?? null,
      allowExternalShare: values.allowExternalShare, status: values.status,
      defaultMemberRole: ctx.editing?.type === 'personal' ? undefined : (values.defaultMemberRole || null),
      ownerId: ctx.editing?.type === 'team' ? values.ownerId : undefined,
    }),
    labelWidth: 110,
  });

  const runTask = (kind: 'recalc' | 'reindex', spaceId?: number) => {
    submitTask.mutate({ kind, spaceId }, { onSuccess: () => Toast.info(kind === 'recalc' ? '容量重算任务已提交，完成后会通知你' : '索引补建任务已提交，完成后会通知你') });
  };

  const stats = statsQuery.data;
  const columns: ColumnProps<DriveSpace>[] = [
    { title: '名称', dataIndex: 'name', minWidth: 200, ellipsis: { showTitle: false },
      render: (v: string, s: DriveSpace) => <Typography.Text link ellipsis={{ showTooltip: true }} onClick={() => navigate(`/drive?space=${s.id}`)}>{v}</Typography.Text> },
    { title: '类型', dataIndex: 'type', width: 100, render: (v: DriveSpaceType) => <Tag size="small" color={v === 'personal' ? 'grey' : v === 'department' ? 'green' : 'blue'}>{DRIVE_SPACE_TYPE_LABELS[v]}</Tag> },
    { title: '所有者 / 部门', width: 150, render: (_: unknown, s: DriveSpace) => s.ownerName ?? s.departmentName ?? EMPTY_PLACEHOLDER },
    { title: '默认成员角色', dataIndex: 'defaultMemberRole', width: 110, render: (v: DriveRole | null) => (v ? DRIVE_ROLE_LABELS[v] : '不开放') },
    { title: '成员 / 节点', width: 100, render: (_: unknown, s: DriveSpace) => `${s.memberCount ?? 0} / ${s.nodeCount ?? 0}` },
    { title: '用量', width: 210, render: (_: unknown, s: DriveSpace) => {
      const pct = usagePercent(s);
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 12 }}>{formatBytes(s.usedBytes)}{s.quotaBytes ? ` / ${formatBytes(s.quotaBytes)}` : ' · 不限'}{s.customQuotaBytes !== null && <Typography.Text type="tertiary" size="small">（自定义）</Typography.Text>}</span>
          {pct !== null && <Progress percent={pct} size="small" showInfo={false} stroke={pct >= 90 ? 'var(--semi-color-danger)' : undefined} aria-label={`用量 ${pct}%`} />}
        </div>
      );
    } },
    { title: '外链', dataIndex: 'allowExternalShare', width: 70, render: (v: boolean) => (v ? '允许' : '禁止') },
    { title: '状态', dataIndex: 'status', width: 80, render: (v: string) => (v === 'enabled' ? <Tag size="small" color="green">启用</Tag> : <Tag size="small" color="grey">停用</Tag>) },
    dateTimeColumn('创建时间', 'createdAt'),
    createOperationColumn<DriveSpace>({ width: 190, desktopInlineKeys: ['open', 'edit'], actions: (s) => [
      { key: 'open', label: '打开', onClick: () => navigate(`/drive?space=${s.id}`) },
      { key: 'edit', label: '编辑', hidden: !canEdit, onClick: () => modal.openEdit(s) },
      { key: 'recalc', label: '重算容量', hidden: !canEdit, onClick: () => runTask('recalc', s.id) },
      { key: 'reindex', label: '补建索引', hidden: !canEdit, onClick: () => runTask('reindex', s.id) },
      { key: 'delete', label: '删除', danger: true, dividerBefore: true, hidden: !hasPermission('drive:admin:space:delete') || s.type === 'personal',
        onClick: () => { confirmDanger({ title: `删除空间「${s.name}」？`, content: '空间内全部文件将进入回收站，并在保留期后彻底清除。', okText: '删除',
          onOk: () => remove.mutateAsync({ params: { id: s.id } }).then(() => Toast.success('已删除')) }); } },
    ] }),
  ];

  return (
    <div className="page-container">
      {stats ? (
        <StatGrid>
          <StatCard title="空间总数" value={stats.spaceCount} icon={<Building2 />} sub={`个人 ${stats.spaceCountByType.personal} · 部门 ${stats.spaceCountByType.department} · 协作 ${stats.spaceCountByType.team}`} />
          <StatCard title="文件 / 文件夹" value={`${stats.fileCount} / ${stats.folderCount}`} icon={<Files />} />
          <StatCard title="总占用" value={formatBytes(stats.totalBytes)} icon={<HardDrive />} sub={`回收站 ${formatBytes(stats.recycleBytes)} · 历史版本 ${formatBytes(stats.versionBytes)}`} />
          <StatCard title="今日上传 / 下载" value={`${stats.todayUploads} / ${stats.todayDownloads}`} icon={<Upload />} />
          <StatCard title="有效外链" value={stats.activeShareLinks} icon={<Link2 />} onClick={() => navigate('/drive/admin/share-links')} />
        </StatGrid>
      ) : <Skeleton active loading placeholder={<Skeleton.Paragraph rows={2} />} />}
      {stats && (
        <Suspense fallback={<Skeleton active loading placeholder={<Skeleton.Paragraph rows={5} />} />}>
          <DriveAdminCharts stats={stats} />
        </Suspense>
      )}
      <SearchToolbar
        filters={(
          <>
            <KeywordInput value={draftParams.keyword} placeholder="搜索空间 / 所有者" onChange={(v) => setDraftParams((p) => ({ ...p, keyword: v }))} onSearch={handleSearch} />
            <FilterSelect<DriveSpaceType> value={draftParams.type} placeholder="全部类型" items={DRIVE_SPACE_TYPE_OPTIONS} onChange={(v) => setDraftParams((p) => ({ ...p, type: v }))} />
            <StatusSelect<'enabled' | 'disabled'> value={draftParams.status} items={STATUS_OPTIONS} onChange={(v) => setDraftParams((p) => ({ ...p, status: v }))} />
          </>
        )}
        actions={(
          <>
            <SearchButton onClick={handleSearch} />
            <ResetButton onClick={handleReset} />
            {canEdit && <CreateButton onClick={() => setDeptModal(true)}>创建部门空间</CreateButton>}
            {canEdit && <Button icon={<RefreshCcw size={14} />} onClick={() => runTask('recalc')} loading={submitTask.isPending}>全量重算容量</Button>}
            {canEdit && <Button icon={<Search size={14} />} onClick={() => runTask('reindex')} loading={submitTask.isPending}>补建全文索引</Button>}
          </>
        )}
      />
      <ConfigurableTable<DriveSpace> bordered rowKey="id" columns={columns} dataSource={listQuery.data?.list ?? []}
        loading={listQuery.isFetching} onRefresh={() => { void listQuery.refetch(); void statsQuery.refetch(); }} refreshLoading={listQuery.isFetching}
        pagination={buildPagination(listQuery.data?.total ?? 0)} />

      <AppModal {...modal.modalProps} width={600}>
        <Spin spinning={modal.detailLoading}>
          <Form key={modal.formKey} {...modal.formProps}>
            <Form.Input field="name" label="空间名称" rules={[{ required: true, message: '请输入空间名称' }, { max: 100 }]} />
            <Form.TextArea field="description" label="描述" maxCount={300} rows={2} />
            <Form.InputNumber field="quotaGb" label="配额 (GB)" min={0} precision={2} placeholder="留空跟随系统默认" style={{ width: 200 }} extraText="0 表示不限" />
            <Form.InputNumber field="maxVersions" label="最多版本数" min={1} max={200} placeholder="留空跟随系统默认" style={{ width: 200 }} />
            <Form.Switch field="allowExternalShare" label="允许外链分享" />
            {modal.editing?.type !== 'personal' && <Form.Select field="defaultMemberRole" label="默认成员角色" optionList={ROLE_OPTIONS_WITH_NONE} style={{ width: '100%' }} />}
            {modal.editing?.type === 'team' && (
              <Form.Slot label="所有者">
                <UserSelect value={modal.formApi.current?.getValue('ownerId') as number | undefined} onChange={(v) => modal.formApi.current?.setValue('ownerId', typeof v === 'number' ? v : undefined)} style={{ width: '100%' }} />
              </Form.Slot>
            )}
            <Form.RadioGroup field="status" label="状态" type="button"><Form.Radio value="enabled">启用</Form.Radio><Form.Radio value="disabled">停用</Form.Radio></Form.RadioGroup>
          </Form>
        </Spin>
      </AppModal>
      <DepartmentSpaceModal visible={deptModal} onClose={() => setDeptModal(false)} />
    </div>
  );
}
