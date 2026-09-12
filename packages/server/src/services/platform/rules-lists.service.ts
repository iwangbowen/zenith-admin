/**
 * 名单库服务（规则中心）：黑/白/灰名单 CRUD、条目管理（含过期）与运行时命中判定。
 */
import { and, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { QueryOutputOf } from '@zenith/shared/core';
import type { RuleListType, RuleListCheckResult, RuleUsageItem } from '@zenith/shared/rules';
import { ruleListContract } from '@zenith/shared/rules';
import { db } from '../../db';
import { ruleLists, ruleListItems, paymentRiskRules } from '../../db/schema';
import { currentUser, currentUserOrNull } from '../../lib/context';
import { tenantCondition, getCreateTenantId } from '../../lib/tenant';
import { buildWhere, keywordCondition } from '../../lib/where-helpers';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { requireFirstRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import { pageOffset } from '../../lib/pagination';
import { formatDateTime, formatNullableDateTime, formatTimestamps, parseDateTimeInput } from '../../lib/datetime';

type ListRow = typeof ruleLists.$inferSelect;
type ItemRow = typeof ruleListItems.$inferSelect;

export function mapRuleList(row: ListRow, itemCount?: number) {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    type: row.type as RuleListType,
    description: row.description ?? null,
    status: row.status,
    itemCount,
    ...formatTimestamps(row),
  };
}

const mapItem = (r: ItemRow) => ({
  id: r.id,
  listId: r.listId,
  value: r.value,
  label: r.label ?? null,
  matchMode: (r.matchMode ?? 'exact') as 'exact' | 'prefix' | 'regex',
  expiresAt: formatNullableDateTime(r.expiresAt),
  remark: r.remark ?? null,
  createdAt: formatDateTime(r.createdAt),
});

export async function ensureRuleList(id: number): Promise<ListRow> {
  const tc = tenantCondition(ruleLists, currentUser());
  return requireFirstRow(
    db.select().from(ruleLists).where(buildWhere(eq(ruleLists.id, id), tc)).limit(1),
    '名单不存在',
  );
}

export async function listRuleLists(q: QueryOutputOf<typeof ruleListContract.list>) {
  const { page, pageSize } = q;
  const where = buildWhere(
    tenantCondition(ruleLists, currentUser()),
    keywordCondition(q.keyword, [ruleLists.name]),
    q.type ? eq(ruleLists.type, q.type) : undefined,
  );
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(ruleLists, where),
    rows: async () => {
      const rows = await db.select().from(ruleLists).where(where).orderBy(desc(ruleLists.id)).limit(pageSize).offset(pageOffset(page, pageSize));
      const ids = rows.map((r) => r.id);
      const counts = ids.length
        ? await db.select({ listId: ruleListItems.listId, count: sql<number>`count(*)::int` })
          .from(ruleListItems).where(inArray(ruleListItems.listId, ids)).groupBy(ruleListItems.listId)
        : [];
      const countByList = new Map(counts.map((c) => [c.listId, c.count]));
      return rows.map((r) => ({ row: r, itemCount: countByList.get(r.id) ?? 0 }));
    },
    map: ({ row, itemCount }) => mapRuleList(row, itemCount),
  });
}

export interface CreateRuleListInput {
  key: string;
  name: string;
  type?: RuleListType;
  description?: string | null;
}

export async function createRuleList(input: CreateRuleListInput) {
  try {
    const [row] = await db.insert(ruleLists).values({
      key: input.key,
      name: input.name,
      type: input.type ?? 'black',
      description: input.description ?? null,
      tenantId: getCreateTenantId(currentUser()),
    }).returning();
    return mapRuleList(row, 0);
  } catch (err) {
    rethrowPgUniqueViolation(err, '名单 key 已存在');
  }
}

export async function updateRuleList(id: number, input: Partial<CreateRuleListInput> & { status?: 'enabled' | 'disabled' }) {
  await ensureRuleList(id);
  const patch: Partial<typeof ruleLists.$inferInsert> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.type !== undefined) patch.type = input.type;
  if (input.description !== undefined) patch.description = input.description;
  if (input.status !== undefined) patch.status = input.status;
  const [row] = await db.update(ruleLists).set(patch).where(eq(ruleLists.id, id)).returning();
  const count = await db.$count(ruleListItems, eq(ruleListItems.listId, id));
  return mapRuleList(row, count);
}

// ─── 引用分析（where-used）与删除保护 ────────────────────────────────────────────

/** 名单引用方：扫描支付风控规则的 blockListKeys / allowListKeys */
export async function listRuleListUsages(id: number): Promise<RuleUsageItem[]> {
  const row = await ensureRuleList(id);
  return findListUsagesByKey(row.key, row.tenantId ?? null);
}

