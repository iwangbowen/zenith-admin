import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Button, Select, Space, Form, Toast, Tag, Row, Col, Tree, Spin } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { ChevronsUpDown, ChevronsDownUp, Building2, KeyRound } from 'lucide-react';
import type { CreateUserInput, User, Role, Department, Position } from '@zenith/shared/identity';
import { USER_STATUSES, enumValueOf, type BodyOf } from '@zenith/shared/core';
import { userContract } from '@zenith/shared/identity';
import { UserAvatar } from '@/components/UserAvatar';
import { formatDateTimeRangeForApi } from '@/utils/date';
import { compactParams } from '@/lib/query';
import { formatPasswordPolicyHint, type PasswordRules as PasswordPolicy } from '@zenith/shared/settings';
import { PasswordStrengthMeter } from '@/components/PasswordStrengthMeter';
import DictTag from '@/components/DictTag';
import { useDictItems } from '@/hooks/useDictItems';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { TreeNodeData } from '@douyinfe/semi-ui/lib/es/tree';
import { usePermission } from '@/hooks/usePermission';
import { isAllKeysExpanded } from '@/hooks/useTreeExpansion';
import { useAuth } from '@/hooks/useAuth';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { MasterDetailLayout } from '@/components/MasterDetailLayout';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import './UsersPage.css';
import { createdAtColumn, dateTimeColumn, renderEllipsis } from '../../utils/table-columns';
import { UserMenuPermissionModal } from './UserMenuPermissionModal';
import { UserDataScopeModal } from './UserDataScopeModal';
import { UserAvatarModal } from './UserAvatarModal';
import ExportButton from '@/components/ExportButton';
import ImportButton from '@/components/ImportButton';
import { useAllRoles } from '@/hooks/queries/roles';
import { departmentsToTreeData, useFlatDepartments } from '@/hooks/queries/departments';
import { useAllPositions } from '@/hooks/queries/positions';
import { useMySettings } from '@/hooks/queries/settings';
import { useListSearch } from '@/hooks/useListSearch';
import {
  useAssignUserRoles,
  useBatchUserPassword,
  useBatchUserStatus,
  useDeleteUsers,
  useKickUserSessions,
  useResetUserPassword,
  useSaveUser,
  useUnlockUser,
  useUserDetail,
  useUserList,
  userKeys,
} from '@/hooks/queries/users';
import { BatchDeleteButton, BatchStatusButtons, CreateButton } from '@/components/toolbar-controls';
import { DateRangeFilter, KeywordInput, StatusSelect } from '@/components/search-filters';
import { confirmDanger } from '@/utils/confirm';
import { batchStatusHandler, confirmAndDelete, deleteAction, ListSearchToolbar, listTableProps, useStatusToggle } from '@/components/list-page';
import { useEditModal } from '@/hooks/useEditModal';
import { useSensitiveFormFields } from '@/hooks/useSensitiveFormFields';
import { SensitiveFormInput, SensitiveText } from '@/components/sensitive';
import { abortSubmit } from '@/lib/abort-submit';

interface SearchParams {
  keyword: string;
  phone: string;
  status?: string;
  timeRange: [Date, Date] | null;
  /** 部门树选中的部门；undefined = 全部部门 */
  departmentId?: number;
}

/** 用户表单值：记录里的 null 在提交时归一为未填 / null，与创建入参对齐 */
interface UserFormValues extends Partial<Omit<CreateUserInput, 'email' | 'phone' | 'gender'>> {
  email?: string | null;
  phone?: string | null;
  gender?: string | null;
}

type UserSavePayload = Partial<BodyOf<typeof userContract.create>>;

interface ResetPasswordFormValues {
  password: string;
  confirmPassword: string;
}

const defaultSearchParams: SearchParams = { keyword: '', phone: '', status: undefined, timeRange: null, departmentId: undefined };
const EMPTY_USERS: User[] = [];
const EMPTY_ROLES: Role[] = [];
const EMPTY_DEPARTMENTS: Department[] = [];
const EMPTY_POSITIONS: Position[] = [];

function isAdminUser(user: Pick<User, 'username'>) {
  return user.username.trim().toLowerCase() === 'admin';
}

