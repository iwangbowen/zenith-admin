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
  Popconfirm,
} from '@douyinfe/semi-ui';
import type { CascaderData } from '@douyinfe/semi-ui/lib/es/cascader';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, Plus, RotateCcw } from 'lucide-react';
import type { Region } from '@zenith/shared';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import DictTag from '@/components/DictTag';
import { useDictItems } from '@/hooks/useDictItems';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';

const LEVEL_LABELS: Record<string, string> = {
  province: '省级',
  city: '地级',
  county: '县级',
};

const LEVEL_OPTIONS = [
  { value: 'province', label: '省级' },
  { value: 'city', label: '地级' },
  { value: 'county', label: '县级' },
];

interface SearchParams {
  keyword: string;
  status: string;
  level: string;
}

const defaultSearchParams: SearchParams = { keyword: '', status: '', level: '' };

export default function RegionsPage() {
  const { hasPermission } = usePermission();
  const formApi = useRef<FormApi | null>(null);

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Region[]>([]);
  const [flatData, setFlatData] = useState<Region[]>([]);
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearchParams);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingRegion, setEditingRegion] = useState<Region | null>(null);
  const [editingLevel, setEditingLevel] = useState<string>('province');

  const { items: statusItems } = useDictItems('common_status');

  const fetchRegions = useCallback(async (params = searchParams) => {
    setLoading(true);
    try {
      const queryObj: Record<string, string> = {};
      if (params.keyword) queryObj.keyword = params.keyword;
      if (params.status) queryObj.status = params.status;
      if (params.level) queryObj.level = params.level;

      const query = new URLSearchParams(queryObj).toString();
      const [treeRes, flatRes] = await Promise.all([
        request.get<Region[]>(query ? `/api/regions?${query}` : '/api/regions'),
        request.get<Region[]>('/api/regions/flat'),
      ]);
      if (treeRes.code === 0) setData(treeRes.data);
      if (flatRes.code === 0) setFlatData(flatRes.data);
    } finally {
      setLoading(false);
    }
  }, [searchParams]);

  useEffect(() => {
    void fetchRegions();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSearch() {
    void fetchRegions(searchParams);
  }

  function handleReset() {
    setSearchParams(defaultSearchParams);
    void fetchRegions(defaultSearchParams);
  }

  function openCreate() {
    setEditingRegion(null);
    setEditingLevel('province');
    setModalVisible(true);
  }

  function openEdit(record: Region) {
    setEditingRegion(record);
    setEditingLevel(record.level);
    setModalVisible(true);
  }

  function closeModal() {
    setModalVisible(false);
    setEditingRegion(null);
    setEditingLevel('province');
  }

  // 构建 Cascader 树数据：省→市 两级
  const cascaderTreeData = useMemo<CascaderData[]>(() => {
    const provinces = flatData.filter((r) => r.level === 'province');
    const cities = flatData.filter((r) => r.level === 'city');
    return provinces.map((prov) => ({
      value: prov.code,
      label: `${prov.name}（${prov.code}）`,
      children: cities
        .filter((c) => c.parentCode === prov.code)
        .map((c) => ({ value: c.code, label: `${c.name}（${c.code}）` })),
    }));
  }, [flatData]);

  // 根据 editingLevel 决定展示的 treeData（市级只需一层省，县级需省→市两层）
  const parentTreeData = useMemo<CascaderData[]>(() => {
    if (editingLevel === 'city') {
      return cascaderTreeData.map(({ children: _c, ...rest }) => rest);
    }
    return cascaderTreeData;
  }, [cascaderTreeData, editingLevel]);

  // 从 parentCode 反推 Cascader 路径（用于编辑回显）
  function buildCascaderPath(parentCode: string | null | undefined): string[] {
    if (!parentCode) return [];
    const target = flatData.find((r) => r.code === parentCode);
    if (!target) return [parentCode];
    if (target.level === 'province') return [target.code];
    if (target.level === 'city' && target.parentCode) return [target.parentCode, target.code];
    return [parentCode];
  }

  const formInitValues = editingRegion
    ? {
        code: editingRegion.code,
        name: editingRegion.name,
        level: editingRegion.level,
        parentCode: buildCascaderPath(editingRegion.parentCode),
        sort: editingRegion.sort,
        status: editingRegion.status,
      }
    : { level: 'province', sort: 0, status: 'active' };

  async function handleModalOk() {
    let values;
    try {
      values = await formApi.current?.validate();
    } catch {
      throw new Error('validation');
    }
    if (!values) throw new Error('validation');

    const parentCodeArr = Array.isArray(values.parentCode) ? values.parentCode : [];
    const payload = {
      ...values,
      parentCode: values.level === 'province' ? null : (parentCodeArr.at(-1) ?? null),
    };

    const res = editingRegion
      ? await request.put(`/api/regions/${editingRegion.id}`, payload)
      : await request.post('/api/regions', payload);

    if (res.code === 0) {
      Toast.success(editingRegion ? '更新成功' : '创建成功');
      closeModal();
      void fetchRegions();
    } else {
      throw new Error(res.message);
    }
  }

  async function handleDelete(id: number) {
    const res = await request.delete(`/api/regions/${id}`);
    if (res.code === 0) {
      Toast.success('删除成功');
      void fetchRegions();
    }
  }

  const columns: ColumnProps<Region>[] = [
    {
      title: '地区名称',
      dataIndex: 'name',
      width: 200,
    },
    {
      title: '区划代码',
      dataIndex: 'code',
      width: 140,
    },
    {
      title: '级别',
      dataIndex: 'level',
      width: 90,
      render: (val: string) => LEVEL_LABELS[val] ?? val,
    },
    {
      title: '父级代码',
      dataIndex: 'parentCode',
      width: 120,
      render: (val: string | null) => val ?? '—',
    },
    {
      title: '排序',
      dataIndex: 'sort',
      width: 80,
    },
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
      render: (val: string) => formatDateTime(val),
    },
    {
      title: '操作',
      fixed: 'right',
      width: 160,
      render: (_: unknown, record: Region) => (
        <Space>
          {hasPermission('system:region:update') && (
            <Button
              theme="borderless"
              size="small"
              onClick={() => openEdit(record)}
            >
              编辑
            </Button>
          )}
          {hasPermission('system:region:delete') && (
            <Popconfirm
              title="确定要删除该地区吗？"
              content="若有子地区，需先删除子地区"
              onConfirm={() => handleDelete(record.id)}
            >
              <Button theme="borderless" type="danger" size="small">
                删除
              </Button>
            </Popconfirm>
          )}
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
              placeholder="搜索名称或代码..."
              value={searchParams.keyword}
              onChange={(v) => setSearchParams((p) => ({ ...p, keyword: v }))}
              showClear
              style={{ width: 220 }}
              onEnterPress={handleSearch}
            />
            <Select
              placeholder="全部级别"
              value={searchParams.level || undefined}
              onChange={(v) => setSearchParams((p) => ({ ...p, level: (v as string) ?? '' }))}
              showClear
              style={{ width: 110 }}
              optionList={LEVEL_OPTIONS}
            />
            <Select
              placeholder="全部状态"
              value={searchParams.status || undefined}
              onChange={(v) => setSearchParams((p) => ({ ...p, status: (v as string) ?? '' }))}
              showClear
              style={{ width: 110 }}
              optionList={statusItems.map((i) => ({ value: i.value, label: i.label }))}
            />
            <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>
              查询
            </Button>
            <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>
              重置
            </Button>
          </Space>
          <Space>
            {hasPermission('system:region:create') && (
              <Button type="secondary" icon={<Plus size={14} />} onClick={openCreate}>
                新增
              </Button>
            )}
          </Space>
        </div>
      </div>

      <Table
        bordered
        columns={columns}
        dataSource={data}
        loading={loading}
        rowKey="id"
        size="small"
        expandAllRows={false}
        childrenRecordName="children"
        pagination={false}
        scroll={{ x: 'max-content' }}
      />

      <Modal
        title={editingRegion ? '编辑地区' : '新增地区'}
        visible={modalVisible}
        onOk={handleModalOk}
        onCancel={closeModal}
        width={520}
        maskClosable={false}
      >
        <Form
          key={editingRegion?.id ?? 'new'}
          getFormApi={(api) => { formApi.current = api; }}
          initValues={formInitValues}
          labelPosition="left"
          labelWidth={90}
        >
          <Form.Select
            field="level"
            label="级别"
            optionList={LEVEL_OPTIONS}
            rules={[{ required: true, message: '请选择级别' }]}
            onChange={(v) => setEditingLevel(v as string)}
          />
          {editingLevel !== 'province' && (
            <Form.Cascader
              field="parentCode"
              label="父级地区"
              placeholder="请选择父级地区"
              treeData={parentTreeData}
              changeOnSelect
              filterTreeNode
              showClear
              rules={[{ required: true, message: '请选择父级地区' }]}
              style={{ width: '100%' }}
            />
          )}
          <Form.Input
            field="code"
            label="区划代码"
            placeholder="请输入区划代码"
            rules={[{ required: true, message: '区划代码不能为空' }]}
          />
          <Form.Input
            field="name"
            label="地区名称"
            placeholder="请输入地区名称"
            rules={[{ required: true, message: '名称不能为空' }]}
          />
          <Form.InputNumber
            field="sort"
            label="排序"
            placeholder="排序值"
            min={0}
          />
          <Form.Select
            field="status"
            label="状态"
            optionList={statusItems.map((i) => ({ value: i.value, label: i.label }))}
            rules={[{ required: true, message: '请选择状态' }]}
          />
        </Form>
      </Modal>
    </div>
  );
}
