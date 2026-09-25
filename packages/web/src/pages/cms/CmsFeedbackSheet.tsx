import { useState } from 'react';
import { useDebouncedCallback } from '@tanstack/react-pacer';
import { Banner, Button, DatePicker, Descriptions, Select, Space, Spin, Tag, TextArea, Toast, Typography } from '@douyinfe/semi-ui';
import { canTransitionCmsFeedback, CMS_FEEDBACK_STATUS_LABELS, CMS_FEEDBACK_STATUS_OPTIONS, type CmsFeedbackDetail } from '@zenith/shared/cms';
import { WORKFLOW_ACTIVE_INSTANCE_STATUSES } from '@zenith/shared/workflow';
import { useCmsFeedbackDetail, useCmsFeedbackWorkflow, useCmsFeedbackWorkflowPreview, useCmsOperationsAssignees, useHandleCmsFeedback, useSubmitCmsFeedbackWorkflow, useCreateCmsEditorialTask } from '@/hooks/queries/cms-operations';
import { usePermission } from '@/hooks/usePermission';
import DateTimeText from '@/components/DateTimeText';
import WorkflowSideSheet from '@/components/workflow/WorkflowSideSheet';
import BusinessWorkflowPanel from '@/components/workflow/BusinessWorkflowPanel';
import { formatDateTime, formatDateTimeForApi, parseDateTimeParam } from '@/utils/date';
import { useCmsTaskEditor } from './CmsEditorialTasks';

export function CmsFeedbackDetails({ feedback }: Readonly<{ feedback: CmsFeedbackDetail }>) {
  return <>
    <Descriptions align="left" data={[
      { key: '来信标题', value: feedback.title }, { key: '表单', value: feedback.formName },
      { key: '办理状态', value: CMS_FEEDBACK_STATUS_LABELS[feedback.status] }, { key: '负责人', value: feedback.ownerName ?? '未分派' },
      { key: '收到时间', value: formatDateTime(feedback.createdAt) }, { key: '截止时间', value: formatDateTime(feedback.dueAt) || '未设置' },
      ...feedback.fields.map((field) => ({ key: field.label, value: <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{typeof feedback.data[field.name] === 'object' ? JSON.stringify(feedback.data[field.name]) : String(feedback.data[field.name] ?? '—')}</span> })),
    ]} />
    {feedback.resolution ? <><Typography.Title heading={6}>办理结果</Typography.Title><Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>{feedback.resolution}</Typography.Paragraph></> : null}
  </>;
}

const actionLabel = (action: string) => action.startsWith('status:') ? `状态变更为${CMS_FEEDBACK_STATUS_LABELS[action.slice(7) as keyof typeof CMS_FEEDBACK_STATUS_LABELS] ?? action.slice(7)}` : ({ received: '收到来信', assigned: '调整分派', deadline: '调整截止时间', note: '内部备注', 'workflow:submitted': '提交办理审批', 'workflow:created': '审批已发起', 'workflow:approved': '审批通过', 'workflow:rejected': '审批驳回', 'workflow:withdrawn': '审批撤回', 'workflow:cancelled': '审批取消', 'workflow:failed': '审批发起失败', 'workflow:reconciled': '审批状态同步' }[action] ?? action);

