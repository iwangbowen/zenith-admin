import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Col,
  Form,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Spin,
  Switch,
  Toast,
  Avatar,
  AvatarGroup,
  Tag,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { TreeNodeData } from '@douyinfe/semi-ui/lib/es/tree';
import { Search, Plus, RotateCcw, ChevronsUpDown, ChevronsDownUp } from 'lucide-react';
import type { Department, User, PaginatedResponse } from '@zenith/shared';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import DictTag from '@/components/DictTag';
import { useDictItems } from '@/hooks/useDictItems';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';
import { usePermission } from '@/hooks/usePermission';
import { SearchToolbar } from '@/components/SearchToolbar';
import ExportButton from '@/components/ExportButton';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { createdAtColumn, renderEllipsis } from '../../../utils/table-columns';
import {
  departmentKeys,
  useDeleteDepartment,
  useDepartmentDetail,
  useDepartmentTreeSearch,
  useFlatDepartments,
  useSaveDepartment,
} from '@/hooks/queries/departments';

interface SearchParams {
  keyword: string;
  status: string;
}

const defaultSearchParams: SearchParams = {
  keyword: '',
  status: '',
};

function collectDescendantIds(items: Department[], departmentId: number): Set<number> {
  const descendants = new Set<number>();
  const queue = [departmentId];

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (currentId === undefined) {
      continue;
    }

    for (const item of items) {
      if (item.parentId === currentId) {
        descendants.add(item.id);
        queue.push(item.id);
      }
    }
  }

  return descendants;
}

function buildDepartmentTreeData(items: Department[], excludedIds: Set<number>): TreeNodeData[] {
  const nodeMap = new Map<number, TreeNodeData>();
  const roots: TreeNodeData[] = [];

  items.forEach((item) => {
    if (excludedIds.has(item.id)) {
      return;
    }

    nodeMap.set(item.id, {
      label: item.name,
      value: item.id,
      key: String(item.id),
    });
  });

  items.forEach((item) => {
    if (excludedIds.has(item.id)) {
      return;
    }

    const node = nodeMap.get(item.id);
    if (!node) {
      return;
    }

    if (item.parentId === 0) {
      roots.push(node);
      return;
    }

    const parentNode = nodeMap.get(item.parentId);
    if (!parentNode) {
      roots.push(node);
      return;
    }

    parentNode.children = parentNode.children ?? [];
    parentNode.children.push(node);
  });

  return roots;
}

