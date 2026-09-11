import * as z from 'zod';
import { defineContract, op } from '../../core/contract';
import { clientDeviceSchema } from '../../ops/contracts/app-releases';
import { bindPushDeviceSchema } from '../../ops/validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 会员端绑定的推送设备：与统一设备中心实体同形（主体固定为 member），仅组件名不同 */
export const memberPushDeviceSchema = clientDeviceSchema.meta({ id: 'MemberPushDevice' });

export type MemberPushDevice = z.infer<typeof memberPushDeviceSchema>;

export const pushDeviceIdParam = z.object({
  deviceId: z.string().min(1).max(64).meta({ description: '客户端设备标识', example: 'a1b2c3d4' }),
});

// ─── 契约（会员登录态） ──────────────────────────────────────────────────────

export const memberPushContract = defineContract('/api/member/push/devices', {
  bind: op.post('/', { body: bindPushDeviceSchema, response: memberPushDeviceSchema, summary: '绑定推送设备（登录后上报 RegistrationID）' }),
  unbind: op.delete('/{deviceId}', { params: pushDeviceIdParam, summary: '解绑推送设备（登出时调用）' }),
}, { tags: ['会员推送'] });
