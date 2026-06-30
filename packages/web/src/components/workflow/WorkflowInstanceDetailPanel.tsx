/**
 * 通用流程实例详情面板
 * 在 MyApplications / WorkflowMonitor / PendingApprovals 中复用
 */
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import {
  Descriptions, Empty, Spin, Tabs, TabPane, Tag, Typography, Button,
  Avatar, TextArea, Select, Toast, Popconfirm,
} from '@douyinfe/semi-ui';
import { CornerUpLeft, Send, Undo2 } from 'lucide-react';
import type { WorkflowDefinition, WorkflowInstance, WorkflowComment, WorkflowTaskConsult } from '@zenith/shared';
import { request } from '@/utils/request';
import { useAuth } from '@/hooks/useAuth';
import { formatDateTime } from '@/utils/date';
import ApprovalTimeline from '@/components/ApprovalTimeline';
import WorkflowFormRenderer from '@/pages/workflow/designer/components/WorkflowFormRenderer';
import BusinessFormHost from '@/components/workflow/BusinessFormHost';
import WorkflowGraphView from './WorkflowGraphView';
import WorkflowProcessLayout from './WorkflowProcessLayout';
import { linearizeApprovalNodes } from './workflow-runtime';
import {
  resolveWorkflowCustomForm,
  resolveWorkflowDetailDefinition,
  resolveWorkflowFlowData,
  resolveWorkflowFormFields,
  resolveWorkflowFormSettings,
  resolveWorkflowFormType,
} from '@/utils/workflow-snapshot';

type TagColor = 'amber' | 'blue' | 'cyan' | 'green' | 'grey' | 'orange' | 'purple' | 'red';

const INSTANCE_STATUS_MAP: Record<string, { text: string; color: TagColor }> = {
  draft: { text: '草稿', color: 'grey' },
  running: { text: '审批中', color: 'blue' },
  approved: { text: '已通过', color: 'green' },
  rejected: { text: '已驳回', color: 'red' },
  withdrawn: { text: '已撤回', color: 'orange' },
  cancelled: { text: '已取消', color: 'purple' },
};

interface Props {
  instance: WorkflowInstance | null;
  definition?: WorkflowDefinition | null;
  loading?: boolean;
  extraActions?: ReactNode;
  /** 跳转到关联的父 / 子流程实例详情 */
  onOpenInstance?: (id: number) => void;
  /** 撤回已办成功后的回调（刷新详情） */
  onRecalled?: () => void;
}

