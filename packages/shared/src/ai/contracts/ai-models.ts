import * as z from 'zod';
import { defineContract, op } from '../../core/contract';
import { aiModelCapabilitiesSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 聊天模型选择器条目（轻量列表，不含敏感字段）；一个配置可展开多个模型条目 */
export const aiChatModelSchema = z.object({
  id: z.int().meta({ description: '服务商配置 ID' }),
  name: z.string().meta({ description: '配置名称' }),
  model: z.string().meta({ description: '模型名称' }),
  providerId: z.string().meta({ description: 'Mastra provider ID 或 custom' }),
  isDefault: z.boolean(),
  capabilities: aiModelCapabilitiesSchema.nullable(),
}).meta({ id: 'AiChatModel' });

export type AiChatModel = z.infer<typeof aiChatModelSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const aiChatModelContract = defineContract('/api/ai/models', {
  list: op.get('/', { response: z.array(aiChatModelSchema), summary: '聊天可用模型列表（所有登录用户，仅返回启用配置的非敏感字段）' }),
}, { tags: ['AI'] });
