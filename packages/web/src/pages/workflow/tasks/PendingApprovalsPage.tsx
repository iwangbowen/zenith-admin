import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AppModal } from '@/components/AppModal';
import { Button, Select, SideSheet, Tag, TextArea, Toast, Tooltip, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Plus } from 'lucide-react';
import { SearchToolbar } from '@/components/SearchToolbar';
import WorkflowSummaryLine from '@/components/workflow/WorkflowSummaryLine';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import WorkflowPriorityTag from '@/components/workflow/WorkflowPriorityTag';
import WorkflowSLATag from '@/components/workflow/WorkflowSLATag';
import WorkflowApprovalDetailSheet from '@/components/workflow/WorkflowApprovalDetailSheet';
import SavedViewsBar from '@/components/workflow/SavedViewsBar';
import { useListSearch } from '@/hooks/useListSearch';
import { useQuickPhrases } from '@/hooks/useQuickPhrases';
import { dateTimeColumn, renderEllipsis } from '../../../utils/table-columns';
import { useWorkflowSelectableUsers } from '@/hooks/queries/workflow-shared';
import { ApiError } from '@/lib/query';
import {
  fetchPendingWorkflowTasks,
  type PendingWorkflowItem,
  useBatchApproveWorkflowTasks,
  useBatchRejectWorkflowTasks,
  useConsultWorkflowTask,
  useMyWorkflowConsults,
  usePendingWorkflowTasks,
  useReplyWorkflowConsult,
  workflowTaskKeys,
} from '@/hooks/queries/workflow-tasks';
import { usePublishedWorkflowDefinitions } from '@/hooks/queries/workflow-definitions';
import { ResetButton, SearchButton } from '@/components/toolbar-controls';
import { FilterSelect, KeywordInput } from '@/components/search-filters';

interface SearchParams {
  keyword: string;
  definitionId: number | null;
}

const defaultSearchParams: SearchParams = { keyword: '', definitionId: null };

type PendingItem = PendingWorkflowItem;
type SheetState = { instanceId: number; taskId: number; action: 'approve' | 'reject' | null };
/** 批量审批交互状态（模式与意见总是一起出现/重置） */
type BatchState = { mode: 'approve' | 'reject'; comment: string } | null;
/** 发起协办弹窗状态（打开时一次性初始化，关闭即整体丢弃） */
type ConsultState = { taskId: number; userIds: number[]; question: string } | null;

