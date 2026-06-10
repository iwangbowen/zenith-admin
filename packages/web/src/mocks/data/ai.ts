import { mockDateTimeOffset } from '@/mocks/utils/date';
import type { AiConversation, AiMessage, AiProviderConfig } from '@zenith/shared';

export const mockAiProviders: AiProviderConfig[] = [
  {
    id: 1,
    name: 'OpenAI GPT-4o',
    provider: 'openai_compatible',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-xx...xxxx',
    model: 'gpt-4o',
    systemPrompt: '你是一位专业的后台管理系统 AI 助手。',
    maxTokens: 4096,
    temperature: '0.7',
    isDefault: true,
    isEnabled: true,
    createdAt: '2025-01-01 00:00:00',
    updatedAt: '2025-01-01 00:00:00',
  },
  {
    id: 2,
    name: 'DeepSeek Chat',
    provider: 'openai_compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: 'sk-ds...xxxx',
    model: 'deepseek-chat',
    systemPrompt: null,
    maxTokens: 4096,
    temperature: '0.7',
    isDefault: false,
    isEnabled: true,
    createdAt: '2025-01-02 00:00:00',
    updatedAt: '2025-01-02 00:00:00',
  },
];

export const mockAiConversations: AiConversation[] = [
  {
    id: 1,
    userId: 1,
    tenantId: null,
    title: '数据库查询优化',
    providerSnapshot: { provider: 'openai_compatible', model: 'gpt-4o', configId: 1 },
    isArchived: false,
    createdAt: mockDateTimeOffset(-3600 * 1000 * 2),
    updatedAt: mockDateTimeOffset(-3600 * 1000),
  },
  {
    id: 2,
    userId: 1,
    tenantId: null,
    title: '权限系统设计',
    providerSnapshot: { provider: 'openai_compatible', model: 'gpt-4o', configId: 1 },
    isArchived: false,
    createdAt: mockDateTimeOffset(-86400 * 1000),
    updatedAt: mockDateTimeOffset(-3600 * 1000 * 3),
  },
];

export const mockAiMessages: Record<number, AiMessage[]> = {
  1: [
    {
      id: 1,
      conversationId: 1,
      role: 'user',
      content: '如何优化 PostgreSQL 中的慢查询？',
      tokensInput: 18,
      tokensOutput: 0,
      feedback: null,
      createdAt: mockDateTimeOffset(-3600 * 1000 * 2),
    },
    {
      id: 2,
      conversationId: 1,
      role: 'assistant',
      content: `优化 PostgreSQL 慢查询可以从以下几个方向入手：

**1. 使用 EXPLAIN ANALYZE 定位问题**

\`\`\`sql
EXPLAIN ANALYZE SELECT * FROM users WHERE department_id = 1;
\`\`\`

**2. 添加合适的索引**

\`\`\`sql
CREATE INDEX idx_users_dept ON users(department_id);
\`\`\`

**3. 避免全表扫描**
- 不在 WHERE 条件中对索引列使用函数
- 使用 \`=\` 而非 \`LIKE '%keyword%'\`

需要针对具体的 SQL 进一步分析吗？`,
      tokensInput: 0,
      tokensOutput: 180,
      feedback: null,
      createdAt: mockDateTimeOffset(-3600 * 1000 * 2 + 5000),
    },
  ],
  2: [
    {
      id: 3,
      conversationId: 2,
      role: 'user',
      content: 'Zenith Admin 使用什么权限模型？',
      tokensInput: 15,
      tokensOutput: 0,
      feedback: null,
      createdAt: mockDateTimeOffset(-86400 * 1000),
    },
    {
      id: 4,
      conversationId: 2,
      role: 'assistant',
      content: `Zenith Admin 采用 **RBAC（基于角色的访问控制）** 模型，权限分为三种类型：

1. **目录（directory）** — 导航目录
2. **菜单（menu）** — 页面级权限
3. **按钮（button）** — 操作级权限（如"新增用户"、"删除角色"）

在 RBAC 基础上还支持数据范围控制：all / dept / self。`,
      tokensInput: 0,
      tokensOutput: 120,
      feedback: null,
      createdAt: mockDateTimeOffset(-86400 * 1000 + 5000),
    },
  ],
};

let nextProviderId = 3;
let nextConvId = 3;
let nextMsgId = 10;

export function getNextProviderId() { return nextProviderId++; }
export function getNextConvId() { return nextConvId++; }
export function getNextMsgId() { return nextMsgId++; }
export { mockDateTime as mockAiDateTime } from '@/mocks/utils/date';
