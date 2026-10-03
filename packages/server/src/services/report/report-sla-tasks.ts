import { registerTaskHandler } from '../../lib/task-center';
import { evaluateReportSlaRule } from './report-sla.service';

export function registerReportSlaTaskHandlers(): void {
  registerTaskHandler({
    taskType: 'report-sla-rule-evaluate',
    title: '评估报表 SLA',
    module: '报表中心',
    description: '异步评估数据集 SLA，维护违规状态并按静默期发送通知。',
    allowConcurrent: true,
    maxAttempts: 2,
    async run(ctx) {
      const ruleId = Number(ctx.payload.ruleId);
      const state = await ctx.progress({ note: '开始评估 SLA', checkpoint: { stage: 'evaluating', ruleId } });
      if (state.cancelRequested) return { cancelled: true, message: '任务已取消' };
      const result = await evaluateReportSlaRule(ruleId, new Date(), ctx.taskId);
      await ctx.progress({
        processed: 1,
        total: 1,
        failed: result.violated ? 1 : 0,
        note: result.violated ? 'SLA 评估完成，检测到违规' : 'SLA 评估通过',
        checkpoint: { stage: 'done', ruleId, violationId: result.violation?.id ?? null },
      });
      return {
        ruleId,
        violated: result.violated,
        observedValue: result.observedValue,
        violationId: result.violation?.id ?? null,
      };
    },
  });
}
