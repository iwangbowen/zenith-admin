import { useEffect, useState } from 'react';
import { Form } from '@douyinfe/semi-ui';
import { positionContract, type Position } from '@zenith/shared/identity';
import type { PositionFormValues } from '@/hooks/queries/positions';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { useDictItems } from '@/hooks/useDictItems';
import type { UserTransferUser } from '@/components/UserTransferSelect';
import { usePermission } from '@/hooks/usePermission';
import ExportButton from '@/components/ExportButton';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createdAtColumn, renderEllipsis } from '../../../utils/table-columns';
import { useFlatDepartments } from '@/hooks/queries/departments';
import {
  useAssignPositionMembers,
  useDeletePositions,
  usePositionDetail,
  usePositionList,
  usePositionMembers,
  useSavePosition,
} from '@/hooks/queries/positions';
import { useAllUsers } from '@/hooks/queries/users';
import { useEditModal } from '@/hooks/useEditModal';
import { BatchDeleteButton, CreateButton } from '@/components/toolbar-controls';
import { confirmAndDelete, ListSearchToolbar, useRowSelection, useStatusToggle, useCrudOperationColumn } from '@/components/list-page';
import { MemberAssignmentSheet, memberPreviewColumn } from '@/components/members/MemberAssignmentSheet';
import { useListPage } from '@/hooks/useListPage';
import { EditFormModal } from '@/components/EditFormModal';

export default function PositionsPage() {
  const { hasPermission } = usePermission();
  const { selectedRowKeys, clear: clearSelection, rowSelection } = useRowSelection();
  const page = useListPage({
    contract: positionContract,
    useList: usePositionList,
    table: { empty: '暂无数据', rowSelection },
  });
  const { tableProps, filterQuery } = page;
  const { options: statusOptions } = useDictItems('common_status');

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

  const operationColumn = useCrudOperationColumn<Position>({
    permission: 'system:position',
    edit: (record) => { positionModal.openEdit(record); },
    remove: deleteMutation,
    title: '确定要删除该岗位吗？',
    extraBetween: (record) => [
      {
        key: 'members',
        label: '成员',
        hidden: !hasPermission('system:position:update'),
        onClick: () => { void openMembers(record); },
      },
    ],
    width: 210,
  });

  const columns: ColumnProps<Position>[] = [
    { title: '岗位名称', dataIndex: 'name', minWidth: 200, render: renderEllipsis },
    { title: '岗位编码', dataIndex: 'code', width: 180, render: renderEllipsis },
    { title: '排序', dataIndex: 'sort', width: 90 },
    memberPreviewColumn<Position>({
      dataIndex: 'userPreview',
      width: 180,
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
    operationColumn,
  ];

  return (
    <div className="page-container">
      <ListSearchToolbar
        page={page}
        filters={['keyword', 'status', ['startTime', 'endTime']]}
        create={<CreateButton permission="system:position:create" onClick={positionModal.openCreate} />}
        actions={(
          <>
            <ExportButton entity="system.positions" query={filterQuery} selectedIds={selectedRowKeys} pageIds={tableProps.dataSource?.map(row => row.id)} />
            {selectedRowKeys.length > 0 && hasPermission('system:position:delete') && <BatchDeleteButton count={selectedRowKeys.length} onClick={handleBatchDelete} />}
          </>
        )}
        filterTitle="岗位筛选"
      />

      <ConfigurableTable<Position>
        columns={columns}
        {...tableProps}
      />

      <EditFormModal modal={positionModal} width={520}>
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
      </EditFormModal>

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
