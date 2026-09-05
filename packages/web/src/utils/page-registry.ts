/**
 * 页面组件注册表
 *
 * 统一通过 Vite `import.meta.glob` 收集可被路由 / 流程配置直接引用的页面级组件，
 * 并提供「组件路径字符串 → 动态 import / React.lazy」的解析能力。
 *
 * 复用方：
 * - `App.tsx`：菜单动态路由（DB 存 `component` 字段，如 `system/users/UsersPage`）
 * - 工作流自定义业务表单：`customForm.createComponent` / `viewComponent`
 *
 * 组件路径约定：相对 `src/pages` 的路径，不含前导 `/` 与 `.tsx` 后缀，
 * 例如 `system/users/UsersPage`、`biz/leave/LeaveApprovalView`。
 *
 * 只收页面级组件：`*Page.tsx`（菜单路由）、`pages/biz/**`（业务示例表单）、`*BusinessForm.tsx` /
 * `*ApprovalView.tsx`（工作流自定义业务表单的发起 / 审批视图）。glob 命中的每个文件都会成为独立的
 * 动态入口——页面内部的子组件 / Tab / 弹窗一旦被收进来，就会被迫从所属页面的 chunk 中拆出、多出一次请求，
 * 且每个入口都在注册表里携带一份预载依赖表。新增可被 DB 引用的组件请遵守上述命名。
 */
import React from 'react';

type PageModuleLoader = () => Promise<{ default: React.ComponentType<unknown> }>;

// glob 相对当前文件（src/utils），故使用 ../pages
const pageModules = import.meta.glob([
  '../pages/**/*Page.tsx',
  '../pages/biz/**/*.tsx',
  '../pages/**/*BusinessForm.tsx',
  '../pages/**/*ApprovalView.tsx',
  '!../pages/**/*Skeleton.tsx',
  '!../pages/**/*.test.tsx',
]);
const lazyPageComponents = new Map<string, React.LazyExoticComponent<React.ComponentType<unknown>>>();

/** 归一化组件路径：去除前导斜杠与 .tsx 后缀 */
function normalizeComponentPath(component: string): string {
  return component.replace(/^\/+/, '').replace(/\.tsx$/, '');
}

/** 解析组件路径为动态 import loader；不存在时返回 null */
export function resolvePageLoader(component: string | null | undefined): PageModuleLoader | null {
  if (!component) return null;
  const key = `../pages/${normalizeComponentPath(component)}.tsx`;
  return (pageModules[key] as PageModuleLoader | undefined) ?? null;
}

/** 组件路径是否存在对应页面文件 */
export function hasPageComponent(component: string | null | undefined): boolean {
  return resolvePageLoader(component) !== null;
}

/** 解析组件路径为 React.lazy 组件；不存在时返回 null */
export function lazyPageComponent(
  component: string | null | undefined,
): React.LazyExoticComponent<React.ComponentType<unknown>> | null {
  if (!component) return null;
  const normalized = normalizeComponentPath(component);
  const cached = lazyPageComponents.get(normalized);
  if (cached) return cached;
  const loader = resolvePageLoader(component);
  if (!loader) return null;
  const lazyComponent = React.lazy(loader);
  lazyPageComponents.set(normalized, lazyComponent);
  return lazyComponent;
}
