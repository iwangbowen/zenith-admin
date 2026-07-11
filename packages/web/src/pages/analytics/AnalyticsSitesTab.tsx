
import { useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Form, Input, Modal, Popconfirm, Select, Space, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Plus, RotateCcw, Search } from 'lucide-react';
import type { AnalyticsSite } from '@zenith/shared';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import { SearchToolbar } from '@/components/SearchToolbar';
import {
  analyticsKeys,
  useAnalyticsSites,
  useCreateSite,
  useDeleteSite,
  useRegenerateSiteKey,
  useUpdateSite,
} from '@/hooks/queries/analytics';
import { formatDateTime } from '@/utils/date';

const PAGE_SIZE = 20;
const STATUS_OPTIONS = [
  { value: 'enabled', label: '启用' },
  { value: 'disabled', label: '停用' },
];
const STATUS_META: Record<AnalyticsSite['status'], { label: string; color: 'green' | 'red' }> = {
  enabled: { label: '启用', color: 'green' },
  disabled: { label: '停用', color: 'red' },
};

interface SearchState { name: string; status: '' | AnalyticsSite['status'] }
type SiteFormValues = {
  name: string;
  appId: string;
  allowedOrigins?: string[];
  dailyEventQuota?: number | null;
  status: AnalyticsSite['status'];
  remark?: string | null;
};

const defaultSearch: SearchState = { name: '', status: '' };

function normalizeForm(values: SiteFormValues) {
  return {
    name: values.name?.trim(),
    appId: values.appId?.trim(),
    allowedOrigins: values.allowedOrigins?.map((v) => v.trim()).filter(Boolean) ?? null,
    dailyEventQuota: values.dailyEventQuota ?? null,
    status: values.status ?? 'enabled',
    remark: values.remark?.trim() || null,
  };
}

function renderUsage(record: AnalyticsSite) {
  const usage = record.todayUsage ?? 0;
  if (record.dailyEventQuota == null) return <Typography.Text>{usage} / ∞</Typography.Text>;
  const ratio = record.dailyEventQuota > 0 ? usage / record.dailyEventQuota : 0;
  const content = `${usage} / ${record.dailyEventQuota}`;
  return ratio >= 0.9 ? <Tag color="red" size="small">{content}</Tag> : <Typography.Text>{content}</Typography.Text>;
}

