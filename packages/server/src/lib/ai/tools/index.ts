import { db } from '../../../db';
import { users, aiConversations, aiHttpTools } from '../../../db/schema';
import { eq } from 'drizzle-orm';
import dayjs from 'dayjs';
import { currentUser } from '../../context';
import { getDailyTokensUsed } from '../quota';
import { getConfigNumber, getConfigValue } from '../../system-config';
import { httpRequest } from '../../http-client';
import { AI_SSRF_OPTIONS } from '../outbound';
import logger from '../../logger';
import type { AiHttpToolRow } from '../../../db/schema';
import type { ChatToolCall } from '../adapters/openai-compatible';

/** 工具执行上下文 */
export interface AiToolContext {
  userId: number;
}

/** 内置工具定义 */
export interface AiTool {
  name: string;
  description: string;
  /** JSON Schema 格式的参数定义 */
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>, ctx: AiToolContext) => Promise<string>;
}

const getCurrentTime: AiTool = {
  name: 'get_current_time',
  description: '获取服务器当前日期时间（YYYY-MM-DD HH:mm:ss），可用于回答"现在几点""今天星期几"等问题',
  parameters: { type: 'object', properties: {}, required: [] },
  execute: async () => {
    const now = dayjs();
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    return JSON.stringify({ datetime: now.format('YYYY-MM-DD HH:mm:ss'), weekday: `星期${weekdays[now.day()]}` });
  },
};

const getMyAiUsage: AiTool = {
  name: 'get_my_ai_usage',
  description: '查询当前用户今日 AI token 用量与每日配额（配额为 0 表示不限制）',
  parameters: { type: 'object', properties: {}, required: [] },
  execute: async (_args, ctx) => {
    const [used, quota] = await Promise.all([
      getDailyTokensUsed(ctx.userId),
      getConfigNumber('ai_daily_token_quota', 0),
    ]);
    return JSON.stringify({ usedTokensToday: used, dailyQuota: quota, unlimited: quota === 0 });
  },
};

const getSystemOverview: AiTool = {
  name: 'get_system_overview',
  description: '查询本系统的基础运营概览（注册用户数、AI 对话总数），用于回答"系统有多少用户"之类的问题',
  parameters: { type: 'object', properties: {}, required: [] },
  execute: async () => {
    const [userCount, convCount] = await Promise.all([
      db.$count(users),
      db.$count(aiConversations),
    ]);
    return JSON.stringify({ totalUsers: userCount, totalAiConversations: convCount });
  },
};

/** 内置工具注册表（后续企业工具在此扩展） */
const REGISTRY: AiTool[] = [getCurrentTime, getMyAiUsage, getSystemOverview];

// ─── HTTP API 工具（管理员配置，动态注入） ────────────────────────────────────

/** 工具执行返回结果截断上限（喂回模型，防 token 爆炸） */
const HTTP_TOOL_RESULT_MAX = 4000;
const HTTP_TOOL_TIMEOUT_MS = 10_000;

function httpToolToJsonSchema(tool: AiHttpToolRow): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const p of tool.params ?? []) {
    properties[p.name] = { type: p.type, description: p.description };
    if (p.required) required.push(p.name);
  }
  return { type: 'object', properties, required };
}

/** 执行 HTTP 工具：参数按 location 组装到 path/query/body，走 SSRF 防护出站 */
async function executeHttpTool(tool: AiHttpToolRow, args: Record<string, unknown>): Promise<string> {
  let url = tool.urlTemplate;
  const query = new URLSearchParams();
  const body: Record<string, unknown> = {};
  for (const p of tool.params ?? []) {
    const value = args[p.name];
    if (value === undefined || value === null) {
      if (p.required) return JSON.stringify({ error: `缺少必填参数：${p.name}` });
      continue;
    }
    if (p.location === 'path') {
      url = url.replaceAll(`{${p.name}}`, encodeURIComponent(String(value)));
    } else if (p.location === 'query') {
      query.set(p.name, String(value));
    } else {
      body[p.name] = value;
    }
  }
  if ([...query.keys()].length > 0) {
    url += (url.includes('?') ? '&' : '?') + query.toString();
  }
  const method = tool.method.toUpperCase();
  const res = await httpRequest(url, {
    method,
    headers: { ...(tool.headers ?? {}), ...(method !== 'GET' ? { 'Content-Type': 'application/json' } : {}) },
    body: method !== 'GET' && Object.keys(body).length > 0 ? JSON.stringify(body) : undefined,
    timeout: HTTP_TOOL_TIMEOUT_MS,
    ...AI_SSRF_OPTIONS,
  });
  const text = (await res.text()).slice(0, HTTP_TOOL_RESULT_MAX);
  if (!res.ok) return JSON.stringify({ error: `HTTP ${res.status}`, body: text });
  return text || JSON.stringify({ status: res.status });
}

