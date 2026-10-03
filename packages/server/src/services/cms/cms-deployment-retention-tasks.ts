import { createHash } from 'node:crypto';
import { and, desc, eq, exists, gt, inArray, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { BodyOf } from '@zenith/shared/core';
import { CMS_DEFAULT_DEPLOYMENT_RETENTION, CMS_RETAINED_VERSION_STATUSES, cmsDeploymentRetentionContract, cmsDeploymentRetentionReasons, isCmsPendingCandidate } from '@zenith/shared/cms';
import { db } from '../../db';
import type { DbTransaction } from '../../db/types';
import { asyncTasks, cmsDeployments, cmsDeploymentRetentionPolicies, cmsDeploymentStorage, cmsReleases, cmsSites } from '../../db/schema';
import { requireRow } from '../../lib/db-assert';
import { buildWhere } from '../../lib/where-helpers';
import { currentUserOrNull, hasPermission } from '../../lib/context';
import { enqueueAsyncTask, persistAsyncTask, persistSystemAsyncTask, registerTaskHandler, submitAsyncTask, TaskCancelledError, type TaskRunContext } from '../../lib/task-center';
import { acquireCmsSitePublishLock } from './cms-site-publish-lock.service';
import { cmsGenerationSchemaName } from './cms-generation-storage.service';
import { inspectCmsDeploymentDirectory, removeCmsDeploymentDirectory } from './cms-deployment-files';
import { assertNoExternalCmsSchemaDependencies } from './cms-deployment-storage-state';
import { assertCmsDeploymentCapacityAccess, CMS_DEPLOYMENT_CLEANUP_TASK, CMS_DEPLOYMENT_MEASURE_TASK, cmsDeploymentReferences, previewCmsDeploymentCleanup, readCmsDeploymentRetentionPolicy } from './cms-deployment-retention.service';

async function ownTask(tx: DbTransaction, ctx: TaskRunContext) {
  const [row] = await tx.select({ id: asyncTasks.id }).from(asyncTasks).where(buildWhere(eq(asyncTasks.id, ctx.taskId), eq(asyncTasks.dispatchToken, ctx.dispatchToken), eq(asyncTasks.status, 'running'), eq(asyncTasks.cancelRequested, false))).for('share').limit(1);
  if (!row) throw new TaskCancelledError('回收执行轮次已变化或已请求取消');
}
async function assertTaskAccess(ctx: TaskRunContext, siteId: number) {
  if (ctx.payload.automatic === true && !currentUserOrNull()) return;
  if (!await hasPermission('cms:publish:manage')) throw new HTTPException(403, { message: '没有管理部署存储的权限' });
  await assertCmsDeploymentCapacityAccess(siteId);
}
async function assertUncancelled(ctx: TaskRunContext) { if (await ctx.isCancelRequested()) throw new TaskCancelledError('已停止剩余部署的回收；已完成步骤保留，可从断点继续'); }
async function readDeployment(siteId: number, id: number, tx = db as typeof db | DbTransaction) {
  const [row] = await tx.select({ deployment: { id: cmsDeployments.id, siteId: cmsDeployments.siteId, status: cmsDeployments.status, createdAt: cmsDeployments.createdAt, updatedAt: cmsDeployments.updatedAt, activatedAt: cmsDeployments.activatedAt }, storage: cmsDeploymentStorage,
    release: { status: cmsReleases.status, deploymentId: cmsReleases.deploymentId, baseGenerationId: cmsReleases.baseGenerationId },
    siteCode: sql<string>`coalesce(${cmsDeploymentStorage.siteCode},nullif(${cmsDeployments.snapshot}->>'siteCode',''),${cmsSites.code})`,
  }).from(cmsDeployments).innerJoin(cmsReleases, eq(cmsReleases.id, cmsDeployments.releaseId)).innerJoin(cmsSites, eq(cmsSites.id, cmsDeployments.siteId)).leftJoin(cmsDeploymentStorage, eq(cmsDeploymentStorage.deploymentId, cmsDeployments.id)).where(buildWhere(eq(cmsDeployments.id, id), eq(cmsDeployments.siteId, siteId))).limit(1);
  return requireRow(row, '部署不存在或不属于所选站点');
}
async function cleanupReasons(tx: DbTransaction, siteId: number, id: number, ctx: TaskRunContext) {
  const row = await readDeployment(siteId, id, tx);
  const policy = await readCmsDeploymentRetentionPolicy(siteId, tx);
  const { references, tasks, activeGenerationId } = await cmsDeploymentReferences(siteId, tx);
  const recent = await tx.select({ id: cmsDeployments.id }).from(cmsDeployments).leftJoin(cmsDeploymentStorage, eq(cmsDeploymentStorage.deploymentId, cmsDeployments.id)).where(buildWhere(eq(cmsDeployments.siteId, siteId), inArray(cmsDeployments.status, [...CMS_RETAINED_VERSION_STATUSES]), sql`coalesce(${cmsDeploymentStorage.storageState},'available')='available'`)).orderBy(sql`coalesce(${cmsDeployments.activatedAt},${cmsDeployments.createdAt}) desc`, desc(cmsDeployments.id)).limit(policy.retainCount);
  const reasons = cmsDeploymentRetentionReasons({ id, status: row.deployment.status, releaseStatus: row.release.status, storageState: row.storage?.storageState ?? 'available', pinned: row.storage?.pinned ?? false,
    pendingCandidate: isCmsPendingCandidate(id, row.release, activeGenerationId),
    ageFrom: (row.deployment.status === 'failed' ? row.deployment.updatedAt : row.deployment.activatedAt ?? row.deployment.createdAt).toISOString(),
    protectedBy: [...references.get(id) ?? [], ...(row.storage?.cleanupTaskId && row.storage.cleanupTaskId !== ctx.taskId && tasks.some(task => task.id === row.storage!.cleanupTaskId) ? ['另一回收任务正在处理'] : [])],
  }, policy, recent.some(item => item.id === id));
  return { row, reasons };
}
async function schemaBytes(tx: DbTransaction, id: number) {
  const names = [cmsGenerationSchemaName(id), `${cmsGenerationSchemaName(id)}_build`];
  const [row] = await tx.execute<{ bytes: number }>(sql`select coalesce(sum(pg_total_relation_size(c.oid)),0)::double precision as bytes from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in (${names[0]},${names[1]}) and c.relkind in ('r','m')`);
  return Number(row.bytes);
}

export async function purgeCmsDeploymentStorage(siteId: number, id: number, ctx: TaskRunContext): Promise<string> {
  await assertUncancelled(ctx);
  const initial = await readDeployment(siteId, id);
  if (initial.storage?.storageState === 'purged') return '已回收，无需重复处理';
  // Filesystem containment and link checks happen before any destructive database step.
  const files = await inspectCmsDeploymentDirectory(initial.siteCode, id, { checkCancelled: () => assertUncancelled(ctx) });
  const claimed = await db.transaction(async tx => {
    await acquireCmsSitePublishLock(tx, siteId); await ownTask(tx, ctx);
    const { row, reasons } = await cleanupReasons(tx, siteId, id, ctx);
    if (reasons.length) return { reason: reasons.join('；') };
    const bytes = await schemaBytes(tx, id);
    const names = [cmsGenerationSchemaName(id), `${cmsGenerationSchemaName(id)}_build`];
    await assertNoExternalCmsSchemaDependencies(tx, names);
    await tx.insert(cmsDeploymentStorage).values({ deploymentId: id, siteCode: initial.siteCode, storageState: 'purging', cleanupTaskId: ctx.taskId, schemaBytes: bytes, fileBytes: files.bytes, fileCount: files.files, measuredAt: new Date() })
      .onConflictDoUpdate({ target: cmsDeploymentStorage.deploymentId, set: { siteCode: initial.siteCode, storageState: 'purging', cleanupTaskId: ctx.taskId, version: (row.storage?.version ?? 0) + 1, error: null, updatedAt: new Date() } });
    return { reason: null };
  });
  if (claimed.reason) return `已跳过：${claimed.reason}`;
  try {
    await db.transaction(async tx => {
      await acquireCmsSitePublishLock(tx, siteId); await ownTask(tx, ctx);
      const { row, reasons } = await cleanupReasons(tx, siteId, id, ctx);
      if (reasons.length) throw new Error(`部署仍受保护：${reasons.join('；')}`);
      if (!row.storage?.schemaPurgedAt) {
        const [lock] = await tx.execute<{ acquired: boolean }>(sql`select pg_try_advisory_xact_lock(hashtext('cms-generation-build'),${id}) as acquired`);
        if (!lock.acquired) throw new Error('部署构建进程尚未退出，暂不回收');
        const names = [cmsGenerationSchemaName(id), `${cmsGenerationSchemaName(id)}_build`];
        await assertNoExternalCmsSchemaDependencies(tx, names);
        await tx.execute(sql`drop schema if exists ${sql.identifier(names[1])} cascade`);
        await tx.execute(sql`drop schema if exists ${sql.identifier(names[0])} cascade`);
        await tx.update(cmsDeploymentStorage).set({ schemaPurgedAt: new Date(), schemaBytes: 0 }).where(eq(cmsDeploymentStorage.deploymentId, id));
      }
    });
    await assertUncancelled(ctx);
    await removeCmsDeploymentDirectory(initial.siteCode, id, () => assertUncancelled(ctx));
    await db.transaction(async tx => {
      await acquireCmsSitePublishLock(tx, siteId); await ownTask(tx, ctx);
      const { reasons } = await cleanupReasons(tx, siteId, id, ctx);
      if (reasons.length) throw new Error(`部署保护状态变化：${reasons.join('；')}`);
      const now = new Date();
      await tx.update(cmsDeploymentStorage).set({ filesPurgedAt: now, purgedAt: now, storageState: 'purged', error: null, schemaBytes: 0, fileBytes: 0, fileCount: 0 }).where(eq(cmsDeploymentStorage.deploymentId, id));
    });
    return '数据库投影和静态目录已回收，发布审计记录保留';
  } catch (error) {
    await db.update(cmsDeploymentStorage).set({ error: error instanceof Error ? error.message : '部署回收失败' }).where(buildWhere(eq(cmsDeploymentStorage.deploymentId, id), eq(cmsDeploymentStorage.cleanupTaskId, ctx.taskId), sql`exists(select 1 from ${asyncTasks} where ${asyncTasks.id}=${ctx.taskId} and ${asyncTasks.dispatchToken}=${ctx.dispatchToken} and ${asyncTasks.status}='running')`));
    throw error;
  }
}

export async function submitCmsDeploymentMeasurement(siteId: number) {
  await assertCmsDeploymentCapacityAccess(siteId);
  return submitAsyncTask({ taskType: CMS_DEPLOYMENT_MEASURE_TASK, title: 'CMS 部署容量测量', payload: { siteId }, idempotencyKey: `cms-measure:${siteId}:${Math.floor(Date.now() / 30000)}` });
}
export async function submitCmsDeploymentCleanup(siteId: number, input: BodyOf<typeof cmsDeploymentRetentionContract.cleanup>) {
  await assertCmsDeploymentCapacityAccess(siteId);
  const task = await db.transaction(async tx => {
    await acquireCmsSitePublishLock(tx, siteId);
    const preview = await previewCmsDeploymentCleanup(siteId, { executor: tx, skipAccess: true });
    if (preview.fingerprint !== input.fingerprint) throw new HTTPException(409, { message: '部署保护状态或策略已变化，请重新预览清理范围' });
    const ids = [...new Set(input.deploymentIds)];
    if (ids.some(id => !preview.candidates.some(candidate => candidate.id === id))) throw new HTTPException(409, { message: '选择中包含受保护或不在本次预览内的部署' });
    return persistAsyncTask(tx, { taskType: CMS_DEPLOYMENT_CLEANUP_TASK, title: 'CMS 历史部署存储回收', payload: { siteId, deploymentIds: ids }, idempotencyKey: `cms-cleanup:${siteId}:${createHash('sha256').update(input.fingerprint + ':' + ids.sort((a, b) => a - b).join(',')).digest('hex').slice(0, 48)}` });
  });
  await enqueueAsyncTask(task.id); return task;
}
export function registerCmsDeploymentRetentionTasks() {
  registerTaskHandler({ taskType: CMS_DEPLOYMENT_MEASURE_TASK, title: 'CMS 部署容量测量', module: 'CMS内容管理', affinity: 'node', allowConcurrent: true, maxAttempts: 2,
    async run(ctx) {
      const siteId = Number(ctx.payload.siteId); await assertTaskAccess(ctx, siteId);
      let after = Number(ctx.checkpoint?.after ?? 0); let processed = Number(ctx.checkpoint?.processed ?? 0);
      const total = await db.$count(cmsDeployments, eq(cmsDeployments.siteId, siteId));
      for (;;) {
        const ids = await db.select({ id: cmsDeployments.id }).from(cmsDeployments).where(buildWhere(eq(cmsDeployments.siteId, siteId), gt(cmsDeployments.id, after))).orderBy(cmsDeployments.id).limit(50);
        if (!ids.length) break;
        for (const { id } of ids) {
          await assertUncancelled(ctx); const row = await readDeployment(siteId, id);
          if (!row.storage || row.storage.storageState === 'available') {
            const files = await inspectCmsDeploymentDirectory(row.siteCode, id, { checkCancelled: () => assertUncancelled(ctx) });
            await db.transaction(async tx => {
              await acquireCmsSitePublishLock(tx, siteId); await ownTask(tx, ctx);
              const values = { schemaBytes: await schemaBytes(tx, id), fileBytes: files.bytes, fileCount: files.files, measuredAt: new Date() };
              await tx.insert(cmsDeploymentStorage).values({ deploymentId: id, siteCode: row.siteCode, ...values }).onConflictDoUpdate({ target: cmsDeploymentStorage.deploymentId, set: { ...values, siteCode: row.siteCode, updatedAt: new Date() }, setWhere: eq(cmsDeploymentStorage.storageState, 'available') });
            });
          }
          processed++; after = id;
          if ((await ctx.progress({ processed, total, note: `已测量 ${processed}/${total} 个部署`, checkpoint: { after, processed } })).cancelRequested) return { processed };
        }
      }
      return { processed };
    },
  });
  registerTaskHandler({ taskType: CMS_DEPLOYMENT_CLEANUP_TASK, title: 'CMS 历史部署存储回收', module: 'CMS内容管理', affinity: 'node', allowConcurrent: true, maxAttempts: 3, retryDelayMs: 5000,
    async run(ctx) {
      const siteId = Number(ctx.payload.siteId); await assertTaskAccess(ctx, siteId);
      const ids = [...new Set((Array.isArray(ctx.payload.deploymentIds) ? ctx.payload.deploymentIds : []).map(Number))];
      if (!ids.length || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error('回收任务缺少有效的部署范围');
      let processed = Number(ctx.checkpoint?.processed ?? 0);
      for (let index = processed; index < ids.length; index++) {
        const message = await purgeCmsDeploymentStorage(siteId, ids[index], ctx);
        await ctx.reportItems([{ key: String(ids[index]), label: `部署 #${ids[index]}`, status: message.startsWith('已跳过') ? 'skipped' : 'success', message, data: { siteId, deploymentId: ids[index] } }]);
        processed = index + 1;
        if ((await ctx.progress({ processed, total: ids.length, note: `已处理 ${processed}/${ids.length} 个部署`, checkpoint: { processed } })).cancelRequested) return { processed };
      }
      return { processed };
    },
  });
}
export async function dispatchCmsDeploymentRetention(): Promise<string> {
  // Sites without a saved policy follow the default rules; only explicit opt-outs are skipped.
  const sites = await db.select({ siteId: cmsSites.id }).from(cmsSites)
    .leftJoin(cmsDeploymentRetentionPolicies, eq(cmsDeploymentRetentionPolicies.siteId, cmsSites.id))
    .where(and(
      sql`coalesce(${cmsDeploymentRetentionPolicies.automatic}, ${CMS_DEFAULT_DEPLOYMENT_RETENTION.automatic})`,
      exists(db.select({ id: cmsDeployments.id }).from(cmsDeployments).where(eq(cmsDeployments.siteId, cmsSites.id))),
    )).orderBy(cmsSites.id);
  let submitted = 0;
  for (const { siteId } of sites) {
    const task = await db.transaction(async tx => {
      await acquireCmsSitePublishLock(tx, siteId);
      if (!(await readCmsDeploymentRetentionPolicy(siteId, tx)).automatic) return null;
      const preview = await previewCmsDeploymentCleanup(siteId, { executor: tx, skipAccess: true });
      if (!preview.candidates.length) return null;
      return persistSystemAsyncTask(tx, { taskType: CMS_DEPLOYMENT_CLEANUP_TASK, title: 'CMS 自动部署存储回收', payload: { siteId, deploymentIds: preview.candidates.map(row => row.id), automatic: true }, idempotencyKey: `cms-retention:${siteId}:${preview.fingerprint.slice(0, 48)}` }, null);
    });
    if (task) { await enqueueAsyncTask(task.id); submitted++; }
  }
  return `已提交 ${submitted} 个站点的部署存储回收任务`;
}
