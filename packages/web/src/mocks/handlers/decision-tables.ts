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
  if (!matched.length) return { matched: false, outputs: {}, matchedRowIds: [], hitPolicy: table.hitPolicy };
  const row = matched[0];
  const outputs: Record<string, unknown> = {};
  for (const o of table.outputs as RuleDecisionOutput[]) outputs[o.key] = row.then[o.key] ?? o.default ?? null;
  return { matched: true, outputs, matchedRowIds: matched.map((r) => r.id), hitPolicy: table.hitPolicy };
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
    return ok(r);
  }),
  http.get('/api/rules/decision-tables/:id', ({ params }) => {
    const row = mockDecisionTables.find((t) => t.id === Number(params.id));
    return row ? ok(row) : fail('决策表不存在', 404);
  }),
  http.post('/api/rules/decision-tables', async ({ request }) => {
    const b = (await request.json()) as Partial<RuleDecisionTable>;
    const now = mockDateTime();
    const row: RuleDecisionTable = { id: getNextTableId(), key: b.key!, name: b.name!, description: b.description ?? null, categoryId: null, status: 'draft', hitPolicy: b.hitPolicy ?? 'first', inputs: b.inputs ?? [], outputs: b.outputs ?? [], rules: b.rules ?? [], version: 1, publishedAt: null, createdAt: now, updatedAt: now };
    mockDecisionTables.unshift(row);
    return ok(row);
  }),
  http.put('/api/rules/decision-tables/:id', async ({ params, request }) => {
    const i = mockDecisionTables.findIndex((t) => t.id === Number(params.id));
    if (i === -1) return fail('决策表不存在', 404);
    mockDecisionTables[i] = { ...mockDecisionTables[i], ...(await request.json() as object), updatedAt: mockDateTime() };
    return ok(mockDecisionTables[i]);
  }),
  http.post('/api/rules/decision-tables/:id/publish', ({ params }) => {
    const r = mockDecisionTables.find((t) => t.id === Number(params.id));
    if (!r) return fail('决策表不存在', 404);
    const run = runCases(r.id);
    if (run.failed > 0) return fail(`发布受阻：${run.failed}/${run.total} 个用例未通过`);
    if (run.total > 0 && run.coverage < 100) return fail(`发布受阻：覆盖率 ${run.coverage}%`);
    (mockDecisionVersions[r.id] ??= []).unshift({ version: r.version, name: r.name, hitPolicy: r.hitPolicy, inputs: r.inputs, outputs: r.outputs, rules: r.rules, publishedAt: mockDateTime() });
    r.status = 'published'; r.publishedAt = mockDateTime(); r.version += 1;
    return ok(r);
  }),
  http.get('/api/rules/decision-tables/:id/cases', ({ params }) => ok(mockTestCases[Number(params.id)] ?? [])),
  http.post('/api/rules/decision-tables/:id/cases', async ({ params, request }) => {
    const id = Number(params.id); const b = (await request.json()) as { name: string; input?: Record<string, unknown>; expected?: Record<string, unknown> };
    const now = mockDateTime(); const c = { id: getNextCaseId(), tableId: id, name: b.name, input: b.input ?? {}, expected: b.expected ?? {}, createdAt: now, updatedAt: now };
    (mockTestCases[id] ??= []).unshift(c); return ok(c);
  }),
  http.post('/api/rules/decision-tables/:id/cases/run', ({ params }) => ok(runCases(Number(params.id)))),
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
    return ok(evaluate(r, input ?? {}));
  }),
  http.delete('/api/rules/decision-tables/:id', ({ params }) => {
    const i = mockDecisionTables.findIndex((t) => t.id === Number(params.id));
    if (i === -1) return fail('决策表不存在', 404);
    mockDecisionTables.splice(i, 1);
    return ok(null);
  }),
];
