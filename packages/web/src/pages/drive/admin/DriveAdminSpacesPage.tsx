import { lazy, Suspense, useState } from 'react';
import { listTableProps } from '@/components/list-page';
import { Button, Checkbox, Form, Input, InputNumber, Select, Skeleton, Space, Spin, Tag, Toast, Typography, withField } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { useNavigate } from 'react-router-dom';
import { Building2, Files, HardDrive, Link2, RefreshCcw, Search, Upload } from 'lucide-react';
import { formatBytes } from '@zenith/shared/core';
import {
  DRIVE_ROLE_OPTIONS, DRIVE_SPACE_TYPE_OPTIONS, DRIVE_HANDOFF_MODE_OPTIONS, handoffDriveSpaceSchema, isOrphanedDriveSpace,
  type HandoffDriveSpaceInput, type AdminUpdateDriveSpaceInput, type CreateDepartmentDriveSpaceInput, type DriveRole, type DriveSpace, type DriveSpaceType,
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
import { confirmDanger, confirmDangerAsync } from '@/utils/confirm';
import { abortSubmit } from '@/lib/abort-submit';
import { useHandoffDriveSpace } from '@/hooks/queries/drive-collaboration';
import { EMPTY_PLACEHOLDER } from '@/utils/table-columns';
import { driveSpaceDefaultRoleColumn, driveSpaceNameColumn, driveSpaceOwnerColumn, driveSpaceTypeColumn, driveSpaceUsageColumn } from '../drive-space-columns';
import { FormStatusRadioGroup } from '@/components/FormStatusRadioGroup';
import '../drive.css';

const DriveAdminCharts = lazy(() => import('./DriveAdminCharts'));
/** 所有者作为受控表单字段（原先直读 formApi 不触发重渲染，选择后不回显） */
const FormUserSelect = withField(UserSelect);

interface SearchParams {
  keyword: string;
  type: DriveSpaceType | undefined;
  status: 'enabled' | 'disabled' | undefined;
  orphaned: boolean;
  archived: boolean;
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
  const { page, pageSize, buildPagination, draftParams, setField, bind, bindKeyword, submittedParams, handleSearch, handleReset } =
    useListSearch<SearchParams>({ defaults: { keyword: '', type: undefined, status: undefined, orphaned: false, archived: false }, listKey: driveKeys.adminSpacesPrefix, extraKeys: [driveKeys.adminStats] });
  const listQuery = useDriveAdminSpaces({
    page, pageSize, keyword: submittedParams.keyword || undefined, type: submittedParams.type, status: submittedParams.status,
    orphaned: submittedParams.orphaned, archived: submittedParams.archived || undefined,
  });
  const update = useAdminUpdateDriveSpace();
  const remove = useAdminDeleteDriveSpace();
  const submitTask = useSubmitDriveAdminTask();
  const [deptModal, setDeptModal] = useState(false);
  const handoffMutation = useHandoffDriveSpace();
  const handoff = useEditModal<DriveSpace, Partial<HandoffDriveSpaceInput>, HandoffDriveSpaceInput>({
    entityName: '空间交接',
    save: { isPending: handoffMutation.isPending, mutateAsync: ({ id, values }) => handoffMutation.mutateAsync({ params: { id: id! }, body: values }) },
    toValues: () => ({ mode: 'merge' }),
    beforeSave: async (values) => {
      const parsed = handoffDriveSpaceSchema.safeParse(values);
      if (!parsed.success) { Toast.warning('请选择接收人与交接方式'); return abortSubmit(); }
      if (!await confirmDangerAsync({ title: '确认交接整个空间？', content: '源空间将移除，全部版本、评论和回收站项目移入目标；原直接授权和外链失效。', okText: '确认交接' })) return abortSubmit();
      return parsed.data;
    },
  });

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
  // 页面宽约 1190px：创建时间 / 外链开关移出列表（外链关闭以标签提示，编辑弹窗可改），保证名称列可读且无横向滚动
  const columns: ColumnProps<DriveSpace>[] = [
    driveSpaceNameColumn(navigate),
    driveSpaceTypeColumn,
    driveSpaceOwnerColumn({ orphanTag: true }),
    driveSpaceDefaultRoleColumn,
    { title: '成员 / 节点', width: 110, render: (_: unknown, s: DriveSpace) => <span className="drive-nowrap">{`${s.memberCount ?? 0} / ${s.nodeCount ?? 0}`}</span> },
    driveSpaceUsageColumn({ width: 200, customQuotaMark: true }),
    { title: '趋势（30 天）', width: 150, render: (_: unknown, s: DriveSpace) => {
      if (s.dailyGrowthBytes === null || s.dailyGrowthBytes === undefined) return EMPTY_PLACEHOLDER;
      const urgent = s.daysUntilFull !== null && s.daysUntilFull !== undefined && s.daysUntilFull <= 30;
      return (
        <div className="drive-nowrap" style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span>日增 {s.dailyGrowthBytes > 0 ? formatBytes(s.dailyGrowthBytes) : '0 B'}</span>
          {s.daysUntilFull !== null && s.daysUntilFull !== undefined && (
            <Typography.Text type={urgent ? 'danger' : 'tertiary'} size="small">预计 {s.daysUntilFull} 天用满</Typography.Text>
          )}
        </div>
      );
    } },
    { title: '状态', dataIndex: 'status', width: 130, fixed: 'right', render: (v: string, s: DriveSpace) => (
      <Space spacing={4} className="drive-nowrap">
        {s.archivedAt ? <Tag size="small" color="grey">已归档</Tag> : v === 'enabled' ? <Tag size="small" color="green">启用</Tag> : <Tag size="small" color="grey">停用</Tag>}
        {!s.allowExternalShare && <Tag size="small" color="orange">禁外链</Tag>}
      </Space>
    ) },
    createOperationColumn<DriveSpace>({ width: 180, desktopInlineKeys: ['open', 'edit'], actions: (s) => [
      { key: 'open', label: '打开', onClick: () => navigate(`/drive?space=${s.id}`) },
      { key: 'edit', label: '编辑', hidden: !canEdit, onClick: () => modal.openEdit(s) },
      { key: 'handoff', label: '交接空间', hidden: !canEdit || (s.type !== 'personal' && !isOrphanedDriveSpace(s)), onClick: () => handoff.openEdit(s) },
      { key: 'recalc', label: '重算容量', hidden: !canEdit, onClick: () => runTask('recalc', s.id) },
      { key: 'reindex', label: '补建索引', hidden: !canEdit, onClick: () => runTask('reindex', s.id) },
      { key: 'delete', label: '删除', danger: true, dividerBefore: true, hidden: !hasPermission('drive:admin:space:delete') || s.type === 'personal',
        onClick: () => { confirmDanger({ title: `删除空间「${s.name}」？`, content: '空间内全部文件将进入回收站，并在保留期后彻底清除。', okText: '删除',
          onOk: () => remove.mutateAsync({ params: { id: s.id } }).then(() => Toast.success('已删除')) }); } },
    ] }),
  ];

  return (
    <div className="page-container zx-flat-panels">
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
            <KeywordInput {...bindKeyword('keyword')} placeholder="搜索空间 / 所有者" />
            <FilterSelect<DriveSpaceType> {...bind('type')} placeholder="全部类型" items={DRIVE_SPACE_TYPE_OPTIONS} />
            <StatusSelect<'enabled' | 'disabled'> {...bind('status')} items={STATUS_OPTIONS} />
            <Checkbox checked={draftParams.orphaned} onChange={(event) => setField('orphaned')(!!event.target.checked)}>仅待接管</Checkbox>
            <Checkbox checked={draftParams.archived} onChange={(event) => setField('archived')(!!event.target.checked)}>仅已归档</Checkbox>
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
      <ConfigurableTable<DriveSpace> columns={columns}
        {...listTableProps(listQuery, { pagination: buildPagination })}
      />

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
              <FormUserSelect field="ownerId" label="所有者" style={{ width: '100%' }} placeholder="选择所有者" />
            )}
            <FormStatusRadioGroup type="button" />
          </Form>
        </Spin>
      </AppModal>
      <DepartmentSpaceModal visible={deptModal} onClose={() => setDeptModal(false)} />
      <AppModal {...handoff.modalProps} title="交接空间" width={560}>
        <Form key={handoff.formKey} {...handoff.formProps}>
          <FormUserSelect field="recipientId" label="接收人" rules={[{ required: true }]} />
          <Form.Select field="mode" label="交接方式" optionList={DRIVE_HANDOFF_MODE_OPTIONS} style={{ width: '100%' }} />
          <Form.Input field="name" label="新空间名称" maxLength={100} placeholder="可选，仅新建空间时使用" />
        </Form>
      </AppModal>
    </div>
  );
}
