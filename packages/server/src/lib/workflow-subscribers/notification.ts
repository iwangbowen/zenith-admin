/**
 * 工作流事件 → 多渠道通知订阅者
 *
 * 站内信始终落库（in_app_messages）；当流程的高级设置开启 email/sms 渠道时，
 * 额外向处理人/发起人发送邮件 / 短信（均通过上下文无关的底层 transport，
 * 因事件订阅者运行在请求上下文之外）。
 * - task.created（pending 审批任务）→ 通知处理人（站内信 + 邮件/短信）
 * - task.created（ccNode 抄送任务）  → 通知抄送人（站内信）
 * - task.urged                       → 通知处理人（站内信）
 * - task.transferred                 → 通知新处理人（站内信）
 * - instance.approved/rejected/withdrawn → 通知发起人（站内信 + 邮件/短信）
 */
import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { inAppMessages, workflowInstances, users, smsTemplates } from '../../db/schema';
import type { InAppMessageType, WorkflowNotifyChannels } from '@zenith/shared';
import { workflowEventBus } from '../workflow-event-bus';
import { sendMail } from '../email';
import { sendSmsByProvider, renderTemplate } from '../sms-sender';
import { findDefaultSmsConfig } from '../../services/messaging/sms-configs.service';
import logger from '../logger';

interface NotifyContext {
  label: string;
  channels: WorkflowNotifyChannels | undefined;
  notifyInitiator: boolean;
}

async function loadNotifyContext(instanceId: number): Promise<NotifyContext> {
  const [row] = await db
    .select({ title: workflowInstances.title, serialNo: workflowInstances.serialNo, snapshot: workflowInstances.definitionSnapshot })
    .from(workflowInstances)
    .where(eq(workflowInstances.id, instanceId))
    .limit(1);
  if (!row) return { label: `#${instanceId}`, channels: undefined, notifyInitiator: true };
  const label = row.serialNo ? `${row.title}（${row.serialNo}）` : row.title;
  const settings = row.snapshot?.flowData?.settings;
  return { label, channels: settings?.notifyChannels, notifyInitiator: settings?.notifyInitiator !== false };
}

async function insertMessage(input: {
  userId: number;
  title: string;
  content: string;
  type: InAppMessageType;
  tenantId: number | null;
  /** 深链地址（站内路由，点击消息跳转到对应审批页） */
  link?: string | null;
}): Promise<void> {
  try {
    await db.insert(inAppMessages).values({
      userId: input.userId,
      title: input.title,
      content: input.content,
      type: input.type,
      source: 'system',
      tenantId: input.tenantId,
      link: input.link ?? null,
    });
  } catch (err) {
    logger.error('[workflow notification] in-app insert failed', { err, userId: input.userId });
  }
}

/** 待办处理深链（待我审批页自动弹出对应详情） */
const pendingLink = (instanceId: number, taskId: number) => `/workflow/pending?instanceId=${instanceId}&taskId=${taskId}`;
/** 实例查看深链（我的申请页自动弹出详情，参与人均可查看） */
const instanceLink = (instanceId: number) => `/workflow/applications?instanceId=${instanceId}`;

/** 通过邮件/短信渠道通知用户（上下文无关，失败仅记录日志） */
async function notifyExternalChannels(
  userId: number,
  channels: WorkflowNotifyChannels | undefined,
  subject: string,
  text: string,
  smsVariables: Record<string, string>,
): Promise<void> {
  if (!channels || (!channels.email && !channels.sms)) return;
  const [user] = await db
    .select({ email: users.email, phone: users.phone })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return;

  if (channels.email && user.email) {
    try {
      await sendMail(user.email, subject, `<p>${text}</p>`);
    } catch (err) {
      logger.error('[workflow notification] email failed', { err, userId });
    }
  }

  if (channels.sms && channels.smsTemplateId && user.phone) {
    try {
      const config = await findDefaultSmsConfig();
      if (!config) { logger.warn('[workflow notification] sms skipped: no default config'); return; }
      const [tpl] = await db.select().from(smsTemplates).where(eq(smsTemplates.id, channels.smsTemplateId)).limit(1);
      if (!tpl || tpl.status !== 'enabled') { logger.warn('[workflow notification] sms skipped: template missing/disabled'); return; }
      if (config.provider !== tpl.provider) { logger.warn('[workflow notification] sms skipped: provider mismatch'); return; }
      const renderedContent = renderTemplate(tpl.content, smsVariables);
      await sendSmsByProvider({ config, template: tpl, phone: user.phone, variables: smsVariables, renderedContent });
    } catch (err) {
      logger.error('[workflow notification] sms failed', { err, userId });
    }
  }
}

