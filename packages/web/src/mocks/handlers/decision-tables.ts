import type { RuleDecisionTable, RuleDecisionOutput, RuleDecisionRow, RuleDecisionTableVersion, RuleEvaluateResult, RuleCollectAggregate, RuleTestRunResult, RuleUsageItem, RuleVersionChange } from '@zenith/shared/rules';
import { decisionTableContract, matchRuleCell, ruleExecutionContract } from '@zenith/shared/rules';
import { mock } from '@/mocks/utils/contract';
import { badRequest, notFound, conflict } from '@/mocks/utils/handlers';
import { mockDecisionTables, getNextTableId, mockDecisionVersions, getNextVersionId, mockTestCases, getNextCaseId, mockExecutions, getNextExecId } from '@/mocks/data/decision-tables';
import { mockDateTime } from '@/mocks/utils/date';

const get = (obj: Record<string, unknown>, path: string) => path.split('.').reduce<unknown>((o, k) => (o == null ? o : (o as Record<string, unknown>)[k]), obj);
const SIMPLE_PATH = /^[a-zA-Z_$][\w$]*(\.[a-zA-Z_$][\w$]*)*$/;

/** mock 侧输出单元格：字面量或 '=' 简单路径表达式（demo 不引入表达式引擎） */
function resolveThen(raw: unknown, o: RuleDecisionOutput, scope: Record<string, unknown>): unknown {
  if (raw == null) return o.default ?? null;
  if (typeof raw === 'string' && raw.trim().startsWith('=')) {
    const expr = raw.trim().slice(1).trim();
    return SIMPLE_PATH.test(expr) ? (get(scope, expr) ?? o.default ?? null) : (o.default ?? null);
  }
  return raw;
}

function aggregate(collected: Array<Record<string, unknown>>, outputs: RuleDecisionOutput[], mode: RuleCollectAggregate): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const o of outputs) {
    const values = collected.map((c) => c[o.key]);
    if (mode === 'sum') out[o.key] = values.reduce<number>((acc, v) => acc + (Number.isFinite(Number(v)) ? Number(v) : 0), 0);
    else if (mode === 'min' || mode === 'max') {
      const nums = values.map(Number).filter((n) => Number.isFinite(n));
      out[o.key] = nums.length === 0 ? null : (mode === 'min' ? Math.min(...nums) : Math.max(...nums));
    } else if (mode === 'count') out[o.key] = collected.length;
    else if (mode === 'distinct') {
      const seen = new Set<string>();
      out[o.key] = values.filter((v) => { const k = JSON.stringify(v ?? null); if (seen.has(k)) return false; seen.add(k); return true; });
    } else out[o.key] = values;
  }
  return out;
}

function evaluate(table: RuleDecisionTable, input: Record<string, unknown>): RuleEvaluateResult {
  const cols = table.inputs.map((i) => get(input, i.expr));
  const matched = table.rules.filter((r) => table.inputs.every((c, i) => matchRuleCell(r.when[i] ?? '', cols[i], c.type)));
  const build = (row: RuleDecisionRow) => {
    const outputs: Record<string, unknown> = {};
    for (const o of table.outputs) outputs[o.key] = resolveThen(row.then[o.key], o, input);
    return outputs;
  };
  if (!matched.length) {
    if (table.settings?.fallbackToDefaults) {
      const outputs = Object.fromEntries(table.outputs.map((o) => [o.key, o.default ?? null]));
      return { matched: false, outputs, matchedRowIds: [], hitPolicy: table.hitPolicy, reason: 'no_match', usedFallback: true };
    }
    return { matched: false, outputs: {}, matchedRowIds: [], hitPolicy: table.hitPolicy, reason: 'no_match' };
  }
  switch (table.hitPolicy) {
    case 'unique':
      if (matched.length > 1) return { matched: false, outputs: {}, matchedRowIds: matched.map((r) => r.id), hitPolicy: 'unique', reason: 'unique_conflict' };
      return { matched: true, outputs: build(matched[0]), matchedRowIds: [matched[0].id], hitPolicy: 'unique' };
    case 'priority': {
      const top = [...matched].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0];
      return { matched: true, outputs: build(top), matchedRowIds: [top.id], hitPolicy: 'priority' };
    }
    case 'collect': {
      const collected = matched.map(build);
      return { matched: true, outputs: aggregate(collected, table.outputs, table.settings?.collectAggregate ?? 'list'), matchedRowIds: matched.map((r) => r.id), hitPolicy: 'collect', collected };
    }
    case 'any': {
      const all = matched.map(build);
      const head = JSON.stringify(all[0]);
      if (all.some((o) => JSON.stringify(o) !== head)) return { matched: false, outputs: {}, matchedRowIds: matched.map((r) => r.id), hitPolicy: 'any', reason: 'any_conflict' };
      return { matched: true, outputs: all[0], matchedRowIds: matched.map((r) => r.id), hitPolicy: 'any' };
    }
    default:
      return { matched: true, outputs: build(matched[0]), matchedRowIds: [matched[0].id], hitPolicy: table.hitPolicy };
  }
}

