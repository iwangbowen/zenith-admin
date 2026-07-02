import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { commonErrorResponses, jsonContent, ok, okBody, validationHook } from '../lib/openapi-schemas';
import { AsyncTaskDTO } from '../lib/openapi-dtos';
import { mapAsyncTask, registerTaskHandler, submitAsyncTask } from '../lib/task-center';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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
    description: '模拟逐条批量处理：可配置总条数、单条耗时与模拟失败点；失败/取消后支持断点恢复续跑。',
    allowConcurrent: true,
    async run(ctx) {
      const total = Math.min(Math.max(Number(ctx.payload.totalItems ?? 100), 1), 10000);
      const delayMs = Math.min(Math.max(Number(ctx.payload.itemDelayMs ?? 200), 10), 5000);
      const failAtRaw = Number(ctx.payload.failAtItem ?? 0);
      const failAt = Number.isFinite(failAtRaw) && failAtRaw > 0 ? Math.trunc(failAtRaw) : null;
      // 从断点恢复：跳过已处理的条目
      let processed = Math.trunc(Number(ctx.checkpoint?.processed ?? 0));
      const failed = Math.trunc(Number(ctx.checkpoint?.failed ?? 0));

      for (let i = processed + 1; i <= total; i++) {
        await sleep(delayMs); // 模拟单条业务处理耗时
        // 仅首次执行时在失败点抛错，断点恢复后跳过 → 演示「从中断处继续」
        if (failAt !== null && i === failAt && ctx.attempt === 1) {
          throw new Error(`模拟失败：第 ${i} 条处理异常（断点恢复后将从第 ${processed + 1} 条继续）`);
        }
        processed = i;
        const { cancelRequested } = await ctx.progress({
          processed,
          failed,
          total,
          note: `已处理 ${processed}/${total} 条`,
          checkpoint: { processed, failed },
        });
        if (cancelRequested) return; // 协作式取消：保存完断点后退出
      }
      return { processed, failed, message: `批量处理完成，共 ${processed} 条` };
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

const taskDemoRoute = new OpenAPIHono({ defaultHook: validationHook });

const submitDemoTaskSchema = z.object({
  taskType: z.enum(['demo-batch', 'demo-serial']),
  totalItems: z.number().int().min(1).max(10000).optional(),
  itemDelayMs: z.number().int().min(10).max(5000).optional(),
  failAtItem: z.number().int().min(1).max(10000).nullable().optional(),
  stageDelayMs: z.number().int().min(500).max(30000).optional(),
});

const submitRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/submit', tags: ['TaskDemo'], summary: '提交演示异步任务',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ audit: { description: '提交演示异步任务', module: '业务示例' } })] as const,
    request: { body: { content: jsonContent(submitDemoTaskSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(AsyncTaskDTO, '任务已提交') },
  }),
  handler: async (c) => {
    const { taskType, ...payload } = c.req.valid('json');
    const title = taskType === 'demo-batch'
      ? `批量处理演示（${payload.totalItems ?? 100} 条）`
      : '串行阶段演示';
    const row = await submitAsyncTask({ taskType, title, payload });
    return c.json(okBody(mapAsyncTask(row), '任务已提交，可在下方列表查看进度'), 200);
  },
});

taskDemoRoute.openapiRoutes([submitRoute] as const);

export default taskDemoRoute;
