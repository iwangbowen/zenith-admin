import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Banner, Descriptions, Form, Rating, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { UserFeedback, UserFeedbackCategory, UserFeedbackStatus } from '@zenith/shared/platform';
import { USER_FEEDBACK_CATEGORY_LABELS, USER_FEEDBACK_STATUS_LABELS } from '@zenith/shared/platform';
import { createLabelOptionsFromMap } from '@zenith/shared/core';
import ConfigurableTable from '@/components/ConfigurableTable';
import ExportButton from '@/components/ExportButton';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { confirmAndDelete, deleteAction, ListSearchToolbar, listTableProps, useRowSelection } from '@/components/list-page';
import AppModal from '@/components/AppModal';
import { dateTimeColumn, EMPTY_PLACEHOLDER, renderEllipsis } from '@/utils/table-columns';
import { formatDateRangeForApi } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import { useMySettings } from '@/hooks/queries/settings';
import { useDeleteFeedbacks, useHandleFeedback, useUserFeedbackList, userFeedbackKeys } from '@/hooks/queries/user-feedbacks';
import { useListSearch } from '@/hooks/useListSearch';
import { useEditModal } from '@/hooks/useEditModal';
import { abortSubmit } from '@/lib/abort-submit';
import { BatchDeleteButton } from '@/components/toolbar-controls';
import { DateRangeFilter, FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';
import { compactParams } from '@/lib/query';

const CATEGORY_OPTIONS = createLabelOptionsFromMap<UserFeedbackCategory>(USER_FEEDBACK_CATEGORY_LABELS);
const STATUS_OPTIONS = createLabelOptionsFromMap<UserFeedbackStatus>(USER_FEEDBACK_STATUS_LABELS);

const CATEGORY_COLORS: Record<UserFeedbackCategory, 'blue' | 'red' | 'orange' | 'grey'> = {
  suggestion: 'blue',
  bug: 'red',
  ux: 'orange',
  other: 'grey',
};
const STATUS_COLORS: Record<UserFeedbackStatus, 'amber' | 'blue' | 'green' | 'grey'> = {
  pending: 'amber',
  processing: 'blue',
  resolved: 'green',
  ignored: 'grey',
};

const categoryMap = new Map(CATEGORY_OPTIONS.map((o) => [o.value, { ...o, color: CATEGORY_COLORS[o.value] }]));
const statusMap = new Map(STATUS_OPTIONS.map((o) => [o.value, { ...o, color: STATUS_COLORS[o.value] }]));

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
  const entryConfigQuery = useMySettings();
  const entryEnabled = entryConfigQuery.data?.ui.feedbackEntryEnabled ?? false;

  // ─── 搜索状态 ──────────────────────────────────────────────────────────
  const {
    page, pageSize, buildPagination,
    bind, bindKeyword, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: userFeedbackKeys.lists });

  // 已提交筛选 → 契约查询参数：列表与导出共用同一份映射
  const filterQuery = useMemo(() => compactParams({
    keyword: submittedParams.keyword,
    category: submittedParams.category,
    status: submittedParams.status,
    ...formatDateRangeForApi(submittedParams.dateRange),
  }), [submittedParams]);
  const listQuery = useUserFeedbackList({ page, pageSize, ...filterQuery });

  // ─── 批量选择 ──────────────────────────────────────────────────────────
  const { selectedRowKeys, setSelectedRowKeys, clear: clearSelection, rowSelection } = useRowSelection();

  // ─── 处理弹窗 ──────────────────────────────────────────────────────────
  const handleMutation = useHandleFeedback();
  const handleModal = useEditModal<UserFeedback, { status: UserFeedbackStatus; handleRemark?: string }, { status: UserFeedbackStatus; handleRemark: string | null }>({
    save: {
      isPending: handleMutation.isPending,
      mutateAsync: ({ id, values }) => {
        if (id === undefined) {
          Toast.error('缺少反馈 ID，请刷新后重试');
          abortSubmit('missing-id');
        }
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


  function confirmBatchDelete() {
    confirmAndDelete({
      title: `确认删除选中的 ${selectedRowKeys.length} 条反馈？`,
      content: '删除后不可恢复',
      run: () => deleteMutation.mutateAsync(selectedRowKeys),
      successMessage: '删除成功',
      onDeleted: clearSelection,
    });
  }

  // ─── 表格列 ────────────────────────────────────────────────────────────
  const columns: ColumnProps<UserFeedback>[] = useMemo(() => [
    { title: '提交人', dataIndex: 'userNickname', width: 110, render: (v: string | null, r: UserFeedback) => v || `#${r.userId}` },
    {
      title: '评分', dataIndex: 'score', width: 150,
      render: (v: number | null) => v ? <Rating value={v} disabled size="small" /> : EMPTY_PLACEHOLDER,
    },
    {
      title: '分类', dataIndex: 'category', width: 100,
      render: (v: UserFeedbackCategory) => {
        const o = categoryMap.get(v);
        return <Tag color={o?.color ?? 'grey'}>{o?.label ?? v}</Tag>;
      },
    },
    { title: '反馈内容', dataIndex: 'content', minWidth: 260, render: renderEllipsis },
    { title: '来源页面', dataIndex: 'pagePath', width: 150, render: renderEllipsis },
    { title: '处理人', dataIndex: 'handlerNickname', width: 100, render: (v: string | null) => v ?? EMPTY_PLACEHOLDER },
    { title: '处理备注', dataIndex: 'handleRemark', width: 180, render: renderEllipsis },
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
        deleteAction({
          hidden: !hasPermission('system:feedback:delete'),
          title: '确定要删除这条反馈吗？',
          content: '删除后不可恢复',
          run: () => deleteMutation.mutateAsync([record.id]),
          onDeleted: () => setSelectedRowKeys((prev) => prev.filter((k) => k !== record.id)),
        }),
      ],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [hasPermission]);

  // ─── 搜索区渲染 ────────────────────────────────────────────────────────

  const batchDeleteButton = selectedRowKeys.length > 0 && hasPermission('system:feedback:delete') ? (
    <BatchDeleteButton count={selectedRowKeys.length} onClick={confirmBatchDelete} />
  ) : null;

  const renderExportButton = (variant?: 'flat') => hasPermission('system:feedback:list') ? (
    <ExportButton entity="system.userFeedbacks" query={filterQuery} variant={variant} />
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
              意见反馈入口当前已关闭（系统设置 · 界面与体验 · 意见反馈入口），用户暂时无法提交新反馈。
              {hasPermission('system:setting:update') && (
                <Typography.Text link style={{ marginLeft: 8 }} onClick={() => navigate('/system/settings?module=ui')}>
                  前往系统设置开启
                </Typography.Text>
              )}
            </span>
          )}
        />
      )}

      <ListSearchToolbar
        keyword={<KeywordInput placeholder="搜索反馈内容..." {...bindKeyword('keyword')} />}
        filters={(
          <>
            <FilterSelect
              placeholder="全部分类"
              items={CATEGORY_OPTIONS}
              {...bind('category')}
            />
            <StatusSelect
              items={STATUS_OPTIONS}
              {...bind('status')}
            />
            <DateRangeFilter type="dateRange" {...bind('dateRange')} />
          </>
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        actions={(
          <>
            {batchDeleteButton}
            {renderExportButton()}
          </>
        )}
        mobileActions={(
          <>
            {batchDeleteButton}
            {renderExportButton('flat')}
          </>
        )}
        filterTitle="筛选条件"
      />

      <ConfigurableTable<UserFeedback>
        columns={columns}
        empty="暂无反馈"
        {...listTableProps(listQuery, {
          pagination: buildPagination,
          rowSelection,
        })}
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
                { key: '评分', value: handleModal.editing.score ? <Rating value={handleModal.editing.score} disabled size="small" /> : EMPTY_PLACEHOLDER },
                { key: '分类', value: categoryMap.get(handleModal.editing.category)?.label ?? handleModal.editing.category },
                { key: '反馈内容', value: handleModal.editing.content ?? EMPTY_PLACEHOLDER },
                { key: '来源页面', value: handleModal.editing.pagePath ?? EMPTY_PLACEHOLDER },
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
