import { http, HttpResponse } from 'msw';
import { toColonPath } from '@zenith/shared/core';
import {
  aiArenaContract,
  aiAuditContract,
  aiConversationContract,
  aiGenerationContract,
  aiKnowledgeBaseContract,
  aiPromptTemplateContract,
  aiPublicContract,
  aiSettingsContract,
  arenaChatSchema,
  AI_USER_SETTINGS_DEFAULTS,
} from '@zenith/shared/ai';
import type { AiConversationShare, AiKbDocument, AiKnowledgeBase, AiUserSettings } from '@zenith/shared/ai';
import { mock } from '@/mocks/utils/contract';
import { badRequest, notFound } from '@/mocks/utils/handlers';
import { mockDateTime } from '../utils/date';

/* ─── 用户级 AI 设置（个人指令 / AI 记忆） ────────────────────── */

let settings: AiUserSettings = structuredClone(AI_USER_SETTINGS_DEFAULTS) as AiUserSettings;
let memoryProfile: string | null = null;

/* ─── 分享 ────────────────────────────────────────────────── */

const shares = new Map<number, AiConversationShare>();

/* ─── 知识库 ──────────────────────────────────────────────── */

let nextKbId = 2;
let nextDocId = 2;
const kbStore: AiKnowledgeBase[] = [
  {
    id: 1,
    name: '产品手册',
    description: 'Zenith Admin 功能说明文档',
    userId: 1,
    embeddingModel: null,
    documentCount: 1,
    chunkCount: 3,
    createdAt: '2025-01-01 00:00:00',
    updatedAt: '2025-01-01 00:00:00',
  },
];
const docStore: Record<number, AiKbDocument[]> = {
  1: [
    {
      id: 1,
      kbId: 1,
      name: '快速上手指南',
      sourceUrl: null,
      status: 'ready',
      chunkCount: 3,
      charCount: 1200,
      error: null,
      createdAt: '2025-01-01 00:00:00',
    },
  ],
};

