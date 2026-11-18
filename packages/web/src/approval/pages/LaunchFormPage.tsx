import { useEffect, useMemo, useRef, useState } from 'react';
import { useDebouncedCallback } from '@tanstack/react-pacer';
import { useNavigate, useParams } from 'react-router-dom';
import { Banner, Button, Empty, Input, Select, Skeleton, Spin, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { ChevronLeft, Clock, GitBranch, Mail, Send, UserPlus, type LucideIcon } from 'lucide-react';
import dayjs from 'dayjs';
import type { WorkflowApproverPreviewNode, WorkflowInstancePriority } from '@zenith/shared/workflow';
import { applyFieldPermissionsToFields, WORKFLOW_APPROVE_METHOD_LABELS as METHOD_LABEL } from '@zenith/shared/workflow';
import WorkflowFormRenderer from '@/pages/workflow/designer/components/WorkflowFormRenderer';
import BusinessFormHost, { type WorkflowBusinessFormApi } from '@/components/workflow/BusinessFormHost';
import { SignatureClientProvider } from '@/components/signature/SignatureClientContext';
import { approvalRequest } from '../lib/approval-request';
import {
  compactSelectedInitiatorApprovers,
  firstMissingInitiatorApproverNode,
  type InitiatorApproverSelectNode,
  type SelectedInitiatorApprovers,
} from '@/components/workflow/WorkflowApprovalChainPanel';
import { UserAvatar } from '@/components/UserAvatar';
import { useEventCallback } from '@/hooks/useEventCallback';
import { WORKFLOW_PRIORITY_OPTIONS } from '@/components/workflow/WorkflowPriorityTag';
import ApproverPickerField from '../components/ApproverPicker';
import { canLaunchOnMobile } from '../lib/launch';
import MobileWorkflowGraph from '../components/MobileWorkflowGraph';
import { recordRecentDefinition } from '../lib/recent';
import { readApprovalRecovery, removeApprovalRecovery, saveApprovalRecovery } from '../lib/draft-recovery';
import {
  useApprovalChainPreview, useApprovalDraftEditor, useApprovalMe, useApprovalUsers, useLaunchInstance,
  usePublishedDefinitions, useSubmitApprovalDraft, useUpdateApprovalDraft,
} from '../lib/queries';

const CHAIN_ICON: Record<string, LucideIcon> = {
  approve: Clock, handler: Clock, ccNode: Mail, subProcess: GitBranch,
};

/** 发起页审批链路（预测态）：竖向紧凑时间线，自选节点内联选人 */
function ChainSection({
  nodes, isLoading, isError, onRetry, selected, onSelect, highlightMissing,
}: Readonly<{
  nodes: WorkflowApproverPreviewNode[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  selected: SelectedInitiatorApprovers;
  onSelect: (nodeKey: string, ids: number[]) => void;
  highlightMissing: boolean;
}>) {
  if (isLoading && nodes.length === 0) {
    return <div style={{ textAlign: 'center', padding: '20px 0' }}><Spin /></div>;
  }
  if (isError) {
    return (
      <div style={{ textAlign: 'center', padding: '12px 0' }}>
        <Typography.Text type="tertiary" style={{ display: 'block', marginBottom: 8 }}>审批链路预测失败</Typography.Text>
        <Button size="small" onClick={onRetry}>重试</Button>
      </div>
    );
  }
  const startNode = nodes.find((n) => n.nodeType === 'start');
  const flowNodes = nodes.filter((n) => n.nodeType !== 'start' && n.status !== 'excluded');
  if (flowNodes.length === 0) {
    return <Typography.Text type="tertiary" size="small">该流程无需审批，提交后自动通过</Typography.Text>;
  }
  const items: Array<{ key: string; name: string; icon: LucideIcon; warning: boolean; body: React.ReactNode; tag?: string }> = [];
  items.push({
    key: '__start__',
    name: '发起申请',
    icon: Send,
    warning: false,
    body: (
      <div className="ap-chain__approvers">
        <span className="ap-chain__approver">
          <UserAvatar name={startNode?.approvers[0]?.name ?? '发起人'} semiSize="extra-extra-small" size={20} />
          {startNode?.approvers[0]?.name ?? '发起人'}
        </span>
      </div>
    ),
  });
  for (const n of flowNodes) {
    const isSelect = n.selectionRequired === true;
    let body: React.ReactNode;
    if (isSelect) {
      const ids = selected[n.nodeKey] ?? [];
      const missing = highlightMissing && ids.length === 0;
      body = (
        <div className="ap-chain__picker">
          <ApproverPickerField
            title={n.nodeName}
            candidates={n.selectableApprovers ?? []}
            value={ids}
            onChange={(next) => onSelect(n.nodeKey, next)}
            error={missing}
          />
          {missing && <span className="ap-chain__error">请选择该节点的审批人</span>}
        </div>
      );
    } else if (n.nodeType === 'subProcess') {
      body = <Typography.Text size="small" type="tertiary">子流程</Typography.Text>;
    } else if (n.approvers.length > 0) {
      body = (
        <div className="ap-chain__approvers">
          {n.approvers.map((a) => (
            <span key={a.id} className="ap-chain__approver">
              <UserAvatar name={a.name} semiSize="extra-extra-small" size={20} />
              {a.name}
            </span>
          ))}
        </div>
      );
    } else {
      body = (
        <Typography.Text size="small" type="warning">
          {n.approverState === 'empty' ? '无人可派，将按空审批人策略处理' : n.approverState === 'unknown' ? '审批人将在运行时确定' : '—'}
        </Typography.Text>
      );
    }
    items.push({
      key: n.nodeKey,
      name: n.branchLabel ? `${n.nodeName}（${n.branchLabel}）` : n.nodeName,
      icon: isSelect ? UserPlus : (CHAIN_ICON[n.nodeType] ?? Clock),
      warning: isSelect,
      tag: n.automaticAction ? (n.automaticAction === 'approve' ? '自动通过' : '自动拒绝') : n.status === 'unknown' ? '待条件确认' : n.approveMethod ? METHOD_LABEL[n.approveMethod] : undefined,
      body,
    });
  }
  return (
    <div className="ap-chain">
      {items.map((item, idx) => {
        const Icon = item.icon;
        return (
          <div key={item.key} className="ap-chain__node">
            <div className="ap-chain__rail">
              <span className={`ap-chain__icon${item.warning ? ' ap-chain__icon--warning' : ''}`}><Icon size={13} /></span>
              {idx < items.length - 1 && <span className="ap-chain__link" />}
            </div>
            <div className="ap-chain__content">
              <div className="ap-chain__name">
                {item.name}
                {item.tag && <Tag size="small" color="blue">{item.tag}</Tag>}
              </div>
              {item.body}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function LaunchFormPage() {
  const params = useParams();
  return <SignatureClientProvider client={approvalRequest}><LaunchFormContent key={`${params.definitionId ?? 'draft'}-${params.instanceId ?? 'new'}`} /></SignatureClientProvider>;
}

function LaunchFormContent() {
  const navigate = useNavigate();
  const { definitionId, instanceId: draftInstanceIdParam } = useParams<{ definitionId?: string; instanceId?: string }>();
  const draftInstanceId = draftInstanceIdParam ? Number(draftInstanceIdParam) : null;
  const defsQuery = usePublishedDefinitions();
  const editorQuery = useApprovalDraftEditor(Number.isFinite(draftInstanceId) ? draftInstanceId : null);
  const draftQuery = { ...editorQuery, data: editorQuery.data?.instance };
  const meQuery = useApprovalMe();
  const launchMutation = useLaunchInstance();
  const draftMutation = useLaunchInstance();
  const updateDraftMutation = useUpdateApprovalDraft();
  const submitDraftMutation = useSubmitApprovalDraft();
  const [ccSearch, setCcSearch] = useState('');
  const usersQuery = useApprovalUsers(true, ccSearch);
  const formApi = useRef<FormApi | null>(null);
  const businessApi = useRef<WorkflowBusinessFormApi | null>(null);

  const isEditingDraft = draftInstanceId != null;
  const def = useMemo(
    () => {
      if (editorQuery.data) return editorQuery.data.definition;
      return (defsQuery.data ?? []).find((d) => d.id === Number(definitionId)) ?? null;
    },
    [defsQuery.data, definitionId, editorQuery.data],
  );

  const defaultTitle = useMemo(() => {
    const who = meQuery.data?.nickname || meQuery.data?.username || '';
    return def ? `${def.name} - ${who} - ${dayjs().format('MM-DD HH:mm')}` : '';
  }, [def, meQuery.data]);
  const [title, setTitle] = useState<string | null>(null);
  const [priority, setPriority] = useState<WorkflowInstancePriority>('normal');
  const [ccUserIds, setCcUserIds] = useState<number[]>([]);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [autosaveState, setAutosaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const revision = useRef<number | undefined>(undefined);
  const dirty = useRef(false);
  const saving = useRef<Promise<unknown> | null>(null);
  const manualSubmission = useRef(false);
  const [versionAccepted, setVersionAccepted] = useState(false);
  const [recoveryValues, setRecoveryValues] = useState<Record<string, unknown> | undefined>();
  const [recoveryLoaded, setRecoveryLoaded] = useState(false);
  useEffect(() => {
    if (!def || isEditingDraft || recoveryLoaded) return;
    const recovery = readApprovalRecovery(def.id);
    if (recovery && window.confirm('发现未提交的本地恢复稿，是否恢复？')) { setRecoveryValues(recovery.formData); setTitle(recovery.title); }
    setRecoveryLoaded(true);
  }, [def, isEditingDraft, recoveryLoaded]);

  useEffect(() => {
    const setOnlineState = () => setOnline(navigator.onLine);
    window.addEventListener('online', setOnlineState);
    window.addEventListener('offline', setOnlineState);
    return () => {
      window.removeEventListener('online', setOnlineState);
      window.removeEventListener('offline', setOnlineState);
    };
  }, []);

  useEffect(() => {
    if (!draftQuery.data || revision.current !== undefined) return;
    setTitle(draftQuery.data.title);
    setPriority(draftQuery.data.priority ?? 'normal');
    revision.current = draftQuery.data.draftRevision;
    setCcUserIds(draftQuery.data.draftIntent?.ccUserIds ?? []);
    setSelectedApprovers(draftQuery.data.draftIntent?.selectedInitiatorApprovers ?? {});
  }, [draftQuery.data]);

  const launchFields = useMemo(() => {
    if (!def) return [];
    const startPerms = def.flowData?.nodes.find((n) => n.data.type === 'start')?.data.fieldPermissions;
    return applyFieldPermissionsToFields(def.formFields ?? [], startPerms);
  }, [def]);

  const canSubmit = def != null && canLaunchOnMobile(def);

  const scheduleDraftAutosave = useDebouncedCallback(() => {
    if (manualSubmission.current) return;
    dirty.current = true;
    if (!isEditingDraft && def) saveApprovalRecovery(def.id, def.formFields ?? [], formApi.current?.getValues() ?? {}, title ?? defaultTitle);
    if (!isEditingDraft || draftInstanceId == null || !draftQuery.data || !online
      || launchMutation.isPending || draftMutation.isPending || submitDraftMutation.isPending) return;
    if (editorQuery.data?.versionChanged && !versionAccepted) return;
    if (saving.current) return;
    const save = async () => {
      while (dirty.current) {
        dirty.current = false;
        setAutosaveState('saving');
        const saved = await persistDraft();
        revision.current = saved.draftRevision;
        setAutosaveState('saved');
      }
    };
    saving.current = save().catch(() => { dirty.current = true; setAutosaveState('failed'); }).finally(() => { saving.current = null; });
  }, { wait: 1200 });

  // 审批链路预测：表单变更防抖 500ms 重新预测（条件分支可能随表单值变化）
  const [chainReloadKey, setChainReloadKey] = useState(0);
  const scheduleChainReload = useDebouncedCallback(() => setChainReloadKey((k) => k + 1), { wait: 500 });

  const previewQuery = useApprovalChainPreview(
    canSubmit ? def.id : null,
    chainReloadKey,
    () => (businessApi.current?.getValues?.() ?? formApi.current?.getValues() ?? {}) as Record<string, unknown>,
  );
  const chainNodes = useMemo(() => previewQuery.data ?? [], [previewQuery.data]);
  const sameInitiatorAutoSkip = useMemo(() => {
    const initiatorId = meQuery.data?.id;
    if (!initiatorId || !def?.flowData) return [] as string[];
    const autoSkipNodeKeys = new Set(
      def.flowData.nodes
        .filter((node) => node.data.type === 'approve' && node.data.sameInitiatorStrategy !== 'selfApprove')
        .map((node) => node.data.key),
    );
    return chainNodes
      .filter((node) => node.nodeType === 'approve' && node.status !== 'excluded' && autoSkipNodeKeys.has(node.nodeKey))
      .filter((node) => node.approvers.some((approver) => approver.id === initiatorId))
      .map((node) => node.nodeName);
  }, [chainNodes, def, meQuery.data?.id]);

  // 发起人自选审批人：nodeKey -> userIds
  const [selectedApprovers, setSelectedApprovers] = useState<SelectedInitiatorApprovers>({});
  const persistDraft = useEventCallback(async () => updateDraftMutation.mutateAsync({ id: draftInstanceId!, body: { title: (title ?? draftQuery.data?.title ?? defaultTitle).trim() || defaultTitle, formData: businessApi.current?.getValues?.() ?? formApi.current?.getValues() ?? {}, priority, expectedRevision: revision.current, expectedDefinitionVersion: def?.version, expectedFormRevision: editorQuery.data?.formRevision, draftIntent: { ccUserIds, selectedInitiatorApprovers: selectedApprovers } } }));
  useEffect(() => { if (online && isEditingDraft && dirty.current) scheduleDraftAutosave(); }, [online, isEditingDraft, scheduleDraftAutosave]);
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => { if (dirty.current || saving.current || (!isEditingDraft && formApi.current?.getValues() && Object.keys(formApi.current.getValues()).length)) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [isEditingDraft]);
  const [highlightMissing, setHighlightMissing] = useState(false);
  const selectNodes = useMemo<InitiatorApproverSelectNode[]>(
    () => chainNodes
      .filter((n) => n.selectionRequired)
      .map((n) => ({
        nodeKey: n.nodeKey,
        nodeName: n.nodeName,
        selectableApprovers: n.selectableApprovers ?? [],
        selectionRequired: n.selectionRequired ?? false,
      })),
    [chainNodes],
  );

  const handleSelect = (nodeKey: string, ids: number[]) => {
    setSelectedApprovers((prev) => ({ ...prev, [nodeKey]: ids }));
    if (ids.length > 0) setHighlightMissing(false);
    scheduleDraftAutosave();
  };

  const submit = async (asDraft = false) => {
    if (!def || launchMutation.isPending || draftMutation.isPending || submitDraftMutation.isPending) return;
    try {
      if (editorQuery.data?.versionChanged && !versionAccepted) { Toast.warning('请先确认流程或表单版本变化'); return; }
      manualSubmission.current = true;
      await saving.current;
      dirty.current = false;
      const formData = (asDraft
        ? businessApi.current?.getValues?.() ?? formApi.current?.getValues() ?? {}
        : businessApi.current ? await businessApi.current.validate() : await formApi.current?.validate() ?? {}) as Record<string, unknown>;
      const missing = asDraft ? null : firstMissingInitiatorApproverNode(selectedApprovers, selectNodes);
      if (missing) {
        setHighlightMissing(true);
        Toast.error(`请为「${missing.nodeName}」选择审批人`);
        return;
      }
      const effectiveTitle = (title ?? draftQuery.data?.title ?? defaultTitle).trim() || defaultTitle;
      const selected = compactSelectedInitiatorApprovers(selectedApprovers, selectNodes);
      if (isEditingDraft && draftInstanceId != null) {
        const saved = await updateDraftMutation.mutateAsync({
          id: draftInstanceId,
          body: { title: effectiveTitle, formData, priority, expectedRevision: revision.current, expectedDefinitionVersion: def.version, expectedFormRevision: editorQuery.data?.formRevision, draftIntent: { ccUserIds, selectedInitiatorApprovers: selected } },
        });
        revision.current = saved.draftRevision;
        if (!asDraft) {
          await submitDraftMutation.mutateAsync({ id: draftInstanceId, selectedInitiatorApprovers: selected, expectedRevision: saved.draftRevision, expectedDefinitionVersion: def.version, expectedFormRevision: editorQuery.data?.formRevision });
        }
        Toast.success(asDraft ? '草稿已保存' : '提交成功');
        navigate(`/detail/${draftInstanceId}`, { replace: true });
        return;
      }
      const mutation = asDraft ? draftMutation : launchMutation;
      const created = await mutation.mutateAsync({
        definitionId: def.id,
        title: effectiveTitle,
        formData,
        priority,
        ccUserIds: ccUserIds.length > 0 ? ccUserIds : undefined,
        selectedInitiatorApprovers: selected,
        ...(asDraft ? { asDraft: true } : {}),
      });
      recordRecentDefinition(def.id);
      removeApprovalRecovery(def.id);
      dirty.current = false;
      Toast.success(asDraft ? '草稿已保存' : '提交成功');
      navigate(asDraft ? `/draft/${created.id}` : `/detail/${created.id}`, { replace: true });
    } catch { dirty.current = true; /* 校验或请求失败（request 层已 Toast） */ } finally { manualSubmission.current = false; }
  };

  const renderBody = () => {
    if (defsQuery.isLoading || (isEditingDraft && draftQuery.isLoading)) return <Skeleton placeholder={<Skeleton.Paragraph rows={5} />} loading active />;
    if (isEditingDraft && !draftQuery.data) return <Empty description="草稿不存在或无权编辑" style={{ paddingTop: 60 }} />;
    if (!def) return <Empty description="流程不存在或未发布" style={{ paddingTop: 60 }} />;
    if (!isEditingDraft && !recoveryLoaded) return <Spin />;
    if (!canLaunchOnMobile(def)) {
      return <Banner type="warning" closeIcon={null} description="该流程使用业务自定义表单，请到桌面端发起。" />;
    }
    return (
      <>
        {editorQuery.data?.versionChanged && !versionAccepted && <Banner type="warning" closeIcon={null} description={<>流程或表单已更新，请核对字段与审批链后确认。<Button onClick={() => { setVersionAccepted(true); setSelectedApprovers({}); }}>使用当前发布版本继续编辑</Button></>} />}
        <div className="ap-section-title">申请标题</div>
        <Input value={title ?? draftQuery.data?.title ?? defaultTitle} onChange={(value) => { setTitle(value); scheduleDraftAutosave(); }} showClear placeholder="请输入申请标题" />
        <div className="ap-section-title">申请设置</div>
        <div className="ap-launch-settings">
          <div className="ap-launch-settings__field">
            <Typography.Text type="tertiary" size="small">优先级</Typography.Text>
            <Select
              value={priority}
              optionList={WORKFLOW_PRIORITY_OPTIONS}
              onChange={(value) => { setPriority(value as WorkflowInstancePriority); scheduleDraftAutosave(); }}
              style={{ width: '100%' }}
            />
          </div>
          {(
            <div className="ap-launch-settings__field">
              <Typography.Text type="tertiary" size="small">抄送人</Typography.Text>
              <Select
                multiple
                maxTagCount={2}
                showRestTagsPopover
                filter
                remote
                onSearch={setCcSearch}
                showClear
                value={ccUserIds}
                loading={usersQuery.isLoading}
                optionList={(usersQuery.data ?? []).map((user) => ({ value: user.id, label: user.nickname || user.username }))}
                placeholder="可选，提交后立即抄送"
                onChange={(value) => { setCcUserIds((value as number[]) ?? []); scheduleDraftAutosave(); }}
                style={{ width: '100%' }}
              />
            </div>
          )}
        </div>
        <div className="ap-section-title">表单信息</div>
        {def.formType === 'custom' ? <BusinessFormHost customForm={def.customForm} mode="create" container="tab" requestClient={approvalRequest} definitionId={def.id} value={draftQuery.data?.formData ?? {}} getFormApi={api => { businessApi.current = api; }} onValuesChange={() => { scheduleChainReload(); scheduleDraftAutosave(); }} /> : launchFields.length === 0
          ? <Typography.Text type="tertiary">该流程无需填写表单，直接提交即可</Typography.Text>
          : (
            <WorkflowFormRenderer
              key={`launch-${def.id}`}
              fields={launchFields}
              filePreviewPresentation="fullscreen"
              fileCapture="environment"
              initValues={(draftQuery.data?.formData ?? recoveryValues) as Record<string, unknown> | undefined}
              getFormApi={(api) => { formApi.current = api; }}
              onValueChange={() => { dirty.current = true; scheduleChainReload(); scheduleDraftAutosave(); }}
            />
          )}
        <div className="ap-section-title">审批流程</div>
        {sameInitiatorAutoSkip.length > 0 && (
          <Banner
            type="warning"
            closeIcon={null}
            description={`节点「${sameInitiatorAutoSkip.join('、')}」的审批人是当前发起人，提交后将按流程规则自动跳过。需要本人审批时，请在流程设计中将「与提交人同一人」设置为「由发起人自己审批」。`}
            style={{ marginBottom: 10 }}
          />
        )}
        <ChainSection
          nodes={chainNodes}
          isLoading={previewQuery.isLoading}
          isError={previewQuery.isError}
          onRetry={() => void previewQuery.refetch()}
          selected={selectedApprovers}
          onSelect={handleSelect}
          highlightMissing={highlightMissing}
        />
      </>
    );
  };

  return (
    <div className="ap-page">
      <div className="ap-header">
        <Button theme="borderless" icon={<ChevronLeft size={18} />} onClick={() => { if (dirty.current && !window.confirm('尚有未保存内容，确定离开？')) return; navigate(-1); }} aria-label="返回" />
        <span className="ap-header__title">{def?.name ?? '发起申请'}</span>
        {def && canSubmit ? (
          <MobileWorkflowGraph flowData={def.flowData} formFields={def.formFields ?? undefined} />
        ) : null}
      </div>
      <div className={`ap-body${canSubmit ? ' ap-body--with-footer' : ''}`}>{renderBody()}</div>
      {!online && <Banner className="ap-offline-banner" type="warning" closeIcon={null} description="当前处于离线状态，草稿会在网络恢复后继续保存。" />}
      {canSubmit && (
        <div className="ap-footer-bar">
          {isEditingDraft && <Typography.Text className="ap-autosave-status" type={autosaveState === 'failed' ? 'danger' : 'tertiary'}>
            {autosaveState === 'saving' ? '自动保存中…' : autosaveState === 'saved' ? '已自动保存' : autosaveState === 'failed' ? '自动保存失败' : ''}
          </Typography.Text>}
          <Button
            theme="light"
            loading={isEditingDraft ? updateDraftMutation.isPending : draftMutation.isPending}
            disabled={submitDraftMutation.isPending || launchMutation.isPending}
            onClick={() => void submit(true)}
          >
            {isEditingDraft ? '保存' : '保存草稿'}
          </Button>
          <Button
            theme="solid"
            type="primary"
            loading={isEditingDraft ? submitDraftMutation.isPending : launchMutation.isPending}
            disabled={isEditingDraft ? updateDraftMutation.isPending : draftMutation.isPending}
            onClick={() => void submit()}
          >
            {isEditingDraft ? '保存并提交' : '提交申请'}
          </Button>
        </div>
      )}
    </div>
  );
}
