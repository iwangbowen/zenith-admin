import { useCallback, useEffect, useRef, useState } from 'react';
import { AppModal } from '@/components/AppModal';
import {
  Button,
  Input,
  Select,
  SideSheet,
  Tag,
  TextArea,
  Toast,
  Typography,
} from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Plus, RotateCcw, Search } from 'lucide-react';
import type { WorkflowInstance, WorkflowDefinition, PaginatedResponse, WorkflowSlaLevel } from '@zenith/shared';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import WorkflowPriorityTag from '@/components/workflow/WorkflowPriorityTag';
import WorkflowSLATag from '@/components/workflow/WorkflowSLATag';
import WorkflowApprovalDetailSheet from '@/components/workflow/WorkflowApprovalDetailSheet';
import { usePagination } from '@/hooks/usePagination';
import { useQuickPhrases } from '@/hooks/useQuickPhrases';
import { renderEllipsis } from '../../../utils/table-columns';

interface SearchParams {
  keyword: string;
  definitionId: number | null;
}

const defaultSearchParams: SearchParams = { keyword: '', definitionId: null };

type PendingItem = WorkflowInstance & { pendingTaskId: number; pendingSignatureRequired?: boolean; requiresIndividual?: boolean; slaLevel?: WorkflowSlaLevel; slaOverdueSec?: number | null; slaDeadline?: string | null };
type SheetState = { instanceId: number; taskId: number; action: 'approve' | 'reject' | null };

