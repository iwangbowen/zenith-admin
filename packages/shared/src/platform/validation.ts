import * as z from 'zod';
import { partialForUpdate, validateTypedAlertDelivery, webhookUrlSchema } from '../core/validation';
import { CRON_JOB_STATUSES, FILE_ACCESS_STRATEGIES, FILE_BUCKET_ACCESS_SUPPORT, FILE_DIRECT_UPLOAD_SUPPORT, FILE_OBJECT_ACL_SUPPORT, FILE_UPLOAD_MODES, MASK_TYPES, MONITOR_ALERT_HANDLE_STATUSES, MONITOR_ALERT_LEVELS, MONITOR_ALERT_OPERATORS, MONITOR_HISTORY_RANGES, MONITOR_METRICS, PRESIGNED_EXPIRY_DEFAULT_SECONDS, PRESIGNED_EXPIRY_MAX_SECONDS, PRESIGNED_EXPIRY_MIN_SECONDS, REGION_LEVELS, SQL_MONITOR_QUERY_SORTS, SQL_MONITOR_QUERY_SORT_OPTIONS, SQL_MONITOR_SESSION_ACTIONS, SYSTEM_SCHEDULER_ALERT_CHANNELS, UPLOAD_CHUNK_MAX_BYTES, UPLOAD_CHUNK_MIN_BYTES, USER_FEEDBACK_CATEGORIES, USER_FEEDBACK_STATUSES } from './constants';
import { entityStatusSchema, keywordQuery, queryEnum } from '../core/api-schemas';

// ─── 字典 Schema ──────────────────────────────────────────────────────────────
export const createDictSchema = z.object({
  name: z.string().min(1, '字典名称不能为空').max(64),
  code: z.string().min(1, '字典编码不能为空').max(64).regex(/^[a-z_]+$/, '字典编码只能包含小写字母和下划线'),
  description: z.string().max(256).optional(),
  status: entityStatusSchema.default('enabled'),
});

export const updateDictSchema = partialForUpdate(createDictSchema);

