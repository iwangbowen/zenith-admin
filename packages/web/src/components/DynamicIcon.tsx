import type React from 'react';
import { renderLucideIcon, useLucideIconsReady } from '../utils/icons';

export interface DynamicIconProps {
  readonly name: string | null | undefined;
  readonly size?: number;
  /** 注册表未就绪或名字无效时的占位（默认不渲染） */
  readonly fallback?: React.ReactNode;
}

/**
 * 按名字渲染 lucide 图标（图标名来自数据：菜单、工作流模板、表单配置……）。
 * 自动订阅注册表就绪，就绪后自行补齐，调用方无需关心加载状态；投递策略见 utils/icons.tsx。
 */
export function DynamicIcon({ name, size = 16, fallback = null }: DynamicIconProps): React.ReactElement | null {
  useLucideIconsReady();
  if (!name) return fallback as React.ReactElement | null;
  return renderLucideIcon(name, size) ?? (fallback as React.ReactElement | null);
}
