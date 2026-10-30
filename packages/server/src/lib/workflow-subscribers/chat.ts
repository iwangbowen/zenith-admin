/**
 * 工作流事件 → 聊天卡片订阅器
 *
 * - task.created（pending 审批）→ 给处理人推送审批卡片（含「同意/驳回」按钮）
 * - task.approved / task.rejected → 将对应审批卡片标记为已处理（置灰）
 * - instance.approved/rejected/withdrawn → 给发起人推送结果卡片
 *
 * 卡片经「系统机器人 → 用户单聊」投递（notifyUserWithCard），按钮在前端调用
 * 审批任务的通过 / 驳回操作（`workflowTaskContract.approve` / `reject`）。
 */
import type { DbTransaction } from '../../db/types';
import type { OutboxEventRow } from '../../db/schema/event-outbox';
import type { ChatCard } from '@zenith/shared/chat';
import type { SemanticStatus } from '@zenith/shared/core';
import { getNotificationEvent } from '@zenith/shared/messaging';
import { registerWorkflowEventConsumer } from '../workflow-event-consumer';
import {
  getSystemChannelIdWithin, publishTargetedWithin, markChannelTaskCardsDoneWithin,
} from '../../services/messaging/channel.service';

export function registerChatWorkflowSubscriber(): void {
  // 待办审批 → 审批卡片
  registerWorkflowEventConsumer('workflow.chat', ['task.created'], async (tx, event, fact) => {
    const task = event.task;
    if (!task.assigneeId || task.nodeType === 'ccNode' || task.status !== 'pending') return;

      const channelId = await getSystemChannelIdWithin(tx);
      if (!channelId) return;
      const label = String(fact.scope.label);
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
        semanticStatus: getNotificationEvent('workflow.task.created').inAppType,
        instanceId: event.instanceId,
      };
      await publishTargetedWithin(tx, channelId, [task.assigneeId], {
        type: 'card', content: card.title, extra: { card },
        dedupeKey: `workflow-event:${event.eventId}:chat`,
      });
  });

  // 审批完成 → 置灰卡片
  const resolveCard = (semanticStatus: SemanticStatus) => async (tx: DbTransaction, event: { task: { id: number } }) => {

      await markChannelTaskCardsDoneWithin(tx, event.task.id, semanticStatus);
  };
  registerWorkflowEventConsumer('workflow.chat', ['task.approved'], resolveCard('agreed'));
  registerWorkflowEventConsumer('workflow.chat', ['task.rejected'], resolveCard('declined'));
  registerWorkflowEventConsumer('workflow.chat', ['task.skipped'], resolveCard('skipped'));
  registerWorkflowEventConsumer('workflow.chat', ['task.transferred'], resolveCard('transferred'));

  // 流程结束 → 通知发起人
  const notifyInitiator = (kind: 'approved' | 'rejected' | 'withdrawn' | 'returned') => async (
    tx: DbTransaction, event: { eventId: string; instanceId: number; instance: { initiatorId: number; title: string; serialNo?: string | null } }, fact: OutboxEventRow,
  ) => {
    const inst = event.instance;
    if (fact.scope.notifyInitiator === false) return;
    const label = inst.serialNo ? `${inst.title}（${inst.serialNo}）` : inst.title;
    const map = {
      approved: { title: '审批通过', text: `你发起的流程「${label}」已审批通过` },
      rejected: { title: '审批被驳回', text: `你发起的流程「${label}」已被驳回` },
      withdrawn: { title: '流程已撤回', text: `你发起的流程「${label}」已撤回` },
      returned: { title: '申请被退回', text: `你发起的流程「${label}」已被退回，请修改后重新提交` },
    };
    const m = map[kind];

      const channelId = await getSystemChannelIdWithin(tx);
      if (!channelId) return;
      const card: ChatCard = {
        title: m.title,
        text: m.text,
        source: '工作流',
        status: 'done',
        semanticStatus: getNotificationEvent(`workflow.instance.${kind}`).inAppType,
        instanceId: event.instanceId,
      };
      await publishTargetedWithin(tx, channelId, [inst.initiatorId], {
        type: 'card', content: card.title, extra: { card },
        dedupeKey: `workflow-event:${event.eventId}:chat`,
      });
  };
  registerWorkflowEventConsumer('workflow.chat', ['instance.approved'], notifyInitiator('approved'));
  registerWorkflowEventConsumer('workflow.chat', ['instance.rejected'], notifyInitiator('rejected'));
  registerWorkflowEventConsumer('workflow.chat', ['instance.withdrawn'], notifyInitiator('withdrawn'));
  registerWorkflowEventConsumer('workflow.chat', ['instance.returned'], notifyInitiator('returned'));
}
