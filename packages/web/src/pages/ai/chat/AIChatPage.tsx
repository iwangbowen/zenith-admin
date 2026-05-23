import React, { useState, useCallback, useRef } from 'react';
import { AIChatDialogue, AIChatInput, Typography, Button, Tag, RadioGroup, Radio, Select, Toast, List as SemiList } from '@douyinfe/semi-ui';
import type { Message as AIChatMessage } from '@douyinfe/semi-ui/lib/es/aiChatDialogue';
import { MessageSquarePlus, Trash2, Globe, AlignLeft, AlignJustify, Bot, Wrench } from 'lucide-react';
import { MasterDetailLayout } from '@/components/MasterDetailLayout';

const { Configure } = AIChatInput;
const { Title, Text } = Typography;

type AIChatDialogueInstance = InstanceType<typeof AIChatDialogue>;

type Message = Omit<AIChatMessage, 'role' | 'content' | 'status' | 'createdAt'> & {
  id: string;
  role: 'system' | 'user' | 'assistant';
  content: NonNullable<AIChatMessage['content']>;
  createdAt: number;
  status?: 'completed' | 'in_progress' | 'failed';
};

const roleConfig = {
  user: {
    name: '我',
    avatar: 'https://lf3-static.bytednsdoc.com/obj/eden-cn/ptlz_zlp/ljhwZthlaukjlkulzlp/docs-icon.png',
  },
  assistant: {
    name: 'AI 助手',
    avatar: 'https://lf3-static.bytednsdoc.com/obj/eden-cn/ptlz_zlp/ljhwZthlaukjlkulzlp/other/logo.png',
  },
  system: {
    name: '系统',
    avatar: 'https://lf3-static.bytednsdoc.com/obj/eden-cn/ptlz_zlp/ljhwZthlaukjlkulzlp/other/logo.png',
  },
};

