import { http, HttpResponse } from 'msw';
import type { RuleDecisionTable, RuleDecisionInput, RuleDecisionOutput, RuleDecisionRow, RuleEvaluateResult } from '@zenith/shared';
import { mockDecisionTables, getNextTableId, mockDecisionVersions, mockTestCases, getNextCaseId, mockExecutions, getNextExecId } from '@/mocks/data/decision-tables';
import { mockDateTime } from '@/mocks/utils/date';

function ok<T>(data: T) { return HttpResponse.json({ code: 0, message: 'ok', data }); }
function fail(message: string, code = 400) { return HttpResponse.json({ code, message, data: null }, { status: code }); }

const get = (obj: Record<string, unknown>, path: string) => path.split('.').reduce<unknown>((o, k) => (o == null ? o : (o as Record<string, unknown>)[k]), obj);
const coerce = (v: unknown, t: string) => v == null ? v : t === 'number' ? Number(v) : t === 'boolean' ? (v === true || v === 'true' || v === '1') : String(v);
function cell(c: string, val: unknown, t: string): boolean {
  const s = (c ?? '').trim();
  if (s === '' || s === '-' || s === '*') return true;
  const m = s.match(/^(>=|<=|==|!=|>|<)\s*(.+)$/);
  if (m) { const n = Number(val), r = Number(m[2]); switch (m[1]) { case '>=': return n >= r; case '<=': return n <= r; case '>': return n > r; case '<': return n < r; case '==': return n === r; case '!=': return n !== r; } }
  const range = s.match(/^(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)$/);
  if (range) { const n = Number(val); return n >= Number(range[1]) && n <= Number(range[2]); }
  return coerce(val, t) === coerce(s, t);
}
function evaluate(table: RuleDecisionTable, input: Record<string, unknown>): RuleEvaluateResult {
  const cols = (table.inputs as RuleDecisionInput[]).map((i) => get(input, i.expr));
  const matched = (table.rules as RuleDecisionRow[]).filter((r) => table.inputs.every((c, i) => cell(r.when[i] ?? '', cols[i], (c as RuleDecisionInput).type)));
  const build = (row: RuleDecisionRow) => {
    const outputs: Record<string, unknown> = {};
    for (const o of table.outputs as RuleDecisionOutput[]) outputs[o.key] = row.then[o.key] ?? o.default ?? null;
    return outputs;
  };
  if (!matched.length) return { matched: false, outputs: {}, matchedRowIds: [], hitPolicy: table.hitPolicy, reason: 'no_match' };
  switch (table.hitPolicy) {
    case 'unique':
      if (matched.length > 1) return { matched: false, outputs: {}, matchedRowIds: matched.map((r) => r.id), hitPolicy: 'unique', reason: 'unique_conflict' };
      return { matched: true, outputs: build(matched[0]), matchedRowIds: [matched[0].id], hitPolicy: 'unique' };
    case 'priority': {
      const top = [...matched].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0];
      return { matched: true, outputs: build(top), matchedRowIds: [top.id], hitPolicy: 'priority' };
    }
    case 'collect':
      return { matched: true, outputs: build(matched[0]), matchedRowIds: matched.map((r) => r.id), hitPolicy: 'collect', collected: matched.map(build) };
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

/** 与后端 dirty 语义对齐：编辑态 vs 最新发布快照（name/hitPolicy/inputs/outputs/rules） */
function computeDirty(row: RuleDecisionTable): boolean {
  const latest = (mockDecisionVersions[row.id] ?? [])[0];
  if (!latest) return false;
  const comparable = (x: { name: string; hitPolicy: string; inputs: unknown; outputs: unknown; rules: unknown }) =>
    JSON.stringify([x.name, x.hitPolicy, x.inputs, x.outputs, x.rules]);
  return comparable(row) !== comparable(latest);
}

function runCases(id: number) {
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
  http.get('/api/rules/decision-tables', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page')) || 1, pageSize = Number(url.searchParams.get('pageSize')) || 20;
    const kw = url.searchParams.get('keyword') ?? '';
    let list = [...mockDecisionTables];
    if (kw) list = list.filter((t) => t.name.includes(kw) || t.key.includes(kw));
    return ok({ list: list.slice((page - 1) * pageSize, page * pageSize), total: list.length, page, pageSize });
  }),
  http.get('/api/rules/decision-tables/executions', ({ request }) => {
    const url = new URL(request.url); const tableId = Number(url.searchParams.get('tableId')) || null; const instanceId = Number(url.searchParams.get('instanceId')) || null;
    return ok(mockExecutions.filter((e) => (!tableId || e.tableId === tableId) && (!instanceId || e.instanceId === instanceId)).slice(0, 50));
  }),
  http.get('/api/rules/decision-tables/:id/versions', ({ params }) => ok(mockDecisionVersions[Number(params.id)] ?? [])),
  http.get('/api/rules/decision-tables/:id/diff', ({ params, request }) => {
    const r = mockDecisionTables.find((t) => t.id === Number(params.id));
    const url = new URL(request.url); const from = Number(url.searchParams.get('from')) || 0;
    const v = (mockDecisionVersions[Number(params.id)] ?? []).find((x) => x.version === from);
    const changes: Array<{ kind: string; op: string; ref: string; detail: string }> = [];
    if (r && v) {
      if (v.name !== r.name) changes.push({ kind: 'meta', op: 'changed', ref: 'name', detail: `${v.name} → ${r.name}` });
      if ((v.rules as unknown[]).length !== r.rules.length) changes.push({ kind: 'rule', op: 'changed', ref: 'count', detail: `规则数 ${(v.rules as unknown[]).length} → ${r.rules.length}` });
    }
    return ok({ from, to: 0, changes });
  }),
  http.post('/api/rules/decision-tables/:id/rollback/:version', ({ params }) => {
    const r = mockDecisionTables.find((t) => t.id === Number(params.id));
    const v = (mockDecisionVersions[Number(params.id)] ?? []).find((x) => x.version === Number(params.version));
    if (!r || !v) return fail('版本不存在', 404);
    Object.assign(r, { name: v.name, hitPolicy: v.hitPolicy, inputs: v.inputs, outputs: v.outputs, rules: v.rules, status: 'draft' });
    r.dirty = computeDirty(r);
    return ok(r);
  }),
  http.get('/api/rules/decision-tables/:id', ({ params }) => {
    const row = mockDecisionTables.find((t) => t.id === Number(params.id));
    return row ? ok(row) : fail('决策表不存在', 404);
  }),
  http.post('/api/rules/decision-tables', async ({ request }) => {
    const b = (await request.json()) as Partial<RuleDecisionTable>;
    const now = mockDateTime();
    const row: RuleDecisionTable = { id: getNextTableId(), key: b.key!, name: b.name!, description: b.description ?? null, categoryId: null, status: 'draft', hitPolicy: b.hitPolicy ?? 'first', inputs: b.inputs ?? [], outputs: b.outputs ?? [], rules: b.rules ?? [], version: 1, publishedAt: null, dirty: false, createdAt: now, updatedAt: now };
    mockDecisionTables.unshift(row);
    return ok(row);
  }),
  http.put('/api/rules/decision-tables/:id', async ({ params, request }) => {
    const i = mockDecisionTables.findIndex((t) => t.id === Number(params.id));
    if (i === -1) return fail('决策表不存在', 404);
    const { expectedUpdatedAt, ...body } = (await request.json()) as Record<string, unknown> & { expectedUpdatedAt?: string };
    if (expectedUpdatedAt && expectedUpdatedAt !== mockDecisionTables[i].updatedAt) return fail('决策表已被他人修改，请刷新后重试', 409);
    mockDecisionTables[i] = { ...mockDecisionTables[i], ...body, updatedAt: mockDateTime() };
    mockDecisionTables[i].dirty = computeDirty(mockDecisionTables[i]);
    return ok(mockDecisionTables[i]);
  }),
  http.post('/api/rules/decision-tables/:id/toggle', async ({ params, request }) => {
    const r = mockDecisionTables.find((t) => t.id === Number(params.id));
    if (!r) return fail('决策表不存在', 404);
    const { enabled } = (await request.json()) as { enabled: boolean };
    r.status = enabled ? (r.publishedAt ? 'published' : 'draft') : 'disabled';
    return ok(r);
  }),
  http.post('/api/rules/decision-tables/:id/publish', ({ params }) => {
    const r = mockDecisionTables.find((t) => t.id === Number(params.id));
    if (!r) return fail('决策表不存在', 404);
    const run = runCases(r.id);
    if (run.failed > 0) return fail(`发布受阻：${run.failed}/${run.total} 个用例未通过`);
    if (run.total > 0 && run.coverage < 100) return fail(`发布受阻：覆盖率 ${run.coverage}%`);
    (mockDecisionVersions[r.id] ??= []).unshift({ version: r.version, name: r.name, hitPolicy: r.hitPolicy, inputs: r.inputs, outputs: r.outputs, rules: r.rules, publishedAt: mockDateTime() });
    r.status = 'published'; r.publishedAt = mockDateTime(); r.version += 1; r.dirty = false;
    return ok(r);
  }),
  http.get('/api/rules/decision-tables/:id/cases', ({ params }) => ok(mockTestCases[Number(params.id)] ?? [])),
  http.post('/api/rules/decision-tables/:id/cases', async ({ params, request }) => {
    const id = Number(params.id); const b = (await request.json()) as { name: string; input?: Record<string, unknown>; expected?: Record<string, unknown> };
    const now = mockDateTime(); const c = { id: getNextCaseId(), tableId: id, name: b.name, input: b.input ?? {}, expected: b.expected ?? {}, createdAt: now, updatedAt: now };
    (mockTestCases[id] ??= []).unshift(c); return ok(c);
  }),
  http.post('/api/rules/decision-tables/:id/cases/run', ({ params }) => ok(runCases(Number(params.id)))),
  http.put('/api/rules/decision-tables/:id/cases/:caseId', async ({ params, request }) => {
    const arr = mockTestCases[Number(params.id)] ?? [];
    const i = arr.findIndex((c) => c.id === Number(params.caseId));
    if (i === -1) return fail('测试用例不存在', 404);
    const b = (await request.json()) as { name?: string; input?: Record<string, unknown>; expected?: Record<string, unknown> };
    arr[i] = { ...arr[i], ...b, updatedAt: mockDateTime() };
    return ok(arr[i]);
  }),
  http.delete('/api/rules/decision-tables/:id/cases/:caseId', ({ params }) => {
    const arr = mockTestCases[Number(params.id)] ?? []; const i = arr.findIndex((c) => c.id === Number(params.caseId));
    if (i >= 0) arr.splice(i, 1); return ok(null);
  }),
  http.post('/api/rules/decision-tables/:id/test', async ({ params, request }) => {
    const r = mockDecisionTables.find((t) => t.id === Number(params.id));
    if (!r) return fail('决策表不存在', 404);
    const { input } = (await request.json()) as { input: Record<string, unknown> };
    const res = evaluate(r, input ?? {});
    mockExecutions.unshift({ id: getNextExecId(), ruleKey: r.key, tableId: r.id, instanceId: null, nodeKey: null, source: 'test', matched: res.matched, hitPolicy: r.hitPolicy, input: input ?? {}, outputs: res.outputs, matchedRowIds: res.matchedRowIds, createdAt: mockDateTime() });
    return ok(res);
  }),
  http.post('/api/rules/decision-tables/evaluate', async ({ request }) => {
    const { key, input } = (await request.json()) as { key: string; input: Record<string, unknown> };
    const r = mockDecisionTables.find((t) => t.key === key);
    if (!r) return fail('决策表不存在', 404);
    if (r.status === 'disabled') return fail('决策表已禁用');
    return ok(evaluate(r, input ?? {}));
  }),
  http.delete('/api/rules/decision-tables/:id', ({ params }) => {
    const i = mockDecisionTables.findIndex((t) => t.id === Number(params.id));
    if (i === -1) return fail('决策表不存在', 404);
    mockDecisionTables.splice(i, 1);
    return ok(null);
  }),
];
