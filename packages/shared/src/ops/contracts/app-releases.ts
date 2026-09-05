import * as z from 'zod';
import { auditFieldsSchema, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, fileField, multipart, op } from '../../core/contract';
import {
  APP_ARCHES,
  APP_ARTIFACT_KINDS,
  APP_FILE_ARTIFACT_KINDS,
  APP_PLATFORMS,
  APP_RELEASE_CHANNELS,
  APP_RELEASE_STATUSES,
} from '../constants';
import { DEVICE_SUBJECT_TYPES } from '../types';
import {
  checkAppUpdateQuerySchema,
  createAppReleaseSchema,
  createClientAppSchema,
  createExternalArtifactSchema,
  reportAppReleaseEventSchema,
  setAppReleaseRolloutSchema,
  updateAppReleaseSchema,
  updateClientAppSchema,
} from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const clientAppSchema = z.object({
  id: z.int(),
  appKey: z.string().meta({ description: '客户端侧标识，创建后不可修改', example: 'zenith-desktop' }),
  name: z.string(),
  description: z.string().nullable(),
  status: z.enum(['enabled', 'disabled']),
  releaseCount: z.int().optional().meta({ description: '列表冗余：版本总数' }),
  latestVersion: z.string().nullable().optional().meta({ description: '列表冗余：最新已发布版本号' }),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'ClientApp' });

export type ClientApp = z.infer<typeof clientAppSchema>;

