/**
 * 运维域中无法由契约 schema 推导的类型。
 * 进程 / 证书 / 备份 / 主机 / 应用版本 / 设备等 API 实体类型一律从 `./contracts` 推导。
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

/** 保留策略执行器的单条结果（含策略标题，供定时任务日志汇总；API 响应见 `retentionRunResultSchema`） */
export interface RetentionRunResult {
  key: string;
  title: string;
  deleted: number;
}

// ─── 统一设备中心 ─────────────────────────────────────────────────────────────

/** 设备绑定人类型（与通知收件人 user/member 对齐） */
export const DEVICE_SUBJECT_TYPES = ['user', 'member'] as const;
export type DeviceSubjectType = (typeof DEVICE_SUBJECT_TYPES)[number];
