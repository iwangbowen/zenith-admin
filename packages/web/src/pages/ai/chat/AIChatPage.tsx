import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { AIChatDialogue, AIChatInput, Typography, Button, RadioGroup, Radio, Select, Toast, List as SemiList, Tooltip, Spin } from '@douyinfe/semi-ui';
import type { Message as AIChatMessage } from '@douyinfe/semi-ui/lib/es/aiChatDialogue';
import { MessageSquarePlus, Trash2, Globe, AlignLeft, AlignJustify, Bot, Wrench, FileText, Settings } from 'lucide-react';
import { MasterDetailLayout } from '@/components/MasterDetailLayout';
import { useAuth } from '@/hooks/useAuth';
import { PDFPreviewPanel } from './PDFPreviewPanel';
import UserAiConfigModal from '../components/UserAiConfigModal';
import { request } from '@/utils/request';
import { TOKEN_KEY } from '@zenith/shared';
import { config } from '@/config';
import type { AiConversation, AiMessage, AiProviderConfig, UserAiConfig } from '@zenith/shared';

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

const AI_AVATAR = 'https://lf3-static.bytednsdoc.com/obj/eden-cn/ptlz_zlp/ljhwZthlaukjlkulzlp/other/logo.png';

const HINTS = [
  '如何新增一个 CRUD 模块？',
  '如何配置角色权限？',
  '如何查看操作日志？',
  '如何设置定时任务？',
];

const DEFAULT_MODEL_OPTIONS: { value: string; label: string }[] = [];

const THINK_MODE_OPTIONS = [
  { label: '极速', value: 'fast' },
  { label: '思考', value: 'think' },
  { label: '超能', value: 'super' },
];

let msgIdCounter = 1000;
function nextMsgId() {
  return `msg-${++msgIdCounter}`;
}

function truncateName(name: string, max = 12) {
  return name.length > max ? `${name.slice(0, max)}…` : name;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function convertApiMessage(m: AiMessage): Message {
  return {
    id: `api-${m.id}`,
    role: m.role,
    content: m.content,
    createdAt: new Date(m.createdAt).getTime(),
    status: 'completed',
  };
}

interface PdfFileCardProps {
  readonly filename: string;
  readonly size: string;
  readonly onClick?: () => void;
}

function PdfFileCard({ filename, size, onClick }: PdfFileCardProps) {
  const inner = (
    <>
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 6,
          background: '#ff4d4f22',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <FileText size={20} color="#ff4d4f" />
      </div>
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: 'var(--semi-color-text-0)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: 160,
          }}
          title={filename}
        >
          {filename}
        </div>
        <div style={{ fontSize: 12, color: 'var(--semi-color-text-2)', marginTop: 2 }}>
          PDF · {size}
        </div>
      </div>
    </>
  );
  const cardStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 14px',
    borderRadius: 10,
    background: 'var(--semi-color-bg-2)',
    border: '1px solid var(--semi-color-border)',
    maxWidth: 260,
    userSelect: 'none',
    textAlign: 'left',
  };
  if (onClick) {
    return (
      <button type="button" onClick={onClick} style={{ ...cardStyle, cursor: 'pointer' }}>
        {inner}
      </button>
    );
  }
  return <div style={cardStyle}>{inner}</div>;
}

