import { useState, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Input, Tag, Modal, Form, Toast, Typography, Select, Row, Col } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Plus, RotateCcw, Search, Trash2 } from 'lucide-react';
import { API_SCOPE_GROUPS, API_SCOPE_GROUP_LABELS } from '@zenith/shared';
import type { ApiScope } from '@zenith/shared';
import { createdAtColumn } from '@/utils/table-columns';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import {
  openPlatformKeys,
  useApiScopeList,
  useBatchDeleteApiScopes,
  useDeleteApiScope,
  useSaveApiScope,
} from '@/hooks/queries/open-platform';

const { Text } = Typography;

const STATUS_OPTIONS = [
  { value: 'enabled', label: '启用' },
  { value: 'disabled', label: '禁用' },
];
const GROUP_OPTIONS = API_SCOPE_GROUPS.map((g) => ({ value: g, label: API_SCOPE_GROUP_LABELS[g] ?? g }));

type FormValues = {
  code: string;
  name: string;
  scopeGroup: string;
  description?: string;
  status: 'enabled' | 'disabled';
};

export default function ApiScopesPage() {
  const { hasPermission } = usePermission();
  const queryClient = useQueryClient();
  const canManage = hasPermission('open:scope:manage');
  const formApi = useRef<FormApi | null>(null);

  interface SearchParams { keyword: string; scopeGroup?: string; status?: 'enabled' | 'disabled' }
  const defaultSearchParams: SearchParams = { keyword: '', scopeGroup: undefined, status: undefined };
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftParams, setDraftParams] = useState<SearchParams>(defaultSearchParams);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearchParams);

  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<ApiScope | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);

  const listQuery = useApiScopeList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    scopeGroup: submittedParams.scopeGroup,
    status: submittedParams.status,
  });
  const data = listQuery.data ?? null;
  const saveMutation = useSaveApiScope();
  const deleteMutation = useDeleteApiScope();
  const batchDeleteMutation = useBatchDeleteApiScopes();

  function handleSearch() {
    setPage(1);
    setSubmittedParams(draftParams);
    void queryClient.invalidateQueries({ queryKey: openPlatformKeys.apiScopes.lists });
  }
  function handleReset() {
    setDraftParams(defaultSearchParams);
    setSubmittedParams(defaultSearchParams);
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: openPlatformKeys.apiScopes.lists });
  }

  function openCreate() {
    setEditing(null);
    setModalVisible(true);
  }
  function openEdit(record: ApiScope) {
    setEditing(record);
    setModalVisible(true);
    formApi.current?.setValues({
      code: record.code,
      name: record.name,
      scopeGroup: record.scopeGroup,
      description: record.description ?? '',
      status: record.status,
    });
  }
  function closeModal() {
    setModalVisible(false);
    setEditing(null);
  }

  const formInitValues: Partial<FormValues> = editing
    ? { code: editing.code, name: editing.name, scopeGroup: editing.scopeGroup, description: editing.description ?? '', status: editing.status }
    : { scopeGroup: 'general', status: 'enabled' };

  async function handleModalOk() {
    let values: FormValues;
    try {
      values = (await formApi.current?.validate()) as FormValues;
    } catch {
      throw new Error('validation');
    }
    if (!values) throw new Error('validation');
    await saveMutation.mutateAsync({ id: editing?.id, values });
    Toast.success(editing ? '更新成功' : '创建成功');
    closeModal();
  }

  async function handleDelete(id: number) {
    await deleteMutation.mutateAsync(id);
    Toast.success('删除成功');
  }

  function handleBatchDelete() {
    Modal.confirm({
      title: `确定删除选中的 ${selectedRowKeys.length} 个 Scope？`,
      content: '删除后不可恢复',
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        await batchDeleteMutation.mutateAsync(selectedRowKeys);
        Toast.success('批量删除成功');
        setSelectedRowKeys([]);
      },
    });
  }

  const columns: ColumnProps<ApiScope>[] = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    { title: 'Scope 编码', dataIndex: 'code', width: 200, render: (v: string) => <Text copyable={{ content: v }}>{v}</Text> },
    { title: '名称', dataIndex: 'name', width: 160 },
    {
      title: '分组',
      dataIndex: 'scopeGroup',
      width: 100,
      render: (v: string) => <Tag size="small" color="blue">{API_SCOPE_GROUP_LABELS[v] ?? v}</Tag>,
    },
    { title: '描述', dataIndex: 'description', width: 240, render: (v: string | null) => v || <Text type="tertiary">—</Text> },
    createdAtColumn,
    {
      title: '状态',
      dataIndex: 'status',
      width: 80,
      fixed: 'right' as const,
      render: (v: string) => <Tag color={v === 'enabled' ? 'green' : 'grey'} size="small">{v === 'enabled' ? '启用' : '禁用'}</Tag>,
    },
    createOperationColumn<ApiScope>({
      width: 140,
      actions: (record) => [
        { key: 'edit', label: '编辑', hidden: !canManage, onClick: () => openEdit(record) },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          hidden: !canManage,
          onClick: () => {
            Modal.confirm({
              title: '确定要删除此 Scope 吗？',
              content: '删除后不可恢复',
              okButtonProps: { type: 'danger', theme: 'solid' },
              onOk: () => handleDelete(record.id),
            });
          },
        },
      ],
    }),
  ];

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            <Input
              prefix={<Search size={14} />}
              placeholder="搜索编码 / 名称"
              value={draftParams.keyword}
              onChange={(v) => setDraftParams({ ...draftParams, keyword: v })}
              onEnterPress={handleSearch}
              showClear
              style={{ width: 200 }}
            />
            <Select
              placeholder="分组"
              value={draftParams.scopeGroup}
              onChange={(v) => setDraftParams({ ...draftParams, scopeGroup: v as string })}
              optionList={GROUP_OPTIONS}
              showClear
              style={{ width: 120 }}
            />
            <Select
              placeholder="状态"
              value={draftParams.status}
              onChange={(v) => setDraftParams({ ...draftParams, status: v as 'enabled' | 'disabled' })}
              optionList={STATUS_OPTIONS}
              showClear
              style={{ width: 110 }}
            />
            <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
            <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
            {canManage && <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>}
            {canManage && selectedRowKeys.length > 0 && (
              <Button type="danger" icon={<Trash2 size={14} />} onClick={handleBatchDelete}>批量删除（{selectedRowKeys.length}）</Button>
            )}
          </>
        )}
        mobilePrimary={(
          <>
            <Input
              prefix={<Search size={14} />}
              placeholder="搜索编码 / 名称"
              value={draftParams.keyword}
              onChange={(v) => setDraftParams({ ...draftParams, keyword: v })}
              onEnterPress={handleSearch}
              showClear
              style={{ width: 200 }}
            />
            <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
            {canManage && <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>}
          </>
        )}
        mobileActions={<Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>}
        actionTitle="Scope 操作"
      />

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={data?.list ?? []}
        loading={listQuery.isFetching}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        rowKey="id"
        size="small"
        empty="暂无数据"
        rowSelection={canManage ? { selectedRowKeys, onChange: (keys) => setSelectedRowKeys((keys ?? []) as number[]) } : undefined}
        pagination={buildPagination(data?.total ?? 0)}
      />

      <AppModal
        title={editing ? '编辑 API Scope' : '新增 API Scope'}
        visible={modalVisible}
        onOk={handleModalOk}
        onCancel={closeModal}
        okButtonProps={{ loading: saveMutation.isPending }}
        width={520}
        closeOnEsc
      >
        <Form
          key={editing?.id ?? 'new'}
          getFormApi={(api) => { formApi.current = api; }}
          initValues={formInitValues}
          labelPosition="left"
          labelWidth={110}
        >
          <Form.Input
            field="code"
            label="Scope 编码"
            placeholder="如 user:read"
            disabled={!!editing}
            extraText={editing ? '编码创建后不可修改' : '小写字母开头，可含 : . _ -'}
            rules={[{ required: true, message: 'Scope 编码不能为空' }]}
          />
          <Form.Input field="name" label="名称" placeholder="如 读取用户信息" rules={[{ required: true, message: '名称不能为空' }]} />
          <Row gutter={16}>
            <Col span={12}>
              <Form.Select field="scopeGroup" label="分组" style={{ width: '100%' }} optionList={GROUP_OPTIONS} filter allowCreate rules={[{ required: true, message: '请选择分组' }]} />
            </Col>
            <Col span={12}>
              <Form.Select field="status" label="状态" style={{ width: '100%' }} optionList={STATUS_OPTIONS} rules={[{ required: true, message: '请选择状态' }]} />
            </Col>
          </Row>
          <Form.TextArea field="description" label="描述" placeholder="该 scope 授予的权限说明（可选）" rows={2} />
        </Form>
      </AppModal>
    </div>
  );
}
