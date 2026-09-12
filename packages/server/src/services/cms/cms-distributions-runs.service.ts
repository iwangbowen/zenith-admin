import { requireRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import { enumValueOf, type QueryOutputOf } from '@zenith/shared/core';
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  lte,
  sql,
  type SQL,
} from 'drizzle-orm';
import { CMS_DISTRIBUTION_TASK_STATUSES, cmsDistributionContract } from '@zenith/shared/cms';
import { db } from '../../db';
import {
  asyncTaskItems,
  asyncTasks,
  cmsDistributionRules,
  cmsSites,
} from '../../db/schema';
import { formatDateTime } from '../../lib/datetime';
import { pageOffset } from '../../lib/pagination';
import { buildWhere, dateRangeConditions } from '../../lib/where-helpers';
import logger from '../../lib/logger';
import { runWithCurrentUser } from '../../lib/context';
import { mapAsyncTask } from '../../lib/task-center';
import { assertSiteAccess, getAccessibleSiteIds } from './cms-sites.service';
import { DISTRIBUTION_TASK_TYPE, nextSchedule, SYSTEM_USER } from './cms-distributions-shared';
import { submitCmsDistributionRun } from './cms-distributions-sync.service';
import { mapAsyncTaskItem } from '../../lib/task-center';

export type CmsDistributionRunListFilter = Omit<QueryOutputOf<typeof cmsDistributionContract.runs>, 'page' | 'pageSize'>;

/** 分发同步记录共用的任务级范围条件：任务类型 + 站点可见性 + 列表筛选 */
export async function buildCmsDistributionRunWhere(
  query: CmsDistributionRunListFilter,
): Promise<SQL | undefined> {
  const accessible = await getAccessibleSiteIds();
  let accessibleSourceCondition: SQL | undefined;
  let accessibleTargetCondition: SQL | undefined;
  if (accessible !== null) {
    if (!accessible.length) accessibleSourceCondition = sql`false`;
    else {
      const values = sql.join(accessible.map((id) => sql`${String(id)}`), sql`, `);
      accessibleSourceCondition = sql`${asyncTasks.payload}->>'sourceSiteId' in (${values})`;
      accessibleTargetCondition = sql`${asyncTasks.payload}->>'targetSiteId' in (${values})`;
    }
  }
  let siteCondition: SQL | undefined;
  if (query.siteId) {
    await assertSiteAccess(query.siteId);
    siteCondition = sql`(
      ${asyncTasks.payload}->>'sourceSiteId' = ${String(query.siteId)}
      or ${asyncTasks.payload}->>'targetSiteId' = ${String(query.siteId)}
    )`;
  }
  return buildWhere(
    eq(asyncTasks.taskType, DISTRIBUTION_TASK_TYPE),
    accessibleSourceCondition,
    accessibleTargetCondition,
    query.ruleId ? sql`${asyncTasks.payload}->>'ruleId' = ${String(query.ruleId)}` : undefined,
    siteCondition,
    query.status ? eq(asyncTasks.status, query.status) : undefined,
    ...dateRangeConditions(asyncTasks.createdAt, query.startTime, query.endTime),
  );
}

async function mapRuns(rows: Array<typeof asyncTasks.$inferSelect>) {
  const ruleIds = [...new Set(rows.map((row) => Number(row.payload.ruleId)).filter((id) => id > 0))];
  const siteIds = [...new Set(rows.flatMap((row) => [
    Number(row.payload.sourceSiteId),
    Number(row.payload.targetSiteId),
  ]).filter((id) => id > 0))];
  const [rules, sites] = await Promise.all([
    ruleIds.length
      ? db.select({ id: cmsDistributionRules.id, name: cmsDistributionRules.name }).from(cmsDistributionRules)
        .where(inArray(cmsDistributionRules.id, ruleIds))
      : Promise.resolve([]),
    siteIds.length
      ? db.select({ id: cmsSites.id, name: cmsSites.name }).from(cmsSites).where(inArray(cmsSites.id, siteIds))
      : Promise.resolve([]),
  ]);
  return rows.map((row) => {
    const task = mapAsyncTask(row);
    const result = row.result ?? {};
    const ruleId = Number(row.payload.ruleId);
    const sourceSiteId = Number(row.payload.sourceSiteId);
    const targetSiteId = Number(row.payload.targetSiteId);
    return {
      ...task,
      ruleId,
      ruleName: rules.find((rule) => rule.id === ruleId)?.name ?? null,
      sourceSiteId,
      sourceSiteName: sites.find((site) => site.id === sourceSiteId)?.name ?? null,
      targetSiteId,
      targetSiteName: sites.find((site) => site.id === targetSiteId)?.name ?? null,
      trigger: ['scheduled', 'mapping-update'].includes(String(row.payload.trigger))
        ? row.payload.trigger as 'scheduled' | 'mapping-update'
        : 'manual' as const,
      succeeded: Number(result.succeeded ?? 0),
      skipped: Number(result.skipped ?? 0),
      conflicts: Number(result.conflicts ?? 0),
    };
  });
}

