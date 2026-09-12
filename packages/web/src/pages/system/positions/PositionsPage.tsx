import { useEffect, useState, useMemo } from 'react';
import { Form, Spin } from '@douyinfe/semi-ui';
import type { Position } from '@zenith/shared/identity';
import { USER_STATUSES, enumValueOf } from '@zenith/shared/core';
import type { PositionFormValues } from '@/hooks/queries/positions';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { useDictItems } from '@/hooks/useDictItems';
import type { UserTransferUser } from '@/components/UserTransferSelect';
import { formatDateTimeRangeForApi } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import ExportButton from '@/components/ExportButton';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { createdAtColumn, renderEllipsis } from '../../../utils/table-columns';
import { useFlatDepartments } from '@/hooks/queries/departments';
import {
  useAssignPositionMembers,
  useDeletePositions,
  positionKeys,
  usePositionDetail,
  usePositionList,
  usePositionMembers,
  useSavePosition,
} from '@/hooks/queries/positions';
import { useAllUsers } from '@/hooks/queries/users';
import { useEditModal } from '@/hooks/useEditModal';
import { useListSearch } from '@/hooks/useListSearch';
import { BatchDeleteButton, CreateButton } from '@/components/toolbar-controls';
import { DateRangeFilter, KeywordInput, StatusSelect } from '@/components/search-filters';
import { confirmAndDelete, deleteAction, ListSearchToolbar, listTableProps, useRowSelection, useStatusToggle } from '@/components/list-page';
import { MemberAssignmentSheet, memberPreviewColumn } from '@/components/members/MemberAssignmentSheet';
import { compactParams } from '@/lib/query';

interface SearchParams {
  keyword: string;
  status?: string;
  timeRange: [Date, Date] | null;
}

const defaultSearchParams: SearchParams = {
  keyword: '',
  status: undefined,
  timeRange: null,
};

