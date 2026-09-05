import * as z from 'zod';
import { defineContract, op } from '../../core/contract';
import { saveAiUserSettingsSchema, updateAiMemoryProfileSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 用户级 AI 设置（单份文档，分域；DB 稀疏存储，读取时与 AI_USER_SETTINGS_DEFAULTS 深合并） */
export const aiUserSettingsSchema = z.object({
  /** 个人指令（Custom Instructions） */
  instructions: z.object({
    enabled: z.boolean().meta({ description: '是否启用个人指令' }),
    aboutMe: z.string().nullable().meta({ description: '关于我：背景、身份、偏好等' }),
    replyStyle: z.string().nullable().meta({ description: '回答风格要求' }),
  }),
  /** AI 记忆（Mastra working memory 用户画像） */
  memory: z.object({
    enabled: z.boolean().meta({ description: '是否启用 AI 记忆（working memory 用户画像）' }),
  }),
}).meta({ id: 'AiUserSettings' });

export type AiUserSettings = z.infer<typeof aiUserSettingsSchema>;

export const aiMemoryProfileSchema = z.object({
  content: z.string().nullable().meta({ description: 'AI 记忆画像内容（Markdown），null = 尚未生成' }),
}).meta({ id: 'AiMemoryProfile' });

export type AiMemoryProfile = z.infer<typeof aiMemoryProfileSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const aiSettingsContract = defineContract('/api/ai/settings', {
  me: op.get('/', { response: aiUserSettingsSchema, summary: '获取我的 AI 设置（个人指令 / AI 记忆开关等）' }),
  save: op.put('/', { body: saveAiUserSettingsSchema, response: aiUserSettingsSchema, summary: '保存我的 AI 设置（域内字段级合并）' }),
  memoryProfile: op.get('/memory-profile', { response: aiMemoryProfileSchema, summary: '查看我的 AI 记忆画像（working memory）' }),
  saveMemoryProfile: op.put('/memory-profile', { body: updateAiMemoryProfileSchema, response: aiMemoryProfileSchema, summary: '编辑我的 AI 记忆画像' }),
  clearMemoryProfile: op.delete('/memory-profile', { summary: '清空我的 AI 记忆画像' }),
}, { tags: ['AI'] });
