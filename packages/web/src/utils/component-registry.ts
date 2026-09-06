/**
 * 「组件路径字符串 → 动态 import / React.lazy」解析器工厂。
 *
 * 本文件不含任何 `import.meta.glob`：glob 在构建期按模块展开，哪个入口引用了含 glob 的模块，
 * 该 glob 命中的全部文件就会进入那个入口的产物。因此不同用途的注册表必须放在各自的模块里
 * （`page-registry.ts` 收后台路由页面，`business-form-registry.ts` 只收工作流业务表单），
 * 只需要业务表单的入口（移动审批）才不会被迫带上整套后台页面。
 */
import React from 'react';

export type PageModuleLoader = () => Promise<{ default: React.ComponentType<unknown> }>;

export type ComponentModuleMap = Record<string, PageModuleLoader>;

/** 归一化组件路径：去除前导斜杠与 .tsx 后缀（相对 `src/pages`，如 `system/users/UsersPage`） */
export function normalizeComponentPath(component: string): string {
  return component.replace(/^\/+/, '').replace(/\.tsx$/, '');
}

export interface ComponentRegistry {
  /** 解析组件路径为动态 import loader；不存在时返回 null */
  resolveLoader: (component: string | null | undefined) => PageModuleLoader | null;
  /** 组件路径是否存在对应文件 */
  has: (component: string | null | undefined) => boolean;
  /** 解析组件路径为 React.lazy 组件（同路径复用同一实例，避免父组件重渲染时 lazy 身份变化）；不存在时返回 null */
  lazy: (component: string | null | undefined) => React.LazyExoticComponent<React.ComponentType<unknown>> | null;
}

/** 由 `import.meta.glob` 结果（键为相对 `src/utils` 的 `../pages/**` 路径）创建解析器 */
export function createComponentRegistry(modules: ComponentModuleMap): ComponentRegistry {
  const lazyComponents = new Map<string, React.LazyExoticComponent<React.ComponentType<unknown>>>();

  const resolveLoader: ComponentRegistry['resolveLoader'] = (component) => {
    if (!component) return null;
    const key = `../pages/${normalizeComponentPath(component)}.tsx`;
    return modules[key] ?? null;
  };

  const lazy: ComponentRegistry['lazy'] = (component) => {
    if (!component) return null;
    const normalized = normalizeComponentPath(component);
    const cached = lazyComponents.get(normalized);
    if (cached) return cached;
    const loader = resolveLoader(component);
    if (!loader) return null;
    const lazyComponent = React.lazy(loader);
    lazyComponents.set(normalized, lazyComponent);
    return lazyComponent;
  };

  return { resolveLoader, has: (component) => resolveLoader(component) !== null, lazy };
}
