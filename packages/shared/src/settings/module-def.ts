import type * as z from 'zod';
import type { LicenseFeatureKey } from '../licensing/constants';
import type { SettingsScope, SettingsVisibility } from './constants';

/**
 * 设置模块定义：一个模块 = 一份 Zod 文档 schema + 治理元数据。
 *
 * - `schema`：**读取 schema**，每个叶子字段必须带 `.default()`，嵌套对象必须 `.prefault({})`，
 *   保证 `schema.parse({})` 即完整默认文档——默认值只在这里出现一次，不进种子、不进调用点。
 *   字段的表单标签 / 说明写在 `.meta({ title, description })`，通用设置页据此渲染。
 * - `scope`：`platform` 全局一行；`tenant` 允许租户覆盖平台值。**被无请求上下文的后台任务读取的模块
 *   必须是 `platform`**（任务拿不到租户，tenant 作用域会静默退回平台值）。
 * - `feature`：License 特性门控，随同名业务域的路由挂载（`{ feature }`）保持一致；
 *   `/me` 投影按租户套餐过滤带门控的模块。
 * - `readPermission` 为 `null` 表示任意登录用户可读整模块；`writePermission` 为写入权限码。
 * - `visibility`：字段级投影（默认 `admin`），只在顶层字段粒度声明；嵌套对象整体进入投影。
 * - `page`：已有专用页面的模块在通用设置页只给跳转链接。
 */
export interface SettingsModuleDef<S extends z.ZodObject = z.ZodObject> {
  readonly schema: S;
  readonly title: string;
  readonly description: string;
  readonly scope: SettingsScope;
  readonly feature?: LicenseFeatureKey;
  readonly readPermission: string | null;
  readonly writePermission: string;
  readonly visibility?: Partial<Record<keyof z.output<S> & string, SettingsVisibility>>;
  readonly page?: string;
  readonly sort: number;
}

/** 身份函数：保留各模块 schema 的精确类型，供注册表推导 `SettingsOf<M>` */
export function defineSettingsModule<S extends z.ZodObject>(def: SettingsModuleDef<S>): SettingsModuleDef<S> {
  return def;
}
