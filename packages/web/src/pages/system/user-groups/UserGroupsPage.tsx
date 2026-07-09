import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Toast,
  SideSheet,
  Empty,
  Tag,
  Row,
  Col,
  Spin,
  Switch,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, Plus, RotateCcw, Trash2, Users } from 'lucide-react';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { TreeNodeData } from '@douyinfe/semi-ui/lib/es/tree';
import type { User, UserGroup } from '@zenith/shared';
import { usePermission } from '@/hooks/usePermission';
import { UserTransferSelect } from '@/components/UserTransferSelect';
import type { UserTransferUser } from '@/components/UserTransferSelect';
import { SearchToolbar } from '@/components/SearchToolbar';
import { UserPreviewCell } from '@/components/UserPreviewCell';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { createdAtColumn, renderEllipsis } from '../../../utils/table-columns';
import { usePagination } from '@/hooks/usePagination';
import { useFlatDepartments } from '@/hooks/queries/departments';
import {
  useAssignUserGroupMembers,
  useAssignUserGroupRoles,
  useDeleteUserGroups,
  useSaveUserGroup,
  userGroupKeys,
  useUserGroupDetail,
  useUserGroupList,
  useUserGroupMembers,
  useUserGroupRoles,
} from '@/hooks/queries/user-groups';
import { useAllUsers } from '@/hooks/queries/users';
import { useAllRoles } from '@/hooks/queries/roles';
import { useDictItems } from '@/hooks/useDictItems';

interface SearchParams {
  keyword: string;
  status: string;
}

type SimpleUser = UserTransferUser & {
  email?: string | null;
  departmentId?: number | null;
};

const defaultSearchParams: SearchParams = { keyword: '', status: '' };

