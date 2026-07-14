/**
 * 表单字段依赖关系图数据构建（纯函数）
 * 将字段间的引用解析为有向边：驱动方 → 被影响方。
 * - 公式 {a}：a 驱动该公式字段
 * - 显隐 / 必填 / 只读 规则：条件字段 驱动 受控字段
 * - 级联 optionsFrom.sourceKey：父字段 驱动 子字段
 * - 天数 daysFromKey：日期区间 驱动 天数字段
 * - 联动赋值 autoFill.targets：源字段 赋值给 目标字段
 */
import type { WorkflowFormField } from '@zenith/shared';
import { flattenAllFields } from './form-tree';

export type DepKind = '公式' | '显隐' | '必填' | '只读' | '级联' | '天数' | '赋值';

export interface DepNode {
  key: string;
  label: string;
  type: string;
  missing?: boolean;
}

export interface DepEdge {
  source: string;
  target: string;
  kind: DepKind;
}

export const DEP_KIND_COLOR: Record<DepKind, string> = {
  公式: '#1677ff',
  显隐: '#722ed1',
  必填: '#fa8c16',
  只读: '#13c2c2',
  级联: '#52c41a',
  天数: '#eb2f96',
  赋值: '#2f54eb',
};

const FORMULA_REF_RE = /\{([^}]+)\}/g;
const NON_NODE_TYPES = new Set(['divider']);

export function buildFieldDependencyGraph(fields: WorkflowFormField[]): { nodes: DepNode[]; edges: DepEdge[] } {
  const all = flattenAllFields(fields);
  const byKey = new Map(all.map((f) => [f.key, f]));
  const edges: DepEdge[] = [];
  const seen = new Set<string>();
  const referenced = new Set<string>();

  const addEdge = (source: string, target: string, kind: DepKind) => {
    if (!source || !target || source === target) return;
    referenced.add(source);
    referenced.add(target);
    const id = `${source}->${target}:${kind}`;
    if (seen.has(id)) return;
    seen.add(id);
    edges.push({ source, target, kind });
  };

  for (const f of all) {
    if (f.formula) {
      for (const m of f.formula.matchAll(FORMULA_REF_RE)) {
        const ref = m[1].trim().split('.')[0];
        addEdge(ref, f.key, '公式');
      }
    }
    if (f.visibilityCondition?.field) addEdge(f.visibilityCondition.field, f.key, '显隐');
    f.visibilityRules?.rules?.forEach((r) => { if (r.field) addEdge(r.field, f.key, '显隐'); });
    f.requiredRules?.rules?.forEach((r) => { if (r.field) addEdge(r.field, f.key, '必填'); });
    f.readOnlyRules?.rules?.forEach((r) => { if (r.field) addEdge(r.field, f.key, '只读'); });
    if (f.optionsFrom?.sourceKey) addEdge(f.optionsFrom.sourceKey, f.key, '级联');
    if (f.daysFromKey) addEdge(f.daysFromKey, f.key, '天数');
    f.autoFill?.targets?.forEach((t) => addEdge(f.key, t, '赋值'));
  }

  const nodes: DepNode[] = all
    .filter((f) => !NON_NODE_TYPES.has(f.type))
    .map((f) => ({ key: f.key, label: f.label || f.key, type: f.type }));

  // 引用了但不存在的字段 → 缺失节点（红色提示）
  for (const ref of referenced) {
    if (!byKey.has(ref) && !nodes.some((n) => n.key === ref)) {
      nodes.push({ key: ref, label: ref, type: 'missing', missing: true });
    }
  }

  return { nodes, edges };
}

// ─── 值联动循环依赖检测 ──────────────────────────────────────────────
//
// 只对「会改写字段值」的边（公式 / 天数 / 赋值）检测环：
// 这类环在运行时会互相触发重算，可能导致值震荡甚至死循环。
// 显隐/必填/只读与级联选项不改值（级联环已由 createsCascadeCycle 单独防护），不参与。
// 自引用（A→A）由体检的「公式引用了自身」警告单独覆盖，这里只报长度 ≥ 2 的环。

const VALUE_DEP_KINDS = new Set<DepKind>(['公式', '天数', '赋值']);

/**
 * 检测值联动依赖环，返回环路径列表（每条为字段 key 数组，如 ['a','b','a']）。
 * 同一个环只报告一次（按最小 key 起点归一化去重），最多返回 10 条。
 */
export function findValueDependencyCycles(fields: WorkflowFormField[]): string[][] {
  const { edges } = buildFieldDependencyGraph(fields);
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!VALUE_DEP_KINDS.has(e.kind) || e.source === e.target) continue;
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source)?.push(e.target);
  }

  const cycles: string[][] = [];
  const seen = new Set<string>();
  const color = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];

  const dfs = (key: string): void => {
    color.set(key, 'visiting');
    stack.push(key);
    for (const next of adj.get(key) ?? []) {
      if (cycles.length >= 10) break;
      const state = color.get(next);
      if (state === 'visiting') {
        // 回边：截取栈中环路径并归一化去重
        const start = stack.indexOf(next);
        const path = stack.slice(start);
        const minIdx = path.reduce((mi, k, i) => (k < path[mi] ? i : mi), 0);
        const normalized = [...path.slice(minIdx), ...path.slice(0, minIdx)];
        const id = normalized.join('->');
        if (!seen.has(id)) {
          seen.add(id);
          cycles.push([...normalized, normalized[0]]);
        }
      } else if (state === undefined) {
        dfs(next);
      }
    }
    stack.pop();
    color.set(key, 'done');
  };

  for (const key of adj.keys()) {
    if (!color.has(key)) dfs(key);
  }
  return cycles;
}
