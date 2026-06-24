import type {
  MpKfSession, MpKfSessionEvent, MpKfRoutingConfig, MpKfSessionStats, MpMessage,
} from '@zenith/shared';
import {
  SEED_MP_KF_SESSIONS, SEED_MP_KF_SESSION_EVENTS, SEED_MP_KF_ROUTING_CONFIGS,
  SEED_MP_KF_ACCOUNTS, SEED_MP_FANS, SEED_MP_MESSAGES,
} from '@zenith/shared';
import { mockDateTime } from '@/mocks/utils/date';

const kfNickById = new Map<number, string>(SEED_MP_KF_ACCOUNTS.map((k) => [k.id, k.nickname]));
const fanByOpenid = new Map(SEED_MP_FANS.map((f) => [f.openid, { nickname: f.nickname, avatar: f.avatar }]));

export const mockMpKfSessions: MpKfSession[] = SEED_MP_KF_SESSIONS.map((s) => {
  const now = mockDateTime();
  const fan = fanByOpenid.get(s.openid);
  return {
    id: s.id,
    accountId: s.accountId,
    openid: s.openid,
    kfId: s.kfId,
    kfNickname: s.kfId ? (kfNickById.get(s.kfId) ?? null) : null,
    fanNickname: fan?.nickname ?? null,
    fanAvatar: fan?.avatar ?? null,
    status: s.status,
    priority: 0,
    source: s.source,
    unreadCount: s.unreadCount,
    lastFanMsgAt: now,
    lastKfMsgAt: s.kfId ? now : null,
    lastMsgAt: now,
    waitingSince: s.status === 'waiting' ? now : null,
    acceptedAt: s.status === 'waiting' ? null : now,
    closedAt: s.status === 'closed' ? now : null,
    closeReason: s.closeReason,
    remark: null,
    waitSeconds: s.status === 'waiting' ? 42 : undefined,
    createdAt: now,
    updatedAt: now,
  };
});

export const mockMpKfSessionEvents: MpKfSessionEvent[] = SEED_MP_KF_SESSION_EVENTS.map((e) => ({
  id: e.id,
  sessionId: e.sessionId,
  accountId: e.accountId,
  type: e.type,
  fromKfId: e.fromKfId,
  toKfId: e.toKfId,
  fromKfNickname: e.fromKfId ? (kfNickById.get(e.fromKfId) ?? null) : null,
  toKfNickname: e.toKfId ? (kfNickById.get(e.toKfId) ?? null) : null,
  operatorId: null,
  operatorName: e.type === 'accept' || e.type === 'close' ? '管理员' : null,
  detail: e.detail,
  createdAt: mockDateTime(),
}));

export const mockMpKfMessages: MpMessage[] = SEED_MP_MESSAGES.map((m) => ({ ...m }));

export const mockMpKfRoutingConfigs: MpKfRoutingConfig[] = SEED_MP_KF_ROUTING_CONFIGS.map((c, i) => ({
  id: i + 1,
  accountId: c.accountId,
  enabled: c.enabled,
  strategy: c.strategy,
  maxConcurrent: c.maxConcurrent,
  waitTimeoutMinutes: c.waitTimeoutMinutes,
  idleTimeoutMinutes: c.idleTimeoutMinutes,
  autoCloseEnabled: c.autoCloseEnabled,
  welcomeText: c.welcomeText,
  updatedAt: mockDateTime(),
}));

let nextEventId = Math.max(0, ...mockMpKfSessionEvents.map((e) => e.id)) + 1;
export function getNextMpKfEventId() { return nextEventId++; }

let nextMsgId = Math.max(0, ...mockMpKfMessages.map((m) => m.id)) + 1;
export function getNextMpKfMessageId() { return nextMsgId++; }

export function ensureMpKfConfig(accountId: number): MpKfRoutingConfig {
  let cfg = mockMpKfRoutingConfigs.find((c) => c.accountId === accountId);
  if (!cfg) {
    cfg = {
      id: mockMpKfRoutingConfigs.length + 1, accountId, enabled: true, strategy: 'least_active',
      maxConcurrent: 5, waitTimeoutMinutes: 3, idleTimeoutMinutes: 15, autoCloseEnabled: true,
      welcomeText: null, updatedAt: mockDateTime(),
    };
    mockMpKfRoutingConfigs.push(cfg);
  }
  return cfg;
}

export function buildMpKfStats(accountId: number): MpKfSessionStats {
  const list = mockMpKfSessions.filter((s) => s.accountId === accountId);
  const agents = SEED_MP_KF_ACCOUNTS.filter((k) => k.accountId === accountId).map((k) => ({
    kfId: k.id,
    kfAccount: k.kfAccount,
    nickname: k.nickname,
    status: k.status,
    activeCount: list.filter((s) => s.status === 'active' && s.kfId === k.id).length,
  }));
  return {
    waiting: list.filter((s) => s.status === 'waiting').length,
    active: list.filter((s) => s.status === 'active').length,
    closedToday: list.filter((s) => s.status === 'closed').length,
    avgWaitSeconds: 35,
    agents,
  };
}
