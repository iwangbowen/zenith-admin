import type { ChatMessage, ChatReactionGroup, ChatVoteData } from '../chat/contracts';
import type { RtcIceCandidateInit, RtcInvitePayload, RtcPeerInfo } from '../chat/types';
import type { Announcement, ChannelMessage, InAppMessage } from '../messaging/contracts';
import type { MpMessageDirection, MpMessageType } from '../mp/constants';
import type { MpKfSession } from '../mp/contracts';
import type { AsyncTask } from '../tasks/contracts';
import type { WorkflowInstanceStatus } from '../workflow/types';

// ─── 文件管理 ─────────────────────────────────────────────────────────────────
export type FileStorageProvider = 'local' | 'oss' | 's3' | 'cos' | 'obs' | 'kodo' | 'bos' | 'azure' | 'sftp';

/** 对象读写权限（canned ACL）；default = 继承 Bucket */
export type FileObjectAcl = 'default' | 'private' | 'public-read' | 'public-read-write';

/** 文件访问 URL 策略；proxy=服务端代理，public=永久公开直链，presigned=临时签名直链 */
export type FileUrlStrategy = 'proxy' | 'public' | 'presigned';

/** 托管文件可见性；public=持 ID 可读，restricted=仅归属模块鉴权接口可读 */
export type FileVisibility = 'public' | 'restricted';

// ─── Maintenance Logs ────────────────────────────────────
export type MaintenanceLogStatus = 'ongoing' | 'completed';

export interface MaintenanceLog {
  id: number;
  message: string;
  estimatedEndAt: string | null;
  startedAt: string | null;
  startedByName: string | null;
  endedAt: string | null;
  endedByName: string | null;
  durationSeconds: number | null;
  status: MaintenanceLogStatus;
  createdAt: string;
}