export default function PendingApprovalsPage() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<PaginatedResponse<PendingItem> | null>(null);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearchParams);
  const searchParamsRef = useRef<SearchParams>(defaultSearchParams);
  searchParamsRef.current = searchParams;
  const [definitions, setDefinitions] = useState<WorkflowDefinition[]>([]);
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [userOptions, setUserOptions] = useState<Array<{ label: string; value: number }>>([]);
  const { renderPhraseBar, phraseManageModal } = useQuickPhrases();
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);
  const [batchMode, setBatchMode] = useState<'approve' | 'reject' | null>(null);
  const [batchComment, setBatchComment] = useState('');
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const [consultVisible, setConsultVisible] = useState(false);
  const [consultTaskId, setConsultTaskId] = useState<number | null>(null);
  const [consultUserIds, setConsultUserIds] = useState<number[]>([]);
  const [consultQuestion, setConsultQuestion] = useState('');
  const [myConsultsVisible, setMyConsultsVisible] = useState(false);
  const [myConsults, setMyConsults] = useState<import('@zenith/shared').WorkflowTaskConsult[]>([]);
  const [replyDraft, setReplyDraft] = useState<Record<number, string>>({});

  const loadUserOptions = useCallback(async () => {
    if (userOptions.length > 0) return;
    try {
      const res = await request.get<Array<{ id: number; nickname: string; username: string }>>('/api/users/all');
      if (res.code === 0) {
        setUserOptions(res.data.map((u) => ({ label: `${u.nickname ?? u.username}`, value: u.id })));
      }
    } catch {
      // ignore
    }
  }, [userOptions.length]);

  const fetchList = useCallback(async (p = page, ps = pageSize, params?: SearchParams) => {
    const { keyword: kw, definitionId: did } = params ?? searchParamsRef.current;
    setLoading(true);
    try {
      const query = new URLSearchParams({
        page: String(p),
        pageSize: String(ps),
        ...(kw ? { keyword: kw } : {}),
        ...(did === null ? {} : { definitionId: String(did) }),
      }).toString();
      const res = await request.get<PaginatedResponse<PendingItem>>(`/api/workflows/instances/pending-mine?${query}`);
      if (res.code === 0) {
        setData(res.data);
        setPage(res.data.page);
      }
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, setPage]);

  const fetchPendingSnapshot = useCallback(async (p = page, ps = pageSize, params?: SearchParams) => {
    const { keyword: kw, definitionId: did } = params ?? searchParamsRef.current;
    const query = new URLSearchParams({
      page: String(p),
      pageSize: String(ps),
      ...(kw ? { keyword: kw } : {}),
      ...(did === null ? {} : { definitionId: String(did) }),
    }).toString();
    const res = await request.get<PaginatedResponse<PendingItem>>(`/api/workflows/instances/pending-mine?${query}`, { silent: true });
    return res.code === 0 ? res.data : null;
  }, [page, pageSize]);

  useEffect(() => {
    void fetchList();
    request.get<WorkflowDefinition[]>('/api/workflows/definitions/published')
      .then((res) => { if (res.code === 0 && res.data) setDefinitions(res.data); });
  }, [fetchList]);

  const handleSearch = () => {
    setPage(1);
    void fetchList(1, pageSize);
  };

  const handleReset = () => {
    setSearchParams(defaultSearchParams);
    setPage(1);
    void fetchList(1, pageSize, defaultSearchParams);
  };

  const handleBatch = async () => {
    if (batchSubmitting) return;
    const taskIds = (data?.list ?? [])
      .filter((it) => selectedRowKeys.includes(it.id))
      .map((it) => it.pendingTaskId)
      .filter((v): v is number => typeof v === 'number');
    if (taskIds.length === 0) { Toast.warning('请先选择待审批项'); return; }
    if (batchMode === 'reject' && !batchComment.trim()) { Toast.error('请填写驳回原因'); return; }
    setBatchSubmitting(true);
    try {
      const latest = await fetchPendingSnapshot();
      const latestMap = new Map((latest?.list ?? []).map((item) => [item.id, item.pendingTaskId]));
      const staleKeys = selectedRowKeys.filter((instanceId) => latestMap.get(instanceId) == null
        || !taskIds.includes(latestMap.get(instanceId) as number));
      if (staleKeys.length > 0) {
        Toast.warning('部分任务状态已变化，请刷新后重试');
        if (latest) {
          setData(latest);
          setPage(latest.page);
        } else {
          void fetchList();
        }
        setSelectedRowKeys((keys) => keys.filter((key) => !staleKeys.includes(key)));
        return;
      }
      const path = batchMode === 'approve' ? 'batch-approve' : 'batch-reject';
      const payload = batchMode === 'reject'
        ? { taskIds, comment: batchComment.trim() }
        : { taskIds, comment: batchComment.trim() || undefined };
      const res = await request.post<{ succeeded: number; failed: number; results?: Array<{ taskId: number; success: boolean; message?: string }> }>(
        `/api/workflows/tasks/${path}`,
        payload,
        { headers: { 'X-Idempotency-Key': `workflow-${path}-${taskIds.join('-')}` } },
      );
      if (res.code === 0) {
        const failed = res.data?.failed ?? 0;
        if (failed > 0) {
          const reasons = [...new Set((res.data?.results ?? [])
            .filter((r) => !r.success && r.message)
            .map((r) => r.message as string))];
          Toast.warning(reasons.length > 0 ? `${res.message}（${reasons.join('；')}）` : (res.message || '部分任务未处理'));
        } else {
          Toast.success(res.message || '批量处理完成');
        }
        setBatchMode(null);
        setBatchComment('');
        setSelectedRowKeys([]);
        void fetchList();
      } else {
        Toast.error(res.message || '批量处理失败');
      }
    } finally {
      setBatchSubmitting(false);
    }
  };

  const openConsult = (record: PendingItem) => {
    setConsultTaskId(record.pendingTaskId);
    setConsultUserIds([]);
    setConsultQuestion('');
    void loadUserOptions();
    setConsultVisible(true);
  };

  const submitConsult = async () => {
    if (!consultTaskId) return;
    if (consultUserIds.length === 0) { Toast.warning('请选择协办人'); return; }
    setSubmitting(true);
    try {
      const res = await request.post(`/api/workflows/tasks/${consultTaskId}/consult`, { consulteeIds: consultUserIds, question: consultQuestion || undefined });
      if (res.code === 0) { Toast.success('已发起协办'); setConsultVisible(false); }
      else Toast.error(res.message || '发起失败');
    } finally { setSubmitting(false); }
  };

  const loadMyConsults = useCallback(async () => {
    const res = await request.get<PaginatedResponse<import('@zenith/shared').WorkflowTaskConsult>>('/api/workflows/instances/consults/mine?pageSize=50');
    if (res.code === 0) setMyConsults(res.data.list ?? []);
  }, []);

  const openMyConsults = () => { setMyConsultsVisible(true); void loadMyConsults(); };

  const submitReply = async (id: number) => {
    const opinion = (replyDraft[id] ?? '').trim();
    if (!opinion) { Toast.warning('请填写协办意见'); return; }
    const res = await request.post(`/api/workflows/instances/consults/${id}/reply`, { opinion });
    if (res.code === 0) { Toast.success('已回复'); void loadMyConsults(); }
    else Toast.error(res.message || '回复失败');
  };

  const columns: ColumnProps<PendingItem>[] = [
    {
      title: '申请标题',
      dataIndex: 'title',
      width: 220,
      render: (v: string, record: PendingItem) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <Typography.Text ellipsis={{ showTooltip: true }} style={{ flex: 1, minWidth: 0 }}>{v}</Typography.Text>
          {record.requiresIndividual && (
            <Tag size="small" color="amber" style={{ flexShrink: 0 }}>需单独审批</Tag>
          )}
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
    {
      title: '提交时间',
      dataIndex: 'createdAt',
      width: 180,
      render: (v: string) => formatDateTime(v),
    },
    createOperationColumn<PendingItem>({
      width: 280,
      desktopInlineKeys: ['detail', 'approve', 'reject', 'consult'],
      actions: (record) => [
        {
          key: 'detail',
          label: '详情',
          onClick: () => setSheet({ instanceId: record.id, taskId: record.pendingTaskId, action: null }),
        },
        {
          key: 'approve',
          label: '通过',
          type: 'primary',
          onClick: () => setSheet({ instanceId: record.id, taskId: record.pendingTaskId, action: 'approve' }),
        },
        {
          key: 'reject',
          label: '驳回',
          danger: true,
          onClick: () => setSheet({ instanceId: record.id, taskId: record.pendingTaskId, action: 'reject' }),
        },
        { key: 'consult', label: '协办', onClick: () => openConsult(record) },
      ],
    }),
  ];

  const renderKeywordSearch = () => (
    <Input
      prefix={<Search size={14} />}
      placeholder="请输入审批标题"
      value={searchParams.keyword}
      onChange={(v) => setSearchParams((prev) => ({ ...prev, keyword: v }))}
      onEnterPress={handleSearch}
      style={{ width: 200 }}
      showClear
    />
  );

  const renderDefinitionFilter = () => (
    <Select
      placeholder="流程类型"
      value={searchParams.definitionId ?? undefined}
      onChange={(v) => setSearchParams((prev) => ({ ...prev, definitionId: typeof v === 'number' ? v : null }))}
      style={{ width: 180 }}
      showClear
    >
      {definitions.map((d) => (
        <Select.Option key={d.id} value={d.id}>{d.name}</Select.Option>
      ))}
    </Select>
  );

  const renderSearchButton = () => (
    <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
  );

  const renderResetButton = () => (
    <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
  );

  const renderMyConsultsButton = () => (
    <Button type="tertiary" onClick={openMyConsults}>我的协办</Button>
  );

  const renderBatchButtons = () => selectedRowKeys.length > 0 ? (
    <>
      <Button type="primary" theme="solid" icon={<Plus size={14} />} onClick={() => { setBatchComment(''); setBatchMode('approve'); }}>
        批量通过（{selectedRowKeys.length}）
      </Button>
      <Button type="danger" theme="solid" onClick={() => { setBatchComment(''); setBatchMode('reject'); }}>
        批量驳回（{selectedRowKeys.length}）
      </Button>
    </>
  ) : null;

  return (
    <div className="page-container">
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
        rowKey="id"
        loading={loading}
        onRefresh={() => void fetchList()}
        refreshLoading={loading}
        pagination={buildPagination(data?.total ?? 0, fetchList)}
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
        onActionDone={() => { void fetchList(); }}
      />

      <AppModal
        title={batchMode === 'approve' ? `批量通过（${selectedRowKeys.length}）` : `批量驳回（${selectedRowKeys.length}）`}
        visible={!!batchMode}
        onCancel={() => setBatchMode(null)}
        onOk={() => void handleBatch()}
        okButtonProps={{ loading: batchSubmitting, type: batchMode === 'approve' ? 'primary' : 'danger' }}
        okText="确认"
        style={{ width: 480 }}
      >
        <Typography.Text type="tertiary" style={{ display: 'block', marginBottom: 8 }}>
          将对选中的 {selectedRowKeys.length} 条待办执行{batchMode === 'approve' ? '通过' : '驳回'}操作（逐条处理，失败项会单独提示）。
        </Typography.Text>
        <TextArea
          value={batchComment}
          onChange={setBatchComment}
          placeholder={batchMode === 'approve' ? '批量审批意见（可选）' : '批量驳回原因（必填）'}
          autosize={{ minRows: 2, maxRows: 4 }}
          maxCount={500}
        />
        <div style={{ marginTop: 8 }}>{renderPhraseBar((t) => setBatchComment((c) => (c ? `${c} ${t}` : t)))}</div>
      </AppModal>
      {phraseManageModal}

      <AppModal
        title="邀请协办"
        visible={consultVisible}
        onCancel={() => setConsultVisible(false)}
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
          value={consultUserIds}
          onChange={(v) => setConsultUserIds((v as number[]) ?? [])}
        />
        <TextArea
          value={consultQuestion}
          onChange={setConsultQuestion}
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
              <div key={c.id} style={{ border: '1px solid var(--semi-color-border)', borderRadius: 6, padding: 12 }}>
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
