import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Table,
  Button,
  Input,
  Select,
  Space,
  Modal,
  Form,
  Toast,
  Tag,
  DatePicker,
  Upload,
  Typography,
  Row,
  Col,
  Tree,
  Spin,
  Switch,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, Plus, RotateCcw, Download, Trash2, FileUp, ChevronsUpDown, ChevronsDownUp, Building2, ArrowLeft, KeyRound, ToggleLeft, ToggleRight } from 'lucide-react';
import type { User, Role, Department, Position } from '@zenith/shared';
import { request } from '@/utils/request';
import { UserAvatar } from '@/components/UserAvatar';
import { formatDateTimeForApi } from '@/utils/date';
import { formatPasswordPolicyHint, type PasswordPolicy } from '@/utils/password-policy';
import { PasswordStrengthMeter } from '@/components/PasswordStrengthMeter';
import DictTag from '@/components/DictTag';
import { useDictItems } from '@/hooks/useDictItems';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { TreeNodeData } from '@douyinfe/semi-ui/lib/es/tree';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { MasterDetailLayout } from '@/components/MasterDetailLayout';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import './UsersPage.css';
import { createdAtColumn, renderEllipsis } from '../../utils/table-columns';
import { UserMenuPermissionModal } from './UserMenuPermissionModal';
import { UserDataScopeModal } from './UserDataScopeModal';
import { UserAvatarModal } from './UserAvatarModal';
import ExportButton from '@/components/ExportButton';
import { useAllRoles } from '@/hooks/queries/roles';
import { useFlatDepartments } from '@/hooks/queries/departments';
import { useAllPositions } from '@/hooks/queries/positions';
import { useSystemPasswordPolicy } from '@/hooks/queries/system-configs';
import {
  useAssignUserRoles,
  useBatchDeleteUsers,
  useBatchUserPassword,
  useBatchUserStatus,
  useDeleteUser,
  useImportUsers,
  useKickUserSessions,
  useResetUserPassword,
  useSaveUser,
  useUnlockUser,
  useUserDetail,
  useUserList,
  userKeys,
} from '@/hooks/queries/users';

interface SearchParams {
  keyword: string;
  phone: string;
  status: string;
  timeRange: [Date, Date] | null;
  departmentId: number | null;
}

const defaultSearchParams: SearchParams = { keyword: '', phone: '', status: '', timeRange: null, departmentId: null };
const EMPTY_USERS: User[] = [];
const EMPTY_ROLES: Role[] = [];
const EMPTY_DEPARTMENTS: Department[] = [];
const EMPTY_POSITIONS: Position[] = [];

function isAdminUser(user: Pick<User, 'username'>) {
  return user.username.trim().toLowerCase() === 'admin';
}

