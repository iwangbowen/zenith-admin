import { CMS_SITE_MAX_DEPTH } from '@zenith/shared';

export interface CmsSiteHierarchyNode {
  id: number;
  parentId: number | null;
  status?: 'enabled' | 'disabled';
}

export interface CmsHierarchyMovePlan {
  subtreeIds: number[];
  oldDepth: number;
  newDepth: number;
  subtreeHeight: number;
}

function depthOf(nodes: ReadonlyMap<number, CmsSiteHierarchyNode>, id: number): number {
  let depth = 1;
  let current = nodes.get(id);
  const seen = new Set<number>();
  while (current?.parentId != null) {
    if (seen.has(current.id)) throw new Error(`站点层级存在环：#${current.id}`);
    seen.add(current.id);
    current = nodes.get(current.parentId);
    if (!current) throw new Error('父站点不存在');
    depth += 1;
    if (depth > CMS_SITE_MAX_DEPTH) throw new Error(`站点层级超过 ${CMS_SITE_MAX_DEPTH} 层`);
  }
  return depth;
}

function subtree(nodes: readonly CmsSiteHierarchyNode[], rootId: number): number[] {
  const children = new Map<number, number[]>();
  for (const node of nodes) {
    if (node.parentId == null) continue;
    children.set(node.parentId, [...(children.get(node.parentId) ?? []), node.id]);
  }
  const result: number[] = [];
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift()!;
    result.push(id);
    queue.push(...(children.get(id) ?? []));
  }
  return result;
}

function subtreeHeight(nodes: ReadonlyMap<number, CmsSiteHierarchyNode>, ids: readonly number[], rootDepth: number): number {
  return Math.max(...ids.map((id) => depthOf(nodes, id) - rootDepth + 1), 1);
}

export function planCmsSiteMove(
  rows: readonly CmsSiteHierarchyNode[],
  siteId: number,
  parentId: number | null,
  maxDepth = CMS_SITE_MAX_DEPTH,
): CmsHierarchyMovePlan {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const site = byId.get(siteId);
  if (!site) throw new Error('站点不存在');
  if (parentId === siteId) throw new Error('站点不能移动到自身下级');
  const subtreeIds = subtree(rows, siteId);
  if (parentId != null && subtreeIds.includes(parentId)) throw new Error('不能把站点移动到自身子树中');
  if (parentId != null && !byId.has(parentId)) throw new Error('目标父站点不存在');
  const oldDepth = depthOf(byId, siteId);
  const newDepth = parentId == null ? 1 : depthOf(byId, parentId) + 1;
  const height = subtreeHeight(byId, subtreeIds, oldDepth);
  if (newDepth + height - 1 > maxDepth) {
    throw new Error(`移动后站点层级将超过 ${maxDepth} 层`);
  }
  return { subtreeIds, oldDepth, newDepth, subtreeHeight: height };
}

export function validateCmsSiteEnablement(
  rows: readonly CmsSiteHierarchyNode[],
  siteId: number,
  nextStatus: 'enabled' | 'disabled',
): void {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const site = byId.get(siteId);
  if (!site) throw new Error('站点不存在');
  if (nextStatus === 'enabled') {
    let parentId = site.parentId;
    while (parentId != null) {
      const parent = byId.get(parentId);
      if (!parent) throw new Error('父站点不存在');
      if (parent.status === 'disabled') throw new Error('父站点已停用，不能启用子站点');
      parentId = parent.parentId;
    }
    return;
  }
  const enabledDescendant = subtree(rows, siteId)
    .filter((id) => id !== siteId)
    .map((id) => byId.get(id))
    .find((node) => node?.status === 'enabled');
  if (enabledDescendant) throw new Error('存在启用中的子站点，请先逐级停用子站点');
}
