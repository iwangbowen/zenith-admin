import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Banner, Button, Descriptions, Form, Rating, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Trash2 } from 'lucide-react';
import type { UserFeedback, UserFeedbackCategory, UserFeedbackStatus } from '@zenith/shared/platform';
import { USER_FEEDBACK_CATEGORY_LABELS, USER_FEEDBACK_STATUS_LABELS } from '@zenith/shared/platform';
import ConfigurableTable from '@/components/ConfigurableTable';
import ExportButton from '@/components/ExportButton';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import AppModal from '@/components/AppModal';
import { dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import { formatDateForApi } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import { usePublicConfig } from '@/hooks/queries/system-configs';
import { useDeleteFeedbacks, useHandleFeedback, useUserFeedbackList, userFeedbackKeys } from '@/hooks/queries/user-feedbacks';
import { useListSearch } from '@/hooks/useListSearch';
import { useEditModal } from '@/hooks/useEditModal';
import { ResetButton, SearchButton } from '@/components/toolbar-controls';
import { DateRangeFilter, FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';
import { confirmDelete } from '@/utils/confirm';

// 文案统一来自 @zenith/shared；Tag 色为本页特化
const CATEGORY_OPTIONS: Array<{ value: UserFeedbackCategory; label: string; color: 'blue' | 'red' | 'orange' | 'grey' }> = [
  { value: 'suggestion', label: USER_FEEDBACK_CATEGORY_LABELS.suggestion, color: 'blue' },
  { value: 'bug', label: USER_FEEDBACK_CATEGORY_LABELS.bug, color: 'red' },
  { value: 'ux', label: USER_FEEDBACK_CATEGORY_LABELS.ux, color: 'orange' },
  { value: 'other', label: USER_FEEDBACK_CATEGORY_LABELS.other, color: 'grey' },
];

const STATUS_OPTIONS: Array<{ value: UserFeedbackStatus; label: string; color: 'amber' | 'blue' | 'green' | 'grey' }> = [
  { value: 'pending', label: USER_FEEDBACK_STATUS_LABELS.pending, color: 'amber' },
  { value: 'processing', label: USER_FEEDBACK_STATUS_LABELS.processing, color: 'blue' },
  { value: 'resolved', label: USER_FEEDBACK_STATUS_LABELS.resolved, color: 'green' },
  { value: 'ignored', label: USER_FEEDBACK_STATUS_LABELS.ignored, color: 'grey' },
];

const categoryMap = new Map(CATEGORY_OPTIONS.map((o) => [o.value, o]));
const statusMap = new Map(STATUS_OPTIONS.map((o) => [o.value, o]));

interface SearchParams {
  keyword: string;
  category?: UserFeedbackCategory;
  status?: UserFeedbackStatus;
  dateRange: [Date, Date] | null;
}

const defaultSearchParams: SearchParams = {
  keyword: '',
  category: undefined,
  status: undefined,
  dateRange: null,
};

export default function FeedbacksPage() {
  const { hasPermission } = usePermission();
  const navigate = useNavigate();
  // ─── 反馈入口配置状态（关闭时 Banner 提示）──────────────────────────────
  const entryConfigQuery = usePublicConfig('feedback_entry_enabled');
  const entryEnabled = entryConfigQuery.data?.configValue === 'true';

  // ─── 搜索状态 ──────────────────────────────────────────────────────────
  const {
    page, pageSize, buildPagination,
    draftParams, setDraftParams, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: userFeedbackKeys.lists });

  const [rangeStart, rangeEnd] = submittedParams.dateRange ?? [];
  const listQuery = useUserFeedbackList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    category: submittedParams.category,
    status: submittedParams.status,
    startTime: rangeStart ? formatDateForApi(rangeStart) : undefined,
    endTime: rangeEnd ? formatDateForApi(rangeEnd) : undefined,
  });
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;

  // ─── 批量选择 ──────────────────────────────────────────────────────────
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);

  // ─── 处理弹窗 ──────────────────────────────────────────────────────────
  const handleMutation = useHandleFeedback();
  const handleModal = useEditModal<UserFeedback, { status: UserFeedbackStatus; handleRemark?: string }, { status: UserFeedbackStatus; handleRemark: string | null }>({
    save: {
      isPending: handleMutation.isPending,
      mutateAsync: ({ id, values }) => {
        if (id === undefined) throw new Error('缺少反馈 ID，请刷新后重试');
        return handleMutation.mutateAsync({ params: { id }, body: values });
      },
    },
    toValues: (record) => ({
      status: record.status === 'pending' ? 'processing' : record.status,
      handleRemark: record.handleRemark ?? '',
    }),
    beforeSave: (values) => ({
      status: values.status,
      handleRemark: values.handleRemark?.trim() || null,
    }),
    successMessage: () => '处理成功',
  });
  const deleteMutation = useDeleteFeedbacks();

  function buildExportQuery(): Record<string, unknown> {
    return {
      ...(submittedParams.keyword ? { keyword: submittedParams.keyword } : {}),
      ...(submittedParams.category ? { category: submittedParams.category } : {}),
      ...(submittedParams.status ? { status: submittedParams.status } : {}),
      ...(rangeStart ? { startTime: formatDateForApi(rangeStart) } : {}),
      ...(rangeEnd ? { endTime: formatDateForApi(rangeEnd) } : {}),
    };
  }

  async function handleDelete(ids: number[]) {
    await deleteMutation.mutateAsync(ids);
    Toast.success('删除成功');
    setSelectedRowKeys((prev) => prev.filter((k) => !ids.includes(k)));
  }

  function confirmBatchDelete() {
    confirmDelete({
      title: `确认删除选中的 ${selectedRowKeys.length} 条反馈？`,
      content: '删除后不可恢复',
      onOk: () => handleDelete(selectedRowKeys),
    });
  }

  // ─── 表格列 ────────────────────────────────────────────────────────────
  const columns: ColumnProps<UserFeedback>[] = useMemo(() => [
    { title: '提交人', dataIndex: 'userNickname', width: 110, render: (v: string | null, r: UserFeedback) => v || `#${r.userId}` },
    {
      title: '评分', dataIndex: 'score', width: 150,
      render: (v: number | null) => v ? <Rating value={v} disabled size="small" /> : '—',
    },
    {
      title: '分类', dataIndex: 'category', width: 100,
      render: (v: UserFeedbackCategory) => {
        const o = categoryMap.get(v);
        return <Tag color={o?.color ?? 'grey'}>{o?.label ?? v}</Tag>;
      },
    },
    { title: '反馈内容', dataIndex: 'content', minWidth: 260, render: (v: string | null) => renderEllipsis(v ?? '—') },
    { title: '来源页面', dataIndex: 'pagePath', width: 150, render: (v: string | null) => renderEllipsis(v ?? '—') },
    { title: '处理人', dataIndex: 'handlerNickname', width: 100, render: (v: string | null) => v ?? '—' },
    { title: '处理备注', dataIndex: 'handleRemark', width: 180, render: (v: string | null) => renderEllipsis(v ?? '—') },
    dateTimeColumn('提交时间', 'createdAt'),
    {
      title: '状态', dataIndex: 'status', width: 90, fixed: 'right',
      render: (v: UserFeedbackStatus) => {
        const o = statusMap.get(v);
        return <Tag color={o?.color ?? 'grey'}>{o?.label ?? v}</Tag>;
      },
    },
    createOperationColumn<UserFeedback>({
      width: 180,
      desktopInlineKeys: ['handle', 'delete'],
      actions: (record) => [
        ...(record.replayId && hasPermission('monitor:replay:list') ? [{
          key: 'replay',
          label: '查看回放',
          onClick: () => navigate(`/analytics/replays?replay=${encodeURIComponent(record.replayId!)}`),
        }] : []),
        ...(hasPermission('system:feedback:handle') ? [{
          key: 'handle',
          label: '处理',
          onClick: () => handleModal.openEdit(record),
        }] : []),
        ...(hasPermission('system:feedback:delete') ? [{
          key: 'delete',
          label: '删除',
          danger: true,
          onClick: () => {
            confirmDelete({
              title: '确定要删除这条反馈吗？',
              content: '删除后不可恢复',
              onOk: () => handleDelete([record.id]),
            });
          },
        }] : []),
      ],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [hasPermission]);

  // ─── 搜索区渲染 ────────────────────────────────────────────────────────
  const renderKeywordSearch = () => (
    <KeywordInput placeholder="搜索反馈内容..." value={draftParams.keyword} onChange={(v) => setDraftParams((p) => ({ ...p, keyword: v }))} onSearch={handleSearch} />
  );

  const renderCategoryFilter = () => (
    <FilterSelect
      placeholder="全部分类"
      items={CATEGORY_OPTIONS}
      value={draftParams.category}
      onChange={(v) => setDraftParams((p) => ({ ...p, category: v as UserFeedbackCategory | undefined }))}
    />
  );

  const renderStatusFilter = () => (
    <StatusSelect
      items={STATUS_OPTIONS}
      value={draftParams.status}
      onChange={(v) => setDraftParams((p) => ({ ...p, status: v as UserFeedbackStatus | undefined }))}
    />
  );

  const renderDateRangeFilter = () => (
    <DateRangeFilter type="dateRange" value={draftParams.dateRange ?? undefined} onChange={(value) => setDraftParams((p) => ({ ...p, dateRange: value ? (value as [Date, Date]) : null }))} />
  );

  const renderSearchButton = () => (
    <SearchButton onClick={handleSearch} />
  );

  const renderResetButton = () => (
    <ResetButton onClick={handleReset} />
  );

  const renderBatchDeleteButton = () => selectedRowKeys.length > 0 && hasPermission('system:feedback:delete') ? (
    <Button type="danger" icon={<Trash2 size={14} />} onClick={confirmBatchDelete}>
      批量删除 ({selectedRowKeys.length})
    </Button>
  ) : null;

  const renderExportButton = (variant?: 'flat') => hasPermission('system:feedback:list') ? (
    <ExportButton entity="system.userFeedbacks" query={buildExportQuery()} variant={variant} />
  ) : null;



  return (
    <div className="page-container">
      {!entryConfigQuery.isLoading && !entryEnabled && (
        <Banner
          type="warning"
          closeIcon={null}
          style={{ marginBottom: 12 }}
          description={(
            <span>
              意见反馈入口当前已关闭（系统配置 feedback_entry_enabled = false），用户暂时无法提交新反馈。
              {hasPermission('system:config:update') && (
                <Typography.Text link style={{ marginLeft: 8 }} onClick={() => navigate('/system/configs')}>
                  前往系统配置开启
                </Typography.Text>
              )}
            </span>
          )}
        />
      )}

      <SearchToolbar
        primary={(
          <>
            {renderKeywordSearch()}
            {renderCategoryFilter()}
            {renderStatusFilter()}
            {renderDateRangeFilter()}
            {renderSearchButton()}
            {renderResetButton()}
          </>
        )}
        actions={(
          <>
            {renderBatchDeleteButton()}
            {renderExportButton()}
          </>
        )}
        mobilePrimary={(
          <>
            {renderKeywordSearch()}
            {renderSearchButton()}
          </>
        )}
        mobileFilters={(
          <>
            {renderCategoryFilter()}
            {renderStatusFilter()}
            {renderDateRangeFilter()}
          </>
        )}
        mobileActions={(
          <>
            {renderBatchDeleteButton()}
            {renderExportButton('flat')}
          </>
        )}
        filterTitle="筛选条件"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={list}
        loading={listQuery.isFetching}
        rowKey="id"
        size="small"
        empty="暂无反馈"
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        pagination={buildPagination(total)}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys((keys ?? []) as number[]),
        }}
      />

      <AppModal
        {...handleModal.modalProps}
        title="处理反馈"
        width={520}
        closeOnEsc
      >
        {handleModal.editing && (
          <>
            <Descriptions
              size="small"
              align="left"
              style={{ marginBottom: 16 }}
              data={[
                { key: '提交人', value: handleModal.editing.userNickname || `#${handleModal.editing.userId}` },
                { key: '评分', value: handleModal.editing.score ? <Rating value={handleModal.editing.score} disabled size="small" /> : '—' },
                { key: '分类', value: categoryMap.get(handleModal.editing.category)?.label ?? handleModal.editing.category },
                { key: '反馈内容', value: handleModal.editing.content ?? '—' },
                { key: '来源页面', value: handleModal.editing.pagePath ?? '—' },
                { key: '提交时间', value: handleModal.editing.createdAt },
              ]}
            />
            <Form
              key={handleModal.formKey} {...handleModal.formProps}
            >
              <Form.Select
                field="status"
                label="处理状态"
                style={{ width: '100%' }}
                rules={[{ required: true, message: '请选择处理状态' }]}
                optionList={STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              />
              <Form.TextArea
                field="handleRemark"
                label="处理备注"
                placeholder="填写处理说明（选填）"
                maxCount={500}
                rows={3}
              />
            </Form>
          </>
        )}
      </AppModal>
    </div>
  );
}
