/** 消息分支树（与服务端算法对齐）：激活路径解析与兄弟分支信息 */
import type { AiMessage } from '@zenith/shared/ai';

export interface BranchInfo {
  /** 同父同角色的兄弟消息 ID（时间序） */
  siblings: number[];
  index: number;
}

/** 激活路径：activeLeaf 祖先链；未设置 / 失效时取最新消息为叶子 */
export function resolveActivePath(rows: AiMessage[], activeLeafMsgId: number | null): AiMessage[] {
  if (rows.length === 0) return [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const leafId = activeLeafMsgId !== null && byId.has(activeLeafMsgId) ? activeLeafMsgId : rows[rows.length - 1].id;
  const path: AiMessage[] = [];
  let cur: number | null = leafId;
  const guard = new Set<number>();
  while (cur !== null && !guard.has(cur)) {
    guard.add(cur);
    const node = byId.get(cur);
    if (!node) break;
    path.unshift(node);
    cur = node.parentId;
  }
  return path;
}

/** 每条消息的兄弟分支信息（同父 + 同角色，数量 > 1 时展示切换器） */
export function computeBranchInfo(rows: AiMessage[]): Map<number, BranchInfo> {
  const groups = new Map<string, number[]>();
  for (const r of rows) {
    const key = `${r.parentId ?? 'root'}|${r.role}`;
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
