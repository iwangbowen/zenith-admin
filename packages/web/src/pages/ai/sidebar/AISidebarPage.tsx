import React, { useState } from 'react';
import { Sidebar, Annotation, MCPConfigure, Button, Typography, Tag, Tabs, TabPane, Toast } from '@douyinfe/semi-ui';
import type { MCPReactOption } from '@douyinfe/semi-ui/lib/es/sideBar/mcpConfigure/content';
import { PanelRight, PanelRightClose, Search, FileText, Code2, Wrench, Bot, Palette } from 'lucide-react';

const { Title, Text, Paragraph } = Typography;
const { Container, CodeContent, FileContent } = Sidebar;

// 内嵌在 Tab 中时隐藏 Container 自带的标题栏
const embeddedContainerStyle = `
  .embedded-container .semi-sidebar-container-header { display: none !important; }
  .embedded-container.semi-resizable-resizable { min-width: 0 !important; width: auto !important; }
`;

const DEMO_ANNOTATIONS = [
  {
    header: (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Search size={14} />
        <span>参考来源</span>
      </div>
    ),
    key: 'source-1',
    annotations: [
      {
        type: 'text' as const,
        title: 'Zenith Admin 权限模型文档',
        siteName: 'Zenith Docs',
        detail: 'Zenith Admin 采用 RBAC 权限模型，支持菜单级和按钮级权限控制，以及数据权限（dataScope）过滤。',
        logo: 'https://lf3-static.bytednsdoc.com/obj/eden-cn/ptlz_zlp/ljhwZthlaukjlkulzlp/other/logo.png',
        order: 1,
        url: '#',
      },
      {
        type: 'text' as const,
        title: 'Semi Design 组件文档',
        siteName: 'Semi Design',
        detail: 'Semi Design 是由抖音前端团队和 MED 产品设计团队设计、开发并维护的设计系统，提供丰富的 AI 组件支持。',
        logo: 'https://lf3-static.bytednsdoc.com/obj/eden-cn/ptlz_zlp/ljhwZthlaukjlkulzlp/other/logo.png',
        order: 2,
        url: 'https://semi.design',
      },
      {
        type: 'text' as const,
        title: 'Hono.js 官方文档',
        siteName: 'Hono',
        detail: 'Hono 是一个超轻量的 Web 框架，适用于 Edge、Cloudflare Workers 和 Node.js 等多种运行环境。',
        logo: 'https://lf3-static.bytednsdoc.com/obj/eden-cn/ptlz_zlp/ljhwZthlaukjlkulzlp/other/logo.png',
        order: 3,
        url: 'https://hono.dev',
      },
      {
        type: 'video' as const,
        title: 'AI 组件使用教程',
        siteName: 'Semi Design TV',
        detail: '手把手教你使用 Semi Design AI 组件快速搭建智能对话界面',
        duration: 750,
        img: 'https://lf3-static.bytednsdoc.com/obj/eden-cn/ptlz_zlp/ljhwZthlaukjlkulzlp/other/logo.png',
        order: 4,
        url: '#',
      },
    ],
  },
];

const DEMO_CODES = [
  {
    key: 'backend',
    name: 'ai-chat.ts',
    language: 'typescript',
    content: `import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';

const aiRouter = new Hono<{ Variables: { user: JwtPayload } }>();

// AI 聊天接口（流式 SSE）
aiRouter.post('/chat', authMiddleware, async (c) => {
  const { messages, model } = await c.req.json();

  // 使用 OpenAI SDK 发起请求
  const stream = await openai.chat.completions.create({
    model: model ?? 'gpt-4o',
    messages,
    stream: true,
  });

  // 返回 SSE 流式响应
  return streamSSE(c, async (sse) => {
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content ?? '';
      if (content) {
        await sse.writeSSE({ data: content });
      }
    }
    await sse.writeSSE({ data: '[DONE]' });
  });
});

export default aiRouter;`,
  },
  {
    key: 'frontend',
    name: 'useAIChat.ts',
    language: 'typescript',
    content: `import { useState, useCallback } from 'react';
import { streamingChatCompletionToMessage } from '@douyinfe/semi-ui';

export function useAIChat() {
  const [chats, setChats] = useState([]);
  const [generating, setGenerating] = useState(false);

  const sendMessage = useCallback(async (userText: string) => {
    // 追加用户消息
    const userMsg = { id: Date.now(), role: 'user', content: userText };
    const assistantMsg = { id: Date.now() + 1, role: 'assistant',
      content: '', status: 'in_progress' };
    setChats(prev => [...prev, userMsg, assistantMsg]);
    setGenerating(true);

    // 调用后端 SSE 接口
    const resp = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json',
        'Authorization': \`Bearer \${localStorage.getItem('zenith_token')}\` },
      body: JSON.stringify({ messages: [{ role: 'user', content: userText }] }),
    });

    const reader = resp.body!.getReader();
    let chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(/* parse chunk */);
      const { messages } = streamingChatCompletionToMessage(chunks);
      setChats(prev => [...prev.slice(0, -1), messages[0]]);
    }
    setGenerating(false);
  }, []);

  return { chats, generating, sendMessage };
}`,
  },
];

