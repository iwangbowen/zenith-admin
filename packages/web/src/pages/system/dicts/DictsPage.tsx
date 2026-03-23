import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Card,
  Table,
  Button,
  Input,
  Tag,
  Space,
  Modal,
  Form,
  Toast,
  Popconfirm,
  Empty,
  Typography,
} from '@douyinfe/semi-ui';
import { Search, Plus, RefreshCw, List } from 'lucide-react';
import type { Dict, DictItem } from '@zenith/shared';
import { request } from '../../../utils/request';
import DictTag from '../../../components/DictTag';
import { useDictItems } from '../../../hooks/useDictItems';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import './DictsPage.css';

const { Text } = Typography;

export default function DictsPage() {
  const dictFormApi = useRef<any>(null);
  const itemFormApi = useRef<any>(null);

  // ─── 字典列表 ──────────────────────────────────────────────────────────────
  const [dicts, setDicts] = useState<Dict[]>([]);
  const [dictsLoading, setDictsLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [dictModalVisible, setDictModalVisible] = useState(false);
  const [editingDict, setEditingDict] = useState<Dict | null>(null);

  // ─── 字典项列表 ────────────────────────────────────────────────────────────
  const [selectedDict, setSelectedDict] = useState<Dict | null>(null);
  const [items, setItems] = useState<DictItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemModalVisible, setItemModalVisible] = useState(false);
  const [editingItem, setEditingItem] = useState<DictItem | null>(null);
  const { items: statusItems } = useDictItems('common_status');

  // ─── 数据获取 ──────────────────────────────────────────────────────────────
  const fetchDicts = useCallback(async () => {
    setDictsLoading(true);
    try {
      const res = await request.get<Dict[]>(`/api/dicts?keyword=${encodeURIComponent(keyword)}`);
      if (res.code === 0) {
        setDicts(res.data);
        // 若当前选中字典已被删除则清除
        if (selectedDict && !res.data.some((d) => d.id === selectedDict.id)) {
          setSelectedDict(null);
          setItems([]);
        }
      }
    } finally {
      setDictsLoading(false);
    }
  }, [keyword, selectedDict]);

  const fetchItems = useCallback(async (dictId: number) => {
    setItemsLoading(true);
    try {
      const res = await request.get<DictItem[]>(`/api/dicts/${dictId}/items`);
      if (res.code === 0) setItems(res.data);
    } finally {
      setItemsLoading(false);
    }
  }, []);

  useEffect(() => { fetchDicts(); }, [fetchDicts]);

  const selectDict = (dict: Dict) => {
    setSelectedDict(dict);
    fetchItems(dict.id);
  };

  // ─── 字典 CRUD ─────────────────────────────────────────────────────────────
  const handleDictSubmit = async (values: Partial<Dict>) => {
    const res = editingDict
      ? await request.put(`/api/dicts/${editingDict.id}`, values)
      : await request.post('/api/dicts', values);
    if (res.code === 0) {
      Toast.success(editingDict ? '更新成功' : '创建成功');
      setDictModalVisible(false);
      fetchDicts();
    } else {
      Toast.error(res.message);
    }
  };

  const handleDictDelete = async (id: number) => {
    const res = await request.delete(`/api/dicts/${id}`);
    if (res.code === 0) {
      Toast.success('删除成功');
      if (selectedDict?.id === id) {
        setSelectedDict(null);
        setItems([]);
      }
      fetchDicts();
    } else {
      Toast.error(res.message);
    }
  };

  // ─── 字典项 CRUD ───────────────────────────────────────────────────────────
  const handleItemSubmit = async (values: Partial<DictItem>) => {
    if (!selectedDict) return;
    const res = editingItem
      ? await request.put(`/api/dicts/${selectedDict.id}/items/${editingItem.id}`, values)
      : await request.post(`/api/dicts/${selectedDict.id}/items`, values);
    if (res.code === 0) {
      Toast.success(editingItem ? '更新成功' : '创建成功');
      setItemModalVisible(false);
      fetchItems(selectedDict.id);
    } else {
      Toast.error(res.message);
    }
  };

  const handleItemDelete = async (id: number) => {
    if (!selectedDict) return;
    const res = await request.delete(`/api/dicts/${selectedDict.id}/items/${id}`);
    if (res.code === 0) {
      Toast.success('删除成功');
      fetchItems(selectedDict.id);
    } else {
      Toast.error(res.message);
    }
  };

  // ─── 表格列定义 ────────────────────────────────────────────────────────────
  const dictColumns: ColumnProps<Dict>[] = [
    {
      title: '字典名称',
      dataIndex: 'name',
      width: 220,
      ellipsis: { showTitle: false },
      render: (v, row) => (
        <button
          type="button"
          className={`dict-name-cell${selectedDict?.id === row.id ? ' dict-name-cell--active' : ''}`}
          onClick={() => selectDict(row)}
        >
          <List style={{ marginRight: 6, flexShrink: 0 }} />
          <span className="table-cell-ellipsis" title={String(v)}>{v}</span>
        </button>
      ),
    },
    { title: '字典编码', dataIndex: 'code', width: 160, ellipsis: true },
    {
      title: '状态',
      dataIndex: 'status',
      width: 80,
      align: 'center',
      render: (v: string) => <DictTag dictCode="common_status" value={v} />,
    },
    {
      title: '操作',
      fixed: 'right',
      width: 180,
      align: 'center',
      render: (_v, row) => (
        <Space>
          <Button
            theme="borderless"
            size="small"
            onClick={(e) => { e.stopPropagation(); setEditingDict(row); setDictModalVisible(true); }}
          >
            编辑
          </Button>
          <Popconfirm
            title="确认删除此字典？"
            content="字典下的所有字典项也将一并删除"
            okText="删除"
            okButtonProps={{ type: 'danger', theme: 'solid' }}
            onConfirm={() => handleDictDelete(row.id)}
          >
            <Button theme="borderless" size="small" type="danger" onClick={(e) => e.stopPropagation()}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const itemColumns: ColumnProps<DictItem>[] = [
    { title: '标签', dataIndex: 'label', width: 160, ellipsis: true },
    { title: '键值', dataIndex: 'value', width: 160, ellipsis: true },
    { title: '排序', dataIndex: 'sort', width: 70, align: 'center' },
    {
      title: '状态',
      dataIndex: 'status',
      width: 80,
      align: 'center',
      render: (v: string) => <DictTag dictCode="common_status" value={v} />,
    },
    { title: '备注', dataIndex: 'remark', ellipsis: true, render: (v) => v || '—' },
    {
      title: '操作',
      fixed: 'right',
      width: 180,
      align: 'center',
      render: (_v, row) => (
        <Space>
          <Button
            theme="borderless"
            size="small"
            onClick={() => { setEditingItem(row); setItemModalVisible(true); }}
          >
            编辑
          </Button>
          <Popconfirm
            title="确认删除此字典项？"
            okText="删除"
            okButtonProps={{ type: 'danger', theme: 'solid' }}
            onConfirm={() => handleItemDelete(row.id)}
          >
            <Button theme="borderless" size="small" type="danger">删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h2 className="page-title">字典管理</h2>
          <p className="page-desc">管理系统数据字典及字典项</p>
        </div>
      </div>

      <div className="dicts-layout">
        {/* 左侧：字典列表 */}
        <Card className="dicts-left-card">
          <div className="dicts-panel-toolbar">
            <Input
              prefix={<Search />}
              placeholder="搜索字典名称/编码"
              value={keyword}
              onChange={(v) => setKeyword(v)}
              showClear
              style={{ flex: 1 }}
            />
            <Button icon={<RefreshCw />} onClick={fetchDicts} />
            <Button
              type="primary"
              icon={<Plus />}
              onClick={() => { setEditingDict(null); setDictModalVisible(true); }}
            >
              新增
            </Button>
          </div>
          <Table
            className="admin-table-nowrap"
            columns={dictColumns}
            dataSource={dicts}
            rowKey="id"
            loading={dictsLoading}
            pagination={false}
            size="small"
            onRow={(row) => ({
              onClick: () => row && selectDict(row),
              style: {
                cursor: 'pointer',
                background: row?.id === selectedDict?.id ? 'var(--semi-color-primary-light-default)' : undefined,
              },
            })}
          />
        </Card>

        {/* 右侧：字典项列表 */}
        <Card className="dicts-right-card">
          {selectedDict ? (
            <>
              <div className="dicts-panel-toolbar">
                <Text strong style={{ fontSize: 14 }}>
                  字典项：{selectedDict.name}
                  <Tag size="small" color="blue" style={{ marginLeft: 8 }}>{selectedDict.code}</Tag>
                </Text>
                <Space style={{ marginLeft: 'auto' }}>
                  <Button icon={<RefreshCw />} onClick={() => fetchItems(selectedDict.id)} />
                  <Button
                    type="primary"
                    icon={<Plus />}
                    onClick={() => { setEditingItem(null); setItemModalVisible(true); }}
                  >
                    新增字典项
                  </Button>
                </Space>
              </div>
              <Table
                className="admin-table-nowrap"
                columns={itemColumns}
                dataSource={items}
                rowKey="id"
                loading={itemsLoading}
                pagination={false}
                size="small"
              />
            </>
          ) : (
            <Empty
              image={<List size={32} style={{ color: 'var(--semi-color-text-2)' }} />}
              title="请选择字典"
              description="点击左侧字典查看其字典项"
              style={{ padding: '60px 0' }}
            />
          )}
        </Card>
      </div>

      {/* 字典创建/编辑 Modal */}
      <Modal
        title={editingDict ? '编辑字典' : '新增字典'}
        visible={dictModalVisible}
        onCancel={() => setDictModalVisible(false)}
        onOk={() => dictFormApi.current?.submit()}
        width={480}
        bodyStyle={{ paddingBottom: 24 }}
      >
        <Form
          getFormApi={(api) => dictFormApi.current = api}
          key={editingDict?.id ?? 'new-dict'}
          initValues={editingDict ?? { status: 'active' }}
          onSubmit={handleDictSubmit}
          labelPosition="left"
          labelWidth={80}
        >
          <Form.Input field="name" label="字典名称" rules={[{ required: true, message: '请输入字典名称' }]} />
          <Form.Input field="code" label="字典编码" rules={[{ required: true, message: '请输入字典编码' }]} />
          <Form.Input field="description" label="描述" />
          <Form.Select field="status" label="状态"
            optionList={statusItems.map((i) => ({ value: i.value, label: i.label }))}
          />
        </Form>
      </Modal>

      {/* 字典项创建/编辑 Modal */}
      <Modal
        title={editingItem ? '编辑字典项' : '新增字典项'}
        visible={itemModalVisible}
        onCancel={() => setItemModalVisible(false)}
        onOk={() => itemFormApi.current?.submit()}
        width={480}
        bodyStyle={{ paddingBottom: 24 }}
      >
        <Form
          getFormApi={(api) => itemFormApi.current = api}
          key={editingItem?.id ?? 'new-item'}
          initValues={editingItem ?? { status: 'active', sort: 0 }}
          onSubmit={handleItemSubmit}
          labelPosition="left"
          labelWidth={80}
        >
          <Form.Input field="label" label="标签" rules={[{ required: true, message: '请输入标签' }]} />
          <Form.Input field="value" label="键值" rules={[{ required: true, message: '请输入键值' }]} />
          <Form.InputNumber field="sort" label="排序" min={0} />
          <Form.Select field="status" label="状态"
            optionList={statusItems.map((i) => ({ value: i.value, label: i.label }))}
          />
          <Form.Input field="remark" label="备注" />
        </Form>
      </Modal>
    </div>
  );
}
