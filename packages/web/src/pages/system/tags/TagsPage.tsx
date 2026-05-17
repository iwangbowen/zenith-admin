import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Toast,
  Typography,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form';
import { Plus, RotateCcw, Search, Tags, Trash2 } from 'lucide-react';
import type { Tag, PaginatedResponse } from '@zenith/shared';
import { usePermission } from '@/hooks/usePermission';
import { request } from '@/utils/request';
import { SearchToolbar } from '@/components/SearchToolbar';

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

function ColorInput({ value, onChange }: { value?: string; onChange?: (v: string) => void }) {
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
        <span
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
        </span>
      }
    />
  );
}

export default function TagsPage() {
  const { hasPermission: can } = usePermission();

  const [loading, setLoading] = useState(false);
  const [list, setList] = useState<Tag[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const [keyword, setKeyword] = useState('');
  const [filterStatus, setFilterStatus] = useState<string | undefined>();
  const [filterGroup, setFilterGroup] = useState<string | undefined>();
  const [groups, setGroups] = useState<string[]>([]);

  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);

  const [modalVisible, setModalVisible] = useState(false);
  const [editRecord, setEditRecord] = useState<Tag | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const formRef = useRef<FormApi>(null);
  const [colorValue, setColorValue] = useState('');

  const fetchGroups = useCallback(async () => {
    try {
      const res = await request.get<string[]>('/api/tags/groups');
      setGroups(res.data ?? []);
    } catch {}
  }, []);

  const fetchList = useCallback(
    async (p: number, kw: string, st: string | undefined, gn: string | undefined) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ page: String(p), pageSize: String(pageSize) });
        if (kw) params.set('keyword', kw);
        if (st) params.set('status', st);
        if (gn) params.set('groupName', gn);
        const res = await request.get<PaginatedResponse<Tag>>(`/api/tags?${params}`);
        setList(res.data?.list ?? []);
        setTotal(res.data?.total ?? 0);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void fetchList(page, keyword, filterStatus, filterGroup);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  useEffect(() => { void fetchGroups(); }, [fetchGroups]);

  const handleSearch = () => {
    setPage(1);
    void fetchList(1, keyword, filterStatus, filterGroup);
  };

  const handleReset = () => {
    setKeyword('');
    setFilterStatus(undefined);
    setFilterGroup(undefined);
    setPage(1);
    void fetchList(1, '', undefined, undefined);
  };

  const openCreate = () => {
    setEditRecord(null);
    setColorValue('');
    setModalVisible(true);
  };

  const openEdit = (record: Tag) => {
    setEditRecord(record);
    setColorValue(record.color ?? '');
    setModalVisible(true);
  };

  const handleSubmit = async () => {
    try {
      const values = await formRef.current?.validate();
      if (!values) return;
      setSubmitting(true);
      const payload = { ...values, color: colorValue || null };
      if (editRecord) {
        await request.put(`/api/tags/${editRecord.id}`, payload);
        Toast.success('更新成功');
      } else {
        await request.post('/api/tags', payload);
        Toast.success('创建成功');
      }
      setModalVisible(false);
      void fetchList(page, keyword, filterStatus, filterGroup);
      void fetchGroups();
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message;
      if (msg) Toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await request.delete(`/api/tags/${id}`);
      Toast.success('删除成功');
      setSelectedRowKeys((prev) => prev.filter((k) => k !== id));
      void fetchList(page, keyword, filterStatus, filterGroup);
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message;
      if (msg) Toast.error(msg);
    }
  };

  const handleBatchDelete = async () => {
    if (!selectedRowKeys.length) return;
    try {
      await request.delete('/api/tags/batch', { ids: selectedRowKeys });
      Toast.success(`已删除 ${selectedRowKeys.length} 条标签`);
      setSelectedRowKeys([]);
      void fetchList(page, keyword, filterStatus, filterGroup);
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message;
      if (msg) Toast.error(msg);
    }
  };

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
      ellipsis: true,
      render: (v: string | null) => v || <Text type="quaternary">—</Text>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (v: string) => (
        <Text type={v === 'enabled' ? 'success' : 'tertiary'}>
          {v === 'enabled' ? '启用' : '禁用'}
        </Text>
      ),
    },
    {
      title: '排序',
      dataIndex: 'sortOrder',
      width: 80,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 180,
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
            <Popconfirm title="确定要删除吗？" onConfirm={() => handleDelete(record.id)}>
              <Button theme="borderless" type="danger" size="small">
                删除
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  const groupOptions = groups.map((g) => ({ label: g, value: g }));

  return (
    <div>
      <SearchToolbar>
        <Input
          prefix={<Search size={14} />}
          placeholder="搜索标签名称或描述"
          value={keyword}
          onChange={setKeyword}
          onEnterPress={handleSearch}
          showClear
          style={{ width: 200 }}
        />
        <Select
          placeholder="所属分组"
          value={filterGroup}
          onChange={(v) => setFilterGroup(v as string | undefined)}
          optionList={groupOptions}
          showClear
          style={{ width: 160 }}
        />
        <Select
          placeholder="状态"
          value={filterStatus}
          onChange={(v) => setFilterStatus(v as string | undefined)}
          optionList={[
            { label: '启用', value: 'enabled' },
            { label: '禁用', value: 'disabled' },
          ]}
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
          <Popconfirm
            title={`确定要删除选中的 ${selectedRowKeys.length} 条标签吗？`}
            onConfirm={handleBatchDelete}
          >
            <Button type="danger" icon={<Trash2 size={14} />}>
              批量删除 ({selectedRowKeys.length})
            </Button>
          </Popconfirm>
        )}
        {can('system:tag:create') && (
          <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>
            新增标签
          </Button>
        )}
      </SearchToolbar>

      <Table
        bordered
        loading={loading}
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
        pagination={{
          total,
          currentPage: page,
          pageSize,
          showSizeChanger: false,
          onPageChange: (p: number) => setPage(p),
        }}
        scroll={{ x: 900 }}
      />

      <Modal
        title={editRecord ? '编辑标签' : '新增标签'}
        visible={modalVisible}
        onOk={handleSubmit}
        onCancel={() => setModalVisible(false)}
        confirmLoading={submitting}
        afterClose={() => {
          formRef.current?.reset();
          setColorValue('');
        }}
        width={520}
      >
        <Form
          getFormApi={(api) => {
            (formRef as { current: FormApi }).current = api;
          }}
          layout="vertical"
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
            optionList={[
              { label: '启用', value: 'enabled' },
              { label: '禁用', value: 'disabled' },
            ]}
          />
          <Form.InputNumber
            field="sortOrder"
            label="排序"
            min={0}
            max={9999}
            innerButtons
          />
        </Form>
      </Modal>
    </div>
  );
}