const DEMO_FILES = [
  {
    key: 'readme',
    name: 'AI 接入说明',
    editable: true,
    content: `<h2>AI 功能接入指南</h2>
<p>本页面展示了 <strong>Semi Design</strong> 提供的 AI Sidebar 组件能力，包括：</p>
<ul>
<li><strong>MCP 配置</strong>：管理 AI 工具服务（MCP Servers）的启用与配置</li>
<li><strong>参考来源</strong>：展示 AI 回复引用的文档、网页等参考资料</li>
<li><strong>代码预览</strong>：查看 AI 生成的代码，支持语法高亮与复制</li>
<li><strong>富文本编辑</strong>：查看和编辑 AI 生成的文档内容</li>
</ul>
<h3>快速接入步骤</h3>
<ol>
<li>在系统配置中添加 AI 服务商的 API Key（OpenAI / DashScope / DeepSeek）</li>
<li>后端新增 <code>/api/ai/chat</code> 端点，转发并处理流式响应</li>
<li>前端引入 <code>AIChatInput</code> 和 <code>AIChatDialogue</code> 组件</li>
<li>使用 <code>streamingChatCompletionToMessage()</code> 转换流式数据</li>
</ol>
<blockquote>
<p>详细示例代码见右侧"代码预览" Tab 页。</p>
</blockquote>`,
  },
];

const INITIAL_MCP_OPTIONS = [
  {
    icon: <Bot size={16} />,
    label: 'Semi MCP',
    value: 'semi-mcp',
    desc: 'Semi 组件文档搜索',
    configure: true,
    active: true,
  },
  {
    icon: <Palette size={16} />,
    label: 'Figma',
    value: 'figma-mcp',
    desc: '连接 Figma 设计稿',
    configure: true,
    active: false,
  },
  {
    icon: <Search size={16} />,
    label: 'Web Search',
    value: 'web-search',
    desc: '联网实时搜索',
    configure: false,
    active: true,
  },
  {
    icon: <Wrench size={16} />,
    label: 'Code Exec',
    value: 'code-exec',
    desc: '在沙箱中执行代码',
    configure: false,
    active: false,
  },
];

