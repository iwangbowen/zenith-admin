/**
 * 工作流自定义业务表单组件注册表
 *
 * 只收 `pages/biz/**`、`*BusinessForm.tsx`（发起视图）与 `*ApprovalView.tsx`（审批 / 查看视图），
 * 供 `BusinessFormHost` 按 `customForm.createComponent / viewComponent` 解析组件。
 *
 * ⚠️ 与 `page-registry.ts`（后台路由页面 `*Page.tsx`）刻意分成两个模块：glob 在构建期按模块展开，
 * 移动审批入口只引用本文件，才不会把几百个后台页面 chunk 及其重依赖一并打进 `assets-approval/`。
 * 新增可被流程定义引用的业务表单请遵守上述命名。
 */
import { createComponentRegistry, type ComponentModuleMap } from './component-registry';

// glob 相对当前文件（src/utils），故使用 ../pages
export const businessFormModules = import.meta.glob([
  '../pages/biz/**/*.tsx',
  '../pages/**/*BusinessForm.tsx',
  '../pages/**/*ApprovalView.tsx',
  '!../pages/**/*Skeleton.tsx',
  '!../pages/**/*.test.tsx',
]) as ComponentModuleMap;

const registry = createComponentRegistry(businessFormModules);

/** 组件路径是否为已注册的业务表单组件 */
export const hasBusinessFormComponent = registry.has;

/** 解析业务表单组件路径为 React.lazy 组件；不存在时返回 null */
export const lazyBusinessFormComponent = registry.lazy;