export default function PositionsPage() {
  const { hasPermission } = usePermission();
  const {
    page, pageSize, buildPagination,
    bind, bindKeyword, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: positionKeys.lists });
  // 已提交筛选 → 契约查询参数：列表与导出共用同一份映射
  const filterQuery = useMemo(() => compactParams({
    keyword: submittedParams.keyword,
    status: enumValueOf(USER_STATUSES, submittedParams.status),
    ...formatDateTimeRangeForApi(submittedParams.timeRange),
  }), [submittedParams]);
  const listQuery = usePositionList({ page, pageSize, ...filterQuery });
  const { selectedRowKeys, clear: clearSelection, rowSelection } = useRowSelection();
  const { items: statusItems, options: statusOptions } = useDictItems('common_status');

  // 成员管理
  const allUsersQuery = useAllUsers();
  const departmentsQuery = useFlatDepartments();
  const allUsers: UserTransferUser[] = allUsersQuery.data ?? [];
  const departments = departmentsQuery.data ?? [];
  const [memberSheetVisible, setMemberSheetVisible] = useState(false);
  const [memberPosition, setMemberPosition] = useState<Position | null>(null);
  const [memberIds, setMemberIds] = useState<number[]>([]);
  const membersQuery = usePositionMembers(memberPosition?.id, memberSheetVisible);
  const saveMutation = useSavePosition();
  const positionModal = useEditModal<Position, PositionFormValues>({
    entityName: '岗位',
    save: saveMutation,
    useDetail: usePositionDetail,
    defaults: { sort: 0, status: 'enabled' },
    toValues: (position) => ({
      name: position.name,
      code: position.code,
      sort: position.sort,
      status: position.status,
      // 记录里的 null 备注在表单中视为未填
      remark: position.remark ?? undefined,
    }),
  });
  const toggleStatusMutation = useSavePosition();
  const deleteMutation = useDeletePositions();
  const assignMembersMutation = useAssignPositionMembers();
  const status = useStatusToggle<Position>({
    toggle: (pos, enabled) => toggleStatusMutation.mutateAsync({ id: pos.id, values: { status: enabled ? 'enabled' : 'disabled' } }),
    confirmDisable: (pos) => ({ danger: true, title: `确认停用岗位「${pos.name}」？`, content: '停用后该岗位将不可选择。', okText: '确认停用' }),
    disabled: !hasPermission('system:position:update'),
  });

  useEffect(() => {
    if (memberSheetVisible) setMemberIds((membersQuery.data ?? []).map((m) => m.id));
  }, [memberSheetVisible, membersQuery.data]);

  const handleBatchDelete = () => {
    if (!selectedRowKeys.length) return;
    confirmAndDelete({
      title: `确认删除选中的 ${selectedRowKeys.length} 个岗位？`,
      content: '删除后无法恢复，请确认操作',
      run: () => deleteMutation.mutateAsync(selectedRowKeys),
      onDeleted: clearSelection,
    });
  };

  const openMembers = (pos: Position) => {
    setMemberPosition(pos);
    setMemberSheetVisible(true);
  };

  const handleSaveMembers = async () => {
    if (!memberPosition) return;
    await assignMembersMutation.mutateAsync({ params: { id: memberPosition.id }, body: { userIds: memberIds } });
    setMemberSheetVisible(false);
  };

  const columns: ColumnProps<Position>[] = [
    { title: '岗位名称', dataIndex: 'name', minWidth: 200, render: renderEllipsis },
    { title: '岗位编码', dataIndex: 'code', width: 180, render: renderEllipsis },
    { title: '排序', dataIndex: 'sort', width: 90 },
    memberPreviewColumn<Position>({
      dataIndex: 'userPreview',
      width: 150,
      getPreview: (record) => record.userPreview,
      getCount: (record) => record.userCount,
      getScope: (record) => ({ type: 'position', id: record.id, name: record.name }),
    }),
    {
      title: '备注',
      dataIndex: 'remark',
      width: 200,
      render: renderEllipsis,
    },
    createdAtColumn,
    status.column(),
    createOperationColumn<Position>({
      width: 210,
      actions: (record) => [
        {
          key: 'edit',
          label: '编辑',
          hidden: !hasPermission('system:position:update'),
          onClick: () => { positionModal.openEdit(record); },
        },
        {
          key: 'members',
          label: '成员',
          hidden: !hasPermission('system:position:update'),
          onClick: () => { void openMembers(record); },
        },
        deleteAction({
          hidden: !hasPermission('system:position:delete'),
          title: '确定要删除该岗位吗？',
          run: () => deleteMutation.mutateAsync([record.id]),
        }),
      ],
    }),
  ];


  return (
    <div className="page-container">
      <ListSearchToolbar
        keyword={<KeywordInput placeholder="搜索岗位名称/编码" {...bindKeyword('keyword')} width={240} />}
        filters={(
          <>
            <StatusSelect
              items={statusItems}
              {...bind('status')}
            />
            <DateRangeFilter {...bind('timeRange')} />
          </>
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        create={(
          hasPermission('system:position:create') ? (
            <CreateButton onClick={positionModal.openCreate} />
          ) : null
        )}
        actions={(
          <>
            <ExportButton entity="system.positions" query={filterQuery} />
            {selectedRowKeys.length > 0 && hasPermission('system:position:delete') && <BatchDeleteButton count={selectedRowKeys.length} onClick={handleBatchDelete} />}
          </>
        )}
        mobileActions={(
          <>
            <ExportButton entity="system.positions" query={filterQuery} variant="flat" />
            {selectedRowKeys.length > 0 && hasPermission('system:position:delete') && <BatchDeleteButton count={selectedRowKeys.length} onClick={handleBatchDelete} />}
          </>
        )}
        filterTitle="岗位筛选"
      />

      <ConfigurableTable<Position>
        columns={columns}
        {...listTableProps(listQuery, {
          pagination: buildPagination,
          empty: '暂无数据',
          rowSelection,
        })}
      />

      <AppModal {...positionModal.modalProps} width={520}>
        <Spin spinning={positionModal.detailLoading} wrapperClassName="modal-spin-wrapper">
        <Form key={positionModal.formKey} {...positionModal.formProps}>
          <Form.Input field="name" label="岗位名称" placeholder="请输入岗位名称" rules={[{ required: true, message: '请输入岗位名称' }]} />
          <Form.Input field="code" label="岗位编码" placeholder="请输入岗位编码" rules={[{ required: true, message: '请输入岗位编码' }]} />
          <Form.InputNumber field="sort" label="排序" placeholder="请输入排序" min={0} style={{ width: '100%' }} />
          <Form.Select
            field="status"
            label="状态"
            optionList={statusOptions}
            style={{ width: '100%' }}
            placeholder="请选择状态"
          />
          <Form.TextArea field="remark" label="备注" placeholder="请输入备注" maxCount={256} />
        </Form>
        </Spin>
      </AppModal>

      <MemberAssignmentSheet
        title={`成员管理 - ${memberPosition?.name ?? ''}`}
        visible={memberSheetVisible}
        onCancel={() => setMemberSheetVisible(false)}
        users={allUsers}
        value={memberIds}
        onChange={setMemberIds}
        departments={departments}
        canSave={membersQuery.isSuccess}
        saveLoading={assignMembersMutation.isPending}
        onSave={handleSaveMembers}
      />
    </div>
  );
}
