import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Toast,
} from '@douyinfe/semi-ui';
import type { TreeNodeData } from '@douyinfe/semi-ui/lib/es/tree';
import { Search, Plus, RotateCcw, Download } from 'lucide-react';
import type { Department } from '@zenith/shared';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import DictTag from '@/components/DictTag';
import { useDictItems } from '@/hooks/useDictItems';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';

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
  const formApi = useRef<any>(null);
  const [loading, setLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [data, setData] = useState<Department[]>([]);
  const [allDepartments, setAllDepartments] = useState<Department[]>([]);
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearchParams);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingDepartment, setEditingDepartment] = useState<Department | null>(null);
  const { items: statusItems } = useDictItems('common_status');

  const fetchDepartments = useCallback(async (params = searchParams) => {
    setLoading(true);
    try {
      const query = new URLSearchParams({
        ...(params.keyword ? { keyword: params.keyword } : {}),
        ...(params.status ? { status: params.status } : {}),
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
  }, [searchParams]);

  useEffect(() => {
    void fetchDepartments();
  }, []);

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
        leader: editingDepartment.leader,
        phone: editingDepartment.phone,
        email: editingDepartment.email,
        sort: editingDepartment.sort,
        status: editingDepartment.status,
      }
    : {
        parentId: 0,
        sort: 0,
        status: 'active',
      };

  const handleReset = () => {
    setSearchParams(defaultSearchParams);
    void fetchDepartments(defaultSearchParams);
  };

  const handleModalOk = async () => {
    let values: any;
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

  const columns: ColumnProps<Department>[] = [
    { title: '部门名称', dataIndex: 'name', width: 220 },
    { title: '部门编码', dataIndex: 'code', width: 180, ellipsis: true },
    { title: '负责人', dataIndex: 'leader', width: 120, render: (value) => value || '—' },
    { title: '联系电话', dataIndex: 'phone', width: 140, render: (value) => value || '—' },
    { title: '邮箱', dataIndex: 'email', width: 200, ellipsis: true, render: (value) => value || '—' },
    { title: '排序', dataIndex: 'sort', width: 90 },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (value: string) => <DictTag dictCode="common_status" value={value} />,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 180,
      ellipsis: true,
      render: (value: string) => formatDateTime(value),
    },
    {
      title: '操作',
      fixed: 'right',
      width: 160,
      render: (_: unknown, record: Department) => (
        <Space>
          {hasPermission('system:department:update') && <Button
            theme="borderless"
            size="small"
            onClick={() => {
              setEditingDepartment(record);
              setModalVisible(true);
            }}
          >编辑</Button>}
          {hasPermission('system:department:delete') && <Button theme="borderless" type="danger" size="small" onClick={() => {
            Modal.confirm({
              title: '确定要删除该部门吗？',
              okButtonProps: { type: 'danger', theme: 'solid' },
              onOk: () => handleDelete(record.id),
            });
          }}>删除</Button>}
        </Space>
      ),
    },
  ];

  return (
    <div className="page-container">
      <div className="search-area">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Space wrap>
            <Input
              prefix={<Search size={14} />}
              placeholder="搜索部门名称/编码"
              value={searchParams.keyword}
              onChange={(value) => setSearchParams((prev) => ({ ...prev, keyword: value }))}
              onEnterPress={() => void fetchDepartments()}
              style={{ width: 240 }}
              showClear
            />
            <Select
              placeholder="请选择状态"
              value={searchParams.status || undefined}
              onChange={(value) => setSearchParams((prev) => ({ ...prev, status: (value as string) ?? '' }))}
              style={{ width: 140 }}
              optionList={[
                { value: '', label: '全部状态' },
                ...statusItems.map((item) => ({ value: item.value, label: item.label })),
              ]}
            />
            <Button type="primary" icon={<Search size={14} />} onClick={() => void fetchDepartments()}>查询</Button>
            <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
          </Space>
          <Space>
            <Button icon={<Download size={14} />} loading={exportLoading} onClick={async () => { setExportLoading(true); try { await request.download('/api/departments/export', '部门列表.xlsx'); } finally { setExportLoading(false); } }}>导出</Button>
            {hasPermission('system:department:create') && <Button
              type="secondary"
              icon={<Plus size={14} />}
              onClick={() => {
                setEditingDepartment(null);
                setModalVisible(true);
              }}
            >
              新增
            </Button>}
          </Space>
        </div>
      </div>

      <Table
        bordered
        className="admin-table-nowrap"
        columns={columns}
        dataSource={data}
        loading={loading}
        rowKey="id"
        pagination={false}
        empty="暂无数据"
      />

      <Modal
        title={editingDepartment ? '编辑部门' : '新增部门'}
        visible={modalVisible}
        onCancel={() => {
          setModalVisible(false);
          setEditingDepartment(null);
        }}
        onOk={handleModalOk}
        width={520}
        bodyStyle={{ paddingBottom: 24 }}
      >
        <Form
          key={editingDepartment?.id ?? 'new-department'}
          getFormApi={(api) => { formApi.current = api; }}
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
            expandAll
          />
          <Form.Input field="name" label="部门名称" rules={[{ required: true, message: '请输入部门名称' }]} />
          <Form.Input field="code" label="部门编码" rules={[{ required: true, message: '请输入部门编码' }]} />
          <Form.Input field="leader" label="负责人" />
          <Form.Input field="phone" label="联系电话" />
          <Form.Input field="email" label="邮箱" />
          <Form.InputNumber field="sort" label="排序" min={0} style={{ width: '100%' }} />
          <Form.Select
            field="status"
            label="状态"
            optionList={statusItems.map((item) => ({ value: item.value, label: item.label }))}
            style={{ width: '100%' }}
          />
        </Form>
      </Modal>
    </div>
  );
}
