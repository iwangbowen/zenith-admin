import * as LucideIcons from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import React from 'react';

// ─── 动态注册表：从 lucide-react 全量导出中提取所有图标组件 ──────────────────
// lucide-react 图标使用 React.forwardRef 封装，typeof 为 'object' 而非 'function'
// 过滤规则：大写字母开头、不以 Icon 结尾（避免 ActivityIcon / Activity 重复）
// 同时兼容 function 组件和 forwardRef object 组件
const _excluded = new Set(['createLucideIcon']);

function isReactComponent(val: unknown): boolean {
  if (typeof val === 'function') return true;
  if (typeof val === 'object' && val !== null && '$$typeof' in val) return true;
  return false;
}

export const ICON_REGISTRY: Record<string, LucideIcon> = Object.fromEntries(
  Object.entries(LucideIcons).filter(
    ([key, val]) =>
      /^[A-Z]/.test(key) &&
      !key.endsWith('Icon') &&
      !_excluded.has(key) &&
      isReactComponent(val),
  ),
) as Record<string, LucideIcon>;

export const ALL_ICON_NAMES: string[] = Object.keys(ICON_REGISTRY).sort((a, b) => a.localeCompare(b));

/** 渲染指定名称的 lucide 图标，找不到时返回 null */
export function renderLucideIcon(name: string, size = 16): React.ReactElement | null {
  const Icon = ICON_REGISTRY[name];
  if (!Icon) return null;
  return React.createElement(Icon as React.ComponentType<{ size: number }>, { size });
}
