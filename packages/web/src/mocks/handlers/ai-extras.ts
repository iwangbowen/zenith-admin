import { http, HttpResponse } from 'msw';
import type { AiKnowledgeBase, AiKbDocument, AiUserPreference } from '@zenith/shared';
import { mockDateTime } from '../utils/date';

/* ─── 个人指令 ─────────────────────────────────────────────── */

let preference: AiUserPreference = { aboutMe: null, replyStyle: null, isEnabled: true };

/* ─── 分享 ────────────────────────────────────────────────── */

const shares = new Map<number, { token: string; expiresAt: string | null; createdAt: string }>();

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
      status: 'ready',
      chunkCount: 3,
      charCount: 1200,
      error: null,
      createdAt: '2025-01-01 00:00:00',
    },
  ],
};

export const aiExtrasHandlers = [
  // ── 个人指令 ──
  http.get('/api/ai/preferences', () => HttpResponse.json({ code: 0, message: 'ok', data: preference })),
  http.put('/api/ai/preferences', async ({ request }) => {
    const body = await request.json() as Partial<AiUserPreference>;
    preference = {
      aboutMe: body.aboutMe ?? null,
      replyStyle: body.replyStyle ?? null,
      isEnabled: body.isEnabled ?? true,
    };
    return HttpResponse.json({ code: 0, message: '保存成功', data: preference });
  }),

  // ── 对话分享 ──
  http.get('/api/ai/conversations/:id/share', ({ params }) => {
    const share = shares.get(Number(params.id));
    return HttpResponse.json({
      code: 0,
      message: 'ok',
      data: share ? { token: share.token, url: `/public/ai-chat/${share.token}`, expiresAt: share.expiresAt, createdAt: share.createdAt } : null,
    });
  }),
  http.post('/api/ai/conversations/:id/share', ({ params }) => {
    const token = `demo-share-${params.id}-${Date.now().toString(36)}`;
    const share = { token, expiresAt: null, createdAt: mockDateTime() };
    shares.set(Number(params.id), share);
    return HttpResponse.json({
      code: 0,
      message: '已生成分享链接',
      data: { token, url: `/public/ai-chat/${token}`, expiresAt: null, createdAt: share.createdAt },
    });
  }),
  http.delete('/api/ai/conversations/:id/share', ({ params }) => {
    shares.delete(Number(params.id));
    return HttpResponse.json({ code: 0, message: '已取消分享', data: null });
  }),
  http.get('/api/ai/public/chat/:token', () => {
    return HttpResponse.json({
      code: 0,
      message: 'ok',
      data: {
        title: 'Demo 分享对话',
        sharedAt: mockDateTime(),
        messages: [
          { id: 1, role: 'user', content: '这是分享页的演示提问', reasoning: null, model: null, createdAt: mockDateTime() },
          { id: 2, role: 'assistant', content: '这是 **Demo 模式** 下的分享页演示回复。', reasoning: null, model: 'qwen (demo)', createdAt: mockDateTime() },
        ],
      },
    });
  }),

  // ── 对话挂载知识库 ──
  http.put('/api/ai/conversations/:id/knowledge-base', () => HttpResponse.json({ code: 0, message: '设置成功', data: null })),

  // ── 知识库 ──
  http.get('/api/ai/knowledge-bases/available', () => HttpResponse.json({ code: 0, message: 'ok', data: kbStore })),
  http.get('/api/ai/knowledge-bases', () => HttpResponse.json({ code: 0, message: 'ok', data: kbStore })),
  http.post('/api/ai/knowledge-bases', async ({ request }) => {
    const body = await request.json() as { name?: string; description?: string | null };
    const now = mockDateTime();
    const kb: AiKnowledgeBase = {
      id: nextKbId++,
      name: body.name ?? '未命名知识库',
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
    return HttpResponse.json({ code: 0, message: '创建成功', data: kb });
  }),
  http.put('/api/ai/knowledge-bases/:id', async ({ params, request }) => {
    const kb = kbStore.find((k) => k.id === Number(params.id));
    if (!kb) return HttpResponse.json({ code: 404, message: '知识库不存在', data: null }, { status: 404 });
    const body = await request.json() as { name?: string; description?: string | null };
    if (body.name !== undefined) kb.name = body.name;
    if (body.description !== undefined) kb.description = body.description;
    kb.updatedAt = mockDateTime();
    return HttpResponse.json({ code: 0, message: '更新成功', data: kb });
  }),
  http.delete('/api/ai/knowledge-bases/:id', ({ params }) => {
    const idx = kbStore.findIndex((k) => k.id === Number(params.id));
    if (idx === -1) return HttpResponse.json({ code: 404, message: '知识库不存在', data: null }, { status: 404 });
    kbStore.splice(idx, 1);
    return HttpResponse.json({ code: 0, message: '删除成功', data: null });
  }),
  http.get('/api/ai/knowledge-bases/:id/documents', ({ params }) => {
    return HttpResponse.json({ code: 0, message: 'ok', data: docStore[Number(params.id)] ?? [] });
  }),
  http.post('/api/ai/knowledge-bases/:id/documents', async ({ params, request }) => {
    const kbId = Number(params.id);
    const kb = kbStore.find((k) => k.id === kbId);
    if (!kb) return HttpResponse.json({ code: 404, message: '知识库不存在', data: null }, { status: 404 });
    const body = await request.json() as { name?: string; content?: string };
    const content = body.content ?? '';
    const chunkCount = Math.max(1, Math.ceil(content.length / 800));
    const doc: AiKbDocument = {
      id: nextDocId++,
      kbId,
      name: body.name ?? '未命名文档',
      status: 'ready',
      chunkCount,
      charCount: content.length,
      error: null,
      createdAt: mockDateTime(),
    };
    (docStore[kbId] ??= []).push(doc);
    kb.documentCount += 1;
    kb.chunkCount += chunkCount;
    return HttpResponse.json({ code: 0, message: '文档已入库', data: doc });
  }),
  http.delete('/api/ai/knowledge-bases/:id/documents/:docId', ({ params }) => {
    const kbId = Number(params.id);
    const docs = docStore[kbId] ?? [];
    const idx = docs.findIndex((d) => d.id === Number(params.docId));
    if (idx === -1) return HttpResponse.json({ code: 404, message: '文档不存在', data: null }, { status: 404 });
    const [removed] = docs.splice(idx, 1);
    const kb = kbStore.find((k) => k.id === kbId);
    if (kb) {
      kb.documentCount = Math.max(0, kb.documentCount - 1);
      kb.chunkCount = Math.max(0, kb.chunkCount - removed.chunkCount);
    }
    return HttpResponse.json({ code: 0, message: '删除成功', data: null });
  }),

  // ── Arena ──
  http.post('/api/ai/arena/chat', async ({ request }) => {
    const body = await request.json() as { message?: string; model?: string };
    const reply = `【Demo Arena】模型 ${body.model ?? '默认'} 对「${body.message ?? ''}」的模拟回答。`;
    let sse = '';
    for (const chunk of reply.match(/.{1,6}/g) ?? []) {
      sse += `event: delta\ndata: ${JSON.stringify({ content: chunk })}\n\n`;
    }
    sse += `event: done\ndata: ${JSON.stringify({ tokensInput: 10, tokensOutput: 30 })}\n\n`;
    return new HttpResponse(sse, { headers: { 'Content-Type': 'text/event-stream' } });
  }),
  http.post('/api/ai/arena/vote', () => HttpResponse.json({ code: 0, message: '感谢投票', data: null })),

  // ── 审计 ──
  http.get('/api/ai/audit/messages', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page')) || 1;
    const pageSize = Number(url.searchParams.get('pageSize')) || 10;
    return HttpResponse.json({ code: 0, message: 'ok', data: { list: [], total: 0, page, pageSize } });
  }),

  // ── 模型自动发现 ──
  http.post('/api/ai/providers/fetch-models', () => {
    return HttpResponse.json({ code: 0, message: 'ok', data: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'o4-mini'] });
  }),
];