export const aiExtrasHandlers = [
  // ── 用户级 AI 设置 ──
  mock(aiSettingsContract.me, ({ ok }) => ok(settings)),
  mock(aiSettingsContract.save, ({ body, ok }) => {
    settings = {
      instructions: { ...settings.instructions, ...body.instructions },
      memory: { ...settings.memory, ...body.memory },
    };
    return ok(settings, '保存成功');
  }),
  mock(aiSettingsContract.memoryProfile, ({ ok }) => ok({ content: memoryProfile })),
  mock(aiSettingsContract.saveMemoryProfile, ({ body, ok }) => {
    memoryProfile = body.content || null;
    return ok({ content: memoryProfile }, '保存成功');
  }),
  mock(aiSettingsContract.clearMemoryProfile, ({ ok }) => {
    memoryProfile = null;
    return ok(null, '已清空');
  }),

  // ── 对话分享 ──
  mock(aiConversationContract.shareInfo, ({ params, ok }) => ok(shares.get(params.id) ?? null)),
  mock(aiConversationContract.share, ({ params, ok }) => {
    const token = `demo-share-${params.id}-${Date.now().toString(36)}`;
    const share: AiConversationShare = { token, url: `/public/ai-chat/${token}`, expiresAt: null, createdAt: mockDateTime() };
    shares.set(params.id, share);
    return ok(share, '已生成分享链接');
  }),
  mock(aiConversationContract.revokeShare, ({ params, ok }) => {
    shares.delete(params.id);
    return ok(null, '已取消分享');
  }),
  mock(aiPublicContract.sharedConversation, ({ ok }) =>
    ok({
      title: 'Demo 分享对话',
      sharedAt: mockDateTime(),
      messages: [
        { id: 1, role: 'user', content: '这是分享页的演示提问', reasoning: null, model: null, createdAt: mockDateTime() },
        { id: 2, role: 'assistant', content: '这是 **Demo 模式** 下的分享页演示回复。', reasoning: null, model: 'qwen (demo)', createdAt: mockDateTime() },
      ],
    })),

  // ── 对话挂载知识库 ──
  mock(aiConversationContract.setKnowledgeBase, ({ body, ok }) => ok(null, body.kbId ? '已挂载知识库' : '已清除知识库')),

  // ── 知识库（静态 /available 早于动态 /:id）──
  mock(aiKnowledgeBaseContract.all, ({ ok }) => ok(kbStore)),
  mock(aiKnowledgeBaseContract.list, ({ ok }) => ok(kbStore)),
  mock(aiKnowledgeBaseContract.create, ({ body, ok }) => {
    const now = mockDateTime();
    const kb: AiKnowledgeBase = {
      id: nextKbId++,
      name: body.name,
      description: body.description ?? null,
      userId: 1,
      embeddingModel: null,
      documentCount: 0,
      chunkCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    kbStore.push(kb);
    docStore[kb.id] = [];
    return ok(kb, '创建成功');
  }),
  mock(aiKnowledgeBaseContract.update, ({ params, body, ok }) => {
    const kb = kbStore.find((k) => k.id === params.id);
    if (!kb) return notFound('知识库不存在', { status: 404 });
    if (body.name !== undefined) kb.name = body.name;
    if (body.description !== undefined) kb.description = body.description;
    kb.updatedAt = mockDateTime();
    return ok(kb, '更新成功');
  }),
  mock(aiKnowledgeBaseContract.remove, ({ params, ok }) => {
    const idx = kbStore.findIndex((k) => k.id === params.id);
    if (idx === -1) return notFound('知识库不存在', { status: 404 });
    kbStore.splice(idx, 1);
    return ok(null, '删除成功');
  }),
  mock(aiKnowledgeBaseContract.documents, ({ params, ok }) => ok(docStore[params.id] ?? [])),
  mock(aiKnowledgeBaseContract.addDocument, ({ params, body, ok }) => {
    const kb = kbStore.find((k) => k.id === params.id);
    if (!kb) return notFound('知识库不存在', { status: 404 });
    const chunkCount = Math.max(1, Math.ceil(body.content.length / 800));
    const doc: AiKbDocument = {
      id: nextDocId++,
      kbId: params.id,
      name: body.name,
      sourceUrl: null,
      status: 'ready',
      chunkCount,
      charCount: body.content.length,
      error: null,
      createdAt: mockDateTime(),
    };
    (docStore[params.id] ??= []).push(doc);
    kb.documentCount += 1;
    kb.chunkCount += chunkCount;
    return ok(doc, '文档已入库');
  }),
  // 从 URL 抓取网页入库（Demo：生成模拟正文）
  mock(aiKnowledgeBaseContract.importUrl, ({ params, body, ok }) => {
    const kb = kbStore.find((k) => k.id === params.id);
    if (!kb) return notFound('知识库不存在', { status: 404 });
    const doc: AiKbDocument = {
      id: nextDocId++,
      kbId: params.id,
      name: body.name?.trim() || new URL(body.url).hostname,
      sourceUrl: body.url,
      status: 'ready',
      chunkCount: 2,
      charCount: 1600,
      error: null,
      createdAt: mockDateTime(),
    };
    (docStore[params.id] ??= []).push(doc);
    kb.documentCount += 1;
    kb.chunkCount += 2;
    return ok(doc, '网页已入库');
  }),
  mock(aiKnowledgeBaseContract.chunks, ({ params, ok }) => {
    const doc = (docStore[params.id] ?? []).find((d) => d.id === params.docId);
    if (!doc) return notFound('文档不存在', { status: 404 });
    return ok(Array.from({ length: doc.chunkCount }, (_, i) => ({
      id: doc.id * 100 + i + 1,
      content: `【Demo 分块 ${i + 1}】${doc.name} 的第 ${i + 1} 段正文内容。`,
      tokenCount: 120,
    })));
  }),
  mock(aiKnowledgeBaseContract.removeDocument, ({ params, ok }) => {
    const docs = docStore[params.id] ?? [];
    const idx = docs.findIndex((d) => d.id === params.docId);
    if (idx === -1) return notFound('文档不存在', { status: 404 });
    const [removed] = docs.splice(idx, 1);
    const kb = kbStore.find((k) => k.id === params.id);
    if (kb) {
      kb.documentCount = Math.max(0, kb.documentCount - 1);
      kb.chunkCount = Math.max(0, kb.chunkCount - removed.chunkCount);
    }
    return ok(null, '删除成功');
  }),

  // ── Arena：流式响应不走契约 handler，路径仍由契约派生 ──
  http.post(toColonPath(aiArenaContract.chat.fullPath), async ({ request }) => {
    const parsed = arenaChatSchema.safeParse(await request.json());
    if (!parsed.success) return badRequest('参数错误', { status: 400 });
    const reply = `【Demo Arena】模型 ${parsed.data.model ?? '默认'} 对「${parsed.data.message}」的模拟回答。`;
    let sse = '';
    for (const chunk of reply.match(/.{1,6}/g) ?? []) {
      sse += `event: delta\ndata: ${JSON.stringify({ content: chunk })}\n\n`;
    }
    sse += `event: done\ndata: ${JSON.stringify({ tokensInput: 10, tokensOutput: 30 })}\n\n`;
    return new HttpResponse(sse, { headers: { 'Content-Type': 'text/event-stream' } });
  }),
  mock(aiArenaContract.vote, ({ ok }) => ok(null, '感谢投票')),

  // ── 审计（Demo：无跨用户消息） ──
  mock(aiAuditContract.messages, ({ ok, paginate }) => ok(paginate([]))),

  // ── 生成任务（Demo：同步返回，无实际后台生成） ──
  mock(aiGenerationContract.cancel, ({ ok }) => ok(null, '已停止')),

  // ── 提示词模板版本 ──
  mock(aiPromptTemplateContract.versions, ({ params, ok }) =>
    ok([
      { id: 2, templateId: params.id, version: 2, name: '示例模板', content: '你是一位资深的{{领域}}专家（v2 演示版本），请回答用户问题。', createdBy: 1, creatorName: '管理员', createdAt: mockDateTime() },
      { id: 1, templateId: params.id, version: 1, name: '示例模板', content: '你是{{领域}}助手（v1 演示版本）。', createdBy: 1, creatorName: '管理员', createdAt: '2025-01-01 00:00:00' },
    ])),
];
