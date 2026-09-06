/**
 * 页面组件注册表（后台路由）
 *
 * 统一通过 Vite `import.meta.glob` 收集可被菜单路由直接引用的页面级组件（`*Page.tsx`），
 * 并提供「组件路径字符串 → 动态 import / React.lazy」的解析能力。
 *
 * 复用方：
 * - `App.tsx`：菜单动态路由（DB 存 `component` 字段，如 `system/users/UsersPage`）
 * - 流程设计器：校验自定义业务表单组件路径是否存在
 *
 * 组件路径约定：相对 `src/pages` 的路径，不含前导 `/` 与 `.tsx` 后缀，
 * 例如 `system/users/UsersPage`、`biz/leave/LeaveApprovalView`。
 *
 * 只收页面级组件：`*Page.tsx`（菜单路由）；工作流自定义业务表单（`pages/biz/**`、`*BusinessForm.tsx` /
 * `*ApprovalView.tsx`）收在 `business-form-registry.ts`，本注册表合并两者对外解析。glob 命中的每个文件都会成为
 * 独立的动态入口——页面内部的子组件 / Tab / 弹窗一旦被收进来，就会被迫从所属页面的 chunk 中拆出、多出一次请求，
 * 且每个入口都在注册表里携带一份预载依赖表。新增可被 DB 引用的组件请遵守上述命名。
 *
 * ⚠️ 本模块含全部后台页面的 glob，只能被后台入口（`App.tsx` 及其页面）引用；会员端 / 移动审批入口
 * 一旦引用，整套后台页面 chunk 都会进入其产物。
 */
import { businessFormModules } from './business-form-registry';
import { createComponentRegistry, type ComponentModuleMap } from './component-registry';

// glob 相对当前文件（src/utils），故使用 ../pages
const pageModules = import.meta.glob([
  '../pages/**/*Page.tsx',
  '!../pages/**/*Skeleton.tsx',
  '!../pages/**/*.test.tsx',
]) as ComponentModuleMap;

const registry = createComponentRegistry({ ...businessFormModules, ...pageModules });

/** 解析组件路径为动态 import loader；不存在时返回 null */
export const resolvePageLoader = registry.resolveLoader;

/** 组件路径是否存在对应页面文件 */
export const hasPageComponent = registry.has;

/** 解析组件路径为 React.lazy 组件；不存在时返回 null */
export const lazyPageComponent = registry.lazy;
