import * as z from 'zod';
import { httpUrl, partialForUpdate } from '../core/validation';
import {
  APP_ARCHES,
  DB_ADMIN_MAINTENANCE_ACTIONS,
  FIREWALL_DIRECTIONS,
  FIREWALL_PROTOCOLS,
  FIREWALL_RULE_TYPES,
  FS_ENTRY_TYPES,
  OPS_HOST_AUTH_TYPES,
  APP_CLIENT_REPORTABLE_EVENT_TYPES,
  APP_PLATFORMS,
  APP_RELEASE_CHANNELS,
  APP_SEMVER_RE,
  PROCESS_KILL_SIGNALS,
  PROCESS_PRIORITY_CLASSES,
  SSH_AUTH_TYPES,
  TERMINAL_RECORDING_EVENT_TYPES,
} from './constants';

// ─── 维护模式 ────────────────────────────────────────────────────────────────
export const updateMaintenanceSchema = z.object({
  enabled: z.boolean(),
  message: z.string().max(512).optional(),
  estimatedEndAt: z.string().nullable().optional(),
});

export type UpdateMaintenanceInput = z.infer<typeof updateMaintenanceSchema>;

// ─── SSL 证书 ────────────────────────────────────────────────────────────────
export const generateSelfSignedCertSchema = z.object({
  name: z.string().min(1).max(128),
  domain: z.string().min(1).max(256),
  days: z.number().int().min(1).max(3650).default(365),
  country: z.string().length(2).default('CN').optional(),
  organization: z.string().max(64).optional(),
  outputDir: z.string().max(500).optional(),
});

export type GenerateSelfSignedCertInput = z.infer<typeof generateSelfSignedCertSchema>;

// ─── 进程管理 ────────────────────────────────────────────────────────────────
export const killProcessSchema = z.object({
  signal: z.enum(PROCESS_KILL_SIGNALS).default('SIGTERM'),
});

export const setProcessPrioritySchema = z.object({
  /** Nice value -20~19 for Linux/macOS */
  nice: z.number().int().min(-20).max(19).optional(),
  /** Priority class for Windows */
  priorityClass: z.enum(PROCESS_PRIORITY_CLASSES).optional(),
});

export type KillProcessInput = z.infer<typeof killProcessSchema>;

export type SetProcessPriorityInput = z.infer<typeof setProcessPrioritySchema>;

// ─── 防火墙 ──────────────────────────────────────────────────────────────────
export const addFirewallRuleSchema = z.object({
  type: z.enum(FIREWALL_RULE_TYPES),
  protocol: z.enum(FIREWALL_PROTOCOLS),
  port: z.string().max(20),
  from: z.string().max(100).default('any'),
  to: z.string().max(100).default('any'),
  direction: z.enum(FIREWALL_DIRECTIONS).default('in'),
  comment: z.string().max(200).optional(),
});

export type AddFirewallRuleInput = z.infer<typeof addFirewallRuleSchema>;

// ─── Nginx 站点 ──────────────────────────────────────────────────────────────
export const createNginxSiteSchema = z.object({
  name: z.string().min(1).max(100).regex(/^[a-zA-Z0-9._-]+$/, '站点名只能包含字母、数字、点、横线和下划线'),
  serverName: z.string().min(1).max(200),
  listenPort: z.number().int().min(1).max(65535).default(80),
  root: z.string().max(500).optional(),
  proxyPass: z.string().max(500).optional(),
  sslEnabled: z.boolean().default(false),
  sslCertPath: z.string().max(500).optional(),
  sslKeyPath: z.string().max(500).optional(),
  extraConfig: z.string().max(10000).optional(),
});

export type CreateNginxSiteInput = z.infer<typeof createNginxSiteSchema>;

export const updateNginxSiteContentSchema = z.object({
  content: z.string().max(100000),
});

export type UpdateNginxSiteContentInput = z.infer<typeof updateNginxSiteContentSchema>;

