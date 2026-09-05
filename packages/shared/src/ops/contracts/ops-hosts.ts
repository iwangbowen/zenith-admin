import * as z from 'zod';
import { idParam } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { OPS_HOST_AUTH_TYPES, OPS_HOST_STATUSES } from '../constants';
import { createOpsHostSchema, updateOpsHostSchema } from '../validation';

// ─── 通用：运维主机选择 ─────────────────────────────────────────────────────────

/** 运维主机选择：缺省为本机，传 hostId 时服务端校验远端准入（system:host:use） */
export const hostQuery = z.object({
  hostId: z.coerce.number().int().positive().optional().meta({ description: '远端运维主机 ID；缺省为本机', example: 1 }),
});

export type HostQueryInput = z.infer<typeof hostQuery>;

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 主机探测快照：探测 cron 时点采集，概览矩阵与主机管理页展示 */
export const opsHostSnapshotSchema = z.object({
  kernel: z.string().nullable().meta({ description: 'uname -sr' }),
  osName: z.string().nullable().meta({ description: '/etc/os-release PRETTY_NAME' }),
  uptimeSeconds: z.number().nullable(),
  cpuCores: z.number().nullable(),
  load1: z.number().nullable(),
  memTotalBytes: z.number().nullable(),
  memUsedBytes: z.number().nullable(),
  memUsagePercent: z.number().nullable(),
  diskTotalBytes: z.number().nullable().meta({ description: '根分区容量' }),
  diskUsedBytes: z.number().nullable(),
  diskUsagePercent: z.number().nullable(),
}).meta({ id: 'OpsHostSnapshot' });

export type OpsHostSnapshot = z.infer<typeof opsHostSnapshotSchema>;

export const opsHostSchema = z.object({
  id: z.int(),
  name: z.string(),
  host: z.string(),
  port: z.int(),
  username: z.string(),
  authType: z.enum(OPS_HOST_AUTH_TYPES),
  hasPassword: z.boolean().meta({ description: '凭据只回传有无，不回传内容' }),
  hasKeyContent: z.boolean(),
  hasKeyPassphrase: z.boolean(),
  hostKeyFingerprint: z.string().nullable().meta({ description: 'SSH host key 指纹（SHA256 base64）；首连 TOFU 记录，后续不匹配拒连' }),
  status: z.enum(OPS_HOST_STATUSES),
  snapshot: opsHostSnapshotSchema.nullable(),
  probedAt: z.string().nullable(),
  probeError: z.string().nullable().meta({ description: '最近一次探测失败原因' }),
  enabled: z.boolean(),
  remark: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'OpsHost' });

export type OpsHost = z.infer<typeof opsHostSchema>;

export const opsHostTestResultSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  latencyMs: z.number().nullable(),
}).meta({ id: 'OpsHostTestResult' });

export type OpsHostTestResult = z.infer<typeof opsHostTestResultSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

const sshProfileIdParam = z.object({
  profileId: z.coerce.number().int().positive().meta({ description: '当前用户的 SSH 配置 ID', example: 1 }),
});

export const opsHostContract = defineContract('/api/ops-hosts', {
  list: op.get('/', { response: z.array(opsHostSchema), summary: '运维主机列表' }),
  probeAll: op.post('/probe-all', { response: z.array(opsHostSchema), summary: '探测全部启用主机' }),
  importSshProfile: op.post('/import-ssh-profile/{profileId}', { params: sshProfileIdParam, response: opsHostSchema, summary: '从当前用户 SSH 配置导入平台主机' }),
  detail: op.get('/{id}', { params: idParam, response: opsHostSchema, summary: '主机详情' }),
  create: op.post('/', { body: createOpsHostSchema, response: opsHostSchema, summary: '新增主机' }),
  update: op.put('/{id}', { params: idParam, body: updateOpsHostSchema, response: opsHostSchema, summary: '更新主机' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除主机' }),
  test: op.post('/{id}/test', { params: idParam, response: opsHostTestResultSchema, summary: '测试主机连接' }),
  probe: op.post('/{id}/probe', { params: idParam, response: opsHostSchema, summary: '立即探测主机' }),
  resetHostKey: op.post('/{id}/reset-host-key', { params: idParam, summary: '重置 host key 指纹（主机重装后）' }),
}, { tags: ['OpsHosts'] });