export default function AIChatPage() {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<AiConversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [generating, setGenerating] = useState(false);
  const [convsLoading, setConvsLoading] = useState(false);
  const [msgsLoading, setMsgsLoading] = useState(false);
  const [modelOptions, setModelOptions] = useState<{ value: string; label: string }[]>(DEFAULT_MODEL_OPTIONS);
  const userConfigRef = useRef<UserAiConfig | null>(null);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [align, setAlign] = useState<'leftRight' | 'leftAlign'>('leftRight');
  const [mode, setMode] = useState<'bubble' | 'noBubble' | 'userBubble'>('bubble');
  const configureValuesRef = React.useRef<Record<string, unknown>>({
    model: '',
    webSearch: false,
    thinkMode: 'fast',
  });
  const setConfigureValues = useCallback((v: Record<string, unknown>) => { configureValuesRef.current = v; }, []);
  const dialogueRef = useRef<AIChatDialogueInstance | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Load AI provider configs + user config as model options
  const loadModelOptions = useCallback((providers: AiProviderConfig[], uc: UserAiConfig | null) => {
    const sysOptions = providers.map((p) => ({ value: String(p.id), label: `${p.name} (${p.model})` }));
    const userOption =
      uc?.isEnabled && uc.model
        ? [{ value: 'user', label: `我的配置 (${uc.model})` }]
        : [];
    const options = [...userOption, ...sysOptions];
    setModelOptions(options);
    if (options.length > 0) {
      setConfigureValues((prev) => ({ ...prev, model: options[0].value }));
    }
  }, [setConfigureValues]);

  useEffect(() => {
    void Promise.all([
      request.get<{ list: AiProviderConfig[] }>('/api/ai/providers').then((r) => r.data?.list ?? []),
      request.get<UserAiConfig | null>('/api/ai/user-config').then((r) => r.data ?? null).catch(() => null),
    ]).then(([providers, uc]) => {
      userConfigRef.current = uc;
      loadModelOptions(providers, uc);
    }).catch(() => {});
  }, [loadModelOptions]);

  // Load conversations on mount
  useEffect(() => {
    setConvsLoading(true);
    void request.get<{ list: AiConversation[] }>('/api/ai/conversations').then((res) => {
      const list = res.data?.list ?? [];
      setConversations(list);
      if (list.length > 0) setActiveConvId(list[0].id);
    }).catch(() => {}).finally(() => setConvsLoading(false));
  }, []);

  // Load messages when active conversation changes
  useEffect(() => {
    if (!activeConvId) {
      setMessages([]);
      return;
    }
    setMsgsLoading(true);
    void request.get<{ list: AiMessage[] }>(`/api/ai/conversations/${activeConvId}/messages`).then((res) => {
      setMessages((res.data?.list ?? []).map(convertApiMessage));
    }).catch(() => {}).finally(() => setMsgsLoading(false));
  }, [activeConvId]);

  // AIChatInput 内置上传按钮的拦截处理：选择 PDF 后直接开启预览，不实际上传
  const handleBeforeUpload = useCallback(
    (fileInfo: { file: { fileInstance?: File; name: string; size?: string } }) => {
      const rawFile = fileInfo.file?.fileInstance;
      if (rawFile) {
        setPdfFile(rawFile);
        const fileMsg: Message = {
          id: nextMsgId(),
          role: 'user',
          content: [
            {
              type: 'pdf_card',
              filename: rawFile.name,
              size: formatFileSize(rawFile.size),
              fileInstance: rawFile,
            },
          ] as NonNullable<AIChatMessage['content']>,
          createdAt: Date.now(),
          status: 'completed',
        };
        setMessages((prev) => [...prev, fileMsg]);
      }
      return false as const;
    },
    []
  );

  // eslint-disable-next-line react/no-unstable-nested-components
  const dialogueRenderConfig = useMemo(() => ({}), []);

  const renderDialogueContentItem = useMemo(() => ({
    // eslint-disable-next-line react/no-unstable-nested-components
    pdf_card: (item: Record<string, unknown>) => (
      <PdfFileCard
        filename={item.filename as string}
        size={item.size as string}
        onClick={() => {
          const fi = item.fileInstance;
          if (fi instanceof File) setPdfFile(fi);
        }}
      />
    ),
  }), [setPdfFile]);

  const roleConfig = {
    user: {
      name: user?.nickname || user?.username || '我',
      avatar: user?.avatar || undefined,
    },
    assistant: { name: 'AI 助手', avatar: AI_AVATAR },
    system: { name: '系统', avatar: AI_AVATAR },
  };

  const handleMessageSend = useCallback(
    async (content: { inputContents?: { type: string; text?: string }[]; text?: string }) => {
      const text = content.text ?? content.inputContents?.find((c) => c.type === 'text')?.text;
      if (!text?.trim() || !activeConvId) return;

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

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setGenerating(true);

      const abortController = new AbortController();
      abortRef.current = abortController;
      const token = localStorage.getItem(TOKEN_KEY);

      try {
        const response = await fetch(
          `${config.apiBaseUrl}/api/ai/conversations/${activeConvId}/chat`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify(
              configureValuesRef.current.model === 'user'
                ? { message: text, configSource: 'user' }
                : { message: text, configSource: 'system', configId: Number(configureValuesRef.current.model) || undefined }
            ),
            signal: abortController.signal,
          }
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response body');

        const decoder = new TextDecoder();
        let buffer = '';
        let accContent = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          let eventType = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) {
              eventType = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
              const dataStr = line.slice(6).trim();
              if (!dataStr) continue;
              try {
                const parsed = JSON.parse(dataStr) as Record<string, unknown>;
                if (eventType === 'delta' && parsed.content) {
                  accContent += (parsed.content as string | undefined) ?? '';
                  setMessages((prev) =>
                    prev.map((m) => (m.id === assistantMsgId ? { ...m, content: accContent } : m))
                  );
                } else if (eventType === 'done') {
                  setMessages((prev) =>
                    prev.map((m) => (m.id === assistantMsgId ? { ...m, status: 'completed' } : m))
                  );
                  // Refresh conversations to get updated title
                  void request.get<{ list: AiConversation[] }>('/api/ai/conversations').then((r) => {
                    setConversations(r.data?.list ?? []);
                  });
                } else if (eventType === 'error') {
                  Toast.error((parsed.error as string | undefined) ?? 'AI 服务出错');
                  setMessages((prev) =>
                    prev.map((m) => (m.id === assistantMsgId ? { ...m, status: 'failed' } : m))
                  );
                }
              } catch {
                // ignore JSON parse errors
              }
            }
          }
        }
      } catch (err) {
        if ((err as Error)?.name !== 'AbortError') {
          Toast.error('消息发送失败');
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantMsgId ? { ...m, status: 'failed' } : m))
          );
        }
      } finally {
        setGenerating(false);
        abortRef.current = null;
        setTimeout(() => dialogueRef.current?.scrollToBottom(true), 100);
      }
    },
    [activeConvId]
  );

  const handleStopGenerate = useCallback(() => {
    abortRef.current?.abort();
    setGenerating(false);
    setMessages((prev) =>
      prev.map((m) => (m.status === 'in_progress' ? { ...m, status: 'completed' } : m))
    );
  }, []);

  const handleNewConversation = async () => {
    try {
      const res = await request.post<AiConversation>('/api/ai/conversations', { title: '新对话' });
      const newConv = res.data;
      setConversations((prev) => [newConv, ...prev]);
      setActiveConvId(newConv.id);
      setMessages([]);
    } catch {
      Toast.error('创建对话失败');
    }
  };

  const handleDeleteConversation = async (id: number) => {
    try {
      await request.delete(`/api/ai/conversations/${id}`);
      setConversations((prev) => {
        const remaining = prev.filter((c) => c.id !== id);
        if (activeConvId === id) {
          setActiveConvId(remaining[0]?.id ?? null);
          setMessages([]);
        }
        return remaining;
      });
    } catch {
      Toast.error('删除对话失败');
    }
  };

  const handleHintClick = useCallback(
    (hint: string) => {
      void handleMessageSend({ text: hint });
    },
    [handleMessageSend]
  );

  const activeConv = conversations.find((c) => c.id === activeConvId);

  return (
    <>
    <MasterDetailLayout
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
              onClick={() => void handleNewConversation()}
            >
              新建对话
            </Button>
          </div>
          <MasterDetailLayout.Body style={{ padding: '4px 8px' }}>
            {convsLoading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}>
                <Spin />
              </div>
            ) : (
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
                            void handleDeleteConversation(conv.id);
                          }}
                        />
                      )}
                    />
                  );
                }}
              />
            )}
          </MasterDetailLayout.Body>
        </>
      )}
      detail={(
        <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
          {/* 聊天区域 */}
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
              <Title heading={6} style={{ margin: 0 }}>
                {activeConv?.title ?? '智能对话'}
              </Title>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {pdfFile && (
                  <Tooltip content="点击关闭预览">
                    <Button
                      theme="solid"
                      type="primary"
                      size="small"
                      icon={<FileText size={13} />}
                      onClick={() => setPdfFile(null)}
                    >
                      {truncateName(pdfFile.name)}
                    </Button>
                  </Tooltip>
                )}
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
                <Tooltip content="我的 AI 配置">
                  <Button
                    theme="borderless"
                    size="small"
                    icon={<Settings size={14} />}
                    onClick={() => setSettingsVisible(true)}
                  />
                </Tooltip>
              </div>
            </div>

            {/* 对话内容 */}
            <div style={{ flex: 1, overflow: 'hidden' }}>
              {msgsLoading ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                  <Spin size="large" />
                </div>
              ) : (
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
                  onMessageReset={() => Toast.info('重新生成功能暂不支持')}
                  onHintClick={handleHintClick}
                  onFileClick={(fileItem) => {
                    const fi = fileItem?.fileInstance;
                    if (fi instanceof File) setPdfFile(fi);
                  }}
                  dialogueRenderConfig={dialogueRenderConfig}
                  renderDialogueContentItem={renderDialogueContentItem}
                  onChatsChange={(chats) => {
                    setMessages(chats as Message[]);
                  }}
                  style={{ height: '100%' }}
                />
              )}
            </div>

            {/* 输入框 */}
            <div style={{ padding: '12px 20px', borderTop: '1px solid var(--semi-color-border)', background: 'var(--semi-color-bg-1)', flexShrink: 0 }}>
              <AIChatInput
                placeholder="向 AI 提问，或点击下方回形针上传 PDF 预览..."
                generating={generating}
                onMessageSend={(c) => void handleMessageSend(c)}
                onStopGenerate={handleStopGenerate}
                onConfigureChange={(value) => setConfigureValues(value)}
                uploadProps={{
                  action: '',
                  accept: '.pdf,application/pdf',
                  beforeUpload: handleBeforeUpload,
                }}
                renderConfigureArea={() => (
                  <Configure>
                    <Configure.Select
                      key={modelOptions[0]?.value ?? 'default'}
                      field="model"
                      initValue={modelOptions[0]?.value ?? ''}
                      optionList={modelOptions}
                      style={{ minWidth: 160 }}
                      placeholder="选择模型"
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
          </div>

          {/* PDF 预览面板（右侧） */}
          {pdfFile && (
            <PDFPreviewPanel
              file={pdfFile}
              onClose={() => setPdfFile(null)}
            />
          )}
        </div>
      )}
    />

    <UserAiConfigModal
      visible={settingsVisible}
      onClose={() => setSettingsVisible(false)}
      onSaved={(savedCfg) => {
        userConfigRef.current = savedCfg;
        void request.get<{ list: AiProviderConfig[] }>('/api/ai/providers').then((r) => {
          loadModelOptions(r.data?.list ?? [], savedCfg);
        }).catch(() => {});
      }}
    />
    </>
  );
}
