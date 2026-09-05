/**
 * 运维域中不属于 HTTP 契约的类型（WebSocket 消息、设备主体枚举）。
 * API 实体类型一律从 `./contracts` 推导。
 */

/** Terminal WebSocket 消息（独立端点 /api/ws/terminal） */
export type TerminalMessage =
  | { type: 'terminal:input'; data: string }
  | { type: 'terminal:output'; data: string }
  | { type: 'terminal:cwd'; cwd: string }
  | { type: 'terminal:resize'; cols: number; rows: number }
  | { type: 'terminal:close' }
  | { type: 'terminal:exit' }
  | { type: 'terminal:error'; message: string }
  /** 服务端下发本次会话的权威标识；客户端保存后用于断线重连 */
  | { type: 'terminal:session'; sessionId: string }
  /** 重连成功，后续按输出缓冲回放 */
  | { type: 'terminal:reconnected' };

// ─── 统一设备中心 ─────────────────────────────────────────────────────────────

/** 设备绑定人类型（与通知收件人 user/member 对齐） */
export const DEVICE_SUBJECT_TYPES = ['user', 'member'] as const;
export type DeviceSubjectType = (typeof DEVICE_SUBJECT_TYPES)[number];
