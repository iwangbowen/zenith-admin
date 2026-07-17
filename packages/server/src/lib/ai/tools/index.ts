import { db } from '../../../db';
import { users, aiConversations } from '../../../db/schema';
import dayjs from 'dayjs';
import { currentUser } from '../../context';
import { getDailyTokensUsed } from '../quota';
import { getConfigNumber } from '../../system-config';
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

/** OpenAI tools 参数格式 */
export function getOpenAiToolDefs(): unknown[] {
  return REGISTRY.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

/** 执行一个工具调用，返回字符串结果（异常转为错误 JSON，喂回给模型） */
export async function executeToolCall(call: ChatToolCall): Promise<string> {
  const tool = REGISTRY.find((t) => t.name === call.function.name);
  if (!tool) return JSON.stringify({ error: `未知工具：${call.function.name}` });
  let args: Record<string, unknown> = {};
  try {
    if (call.function.arguments?.trim()) args = JSON.parse(call.function.arguments) as Record<string, unknown>;
  } catch {
    return JSON.stringify({ error: '工具参数不是合法 JSON' });
  }
  try {
    const user = currentUser();
    return await tool.execute(args, { userId: user.userId });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : '工具执行失败' });
  }
}