/** 供决策流 mock 复用的决策表求值（与后端引擎语义对齐） */
export function evaluateMockDecisionTable(table: RuleDecisionTable, input: Record<string, unknown>): RuleEvaluateResult {
  return evaluate(table, input);
}

/** 与后端 dirty 语义对齐：编辑态 vs 最新发布快照（name/hitPolicy/inputs/outputs/rules/settings） */
function computeDirty(row: RuleDecisionTable): boolean {
  const latest = (mockDecisionVersions[row.id] ?? [])[0];
  if (!latest) return false;
  const comparable = (x: Pick<RuleDecisionTable, 'name' | 'hitPolicy' | 'inputs' | 'outputs' | 'rules' | 'settings'>) =>
    JSON.stringify([x.name, x.hitPolicy, x.inputs, x.outputs, x.rules, x.settings ?? {}]);
  return comparable(row) !== comparable(latest);
}

/** 固化当前编辑态为发布快照（新版本在前） */
function snapshotVersion(r: RuleDecisionTable): RuleDecisionTableVersion {
  return {
    id: getNextVersionId(), tableId: r.id, version: r.version, name: r.name, hitPolicy: r.hitPolicy,
    inputs: r.inputs, outputs: r.outputs, rules: r.rules, settings: r.settings ?? {}, publishedAt: mockDateTime(), publishedBy: 1,
  };
}

function runCases(id: number): RuleTestRunResult {
  const r = mockDecisionTables.find((t) => t.id === id);
  const list = mockTestCases[id] ?? [];
  const covered = new Set<string>();
  const cases = list.map((c) => { const res = r ? evaluate(r, c.input) : { matched: false, outputs: {}, matchedRowIds: [] as string[], hitPolicy: 'first' as const }; res.matchedRowIds.forEach((x) => covered.add(x)); return { id: c.id, name: c.name, pass: JSON.stringify(res.outputs) === JSON.stringify(c.expected), expected: c.expected, actual: res.outputs }; });
  const allIds = (r?.rules ?? []).map((x) => x.id);
  const uncoveredRowIds = allIds.filter((x) => !covered.has(x));
  const coverage = allIds.length ? Math.round((allIds.length - uncoveredRowIds.length) / allIds.length * 100) : 100;
  return { total: cases.length, passed: cases.filter((c) => c.pass).length, failed: cases.filter((c) => !c.pass).length, coverage, uncoveredRowIds, cases };
}