// ─── WebSocket 推送消息 ────────────────────────────────────────────────────────
export type WsMessage =
  | { type: 'announcement:new'; payload: Announcement }
  | { type: 'announcement:updated'; payload: Announcement }
  | { type: 'announcement:deleted'; payload: { id: number } }
  | { type: 'announcement:read'; payload: { id: number } }
  | { type: 'announcement:read-all'; payload: Record<string, never> }
  | { type: 'in-app-message:new'; payload: InAppMessage }
  | { type: 'in-app-message:read'; payload: { id: number } }
  | { type: 'in-app-message:read-all'; payload: Record<string, never> }
  | { type: 'in-app-message:deleted'; payload: { id: number } }
  | { type: 'session:force-logout'; payload: { reason: string } }
  | { type: 'chat:message'; payload: ChatMessage }
  | { type: 'chat:recall'; payload: { conversationId: number; messageId: number } }
  | { type: 'chat:read'; payload: { conversationId: number; userId: number; readAt: string } }
  | { type: 'chat:member-join'; payload: { conversationId: number; user: { id: number; nickname: string; avatar: string | null } } }
  | { type: 'chat:member-leave'; payload: { conversationId: number; userId: number } }
  | { type: 'chat:group-update'; payload: { conversationId: number; name?: string | null; announcement?: string | null; muteAll?: boolean; joinApproval?: boolean } }
  | { type: 'chat:member-update'; payload: { conversationId: number } }
  | { type: 'chat:join-request'; payload: { conversationId: number } }
  | { type: 'chat:conversation-removed'; payload: { conversationId: number; reason: 'disbanded' } }
  | { type: 'chat:typing'; payload: { conversationId: number; userId: number; nickname: string } }
  | { type: 'chat:reaction'; payload: { conversationId: number; messageId: number; reactions: ChatReactionGroup[] } }
  | { type: 'chat:edit'; payload: ChatMessage }
  | { type: 'chat:vote-update'; payload: { conversationId: number; messageId: number; voteData: ChatVoteData } }
  | { type: 'chat:presence'; payload: { userId: number; online: boolean; lastSeen: string | null } }
  | { type: 'channel:message'; payload: ChannelMessage }
  | { type: 'channel:message-retract'; payload: { channelId: number; messageId: number } }
  | { type: 'channel:cs-message'; payload: { channelId: number } }
  | { type: 'rtc:invite'; payload: RtcInvitePayload }
  | { type: 'rtc:accept'; payload: { callId: string; to: number; from: RtcPeerInfo } }
  | { type: 'rtc:reject'; payload: { callId: string; to: number; reason?: string } }
  | { type: 'rtc:busy'; payload: { callId: string; to: number } }
  | { type: 'rtc:cancel'; payload: { callId: string; conversationId: number; to?: number } }
  | { type: 'rtc:join'; payload: { callId: string; conversationId: number; from: RtcPeerInfo } }
  | { type: 'rtc:room-participants'; payload: { callId: string; participants: RtcPeerInfo[] } }
  | { type: 'rtc:leave'; payload: { callId: string; conversationId: number; from: number; to?: number } }
  | { type: 'rtc:offer'; payload: { callId: string; to: number; from: number; sdp: string } }
  | { type: 'rtc:answer'; payload: { callId: string; to: number; from: number; sdp: string } }
  | { type: 'rtc:ice'; payload: { callId: string; to: number; from: number; candidate: RtcIceCandidateInit } }
  | { type: 'workflow:taskCreated'; payload: { instanceId: number; taskId: number; instanceTitle: string; nodeName: string } }
  | { type: 'workflow:taskFinished'; payload: { instanceId: number; taskId: number; decision: 'approved' | 'rejected' | 'skipped' } }
  | { type: 'workflow:instanceFinished'; payload: { instanceId: number; status: WorkflowInstanceStatus; title: string } }
  | { type: 'payment:success'; payload: { orderNo: string; bizType: string; bizId: string; amount: number } }
  | { type: 'payment:closed'; payload: { orderNo: string; bizType: string; bizId: string } }
  | { type: 'payment:failed'; payload: { orderNo: string; bizType: string; bizId: string } }
  | { type: 'payment:refunded'; payload: { orderNo: string; refundNo: string; refundAmount: number } }
  | { type: 'payment:refund-failed'; payload: { orderNo: string; refundNo: string; refundAmount: number } }
  | { type: 'task:progress'; payload: AsyncTask }
  | { type: 'mp-kf:session-new'; payload: MpKfSession }
  | { type: 'mp-kf:session-update'; payload: MpKfSession }
  | { type: 'mp-kf:session-message'; payload: { sessionId: number; accountId: number; openid: string; direction: MpMessageDirection; msgType: MpMessageType; content: string | null; createdAt: string } }
  | { type: 'analytics:ingest'; payload: { count: number } }
  | { type: 'analytics:config-updated'; payload: { tenantId: number | null } }
  | { type: 'iot:telemetry'; payload: { deviceId: number; metrics: Record<string, number | string | boolean>; reportedAt: string } }
  | { type: 'iot:shadow'; payload: { deviceId: number; reported: Record<string, number | string | boolean>; desired: Record<string, number | string | boolean>; desiredVersion: number } }
  | { type: 'iot:device-event'; payload: { deviceId: number; kind: 'lifecycle' | 'model' | 'anomaly'; identifier: string; name: string; level: 'info' | 'warn' | 'fault'; reportedAt: string } };

// ─── 数据库备份 ────────────────────────────────────────────────────────────
export type BackupType = 'pg_dump' | 'drizzle_export';

export type BackupStatus = 'pending' | 'running' | 'success' | 'failed';

export interface DbBackup {
  id: number;
  name: string;
  type: BackupType;
  fileId: string | null;
  fileSize: number | null;
  status: BackupStatus;
  tables: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  errorMessage: string | null;
  createdBy: number | null;
  createdByName?: string | null;
  createdAt: string;
}

export interface UploadCertInput {
  name: string;
  domain: string;
  certContent: string;
  keyContent: string;
}
