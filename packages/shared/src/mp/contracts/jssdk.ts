import * as z from 'zod';
import { defineContract, op } from '../../core/contract';
import { getMpJsConfigSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** JS-SDK wx.config 注入参数 */
export const mpJsConfigSchema = z.object({
  appId: z.string(),
  timestamp: z.int(),
  nonceStr: z.string(),
  signature: z.string(),
}).meta({ id: 'MpJsConfig' });

export type MpJsConfig = z.infer<typeof mpJsConfigSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const mpJsSdkContract = defineContract('/api/mp/jssdk', {
  config: op.post('/config', { body: getMpJsConfigSchema, response: mpJsConfigSchema, summary: '生成 JS-SDK wx.config 签名' }),
}, { tags: ['公众号 JS-SDK'] });
