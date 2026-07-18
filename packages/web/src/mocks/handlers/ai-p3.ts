import { http, HttpResponse } from 'msw';
import type { AiAgent, AiHttpTool, AiToolInfo, AiEvalSet, AiEvalRun } from '@zenith/shared';
import { mockDateTime } from '../utils/date';

/* ─── 智能体 ─────────────────────────────────────────────── */

let nextAgentId = 3;
const agentStore: AiAgent[] = [
  {
    id: 1,
    userId: 1,
    name: '合同审阅助手',
    description: '帮你快速审阅合同条款，标记风险点',
    avatar: '⚖️',
    systemPrompt: '你是一位资深法务，擅长审阅商业合同。请指出条款风险并给出修改建议。',
    configId: null,
    model: null,
    temperature: null,
    knowledgeBaseId: 1,
    tools: ['get_current_time'],
    openingMessage: '您好！我是合同审阅助手，请把需要审阅的合同条款粘贴给我。',
    suggestedQuestions: ['帮我审阅一段保密条款', '违约金比例多少合适？'],
    status: 'published',
    clonedFromId: null,
    usageCount: 12,
    isEnabled: true,
    ownerName: '管理员',
    createdAt: '2025-01-01 00:00:00',
    updatedAt: '2025-01-01 00:00:00',
  },
  {
    id: 2,
    userId: 1,
    name: '周报小助手',
    description: '把零散工作记录整理成结构化周报',
    avatar: '✍️',
    systemPrompt: '你是周报写作助手，请把用户提供的零散工作内容整理为结构化周报（本周工作 / 下周计划 / 风险与求助）。',
    configId: null,
    model: null,
    temperature: null,
    knowledgeBaseId: null,
    tools: [],
    openingMessage: '把这周做的事丢给我，我来帮你整理成周报~',
    suggestedQuestions: ['帮我把这几条记录写成周报'],
    status: 'private',
    clonedFromId: null,
    usageCount: 5,
    isEnabled: true,
    ownerName: '管理员',
    createdAt: '2025-01-02 00:00:00',
    updatedAt: '2025-01-02 00:00:00',
  },
];

/* ─── HTTP 工具 ──────────────────────────────────────────── */

let nextToolId = 2;
const toolStore: AiHttpTool[] = [
  {
    id: 1,
    name: 'query_weather',
    description: '查询指定城市的实时天气，用户询问天气时调用',
    method: 'GET',
    urlTemplate: 'https://api.example.com/weather?city={city}',
    headers: null,
    params: [
      { name: 'city', type: 'string', description: '城市名称（如 北京）', required: true, location: 'path' },
    ],
    isEnabled: true,
    createdAt: '2025-01-01 00:00:00',
    updatedAt: '2025-01-01 00:00:00',
  },
];

const BUILTIN_TOOLS: AiToolInfo[] = [
  { name: 'get_current_time', description: '获取服务器当前日期时间', source: 'builtin' },
  { name: 'get_my_ai_usage', description: '查询当前用户今日 AI token 用量与配额', source: 'builtin' },
  { name: 'get_system_overview', description: '查询系统基础运营概览', source: 'builtin' },
];

/* ─── 评测 ───────────────────────────────────────────────── */

