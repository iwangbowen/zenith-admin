import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Button,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Spin,
  Toast,
  Typography,
  Switch,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form';
import { Plus, RotateCcw, Search, Tags, Trash2 } from 'lucide-react';
import type { Tag, PaginatedResponse } from '@zenith/shared';
import { usePermission } from '@/hooks/usePermission';
import { useDictItems } from '@/hooks/useDictItems';
import { request } from '@/utils/request';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createdAtColumn } from '../../../utils/table-columns';
import { usePagination } from '@/hooks/usePagination';

const { Text } = Typography;

function ColorDot({ color }: { color: string | null }) {
  return color ? (
    <span
      style={{
        display: 'inline-block',
        width: 12,
        height: 12,
        borderRadius: '50%',
        backgroundColor: color,
        border: '1px solid rgba(0,0,0,0.12)',
        verticalAlign: 'middle',
        marginRight: 6,
        flexShrink: 0,
      }}
    />
  ) : (
    <Tags size={12} style={{ color: 'var(--semi-color-text-3)', marginRight: 6, verticalAlign: 'middle' }} />
  );
}

function ColorInput({ value, onChange }: { readonly value?: string; readonly onChange?: (v: string) => void }) {
  const [text, setText] = useState(value ?? '');
  const nativeRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setText(value ?? ''); }, [value]);

  const isValidHex = (v: string) => /^#[0-9a-fA-F]{6}$/.test(v);

  const handleTextChange = (v: string) => {
    setText(v);
    if (isValidHex(v) || v === '') onChange?.(v);
  };

  const handleNativeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const c = e.target.value;
    setText(c);
    onChange?.(c);
  };

  return (
    <Input
      value={text}
      onChange={handleTextChange}
      placeholder="#2563eb（留空则无颜色）"
      prefix={
        <button
          type="button"
          title="点击选色"
          style={{
            display: 'inline-flex',
            width: 16,
            height: 16,
            borderRadius: 3,
            background: isValidHex(text) ? text : '#e5e7eb',
            border: '1px solid rgba(0,0,0,0.15)',
            cursor: 'pointer',
            overflow: 'hidden',
            position: 'relative',
            padding: 0,
            flexShrink: 0,
          }}
          onClick={() => nativeRef.current?.click()}
        >
          <input
            ref={nativeRef}
            type="color"
            value={isValidHex(text) ? text : '#2563eb'}
            onChange={handleNativeChange}
            style={{
              position: 'absolute',
              width: '300%',
              height: '300%',
              top: '-100%',
              left: '-100%',
              opacity: 0,
              cursor: 'pointer',
              border: 'none',
              padding: 0,
            }}
          />
        </button>
      }
    />
  );
}

