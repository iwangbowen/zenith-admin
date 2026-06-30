import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppModal } from '@/components/AppModal';
import {
  Banner,
  Button,
  Dropdown,
  Form,
  Select,
  Space,
  Spin,
  Toast,
  Typography,
} from '@douyinfe/semi-ui';
import { ChevronDown } from 'lucide-react';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { WorkflowActionButtonConfig, WorkflowActionButtonKey, WorkflowDefinition, WorkflowInstance, WorkflowSelectableNextApproverGroup, WorkflowTask } from '@zenith/shared';
import { request } from '@/utils/request';
import { resolveRejectTargetHint } from '@/utils/workflow-reject';
import { resolveWorkflowDetailDefinition } from '@/utils/workflow-snapshot';
import { useQuickPhrases } from '@/hooks/useQuickPhrases';
import SignaturePad from '@/components/SignaturePad';
import FileAttachment from '@/components/FileAttachment';
import { uploadedFileToAttachment } from '@/components/FileAttachment/utils';
import WorkflowInstanceDetailPanel from '@/components/workflow/WorkflowInstanceDetailPanel';
import WorkflowSideSheet from '@/components/workflow/WorkflowSideSheet';
import { useUserOptions } from '@/hooks/useUserOptions';

type ApprovalInitialAction = 'approve' | 'reject' | null;
type AddSignPosition = 'before' | 'after' | 'parallel';
type AddSignMode = 'and' | 'or';

interface UploadedFile { name: string; url: string; size?: number }

type ActionAttachmentKey = 'approve' | 'reject' | 'transfer' | 'delegate' | 'addSign' | 'return';
const EMPTY_ACTION_ATTACHMENTS: Record<ActionAttachmentKey, UploadedFile[]> = {
  approve: [], reject: [], transfer: [], delegate: [], addSign: [], return: [],
};

interface Props {
  instanceId: number | null;
  taskId: number | null;
  visible: boolean;
  initialAction?: ApprovalInitialAction;
  title?: string;
  onClose: () => void;
  onActionDone?: () => void;
}

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

function appendPhrase(formApi: FormApi | null, text: string) {
  if (!formApi) return;
  const cur = (formApi.getValue('comment') as string | undefined) ?? '';
  formApi.setValue('comment', cur ? `${cur} ${text}` : text);
}

