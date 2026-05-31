/**
 * Auth / OAuth 相关 DTO：登录、验证码、Token、用户画像、OAuth 账号/配置
 */
import { z } from '@hono/zod-openapi';
import { auditFields } from './_audit';
import { UserDTO } from './users';

export const CaptchaDTO = z
  .object({
    enabled: z.boolean().openapi({ example: true }),
    captchaId: z.string().openapi({ example: 'uuid-xxx' }),
    svg: z.string().openapi({ example: '<svg>...</svg>' }),
  })
  .openapi('Captcha');

export const LoginResultDTO = z
  .object({
    user: UserDTO,
    token: z.object({
      accessToken: z.string().openapi({ example: 'eyJhbGciOi...' }),
      refreshToken: z.string().openapi({ example: 'eyJhbGciOi...' }),
    }),
    requirePasswordChange: z.boolean().optional(),
  })
  .openapi('LoginResult');

export const RefreshTokenResultDTO = z
  .object({
    accessToken: z.string(),
  })
  .openapi('RefreshTokenResult');

export const UserProfileDTO = UserDTO.extend({
  permissions: z.array(z.string()).optional(),
  lastLoginAt: z.string().nullable().optional().openapi({ example: '2026-01-01 09:00:00', description: '上次登录时间' }),
  lastLoginIp: z.string().nullable().optional().openapi({ description: '上次登录 IP' }),
  lastLoginLocation: z.string().nullable().optional().openapi({ description: '上次登录地理位置' }),
}).openapi('UserProfile');

export const TenantItemDTO = z
  .object({
    id: z.number().int(),
    name: z.string(),
    code: z.string(),
  })
  .openapi('TenantItem');

export const SwitchTenantResultDTO = z
  .object({
    accessToken: z.string(),
    refreshToken: z.string().optional(),
    viewingTenantId: z.number().int().nullable().optional(),
    tenantId: z.number().int().nullable().optional(),
  })
  .openapi('SwitchTenantResult');

export const OAuthAccountDTO = z
  .object({
    id: z.number().int(),
    provider: z.string(),
    openId: z.string(),
    nickname: z.string().nullable(),
    avatar: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('OAuthAccount');

export const OAuthAuthUrlDTO = z
  .object({ authUrl: z.string(), state: z.string() })
  .openapi('OAuthAuthUrl');

export const UserPreferencesDTO = z
  .record(z.string(), z.unknown())
  .openapi('UserPreferences');

export const OAuthConfigItemDTO = z
  .object({
    id: z.number().int(),
    provider: z.string(),
    clientId: z.string().nullable(),
    clientSecret: z.string(),
    enabled: z.boolean(),
    agentId: z.string().nullable().optional(),
    corpId: z.string().nullable().optional(),
    ...auditFields,
    createdAt: z.union([z.string(), z.date()]).nullable().optional(),
    updatedAt: z.union([z.string(), z.date()]).nullable().optional(),
  })
  .openapi('OAuthConfigItem');
