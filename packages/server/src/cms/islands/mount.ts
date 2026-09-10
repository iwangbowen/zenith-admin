import type { IslandMount } from './registry';

const MOUNTED_FLAG = 'islandMounted';

/**
 * 在 root 下查找全部 `[data-island]` 容器并按注册表挂载，每个容器只挂载一次。
 * 单个岛抛错不影响其他岛（记录到控制台便于排查）。
 */
export function mountIslands(root: ParentNode, islands: Readonly<Record<string, IslandMount>>): number {
  let mounted = 0;
  for (const el of root.querySelectorAll<HTMLElement>('[data-island]')) {
    if (el.dataset[MOUNTED_FLAG]) continue;
    const name = el.dataset.island;
    const mount = name ? islands[name] : undefined;
    if (!mount) continue;
    el.dataset[MOUNTED_FLAG] = '1';
    try {
      mount(el);
      mounted += 1;
    } catch (error) {
      console.error(`[cms-islands] 岛 "${name}" 挂载失败`, error);
    }
  }
  return mounted;
}
