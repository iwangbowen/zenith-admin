import { setTimeout as sleep } from 'node:timers/promises';
import { registerTaskHandler } from '../../lib/task-center/registry';

/**
 * 业务示例：注册两个演示任务类型。
 * - demo-batch：可并发，逐条处理 + 可配置失败点，演示确定进度与断点续跑；
 * - demo-serial：不可并发（同一用户同时只允许一个），多阶段长任务，演示不定进度与重复提交拦截。
 */
export function registerTaskDemoHandlers(): void {
  registerTaskHandler({
    taskType: 'demo-batch',
    title: '批量处理演示',
    module: '业务示例',
    description: '模拟逐条批量处理：可配置总条数、单条耗时、硬失败点（整个任务失败，触发自动重试/断点恢复）与软失败间隔（单条失败计入明细但任务继续）。',
    allowConcurrent: true,
    maxAttempts: 3,
    retryDelayMs: 5000,
    async run(ctx) {
      const total = Math.min(Math.max(Number(ctx.payload.totalItems ?? 100), 1), 10000);
      const delayMs = Math.min(Math.max(Number(ctx.payload.itemDelayMs ?? 200), 10), 5000);
      const failAtRaw = Number(ctx.payload.failAtItem ?? 0);
      const failAt = Number.isFinite(failAtRaw) && failAtRaw > 0 ? Math.trunc(failAtRaw) : null;
      const failEveryRaw = Number(ctx.payload.failEveryN ?? 0);
      const failEvery = Number.isFinite(failEveryRaw) && failEveryRaw > 1 ? Math.trunc(failEveryRaw) : null;
      // 从断点恢复：跳过已处理的条目
      let processed = Math.trunc(Number(ctx.checkpoint?.processed ?? 0));
      let failed = Math.trunc(Number(ctx.checkpoint?.failed ?? 0));

      for (let i = processed + 1; i <= total; i++) {
        await sleep(delayMs); // 模拟单条业务处理耗时
        // 硬失败：仅首次执行时在失败点抛错（自动重试 / 断点恢复后 attempt > 1 跳过）→ 演示重试与续跑
        if (failAt !== null && i === failAt && ctx.attempt === 1) {
          throw new Error(`模拟失败：第 ${i} 条处理异常（自动重试/断点恢复后将从第 ${processed + 1} 条继续）`);
        }
        // 软失败：每 N 条标记一条失败，任务继续 → 演示行级明细
        const softFailed = failEvery !== null && i % failEvery === 0;
        if (softFailed) failed++;
        processed = i;
        await ctx.reportItems([{
          key: `item-${i}`,
          label: `第 ${i} 条记录`,
          status: softFailed ? 'failed' : 'success',
          message: softFailed ? `模拟软失败：第 ${i} 条数据校验不通过` : null,
        }]);
        const { cancelRequested } = await ctx.progress({
          processed,
          failed,
          total,
          note: `已处理 ${processed}/${total} 条${failed > 0 ? `，失败 ${failed} 条` : ''}`,
          checkpoint: { processed, failed },
        });
        if (cancelRequested) return; // 协作式取消：保存完断点后退出
      }
      return { processed, failed, message: `批量处理完成，共 ${processed} 条${failed > 0 ? `，失败 ${failed} 条` : ''}` };
    },
  });

  registerTaskHandler({
    taskType: 'demo-serial',
    title: '串行阶段演示',
    module: '业务示例',
    description: '模拟多阶段长任务（阶段数不可枚举为逐条进度，演示不定进度条）；同一用户同时只允许一个实例，演示重复提交拦截。',
    allowConcurrent: false,
    async run(ctx) {
      const stages = ['准备数据', '汇总统计', '生成报告', '归档结果'];
      const stageDelayMs = Math.min(Math.max(Number(ctx.payload.stageDelayMs ?? 4000), 500), 30000);
      const startStage = Math.trunc(Number(ctx.checkpoint?.stage ?? 0));

      for (let s = startStage; s < stages.length; s++) {
        const { cancelRequested } = await ctx.progress({
          note: `阶段 ${s + 1}/${stages.length}：${stages[s]}…`,
          checkpoint: { stage: s },
        });
        if (cancelRequested) return;
        await sleep(stageDelayMs); // 模拟阶段耗时
      }
      await ctx.progress({ note: '全部阶段完成', checkpoint: { stage: stages.length } });
      return { stages: stages.length, message: '串行任务完成' };
    },
  });
}
