import * as z from 'zod';
import { idParam } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { AI_KB_DOCUMENT_STATUSES } from '../constants';
import { addAiKbDocumentSchema, createAiKnowledgeBaseSchema, importAiKbUrlSchema, updateAiKnowledgeBaseSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const aiKnowledgeBaseSchema = z.object({
  id: z.int(),
  name: z.string(),
  description: z.string().nullable(),
  userId: z.int().meta({ description: '归属用户' }),
  embeddingModel: z.string().nullable().meta({ description: '向量化模型（空 = 关键词检索）' }),
  documentCount: z.int(),
  chunkCount: z.int(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'AiKnowledgeBase' });

export type AiKnowledgeBase = z.infer<typeof aiKnowledgeBaseSchema>;

export const aiKbDocumentSchema = z.object({
  id: z.int(),
  kbId: z.int(),
  name: z.string(),
  sourceUrl: z.string().nullable().meta({ description: '网页抓取来源 URL（手工文本 / 文件导入为 null）' }),
  status: z.enum(AI_KB_DOCUMENT_STATUSES),
  chunkCount: z.int(),
  charCount: z.int(),
  error: z.string().nullable().meta({ description: '失败原因' }),
  createdAt: z.string(),
}).meta({ id: 'AiKbDocument' });

export type AiKbDocument = z.infer<typeof aiKbDocumentSchema>;

/** 知识库文档分块（回看原文） */
export const aiKbChunkSchema = z.object({
  id: z.int(),
  content: z.string(),
  tokenCount: z.int(),
}).meta({ id: 'AiKbChunk' });

export type AiKbChunk = z.infer<typeof aiKbChunkSchema>;

// ─── 路径参数 ────────────────────────────────────────────────────────────────

/** `{id}` 知识库 + `{docId}` 文档 */
export const aiKbDocumentParams = idParam.extend({
  docId: z.coerce.number().int().positive().meta({ description: '文档 ID', example: 1 }),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const aiKnowledgeBaseContract = defineContract('/api/ai/knowledge-bases', {
  list: op.get('/', { response: z.array(aiKnowledgeBaseSchema), summary: '获取我的知识库列表' }),
  all: op.get('/available', { response: z.array(aiKnowledgeBaseSchema), summary: '获取我的知识库（聊天挂载选择器用，仅需登录）' }),
  create: op.post('/', { body: createAiKnowledgeBaseSchema, response: aiKnowledgeBaseSchema, summary: '创建知识库' }),
  update: op.put('/{id}', { params: idParam, body: updateAiKnowledgeBaseSchema, response: aiKnowledgeBaseSchema, summary: '更新知识库' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除知识库（级联删除文档与分块）' }),
  documents: op.get('/{id}/documents', { params: idParam, response: z.array(aiKbDocumentSchema), summary: '获取知识库文档列表' }),
  addDocument: op.post('/{id}/documents', { params: idParam, body: addAiKbDocumentSchema, response: aiKbDocumentSchema, summary: '添加文档（纯文本，自动分块与向量化）' }),
  importUrl: op.post('/{id}/documents/import-url', { params: idParam, body: importAiKbUrlSchema, response: aiKbDocumentSchema, summary: '从 URL 抓取网页正文入库' }),
  chunks: op.get('/{id}/documents/{docId}/chunks', { params: aiKbDocumentParams, response: z.array(aiKbChunkSchema), summary: '获取文档分块内容（回看原文）' }),
  removeDocument: op.delete('/{id}/documents/{docId}', { params: aiKbDocumentParams, summary: '删除知识库文档（级联删除分块）' }),
}, { tags: ['AI'] });