export default function AISidebarPage() {
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [activeTabKey, setActiveTabKey] = useState('mcp');
  const [annotationKey, setAnnotationKey] = useState<string | string[]>(['source-1']);
  const [codeActiveKey, setCodeActiveKey] = useState<string | string[]>([]);
  const [fileActiveKey, setFileActiveKey] = useState<string | string[]>([]);
  const [mcpOptions, setMcpOptions] = useState<MCPReactOption[]>(INITIAL_MCP_OPTIONS);

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 64px)', overflow: 'hidden', gap: 0 }}>
      <style>{embeddedContainerStyle}</style>
      {/* 主内容区 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        {/* 顶栏 */}
        <div
          style={{
            padding: '12px 20px',
            borderBottom: '1px solid var(--semi-color-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--semi-color-bg-1)',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Title heading={6} style={{ margin: 0 }}>AI 侧边栏组件展示</Title>
            <Tag color="violet" size="small">Semi Design New</Tag>
          </div>
          <Button
            theme="borderless"
            icon={sidebarVisible ? <PanelRightClose size={16} /> : <PanelRight size={16} />}
            onClick={() => setSidebarVisible(!sidebarVisible)}
          >
            {sidebarVisible ? '收起侧边栏' : '展开侧边栏'}
          </Button>
        </div>

        {/* 内容 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          <div style={{ maxWidth: 720 }}>
            <Title heading={4}>Sidebar 组件能力介绍</Title>
            <Paragraph spacing="extended" type="secondary">
              Semi Design 的 <Text strong>Sidebar</Text> 是专为 AI 场景设计的侧边信息栏组件，
              主要用于在 AI 对话旁展示配置项、参考来源、代码产物和富文本文档。
            </Paragraph>

            <div style={{ marginTop: 24 }}>
              <Title heading={5}>包含子组件</Title>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 12 }}>
                {[
                  {
                    icon: <Search size={20} color="var(--semi-color-primary)" />,
                    title: 'MCPConfigure',
                    desc: '管理 MCP 工具服务的启用/关闭与配置，支持内置和自定义工具',
                  },
                  {
                    icon: <FileText size={20} color="var(--semi-color-success)" />,
                    title: 'Annotation（参考来源）',
                    desc: '展示 AI 回复引用的文档、网页、视频等参考资料列表',
                  },
                  {
                    icon: <Code2 size={20} color="var(--semi-color-warning)" />,
                    title: 'CodeContent',
                    desc: '展示代码文件列表，支持语法高亮（JSON/TS/CSS 等）与全屏查看',
                  },
                  {
                    icon: <FileText size={20} color="var(--semi-color-danger)" />,
                    title: 'FileContent',
                    desc: '展示富文本文档列表，支持在线编辑（基于 tiptap）',
                  },
                ].map((item) => (
                  <div
                    key={item.title}
                    style={{
                      padding: 16,
                      border: '1px solid var(--semi-color-border)',
                      borderRadius: 8,
                      background: 'var(--semi-color-bg-1)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      {item.icon}
                      <Text strong>{item.title}</Text>
                    </div>
                    <Text type="secondary" size="small">{item.desc}</Text>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ marginTop: 24 }}>
              <Title heading={5}>右侧面板说明</Title>
              <Paragraph type="secondary">
                点击右上角按钮可切换侧边栏显示/隐藏。侧边栏包含三个 Tab：
              </Paragraph>
              <ul style={{ color: 'var(--semi-color-text-1)', lineHeight: 2 }}>
                <li><Text strong>参考来源</Text> — 展示 Annotation 组件，模拟 AI 引用的文档资料</li>
                <li><Text strong>代码预览</Text> — 展示 CodeContent 组件，包含后端路由和前端 Hook 示例代码</li>
                <li><Text strong>文档说明</Text> — 展示 FileContent 组件，富文本 AI 接入指南</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* 右侧：Sidebar */}
      {sidebarVisible && (
        <Container
          visible={sidebarVisible}
          onCancel={() => setSidebarVisible(false)}
          title="AI 信息栏"
          motion={false}
          resizable
          defaultSize={{ width: 380 }}
          minWidth={300}
          maxWidth={600}
          showClose={false}
          style={{ borderLeft: '1px solid var(--semi-color-border)', position: 'relative', height: '100%' }}
        >
          <Tabs
            activeKey={activeTabKey}
            onChange={setActiveTabKey}
            size="small"
            style={{ padding: '0 4px' }}
          >
            <TabPane tab="MCP 配置" itemKey="mcp">
              <div style={{ padding: '8px 0' }}>
                <MCPConfigure
                  visible
                  motion={false}
                  resizable={false}
                  className="embedded-container"
                  options={mcpOptions}
                  onStatusChange={(options) => {
                    setMcpOptions(options);
                  }}
                  onAddClick={() => {
                    Toast.info('添加新的 MCP Server');
                  }}
                />
              </div>
            </TabPane>
            <TabPane tab="参考来源" itemKey="references">
              <div style={{ padding: '8px 0' }}>
                <Annotation
                  info={DEMO_ANNOTATIONS}
                  activeKey={annotationKey}
                  onChange={setAnnotationKey}
                  onClick={(_e, item) => {
                    if (item?.url && item.url !== '#') {
                      Toast.info(`打开链接：${item.title}`);
                    }
                  }}
                  visible
                  motion={false}
                  className="embedded-container"
                  style={{ border: 'none', boxShadow: 'none' }}
                />
              </div>
            </TabPane>
            <TabPane tab="代码预览" itemKey="code">
              <div style={{ padding: '8px 0' }}>
                <CodeContent
                  codes={DEMO_CODES}
                  activeKey={codeActiveKey}
                  onChange={setCodeActiveKey}
                  style={{ border: 'none', boxShadow: 'none' }}
                />
              </div>
            </TabPane>
            <TabPane tab="文档说明" itemKey="files">
              <div style={{ padding: '8px 0' }}>
                <FileContent
                  files={DEMO_FILES}
                  activeKey={fileActiveKey}
                  onChange={setFileActiveKey}
                  style={{ border: 'none', boxShadow: 'none' }}
                />
              </div>
            </TabPane>
          </Tabs>
        </Container>
      )}
    </div>
  );
}