export default function TagsPage() {
  const { hasPermission: can } = usePermission();
  const { items: statusItems } = useDictItems('common_status');

  interface SearchParams { keyword: string; filterStatus: string | undefined; filterGroup: string | undefined; }
  const defaultSearchParams: SearchParams = { keyword: '', filterStatus: undefined, filterGroup: undefined };
  const [loading, setLoading] = useState(false);
  const [list, setList] = useState<Tag[]>([]);
  const [total, setTotal] = useState(0);
  const { page, pageSize, setPage, setPageSize, buildPagination } = usePagination();
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearchParams);
  const searchParamsRef = useRef<SearchParams>(defaultSearchParams);
  searchParamsRef.current = searchParams;
  const [groups, setGroups] = useState<string[]>([]);

  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);

  const [modalVisible, setModalVisible] = useState(false);
  const [editRecord, setEditRecord] = useState<Tag | null>(null);
  const [modalDetailLoading, setModalDetailLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const formRef = useRef<FormApi>(null);
  const [colorValue, setColorValue] = useState('');

  const fetchGroups = useCallback(async () => {
    try {
      const res = await request.get<string[]>('/api/tags/groups');
      setGroups(res.data ?? []);
    } catch {
      // 分组列表加载失败不影响主功能
    }
  }, []);

  const fetchList = useCallback(
    async (p = page, ps = pageSize, params?: SearchParams) => {
      const { keyword: kw, filterStatus: st, filterGroup: gn } = params ?? searchParamsRef.current;
      setLoading(true);
      try {
        const query = new URLSearchParams({ page: String(p), pageSize: String(ps) });
        if (kw) query.set('keyword', kw);
        if (st) query.set('status', st);
        if (gn) query.set('groupName', gn);
        const res = await request.get<PaginatedResponse<Tag>>(`/api/tags?${query}`);
        setList(res.data?.list ?? []);
        setTotal(res.data?.total ?? 0);
        setPage(res.data?.page ?? p);
        setPageSize(res.data?.pageSize ?? ps);
      } finally {
        setLoading(false);
      }
    },
    [page, pageSize],
  );

  useEffect(() => {
    void fetchList(1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { void fetchGroups(); }, [fetchGroups]);

  const handleSearch = () => { setPage(1); void fetchList(1, pageSize); };

  const handleReset = () => {
    setSearchParams(defaultSearchParams);
    setPage(1);
    void fetchList(1, pageSize, defaultSearchParams);
  };

  const openCreate = () => {
    setEditRecord(null);
    setColorValue('');
    setModalVisible(true);
  };

  const openEdit = async (record: Tag) => {
    setEditRecord(record);
    setColorValue(record.color ?? '');
    setModalVisible(true);
    setModalDetailLoading(true);
    const res = await request.get<Tag>(`/api/tags/${record.id}`);
    setModalDetailLoading(false);
    if (res.code === 0 && res.data) {
      setEditRecord(res.data);
      setColorValue(res.data.color ?? '');
    } else {
      Toast.error(res.message || '获取信息失败');
    }
  };

  const handleSubmit = async () => {
    let values: Awaited<ReturnType<FormApi['validate']>>;
    try {
      values = (await formRef.current?.validate())!;
    } catch {
      throw new Error('validation');
    }
    setSubmitting(true);
    try {
      const payload = { ...values, color: colorValue || null };
      if (editRecord) {
        await request.put(`/api/tags/${editRecord.id}`, payload);
        Toast.success('更新成功');
      } else {
        await request.post('/api/tags', payload);
        Toast.success('创建成功');
      }
      setModalVisible(false);
      void fetchList();
      void fetchGroups();
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message;
      if (msg) Toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = (id: number) => {
    Modal.confirm({
      title: '确定要删除该标签吗？',
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        await request.delete(`/api/tags/${id}`);
        Toast.success('删除成功');
        setSelectedRowKeys(selectedRowKeys.filter((k) => k !== id));
        void fetchList();
      },
    });
  };

  const handleBatchDelete = () => {
    if (!selectedRowKeys.length) return;
    Modal.confirm({
      title: `确认删除选中的 ${selectedRowKeys.length} 条标签？`,
      content: '删除后无法恢复，请谨慎操作。',
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        await request.delete('/api/tags/batch', { ids: selectedRowKeys });
        Toast.success(`已删除 ${selectedRowKeys.length} 条标签`);
        setSelectedRowKeys([]);
        void fetchList();
      },
    });
  };

  const [togglingStatusId, setTogglingStatusId] = useState<number | null>(null);

  const handleToggleStatus = useCallback(async (tag: Tag, newStatus: 'enabled' | 'disabled') => {
    if (newStatus === 'disabled') {
      const confirmed = await new Promise<boolean>((resolve) => {
        Modal.confirm({
          title: `确认禁用标签「${tag.name}」？`,
          okButtonProps: { type: 'danger', theme: 'solid' },
          okText: '确认禁用',
          cancelText: '取消',
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });
      if (!confirmed) return;
    }
    setTogglingStatusId(tag.id);
    try {
      const res = await request.put(`/api/tags/${tag.id}`, { status: newStatus });
      if (res.code === 0) {
        Toast.success(newStatus === 'enabled' ? '已启用' : '已禁用');
        void fetchList();
      } else {
        Toast.error(res.message || '操作失败');
      }
    } finally {
      setTogglingStatusId(null);
    }
  }, [fetchList]);

  const columns = [
    {
      title: '标签名称',
      dataIndex: 'name',
      render: (_: unknown, record: Tag) => (
        <Space align="center" spacing={0}>
          <ColorDot color={record.color} />
          <span>{record.name}</span>
        </Space>
      ),
    },
    {
      title: '所属分组',
      dataIndex: 'groupName',
      render: (v: string | null) =>
        v ? <Text>{v}</Text> : <Text type="quaternary">—</Text>,
    },
    {
      title: '描述',
      dataIndex: 'description',
      render: (v: string | null) => v ? <Text ellipsis={{ showTooltip: true }}>{v}</Text> : <Text type="quaternary">—</Text>,
    },
    {
      title: '排序',
      dataIndex: 'sortOrder',
      width: 80,
    },
    createdAtColumn,
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      align: 'center' as const,
      fixed: 'right' as const,
      render: (v: string, record: Tag) => (
        <Switch
          size="small"
          checked={v === 'enabled'}
          loading={togglingStatusId === record.id}
          disabled={!can('system:tag:update')}
          onChange={(checked: boolean) => void handleToggleStatus(record, checked ? 'enabled' : 'disabled')}
        />
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 130,
      fixed: 'right' as const,
      render: (_: unknown, record: Tag) => (
        <Space>
          {can('system:tag:update') && (
            <Button theme="borderless" size="small" onClick={() => openEdit(record)}>
              编辑
            </Button>
          )}
          {can('system:tag:delete') && (
            <Button
              theme="borderless"
              type="danger"
              size="small"
              onClick={() => handleDelete(record.id)}
            >
              删除
            </Button>
          )}
        </Space>
      ),
    },
  ];

  const groupOptions = groups.map((g) => ({ label: g, value: g }));

  return (
    <div className="page-container">
      <SearchToolbar>
        <Input
          prefix={<Search size={14} />}
          placeholder="搜索标签名称或描述"
          value={searchParams.keyword}
          onChange={(v) => setSearchParams({ ...searchParams, keyword: v })}
          onEnterPress={handleSearch}
          showClear
          style={{ width: 200 }}
        />
        <Select
          placeholder="所属分组"
          value={searchParams.filterGroup}
          onChange={(v) => setSearchParams({ ...searchParams, filterGroup: v as string | undefined })}
          optionList={groupOptions}
          showClear
          style={{ width: 160 }}
        />
        <Select
          placeholder="状态"
          value={searchParams.filterStatus}
          onChange={(v) => setSearchParams({ ...searchParams, filterStatus: v as string | undefined })}
          optionList={statusItems.map((i) => ({ label: i.label, value: i.value }))}
          showClear
          style={{ width: 100 }}
        />
        <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>
          查询
        </Button>
        <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>
          重置
        </Button>
        {can('system:tag:delete') && selectedRowKeys.length > 0 && (
          <Button type="danger" theme="light" icon={<Trash2 size={14} />} onClick={handleBatchDelete}>
            批量删除 ({selectedRowKeys.length})
          </Button>
        )}
        {can('system:tag:create') && (
          <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>
            新增
          </Button>
        )}
      </SearchToolbar>

      <ConfigurableTable
        bordered
        loading={loading}
        onRefresh={() => void fetchList()}
        refreshLoading={loading}
        columns={columns}
        dataSource={list}
        rowKey="id"
        rowSelection={
          can('system:tag:delete')
            ? {
                selectedRowKeys,
                onChange: (keys: (string | number)[] | undefined) =>
                  setSelectedRowKeys((keys ?? []) as number[]),
              }
            : undefined
        }
        pagination={buildPagination(total, fetchList)}
        scroll={{ x: 900 }}
      />

      <Modal
        title={editRecord ? '编辑标签' : '新增标签'}
        visible={modalVisible}
        onOk={handleSubmit}
        onCancel={() => { setModalVisible(false); setEditRecord(null); setModalDetailLoading(false); }}
        confirmLoading={submitting}
        okButtonProps={{ disabled: modalDetailLoading }}
        afterClose={() => { setColorValue(''); }}
        width={520}

      >
        <Spin spinning={modalDetailLoading} wrapperClassName="modal-spin-wrapper">
        <Form
          key={editRecord?.id ?? 'new'}
          getFormApi={(api) => {
            (formRef as { current: FormApi }).current = api;
          }}
          allowEmpty
          labelPosition="left"
          labelWidth={90}
          initValues={
            editRecord
              ? {
                  name: editRecord.name,
                  groupName: editRecord.groupName ?? undefined,
                  description: editRecord.description ?? undefined,
                  status: editRecord.status,
                  sortOrder: editRecord.sortOrder,
                }
              : { status: 'enabled', sortOrder: 0 }
          }
        >
          <Form.Input
            field="name"
            label="标签名称"
            placeholder="请输入标签名称"
            rules={[{ required: true, message: '标签名称不能为空' }]}
          />
          <Form.Slot label="颜色">
            <ColorInput value={colorValue} onChange={setColorValue} />
          </Form.Slot>
          <Form.Input
            field="groupName"
            label="所属分组"
            placeholder="请输入分组名称（选填）"
          />
          <Form.TextArea
            field="description"
            label="描述"
            placeholder="请输入标签描述（选填）"
            rows={3}
          />
          <Form.Select
            field="status"
            label="状态"
            placeholder="请选择状态"
            style={{ width: '100%' }}
            optionList={statusItems.map((i) => ({ value: i.value, label: i.label }))}
          />
          <Form.InputNumber
            field="sortOrder"
            label="排序"
            min={0}
            max={9999}
            innerButtons
            style={{ width: '100%' }}
          />
        </Form>
        </Spin>
      </Modal>
    </div>
  );
}