// ─── SSH 配置（个人） ─────────────────────────────────────────────────────────
export const createSshProfileSchema = z.object({
  name: z.string().min(1).max(128),
  host: z.string().min(1).max(255),
  port: z.coerce.number().int().min(1).max(65535).default(22),
  username: z.string().min(1).max(128),
  authType: z.enum(SSH_AUTH_TYPES),
  password: z.string().max(512).nullable().optional(),
  keyPath: z.string().max(512).nullable().optional(),
  keyContent: z.string().max(16384).nullable().optional(),
  keyPassphrase: z.string().max(512).nullable().optional(),
  envVars: z.record(z.string(), z.string()).optional(),
  groupName: z.string().max(128).nullable().optional(),
  tags: z.array(z.string().max(32)).max(20).optional(),
  orderNum: z.coerce.number().int().optional(),
});

export const updateSshProfileSchema = partialForUpdate(createSshProfileSchema);

export type CreateSshProfileInput = z.infer<typeof createSshProfileSchema>;

export type UpdateSshProfileInput = z.infer<typeof updateSshProfileSchema>;

// ─── 终端录屏 ────────────────────────────────────────────────────────────────
/** 录屏事件：[timeOffset(秒), type, data] */
export const terminalRecordingEventSchema = z.tuple([z.number(), z.enum(TERMINAL_RECORDING_EVENT_TYPES), z.string()]);

export type TerminalRecordingEvent = z.infer<typeof terminalRecordingEventSchema>;

export const createTerminalRecordingSchema = z.object({
  title: z.string().max(256).default(''),
  shell: z.string().max(64).nullable().optional(),
  cols: z.number().int().min(1).max(1000),
  rows: z.number().int().min(1).max(500),
  duration: z.number().min(0),
  events: z.array(terminalRecordingEventSchema),
});

export type CreateTerminalRecordingInput = z.infer<typeof createTerminalRecordingSchema>;

// ─── 文件系统操作（宿主机 / SFTP / 远程主机共用） ───────────────────────────────
export const fsWriteTextSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
  /** 读取时拿到的版本；不传表示强制覆盖 */
  baseEtag: z.string().optional(),
});

export type FsWriteTextInput = z.infer<typeof fsWriteTextSchema>;

export const fsCreateEntrySchema = z.object({
  path: z.string().min(1),
  type: z.enum(FS_ENTRY_TYPES),
});

export type FsCreateEntryInput = z.infer<typeof fsCreateEntrySchema>;

export const fsRenameSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
});

export type FsRenameInput = z.infer<typeof fsRenameSchema>;

export const fsChmodSchema = z.object({
  path: z.string().min(1),
  mode: z.number().int().min(0).max(0o7777),
});

export type FsChmodInput = z.infer<typeof fsChmodSchema>;

export const fsCompressSchema = z.object({
  paths: z.array(z.string().min(1)).min(1),
  destPath: z.string().min(1),
});

export type FsCompressInput = z.infer<typeof fsCompressSchema>;

export const fsExtractSchema = z.object({
  path: z.string().min(1),
  destPath: z.string().optional(),
});

export type FsExtractInput = z.infer<typeof fsExtractSchema>;

// ─── Docker ──────────────────────────────────────────────────────────────────
export const dockerPullImageSchema = z.object({
  repoTag: z.string().min(1),
});

export const dockerCreateNetworkSchema = z.object({
  name: z.string().min(1).max(128),
  driver: z.string().default('bridge'),
  internal: z.boolean().default(false),
});

export type DockerCreateNetworkInput = z.infer<typeof dockerCreateNetworkSchema>;

export const dockerCreateVolumeSchema = z.object({
  name: z.string().min(1).max(255),
  driver: z.string().default('local'),
});

export type DockerCreateVolumeInput = z.infer<typeof dockerCreateVolumeSchema>;

// ─── 网络诊断 ────────────────────────────────────────────────────────────────
export const networkPortCheckSchema = z.object({
  host: z.string().min(1).max(253),
  port: z.number().int().min(1).max(65535),
});

export type NetworkPortCheckInput = z.infer<typeof networkPortCheckSchema>;

export const networkHttpProbeSchema = z.object({
  url: z.url().max(2048),
});

// ─── 数据库管理 ──────────────────────────────────────────────────────────────
export const dbAdminSqlBodySchema = z.object({ sql: z.string().min(1, 'SQL 不能为空').max(50000) });

export const dbAdminExplainBodySchema = dbAdminSqlBodySchema.extend({ analyze: z.boolean().optional() });

export const dbAdminQueryBodySchema = dbAdminSqlBodySchema.extend({
  queryId: z.string().max(64).optional(),
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(1000).optional(),
});

