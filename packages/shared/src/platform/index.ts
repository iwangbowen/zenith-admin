/**
 * 平台能力：字典 / 系统配置 / 文件 / 日志 / 会话 / 监控 / 备份 / 脱敏
 *
 * 用法：import { Xxx } from '@zenith/shared/platform'
 * 注意：本入口刻意不导出种子数据，seed 请走 '@zenith/shared/seed'。
 */
export * from './constants';
export * from './contracts';
export * from './data-mask';
export * from './regions';
export * from './types';
export * from './upload';
export * from './validation';