export default function UsersPage() {
  const { hasPermission } = usePermission();
  const { updateUser } = useAuth();
  const {
    page, pageSize, buildPagination,
    draftParams, bind, bindKeyword, submittedParams,
    handleSearch, applySearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: userKeys.lists });
  const [batchPasswordModalVisible, setBatchPasswordModalVisible] = useState(false);
  // useEditModal 例外：批量重置密码对话框（针对选中用户的动作表单，非新增 / 编辑）
  const batchPasswordFormApi = useRef<FormApi | null>(null);
  const [menuPermUser, setMenuPermUser] = useState<User | null>(null);
  const [menuPermVisible, setMenuPermVisible] = useState(false);
  const [dataPermUser, setDataPermUser] = useState<User | null>(null);
  const [dataPermVisible, setDataPermVisible] = useState(false);
  const [roleAssignUser, setRoleAssignUser] = useState<User | null>(null);
  const [roleAssignVisible, setRoleAssignVisible] = useState(false);
  const [roleAssignIds, setRoleAssignIds] = useState<number[]>([]);
  const [avatarUser, setAvatarUser] = useState<User | null>(null);
  const [avatarModalVisible, setAvatarModalVisible] = useState(false);
  const [createPwdVal, setCreatePwdVal] = useState('');
  const [editPwdVal, setEditPwdVal] = useState('');
  const [batchPwdVal, setBatchPwdVal] = useState('');

  const { items: statusItems } = useDictItems('common_status');
  const { options: genderOptions } = useDictItems('user_gender');
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);
  const [deptTreeExpandedKeys, setDeptTreeExpandedKeys] = useState<string[]>([]);

  const allRolesQuery = useAllRoles();
  const allDepartmentsQuery = useFlatDepartments();
  const allPositionsQuery = useAllPositions();
  const mySettingsQuery = useMySettings();
  const allRoles = allRolesQuery.data ?? EMPTY_ROLES;
  const allDepartments = allDepartmentsQuery.data ?? EMPTY_DEPARTMENTS;
  const allPositions = allPositionsQuery.data ?? EMPTY_POSITIONS;
  const passwordPolicy: PasswordPolicy | null = mySettingsQuery.data?.identitySecurity.password ?? null;

  // 已提交筛选 → 契约查询参数：列表与导出共用同一份映射
  const filterQuery = useMemo(() => compactParams({
    keyword: submittedParams.keyword,
    phone: submittedParams.phone,
    departmentId: submittedParams.departmentId,
    status: enumValueOf(USER_STATUSES, submittedParams.status),
    ...formatDateTimeRangeForApi(submittedParams.timeRange),
  }), [submittedParams]);
  const listQuery = useUserList({ page, pageSize, ...filterQuery });
  const userList = listQuery.data?.list ?? EMPTY_USERS;
  const saveMutation = useSaveUser();
  const resetPasswordMutation = useResetUserPassword();
  const deleteMutation = useDeleteUsers();
  const unlockMutation = useUnlockUser();
  const batchStatusMutation = useBatchUserStatus();
  const toggleStatusMutation = useBatchUserStatus();
  const batchPasswordMutation = useBatchUserPassword();
  const assignRolesMutation = useAssignUserRoles();
  const kickSessionsMutation = useKickUserSessions();
  // 敏感字段（手机号 / 邮箱）对非豁免用户是掩码：编辑时锁定，提交前剔除未修改的锁定字段
  const sensitiveFieldsRef = useRef<ReturnType<typeof useSensitiveFormFields<User>> | null>(null);
  const modal = useEditModal<User, UserFormValues, UserSavePayload>({
    entityName: '用户',
    save: saveMutation,
    useDetail: useUserDetail,
    defaults: {
      positionIds: [],
      roleIds: [],
      status: 'enabled',
    },
    toValues: (user) => ({
      username: user.username,
      nickname: user.nickname,
      email: user.email ?? undefined,
      phone: user.phone ?? undefined,
      gender: user.gender ?? undefined,
      departmentId: user.departmentId ?? undefined,
      positionIds: user.positionIds ?? user.positions?.map((item) => item.id) ?? [],
      roleIds: user.roles.map((r) => r.id),
      status: user.status,
    }),
    beforeSave: (rawValues, { editing }) => {
      const control = sensitiveFieldsRef.current;
      const values = (control ? control.strip(rawValues as unknown as Record<string, unknown>) : rawValues) as UserFormValues;
      const payload: UserSavePayload = {
        ...values,
        email: values.email ?? undefined,
        phone: values.phone ?? undefined,
        departmentId: values.departmentId ?? null,
        gender: values.gender ?? null,
        positionIds: values.positionIds ?? [],
        roleIds: values.roleIds ?? [],
      };
      // 被剔除的锁定字段不出现在载荷里（服务端只更新提交了的字段）
      if (!('email' in values)) delete payload.email;
      if (!('phone' in values)) delete payload.phone;

      if (editing && isAdminUser(editing) && values.status === 'disabled') {
        Toast.warning('admin 账号不允许禁用');
        abortSubmit('admin_status_forbidden');
      }
      return payload;
    },
    labelWidth: 72,
  });
  const editingUser = modal.editing;
  const sensitiveFields = useSensitiveFormFields<User>({ entity: 'User', fields: ['email', 'phone'], record: editingUser });
  sensitiveFieldsRef.current = sensitiveFields;
  const passwordModal = useEditModal<User, ResetPasswordFormValues>({
    save: {
      mutateAsync: async ({ id, values }) => {
        if (id == null) abortSubmit('missing_user');
        await resetPasswordMutation.mutateAsync({ params: { id }, body: { password: values.password } });
        return {} as User;
      },
      isPending: false,
    },
    beforeSave: (values) => {
      if (values.password !== values.confirmPassword) {
        Toast.error('两次密码输入不一致');
        abortSubmit('password_not_match');
      }
      return values;
    },
    successMessage: () => '密码修改成功',
    onSaved: () => setEditPwdVal(''),
  });

  const selectedDeletableCount = useMemo(() => {
    if (!userList.length) return 0;
    const selectedSet = new Set(selectedRowKeys);
    return userList.filter((item) => selectedSet.has(item.id) && !isAdminUser(item)).length;
  }, [userList, selectedRowKeys]);

  const selectedNonAdminIds = useMemo(() => {
    if (!userList.length) return [];
    const selectedSet = new Set(selectedRowKeys);
    return userList.filter((item) => selectedSet.has(item.id) && !isAdminUser(item)).map((item) => item.id);
  }, [userList, selectedRowKeys]);

  const status = useStatusToggle<User>({
    toggle: (user, enabled) => toggleStatusMutation.mutateAsync({ body: { ids: [user.id], status: enabled ? 'enabled' : 'disabled' } }),
    confirmDisable: (user) => ({ danger: true, title: `确认停用用户「${user.nickname ?? user.username}」？`, content: '停用后该用户将无法登录。', okText: '确认停用' }),
    disabled: (user) => isAdminUser(user) || !hasPermission('system:user:update'),
  });

  // 启用 / 停用都需确认（停用后无法登录，红色实心确认）；admin 账号不在选中集里
  const handleBatchStatus = batchStatusHandler({
    selectedRowKeys: selectedNonAdminIds,
    clearSelection: () => setSelectedRowKeys([]),
    run: (ids, status) => batchStatusMutation.mutateAsync({ body: { ids, status } }),
    confirm: 'always',
    entity: '个用户',
    confirmContent: (status) => (status === 'disabled' ? '停用后该用户将无法登录。' : '启用后该用户可正常登录。'),
    danger: true,
  });

  const handleBatchDelete = () => {
    const deletableIds = userList
      .filter((item) => selectedRowKeys.includes(item.id) && !isAdminUser(item))
      .map((item) => item.id);

    if (deletableIds.length === 0) {
      Toast.warning('admin 账号不允许删除');
      return;
    }

    confirmAndDelete({
      title: `确认删除选中的 ${deletableIds.length} 个用户？`,
      content: '删除后无法恢复，请谨慎操作。',
      run: () => deleteMutation.mutateAsync(deletableIds),
      successMessage: '批量删除成功',
      onDeleted: () => setSelectedRowKeys([]),
    });
  };

  const departmentTreeData = useMemo<TreeNodeData[]>(
    () => departmentsToTreeData(allDepartments, { keepEmptyChildren: true }),
    [allDepartments]
  );

  const allDeptExpandedKeys = useMemo(
    () => allDepartments.map((item) => String(item.id)),
    [allDepartments]
  );

  // 首次加载完成后默认全展开；此后（keepAlive 页签切回 / 数据刷新触发 effect 重放）保持用户手动展开/折叠状态
  const deptTreeExpandInitedRef = useRef(false);
  useEffect(() => {
    if (deptTreeExpandInitedRef.current || allDepartments.length === 0) return;
    deptTreeExpandInitedRef.current = true;
    setDeptTreeExpandedKeys(allDeptExpandedKeys);
  }, [allDeptExpandedKeys, allDepartments.length]);

  const isAllDeptExpanded = isAllKeysExpanded(deptTreeExpandedKeys, allDeptExpandedKeys);

  function toggleDeptExpandAll() {
    setDeptTreeExpandedKeys(isAllDeptExpanded ? [] : allDeptExpandedKeys);
  }

  const positionOptionList = useMemo(
    () => allPositions.map((item) => ({ value: item.id, label: item.name })),
    [allPositions]
  );

  const openCreate = modal.openCreate;
  const openEdit = modal.openEdit;
  const openPassword = passwordModal.openEdit;

  const { mutateAsync: unlockUser } = unlockMutation;
  const handleUnlock = useCallback(async (id: number) => {
    await unlockUser({ params: { id } });
    Toast.success('解锁成功');
  }, [unlockUser]);

  const { mutateAsync: kickUserSessions } = kickSessionsMutation;
  const { refetch: refetchUserList } = listQuery;

  // 列定义 memo 化：搜索框每次击键都会触发页面重渲染，
  // 若每次都重建 columns（含所有 render 闭包），表格会整体重渲染所有行
  const columns: ColumnProps<User>[] = useMemo(() => [
    {
      title: '用户',
      dataIndex: 'nickname',
      minWidth: 260,
      ellipsis: { showTitle: false },
      render: (_: unknown, record: User) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span
            title={record.isOnline ? '在线' : '离线'}
            style={{
              flexShrink: 0,
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: record.isOnline ? 'var(--semi-color-success)' : 'var(--semi-color-fill-2)',
              display: 'inline-block',
              boxShadow: record.isOnline ? '0 0 0 2px color-mix(in srgb, var(--semi-color-success) 20%, transparent)' : undefined,
            }}
          />
          <UserAvatar name={record.nickname || record.username} avatar={record.avatar} semiSize="extra-small" size={24} />
          <span className="table-cell-ellipsis" title={`${record.nickname}（${record.username}）`}>
            {record.nickname}（{record.username}）
          </span>
          {record.isLocked && (
            <Tag size="small" color="red" style={{ flexShrink: 0 }}>已锁定</Tag>
          )}
        </div>
      ),
    },
    {
      title: '手机号码',
      dataIndex: 'phone',
      width: 170,
      render: (v: string | null | undefined, record: User) => <SensitiveText entity="User" id={record.id} field="phone" value={v} />,
    },
    {
      title: '邮箱',
      dataIndex: 'email',
      width: 240,
      render: (v: string | null | undefined, record: User) => <SensitiveText entity="User" id={record.id} field="email" value={v} />,
    },
    {
      title: '性别',
      dataIndex: 'gender',
      width: 80,
      render: (gender: string | null | undefined) => gender ? <DictTag dictCode="user_gender" value={gender} /> : null,
    },
    {
      title: '部门',
      dataIndex: 'departmentName',
      width: 160,
      render: renderEllipsis,
    },
    {
      title: '岗位',
      dataIndex: 'positions',
      width: 220,
      render: (positions: Position[] | undefined) => {
        const list = positions ?? [];
        return (
          <Space spacing={4} wrap>
            {list.length === 0 ? <Tag color="grey">无岗位</Tag> : list.map((item) => (
              <Tag key={item.id} color="purple">{item.name}</Tag>
            ))}
          </Space>
        );
      },
    },
    {
      title: '角色',
      dataIndex: 'roles',
      width: 180,
      render: (roles: Role[]) => (
        <Space spacing={4} wrap>
          {roles.length === 0 ? <Tag color="grey">无角色</Tag> : roles.map((r) => (
            <Tag key={r.id} color="blue">{r.name}</Tag>
          ))}
        </Space>
      ),
    },
    dateTimeColumn('最近登录', 'lastLoginAt'),
    createdAtColumn,
    status.column(),
    createOperationColumn<User>({
      width: 180,
      desktopInlineKeys: ['edit', 'delete'],
      actions: (record) => {
        const isAdmin = isAdminUser(record);
        return [
          {
            key: 'edit',
            label: '编辑',
            hidden: !hasPermission('system:user:update'),
            onClick: () => {
              openEdit(record);
            },
          },
          deleteAction({
            hidden: !hasPermission('system:user:delete'),
            disabled: isAdmin,
            disabledReason: 'admin 账号不允许删除',
            title: '确定要删除该用户吗？',
            run: () => deleteMutation.mutateAsync([record.id]),
          }),
          {
            key: 'avatar',
            label: '管理头像',
            hidden: !hasPermission('system:user:update'),
            onClick: () => {
              setAvatarUser(record);
              setAvatarModalVisible(true);
            },
          },
          {
            key: 'password',
            label: '修改密码',
            hidden: !hasPermission('system:user:update'),
            onClick: () => {
              openPassword(record);
            },
          },
          {
            key: 'unlock',
            label: '解锁',
            hidden: !record.isLocked || !hasPermission('system:user:update'),
            onClick: () => handleUnlock(record.id),
          },
          {
            key: 'menu-permission',
            label: '菜单权限',
            hidden: !hasPermission('system:user:assign'),
            onClick: () => {
              setMenuPermUser(record);
              setMenuPermVisible(true);
            },
          },
          {
            key: 'assign-role',
            label: '分配角色',
            hidden: !hasPermission('system:user:assign'),
            onClick: () => {
              setRoleAssignUser(record);
              setRoleAssignIds(record.roles.map((r) => r.id));
              setRoleAssignVisible(true);
            },
          },
          {
            key: 'data-permission',
            label: '数据权限',
            hidden: !hasPermission('system:user:assign'),
            onClick: () => {
              setDataPermUser(record);
              setDataPermVisible(true);
            },
          },
          {
            key: 'force-logout',
            label: '强制下线',
            danger: true,
            dividerBefore: true,
            hidden: !record.isOnline || !hasPermission('system:session:forceLogout'),
            onClick: () => {
              confirmDanger({
                title: '强制下线',
                content: `确定要强制下线用户「${record.nickname}（${record.username}）」的全部会话吗？`,
                onOk: async () => {
                  await kickUserSessions({ params: { id: record.id } });
                  Toast.success('已强制下线');
                  void refetchUserList();
                },
              });
            },
          },
        ];
      },
    }),
  ], [hasPermission, status, deleteMutation, handleUnlock, kickUserSessions, refetchUserList, openEdit, openPassword]);

  const [showDeptTree, setShowDeptTree] = useState(false);
  const [isLayoutNarrow, setIsLayoutNarrow] = useState(false);

  const masterContent = (
    <div className="users-dept-sidebar">
      <MasterDetailLayout.Header
        className="users-dept-sidebar-title"
        style={{ padding: '10px 12px', minHeight: 44, marginBottom: 4 }}
        extra={(
          <Button
            className="users-dept-tree-action"
            theme="borderless"
            size="small"
            icon={isAllDeptExpanded ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
            onClick={toggleDeptExpandAll}
          >
            {isAllDeptExpanded ? '全部折叠' : '全部展开'}
          </Button>
        )}
      >
        <span className="users-dept-sidebar-title-text">组织架构</span>
      </MasterDetailLayout.Header>
      <Tree
        treeData={departmentTreeData}
        expandedKeys={deptTreeExpandedKeys}
        value={draftParams.departmentId === undefined ? undefined : String(draftParams.departmentId)}
        filterTreeNode
        showFilteredOnly
        searchPlaceholder="全部部门"
        onExpand={(expandedKeys) => {
          setDeptTreeExpandedKeys((expandedKeys as Array<string | number>).map(String));
        }}
        onSelect={(selectedKey) => {
          const key = selectedKey;
          const newDeptId = !key ? undefined : Number(key);
          const newParams = { ...draftParams, departmentId: newDeptId };
          applySearch(newParams);
          setShowDeptTree(false);
        }}
        style={{ width: '100%' }}
      />
    </div>
  );

  const renderDepartmentButton = (forceVisible = false) => (
    <Button
      theme="borderless"
      icon={<Building2 size={14} />}
      onClick={() => setShowDeptTree(true)}
      style={{ display: forceVisible || isLayoutNarrow ? undefined : 'none' }}
    >
      按部门
    </Button>
  );

  const renderBatchActions = () => (
    <>
      {selectedDeletableCount > 0 && hasPermission('system:user:delete') && (
        <BatchDeleteButton count={selectedDeletableCount} onClick={handleBatchDelete} />
      )}
      {selectedNonAdminIds.length > 0 && hasPermission('system:user:update') && (
        <>
          <BatchStatusButtons count={selectedNonAdminIds.length} onChange={handleBatchStatus} danger />
          <Button theme="light" icon={<KeyRound size={14} />} onClick={() => setBatchPasswordModalVisible(true)}>
            批量修改密码 ({selectedNonAdminIds.length})
          </Button>
        </>
      )}
    </>
  );

  const renderImportButton = () => hasPermission('system:user:import') ? (
    <ImportButton
      entity="identity.users"
      title="用户"
      onFinished={() => void refetchUserList()}
    />
  ) : null;

  return (
    <div className="page-container page-container--stretch">
      <MasterDetailLayout
        master={masterContent}
        detail={
        <div className="users-content">
      <ListSearchToolbar
        keyword={<KeywordInput placeholder="搜索用户名/昵称/邮箱" {...bindKeyword('keyword')} width={260} />}
        filters={(
          <>
            <KeywordInput placeholder="搜索手机号码" {...bindKeyword('phone')} width={180} />
            <StatusSelect
              items={statusItems}
              {...bind('status')}
            />
            <DateRangeFilter placeholder={["开始时间", "结束时间"]} {...bind('timeRange')} />
          </>
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        create={(
          hasPermission('system:user:create') ? (
            <CreateButton onClick={openCreate} />
          ) : null
        )}
        actions={(
          <>
            {renderDepartmentButton()}
            {renderBatchActions()}
            <ExportButton entity="system.users" query={filterQuery} watermark={false} permission="system:user:export" />
            {renderImportButton()}
          </>
        )}
        filterTitle="用户筛选"
        actionTitle="用户操作"
      />

      <ConfigurableTable<User>
        columns={columns}
        {...listTableProps(listQuery, {
          pagination: buildPagination,
          empty: '暂无数据',
          rowSelection: {
            selectedRowKeys,
            onChange: (keys) => {
              const nextKeys = (keys ?? []).map(Number);
              const nextKeySet = new Set(nextKeys);
              const adminIds = userList.filter((item) => isAdminUser(item)).map((item) => item.id);
              const filtered = nextKeys.filter((id) => !adminIds.includes(id));
              if (filtered.length < nextKeys.length && adminIds.some((id) => nextKeySet.has(id))) {
                Toast.warning('admin 账号不支持批量删除');
              }
              setSelectedRowKeys(filtered);
            },
          },
        })}
      />
        </div>
        }
        defaultSize={220}
        minSize={160}
        maxSize={400}
        showDetail={!showDeptTree}
        onMasterBack={() => setShowDeptTree(false)}
        masterBackLabel="返回用户列表"
        onResponsiveChange={setIsLayoutNarrow}
        persistKey="users"
        style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}
      />

      <AppModal
        {...modal.modalProps}
        okButtonProps={{ disabled: modal.detailLoading }}
        width={660}
      >
        <Form
          key={modal.formKey} {...modal.formProps}
        >
          <Spin spinning={modal.detailLoading} wrapperClassName="modal-spin-wrapper">
          {editingUser ? (
            <>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Input field="username" label="用户名" disabled />
                </Col>
                <Col span={12}>
                  <Form.Input field="nickname" label="昵称" placeholder="请输入昵称" rules={[{ required: true, message: '请输入昵称' }]} />
                </Col>
              </Row>
              <Row gutter={16}>
                <Col span={12}>
                  <SensitiveFormInput
                    control={sensitiveFields}
                    field="phone"
                    label="手机号码"
                    placeholder="请输入手机号码"
                    rules={[{ pattern: /^1[3-9]\d{9}$/, message: '请输入正确的手机号码' }]}
                  />
                </Col>
              </Row>
            </>
          ) : (
            <>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Input field="username" label="用户名" placeholder="请输入用户名" rules={[{ required: true, message: '请输入用户名' }]} />
                </Col>
                <Col span={12}>
                  <Form.Input field="nickname" label="昵称" placeholder="请输入昵称" rules={[{ required: true, message: '请输入昵称' }]} />
                </Col>
              </Row>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Input
                    field="phone"
                    label="手机号码"
                    placeholder="请输入手机号码"
                    rules={[{ pattern: /^1[3-9]\d{9}$/, message: '请输入正确的手机号码' }]}
                  />
                </Col>
                <Col span={12}>
                  <Form.Input
                    field="password"
                    label="密码"
                    placeholder="请输入密码"
                    type="password"
                    rules={[{ required: true, message: '请输入密码' }]}
                    onChange={(v) => setCreatePwdVal(String(v ?? ''))}
                    helpText={<PasswordStrengthMeter password={createPwdVal} policy={passwordPolicy} />}
                  />
                </Col>
              </Row>
            </>
          )}
          <Row gutter={16}>
            <Col span={12}>
              <SensitiveFormInput
                control={sensitiveFields}
                field="email"
                label="邮箱"
                placeholder="请输入邮箱"
                rules={[{ type: 'email', message: '邮箱格式不正确' }]}
              />
            </Col>
            <Col span={12}>
              <Form.Select
                field="gender"
                label="性别"
                style={{ width: '100%' }}
                showClear
                optionList={genderOptions}
                placeholder="请选择性别"
              />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.TreeSelect
                field="departmentId"
                label="所属部门"
                style={{ width: '100%' }}
                treeData={departmentTreeData}
                placeholder="请选择所属部门"
                filterTreeNode
                showClear
              />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Select
                field="positionIds"
                label="岗位"
                style={{ width: '100%' }}
                multiple
                filter
                showClear
                optionList={positionOptionList}
                placeholder="请选择岗位"
              />
            </Col>
            <Col span={12}>
              <Form.Select
                field="roleIds"
                label="角色"
                style={{ width: '100%' }}
                multiple
                filter
                optionList={allRoles.map((r) => ({ value: r.id, label: r.name }))}
                placeholder="请选择角色"
              />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Select
                field="status"
                label="状态"
                style={{ width: '100%' }}
                optionList={statusItems.map((i) => ({
                  value: i.value,
                  label: i.label,
                  disabled: editingUser ? (isAdminUser(editingUser) && i.value === 'disabled') : false,
                }))}
                placeholder="请选择状态"
              />
            </Col>
          </Row>
          </Spin>
        </Form>
      </AppModal>

      <AppModal
        {...passwordModal.modalProps}
        title={passwordModal.editing ? `修改密码 - ${passwordModal.editing.nickname}` : '修改密码'}
        onCancel={() => {
          passwordModal.close();
          setEditPwdVal('');
        }}
        width={420}
      >
        <Form key={passwordModal.formKey} {...passwordModal.formProps}>
          <Form.Input
            field="password"
            label="新密码"
            placeholder="请输入新密码"
            mode="password"
            rules={[
              { required: true, message: '请输入新密码' },
              { min: 6, message: '密码至少 6 个字符' },
            ]}
            onChange={(v) => setEditPwdVal(String(v ?? ''))}
            helpText={<PasswordStrengthMeter password={editPwdVal} policy={passwordPolicy} />}
          />
          <Form.Input
            field="confirmPassword"
            label="确认密码"
            placeholder="请再次输入新密码"
            mode="password"
            rules={[{ required: true, message: '请确认新密码' }]}
          />
        </Form>
      </AppModal>

      {/* 批量修改密码 */}
      <AppModal
        title={`批量修改密码（共 ${selectedNonAdminIds.length} 个用户）`}
        visible={batchPasswordModalVisible}
        onCancel={() => { setBatchPasswordModalVisible(false); batchPasswordFormApi.current?.setValues({ password: '', confirmPassword: '' }); setBatchPwdVal(''); }}
        confirmLoading={batchPasswordMutation.isPending}
        onOk={async () => {
          if (!batchPasswordFormApi.current) return;
          try {
            const values = await batchPasswordFormApi.current.validate() as unknown as { password: string; confirmPassword: string };
            if (values.password !== values.confirmPassword) {
              batchPasswordFormApi.current.setError('confirmPassword', '两次密码输入不一致');
              return;
            }
            await batchPasswordMutation.mutateAsync({ body: { ids: selectedNonAdminIds, password: values.password } });
            Toast.success('密码修改成功');
            setBatchPasswordModalVisible(false);
            batchPasswordFormApi.current.setValues({ password: '', confirmPassword: '' });
            setBatchPwdVal('');
            setSelectedRowKeys([]);
          } catch {
            // validation failed
          }
        }}
      >
        <Form
          getFormApi={(api) => { batchPasswordFormApi.current = api; }}
          labelPosition="left"
          labelWidth={90}
        >
          <Form.Input
            field="password"
            label="新密码"
            type="password"
            placeholder={passwordPolicy ? formatPasswordPolicyHint(passwordPolicy) : '请输入新密码'}
            rules={[{ required: true, message: '请输入新密码' }]}
            onChange={(v) => setBatchPwdVal(String(v ?? ''))}
            helpText={<PasswordStrengthMeter password={batchPwdVal} policy={passwordPolicy} />}
          />
          <Form.Input
            field="confirmPassword"
            label="确认密码"
            type="password"
            placeholder="请再次输入新密码"
            rules={[{ required: true, message: '请确认密码' }]}
          />
        </Form>
      </AppModal>

      {/* 管理头像 */}
      {avatarUser && (
        <UserAvatarModal
          visible={avatarModalVisible}
          user={avatarUser}
          onClose={() => setAvatarModalVisible(false)}
          onUpdated={(updated) => {
            void listQuery.refetch();
            setAvatarUser(updated);
            updateUser(updated);
          }}
        />
      )}

      {/* 用户菜单权限 */}
      {menuPermUser && (
        <UserMenuPermissionModal
          userId={menuPermUser.id}
          userName={menuPermUser.nickname || menuPermUser.username}
          visible={menuPermVisible}
          onClose={() => setMenuPermVisible(false)}
        />
      )}

      {/* 用户数据权限 */}
      {dataPermUser && (
        <UserDataScopeModal
          userId={dataPermUser.id}
          userName={dataPermUser.nickname || dataPermUser.username}
          visible={dataPermVisible}
          deptTree={allDepartments}
          onClose={() => setDataPermVisible(false)}
        />
      )}

      {/* 分配角色 */}
      <AppModal
        title={`分配角色——${roleAssignUser?.nickname || roleAssignUser?.username || ''}`}
        visible={roleAssignVisible}
        onCancel={() => setRoleAssignVisible(false)}
        confirmLoading={assignRolesMutation.isPending}
        onOk={async () => {
          if (!roleAssignUser) return;
          await assignRolesMutation.mutateAsync({ params: { id: roleAssignUser.id }, body: { roleIds: roleAssignIds } });
          Toast.success('角色分配成功');
          setRoleAssignVisible(false);
        }}
        okText="保存"
        cancelText="取消"
        width={480}
      >
        <Select
          multiple
          filter
          showClear
          style={{ width: '100%' }}
          value={roleAssignIds}
          onChange={(v) => setRoleAssignIds((v as number[]) ?? [])}
          optionList={allRoles.map((r) => ({ value: r.id, label: r.name }))}
          placeholder="请选择要分配的角色"
        />
      </AppModal>
    </div>
  );
}
