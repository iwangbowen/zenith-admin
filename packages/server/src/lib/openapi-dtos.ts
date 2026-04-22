/**
 * 统一的 OpenAPI 实体 DTO 定义，供所有路由模块复用。
 *
 * 各 DTO 已按业务域拆分至 `./dtos/` 子目录，本文件作为向后兼容的
 * re-export 入口，现有 `import { XxxDTO } from '../lib/openapi-dtos'`
 * 无需任何修改。
 *
 * 新增 DTO 请直接在对应的子文件中维护：
 *   - dtos/iam.ts       用户 / 角色 / 菜单 / 部门 / 租户 / 岗位 / 会话 / API Token
 *   - dtos/auth.ts      认证 / OAuth
 *   - dtos/dict.ts      字典
 *   - dtos/files.ts     文件存储
 *   - dtos/logs.ts      日志
 *   - dtos/notices.ts   通知公告
 *   - dtos/system.ts    系统配置 / 定时任务 / 邮件 / 缓存 / 备份 / 监控 / 在线会话
 *   - dtos/workflow.ts  工作流
 *   - dtos/dashboard.ts 仪表盘
 *   - dtos/region.ts    地区
 *   - dtos/messages.ts  消息模板
 */
export * from './dtos';
