import * as z from 'zod';
import { idParam, keywordQuery, paginated, paginationQuery, queryEnum } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { SESSION_CLIENT_KIND_OPTIONS, SESSION_CLIENT_KINDS } from '../constants';
import { tokenIdParam } from './auth';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 在线会话（管理员视角） */
export const onlineSessionSchema = z.object({
  tokenId: z.string(),
  userId: z.int(),
  username: z.string(),
  nickname: z.string(),
  client: z.enum(SESSION_CLIENT_KINDS).meta({ description: '登录终端：web 网页 / mobile 移动审批 / desktop 桌面端' }),
  ip: z.string(),
  location: z.string().nullable(),
  browser: z.string(),
  os: z.string(),
  loginAt: z.string(),
  lastActiveAt: z.string(),
  impersonatorName: z.string().nullable().optional().meta({ description: '模拟会话的实际操作人；本人登录为 null' }),
}).meta({ id: 'OnlineSession' });

export type OnlineSession = z.infer<typeof onlineSessionSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const sessionListQuery = paginationQuery.extend({
  keyword: keywordQuery('用户名 / 昵称 / IP '),
  client: queryEnum(SESSION_CLIENT_KINDS, { description: '登录终端；空 = 全部', options: SESSION_CLIENT_KIND_OPTIONS }),
});

export const sessionContract = defineContract('/api/sessions', {
  list: op.get('/', { access: { permission: 'system:session:list' }, query: sessionListQuery, response: paginated(onlineSessionSchema), summary: '获取在线会话列表' }),
  forceLogoutUser: op.delete('/user/{id}', { access: { permission: 'system:session:forceLogout' }, audit: '强制下线全部会话', params: idParam, summary: '强制指定用户所有会话下线' }),
  forceLogout: op.delete('/{tokenId}', { access: { permission: 'system:session:forceLogout' }, audit: '强制下线', params: tokenIdParam, summary: '强制指定会话下线' }),
}, { tags: ['Sessions'], auditModule: '会话管理' });