const DEMO_CONVERSATIONS: { id: string; title: string; messages: Message[] }[] = [
  {
    id: 'conv-1',
    title: '数据库查询优化',
    messages: [
      {
        id: 'msg-1-1',
        role: 'system',
        content: '你是一位专业的后台管理系统 AI 助手，可以帮助用户解答系统使用、SQL 查询、功能开发等问题。',
        createdAt: Date.now() - 300000,
        status: 'completed',
      },
      {
        id: 'msg-1-2',
        role: 'user',
        content: '如何优化 PostgreSQL 中的慢查询？',
        createdAt: Date.now() - 280000,
        status: 'completed',
      },
      {
        id: 'msg-1-3',
        role: 'assistant',
        content: `优化 PostgreSQL 慢查询可以从以下几个方向入手：

**1. 使用 EXPLAIN ANALYZE 定位问题**

\`\`\`sql
EXPLAIN ANALYZE SELECT * FROM users WHERE department_id = 1;
\`\`\`

**2. 添加合适的索引**

\`\`\`sql
-- 单列索引
CREATE INDEX idx_users_dept ON users(department_id);

-- 复合索引（注意列顺序）
CREATE INDEX idx_users_dept_status ON users(department_id, status);
\`\`\`

**3. 避免全表扫描**
- 不在 WHERE 条件中对索引列使用函数
- 使用 \`=\` 而非 \`LIKE '%keyword%'\`
- 避免隐式类型转换

**4. 分页优化**

\`\`\`sql
-- 慢（OFFSET 大时性能差）
SELECT * FROM logs ORDER BY id DESC OFFSET 10000 LIMIT 20;

-- 快（游标分页）
SELECT * FROM logs WHERE id < :lastId ORDER BY id DESC LIMIT 20;
\`\`\`

**5. 连接查询优化**
- 确保 JOIN 条件列上有索引
- 小表驱动大表
- 使用 \`EXISTS\` 代替 \`IN\` 处理大子查询

需要针对具体的 SQL 进一步分析吗？`,
        createdAt: Date.now() - 260000,
        status: 'completed',
      },
    ],
  },
  {
    id: 'conv-2',
    title: '权限系统设计',
    messages: [
      {
        id: 'msg-2-1',
        role: 'system',
        content: '你是一位专业的后台管理系统 AI 助手。',
        createdAt: Date.now() - 600000,
        status: 'completed',
      },
      {
        id: 'msg-2-2',
        role: 'user',
        content: 'Zenith Admin 使用什么权限模型？',
        createdAt: Date.now() - 580000,
        status: 'completed',
      },
      {
        id: 'msg-2-3',
        role: 'assistant',
        content: `Zenith Admin 采用 **RBAC（基于角色的访问控制）** 模型，具体包含以下层次：

**核心概念**
- **用户（User）**：系统操作主体
- **角色（Role）**：权限的载体，如"超级管理员"、"普通用户"
- **菜单/权限（Menu/Permission）**：具体的功能点或操作权限

**权限粒度**
分为三种类型：
1. \`directory\` — 导航目录（不可直接访问）
2. \`menu\` — 页面级权限（控制路由访问）
3. \`button\` — 操作级权限（如"新增用户"、"删除角色"）

**数据权限**
在 RBAC 基础上，还支持数据范围控制（dataScope）：
- \`all\`：可查看全部数据
- \`dept\`：只能查看本部门数据
- \`self\`：只能查看自己创建的数据

**前端使用**

\`\`\`tsx
import { usePermission } from '@/hooks/usePermission';

function MyPage() {
  const hasPermission = usePermission();
  return (
    <>
      {hasPermission('system:user:create') && (
        <Button>新增用户</Button>
      )}
    </>
  );
}
\`\`\``,
        createdAt: Date.now() - 560000,
        status: 'completed',
      },
    ],
  },
  {
    id: 'conv-3',
    title: 'AI 富内容演示',
    messages: [
      {
        id: 'msg-3-1',
        role: 'system' as const,
        content: '你是一位专业的 AI 助手，可以联网搜索和使用工具。',
        createdAt: Date.now() - 100000,
        status: 'completed' as const,
      },
      {
        id: 'msg-3-2',
        role: 'user' as const,
        content: '帮我搜索 Semi Design 最新版本的 AI 组件有哪些？',
        createdAt: Date.now() - 98000,
        status: 'completed' as const,
      },
      {
        id: 'msg-3-3',
        role: 'assistant' as const,
        createdAt: Date.now() - 96000,
        status: 'completed' as const,
        content: [
          {
            type: 'reasoning',
            id: 'reasoning-1',
            summary: [{ type: 'summary_text', text: '已思考完成（用时 3.2s）' }],
            content: [{ type: 'thinking', text: '用户想了解 Semi Design 最新 AI 组件。我需要搜索相关信息并整理出清晰的回答。让我检索 Semi Design 官方文档中关于 AI 组件的介绍页面...' }],
          },
          {
            type: 'web_search_call',
            id: 'search-1',
            status: 'completed',
            action: { type: 'search', query: 'Semi Design AI 组件 最新版本' },
          },
          {
            type: 'message',
            id: 'output-1',
            role: 'assistant',
            content: [
              {
                type: 'output_text',
                text: 'Semi Design 最新版本新增了专为 AI 场景设计的组件系列，主要包括：\n\n1. **AIChatInput** — 聊天输入框，支持富文本输入、文件上传、引用、配置区域（模型选择、联网搜索、MCP 工具）、技能模版等\n2. **AIChatDialogue** — AI 对话展示组件，支持多种消息类型（文本、图片、思考块、工具调用、参考来源引用等）\n3. **Sidebar** — 侧边信息栏，集成 MCP 配置、参考来源（Annotation）、代码预览（CodeContent）、富文本编辑（FileContent）\n\n此外还新增了 AI Token 色板和 AI 风格的 Button / Tag / FloatButton。',
                annotations: [
                  { type: 'url_citation', title: 'Semi Design AI 组件介绍', url: 'https://semi.design/zh-CN/ai/aiComponent', start_index: 0, end_index: 20 },
                  { type: 'url_citation', title: 'AIChatInput 文档', url: 'https://semi.design/zh-CN/ai/aiChatInput', start_index: 60, end_index: 95 },
                  { type: 'url_citation', title: 'AIChatDialogue 文档', url: 'https://semi.design/zh-CN/ai/aiChatDialogue', start_index: 96, end_index: 150 },
                ],
              },
            ],
          },
        ],
      },
      {
        id: 'msg-3-4',
        role: 'user' as const,
        content: '用代码展示一下 AIChatInput 的基本用法',
        createdAt: Date.now() - 90000,
        status: 'completed' as const,
      },
      {
        id: 'msg-3-5',
        role: 'assistant' as const,
        createdAt: Date.now() - 88000,
        status: 'completed' as const,
        content: [
          {
            type: 'reasoning',
            id: 'reasoning-2',
            summary: [{ type: 'summary_text', text: '已思考完成（用时 1.8s）' }],
            content: [{ type: 'thinking', text: '用户需要 AIChatInput 的代码示例。我可以直接从文档中提取一个完整的使用示例。' }],
          },
          {
            type: 'message',
            id: 'output-2',
            role: 'assistant',
            content: [
              {
                type: 'output_text',
                text: '下面是 AIChatInput 的基本用法示例：\n\n```tsx\nimport { AIChatInput } from \'@douyinfe/semi-ui\';\n\nconst { Configure } = AIChatInput;\n\nfunction ChatInput() {\n  const [generating, setGenerating] = useState(false);\n\n  return (\n    <AIChatInput\n      placeholder="向 AI 提问..."\n      generating={generating}\n      onMessageSend={(content) => {\n        console.log(content.text);\n        setGenerating(true);\n      }}\n      onStopGenerate={() => setGenerating(false)}\n      renderConfigureArea={() => (\n        <Configure>\n          <Configure.Select\n            field="model"\n            initValue="gpt-4o"\n            optionList={[\n              { value: \'gpt-4o\', label: \'GPT-4o\' },\n              { value: \'deepseek\', label: \'DeepSeek\' },\n            ]}\n          />\n        </Configure>\n      )}\n    />\n  );\n}\n```\n\n核心 Props 包括 `generating`（控制生成状态）、`onMessageSend`（发送回调）和 `renderConfigureArea`（配置区域）。',
              },
            ],
          },
        ],
      },
    ],
  },
];

