import { createHash } from 'node:crypto';
import { desc, eq, inArray, like, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { BodyOf, QueryOutputOf } from '@zenith/shared/core';
import { CMS_DEFAULT_DEPLOYMENT_RETENTION, cmsDeploymentRetentionContract, cmsDeploymentRetentionDecisions, cmsTaskDeploymentReferences, isCmsPendingCandidate, type CmsDeploymentCapacityRow, type CmsDeploymentRetentionPolicy } from '@zenith/shared/cms';
import { db, readSnapshot } from '../../db';
import type { DbExecutor } from '../../db/types';
import { asyncTasks, cmsDeployments, cmsDeploymentStorage, cmsDeploymentRetentionPolicies, cmsReleases, cmsSiteGenerations } from '../../db/schema';
import { buildWhere, withPagination } from '../../lib/where-helpers';
import { requireRow } from '../../lib/db-assert';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import { assertSiteAccess, ensureCmsSiteExists } from './cms-sites.service';
import { assertAllCmsSiteChannelsAccess } from './cms-channels.service';
import { acquireCmsSitePublishLock } from './cms-site-publish-lock.service';

export const CMS_DEPLOYMENT_CLEANUP_TASK = 'cms-deployment-cleanup';
export const CMS_DEPLOYMENT_MEASURE_TASK = 'cms-deployment-measure';
export async function assertCmsDeploymentCapacityAccess(siteId: number) { await ensureCmsSiteExists(siteId); await assertSiteAccess(siteId); await assertAllCmsSiteChannelsAccess(siteId); }

export async function readCmsDeploymentRetentionPolicy(siteId: number, executor: DbExecutor = db): Promise<CmsDeploymentRetentionPolicy> {
  const [policy] = await executor.select().from(cmsDeploymentRetentionPolicies).where(eq(cmsDeploymentRetentionPolicies.siteId, siteId)).limit(1);
  return { siteId, version: policy?.version ?? 0, retainCount: policy?.retainCount ?? CMS_DEFAULT_DEPLOYMENT_RETENTION.retainCount,
    retainDays: policy?.retainDays ?? CMS_DEFAULT_DEPLOYMENT_RETENTION.retainDays, failedRetainDays: policy?.failedRetainDays ?? CMS_DEFAULT_DEPLOYMENT_RETENTION.failedRetainDays, automatic: policy?.automatic ?? CMS_DEFAULT_DEPLOYMENT_RETENTION.automatic };
}

export async function cmsDeploymentReferences(siteId: number, executor: DbExecutor = db) {
  const [pointer] = await executor.select().from(cmsSiteGenerations).where(eq(cmsSiteGenerations.siteId, siteId)).limit(1);
  const pending = await executor.select({ id: cmsReleases.id, base: cmsReleases.baseGenerationId }).from(cmsReleases).where(buildWhere(eq(cmsReleases.siteId, siteId), inArray(cmsReleases.status, ['draft', 'building', 'ready', 'scheduled']))).orderBy(cmsReleases.id);
  const tasks = await executor.select({ id: asyncTasks.id, taskType: asyncTasks.taskType, payload: asyncTasks.payload }).from(asyncTasks).where(buildWhere(like(asyncTasks.taskType, 'cms-%'), inArray(asyncTasks.status, ['pending', 'running']))).orderBy(asyncTasks.id);
  const references = new Map<number, string[]>();
  const protect = (id: number | null, reason: string) => { if (id) references.set(id, [...references.get(id) ?? [], reason]); };
  protect(pointer?.activeGenerationId ?? null, '站点当前生效版本');
  for (const release of pending) protect(release.base, `发布单 #${release.id} 的构建基础`);
  for (const task of tasks) if (![CMS_DEPLOYMENT_CLEANUP_TASK, CMS_DEPLOYMENT_MEASURE_TASK].includes(task.taskType)) {
    const ids = cmsTaskDeploymentReferences(task.payload);
    for (const id of ids) protect(id, `执行中的任务 #${task.id} 引用`);
    if (!ids.length && Number(task.payload.siteId) === siteId && /cdn|delivery|verif/iu.test(task.taskType)) {
      const generations = await executor.select({ id: cmsDeployments.id }).from(cmsDeployments).where(eq(cmsDeployments.siteId, siteId));
      for (const generation of generations) protect(generation.id, `站点交付任务 #${task.id} 尚未完成`);
    }
  }
  return { references, tasks, activeGenerationId: pointer?.activeGenerationId ?? null };
}

/** Only compact identity/state facts are read across the site; manifests are never parsed in online queries. */
async function capacityContext(siteId: number, executor: DbExecutor, ownCleanupTaskId?: number) {
  const rows = await executor.select({ id: cmsDeployments.id, status: cmsDeployments.status, releaseStatus: cmsReleases.status,
    releaseDeploymentId: cmsReleases.deploymentId, releaseBaseGenerationId: cmsReleases.baseGenerationId,
    createdAt: cmsDeployments.createdAt, updatedAt: cmsDeployments.updatedAt, activatedAt: cmsDeployments.activatedAt,
    pinned: cmsDeploymentStorage.pinned, storageState: cmsDeploymentStorage.storageState, cleanupTaskId: cmsDeploymentStorage.cleanupTaskId,
    version: cmsDeploymentStorage.version, measuredAt: cmsDeploymentStorage.measuredAt,
  }).from(cmsDeployments).innerJoin(cmsReleases, eq(cmsReleases.id, cmsDeployments.releaseId)).leftJoin(cmsDeploymentStorage, eq(cmsDeploymentStorage.deploymentId, cmsDeployments.id)).where(eq(cmsDeployments.siteId, siteId)).orderBy(desc(cmsDeployments.id));
  const { references, tasks, activeGenerationId } = await cmsDeploymentReferences(siteId, executor);
  const policy = await readCmsDeploymentRetentionPolicy(siteId, executor);
  const facts = rows.map(row => ({ id: row.id, status: row.status, releaseStatus: row.releaseStatus,
    pinned: row.pinned ?? false, storageState: row.storageState ?? 'available' as const,
    pendingCandidate: isCmsPendingCandidate(row.id, { status: row.releaseStatus, deploymentId: row.releaseDeploymentId, baseGenerationId: row.releaseBaseGenerationId }, activeGenerationId),
    ageFrom: (row.status === 'failed' ? row.updatedAt : row.activatedAt ?? row.createdAt).toISOString(),
    protectedBy: [...references.get(row.id) ?? [], ...(row.cleanupTaskId && row.cleanupTaskId !== ownCleanupTaskId && tasks.some(task => task.id === row.cleanupTaskId) ? [`回收任务 #${row.cleanupTaskId} 正在执行`] : [])],
  }));
  return { rows, policy, decisions: cmsDeploymentRetentionDecisions(facts, policy) };
}
type CapacityContext = Awaited<ReturnType<typeof capacityContext>>;
type CapacityPage = Pick<QueryOutputOf<typeof cmsDeploymentRetentionContract.list>, 'page' | 'pageSize'>;
async function capacityRows(siteId: number, executor: DbExecutor, context: CapacityContext, filter: { ids?: number[]; pagination?: CapacityPage } = {}): Promise<CmsDeploymentCapacityRow[]> {
  if (filter.ids && !filter.ids.length) return [];
  const query = executor.select({ deployment: { id: cmsDeployments.id, siteId: cmsDeployments.siteId, releaseId: cmsDeployments.releaseId, status: cmsDeployments.status, createdAt: cmsDeployments.createdAt, activatedAt: cmsDeployments.activatedAt },
    releaseName: cmsReleases.name, releaseStatus: cmsReleases.status, storage: cmsDeploymentStorage,
  }).from(cmsDeployments).innerJoin(cmsReleases, eq(cmsReleases.id, cmsDeployments.releaseId)).leftJoin(cmsDeploymentStorage, eq(cmsDeploymentStorage.deploymentId, cmsDeployments.id))
    .where(buildWhere(eq(cmsDeployments.siteId, siteId), filter.ids ? inArray(cmsDeployments.id, filter.ids) : undefined)).orderBy(desc(cmsDeployments.id)).$dynamic();
  const rows = await (filter.pagination ? withPagination(query, filter.pagination.page, filter.pagination.pageSize) : query);
  return rows.map(({ deployment: item, storage, releaseName, releaseStatus }) => ({ id: item.id, siteId, releaseId: item.releaseId, releaseName, releaseStatus, status: item.status,
    storageState: storage?.storageState ?? 'available', version: storage?.version ?? 0, pinned: storage?.pinned ?? false, pinReason: storage?.pinReason ?? null,
    schemaBytes: storage?.schemaBytes ?? null, fileBytes: storage?.fileBytes ?? null, fileCount: storage?.fileCount ?? null, measuredAt: formatNullableDateTime(storage?.measuredAt),
    schemaPurgedAt: formatNullableDateTime(storage?.schemaPurgedAt), filesPurgedAt: formatNullableDateTime(storage?.filesPurgedAt), purgedAt: formatNullableDateTime(storage?.purgedAt), cleanupTaskId: storage?.cleanupTaskId ?? null, error: storage?.error ?? null,
    createdAt: formatDateTime(item.createdAt), activatedAt: formatNullableDateTime(item.activatedAt), protectedReasons: context.decisions.get(item.id)!, eligible: context.decisions.get(item.id)!.length === 0,
  }));
}
export async function listCmsDeploymentCapacity(query: QueryOutputOf<typeof cmsDeploymentRetentionContract.list>) {
  await assertCmsDeploymentCapacityAccess(query.siteId);
  return readSnapshot(async tx => {
    const context = await capacityContext(query.siteId, tx);
    const total = await tx.$count(cmsDeployments, eq(cmsDeployments.siteId, query.siteId));
    return { list: await capacityRows(query.siteId, tx, context, { pagination: query }), total, page: query.page, pageSize: query.pageSize };
  });
}
export async function getCmsDeploymentCapacitySummary(siteId: number) {
  await assertCmsDeploymentCapacityAccess(siteId);
  return readSnapshot(async tx => {
    const { rows, decisions, policy } = await capacityContext(siteId, tx);
    const [totals] = await tx.select({ schemaBytes: sql<number>`coalesce(sum(${cmsDeploymentStorage.schemaBytes}),0)::double precision`, fileBytes: sql<number>`coalesce(sum(${cmsDeploymentStorage.fileBytes}),0)::double precision` })
      .from(cmsDeploymentStorage).innerJoin(cmsDeployments, eq(cmsDeployments.id, cmsDeploymentStorage.deploymentId)).where(buildWhere(eq(cmsDeployments.siteId, siteId), sql`${cmsDeploymentStorage.storageState}<>'purged'`));
    return { retained: rows.filter(row => row.storageState !== 'purged').length, purged: rows.filter(row => row.storageState === 'purged').length,
      protected: rows.filter(row => decisions.get(row.id)!.length && row.storageState !== 'purged').length, eligible: rows.filter(row => !decisions.get(row.id)!.length).length,
      schemaBytes: Number(totals.schemaBytes), fileBytes: Number(totals.fileBytes), unmeasured: rows.filter(row => row.storageState !== 'purged' && !row.measuredAt).length, policy };
  });
}
export async function saveCmsDeploymentRetentionPolicy(siteId: number, input: BodyOf<typeof cmsDeploymentRetentionContract.savePolicy>) {
  await assertCmsDeploymentCapacityAccess(siteId);
  await db.transaction(async tx => {
    await acquireCmsSitePublishLock(tx, siteId);
    const current = await readCmsDeploymentRetentionPolicy(siteId, tx);
    if (current.version !== input.expectedVersion) throw new HTTPException(409, { message: '保留策略已变化，请刷新后重试' });
    const { expectedVersion, ...rules } = input;
    await tx.insert(cmsDeploymentRetentionPolicies).values({ siteId, version: expectedVersion + 1, ...rules }).onConflictDoUpdate({ target: cmsDeploymentRetentionPolicies.siteId, set: { ...rules, version: expectedVersion + 1, updatedAt: new Date() } });
  });
  return readCmsDeploymentRetentionPolicy(siteId);
}
export async function pinCmsDeployment(deploymentId: number, input: BodyOf<typeof cmsDeploymentRetentionContract.pin>) {
  const [deployment] = await db.select({ siteId: cmsDeployments.siteId }).from(cmsDeployments).where(eq(cmsDeployments.id, deploymentId)).limit(1);
  const siteId = requireRow(deployment, '部署不存在').siteId; await assertCmsDeploymentCapacityAccess(siteId);
  await db.transaction(async tx => {
    await acquireCmsSitePublishLock(tx, siteId);
    const [current] = await tx.select().from(cmsDeploymentStorage).where(eq(cmsDeploymentStorage.deploymentId, deploymentId)).for('update').limit(1);
    if (current && current.storageState !== 'available') throw new HTTPException(409, { message: '回收已经开始或完成，不能再设为保留版本' });
    if ((current?.version ?? 0) !== input.expectedVersion) throw new HTTPException(409, { message: '部署保留标记已变化，请刷新后重试' });
    await tx.insert(cmsDeploymentStorage).values({ deploymentId, version: input.expectedVersion + 1, pinned: input.pinned, pinReason: input.pinned ? input.reason : null }).onConflictDoUpdate({ target: cmsDeploymentStorage.deploymentId, set: { version: input.expectedVersion + 1, pinned: input.pinned, pinReason: input.pinned ? input.reason : null, updatedAt: new Date() } });
  });
  return readSnapshot(async tx => requireRow((await capacityRows(siteId, tx, await capacityContext(siteId, tx), { ids: [deploymentId] }))[0], '部署不存在'));
}
export async function previewCmsDeploymentCleanup(siteId: number, options?: { executor?: DbExecutor; skipAccess?: boolean }) {
  if (!options?.skipAccess) await assertCmsDeploymentCapacityAccess(siteId);
  const read = async (executor: DbExecutor) => {
    const context = await capacityContext(siteId, executor);
    const candidateIds = context.rows.filter(row => !context.decisions.get(row.id)!.length).map(row => row.id);
    const candidates = await capacityRows(siteId, executor, context, { ids: candidateIds.slice(0, 1000) });
    const fingerprint = createHash('sha256').update(JSON.stringify({ siteId, policy: context.policy, rows: context.rows.map(row => ({ id: row.id, version: row.version ?? 0, storageState: row.storageState ?? 'available', reasons: context.decisions.get(row.id) })) })).digest('hex');
    return { fingerprint, candidates, totalCandidates: candidateIds.length, bytes: candidates.reduce((sum, row) => sum + (row.schemaBytes ?? 0) + (row.fileBytes ?? 0), 0), unmeasured: candidates.filter(row => !row.measuredAt).length, protectedCount: context.rows.filter(row => context.decisions.get(row.id)!.length && row.storageState !== 'purged').length };
  };
  return options?.executor ? read(options.executor) : readSnapshot(read);
}
