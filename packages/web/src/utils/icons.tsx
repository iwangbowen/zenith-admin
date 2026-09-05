import type { LucideIcon } from 'lucide-react';
import React, { useSyncExternalStore } from 'react';

/**
 * 按名字渲染图标的平台能力（菜单 / 标签栏 / 面包屑 / 命令面板 / 工作流模板与自定义表单……）。
 *
 * 调用方只使用两个入口：`<DynamicIcon name />`（components/DynamicIcon.tsx，或函数形态 `renderLucideIcon`）与 `IconPicker`，
 * 图标从哪来是本模块内部的「投递策略」：当前为「单个懒加载全量表 + 就绪订阅」——
 * 全表是一个哈希文件、一年缓存；后台入口在检测到登录凭证时立即 `prewarmLucideIcons()`，
 * 与 `/api/auth/me` 并行下载，侧栏首帧通常已有图标；未就绪时组件渲染 null 并在就绪后自动补齐。
 * 将来若改为 sprite / 逐图标导入 / 服务端下发节点，只改本文件，调用点零改动。
 *
 * 页面里 `import { X } from 'lucide-react'` 的静态按需图标不受影响（摇树成小子集）。
 */

type Registry = Record<string, LucideIcon>;

let registry: Registry | null = null;
let allNames: string[] = [];
let loadPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();

function isReactComponent(val: unknown): boolean {
  if (typeof val === 'function') return true;
  if (typeof val === 'object' && val !== null && '$$typeof' in val) return true;
  return false;
}

/** 触发（幂等）全量图标注册表加载 */
export function ensureLucideIcons(): Promise<void> {
  // 刻意从 CJS 构建产物加载（而非裸 'lucide-react'）：应用各处的静态按需导入
  // 解析到 ESM 入口并被摇树成小子集；若此处对同一 ESM 模块做命名空间动态导入，
  // 会强制保留全量导出，使首屏静态图中的 lucide chunk 膨胀回 ~600KB。
  // CJS 路径是独立模块实例，全量表只存在于本懒加载 chunk 中。
  // @ts-expect-error CJS 深路径无类型声明，运行时形状与 ESM 入口一致
  loadPromise ??= import('lucide-react/dist/cjs/lucide-react.js').then((mod) => {
    const LucideIcons = ((mod as Record<string, unknown>).default ?? mod) as Record<string, unknown>;
    // lucide-react 图标使用 React.forwardRef 封装，typeof 为 'object' 而非 'function'
    // 过滤规则：大写字母开头、不以 Icon 结尾（避免 ActivityIcon / Activity 重复）
    registry = Object.fromEntries(
      Object.entries(LucideIcons).filter(
        ([key, val]) =>
          /^[A-Z]/.test(key) &&
          !key.endsWith('Icon') &&
          key !== 'createLucideIcon' &&
          isReactComponent(val),
      ),
    ) as Registry;
    allNames = Object.keys(registry).sort((a, b) => a.localeCompare(b));
    listeners.forEach((l) => l());
  });
  return loadPromise;
}

/**
 * 预热：在拿到登录凭证、尚未等到用户 / 菜单数据时就开始下载全量表，
 * 让它与鉴权请求并行而不是排在侧栏首次渲染之后。失败静默（渲染路径会再次触发加载）。
 */
export function prewarmLucideIcons(): void {
  void ensureLucideIcons().catch(() => {});
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** 注册表是否就绪；自动触发加载，加载完成后触发订阅组件重渲染 */
export function useLucideIconsReady(): boolean {
  void ensureLucideIcons();
  return useSyncExternalStore(subscribe, () => registry !== null, () => false);
}

/** 全部图标名（IconPicker 用）；未就绪时为空数组，就绪后自动重渲染 */
export function useAllIconNames(): string[] {
  useLucideIconsReady();
  return allNames;
}

/** 渲染指定名称的 lucide 图标；注册表未就绪（自动触发加载）或找不到时返回 null */
export function renderLucideIcon(name: string, size = 16): React.ReactElement | null {
  if (!registry) {
    void ensureLucideIcons();
    return null;
  }
  const Icon = registry[name];
  if (!Icon) return null;
  return React.createElement(Icon as React.ComponentType<{ size: number; strokeWidth?: number }>, { size, strokeWidth: 1.5 });
}
