/**
 * 统一的 OpenAPI 实体 DTO 定义，供所有路由模块复用。
 *
 * 实体 DTO 按业务域组织在 `./dtos/` 子目录，本文件作为统一的
 * re-export 入口，统一通过 `import { XxxDTO } from './openapi-dtos'` 导入。
 *
 * 新增 DTO 请直接在对应的子文件中维护（已契约化的域没有独立 DTO，实体 schema 来自 `@zenith/shared`）：
 *   - dtos/oauth2.ts         OAuth2 RFC 协议端点响应
 *   - dtos/cms.ts            CMS 内容管理
 */
export * from './dtos';
