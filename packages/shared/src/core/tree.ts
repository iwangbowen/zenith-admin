export interface BuildTreeOptions<T> {
  /** 节点键，默认取 `id` */
  id?: (node: T) => unknown;
  /** 父节点键，默认取 `parentId`；为空或找不到父节点时提升为根节点 */
  parentId?: (node: T) => unknown;
  /** 逐层排序；缺省保持入参顺序 */
  compare?: (a: T, b: T) => number;
  /** 叶子节点保留 `children: []`；缺省删除该属性 */
  keepEmptyChildren?: boolean;
}

/** 平铺列表 → 树：浅拷贝每个节点并挂接 children，父节点缺失（被过滤 / 越权）的节点挂到根 */
export function buildTree<T extends { children?: T[] }>(list: readonly T[], options: BuildTreeOptions<T> = {}): T[] {
  const getId = options.id ?? ((node: T) => (node as { id?: unknown }).id);
  const getParentId = options.parentId ?? ((node: T) => (node as { parentId?: unknown }).parentId);
  const map = new Map<unknown, T>();
  for (const item of list) map.set(getId(item), { ...item, children: [] });
  const roots: T[] = [];
  for (const node of map.values()) {
    const parentId = getParentId(node);
    const parent = parentId == null ? undefined : map.get(parentId);
    if (parent) parent.children!.push(node);
    else roots.push(node);
  }
  const finish = (nodes: T[]) => {
    if (options.compare) nodes.sort(options.compare);
    for (const node of nodes) {
      if (node.children!.length > 0) finish(node.children!);
      else if (!options.keepEmptyChildren) delete node.children;
    }
  };
  finish(roots);
  return roots;
}

/** 递归映射树节点（children 递归映射，无 children 的节点输出 `children: undefined`） */
export function mapTree<T extends { children?: T[] }, R extends { children?: R[] }>(
  nodes: readonly T[],
  map: (node: T) => Omit<R, 'children'>,
): R[] {
  return nodes.map((node) => ({ ...map(node), children: node.children ? mapTree(node.children, map) : undefined }) as R);
}

/** 树 → 先序平铺列表（父节点在其子树之前），节点原样返回不拷贝；用于树形下拉源的查找 / 计数 */
export function flattenTree<T extends { children?: T[] | null }>(nodes: readonly T[]): T[] {
  return nodes.flatMap((node) => [node, ...flattenTree(node.children ?? [])]);
}