export function registerNotificationWorkflowSubscriber(): void {
  workflowEventBus.on('task.created', async (event) => {
    const task = event.task;
    if (!task.assigneeId) return;
    const isCc = task.nodeType === 'ccNode';
    if (!isCc && task.status !== 'pending') return;
    const { label, channels } = await loadNotifyContext(event.instanceId);
    await insertMessage({
      userId: task.assigneeId,
      title: isCc ? '流程抄送通知' : '待办审批提醒',
      content: isCc
        ? `流程「${label}」抄送给你（节点：${task.nodeName}）`
        : `你有一条新的待办：流程「${label}」（节点：${task.nodeName}），请及时处理`,
      type: 'info',
      tenantId: event.tenantId,
      link: isCc ? `/workflow/cc?instanceId=${event.instanceId}` : pendingLink(event.instanceId, task.id),
    });
    if (!isCc) {
      await notifyExternalChannels(
        task.assigneeId,
        channels,
        `【待办提醒】${label}`,
        `你有一条新的待办：流程「${label}」（节点：${task.nodeName}），请及时处理。`,
        { title: label, node: task.nodeName },
      );
    }
  });

  workflowEventBus.on('task.urged', async (event) => {
    const task = event.task;
    if (!task.assigneeId) return;
    const { label } = await loadNotifyContext(event.instanceId);
    const extra = event.comment ? `：${event.comment}` : '';
    await insertMessage({
      userId: task.assigneeId,
      title: '催办提醒',
      content: `流程「${label}」（节点：${task.nodeName}）有人催办${extra}，请尽快处理`,
      type: 'warning',
      tenantId: event.tenantId,
      link: pendingLink(event.instanceId, task.id),
    });
  });

  workflowEventBus.on('task.transferred', async (event) => {
    const task = event.task;
    if (!task.assigneeId || task.status !== 'pending') return;
    const { label } = await loadNotifyContext(event.instanceId);
    await insertMessage({
      userId: task.assigneeId,
      title: '待办转交提醒',
      content: `流程「${label}」（节点：${task.nodeName}）的审批任务已转交给你，请及时处理`,
      type: 'info',
      tenantId: event.tenantId,
      link: pendingLink(event.instanceId, task.id),
    });
  });

  const notifyInitiator = (status: 'approved' | 'rejected' | 'withdrawn') => async (
    event: { instanceId: number; tenantId: number | null; instance: { initiatorId: number; title: string; serialNo?: string | null } },
  ) => {
    const inst = event.instance;
    const label = inst.serialNo ? `${inst.title}（${inst.serialNo}）` : inst.title;
    const map = {
      approved: { title: '审批通过', content: `你发起的流程「${label}」已审批通过`, type: 'success' as const },
      rejected: { title: '审批被驳回', content: `你发起的流程「${label}」已被驳回`, type: 'warning' as const },
      withdrawn: { title: '流程已撤回', content: `你发起的流程「${label}」已撤回`, type: 'info' as const },
    };
    const m = map[status];
    const { channels, notifyInitiator: shouldNotify } = await loadNotifyContext(event.instanceId);
    if (!shouldNotify) return;
    await insertMessage({ userId: inst.initiatorId, title: m.title, content: m.content, type: m.type, tenantId: event.tenantId, link: instanceLink(event.instanceId) });
    await notifyExternalChannels(inst.initiatorId, channels, `【${m.title}】${label}`, m.content, { title: label, status: m.title });
  };

  workflowEventBus.on('instance.approved', notifyInitiator('approved'));
  workflowEventBus.on('instance.rejected', notifyInitiator('rejected'));
  workflowEventBus.on('instance.withdrawn', notifyInitiator('withdrawn'));
}
