import { mapAsyncTask, registerTaskHandler, submitAsyncTask } from '../../lib/task-center';
import { ensureDatasetExists, refreshMaterialization } from './report-dataset.service';

const TASK_TYPE = 'report-dataset-materialize';

export function registerReportDatasetTaskHandlers(): void {
  registerTaskHandler({
    taskType: TASK_TYPE,
    title: '刷新报表物化快照',
    module: '报表中心',
    description: '异步刷新报表数据集物化快照，支持进度、幂等与取消。',
    allowConcurrent: false,
    async run(ctx) {
      const datasetId = Number(ctx.payload.datasetId);
      await ctx.progress({ note: '开始刷新物化快照', checkpoint: { stage: 'start' } });
      const { cancelRequested } = await ctx.progress({ note: '正在执行数据集查询并写入快照', checkpoint: { stage: 'running' } });
      if (cancelRequested) return { cancelled: true, message: '任务已取消' };
      const result = await refreshMaterialization(datasetId, {
        isCancelRequested: ctx.isCancelRequested,
      });
      if (result.cancelled) {
        await ctx.progress({ note: '已取消，未写入物化快照', checkpoint: { stage: 'cancelled' } });
        return { cancelled: true, rows: result.rows, message: '任务已取消，未写入物化快照' };
      }
      await ctx.progress({ processed: result.rows, total: result.rows, note: `刷新完成，共 ${result.rows} 行`, checkpoint: { stage: 'done', rows: result.rows } });
      return { rows: result.rows, message: `物化刷新完成，共 ${result.rows} 行` };
    },
  });
}

export async function submitDatasetMaterializeTask(datasetId: number) {
  const row = await ensureDatasetExists(datasetId);
  const materialize = (row.materialize ?? {}) as { refreshedAtMs?: number | null };
  return mapAsyncTask(await submitAsyncTask({
    taskType: TASK_TYPE,
    title: `刷新物化快照 · ${row.name}`,
    payload: { datasetId },
    idempotencyKey: `${TASK_TYPE}:${datasetId}:${row.updatedAt.getTime()}:${materialize.refreshedAtMs ?? 0}`,
  }));
}