async function findListUsagesByKey(key: string, listTenantId: number | null): Promise<RuleUsageItem[]> {
  const refCond = keywordCondition(`"${key}"`, [sql`${paymentRiskRules.blockListKeys}::text`, sql`${paymentRiskRules.allowListKeys}::text`]);
  // 租户名单只可能被本租户的风控规则引用；平台级（null）名单可被任意租户引用，保持全量扫描
  const rows = await db.select({ id: paymentRiskRules.id, name: paymentRiskRules.name, status: paymentRiskRules.status })
    .from(paymentRiskRules).where(buildWhere(refCond, listTenantId != null ? eq(paymentRiskRules.tenantId, listTenantId) : undefined));
  return rows.map((r) => ({ type: 'paymentRisk' as const, id: r.id, name: r.name, status: r.status }));
}

/** 删除前校验：仍被引用时拒绝删除（停用不受限，作为运维开关保留） */
async function ensureListNotReferenced(row: ListRow): Promise<void> {
  const usages = await findListUsagesByKey(row.key, row.tenantId ?? null);
  if (usages.length === 0) return;
  const names = usages.slice(0, 3).map((u) => u.name).join('、');
  throw new HTTPException(400, { message: `名单「${row.name}」被 ${usages.length} 处引用（${names}${usages.length > 3 ? ' 等' : ''}），请先解除引用后再删除` });
}

export async function deleteRuleList(id: number): Promise<void> {
  const row = await ensureRuleList(id);
  await ensureListNotReferenced(row);
  await db.delete(ruleLists).where(eq(ruleLists.id, id));
}

// ─── 条目管理 ──────────────────────────────────────────────────────────────────

export async function listRuleListItems(listId: number, q: QueryOutputOf<typeof ruleListContract.items>) {
  await ensureRuleList(listId);
  const { page, pageSize } = q;
  const where = buildWhere(
    eq(ruleListItems.listId, listId),
    keywordCondition(q.keyword, [ruleListItems.value]),
  );
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(ruleListItems, where),
    rows: () => db.select().from(ruleListItems).where(where).orderBy(desc(ruleListItems.id)).limit(pageSize).offset(pageOffset(page, pageSize)),
    map: mapItem,
  });
}

export interface CreateRuleListItemInput {
  value: string;
  label?: string | null;
  matchMode?: 'exact' | 'prefix' | 'regex';
  expiresAt?: string | null;
  remark?: string | null;
}

/** 正则条目安全校验：必须可编译，限制长度防 ReDoS 滥用 */
function ensureRegexValid(pattern: string): void {
  if (pattern.length > 128) throw new HTTPException(400, { message: '正则过长（最多 128 字符）' });
  try {
    void new RegExp(pattern);
  } catch {
    throw new HTTPException(400, { message: '正则表达式无法编译' });
  }
}

export async function createRuleListItem(listId: number, input: CreateRuleListItemInput) {
  await ensureRuleList(listId);
  const matchMode = input.matchMode ?? 'exact';
  if (matchMode === 'regex') ensureRegexValid(input.value.trim());
  try {
    const [row] = await db.insert(ruleListItems).values({
      listId,
      value: input.value.trim(),
      label: input.label ?? null,
      matchMode,
      expiresAt: parseDateTimeInput(input.expiresAt) ?? null,
      remark: input.remark ?? null,
      createdBy: currentUser().userId,
    }).returning();
    return mapItem(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '该值已在名单中');
  }
}

/** 批量导入：去重后 onConflictDoNothing，返回实际新增数 */
export async function batchCreateRuleListItems(listId: number, values: string[], expiresAt?: string | null): Promise<number> {
  await ensureRuleList(listId);
  const unique = [...new Set(values.map((v) => v.trim()).filter(Boolean))];
  if (unique.length === 0) return 0;
  const rows = await db.insert(ruleListItems).values(unique.map((value) => ({
    listId,
    value,
    expiresAt: parseDateTimeInput(expiresAt) ?? null,
    createdBy: currentUser().userId,
  }))).onConflictDoNothing({ target: [ruleListItems.listId, ruleListItems.value] }).returning({ id: ruleListItems.id });
  return rows.length;
}

export async function deleteRuleListItem(listId: number, itemId: number): Promise<void> {
  await ensureRuleList(listId);
  await db.delete(ruleListItems).where(and(eq(ruleListItems.id, itemId), eq(ruleListItems.listId, listId)));
}

/** 清理已过期条目，返回删除数 */
export async function purgeExpiredRuleListItems(listId: number): Promise<number> {
  await ensureRuleList(listId);
  const rows = await db.delete(ruleListItems)
    .where(and(eq(ruleListItems.listId, listId), sql`${ruleListItems.expiresAt} IS NOT NULL AND ${ruleListItems.expiresAt} < now()`))
    .returning({ id: ruleListItems.id });
  return rows.length;
}

// ─── 运行时命中判定 ─────────────────────────────────────────────────────────────

