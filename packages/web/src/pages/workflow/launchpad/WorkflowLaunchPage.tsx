/**
 * 流程发起整页（多页签打开）
 *
 * 与发起工作台 SideSheet 等价的发起填写表单，作为独立系统多页签承载。
 * 表单主体复用 WorkflowLaunchForm 组件。
 */
import { useContext, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button, Empty, Spin, Toast, Typography } from '@douyinfe/semi-ui';
import type { WorkflowDefinition, WorkflowInstance } from '@zenith/shared';
import { request } from '@/utils/request';
import WorkflowLaunchForm, { type WorkflowLaunchFormHandle } from '@/components/workflow/WorkflowLaunchForm';
import { useTabMeta, TabsMetaContext } from '@/hooks/useTabMeta';

export default function WorkflowLaunchPage() {
  const { definitionId } = useParams<{ definitionId: string }>();
  const navigate = useNavigate();
  const tabsCtx = useContext(TabsMetaContext);
  const defId = Number(definitionId);

  const [loading, setLoading] = useState(false);
  const [def, setDef] = useState<WorkflowDefinition | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);

  const launchFormRef = useRef<WorkflowLaunchFormHandle>(null);
  const submitNonceRef = useRef<string>('');

  useEffect(() => {
    if (!Number.isFinite(defId)) return;
    setLoading(true);
    request.get<WorkflowDefinition>(`/api/workflows/definitions/${defId}`)
      .then((res) => {
        if (res.code === 0) setDef(res.data);
      })
      .finally(() => setLoading(false));
  }, [defId]);

  useTabMeta({
    title: def ? `发起：${def.name}` : '发起申请',
    icon: def?.customForm?.icon ?? def?.categoryIcon ?? 'Send',
  });
  const isExternal = def?.formType === 'external';

  const handleSubmit = async (asDraft: boolean) => {
    if (!def) return;
    const result = await launchFormRef.current?.collectFormData({ requireInitiatorApprovers: !asDraft });
    if (!result) return;
    const { values, formData } = result;
    const setBusy = asDraft ? setSavingDraft : setSubmitting;
    setBusy(true);
    try {
      if (!asDraft && !submitNonceRef.current) submitNonceRef.current = crypto.randomUUID();
      const res = await request.post<WorkflowInstance>('/api/workflows/instances', {
        definitionId: def.id,
        title: values.title,
        formData,
        priority: values.priority ?? 'normal',
        ccUserIds: Array.isArray(values.ccUserIds) ? values.ccUserIds : undefined,
        selectedInitiatorApprovers: result.selectedInitiatorApprovers,
        ...(asDraft ? { asDraft: true } : {}),
      }, asDraft ? undefined : { headers: { 'X-Idempotency-Key': `workflow-launch-${submitNonceRef.current}` } });
      if (res.code === 0) {
        if (!asDraft) submitNonceRef.current = '';
        Toast.success(asDraft ? '草稿已保存' : '申请已提交');
        const newId = res.data?.id;
        if (!asDraft && newId) {
          navigate(`/workflow/instance/${newId}`, { state: { tabTitle: String(values.title ?? '流程详情') } });
        } else {
          navigate('/workflow/instances');
        }
        // 关闭当前发起整页标签，避免遗留已消费的“发起：X”标签
        tabsCtx?.closeTab(`/workflow/launch/${definitionId}`);
      }
    } finally {
      setBusy(false);
    }
  };

  if (loading && !def) {
    return <div style={{ textAlign: 'center', padding: 60 }}><Spin /></div>;
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
        {def && <WorkflowLaunchForm ref={launchFormRef} def={def} container="tab" />}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Button onClick={() => navigate('/workflow/launchpad')}>取消</Button>
        <Button loading={savingDraft} disabled={submitting || isExternal} onClick={() => void handleSubmit(true)}>保存草稿</Button>
        <Button type="primary" loading={submitting} disabled={savingDraft || isExternal} onClick={() => void handleSubmit(false)}>提交</Button>
      </div>
    </div>
  );
}
