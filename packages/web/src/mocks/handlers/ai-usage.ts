import { http, HttpResponse } from 'msw';
import { mockDate } from '../utils/date';

const byModel = [
  { model: 'qwen-max', provider: 'openai_compatible', messages: 320, tokensInput: 450000, tokensOutput: 210000, totalTokens: 660000, avgTtftMs: 780, costFen: 620 },
  { model: 'gpt-4o', provider: 'openai_compatible', messages: 220, tokensInput: 380000, tokensOutput: 175000, totalTokens: 555000, avgTtftMs: 920, costFen: 1944 },
  { model: 'deepseek-chat', provider: 'openai_compatible', messages: 180, tokensInput: 260000, tokensOutput: 110000, totalTokens: 370000, avgTtftMs: 650, costFen: 140 },
  { model: 'claude-3.5-sonnet', provider: null, messages: 90, tokensInput: 160000, tokensOutput: 82000, totalTokens: 242000, avgTtftMs: 1100, costFen: null },
];

const byUser = [
  { userId: 1, username: 'admin', nickname: '系统管理员', conversations: 48, messages: 166, totalTokens: 386000 },
  { userId: 2, username: 'zhangsan', nickname: '张三', conversations: 32, messages: 128, totalTokens: 296000 },
  { userId: 3, username: 'lisi', nickname: '李四', conversations: 27, messages: 104, totalTokens: 238000 },
  { userId: 4, username: 'wangwu', nickname: '王五', conversations: 23, messages: 96, totalTokens: 214000 },
  { userId: 5, username: 'product', nickname: '产品经理', conversations: 18, messages: 88, totalTokens: 192000 },
  { userId: 6, username: 'operator', nickname: '运营同学', conversations: 15, messages: 74, totalTokens: 168000 },
  { userId: 7, username: 'support', nickname: '客服主管', conversations: 12, messages: 58, totalTokens: 126000 },
  { userId: 8, username: 'devops', nickname: '运维工程师', conversations: 9, messages: 46, totalTokens: 98000 },
];

function buildTrend() {
  const messages = [42, 38, 45, 51, 49, 56, 62, 58, 61, 64, 70, 72, 68, 74];
  const tokens = [92000, 87000, 101000, 113000, 108000, 126000, 141000, 130000, 139000, 145000, 158000, 162000, 153000, 172000];
  return messages.map((messageCount, index) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (messages.length - 1 - index));
    return { date: mockDate(date), messages: messageCount, totalTokens: tokens[index] };
  });
}

const overview = {
  totalConversations: byUser.reduce((sum, item) => sum + item.conversations, 0),
  totalMessages: byModel.reduce((sum, item) => sum + item.messages, 0),
  tokensInput: byModel.reduce((sum, item) => sum + item.tokensInput, 0),
  tokensOutput: byModel.reduce((sum, item) => sum + item.tokensOutput, 0),
  totalTokens: byModel.reduce((sum, item) => sum + item.totalTokens, 0),
  activeUsers: byUser.length,
  totalCostFen: byModel.reduce((sum, item) => sum + (item.costFen ?? 0), 0),
  avgTtftMs: 860,
  successRate: 99.42,
};

export const aiUsageHandlers = [
  http.get('/api/ai/usage/stats', () => {
    return HttpResponse.json({
      code: 0,
      message: 'success',
      data: {
        overview,
        byModel,
        byUser,
        trend: buildTrend(),
      },
    });
  }),
];
