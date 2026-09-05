import type { RuleDecisionFlow, RuleFlowStep, RuleFlowStepTrace, RuleList, RuleListItem, RuleScorecard, RuleScorecardEvaluateResult, RuleUsageItem } from '@zenith/shared/rules';
import { decisionFlowContract, ruleListContract, ruleScorecardContract } from '@zenith/shared/rules';
import { mock } from '@/mocks/utils/contract';
import { badRequest, notFound, conflict } from '@/mocks/utils/handlers';
import { mockDecisionFlows, getNextFlowId, mockRuleLists, mockRuleListItems, getNextListId, getNextListItemId, mockRuleScorecards, getNextScorecardId, mockAssetVersions, getNextAssetVersionId } from '@/mocks/data/rules-p2';
import { mockDecisionTables } from '@/mocks/data/decision-tables';
import { mockPaymentRiskRules } from './payment-bext';
import { evaluateMockDecisionTable } from './decision-tables';
import { mockDateTime } from '@/mocks/utils/date';

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

/** mock 评分卡求值：与后端 rules-scorecard 引擎语义对齐（分段命中×权重+基础分→等级） */
function evaluateMockScorecard(card: RuleScorecard, input: Record<string, unknown>): RuleScorecardEvaluateResult {
  const get = (path: string) => path.split('.').reduce<unknown>((o, k) => (o == null ? o : (o as Record<string, unknown>)[k]), input);
  let total = card.baseScore;
  const variables = card.variables.map((v) => {
    const raw = get(v.expr);
    let score = v.missingScore ?? 0;
    let matchedBand: string | null = null;
    let missed = true;
    for (const band of v.bands) {
      let hit: boolean;
      if (band.op === 'default') hit = true;
      else if (band.op === 'eq') hit = raw != null && String(raw) === String(band.value ?? '');
      else if (band.op === 'in') hit = raw != null && (band.values ?? []).some((x) => String(raw) === x);
      else {
        const n = Number(raw);
        hit = raw != null && raw !== '' && Number.isFinite(n)
          && (band.min == null || n >= band.min) && (band.max == null || n < band.max);
      }
      if (hit) {
        score = band.score;
        matchedBand = band.label ?? (band.op === 'range' ? `[${band.min ?? '-∞'}, ${band.max ?? '+∞'})` : band.op === 'eq' ? `= ${band.value ?? ''}` : band.op === 'in' ? `in [${(band.values ?? []).join(', ')}]` : '兜底');
        missed = false;
        break;
      }
    }
    const weight = v.weight ?? 1;
    const weighted = Math.round(score * weight * 10000) / 10000;
    total += weighted;
    return { key: v.key, label: v.label, raw, matchedBand, score, weight, weighted, missed };
  });
  const totalScore = Math.round(total * 10000) / 10000;
  const grade = [...card.grades].sort((a, b) => b.minScore - a.minScore).find((g) => totalScore >= g.minScore) ?? null;
  return { totalScore, baseScore: card.baseScore, grade: grade?.grade ?? null, decision: grade?.decision ?? null, variables };
}

const listUsages = (key: string): RuleUsageItem[] => mockPaymentRiskRules
  .filter((r) => (r.blockListKeys ?? []).includes(key) || (r.allowListKeys ?? []).includes(key))
  .map((r) => ({ type: 'paymentRisk' as const, id: r.id, name: r.name, status: r.status }));

