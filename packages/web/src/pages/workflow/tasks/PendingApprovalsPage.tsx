import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Banner,
  Button,
  Form,
  Input,
  Modal,
  Select,
  SideSheet,
  Space,
  Spin,
  Toast,
  Typography,
  Upload,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { RotateCcw, Search } from 'lucide-react';
import type { WorkflowInstance, WorkflowDefinition, PaginatedResponse, WorkflowTask, WorkflowActionButtonKey, WorkflowActionButtonConfig } from '@zenith/shared';
import { request } from '@/utils/request';
import { config } from '@/config';
import { formatDateTime } from '@/utils/date';
import { resolveRejectTargetHint } from '@/utils/workflow-reject';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { usePagination } from '@/hooks/usePagination';
import WorkflowInstanceDetailPanel from '@/components/workflow/WorkflowInstanceDetailPanel';
import { renderEllipsis } from '../../../utils/table-columns';

interface SearchParams {
  keyword: string;
  definitionId: number | null;
}

const defaultSearchParams: SearchParams = { keyword: '', definitionId: null };

type PendingItem = WorkflowInstance & { pendingTaskId: number };

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
  const [userOptions, setUserOptions] = useState<Array<{ label: string; value: number }>>([]);
  const [selectedNextApprovers, setSelectedNextApprovers] = useState<number[]>([]);

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
    request.get<WorkflowDefinition[]>('/api/workflows/definitions/published')
      .then((res) => { if (res.code === 0 && res.data) setDefinitions(res.data); });
  }, [fetchList]);

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
    try {
      const values = await approveFormApi.current?.validate();
      if (btnApprove.uploadRequired && approveAttachments.length === 0) {
        Toast.error('请上传附件后再提交');
        return;
      }
      setSubmitting(true);
      const res = await request.post(
        `/api/workflows/tasks/${selectedItem.pendingTaskId}/approve`,
        {
          comment: values?.comment ?? '',
          attachments: approveAttachments.length > 0 ? approveAttachments : undefined,
          selectedNextApprovers: hasApproverSelectDownstream && selectedNextApprovers.length > 0 ? selectedNextApprovers : undefined,
        }
      );
      if (res.code === 0) {
        Toast.success('审批通过');
        setApproveVisible(false);
        setApproveAttachments([]);
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

  const handleAddSign = async () => {
    try {
      const values = await addSignFormApi.current?.validate() as { targetUserIds: number[]; position: 'before' | 'after' | 'parallel'; comment?: string };
      await submitSimpleAction('add-sign', values, '已加签', () => setAddSignVisible(false));
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
      width: 160,
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
                  <Button onClick={() => openUserPickerModal(() => setAddSignVisible(true))}>
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
      <Modal
        title={btnApprove.displayName ? `${btnApprove.displayName}` : '审批通过'}
        visible={approveVisible}
        onCancel={() => { setApproveVisible(false); setApproveAttachments([]); setSelectedNextApprovers([]); }}
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
      </Modal>

      {/* 驳回弹窗 */}
      <Modal
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
      </Modal>

      {/* 转办弹窗 */}
      <Modal
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
      </Modal>

      {/* 委派弹窗 */}
      <Modal
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
      </Modal>

      {/* 加签弹窗 */}
      <Modal
        title={btnAddSign.displayName ?? '加签'}
        visible={addSignVisible}
        onCancel={() => setAddSignVisible(false)}
        onOk={() => void handleAddSign()}
        okButtonProps={{ loading: submitting, type: 'primary' }}
        okText="确认"
        style={{ width: 520 }}
      >
        <Form getFormApi={api => { addSignFormApi.current = api; }} initValues={{ position: 'after' }}>
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
          <Form.RadioGroup field="position" label="位置">
            <Form.Radio value="before">前加签（加签人先审批）</Form.Radio>
            <Form.Radio value="parallel">并加签（与自己同时审批）</Form.Radio>
            <Form.Radio value="after">后加签（自己之后再审批）</Form.Radio>
          </Form.RadioGroup>
          <Form.TextArea field="comment" label={btnAddSign.opinionName ?? '加签说明'} rows={3} />
        </Form>
      </Modal>

      {/* 减签弹窗 */}
      <Modal
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
      </Modal>

      {/* 退回弹窗 */}
      <Modal
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
      </Modal>
    </div>
  );
}