export type DbAdminQueryInput = z.infer<typeof dbAdminQueryBodySchema>;

/** 导出 SQL 结果（CSV / JSON）：只需要语句本身 */
export const dbAdminExportQueryBodySchema = z.object({ sql: z.string() });

export const dbAdminCancelQuerySchema = z.object({ queryId: z.string().min(1).max(64) });

const dbAdminRowRecordSchema = z.record(z.string(), z.unknown());

export const dbAdminInsertRowSchema = z.object({ values: dbAdminRowRecordSchema });

export const dbAdminUpdateRowSchema = z.object({
  pk: dbAdminRowRecordSchema,
  changes: dbAdminRowRecordSchema,
});

export const dbAdminDeleteRowSchema = z.object({ pk: dbAdminRowRecordSchema });

export const dbAdminImportRowsSchema = z.object({ rows: z.array(dbAdminRowRecordSchema).max(100000) });

export const dbAdminBatchMutateSchema = z.object({
  inserts: z.array(dbAdminRowRecordSchema).max(500).optional(),
  updates: z.array(dbAdminUpdateRowSchema).max(500).optional(),
  deletes: z.array(dbAdminDeleteRowSchema).max(500).optional(),
});

export type DbAdminBatchMutateInput = z.infer<typeof dbAdminBatchMutateSchema>;

export const dbAdminMaintenanceActionSchema = z.object({ action: z.enum(DB_ADMIN_MAINTENANCE_ACTIONS) });

// ─── SQL 收藏夹 ─────────────────────────────────────────────────────────────────
export const createDbQueryFavoriteSchema = z.object({
  name: z.string().min(1, '名称不能为空').max(100),
  sql: z.string().min(1, 'SQL 不能为空'),
  description: z.string().max(500).optional(),
  tags: z.array(z.string().max(50)).max(10).default([]),
});

export const updateDbQueryFavoriteSchema = partialForUpdate(createDbQueryFavoriteSchema);

export type CreateDbQueryFavoriteInput = z.infer<typeof createDbQueryFavoriteSchema>;

export type UpdateDbQueryFavoriteInput = z.infer<typeof updateDbQueryFavoriteSchema>;

// ─── 数据保留策略 ────────────────────────────────────────────────────────────
/** 保留天数上限 10 年，足够覆盖等保与审计留存要求 */
export const RETENTION_MAX_DAYS = 3650;

export const RETENTION_MIN_BATCH_SIZE = 100;

export const RETENTION_MAX_BATCH_SIZE = 50_000;

export const updateRetentionPolicySchema = z.object({
  enabled: z.boolean().optional(),
  retentionDays: z.number().int().min(0, '保留天数不能为负').max(RETENTION_MAX_DAYS).optional(),
  batchSize: z.number().int().min(RETENTION_MIN_BATCH_SIZE).max(RETENTION_MAX_BATCH_SIZE).optional(),
});

export type UpdateRetentionPolicyInput = z.infer<typeof updateRetentionPolicySchema>;

// ─── 应用版本管理（在线升级）──────────────────────────────────────────────────

const semverSchema = z.string().max(32).regex(APP_SEMVER_RE, '版本号须为 semver 格式，如 1.2.3');

export const createClientAppSchema = z.object({
  appKey: z
    .string()
    .min(1, 'appKey 不能为空')
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'appKey 仅允许小写字母、数字与连字符'),
  name: z.string().min(1, '名称不能为空').max(100),
  description: z.string().max(500).optional(),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
});

/** appKey 是客户端侧标识，创建后不可修改（改了会导致在网客户端失联） */
export const updateClientAppSchema = partialForUpdate(createClientAppSchema).omit({ appKey: true });

export type CreateClientAppInput = z.infer<typeof createClientAppSchema>;
export type UpdateClientAppInput = z.infer<typeof updateClientAppSchema>;

export const createAppReleaseSchema = z.object({
  appId: z.number().int().positive(),
  channel: z.enum(APP_RELEASE_CHANNELS).default('stable'),
  version: semverSchema,
  notes: z.string().max(20000).optional(),
  mandatory: z.boolean().default(false),
  minVersion: semverSchema.nullable().optional(),
  rolloutPercent: z.number().int().min(0).max(100).default(100),
});

