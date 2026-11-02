/**
 * 事件总线订阅者注册（工作流 / 支付 / CMS / 分析）。
 *
 * 这些订阅者把领域事件接到 WS 推送、通知、聊天、账本、手续费、分账等下游。
 * delay/trigger/external/webhook 由 workflow_jobs 作业处理。
 */
import logger from '../lib/logger';
import { registerQuotaNotificationConsumer } from '../services/open-platform/open-quota-alerts.service';
import { registerOpenEventConsumer } from '../services/open-platform/open-events.service';
import { registerWorkflowEventConsumers } from '../services/workflow/workflow-event-consumers';
import { registerIdentityEventConsumers } from '../services/identity/identity-event-consumers';
import { initNotificationAdapters } from '../lib/notification/adapters';
import { initPaymentAdapters } from '../lib/payment';
import { registerChatWorkflowSubscriber } from '../lib/workflow-subscribers/chat';
import { registerNodeListenersSubscriber } from '../lib/workflow-subscribers/node-listeners';
import { registerNotificationWorkflowSubscriber } from '../lib/workflow-subscribers/notification';
import { registerWsWorkflowSubscriber } from '../lib/workflow-subscribers/ws';
import { registerAnalyticsServerEventSubscribers } from '../services/analytics/analytics-server-event-subscribers';
import { registerBizLeaveSubscribers } from '../services/biz-demo/biz-leave-subscribers';
import { registerCmsWorkflowSubscribers } from '../services/cms/cms-workflow.service';
import { registerCmsFeedbackWorkflowSubscribers } from '../services/cms/cms-feedback-workflow.service';
import { registerReconAdjustmentSubscribers } from '../services/payment/payment-recon-adjustment.service';
import { registerPaymentEventConsumers } from '../services/payment/payment-event-consumers';
import { registerWorkflowPrintArchiveSubscriber } from '../services/workflow/workflow-print-archive';

export function registerEventSubscribers(): void {
  registerOpenEventConsumer();
  registerQuotaNotificationConsumer();
  registerPaymentEventConsumers();
  registerWorkflowEventConsumers();
  registerIdentityEventConsumers();
  initNotificationAdapters();
  registerWsWorkflowSubscriber();
  registerNodeListenersSubscriber();
  registerNotificationWorkflowSubscriber();
  registerChatWorkflowSubscriber();
  registerWorkflowPrintArchiveSubscriber(); // 流程终态 → 投递审批单归档件生成作业
  initPaymentAdapters();
  registerBizLeaveSubscribers();
  registerCmsWorkflowSubscribers(); // CMS 内容工作流审核（通过→发布+静态化，驳回/撤回→回写状态）
  registerCmsFeedbackWorkflowSubscribers();
  registerReconAdjustmentSubscribers();
  registerAnalyticsServerEventSubscribers();
  logger.info('Workflow event subscribers registered');
}
