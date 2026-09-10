/**
 * 岛（island）契约：服务端主题组件只输出 `<el data-island="name" data-…>` 容器与 data 属性，
 * 浏览器端由本目录的模块按名挂载。岛必须以 data-* 属性为唯一输入契约，找不到期望的
 * 元素时静默 no-op——陈旧静态页可能引用新版本脚本，容器结构不匹配不得抛错。
 */
export type IslandMount = (el: HTMLElement) => void;

/**
 * 岛注册表：name → 挂载函数。新增岛 = 新建模块 + 在此登记 + 主题容器加 data-island。
 */
export const registry: Readonly<Record<string, IslandMount>> = {};
