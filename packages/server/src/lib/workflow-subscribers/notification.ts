/**
 * 工作流事件 → 通知中心
 *
 * 流程高级设置里的 `notifyChannels` 是**管理员配置层**：它决定邮件 / 短信渠道
 * 是否对这条流程开放；开放之后再由收件人偏好决定要不要真的收。两层叠加的顺序
 * 在派发器里统一处理，这里只负责把流程事件翻译成通知事件。
 *
 * - task.created（pending 审批任务）→ 通知处理人
 * - task.created（ccNode 抄送任务）  → 通知抄送人（抄送不外发邮件/短信）
 * - task.urged                       → 通知处理人
 * - task.transferred                 → 通知新处理人
 * - instance.approved/rejected/withdrawn/returned → 通知发起人
 *
 * 站内信走 `notify()` 统一派发，幂等与派发留痕自动具备（不直写 in_app_messages）。
 */
import type {
  NotificationChannelOptions,
  NotificationChannelPolicy,
} from '@zenith/shared/messaging';
import type { WorkflowNotifyChannels } from '@zenith/shared/workflow';
import type { DbTransaction } from '../../db/types';
import type { OutboxEventRow } from '../../db/schema/event-outbox';
import { escapeHtml } from '@zenith/shared/core';
import { notifyWithin } from '../../services/messaging/notification-outbox.service';
import { registerWorkflowEventConsumer } from '../workflow-event-consumer';

interface NotifyContext {
  label: string;
  channels: WorkflowNotifyChannels | undefined;
  notifyInitiator: boolean;
}

function loadNotifyContext(fact: OutboxEventRow): NotifyContext {
  return { label: String(fact.scope.label), channels: fact.scope.notifyChannels as WorkflowNotifyChannels | undefined,
    notifyInitiator: fact.scope.notifyInitiator !== false };
}

/** 待办处理深链（待我审批页自动弹出对应详情） */
const pendingLink = (instanceId: number, taskId: number) => `/workflow/pending?instanceId=${instanceId}&taskId=${taskId}`;
/** 实例查看深链（我的申请页自动弹出详情，参与人均可查看） */
const instanceLink = (instanceId: number) => `/workflow/applications?instanceId=${instanceId}`;

/** 流程设置里开启的外发渠道；未开启时返回 null，收件人也就无从打开它们。 */
function toChannelPolicy(channels: WorkflowNotifyChannels | undefined): NotificationChannelPolicy | null {
  if (!channels) return null;
  const enable: Array<'email' | 'sms'> = [];
  if (channels.email) enable.push('email');
  // 没有配模板的短信开关等于没开：发不出去还不如不出现在候选渠道里
  if (channels.sms && channels.smsTemplateId) enable.push('sms');
  return enable.length > 0 ? { enable } : null;
}

function toChannelOptions(
  channels: WorkflowNotifyChannels | undefined,
  subject: string,
  text: string,
  smsVariables: Record<string, string>,
): NotificationChannelOptions {
  // 流程标题是发起人自由填写的文本，进 HTML 前必须转义，否则可向审批人邮箱注入任意标签
  const options: NotificationChannelOptions = { email: { subject, html: `<p>${escapeHtml(text)}</p>` } };
  if (channels?.sms && channels.smsTemplateId) {
    // 显式传短信变量：服务商按位置映射参数，依赖事件 vars 会被 jsonb 键序重排打乱
    options.sms = { templateId: channels.smsTemplateId, variables: smsVariables };
  }
  return options;
}

