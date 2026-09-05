import { sql, eq, asc, notInArray } from 'drizzle-orm';
import type { RetentionPolicy, RetentionPreview, RetentionRunResult } from '@zenith/shared/ops';
import { db } from '../../db';
import { retentionPolicies } from '../../db/schema';
import { formatDateTime } from '../datetime';
import logger from '../logger';
import { RETENTION_POLICIES, findPolicy } from './policies';
import type { RetentionPolicyDefinition } from './types';

/** 单次执行的批次上限，避免单表长时间占用清理窗口 */
const MAX_BATCHES = 200;

const DEFAULT_BATCH_SIZE = 5000;

function cutoffFor(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}

/**
 * sql 模板裸插值 Date 无列编码器会导致驱动序列化失败，
 * 统一绑定格式化串并在 SQL 中显式 cast。
 */
function cutoffLiteral(days: number) {
  return sql`${formatDateTime(cutoffFor(days))}::timestamptz`;
}

/** 启动时把代码声明的策略登记进库；已存在的行保留管理员调整值，不回写默认值。 */
export async function registerRetentionPolicies(): Promise<void> {
  for (const policy of RETENTION_POLICIES) {
    await db.insert(retentionPolicies).values({
      policyKey: policy.key,
      enabled: true,
      retentionDays: policy.defaultDays,
      batchSize: policy.batchSize ?? DEFAULT_BATCH_SIZE,
    }).onConflictDoUpdate({
      target: retentionPolicies.policyKey,
      set: { updatedAt: new Date() },
    });
  }
  // 代码中已删除的策略，其残留配置行一并清除
  const known = RETENTION_POLICIES.map((policy) => policy.key);
  if (known.length === 0) return;
  await db.delete(retentionPolicies).where(notInArray(retentionPolicies.policyKey, known));
}

async function loadConfig(key: string) {
  const [row] = await db.select().from(retentionPolicies).where(eq(retentionPolicies.policyKey, key)).limit(1);
  return row;
}

/** 按时间列分批删除；使用 ctid 定位，无需依赖主键类型，且是 PostgreSQL 下最快的批量删除方式。 */
async function purgeByAge(policy: RetentionPolicyDefinition, days: number, batchSize: number): Promise<number> {
  if (days <= 0) return 0;
  const table = sql.identifier(policy.tableName);
  const column = sql.identifier(policy.timeColumn);
  let total = 0;
  for (let i = 0; i < MAX_BATCHES; i++) {
    const res = await db.execute(sql`
      DELETE FROM ${table}
      WHERE ctid IN (
        SELECT ctid FROM ${table}
        WHERE ${column} < ${cutoffLiteral(days)}
        LIMIT ${batchSize}
      )
    `);
    const deleted = (res as unknown as { rowCount?: number }).rowCount ?? 0;
    total += deleted;
    if (deleted < batchSize) break;
  }
  return total;
}

/** 逐租户按各自保留天数裁剪；未覆盖的租户回落到全局天数。 */
async function purgeByTenant(
  policy: RetentionPolicyDefinition,
  fallbackDays: number,
  batchSize: number,
): Promise<number> {
  const perTenant = await policy.perTenant!();
  const table = sql.identifier(policy.tableName);
  const column = sql.identifier(policy.timeColumn);
  let total = 0;

  // 先按各租户自定义天数裁剪
  for (const [tenantId, days] of perTenant) {
    if (days <= 0) continue;
    const tenantMatch = tenantId === null
      ? sql`tenant_id IS NULL`
      : sql`tenant_id = ${tenantId}`;
    for (let i = 0; i < MAX_BATCHES; i++) {
      const res = await db.execute(sql`
        DELETE FROM ${table}
        WHERE ctid IN (
          SELECT ctid FROM ${table}
          WHERE ${tenantMatch} AND ${column} < ${cutoffLiteral(days)}
          LIMIT ${batchSize}
        )
      `);
      const deleted = (res as unknown as { rowCount?: number }).rowCount ?? 0;
      total += deleted;
      if (deleted < batchSize) break;
    }
  }

  // 再用全局天数兜底处理未在设置表中登记的租户
  if (fallbackDays > 0) {
    const covered = [...perTenant.keys()].filter((id): id is number => id !== null);
    const hasNullPolicy = perTenant.has(null);
    const uncovered = covered.length > 0
      ? sql`(tenant_id IS NOT NULL AND tenant_id <> ALL(${covered}))`
      : sql`tenant_id IS NOT NULL`;
    const scope = hasNullPolicy ? uncovered : sql`(${uncovered} OR tenant_id IS NULL)`;
    for (let i = 0; i < MAX_BATCHES; i++) {
      const res = await db.execute(sql`
        DELETE FROM ${table}
        WHERE ctid IN (
          SELECT ctid FROM ${table}
          WHERE ${scope} AND ${column} < ${cutoffLiteral(fallbackDays)}
          LIMIT ${batchSize}
        )
      `);
      const deleted = (res as unknown as { rowCount?: number }).rowCount ?? 0;
      total += deleted;
      if (deleted < batchSize) break;
    }
  }
  return total;
}