export default function UsersPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = usePermission();
  const formApi = useRef<FormApi | null>(null);
  const passwordFormApi = useRef<FormApi | null>(null);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftParams, setDraftParams] = useState<SearchParams>(defaultSearchParams);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearchParams);
  const [modalVisible, setModalVisible] = useState(false);
  const [passwordModalVisible, setPasswordModalVisible] = useState(false);
  const [editingRecord, setEditingRecord] = useState<User | null>(null);
  const [passwordUser, setPasswordUser] = useState<User | null>(null);
  const [batchPasswordModalVisible, setBatchPasswordModalVisible] = useState(false);
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
  const { items: genderItems } = useDictItems('user_gender');
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);
  const [importModalVisible, setImportModalVisible] = useState(false);
  const [deptTreeExpandedKeys, setDeptTreeExpandedKeys] = useState<string[]>([]);

  interface ImportResult {
    total: number;
    success: number;
    failed: number;
    errors: Array<{ row: number; message: string }>;
  }

  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const importFileRef = useRef<File | null>(null);
  const allRolesQuery = useAllRoles();
  const allDepartmentsQuery = useFlatDepartments();
  const allPositionsQuery = useAllPositions();
  const passwordPolicyQuery = useSystemPasswordPolicy();
  const allRoles = allRolesQuery.data ?? EMPTY_ROLES;
  const allDepartments = allDepartmentsQuery.data ?? EMPTY_DEPARTMENTS;
  const allPositions = allPositionsQuery.data ?? EMPTY_POSITIONS;
  const passwordPolicy: PasswordPolicy | null = passwordPolicyQuery.data ?? null;

  const listQuery = useUserList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    phone: submittedParams.phone || undefined,
    departmentId: submittedParams.departmentId ?? undefined,
    status: submittedParams.status || undefined,
    startTime: submittedParams.timeRange ? formatDateTimeForApi(submittedParams.timeRange[0]) : undefined,
    endTime: submittedParams.timeRange ? formatDateTimeForApi(submittedParams.timeRange[1]) : undefined,
  });
  const data = listQuery.data ?? null;
  const userList = data?.list ?? EMPTY_USERS;
  const total = data?.total ?? 0;
  const detailQuery = useUserDetail(editingRecord?.id, modalVisible);
  const editingUser = editingRecord ? (detailQuery.data ?? editingRecord) : null;
  const modalDetailLoading = !!editingRecord && detailQuery.isFetching;
  const saveMutation = useSaveUser();
  const resetPasswordMutation = useResetUserPassword();
  const importUsersMutation = useImportUsers();
  const deleteMutation = useDeleteUser();
  const unlockMutation = useUnlockUser();
  const batchDeleteMutation = useBatchDeleteUsers();
  const batchStatusMutation = useBatchUserStatus();
  const toggleStatusMutation = useBatchUserStatus();
  const batchPasswordMutation = useBatchUserPassword();
  const assignRolesMutation = useAssignUserRoles();
  const kickSessionsMutation = useKickUserSessions();

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

  const togglingStatusId = toggleStatusMutation.isPending ? (toggleStatusMutation.variables?.id ?? null) : null;

  const handleBatchStatus = (status: 'enabled' | 'disabled') => {
    if (selectedNonAdminIds.length === 0) return;
    const label = status === 'enabled' ? '启用' : '停用';
    Modal.confirm({
      title: `确认批量${label}选中的 ${selectedNonAdminIds.length} 个用户？`,
      content: status === 'disabled' ? '停用后该用户将无法登录。' : '启用后该用户可正常登录。',
      okButtonProps: { type: status === 'disabled' ? 'danger' : 'primary', theme: 'solid' },
      onOk: async () => {
        await batchStatusMutation.mutateAsync({ ids: selectedNonAdminIds, status });
        Toast.success(`批量${label}成功`);
        setSelectedRowKeys([]);
      },
    });
  };

  const handleBatchDelete = () => {
    const deletableIds = userList
      .filter((item) => selectedRowKeys.includes(item.id) && !isAdminUser(item))
      .map((item) => item.id);

    if (deletableIds.length === 0) {
      Toast.warning('admin 账号不允许删除');
      return;
    }

    Modal.confirm({
      title: `确认删除选中的 ${deletableIds.length} 个用户？`,
      content: '删除后无法恢复，请谨慎操作。',
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        await batchDeleteMutation.mutateAsync(deletableIds);
        Toast.success('批量删除成功');
        setSelectedRowKeys([]);
      },
    });
  };

  const departmentTreeData = useMemo<TreeNodeData[]>(
    () => {
      const nodeMap = new Map<number, TreeNodeData>();
      const rootNodes: TreeNodeData[] = [];

      allDepartments.forEach((item) => {
        nodeMap.set(item.id, {
          key: String(item.id),
          value: item.id,
          label: item.name,
          children: [],
        });
      });

      allDepartments.forEach((item) => {
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
    },
    [allDepartments]
  );

  const deptTreeData = useMemo<TreeNodeData[]>(
    () => [{ key: '__all__', value: '__all__', label: '全部部门' }, ...departmentTreeData],
    [departmentTreeData]
  );

  const allDeptExpandedKeys = useMemo(
    () => ['__all__', ...allDepartments.map((item) => String(item.id))],
    [allDepartments]
  );

  // 首次加载完成后默认全展开；此后（keepAlive 页签切回 / 数据刷新触发 effect 重放）保持用户手动展开/折叠状态
  const deptTreeExpandInitedRef = useRef(false);
  useEffect(() => {
    if (deptTreeExpandInitedRef.current || allDepartments.length === 0) return;
    deptTreeExpandInitedRef.current = true;
    setDeptTreeExpandedKeys(allDeptExpandedKeys);
  }, [allDeptExpandedKeys, allDepartments.length]);

  const isAllDeptExpanded = allDeptExpandedKeys.length > 0 && deptTreeExpandedKeys.length >= allDeptExpandedKeys.length;

  function toggleDeptExpandAll() {
    setDeptTreeExpandedKeys(isAllDeptExpanded ? [] : allDeptExpandedKeys);
  }

  const positionOptionList = useMemo(
    () => allPositions.map((item) => ({ value: item.id, label: item.name })),
    [allPositions]
  );

  const formInitValues = editingUser
    ? {
        username: editingUser.username,
        nickname: editingUser.nickname,
        email: editingUser.email ?? undefined,
        phone: editingUser.phone ?? undefined,
        gender: editingUser.gender ?? undefined,
        departmentId: editingUser.departmentId ?? undefined,
        positionIds: editingUser.positionIds ?? editingUser.positions?.map((item) => item.id) ?? [],
        roleIds: editingUser.roles.map((r) => r.id),
        status: editingUser.status,
      }
    : {
        positionIds: [],
        roleIds: [],
        status: 'enabled',
      };

  const { mutate: toggleStatus } = toggleStatusMutation;
  const handleToggleStatus = useCallback(async (user: User, newStatus: 'enabled' | 'disabled') => {
    if (newStatus === 'disabled') {
      const confirmed = await new Promise<boolean>((resolve) => {
        Modal.confirm({
          title: `确认停用用户「${user.nickname ?? user.username}」？`,
          content: '停用后该用户将无法登录。',
          okButtonProps: { type: 'danger', theme: 'solid' },
          okText: '确认停用',
          cancelText: '取消',
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });
      if (!confirmed) return;
    }
    toggleStatus(
      { id: user.id, ids: [user.id], status: newStatus },
      { onSuccess: () => Toast.success(newStatus === 'enabled' ? '已启用' : '已停用') },
    );
  }, [toggleStatus]);

  function handleSearch() {
    setPage(1);
    setSubmittedParams(draftParams);
    void queryClient.invalidateQueries({ queryKey: userKeys.lists });
  }

  function handleReset() {
    setPage(1);
    setDraftParams(defaultSearchParams);
    setSubmittedParams(defaultSearchParams);
    void queryClient.invalidateQueries({ queryKey: userKeys.lists });
  }

  const buildExportQuery = useCallback((params: SearchParams = submittedParams) => ({
    ...(params.keyword ? { keyword: params.keyword } : {}),
    ...(params.phone ? { phone: params.phone } : {}),
    ...(params.departmentId ? { departmentId: params.departmentId } : {}),
    ...(params.status ? { status: params.status } : {}),
    ...(params.timeRange
      ? {
          startTime: formatDateTimeForApi(params.timeRange[0]),
          endTime: formatDateTimeForApi(params.timeRange[1]),
        }
      : {}),
  }), [submittedParams]);

  const handleModalOk = async () => {
    let values;
    try {
      values = await formApi.current?.validate();
    } catch {
      throw new Error('validation');
    }
    if (!values) throw new Error('validation');

    const payload = {
      ...values,
      departmentId: values.departmentId ?? null,
      gender: (values as { gender?: string }).gender ?? null,
      positionIds: values.positionIds ?? [],
      roleIds: values.roleIds ?? [],
    };
    const nextStatus = (values as { status?: string }).status;

    if (editingUser && isAdminUser(editingUser) && nextStatus === 'disabled') {
      Toast.warning('admin 账号不允许禁用');
      throw new Error('admin_status_forbidden');
    }

    await saveMutation.mutateAsync({ id: editingRecord?.id, values: payload });
    Toast.success(editingRecord ? '更新成功' : '创建成功');
    setModalVisible(false);
    setEditingRecord(null);
  };

  const handlePasswordModalOk = async () => {
    let values;
    try {
      values = await passwordFormApi.current?.validate();
    } catch {
      throw new Error('validation');
    }
    if (!values) throw new Error('validation');

    if (values.password !== values.confirmPassword) {
      Toast.error('两次密码输入不一致');
      throw new Error('password_not_match');
    }

    if (!passwordUser) {
      throw new Error('missing_user');
    }

    await resetPasswordMutation.mutateAsync({ id: passwordUser.id, password: values.password });
    Toast.success('密码修改成功');
    setPasswordModalVisible(false);
    setPasswordUser(null);
    setEditPwdVal('');
  };

  const handleImportTemplate = async () => {
    try {
      await request.download('/api/users/import-template', 'user_import_template.xlsx');
    } catch {
      Toast.error('模板下载失败');
    }
  };

  const handleImportSubmit = async () => {
    if (!importFileRef.current) {
      Toast.warning('请先选择文件');
      return;
    }
    const formData = new FormData();
    formData.append('file', importFileRef.current);
    try {
      const result = await importUsersMutation.mutateAsync({ formData });
      setImportResult(result);
    } catch {
      // request 层已提示错误
    }
  };

  const openCreate = () => {
    setEditingRecord(null);
    setModalVisible(true);
  };

  const openImport = () => {
    setImportModalVisible(true);
    setImportResult(null);
    importFileRef.current = null;
  };

  const { mutateAsync: deleteUser } = deleteMutation;
  const handleDelete = useCallback(async (id: number) => {
    await deleteUser(id);
    Toast.success('删除成功');
  }, [deleteUser]);

  const { mutateAsync: unlockUser } = unlockMutation;
  const handleUnlock = useCallback(async (id: number) => {
    await unlockUser(id);
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
      width: 260,
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
      width: 150,
      render: renderEllipsis,
    },
    {
      title: '邮箱',
      dataIndex: 'email',
      width: 220,
      render: renderEllipsis,
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
    {
      title: '最近登录',
      dataIndex: 'lastLoginAt',
      width: 180,
      render: (v: string | null | undefined) => v ?? '—',
    },
    createdAtColumn,
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      fixed: 'right',
      render: (status: string, record: User) => (
        <Switch
          size="small"
          checked={status === 'enabled'}
          loading={togglingStatusId === record.id}
          disabled={isAdminUser(record) || !hasPermission('system:user:update')}
          onChange={(checked: boolean) => void handleToggleStatus(record, checked ? 'enabled' : 'disabled')}
        />
      ),
    },
    createOperationColumn<User>({
      width: 200,
      desktopInlineKeys: ['edit', 'delete'],
      actions: (record) => {
        const isAdmin = isAdminUser(record);
        return [
          {
            key: 'edit',
            label: '编辑',
            hidden: !hasPermission('system:user:update'),
            onClick: () => {
              setEditingRecord(record);
              setModalVisible(true);
            },
          },
          {
            key: 'delete',
            label: '删除',
            danger: true,
            hidden: !hasPermission('system:user:delete'),
            disabled: isAdmin,
            disabledReason: 'admin 账号不允许删除',
            onClick: () => {
              Modal.confirm({
                title: '确定要删除该用户吗？',
                okButtonProps: { type: 'danger', theme: 'solid' },
                onOk: () => handleDelete(record.id),
              });
            },
          },
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
              setPasswordUser(record);
              setPasswordModalVisible(true);
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
              Modal.confirm({
                title: '强制下线',
                content: `确定要强制下线用户「${record.nickname}（${record.username}）」的全部会话吗？`,
                okButtonProps: { type: 'danger', theme: 'solid' },
                onOk: async () => {
                  await kickUserSessions(record.id);
                  Toast.success('已强制下线');
                  void refetchUserList();
                },
              });
            },
          },
        ];
      },
    }),
  ], [hasPermission, togglingStatusId, handleToggleStatus, handleDelete, handleUnlock, kickUserSessions, refetchUserList]);

  const [showDeptTree, setShowDeptTree] = useState(false);
  const [isLayoutNarrow, setIsLayoutNarrow] = useState(false);

  const masterContent = (
    <div className="users-dept-sidebar">
      {showDeptTree && (
        <button type="button" className="users-dept-back" onClick={() => setShowDeptTree(false)}>
          <ArrowLeft size={14} />
          返回用户列表
        </button>
      )}
      <div className="users-dept-sidebar-title">
        <span className="users-dept-sidebar-title-text">组织架构</span>
        <div className="users-dept-sidebar-actions">
          <Button
            className="users-dept-tree-action"
            theme="borderless"
            size="small"
            icon={isAllDeptExpanded ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
            onClick={toggleDeptExpandAll}
          >
            {isAllDeptExpanded ? '全部折叠' : '全部展开'}
          </Button>
        </div>
      </div>
      <Tree
        treeData={deptTreeData}
        expandedKeys={deptTreeExpandedKeys}
      value={draftParams.departmentId == null ? '__all__' : String(draftParams.departmentId)}
        filterTreeNode
        showFilteredOnly
        searchPlaceholder="搜索部门"
        onExpand={(expandedKeys) => {
          setDeptTreeExpandedKeys((expandedKeys as Array<string | number>).map(String));
        }}
        onSelect={(selectedKey) => {
          const key = selectedKey;
          const newDeptId = !key || key === '__all__' ? null : Number(key);
          const newParams = { ...draftParams, departmentId: newDeptId };
          setDraftParams(newParams);
          setSubmittedParams(newParams);
          setPage(1);
          void queryClient.invalidateQueries({ queryKey: userKeys.lists });
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

  const renderKeywordSearch = () => (
    <Input
      prefix={<Search size={14} />}
      placeholder="搜索用户名/昵称/邮箱"
      value={draftParams.keyword}
      onChange={(value) => setDraftParams((prev) => ({ ...prev, keyword: value }))}
      onEnterPress={handleSearch}
      style={{ width: 260, maxWidth: '100%' }}
      showClear
    />
  );

  const renderPhoneSearch = () => (
    <Input
      prefix={<Search size={14} />}
      placeholder="搜索手机号码"
      value={draftParams.phone}
      onChange={(value) => setDraftParams((prev) => ({ ...prev, phone: value }))}
      onEnterPress={handleSearch}
      style={{ width: 180, maxWidth: '100%' }}
      showClear
    />
  );

  const renderStatusFilter = () => (
    <Select
      placeholder="请选择状态"
      value={draftParams.status || undefined}
      onChange={(value) => setDraftParams((prev) => ({ ...prev, status: (value as string) ?? '' }))}
      style={{ width: 140, maxWidth: '100%' }}
      optionList={[
        { value: '', label: '全部状态' },
        ...statusItems.map((item) => ({ value: item.value, label: item.label })),
      ]}
    />
  );

  const renderTimeRangeFilter = () => (
    <DatePicker
      type="dateTimeRange"
      placeholder={["开始时间", "结束时间"]}
      value={draftParams.timeRange ?? undefined}
      onChange={(value) => setDraftParams((prev) => ({ ...prev, timeRange: value ? (value as [Date, Date]) : null }))}
      style={{ width: 360, maxWidth: '100%' }}
    />
  );

  const renderSearchButton = () => <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>;
  const renderResetButton = () => <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>;
  const renderBatchActions = () => (
    <>
      {selectedDeletableCount > 0 && hasPermission('system:user:delete') && (
        <Button type="danger" theme="light" icon={<Trash2 size={14} />} onClick={handleBatchDelete}>
          批量删除 ({selectedDeletableCount})
        </Button>
      )}
      {selectedNonAdminIds.length > 0 && hasPermission('system:user:update') && (
        <>
          <Button theme="light" icon={<ToggleRight size={14} />} onClick={() => handleBatchStatus('enabled')}>
            批量启用 ({selectedNonAdminIds.length})
          </Button>
          <Button theme="light" type="danger" icon={<ToggleLeft size={14} />} onClick={() => handleBatchStatus('disabled')}>
            批量停用 ({selectedNonAdminIds.length})
          </Button>
          <Button theme="light" icon={<KeyRound size={14} />} onClick={() => setBatchPasswordModalVisible(true)}>
            批量修改密码 ({selectedNonAdminIds.length})
          </Button>
        </>
      )}
    </>
  );

  const renderExportButtons = () => hasPermission('system:user:export')
    ? <ExportButton entity="system.users" query={buildExportQuery()} />
    : null;

  const renderMobileExportActions = () => (
    hasPermission('system:user:export')
      ? <ExportButton entity="system.users" query={buildExportQuery()} label="导出" variant="flat" />
      : null
  );

  const renderImportButton = () => hasPermission('system:user:import') ? (
    <Button type="primary" icon={<FileUp size={14} />} onClick={openImport}>导入</Button>
  ) : null;

  const renderCreateButton = () => hasPermission('system:user:create') ? (
    <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>
  ) : null;

  return (
    <div className="page-container">
      <MasterDetailLayout
        master={masterContent}
        detail={
        <div className="users-content">
      <SearchToolbar
        primary={(
          <>
            {renderDepartmentButton()}
            {renderKeywordSearch()}
            {renderPhoneSearch()}
            {renderStatusFilter()}
            {renderTimeRangeFilter()}
            {renderSearchButton()}
            {renderResetButton()}
            {renderBatchActions()}
            {renderExportButtons()}
            {renderImportButton()}
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
        mobileFilters={(
          <>
            {renderPhoneSearch()}
            {renderStatusFilter()}
            {renderTimeRangeFilter()}
          </>
        )}
        mobileActions={(
          <>
            {renderDepartmentButton(true)}
            {renderBatchActions()}
            {renderMobileExportActions()}
            {renderImportButton()}
          </>
        )}
        filterTitle="用户筛选"
        actionTitle="用户操作"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={userList}
        loading={listQuery.isFetching}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        pagination={buildPagination(total)}
        rowKey="id"
        size="small"
        empty="暂无数据"
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => {
            const nextKeys = (keys as (string | number)[]).map(Number);
            const nextKeySet = new Set(nextKeys);
            const adminIds = userList.filter((item) => isAdminUser(item)).map((item) => item.id);
            const filtered = nextKeys.filter((id) => !adminIds.includes(id));
            if (filtered.length < nextKeys.length && adminIds.some((id) => nextKeySet.has(id))) {
              Toast.warning('admin 账号不支持批量删除');
            }
            setSelectedRowKeys(filtered);
          },
        }}
      />
        </div>
        }
        defaultSize={220}
        minSize={160}
        maxSize={400}
        showDetail={!showDeptTree}
        onResponsiveChange={setIsLayoutNarrow}
        persistKey="users"
        style={{ flex: 1, overflow: 'hidden' }}
      />

      <AppModal
        title={editingUser ? '编辑用户' : '新增用户'}
        visible={modalVisible}
        onCancel={() => {
          setModalVisible(false);
          setEditingRecord(null);
        }}
        onOk={handleModalOk}
        okButtonProps={{ disabled: modalDetailLoading }}
        width={660}
        closeOnEsc
      >
        <Form
          key={editingUser?.id ?? 'new-user'}
          getFormApi={(api) => { formApi.current = api; }}
          allowEmpty
          initValues={formInitValues}
          labelPosition="left"
          labelWidth={72}
        >
          <Spin spinning={modalDetailLoading} wrapperClassName="modal-spin-wrapper">
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
                  <Form.Input
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
              <Form.Input
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
                optionList={genderItems.map((i) => ({ value: i.value, label: i.label }))}
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
        title={passwordUser ? `修改密码 - ${passwordUser.nickname}` : '修改密码'}
        visible={passwordModalVisible}
        onCancel={() => {
          setPasswordModalVisible(false);
          setPasswordUser(null);
          setEditPwdVal('');
        }}
        onOk={handlePasswordModalOk}
        width={420}
      >
        <Form
          key={passwordUser?.id ?? 'password-form'}
          getFormApi={(api) => { passwordFormApi.current = api; }}
          labelPosition="left"
          labelWidth={90}
        >
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

      <AppModal
        title="批量导入用户"
        visible={importModalVisible}
        onCancel={() => setImportModalVisible(false)}
        footer={
          importResult ? (
            <Button onClick={() => setImportModalVisible(false)}>关闭</Button>
          ) : (
            <Space>
              <Button onClick={() => setImportModalVisible(false)}>取消</Button>
              <Button type="primary" loading={importUsersMutation.isPending} onClick={handleImportSubmit}>开始导入</Button>
            </Space>
          )
        }
        width={560}
      >
        {importResult ? (
          <div>
            <div style={{ marginBottom: 12 }}>
              <Space>
                <Tag color="green">成功: {importResult.success}</Tag>
                <Tag color="red">失败: {importResult.failed}</Tag>
                <Tag color="grey">共: {importResult.total}</Tag>
              </Space>
            </div>
            {importResult.errors.length > 0 && (
              <Table
                size="small"
                columns={[
                  { title: '行号', dataIndex: 'row', width: 80 },
                  { title: '错误信息', dataIndex: 'message' },
                ]}
                dataSource={importResult.errors}
                pagination={false}
                rowKey="row"
              />
            )}
          </div>
        ) : (
          <div style={{ padding: '16px 0' }}>
            <div style={{ marginBottom: 12 }}>
              <Button type="tertiary" icon={<Download size={14} />} onClick={handleImportTemplate}>下载导入模板</Button>
              <Typography.Text type="tertiary" style={{ marginLeft: 8, fontSize: 12 }}>请先下载模板，按格式填写后上传</Typography.Text>
            </div>
            <Upload
              accept=".xlsx,.xls"
              limit={1}
              action=""
              beforeUpload={({ file }) => {
                importFileRef.current = file.fileInstance ?? null;
                return false;
              }}
              onRemove={() => { importFileRef.current = null; }}
            >
              <Button icon={<FileUp size={14} />}>选择文件</Button>
            </Upload>
          </div>
        )}
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
            await batchPasswordMutation.mutateAsync({ ids: selectedNonAdminIds, password: values.password });
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
            globalThis.dispatchEvent(new CustomEvent('auth:user-updated', { detail: updated }));
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
          await assignRolesMutation.mutateAsync({ id: roleAssignUser.id, roleIds: roleAssignIds });
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
