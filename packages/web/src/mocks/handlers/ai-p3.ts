import { aiAgentContract, aiEvalContract, aiHttpToolContract } from '@zenith/shared/ai';
import type {
  AiAgent,
  AiBuiltinAgent,
  AiHttpTool,
  AiToolInfo,
  AiEvalDataset,
  AiEvalDatasetItem,
  AiEvalExperiment,
  AiEvalExperimentResult,
} from '@zenith/shared/ai';
import { mock } from '@/mocks/utils/contract';
import { notFound } from '@/mocks/utils/handlers';
import { mockDateTime } from '../utils/date';

/* ─── 智能体(创建即用,注册进 Mastra) ─────────────────────── */

let nextAgentId = 3;
const agentStore: AiAgent[] = [
  {
    id: 1,
    userId: 1,
    name: '合同审阅助手',
    description: '帮你快速审阅合同条款，标记风险点',
    avatar: '⚖️',
    instructions: '你是一位资深法务，擅长审阅商业合同。请指出条款风险并给出修改建议。',
    configId: null,
    model: null,
    modelSettings: { temperature: 0.3 },
    maxSteps: null,
    knowledgeBaseId: 1,
    tools: ['get_current_time'],
    openingMessage: '您好！我是合同审阅助手，请把需要审阅的合同条款粘贴给我。',
    suggestedQuestions: ['帮我审阅一段保密条款', '违约金比例多少合适？'],
    usageCount: 12,
    isEnabled: true,
    createdAt: '2025-01-01 00:00:00',
    updatedAt: '2025-01-01 00:00:00',
  },
  {
    id: 2,
    userId: 1,
    name: '周报小助手',
    description: '把零散工作记录整理成结构化周报',
    avatar: '✍️',
    instructions: '你是周报写作助手，请把用户提供的零散工作内容整理为结构化周报（本周工作 / 下周计划 / 风险与求助）。',
    configId: null,
    model: null,
    modelSettings: null,
    maxSteps: null,
    knowledgeBaseId: null,
    tools: [],
    openingMessage: '把这周做的事丢给我，我来帮你整理成周报~',
    suggestedQuestions: ['帮我把这几条记录写成周报'],
    usageCount: 5,
    isEnabled: true,
    createdAt: '2025-01-02 00:00:00',
    updatedAt: '2025-01-02 00:00:00',
  },
];

