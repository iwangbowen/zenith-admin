/**
 * 导入任务提交与模板下载（导入中心统一入口）。
 * 历史列表复用任务中心（taskType 'data-import'），无独立存储。
 */
import { HTTPException } from 'hono/http-exception';
import { requireRow } from '../../lib/db-assert';
import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { managedFiles } from '../../db/schema';
import { hasPermission } from '../../lib/context';
import { submitAsyncTask } from '../../lib/task-center';
import { getImportDefinition } from '../../lib/import-center/registry';
import { buildImportTemplate } from '../../lib/import-center/template';
import { IMPORT_MAX_FILE_BYTES, IMPORT_TASK_TYPE, IMPORT_PREVIEW_TASK_TYPE } from '../../lib/import-center/types';
import { importJobIdempotencyKey } from '../../lib/import-center/identity';

export { listImportEntities } from '../../lib/import-center/registry';

async function ensureImportPermission(entity: string) {
  const def = getImportDefinition(entity);
  if (!(await hasPermission(def.permission))) {
    throw new HTTPException(403, { message: '权限不足' });
  }
  return def;
}

export async function getImportTemplate(entity: string) {
  const def = await ensureImportPermission(entity);
  const buffer = await buildImportTemplate(def.title, def.columns);
  return { buffer, filename: `${def.title}导入模板.xlsx` };
}

export interface SubmitImportOptions {
  dryRun?: boolean;
  context?: Record<string, unknown>;
}

export async function submitImportJob(entity: string, fileId: string, options: SubmitImportOptions = {}) {
  const def = await ensureImportPermission(entity);
  // 上下文参数在提交时先行校验（handler 内还会再校验一次，双保险）
  let context = options.context ?? {};
  if (def.contextSchema) {
    try {
      context = def.contextSchema.parse(context);
    } catch (err) {
      const message = err instanceof Error && 'issues' in err
        ? ((err as { issues: Array<{ message: string }> }).issues[0]?.message ?? '上下文参数不合法')
        : '上下文参数不合法';
      throw new HTTPException(400, { message });
    }
  }
  const [maybeFile] = await db.select({ id: managedFiles.id, size: managedFiles.size, originalName: managedFiles.originalName })
    .from(managedFiles).where(eq(managedFiles.id, fileId)).limit(1);
  const file = requireRow(maybeFile, '文件不存在，请重新上传', 400);
  if (file.size > IMPORT_MAX_FILE_BYTES) {
    throw new HTTPException(400, { message: `文件超过 ${Math.round(IMPORT_MAX_FILE_BYTES / 1024 / 1024)}MB 上限` });
  }
  const dryRun = options.dryRun ?? false;
  return submitAsyncTask({
    taskType: dryRun ? IMPORT_PREVIEW_TASK_TYPE : IMPORT_TASK_TYPE,
    title: `${def.title}${dryRun ? '预检' : '导入'}（${file.originalName ?? fileId}）`,
    payload: { entity, fileId, dryRun, context, filename: file.originalName },
    idempotencyKey: dryRun ? undefined : importJobIdempotencyKey(entity, fileId, context),
  });
}
