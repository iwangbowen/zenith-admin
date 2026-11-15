import * as z from 'zod';
import { defineSettingsModule } from '../module-def';
import { isIpOrCidr, normalizeIpOrCidr } from '../ip-access-policy';
export { isIpOrCidr } from '../ip-access-policy';

const ipOrCidrSchema = z.string().trim().min(1).max(64).refine(isIpOrCidr, '必须是合法的 IP 或 CIDR（如 10.0.0.0/8）')
  .overwrite((value) => normalizeIpOrCidr(value) ?? value);

/** API 层 IP 黑白名单（`/api/*` 中间件每个请求都读，必须是平台级） */
export const ipAccessSettingsSchema = z.object({
  whitelistEnabled: z.boolean().default(false)
    .meta({ title: '启用白名单', description: '开启后仅名单内 IP 可访问 API，包含登录、公开接口和 WebSocket 握手' }),
  whitelist: z.array(ipOrCidrSchema).max(1000).default(() => [])
    .meta({ title: '白名单', description: 'IP 或 CIDR，支持 IPv4 / IPv6' }),
  blacklistEnabled: z.boolean().default(false)
    .meta({ title: '启用黑名单', description: '开启后名单内 IP 一律拒绝（黑名单优先于白名单）' }),
  blacklist: z.array(ipOrCidrSchema).max(1000).default(() => [])
    .meta({ title: '黑名单', description: 'IP 或 CIDR，支持 IPv4 / IPv6' }),
}).refine((value) => !value.whitelistEnabled || value.whitelist.length > 0, { path: ['whitelist'], message: '启用白名单时至少需要一个有效地址' })
  .meta({ id: 'Settings.IpAccess' });

export type IpAccessSettings = z.output<typeof ipAccessSettingsSchema>;

export const ipAccessSettingsModule = defineSettingsModule({
  schema: ipAccessSettingsSchema,
  title: 'IP 访问控制',
  description: '接口层 IP 黑白名单',
  scope: 'platform',
  platformOnly: 'multi-tenant',
  readPermission: 'system:ip-access:view',
  writePermission: 'system:ip-access:update',
  page: '/system/ip-access',
  sort: 110,
});
