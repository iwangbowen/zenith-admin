
import { useMemo } from 'react';
import { compactParams } from '@/lib/query';
import { useListSearch } from '@/hooks/useListSearch';
import { Form, Modal, Space, Tag, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { AnalyticsSite } from '@zenith/shared/analytics';
import { COMMON_STATUS_LABELS, COMMON_STATUS_OPTIONS } from '@zenith/shared/core';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import {
  analyticsKeys,
  useAnalyticsSites,
  useCreateSite,
  useDeleteSite,
  useRegenerateSiteKey,
  useUpdateSite,
} from '@/hooks/queries/analytics';
import { CreateButton } from '@/components/toolbar-controls';
import { KeywordInput, StatusSelect } from '@/components/search-filters';
import { useEditModal } from '@/hooks/useEditModal';
import { copyableNoColumn, dateTimeColumn } from '@/utils/table-columns';
import { confirmDelete } from '@/utils/confirm';
import { ListSearchToolbar } from '@/components/list-page';

const PAGE_SIZE = 20;
const STATUS_META: Record<AnalyticsSite['status'], { label: string; color: 'green' | 'red' }> = {
  enabled: { label: COMMON_STATUS_LABELS.enabled, color: 'green' },
  disabled: { label: COMMON_STATUS_LABELS.disabled, color: 'red' },
};

interface SearchState { name: string; status?: AnalyticsSite['status'] }
type SiteFormValues = {
  name: string;
  appId: string;
  allowedOrigins?: string[];
  dailyEventQuota?: number | null;
  status: AnalyticsSite['status'];
  remark?: string | null;
};

const defaultSearch: SearchState = { name: '', status: undefined };

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
  const {
    page, pageSize, buildPagination,
    bind, bindKeyword, submittedParams: submitted,
    handleSearch, handleReset,
  } = useListSearch<SearchState>({ defaults: defaultSearch, listKey: analyticsKeys.data.sitesLists, pageSize: PAGE_SIZE });

  // 已提交筛选 → 契约查询参数：只映射一次
  const params = useMemo(() => ({
    page,
    pageSize,
    ...compactParams({ name: submitted.name, status: submitted.status }),
  }), [page, pageSize, submitted]);
  const listQuery = useAnalyticsSites(params);
  const createMutation = useCreateSite();
  const updateMutation = useUpdateSite();
  const deleteMutation = useDeleteSite();
  const regenerateMutation = useRegenerateSiteKey();

  const data = listQuery.data;
  const list = data?.list ?? [];

  const siteModal = useEditModal<AnalyticsSite, SiteFormValues, ReturnType<typeof normalizeForm>>({
    entityName: '站点',
    save: {
      mutateAsync: ({ id, values }) => (
        id ? updateMutation.mutateAsync({ params: { id }, body: values }) : createMutation.mutateAsync({ body: values })
      ),
      isPending: createMutation.isPending || updateMutation.isPending,
    },
    defaults: { appId: 'admin', status: 'enabled', allowedOrigins: [] },
    toValues: (record) => ({
      name: record.name,
      appId: record.appId,
      allowedOrigins: record.allowedOrigins ?? [],
      dailyEventQuota: record.dailyEventQuota,
      status: record.status,
      remark: record.remark,
    }),
    beforeSave: normalizeForm,
    labelWidth: 110,
  });

  const columns: ColumnProps<AnalyticsSite>[] = [
    { title: '名称', dataIndex: 'name', width: 160, fixed: 'left' },
    copyableNoColumn('Site Key', 'siteKey', { width: 340 }),
    { title: 'AppId', dataIndex: 'appId', width: 120, render: (value: string) => <Tag size="small">{value}</Tag> },
    { title: '归属租户', dataIndex: 'tenantName', width: 140, render: (_: unknown, record) => record.tenantName || '平台' },
    { title: '来源白名单', dataIndex: 'allowedOrigins', minWidth: 220, render: (origins: string[] | null) => origins?.length ? <Space wrap>{origins.slice(0, 3).map((o) => <Tag key={o} size="small">{o}</Tag>)}{origins.length > 3 ? <Tag size="small">+{origins.length - 3}</Tag> : null}</Space> : '不限制' },
    { title: '日配额', dataIndex: 'dailyEventQuota', width: 110, align: 'right', render: (value: number | null) => value ?? '不限' },
    { title: '今日用量', dataIndex: 'todayUsage', width: 140, align: 'right', render: (_: number | null, record) => renderUsage(record) },
    dateTimeColumn('更新时间', 'updatedAt'),
    { title: '状态', dataIndex: 'status', width: 100, fixed: 'right', render: (value: AnalyticsSite['status']) => <Tag color={STATUS_META[value].color} size="small">{STATUS_META[value].label}</Tag> },
    createOperationColumn<AnalyticsSite>({
      width: 180,
      desktopInlineKeys: ['edit', 'delete'],
      actions: (record) => [
        { key: 'edit', label: '编辑', onClick: () => siteModal.openEdit(record) },
        {
          key: 'regenerate', label: '重新生成 Key', loading: regenerateMutation.isPending,
          onClick: () => { Modal.confirm({ title: '确定重新生成 Key？', content: '旧 Key 将立即失效。', onOk: () => regenerateMutation.mutate({ params: { id: record.id } }) }); },
        },
        {
          key: 'delete', label: '删除', danger: true, loading: deleteMutation.isPending,
          onClick: () => { confirmDelete({ title: '确定要删除该站点吗？', content: '删除后不可恢复', onOk: () => deleteMutation.mutate({ params: { id: record.id } }) }); },
        },
      ],
    }),
  ];

  return (
    <>
      <ListSearchToolbar
        keyword={<KeywordInput placeholder="站点名称" {...bindKeyword('name')} />}
        filters={<StatusSelect items={COMMON_STATUS_OPTIONS} {...bind('status')} />}
        onSearch={handleSearch}
        onReset={handleReset}
        create={<CreateButton onClick={siteModal.openCreate} />}
      />

      <ConfigurableTable
        bordered
        rowKey="id"
        loading={listQuery.isFetching}
        columns={columns}
        dataSource={list}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        pagination={buildPagination(data?.total ?? 0)}
        empty="暂无站点"
      />

      <Modal
        {...siteModal.modalProps}
        width={620}
      >
        <Form key={siteModal.formKey} {...siteModal.formProps}>
          <Form.Input field="name" label="站点名称" placeholder="如 管理后台" rules={[{ required: true, message: '请输入站点名称' }]} />
          <Form.Input field="appId" label="AppId" placeholder="如 admin/member" rules={[{ required: true, message: '请输入 appId' }, { pattern: /^[a-z][a-z0-9_-]*$/, message: '以小写字母开头，仅允许小写字母、数字、下划线和中划线' }]} />
          <Form.TagInput field="allowedOrigins" label="来源白名单" placeholder="输入 origin 后回车，如 https://example.com" />
          <Form.InputNumber field="dailyEventQuota" label="日事件配额" min={1} placeholder="留空表示不限" style={{ width: '100%' }} />
          <Form.Select field="status" label="状态" optionList={COMMON_STATUS_OPTIONS} style={{ width: '100%' }} />
          <Form.TextArea field="remark" label="备注" maxCount={500} autosize={{ minRows: 3, maxRows: 5 }} />
        </Form>
      </Modal>
    </>
  );
}
