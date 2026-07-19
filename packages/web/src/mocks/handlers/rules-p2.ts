import { http, HttpResponse } from 'msw';
import type { RuleDecisionFlow, RuleFlowStep, RuleFlowStepTrace, RuleList } from '@zenith/shared';
import { mockDecisionFlows, getNextFlowId, mockRuleLists, mockRuleListItems, getNextListId, getNextListItemId } from '@/mocks/data/rules-p2';
import { mockDecisionTables } from '@/mocks/data/decision-tables';
import { evaluateMockDecisionTable } from './decision-tables';
import { mockDateTime } from '@/mocks/utils/date';

function ok<T>(data: T, message = 'ok') { return HttpResponse.json({ code: 0, message, data }); }
function fail(message: string, code = 400) { return HttpResponse.json({ code, message, data: null }, { status: code }); }

/** mock 决策流求值：与后端 rules-flow 引擎语义对齐（条件跳过/命名空间合并/逐步 trace） */
function evaluateFlow(steps: RuleFlowStep[], input: Record<string, unknown>) {
  const scope: Record<string, unknown> = { ...input };
  const combined: Record<string, unknown> = {};
  const traces: RuleFlowStepTrace[] = [];
  for (const step of steps) {
    const base = { stepId: step.id, tableKey: step.tableKey, label: step.label, matched: false, outputs: {}, matchedRowIds: [] as string[] };
    if (step.condition?.trim()) {
      // demo 简化：仅支持 key === 'value' / key !== 'value' / 布尔取值
      const m = step.condition.trim().match(/^([\w$.]+)\s*(===|!==|==|!=)\s*['"]?([^'"]*)['"]?$/);
      const get = (path: string) => path.split('.').reduce<unknown>((o, k) => (o == null ? o : (o as Record<string, unknown>)[k]), scope);
      const pass = m
        ? ((m[2] === '===' || m[2] === '==') ? String(get(m[1])) === m[3] : String(get(m[1])) !== m[3])
        : Boolean(get(step.condition.trim()));
      if (!pass) { traces.push({ ...base, skipped: true, skipReason: 'condition' }); continue; }
    }
    const table = mockDecisionTables.find((t) => t.key === step.tableKey && t.status !== 'disabled');
    if (!table) { traces.push({ ...base, skipped: true, skipReason: 'unavailable', error: `决策表 ${step.tableKey} 不可用` }); continue; }
    const res = evaluateMockDecisionTable(table, scope);
    const outs = res.matched || res.usedFallback ? res.outputs : {};
    const ns = step.outputNamespace?.trim();
    if (ns) {
      scope[ns] = { ...(scope[ns] as Record<string, unknown> ?? {}), ...outs };
      combined[ns] = { ...(combined[ns] as Record<string, unknown> ?? {}), ...outs };
    } else {
      Object.assign(scope, outs);
      Object.assign(combined, outs);
    }
    traces.push({ ...base, skipped: false, matched: res.matched, outputs: outs, matchedRowIds: res.matchedRowIds, reason: res.reason });
  }
  return { outputs: combined, steps: traces };
}

const flowDirty = (f: RuleDecisionFlow) => !!f.publishedSteps && JSON.stringify(f.steps) !== JSON.stringify(f.publishedSteps);

