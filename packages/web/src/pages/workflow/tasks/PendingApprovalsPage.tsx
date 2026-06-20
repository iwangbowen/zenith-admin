import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppModal } from '@/components/AppModal';
import {
  Banner,
  Button,
  Form,
  Input,
  Popconfirm,
  Select,
  SideSheet,
  Space,
  Spin,
  Tag,
  TextArea,
  Toast,
  Typography,
  Upload,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Plus, RotateCcw, Search } from 'lucide-react';
import type { WorkflowInstance, WorkflowDefinition, PaginatedResponse, WorkflowTask, WorkflowActionButtonKey, WorkflowActionButtonConfig, WorkflowQuickPhrase } from '@zenith/shared';
import { request } from '@/utils/request';
import { config } from '@/config';
import { formatDateTime } from '@/utils/date';
import { resolveRejectTargetHint } from '@/utils/workflow-reject';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { usePagination } from '@/hooks/usePagination';
import WorkflowInstanceDetailPanel from '@/components/workflow/WorkflowInstanceDetailPanel';
import SignaturePad from '@/components/SignaturePad';
import { renderEllipsis } from '../../../utils/table-columns';

interface SearchParams {
  keyword: string;
  definitionId: number | null;
}

const defaultSearchParams: SearchParams = { keyword: '', definitionId: null };

type PendingItem = WorkflowInstance & { pendingTaskId: number; pendingSignatureRequired?: boolean };
type AddSignPosition = 'before' | 'after' | 'parallel';
type AddSignMode = 'and' | 'or';

const DEFAULT_BUTTONS: Record<WorkflowActionButtonKey, WorkflowActionButtonConfig> = {
  approve: { enabled: true, displayName: '同意', opinionName: '审批意见' },
  reject: { enabled: true, displayName: '拒绝', opinionName: '拒绝原因' },
  transfer: { enabled: false, displayName: '转办', opinionName: '转办说明' },
  delegate: { enabled: false, displayName: '委派', opinionName: '委派说明' },
  addSign: { enabled: false, displayName: '加签', opinionName: '加签说明' },
  reduceSign: { enabled: false, displayName: '减签', opinionName: '减签说明' },
  return: { enabled: false, displayName: '退回', opinionName: '退回原因' },
};

function resolveButton(
  cfg: Partial<Record<WorkflowActionButtonKey, WorkflowActionButtonConfig>> | null | undefined,
  key: WorkflowActionButtonKey,
): WorkflowActionButtonConfig {
  const defaults = DEFAULT_BUTTONS[key];
  const override = cfg?.[key];
  return override ? { ...defaults, ...override } : defaults;
}

interface UploadedFile { name: string; url: string; size?: number }

