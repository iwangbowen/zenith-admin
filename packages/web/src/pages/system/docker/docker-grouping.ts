import type { DockerContainer } from '@zenith/shared/ops';

export interface ComposeGrouping {
  /** Compose 项目名 → 成员容器（按首次出现顺序） */
  groups: Record<string, DockerContainer[]>;
  /** 不属于任何 Compose 项目的独立容器 */
  standalone: DockerContainer[];
}

/** 按 Compose 项目分组容器：容器列表页的树形表格与终端侧的容器浏览树共用 */
export function groupContainersByCompose(containers: DockerContainer[]): ComposeGrouping {
  const groups: Record<string, DockerContainer[]> = {};
  const standalone: DockerContainer[] = [];
  for (const c of containers) {
    if (c.composeProject) {
      if (!groups[c.composeProject]) groups[c.composeProject] = [];
      groups[c.composeProject].push(c);
    } else {
      standalone.push(c);
    }
  }
  return { groups, standalone };
}
