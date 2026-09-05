import type { PaginatedResponse } from '../core/types';
import type { IdentityProviderSyncStatus, OAuthProviderType } from './constants';

// ─── JWT Payload ──────────────────────────────────────────────────────────────
export interface JwtPayload {
  userId: number;
  username: string;
  roles: string[];
  tenantId: number | null;
  /** 超管切换租户视角时，存放目标租户 ID */
  viewingTenantId?: number | null;
  jti?: string;
}

// ─── 用户行为分析 ────────────────────────────────────────────
export type UserBehaviorEventType =
  | 'page_view' | 'page_leave' | 'feature_use' | 'area_click'
  | 'custom' | 'perf' | 'api_request' | 'identify';

export interface UserStatItem {
  userId: number | null;
  username: string | null;
  totalEvents: number;
  pageViews: number;
  uniquePages: number;
  featureUses: number;
  totalDwellMs: number | null;
  lastActiveAt: string | null;
}

export type UserStats = PaginatedResponse<UserStatItem>;

export interface UserTimelineEvent {
  id: number;
  eventType: UserBehaviorEventType;
  eventName: string | null;
  pagePath: string;
  pageTitle: string | null;
  elementLabel: string | null;
  componentArea: string | null;
  durationMs: number | null;
  sessionId: string | null;
  properties: Record<string, unknown> | null;
  createdAt: string;
}

export interface UserTimeline {
  userId: number | null;
  username: string | null;
  totalEvents: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  items: UserTimelineEvent[];
}

// ─── OAuth 第三方登录（UI 视图模型）──────────────────────────────────────────
export interface OAuthProviderInfo {
  key: OAuthProviderType;
  label: string;
  icon: string;
}

/** 前端在跳转到提供方之前暂存于 sessionStorage 的 OAuth 往返上下文 */
export interface OAuthPendingState {
  state: string;
  provider: OAuthProviderType;
  intent: 'login' | 'bind';
  redirectTo?: string | null;
}

// ─── 企业身份源同步日志 ───────────────────────────────────────────────────────
export interface IdentityProviderSyncLog {
  id: number;
  providerId: number;
  status: IdentityProviderSyncStatus;
  triggerType: string;
  total: number;
  created: number;
  linked: number;
  updated: number;
  skipped: number;
  failed: number;
  message?: string | null;
  errorMessage?: string | null;
  startedAt: string;
  completedAt?: string | null;
  createdAt: string;
}

export type { UserAiConfig } from '../ai/contracts';

// ─── 意见反馈 ────────────────────────────────────────────────────────────────
export type UserFeedbackCategory = 'suggestion' | 'bug' | 'ux' | 'other';

export type UserFeedbackStatus = 'pending' | 'processing' | 'resolved' | 'ignored';

export interface UserFeedback {
  id: number;
  userId: number;
  /** 提交人昵称（JOIN 后附加） */
  userNickname?: string | null;
  /** 满意度评分 1-5，可空 */
  score: number | null;
  category: UserFeedbackCategory;
  content: string | null;
  /** 提交时所在页面路由 */
  pagePath: string | null;
  /** 提交时活跃的会话回放 ID（反馈联动） */
  replayId: string | null;
  status: UserFeedbackStatus;
  handleRemark: string | null;
  handledBy: number | null;
  /** 处理人昵称（JOIN 后附加） */
  handlerNickname?: string | null;
  handledAt: string | null;
  createdAt: string;
  updatedAt: string;
}