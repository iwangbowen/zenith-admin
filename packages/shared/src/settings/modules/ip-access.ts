import * as z from 'zod';
import { defineSettingsModule } from '../module-def';

const IPV4_SEGMENT = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const IPV4_PATTERN = new RegExp(`^(?:${IPV4_SEGMENT}\\.){3}${IPV4_SEGMENT}(?:\\/(?:3[0-2]|[12]?\\d))?$`);
// IPv6 采用宽松判定（十六进制段 + 可选 :: 压缩 + 可选前缀长度），运行期由 ip-range-check 做最终匹配
const IPV6_PATTERN = /^(?=.*:)[0-9a-fA-F:.]{2,45}(?:\/(?:12[0-8]|1[01]\d|[1-9]?\d))?$/;

/** 单个 IP 或 CIDR（IPv4 / IPv6） */
export function isIpOrCidr(value: string): boolean {
  return IPV4_PATTERN.test(value) || IPV6_PATTERN.test(value);
}

const ipOrCidrSchema = z.string().trim().min(1).max(64).refine(isIpOrCidr, '必须是合法的 IP 或 CIDR（如 10.0.0.0/8）');

/** API 层 IP 黑白名单（`/api/*` 中间件每个请求都读，必须是平台级） */
export const ipAccessSettingsSchema = z.object({
  whitelistEnabled: z.boolean().default(false)
    .meta({ title: '启用白名单', description: '开启后仅名单内 IP 可访问接口（登录等免检路径除外）' }),
  whitelist: z.array(ipOrCidrSchema).max(1000).default(() => [])
    .meta({ title: '白名单', description: 'IP 或 CIDR，支持 IPv4 / IPv6' }),
  blacklistEnabled: z.boolean().default(false)
    .meta({ title: '启用黑名单', description: '开启后名单内 IP 一律拒绝（黑名单优先于白名单）' }),
  blacklist: z.array(ipOrCidrSchema).max(1000).default(() => [])
    .meta({ title: '黑名单', description: 'IP 或 CIDR，支持 IPv4 / IPv6' }),
}).meta({ id: 'Settings.IpAccess' });

export type IpAccessSettings = z.output<typeof ipAccessSettingsSchema>;

export const ipAccessSettingsModule = defineSettingsModule({
  schema: ipAccessSettingsSchema,
  title: 'IP 访问控制',
  description: '接口层 IP 黑白名单',
  scope: 'platform',
  readPermission: 'system:ip-access:view',
  writePermission: 'system:ip-access:update',
  page: '/system/ip-access',
  sort: 110,
});