export const rulesP2Handlers = [
  // ── 决策流 ──────────────────────────────────────────────────────────────────
  http.get('/api/rules/decision-flows', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page')) || 1, pageSize = Number(url.searchParams.get('pageSize')) || 20;
    const kw = url.searchParams.get('keyword') ?? '';
    let list = [...mockDecisionFlows];
    if (kw) list = list.filter((t) => t.name.includes(kw) || t.key.includes(kw));
    return ok({ list: list.slice((page - 1) * pageSize, page * pageSize), total: list.length, page, pageSize });
  }),
  http.post('/api/rules/decision-flows', async ({ request }) => {
    const b = (await request.json()) as Partial<RuleDecisionFlow>;
    const now = mockDateTime();
    const row: RuleDecisionFlow = { id: getNextFlowId(), key: b.key!, name: b.name!, description: b.description ?? null, status: 'draft', steps: b.steps ?? [], publishedSteps: null, version: 1, publishedAt: null, dirty: false, createdAt: now, updatedAt: now };
    mockDecisionFlows.unshift(row);
    return ok(row, '创建成功');
  }),
  http.put('/api/rules/decision-flows/:id', async ({ params, request }) => {
    const r = mockDecisionFlows.find((t) => t.id === Number(params.id));
    if (!r) return fail('决策流不存在', 404);
    const { expectedUpdatedAt, ...body } = (await request.json()) as Record<string, unknown> & { expectedUpdatedAt?: string };
    if (expectedUpdatedAt && expectedUpdatedAt !== r.updatedAt) return fail('决策流已被他人修改，请刷新后重试', 409);
    Object.assign(r, body, { updatedAt: mockDateTime() });
    r.dirty = flowDirty(r);
    return ok(r, '更新成功');
  }),
  http.post('/api/rules/decision-flows/:id/publish', ({ params }) => {
    const r = mockDecisionFlows.find((t) => t.id === Number(params.id));
    if (!r) return fail('决策流不存在', 404);
    if (r.steps.length === 0) return fail('决策流至少需要一个步骤');
    const bad = r.steps.filter((s) => mockDecisionTables.find((t) => t.key === s.tableKey)?.status !== 'published');
    if (bad.length > 0) return fail(`发布受阻：引用的决策表未发布或不存在：${bad.map((s) => s.tableKey).join('、')}`);
    r.status = 'published'; r.publishedSteps = JSON.parse(JSON.stringify(r.steps)); r.publishedAt = mockDateTime(); r.version += 1; r.dirty = false;
    return ok(r, '发布成功');
  }),
  http.post('/api/rules/decision-flows/:id/toggle', async ({ params, request }) => {
    const r = mockDecisionFlows.find((t) => t.id === Number(params.id));
    if (!r) return fail('决策流不存在', 404);
    const { enabled } = (await request.json()) as { enabled: boolean };
    r.status = enabled ? (r.publishedAt ? 'published' : 'draft') : 'disabled';
    return ok(r);
  }),
  http.post('/api/rules/decision-flows/:id/test', async ({ params, request }) => {
    const r = mockDecisionFlows.find((t) => t.id === Number(params.id));
    if (!r) return fail('决策流不存在', 404);
    const { input } = (await request.json()) as { input: Record<string, unknown> };
    return ok(evaluateFlow(r.steps, input ?? {}));
  }),
  http.post('/api/rules/decision-flows/evaluate', async ({ request }) => {
    const { key, input } = (await request.json()) as { key: string; input: Record<string, unknown> };
    const r = mockDecisionFlows.find((t) => t.key === key);
    if (!r) return fail('决策流不存在', 404);
    if (r.status === 'disabled') return fail('决策流已禁用');
    return ok(evaluateFlow(r.status === 'published' && r.publishedSteps ? r.publishedSteps : r.steps, input ?? {}));
  }),
  http.delete('/api/rules/decision-flows/:id', ({ params }) => {
    const i = mockDecisionFlows.findIndex((t) => t.id === Number(params.id));
    if (i === -1) return fail('决策流不存在', 404);
    mockDecisionFlows.splice(i, 1);
    return ok(null, '删除成功');
  }),

  // ── 名单库 ──────────────────────────────────────────────────────────────────
  http.get('/api/rules/lists', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page')) || 1, pageSize = Number(url.searchParams.get('pageSize')) || 20;
    const kw = url.searchParams.get('keyword') ?? '';
    const type = url.searchParams.get('type');
    let list = mockRuleLists.map((l) => ({ ...l, itemCount: mockRuleListItems.filter((i) => i.listId === l.id).length }));
    if (kw) list = list.filter((t) => t.name.includes(kw) || t.key.includes(kw));
    if (type) list = list.filter((t) => t.type === type);
    return ok({ list: list.slice((page - 1) * pageSize, page * pageSize), total: list.length, page, pageSize });
  }),
  http.post('/api/rules/lists/check', async ({ request }) => {
    const { key, value } = (await request.json()) as { key: string; value: string };
    const list = mockRuleLists.find((l) => l.key === key);
    if (!list || list.status !== 'enabled') return ok({ hit: false });
    const item = mockRuleListItems.find((i) => i.listId === list.id && i.value === value.trim() && (!i.expiresAt || i.expiresAt > mockDateTime()));
    return ok(item ? { hit: true, listType: list.type, item: { value: item.value, label: item.label, expiresAt: item.expiresAt } } : { hit: false });
  }),
  http.post('/api/rules/lists', async ({ request }) => {
    const b = (await request.json()) as Partial<RuleList>;
    const now = mockDateTime();
    const row: RuleList = { id: getNextListId(), key: b.key!, name: b.name!, type: b.type ?? 'black', description: b.description ?? null, status: 'enabled', itemCount: 0, createdAt: now, updatedAt: now };
    mockRuleLists.unshift(row);
    return ok(row, '创建成功');
  }),
  http.put('/api/rules/lists/:id', async ({ params, request }) => {
    const r = mockRuleLists.find((t) => t.id === Number(params.id));
    if (!r) return fail('名单不存在', 404);
    Object.assign(r, await request.json() as object, { updatedAt: mockDateTime() });
    return ok(r, '更新成功');
  }),
  http.delete('/api/rules/lists/:id', ({ params }) => {
    const i = mockRuleLists.findIndex((t) => t.id === Number(params.id));
    if (i === -1) return fail('名单不存在', 404);
    const listId = mockRuleLists[i].id;
    mockRuleLists.splice(i, 1);
    for (let k = mockRuleListItems.length - 1; k >= 0; k -= 1) if (mockRuleListItems[k].listId === listId) mockRuleListItems.splice(k, 1);
    return ok(null, '删除成功');
  }),
  http.get('/api/rules/lists/:id/items', ({ params, request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page')) || 1, pageSize = Number(url.searchParams.get('pageSize')) || 20;
    const kw = url.searchParams.get('keyword') ?? '';
    let list = mockRuleListItems.filter((i) => i.listId === Number(params.id));
    if (kw) list = list.filter((i) => i.value.includes(kw));
    list = [...list].reverse();
    return ok({ list: list.slice((page - 1) * pageSize, page * pageSize), total: list.length, page, pageSize });
  }),
  http.post('/api/rules/lists/:id/items/batch', async ({ params, request }) => {
    const listId = Number(params.id);
    const { values, expiresAt } = (await request.json()) as { values: string[]; expiresAt?: string | null };
    const existing = new Set(mockRuleListItems.filter((i) => i.listId === listId).map((i) => i.value));
    let added = 0;
    for (const raw of [...new Set(values.map((v) => v.trim()).filter(Boolean))]) {
      if (existing.has(raw)) continue;
      mockRuleListItems.push({ id: getNextListItemId(), listId, value: raw, label: null, expiresAt: expiresAt ?? null, remark: null, createdAt: mockDateTime() });
      added += 1;
    }
    return ok(null, `导入完成：新增 ${added} 条（重复值已跳过）`);
  }),
  http.post('/api/rules/lists/:id/items/purge-expired', ({ params }) => {
    const listId = Number(params.id);
    const now = mockDateTime();
    let removed = 0;
    for (let k = mockRuleListItems.length - 1; k >= 0; k -= 1) {
      const it = mockRuleListItems[k];
      if (it.listId === listId && it.expiresAt && it.expiresAt < now) { mockRuleListItems.splice(k, 1); removed += 1; }
    }
    return ok(null, `清理完成：删除 ${removed} 条过期条目`);
  }),
  http.post('/api/rules/lists/:id/items', async ({ params, request }) => {
    const listId = Number(params.id);
    const b = (await request.json()) as { value: string; label?: string | null; expiresAt?: string | null; remark?: string | null };
    if (mockRuleListItems.some((i) => i.listId === listId && i.value === b.value.trim())) return fail('该值已在名单中');
    const row = { id: getNextListItemId(), listId, value: b.value.trim(), label: b.label ?? null, expiresAt: b.expiresAt ?? null, remark: b.remark ?? null, createdAt: mockDateTime() };
    mockRuleListItems.push(row);
    return ok(row, '新增成功');
  }),
  http.delete('/api/rules/lists/:id/items/:itemId', ({ params }) => {
    const i = mockRuleListItems.findIndex((x) => x.id === Number(params.itemId) && x.listId === Number(params.id));
    if (i >= 0) mockRuleListItems.splice(i, 1);
    return ok(null, '删除成功');
  }),
];