export default function UserGroupsPage() {
  const { items: statusItems } = useDictItems('common_status');
  const { hasPermission } = usePermission();
  const queryClient = useQueryClient();
  const formApi = useRef<FormApi | null>(null);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftParams, setDraftParams] = useState<SearchParams>(defaultSearchParams);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearchParams);
  const listQuery = useUserGroupList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    status: submittedParams.status || undefined,
  });
  const data = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const [modalVisible, setModalVisible] = useState(false);
  const [editingRecord, setEditingRecord] = useState<UserGroup | null>(null);
  const detailQuery = useUserGroupDetail(editingRecord?.id, modalVisible);
  const editing = editingRecord ? (detailQuery.data ?? editingRecord) : null;
  const modalDetailLoading = !!editingRecord && detailQuery.isFetching;
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);

  // 选项数据
  const allUsersQuery = useAllUsers();
  const departmentsQuery = useFlatDepartments();
  const allUsers: SimpleUser[] = (allUsersQuery.data ?? []).map((u: User) => ({
    id: u.id,
    username: u.username,
    nickname: u.nickname,
    avatar: u.avatar,
    email: u.email,
    departmentId: u.departmentId,
    departmentName: u.departmentName,
  }));
  const departments = useMemo(() => departmentsQuery.data ?? [], [departmentsQuery.data]);

  // 成员管理
  const [memberSheetVisible, setMemberSheetVisible] = useState(false);
  const [memberGroup, setMemberGroup] = useState<UserGroup | null>(null);
  const [memberIds, setMemberIds] = useState<number[]>([]);
  const membersQuery = useUserGroupMembers(memberGroup?.id, memberSheetVisible);
  // 角色分配
  const [roleModalVisible, setRoleModalVisible] = useState(false);
  const [roleGroup, setRoleGroup] = useState<UserGroup | null>(null);
  const [roleIds, setRoleIds] = useState<number[]>([]);
  const groupRolesQuery = useUserGroupRoles(roleGroup?.id, roleModalVisible);
  const allRolesQuery = useAllRoles({ enabled: roleModalVisible });
  const saveMutation = useSaveUserGroup();
  const toggleStatusMutation = useSaveUserGroup();
  const deleteMutation = useDeleteUserGroups();
  const assignMembersMutation = useAssignUserGroupMembers();
  const assignRolesMutation = useAssignUserGroupRoles();
  const togglingStatusId = toggleStatusMutation.isPending ? (toggleStatusMutation.variables?.id ?? null) : null;

  const departmentTreeData = useMemo<TreeNodeData[]>(() => {
    const nodeMap = new Map<number, TreeNodeData>();
    const rootNodes: TreeNodeData[] = [];

    departments.forEach((item) => {
      nodeMap.set(item.id, {
        key: String(item.id),
        value: item.id,
        label: item.name,
        children: [],
      });
    });

    departments.forEach((item) => {
      const currentNode = nodeMap.get(item.id);
      if (!currentNode) return;

      const parentNode = item.parentId ? nodeMap.get(item.parentId) : undefined;
      if (parentNode) {
        parentNode.children = [...(parentNode.children ?? []), currentNode];
        return;
      }

      rootNodes.push(currentNode);
    });

    return rootNodes;
  }, [departments]);

  useEffect(() => {
    if (memberSheetVisible) setMemberIds((membersQuery.data ?? []).map((m) => m.id));
  }, [memberSheetVisible, membersQuery.data]);

  useEffect(() => {
    if (roleModalVisible) setRoleIds((groupRolesQuery.data ?? []).map((r) => r.id));
  }, [roleModalVisible, groupRolesQuery.data]);

  const handleSearch = () => {
    setPage(1);
    setSubmittedParams(draftParams);
    void queryClient.invalidateQueries({ queryKey: userGroupKeys.lists });
  };
  const handleReset = () => {
    setPage(1);
    setDraftParams(defaultSearchParams);
    setSubmittedParams(defaultSearchParams);
    void queryClient.invalidateQueries({ queryKey: userGroupKeys.lists });
  };

  const handleModalOk = async () => {
    let values;
    try {
      values = await formApi.current!.validate();
    } catch {
      throw new Error('validation');
    }
    await saveMutation.mutateAsync({ id: editingRecord?.id, values });
    Toast.success(editingRecord ? '更新成功' : '创建成功');
    setModalVisible(false);
    setEditingRecord(null);
  };

  const handleDelete = async (id: number) => {
    await deleteMutation.mutateAsync([id]);
    Toast.success('删除成功');
  };

  const handleToggleStatus = async (group: UserGroup, newStatus: 'enabled' | 'disabled') => {
    if (newStatus === 'disabled') {
      const confirmed = await new Promise<boolean>((resolve) => {
        Modal.confirm({
          title: `确认禁用用户组「${group.name}」？`,
          content: '禁用后该用户组将不可选择。',
          okButtonProps: { type: 'danger', theme: 'solid' },
          okText: '确认禁用',
          cancelText: '取消',
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });
      if (!confirmed) return;
    }
    toggleStatusMutation.mutate(
      { id: group.id, values: { status: newStatus } },
      { onSuccess: () => Toast.success(newStatus === 'enabled' ? '已启用' : '已禁用') },
    );
  };

  const handleBatchDelete = () => {
    Modal.confirm({
      title: `确认删除选中的 ${selectedRowKeys.length} 个用户组？`,
      content: '删除后无法恢复，请确认操作',
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        await deleteMutation.mutateAsync(selectedRowKeys);
        Toast.success('删除成功');
        setSelectedRowKeys([]);
      },
    });
  };

  const openMembers = (group: UserGroup) => {
    setMemberGroup(group);
    setMemberSheetVisible(true);
  };

  const openRoles = (group: UserGroup) => {
    setRoleGroup(group);
    setRoleModalVisible(true);
  };

  const handleSaveRoles = async () => {
    if (!roleGroup) return;
    await assignRolesMutation.mutateAsync({ id: roleGroup.id, roleIds });
    Toast.success('角色已更新，组内成员即时生效');
    setRoleModalVisible(false);
    setRoleGroup(null);
  };

  const openEdit = (record: UserGroup) => {
    setEditingRecord(record);
    setModalVisible(true);
  };

  const handleSaveMembers = async () => {
    if (!memberGroup) return;
    await assignMembersMutation.mutateAsync({ id: memberGroup.id, userIds: memberIds });
    Toast.success('保存成功');
    setMemberSheetVisible(false);
  };

  const columns: ColumnProps<UserGroup>[] = [
    { title: '用户组名称', dataIndex: 'name', width: 200, render: renderEllipsis },
    { title: '编码', dataIndex: 'code', width: 180, render: renderEllipsis },
    {
      title: '描述', dataIndex: 'description',
      render: renderEllipsis,
    },
    {
      title: '负责人', dataIndex: 'ownerName', width: 120,
      render: (v: string | null | undefined) => v || '—',
    },
    {
      title: '所属部门', dataIndex: 'departmentName', width: 140,
      render: (v: string | null | undefined) => v || '—',
    },
    {
      title: '成员', dataIndex: 'memberPreview', width: 150,
      render: (_: unknown, record: UserGroup) => <UserPreviewCell preview={record.memberPreview} count={record.memberCount} />,
    },
    {
      title: '角色', dataIndex: 'roleCount', width: 80,
      render: (v: number | undefined, record: UserGroup) => (
        <Tag color={v ? 'violet' : 'grey'} style={{ cursor: hasPermission('system:user-groups:assign') ? 'pointer' : 'default' }}
          onClick={() => hasPermission('system:user-groups:assign') && openRoles(record)}>
          {v ?? 0}
        </Tag>
      ),
    },
    createdAtColumn,
    {
      title: '状态', dataIndex: 'status', width: 90, fixed: 'right',
      render: (v: string, record: UserGroup) => (
        <Switch
          size="small"
          checked={v === 'enabled'}
          loading={togglingStatusId === record.id}
          disabled={!hasPermission('system:user-groups:update')}
          onChange={(checked: boolean) => void handleToggleStatus(record, checked ? 'enabled' : 'disabled')}
        />
      ),
    },
    createOperationColumn<UserGroup>({
      width: 260,
      desktopInlineKeys: ['members', 'roles', 'edit', 'delete'],
      actions: (record) => [
        {
          key: 'members',
          label: '成员',
          hidden: !hasPermission('system:user-groups:assign'),
          onClick: () => { void openMembers(record); },
        },
        {
          key: 'roles',
          label: '角色',
          hidden: !hasPermission('system:user-groups:assign'),
          onClick: () => { void openRoles(record); },
        },
        {
          key: 'edit',
          label: '编辑',
          hidden: !hasPermission('system:user-groups:update'),
          onClick: () => { void openEdit(record); },
        },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          hidden: !hasPermission('system:user-groups:delete'),
          onClick: () => {
            Modal.confirm({
              title: '确定要删除该用户组吗？',
              okButtonProps: { type: 'danger', theme: 'solid' },
              onOk: () => handleDelete(record.id),
            });
          },
        },
      ],
    }),
  ];

  const formInitValues = editing
    ? {
        name: editing.name,
        code: editing.code,
        description: editing.description ?? undefined,
        ownerId: editing.ownerId ?? undefined,
        departmentId: editing.departmentId ?? undefined,
        status: editing.status,
      }
    : { status: 'enabled' };

  const renderKeywordSearch = () => (
    <Input
      prefix={<Search size={14} />}
      placeholder="搜索名称/编码"
      value={draftParams.keyword}
      onChange={(value) => setDraftParams((prev) => ({ ...prev, keyword: value }))}
      onEnterPress={handleSearch}
      style={{ width: 240, maxWidth: '100%' }}
      showClear
    />
  );

  const renderStatusFilter = () => (
    <Select
      placeholder="请选择状态"
      value={draftParams.status || undefined}
      onChange={(value) => setDraftParams((prev) => ({ ...prev, status: (value as string) ?? '' }))}
      style={{ width: 140, maxWidth: '100%' }}
      optionList={[{ value: '', label: '全部状态' }, ...statusItems.map((i) => ({ value: i.value, label: i.label }))]}
    />
  );

  const renderSearchButton = () => <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>;
  const renderResetButton = () => <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>;
  const renderBatchDeleteButton = () => selectedRowKeys.length > 0 && hasPermission('system:user-groups:delete') ? (
    <Button type="danger" theme="light" icon={<Trash2 size={14} />} onClick={handleBatchDelete}>
      批量删除 ({selectedRowKeys.length})
    </Button>
  ) : null;
  const renderCreateButton = () => hasPermission('system:user-groups:create') ? (
    <Button type="primary" icon={<Plus size={14} />} onClick={() => { setEditingRecord(null); setModalVisible(true); }}>新增</Button>
  ) : null;

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            {renderKeywordSearch()}
            {renderStatusFilter()}
            {renderSearchButton()}
            {renderResetButton()}
            {renderBatchDeleteButton()}
            {renderCreateButton()}
          </>
        )}
        mobilePrimary={(
          <>
            {renderKeywordSearch()}
            {renderSearchButton()}
            {renderCreateButton()}
          </>
        )}
        mobileFilters={renderStatusFilter()}
        mobileActions={renderBatchDeleteButton()}
        filterTitle="用户组筛选"
        actionTitle="用户组操作"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={data}
        loading={listQuery.isFetching}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        rowKey="id"
        scroll={{ x: 'max-content' }}
        pagination={buildPagination(total)}
        empty="暂无数据"
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys as number[]),
        }}
      />

      <AppModal
        title={editing ? '编辑用户组' : '新增用户组'}
        visible={modalVisible}
        onCancel={() => { setModalVisible(false); setEditingRecord(null); }}
        onOk={handleModalOk}
        okButtonProps={{ disabled: modalDetailLoading }}
        width={660}

      >
        <Spin spinning={modalDetailLoading} wrapperClassName="modal-spin-wrapper">
        <Form
          key={editing?.id ?? 'new-group'}
          getFormApi={(api) => { formApi.current = api; }}
          allowEmpty
          initValues={formInitValues}
          labelPosition="left"
          labelWidth={90}
        >
          <Row gutter={16}>
            <Col span={12}>
              <Form.Input field="name" label="名称" placeholder="请输入用户组名称" rules={[{ required: true, message: '请输入用户组名称' }]} />
            </Col>
            <Col span={12}>
              <Form.Input field="code" label="编码" placeholder="字母数字下划线" rules={[
                { required: true, message: '请输入用户组编码' },
                { pattern: /^\w+$/, message: '编码只能包含字母、数字和下划线' },
              ]} />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Select
                field="ownerId" label="负责人" placeholder="请选择负责人（可选）"
                style={{ width: '100%' }} filter showClear
                optionList={allUsers.map(u => ({ value: u.id, label: `${u.nickname} (${u.username})` }))}
              />
            </Col>
            <Col span={12}>
              <Form.TreeSelect
                field="departmentId" label="所属部门" placeholder="请选择部门（可选）"
                style={{ width: '100%' }} filterTreeNode showClear
                treeData={departmentTreeData}
              />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Select
                field="status" label="状态" style={{ width: '100%' }}
                optionList={statusItems.map((i) => ({ value: i.value, label: i.label }))}
              />
            </Col>
          </Row>
          <Form.TextArea field="description" label="描述" placeholder="请输入描述（可选）" maxCount={256} />
        </Form>
        </Spin>
      </AppModal>

      <SideSheet
        title={
          <Space>
            <Users size={16} />
            <span>成员管理 - {memberGroup?.name}</span>
          </Space>
        }
        visible={memberSheetVisible}
        onCancel={() => setMemberSheetVisible(false)}
        width={720}
        footer={
          <Space>
            <Button onClick={() => setMemberSheetVisible(false)}>取消</Button>
            <Button type="primary" loading={assignMembersMutation.isPending} onClick={handleSaveMembers}>保存</Button>
          </Space>
        }
      >
        {allUsers.length === 0 ? (
          <Empty title="暂无用户" description="请先创建用户" />
        ) : (
          <UserTransferSelect
            dataSource={allUsers}
            value={memberIds}
            onChange={setMemberIds}
            departments={departments}
          />
        )}
      </SideSheet>

      <AppModal
        title={`分配角色 — ${roleGroup?.name ?? ''}`}
        visible={roleModalVisible}
        onCancel={() => { setRoleModalVisible(false); setRoleGroup(null); }}
        onOk={handleSaveRoles}
        confirmLoading={assignRolesMutation.isPending}
        width={480}
      >
        <Spin spinning={groupRolesQuery.isFetching || allRolesQuery.isFetching} wrapperClassName="modal-spin-wrapper">
          <div style={{ marginBottom: 8, fontSize: 12, color: 'var(--semi-color-text-2)' }}>
            组内成员将自动继承所选角色的菜单与数据权限（与成员直接分配的角色取并集）
          </div>
          <Select
            multiple
            filter
            placeholder="请选择角色"
            style={{ width: '100%' }}
            value={roleIds}
            onChange={(v) => setRoleIds((v as number[]) ?? [])}
            optionList={(allRolesQuery.data ?? []).map((r) => ({ value: r.id, label: `${r.name}（${r.code}）` }))}
          />
        </Spin>
      </AppModal>
    </div>
  );
}
