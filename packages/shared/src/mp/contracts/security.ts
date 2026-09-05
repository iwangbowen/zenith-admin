import * as z from 'zod';
import { defineContract, op } from '../../core/contract';
import { checkMpContentSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 文本内容安全校验结果（微信 msg_sec_check） */
export const mpContentCheckSchema = z.object({
  pass: z.boolean(),
  suggest: z.string().meta({ description: 'pass / risky / review' }),
}).meta({ id: 'MpContentCheck' });

export type MpContentCheck = z.infer<typeof mpContentCheckSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const mpSecurityContract = defineContract('/api/mp/security', {
  checkText: op.post('/check-text', { body: checkMpContentSchema, response: mpContentCheckSchema, summary: '文本内容安全校验' }),
}, { tags: ['公众号内容安全'] });
