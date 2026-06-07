import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Spin,
  Toast,
  Popconfirm,
  SplitButtonGroup,
  Dropdown,
  Switch,
} from '@douyinfe/semi-ui';
import type { CascaderData } from '@douyinfe/semi-ui/lib/es/cascader';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, Plus, RotateCcw, ChevronsDownUp, ChevronsUpDown, Download, ChevronDown } from 'lucide-react';
import type { Region } from '@zenith/shared';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { useDictItems } from '@/hooks/useDictItems';
import { request } from '@/utils/request';
import { createdAtColumn } from '@/utils/table-columns';
import { usePermission } from '@/hooks/usePermission';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';

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
  const [exportLoading, setExportLoading] = useState(false);
  const [exportCsvLoading, setExportCsvLoading] = useState(false);
  const [data, setData] = useState<Region[]>([]);
  const [flatData, setFlatData] = useState<Region[]>([]);
  const [flatLoading, setFlatLoading] = useState(false);
  const [togglingStatusId, setTogglingStatusId] = useState<number | null>(null);
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearchParams);
  const searchParamsRef = useRef<SearchParams>(defaultSearchParams);
  searchParamsRef.current = searchParams;
  const [modalVisible, setModalVisible] = useState(false);
  const [editingRegion, setEditingRegion] = useState<Region | null>(null);
  const [editingLevel, setEditingLevel] = useState<string>('province');
  const [modalDetailLoading, setModalDetailLoading] = useState(false);
  const [expandedRowKeys, setExpandedRowKeys] = useState<(string | number)[]>([]);
  const [tableHeight, setTableHeight] = useState(500);
  const [tableWidth, setTableWidth] = useState(0);
  const tableWrapperRef = useRef<HTMLDivElement>(null);

  const { items: statusItems } = useDictItems('common_status');

  useEffect(() => {
    const el = tableWrapperRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setTableHeight(Math.floor(entry.contentRect.height));
        setTableWidth(Math.floor(entry.contentRect.width));
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const fetchRegions = useCallback(async (params?: SearchParams) => {
    const activeParams = params ?? searchParamsRef.current;
    setLoading(true);
    try {
      const queryObj: Record<string, string> = {};
      if (activeParams.keyword) queryObj.keyword = activeParams.keyword;
      if (activeParams.status) queryObj.status = activeParams.status;
      if (activeParams.level) queryObj.level = activeParams.level;

      const query = new URLSearchParams(queryObj).toString();
      const res = await request.get<Region[]>(query ? `/api/regions?${query}` : '/api/regions');
      if (res.code === 0) setData(res.data);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchFlatData = useCallback(async () => {
    setFlatLoading(true);
    try {
      const res = await request.get<Region[]>('/api/regions/flat');
      if (res.code === 0) setFlatData(res.data);
    } finally {
      setFlatLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchRegions();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSearch() {
    void fetchRegions(searchParamsRef.current);
  }

  function handleReset() {
    setSearchParams(defaultSearchParams);
    void fetchRegions(defaultSearchParams);
  }

  // 递归收集所有节点 ID
  const allRowKeys = useMemo(() => {
    const keys: number[] = [];
    function collect(items: Region[]) {
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

  async function openCreate() {
    setEditingRegion(null);
    setEditingLevel('province');
    setModalVisible(true);
    void fetchFlatData();
  }

  async function openEdit(record: Region) {
    setEditingRegion(record);
    setEditingLevel(record.level);
    setModalVisible(true);
    void fetchFlatData();
    setModalDetailLoading(true);
    const res = await request.get<Region>(`/api/regions/${record.id}`);
    setModalDetailLoading(false);
    if (res.code === 0 && res.data) {
      setEditingRegion(res.data);
      setEditingLevel(res.data.level);
    } else {
      Toast.error(res.message || '获取信息失败');
    }
  }

  function closeModal() {
    setModalVisible(false);
    setEditingRegion(null);
    setEditingLevel('province');
    setModalDetailLoading(false);
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
    : { level: 'province', sort: 0, status: 'enabled' };

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

  const handleToggleStatus = useCallback(async (region: Region, newStatus: 'enabled' | 'disabled') => {
    if (newStatus === 'disabled') {
      const confirmed = await new Promise<boolean>((resolve) => {
        Modal.confirm({
          title: `确认禁用「${region.name}」？`,
          okButtonProps: { type: 'danger', theme: 'solid' },
          okText: '确认禁用',
          cancelText: '取消',
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });
      if (!confirmed) return;
    }
    setTogglingStatusId(region.id);
    try {
      const res = await request.put(`/api/regions/${region.id}`, { status: newStatus });
      if (res.code === 0) {
        Toast.success(newStatus === 'enabled' ? '已启用' : '已禁用');
        void fetchRegions();
      } else {
        Toast.error(res.message || '操作失败');
      }
    } finally {
      setTogglingStatusId(null);
    }
  }, [fetchRegions]);

  const FIXED_COLS_WIDTH = 140 + 90 + 120 + 70 + 180 + 90 + 160; // 其他列总宽
  const nameColWidth = Math.max(240, tableWidth - FIXED_COLS_WIDTH);
  const totalTableWidth = nameColWidth + FIXED_COLS_WIDTH;

  const columns: ColumnProps<Region>[] = [
    {
      title: '地区名称',
      dataIndex: 'name',
      width: nameColWidth,
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
      width: 70,
      align: 'center',
    },
    createdAtColumn,
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      align: 'center',
      fixed: 'right',
      render: (v: string, record: Region) => (
        <Switch
          size="small"
          checked={v === 'enabled'}
          loading={togglingStatusId === record.id}
          disabled={!hasPermission('system:region:update')}
          onChange={(checked: boolean) => void handleToggleStatus(record, checked ? 'enabled' : 'disabled')}
        />
      ),
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
    <div className="page-container regions-page" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <SearchToolbar>
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
          <Button
            type="primary"
            icon={isAllExpanded ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
            onClick={toggleExpandAll}
          >
            {isAllExpanded ? '全部折叠' : '全部展开'}
          </Button>
          {hasPermission('system:region:export') && (
            <SplitButtonGroup>
              <Button
                type="primary"
                icon={<Download size={14} />}
                loading={exportLoading}
                onClick={async () => {
                  setExportLoading(true);
                  try { await request.download('/api/regions/export', '地区列表.xlsx'); }
                  finally { setExportLoading(false); }
                }}
              >
                导出
              </Button>
              <Dropdown
                trigger="click"
                position="bottomRight"
                clickToHide
                render={(
                  <Dropdown.Menu>
                    <Dropdown.Item onClick={async () => { setExportLoading(true); try { await request.download('/api/regions/export', '地区列表.xlsx'); } finally { setExportLoading(false); } }}>导出 Excel</Dropdown.Item>
                    <Dropdown.Item onClick={async () => { setExportCsvLoading(true); try { await request.download('/api/regions/export/csv', '地区列表.csv'); } finally { setExportCsvLoading(false); } }}>导出 CSV</Dropdown.Item>
                  </Dropdown.Menu>
                )}
              >
                <Button type="primary" icon={<ChevronDown size={14} />} loading={exportCsvLoading} />
              </Dropdown>
            </SplitButtonGroup>
          )}
          {hasPermission('system:region:create') && (
            <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>
              新增
            </Button>
          )}
      </SearchToolbar>

      <div ref={tableWrapperRef} style={{ flex: 1, minHeight: 0, overflowX: 'auto', overflowY: 'hidden' }}>
        <ConfigurableTable
          bordered
          columns={columns}
          dataSource={data}
          loading={loading}
          onRefresh={() => void fetchRegions()}
          refreshLoading={loading}
          rowKey="id"
          size="small"
        expandedRowKeys={expandedRowKeys}
        onExpandedRowsChange={(rows) => setExpandedRowKeys(rows?.filter((r): r is Region => 'id' in r).map((r) => r.id) ?? [])}
        childrenRecordName="children"
        pagination={false}
        virtualized
        scroll={{ y: tableHeight, x: totalTableWidth }}
      />
      </div>

      <Modal
        title={editingRegion ? '编辑地区' : '新增地区'}
        visible={modalVisible}
        onOk={handleModalOk}
        onCancel={closeModal}
        okButtonProps={{ disabled: modalDetailLoading }}
        width={520}
        maskClosable={false}
      >
        <Spin spinning={modalDetailLoading} wrapperClassName="modal-spin-wrapper">
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
            placeholder="请选择级别"
            style={{ width: '100%' }}
          />
          {editingLevel !== 'province' && (
            <Form.Cascader
              field="parentCode"
              label="父级地区"
              placeholder={flatLoading ? '加载父级地区中...' : '请选择父级地区'}
              treeData={parentTreeData}
              changeOnSelect
              filterTreeNode
              showClear
              disabled={flatLoading}
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
            style={{ width: '100%' }}
          />
          <Form.Select
            field="status"
            label="状态"
            optionList={statusItems.map((i) => ({ value: i.value, label: i.label }))}
            rules={[{ required: true, message: '请选择状态' }]}
            placeholder="请选择状态"
            style={{ width: '100%' }}
          />
        </Form>
        </Spin>
      </Modal>
    </div>
  );
}
