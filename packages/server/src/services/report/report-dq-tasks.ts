import { registerTaskHandler } from '../../lib/task-center';
import { executeReportDqRule } from './report-dq.service';

export function registerReportDqTaskHandlers(): void {
  registerTaskHandler({
    taskType: 'report-dq-rule-run',
    title: '执行数据质量规则',
    module: '报表中心',
    description: '异步执行数据质量规则、保存失败样本并更新质量评分。',
    allowConcurrent: true,
    maxAttempts: 2,
    async run(ctx) {
      const ruleId = Number(ctx.payload.ruleId);
      const sampleLimit = Number(ctx.payload.sampleLimit ?? 20);
      const triggerType = ctx.payload.triggerType === 'scheduled' || ctx.payload.triggerType === 'dataset_refresh'
        ? ctx.payload.triggerType
        : 'manual';
      const checkpointRunId = Number(ctx.checkpoint?.runId ?? 0) || undefined;
      const state = await ctx.progress({
        note: checkpointRunId ? '从断点继续质量检查' : '开始执行质量检查',
        checkpoint: checkpointRunId ? { runId: checkpointRunId, stage: 'running' } : { stage: 'starting' },
      });
      if (state.cancelRequested) return { cancelled: true, message: '任务已取消' };
      const run = await executeReportDqRule(ruleId, {
        taskId: ctx.taskId,
        sampleLimit,
        triggerType,
        runId: checkpointRunId,
        isCancelRequested: ctx.isCancelRequested,
        onRunStarted: async (runId) => {
          await ctx.progress({ note: '已创建质量检查运行记录', checkpoint: { runId, stage: 'running' } });
        },
      });
      if (run.status === 'cancelled') {
        await ctx.progress({ note: '质量检查已取消', checkpoint: { runId: run.id, stage: 'cancelled' } });
        return { cancelled: true, runId: run.id, message: '质量检查已取消' };
      }
      await ctx.progress({
        processed: run.checkedRows,
        failed: run.failedRows,
        total: run.checkedRows,
        note: run.status === 'succeeded' ? '质量检查通过' : '质量检查完成，发现异常',
        checkpoint: { runId: run.id, stage: 'done' },
      });
      return { runId: run.id, status: run.status, checkedRows: run.checkedRows, failedRows: run.failedRows };
    },
  });
}
