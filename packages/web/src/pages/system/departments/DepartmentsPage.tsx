import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  SplitButtonGroup,
  Dropdown,
  Switch,
  Toast,
  Avatar,
  AvatarGroup,
  Tag,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { TreeNodeData } from '@douyinfe/semi-ui/lib/es/tree';
import { Search, Plus, RotateCcw, Download, ChevronsUpDown, ChevronsDownUp, ChevronDown } from 'lucide-react';
import type { Department, User, PaginatedResponse } from '@zenith/shared';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import DictTag from '@/components/DictTag';
import { useDictItems } from '@/hooks/useDictItems';
import { request } from '@/utils/request';
import { usePermission } from '@/hooks/usePermission';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { createdAtColumn, renderEllipsis } from '../../../utils/table-columns';

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
  const formApi = useRef<FormApi | null>(null);
  const [loading, setLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [exportCsvLoading, setExportCsvLoading] = useState(false);
  const [data, setData] = useState<Department[]>([]);
  const [allDepartments, setAllDepartments] = useState<Department[]>([]);
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearchParams);
  const searchParamsRef = useRef<SearchParams>(defaultSearchParams);
  searchParamsRef.current = searchParams;
  const [modalVisible, setModalVisible] = useState(false);
  const [editingDepartment, setEditingDepartment] = useState<Department | null>(null);
  const [modalDetailLoading, setModalDetailLoading] = useState(false);
  const { items: statusItems } = useDictItems('common_status');
  const { items: categoryItems } = useDictItems('department_category');

  const [leaderOptions, setLeaderOptions] = useState<Array<{ value: number; label: string }>>([]);
  const [leaderSearchLoading, setLeaderSearchLoading] = useState(false);

  const fetchLeaderOptions = useCallback(async (keyword = '') => {
    setLeaderSearchLoading(true);
    try {
      const params = new URLSearchParams({ pageSize: '50' });
      if (keyword) params.set('keyword', keyword);
      const res = await request.get<PaginatedResponse<User>>(`/api/users?${params.toString()}`);
      if (res.code === 0) {
        setLeaderOptions(
          res.data.list.map((u) => ({
            value: u.id,
            label: u.departmentName ? `${u.nickname}-${u.departmentName}` : u.nickname,
          }))
        );
      }
    } finally {
      setLeaderSearchLoading(false);
    }
  }, []);

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

  const handleExportExcel = async () => {
    setExportLoading(true);
    try {
      await request.download('/api/departments/export', '部门列表.xlsx');
    } finally {
      setExportLoading(false);
    }
  };

  const handleExportCsv = async () => {
    setExportCsvLoading(true);
    try {
      await request.download('/api/departments/export/csv', '部门列表.csv');
    } finally {
      setExportCsvLoading(false);
    }
  };

  const fetchDepartments = useCallback(async (params?: SearchParams) => {
    const activeParams = params ?? searchParamsRef.current;
    setLoading(true);
    try {
      const query = new URLSearchParams({
        ...(activeParams.keyword ? { keyword: activeParams.keyword } : {}),
        ...(activeParams.status ? { status: activeParams.status } : {}),
      }).toString();
      const [treeRes, flatRes] = await Promise.all([
        request.get<Department[]>(query ? `/api/departments?${query}` : '/api/departments'),
        request.get<Department[]>('/api/departments/flat'),
      ]);
      if (treeRes.code === 0) setData(treeRes.data);
      if (flatRes.code === 0) setAllDepartments(flatRes.data);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void fetchDepartments();
  }, [fetchDepartments]);

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

  const formInitValues = editingDepartment
    ? {
        parentId: editingDepartment.parentId,
        name: editingDepartment.name,
        code: editingDepartment.code,
        category: editingDepartment.category ?? 'department',
        leaderId: editingDepartment.leaderId ?? undefined,
        phone: editingDepartment.phone,
        email: editingDepartment.email,
        sort: editingDepartment.sort,
        status: editingDepartment.status,
      }
    : {
        parentId: 0,
        category: 'department',
        sort: 0,
        status: 'enabled',
      };

  const openEdit = async (record: Department) => {
    setEditingDepartment(record);
    setModalVisible(true);
    void fetchLeaderOptions();
    setModalDetailLoading(true);
    const res = await request.get<Department>(`/api/departments/${record.id}`);
    setModalDetailLoading(false);
    if (res.code === 0 && res.data) {
      setEditingDepartment(res.data);
    } else {
      Toast.error(res.message || '获取信息失败');
    }
  };

  const handleReset = () => {
    setSearchParams(defaultSearchParams);
    void fetchDepartments(defaultSearchParams);
  };

  const handleModalOk = async () => {
    let values;
    try {
      values = await formApi.current?.validate();
    } catch {
      throw new Error('validation');
    }

    const res = editingDepartment
      ? await request.put(`/api/departments/${editingDepartment.id}`, values)
      : await request.post('/api/departments', values);

    if (res.code === 0) {
      Toast.success(editingDepartment ? '更新成功' : '创建成功');
      setModalVisible(false);
      setEditingDepartment(null);
      void fetchDepartments();
    } else {
      throw new Error(res.message);
    }
  };

  const handleDelete = async (id: number) => {
    const res = await request.delete(`/api/departments/${id}`);
    if (res.code === 0) {
      Toast.success('删除成功');
      void fetchDepartments();
    }
  };

  const [togglingStatusId, setTogglingStatusId] = useState<number | null>(null);

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
    setTogglingStatusId(dept.id);
    try {
      const res = await request.put(`/api/departments/${dept.id}`, { status: newStatus });
      if (res.code === 0) {
        Toast.success(newStatus === 'enabled' ? '已启用' : '已停用');
        void fetchDepartments();
      } else {
        Toast.error(res.message || '操作失败');
      }
    } finally {
      setTogglingStatusId(null);
    }
  }, [fetchDepartments]);

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
      value={searchParams.keyword}
      onChange={(value) => setSearchParams((prev) => ({ ...prev, keyword: value }))}
      onEnterPress={() => void fetchDepartments()}
      style={{ width: 240, maxWidth: '100%' }}
      showClear
    />
  );

  const renderStatusFilter = () => (
    <Select
      placeholder="请选择状态"
      value={searchParams.status || undefined}
      onChange={(value) => setSearchParams((prev) => ({ ...prev, status: (value as string) ?? '' }))}
      style={{ width: 140, maxWidth: '100%' }}
      optionList={[
        { value: '', label: '全部状态' },
        ...statusItems.map((item) => ({ value: item.value, label: item.label })),
      ]}
    />
  );

  const renderSearchButton = () => <Button type="primary" icon={<Search size={14} />} onClick={() => void fetchDepartments()}>查询</Button>;
  const renderResetButton = () => <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>;
  const renderExpandButton = () => (
    <Button
      type="primary"
      icon={isAllExpanded ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
      onClick={toggleExpandAll}
    >
      {isAllExpanded ? '全部折叠' : '全部展开'}
    </Button>
  );
  const renderExportButtons = () => (
    <SplitButtonGroup>
      <Button type="primary" icon={<Download size={14} />} loading={exportLoading} onClick={handleExportExcel}>导出</Button>
      <Dropdown
        trigger="click"
        position="bottomRight"
        clickToHide
        render={(
          <Dropdown.Menu>
            <Dropdown.Item onClick={handleExportExcel}>导出 Excel</Dropdown.Item>
            <Dropdown.Item onClick={handleExportCsv}>导出 CSV</Dropdown.Item>
          </Dropdown.Menu>
        )}
      >
        <Button type="primary" icon={<ChevronDown size={14} />} loading={exportCsvLoading} />
      </Dropdown>
    </SplitButtonGroup>
  );
  const renderMobileExportActions = () => (
    <>
      <Button icon={<Download size={14} />} loading={exportLoading} onClick={handleExportExcel}>导出 Excel</Button>
      <Button icon={<Download size={14} />} loading={exportCsvLoading} onClick={handleExportCsv}>导出 CSV</Button>
    </>
  );
  const renderCreateButton = () => hasPermission('system:department:create') ? (
    <Button
      type="primary"
      icon={<Plus size={14} />}
      onClick={() => {
        setEditingDepartment(null);
        setModalVisible(true);
        void fetchLeaderOptions();
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
            {renderExpandButton()}
            {renderMobileExportActions()}
          </>
        )}
        filterTitle="部门筛选"
        actionTitle="部门操作"
        onFilterApply={() => void fetchDepartments()}
        onFilterReset={handleReset}
      />

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={data}
        loading={loading}
        onRefresh={fetchDepartments}
        refreshLoading={loading}
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
          setModalDetailLoading(false);
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
                loading={leaderSearchLoading}
                optionList={leaderOptions}
                onSearch={(keyword) => void fetchLeaderOptions(keyword)}
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