export const appArtifactSchema = z.object({
  id: z.int(),
  releaseId: z.int(),
  platform: z.enum(APP_PLATFORMS),
  arch: z.enum(APP_ARCHES),
  kind: z.enum(APP_ARTIFACT_KINDS),
  fileId: z.string().nullable().meta({ description: '托管文件 ID；external 制品为 null' }),
  externalUrl: z.string().nullable(),
  fileName: z.string(),
  size: z.number(),
  sha256: z.string().nullable(),
  downloadCount: z.int(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'AppArtifact' });

export type AppArtifact = z.infer<typeof appArtifactSchema>;

export const appReleaseSchema = z.object({
  id: z.int(),
  appId: z.int(),
  appKey: z.string().optional().meta({ description: 'JOIN 冗余，供列表直接展示' }),
  appName: z.string().optional(),
  channel: z.enum(APP_RELEASE_CHANNELS),
  version: z.string(),
  notes: z.string().nullable(),
  status: z.enum(APP_RELEASE_STATUSES),
  mandatory: z.boolean(),
  minVersion: z.string().nullable(),
  rolloutPercent: z.int(),
  publishedAt: z.string().nullable(),
  artifactCount: z.int().optional(),
  artifacts: z.array(appArtifactSchema).optional(),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'AppRelease' });

export type AppRelease = z.infer<typeof appReleaseSchema>;

export const appReleaseStatsSchema = z.object({
  totals: z.object({
    checks: z.int(),
    downloads: z.int(),
    devices: z.int(),
    installSuccess: z.int(),
    installFail: z.int(),
  }),
  trend: z.array(z.object({
    date: z.string(),
    checks: z.int(),
    downloads: z.int(),
    installSuccess: z.int(),
    installFail: z.int(),
  })),
  platforms: z.array(z.object({ platform: z.enum(APP_PLATFORMS), count: z.int() })),
  versions: z.array(z.object({ version: z.string(), devices: z.int() })).meta({ description: '活跃设备的客户端版本分布（直查统一设备中心）' }),
}).meta({ id: 'AppReleaseStats' });

export type AppReleaseStats = z.infer<typeof appReleaseStatsSchema>;

/** 统一设备中心实体（升级心跳 / 推送绑定共用的设备档案） */
export const clientDeviceSchema = z.object({
  id: z.int(),
  deviceId: z.string(),
  appId: z.int(),
  appName: z.string().optional().meta({ description: 'JOIN 冗余' }),
  platform: z.enum(APP_PLATFORMS),
  arch: z.enum(APP_ARCHES).nullable(),
  deviceModel: z.string().nullable(),
  osVersion: z.string().nullable(),
  appVersion: z.string().nullable(),
  subjectType: z.enum(DEVICE_SUBJECT_TYPES).nullable(),
  subjectId: z.int().nullable(),
  subjectName: z.string().nullable().meta({ description: 'JOIN 冗余：绑定人显示名' }),
  pushProvider: z.string().nullable(),
  pushRegistrationId: z.string().nullable(),
  pushEnabled: z.boolean(),
  createdAt: z.string(),
  lastActiveAt: z.string(),
}).meta({ id: 'ClientDevice' });

export type ClientDevice = z.infer<typeof clientDeviceSchema>;

/** 公开 check API 的响应（对外裁剪，不含内部字段） */
export const appUpdateCheckResultSchema = z.object({
  hasUpdate: z.boolean(),
  mandatory: z.boolean().optional().meta({ description: 'hasUpdate=true 时以下字段存在' }),
  version: z.string().optional(),
  notes: z.string().nullable().optional(),
  publishedAt: z.string().nullable().optional(),
  artifact: z.object({
    kind: z.enum(APP_ARTIFACT_KINDS),
    fileName: z.string(),
    size: z.number(),
    sha256: z.string().nullable().optional(),
    downloadUrl: z.string().meta({ description: '托管制品为服务端下载地址；external 制品为外部跳转链接' }),
  }).optional(),
}).meta({ id: 'AppUpdateCheckResult' });

export type AppUpdateCheckResult = z.infer<typeof appUpdateCheckResultSchema>;

/** 公开 latest API 的响应（官网下载页用） */
export const appPublicReleaseInfoSchema = z.object({
  version: z.string(),
  notes: z.string().nullable().optional(),
  publishedAt: z.string().nullable().optional(),
  artifacts: z.array(z.object({
    platform: z.enum(APP_PLATFORMS),
    arch: z.enum(APP_ARCHES),
    kind: z.enum(APP_ARTIFACT_KINDS),
    fileName: z.string(),
    size: z.number(),
    sha256: z.string().nullable().optional(),
    downloadUrl: z.string(),
  })),
}).meta({ id: 'AppPublicReleaseInfo' });

export type AppPublicReleaseInfo = z.infer<typeof appPublicReleaseInfoSchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const clientAppListQuery = paginationQuery.extend({
  keyword: z.string().max(256).optional(),
  status: z.enum(['enabled', 'disabled']).optional(),
});

export const appReleaseListQuery = paginationQuery.extend({
  appId: z.coerce.number().int().positive().optional(),
  channel: z.enum(APP_RELEASE_CHANNELS).optional(),
  status: z.enum(APP_RELEASE_STATUSES).optional(),
  keyword: z.string().max(256).optional(),
});

export const appReleaseStatsQuery = z.object({
  appId: z.coerce.number().int().positive(),
  days: z.coerce.number().int().min(1).max(90).default(30),
});

export const clientDeviceListQuery = paginationQuery.extend({
  appId: z.coerce.number().int().positive().optional(),
  platform: z.enum(APP_PLATFORMS).optional(),
  subjectType: z.enum(DEVICE_SUBJECT_TYPES).optional(),
  pushBound: z.enum(['true', 'false']).optional().meta({ description: 'true 只看已绑定推送的设备' }),
  keyword: z.string().max(256).optional(),
});

/** 制品文件上传：文件本体 + 平台 / 架构 / 类型（arch 缺省 x64，kind 缺省 installer） */
export const uploadAppArtifactBody = multipart(z.object({
  file: fileField('制品文件'),
  platform: z.enum(APP_PLATFORMS),
  arch: z.enum(APP_ARCHES).optional(),
  kind: z.enum(APP_FILE_ARTIFACT_KINDS).optional(),
}));

export const publicLatestReleaseQuery = z.object({
  app: z.string().min(1).max(64),
  channel: z.enum(APP_RELEASE_CHANNELS).default('stable'),
  platform: z.enum(APP_PLATFORMS).optional(),
});

export const publicArtifactParam = z.object({
  app: z.string().min(1).max(64).meta({ description: '应用 appKey', example: 'zenith-desktop' }),
  channel: z.enum(APP_RELEASE_CHANNELS).meta({ example: 'stable' }),
  platform: z.enum(APP_PLATFORMS).meta({ example: 'windows' }),
  filename: z.string().min(1).max(255).meta({ example: 'latest.yml' }),
});

// ─── 契约：管理侧（五组子资源共享 /api/app-releases 前缀，各自独立挂载） ────────────

export const clientAppContract = defineContract('/api/app-releases/apps', {
  list: op.get('/', { query: clientAppListQuery, response: paginated(clientAppSchema), summary: '应用列表' }),
  all: op.get('/all', { response: z.array(clientAppSchema), summary: '全部启用应用（应用切换器）' }),
  create: op.post('/', { body: createClientAppSchema, response: clientAppSchema, summary: '创建应用' }),
  update: op.put('/{id}', { params: idParam, body: updateClientAppSchema, response: clientAppSchema, summary: '更新应用' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除应用' }),
}, { tags: ['应用版本管理'] });

export const appReleaseContract = defineContract('/api/app-releases/releases', {
  list: op.get('/', { query: appReleaseListQuery, response: paginated(appReleaseSchema), summary: '版本列表' }),
  detail: op.get('/{id}', { params: idParam, response: appReleaseSchema, summary: '版本详情（含制品）' }),
  create: op.post('/', { body: createAppReleaseSchema, response: appReleaseSchema, summary: '创建版本（草稿）' }),
  update: op.put('/{id}', { params: idParam, body: updateAppReleaseSchema, response: appReleaseSchema, summary: '更新版本' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除版本（草稿 / 已撤回）' }),
  publish: op.post('/{id}/publish', { params: idParam, response: appReleaseSchema, summary: '发布版本' }),
  revoke: op.post('/{id}/revoke', { params: idParam, response: appReleaseSchema, summary: '撤回版本' }),
  rollout: op.put('/{id}/rollout', { params: idParam, body: setAppReleaseRolloutSchema, response: appReleaseSchema, summary: '调整灰度比例' }),
  uploadArtifact: op.post('/{id}/artifacts', { params: idParam, body: uploadAppArtifactBody, response: appArtifactSchema, summary: '上传制品文件' }),
  addExternalArtifact: op.post('/{id}/artifacts/external', { params: idParam, body: createExternalArtifactSchema, response: appArtifactSchema, summary: '添加外链制品（App Store / TestFlight 等）' }),
}, { tags: ['应用版本管理'] });

export const appArtifactContract = defineContract('/api/app-releases/artifacts', {
  remove: op.delete('/{id}', { params: idParam, summary: '删除制品' }),
}, { tags: ['应用版本管理'] });

export const appReleaseStatsContract = defineContract('/api/app-releases', {
  stats: op.get('/stats', { query: appReleaseStatsQuery, response: appReleaseStatsSchema, summary: '升级看板统计' }),
}, { tags: ['应用版本管理'] });

export const clientDeviceContract = defineContract('/api/app-releases/devices', {
  list: op.get('/', { query: clientDeviceListQuery, response: paginated(clientDeviceSchema), summary: '设备列表（统一设备中心）' }),
  unbind: op.put('/{id}/unbind', { params: idParam, summary: '解绑设备推送（保留设备档案）' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除设备档案' }),
}, { tags: ['应用版本管理'] });

// ─── 契约：公开侧（客户端检查更新 / 制品分发，免登录） ───────────────────────────

export const publicAppReleaseContract = defineContract('/api/public/app-releases', {
  check: op.get('/check', { query: checkAppUpdateQuerySchema, response: appUpdateCheckResultSchema, public: true, summary: '检查更新（免登录）' }),
  latest: op.get('/latest', { query: publicLatestReleaseQuery, response: appPublicReleaseInfoSchema, public: true, summary: '最新已发布版本（免登录）' }),
  reportEvent: op.post('/events', { body: reportAppReleaseEventSchema, public: true, summary: '安装回执上报（免登录）' }),
  download: op.get('/{app}/{channel}/{platform}/{filename}', {
    params: publicArtifactParam,
    kind: 'file',
    public: true,
    summary: '制品分发（免登录，兼容 electron-updater）',
    description: 'electron-updater generic provider 以 feed 基地址 + 固定文件名请求：{base}/latest.yml 为版本元数据，{base}/Xxx-Setup-1.2.3.exe(.blockmap) 为安装包与差量块图；设备标识取 query deviceId 或请求头 x-device-id',
  }),
}, { tags: ['应用版本公开接口'] });