let nextEvalSetId = 2;
let nextEvalRunId = 2;
const evalSetStore: AiEvalSet[] = [
  {
    id: 1,
    name: '通用问答回归集',
    description: '发版前跑一遍，观察基础问答质量与延迟',
    items: [
      { question: '用一句话解释什么是 RBAC 权限模型', expected: '基于角色的访问控制' },
      { question: '把这句话翻译成英文：今天天气很好', expected: 'The weather is nice today' },
    ],
    createdAt: '2025-01-01 00:00:00',
    updatedAt: '2025-01-01 00:00:00',
  },
];
const evalRunStore: AiEvalRun[] = [
  {
    id: 1,
    setId: 1,
    setName: '通用问答回归集',
    configId: 1,
    model: 'gpt-4o',
    status: 'done',
    results: [
      { question: '用一句话解释什么是 RBAC 权限模型', expected: '基于角色的访问控制', answer: 'RBAC 是基于角色的访问控制模型，通过给用户分配角色、给角色分配权限来管理访问。', durationMs: 1450, tokensInput: 18, tokensOutput: 42 },
      { question: '把这句话翻译成英文：今天天气很好', expected: 'The weather is nice today', answer: 'The weather is very nice today.', durationMs: 980, tokensInput: 14, tokensOutput: 9 },
    ],
    avgDurationMs: 1215,
    totalTokens: 83,
    createdAt: '2025-01-05 10:00:00',
  },
];

