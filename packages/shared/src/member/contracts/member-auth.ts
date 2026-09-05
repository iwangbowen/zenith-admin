import * as z from 'zod';
import { defineContract, op } from '../../core/contract';
import {
  memberChangePasswordSchema,
  memberDeactivateSchema,
  memberLoginSchema,
  memberRefreshTokenSchema,
  memberRegisterSchema,
  memberResetPasswordSchema,
  memberSmsCodeSchema,
  memberUpdateProfileSchema,
} from '../validation';
import { memberSchema } from './members';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const memberTokenSchema = z.object({
  accessToken: z.string().meta({ example: '******' }),
  refreshToken: z.string().meta({ example: '******' }),
}).meta({ id: 'MemberToken' });

export type MemberToken = z.infer<typeof memberTokenSchema>;

export const memberLoginResultSchema = z.object({
  member: memberSchema,
  token: memberTokenSchema,
}).meta({ id: 'MemberLoginResult' });

export type MemberLoginResult = z.infer<typeof memberLoginResultSchema>;

export const memberRefreshResultSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string().meta({ description: '续签同时轮换 refresh token：客户端必须以新值替换本地保存的 refresh token' }),
}).meta({ id: 'MemberRefreshResult' });

export type MemberRefreshResult = z.infer<typeof memberRefreshResultSchema>;

export const memberSmsCodeResultSchema = z.object({
  sent: z.boolean(),
  devCode: z.string().optional().meta({ description: '仅开发模式（NODE_ENV=development）回传，便于联调；其他环境永不返回' }),
}).meta({ id: 'MemberSmsCodeResult' });

export type MemberSmsCodeResult = z.infer<typeof memberSmsCodeResultSchema>;

// ─── 契约（会员前台认证） ────────────────────────────────────────────────────

export const memberAuthContract = defineContract('/api/member/auth', {
  smsCode: op.post('/sms-code', { body: memberSmsCodeSchema, response: memberSmsCodeResultSchema, summary: '发送会员短信验证码', public: true }),
  register: op.post('/register', { body: memberRegisterSchema, response: memberLoginResultSchema, summary: '会员注册', public: true }),
  login: op.post('/login', { body: memberLoginSchema, response: memberLoginResultSchema, summary: '会员登录', public: true }),
  refresh: op.post('/refresh', { body: memberRefreshTokenSchema, response: memberRefreshResultSchema, summary: '刷新会员令牌', public: true }),
  resetPassword: op.post('/reset-password', { body: memberResetPasswordSchema, summary: '会员重置密码（短信验证码）', public: true }),
  logout: op.post('/logout', { summary: '会员退出登录' }),
  me: op.get('/me', { response: memberSchema, summary: '获取当前会员' }),
  updateProfile: op.put('/profile', { body: memberUpdateProfileSchema, response: memberSchema, summary: '修改会员资料' }),
  changePassword: op.put('/password', { body: memberChangePasswordSchema, summary: '修改会员密码' }),
  deactivate: op.post('/deactivate', { body: memberDeactivateSchema, summary: '自助注销账户（软删除）' }),
}, { tags: ['MemberAuth'] });