export const decisionTablesHandlers = [
  mock(decisionTableContract.list, ({ query, ok, paginate }) => {
    const { keyword, status } = query;
    let list = [...mockDecisionTables];
    if (keyword) list = list.filter((t) => t.name.includes(keyword) || t.key.includes(keyword));
    if (status) list = list.filter((t) => t.status === status);
    return ok(paginate(list));
  }),
  mock(ruleExecutionContract.list, ({ query, ok, paginate }) => {
    const { refKind, refId, caller, bizRef, ruleKey, source, matched, dateStart, dateEnd } = query;
    const list = mockExecutions.filter((e) =>
      (!refKind || e.refKind === refKind)
      && (!refId || e.refId === refId)
      && (!caller || e.caller === caller)
      && (!bizRef || (e.bizRef ?? '').startsWith(bizRef))
      && (!ruleKey || e.ruleKey.includes(ruleKey))
      && (!source || e.source === source)
      && (matched === undefined || e.matched === matched)
      && (!dateStart || e.createdAt >= dateStart)
      && (!dateEnd || e.createdAt <= dateEnd));
    return ok(paginate(list));
  }),
  mock(decisionTableContract.usages, ({ params, ok }) => {
    const r = mockDecisionTables.find((t) => t.id === params.id);
    if (!r) return notFound('决策表不存在', { status: 404 });
    const usages: RuleUsageItem[] = r.key === 'coupon_eligibility'
      ? [{ type: 'coupon', id: null, name: '优惠券领取资格判定（内置消费方）', status: null }]
      : [];
    return ok(usages);
  }),
  mock(decisionTableContract.stats, ({ params, query, ok }) => {
    const r = mockDecisionTables.find((t) => t.id === params.id);
    if (!r) return notFound('决策表不存在', { status: 404 });
    const days = query.days ?? 30;
    const execs = mockExecutions.filter((e) => e.refKind === 'table' && e.refId === r.id);
    const total = execs.length;
    const matched = execs.filter((e) => e.matched).length;
    const byDayMap = new Map<string, { total: number; matched: number }>();
    const rowHitMap = new Map<string, number>();
    const sourceMap = new Map<string, number>();
    for (const e of execs) {
      const date = e.createdAt.slice(0, 10);
      const day = byDayMap.get(date) ?? { total: 0, matched: 0 };
      day.total += 1;
      if (e.matched) day.matched += 1;
      byDayMap.set(date, day);
      for (const id of e.matchedRowIds) rowHitMap.set(id, (rowHitMap.get(id) ?? 0) + 1);
      sourceMap.set(e.source, (sourceMap.get(e.source) ?? 0) + 1);
    }
    return ok({
      days, total, matched, unmatched: total - matched,
      byDay: [...byDayMap.entries()].map(([date, v]) => ({ date, ...v })).sort((a, b) => a.date.localeCompare(b.date)),
      rowHits: [...rowHitMap.entries()].map(([rowId, count]) => ({ rowId, count })).sort((a, b) => b.count - a.count),
      bySource: [...sourceMap.entries()].map(([source, count]) => ({ source, count })),
    });
  }),
  mock(decisionTableContract.shadowRun, ({ params, body, ok }) => {
    const r = mockDecisionTables.find((t) => t.id === params.id);
    if (!r) return notFound('决策表不存在', { status: 404 });
    const execs = mockExecutions.filter((e) => e.refKind === 'table' && e.refId === r.id).slice(0, body.limit);
    const samples: Array<{ executionId: number; input: Record<string, unknown>; before: Record<string, unknown>; after: Record<string, unknown>; beforeMatched: boolean; afterMatched: boolean }> = [];
    let same = 0;
    for (const e of execs) {
      const res = evaluate(r, e.input);
      const after = res.matched || res.usedFallback ? res.outputs : {};
      // 存量记录 outputs 已是"生效输出"，与后端一致做对称比较
      if (JSON.stringify(e.outputs) === JSON.stringify(after) && e.matched === res.matched) same += 1;
      else if (samples.length < 20) samples.push({ executionId: e.id, input: e.input, before: e.outputs, after, beforeMatched: e.matched, afterMatched: res.matched });
    }
    return ok({ total: execs.length, same, changed: execs.length - same, samples });
  }),
  mock(decisionTableContract.submitReview, ({ params, ok }) => {
    const r = mockDecisionTables.find((t) => t.id === params.id);
    if (!r) return notFound('决策表不存在', { status: 404 });
    if (r.reviewStatus === 'pending') return badRequest('已有待审批的发布申请', { status: 400 });
    r.reviewStatus = 'pending'; r.reviewRequestedBy = 1; r.reviewRequestedAt = mockDateTime(); r.reviewComment = null;
    return ok(r, '已提交审批');
  }),
  mock(decisionTableContract.review, ({ params, body, ok }) => {
    const r = mockDecisionTables.find((t) => t.id === params.id);
    if (!r) return notFound('决策表不存在', { status: 404 });
    if (r.reviewStatus !== 'pending') return badRequest('该决策表没有待审批的发布申请', { status: 400 });
    const { approve, comment } = body;
    r.reviewStatus = null; r.reviewRequestedBy = null; r.reviewRequestedAt = null;
    if (approve) {
      (mockDecisionVersions[r.id] ??= []).unshift(snapshotVersion(r));
      r.status = 'published'; r.publishedAt = mockDateTime(); r.version += 1; r.dirty = false; r.reviewComment = null;
      return ok(r, '已批准并发布');
    }
    r.reviewComment = comment?.trim() || '发布申请已驳回';
    return ok(r, '已驳回');
  }),
  mock(decisionTableContract.versions, ({ params, ok }) => ok(mockDecisionVersions[params.id] ?? [])),
  mock(decisionTableContract.diff, ({ params, query, ok }) => {
    const r = mockDecisionTables.find((t) => t.id === params.id);
    const { from } = query;
    const to = query.to ?? 0;
    const v = (mockDecisionVersions[params.id] ?? []).find((x) => x.version === from);
    const changes: RuleVersionChange[] = [];
    if (r && v) {
      if (v.name !== r.name) changes.push({ kind: 'meta', op: 'changed', ref: 'name', detail: `${v.name} → ${r.name}` });
      if (v.rules.length !== r.rules.length) changes.push({ kind: 'rule', op: 'changed', ref: 'count', detail: `规则数 ${v.rules.length} → ${r.rules.length}` });
    }
    return ok({ from, to, changes });
  }),
  mock(decisionTableContract.rollback, ({ params, ok }) => {
    const r = mockDecisionTables.find((t) => t.id === params.id);
    const v = (mockDecisionVersions[params.id] ?? []).find((x) => x.version === params.version);
    if (!r || !v) return notFound('版本不存在', { status: 404 });
    Object.assign(r, { name: v.name, hitPolicy: v.hitPolicy, inputs: v.inputs, outputs: v.outputs, rules: v.rules, settings: v.settings ?? {}, status: 'draft' });
    r.dirty = computeDirty(r);
    return ok(r);
  }),
  mock(decisionTableContract.detail, ({ params, ok }) => {
    const row = mockDecisionTables.find((t) => t.id === params.id);
    return row ? ok(row) : notFound('决策表不存在', { status: 404 });
  }),
  mock(decisionTableContract.create, ({ body, ok }) => {
    const now = mockDateTime();
    const row: RuleDecisionTable = {
      id: getNextTableId(), key: body.key, name: body.name, description: body.description ?? null, categoryId: body.categoryId ?? null,
      status: 'draft', hitPolicy: body.hitPolicy, inputs: body.inputs, outputs: body.outputs, rules: body.rules, settings: body.settings ?? {},
      version: 1, publishedAt: null, gray: null, dirty: false,
      reviewStatus: null, reviewRequestedBy: null, reviewRequestedAt: null, reviewComment: null,
      createdAt: now, updatedAt: now,
    };
    mockDecisionTables.unshift(row);
    return ok(row);
  }),
  mock(decisionTableContract.update, ({ params, body, ok }) => {
    const i = mockDecisionTables.findIndex((t) => t.id === params.id);
    if (i === -1) return notFound('决策表不存在', { status: 404 });
    const { expectedUpdatedAt, ...patch } = body;
    if (expectedUpdatedAt && expectedUpdatedAt !== mockDecisionTables[i].updatedAt) return conflict('决策表已被他人修改，请刷新后重试', { status: 409 });
    mockDecisionTables[i] = { ...mockDecisionTables[i], ...patch, updatedAt: mockDateTime() };
    mockDecisionTables[i].dirty = computeDirty(mockDecisionTables[i]);
    return ok(mockDecisionTables[i]);
  }),
  mock(decisionTableContract.toggle, ({ params, body, ok }) => {
    const r = mockDecisionTables.find((t) => t.id === params.id);
    if (!r) return notFound('决策表不存在', { status: 404 });
    r.status = body.enabled ? (r.publishedAt ? 'published' : 'draft') : 'disabled';
    return ok(r);
  }),
  mock(decisionTableContract.publish, ({ params, ok }) => {
    const r = mockDecisionTables.find((t) => t.id === params.id);
    if (!r) return notFound('决策表不存在', { status: 404 });
    const run = runCases(r.id);
    if (run.failed > 0) return badRequest(`发布受阻：${run.failed}/${run.total} 个用例未通过`, { status: 400 });
    if (run.total > 0 && run.coverage < 100) return badRequest(`发布受阻：覆盖率 ${run.coverage}%`, { status: 400 });
    (mockDecisionVersions[r.id] ??= []).unshift(snapshotVersion(r));
    r.status = 'published'; r.publishedAt = mockDateTime(); r.version += 1; r.dirty = false;
    return ok(r);
  }),
  mock(decisionTableContract.cases, ({ params, ok }) => ok(mockTestCases[params.id] ?? [])),
  mock(decisionTableContract.createCase, ({ params, body, ok }) => {
    const now = mockDateTime();
    const c = { id: getNextCaseId(), tableId: params.id, name: body.name, input: body.input, expected: body.expected, createdAt: now, updatedAt: now };
    (mockTestCases[params.id] ??= []).unshift(c);
    return ok(c);
  }),
  mock(decisionTableContract.runCases, ({ params, ok }) => ok(runCases(params.id))),
  mock(decisionTableContract.updateCase, ({ params, body, ok }) => {
    const arr = mockTestCases[params.id] ?? [];
    const i = arr.findIndex((c) => c.id === params.caseId);
    if (i === -1) return notFound('测试用例不存在', { status: 404 });
    arr[i] = { ...arr[i], ...body, updatedAt: mockDateTime() };
    return ok(arr[i]);
  }),
  mock(decisionTableContract.removeCase, ({ params, ok }) => {
    const arr = mockTestCases[params.id] ?? [];
    const i = arr.findIndex((c) => c.id === params.caseId);
    if (i >= 0) arr.splice(i, 1);
    return ok(null);
  }),
  mock(decisionTableContract.test, ({ params, body, ok }) => {
    const r = mockDecisionTables.find((t) => t.id === params.id);
    if (!r) return notFound('决策表不存在', { status: 404 });
    const { input } = body;
    const res = evaluate(r, input);
    mockExecutions.unshift({ id: getNextExecId(), refKind: 'table', refId: r.id, ruleKey: r.key, version: null, caller: 'admin.test', callerName: '后台测试', bizRef: null, source: 'test', matched: res.matched, hitPolicy: r.hitPolicy, input, outputs: res.outputs, matchedRowIds: res.matchedRowIds, createdAt: mockDateTime() });
    return ok(res);
  }),
  mock(decisionTableContract.evaluate, ({ body, ok }) => {
    const { key, input } = body;
    const r = mockDecisionTables.find((t) => t.key === key);
    if (!r) return notFound('决策表不存在', { status: 404 });
    if (r.status === 'disabled') return badRequest('决策表已禁用', { status: 400 });
    const res = evaluate(r, input);
    mockExecutions.unshift({ id: getNextExecId(), refKind: 'table', refId: r.id, ruleKey: r.key, version: r.status === 'published' ? r.version : null, caller: 'admin.evaluate', callerName: '后台求值', bizRef: null, source: 'manual', matched: res.matched, hitPolicy: r.hitPolicy, input, outputs: res.outputs, matchedRowIds: res.matchedRowIds, createdAt: mockDateTime() });
    return ok(res);
  }),
  mock(decisionTableContract.remove, ({ params, ok }) => {
    const i = mockDecisionTables.findIndex((t) => t.id === params.id);
    if (i === -1) return notFound('决策表不存在', { status: 404 });
    mockDecisionTables.splice(i, 1);
    return ok(null);
  }),
];
