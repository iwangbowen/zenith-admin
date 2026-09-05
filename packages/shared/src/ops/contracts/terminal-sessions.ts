import * as z from 'zod';
import { paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { TERMINAL_SESSION_KINDS } from '../constants';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 活动终端会话（管理员监控视图） */
export const terminalSessionSchema = z.object({
  sessionId: z.string(),
  userId: z.int(),
  username: z.string(),
  kind: z.enum(TERMINAL_SESSION_KINDS).meta({ description: '会话类型：本地 / SSH / Docker / 数据库' }),
  label: z.string().meta({ description: '展示标签：本地为 shell 名，SSH 为 user@host，Docker 为容器名' }),
  clientIp: z.string(),
  cols: z.int(),
  rows: z.int(),
  connected: z.boolean().meta({ description: '客户端当前是否在线（断线保活期间为 false）' }),
  observerCount: z.int().meta({ description: '当前监控该会话的管理员数量' }),
  takenOver: z.boolean().meta({ description: '是否正被管理员接管输入' }),
  startedAt: z.string(),
  lastActivityAt: z.string(),
  idleSeconds: z.int().meta({ description: '距最近活跃的秒数' }),
  durationSeconds: z.int().meta({ description: '会话已持续秒数' }),
}).meta({ id: 'TerminalSession' });

export type TerminalSession = z.infer<typeof terminalSessionSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const terminalSessionListQuery = paginationQuery.extend({
  keyword: z.string().optional(),
  kind: z.enum(TERMINAL_SESSION_KINDS).optional(),
});

export const terminalSessionIdParam = z.object({
  sessionId: z.string().min(1).meta({ description: '终端会话 ID', example: 'tab-1-1700000000000' }),
});

export const terminalSessionContract = defineContract('/api/terminal-sessions', {
  list: op.get('/', { query: terminalSessionListQuery, response: paginated(terminalSessionSchema), summary: '活动终端会话列表' }),
  terminate: op.post('/{sessionId}/terminate', { params: terminalSessionIdParam, summary: '强制终止终端会话' }),
}, { tags: ['TerminalSessions'] });