export default function PendingApprovalsPage() {
  const queryClient = useQueryClient();
  const {
    page, pageSize, setPage, buildPagination,
    draftParams, setDraftParams, submittedParams,
    handleSearch, applySearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: workflowTaskKeys.pendingLists });
  const [sheet, setSheet] = useState<SheetState | null>(null);
  // 通知深链：/workflow/pending?instanceId=&taskId= 自动弹出对应审批详情（消费后清掉参数）
  const [urlParams, setUrlParams] = useSearchParams();
  useEffect(() => {
    const instanceId = Number(urlParams.get('instanceId'));
    const taskId = Number(urlParams.get('taskId'));
    if (instanceId > 0 && taskId > 0) {
      setSheet({ instanceId, taskId, action: null });
      setUrlParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const { renderPhraseBar, phraseManageModal } = useQuickPhrases();
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);
  const [batch, setBatch] = useState<BatchState>(null);
  const [consult, setConsult] = useState<ConsultState>(null);
  const [myConsultsVisible, setMyConsultsVisible] = useState(false);
  const [replyDraft, setReplyDraft] = useState<Record<number, string>>({});
  const listParams = {
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    definitionId: submittedParams.definitionId ?? undefined,
  };
  const listQuery = usePendingWorkflowTasks(listParams);
  const definitionsQuery = usePublishedWorkflowDefinitions();
  const usersQuery = useWorkflowSelectableUsers({ enabled: consult !== null });
  const myConsultsQuery = useMyWorkflowConsults(myConsultsVisible);
  const batchApproveMutation = useBatchApproveWorkflowTasks();
  const batchRejectMutation = useBatchRejectWorkflowTasks();
  const consultMutation = useConsultWorkflowTask();
  const replyMutation = useReplyWorkflowConsult();
  const data = listQuery.data;
  const definitions = definitionsQuery.data ?? [];
  const userOptions = useMemo(
    () => (usersQuery.data ?? []).map((u) => ({ label: `${u.nickname ?? u.username}`, value: u.id })),
    [usersQuery.data],
  );
  const myConsults = myConsultsQuery.data?.list ?? [];
  const batchSubmitting = batchApproveMutation.isPending || batchRejectMutation.isPending;
  const submitting = consultMutation.isPending;

  const handleBatch = async () => {
    if (batchSubmitting || !batch) return;
    // 行键即待办任务 ID（同一实例可能有多条并行待办，各自独立勾选/审批）
    const taskIds = selectedRowKeys;
    if (taskIds.length === 0) { Toast.warning('请先选择待审批项'); return; }
    if (batch.mode === 'reject' && !batch.comment.trim()) { Toast.error('请填写驳回原因'); return; }
    try {
      const latest = await fetchPendingWorkflowTasks(listParams);
      const latestTaskIds = new Set((latest?.list ?? []).map((item) => item.pendingTaskId));
      const staleKeys = selectedRowKeys.filter((taskId) => !latestTaskIds.has(taskId));
      if (staleKeys.length > 0) {
        Toast.warning('部分任务状态已变化，请刷新后重试');
        setPage(latest.page);
        void queryClient.setQueryData(workflowTaskKeys.pendingList(listParams), latest);
        setSelectedRowKeys((keys) => keys.filter((key) => !staleKeys.includes(key)));
        return;
      }
      const res = batch.mode === 'reject'
        ? await batchRejectMutation.mutateAsync({ body: { taskIds, comment: batch.comment.trim() } })
        : await batchApproveMutation.mutateAsync({ body: { taskIds, comment: batch.comment.trim() || undefined } });
      const failed = res.failed ?? 0;
      if (failed > 0) {
        const reasons = [...new Set((res.results ?? [])
          .filter((r) => !r.success && r.message)
          .map((r) => r.message as string))];
        Toast.warning(reasons.length > 0 ? `批量处理完成（${reasons.join('；')}）` : '部分任务未处理');
      } else {
        Toast.success('批量处理完成');
      }
      setBatch(null);
      setSelectedRowKeys([]);
    } catch (err) {
      // 409 并发冲突：任务已被他人处理/流程状态变化，刷新列表引导重试（request 层已 toast 兜底其它错误）
      if (err instanceof ApiError && err.code === 409) {
        Toast.warning('任务状态已变化，已刷新列表，请重新选择');
        setSelectedRowKeys([]);
        void queryClient.invalidateQueries({ queryKey: workflowTaskKeys.pendingLists });
      }
    }
  };

  const openConsult = (record: PendingItem) => {
    setConsult({ taskId: record.pendingTaskId, userIds: [], question: '' });
  };

  const submitConsult = async () => {
    if (!consult) return;
    if (consult.userIds.length === 0) { Toast.warning('请选择协办人'); return; }
    await consultMutation.mutateAsync({ params: { taskId: consult.taskId }, body: { consulteeIds: consult.userIds, question: consult.question || undefined } });
    Toast.success('已发起协办');
    setConsult(null);
  };

  const openMyConsults = () => { setMyConsultsVisible(true); };

  const submitReply = async (id: number) => {
    const opinion = (replyDraft[id] ?? '').trim();
    if (!opinion) { Toast.warning('请填写协办意见'); return; }
    await replyMutation.mutateAsync({ params: { id }, body: { opinion } });
    Toast.success('已回复');
  };

  const columns: ColumnProps<PendingItem>[] = [
    {
      title: '申请标题',
      dataIndex: 'title',
      minWidth: 220,
      render: (v: string, record: PendingItem) => (
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <Typography.Text ellipsis={{ showTooltip: true }} style={{ flex: 1, minWidth: 0 }}>{v}</Typography.Text>
            {record.pendingDelegatedFromName && (
              <Tooltip content={record.pendingDelegationMode === 'suggest'
                ? `${record.pendingDelegatedFromName} 委托你提出审批建议，最终由其确认`
                : `代 ${record.pendingDelegatedFromName} 审批，你的操作将直接推进流程`}>
                <Tag size="small" color="cyan" style={{ flexShrink: 0 }}>代 {record.pendingDelegatedFromName}</Tag>
              </Tooltip>
            )}
            {record.requiresIndividual && (
              <Tag size="small" color="amber" style={{ flexShrink: 0 }}>需单独审批</Tag>
            )}
          </div>
          <WorkflowSummaryLine items={record.summary} />
        </div>
      ),
    },
    {
      title: '优先级',
      dataIndex: 'priority',
      width: 80,
      render: (v: PendingItem['priority']) => <WorkflowPriorityTag priority={v} />,
    },
    {
      title: '时限',
      dataIndex: 'slaLevel',
      width: 150,
      render: (_: unknown, record: PendingItem) => <WorkflowSLATag level={record.slaLevel} overdueSec={record.slaOverdueSec} deadline={record.slaDeadline} />,
    },
    {
      title: '流程名称',
      dataIndex: 'definitionName',
      width: 160,
      render: renderEllipsis,
    },
    {
      title: '申请人',
      dataIndex: 'initiatorName',
      width: 120,
      render: (v: string | null) => v ?? '—',
    },
    dateTimeColumn('提交时间', 'createdAt'),
    createOperationColumn<PendingItem>({
      width: 290,
      desktopInlineKeys: ['detail', 'approve', 'reject'],
      actions: (record) => [
        {
          key: 'detail',
          label: '详情',
          onClick: () => setSheet({ instanceId: record.id, taskId: record.pendingTaskId, action: null }),
        },
        {
          key: 'approve',
          label: record.pendingTaskNodeType === 'handler' ? '完成办理' : '同意',
          type: 'primary',
          onClick: () => setSheet({ instanceId: record.id, taskId: record.pendingTaskId, action: 'approve' }),
        },
        {
          key: 'reject',
          label: record.pendingTaskNodeType === 'handler' ? '无法办理' : '拒绝',
          danger: true,
          onClick: () => setSheet({ instanceId: record.id, taskId: record.pendingTaskId, action: 'reject' }),
        },
        { key: 'consult', label: '协办', onClick: () => openConsult(record) },
      ],
    }),
  ];

  const renderKeywordSearch = () => (
    <KeywordInput placeholder="请输入审批标题" value={draftParams.keyword} onChange={(v) => setDraftParams((prev) => ({ ...prev, keyword: v }))} onSearch={handleSearch} width={200} />
  );

  const renderDefinitionFilter = () => (
    <FilterSelect
      placeholder="全部流程类型"
      items={definitions.map((d) => ({ value: d.id, label: d.name }))}
      value={draftParams.definitionId ?? undefined}
      onChange={(v) => setDraftParams((prev) => ({ ...prev, definitionId: v ?? null }))}
      width={180}
    />
  );

  const renderSearchButton = () => (
    <SearchButton onClick={handleSearch} />
  );

  const renderResetButton = () => (
    <ResetButton onClick={handleReset} />
  );

  const renderMyConsultsButton = () => (
    <Button type="tertiary" onClick={openMyConsults}>我的协办</Button>
  );

  const renderBatchButtons = () => selectedRowKeys.length > 0 ? (
    <>
      <Button type="primary" theme="solid" icon={<Plus size={14} />} onClick={() => setBatch({ mode: 'approve', comment: '' })}>
        批量同意（{selectedRowKeys.length}）
      </Button>
      <Button type="danger" theme="solid" onClick={() => setBatch({ mode: 'reject', comment: '' })}>
        批量拒绝（{selectedRowKeys.length}）
      </Button>
    </>
  ) : null;

  return (
    <div className="page-container">
      <SavedViewsBar
        pageKey="workflow-pending"
        currentFilters={submittedParams as unknown as Record<string, unknown>}
        onApply={(filters) => {
          const next = { ...defaultSearchParams, ...(filters as Partial<SearchParams>) };
          applySearch(next);
        }}
      />
      <SearchToolbar
        primary={(
          <>
            {renderKeywordSearch()}
            {renderDefinitionFilter()}
            {renderSearchButton()}
            {renderResetButton()}
            {renderMyConsultsButton()}
            {renderBatchButtons()}
          </>
        )}
        mobilePrimary={(
          <>
            {renderKeywordSearch()}
            {renderSearchButton()}
          </>
        )}
        mobileFilters={renderDefinitionFilter()}
        mobileActions={(
          <>
            {renderResetButton()}
            {renderMyConsultsButton()}
            {renderBatchButtons()}
          </>
        )}
        filterTitle="待办审批筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />
      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={data?.list ?? []}
        rowKey="pendingTaskId"
        loading={listQuery.isFetching}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        pagination={buildPagination(data?.total ?? 0)}
        rowSelection={{
          selectedRowKeys,
          getCheckboxProps: (record: PendingItem) => ({ disabled: !!record.requiresIndividual }),
          onChange: (keys) => setSelectedRowKeys(((keys as (string | number)[]) ?? []).map(Number)),
        }}
      />

      <WorkflowApprovalDetailSheet
        instanceId={sheet?.instanceId ?? null}
        taskId={sheet?.taskId ?? null}
        initialAction={sheet?.action ?? null}
        visible={!!sheet}
        onClose={() => setSheet(null)}
        onActionDone={() => { void queryClient.invalidateQueries({ queryKey: ['workflow'] }); }}
      />

      <AppModal
        title={batch?.mode === 'approve' ? `批量同意（${selectedRowKeys.length}）` : `批量拒绝（${selectedRowKeys.length}）`}
        visible={!!batch}
        onCancel={() => setBatch(null)}
        onOk={() => void handleBatch()}
        okButtonProps={{ loading: batchSubmitting, type: batch?.mode === 'approve' ? 'primary' : 'danger' }}
        okText="确认"
        style={{ width: 480 }}
      >
        <Typography.Text type="tertiary" style={{ display: 'block', marginBottom: 8 }}>
          将对选中的 {selectedRowKeys.length} 条待办执行{batch?.mode === 'approve' ? '同意' : '拒绝'}操作（逐条处理，失败项会单独提示）。
        </Typography.Text>
        <TextArea
          value={batch?.comment ?? ''}
          onChange={(v) => setBatch((b) => (b ? { ...b, comment: v } : b))}
          placeholder={batch?.mode === 'approve' ? '批量审批意见（可选）' : '批量拒绝原因（必填）'}
          autosize={{ minRows: 2, maxRows: 4 }}
          maxCount={500}
        />
        <div style={{ marginTop: 8 }}>{renderPhraseBar((t) => setBatch((b) => (b ? { ...b, comment: b.comment ? `${b.comment} ${t}` : t } : b)))}</div>
      </AppModal>
      {phraseManageModal}

      <AppModal
        title="邀请协办"
        visible={!!consult}
        onCancel={() => setConsult(null)}
        onOk={() => void submitConsult()}
        okButtonProps={{ loading: submitting, type: 'primary' }}
        okText="发起协办"
        style={{ width: 480 }}
      >
        <Typography.Text type="tertiary" style={{ display: 'block', marginBottom: 8 }}>
          邀请他人就本单据给出协办意见（不代替你审批，你仍需自行决策）。
        </Typography.Text>
        <Select
          multiple
          filter
          style={{ width: '100%', marginBottom: 8 }}
          placeholder="选择协办人"
          optionList={userOptions}
          value={consult?.userIds ?? []}
          onChange={(v) => setConsult((s) => (s ? { ...s, userIds: (v as number[]) ?? [] } : s))}
        />
        <TextArea
          value={consult?.question ?? ''}
          onChange={(v) => setConsult((s) => (s ? { ...s, question: v } : s))}
          placeholder="协办说明（可选）"
          autosize={{ minRows: 2, maxRows: 4 }}
          maxCount={500}
        />
      </AppModal>

      <SideSheet
        title="我的协办"
        visible={myConsultsVisible}
        onCancel={() => setMyConsultsVisible(false)}
        width={560}
        bodyStyle={{ padding: 16 }}
      >
        {myConsults.length === 0 ? (
          <Typography.Text type="tertiary">暂无协办邀请。</Typography.Text>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {myConsults.map((c) => (
              <div key={c.id} style={{ border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-medium)', padding: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                  <Typography.Text strong>{c.inviterName ?? `用户#${c.inviterId}`}</Typography.Text>
                  <Typography.Text type="tertiary" size="small">邀请你协办</Typography.Text>
                  {c.nodeName && <Tag size="small" color="grey">{c.nodeName}</Tag>}
                  {c.status === 'pending' ? <Tag size="small" color="amber">待回复</Tag> : <Tag size="small" color="green">已回复</Tag>}
                </div>
                {c.question && <div style={{ marginBottom: 6, color: 'var(--semi-color-text-2)' }}>问题：{c.question}</div>}
                {c.status === 'replied'
                  ? <div>我的意见：{c.opinion}</div>
                  : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <TextArea
                        value={replyDraft[c.id] ?? ''}
                        onChange={(v) => setReplyDraft((prev) => ({ ...prev, [c.id]: v }))}
                        placeholder="填写协办意见"
                        autosize={{ minRows: 2, maxRows: 4 }}
                        maxCount={1000}
                      />
                      <div><Button type="primary" size="small" onClick={() => void submitReply(c.id)}>回复</Button></div>
                    </div>
                  )}
              </div>
            ))}
          </div>
        )}
      </SideSheet>
    </div>
  );
}
