export interface CmsSiteTreeNode {
  id: number;
  parentId: number | null;
}

export function listCmsSubtreeIds(rows: readonly CmsSiteTreeNode[], rootId: number): number[] {
  const children = new Map<number, number[]>();
  for (const row of rows) {
    if (row.parentId == null) continue;
    children.set(row.parentId, [...(children.get(row.parentId) ?? []), row.id]);
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
