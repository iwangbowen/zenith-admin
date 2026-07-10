import { mapAsyncTask, registerTaskHandler, submitAsyncTask } from '../../lib/task-center';
import { ensureAlertExists, runAlertTask } from './report-alert.service';
import { ensureSubscriptionExists, runSubscriptionTask } from './report-subscription.service';

const SUBSCRIPTION_TASK_TYPE = 'report-subscription-deliver';
const ALERT_TASK_TYPE = 'report-alert-evaluate';

export function registerReportDeliveryTaskHandlers(): void {
  registerTaskHandler({
    taskType: SUBSCRIPTION_TASK_TYPE,
    title: '推送报表订阅',
    module: '报表中心',
    description: '异步推送报表订阅，支持幂等、进度、取消和自动重试。',
    allowConcurrent: false,
    maxAttempts: 3,
    retryDelayMs: 5000,
    async run(ctx) {
      const subscriptionId = Number(ctx.payload.subscriptionId);
      await ctx.progress({ total: 3, processed: 0, note: '开始校验订阅配置', checkpoint: { stage: 'validate' } });
      if ((await ctx.isCancelRequested())) return { cancelled: true, message: '任务已取消' };
      const row = await runSubscriptionTask(subscriptionId, {
        taskId: ctx.taskId,
        attempt: ctx.attempt,
        maxAttempts: 3,
        isCancelRequested: ctx.isCancelRequested,
      });
      await ctx.progress({ total: 3, processed: 3, note: row.message, checkpoint: { stage: 'done', runId: row.runId, status: row.status } });
      return row;
    },
  });

  registerTaskHandler({
    taskType: ALERT_TASK_TYPE,
    title: '评估报表预警',
    module: '报表中心',
    description: '异步评估并可靠投递报表预警，支持幂等、进度、取消和自动重试。',
    allowConcurrent: false,
    maxAttempts: 3,
    retryDelayMs: 5000,
    async run(ctx) {
      const alertRuleId = Number(ctx.payload.alertRuleId);
      await ctx.progress({ total: 3, processed: 0, note: '开始校验预警规则', checkpoint: { stage: 'validate' } });
      if ((await ctx.isCancelRequested())) return { cancelled: true, message: '任务已取消' };
      const result = await runAlertTask(alertRuleId, {
        taskId: ctx.taskId,
        attempt: ctx.attempt,
        maxAttempts: 3,
        isCancelRequested: ctx.isCancelRequested,
      });
      await ctx.progress({
        total: 3,
        processed: 3,
        note: result.triggered ? '预警评估完成' : '预警评估完成，当前未触发',
        checkpoint: { stage: 'done', deliveryRunId: result.deliveryRunId, status: result.status, triggered: result.triggered },
      });
      return {
        value: result.value,
        triggered: result.triggered,
        hits: result.hits ?? null,
        status: result.status,
        deliveryRunId: result.deliveryRunId ?? null,
      };
    },
  });
}

export async function submitSubscriptionDeliveryTask(subscriptionId: number) {
  const row = await ensureSubscriptionExists(subscriptionId);
  return mapAsyncTask(await submitAsyncTask({
    taskType: SUBSCRIPTION_TASK_TYPE,
    title: `立即推送订阅 · #${row.id}`,
    payload: { subscriptionId },
    idempotencyKey: `${SUBSCRIPTION_TASK_TYPE}:${row.id}:${row.updatedAt.getTime()}:${row.lastRunAt?.getTime() ?? 0}:${row.lastDeliveryAt?.getTime() ?? 0}`,
  }));
}

export async function submitAlertEvaluateTask(alertRuleId: number) {
  const row = await ensureAlertExists(alertRuleId);
  return mapAsyncTask(await submitAsyncTask({
    taskType: ALERT_TASK_TYPE,
    title: `手动评估预警 · ${row.name}`,
    payload: { alertRuleId },
    idempotencyKey: `${ALERT_TASK_TYPE}:${row.id}:${row.updatedAt.getTime()}:${row.lastCheckedAt?.getTime() ?? 0}:${row.lastDeliveryAt?.getTime() ?? 0}`,
  }));
}
