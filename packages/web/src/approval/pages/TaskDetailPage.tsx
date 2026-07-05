import { useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Banner, Button, Empty, Form, Modal, Skeleton, TabPane, Tabs, Tag, Toast, Typography,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { ChevronLeft } from 'lucide-react';
import type { WorkflowActionButtonConfig, WorkflowFieldPermission, WorkflowTask } from '@zenith/shared';
import { applyFieldPermissionsToFields, hasEditableFieldPermission } from '@zenith/shared';
import { formatDateTime } from '@/utils/date';
import ApprovalTimeline from '@/components/ApprovalTimeline';
import SignaturePad from '@/components/SignaturePad';
import WorkflowFormRenderer from '@/pages/workflow/designer/components/WorkflowFormRenderer';
import WorkflowPriorityTag from '@/components/workflow/WorkflowPriorityTag';
import { linearizeApprovalNodes } from '@/components/workflow/workflow-runtime';
import {
  resolveWorkflowDetailDefinition,
  resolveWorkflowFlowData,
  resolveWorkflowFormFields,
  resolveWorkflowFormType,
} from '@/utils/workflow-snapshot';
import { approvalRequest, unwrapApproval } from '../lib/approval-request';
import { useApprovalDetail, useApprovalMe, useTaskAction } from '../lib/queries';

type TagColor = 'amber' | 'blue' | 'green' | 'grey' | 'orange' | 'purple' | 'red';

const STATUS_MAP: Record<string, { text: string; color: TagColor }> = {
  draft: { text: '草稿', color: 'grey' },
  running: { text: '审批中', color: 'blue' },
  suspended: { text: '已挂起', color: 'amber' },
  approved: { text: '已通过', color: 'green' },
  rejected: { text: '已驳回', color: 'red' },
  withdrawn: { text: '已撤回', color: 'orange' },
  cancelled: { text: '已取消', color: 'purple' },
};

type ActionKind = 'approve' | 'reject' | 'transfer' | null;

function resolveBtn(
  cfg: Partial<Record<string, WorkflowActionButtonConfig>> | null | undefined,
  key: 'approve' | 'reject' | 'transfer',
): WorkflowActionButtonConfig {
  const defaults: WorkflowActionButtonConfig = {
    enabled: key !== 'transfer',
    displayName: key === 'approve' ? '同意' : key === 'reject' ? '拒绝' : '转办',
    opinionName: key === 'approve' ? '审批意见' : key === 'reject' ? '拒绝原因' : '转办说明',
  };
  const override = cfg?.[key];
  return override ? { ...defaults, ...override } : defaults;
}

export default function TaskDetailPage() {
  const navigate = useNavigate();
  const params = useParams<{ instanceId: string; taskId?: string }>();
  const instanceId = Number(params.instanceId);
  const taskId = params.taskId ? Number(params.taskId) : null;

  const detailQuery = useApprovalDetail(Number.isFinite(instanceId) ? instanceId : null);
  const meQuery = useApprovalMe();
  const actionMutation = useTaskAction();
  const detail = detailQuery.data ?? null;
  const me = meQuery.data ?? null;

  const [action, setAction] = useState<ActionKind>(null);
  const [signature, setSignature] = useState('');
  const [userOptions, setUserOptions] = useState<Array<{ value: number; label: string }>>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const actionFormApi = useRef<FormApi | null>(null);
  const detailFormApi = useRef<FormApi | null>(null);

  const def = useMemo(() => resolveWorkflowDetailDefinition(detail), [detail]);
  const formType = useMemo(() => resolveWorkflowFormType(detail, def), [detail, def]);
  const formFields = useMemo(() => resolveWorkflowFormFields(detail, def), [detail, def]);
  const flowData = useMemo(() => resolveWorkflowFlowData(detail, def), [detail, def]);

  const currentTask: WorkflowTask | null = useMemo(
    () => (taskId != null ? detail?.tasks?.find((t) => t.id === taskId) ?? null : null),
    [detail, taskId],
  );
  const actionable = currentTask?.status === 'pending' && me != null && currentTask.assigneeId === me.id;

  const nodeCfg = useMemo(
    () => flowData?.nodes.find((n) => n.data.key === currentTask?.nodeKey)?.data ?? null,
    [flowData, currentTask],
  );
  const viewerPerms = (nodeCfg?.fieldPermissions ?? null) as Record<string, WorkflowFieldPermission> | null;
  const visibleFields = useMemo(
    () => applyFieldPermissionsToFields(formFields, currentTask ? viewerPerms : null),
    [formFields, viewerPerms, currentTask],
  );
  const formEditable = actionable && hasEditableFieldPermission(viewerPerms);

  const btnApprove = resolveBtn(currentTask?.actionButtons ?? null, 'approve');
  const btnReject = resolveBtn(currentTask?.actionButtons ?? null, 'reject');
  const btnTransfer = resolveBtn(currentTask?.actionButtons ?? null, 'transfer');
  const needSignature = (currentTask?.signatureRequired ?? false) || (nodeCfg?.operations?.includes('signature') ?? false);
  const opinionRequired = nodeCfg?.operations?.includes('opinionRequired') ?? false;

  const status = detail ? STATUS_MAP[detail.status] : null;

  const collectFormUpdates = async (): Promise<Record<string, unknown> | undefined> => {
    if (!formEditable || !viewerPerms || !detailFormApi.current) return undefined;
    const values = await detailFormApi.current.validate() as Record<string, unknown>;
    const updates: Record<string, unknown> = {};
    for (const [key, perm] of Object.entries(viewerPerms)) {
      if (perm === 'edit' && key in values) updates[key] = values[key];
    }
    return Object.keys(updates).length > 0 ? updates : undefined;
  };

  const openAction = async (kind: Exclude<ActionKind, null>) => {
    if (kind === 'approve' && taskId != null) {
      // 下游存在「自选下一审批人」节点时，轻页不承载选人交互，引导去桌面端
      try {
        const groups = await approvalRequest
          .get<Array<unknown>>(`/api/workflows/tasks/${taskId}/selectable-next-approvers`, { silent: true })
          .then(unwrapApproval);
        if ((groups?.length ?? 0) > 0) {
          Toast.info('下一节点需要您指定审批人，请到桌面端处理该任务');
          return;
        }
      } catch { /* 拉取失败不阻断，交由服务端校验兜底 */ }
    }
    if (kind === 'approve' && btnApprove.uploadMode === 'required') {
      Toast.info('该节点要求上传附件，请到桌面端处理');
      return;
    }
    if (kind === 'transfer' && userOptions.length === 0) {
      setUsersLoading(true);
      try {
        const users = await approvalRequest
          .get<Array<{ id: number; nickname: string | null; username: string }>>('/api/users/all', { silent: true })
          .then(unwrapApproval);
        setUserOptions((users ?? []).filter((u) => u.id !== me?.id).map((u) => ({ value: u.id, label: u.nickname || u.username })));
      } finally {
        setUsersLoading(false);
      }
    }
    setSignature('');
    setAction(kind);
  };

  const submitAction = async () => {
    if (taskId == null || !action) return;
    try {
      const values = (await actionFormApi.current?.validate() ?? {}) as Record<string, unknown>;
      if (action === 'approve' && needSignature && !signature) {
        Toast.error('该节点要求手写签名，请先签名');
        return;
      }
      let body: Record<string, unknown>;
      if (action === 'approve') {
        body = { comment: values.comment ?? '', signature: signature || undefined, formUpdates: await collectFormUpdates() };
      } else if (action === 'reject') {
        body = { comment: values.comment };
      } else {
        body = { targetUserId: values.targetUserId, comment: values.comment };
      }
      await actionMutation.mutateAsync({ taskId, action, body });
      Toast.success(action === 'approve' ? '已同意' : action === 'reject' ? '已驳回' : '已转办');
      setAction(null);
      navigate(-1);
    } catch { /* 表单校验失败或请求失败（request 层已 Toast） */ }
  };

  const renderForm = () => {
    if (formType !== 'designer') {
      return <Banner type="info" closeIcon={null} description="该流程使用业务自定义表单，请到桌面端查看表单内容；流转记录可在下方查看。" />;
    }
    if (visibleFields.length === 0) {
      return <Empty description="当前节点无可见表单字段" style={{ padding: '24px 0' }} />;
    }
    return (
      <WorkflowFormRenderer
        key={`form-${instanceId}-${formEditable ? 'edit' : 'read'}`}
        fields={visibleFields}
        initValues={(detail?.formData ?? {}) as Record<string, unknown>}
        readOnly={!formEditable}
        getFormApi={(api) => { detailFormApi.current = api; }}
      />
    );
  };

  if (detailQuery.isLoading) {
    return (
      <div className="ap-page">
        <div className="ap-header">
          <Button theme="borderless" icon={<ChevronLeft size={18} />} onClick={() => navigate(-1)} aria-label="返回" />
          <span className="ap-header__title">加载中…</span>
        </div>
        <div className="ap-body"><Skeleton placeholder={<Skeleton.Paragraph rows={6} />} loading active /></div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="ap-page">
        <div className="ap-header">
          <Button theme="borderless" icon={<ChevronLeft size={18} />} onClick={() => navigate(-1)} aria-label="返回" />
          <span className="ap-header__title">申请详情</span>
        </div>
        <div className="ap-body"><Empty description="流程不存在或无权查看" style={{ paddingTop: 60 }} /></div>
      </div>
    );
  }

  return (
    <div className="ap-page">
      <div className="ap-header">
        <Button theme="borderless" icon={<ChevronLeft size={18} />} onClick={() => navigate(-1)} aria-label="返回" />
        <span className="ap-header__title">{detail.title}</span>
        {status && <Tag color={status.color}>{status.text}</Tag>}
      </div>
      <div className={`ap-body${actionable ? ' ap-body--with-footer' : ''}`}>
        {detail.status === 'suspended' && (
          <Banner type="warning" closeIcon={null} description={`流程已挂起${detail.suspendReason ? `：${detail.suspendReason}` : ''}，恢复前不可审批`} style={{ marginBottom: 12 }} />
        )}
        <div className="ap-card" style={{ cursor: 'default' }}>
          <div className="ap-card__meta" style={{ marginTop: 0 }}>
            {(detail.priority === 'high' || detail.priority === 'urgent') && <WorkflowPriorityTag priority={detail.priority} />}
            <span>{detail.definitionName ?? '—'}</span>
            <span>·</span>
            <span>{detail.initiatorName ?? '—'} 发起</span>
            <span>·</span>
            <span>{formatDateTime(detail.createdAt)}</span>
          </div>
        </div>
        <Tabs type="line" tabPaneMotion={false}>
          <TabPane tab="审批表单" itemKey="form">
            <div style={{ padding: '12px 2px' }}>{renderForm()}</div>
          </TabPane>
          <TabPane tab="流转记录" itemKey="timeline">
            <div style={{ padding: '12px 2px' }}>
              <ApprovalTimeline
                tasks={detail.tasks ?? []}
                flowNodes={linearizeApprovalNodes(flowData)}
                initiator={{ name: detail.initiatorName, avatar: detail.initiatorAvatar, submittedAt: detail.createdAt }}
                instanceStatus={detail.status}
                finishedAt={detail.updatedAt}
                currentUserId={me?.id ?? null}
              />
            </div>
          </TabPane>
        </Tabs>
      </div>

      {actionable && (
        <div className="ap-footer-bar">
          {btnTransfer.enabled && (
            <Button theme="light" onClick={() => void openAction('transfer')}>{btnTransfer.displayName ?? '转办'}</Button>
          )}
          {btnReject.enabled && (
            <Button theme="light" type="danger" onClick={() => void openAction('reject')}>{btnReject.displayName ?? '拒绝'}</Button>
          )}
          {btnApprove.enabled && (
            <Button theme="solid" type="primary" onClick={() => void openAction('approve')}>{btnApprove.displayName ?? '同意'}</Button>
          )}
        </div>
      )}

      <Modal
        title={action === 'approve' ? (btnApprove.displayName ?? '同意') : action === 'reject' ? (btnReject.displayName ?? '拒绝') : (btnTransfer.displayName ?? '转办')}
        visible={action != null}
        onCancel={() => setAction(null)}
        onOk={() => void submitAction()}
        okButtonProps={{ loading: actionMutation.isPending }}
        closeOnEsc
        style={{ maxWidth: 'calc(100vw - 32px)' }}
      >
        <Form getFormApi={(api) => { actionFormApi.current = api; }}>
          {action === 'transfer' && (
            <Form.Select
              field="targetUserId"
              label="转办给"
              placeholder="选择接收人"
              filter
              loading={usersLoading}
              optionList={userOptions}
              rules={[{ required: true, message: '请选择接收人' }]}
              style={{ width: '100%' }}
            />
          )}
          <Form.TextArea
            field="comment"
            label={action === 'approve' ? (btnApprove.opinionName ?? '审批意见') : action === 'reject' ? (btnReject.opinionName ?? '拒绝原因') : (btnTransfer.opinionName ?? '转办说明')}
            rows={3}
            placeholder={action === 'reject' || (action === 'approve' && opinionRequired) ? '必填' : '选填'}
            rules={action === 'reject' || (action === 'approve' && opinionRequired)
              ? [{ required: true, message: '请填写意见' }]
              : undefined}
          />
        </Form>
        {action === 'approve' && needSignature && (
          <div style={{ marginTop: 8 }}>
            <Typography.Text type="secondary" size="small">手写签名（必填）</Typography.Text>
            <div style={{ border: '1px solid var(--semi-color-border)', borderRadius: 6, marginTop: 6, overflow: 'hidden' }}>
              <SignaturePad value={signature} onChange={setSignature} width={window.innerWidth > 480 ? 400 : window.innerWidth - 96} height={140} />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
