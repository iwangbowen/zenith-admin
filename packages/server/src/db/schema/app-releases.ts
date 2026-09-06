/**
 * 应用版本管理（客户端在线升级）
 *
 * 模型分层：应用（client_apps）→ 版本（app_releases，按渠道）→ 制品（app_artifacts，平台×架构×类型）。
 * 桌面 / 移动 / Web 只是不同的平台与制品类型，共用同一套发布与灰度模型。
 * app_release_events 是追加型日志（检查 / 下载 / 安装回执），供升级看板统计。
 */
import { pgTable, pgEnum, varchar, text, integer, smallint, bigint, boolean, timestamp, unique, index, uuid, uniqueIndex } from 'drizzle-orm/pg-core';
import { statusEnum, pushProviderEnum, timestampColumns } from './common';
import { auditColumns } from './core';
import { managedFiles } from './files';

// ─── 枚举（三端同步：pgEnum / shared constants / Zod enum）──────────────────
export const appReleaseChannelEnum = pgEnum('app_release_channel', ['stable', 'beta', 'internal']);
export const appReleaseStatusEnum = pgEnum('app_release_status', ['draft', 'published', 'revoked']);
export const appPlatformEnum = pgEnum('app_platform', ['windows', 'macos', 'linux', 'android', 'ios', 'web']);
export const appArchEnum = pgEnum('app_arch', ['x64', 'arm64', 'universal']);
export const appArtifactKindEnum = pgEnum('app_artifact_kind', ['installer', 'hotupdate', 'metadata', 'external']);
export const appReleaseEventTypeEnum = pgEnum('app_release_event_type', ['check', 'download', 'install_success', 'install_fail']);

// ─── 应用 ────────────────────────────────────────────────────────────────────
export const clientApps = pgTable('client_apps', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  /** 客户端侧标识（如 zenith-desktop），公开 check API 用它定位应用 */
  appKey: varchar({ length: 64 }).notNull().unique('client_apps_app_key_unique'),
  name: varchar({ length: 100 }).notNull(),
  description: text(),
  status: statusEnum().notNull().default('enabled'),
  ...auditColumns(),
  ...timestampColumns(),
});

export type ClientAppRow = typeof clientApps.$inferSelect;
export type NewClientApp = typeof clientApps.$inferInsert;

// ─── 版本 ────────────────────────────────────────────────────────────────────
export const appReleases = pgTable('app_releases', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  appId: integer().notNull().references(() => clientApps.id, { onDelete: 'cascade' }),
  channel: appReleaseChannelEnum().notNull().default('stable'),
  /** semver，如 1.86.0 */
  version: varchar({ length: 32 }).notNull(),
  /** 更新日志（Markdown） */
  notes: text(),
  status: appReleaseStatusEnum().notNull().default('draft'),
  /** 强制更新：客户端收到后不允许跳过 */
  mandatory: boolean().notNull().default(false),
  /** 最低可用版本：低于该版本的客户端按强制更新处理 */
  minVersion: varchar({ length: 32 }),
  /** 灰度比例 0-100，按 deviceId 哈希放量；100 = 全量 */
  rolloutPercent: smallint().notNull().default(100),
  publishedAt: timestamp(),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [unique('app_releases_app_channel_version_unique').on(t.appId, t.channel, t.version)]);

export type AppReleaseRow = typeof appReleases.$inferSelect;
export type NewAppRelease = typeof appReleases.$inferInsert;

