/**
 * 系统配置、密码策略相关 DTO
 */
import { z } from '@hono/zod-openapi';
import { auditFields } from './_audit';

export const SystemConfigDTO = z
  .object({
    id: z.number().int(),
    configKey: z.string().openapi({ example: 'site_title' }),
    configValue: z.string().openapi({ example: 'Zenith Admin' }),
    configType: z.enum(['string', 'number', 'boolean', 'json']),
    description: z.string(),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('SystemConfig');

export const PasswordPolicyDTO = z
  .object({
    minLength: z.number().int(),
    requireUppercase: z.boolean(),
    requireSpecialChar: z.boolean(),
  })
  .openapi('PasswordPolicy');

export const PublicConfigDTO = z
  .object({
    configKey: z.string(),
    configValue: z.string().nullable(),
    configType: z.enum(['string', 'number', 'boolean', 'json']),
  })
  .openapi('PublicConfig');
