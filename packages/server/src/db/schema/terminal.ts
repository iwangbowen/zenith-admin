import { pgTable, serial, varchar, timestamp, pgEnum, integer, text, jsonb, real } from 'drizzle-orm/pg-core';
import { tenants, users } from './core';

// ─── 终端录屏表 ─────────────────────────────────────────────────────────
/** 终端 session 录屏事件：[timeOffset(秒), type('o'|’i'), data] */
export type RecordingEvent = [number, 'o' | 'i', string];

export const terminalRecordings = pgTable('terminal_recordings', {
  id: serial('id').primaryKey(),
  title: varchar('title', { length: 256 }).notNull().default(''),
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  shell: varchar('shell', { length: 64 }),
  cols: integer('cols').notNull().default(80),
  rows: integer('rows').notNull().default(24),
  duration: real('duration').notNull().default(0), // 秒
  events: jsonb('events').$type<RecordingEvent[]>().notNull().default([]),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type TerminalRecordingRow = typeof terminalRecordings.$inferSelect;

export type NewTerminalRecording = typeof terminalRecordings.$inferInsert;

// ─── SSH 连接配置表 ────────────────────────────────────────────────────────────

export const sshAuthTypeEnum = pgEnum('ssh_auth_type', ['password', 'key_path', 'key_content', 'agent']);

export const sshProfiles = pgTable('ssh_profiles', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  name: varchar('name', { length: 128 }).notNull(),
  host: varchar('host', { length: 255 }).notNull(),
  port: integer('port').notNull().default(22),
  username: varchar('username', { length: 128 }).notNull(),
  authType: sshAuthTypeEnum('auth_type').notNull().default('password'),
  /** 加密存储的密码（authType=password 时使用） */
  passwordEncrypted: text('password_encrypted'),
  /** 服务端私钥文件路径（authType=key_path 时使用，如 ~/.ssh/id_rsa） */
  keyPath: text('key_path'),
  /** 加密存储的私钥内容（authType=key_content 时使用） */
  keyContentEncrypted: text('key_content_encrypted'),
  /** 加密存储的私钥口令（authType=key_path|key_content 时可选） */
  keyPassphraseEncrypted: text('key_passphrase_encrypted'),
  /** 连接后自动设置的环境变量 */
  envVars: jsonb('env_vars').$type<Record<string, string>>().notNull().default({}),
  /** 所属分组名称（用于在 SSH 连接面板中按分组折叠展示，null 表示未分组） */
  groupName: varchar('group_name', { length: 128 }),
  /** 标签数组（用于筛选与标注，如 prod / staging / db） */
  tags: jsonb('tags').$type<string[]>().notNull().default([]),
  /** 列表排序权重（数字越小越靠前） */
  orderNum: integer('order_num').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type SshProfileRow = typeof sshProfiles.$inferSelect;

export type NewSshProfile = typeof sshProfiles.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════
// 会员中心（Member Center）—— 面向 C 端的前台用户体系，与后台管理员 users 完全隔离
// ═══════════════════════════════════════════════════════════════════════════