// ─── 制品 ────────────────────────────────────────────────────────────────────
export const appArtifacts = pgTable('app_artifacts', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  releaseId: integer().notNull().references(() => appReleases.id, { onDelete: 'cascade' }),
  platform: appPlatformEnum().notNull(),
  arch: appArchEnum().notNull().default('x64'),
  /** installer=安装包 hotupdate=热更包 metadata=latest.yml/blockmap external=外链（App Store 等） */
  kind: appArtifactKindEnum().notNull().default('installer'),
  /** 托管文件（external 制品为空）；文件删除时置空以保留发布记录 */
  fileId: uuid().references(() => managedFiles.id, { onDelete: 'set null' }),
  /** 外链制品（iOS App Store / TestFlight 等）的跳转地址 */
  externalUrl: varchar({ length: 500 }),
  /** 分发匹配名：electron-updater 按固定文件名（latest.yml / Setup.exe / .blockmap）请求 */
  fileName: varchar({ length: 255 }).notNull(),
  size: bigint({ mode: 'number' }).notNull().default(0),
  sha256: varchar({ length: 64 }),
  downloadCount: integer().notNull().default(0),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [
  unique('app_artifacts_release_filename_unique').on(t.releaseId, t.fileName),
  index('app_artifacts_release_idx').on(t.releaseId),
]);

export type AppArtifactRow = typeof appArtifacts.$inferSelect;
export type NewAppArtifact = typeof appArtifacts.$inferInsert;

// ─── 升级事件（追加型日志，无审计列）────────────────────────────────────────
export const appReleaseEvents = pgTable('app_release_events', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  appId: integer().notNull().references(() => clientApps.id, { onDelete: 'cascade' }),
  releaseId: integer().references(() => appReleases.id, { onDelete: 'set null' }),
  artifactId: integer().references(() => appArtifacts.id, { onDelete: 'set null' }),
  eventType: appReleaseEventTypeEnum().notNull(),
  channel: appReleaseChannelEnum().notNull().default('stable'),
  platform: appPlatformEnum(),
  arch: appArchEnum(),
  /** check = 客户端当前版本；download / install_* = 目标版本 */
  version: varchar({ length: 32 }),
  /** 客户端自生成的匿名设备标识，用于灰度命中与设备数统计 */
  deviceId: varchar({ length: 64 }),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [index('app_release_events_app_time_idx').on(t.appId, t.createdAt)]);

export type AppReleaseEventRow = typeof appReleaseEvents.$inferSelect;
export type NewAppReleaseEvent = typeof appReleaseEvents.$inferInsert;

// ─── 统一设备中心 ─────────────────────────────────────────────────────────────
// 设备是一等公民:升级灰度、App 推送与在网统计共用一份档案。
// 写入来自客户端上报（升级检查心跳顺手 upsert、登录后绑定推送），无审计列。
export const clientDevices = pgTable('client_devices', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  /** 客户端生成并持久化的匿名设备标识（与升级灰度 deviceId 同源） */
  deviceId: varchar({ length: 64 }).notNull().unique('client_devices_device_id_unique'),
  appId: integer().notNull().references(() => clientApps.id, { onDelete: 'cascade' }),
  platform: appPlatformEnum().notNull(),
  arch: appArchEnum(),
  deviceModel: varchar({ length: 128 }),
  osVersion: varchar({ length: 64 }),
  /** 客户端当前版本（升级检查心跳回写,在网版本分布直查本列） */
  appVersion: varchar({ length: 32 }),
  /** 当前绑定人（登录绑定/登出解绑;空=匿名设备） */
  subjectType: varchar({ length: 16 }),
  subjectId: integer(),
  /** 推送通道绑定（移动端集成推送 SDK 后上报） */
  pushProvider: pushProviderEnum(),
  pushRegistrationId: varchar({ length: 128 }),
  pushEnabled: boolean().notNull().default(true),
  createdAt: timestamp().defaultNow().notNull(),
  lastActiveAt: timestamp().defaultNow().notNull(),
}, (t) => [
  index('client_devices_app_active_idx').on(t.appId, t.lastActiveAt),
  index('client_devices_subject_idx').on(t.subjectType, t.subjectId),
  uniqueIndex('client_devices_push_reg_unique').on(t.pushProvider, t.pushRegistrationId),
]);

export type ClientDeviceRow = typeof clientDevices.$inferSelect;
export type NewClientDevice = typeof clientDevices.$inferInsert;
