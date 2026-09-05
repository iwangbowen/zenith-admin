import * as z from 'zod';
import { defineSettingsModule } from '../module-def';

/** AI 助手运行开关（模型服务商与密钥在 AI 服务商配置中维护，不在此处） */
export const aiSettingsSchema = z.object({
  dailyTokenQuota: z.int().min(0).max(1_000_000_000).default(0)
    .meta({ title: '每用户每日 Token 配额', description: '输入 + 输出合计；0 表示不限制，超限后当日无法继续对话' }),
  contentFilterEnabled: z.boolean().default(false)
    .meta({ title: '输入侧敏感词过滤', description: '词库维护在字典「AI 敏感词」中，命中直接拒绝发送' }),
  embeddingModel: z.string().trim().max(128).default('')
    .meta({ title: '知识库向量模型', description: '使用系统默认 AI 服务商的 /embeddings 接口；留空则知识库退化为关键词检索' }),
  imageModel: z.string().trim().max(128).default('')
    .meta({ title: '图片生成模型', description: '使用系统默认 AI 服务商的 /images/generations 接口；留空则关闭图片生成' }),
}).meta({ id: 'Settings.Ai' });

export type AiSettings = z.output<typeof aiSettingsSchema>;

export const aiSettingsModule = defineSettingsModule({
  schema: aiSettingsSchema,
  title: 'AI 助手',
  description: 'Token 配额、敏感词过滤与默认模型',
  scope: 'platform',
  feature: 'ai',
  readPermission: 'system:setting:view',
  writePermission: 'system:setting:update',
  sort: 70,
});
