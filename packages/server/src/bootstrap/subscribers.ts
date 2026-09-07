/**
 * 事件总线订阅者注册（工作流 / 支付 / CMS / 分析）。
 *
 * 从 src/index.ts 抽出。这些订阅者把领域事件接到 WS 推送、通知、聊天、账本、
 * 手续费、分账等下游——delay/trigger/external/webhook 已统一为 workflow_jobs 作业。
 */
import logger from '../lib/logger';
import { initNotificationAdapters } from '../lib/notification/adapters';
import { initPaymentAdapters } from '../lib/payment';
import { registerChatWorkflowSubscriber } from '../lib/workflow-subscribers/chat';
import { registerNodeListenersSubscriber } from '../lib/workflow-subscribers/node-listeners';
import { registerNotificationWorkflowSubscriber } from '../lib/workflow-subscribers/notification';
import { registerWsWorkflowSubscriber } from '../lib/workflow-subscribers/ws';
import { registerAnalyticsServerEventSubscribers } from '../services/analytics/analytics-server-event-subscribers';
import { registerBizLeaveSubscribers } from '../services/biz-demo/biz-leave-subscribers';
import { registerCmsWorkflowSubscribers } from '../services/cms/cms-workflow.service';
import { registerBizPayDemoSubscribers } from '../services/payment/biz-pay-demo-subscribers';
import { registerContractSubscribers } from '../services/payment/payment-contract.service';
import { registerCouponPaymentSubscribers } from '../services/payment/payment-coupon.service';
import { registerFeeSubscribers } from '../services/payment/payment-fee.service';
import { registerPaymentJournalSubscribers } from '../services/payment/payment-journal-subscribers.service';
import { registerSharingSubscribers } from '../services/payment/payment-sharing.service';
import { registerPaymentSubscribers } from '../services/payment/payment-subscribers';
import { registerPaymentOpenWebhookBridge } from '../services/payment/payment-open-webhook-bridge.service';
import { registerWorkflowAutomationSubscribers } from '../services/workflow/workflow-automations.service';
import { registerDriveOwnershipSubscriber } from '../services/drive/drive-handoff.service';

export function registerEventSubscribers(): void {
  initNotificationAdapters();
  registerWsWorkflowSubscriber();
  registerNodeListenersSubscriber();
  registerNotificationWorkflowSubscriber();
  registerChatWorkflowSubscriber();
  registerWorkflowAutomationSubscribers();
  initPaymentAdapters();
  registerPaymentSubscribers();
  registerContractSubscribers();
  registerCouponPaymentSubscribers();
  registerPaymentOpenWebhookBridge();
  registerBizLeaveSubscribers();
  registerBizPayDemoSubscribers();
  registerCmsWorkflowSubscribers(); // CMS 内容工作流审核（通过→发布+静态化，驳回/撤回→回写状态）
  registerPaymentJournalSubscribers();
  registerFeeSubscribers();
  registerSharingSubscribers();
  registerAnalyticsServerEventSubscribers();
  registerDriveOwnershipSubscriber();
  logger.info('Workflow event subscribers registered');
}
