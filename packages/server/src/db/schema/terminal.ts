import { timestampColumns } from './common';
import { pgTable, varchar, timestamp, pgEnum, integer, text, jsonb, real, uuid as pgUuid, index } from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';
import { TERMINAL_SESSION_KINDS, TERMINAL_SESSION_STATES } from '@zenith/shared/ops';
import { tenants, users } from './core';

// ─── 终端会话表 ─────────────────────────────────────────────────────────
/**
 * 活动与历史终端会话。
 *
 * 会话进程只存活在创建它的 Node 进程内存中，本表是它的权威元数据：
 * 提供事后追溯（谁、何时、连到哪、怎么结束的），并让进程重启后能结算残留记录。
 * `node_id` 标识承载进程的实例，跨实例连接会被拒绝而不是静默连到别处。
 */
export const terminalSessionStateEnum = pgEnum('terminal_session_state', TERMINAL_SESSION_STATES);

export const terminalSessionKindEnum = pgEnum('terminal_session_kind', TERMINAL_SESSION_KINDS);

export const terminalSessions = pgTable('terminal_sessions', {
  /** 服务端生成的 UUIDv7；客户端无法指定，杜绝按 ID 抢占他人会话 */
  id: pgUuid().primaryKey().$defaultFn(() => uuidv7()),
  userId: integer().references(() => users.id, { onDelete: 'cascade' }).notNull(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  kind: terminalSessionKindEnum().notNull(),
  /** 连接目标：本地 shell id / ssh:<profileId> / docker-exec:<container>:<shell> */
  target: varchar({ length: 255 }).notNull().default(''),
  /** 展示标签：本地为 shell 名，SSH 为 user@host:port，Docker 为容器名 */
  label: varchar({ length: 255 }).notNull().default(''),
  clientIp: varchar({ length: 64 }).notNull().default(''),
  /** 承载该会话进程的服务实例标识（hostname:port） */
  nodeId: varchar({ length: 128 }).notNull(),
  state: terminalSessionStateEnum().notNull().default('active'),
  cols: integer().notNull().default(80),
  rows: integer().notNull().default(24),
  startedAt: timestamp().defaultNow().notNull(),
  lastActivityAt: timestamp().defaultNow().notNull(),
  endedAt: timestamp(),
  /** 结束原因，取值见 @zenith/shared/ops 的 TERMINAL_END_REASONS */
  endReason: varchar({ length: 32 }),
  ...timestampColumns(),
}, (t) => [
  // 「我的会话」与配额统计：按用户过滤活动会话
  index('terminal_sessions_user_state_idx').on(t.userId, t.state),
  // 管理端会话列表：租户内按开始时间倒序
  index('terminal_sessions_tenant_started_idx').on(t.tenantId, t.startedAt),
  // 启动结算：找出本实例遗留的未终结会话
  index('terminal_sessions_node_state_idx').on(t.nodeId, t.state),
]);

export type TerminalSessionRow = typeof terminalSessions.$inferSelect;

export type NewTerminalSession = typeof terminalSessions.$inferInsert;

// ─── 终端录屏表 ─────────────────────────────────────────────────────────
/** 终端 session 录屏事件：[timeOffset(秒), type('o'|’i'), data] */
export type RecordingEvent = [number, 'o' | 'i', string];

export const terminalRecordings = pgTable('terminal_recordings', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  title: varchar({ length: 256 }).notNull().default(''),
  userId: integer().references(() => users.id, { onDelete: 'cascade' }).notNull(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  shell: varchar({ length: 64 }),
  cols: integer().notNull().default(80),
  rows: integer().notNull().default(24),
  duration: real().notNull().default(0), // 秒
  events: jsonb().$type<RecordingEvent[]>().notNull().default([]),
  ...timestampColumns(),
}, (t) => [index('terminal_recordings_user_idx').on(t.userId), index('terminal_recordings_tenant_idx').on(t.tenantId)]);

export type TerminalRecordingRow = typeof terminalRecordings.$inferSelect;

export type NewTerminalRecording = typeof terminalRecordings.$inferInsert;

// ─── SSH 连接配置表 ────────────────────────────────────────────────────────────

export const sshAuthTypeEnum = pgEnum('ssh_auth_type', ['password', 'key_path', 'key_content', 'agent']);

export const sshProfiles = pgTable('ssh_profiles', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  userId: integer().references(() => users.id, { onDelete: 'cascade' }).notNull(),
  name: varchar({ length: 128 }).notNull(),
  host: varchar({ length: 255 }).notNull(),
  port: integer().notNull().default(22),
  username: varchar({ length: 128 }).notNull(),
  authType: sshAuthTypeEnum().notNull().default('password'),
  /** 加密存储的密码（authType=password 时使用） */
  passwordEncrypted: text(),
  /** 服务端私钥文件路径（authType=key_path 时使用，如 ~/.ssh/id_rsa） */
  keyPath: text(),
  /** 加密存储的私钥内容（authType=key_content 时使用） */
  keyContentEncrypted: text(),
  /** 加密存储的私钥口令（authType=key_path|key_content 时可选） */
  keyPassphraseEncrypted: text(),
  /** 连接后自动设置的环境变量 */
  envVars: jsonb().$type<Record<string, string>>().notNull().default({}),
  /** 所属分组名称（用于在 SSH 连接面板中按分组折叠展示，null 表示未分组） */
  groupName: varchar({ length: 128 }),
  /** 标签数组（用于筛选与标注，如 prod / staging / db） */
  tags: jsonb().$type<string[]>().notNull().default([]),
  /** 列表排序权重（数字越小越靠前） */
  orderNum: integer().notNull().default(0),
  ...timestampColumns(),
}, (t) => [index('ssh_profiles_user_idx').on(t.userId)]);

export type SshProfileRow = typeof sshProfiles.$inferSelect;

export type NewSshProfile = typeof sshProfiles.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════
// 会员中心（Member Center）—— 面向 C 端的前台用户体系，与后台管理员 users 完全隔离
// ═══════════════════════════════════════════════════════════════════════════