/** 流程沟通时间线（自由评论 + @提及），自管理状态与请求 */
function InstanceComments({ instance }: Readonly<{ instance: WorkflowInstance }>) {
  const [comments, setComments] = useState<WorkflowComment[]>(instance.comments ?? []);
  const [content, setContent] = useState('');
  const [mentions, setMentions] = useState<number[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { setComments(instance.comments ?? []); }, [instance.id, instance.comments]);

  // @提及候选：发起人 + 各任务处理人（去重）
  const mentionOptions = (() => {
    const map = new Map<number, string>();
    if (instance.initiatorId) map.set(instance.initiatorId, instance.initiatorName ?? `用户#${instance.initiatorId}`);
    for (const t of instance.tasks ?? []) {
      if (t.assigneeId) map.set(t.assigneeId, t.assigneeName ?? `用户#${t.assigneeId}`);
    }
    return [...map.entries()].map(([value, label]) => ({ value, label }));
  })();

  const submit = async () => {
    const text = content.trim();
    if (!text) { Toast.warning('请输入评论内容'); return; }
    setSubmitting(true);
    try {
      const res = await request.post<WorkflowComment>(`/api/workflows/instances/${instance.id}/comments`, { content: text, mentions });
      if (res.code === 0 && res.data) {
        setComments((prev) => [...prev, res.data as WorkflowComment]);
        setContent('');
        setMentions([]);
      } else {
        Toast.error(res.message || '评论失败');
      }
    } catch {
      Toast.error('评论失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {comments.length === 0 ? (
        <Empty title="暂无沟通记录" style={{ padding: '24px 0' }} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {comments.map((c) => (
            <div key={c.id} style={{ display: 'flex', gap: 8 }}>
              <Avatar size="small" src={c.userAvatar ?? undefined} style={{ flexShrink: 0 }}>
                {(c.userName ?? 'U').slice(0, 1)}
              </Avatar>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Typography.Text strong>{c.userName ?? `用户#${c.userId}`}</Typography.Text>
                  <Typography.Text type="tertiary" size="small">{formatDateTime(c.createdAt)}</Typography.Text>
                </div>
                <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginTop: 2 }}>{c.content}</div>
                {c.mentionNames && c.mentionNames.length > 0 && (
                  <div style={{ marginTop: 4, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {c.mentionNames.map((n) => <Tag key={n} size="small" color="light-blue">@{n}</Tag>)}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {instance.allowComment === false ? (
        <div style={{ borderTop: '1px solid var(--semi-color-border)', paddingTop: 12, color: 'var(--semi-color-text-2)', fontSize: 13 }}>
          该流程已关闭评论
        </div>
      ) : (
        <div style={{ borderTop: '1px solid var(--semi-color-border)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <TextArea
            value={content}
            onChange={setContent}
            placeholder="发表评论，与流程相关人员沟通…"
            autosize={{ minRows: 2, maxRows: 5 }}
            maxCount={2000}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
            <Select
              multiple
              filter
              placeholder="提醒谁（@提及）"
              value={mentions}
              onChange={(v) => setMentions((v as number[]) ?? [])}
              optionList={mentionOptions}
              maxTagCount={3}
              style={{ flex: 1, minWidth: 0 }}
              showClear
            />
            <Button theme="solid" type="primary" icon={<Send size={14} />} loading={submitting} onClick={submit}>
              发送
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function WorkflowInstanceDetailPanel({
  instance, definition, loading, extraActions, onOpenInstance, onRecalled,
}: Readonly<Props>) {
  const { user } = useAuth();
  if (loading) {
    return <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>;
  }
  if (!instance) {
    return <Empty title="暂无数据" />;
  }
  const statusInfo = INSTANCE_STATUS_MAP[instance.status];
  // 撤回已办：当前用户在运行中实例上最近一次已通过/驳回的任务
  const myRecallableTask = instance.status === 'running' && user
    ? [...(instance.tasks ?? [])].reverse().find((t) => t.assigneeId === user.id && (t.status === 'approved' || t.status === 'rejected'))
    : null;
  const handleRecall = async () => {
    if (!myRecallableTask) return;
    try {
      const res = await request.post(`/api/workflows/tasks/${myRecallableTask.id}/recall`, {});
      if (res.code === 0) { Toast.success('已撤回'); onRecalled?.(); }
      else Toast.error(res.message || '撤回失败');
    } catch { Toast.error('撤回失败'); }
  };
  const consults = instance.consults ?? [];
  const effectiveDefinition = resolveWorkflowDetailDefinition(instance, definition);
  // 历史实例渲染冻结快照（发起时绑定），不受表单后续修改影响；无快照时回退到当前表单
  const formFields = resolveWorkflowFormFields(instance, effectiveDefinition);
  const formSettings = resolveWorkflowFormSettings(instance, effectiveDefinition);
  const formType = resolveWorkflowFormType(instance, effectiveDefinition);
  const customForm = resolveWorkflowCustomForm(instance, effectiveDefinition);
  const hasFormFields = formFields.length > 0;
  const flowData = (resolveWorkflowFlowData(instance, effectiveDefinition) ?? null) as { process?: import('@/pages/workflow/designer/types').FlowProcess } | null;
  const childInstances = instance.childInstances ?? [];
  const activeNodeNames = (instance.currentNodeNames && instance.currentNodeNames.length > 0)
    ? instance.currentNodeNames
    : (instance.currentNodeName ? [instance.currentNodeName] : []);

  const renderFormData = () => {
    // 自定义业务表单（custom）/ 业务系统主导（external）：渲染业务页面（view 只读）
    if (formType === 'custom' || formType === 'external') {
      return (
        <BusinessFormHost
          customForm={customForm}
          mode="view"
          container="sheet"
          definitionId={instance.definitionId}
          instanceId={instance.id}
          value={(instance.formData as Record<string, unknown>) ?? {}}
          bizType={instance.bizType ?? null}
          bizId={instance.bizId ?? null}
          readOnly
        />
      );
    }
    if (hasFormFields) {
      return (
        <WorkflowFormRenderer
          fields={formFields}
          initValues={(instance.formData as Record<string, unknown>) ?? {}}
          readOnly
          labelPosition={formSettings?.labelPosition}
          labelAlign={formSettings?.labelAlign}
          labelWidth={formSettings?.labelWidth}
        />
      );
    }
    const formatValue = (v: unknown): string => {
      if (v === null || v === undefined) return '';
      if (typeof v === 'object') return JSON.stringify(v);
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
      return JSON.stringify(v);
    };
    if (instance.formData && Object.keys(instance.formData).length > 0) {
      return (
        <Descriptions
          data={Object.entries(instance.formData).map(([k, v]) => ({ key: k, value: formatValue(v) }))}
        />
      );
    }
    return <Empty title="无表单数据" />;
  };

  const header = (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
        <Typography.Title heading={5} style={{ margin: 0, lineHeight: 1.4, flex: 1, minWidth: 0 }}>
          {instance.title}
        </Typography.Title>
        <div style={{ flexShrink: 0, marginTop: 2 }}>
          {statusInfo
            ? <Tag color={statusInfo.color}>{statusInfo.text}</Tag>
            : <span style={{ fontSize: 13 }}>{instance.status}</span>}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--semi-color-text-2)', flexWrap: 'wrap' }}>
        {instance.serialNo && (
          <>
            <Tag size="small" color="grey" style={{ cursor: 'default' }}>{instance.serialNo}</Tag>
            <span>·</span>
          </>
        )}
        <span>{instance.definitionName ?? '—'}</span>
        {effectiveDefinition?.categoryName && (
          <>
            <span>·</span>
            <Tag size="small" color="blue" style={{ cursor: 'default' }}>{effectiveDefinition.categoryName}</Tag>
          </>
        )}
        <span>·</span>
        <span>{instance.initiatorName ?? '—'}</span>
        <span>·</span>
        <span>{formatDateTime(instance.createdAt)}</span>
        {activeNodeNames.length > 0 && (
          <>
            <span>·</span>
            <span>当前节点</span>
            {activeNodeNames.map((name) => <Tag key={name} size="small" color="cyan" style={{ cursor: 'default' }}>{name}</Tag>)}
          </>
        )}
      </div>
      {(instance.parentInstanceId || extraActions || myRecallableTask) ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          {instance.parentInstanceId ? (
            <Button
              theme="borderless"
              size="small"
              icon={<CornerUpLeft size={14} />}
              disabled={!onOpenInstance}
              onClick={() => onOpenInstance?.(instance.parentInstanceId as number)}
            >
              来自父流程实例 #{instance.parentInstanceId}
            </Button>
          ) : null}
          {extraActions}
          {myRecallableTask ? (
            <Popconfirm title="撤回我刚做的处理？" content="后续节点已处理时无法撤回。" onConfirm={() => void handleRecall()}>
              <Button theme="borderless" size="small" type="warning" icon={<Undo2 size={14} />}>撤回我的处理</Button>
            </Popconfirm>
          ) : null}
        </div>
      ) : null}
    </>
  );

  const chainContent = (
    <ApprovalTimeline
      tasks={instance.tasks ?? []}
      flowNodes={linearizeApprovalNodes(flowData)}
      initiator={{ name: instance.initiatorName, avatar: instance.initiatorAvatar, submittedAt: instance.createdAt }}
      instanceStatus={instance.status}
      finishedAt={instance.updatedAt}
    />
  );

  const graphContent = (
    <WorkflowGraphView flowData={flowData} tasks={instance.tasks ?? []} instanceStatus={instance.status} />
  );

  return (
    <WorkflowProcessLayout
      persistKey="workflow-detail"
      header={header}
      chain={chainContent}
      graph={graphContent}
      left={(
        <Tabs type="line">
        <TabPane tab="表单" itemKey="form">
          {renderFormData()}
          {effectiveDefinition?.description ? (
            <div style={{ marginTop: 16, color: 'var(--semi-color-text-2)', fontSize: 13 }}>
              <Typography.Text type="tertiary">流程说明：{effectiveDefinition.description}</Typography.Text>
            </div>
          ) : null}
        </TabPane>
        <TabPane tab={`沟通${instance.comments && instance.comments.length > 0 ? ` (${instance.comments.length})` : ''}`} itemKey="comments">
          <InstanceComments key={instance.id} instance={instance} />
        </TabPane>
        {consults.length > 0 && (
          <TabPane tab={`协办 (${consults.length})`} itemKey="consults">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {consults.map((c: WorkflowTaskConsult) => (
                <div key={c.id} style={{ border: '1px solid var(--semi-color-border)', borderRadius: 6, padding: '8px 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <Typography.Text strong>{c.inviterName ?? `用户#${c.inviterId}`}</Typography.Text>
                    <Typography.Text type="tertiary" size="small">邀请</Typography.Text>
                    <Typography.Text strong>{c.consulteeName ?? `用户#${c.consulteeId}`}</Typography.Text>
                    <Typography.Text type="tertiary" size="small">协办</Typography.Text>
                    {c.nodeName && <Tag size="small" color="grey">{c.nodeName}</Tag>}
                    {c.status === 'pending'
                      ? <Tag size="small" color="amber">待回复</Tag>
                      : <Tag size="small" color="green">已回复</Tag>}
                  </div>
                  {c.question && <div style={{ marginTop: 4, color: 'var(--semi-color-text-2)' }}>问题：{c.question}</div>}
                  {c.opinion && <div style={{ marginTop: 4 }}>意见：{c.opinion}</div>}
                </div>
              ))}
            </div>
          </TabPane>
        )}
        {childInstances.length > 0 && (
          <TabPane tab={`子流程 (${childInstances.length})`} itemKey="children">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {childInstances.map((c) => {
                const ci = INSTANCE_STATUS_MAP[c.status];
                return (
                  <div
                    key={c.id}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                      padding: '8px 12px', border: '1px solid var(--semi-color-border)', borderRadius: 6,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      {ci ? <Tag color={ci.color} size="small">{ci.text}</Tag> : <Tag size="small">{c.status}</Tag>}
                      <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 320 }}>{c.title}</Typography.Text>
                      <Typography.Text type="tertiary" size="small">#{c.id} · {formatDateTime(c.createdAt)}</Typography.Text>
                    </div>
                    <Button
                      theme="borderless"
                      size="small"
                      disabled={!onOpenInstance}
                      onClick={() => onOpenInstance?.(c.id)}
                    >
                      查看
                    </Button>
                  </div>
                );
              })}
            </div>
          </TabPane>
        )}
        </Tabs>
      )}
    />
  );
}
