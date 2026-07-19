// 数据库 schema barrel：按业务域拆分至 ./schema/ 目录，此处统一 re-export。
// 导入方式保持不变：import { users } from './schema'
// 新增表时请在对应业务域文件中维护，勿在本文件添加实体定义。

export * from './schema/common';
export * from './schema/core';
export * from './schema/files';
export * from './schema/data-mask';
export * from './schema/tasks';
export * from './schema/system';
export * from './schema/auth';
export * from './schema/identity-providers';
export * from './schema/dicts';
export * from './schema/logs';
export * from './schema/analytics';
export * from './schema/announcements';
export * from './schema/workflow';
export * from './schema/messaging';
export * from './schema/db-admin';
export * from './schema/tags';
export * from './schema/rules';
export * from './schema/biz';
export * from './schema/chat';
export * from './schema/channels';
export * from './schema/payment';
export * from './schema/ai';
export * from './schema/open-platform';
export * from './schema/terminal';
export * from './schema/member';
export * from './schema/monitor';
export * from './schema/mp';
export * from './schema/report';
export * from './schema/report-platform';
export * from './schema/cms';
export * from './schema/relations';