const HINTS = [
  '如何新增一个 CRUD 模块？',
  '如何配置角色权限？',
  '如何查看操作日志？',
  '如何设置定时任务？',
];

const MODEL_OPTIONS = [
  { value: 'gpt-4o', label: 'GPT-4o' },
  { value: 'gpt-4o-mini', label: 'GPT-4o-mini' },
  { value: 'qwen-plus', label: '通义千问 Plus' },
  { value: 'deepseek-chat', label: 'DeepSeek Chat' },
];

const THINK_MODE_OPTIONS = [
  { label: '极速', value: 'fast' },
  { label: '思考', value: 'think' },
  { label: '超能', value: 'super' },
];

let msgIdCounter = 1000;
function nextMsgId() {
  return `msg-${++msgIdCounter}`;
}

export default function AIChatPage() {
  const [conversations, setConversations] = useState(DEMO_CONVERSATIONS);
  const [activeConvId, setActiveConvId] = useState('conv-1');
  const [generating, setGenerating] = useState(false);
  const [align, setAlign] = useState<'leftRight' | 'leftAlign'>('leftRight');
  const [mode, setMode] = useState<'bubble' | 'noBubble' | 'userBubble'>('bubble');
  const [configureValues, setConfigureValues] = useState<Record<string, unknown>>({
    model: 'gpt-4o',
    webSearch: false,
    thinkMode: 'fast',
  });
  const dialogueRef = useRef<AIChatDialogueInstance | null>(null);

  const activeConv = conversations.find((c) => c.id === activeConvId);
  const messages = activeConv?.messages ?? [];

  const updateMessages = useCallback(
    (updater: (prev: Message[]) => Message[]) => {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeConvId ? { ...c, messages: updater(c.messages) } : c
        )
      );
    },
    [activeConvId]
  );

  const patchMessage = useCallback(
    (msgId: string, patch: Partial<Message>) => {
      updateMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, ...patch } : m)));
    },
    [updateMessages]
  );

  const handleMessageSend = useCallback(
    (content: { inputContents?: { type: string; text?: string }[]; text?: string }) => {
      // 兼容 MessageContent (inputContents) 和直接 { text } 调用
      const text = content.text ?? content.inputContents?.find(c => c.type === 'text')?.text;
      if (!text?.trim()) return;

      const userMsg: Message = {
        id: nextMsgId(),
        role: 'user',
        content: text,
        createdAt: Date.now(),
        status: 'completed',
      };

      const assistantMsgId = nextMsgId();
      const assistantMsg: Message = {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        createdAt: Date.now() + 1,
        status: 'in_progress',
      };

      updateMessages((prev) => [...prev, userMsg, assistantMsg]);
      setGenerating(true);

      // 模拟流式输出
      const modelLabel = MODEL_OPTIONS.find(m => m.value === configureValues.model)?.label ?? 'GPT-4o';
      const thinkModeLabel = THINK_MODE_OPTIONS.find(m => m.value === configureValues.thinkMode)?.label ?? '极速';
      const webSearchOn = configureValues.webSearch ? '✅ 开启' : '❌ 关闭';
      const mockReply = `感谢您的提问："${text}"。\n\n这是一个演示页面，用于展示 Semi Design 的 **AI Chat 组件**能力。在实际项目中，您需要接入真实的 AI 服务（如 OpenAI、通义千问等），通过后端 API 转发请求并支持流式响应（SSE / WebSocket）。\n\n**当前输入框配置区状态：**\n\n| 配置项 | 当前值 |\n|--------|--------|\n| 模型 | ${modelLabel} |\n| 思考模式 | ${thinkModeLabel} |\n| 联网搜索 | ${webSearchOn} |\n\n**接入步骤参考：**\n\n1. 在后端新增 \`/api/ai/chat\` 端点，使用 OpenAI SDK 或 DashScope SDK 发起请求\n2. 前端使用 \`fetch\` + \`ReadableStream\` 处理流式响应\n3. 利用 \`streamingChatCompletionToMessage()\` 转换数据格式，更新 \`chats\` 状态`;

      let i = 0;
      const interval = setInterval(() => {
        i += 5;
        patchMessage(assistantMsgId, { content: mockReply.slice(0, i) });
        if (i >= mockReply.length) {
          clearInterval(interval);
          patchMessage(assistantMsgId, { status: 'completed' });
          setGenerating(false);
          setTimeout(() => dialogueRef.current?.scrollToBottom(true), 100);
        }
      }, 30);
    },
    [updateMessages, patchMessage, configureValues]
  );

  const handleStopGenerate = useCallback(() => {
    setGenerating(false);
    updateMessages((prev) =>
      prev.map((m) =>
        m.status === 'in_progress' ? { ...m, status: 'completed' } : m
      )
    );
  }, [updateMessages]);

  const handleNewConversation = () => {
    const newId = `conv-${Date.now()}`;
    setConversations((prev) => [
      ...prev,
      {
        id: newId,
        title: `新对话 ${prev.length + 1}`,
        messages: [
          {
            id: nextMsgId(),
            role: 'system' as const,
            content: '你是一位专业的后台管理系统 AI 助手，可以帮助用户解答系统使用、SQL 查询、功能开发等问题。',
            createdAt: Date.now(),
            status: 'completed' as const,
          },
        ],
      },
    ]);
    setActiveConvId(newId);
  };

  const handleDeleteConversation = (id: string) => {
    if (conversations.length <= 1) {
      Toast.warning('至少保留一个对话');
      return;
    }
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeConvId === id) {
      setActiveConvId(conversations.find((c) => c.id !== id)?.id ?? '');
    }
  };

  const handleHintClick = useCallback(
    (hint: string) => {
      handleMessageSend({ text: hint });
    },
    [handleMessageSend]
  );

  return (
    <div style={{ padding: 12, height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
    <MasterDetailLayout
      gap={12}
      bordered
      divider={false}
      defaultSize={220}
      minSize={180}
      maxSize={400}
      persistKey="ai-chat"
      master={(
        <>
          <div style={{ padding: '16px 12px 8px' }}>
            <Button
              theme="solid"
              type="primary"
              icon={<MessageSquarePlus size={14} />}
              style={{ width: '100%' }}
              onClick={handleNewConversation}
            >
              新建对话
            </Button>
          </div>
          <MasterDetailLayout.Body style={{ padding: '4px 8px' }}>
          <SemiList
            dataSource={conversations}
            split={false}
            renderItem={(conv) => {
              const active = activeConvId === conv.id;
              return (
                <SemiList.Item
                  key={conv.id}
                  align="center"
                  onClick={() => setActiveConvId(conv.id)}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 6,
                    marginBottom: 2,
                    cursor: 'pointer',
                    background: active ? 'var(--semi-color-primary-light-default)' : 'transparent',
                    color: active ? 'var(--semi-color-primary)' : 'var(--semi-color-text-0)',
                  }}
                  main={(
                    <Text
                      ellipsis={{ showTooltip: true }}
                      style={{ flex: 1, fontSize: 13, color: 'inherit' }}
                    >
                      {conv.title}
                    </Text>
                  )}
                  extra={(
                    <Button
                      theme="borderless"
                      size="small"
                      icon={<Trash2 size={12} />}
                      type="danger"
                      style={{ flexShrink: 0, marginLeft: 4, opacity: 0.6 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteConversation(conv.id);
                      }}
                    />
                  )}
                />
              );
            }}
          />
          </MasterDetailLayout.Body>
          <div style={{ padding: '8px 12px 12px', borderTop: '1px solid var(--semi-color-border)' }}>
            <Text type="tertiary" size="small">
              演示模式 · 模拟 AI 回复
            </Text>
          </div>
        </>
      )}
      detail={(
        <>
          {/* 顶栏 */}
        <div
          style={{
            padding: '12px 20px',
            borderBottom: '1px solid var(--semi-color-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--semi-color-bg-1)',
          }}
        >
          <Title heading={6} style={{ margin: 0 }}>
            {activeConv?.title ?? '智能对话'}
          </Title>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Tag color="purple" size="small">演示模式</Tag>
            <Select
              value={mode}
              onChange={(v) => setMode(v as 'bubble' | 'noBubble' | 'userBubble')}
              size="small"
              placeholder="请选择模式"
              style={{ width: 110 }}
              optionList={[
                { value: 'bubble', label: '双侧气泡' },
                { value: 'noBubble', label: '无气泡' },
                { value: 'userBubble', label: '用户气泡' },
              ]}
            />
            <RadioGroup
              type="button"
              value={align}
              onChange={(e) => setAlign(e.target.value as 'leftRight' | 'leftAlign')}
              buttonSize="small"
            >
              <Radio value="leftRight"><AlignJustify size={12} /></Radio>
              <Radio value="leftAlign"><AlignLeft size={12} /></Radio>
            </RadioGroup>
          </div>
        </div>

        {/* 对话内容 */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <AIChatDialogue
            ref={dialogueRef}
            chats={messages}
            roleConfig={roleConfig}
            hints={generating ? [] : HINTS}
            align={align}
            mode={mode}
            onMessageCopy={() => Toast.success('已复制到剪贴板')}
            onMessageGoodFeedback={() => Toast.success('感谢您的正向反馈')}
            onMessageBadFeedback={() => Toast.info('感谢您的反馈，我们会持续改进')}
            onMessageReset={() => Toast.info('重新生成需接入真实 AI 服务')}
            onHintClick={handleHintClick}
            onChatsChange={(chats) => {
              updateMessages(() => chats as Message[]);
            }}
            style={{ height: '100%' }}
          />
        </div>

        {/* 输入框 */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--semi-color-border)', background: 'var(--semi-color-bg-1)' }}>
          <AIChatInput
            placeholder="向 AI 提问，或点击上方提示快速发送..."
            generating={generating}
            onMessageSend={handleMessageSend}
            onStopGenerate={handleStopGenerate}
            onConfigureChange={(value) => setConfigureValues(value as Record<string, unknown>)}
            renderConfigureArea={() => (
              <Configure>
                <Configure.Select
                  field="model"
                  initValue="gpt-4o"
                  optionList={MODEL_OPTIONS}
                />
                <Configure.Button
                  field="webSearch"
                  initValue={false}
                  icon={<Globe size={14} />}
                >
                  联网搜索
                </Configure.Button>
                <Configure.RadioButton
                  field="thinkMode"
                  initValue="fast"
                  options={THINK_MODE_OPTIONS}
                />
                <Configure.Mcp
                  showConfigure={false}
                  onConfigureButtonClick={() => Toast.info('MCP 配置面板')}
                  options={[
                    { icon: <Bot size={14} />, label: 'Semi MCP', value: 'semi-mcp', active: true },
                    { icon: <Wrench size={14} />, label: 'Code Exec', value: 'code-exec', active: false },
                    { icon: <Globe size={14} />, label: 'Web Search', value: 'web-search', active: true },
                  ]}
                />
              </Configure>
            )}
            style={{ borderRadius: 12 }}
          />
        </div>
        </>
      )}
    />
    </div>
  );
}