export const aiP3Handlers = [
  // ── 智能体 ──
  http.get('/api/ai/agents/market', () =>
    HttpResponse.json({ code: 0, message: 'ok', data: agentStore.filter((a) => a.status === 'published' && a.isEnabled) })),
  http.get('/api/ai/agents/pending', () =>
    HttpResponse.json({ code: 0, message: 'ok', data: agentStore.filter((a) => a.status === 'pending') })),
  http.get('/api/ai/agents/:id', ({ params }) => {
    const agent = agentStore.find((a) => a.id === Number(params.id));
    if (!agent) return HttpResponse.json({ code: 404, message: '智能体不存在', data: null }, { status: 404 });
    return HttpResponse.json({ code: 0, message: 'ok', data: agent });
  }),
  http.get('/api/ai/agents', () => HttpResponse.json({ code: 0, message: 'ok', data: agentStore })),
  http.post('/api/ai/agents/:id/publish', ({ params }) => {
    const agent = agentStore.find((a) => a.id === Number(params.id));
    if (!agent) return HttpResponse.json({ code: 404, message: '智能体不存在', data: null }, { status: 404 });
    agent.status = 'pending';
    return HttpResponse.json({ code: 0, message: '已提交审核', data: agent });
  }),
  http.post('/api/ai/agents/:id/unpublish', ({ params }) => {
    const agent = agentStore.find((a) => a.id === Number(params.id));
    if (!agent) return HttpResponse.json({ code: 404, message: '智能体不存在', data: null }, { status: 404 });
    agent.status = 'private';
    return HttpResponse.json({ code: 0, message: '已撤回', data: agent });
  }),
  http.post('/api/ai/agents/:id/review', async ({ params, request }) => {
    const agent = agentStore.find((a) => a.id === Number(params.id));
    if (!agent) return HttpResponse.json({ code: 404, message: '智能体不存在', data: null }, { status: 404 });
    const body = await request.json() as { approve?: boolean };
    agent.status = body.approve ? 'published' : 'rejected';
    return HttpResponse.json({ code: 0, message: body.approve ? '已通过上架' : '已驳回', data: agent });
  }),
  http.post('/api/ai/agents/:id/clone', ({ params }) => {
    const src = agentStore.find((a) => a.id === Number(params.id));
    if (!src) return HttpResponse.json({ code: 404, message: '智能体不存在', data: null }, { status: 404 });
    const now = mockDateTime();
    const cloned: AiAgent = { ...src, id: nextAgentId++, name: `${src.name} 副本`, status: 'private', clonedFromId: src.id, usageCount: 0, knowledgeBaseId: null, createdAt: now, updatedAt: now };
    agentStore.unshift(cloned);
    return HttpResponse.json({ code: 0, message: '克隆成功', data: cloned });
  }),
  http.post('/api/ai/agents', async ({ request }) => {
    const body = await request.json() as Partial<AiAgent>;
    const now = mockDateTime();
    const agent: AiAgent = {
      id: nextAgentId++,
      userId: 1,
      name: body.name ?? '未命名智能体',
      description: body.description ?? null,
      avatar: body.avatar ?? '🤖',
      systemPrompt: body.systemPrompt ?? '',
      configId: body.configId ?? null,
      model: body.model ?? null,
      temperature: body.temperature ?? null,
      knowledgeBaseId: body.knowledgeBaseId ?? null,
      tools: body.tools ?? [],
      openingMessage: body.openingMessage ?? null,
      suggestedQuestions: body.suggestedQuestions ?? [],
      status: 'private',
      clonedFromId: null,
      usageCount: 0,
      isEnabled: body.isEnabled ?? true,
      ownerName: '管理员',
      createdAt: now,
      updatedAt: now,
    };
    agentStore.unshift(agent);
    return HttpResponse.json({ code: 0, message: '创建成功', data: agent });
  }),
  http.put('/api/ai/agents/:id', async ({ params, request }) => {
    const agent = agentStore.find((a) => a.id === Number(params.id));
    if (!agent) return HttpResponse.json({ code: 404, message: '智能体不存在', data: null }, { status: 404 });
    const body = await request.json() as Partial<AiAgent>;
    Object.assign(agent, body, { updatedAt: mockDateTime() });
    return HttpResponse.json({ code: 0, message: '更新成功', data: agent });
  }),
  http.delete('/api/ai/agents/:id', ({ params }) => {
    const idx = agentStore.findIndex((a) => a.id === Number(params.id));
    if (idx === -1) return HttpResponse.json({ code: 404, message: '智能体不存在', data: null }, { status: 404 });
    agentStore.splice(idx, 1);
    return HttpResponse.json({ code: 0, message: '删除成功', data: null });
  }),

  // ── HTTP 工具 ──
  http.get('/api/ai/http-tools/available', () =>
    HttpResponse.json({
      code: 0,
      message: 'ok',
      data: [...BUILTIN_TOOLS, ...toolStore.filter((t) => t.isEnabled).map((t) => ({ name: t.name, description: t.description, source: 'http' as const }))],
    })),
  http.get('/api/ai/http-tools', () => HttpResponse.json({ code: 0, message: 'ok', data: toolStore })),
  http.post('/api/ai/http-tools', async ({ request }) => {
    const body = await request.json() as Partial<AiHttpTool>;
    const now = mockDateTime();
    const tool: AiHttpTool = {
      id: nextToolId++,
      name: body.name ?? 'tool',
      description: body.description ?? '',
      method: body.method ?? 'GET',
      urlTemplate: body.urlTemplate ?? '',
      headers: body.headers ?? null,
      params: body.params ?? [],
      isEnabled: body.isEnabled ?? true,
      createdAt: now,
      updatedAt: now,
    };
    toolStore.unshift(tool);
    return HttpResponse.json({ code: 0, message: '创建成功', data: tool });
  }),
  http.put('/api/ai/http-tools/:id', async ({ params, request }) => {
    const tool = toolStore.find((t) => t.id === Number(params.id));
    if (!tool) return HttpResponse.json({ code: 404, message: '工具不存在', data: null }, { status: 404 });
    const body = await request.json() as Partial<AiHttpTool>;
    Object.assign(tool, body, { updatedAt: mockDateTime() });
    return HttpResponse.json({ code: 0, message: '更新成功', data: tool });
  }),
  http.delete('/api/ai/http-tools/:id', ({ params }) => {
    const idx = toolStore.findIndex((t) => t.id === Number(params.id));
    if (idx === -1) return HttpResponse.json({ code: 404, message: '工具不存在', data: null }, { status: 404 });
    toolStore.splice(idx, 1);
    return HttpResponse.json({ code: 0, message: '删除成功', data: null });
  }),

  // ── 评测 ──
  http.get('/api/ai/eval/sets', () => HttpResponse.json({ code: 0, message: 'ok', data: evalSetStore })),
  http.post('/api/ai/eval/sets/:id/run', ({ params }) => {
    const set = evalSetStore.find((s) => s.id === Number(params.id));
    if (!set) return HttpResponse.json({ code: 404, message: '评测集不存在', data: null }, { status: 404 });
    const now = mockDateTime();
    const run: AiEvalRun = {
      id: nextEvalRunId++,
      setId: set.id,
      setName: set.name,
      configId: 1,
      model: 'gpt-4o (demo)',
      status: 'done',
      results: set.items.map((it, i) => ({
        question: it.question,
        expected: it.expected,
        answer: `【Demo】对「${it.question.slice(0, 30)}」的模拟评测回答（第 ${i + 1} 题）。`,
        durationMs: 800 + i * 120,
        tokensInput: Math.ceil(it.question.length / 4),
        tokensOutput: 30,
      })),
      avgDurationMs: 900,
      totalTokens: set.items.length * 40,
      createdAt: now,
    };
    evalRunStore.unshift(run);
    return HttpResponse.json({
      code: 0,
      message: '评测任务已提交',
      data: {
        run,
        task: { id: Date.now(), taskType: 'ai-eval-run', title: `AI 评测：${set.name}`, module: '智能助手', status: 'succeeded', payload: { runId: run.id }, totalCount: set.items.length, processedCount: set.items.length, failedCount: 0, progressNote: null, result: null, errorMessage: null, cancelRequested: false, attempts: 1, maxAttempts: 1, nextRunAt: null, createdBy: 1, createdByName: '管理员', tenantId: null, startedAt: now, completedAt: now, createdAt: now, updatedAt: now },
      },
    });
  }),
  http.post('/api/ai/eval/sets', async ({ request }) => {
    const body = await request.json() as Partial<AiEvalSet>;
    const now = mockDateTime();
    const set: AiEvalSet = {
      id: nextEvalSetId++,
      name: body.name ?? '未命名评测集',
      description: body.description ?? null,
      items: body.items ?? [],
      createdAt: now,
      updatedAt: now,
    };
    evalSetStore.unshift(set);
    return HttpResponse.json({ code: 0, message: '创建成功', data: set });
  }),
  http.put('/api/ai/eval/sets/:id', async ({ params, request }) => {
    const set = evalSetStore.find((s) => s.id === Number(params.id));
    if (!set) return HttpResponse.json({ code: 404, message: '评测集不存在', data: null }, { status: 404 });
    const body = await request.json() as Partial<AiEvalSet>;
    Object.assign(set, body, { updatedAt: mockDateTime() });
    return HttpResponse.json({ code: 0, message: '更新成功', data: set });
  }),
  http.delete('/api/ai/eval/sets/:id', ({ params }) => {
    const idx = evalSetStore.findIndex((s) => s.id === Number(params.id));
    if (idx === -1) return HttpResponse.json({ code: 404, message: '评测集不存在', data: null }, { status: 404 });
    evalSetStore.splice(idx, 1);
    return HttpResponse.json({ code: 0, message: '删除成功', data: null });
  }),
  http.get('/api/ai/eval/runs/:id', ({ params }) => {
    const run = evalRunStore.find((r) => r.id === Number(params.id));
    if (!run) return HttpResponse.json({ code: 404, message: '评测运行不存在', data: null }, { status: 404 });
    return HttpResponse.json({ code: 0, message: 'ok', data: run });
  }),
  http.get('/api/ai/eval/runs', ({ request }) => {
    const url = new URL(request.url);
    const setId = url.searchParams.get('setId');
    const list = setId ? evalRunStore.filter((r) => r.setId === Number(setId)) : evalRunStore;
    return HttpResponse.json({ code: 0, message: 'ok', data: list });
  }),
  http.delete('/api/ai/eval/runs/:id', ({ params }) => {
    const idx = evalRunStore.findIndex((r) => r.id === Number(params.id));
    if (idx === -1) return HttpResponse.json({ code: 404, message: '评测运行不存在', data: null }, { status: 404 });
    evalRunStore.splice(idx, 1);
    return HttpResponse.json({ code: 0, message: '删除成功', data: null });
  }),
];
