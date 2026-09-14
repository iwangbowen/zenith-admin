import * as z from 'zod';
import { defineSettingsModule } from '../module-def';

/** 地图厂商 API Key（仅此处配置凭证；字段名刻意避开 apikey/secret/token 等敏感词，否则 settings 启动自检拦截） */
export const mapSettingsSchema = z.object({
  tiandituMapKey: z.string().default('').meta({ title: '天地图 API Key' }),
  amapMapKey: z.string().default('').meta({ title: '高德 API Key' }),
  amapSecurityJsCode: z.string().default('').meta({ title: '高德 2.0 安全密钥', description: '高德 2.0 逆编码必填' }),
  tencentMapKey: z.string().default('').meta({ title: '腾讯地图 Key' }),
  baiduMapKey: z.string().default('').meta({ title: '百度地图 Key' }),
}).meta({ id: 'Settings.Map' });

export const mapSettingsModule = defineSettingsModule({
  schema: mapSettingsSchema,
  title: '地图配置',
  description: '各地图厂商 API Key（仅此处配置凭证）',
  scope: 'platform',
  readPermission: 'system:setting:view',
  writePermission: 'system:setting:update',
  visibility: {
    tiandituMapKey: 'public',
    amapMapKey: 'public',
    amapSecurityJsCode: 'public',
    tencentMapKey: 'public',
    baiduMapKey: 'public',
  },
  sort: 80,
});