export default function WorkflowApprovalDetailSheet({
  instanceId,
  taskId,
  visible,
  initialAction = null,
  title = '申请详情',
  onClose,
  onActionDone,
}: Readonly<Props>) {
  const approveFormApi = useRef<FormApi | null>(null);
  const rejectFormApi = useRef<FormApi | null>(null);
  const transferFormApi = useRef<FormApi | null>(null);
  const delegateFormApi = useRef<FormApi | null>(null);
  const addSignFormApi = useRef<FormApi | null>(null);
  const reduceSignFormApi = useRef<FormApi | null>(null);
  const returnFormApi = useRef<FormApi | null>(null);
  const initialActionKeyRef = useRef<string | null>(null);

  const [approveVisible, setApproveVisible] = useState(false);
  const [rejectVisible, setRejectVisible] = useState(false);
  const [transferVisible, setTransferVisible] = useState(false);
  const [delegateVisible, setDelegateVisible] = useState(false);
  const [addSignVisible, setAddSignVisible] = useState(false);
  const [reduceSignVisible, setReduceSignVisible] = useState(false);
  const [returnVisible, setReturnVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [detail, setDetail] = useState<WorkflowInstance | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailDef, setDetailDef] = useState<WorkflowDefinition | null>(null);
  const [viewId, setViewId] = useState<number | null>(instanceId);
  const [rejectInstance, setRejectInstance] = useState<WorkflowInstance | null>(null);
  const [rejectDef, setRejectDef] = useState<WorkflowDefinition | null>(null);
  const [rejectHintLoading, setRejectHintLoading] = useState(false);
  const [actionAttachments, setActionAttachments] = useState<Record<ActionAttachmentKey, UploadedFile[]>>(() => ({ ...EMPTY_ACTION_ATTACHMENTS }));
  const [approveSignature, setApproveSignature] = useState('');
  const { userOptions, ensureLoaded: ensureUserOptions } = useUserOptions();
  const [selectedNextGroups, setSelectedNextGroups] = useState<WorkflowSelectableNextApproverGroup[]>([]);
  const [nextApproversLoading, setNextApproversLoading] = useState(false);
  const [selectedNextApprovers, setSelectedNextApprovers] = useState<Record<string, number[]>>({});
  const [addSignPosition, setAddSignPosition] = useState<AddSignPosition>('after');
  const [signMode, setSignMode] = useState<AddSignMode>('and');
  const { renderPhraseBar, phraseManageModal } = useQuickPhrases();

  const setAttachmentsFor = useCallback((key: ActionAttachmentKey, files: UploadedFile[]) => {
    setActionAttachments((prev) => ({ ...prev, [key]: files }));
  }, []);
  const resetActionAttachments = useCallback(() => {
    setActionAttachments({ ...EMPTY_ACTION_ATTACHMENTS });
  }, []);
  const ensureUploadSatisfied = (btn: WorkflowActionButtonConfig, key: ActionAttachmentKey): boolean => {
    if ((btn.uploadMode ?? 'hidden') === 'required' && actionAttachments[key].length === 0) {
      Toast.error('请上传附件后再提交');
      return false;
    }
    return true;
  };
  const attachmentsPayload = (key: ActionAttachmentKey): UploadedFile[] | undefined =>
    (actionAttachments[key].length > 0 ? actionAttachments[key] : undefined);
  const renderAttachmentField = (btn: WorkflowActionButtonConfig, key: ActionAttachmentKey) => {
    const mode = btn.uploadMode ?? 'hidden';
    if (mode === 'hidden') return null;
    return (
      <div style={{ marginTop: 12 }}>
        <Typography.Text strong>
          附件{mode === 'required' ? <span style={{ color: 'var(--semi-color-danger)' }}> *</span> : null}
        </Typography.Text>
        <div style={{ marginTop: 6 }}>
          <FileAttachment
            mode="edit"
            showTitle={false}
            limit={5}
            value={actionAttachments[key].map((a, i) => uploadedFileToAttachment(a, i))}
            onChange={(items) => setAttachmentsFor(key, items.map((a) => ({ name: a.file.originalName, url: a.file.url, size: a.file.size })))}
          />
        </div>
      </div>
    );
  };

  useEffect(() => {
    if (visible) setViewId(instanceId);
  }, [visible, instanceId]);

  useEffect(() => {
    if (!visible) {
      setDetail(null);
      setDetailDef(null);
      setRejectInstance(null);
      setRejectDef(null);
      setApproveVisible(false);
      setRejectVisible(false);
      setTransferVisible(false);
      setDelegateVisible(false);
      setAddSignVisible(false);
      setReduceSignVisible(false);
      setReturnVisible(false);
      resetActionAttachments();
      setApproveSignature('');
      setSelectedNextApprovers({});
      initialActionKeyRef.current = null;
    }
  }, [visible]);

  useEffect(() => {
    if (!visible || !viewId) return;
    setDetailLoading(true);
    setDetail(null);
    setDetailDef(null);
    const p = request.get<WorkflowInstance>(`/api/workflows/instances/${viewId}`)
      .then((res) => {
        if (res.code === 0) {
          setDetail(res.data);
          if (res.data.definitionSnapshot) return null;
          return request.get<WorkflowDefinition>(`/api/workflows/definitions/${res.data.definitionId}`, { silent: true });
        }
        return null;
      })
      .then((defRes) => { if (defRes?.code === 0) setDetailDef(defRes.data); })
      .finally(() => setDetailLoading(false));
    p.catch(() => undefined);
  }, [visible, viewId]);

  const currentTask: WorkflowTask | null = useMemo(() => {
    if (!detail || taskId == null) return null;
    return detail.tasks?.find((t) => t.id === taskId) ?? null;
  }, [detail, taskId]);

  const actionButtons = currentTask?.actionButtons ?? null;
  const currentDetailDefinition = useMemo(
    () => resolveWorkflowDetailDefinition(detail, detailDef),
    [detail, detailDef],
  );
  const btnApprove = useMemo(() => resolveButton(actionButtons, 'approve'), [actionButtons]);
  const btnReject = useMemo(() => resolveButton(actionButtons, 'reject'), [actionButtons]);
  const btnTransfer = useMemo(() => resolveButton(actionButtons, 'transfer'), [actionButtons]);
  const btnDelegate = useMemo(() => resolveButton(actionButtons, 'delegate'), [actionButtons]);
  const btnAddSign = useMemo(() => resolveButton(actionButtons, 'addSign'), [actionButtons]);
  const btnReduceSign = useMemo(() => resolveButton(actionButtons, 'reduceSign'), [actionButtons]);
  const btnReturn = useMemo(() => resolveButton(actionButtons, 'return'), [actionButtons]);

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
    if (!currentDetailDefinition || !currentTask || !detail) return [] as Array<{ label: string; value: string }>;
    const flow = currentDetailDefinition.flowData;
    if (!flow) return [];
    const currentNode = flow.nodes.find((n) => n.data.key === currentTask.nodeKey);
    if (!currentNode) return [];

    const nodeById = new Map(flow.nodes.map((n) => [n.id, n]));
    const inEdges = new Map<string, string[]>();
    for (const edge of flow.edges ?? []) {
      const targetNode = nodeById.get(edge.target);
      if (edge.isException || targetNode?.data.type === 'catchNode') continue;
      const prev = inEdges.get(edge.target) ?? [];
      prev.push(edge.source);
      inEdges.set(edge.target, prev);
    }

    const ancestorKeys = new Set<string>();
    const visited = new Set<string>();
    const queue = [...(inEdges.get(currentNode.id) ?? [])];
    while (queue.length > 0) {
      const id = queue.shift();
      if (!id || visited.has(id)) continue;
      visited.add(id);
      const node = nodeById.get(id);
      if (node) ancestorKeys.add(node.data.key);
      for (const parentId of inEdges.get(id) ?? []) queue.push(parentId);
    }

    const approvedNodeKeys = new Set(
      (detail.tasks ?? [])
        .filter((t) => t.id !== currentTask.id && t.status === 'approved')
        .map((t) => t.nodeKey),
    );

    return flow.nodes
      .filter((n) =>
        (n.data.type === 'approve' || n.data.type === 'handler')
        && ancestorKeys.has(n.data.key)
        && approvedNodeKeys.has(n.data.key),
      )
      .map((n) => ({ label: n.data.label ?? n.data.key, value: n.data.key }));
  }, [currentDetailDefinition, currentTask, detail]);

  const defaultReturnTargetKeys = useMemo(
    () => (btnReturn.jumpToNodeKey && returnTargetOptions.some((item) => item.value === btnReturn.jumpToNodeKey)
      ? [btnReturn.jumpToNodeKey]
      : []),
    [btnReturn.jumpToNodeKey, returnTargetOptions],
  );

  // 审批弹窗打开时，向服务端拉取「紧邻下一审批节点」中需当前审批人选人的 approverSelect 候选分组。
  // 候选人已按各节点 selectScope（成员/角色/部门/用户组）在服务端解析收窄，前端无需自行计算范围。
  useEffect(() => {
    if (!approveVisible || taskId == null) {
      setSelectedNextGroups([]);
      return;
    }
    let cancelled = false;
    setNextApproversLoading(true);
    request
      .get<WorkflowSelectableNextApproverGroup[]>(`/api/workflows/tasks/${taskId}/selectable-next-approvers`)
      .then((res) => {
        if (cancelled) return;
        setSelectedNextGroups(res.code === 0 && Array.isArray(res.data) ? res.data : []);
      })
      .catch(() => { if (!cancelled) setSelectedNextGroups([]); })
      .finally(() => { if (!cancelled) setNextApproversLoading(false); });
    return () => { cancelled = true; };
  }, [approveVisible, taskId]);
  const hasApproverSelectDownstream = selectedNextGroups.length > 0;


  const openReject = useCallback(async () => {
    if (!instanceId) return;
    setRejectVisible(true);
    if (detail?.id === instanceId) {
      setRejectInstance(detail);
      setRejectDef(detailDef);
      return;
    }
    setRejectInstance(null);
    setRejectDef(null);
    setRejectHintLoading(true);
    try {
      const instRes = await request.get<WorkflowInstance>(`/api/workflows/instances/${instanceId}`);
      if (instRes.code === 0) {
        setRejectInstance(instRes.data);
        if (instRes.data.definitionSnapshot) return;
        const defRes = await request.get<WorkflowDefinition>(`/api/workflows/definitions/${instRes.data.definitionId}`, { silent: true });
        if (defRes.code === 0) setRejectDef(defRes.data);
      }
    } finally {
      setRejectHintLoading(false);
    }
  }, [detail, detailDef, instanceId]);

  useEffect(() => {
    if (!visible || !initialAction) return;
    const key = `${instanceId ?? 'null'}:${taskId ?? 'null'}:${initialAction}`;
    if (initialActionKeyRef.current === key) return;
    initialActionKeyRef.current = key;
    if (initialAction === 'approve') {
      setAttachmentsFor('approve', []);
      setApproveSignature('');
      setSelectedNextApprovers({});
      setApproveVisible(true);
    } else if (initialAction === 'reject') {
      void openReject();
    }
  }, [initialAction, instanceId, openReject, taskId, visible]);

  const rejectHint = useMemo(
    () => resolveRejectTargetHint(rejectInstance, resolveWorkflowDetailDefinition(rejectInstance, rejectDef)?.flowData ?? null),
    [rejectInstance, rejectDef],
  );

  const closeAfterAction = useCallback(() => {
    onActionDone?.();
    onClose();
  }, [onActionDone, onClose]);

  const handleApprove = async () => {
    if (taskId == null) return;
    if (submitting) return;
    const needSignature = currentTask?.signatureRequired ?? false;
    try {
      const values = await approveFormApi.current?.validate();
      if (!ensureUploadSatisfied(btnApprove, 'approve')) return;
      if (needSignature && !approveSignature) {
        Toast.error('该节点要求手写签名，请先签名');
        return;
      }
      if (hasApproverSelectDownstream) {
        const missing = selectedNextGroups.find((g) => (selectedNextApprovers[g.nodeKey]?.length ?? 0) === 0);
        if (missing) {
          Toast.error(`请选择「${missing.label}」的审批人`);
          return;
        }
      }
      setSubmitting(true);
      const res = await request.post(
        `/api/workflows/tasks/${taskId}/approve`,
        {
          comment: values?.comment ?? '',
          attachments: attachmentsPayload('approve'),
          signature: approveSignature || undefined,
          selectedNextApprovers: hasApproverSelectDownstream ? selectedNextApprovers : undefined,
        },
        { headers: { 'X-Idempotency-Key': `workflow-approve-${taskId}` } },
      );
      if (res.code === 0) {
        Toast.success('审批通过');
        setApproveVisible(false);
        setAttachmentsFor('approve', []);
        setApproveSignature('');
        setSelectedNextApprovers({});
        closeAfterAction();
      }
    } catch {
      // validation failed
    } finally {
      setSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (taskId == null) return;
    if (submitting) return;
    try {
      const values = await rejectFormApi.current?.validate() as Record<string, unknown>;
      if (!ensureUploadSatisfied(btnReject, 'reject')) return;
      setSubmitting(true);
      const res = await request.post(
        `/api/workflows/tasks/${taskId}/reject`,
        { comment: values.comment as string, attachments: attachmentsPayload('reject') },
        { headers: { 'X-Idempotency-Key': `workflow-reject-${taskId}` } },
      );
      if (res.code === 0) {
        Toast.success('已驳回');
        setRejectVisible(false);
        setAttachmentsFor('reject', []);
        closeAfterAction();
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
    if (taskId == null) return;
    if (submitting) return;
    try {
      setSubmitting(true);
      const res = await request.post(
        `/api/workflows/tasks/${taskId}/${path}`,
        body,
        { headers: { 'X-Idempotency-Key': `workflow-${path}-${taskId}` } },
      );
      if (res.code === 0) {
        Toast.success(successMsg);
        closer();
        closeAfterAction();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleTransfer = async () => {
    try {
      const values = await transferFormApi.current?.validate() as { targetUserId: number; comment?: string };
      if (!ensureUploadSatisfied(btnTransfer, 'transfer')) return;
      await submitSimpleAction(
        'transfer',
        { ...values, attachments: attachmentsPayload('transfer') },
        '已转办',
        () => { setTransferVisible(false); setAttachmentsFor('transfer', []); },
      );
    } catch { /* validation */ }
  };

  const handleDelegate = async () => {
    try {
      const values = await delegateFormApi.current?.validate() as { targetUserId: number; comment?: string };
      if (!ensureUploadSatisfied(btnDelegate, 'delegate')) return;
      await submitSimpleAction(
        'delegate',
        { ...values, attachments: attachmentsPayload('delegate') },
        '已委派',
        () => { setDelegateVisible(false); setAttachmentsFor('delegate', []); },
      );
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
      if (!ensureUploadSatisfied(btnAddSign, 'addSign')) return;
      await submitSimpleAction(
        'add-sign',
        {
          targetUserIds,
          position,
          comment,
          attachments: attachmentsPayload('addSign'),
          ...(position === 'parallel' ? { signMode } : {}),
        },
        '已加签',
        () => {
          resetAddSignForm();
          setAddSignVisible(false);
          setAttachmentsFor('addSign', []);
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
      if (!ensureUploadSatisfied(btnReturn, 'return')) return;
      await submitSimpleAction(
        'return',
        { ...values, attachments: attachmentsPayload('return') },
        '已退回',
        () => { setReturnVisible(false); setAttachmentsFor('return', []); },
      );
    } catch { /* validation */ }
  };

  const openUserPickerModal = (opener: () => void) => {
    void ensureUserOptions();
    opener();
  };

  const openAddSignModal = () => {
    resetAddSignForm();
    openUserPickerModal(() => setAddSignVisible(true));
  };

  const moreActions: Array<{ key: string; label: string; onClick: () => void }> = [];
  if (btnTransfer.enabled) moreActions.push({ key: 'transfer', label: btnTransfer.displayName ?? '转办', onClick: () => openUserPickerModal(() => setTransferVisible(true)) });
  if (btnDelegate.enabled) moreActions.push({ key: 'delegate', label: btnDelegate.displayName ?? '委派', onClick: () => openUserPickerModal(() => setDelegateVisible(true)) });
  if (btnAddSign.enabled) moreActions.push({ key: 'addSign', label: btnAddSign.displayName ?? '加签', onClick: openAddSignModal });
  if (btnAddSign.enabled && reduceSignCandidates.length > 0) moreActions.push({ key: 'reduceSign', label: btnReduceSign.displayName ?? '减签', onClick: () => setReduceSignVisible(true) });
  if (btnReturn.enabled) moreActions.push({ key: 'return', label: btnReturn.displayName ?? '退回', onClick: () => setReturnVisible(true) });

  const extraActions = taskId != null && detail?.id === instanceId ? (
    <Space>
      {btnApprove.enabled !== false && (
        <Button type="primary" onClick={() => { setAttachmentsFor('approve', []); setApproveSignature(''); setSelectedNextApprovers({}); setApproveVisible(true); }}>
          {btnApprove.displayName ?? '同意'}
        </Button>
      )}
      {btnReject.enabled !== false && (
        <Button type="danger" onClick={() => { void openReject(); }}>
          {btnReject.displayName ?? '拒绝'}
        </Button>
      )}
      {moreActions.length > 0 && (
        <Dropdown
          trigger="click"
          position="topRight"
          render={(
            <Dropdown.Menu>
              {moreActions.map((a) => (
                <Dropdown.Item key={a.key} onClick={a.onClick}>{a.label}</Dropdown.Item>
              ))}
            </Dropdown.Menu>
          )}
        >
          <Button icon={<ChevronDown size={14} />} iconPosition="right">更多</Button>
        </Dropdown>
      )}
    </Space>
  ) : undefined;

  const detailSheetVisible = visible && initialAction == null;

  return (
    <>
      <WorkflowSideSheet
        title={title}
        visible={detailSheetVisible}
        onCancel={onClose}
        variant="split"
        footerRight={extraActions}
      >
        {detailLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
        ) : (
          <WorkflowInstanceDetailPanel
            instance={detail}
            definition={detailDef}
            loading={detailLoading}
            onOpenInstance={(id) => setViewId(id)}
          />
        )}
      </WorkflowSideSheet>

      <AppModal
        title={btnApprove.displayName ? `${btnApprove.displayName}` : '审批通过'}
        visible={approveVisible}
        onCancel={() => { setApproveVisible(false); setAttachmentsFor('approve', []); setApproveSignature(''); setSelectedNextApprovers({}); if (!detailSheetVisible) onClose(); }}
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
        {renderAttachmentField(btnApprove, 'approve')}
        {(currentTask?.signatureRequired ?? false) && (
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
              后续存在“前一审批人选择”节点，请为每个节点选择审批人（可多选）
            </Typography.Text>
            {selectedNextGroups.map((group) => (
              <div key={group.nodeKey} style={{ marginBottom: 10 }}>
                <Typography.Text size="small" style={{ display: 'block', marginBottom: 4 }}>
                  {group.label}<span style={{ color: 'var(--semi-color-danger)' }}> *</span>
                </Typography.Text>
                <Select
                  multiple
                  filter
                  loading={nextApproversLoading}
                  style={{ width: '100%' }}
                  placeholder="请选择审批人"
                  emptyContent="暂无可选审批人"
                  optionList={group.selectableApprovers.map((u) => ({ value: u.id, label: u.name }))}
                  value={selectedNextApprovers[group.nodeKey] ?? []}
                  onChange={(v) => setSelectedNextApprovers((prev) => ({ ...prev, [group.nodeKey]: (v as number[]) ?? [] }))}
                />
              </div>
            ))}
          </div>
        )}
      </AppModal>

      <AppModal
        title="驳回申请"
        visible={rejectVisible}
        onCancel={() => {
          setRejectVisible(false);
          setRejectInstance(null);
          setRejectDef(null);
          setAttachmentsFor('reject', []);
          if (!detailSheetVisible) onClose();
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
        {renderAttachmentField(btnReject, 'reject')}
      </AppModal>

      <AppModal
        title={btnTransfer.displayName ?? '转办'}
        visible={transferVisible}
        onCancel={() => { setTransferVisible(false); setAttachmentsFor('transfer', []); }}
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
        {renderAttachmentField(btnTransfer, 'transfer')}
      </AppModal>

      <AppModal
        title={btnDelegate.displayName ?? '委派'}
        visible={delegateVisible}
        onCancel={() => { setDelegateVisible(false); setAttachmentsFor('delegate', []); }}
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
        {renderAttachmentField(btnDelegate, 'delegate')}
      </AppModal>

      <AppModal
        title={btnAddSign.displayName ?? '加签'}
        visible={addSignVisible}
        onCancel={() => {
          resetAddSignForm();
          setAddSignVisible(false);
          setAttachmentsFor('addSign', []);
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
        {renderAttachmentField(btnAddSign, 'addSign')}
      </AppModal>

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

      <AppModal
        title={btnReturn.displayName ?? '退回'}
        visible={returnVisible}
        onCancel={() => { setReturnVisible(false); setAttachmentsFor('return', []); }}
        onOk={() => void handleReturn()}
        okButtonProps={{ loading: submitting, type: 'primary' }}
        okText="确认"
        style={{ width: 480 }}
      >
        <Form
          getFormApi={api => { returnFormApi.current = api; }}
          initValues={{ targetNodeKeys: defaultReturnTargetKeys }}
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
        {renderAttachmentField(btnReturn, 'return')}
      </AppModal>
      {phraseManageModal}
    </>
  );
}
