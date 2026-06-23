/**
 * 工作流事件 → 聊天卡片订阅器
 *
 * - task.created（pending 审批）→ 给处理人推送审批卡片（含「同意/驳回」按钮）
 * - task.approved / task.rejected → 将对应审批卡片标记为已处理（置灰）
 * - instance.approved/rejected/withdrawn → 给发起人推送结果卡片
 *
 * 卡片经「系统机器人 → 用户单聊」投递（notifyUserWithCard），按钮在前端调用
 * 既有的 /api/workflows/tasks/{id}/approve|reject 接口。
 */
import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { workflowInstances } from '../../db/schema';
import type { ChatCard } from '@zenith/shared';
import { workflowEventBus } from '../workflow-event-bus';
import {
  getSystemBotUserId, ensureBotDirectConversation, postBotMessage, markTaskCardsDone,
} from '../../services/chat.service';
import logger from '../logger';

async function loadInstanceLabel(instanceId: number): Promise<string> {
  const [row] = await db
    .select({ title: workflowInstances.title, serialNo: workflowInstances.serialNo })
    .from(workflowInstances)
    .where(eq(workflowInstances.id, instanceId))
    .limit(1);
  if (!row) return `#${instanceId}`;
  return row.serialNo ? `${row.title}（${row.serialNo}）` : row.title;
}

export function registerChatWorkflowSubscriber(): void {
  // 待办审批 → 审批卡片
  workflowEventBus.on('task.created', async (event) => {
    const task = event.task;
    if (!task.assigneeId || task.nodeType === 'ccNode' || task.status !== 'pending') return;
    try {
      const botId = await getSystemBotUserId();
      if (!botId) return;
      const label = await loadInstanceLabel(event.instanceId);
      const card: ChatCard = {
        title: '待办审批提醒',
        text: `流程「${label}」需要你审批`,
        fields: [{ label: '审批节点', value: task.nodeName }],
        actions: [
          { key: 'approve', label: '同意', theme: 'primary', action: 'workflow:approve', taskId: task.id },
          { key: 'reject', label: '驳回', theme: 'danger', action: 'workflow:reject', taskId: task.id, requireComment: true },
        ],
        source: '工作流',
        status: 'pending',
      };
      const conversationId = await ensureBotDirectConversation(botId, task.assigneeId);
      await postBotMessage(conversationId, botId, { type: 'card', content: card.title, extra: { card } });
    } catch (err) {
      logger.error('[chat-workflow] 审批卡片推送失败', { err, taskId: task.id });
    }
  });

  // 审批完成 → 置灰卡片
  const resolveCard = (statusText: string) => async (event: { task: { id: number } }) => {
    try {
      await markTaskCardsDone(event.task.id, statusText);
    } catch (err) {
      logger.error('[chat-workflow] 卡片置灰失败', { err, taskId: event.task.id });
    }
  };
  workflowEventBus.on('task.approved', resolveCard('已同意'));
  workflowEventBus.on('task.rejected', resolveCard('已驳回'));
  workflowEventBus.on('task.skipped', resolveCard('已自动处理'));
  workflowEventBus.on('task.transferred', resolveCard('已转交'));

  // 流程结束 → 通知发起人
  const notifyInitiator = (kind: 'approved' | 'rejected' | 'withdrawn') => async (
    event: { instanceId: number; instance: { initiatorId: number; title: string; serialNo?: string | null } },
  ) => {
    const inst = event.instance;
    const [snapRow] = await db.select({ snapshot: workflowInstances.definitionSnapshot })
      .from(workflowInstances).where(eq(workflowInstances.id, event.instanceId)).limit(1);
    const notify = (snapRow?.snapshot as { flowData?: { settings?: { notifyInitiator?: boolean } } } | null)?.flowData?.settings?.notifyInitiator;
    if (notify === false) return;
    const label = inst.serialNo ? `${inst.title}（${inst.serialNo}）` : inst.title;
    const map = {
      approved: { title: '审批通过', text: `你发起的流程「${label}」已审批通过`, statusText: '已通过' },
      rejected: { title: '审批被驳回', text: `你发起的流程「${label}」已被驳回`, statusText: '已驳回' },
      withdrawn: { title: '流程已撤回', text: `你发起的流程「${label}」已撤回`, statusText: '已撤回' },
    };
    const m = map[kind];
    try {
      const botId = await getSystemBotUserId();
      if (!botId) return;
      const card: ChatCard = {
        title: m.title,
        text: m.text,
        source: '工作流',
        status: 'done',
        statusText: m.statusText,
      };
      const conversationId = await ensureBotDirectConversation(botId, inst.initiatorId);
      await postBotMessage(conversationId, botId, { type: 'card', content: card.title, extra: { card } });
    } catch (err) {
      logger.error('[chat-workflow] 结果卡片推送失败', { err, instanceId: event.instanceId });
    }
  };
  workflowEventBus.on('instance.approved', notifyInitiator('approved'));
  workflowEventBus.on('instance.rejected', notifyInitiator('rejected'));
  workflowEventBus.on('instance.withdrawn', notifyInitiator('withdrawn'));
}
