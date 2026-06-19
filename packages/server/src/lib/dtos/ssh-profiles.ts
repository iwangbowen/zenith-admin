/**
 * SSH 连接配置 DTO
 */
import { z } from '@hono/zod-openapi';

export const SshProfileDTO = z
  .object({
    id: z.number().int(),
    userId: z.number().int(),
    name: z.string(),
    host: z.string(),
    port: z.number().int(),
    username: z.string(),
    authType: z.enum(['password', 'key_path', 'key_content', 'agent']),
    /** 密码（仅返回是否已设置，不回传明文） */
    hasPassword: z.boolean(),
    keyPath: z.string().nullable(),
    /** 私钥内容（仅返回是否已设置） */
    hasKeyContent: z.boolean(),
    /** 口令（仅返回是否已设置） */
    hasKeyPassphrase: z.boolean(),
    envVars: z.record(z.string(), z.string()),
    /** 所属分组名称（null 表示未分组） */
    groupName: z.string().nullable(),
    /** 标签数组 */
    tags: z.array(z.string()),
    orderNum: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('SshProfile');