/** 在按时间裁剪之外，按分组列只保留最近 capLimit 行。 */
async function purgeByCap(policy: RetentionPolicyDefinition, batchSize: number): Promise<number> {
  const table = sql.identifier(policy.tableName);
  const column = sql.identifier(policy.timeColumn);
  const group = sql.identifier(policy.capColumn!);
  let total = 0;
  for (let i = 0; i < MAX_BATCHES; i++) {
    const res = await db.execute(sql`
      DELETE FROM ${table}
      WHERE ctid IN (
        SELECT ctid FROM (
          SELECT ctid, row_number() OVER (PARTITION BY ${group} ORDER BY ${column} DESC) AS rn
          FROM ${table}
        ) ranked
        WHERE ranked.rn > ${policy.capLimit!}
        LIMIT ${batchSize}
      )
    `);
    const deleted = (res as unknown as { rowCount?: number }).rowCount ?? 0;
    total += deleted;
    if (deleted < batchSize) break;
  }
  return total;
}

/** 执行单条策略，返回删除行数。`days` 可覆盖库中配置（用于手动清理指定天数）。 */
export async function runPolicy(key: string, override?: { days?: number }): Promise<number> {
  const policy = findPolicy(key);
  if (!policy) return 0;
  const config = await loadConfig(key);
  if (!config) return 0;
  if (override?.days === undefined && !config.enabled) return 0;

  const days = override?.days ?? config.retentionDays;
  const batchSize = config.batchSize || DEFAULT_BATCH_SIZE;
  const mode = policy.mode ?? 'age';

  let deleted: number;
  if (mode === 'custom') {
    deleted = days > 0 ? await policy.run!(days, batchSize) : 0;
  } else {
    deleted = policy.perTenant && override?.days === undefined
      ? await purgeByTenant(policy, days, batchSize)
      : await purgeByAge(policy, days, batchSize);
    if (mode === 'ageAndCap' && policy.capColumn && policy.capLimit) {
      deleted += await purgeByCap(policy, batchSize);
    }
  }

  if (deleted > 0 && policy.onDeleted) await policy.onDeleted(deleted);

  await db.update(retentionPolicies)
    .set({ lastRunAt: new Date(), lastDeleted: deleted })
    .where(eq(retentionPolicies.policyKey, key));
  return deleted;
}

/** 预估某策略当前待清理的行数，供后台执行前预览。 */
export async function previewPolicy(key: string): Promise<RetentionPreview> {
  const policy = findPolicy(key);
  const config = policy ? await loadConfig(key) : undefined;
  if (!policy || !config || config.retentionDays <= 0) {
    return { key, pending: 0, cutoff: null };
  }
  if (policy.previewPending) {
    return {
      key,
      pending: await policy.previewPending(config.retentionDays),
      cutoff: formatDateTime(cutoffFor(config.retentionDays)),
    };
  }
  const res = await db.execute(sql`
    SELECT count(*)::int AS pending
    FROM ${sql.identifier(policy.tableName)}
    WHERE ${sql.identifier(policy.timeColumn)} < ${cutoffLiteral(config.retentionDays)}
  `);
  const rows = res as unknown as Array<{ pending: number }>;
  return {
    key,
    pending: Number(rows[0]?.pending ?? 0),
    cutoff: formatDateTime(cutoffFor(config.retentionDays)),
  };
}

/** 定时任务的单条执行结果：API 响应形状之外附带策略标题，供运行日志汇总 */
export type RetentionRunOutcome = RetentionRunResult & { title: string };

/** 定时任务入口：按序执行全部启用策略。单条失败不影响其余策略。 */
export async function runAllPolicies(): Promise<RetentionRunOutcome[]> {
  const results: RetentionRunOutcome[] = [];
  for (const policy of RETENTION_POLICIES) {
    try {
      const deleted = await runPolicy(policy.key);
      if (deleted > 0) results.push({ key: policy.key, title: policy.title, deleted });
    } catch (err) {
      logger.error(`数据保留策略「${policy.title}」执行失败:`, err);
    }
  }
  return results;
}

/** 读取某策略当前生效的保留天数；0 表示不清理。供需要与清理口径保持一致的业务查询使用。 */
export async function getPolicyRetentionDays(key: string): Promise<number> {
  const config = await loadConfig(key);
  if (config) return config.enabled ? config.retentionDays : 0;
  return findPolicy(key)?.defaultDays ?? 0;
}

/** 后台列表：合并代码声明与库中运行期配置。 */
export async function listRetentionPolicies(): Promise<RetentionPolicy[]> {
  const rows = await db.select().from(retentionPolicies).orderBy(asc(retentionPolicies.policyKey));
  const configByKey = new Map(rows.map((row) => [row.policyKey, row]));
  return RETENTION_POLICIES.map((policy) => {
    const config = configByKey.get(policy.key);
    return {
      key: policy.key,
      title: policy.title,
      module: policy.module,
      tableName: policy.tableName,
      timeColumn: policy.timeColumn,
      mode: policy.mode ?? 'age',
      enabled: config?.enabled ?? true,
      retentionDays: config?.retentionDays ?? policy.defaultDays,
      defaultRetentionDays: policy.defaultDays,
      batchSize: config?.batchSize ?? policy.batchSize ?? DEFAULT_BATCH_SIZE,
      perTenant: Boolean(policy.perTenant),
      capColumn: policy.capColumn ?? null,
      capLimit: policy.capLimit ?? null,
      description: policy.description,
      lastRunAt: config?.lastRunAt ? formatDateTime(config.lastRunAt) : null,
      lastDeleted: config?.lastDeleted ?? 0,
    };
  });
}
