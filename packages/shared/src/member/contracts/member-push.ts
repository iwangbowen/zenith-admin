import * as z from 'zod';
import { defineContract, op } from '../../core/contract';
import { APP_ARCHES, APP_PLATFORMS } from '../../ops/constants';
import { DEVICE_SUBJECT_TYPES } from '../../ops/types';
import { bindPushDeviceSchema } from '../../ops/validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 会员端绑定的推送设备（统一设备中心实体的会员侧视图，主体固定为 member） */
export const memberPushDeviceSchema = z.object({
  id: z.int(),
  deviceId: z.string(),
  appId: z.int(),
  appName: z.string().optional(),
  platform: z.enum(APP_PLATFORMS),
  arch: z.enum(APP_ARCHES).nullable(),
  deviceModel: z.string().nullable(),
  osVersion: z.string().nullable(),
  appVersion: z.string().nullable(),
  subjectType: z.enum(DEVICE_SUBJECT_TYPES).nullable(),
  subjectId: z.int().nullable(),
  subjectName: z.string().nullable(),
  pushProvider: z.string().nullable(),
  pushRegistrationId: z.string().nullable(),
  pushEnabled: z.boolean(),
  createdAt: z.string(),
  lastActiveAt: z.string(),
}).meta({ id: 'MemberPushDevice' });

export type MemberPushDevice = z.infer<typeof memberPushDeviceSchema>;

export const pushDeviceIdParam = z.object({
  deviceId: z.string().min(1).max(64).meta({ description: '客户端设备标识', example: 'a1b2c3d4' }),
});

// ─── 契约（会员登录态） ──────────────────────────────────────────────────────

export const memberPushContract = defineContract('/api/member/push/devices', {
  bind: op.post('/', { body: bindPushDeviceSchema, response: memberPushDeviceSchema, summary: '绑定推送设备（登录后上报 RegistrationID）' }),
  unbind: op.delete('/{deviceId}', { params: pushDeviceIdParam, summary: '解绑推送设备（登出时调用）' }),
}, { tags: ['会员推送'] });