export const rulesP2Handlers = [
  // ── 决策流 ──────────────────────────────────────────────────────────────────
  mock(decisionFlowContract.list, ({ query, ok, paginate }) => {
    const { keyword, status } = query;
    let list = [...mockDecisionFlows];
    if (keyword) list = list.filter((t) => t.name.includes(keyword) || t.key.includes(keyword));
    if (status) list = list.filter((t) => t.status === status);
    return ok(paginate(list));
  }),
  mock(decisionFlowContract.create, ({ body, ok }) => {
    const now = mockDateTime();
    const row: RuleDecisionFlow = { id: getNextFlowId(), key: body.key, name: body.name, description: body.description ?? null, status: 'draft', steps: body.steps, publishedSteps: null, version: 1, publishedAt: null, dirty: false, createdAt: now, updatedAt: now };
    mockDecisionFlows.unshift(row);
    return ok(row, '创建成功');
  }),
  mock(decisionFlowContract.evaluate, ({ body, ok }) => {
    const { key, input } = body;
    const r = mockDecisionFlows.find((t) => t.key === key);
    if (!r) return notFound('决策流不存在', { status: 404 });
    if (r.status === 'disabled') return badRequest('决策流已禁用', { status: 400 });
    return ok(evaluateFlow(r.status === 'published' && r.publishedSteps ? r.publishedSteps : r.steps, input));
  }),
  mock(decisionFlowContract.removeBatch, ({ body, ok }) => {
    for (const id of body.ids) {
      const i = mockDecisionFlows.findIndex((t) => t.id === id);
      if (i >= 0) mockDecisionFlows.splice(i, 1);
    }
    return ok(null, '删除成功');
  }),
  mock(decisionFlowContract.detail, ({ params, ok }) => {
    const r = mockDecisionFlows.find((t) => t.id === params.id);
    return r ? ok(r) : notFound('决策流不存在', { status: 404 });
  }),
  mock(decisionFlowContract.update, ({ params, body, ok }) => {
    const r = mockDecisionFlows.find((t) => t.id === params.id);
    if (!r) return notFound('决策流不存在', { status: 404 });
    const { expectedUpdatedAt, ...patch } = body;
    if (expectedUpdatedAt && expectedUpdatedAt !== r.updatedAt) return conflict('决策流已被他人修改，请刷新后重试', { status: 409 });
    Object.assign(r, patch, { updatedAt: mockDateTime() });
    r.dirty = flowDirty(r);
    return ok(r, '更新成功');
  }),
  mock(decisionFlowContract.publish, ({ params, ok }) => {
    const r = mockDecisionFlows.find((t) => t.id === params.id);
    if (!r) return notFound('决策流不存在', { status: 404 });
    if (r.steps.length === 0) return badRequest('决策流至少需要一个步骤', { status: 400 });
    const bad = r.steps.filter((s) => mockDecisionTables.find((t) => t.key === s.tableKey)?.status !== 'published');
    if (bad.length > 0) return badRequest(`发布受阻：引用的决策表未发布或不存在：${bad.map((s) => s.tableKey).join('、')}`, { status: 400 });
    const nextVersion = r.publishedAt == null ? r.version : r.version + 1;
    r.status = 'published'; r.publishedSteps = JSON.parse(JSON.stringify(r.steps)); r.publishedAt = mockDateTime(); r.version = nextVersion; r.dirty = false;
    mockAssetVersions.unshift({ id: getNextAssetVersionId(), refKind: 'flow', refId: r.id, version: nextVersion, publishedBy: 1, publishedAt: r.publishedAt, snapshot: { name: r.name, description: r.description, steps: JSON.parse(JSON.stringify(r.steps)) } });
    return ok(r, '发布成功');
  }),
  mock(decisionFlowContract.versions, ({ params, ok }) => {
    const list = mockAssetVersions.filter((v) => v.refKind === 'flow' && v.refId === params.id)
      .map(({ snapshot: _s, ...meta }) => meta);
    return ok(list);
  }),
  mock(decisionFlowContract.rollback, ({ params, ok }) => {
    const r = mockDecisionFlows.find((t) => t.id === params.id);
    if (!r) return notFound('决策流不存在', { status: 404 });
    const v = mockAssetVersions.find((x) => x.refKind === 'flow' && x.refId === r.id && x.version === params.version);
    if (!v) return notFound(`版本 v${params.version} 不存在`, { status: 404 });
    const snap = v.snapshot as { name: string; description: string | null; steps: RuleFlowStep[] };
    Object.assign(r, { name: snap.name, description: snap.description ?? null, steps: snap.steps ?? [], status: 'draft', updatedAt: mockDateTime() });
    r.dirty = flowDirty(r);
    return ok(r, '回滚成功');
  }),
  mock(decisionFlowContract.toggle, ({ params, body, ok }) => {
    const r = mockDecisionFlows.find((t) => t.id === params.id);
    if (!r) return notFound('决策流不存在', { status: 404 });
    r.status = body.enabled ? (r.publishedAt ? 'published' : 'draft') : 'disabled';
    return ok(r);
  }),
  mock(decisionFlowContract.test, ({ params, body, ok }) => {
    const r = mockDecisionFlows.find((t) => t.id === params.id);
    if (!r) return notFound('决策流不存在', { status: 404 });
    return ok(evaluateFlow(r.steps, body.input));
  }),
  mock(decisionFlowContract.remove, ({ params, ok }) => {
    const i = mockDecisionFlows.findIndex((t) => t.id === params.id);
    if (i === -1) return notFound('决策流不存在', { status: 404 });
    mockDecisionFlows.splice(i, 1);
    return ok(null, '删除成功');
  }),

  // ── 评分卡 ──────────────────────────────────────────────────────────────────
  mock(ruleScorecardContract.list, ({ query, ok, paginate }) => {
    const { keyword, status } = query;
    let list = [...mockRuleScorecards];
    if (keyword) list = list.filter((t) => t.name.includes(keyword) || t.key.includes(keyword));
    if (status) list = list.filter((t) => t.status === status);
    return ok(paginate(list));
  }),
  mock(ruleScorecardContract.evaluateByKey, ({ body, ok }) => {
    const r = mockRuleScorecards.find((t) => t.key === body.key);
    if (!r) return notFound('评分卡不存在', { status: 404 });
    if (r.status !== 'published') return badRequest('评分卡未发布', { status: 400 });
    return ok(evaluateMockScorecard(r, body.input));
  }),
  mock(ruleScorecardContract.create, ({ body, ok }) => {
    if (mockRuleScorecards.some((t) => t.key === body.key)) return conflict('评分卡 key 已存在', { status: 409 });
    const now = mockDateTime();
    const row: RuleScorecard = {
      id: getNextScorecardId(), key: body.key, name: body.name, description: body.description ?? null,
      status: 'draft', baseScore: body.baseScore, variables: body.variables, grades: body.grades,
      version: 1, publishedAt: null, dirty: false, createdAt: now, updatedAt: now,
    };
    mockRuleScorecards.unshift(row);
    return ok(row, '创建成功');
  }),
  mock(ruleScorecardContract.versions, ({ params, ok }) => {
    const list = mockAssetVersions.filter((v) => v.refKind === 'scorecard' && v.refId === params.id)
      .map(({ snapshot: _s, ...meta }) => meta);
    return ok(list);
  }),
  mock(ruleScorecardContract.rollback, ({ params, ok }) => {
    const r = mockRuleScorecards.find((t) => t.id === params.id);
    if (!r) return notFound('评分卡不存在', { status: 404 });
    const v = mockAssetVersions.find((x) => x.refKind === 'scorecard' && x.refId === r.id && x.version === params.version);
    if (!v) return notFound(`版本 v${params.version} 不存在`, { status: 404 });
    const snap = v.snapshot as { name: string; description: string | null; baseScore: number; variables: RuleScorecard['variables']; grades: RuleScorecard['grades'] };
    Object.assign(r, { name: snap.name, description: snap.description ?? null, baseScore: snap.baseScore ?? 0, variables: snap.variables ?? [], grades: snap.grades ?? [], status: 'draft', updatedAt: mockDateTime() });
    return ok(r, '回滚成功');
  }),
  mock(ruleScorecardContract.detail, ({ params, ok }) => {
    const r = mockRuleScorecards.find((t) => t.id === params.id);
    return r ? ok(r) : notFound('评分卡不存在', { status: 404 });
  }),
  mock(ruleScorecardContract.update, ({ params, body, ok }) => {
    const r = mockRuleScorecards.find((t) => t.id === params.id);
    if (!r) return notFound('评分卡不存在', { status: 404 });
    const { expectedUpdatedAt, ...patch } = body;
    if (expectedUpdatedAt && expectedUpdatedAt !== r.updatedAt) return conflict('评分卡已被他人修改，请刷新后重试', { status: 409 });
    Object.assign(r, patch, { updatedAt: mockDateTime(), dirty: r.status === 'published' ? true : r.dirty });
    return ok(r, '更新成功');
  }),
  mock(ruleScorecardContract.remove, ({ params, ok }) => {
    const i = mockRuleScorecards.findIndex((t) => t.id === params.id);
    if (i === -1) return notFound('评分卡不存在', { status: 404 });
    mockRuleScorecards.splice(i, 1);
    return ok(null, '删除成功');
  }),
  mock(ruleScorecardContract.publish, ({ params, ok }) => {
    const r = mockRuleScorecards.find((t) => t.id === params.id);
    if (!r) return notFound('评分卡不存在', { status: 404 });
    if (r.variables.length === 0) return badRequest('评分卡至少需要一个变量', { status: 400 });
    const nextVersion = r.publishedAt == null ? r.version : r.version + 1;
    r.status = 'published'; r.publishedAt = mockDateTime(); r.version = nextVersion; r.dirty = false;
    mockAssetVersions.unshift({ id: getNextAssetVersionId(), refKind: 'scorecard', refId: r.id, version: nextVersion, publishedBy: 1, publishedAt: r.publishedAt, snapshot: { name: r.name, description: r.description, baseScore: r.baseScore, variables: JSON.parse(JSON.stringify(r.variables)), grades: JSON.parse(JSON.stringify(r.grades)) } });
    return ok(r, '发布成功');
  }),
  mock(ruleScorecardContract.toggle, ({ params, body, ok }) => {
    const r = mockRuleScorecards.find((t) => t.id === params.id);
    if (!r) return notFound('评分卡不存在', { status: 404 });
    if (body.enabled && !r.publishedAt) return badRequest('评分卡尚未发布过，请先发布', { status: 400 });
    r.status = body.enabled ? 'published' : 'disabled';
    return ok(r);
  }),
  mock(ruleScorecardContract.evaluate, ({ params, body, ok }) => {
    const r = mockRuleScorecards.find((t) => t.id === params.id);
    if (!r) return notFound('评分卡不存在', { status: 404 });
    return ok(evaluateMockScorecard(r, body.input));
  }),

  // ── 名单库 ──────────────────────────────────────────────────────────────────
  mock(ruleListContract.list, ({ query, ok, paginate }) => {
    const { keyword, type } = query;
    let list: RuleList[] = mockRuleLists.map((l) => ({ ...l, itemCount: mockRuleListItems.filter((i) => i.listId === l.id).length }));
    if (keyword) list = list.filter((t) => t.name.includes(keyword) || t.key.includes(keyword));
    if (type) list = list.filter((t) => t.type === type);
    return ok(paginate(list));
  }),
  mock(ruleListContract.check, ({ body, ok }) => {
    const { key, value } = body;
    const list = mockRuleLists.find((l) => l.key === key);
    if (!list || list.status !== 'enabled') return ok({ hit: false });
    const item = mockRuleListItems.find((i) => i.listId === list.id && i.value === value.trim() && (!i.expiresAt || i.expiresAt > mockDateTime()));
    return ok(item ? { hit: true, listType: list.type, item: { value: item.value, label: item.label, expiresAt: item.expiresAt } } : { hit: false });
  }),
  mock(ruleListContract.create, ({ body, ok }) => {
    const now = mockDateTime();
    const row: RuleList = { id: getNextListId(), key: body.key, name: body.name, type: body.type, description: body.description ?? null, status: 'enabled', itemCount: 0, createdAt: now, updatedAt: now };
    mockRuleLists.unshift(row);
    return ok(row, '创建成功');
  }),
  mock(ruleListContract.usages, ({ params, ok }) => {
    const list = mockRuleLists.find((l) => l.id === params.id);
    if (!list) return notFound('名单不存在', { status: 404 });
    return ok(listUsages(list.key));
  }),
  mock(ruleListContract.update, ({ params, body, ok }) => {
    const r = mockRuleLists.find((t) => t.id === params.id);
    if (!r) return notFound('名单不存在', { status: 404 });
    Object.assign(r, body, { updatedAt: mockDateTime() });
    return ok(r, '更新成功');
  }),
  mock(ruleListContract.remove, ({ params, ok }) => {
    const i = mockRuleLists.findIndex((t) => t.id === params.id);
    if (i === -1) return notFound('名单不存在', { status: 404 });
    const { id: listId, key, name } = mockRuleLists[i];
    const refs = listUsages(key);
    if (refs.length > 0) return badRequest(`名单「${name}」被 ${refs.length} 处引用（${refs.map((r) => r.name).join('、')}），请先解除引用后再删除`, { status: 400 });
    mockRuleLists.splice(i, 1);
    for (let k = mockRuleListItems.length - 1; k >= 0; k -= 1) if (mockRuleListItems[k].listId === listId) mockRuleListItems.splice(k, 1);
    return ok(null, '删除成功');
  }),
  mock(ruleListContract.items, ({ params, query, ok, paginate }) => {
    const { keyword } = query;
    let list = mockRuleListItems.filter((i) => i.listId === params.id);
    if (keyword) list = list.filter((i) => i.value.includes(keyword));
    return ok(paginate([...list].reverse()));
  }),
  mock(ruleListContract.createItemsBatch, ({ params, body, ok }) => {
    const listId = params.id;
    const { values, expiresAt } = body;
    const existing = new Set(mockRuleListItems.filter((i) => i.listId === listId).map((i) => i.value));
    let added = 0;
    for (const raw of [...new Set(values.map((v) => v.trim()).filter(Boolean))]) {
      if (existing.has(raw)) continue;
      mockRuleListItems.push({ id: getNextListItemId(), listId, value: raw, label: null, matchMode: 'exact', expiresAt: expiresAt ?? null, remark: null, createdAt: mockDateTime() });
      added += 1;
    }
    return ok(null, `导入完成：新增 ${added} 条（重复值已跳过）`);
  }),
  mock(ruleListContract.purgeExpiredItems, ({ params, ok }) => {
    const listId = params.id;
    const now = mockDateTime();
    let removed = 0;
    for (let k = mockRuleListItems.length - 1; k >= 0; k -= 1) {
      const it = mockRuleListItems[k];
      if (it.listId === listId && it.expiresAt && it.expiresAt < now) { mockRuleListItems.splice(k, 1); removed += 1; }
    }
    return ok(null, `清理完成：删除 ${removed} 条过期条目`);
  }),
  mock(ruleListContract.createItem, ({ params, body, ok }) => {
    const listId = params.id;
    if (mockRuleListItems.some((i) => i.listId === listId && i.value === body.value.trim())) return badRequest('该值已在名单中', { status: 400 });
    const row: RuleListItem = { id: getNextListItemId(), listId, value: body.value.trim(), label: body.label ?? null, matchMode: body.matchMode, expiresAt: body.expiresAt ?? null, remark: body.remark ?? null, createdAt: mockDateTime() };
    mockRuleListItems.push(row);
    return ok(row, '新增成功');
  }),
  mock(ruleListContract.removeItem, ({ params, ok }) => {
    const i = mockRuleListItems.findIndex((x) => x.id === params.itemId && x.listId === params.id);
    if (i >= 0) mockRuleListItems.splice(i, 1);
    return ok(null, '删除成功');
  }),
];