/** 编程式内置智能体(代码定义,演示 Agent×Workflow 双向整合) */
const BUILTIN_AGENTS: AiBuiltinAgent[] = [
  {
    agentId: 'biz-ops-assistant',
    name: '运营助理（编程式）',
    description: '代码定义的教学示例：zod 工具查询真实运营数据 + 周报 Workflow 编排（Agent 步骤 + structuredOutput），并把 Workflow 挂为 Agent 工具。',
    avatar: '🛠️',
    openingMessage: '我是编程式运营助理，可以查询运营快照或生成结构化周报。',
    suggestedQuestions: ['查询本周运营快照', '生成一份运营周报'],
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

/* ─── 评测(Mastra Datasets + Experiments) ────────────────── */

let nextItemId = 3;
let nextExperimentId = 2;
const datasetStore: AiEvalDataset[] = [
  {
    id: 'ds-demo-1',
    name: '通用问答回归集',
    description: '发版前跑一遍，观察基础问答质量',
    itemCount: 2,
    version: 1,
    createdAt: '2025-01-01 00:00:00',
    updatedAt: '2025-01-01 00:00:00',
  },
];
const itemStore = new Map<string, AiEvalDatasetItem[]>([
  ['ds-demo-1', [
    { id: 'item-1', input: '用一句话解释什么是 RBAC 权限模型', groundTruth: '基于角色的访问控制' },
    { id: 'item-2', input: '把这句话翻译成英文：今天天气很好', groundTruth: 'The weather is nice today' },
  ]],
]);
const experimentStore = new Map<string, AiEvalExperiment[]>([
  ['ds-demo-1', [
    {
      id: 'exp-demo-1',
      name: 'baseline',
      datasetId: 'ds-demo-1',
      targetId: 'zenith-chat',
      status: 'completed',
      totalCount: 2,
      succeededCount: 2,
      failedCount: 0,
      avgScores: { 'ground-truth': 0.62 },
      createdAt: '2025-01-05 10:00:00',
    },
  ]],
]);
const resultStore = new Map<string, AiEvalExperimentResult[]>([
  ['exp-demo-1', [
    {
      itemId: 'item-1',
      input: '用一句话解释什么是 RBAC 权限模型',
      groundTruth: '基于角色的访问控制',
      output: 'RBAC 是基于角色的访问控制模型，通过给用户分配角色、给角色分配权限来管理访问。',
      scores: { 'ground-truth': 0.71, 'answer-similarity': 0.9 },
      reasons: { 'answer-similarity': '输出准确表达了「基于角色的访问控制」核心语义，且补充了角色-权限分配机制，语义高度一致。' },
      error: null,
    },
    {
      itemId: 'item-2',
      input: '把这句话翻译成英文：今天天气很好',
      groundTruth: 'The weather is nice today',
      output: 'The weather is very nice today.',
      scores: { 'ground-truth': 0.53, 'answer-similarity': 0.85 },
      reasons: { 'answer-similarity': '译文与期望答案语义一致，仅多出程度副词 very，不影响正确性。' },
      error: null,
    },
  ]],
]);

export const aiP3Handlers = [
  // ── 智能体（静态 /builtin 早于动态 /:id）──
  mock(aiAgentContract.builtin, ({ ok }) => ok(BUILTIN_AGENTS)),
  mock(aiAgentContract.detail, ({ params, ok }) => {
    const agent = agentStore.find((a) => a.id === params.id);
    if (!agent) return notFound('智能体不存在', { status: 404 });
    return ok(agent);
  }),
  mock(aiAgentContract.list, ({ ok }) => ok(agentStore)),
  mock(aiAgentContract.create, ({ body, ok }) => {
    const now = mockDateTime();
    const agent: AiAgent = {
      id: nextAgentId++,
      userId: 1,
      name: body.name,
      description: body.description ?? null,
      avatar: body.avatar?.trim() || '🤖',
      instructions: body.instructions,
      configId: body.configId ?? null,
      model: body.model ?? null,
      modelSettings: body.modelSettings ?? null,
      maxSteps: body.maxSteps ?? null,
      knowledgeBaseId: body.knowledgeBaseId ?? null,
      tools: body.tools ?? [],
      openingMessage: body.openingMessage ?? null,
      suggestedQuestions: body.suggestedQuestions ?? [],
      usageCount: 0,
      isEnabled: body.isEnabled ?? true,
      createdAt: now,
      updatedAt: now,
    };
    agentStore.unshift(agent);
    return ok(agent, '创建成功');
  }),
  mock(aiAgentContract.update, ({ params, body, ok }) => {
    const agent = agentStore.find((a) => a.id === params.id);
    if (!agent) return notFound('智能体不存在', { status: 404 });
    Object.assign(agent, body, { updatedAt: mockDateTime() });
    return ok(agent, '更新成功');
  }),
  mock(aiAgentContract.remove, ({ params, ok }) => {
    const idx = agentStore.findIndex((a) => a.id === params.id);
    if (idx === -1) return notFound('智能体不存在', { status: 404 });
    agentStore.splice(idx, 1);
    return ok(null, '删除成功');
  }),

  // ── HTTP 工具（静态 /available 早于动态 /:id）──
  mock(aiHttpToolContract.all, ({ ok }) =>
    ok([...BUILTIN_TOOLS, ...toolStore.filter((t) => t.isEnabled).map((t) => ({ name: t.name, description: t.description, source: 'http' as const }))])),
  mock(aiHttpToolContract.list, ({ ok }) => ok(toolStore)),
  mock(aiHttpToolContract.create, ({ body, ok }) => {
    const now = mockDateTime();
    const tool: AiHttpTool = {
      id: nextToolId++,
      name: body.name,
      description: body.description,
      method: body.method,
      urlTemplate: body.urlTemplate,
      headers: body.headers ?? null,
      params: body.params ?? [],
      isEnabled: body.isEnabled ?? true,
      createdAt: now,
      updatedAt: now,
    };
    toolStore.unshift(tool);
    return ok(tool, '创建成功');
  }),
  mock(aiHttpToolContract.update, ({ params, body, ok }) => {
    const tool = toolStore.find((t) => t.id === params.id);
    if (!tool) return notFound('工具不存在', { status: 404 });
    Object.assign(tool, body, { updatedAt: mockDateTime() });
    return ok(tool, '更新成功');
  }),
  mock(aiHttpToolContract.remove, ({ params, ok }) => {
    const idx = toolStore.findIndex((t) => t.id === params.id);
    if (idx === -1) return notFound('工具不存在', { status: 404 });
    toolStore.splice(idx, 1);
    return ok(null, '删除成功');
  }),

  // ── 评测:数据集条目 ──
  mock(aiEvalContract.items, ({ params, ok }) => {
    if (!datasetStore.some((d) => d.id === params.id)) return notFound('评测集不存在', { status: 404 });
    return ok(itemStore.get(params.id) ?? []);
  }),
  mock(aiEvalContract.addItems, ({ params, body, ok }) => {
    const dataset = datasetStore.find((d) => d.id === params.id);
    if (!dataset) return notFound('评测集不存在', { status: 404 });
    const list = itemStore.get(dataset.id) ?? [];
    for (const it of body.items) {
      list.push({ id: `item-${nextItemId++}`, input: it.input, groundTruth: it.groundTruth ?? null });
    }
    itemStore.set(dataset.id, list);
    dataset.itemCount = list.length;
    dataset.version += 1;
    dataset.updatedAt = mockDateTime();
    return ok(list, '添加成功');
  }),
  mock(aiEvalContract.removeItem, ({ params, ok }) => {
    const dataset = datasetStore.find((d) => d.id === params.id);
    if (!dataset) return notFound('评测集不存在', { status: 404 });
    const list = itemStore.get(dataset.id) ?? [];
    const idx = list.findIndex((it) => it.id === params.itemId);
    if (idx === -1) return notFound('条目不存在', { status: 404 });
    list.splice(idx, 1);
    dataset.itemCount = list.length;
    dataset.version += 1;
    dataset.updatedAt = mockDateTime();
    return ok(null, '删除成功');
  }),

  // ── 评测:实验 ──
  mock(aiEvalContract.experimentDetail, ({ params, ok }) => {
    const experiments = experimentStore.get(params.id) ?? [];
    const experiment = experiments.find((e) => e.id === params.experimentId);
    if (!experiment) return notFound('实验不存在', { status: 404 });
    return ok({ experiment, results: resultStore.get(experiment.id) ?? [] });
  }),
  mock(aiEvalContract.experiments, ({ params, ok }) => {
    if (!datasetStore.some((d) => d.id === params.id)) return notFound('评测集不存在', { status: 404 });
    return ok(experimentStore.get(params.id) ?? []);
  }),
  mock(aiEvalContract.runExperiment, ({ params, body, ok }) => {
    const dataset = datasetStore.find((d) => d.id === params.id);
    if (!dataset) return notFound('评测集不存在', { status: 404 });
    const items = itemStore.get(dataset.id) ?? [];
    const experimentId = `exp-${nextExperimentId++}`;
    const name = body.name?.trim() || `exp-${experimentId}`;
    const experiment: AiEvalExperiment = {
      id: experimentId,
      name,
      datasetId: dataset.id,
      targetId: body.targetId,
      status: 'completed',
      totalCount: items.length,
      succeededCount: items.length,
      failedCount: 0,
      avgScores: { 'ground-truth': 0.58 },
      createdAt: mockDateTime(),
    };
    const list = experimentStore.get(dataset.id) ?? [];
    list.unshift(experiment);
    experimentStore.set(dataset.id, list);
    resultStore.set(experimentId, items.map((it, i) => ({
      itemId: it.id,
      input: it.input,
      groundTruth: it.groundTruth,
      output: `【Demo】${body.targetId} 对「${it.input.slice(0, 30)}」的模拟回答（第 ${i + 1} 题）。`,
      scores: { 'ground-truth': 0.58 },
      reasons: {},
      error: null,
    })));
    return ok({ experimentId, name }, '实验已发起');
  }),

  // ── 评测:数据集 CRUD ──
  mock(aiEvalContract.list, ({ ok }) => ok(datasetStore)),
  mock(aiEvalContract.create, ({ body, ok }) => {
    const now = mockDateTime();
    const id = `ds-${Date.now()}`;
    const items = (body.items ?? []).map((it) => ({ id: `item-${nextItemId++}`, input: it.input, groundTruth: it.groundTruth ?? null }));
    const dataset: AiEvalDataset = {
      id,
      name: body.name,
      description: body.description ?? null,
      itemCount: items.length,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    datasetStore.unshift(dataset);
    itemStore.set(id, items);
    return ok(dataset, '创建成功');
  }),
  mock(aiEvalContract.update, ({ params, body, ok }) => {
    const dataset = datasetStore.find((d) => d.id === params.id);
    if (!dataset) return notFound('评测集不存在', { status: 404 });
    if (body.name !== undefined) dataset.name = body.name;
    if (body.description !== undefined) dataset.description = body.description;
    dataset.updatedAt = mockDateTime();
    return ok(dataset, '更新成功');
  }),
  mock(aiEvalContract.remove, ({ params, ok }) => {
    const idx = datasetStore.findIndex((d) => d.id === params.id);
    if (idx === -1) return notFound('评测集不存在', { status: 404 });
    const [removed] = datasetStore.splice(idx, 1);
    itemStore.delete(removed.id);
    experimentStore.delete(removed.id);
    return ok(null, '删除成功');
  }),
];
