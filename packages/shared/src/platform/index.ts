/**
 * 平台能力：字典 / 系统配置 / 文件 / 日志 / 会话 / 监控 / 备份 / 脱敏
 *
 * 用法：import { Xxx } from '@zenith/shared/platform'
 * 注意：本入口刻意不导出种子数据，seed 请走 '@zenith/shared/seed'。
 */
export * from './constants';
export * from './contracts';
export * from './cron-expression';
export * from './cron-health';
export * from './data-mask';
export * from './entity-registry';
export * from './domain-events';
export * from './regions';
export * from './types';
export * from './upload';
export * from './validation';
export * from './permissions';
export * from './ws-monitor';
export * from './workflow-business-catalog';
export * from './relation-origin';
export * from './relation-filter-capabilities';
export * from './manual-relations';

export * from './entity-watches';

export * from './entity-detail-routes';
