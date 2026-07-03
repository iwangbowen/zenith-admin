import { useEffect, useState, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
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
import type { Tag } from '@zenith/shared';
import { usePermission } from '@/hooks/usePermission';
import { useDictItems } from '@/hooks/useDictItems';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { createdAtColumn } from '../../../utils/table-columns';
import { usePagination } from '@/hooks/usePagination';
import {
  tagKeys,
  useBatchDeleteTags,
  useDeleteTag,
  useSaveTag,
  useTagDetail,
  useTagGroups,
  useTagList,
  useUpdateTagStatus,
} from '@/hooks/queries/tags';

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
  const queryClient = useQueryClient();
  const { items: statusItems } = useDictItems('common_status');

  interface SearchParams { keyword: string; filterStatus: string | undefined; filterGroup: string | undefined; }
  const defaultSearchParams: SearchParams = { keyword: '', filterStatus: undefined, filterGroup: undefined };
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftParams, setDraftParams] = useState<SearchParams>(defaultSearchParams);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearchParams);

  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);

  const [modalVisible, setModalVisible] = useState(false);
  const [editRecord, setEditRecord] = useState<Tag | null>(null);
  const formRef = useRef<FormApi>(null);
  const [colorValue, setColorValue] = useState('');

  const listQuery = useTagList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    status: submittedParams.filterStatus || undefined,
    groupName: submittedParams.filterGroup || undefined,
  });
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const groupsQuery = useTagGroups();
  const detailQuery = useTagDetail(editRecord?.id, modalVisible);
  const editing = editRecord ? (detailQuery.data ?? editRecord) : null;
  const modalDetailLoading = !!editRecord && detailQuery.isFetching;
  const saveMutation = useSaveTag();
  const deleteMutation = useDeleteTag();
  const batchDeleteMutation = useBatchDeleteTags();
  const toggleStatusMutation = useUpdateTagStatus();
  const togglingStatusId = toggleStatusMutation.isPending ? (toggleStatusMutation.variables?.id ?? null) : null;

  useEffect(() => {
    if (modalVisible && editing) setColorValue(editing.color ?? '');
  }, [modalVisible, editing]);

  const handleSearch = () => {
    setPage(1);
    setSubmittedParams(draftParams);
    void queryClient.invalidateQueries({ queryKey: tagKeys.lists });
  };

  const handleReset = () => {
    setDraftParams(defaultSearchParams);
    setSubmittedParams(defaultSearchParams);
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: tagKeys.lists });
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
    let values: Awaited<ReturnType<FormApi['validate']>>;
    try {
      values = (await formRef.current?.validate())!;
    } catch {
      throw new Error('validation');
    }
    const payload = { ...values, color: colorValue || null };
    await saveMutation.mutateAsync({ id: editRecord?.id, values: payload });
    Toast.success(editRecord ? '更新成功' : '创建成功');
    setModalVisible(false);
  };

  const handleDelete = (id: number) => {
    Modal.confirm({
      title: '确定要删除该标签吗？',
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        await deleteMutation.mutateAsync(id);
        Toast.success('删除成功');
        setSelectedRowKeys(selectedRowKeys.filter((k) => k !== id));
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
        await batchDeleteMutation.mutateAsync(selectedRowKeys);
        Toast.success(`已删除 ${selectedRowKeys.length} 条标签`);
        setSelectedRowKeys([]);
      },
    });
  };

  const handleToggleStatus = async (tag: Tag, newStatus: 'enabled' | 'disabled') => {
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
    await toggleStatusMutation.mutateAsync({ id: tag.id, status: newStatus });
    Toast.success(newStatus === 'enabled' ? '已启用' : '已禁用');
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
    createOperationColumn<Tag>({
      width: 130,
      actions: (record) => [
        {
          key: 'edit',
          label: '编辑',
          hidden: !can('system:tag:update'),
          onClick: () => openEdit(record),
        },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          hidden: !can('system:tag:delete'),
          onClick: () => handleDelete(record.id),
        },
      ],
    }),
  ];

  const groupOptions = (groupsQuery.data ?? []).map((g) => ({ label: g, value: g }));

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            <Input
              prefix={<Search size={14} />}
              placeholder="搜索标签名称或描述"
              value={draftParams.keyword}
              onChange={(v) => setDraftParams({ ...draftParams, keyword: v })}
              onEnterPress={handleSearch}
              showClear
              style={{ width: 200 }}
            />
            <Select
              placeholder="所属分组"
              value={draftParams.filterGroup}
              onChange={(v) => setDraftParams({ ...draftParams, filterGroup: v as string | undefined })}
              optionList={groupOptions}
              showClear
              style={{ width: 160 }}
            />
            <Select
              placeholder="状态"
              value={draftParams.filterStatus}
              onChange={(v) => setDraftParams({ ...draftParams, filterStatus: v as string | undefined })}
              optionList={statusItems.map((i) => ({ label: i.label, value: i.value }))}
              showClear
              style={{ width: 100 }}
            />
            <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
            <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
          </>
        )}
        actions={(
          <>
            {can('system:tag:delete') && selectedRowKeys.length > 0 && (
              <Button type="danger" theme="light" icon={<Trash2 size={14} />} onClick={handleBatchDelete}>
                批量删除 ({selectedRowKeys.length})
              </Button>
            )}
            {can('system:tag:create') && (
              <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>
            )}
          </>
        )}
        mobilePrimary={(
          <>
            <Input
              prefix={<Search size={14} />}
              placeholder="搜索标签名称或描述"
              value={draftParams.keyword}
              onChange={(v) => setDraftParams({ ...draftParams, keyword: v })}
              onEnterPress={handleSearch}
              showClear
              style={{ width: 200 }}
            />
            <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
            {can('system:tag:create') && (
              <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>
            )}
          </>
        )}
        mobileFilters={(
          <>
            <Select
              placeholder="所属分组"
              value={draftParams.filterGroup}
              onChange={(v) => setDraftParams({ ...draftParams, filterGroup: v as string | undefined })}
              optionList={groupOptions}
              showClear
              style={{ width: 160 }}
            />
            <Select
              placeholder="状态"
              value={draftParams.filterStatus}
              onChange={(v) => setDraftParams({ ...draftParams, filterStatus: v as string | undefined })}
              optionList={statusItems.map((i) => ({ label: i.label, value: i.value }))}
              showClear
              style={{ width: 100 }}
            />
          </>
        )}
        mobileActions={can('system:tag:delete') && selectedRowKeys.length > 0 ? (
          <Button type="danger" theme="light" icon={<Trash2 size={14} />} onClick={handleBatchDelete}>
            批量删除 ({selectedRowKeys.length})
          </Button>
        ) : null}
        filterTitle="标签筛选"
        actionTitle="标签操作"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable
        bordered
        loading={listQuery.isFetching}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
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
        pagination={buildPagination(total)}
        scroll={{ x: 900 }}
      />

      <AppModal
        title={editing ? '编辑标签' : '新增标签'}
        visible={modalVisible}
        onOk={handleSubmit}
        onCancel={() => { setModalVisible(false); setEditRecord(null); }}
        confirmLoading={saveMutation.isPending}
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
            editing
              ? {
                  name: editing.name,
                  groupName: editing.groupName ?? undefined,
                  description: editing.description ?? undefined,
                  status: editing.status,
                  sortOrder: editing.sortOrder,
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
      </AppModal>
    </div>
  );
}
