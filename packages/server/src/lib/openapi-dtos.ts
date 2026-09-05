/**
 * 统一的 OpenAPI 实体 DTO 定义，供所有路由模块复用。
 *
 * 实体 DTO 按业务域组织在 `./dtos/` 子目录，本文件作为统一的
 * re-export 入口，统一通过 `import { XxxDTO } from './openapi-dtos'` 导入。
 *
 * 新增 DTO 请直接在对应的子文件中维护（已契约化的域没有独立 DTO，实体 schema 来自 `@zenith/shared`）：
 *   - dtos/dict.ts           字典
 *   - dtos/logs.ts           日志（IP 拦截 / 操作日志统计 / 日志文件）
 *   - dtos/system-configs.ts 系统配置 / 密码策略
 *   - dtos/cache.ts          缓存
 *   - dtos/db-backups.ts     数据库备份
 *   - dtos/monitor.ts        服务器监控
 *   - dtos/workflow.ts       工作流
 *   - dtos/region.ts         地区
 */
export * from './dtos';
