import { inArray } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { reportDatasources } from '../../db/schema';
import { mapAsyncTask, registerTaskHandler, submitAsyncTask } from '../../lib/task-center';
import { reportScopedWhere } from './report-access';
import { testDatasource } from './report-datasource.service';

const TASK_TYPE = 'report-datasource-health-check';

export function registerReportDatasourceTaskHandlers(): void {
  registerTaskHandler({
    taskType: TASK_TYPE,
    title: '批量检测报表数据源健康状态',
    module: '报表中心',
    description: '异步检测当前租户数据源健康状态，支持进度、幂等与取消。',
    allowConcurrent: false,
    async run(ctx) {
      const ids = Array.isArray(ctx.payload.ids) ? ctx.payload.ids.map(Number).filter((id) => Number.isInteger(id) && id > 0) : [];
      const rows = ids.length === 0
        ? []
        : await db.select({
          id: reportDatasources.id,
          name: reportDatasources.name,
          type: reportDatasources.type,
        }).from(reportDatasources).where(reportScopedWhere(reportDatasources, inArray(reportDatasources.id, ids)));
      await ctx.progress({ total: rows.length, processed: 0, failed: 0, note: `待检测 ${rows.length} 个数据源`, checkpoint: { index: 0, ids: rows.map((row) => row.id) } });

      let processed = 0;
      let failed = 0;
      let skipped = 0;
      for (const row of rows) {
        if (await ctx.isCancelRequested()) {
          await ctx.progress({ processed, failed, total: rows.length, note: '任务已取消', checkpoint: { index: processed, cancelled: true } });
          return { cancelled: true, processed, failed, skipped, total: rows.length, message: '批量健康检查已取消' };
        }

        try {
          if (row.type === 'api') {
            skipped += 1;
            await ctx.reportItems([{ key: String(row.id), label: row.name, status: 'skipped', message: 'API 数据源暂不支持自动连接检测' }]);
          } else {
            const result = await testDatasource({ id: row.id });
            if (!result.ok) failed += 1;
            await ctx.reportItems([{
              key: String(row.id),
              label: row.name,
              status: result.ok ? 'success' : 'failed',
              message: result.ok ? (result.latencyMs != null ? `连接成功（${result.latencyMs}ms）` : '连接成功') : result.message,
              data: { datasourceId: row.id, latencyMs: result.latencyMs ?? null },
            }]);
          }
        } catch (error) {
          failed += 1;
          await ctx.reportItems([{
            key: String(row.id),
            label: row.name,
            status: 'failed',
            message: error instanceof Error ? error.message : '健康检查失败',
          }]);
        }
        processed += 1;
        await ctx.progress({
          processed,
          failed,
          total: rows.length,
          note: `已检测 ${processed}/${rows.length} 个数据源`,
          checkpoint: { index: processed, failed, skipped },
        });
      }

      return {
        total: rows.length,
        processed,
        failed,
        skipped,
        message: failed > 0 ? `检测完成，成功 ${processed - failed - skipped} 个，失败 ${failed} 个，跳过 ${skipped} 个` : `检测完成，共 ${processed} 个数据源`,
      };
    },
  });
}

export async function submitDatasourceHealthCheckTask(ids: number[]) {
  const normalizedIds = Array.from(new Set(ids.map(Number).filter((id) => Number.isInteger(id) && id > 0)));
  if (normalizedIds.length === 0) throw new HTTPException(400, { message: '请选择至少一个数据源' });
  const rows = await db.select({
    id: reportDatasources.id,
    name: reportDatasources.name,
    updatedAt: reportDatasources.updatedAt,
  }).from(reportDatasources).where(reportScopedWhere(reportDatasources, inArray(reportDatasources.id, normalizedIds)));
  if (rows.length === 0) throw new HTTPException(404, { message: '未找到可检测的数据源' });
  const taskIds = rows.map((row) => row.id).sort((a, b) => a - b);
  const fingerprint = rows
    .sort((a, b) => a.id - b.id)
    .map((row) => `${row.id}:${row.updatedAt.getTime()}`)
    .join('|');
  return mapAsyncTask(await submitAsyncTask({
    taskType: TASK_TYPE,
    title: rows.length === 1 ? `检测数据源健康 · ${rows[0].name}` : `批量检测数据源健康 · ${rows.length} 个`,
    payload: { ids: taskIds },
    idempotencyKey: `${TASK_TYPE}:${fingerprint}`,
  }));
}
