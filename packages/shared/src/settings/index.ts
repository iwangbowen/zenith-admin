/**
 * 运行时设置（Settings）：类型化模块设置文档的注册表、契约与解析规则。
 *
 * 用法：import { settingsContract, SETTINGS_MODULES, type SettingsOf } from '@zenith/shared/settings'
 * 新增设置项：改对应 `modules/*.ts` 的 schema（带 `.default()` / `.meta({ title })`）即可，
 * 契约、服务端读取、通用设置页与 MSW 全部随之派生；新增模块另在 `registry.ts` 登记一行。
 * 注意：本入口刻意不导出种子数据，seed 请走 '@zenith/shared/seed'。
 */
export * from './constants';
export * from './contracts';
export * from './module-def';
export * from './modules/ai';
export * from './modules/auth';
export * from './modules/drive';
export * from './modules/files';
export * from './modules/identity-security';
export * from './modules/ip-access';
export * from './modules/member';
export * from './modules/payment';
export * from './modules/rules';
export * from './modules/terminal';
export * from './modules/ui';
export * from './modules/wiki';
export * from './modules/workflow';
export * from './registry';
export * from './resolve';