export interface RuleListBatchHit {
  key: string;
  listId: number;
  value: string;
  listType: RuleListType;
  label: string | null;
  matchMode: 'exact' | 'prefix' | 'regex';
  expiresAt: string | null;
}

export interface RuleListsBatchResult {
  /** 成功解析且启用的名单（缺失/禁用的 key 不在其中） */
  lists: Array<{ key: string; id: number; type: RuleListType; tenantId: number | null }>;
  /** 全部命中（每个 key×value 至多一条，精确命中优先） */
  hits: RuleListBatchHit[];
}

function runtimeListTenantId(explicit?: number | null): number | null | undefined {
  if (explicit !== undefined) return explicit;
  const u = currentUserOrNull();
  return u ? (u.viewingTenantId ?? u.tenantId ?? null) : undefined;
}

/**
 * 名单批量命中判定（运行时/业务侧通用）：keys × values 全组合一次判定，整批 2~3 条 SQL。
 * 租户精确匹配优先回退平台级；名单禁用或不存在不参与判定；条目过期不命中。
 */
export async function checkRuleListsBatch(keys: string[], values: string[], meta?: { tenantId?: number | null }): Promise<RuleListsBatchResult> {
  const uniqKeys = [...new Set(keys.map((k) => k?.trim()).filter(Boolean))];
  const trimmedValues = [...new Set(values.map((v) => v?.trim()).filter(Boolean))];
  if (uniqKeys.length === 0) return { lists: [], hits: [] };
  const tenantId = runtimeListTenantId(meta?.tenantId);
  const candidates = await db.select().from(ruleLists).where(inArray(ruleLists.key, uniqKeys));
  const resolved: ListRow[] = [];
  for (const key of uniqKeys) {
    const cands = candidates.filter((c) => c.key === key);
    const row = (tenantId != null ? cands.find((r) => r.tenantId === tenantId) : undefined)
      ?? cands.find((r) => r.tenantId == null)
      ?? (tenantId === undefined && cands.length === 1 ? cands[0] : undefined);
    if (row && row.status === 'enabled') resolved.push(row);
  }
  const lists = resolved.map((r) => ({ key: r.key, id: r.id, type: r.type as RuleListType, tenantId: r.tenantId ?? null }));
  if (resolved.length === 0 || trimmedValues.length === 0) return { lists, hits: [] };

  const listIds = resolved.map((r) => r.id);
  const keyByListId = new Map(resolved.map((r) => [r.id, r.key]));
  const typeByListId = new Map(resolved.map((r) => [r.id, r.type as RuleListType]));
  const notExpired = or(isNull(ruleListItems.expiresAt), gt(ruleListItems.expiresAt, new Date()));
  // 精确条目走索引等值批查；前缀/正则条目一次载入逐条匹配（此类条目通常极少）
  const [exactItems, patternItems] = await Promise.all([
    db.select().from(ruleListItems).where(and(
      inArray(ruleListItems.listId, listIds),
      inArray(ruleListItems.value, trimmedValues),
      eq(ruleListItems.matchMode, 'exact'),
      notExpired,
    )),
    db.select().from(ruleListItems).where(and(
      inArray(ruleListItems.listId, listIds),
      sql`${ruleListItems.matchMode} <> 'exact'`,
      notExpired,
    )),
  ]);

  const hits: RuleListBatchHit[] = [];
  const seen = new Set<string>();
  const pushHit = (item: ItemRow, value: string) => {
    const dedupe = `${item.listId}|${value}`;
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    hits.push({
      key: keyByListId.get(item.listId) ?? '',
      listId: item.listId,
      value,
      listType: typeByListId.get(item.listId) ?? 'black',
      label: item.label ?? null,
      matchMode: (item.matchMode ?? 'exact') as 'exact' | 'prefix' | 'regex',
      expiresAt: formatNullableDateTime(item.expiresAt),
    });
  };
  for (const item of exactItems) pushHit(item, item.value);
  for (const item of patternItems) {
    for (const value of trimmedValues) {
      if (item.matchMode === 'prefix' && value.startsWith(item.value)) pushHit(item, value);
      if (item.matchMode === 'regex') {
        try {
          if (new RegExp(item.value).test(value)) pushHit(item, value);
        } catch { /* 无法编译的历史正则视为不命中 */ }
      }
    }
  }
  return { lists, hits };
}

/**
 * 单 key 单值命中判定（批量判定的薄封装）：
 * 租户精确匹配优先回退平台级；名单禁用或不存在视为未命中；条目过期不命中。
 */
export async function checkRuleList(key: string, value: string, meta?: { tenantId?: number | null }): Promise<RuleListCheckResult> {
  const { hits } = await checkRuleListsBatch([key], [value], meta);
  const hit = hits[0];
  if (!hit) return { hit: false };
  return {
    hit: true,
    listType: hit.listType,
    item: { value: hit.value, label: hit.label, matchMode: hit.matchMode, expiresAt: hit.expiresAt },
  };
}
