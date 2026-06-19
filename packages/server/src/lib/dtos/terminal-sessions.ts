/**
 * 终端会话监控 DTO
 */
import { z } from '@hono/zod-openapi';

/** 活动终端会话（管理员监控视图） */
export const TerminalSessionDTO = z
  .object({
    sessionId: z.string(),
    userId: z.number().int(),
    username: z.string(),
    /** 会话类型：本地 / SSH / Docker */
    kind: z.enum(['local', 'ssh', 'docker']),
    /** 展示标签：本地为 shell 名，SSH 为 user@host，Docker 为容器名 */
    label: z.string(),
    clientIp: z.string(),
    cols: z.number().int(),
    rows: z.number().int(),
    /** 客户端当前是否在线（断线保活期间为 false） */
    connected: z.boolean(),
    /** 当前监控该会话的管理员数量 */
    observerCount: z.number().int(),
    /** 是否正被管理员接管输入 */
    takenOver: z.boolean(),
    startedAt: z.string(),
    lastActivityAt: z.string(),
    /** 距最近活跃的秒数 */
    idleSeconds: z.number().int(),
    /** 会话已持续秒数 */
    durationSeconds: z.number().int(),
  })
  .openapi('TerminalSession');