export const createDictItemSchema = z.object({
  label: z.string().min(1, '标签不能为空').max(64),
  value: z.string().min(1, '键值不能为空').max(64),
  color: z.string().max(32).nullish(),
  sort: z.number().int().default(0),
  status: entityStatusSchema.default('enabled'),
  remark: z.string().max(256).nullish(),
  parentId: z.number().int().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const updateDictItemSchema = partialForUpdate(createDictItemSchema);

// ─── 文件管理 Schema ─────────────────────────────────────────────────────────
const baseFileStorageConfigSchema = z.object({
  name: z.string().min(1, '配置名称不能为空').max(64),
  provider: z.enum(['local', 'oss', 's3', 'cos', 'obs', 'kodo', 'bos', 'azure', 'sftp']),
  status: entityStatusSchema.default('enabled'),
  isDefault: z.boolean().default(false),
  basePath: z.string().max(256).optional(),
  // 对象读写权限（仅 oss/s3/cos/obs/bos 生效）；default = 继承 Bucket
  objectAcl: z.enum(['default', 'private', 'public-read', 'public-read-write']).default('default'),
  // 文件下载方式（上传始终经服务端或直传通道，与本字段无关）
  accessStrategy: z.enum(FILE_ACCESS_STRATEGIES).default('proxy'),
  // 上传方式：服务端中转 / 浏览器直传
  uploadMode: z.enum(FILE_UPLOAD_MODES).default('server-proxy'),
  // 自定义访问域名（CDN/加速域名），public 策略优先使用
  publicBaseUrl: z.string().max(512).regex(/^https?:\/\/.+/, '访问域名必须以 http:// 或 https:// 开头').optional().or(z.literal('')),
  // 临时签名有效期（秒）
  presignedExpirySeconds: z.number().int()
    .min(PRESIGNED_EXPIRY_MIN_SECONDS, `签名有效期不能小于 ${PRESIGNED_EXPIRY_MIN_SECONDS} 秒`)
    .max(PRESIGNED_EXPIRY_MAX_SECONDS, `签名有效期不能大于 ${PRESIGNED_EXPIRY_MAX_SECONDS} 秒（7 天）`)
    .default(PRESIGNED_EXPIRY_DEFAULT_SECONDS),
  // 本地存储
  localRootPath: z.string().max(512).optional(),
  // 阿里云 OSS
  ossRegion: z.string().max(64).optional(),
  ossEndpoint: z.string().max(128).optional(),
  ossBucket: z.string().max(128).optional(),
  ossAccessKeyId: z.string().max(128).optional(),
  ossAccessKeySecret: z.string().max(256).optional(),
  // S3 兼容存储
  s3Region: z.string().max(64).optional(),
  s3Endpoint: z.string().max(256).optional(),
  s3Bucket: z.string().max(128).optional(),
  s3AccessKeyId: z.string().max(128).optional(),
  s3SecretAccessKey: z.string().max(256).optional(),
  s3ForcePathStyle: z.boolean().optional(),
  // 腾讯云 COS
  cosRegion: z.string().max(64).optional(),
  cosBucket: z.string().max(128).optional(),
  cosSecretId: z.string().max(128).optional(),
  cosSecretKey: z.string().max(256).optional(),
  // 华为云 OBS
  obsEndpoint: z.string().max(256).optional(),
  obsBucket: z.string().max(128).optional(),
  obsAccessKeyId: z.string().max(128).optional(),
  obsSecretAccessKey: z.string().max(256).optional(),
  // 七牛云 Kodo
  kodoAccessKey: z.string().max(128).optional(),
  kodoSecretKey: z.string().max(256).optional(),
  kodoBucket: z.string().max(128).optional(),
  kodoRegion: z.string().max(64).optional(),
  kodoEndpoint: z.string().max(256).optional(),
  // 百度云 BOS
  bosEndpoint: z.string().max(256).optional(),
  bosBucket: z.string().max(128).optional(),
  bosAccessKeyId: z.string().max(128).optional(),
  bosSecretAccessKey: z.string().max(256).optional(),
  // Azure Blob Storage
  azureAccountName: z.string().max(128).optional(),
  azureAccountKey: z.string().max(256).optional(),
  azureContainerName: z.string().max(128).optional(),
  azureEndpoint: z.string().max(256).optional(),
  // SFTP
  sftpHost: z.string().max(256).optional(),
  sftpPort: z.number().int().min(1).max(65535).optional(),
  sftpUsername: z.string().max(128).optional(),
  sftpPassword: z.string().max(256).optional(),
  sftpPrivateKey: z.string().optional(),
  sftpRootPath: z.string().max(512).optional(),
  sftpBaseUrl: z.string().max(512).optional(),
  remark: z.string().max(256).optional(),
});

type FileStorageConfigBase = z.infer<typeof baseFileStorageConfigSchema>;

/** 下载方式与 provider/ACL 的矛盾校验；create 全量、update partial 双方共用（partial 时缺失字段跳过对应检查） */
function addAccessStrategyIssues(data: Partial<FileStorageConfigBase>, ctx: z.RefinementCtx) {
  if (!data.accessStrategy || !data.provider) return;
  const supportedAcls = FILE_OBJECT_ACL_SUPPORT[data.provider];
  const bucketCapability = FILE_BUCKET_ACCESS_SUPPORT[data.provider];
  if (data.uploadMode === 'browser-direct' && !FILE_DIRECT_UPLOAD_SUPPORT[data.provider]) {
    ctx.addIssue({ code: 'custom', message: '该存储类型不支持浏览器直传，请保持「服务端中转」', path: ['uploadMode'] });
  }
  if (data.accessStrategy === 'presigned' && (data.provider === 'local' || data.provider === 'sftp')) {
    ctx.addIssue({ code: 'custom', message: '本地磁盘 / SFTP 不支持临时签名直链，请选择服务端代理或公开直链', path: ['accessStrategy'] });
  }
  if (data.accessStrategy === 'public-object') {
    if (!supportedAcls) {
      ctx.addIssue({ code: 'custom', message: '该存储类型不支持对象 ACL，不能使用对象公共读直链', path: ['accessStrategy'] });
    } else if (!['public-read', 'public-read-write'].includes(data.objectAcl ?? 'default')) {
      ctx.addIssue({ code: 'custom', message: '对象公共读直链要求读写权限为 public-read 或 public-read-write', path: ['objectAcl'] });
    }
  }
  if (data.accessStrategy === 'public-bucket') {
    if (!bucketCapability?.probe) {
      ctx.addIssue({ code: 'custom', message: '该存储类型不支持 Bucket 公共读直链', path: ['accessStrategy'] });
    }
    if ((data.objectAcl ?? 'default') !== 'default') {
      ctx.addIssue({ code: 'custom', message: 'Bucket 公共读直链要求对象读写权限为「继承 Bucket」', path: ['objectAcl'] });
    }
  }
  if (data.accessStrategy === 'public-domain') {
    const hasDomain = Boolean(data.publicBaseUrl?.trim())
      || (data.provider === 'sftp' && Boolean(data.sftpBaseUrl?.trim()))
      || (data.provider === 'kodo' && Boolean(data.kodoEndpoint?.trim()));
    if (!hasDomain) {
      ctx.addIssue({ code: 'custom', message: '自定义域名 / CDN 直链需要配置访问域名', path: ['publicBaseUrl'] });
    }
  }
}

export const createFileStorageConfigSchema = baseFileStorageConfigSchema.superRefine((data, ctx) => {
  const supportedAcls = FILE_OBJECT_ACL_SUPPORT[data.provider];
  if (data.objectAcl !== 'default' && !(supportedAcls ?? []).includes(data.objectAcl)) {
    const message = supportedAcls
      ? `该存储类型的对象读写权限仅支持：${supportedAcls.join(' / ')}`
      : '该存储类型不支持设置对象读写权限';
    ctx.addIssue({ code: 'custom', message, path: ['objectAcl'] });
  }
  addAccessStrategyIssues(data, ctx);
  if (data.provider === 'local' && !data.localRootPath) {
    ctx.addIssue({ code: 'custom', message: '本地磁盘配置需要填写存储目录', path: ['localRootPath'] });
  }
  if (data.provider === 'oss') {
    const requiredFields: Array<keyof typeof data> = ['ossRegion', 'ossEndpoint', 'ossBucket', 'ossAccessKeyId', 'ossAccessKeySecret'];
    for (const field of requiredFields) {
      if (!data[field]) {
        ctx.addIssue({ code: 'custom', message: 'OSS 配置项不能为空', path: [field] });
      }
    }
  }
  if (data.provider === 's3') {
    const requiredFields: Array<keyof typeof data> = ['s3Region', 's3Bucket', 's3AccessKeyId', 's3SecretAccessKey'];
    for (const field of requiredFields) {
      if (!data[field]) {
        ctx.addIssue({ code: 'custom', message: 'S3 配置项不能 为空', path: [field] });
      }
    }
  }
  if (data.provider === 'cos') {
    const requiredFields: Array<keyof typeof data> = ['cosRegion', 'cosBucket', 'cosSecretId', 'cosSecretKey'];
    for (const field of requiredFields) {
      if (!data[field]) {
        ctx.addIssue({ code: 'custom', message: '腾讯云 COS 配 置项不能为空', path: [field] });
      }
    }
  }
  if (data.provider === 'obs') {
    const requiredFields: Array<keyof typeof data> = ['obsEndpoint', 'obsBucket', 'obsAccessKeyId', 'obsSecretAccessKey'];
    for (const field of requiredFields) {
      if (!data[field]) ctx.addIssue({ code: 'custom', message: '华为云 OBS 配置项不能为空', path: [field] });
    }
  }
  if (data.provider === 'kodo') {
    const requiredFields: Array<keyof typeof data> = ['kodoAccessKey', 'kodoSecretKey', 'kodoBucket'];
    for (const field of requiredFields) {
      if (!data[field]) ctx.addIssue({ code: 'custom', message: '七牛云 Kodo 配置项不能为空', path: [field] });
    }
  }
  if (data.provider === 'bos') {
    const requiredFields: Array<keyof typeof data> = ['bosEndpoint', 'bosBucket', 'bosAccessKeyId', 'bosSecretAccessKey'];
    for (const field of requiredFields) {
      if (!data[field]) ctx.addIssue({ code: 'custom', message: '百度云 BOS 配置项不能为空', path: [field] });
    }
  }
  if (data.provider === 'azure') {
    const requiredFields: Array<keyof typeof data> = ['azureAccountName', 'azureAccountKey', 'azureContainerName'];
    for (const field of requiredFields) {
      if (!data[field]) ctx.addIssue({ code: 'custom', message: 'Azure Blob 配置项不能为空', path: [field] });
    }
  }
  if (data.provider === 'sftp') {
    const requiredFields: Array<keyof typeof data> = ['sftpHost', 'sftpUsername'];
    for (const field of requiredFields) {
      if (!data[field]) ctx.addIssue({ code: 'custom', message: 'SFTP 配置项不能为空', path: [field] });
    }
  }
});

export const updateFileStorageConfigSchema = partialForUpdate(baseFileStorageConfigSchema).superRefine(addAccessStrategyIssues);

// ─── 分片上传 ─────────────────────────────────────────────────────────────────
export const initChunkUploadSchema = z.object({
  fileName: z.string().min(1, '文件名不能为空').max(256),
  fileSize: z.number().int().nonnegative(),
  mimeType: z.string().max(128).optional(),
  chunkSize: z.number().int().min(UPLOAD_CHUNK_MIN_BYTES).max(UPLOAD_CHUNK_MAX_BYTES),
});

export const completeChunkUploadSchema = z.object({
  uploadId: z.string().min(1).max(64),
});

export type InitChunkUploadInput = z.infer<typeof initChunkUploadSchema>;

export type CompleteChunkUploadInput = z.infer<typeof completeChunkUploadSchema>;

export type CreateDictInput = z.infer<typeof createDictSchema>;

export type UpdateDictInput = z.infer<typeof updateDictSchema>;

export type CreateDictItemInput = z.infer<typeof createDictItemSchema>;

export type UpdateDictItemInput = z.infer<typeof updateDictItemSchema>;

export type CreateFileStorageConfigInput = z.infer<typeof createFileStorageConfigSchema>;

export type UpdateFileStorageConfigInput = z.infer<typeof updateFileStorageConfigSchema>;

// ─── 定时任务 Schema ────────────────────────────────────────────────────────
export const createCronJobSchema = z.object({
  name: z.string().min(1, '任务名称不能为空').max(64),
  cronExpression: z.string().min(1, 'Cron 表达式不能为空').max(128),
  handler: z.string().min(1, '处理器不能为空').max(128),
  params: z.string().max(4096).nullable().optional(),
  status: entityStatusSchema.default('disabled'),
  description: z.string().max(256).default(''),
  retryCount: z.number().int().min(0, '重试次数不能为负').max(10).default(0),
  /** 重试间隔，单位：秒 */
  retryInterval: z.number().int().min(0, '重试间隔不能为负').default(0),
  retryBackoff: z.boolean().default(false),
  monitorTimeout: z.number().int().min(0).nullable().optional().meta({ description: '监控超时，单位：秒；到点仍未完成视为超时' }),
});

export const updateCronJobSchema = partialForUpdate(createCronJobSchema);

export type CreateCronJobInput = z.infer<typeof createCronJobSchema>;

export type UpdateCronJobInput = z.infer<typeof updateCronJobSchema>;

/** 校验 Cron 表达式 */
export const cronValidateSchema = z.object({
  expression: z.string(),
});

export type CronValidateInput = z.infer<typeof cronValidateSchema>;

/** 切换定时任务启用状态 */
export const cronJobStatusSchema = z.object({
  status: z.enum(CRON_JOB_STATUSES),
});

export type CronJobStatusInput = z.infer<typeof cronJobStatusSchema>;

// ─── 系统调度 Schema ──────────────────────────────────────────────────────────
/** 任务策略表单整体保存：开关 / 保留策略 / 阈值必填，告警渠道与收件人缺省为空集合 */
export const updateSystemSchedulerTaskConfigSchema = z.object({
  enabled: z.boolean(),
  logRetentionDays: z.number().int().min(1).max(3650),
  logRetentionRuns: z.number().int().min(1).max(100000),
  timeoutMs: z.number().int().min(100).max(86_400_000).nullable().optional(),
  failureAlertThreshold: z.number().int().min(1).max(100),
  alertEnabled: z.boolean(),
  alertChannels: z.array(z.enum(SYSTEM_SCHEDULER_ALERT_CHANNELS)).default(['inapp']),
  alertUserIds: z.array(z.number().int().positive()).default([]),
  alertEmails: z.array(z.email()).default([]),
  alertWebhookUrl: z.url().nullable().optional(),
  manualSingleton: z.boolean(),
});

export type UpdateSystemSchedulerTaskConfigInput = z.infer<typeof updateSystemSchedulerTaskConfigSchema>;

/** 确认系统调度告警 */
export const acknowledgeSystemSchedulerAlertSchema = z.object({
  note: z.string().max(500).nullable().optional(),
});

export type AcknowledgeSystemSchedulerAlertInput = z.infer<typeof acknowledgeSystemSchedulerAlertSchema>;

// ─── 地区管理 Schema ───────────────────────────────────────────────────────────
export const createRegionSchema = z.object({
  code:       z.string().min(1, '区划代码不能为空').max(12),
  name:       z.string().min(1, '名称不能为空').max(64),
  level:      z.enum(REGION_LEVELS),
  parentCode: z.string().max(12).nullable().optional(),
  sort:       z.coerce.number().int().default(0),
  status:     entityStatusSchema.default('enabled'),
});

export const updateRegionSchema = partialForUpdate(createRegionSchema);

export type CreateRegionInput = z.infer<typeof createRegionSchema>;

export type UpdateRegionInput = z.infer<typeof updateRegionSchema>;

// ─── 标签管理 Schema ─────────────────────────────────────────────────────────
export const createTagSchema = z.object({
  name:        z.string().min(1, '标签名称不能为空').max(50),
  color:       z.string().max(20).optional(),
  groupName:   z.string().max(50).optional(),
  description: z.string().max(500).optional(),
  status:      entityStatusSchema.default('enabled'),
  sortOrder:   z.number().int().default(0),
});

export const updateTagSchema = partialForUpdate(createTagSchema);

export type CreateTagInput = z.infer<typeof createTagSchema>;

export type UpdateTagInput = z.infer<typeof updateTagSchema>;

// ─── AI 分享 / 知识库 Schema ──────────────────────────────────────────────────

// ─── 数据脱敏策略 Schema ─────────────────────────────────────────────────────

export const customMaskRuleSchema = z.object({
  prefixKeep: z.number().int().min(0).max(20),
  suffixKeep: z.number().int().min(0).max(20),
  maskChar:   z.string().min(1, '掩码字符不能为空').max(2).optional(),
}).refine((rule) => Array.from(rule.maskChar ?? '*').length === 1, { message: '掩码字符只能是单个字符', path: ['maskChar'] });

/**
 * 保存某个契约敏感字段的脱敏策略（整体替换：字段由契约声明，这里只有策略本身）。
 * `maskType` 省略 = 沿用契约声明的默认类型；`custom` 必须带规则；非 custom 的规则会被丢弃。
 */
export const saveDataMaskPolicySchema = z.object({
  maskType:          z.enum(MASK_TYPES).optional(),
  customRule:        customMaskRuleSchema.nullable().optional(),
  exemptPermissions: z.array(z.string().min(1).max(64)).max(20).default([]),
  enabled:           z.boolean().default(true),
  remark:            z.string().max(256).nullable().optional(),
}).superRefine((value, ctx) => {
  if (value.maskType === 'custom' && !value.customRule) {
    ctx.addIssue({ code: 'custom', path: ['customRule'], message: '自定义脱敏类型必须配置保留位数' });
  }
});

export type SaveDataMaskPolicyInput = z.infer<typeof saveDataMaskPolicySchema>;

/** 按需查看明文 */
export const revealSensitiveValueSchema = z.object({
  entity: z.string().min(1).max(64),
  id:     z.number().int().positive(),
  field:  z.string().min(1).max(64),
});

export type RevealSensitiveValueInput = z.infer<typeof revealSensitiveValueSchema>;

// ─── 系统监控告警规则 ─────────────────────────────────────────────────────────
// 指标全集是 constants.ts 的 MONITOR_METRICS（枚举 SSOT），此处只做引用

const monitorAlertRuleBaseSchema = z.object({
  name: z.string().min(1, '名称不能为空').max(128),
  metric: z.enum(MONITOR_METRICS),
  operator: z.enum(MONITOR_ALERT_OPERATORS).default('gt'),
  threshold: z.number(),
  durationMinutes: z.number().int().min(0).max(1440).default(0),
  level: z.enum(MONITOR_ALERT_LEVELS).default('warning'),
  channels: z.array(z.enum(['email', 'webhook', 'inapp'])).default([]),
  webhookUrl: webhookUrlSchema.nullable().optional(),
  recipientUserIds: z.array(z.number().int().positive()).max(100).default([]),
  recipientEmails: z.array(z.email('邮箱格式不正确').max(254)).max(50).default([]),
  silenceMinutes: z.number().int().min(0).max(10_080).default(30),
  enabled: z.boolean().default(true),
});

export const createMonitorAlertRuleSchema = monitorAlertRuleBaseSchema.superRefine(validateTypedAlertDelivery);

export const updateMonitorAlertRuleSchema = partialForUpdate(monitorAlertRuleBaseSchema).superRefine((value, ctx) => {
  if (value.enabled === true && value.channels !== undefined) validateTypedAlertDelivery(value, ctx);
});

/** 启用 / 禁用单条告警规则 */
export const setMonitorAlertRuleEnabledSchema = z.object({
  enabled: z.boolean(),
});

export const monitorAlertRuleIdsBody = z.object({
  ids: z.array(z.number().int().positive()).min(1, '请至少选择一条规则').max(200),
});

export const batchSetMonitorAlertRulesEnabledSchema = monitorAlertRuleIdsBody.extend({
  enabled: z.boolean(),
});

/**
 * 人工处理告警事件。
 * `pending` 表示撤销认领，会一并清空处理人与备注，让事件重新回到「没人管」的池子里。
 */
export const handleMonitorAlertEventSchema = z.object({
  handleStatus: z.enum(MONITOR_ALERT_HANDLE_STATUSES),
  note: z.string().max(500).nullish(),
});

export const batchHandleMonitorAlertEventsSchema = handleMonitorAlertEventSchema.extend({
  ids: z.array(z.number().int().positive()).min(1, '请至少选择一条告警').max(200),
});

export const monitorHistoryQuerySchema = z.object({
  range: z.enum(MONITOR_HISTORY_RANGES).default('1h'),
});

export const sqlMonitorQueriesQuerySchema = z.object({
  keyword: keywordQuery('SQL / Query ID', { max: 200 }),
  sort: queryEnum(SQL_MONITOR_QUERY_SORTS, { description: '排序方式', options: SQL_MONITOR_QUERY_SORT_OPTIONS }).default('totalMs'),
  limit: z.coerce.number().int().min(1).max(200).default(50).meta({ description: '最多返回条数' }),
});

export const sqlMonitorHistoryQuerySchema = z.object({
  range: z.enum(MONITOR_HISTORY_RANGES).default('1h'),
  queryId: z.string().max(64).optional().meta({ description: '精确匹配 Query ID，留空查询整体趋势' }),
});

export const sqlMonitorSessionActionSchema = z.object({
  pid: z.number().int().positive(),
  backendStartToken: z.string().min(1).max(64),
  action: z.enum(SQL_MONITOR_SESSION_ACTIONS),
});

export type CreateMonitorAlertRuleInput = z.infer<typeof createMonitorAlertRuleSchema>;

export type UpdateMonitorAlertRuleInput = z.infer<typeof updateMonitorAlertRuleSchema>;

export type SetMonitorAlertRuleEnabledInput = z.infer<typeof setMonitorAlertRuleEnabledSchema>;

export type BatchSetMonitorAlertRulesEnabledInput = z.infer<typeof batchSetMonitorAlertRulesEnabledSchema>;

export type HandleMonitorAlertEventInput = z.infer<typeof handleMonitorAlertEventSchema>;

export type BatchHandleMonitorAlertEventsInput = z.infer<typeof batchHandleMonitorAlertEventsSchema>;

export type MonitorHistoryQuery = z.infer<typeof monitorHistoryQuerySchema>;

export const uploadCertSchema = z.object({
  name: z.string().min(1).max(128),
  domain: z.string().min(1).max(256),
  certContent: z.string().min(1),
  keyContent: z.string().min(1),
});

export type UploadCertSchemaInput = z.infer<typeof uploadCertSchema>;

// 多客服会话治理（接入/转接/超时自动路由/会话分配）
export const acceptMpKfSessionSchema = z.object({
  kfId: z.number().int().positive(),
});

export const closeMpKfSessionSchema = z.object({
  remark: z.string().max(255).optional(),
});

export const rateMpKfSessionSchema = z.object({
  rating: z.number().int().min(1).max(5),
  remark: z.string().max(255).optional(),
});

export const replyMpKfSessionSchema = z.object({
  msgType: z.enum(['text', 'image', 'voice', 'video', 'news']).default('text'),
  content: z.string().max(2000).optional(),
  mediaId: z.string().max(128).optional(),
}).refine((v) => v.msgType !== 'text' || (v.content && v.content.trim().length > 0), {
  message: '文本消息内容不能为空', path: ['content'],
}).refine((v) => v.msgType === 'text' || !!v.mediaId, {
  message: '该消息类型需提供 mediaId', path: ['mediaId'],
});

export type AcceptMpKfSessionInput = z.infer<typeof acceptMpKfSessionSchema>;

export type CloseMpKfSessionInput = z.infer<typeof closeMpKfSessionSchema>;

export type RateMpKfSessionInput = z.infer<typeof rateMpKfSessionSchema>;

export type ReplyMpKfSessionInput = z.infer<typeof replyMpKfSessionSchema>;

// ─── 意见反馈 Schema ─────────────────────────────────────────────────────────
export const createUserFeedbackSchema = z.object({
  score: z.number().int().min(1, '评分最低 1 分').max(5, '评分最高 5 分').nullable().optional(),
  category: z.enum(USER_FEEDBACK_CATEGORIES).default('suggestion'),
  content: z.string().max(1000, '反馈内容不能超过 1000 字').nullable().optional(),
  pagePath: z.string().max(200).nullable().optional(),
  /** 提交时活跃的会话回放 ID（SDK 联动附带） */
  replayId: z.uuid().nullable().optional(),
}).refine((v) => v.score != null || (v.content != null && v.content.trim() !== ''), {
  message: '评分与反馈内容至少填写一项',
  path: ['content'],
});

export type CreateUserFeedbackInput = z.input<typeof createUserFeedbackSchema>;

export const handleUserFeedbackSchema = z.object({
  status: z.enum(USER_FEEDBACK_STATUSES),
  handleRemark: z.string().max(500, '处理备注不能超过 500 字').nullable().optional(),
});

export type HandleUserFeedbackInput = z.input<typeof handleUserFeedbackSchema>;