export async function listCmsDistributionRuns(query: QueryOutputOf<typeof cmsDistributionContract.runs>) {
  const where = await buildCmsDistributionRunWhere(query);
  return buildListResult({
    page: query.page,
    pageSize: query.pageSize,
    count: () => db.$count(asyncTasks, where),
    rows: async () => mapRuns(await db.select().from(asyncTasks).where(where).orderBy(desc(asyncTasks.id))
      .limit(query.pageSize).offset(pageOffset(query.page, query.pageSize))),
  });
}

async function ensureDistributionRunAccessible(id: number) {
  const runWhere = await buildCmsDistributionRunWhere({});
  const [row] = await db.select().from(asyncTasks).where(and(eq(asyncTasks.id, id), runWhere)).limit(1);
  return requireRow(row, '分发同步记录不存在');
}

export async function getCmsDistributionRunDetail(id: number) {
  const row = await ensureDistributionRunAccessible(id);
  const [run] = await mapRuns([row]);
  const items = await db.select().from(asyncTaskItems)
    .where(eq(asyncTaskItems.taskId, id))
    .orderBy(asc(asyncTaskItems.id))
    .limit(5000);
  return { run, items: items.map(mapAsyncTaskItem) };
}

export async function loadCmsDistributionExportRows(query: Record<string, unknown>) {
  const positive = (value: unknown) => {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
  };
  const where = await buildCmsDistributionRunWhere({
    ruleId: positive(query.ruleId),
    siteId: positive(query.siteId),
    status: enumValueOf(CMS_DISTRIBUTION_TASK_STATUSES, query.status),
    startTime: typeof query.startTime === 'string' ? query.startTime : undefined,
    endTime: typeof query.endTime === 'string' ? query.endTime : undefined,
  });
  const rows = await db.select({ task: asyncTasks, item: asyncTaskItems })
    .from(asyncTaskItems)
    .innerJoin(asyncTasks, eq(asyncTaskItems.taskId, asyncTasks.id))
    .where(where)
    .orderBy(desc(asyncTasks.id), asc(asyncTaskItems.id))
    .limit(50_000);
  const mappedRuns = await mapRuns([...new Map(rows.map(({ task }) => [task.id, task])).values()]);
  const runById = new Map(mappedRuns.map((run) => [run.id, run]));
  return rows.map(({ task, item }) => {
    const run = runById.get(task.id)!;
    return {
      taskId: task.id,
      ruleId: run.ruleId,
      ruleName: run.ruleName ?? '',
      sourceSite: run.sourceSiteName ?? `#${run.sourceSiteId}`,
      targetSite: run.targetSiteName ?? `#${run.targetSiteId}`,
      trigger: run.trigger,
      sourceContentId: Number(item.data?.sourceContentId) || null,
      targetContentId: Number(item.data?.targetContentId) || null,
      outcome: typeof item.data?.outcome === 'string' ? item.data.outcome : item.status,
      title: item.label ?? '',
      message: item.message ?? '',
      createdAt: formatDateTime(task.createdAt),
    };
  });
}

export async function dispatchDueCmsDistributionRules(): Promise<string> {
  const now = new Date();
  const due = await db.select({ id: cmsDistributionRules.id }).from(cmsDistributionRules).where(and(
    eq(cmsDistributionRules.mode, 'scheduled'),
    eq(cmsDistributionRules.status, 'enabled'),
    isNotNull(cmsDistributionRules.nextRunAt),
    lte(cmsDistributionRules.nextRunAt, now),
  )).orderBy(asc(cmsDistributionRules.nextRunAt)).limit(100);
  let submitted = 0;
  let failures = 0;
  for (const { id } of due) {
    const claimed = await db.transaction(async (tx) => {
      const lock = await tx.execute(sql`select pg_try_advisory_xact_lock(hashtext('cms-distribution-schedule'), ${id}) as locked`);
      if (!(lock[0] as { locked?: boolean } | undefined)?.locked) return null;
      const [rule] = await tx.select().from(cmsDistributionRules).where(and(
        eq(cmsDistributionRules.id, id),
        eq(cmsDistributionRules.mode, 'scheduled'),
        eq(cmsDistributionRules.status, 'enabled'),
        isNotNull(cmsDistributionRules.nextRunAt),
        lte(cmsDistributionRules.nextRunAt, now),
      )).for('update').limit(1);
      if (!rule) return null;
      const slot = formatDateTime(rule.nextRunAt!);
      await tx.update(cmsDistributionRules).set({
        nextRunAt: nextSchedule(rule.scheduleCron, rule.nextRunAt!),
      }).where(eq(cmsDistributionRules.id, id));
      return { rule, slot };
    });
    if (!claimed) continue;
    try {
      await runWithCurrentUser(SYSTEM_USER, () => submitCmsDistributionRun(claimed.rule.id, 'scheduled', {
        system: true,
        watermark: claimed.slot,
      }));
    } catch (error) {
      await db.update(cmsDistributionRules).set({ nextRunAt: now }).where(and(
        eq(cmsDistributionRules.id, claimed.rule.id),
        eq(cmsDistributionRules.revision, claimed.rule.revision),
        eq(cmsDistributionRules.status, 'enabled'),
      ));
      failures += 1;
      logger.error(`[cms-distribution] 定时规则 #${claimed.rule.id} 提交失败，将在下一轮重试`, error);
      continue;
    }
    submitted += 1;
  }
  return `CMS 定时分发扫描完成：提交 ${submitted} 条规则，待重试 ${failures} 条`;
}

