/**
 * 文件浏览器共享原语。
 *
 * 本机文件树、SFTP 远程树、Docker 容器内文件树三者的交互差异是真实的
 * （拖拽上传 / 收藏 / 多选 / 盘符切换 vs 简单树 vs 容器树），因此**不**合并组件；
 * 但「条目转树节点」「按 key 替换子节点」「路径拼接」这些原语此前各写一份，
 * 规则一改就漂移。这里只抽取原语。
 */
import type { TreeNodeData } from '@douyinfe/semi-ui/lib/es/tree';

/**
 * 文件树节点：在 Semi TreeNodeData 之上收窄 key/value/label 为字符串，
 * 并带上条目类型与完整路径。文件树的 key 恒为路径，收窄后调用方无需到处断言。
 */
export interface FsTreeNode extends TreeNodeData {
  key: string;
  value: string;
  label: string;
  fileType: 'dir' | 'file';
  fullPath: string;
  children?: FsTreeNode[];
}

export interface FsTreeEntrySource {
  name: string;
  path: string;
  type: 'dir' | 'file';
}

/** 目录优先、同类按名称排序（各文件树列目录时的统一顺序） */
export function sortEntriesDirFirst<T extends { name: string; type: string }>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => {
    if (a.type === 'dir' && b.type !== 'dir') return -1;
    if (a.type !== 'dir' && b.type === 'dir') return 1;
    return a.name.localeCompare(b.name);
  });
}

/** 条目 → 树节点。目录留空 children 以触发懒加载，文件标记为叶子。 */
export function entryToTreeNode(entry: FsTreeEntrySource): FsTreeNode {
  return {
    key: entry.path,
    value: entry.path,
    label: entry.name,
    isLeaf: entry.type === 'file',
    children: entry.type === 'dir' ? undefined : [],
    fileType: entry.type,
    fullPath: entry.path,
  };
}

/**
 * 递归替换指定 key 节点的 children，返回新树（不可变更新）。
 * 懒加载与刷新目录都依赖它，就地修改会让 Semi Tree 漏更新。
 */
export function setTreeChildren<T extends TreeNodeData>(nodes: T[], key: string, children: T[]): T[] {
  return nodes.map((n) => {
    if (n.key === key) return { ...n, children };
    if (n.children) return { ...n, children: setTreeChildren(n.children as T[], key, children) };
    return n;
  });
}

/** POSIX 路径拼接（SFTP / 容器内路径统一用 `/`） */
export function joinPosix(dir: string, name: string): string {
  return `${dir.replace(/\/+$/, '')}/${name}`;
}

/** POSIX 父目录；已在根则返回根 */
export function parentPosix(p: string): string {
  const idx = p.lastIndexOf('/');
  return idx > 0 ? p.slice(0, idx) : '/';
}

/** 按路径自身的分隔符风格拼接（本机路径在 Windows 上是反斜杠） */
export function joinNativePath(dir: string, name: string): string {
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/';
  return `${dir.replace(/[/\\]+$/, '')}${sep}${name}`;
}

/** 本机路径的父目录；已在根则返回自身 */
export function parentNativePath(p: string): string {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return idx > 0 ? p.slice(0, idx) : p;
}

/** 新建 / 重命名 / 改权限对话框的共享状态形态 */
export type FsDialogState =
  | { mode: 'createFile' | 'createDir'; baseDir: string; value: string }
  | { mode: 'rename'; baseDir: string; oldPath: string; value: string }
  | { mode: 'chmod'; targetPath: string; value: string };

export function fsDialogTitle(mode: FsDialogState['mode'] | undefined): string {
  switch (mode) {
    case 'createDir': return '新建文件夹';
    case 'createFile': return '新建文件';
    case 'rename': return '重命名';
    case 'chmod': return '修改权限（八进制）';
    default: return '';
  }
}