async function loadEnabledHttpTools(): Promise<AiHttpToolRow[]> {
  try {
    return await db.select().from(aiHttpTools).where(eq(aiHttpTools.isEnabled, true));
  } catch (err) {
    logger.warn('[ai-tools] load http tools failed', err);
    return [];
  }
}

// ─── 图片生成工具（可选内置，依赖 ai_image_model 系统配置） ──────────────────

const generateImage: AiTool = {
  name: 'generate_image',
  description: '根据文字描述生成一张图片，返回可直接展示的图片 URL。用户要求画图/生成图片/配图时调用',
  parameters: {
    type: 'object',
    properties: { prompt: { type: 'string', description: '图片内容的英文描述（详细、具体）' } },
    required: ['prompt'],
  },
  execute: async (args) => {
    const { generateImageViaProvider } = await import('../image-gen');
    const url = await generateImageViaProvider(String(args.prompt ?? ''));
    return JSON.stringify({ imageUrl: url, note: '请用 Markdown 图片语法 ![描述](URL) 在回答中展示该图片' });
  },
};

/** 工具选择器视图（内置 + HTTP 工具），智能体编辑器勾选用 */
export async function listAvailableTools(): Promise<Array<{ name: string; description: string; source: 'builtin' | 'http' }>> {
  const imageModel = (await getConfigValue('ai_image_model', '')).trim();
  const builtins = [...REGISTRY, ...(imageModel ? [generateImage] : [])]
    .map((t) => ({ name: t.name, description: t.description, source: 'builtin' as const }));
  const httpTools = (await loadEnabledHttpTools()).map((t) => ({ name: t.name, description: t.description, source: 'http' as const }));
  return [...builtins, ...httpTools];
}

/**
 * OpenAI tools 参数格式（内置 + 启用的 HTTP 工具）。
 * filter 提供时（智能体工具白名单）仅保留名单内工具；undefined = 全部。
 */
export async function getOpenAiToolDefs(filter?: string[] | null): Promise<unknown[]> {
  const imageModel = (await getConfigValue('ai_image_model', '')).trim();
  const builtin = [...REGISTRY, ...(imageModel ? [generateImage] : [])];
  const httpTools = await loadEnabledHttpTools();
  const all = [
    ...builtin.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })),
    ...httpTools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: httpToolToJsonSchema(t) } })),
  ];
  if (!filter) return all;
  const allowed = new Set(filter);
  return all.filter((d) => allowed.has((d as { function: { name: string } }).function.name));
}

/** 执行一个工具调用，返回字符串结果（异常转为错误 JSON，喂回给模型） */
export async function executeToolCall(call: ChatToolCall): Promise<string> {
  let args: Record<string, unknown> = {};
  try {
    if (call.function.arguments?.trim()) args = JSON.parse(call.function.arguments) as Record<string, unknown>;
  } catch {
    return JSON.stringify({ error: '工具参数不是合法 JSON' });
  }
  try {
    const name = call.function.name;
    const builtin = name === 'generate_image' ? generateImage : REGISTRY.find((t) => t.name === name);
    if (builtin) {
      const user = currentUser();
      return await builtin.execute(args, { userId: user.userId });
    }
    const [httpTool] = await db.select().from(aiHttpTools).where(eq(aiHttpTools.name, name));
    if (httpTool && httpTool.isEnabled) {
      return await executeHttpTool(httpTool, args);
    }
    return JSON.stringify({ error: `未知工具：${name}` });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : '工具执行失败' });
  }
}