export default function PendingApprovalsPage() {
  const approveFormApi = useRef<FormApi | null>(null);
  const rejectFormApi = useRef<FormApi | null>(null);
  const transferFormApi = useRef<FormApi | null>(null);
  const delegateFormApi = useRef<FormApi | null>(null);
  const addSignFormApi = useRef<FormApi | null>(null);
  const reduceSignFormApi = useRef<FormApi | null>(null);
  const returnFormApi = useRef<FormApi | null>(null);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<PaginatedResponse<PendingItem> | null>(null);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearchParams);
  const searchParamsRef = useRef<SearchParams>(defaultSearchParams);
  searchParamsRef.current = searchParams;
  const [definitions, setDefinitions] = useState<WorkflowDefinition[]>([]);
  const [selectedItem, setSelectedItem] = useState<PendingItem | null>(null);
  const [approveVisible, setApproveVisible] = useState(false);
  const [rejectVisible, setRejectVisible] = useState(false);
  const [transferVisible, setTransferVisible] = useState(false);
  const [delegateVisible, setDelegateVisible] = useState(false);
  const [addSignVisible, setAddSignVisible] = useState(false);
  const [reduceSignVisible, setReduceSignVisible] = useState(false);
  const [returnVisible, setReturnVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [detailVisible, setDetailVisible] = useState(false);
  const [detail, setDetail] = useState<WorkflowInstance | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailDef, setDetailDef] = useState<WorkflowDefinition | null>(null);
  const [rejectInstance, setRejectInstance] = useState<WorkflowInstance | null>(null);
  const [rejectDef, setRejectDef] = useState<WorkflowDefinition | null>(null);
  const [rejectHintLoading, setRejectHintLoading] = useState(false);
  const [approveAttachments, setApproveAttachments] = useState<UploadedFile[]>([]);
  const [approveSignature, setApproveSignature] = useState('');
  const [userOptions, setUserOptions] = useState<Array<{ label: string; value: number }>>([]);
  const [selectedNextApprovers, setSelectedNextApprovers] = useState<number[]>([]);
  const [addSignPosition, setAddSignPosition] = useState<AddSignPosition>('after');
  const [signMode, setSignMode] = useState<AddSignMode>('and');
  // 批量审批
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);
  const [batchMode, setBatchMode] = useState<'approve' | 'reject' | null>(null);
  const [batchComment, setBatchComment] = useState('');
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  // 审批意见常用语
  const [quickPhrases, setQuickPhrases] = useState<WorkflowQuickPhrase[]>([]);
  const [phraseManageVisible, setPhraseManageVisible] = useState(false);
  const [newPhrase, setNewPhrase] = useState('');
  // 协办（T3-5）
  const [consultVisible, setConsultVisible] = useState(false);
  const [consultTaskId, setConsultTaskId] = useState<number | null>(null);
  const [consultUserIds, setConsultUserIds] = useState<number[]>([]);
  const [consultQuestion, setConsultQuestion] = useState('');
  const [myConsultsVisible, setMyConsultsVisible] = useState(false);
  const [myConsults, setMyConsults] = useState<import('@zenith/shared').WorkflowTaskConsult[]>([]);
  const [replyDraft, setReplyDraft] = useState<Record<number, string>>({});

  const currentTask: WorkflowTask | null = useMemo(() => {
    if (!detail || !selectedItem) return null;
    return detail.tasks?.find((t) => t.id === selectedItem.pendingTaskId) ?? null;
  }, [detail, selectedItem]);

  const actionButtons = currentTask?.actionButtons ?? null;
  const btnApprove = useMemo(() => resolveButton(actionButtons, 'approve'), [actionButtons]);
  const btnReject = useMemo(() => resolveButton(actionButtons, 'reject'), [actionButtons]);
  const btnTransfer = useMemo(() => resolveButton(actionButtons, 'transfer'), [actionButtons]);
  const btnDelegate = useMemo(() => resolveButton(actionButtons, 'delegate'), [actionButtons]);
  const btnAddSign = useMemo(() => resolveButton(actionButtons, 'addSign'), [actionButtons]);
  const btnReduceSign = useMemo(() => resolveButton(actionButtons, 'reduceSign'), [actionButtons]);
  const btnReturn = useMemo(() => resolveButton(actionButtons, 'return'), [actionButtons]);

  /** 同节点上加签产生的、尚未处理的兄弟任务（用于减签候选） */
  const reduceSignCandidates = useMemo(() => {
    if (!detail || !currentTask) return [] as WorkflowTask[];
    return (detail.tasks ?? []).filter((t) =>
      t.id !== currentTask.id
      && t.nodeKey === currentTask.nodeKey
      && (t.status === 'pending' || t.status === 'waiting')
      && (t.comment?.startsWith('[加签') ?? false),
    );
  }, [detail, currentTask]);

  const returnTargetOptions = useMemo(() => {
    if (!detailDef || !currentTask) return [] as Array<{ label: string; value: string }>;
    const nodes = detailDef.flowData?.nodes ?? [];
    return nodes
      .filter((n) => (n.data.type === 'approve' || n.data.type === 'handler') && n.data.key !== currentTask.nodeKey)
      .map((n) => ({ label: n.data.label ?? n.data.key, value: n.data.key }));
  }, [detailDef, currentTask]);

  /** 判断当前节点下游是否存在 approverSelect 节点（需要本次审批人选人） */
  const hasApproverSelectDownstream = useMemo(() => {
    if (!detailDef || !currentTask) return false;
    const flow = detailDef.flowData;
    if (!flow) return false;
    const startNode = flow.nodes.find((n) => n.data.key === currentTask.nodeKey);
    if (!startNode) return false;
    const visited = new Set<string>([startNode.id]);
    const queue = [startNode.id];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const e of flow.edges) {
        if (e.source !== cur || visited.has(e.target)) continue;
        visited.add(e.target);
        const targetNode = flow.nodes.find((n) => n.id === e.target);
        if (targetNode?.data.assigneeType === 'approverSelect') return true;
        queue.push(e.target);
      }
    }
    return false;
  }, [detailDef, currentTask]);

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

  const loadQuickPhrases = useCallback(async () => {
    try {
      const res = await request.get<WorkflowQuickPhrase[]>('/api/workflows/quick-phrases');
      if (res.code === 0) setQuickPhrases(res.data ?? []);
    } catch {
      // ignore
    }
  }, []);

  const appendPhrase = (formApi: FormApi | null, text: string) => {
    if (!formApi) return;
    const cur = (formApi.getValue('comment') as string | undefined) ?? '';
    formApi.setValue('comment', cur ? `${cur} ${text}` : text);
  };

  const handleAddPhrase = async () => {
    const text = newPhrase.trim();
    if (!text) return;
    const res = await request.post('/api/workflows/quick-phrases', { content: text, sort: 0 });
    if (res.code === 0) { setNewPhrase(''); void loadQuickPhrases(); }
    else Toast.error(res.message || '新增失败');
  };

  const handleDeletePhrase = async (id: number) => {
    const res = await request.delete(`/api/workflows/quick-phrases/${id}`);
    if (res.code === 0) void loadQuickPhrases();
    else Toast.error(res.message || '删除失败');
  };

  const handleBatch = async () => {
    const taskIds = (data?.list ?? [])
      .filter((it) => selectedRowKeys.includes(it.id))
      .map((it) => it.pendingTaskId)
      .filter((v): v is number => typeof v === 'number');
    if (taskIds.length === 0) { Toast.warning('请先选择待审批项'); return; }
    if (batchMode === 'reject' && !batchComment.trim()) { Toast.error('请填写驳回原因'); return; }
    setBatchSubmitting(true);
    try {
      const path = batchMode === 'approve' ? 'batch-approve' : 'batch-reject';
      const res = await request.post<{ succeeded: number; failed: number }>(
        `/api/workflows/tasks/${path}`,
        { taskIds, comment: batchComment.trim() || undefined },
      );
      if (res.code === 0) {
        Toast.success(res.message || '批量处理完成');
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

  const renderPhraseBar = (onPick: (text: string) => void) => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8, alignItems: 'center' }}>
      {quickPhrases.map((p) => (
        <Tag key={p.id} color="white" style={{ cursor: 'pointer', border: '1px solid var(--semi-color-border)' }} onClick={() => onPick(p.content)}>
          {p.content}
        </Tag>
      ))}
      <Button theme="borderless" size="small" onClick={() => setPhraseManageVisible(true)}>管理常用语</Button>
    </div>
  );

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
  }, [page, pageSize]);

  useEffect(() => {
    void fetchList();
    void loadQuickPhrases();
    request.get<WorkflowDefinition[]>('/api/workflows/definitions/published')
      .then((res) => { if (res.code === 0 && res.data) setDefinitions(res.data); });
  }, [fetchList, loadQuickPhrases]);

  // 当审批弹窗打开且下游存在 approverSelect 节点，预加载用户列表
  useEffect(() => {
    if (approveVisible && hasApproverSelectDownstream) void loadUserOptions();
  }, [approveVisible, hasApproverSelectDownstream, loadUserOptions]);

  const openDetail = (item: PendingItem) => {
    setSelectedItem(item);
    setDetailLoading(true);
    setDetailVisible(true);
    setDetailDef(null);
    const p = request.get<WorkflowInstance>(`/api/workflows/instances/${item.id}`)
      .then(res => {
        if (res.code === 0) {
          setDetail(res.data);
          return request.get<WorkflowDefinition>(`/api/workflows/definitions/${res.data.definitionId}`);
        }
        return null;
      })
      .then(defRes => {
        if (defRes?.code === 0) setDetailDef(defRes.data);
      })
      .finally(() => setDetailLoading(false));
    // mark as intentionally floating promise
    p.catch(() => undefined);
  };

  const handleApprove = async () => {
    if (!selectedItem) return;
    const needSignature = currentTask?.signatureRequired ?? selectedItem.pendingSignatureRequired ?? false;
    try {
      const values = await approveFormApi.current?.validate();
      if (btnApprove.uploadRequired && approveAttachments.length === 0) {
        Toast.error('请上传附件后再提交');
        return;
      }
      if (needSignature && !approveSignature) {
        Toast.error('该节点要求手写签名，请先签名');
        return;
      }
      setSubmitting(true);
      const res = await request.post(
        `/api/workflows/tasks/${selectedItem.pendingTaskId}/approve`,
        {
          comment: values?.comment ?? '',
          attachments: approveAttachments.length > 0 ? approveAttachments : undefined,
          signature: approveSignature || undefined,
          selectedNextApprovers: hasApproverSelectDownstream && selectedNextApprovers.length > 0 ? selectedNextApprovers : undefined,
        }
      );
      if (res.code === 0) {
        Toast.success('审批通过');
        setApproveVisible(false);
        setApproveAttachments([]);
        setApproveSignature('');
        setSelectedNextApprovers([]);
        void fetchList();
      }
    } catch {
      // validation failed
    } finally {
      setSubmitting(false);
    }
  };

  const openReject = useCallback(async (item: PendingItem) => {
    setSelectedItem(item);
    setRejectVisible(true);
    // 若详情面板已为同一实例加载过定义，复用；否则现拉
    if (detail?.id === item.id && detailDef) {
      setRejectInstance(detail);
      setRejectDef(detailDef);
      return;
    }
    setRejectInstance(null);
    setRejectDef(null);
    setRejectHintLoading(true);
    try {
      const instRes = await request.get<WorkflowInstance>(`/api/workflows/instances/${item.id}`);
      if (instRes.code === 0) {
        setRejectInstance(instRes.data);
        const defRes = await request.get<WorkflowDefinition>(`/api/workflows/definitions/${instRes.data.definitionId}`);
        if (defRes.code === 0) setRejectDef(defRes.data);
      }
    } finally {
      setRejectHintLoading(false);
    }
  }, [detail, detailDef]);

  const rejectHint = useMemo(
    () => resolveRejectTargetHint(rejectInstance, rejectDef?.flowData ?? null),
    [rejectInstance, rejectDef]
  );

  const handleReject = async () => {
    if (!selectedItem) return;
    try {
      const values = await rejectFormApi.current?.validate() as Record<string, unknown>;
      setSubmitting(true);
      const res = await request.post(
        `/api/workflows/tasks/${selectedItem.pendingTaskId}/reject`,
        { comment: values.comment as string }
      );
      if (res.code === 0) {
        Toast.success('已驳回');
        setRejectVisible(false);
        void fetchList();
      }
    } catch {
      // validation failed
    } finally {
      setSubmitting(false);
    }
  };

  const submitSimpleAction = async (
    path: string,
    body: Record<string, unknown>,
    successMsg: string,
    closer: () => void,
  ) => {
    if (!selectedItem) return;
    try {
      setSubmitting(true);
      const res = await request.post(`/api/workflows/tasks/${selectedItem.pendingTaskId}/${path}`, body);
      if (res.code === 0) {
        Toast.success(successMsg);
        closer();
        void fetchList();
        setDetailVisible(false);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleTransfer = async () => {
    try {
      const values = await transferFormApi.current?.validate() as { targetUserId: number; comment?: string };
      await submitSimpleAction('transfer', values, '已转办', () => setTransferVisible(false));
    } catch { /* validation */ }
  };

  const handleDelegate = async () => {
    try {
      const values = await delegateFormApi.current?.validate() as { targetUserId: number; comment?: string };
      await submitSimpleAction('delegate', values, '已委派', () => setDelegateVisible(false));
    } catch { /* validation */ }
  };

  const resetAddSignForm = useCallback(() => {
    setAddSignPosition('after');
    setSignMode('and');
    addSignFormApi.current?.setValues({
      targetUserIds: [],
      position: 'after',
      signMode: 'and',
      comment: '',
    });
  }, []);

  const handleAddSign = async () => {
    try {
      const values = await addSignFormApi.current?.validate() as {
        targetUserIds: number[];
        position: AddSignPosition;
        comment?: string;
        signMode?: AddSignMode;
      };
      const { targetUserIds, position, comment } = values;
      await submitSimpleAction(
        'add-sign',
        {
          targetUserIds,
          position,
          comment,
          ...(position === 'parallel' ? { signMode } : {}),
        },
        '已加签',
        () => {
          resetAddSignForm();
          setAddSignVisible(false);
        },
      );
    } catch { /* validation */ }
  };

  const handleReduceSign = async () => {
    try {
      const values = await reduceSignFormApi.current?.validate() as { targetTaskIds: number[]; comment?: string };
      await submitSimpleAction('reduce-sign', values, '已减签', () => setReduceSignVisible(false));
    } catch { /* validation */ }
  };

  const handleReturn = async () => {
    try {
      const values = await returnFormApi.current?.validate() as { targetNodeKeys: string[]; comment: string };
      await submitSimpleAction('return', values, '已退回', () => setReturnVisible(false));
    } catch { /* validation */ }
  };

  const openUserPickerModal = (opener: () => void) => {
    void loadUserOptions();
    opener();
  };

  const openAddSignModal = () => {
    resetAddSignForm();
    openUserPickerModal(() => setAddSignVisible(true));
  };

  const columns: ColumnProps<PendingItem>[] = [
    {
      title: '申请标题',
      dataIndex: 'title',
      width: 200,
      render: renderEllipsis,
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
    {
      title: '操作',
      key: 'action',
      width: 210,
      fixed: 'right',
      render: (_: unknown, record: PendingItem) => (
        <Space>
          <Button theme="borderless" size="small" onClick={() => openDetail(record)}>
            详情
          </Button>
          <Button
            theme="borderless"
            size="small"
            type="primary"
            onClick={() => { setSelectedItem(record); setApproveVisible(true); }}
          >
            通过
          </Button>
          <Button
            theme="borderless"
            size="small"
            type="danger"
            onClick={() => { void openReject(record); }}
          >
            驳回
          </Button>
          <Button theme="borderless" size="small" onClick={() => openConsult(record)}>
            协办
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div className="page-container">
      <SearchToolbar>
        <Input
          prefix={<Search size={14} />}
          placeholder="请输入审批标题"
          value={searchParams.keyword}
          onChange={(v) => setSearchParams((prev) => ({ ...prev, keyword: v }))}
          onEnterPress={() => { setPage(1); void fetchList(1, pageSize); }}
          style={{ width: 200 }}
          showClear
        />
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
        <Button type="primary" icon={<Search size={14} />} onClick={() => { setPage(1); void fetchList(1, pageSize); }}>查询</Button>
        <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={() => { setSearchParams(defaultSearchParams); setPage(1); void fetchList(1, pageSize, defaultSearchParams); }}>重置</Button>
        <Button type="tertiary" onClick={openMyConsults}>我的协办</Button>
        {selectedRowKeys.length > 0 && (
          <>
            <Button type="primary" theme="solid" icon={<Plus size={14} />} onClick={() => { setBatchComment(''); setBatchMode('approve'); }}>
              批量通过（{selectedRowKeys.length}）
            </Button>
            <Button type="danger" theme="solid" onClick={() => { setBatchComment(''); setBatchMode('reject'); }}>
              批量驳回（{selectedRowKeys.length}）
            </Button>
          </>
        )}
      </SearchToolbar>
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
          onChange: (keys) => setSelectedRowKeys(((keys as (string | number)[]) ?? []).map(Number)),
        }}
      />

      {/* 申请详情弹窗 */}
      <SideSheet
        title="申请详情"
        visible={detailVisible}
        onCancel={() => { setDetailVisible(false); setDetail(null); setDetailDef(null); }}
        width={780}
        bodyStyle={{ padding: 16 }}
      >
        {detailLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
        ) : (
          <WorkflowInstanceDetailPanel
            instance={detail}
            definition={detailDef}
            loading={detailLoading}
            extraActions={selectedItem ? (
              <Space wrap>
                {btnApprove.enabled !== false && (
                  <Button type="primary" onClick={() => { setApproveAttachments([]); setApproveVisible(true); }}>
                    {btnApprove.displayName ?? '同意'}
                  </Button>
                )}
                {btnReject.enabled !== false && (
                  <Button type="danger" onClick={() => { if (selectedItem) void openReject(selectedItem); }}>
                    {btnReject.displayName ?? '拒绝'}
                  </Button>
                )}
                {btnTransfer.enabled && (
                  <Button onClick={() => openUserPickerModal(() => setTransferVisible(true))}>
                    {btnTransfer.displayName ?? '转办'}
                  </Button>
                )}
                {btnDelegate.enabled && (
                  <Button onClick={() => openUserPickerModal(() => setDelegateVisible(true))}>
                    {btnDelegate.displayName ?? '委派'}
                  </Button>
                )}
                {btnAddSign.enabled && (
                  <Button onClick={openAddSignModal}>
                    {btnAddSign.displayName ?? '加签'}
                  </Button>
                )}
                {btnAddSign.enabled && reduceSignCandidates.length > 0 && (
                  <Button onClick={() => setReduceSignVisible(true)}>
                    {btnReduceSign.displayName ?? '减签'}
                  </Button>
                )}
                {btnReturn.enabled && (
                  <Button onClick={() => setReturnVisible(true)}>
                    {btnReturn.displayName ?? '退回'}
                  </Button>
                )}
              </Space>
            ) : undefined}
          />
        )}
      </SideSheet>

      {/* 审批通过弹窗 */}
      <AppModal
        title={btnApprove.displayName ? `${btnApprove.displayName}` : '审批通过'}
        visible={approveVisible}
        onCancel={() => { setApproveVisible(false); setApproveAttachments([]); setApproveSignature(''); setSelectedNextApprovers([]); }}
        onOk={() => void handleApprove()}
        okButtonProps={{ loading: submitting, type: 'primary' }}
        okText="确认"
        style={{ width: 480 }}
      >
        <Form allowEmpty getFormApi={api => { approveFormApi.current = api; }}>
          <Form.TextArea
            field="comment"
            label={btnApprove.opinionName ?? '审批意见'}
            placeholder={`请填写${btnApprove.opinionName ?? '审批意见'}`}
            rows={3}
          />
        </Form>
        {renderPhraseBar((t) => appendPhrase(approveFormApi.current, t))}
        <div style={{ marginTop: 12 }}>
          <Typography.Text strong>
            附件{btnApprove.uploadRequired ? <span style={{ color: 'var(--semi-color-danger)' }}> *</span> : null}
          </Typography.Text>
          <Upload
            action={`${config.apiBaseUrl}/api/files/upload-one`}
            headers={{ Authorization: `Bearer ${localStorage.getItem('zenith_token') ?? ''}` }}
            name="file"
            limit={5}
            onSuccess={(res: unknown) => {
              const r = res as { code?: number; data?: { url: string; originalName?: string; size?: number } };
              if (r?.code === 0 && r.data) {
                setApproveAttachments((prev) => [...prev, { name: r.data!.originalName ?? '附件', url: r.data!.url, size: r.data!.size }]);
              }
            }}
            onRemove={(_file, _fileList, currentFile) => {
              setApproveAttachments((prev) => prev.filter((a) => a.name !== currentFile.name));
              return true;
            }}
          />
        </div>
        {(currentTask?.signatureRequired ?? selectedItem?.pendingSignatureRequired) && (
          <div style={{ marginTop: 12 }}>
            <Typography.Text strong>
              手写签名<span style={{ color: 'var(--semi-color-danger)' }}> *</span>
            </Typography.Text>
            <div style={{ marginTop: 6 }}>
              <SignaturePad value={approveSignature} onChange={setApproveSignature} />
            </div>
          </div>
        )}
        {hasApproverSelectDownstream && (
          <div style={{ marginTop: 12 }}>
            <Typography.Text strong>下一节点审批人</Typography.Text>
            <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 6 }}>
              后续存在“前一审批人选择”节点，请选择审批人（可多选）
            </Typography.Text>
            <Select
              multiple
              filter
              style={{ width: '100%' }}
              placeholder="请选择下一节点审批人"
              optionList={userOptions}
              value={selectedNextApprovers}
              onChange={(v) => setSelectedNextApprovers((v as number[]) ?? [])}
            />
          </div>
        )}
      </AppModal>

      {/* 驳回弹窗 */}
      <AppModal
        title="驳回申请"
        visible={rejectVisible}
        onCancel={() => {
          setRejectVisible(false);
          setRejectInstance(null);
          setRejectDef(null);
        }}
        onOk={() => void handleReject()}
        okButtonProps={{ loading: submitting, type: 'danger' }}
        okText="确认驳回"
        style={{ width: 480 }}
      >
        <Banner
          type={rejectHint.terminating ? 'warning' : 'info'}
          description={rejectHintLoading ? '正在加载驳回去向...' : rejectHint.text}
          fullMode={false}
          closeIcon={null}
          style={{ marginBottom: 16 }}
        />
        <Form getFormApi={api => { rejectFormApi.current = api; }}>
          <Form.TextArea
            field="comment"
            label="驳回原因"
            placeholder="请填写驳回原因"
            rules={[{ required: true, message: '请填写驳回原因' }]}
            rows={3}
          />
        </Form>
        {renderPhraseBar((t) => appendPhrase(rejectFormApi.current, t))}
      </AppModal>

      {/* 转办弹窗 */}
      <AppModal
        title={btnTransfer.displayName ?? '转办'}
        visible={transferVisible}
        onCancel={() => setTransferVisible(false)}
        onOk={() => void handleTransfer()}
        okButtonProps={{ loading: submitting, type: 'primary' }}
        okText="确认"
        style={{ width: 480 }}
      >
        <Form allowEmpty getFormApi={api => { transferFormApi.current = api; }}>
          <Form.Select
            field="targetUserId"
            label="转办人"
            placeholder="请选择转办人"
            filter
            optionList={userOptions}
            rules={[{ required: true, message: '请选择转办人' }]}
            style={{ width: '100%' }}
          />
          <Form.TextArea field="comment" label={btnTransfer.opinionName ?? '转办说明'} rows={3} />
        </Form>
      </AppModal>

      {/* 委派弹窗 */}
      <AppModal
        title={btnDelegate.displayName ?? '委派'}
        visible={delegateVisible}
        onCancel={() => setDelegateVisible(false)}
        onOk={() => void handleDelegate()}
        okButtonProps={{ loading: submitting, type: 'primary' }}
        okText="确认"
        style={{ width: 480 }}
      >
        <Form allowEmpty getFormApi={api => { delegateFormApi.current = api; }}>
          <Form.Select
            field="targetUserId"
            label="委派人"
            placeholder="请选择委派人"
            filter
            optionList={userOptions}
            rules={[{ required: true, message: '请选择委派人' }]}
            style={{ width: '100%' }}
          />
          <Form.TextArea field="comment" label={btnDelegate.opinionName ?? '委派说明'} rows={3} />
        </Form>
      </AppModal>

      {/* 加签弹窗 */}
      <AppModal
        title={btnAddSign.displayName ?? '加签'}
        visible={addSignVisible}
        onCancel={() => {
          resetAddSignForm();
          setAddSignVisible(false);
        }}
        onOk={() => void handleAddSign()}
        okButtonProps={{ loading: submitting, type: 'primary' }}
        okText="确认"
        style={{ width: 520 }}
      >
        <Form getFormApi={api => { addSignFormApi.current = api; }} initValues={{ position: 'after', signMode: 'and' }}>
          <Form.Select
            field="targetUserIds"
            label="加签人"
            placeholder="请选择加签人，可多选"
            multiple
            filter
            optionList={userOptions}
            rules={[{ required: true, message: '请选择加签人' }]}
            style={{ width: '100%' }}
          />
          <Form.RadioGroup
            field="position"
            label="位置"
            onChange={(e) => setAddSignPosition((e.target as HTMLInputElement).value as AddSignPosition)}
          >
            <Form.Radio value="before">前加签（加签人先审批）</Form.Radio>
            <Form.Radio value="parallel">并加签（与自己同时审批）</Form.Radio>
            <Form.Radio value="after">后加签（自己之后再审批）</Form.Radio>
          </Form.RadioGroup>
          {addSignPosition === 'parallel' && (
            <Form.RadioGroup
              field="signMode"
              label="会签方式"
              onChange={(e) => setSignMode((e.target as HTMLInputElement).value as AddSignMode)}
            >
              <Form.Radio value="and">会签（全部通过）</Form.Radio>
              <Form.Radio value="or">或签（一人通过）</Form.Radio>
            </Form.RadioGroup>
          )}
          <Form.TextArea field="comment" label={btnAddSign.opinionName ?? '加签说明'} rows={3} />
        </Form>
      </AppModal>

      {/* 减签弹窗 */}
      <AppModal
        title={btnReduceSign.displayName ?? '减签'}
        visible={reduceSignVisible}
        onCancel={() => setReduceSignVisible(false)}
        onOk={() => void handleReduceSign()}
        okButtonProps={{ loading: submitting, type: 'primary' }}
        okText="确认"
        style={{ width: 480 }}
      >
        <Form getFormApi={api => { reduceSignFormApi.current = api; }}>
          <Form.CheckboxGroup
            field="targetTaskIds"
            label="选择要减签的加签人"
            rules={[{ required: true, message: '请至少选择一项' }]}
            options={reduceSignCandidates.map((t) => {
              const who = t.assigneeName ?? `用户${t.assigneeId ?? ''}`;
              const note = t.comment?.replace(/^\[加签-?\w*\]\s*/, '') ?? '';
              return { label: `${who}（${note}）`, value: t.id };
            })}
          />
          <Form.TextArea field="comment" label={btnReduceSign.opinionName ?? '减签说明'} rows={3} />
        </Form>
      </AppModal>

      {/* 退回弹窗 */}
      <AppModal
        title={btnReturn.displayName ?? '退回'}
        visible={returnVisible}
        onCancel={() => setReturnVisible(false)}
        onOk={() => void handleReturn()}
        okButtonProps={{ loading: submitting, type: 'primary' }}
        okText="确认"
        style={{ width: 480 }}
      >
        <Form
          getFormApi={api => { returnFormApi.current = api; }}
          initValues={{ targetNodeKeys: btnReturn.jumpToNodeKey ? [btnReturn.jumpToNodeKey] : [] }}
        >
          <Form.Select
            field="targetNodeKeys"
            label="退回到节点"
            placeholder="请选择退回节点（可多选）"
            multiple
            optionList={returnTargetOptions}
            rules={[{ required: true, message: '请选择退回节点' }]}
            style={{ width: '100%' }}
          />
          <Form.TextArea
            field="comment"
            label={btnReturn.opinionName ?? '退回原因'}
            placeholder="请填写退回原因"
            rules={[{ required: true, message: '请填写退回原因' }]}
            rows={3}
          />
        </Form>
      </AppModal>

      {/* 批量审批弹窗 */}
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

      {/* 常用语管理弹窗 */}
      <AppModal
        title="管理审批常用语"
        visible={phraseManageVisible}
        onCancel={() => setPhraseManageVisible(false)}
        footer={null}
        style={{ width: 480 }}
      >        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <Input
            value={newPhrase}
            onChange={setNewPhrase}
            placeholder="输入新的常用语"
            onEnterPress={() => void handleAddPhrase()}
            maxLength={255}
            showClear
          />
          <Button type="primary" icon={<Plus size={14} />} onClick={() => void handleAddPhrase()}>新增</Button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflow: 'auto' }}>
          {quickPhrases.length === 0 && <Typography.Text type="tertiary">暂无常用语，添加后可在审批时一键填入。</Typography.Text>}
          {quickPhrases.map((p) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '6px 10px', border: '1px solid var(--semi-color-border)', borderRadius: 6 }}>
              <Typography.Text ellipsis={{ showTooltip: true }} style={{ flex: 1, minWidth: 0 }}>{p.content}</Typography.Text>
              {p.userId === null
                ? <Tag size="small" color="grey">系统预置</Tag>
                : (
                  <Popconfirm title="删除该常用语？" onConfirm={() => void handleDeletePhrase(p.id)}>
                    <Button theme="borderless" type="danger" size="small">删除</Button>
                  </Popconfirm>
                )}
            </div>
          ))}
        </div>
      </AppModal>

      {/* 发起协办弹窗 */}
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

      {/* 我的协办 */}
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