export function registerNotificationWorkflowSubscriber(): void {
  registerWorkflowEventConsumer('workflow.notification', ['task.created'], async (tx, event, fact) => {
    const task = event.task;
    if (!task.assigneeId) return;
    const isCc = task.nodeType === 'ccNode';
    if (!isCc && task.status !== 'pending') return;

      const { label, channels } = loadNotifyContext(fact);
      const vars = { instanceId: event.instanceId, taskId: task.id, title: label, node: task.nodeName };
      if (isCc) {
        // 抄送只走站内信：抄送人往往不需要处理，外发短信会变成骚扰
        await notifyWithin(tx, 'workflow.task.cc', {
          recipients: [{ type: 'user', id: task.assigneeId }],
          vars,
          tenantId: event.tenantId,
        subjectRefs: [{ type: 'workflow.instance', key: String(event.instanceId), role: 'primary' }],
          dedupeKey: `workflow-event:${event.eventId}`,
          link: `/workflow/cc?instanceId=${event.instanceId}`,
        });
        return;
      }
      await notifyWithin(tx, 'workflow.task.created', {
        recipients: [{ type: 'user', id: task.assigneeId }],
        vars,
        tenantId: event.tenantId,
        subjectRefs: [{ type: 'workflow.instance', key: String(event.instanceId), role: 'primary' }],
        dedupeKey: `workflow-event:${event.eventId}`,
        link: pendingLink(event.instanceId, task.id),
        channelPolicy: toChannelPolicy(channels),
        channelOptions: toChannelOptions(
          channels,
          `【待办提醒】${label}`,
          `你有一条新的待办：流程「${label}」（节点：${task.nodeName}），请及时处理。`,
          { title: label, node: task.nodeName },
        ),
      });
  });

  registerWorkflowEventConsumer('workflow.notification', ['task.urged'], async (tx, event, fact) => {
    const task = event.task;
    if (!task.assigneeId) return;

      const { label } = loadNotifyContext(fact);
      await notifyWithin(tx, 'workflow.task.urged', {
        recipients: [{ type: 'user', id: task.assigneeId }],
        vars: {
          instanceId: event.instanceId,
          taskId: task.id,
          title: label,
          node: task.nodeName,
          extra: event.comment ? `：${event.comment}` : '',
        },
        tenantId: event.tenantId,
        subjectRefs: [{ type: 'workflow.instance', key: String(event.instanceId), role: 'primary' }],
        dedupeKey: `workflow-event:${event.eventId}`,
        link: pendingLink(event.instanceId, task.id),
      });
  });

  registerWorkflowEventConsumer('workflow.notification', ['task.transferred'], async (tx, event, fact) => {
    const task = event.task;
    if (!task.assigneeId || task.status !== 'pending') return;

      const { label } = loadNotifyContext(fact);
      await notifyWithin(tx, 'workflow.task.transferred', {
        recipients: [{ type: 'user', id: task.assigneeId }],
        vars: { instanceId: event.instanceId, taskId: task.id, title: label, node: task.nodeName },
        tenantId: event.tenantId,
        subjectRefs: [{ type: 'workflow.instance', key: String(event.instanceId), role: 'primary' }],
        dedupeKey: `workflow-event:${event.eventId}`,
        link: pendingLink(event.instanceId, task.id),
      });
  });

  const INSTANCE_EVENTS = {
    approved: { key: 'workflow.instance.approved', status: '审批通过' },
    rejected: { key: 'workflow.instance.rejected', status: '审批被驳回' },
    withdrawn: { key: 'workflow.instance.withdrawn', status: '流程已撤回' },
    returned: { key: 'workflow.instance.returned', status: '申请被退回' },
  } as const;

  const notifyInitiator = (status: keyof typeof INSTANCE_EVENTS) => async (
    tx: DbTransaction, event: { eventId: string; instanceId: number; tenantId: number | null; instance: { initiatorId: number; title: string; serialNo?: string | null } }, fact: OutboxEventRow,
  ) => {
    const inst = event.instance;
    const label = inst.serialNo ? `${inst.title}（${inst.serialNo}）` : inst.title;
    const meta = INSTANCE_EVENTS[status];

      const { channels, notifyInitiator: shouldNotify } = loadNotifyContext(fact);
      if (!shouldNotify) return;
      const text = {
        approved: `你发起的流程「${label}」已审批通过`,
        rejected: `你发起的流程「${label}」已被驳回`,
        withdrawn: `你发起的流程「${label}」已撤回`,
        returned: `你发起的流程「${label}」已被退回，请修改后重新提交`,
      }[status];
      await notifyWithin(tx, meta.key, {
        recipients: [{ type: 'user', id: inst.initiatorId }],
        vars: { instanceId: event.instanceId, title: label, status: meta.status },
        tenantId: event.tenantId,
        subjectRefs: [{ type: 'workflow.instance', key: String(event.instanceId), role: 'primary' }],
        dedupeKey: `workflow-event:${event.eventId}`,
        link: instanceLink(event.instanceId),
        channelPolicy: toChannelPolicy(channels),
        channelOptions: toChannelOptions(channels, `【${meta.status}】${label}`, text, { title: label, status: meta.status }),
      });
  };

  registerWorkflowEventConsumer('workflow.notification', ['instance.approved'], notifyInitiator('approved'));
  registerWorkflowEventConsumer('workflow.notification', ['instance.rejected'], notifyInitiator('rejected'));
  registerWorkflowEventConsumer('workflow.notification', ['instance.withdrawn'], notifyInitiator('withdrawn'));
  registerWorkflowEventConsumer('workflow.notification', ['instance.returned'], notifyInitiator('returned'));
}