function FeedbackHandling({ feedback, onNoteChange }: Readonly<{ feedback: CmsFeedbackDetail; onNoteChange: (note: string) => void }>) {
  const { hasPermission } = usePermission();
  const canManage = hasPermission('cms:feedback:manage');
  const assignees = useCmsOperationsAssignees(canManage);
  const handle = useHandleCmsFeedback();
  const submit = useSubmitCmsFeedbackWorkflow();
  const [version, setVersion] = useState(feedback.version);
  const [status, setStatus] = useState(feedback.status);
  const [ownerId, setOwnerId] = useState<number | null>(feedback.ownerId);
  const [dueAt, setDueAt] = useState(feedback.dueAt);
  const [note, setNote] = useState('');
  const active = WORKFLOW_ACTIVE_INSTANCE_STATUSES.some((value) => value === feedback.workflowStatus);
  const pending = handle.isPending || submit.isPending;
  const refreshDraft = (saved: CmsFeedbackDetail) => { setVersion(saved.version); setStatus(saved.status); setOwnerId(saved.ownerId); setDueAt(saved.dueAt); setNote(''); onNoteChange(''); };
  return <div style={{ padding: 16 }}>
    <CmsFeedbackDetails feedback={feedback} />
    {canManage ? <Space vertical align="start" spacing={12} style={{ width: '100%', marginTop: 20 }}>
      {active ? <Banner type="info" description="办理结果正在审批，审批结束或撤回后可继续修改。" /> : null}
      {feedback.version !== version ? <Banner type="warning" description="记录已被其他人更新。本次输入已保留，请核对最新资料后重新打开办理侧栏。" /> : null}
      <Typography.Title heading={6}>分派与内部办理</Typography.Title>
      <Select aria-label="办理负责人" disabled={active || pending} value={ownerId ?? undefined} onChange={(value) => setOwnerId(value ? Number(value) : null)} showClear filter placeholder="办理负责人" optionList={(assignees.data ?? []).map((user) => ({ value: user.id, label: user.name }))} loading={assignees.isFetching} style={{ width: '100%' }} />
      <DatePicker aria-label="办理截止时间" disabled={active || pending} type="dateTime" value={parseDateTimeParam(dueAt) ?? undefined} onChange={(value) => setDueAt(value ? formatDateTimeForApi(value as Date) : null)} showClear placeholder="办理截止时间" style={{ width: '100%' }} />
      <Select aria-label="办理状态" disabled={active || pending} value={status} onChange={(value) => setStatus(value as typeof status)} optionList={CMS_FEEDBACK_STATUS_OPTIONS.filter((option) => canTransitionCmsFeedback(feedback.status, option.value) && !(option.value === 'resolved' && feedback.workflowDefinitionId))} style={{ width: '100%' }} />
      <TextArea aria-label="内部办理意见" disabled={active || pending} value={note} onChange={(value) => { setNote(value); onNoteChange(value); }} maxCount={5000} placeholder="填写内部备注或办理意见；状态流转和提交审批时必填" rows={4} style={{ width: '100%' }} />
      <Space wrap>
        <Button theme="solid" disabled={active || feedback.version !== version || (!note.trim() && ownerId === feedback.ownerId && dueAt === feedback.dueAt && status === feedback.status) || (status !== feedback.status && !note.trim())} loading={handle.isPending} onClick={async () => { const saved = await handle.mutateAsync({ params: { id: feedback.id }, body: { expectedVersion: version, status, ownerId, dueAt, note } }); refreshDraft(saved); Toast.success('办理记录已保存'); }}>保存办理</Button>
        {feedback.workflowDefinitionId ? <Button disabled={active || feedback.status !== 'processing' || feedback.version !== version || !note.trim() || status !== feedback.status || ownerId !== feedback.ownerId || dueAt !== feedback.dueAt} loading={submit.isPending} onClick={async () => { const saved = await submit.mutateAsync({ params: { id: feedback.id }, body: { expectedVersion: version, note } }); refreshDraft(saved); Toast.success('办理结果已提交审批'); }}>提交办理审批</Button> : null}
      </Space>
      {feedback.workflowDefinitionId ? <Typography.Text type="tertiary">先保存分派和处理状态，再填写办理结果提交审批。</Typography.Text> : null}
    </Space> : null}
    <Typography.Title heading={6} style={{ marginTop: 24 }}>办理历史</Typography.Title>
    {feedback.history.map((event) => <div key={event.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--semi-color-border)' }}><Space wrap><Tag>{actionLabel(event.action)}</Tag><Typography.Text>{event.actorName ?? '系统'}</Typography.Text><Typography.Text type="tertiary"><DateTimeText value={event.createdAt} /> · v{event.version}</Typography.Text></Space>{event.note ? <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', marginTop: 8 }}>{event.note}</Typography.Paragraph> : null}</div>)}
  </div>;
}

export default function CmsFeedbackSheet({ id, onClose }: Readonly<{ id?: number; onClose: () => void }>) {
  const { hasPermission } = usePermission();
  const detail = useCmsFeedbackDetail(id);
  const [instanceId, setInstanceId] = useState<number>();
  const context = useCmsFeedbackWorkflow(id, instanceId);
  const [previewNote, setPreviewNote] = useState('');
  const scheduleNotePreview = useDebouncedCallback(setPreviewNote, { wait: 500 });
  const preview = useCmsFeedbackWorkflowPreview(id, previewNote, !!detail.data?.workflowDefinitionId && !context.data?.instance);
  const createTask = useCreateCmsEditorialTask();
  const editor = useCmsTaskEditor(detail.data?.siteId);
  const feedback = detail.data;
  const content = feedback ? <FeedbackHandling key={feedback.id} feedback={feedback} onNoteChange={scheduleNotePreview} /> : <Spin spinning={detail.isLoading}><Banner type="warning" description={detail.error?.message ?? '正在加载来信'} /></Spin>;
  return <>
    <WorkflowSideSheet title="读者反馈办理" visible={!!id} onCancel={onClose} variant={feedback?.workflowDefinitionId ? 'split' : 'default'} footerRight={<Space><Button onClick={onClose}>关闭</Button>{feedback && hasPermission('cms:editorial-task:manage') ? <Button loading={createTask.isPending} onClick={async () => { const task = await createTask.mutateAsync({ body: { siteId: feedback.siteId, title: feedback.title, description: `来自「${feedback.formName}」的读者反馈。`, source: 'submission', feedbackId: feedback.id, ownerId: feedback.ownerId } }); editor.openEdit(task); }}>转为编辑事项</Button> : null}</Space>}>
      {feedback?.workflowDefinitionId ? <BusinessWorkflowPanel formContent={content} context={context.data} preview={preview.data} selectedInstanceId={instanceId} onSelectInstance={setInstanceId} loading={context.isLoading || preview.isLoading} error={context.error ?? preview.error} onRetry={() => { void context.refetch(); void preview.refetch(); }} /> : content}
    </WorkflowSideSheet>
    {editor.editor}
  </>;
}

