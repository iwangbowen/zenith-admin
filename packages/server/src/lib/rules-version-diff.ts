/**
 * 决策表版本 diff：对比两份快照（输入列/输出列/规则行 + 元信息），输出行级变更。
 * 输入/输出列按 key 匹配，规则行按 id 匹配。
 */
import type {
  RuleDecisionInput, RuleDecisionOutput, RuleDecisionRow, RuleVersionChange, RuleVersionDiff,
} from '@zenith/shared';

interface Snapshot {
  name: string;
  hitPolicy: string;
  inputs: RuleDecisionInput[];
  outputs: RuleDecisionOutput[];
  rules: RuleDecisionRow[];
  /** 行为设置（collect 聚合/未命中回退），可选以兼容旧快照 */
  settings?: unknown;
}

const byKey = <T extends { key: string }>(arr: T[]) => new Map(arr.map((x) => [x.key, x]));
const byId = (arr: RuleDecisionRow[]) => new Map(arr.map((r) => [r.id, r]));

function diffColumns(kind: 'input' | 'output', a: Array<{ key: string; label: string; type: string }>, b: Array<{ key: string; label: string; type: string }>, out: RuleVersionChange[]): void {
  const ma = byKey(a), mb = byKey(b);
  for (const [k, v] of mb) if (!ma.has(k)) out.push({ kind, op: 'added', ref: k, detail: `新增「${v.label}」(${v.type})` });
  for (const [k, v] of ma) if (!mb.has(k)) out.push({ kind, op: 'removed', ref: k, detail: `删除「${v.label}」` });
  for (const [k, v] of ma) { const n = mb.get(k); if (n && (n.label !== v.label || n.type !== v.type)) out.push({ kind, op: 'changed', ref: k, detail: `${v.label}/${v.type} → ${n.label}/${n.type}` }); }
}

export function diffDecisionSnapshots(from: number, to: number, a: Snapshot, b: Snapshot): RuleVersionDiff {
  const changes: RuleVersionChange[] = [];
  if (a.name !== b.name) changes.push({ kind: 'meta', op: 'changed', ref: 'name', detail: `名称 ${a.name} → ${b.name}` });
  if (a.hitPolicy !== b.hitPolicy) changes.push({ kind: 'meta', op: 'changed', ref: 'hitPolicy', detail: `命中策略 ${a.hitPolicy} → ${b.hitPolicy}` });
  if (JSON.stringify(a.settings ?? {}) !== JSON.stringify(b.settings ?? {})) {
    changes.push({ kind: 'meta', op: 'changed', ref: 'settings', detail: `行为设置 ${JSON.stringify(a.settings ?? {})} → ${JSON.stringify(b.settings ?? {})}` });
  }
  diffColumns('input', a.inputs, b.inputs, changes);
  diffColumns('output', a.outputs, b.outputs, changes);
  const ra = byId(a.rules), rb = byId(b.rules);
  for (const [id, r] of rb) if (!ra.has(id)) changes.push({ kind: 'rule', op: 'added', ref: id, detail: `新增规则 [${r.when.join(', ')}] → ${JSON.stringify(r.then)}` });
  for (const [id, r] of ra) if (!rb.has(id)) changes.push({ kind: 'rule', op: 'removed', ref: id, detail: `删除规则 [${r.when.join(', ')}]` });
  for (const [id, r] of ra) {
    const n = rb.get(id);
    if (n && JSON.stringify([r.when, r.then, r.priority]) !== JSON.stringify([n.when, n.then, n.priority])) {
      changes.push({ kind: 'rule', op: 'changed', ref: id, detail: `[${r.when.join(',')}]→[${n.when.join(',')}] ${JSON.stringify(r.then)}→${JSON.stringify(n.then)}` });
    }
  }
  return { from, to, changes };
}