/** 所属应用创建后不可更换 */
export const updateAppReleaseSchema = partialForUpdate(createAppReleaseSchema).omit({ appId: true });

export type CreateAppReleaseInput = z.infer<typeof createAppReleaseSchema>;
export type UpdateAppReleaseInput = z.infer<typeof updateAppReleaseSchema>;

/** 调整灰度比例（发布后可单独调整，不走完整更新） */
export const setAppReleaseRolloutSchema = z.object({
  rolloutPercent: z.number().int().min(0).max(100),
});

export type SetAppReleaseRolloutInput = z.infer<typeof setAppReleaseRolloutSchema>;

/** 外链制品（iOS App Store / TestFlight 等）；文件制品走 multipart 上传 */
export const createExternalArtifactSchema = z.object({
  platform: z.enum(APP_PLATFORMS),
  arch: z.enum(APP_ARCHES).default('universal'),
  externalUrl: httpUrl('必须是合法的 http(s) URL').max(500),
  fileName: z.string().min(1, '显示名不能为空').max(255),
});

export type CreateExternalArtifactInput = z.infer<typeof createExternalArtifactSchema>;

/** 公开 check API 查询参数 */
export const checkAppUpdateQuerySchema = z.object({
  app: z.string().min(1).max(64),
  platform: z.enum(APP_PLATFORMS),
  arch: z.enum(APP_ARCHES).optional(),
  channel: z.enum(APP_RELEASE_CHANNELS).default('stable'),
  version: semverSchema,
  deviceId: z.string().max(64).optional(),
});

export type CheckAppUpdateQuery = z.infer<typeof checkAppUpdateQuerySchema>;

/** 公开安装回执上报（download / check 由服务端记录，不接受客户端上报） */
export const reportAppReleaseEventSchema = z.object({
  app: z.string().min(1).max(64),
  eventType: z.enum(APP_CLIENT_REPORTABLE_EVENT_TYPES),
  channel: z.enum(APP_RELEASE_CHANNELS).default('stable'),
  platform: z.enum(APP_PLATFORMS),
  arch: z.enum(APP_ARCHES).optional(),
  /** 目标版本（本次安装的版本） */
  version: semverSchema,
  deviceId: z.string().max(64).optional(),
});

export type ReportAppReleaseEventInput = z.infer<typeof reportAppReleaseEventSchema>;

/** 设备绑定推送（App 登录后上报;管理端与会员端共用同一 schema） */
export const bindPushDeviceSchema = z.object({
  app: z.string().min(1).max(64),
  deviceId: z.string().min(1).max(64),
  provider: z.enum(['jpush']).default('jpush'),
  registrationId: z.string().min(1, 'RegistrationID 不能为空').max(128),
  platform: z.enum(APP_PLATFORMS),
  arch: z.enum(APP_ARCHES).optional(),
  deviceModel: z.string().max(128).optional(),
  osVersion: z.string().max(64).optional(),
  appVersion: z.string().max(32).optional(),
  /** 用户在 App 设置里关闭推送时传 false（保留绑定但不投递） */
  pushEnabled: z.boolean().default(true),
});

export type BindPushDeviceInput = z.infer<typeof bindPushDeviceSchema>;


// ─── 运维主机（多主机管理）──────────────────────────────────────────────────────
export const createOpsHostSchema = z.object({
  name: z.string().min(1, '名称不能为空').max(64),
  host: z.string().min(1, '主机地址不能为空').max(255)
    .regex(/^[a-zA-Z0-9._:-]+$/, '主机地址只允许字母、数字、点、冒号、下划线和连字符'),
  port: z.number().int().min(1).max(65535).default(22),
  username: z.string().min(1, '用户名不能为空').max(64),
  authType: z.enum(OPS_HOST_AUTH_TYPES),
  /** 创建 / 更新时提交明文,服务端加密存储;更新时留空表示不修改 */
  password: z.string().max(512).optional(),
  keyContent: z.string().max(16384).optional(),
  keyPassphrase: z.string().max(512).optional(),
  enabled: z.boolean().default(true),
  remark: z.string().max(500).optional(),
});

export const updateOpsHostSchema = partialForUpdate(createOpsHostSchema);

export type CreateOpsHostInput = z.infer<typeof createOpsHostSchema>;

export type UpdateOpsHostInput = z.infer<typeof updateOpsHostSchema>;