export default function AnalyticsSitesTab() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [draft, setDraft] = useState<SearchState>(defaultSearch);
  const [submitted, setSubmitted] = useState<SearchState>(defaultSearch);
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<AnalyticsSite | null>(null);
  const formApi = useRef<FormApi | null>(null);

  const params = useMemo(() => ({ page, pageSize, name: submitted.name || undefined, status: submitted.status || undefined }), [page, pageSize, submitted]);
  const listQuery = useAnalyticsSites(params);
  const createMutation = useCreateSite();
  const updateMutation = useUpdateSite();
  const deleteMutation = useDeleteSite();
  const regenerateMutation = useRegenerateSiteKey();

  const data = listQuery.data;
  const list = data?.list ?? [];

  const handleSearch = () => {
    setPage(1);
    setSubmitted(draft);
    void queryClient.invalidateQueries({ queryKey: analyticsKeys.data.sitesLists });
  };
  const handleReset = () => {
    setDraft(defaultSearch);
    setSubmitted(defaultSearch);
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: analyticsKeys.data.sitesLists });
  };
  const openCreate = () => { setEditing(null); setModalVisible(true); };
  const openEdit = (record: AnalyticsSite) => { setEditing(record); setModalVisible(true); };

  const formInit = editing ? {
    name: editing.name,
    appId: editing.appId,
    allowedOrigins: editing.allowedOrigins ?? [],
    dailyEventQuota: editing.dailyEventQuota,
    status: editing.status,
    remark: editing.remark,
  } : { appId: 'admin', status: 'enabled', allowedOrigins: [] };

  const handleSubmit = async () => {
    const values = await formApi.current?.validate() as SiteFormValues | undefined;
    if (!values) return;
    const payload = normalizeForm(values);
    if (editing) await updateMutation.mutateAsync({ id: editing.id, values: payload });
    else await createMutation.mutateAsync(payload);
    Toast.success(editing ? '更新成功' : '创建成功');
    setModalVisible(false);
    setEditing(null);
  };

  const columns: ColumnProps<AnalyticsSite>[] = [
    { title: '名称', dataIndex: 'name', width: 160, fixed: 'left' },
    { title: 'Site Key', dataIndex: 'siteKey', width: 340, render: (text: string) => <Typography.Text copyable={{ content: text }} code>{text}</Typography.Text> },
    { title: 'AppId', dataIndex: 'appId', width: 120, render: (value: string) => <Tag size="small">{value}</Tag> },
    { title: '归属租户', dataIndex: 'tenantName', width: 140, render: (_: unknown, record) => record.tenantName || '平台' },
    { title: '来源白名单', dataIndex: 'allowedOrigins', width: 220, render: (origins: string[] | null) => origins?.length ? <Space wrap>{origins.slice(0, 3).map((o) => <Tag key={o} size="small">{o}</Tag>)}{origins.length > 3 ? <Tag size="small">+{origins.length - 3}</Tag> : null}</Space> : '不限制' },
    { title: '日配额', dataIndex: 'dailyEventQuota', width: 110, render: (value: number | null) => value ?? '不限' },
    { title: '今日用量', dataIndex: 'todayUsage', width: 140, render: (_: number | null, record) => renderUsage(record) },
    { title: '更新时间', dataIndex: 'updatedAt', width: 180, render: (value: string) => formatDateTime(value) },
    { title: '状态', dataIndex: 'status', width: 100, fixed: 'right', render: (value: AnalyticsSite['status']) => <Tag color={STATUS_META[value].color} size="small">{STATUS_META[value].label}</Tag> },
    {
      title: '操作', dataIndex: 'operation', width: 260, fixed: 'right', render: (_: unknown, record) => (
        <Space>
          <Button theme="borderless" size="small" onClick={() => openEdit(record)}>编辑</Button>
          <Popconfirm title="确定重新生成 Key？旧 Key 将立即失效。" onConfirm={() => regenerateMutation.mutate(record.id)}>
            <Button theme="borderless" size="small" loading={regenerateMutation.isPending}>重新生成Key</Button>
          </Popconfirm>
          <Popconfirm title="确定要删除该站点吗？" onConfirm={() => deleteMutation.mutate(record.id)}>
            <Button theme="borderless" type="danger" size="small" loading={deleteMutation.isPending}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <SearchToolbar>
        <Input prefix={<Search size={14} />} placeholder="站点名称" value={draft.name} onChange={(name) => setDraft((prev) => ({ ...prev, name }))} showClear style={{ width: 220 }} />
        <Select placeholder="状态" value={draft.status || undefined} optionList={STATUS_OPTIONS} onChange={(status) => setDraft((prev) => ({ ...prev, status: (status as AnalyticsSite['status']) ?? '' }))} showClear style={{ width: 120 }} />
        <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
        <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
        <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>
      </SearchToolbar>

      <ConfigurableTable
        bordered
        rowKey="id"
        loading={listQuery.isFetching}
        columns={columns}
        dataSource={list}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        scroll={{ x: 1770 }}
        pagination={{
          currentPage: page,
          pageSize,
          total: data?.total ?? 0,
          onPageChange: setPage,
          onPageSizeChange: (next) => { setPage(1); setPageSize(next); },
        }}
        empty="暂无站点"
      />

      <Modal
        title={editing ? '编辑站点' : '新增站点'}
        visible={modalVisible}
        onCancel={() => { setModalVisible(false); setEditing(null); }}
        onOk={() => void handleSubmit()}
        okButtonProps={{ loading: createMutation.isPending || updateMutation.isPending }}
        width={620}
        closeOnEsc
      >
        <Form key={editing?.id ?? 'new'} getFormApi={(api) => { formApi.current = api; }} initValues={formInit} labelPosition="left" labelWidth={110} allowEmpty>
          <Form.Input field="name" label="站点名称" placeholder="如 管理后台" rules={[{ required: true, message: '请输入站点名称' }]} />
          <Form.Input field="appId" label="AppId" placeholder="如 admin/member" rules={[{ required: true, message: '请输入 appId' }, { pattern: /^[a-z][a-z0-9_-]*$/, message: '以小写字母开头，仅允许小写字母、数字、下划线和中划线' }]} />
          <Form.TagInput field="allowedOrigins" label="来源白名单" placeholder="输入 origin 后回车，如 https://example.com" />
          <Form.InputNumber field="dailyEventQuota" label="日事件配额" min={1} placeholder="留空表示不限" style={{ width: '100%' }} />
          <Form.Select field="status" label="状态" optionList={STATUS_OPTIONS} style={{ width: '100%' }} />
          <Form.TextArea field="remark" label="备注" maxCount={500} autosize={{ minRows: 3, maxRows: 5 }} />
        </Form>
      </Modal>
    </>
  );
}
