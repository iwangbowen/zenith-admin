/**
 * 规则执行留痕服务（全资产通用）：异步批写队列 + 分页查询。
 *
 * 写入走内存队列批量落盘（削峰，不阻塞求值热路径），流水尽力而为，不阻断业务；
 * 每条记录携带 refKind / caller / version，执行记录页可按资产类型与调用方分析。
 */
import { desc, eq, inArray } from 'drizzle-orm';
import type { QueryOutputOf } from '@zenith/shared/core';
import type { RuleExecution, RuleExecutionSource, RuleHitPolicy, RuleRefKind } from '@zenith/shared/rules';
import { ruleExecutionContract, RULE_CALLER_LABELS } from '@zenith/shared/rules';
import { db } from '../../db';
import { ruleExecutions, oauth2Clients } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { tenantCondition } from '../../lib/tenant';
import { buildWhere, keywordCondition, dateRangeConditions } from '../../lib/where-helpers';
import { pageOffset } from '../../lib/pagination';
import { formatDateTime } from '../../lib/datetime';
import { buildListResult } from '../../lib/list-query';

type NewExecRow = typeof ruleExecutions.$inferInsert;

const EXEC_FLUSH_INTERVAL_MS = 2_000;
const EXEC_FLUSH_BATCH = 50;
const execWriteQueue: NewExecRow[] = [];
let execFlushTimer: ReturnType<typeof setTimeout> | null = null;

/** 落盘队列中的执行流水（查询前调用，保证刚发生的求值可见） */
export async function flushRuleExecutionQueue(): Promise<void> {
  if (execFlushTimer) { clearTimeout(execFlushTimer); execFlushTimer = null; }
  if (execWriteQueue.length === 0) return;
  const batch = execWriteQueue.splice(0, execWriteQueue.length);
  try { await db.insert(ruleExecutions).values(batch); } catch { /* 执行流水尽力而为，不阻断业务 */ }
}

/** 写一条执行流水（异步批写） */
export function recordRuleExecution(row: NewExecRow): void {
  execWriteQueue.push(row);
  if (execWriteQueue.length >= EXEC_FLUSH_BATCH) {
    void flushRuleExecutionQueue();
    return;
  }
  if (!execFlushTimer) {
    execFlushTimer = setTimeout(() => { void flushRuleExecutionQueue(); }, EXEC_FLUSH_INTERVAL_MS);
    execFlushTimer.unref?.();
  }
}

/** 执行流水入队前的 scope 深拷贝：异步批写期间调用方可能继续改写原对象（如工作流合并输出回 formData） */
export function snapshotRuleScope(scope: Record<string, unknown>): Record<string, unknown> {
  try {
    return structuredClone(scope);
  } catch {
    try { return JSON.parse(JSON.stringify(scope)) as Record<string, unknown>; } catch { return { ...scope }; }
  }
}

const OPEN_CALLER_PREFIX = 'open.';

/**
 * 调用方展示名解析：内置调用方查常量映射；open.{clientId} 按当页去重后的 clientId
 * 一次 IN 查询 OAuth2 应用名（应用已删除时兜底截断 clientId）。留痕本身不落展示名，防应用改名后口径漂移。
 */
async function resolveCallerNames(callers: Array<string | null>): Promise<(caller: string | null) => string | null> {
  const openClientIds = [...new Set(
    callers.filter((c): c is string => !!c?.startsWith(OPEN_CALLER_PREFIX)).map((c) => c.slice(OPEN_CALLER_PREFIX.length)),
  )];
  const apps = openClientIds.length > 0
    ? await db.select({ clientId: oauth2Clients.clientId, name: oauth2Clients.name })
      .from(oauth2Clients).where(inArray(oauth2Clients.clientId, openClientIds))
    : [];
  const nameByClientId = new Map(apps.map((a) => [a.clientId, a.name]));
  return (caller) => {
    if (!caller) return null;
    if (caller.startsWith(OPEN_CALLER_PREFIX)) {
      const clientId = caller.slice(OPEN_CALLER_PREFIX.length);
      return `open.${nameByClientId.get(clientId) ?? `${clientId.slice(0, 8)}…`}`;
    }
    return RULE_CALLER_LABELS[caller] ?? null;
  };
}

export async function listRuleExecutions(q: QueryOutputOf<typeof ruleExecutionContract.list>) {
  // 分页前先落盘缓冲区，保证刚发生的求值可见
  await flushRuleExecutionQueue();
  const { page, pageSize } = q;
  const where = buildWhere(
    tenantCondition(ruleExecutions, currentUser()),
    q.refKind ? eq(ruleExecutions.refKind, q.refKind) : undefined,
    q.refId ? eq(ruleExecutions.refId, q.refId) : undefined,
    q.caller ? eq(ruleExecutions.caller, q.caller) : undefined,
    keywordCondition(q.bizRef, [ruleExecutions.bizRef], 'like', 'prefix'),
    keywordCondition(q.ruleKey, [ruleExecutions.ruleKey]),
    q.source ? eq(ruleExecutions.source, q.source) : undefined,
    q.matched !== undefined ? eq(ruleExecutions.matched, q.matched) : undefined,
    ...dateRangeConditions(ruleExecutions.createdAt, q.dateStart, q.dateEnd),
  );
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(ruleExecutions, where),
    rows: async () => {
      const rows = await db.select().from(ruleExecutions).where(where).orderBy(desc(ruleExecutions.id)).limit(pageSize).offset(pageOffset(page, pageSize));
      const callerNameOf = await resolveCallerNames(rows.map((r) => r.caller));
      return rows.map((r): RuleExecution => ({
        id: r.id,
        refKind: r.refKind as RuleRefKind,
        refId: r.refId,
        ruleKey: r.ruleKey,
        version: r.version,
        caller: r.caller,
        callerName: callerNameOf(r.caller),
        bizRef: r.bizRef,
        source: r.source as RuleExecutionSource,
        matched: r.matched,
        hitPolicy: (r.hitPolicy ?? null) as RuleHitPolicy | null,
        input: (r.input ?? {}) as Record<string, unknown>,
        outputs: (r.outputs ?? {}) as Record<string, unknown>,
        matchedRowIds: (r.matchedRowIds ?? []) as string[],
        createdAt: formatDateTime(r.createdAt),
      }));
    },
  });
}
