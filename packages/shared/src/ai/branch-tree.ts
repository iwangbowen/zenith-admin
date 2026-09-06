/**
 * AI 对话消息分支树（对齐 ChatGPT 数据模型）。
 *
 * 消息带 parentId 组成树；对话的 activeLeafMsgId 指定当前激活分支的叶子，激活路径 = 叶子的祖先链。
 * 历史数据 parentId 为 null（线性），按时间序推导隐式父节点兼容；所有新写入均带显式 parentId。
 *
 * 服务端（落库行）与前端（API 返回行）共用同一套算法，避免两侧各自实现造成漂移；
 * 服务端对外输出的 parentId 已是"有效父节点"，本模块在其上再次推导是幂等的。
 */

export interface BranchTreeNode {
  id: number;
  parentId: number | null;
  role: string;
  /** Date / 时间戳 / `YYYY-MM-DD HH:mm:ss` 等可按字典序比较的时间串 */
  createdAt: Date | string | number;
}

export interface BranchInfo {
  /** 同父同角色的兄弟消息 ID（时间序） */
  siblings: number[];
  index: number;
}

function compareTime(a: BranchTreeNode['createdAt'], b: BranchTreeNode['createdAt']): number {
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  return Number(new Date(a)) - Number(new Date(b));
}

/** 时间序（同一时刻按 id 升序） */
export function sortMessagesByTime<T extends BranchTreeNode>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => compareTime(a.createdAt, b.createdAt) || a.id - b.id);
}

/** 有效父节点：显式 parentId 优先（指向不存在的节点视为根）；legacy 空值按时间序链接前一条 legacy 消息 */
export function buildEffectiveParents<T extends BranchTreeNode>(rows: readonly T[]): Map<number, number | null> {
  const idSet = new Set(rows.map((r) => r.id));
  const map = new Map<number, number | null>();
  let prevLegacyId: number | null = null;
  for (const row of sortMessagesByTime(rows)) {
    if (row.parentId !== null) {
      map.set(row.id, idSet.has(row.parentId) ? row.parentId : null);
    } else {
      map.set(row.id, prevLegacyId);
      prevLegacyId = row.id;
    }
  }
  return map;
}

/** 有效父节点 → 子节点列表（时间序）；根节点归于 `null` 键 */
export function buildChildrenMap<T extends BranchTreeNode>(rows: readonly T[]): Map<number | null, T[]> {
  const parents = buildEffectiveParents(rows);
  const children = new Map<number | null, T[]>();
  for (const row of sortMessagesByTime(rows)) {
    const p = parents.get(row.id) ?? null;
    const list = children.get(p) ?? [];
    list.push(row);
    children.set(p, list);
  }
  return children;
}

/** 从指定节点沿"最新子分支"下探到叶子 */
export function descendToLeaf<T extends BranchTreeNode>(rows: readonly T[], fromId: number): number {
  const children = buildChildrenMap(rows);
  let cur = fromId;
  const guard = new Set<number>();
  while (!guard.has(cur)) {
    guard.add(cur);
    const kids = children.get(cur) ?? [];
    if (kids.length === 0) return cur;
    cur = kids[kids.length - 1].id;
  }
  return cur;
}

function ancestorChain<T extends BranchTreeNode>(rows: readonly T[], leafId: number): T[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const parents = buildEffectiveParents(rows);
  const path: T[] = [];
  let cur: number | null = leafId;
  const guard = new Set<number>();
  while (cur !== null && !guard.has(cur)) {
    guard.add(cur);
    const node = byId.get(cur);
    if (!node) break;
    path.unshift(node);
    cur = parents.get(cur) ?? null;
  }
  return path;
}

/** 激活路径：activeLeaf 的祖先链（含自身）；未设置或已失效时取时间最新消息为叶子 */
export function resolveActivePath<T extends BranchTreeNode>(rows: readonly T[], activeLeafMsgId: number | null): T[] {
  if (rows.length === 0) return [];
  const hasLeaf = activeLeafMsgId !== null && rows.some((r) => r.id === activeLeafMsgId);
  const sorted = sortMessagesByTime(rows);
  const leafId = hasLeaf ? activeLeafMsgId : sorted[sorted.length - 1].id;
  return ancestorChain(rows, leafId);
}

/** 祖先链（含 upToMsgId 自身）——编辑重发时以某条消息为终点构造上下文；节点不存在返回空 */
export function resolveAncestorPath<T extends BranchTreeNode>(rows: readonly T[], upToMsgId: number): T[] {
  if (!rows.some((r) => r.id === upToMsgId)) return [];
  return ancestorChain(rows, upToMsgId);
}

/** 每条消息的兄弟分支信息（同有效父 + 同角色，数量 > 1 时才有条目，供切换器展示） */
export function computeBranchInfo<T extends BranchTreeNode>(rows: readonly T[]): Map<number, BranchInfo> {
  const parents = buildEffectiveParents(rows);
  const groups = new Map<string, number[]>();
  for (const r of sortMessagesByTime(rows)) {
    const key = `${parents.get(r.id) ?? 'root'}|${r.role}`;
    const list = groups.get(key) ?? [];
    list.push(r.id);
    groups.set(key, list);
  }
  const info = new Map<number, BranchInfo>();
  for (const ids of groups.values()) {
    if (ids.length < 2) continue;
    ids.forEach((id, idx) => info.set(id, { siblings: ids, index: idx }));
  }
  return info;
}
