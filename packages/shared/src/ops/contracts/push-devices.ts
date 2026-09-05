import * as z from 'zod';
import { defineContract, op } from '../../core/contract';
import { bindPushDeviceSchema } from '../validation';
import { clientDeviceSchema } from './app-releases';

// ─── 契约：设备推送绑定（管理端 App，登录态即可，无需权限点；会员端见 member 域） ────

const deviceIdParam = z.object({
  deviceId: z.string().min(1).max(64).meta({ description: '客户端设备标识', example: 'a1b2c3d4' }),
});

export const pushDeviceContract = defineContract('/api/push/devices', {
  bind: op.post('/', { body: bindPushDeviceSchema, response: clientDeviceSchema, summary: '绑定推送设备（登录后上报 RegistrationID）' }),
  unbind: op.delete('/{deviceId}', { params: deviceIdParam, summary: '解绑推送设备（登出时调用）' }),
}, { tags: ['推送管理'] });
