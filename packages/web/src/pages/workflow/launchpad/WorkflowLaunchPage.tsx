/**
 * 流程发起整页（多页签打开）
 *
 * 与发起工作台 SideSheet 等价的发起填写表单，作为独立系统多页签承载。
 * 表单主体复用 WorkflowLaunchForm 组件。
 */
import { useContext, useEffect, useRef, useState } from 'react';
import { useLocation, useParams, useNavigate } from 'react-router-dom';
import { Button, Empty, Spin, Toast, Typography } from '@douyinfe/semi-ui';
import WorkflowLaunchForm, { type WorkflowLaunchFormHandle } from '@/components/workflow/WorkflowLaunchForm';
import { launchSnapshotFromState } from '@/components/workflow/launch-snapshot';
import { useLaunchLeaveGuard } from '@/components/workflow/useLaunchLeaveGuard';
import { useTabMeta, TabsMetaContext } from '@/hooks/useTabMeta';
import { usePublishedWorkflowDefinitions } from '@/hooks/queries/workflow-definitions';
import { useLaunchWorkflowInstance } from '@/hooks/queries/workflow-launch';

export default function WorkflowLaunchPage() {
  const { definitionId } = useParams<{ definitionId: string }>();
  const navigate = useNavigate();
  const tabsCtx = useContext(TabsMetaContext);
  const defId = Number(definitionId);
  const location = useLocation();
  const [snapshot, setSnapshot] = useState(() => launchSnapshotFromState(location.state, defId));
  const transferredDefinition = useRef(defId);

  const launchFormRef = useRef<WorkflowLaunchFormHandle>(null);
  const leaveGuard = useLaunchLeaveGuard(() => launchFormRef.current?.hasUnsavedChanges() ?? false);
  useEffect(() => {
    const next = launchSnapshotFromState(location.state, defId);
    if (next) setSnapshot(next);
    else if (transferredDefinition.current !== defId) setSnapshot(undefined);
    transferredDefinition.current = defId;
    if (!next) return;
    const { launchSnapshot: _consumed, ...remainingState } = location.state as Record<string, unknown>;
    void _consumed;
    navigate(`${location.pathname}${location.search}${location.hash}`, { replace: true, state: remainingState });
  }, [defId, location.hash, location.pathname, location.search, location.state, navigate]);
  const submitNonceRef = useRef<string>('');
  // 深链发起页从「已发布定义」取数：与发起工作台同源，仅需发起权限
  //（管理端定义详情接口要求 workflow:definition:list，普通发起人无权限会 403）
  const definitionsQuery = usePublishedWorkflowDefinitions({ enabled: Number.isFinite(defId) });
  const submitMutation = useLaunchWorkflowInstance();
  const saveDraftMutation = useLaunchWorkflowInstance();
  const def = definitionsQuery.data?.find((d) => d.id === defId) ?? null;
  const loading = definitionsQuery.isFetching;
  const submitting = submitMutation.isPending;
  const savingDraft = saveDraftMutation.isPending;

  useTabMeta({
    title: def ? `发起：${def.name}` : '发起申请',
    icon: def?.customForm?.icon ?? def?.categoryIcon ?? 'Send',
  });
  const isExternal = def?.formType === 'external';

  const handleSubmit = async (asDraft: boolean) => {
    if (!def) return;
    const result = await launchFormRef.current?.collectFormData({ requireInitiatorApprovers: !asDraft, validateForm: !asDraft });
    if (!result) return;
    const { values, formData } = result;
    if (!asDraft && !submitNonceRef.current) submitNonceRef.current = crypto.randomUUID();
    const res = await (asDraft ? saveDraftMutation : submitMutation).mutateAsync({
      body: {
        definitionId: def.id,
        title: values.title,
        formData,
        priority: values.priority ?? 'normal',
        ccUserIds: Array.isArray(values.ccUserIds) ? values.ccUserIds : undefined,
        selectedInitiatorApprovers: result.selectedInitiatorApprovers,
        ...(asDraft ? { asDraft: true } : {}),
      },
      idempotencyKey: asDraft ? undefined : `workflow-launch-${submitNonceRef.current}`,
    });
    if (!asDraft) submitNonceRef.current = '';
    Toast.success(asDraft ? '草稿已保存' : '申请已提交');
    const newId = res.id;
    setSnapshot(undefined);
    leaveGuard.allowNavigation(() => {
      if (!asDraft && newId) {
        navigate(`/workflow/instance/${newId}`, { state: { tabTitle: String(values.title ?? '流程详情') } });
      } else {
        navigate('/workflow/instances');
      }
    });
    // 关闭当前发起整页标签，避免遗留已消费的“发起：X”标签
    tabsCtx?.closeTab(`/workflow/launch/${definitionId}`);
  };

  if (loading && !def) {
    return <div style={{ textAlign: 'center', padding: 60 }}><Spin /></div>;
  }
  if (definitionsQuery.isError) {
    return <Empty title="流程加载失败" description="请重试获取流程定义" style={{ padding: 60 }}><Button loading={loading} onClick={() => void definitionsQuery.refetch()}>重试</Button></Empty>;
  }
  if (!Number.isFinite(defId) || (!loading && !def)) {
    return <Empty title="流程定义不存在或未发布" style={{ padding: 60 }} />;
  }

  return (
    <div className="page-container page-container--stretch">
      <Typography.Title heading={5} style={{ margin: 0 }}>
        {def ? `发起：${def.name}` : '发起申请'}
      </Typography.Title>

      <div style={{ flex: 1, minHeight: 0 }}>
        {def && <WorkflowLaunchForm key={`${def.id}-${snapshot ? 'transferred' : 'new'}`} ref={launchFormRef} def={def} container="tab"
          initialTitle={snapshot?.values.title}
          initialPriority={snapshot?.values.priority}
          initialCcUserIds={snapshot?.values.ccUserIds}
          initialFormData={snapshot?.formData}
          initialSelectedInitiatorApprovers={snapshot?.selectedInitiatorApprovers}
          initialDirty={snapshot?.dirty}
        />}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Button onClick={() => navigate('/workflow/launchpad')}>取消</Button>
        <Button loading={savingDraft} disabled={submitting || isExternal} onClick={() => void handleSubmit(true)}>保存草稿</Button>
        <Button type="primary" loading={submitting} disabled={savingDraft || isExternal} onClick={() => void handleSubmit(false)}>提交</Button>
      </div>
    </div>
  );
}
