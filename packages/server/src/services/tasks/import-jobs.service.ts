/**
 * 导入任务提交与模板下载（导入中心统一入口）。
 * 历史列表复用任务中心（taskType 'data-import'），无独立存储。
 */
import { HTTPException } from 'hono/http-exception';
import { requireRow } from '../../lib/db-assert';
import { and, eq } from 'drizzle-orm';
import { db } from '../../db';
import { managedFiles } from '../../db/schema';
import { currentUser, hasPermission } from '../../lib/context';
import { exactTenantCondition, getCreateTenantId } from '../../lib/tenant';
import { enqueueAsyncTask, persistAsyncTaskWithResult } from '../../lib/task-center';
import { getImportDefinition } from '../../lib/import-center/registry';
import { buildImportTemplate } from '../../lib/import-center/template';
import { IMPORT_MAX_FILE_BYTES, IMPORT_TASK_TYPE, IMPORT_PREVIEW_TASK_TYPE } from '../../lib/import-center/types';
import { importJobIdempotencyKey } from '../../lib/import-center/identity';
import { inspectImportWorkbook } from '../../lib/import-center/parser';
import { retainManagedFiles } from '../files/file-gc.service';
import { getAsyncTaskForCreator } from './async-tasks.service';

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
  fieldMapping?: Record<string, string | null>;
  duplicateMode?: 'error' | 'skip';
}

export async function submitImportJob(entity: string, fileId: string, options: SubmitImportOptions = {}) {
  const def = await ensureImportPermission(entity);
  if (options.fieldMapping && Object.keys(options.fieldMapping).some(key => !def.columns.some(column => column.key === key))) {
    throw new HTTPException(400, { message: '导入字段映射包含未知字段，请重新预检' });
  }
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
  const user = currentUser();
  const [maybeFile] = await db.select({ id: managedFiles.id, size: managedFiles.size, originalName: managedFiles.originalName, visibility: managedFiles.visibility })
    .from(managedFiles).where(and(eq(managedFiles.id, fileId), eq(managedFiles.createdBy, user.userId), exactTenantCondition(managedFiles.tenantId, getCreateTenantId(user)))).limit(1);
  const file = requireRow(maybeFile, '文件不存在，请重新上传', 400);
  if (file.visibility !== 'restricted') throw new HTTPException(400, { message: '导入文件必须使用受控上传，请重新选择文件' });
  if (file.size > IMPORT_MAX_FILE_BYTES) {
    throw new HTTPException(400, { message: `文件超过 ${Math.round(IMPORT_MAX_FILE_BYTES / 1024 / 1024)}MB 上限` });
  }
  const dryRun = options.dryRun ?? false;
  const duplicateMode = options.duplicateMode ?? 'error';
  const idempotencyKey = dryRun ? null : importJobIdempotencyKey(entity, fileId, context, { fieldMapping: options.fieldMapping, duplicateMode });
  const input = {
    taskType: dryRun ? IMPORT_PREVIEW_TASK_TYPE : IMPORT_TASK_TYPE,
    title: `${def.title}${dryRun ? '预检' : '导入'}（${file.originalName ?? fileId}）`,
    payload: { entity, fileId, dryRun, context, filename: file.originalName, fieldMapping: options.fieldMapping ?? {}, duplicateMode },
    idempotencyKey: idempotencyKey ?? undefined,
  } as const;
  const row = await db.transaction(async tx => {
    const result = await persistAsyncTaskWithResult(tx, input);
    if (result.created) await retainManagedFiles(tx, [file.id]);
    return result.row;
  });
  await enqueueAsyncTask(row.id).catch(() => undefined);
  return row;
}

export async function inspectImportFile(entity: string, fileId: string, context?: Record<string, unknown>) {
  const def = await ensureImportPermission(entity);
  const user = currentUser();
  const [file] = await db.select({ id: managedFiles.id, tenantId: managedFiles.tenantId, originalName: managedFiles.originalName, size: managedFiles.size })
    .from(managedFiles).where(and(eq(managedFiles.id, fileId), eq(managedFiles.createdBy, user.userId), exactTenantCondition(managedFiles.tenantId, getCreateTenantId(user)), eq(managedFiles.visibility, 'restricted'))).limit(1);
  const owned = requireRow(file, '文件不存在，请重新上传', 400);
  if (file.size > IMPORT_MAX_FILE_BYTES) throw new HTTPException(400, { message: `文件超过 ${Math.round(IMPORT_MAX_FILE_BYTES / 1024 / 1024)}MB 上限` });
  if (def.contextSchema) def.contextSchema.parse(context ?? {});
  const stored = await (await import('../../services/files/files.service')).readGeneratedManagedFile(owned.id, getCreateTenantId(user));
  const buffer = await new Response(stored.stream).arrayBuffer();
  return inspectImportWorkbook(buffer, entity, def.columns, def.maxRows ?? 10_000, file.originalName);
}

export async function confirmImportPreview(id: number) {
  const task = await getAsyncTaskForCreator(id);
  if (task.taskType !== IMPORT_PREVIEW_TASK_TYPE || task.status !== 'success') throw new HTTPException(400, { message: '仅成功的预检任务可以确认导入' });
  if (Number(task.result?.failed ?? 0) > 0) throw new HTTPException(400, { message: '预检存在失败行，请先修正错误文件' });
  const payload = task.payload as { entity?: string; fileId?: string; context?: Record<string, unknown>; fieldMapping?: Record<string, string | null>; duplicateMode?: 'error' | 'skip' };
  if (!payload.entity || !payload.fileId) throw new HTTPException(400, { message: '预检任务缺少导入规格' });
  return submitImportJob(payload.entity, payload.fileId, { context: payload.context, fieldMapping: payload.fieldMapping, duplicateMode: payload.duplicateMode, dryRun: false });
}

export async function getImportTaskForCreator(id: number) {
  const task = await getAsyncTaskForCreator(id);
  if (task.taskType !== IMPORT_PREVIEW_TASK_TYPE && task.taskType !== IMPORT_TASK_TYPE) throw new HTTPException(404, { message: '导入任务不存在' });
  const definition = await ensureImportPermission(String(task.payload.entity ?? ''));
  const context = definition.contextSchema ? definition.contextSchema.parse(task.payload.context ?? {}) : task.payload.context ?? {};
  await definition.prepare(context);
  return task;
}