export default function DepartmentsPage() {
  const { hasPermission } = usePermission();
  const queryClient = useQueryClient();
  const formApi = useRef<FormApi | null>(null);
  const [draftParams, setDraftParams] = useState<SearchParams>(defaultSearchParams);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearchParams);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingDepartment, setEditingDepartment] = useState<Department | null>(null);
  const { items: statusItems } = useDictItems('common_status');
  const { items: categoryItems } = useDictItems('department_category');

  const treeQuery = useDepartmentTreeSearch({
    keyword: submittedParams.keyword || undefined,
    status: submittedParams.status || undefined,
  });
  const data = useMemo(() => treeQuery.data ?? [], [treeQuery.data]);
  const flatDepartmentsQuery = useFlatDepartments();
  const allDepartments = useMemo(() => flatDepartmentsQuery.data ?? [], [flatDepartmentsQuery.data]);
  const detailQuery = useDepartmentDetail(editingDepartment?.id, modalVisible && !!editingDepartment);
  const activeDepartment = editingDepartment ? (detailQuery.data ?? editingDepartment) : null;
  const modalDetailLoading = !!editingDepartment && detailQuery.isFetching;
  const saveMutation = useSaveDepartment();
  const toggleStatusMutation = useSaveDepartment();
  const deleteMutation = useDeleteDepartment();
  const [leaderKeyword, setLeaderKeyword] = useState('');
  const leaderOptionsQuery = useQuery({
    queryKey: ['users', 'options', leaderKeyword],
    queryFn: () =>
      request
        .get<PaginatedResponse<User>>(`/api/users${toQueryString({ pageSize: 50, keyword: leaderKeyword || undefined })}`)
        .then(unwrap),
    enabled: modalVisible,
    staleTime: 30_000,
  });
  const leaderOptions = (leaderOptionsQuery.data?.list ?? []).map((u) => ({
    value: u.id,
    label: u.departmentName ? `${u.nickname}-${u.departmentName}` : u.nickname,
  }));

  const [expandedRowKeys, setExpandedRowKeys] = useState<(string | number)[]>([]);

  const allRowKeys = useMemo(() => {
    const keys: number[] = [];
    function collect(items: Department[]) {
      for (const item of items) {
        keys.push(item.id);
        if (item.children?.length) collect(item.children);
      }
    }
    collect(data);
    return keys;
  }, [data]);

  const isAllExpanded = expandedRowKeys.length > 0 && expandedRowKeys.length >= allRowKeys.length;

  function toggleExpandAll() {
    setExpandedRowKeys(isAllExpanded ? [] : allRowKeys);
  }

  useEffect(() => {
    const detail = detailQuery.data;
    if (!detail || !modalVisible || !editingDepartment || detail.id !== editingDepartment.id) return;
    setEditingDepartment(detail);
  }, [detailQuery.data, editingDepartment, modalVisible]);

  const parentTreeData = useMemo(() => {
    const excludedIds = editingDepartment
      ? new Set([editingDepartment.id, ...collectDescendantIds(allDepartments, editingDepartment.id)])
      : new Set<number>();

    return [
      {
        label: '顶级部门',
        value: 0,
        key: '0',
        children: buildDepartmentTreeData(allDepartments, excludedIds),
      },
    ];
  }, [allDepartments, editingDepartment]);

  const formInitValues = activeDepartment
    ? {
        parentId: activeDepartment.parentId,
        name: activeDepartment.name,
        code: activeDepartment.code,
        category: activeDepartment.category ?? 'department',
        leaderId: activeDepartment.leaderId ?? undefined,
        phone: activeDepartment.phone,
        email: activeDepartment.email,
        sort: activeDepartment.sort,
        status: activeDepartment.status,
      }
    : {
        parentId: 0,
        category: 'department',
        sort: 0,
        status: 'enabled',
      };

  const openEdit = (record: Department) => {
    setEditingDepartment(record);
    setModalVisible(true);
  };

  const handleReset = () => {
    setDraftParams(defaultSearchParams);
    setSubmittedParams(defaultSearchParams);
    void queryClient.invalidateQueries({ queryKey: departmentKeys.tree });
  };

  const handleSearch = () => {
    setSubmittedParams(draftParams);
    void queryClient.invalidateQueries({ queryKey: departmentKeys.tree });
  };

  const handleModalOk = async () => {
    let values;
    try {
      values = await formApi.current?.validate();
    } catch {
      throw new Error('validation');
    }
    if (!values) throw new Error('validation');

    await saveMutation.mutateAsync({ id: editingDepartment?.id, values });
    Toast.success(editingDepartment ? '更新成功' : '创建成功');
    setModalVisible(false);
    setEditingDepartment(null);
  };

  const handleDelete = async (id: number) => {
    await deleteMutation.mutateAsync(id);
    Toast.success('删除成功');
  };

  const togglingStatusId = toggleStatusMutation.isPending ? (toggleStatusMutation.variables?.id ?? null) : null;

  const handleToggleStatus = useCallback(async (dept: Department, newStatus: 'enabled' | 'disabled') => {
    if (newStatus === 'disabled') {
      const confirmed = await new Promise<boolean>((resolve) => {
        Modal.confirm({
          title: `确认停用部门「${dept.name}」？`,
          content: '停用后该部门将不可选择。',
          okButtonProps: { type: 'danger', theme: 'solid' },
          okText: '确认停用',
          cancelText: '取消',
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });
      if (!confirmed) return;
    }
    toggleStatusMutation.mutate(
      { id: dept.id, values: { status: newStatus } },
      { onSuccess: () => Toast.success(newStatus === 'enabled' ? '已启用' : '已停用') },
    );
  }, [toggleStatusMutation]);

  const columns: ColumnProps<Department>[] = [
    { title: '部门名称', dataIndex: 'name', width: 220 },
    { title: '部门编码', dataIndex: 'code', width: 180, render: renderEllipsis },
    { title: '类别', dataIndex: 'category', width: 90, render: (value: string) => <DictTag dictCode="department_category" value={value} /> },
    { title: '负责人', dataIndex: 'leaderName', width: 120, render: (value) => value || '—' },
    { title: '联系电话', dataIndex: 'phone', width: 140, render: (value) => value || '—' },
    { title: '邮箱', dataIndex: 'email', width: 200, render: renderEllipsis },
    { title: '排序', dataIndex: 'sort', width: 90 },
    {
      title: '成员', dataIndex: 'userPreview', width: 150,
      render: (_: unknown, record: Department) => {
        const preview = record.userPreview ?? [];
        const count = record.userCount ?? 0;
        if (count === 0) return <Tag color="blue">0</Tag>;
        return (
          <Space spacing={6}>
            <AvatarGroup maxCount={4} size="extra-extra-small" overlapFrom="end">
              {preview.map((m) => (
                <Avatar
                  key={m.id}
                  style={{ width: 22, height: 22, minWidth: 22, lineHeight: '22px', fontSize: 12, cursor: 'default' }}
                  src={m.avatar ?? undefined}
                  alt={m.nickname}
                  color="light-blue"
                  title={m.nickname}
                >
                  {m.nickname?.[0]}
                </Avatar>
              ))}
            </AvatarGroup>
            <Tag color="blue" style={{ flexShrink: 0 }}>{count}</Tag>
          </Space>
        );
      },
    },
    createdAtColumn,
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      fixed: 'right',
      render: (value: string, record: Department) => (
        <Switch
          size="small"
          checked={value === 'enabled'}
          loading={togglingStatusId === record.id}
          disabled={!hasPermission('system:department:update')}
          onChange={(checked: boolean) => void handleToggleStatus(record, checked ? 'enabled' : 'disabled')}
        />
      ),
    },
    createOperationColumn<Department>({
      width: 160,
      actions: (record) => [
        {
          key: 'edit',
          label: '编辑',
          hidden: !hasPermission('system:department:update'),
          onClick: () => { void openEdit(record); },
        },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          hidden: !hasPermission('system:department:delete'),
          onClick: () => {
            Modal.confirm({
              title: '确定要删除该部门吗？',
              okButtonProps: { type: 'danger', theme: 'solid' },
              onOk: () => handleDelete(record.id),
            });
          },
        },
      ],
    }),
  ];

  const renderKeywordSearch = () => (
    <Input
      prefix={<Search size={14} />}
      placeholder="搜索部门名称/编码"
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
      optionList={[
        { value: '', label: '全部状态' },
        ...statusItems.map((item) => ({ value: item.value, label: item.label })),
      ]}
    />
  );

  const renderSearchButton = () => <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>;
  const renderResetButton = () => <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>;
  const renderExpandButton = (flat = false) => (
    <Button
      type="primary"
      theme={flat ? 'borderless' : undefined}
      icon={isAllExpanded ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
      onClick={toggleExpandAll}
    >
      {isAllExpanded ? '全部折叠' : '全部展开'}
    </Button>
  );
  const buildExportQuery = () => ({
    ...(submittedParams.keyword ? { keyword: submittedParams.keyword } : {}),
    ...(submittedParams.status ? { status: submittedParams.status } : {}),
  });
  const renderExportButtons = () => <ExportButton entity="system.departments" query={buildExportQuery()} />;
  const renderMobileExportActions = () => <ExportButton entity="system.departments" query={buildExportQuery()} variant="flat" />;
  const renderCreateButton = () => hasPermission('system:department:create') ? (
    <Button
      type="primary"
      icon={<Plus size={14} />}
      onClick={() => {
        setEditingDepartment(null);
        setModalVisible(true);
        setLeaderKeyword('');
      }}
    >
      新增
    </Button>
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
            {renderExpandButton()}
            {renderExportButtons()}
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
        mobileActions={(
          <>
            {renderExpandButton(true)}
            {renderMobileExportActions()}
          </>
        )}
        filterTitle="部门筛选"
        actionTitle="部门操作"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={data}
        loading={treeQuery.isFetching}
        onRefresh={() => void treeQuery.refetch()}
        refreshLoading={treeQuery.isFetching}
        rowKey="id"
        pagination={false}
        empty="暂无数据"
        expandedRowKeys={expandedRowKeys}
        onExpandedRowsChange={(rows) => setExpandedRowKeys(rows?.filter((r): r is Department => 'id' in r).map((r) => r.id) ?? [])}
      />

      <AppModal
        title={editingDepartment ? '编辑部门' : '新增部门'}
        visible={modalVisible}
        onCancel={() => {
          setModalVisible(false);
          setEditingDepartment(null);
        }}
        onOk={handleModalOk}
        okButtonProps={{ disabled: modalDetailLoading }}
        width={660}

      >
        <Spin spinning={modalDetailLoading} wrapperClassName="modal-spin-wrapper">
        <Form
          key={editingDepartment?.id ?? 'new-department'}
          getFormApi={(api) => { formApi.current = api; }}
          allowEmpty
          initValues={formInitValues}
          labelPosition="left"
          labelWidth={90}
        >
          <Form.TreeSelect
            field="parentId"
            label="上级部门"
            style={{ width: '100%' }}
            treeData={parentTreeData}
            placeholder="请选择上级部门"
            filterTreeNode
          />
          <Row gutter={16}>
            <Col span={12}>
              <Form.Input field="name" label="部门名称" placeholder="请输入部门名称" rules={[{ required: true, message: '请输入部门名称' }]} />
            </Col>
            <Col span={12}>
              <Form.Input field="code" label="部门编码" placeholder="请输入部门编码" rules={[{ required: true, message: '请输入部门编码' }]} />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Select
                field="category"
                label="类别"
                optionList={categoryItems.map((item) => ({ value: item.value, label: item.label }))}
                style={{ width: '100%' }}
                placeholder="请选择类别"
                rules={[{ required: true, message: '请选择类别' }]}
              />
            </Col>
            <Col span={12}>
              <Form.Select
                field="leaderId"
                label="负责人"
                placeholder="请选择负责人"
                showClear
                filter
                remote
                loading={leaderOptionsQuery.isFetching}
                optionList={leaderOptions}
                onSearch={setLeaderKeyword}
                style={{ width: '100%' }}
              />
            </Col>
            <Col span={12}>
              <Form.Input field="phone" label="联系电话" placeholder="请输入联系电话" />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Input field="email" label="邮箱" placeholder="请输入邮箱" />
            </Col>
            <Col span={12}>
              <Form.InputNumber field="sort" label="排序" placeholder="请输入排序" min={0} style={{ width: '100%' }} />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Select
                field="status"
                label="状态"
                optionList={statusItems.map((item) => ({ value: item.value, label: item.label }))}
                style={{ width: '100%' }}
                placeholder="请选择状态"
              />
            </Col>
          </Row>
        </Form>
        </Spin>
      </AppModal>
    </div>
  );
}
