import * as z from 'zod';
import { idParam } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { IDENTITY_PROVIDER_TYPES } from '../constants';
import { enterpriseLdapLoginSchema, enterpriseOidcCallbackSchema, enterpriseSamlExchangeSchema } from '../validation';
import { loginResultSchema } from './auth';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 登录页展示的企业身份源入口（不含任何凭据） */
export const tenantIdentityProviderSummarySchema = z.object({
  id: z.int(),
  name: z.string(),
  code: z.string(),
  type: z.enum(IDENTITY_PROVIDER_TYPES),
}).meta({ id: 'TenantIdentityProviderSummary' });

export type TenantIdentityProviderSummary = z.infer<typeof tenantIdentityProviderSummarySchema>;

export const enterpriseIdentityDiscoverySchema = z.object({
  tenantCode: z.string().nullable().optional(),
  providers: z.array(tenantIdentityProviderSummarySchema),
}).meta({ id: 'EnterpriseIdentityDiscovery' });

export type EnterpriseIdentityDiscovery = z.infer<typeof enterpriseIdentityDiscoverySchema>;

export const enterpriseAuthUrlSchema = z.object({
  authUrl: z.string(),
  state: z.string().nullable(),
}).meta({ id: 'EnterpriseAuthUrl' });

export type EnterpriseAuthUrl = z.infer<typeof enterpriseAuthUrlSchema>;

/** 企业登录结果：登录态或 MFA 挑战 + 发起登录时携带的回跳地址 */
export const enterpriseLoginResultSchema = z.object({
  loginResult: loginResultSchema,
  redirectTo: z.string().nullable().optional(),
}).meta({ id: 'EnterpriseLoginResult' });

export type EnterpriseLoginResult = z.infer<typeof enterpriseLoginResultSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const enterpriseDiscoveryQuery = z.object({
  tenantCode: z.string().optional(),
});

export const enterpriseAuthUrlQuery = z.object({
  redirect: z.string().optional().meta({ description: '登录成功后的回跳地址' }),
});

/**
 * 企业身份源登录（公开端点）。SAML ACS 端点为 IdP 表单回调并 302 重定向到前端，
 * 不是 JSON 协议，由路由文件单独声明。
 */
export const enterpriseAuthContract = defineContract('/api/auth/enterprise', {
  providers: op.get('/providers', { query: enterpriseDiscoveryQuery, response: enterpriseIdentityDiscoverySchema, summary: '发现企业身份源', public: true }),
  authUrl: op.get('/{id}', { params: idParam, query: enterpriseAuthUrlQuery, response: enterpriseAuthUrlSchema, summary: '获取企业身份源授权链接', public: true }),
  callback: op.post('/callback', { body: enterpriseOidcCallbackSchema, response: enterpriseLoginResultSchema, summary: '企业 OIDC 登录回调', public: true }),
  ldapLogin: op.post('/ldap/login', { body: enterpriseLdapLoginSchema, response: enterpriseLoginResultSchema, summary: '企业 LDAP/AD 登录', public: true }),
  samlExchange: op.post('/saml/exchange', { body: enterpriseSamlExchangeSchema, response: enterpriseLoginResultSchema, summary: '兑换企业 SAML 登录票据', public: true }),
}, { tags: ['EnterpriseAuth'] });
