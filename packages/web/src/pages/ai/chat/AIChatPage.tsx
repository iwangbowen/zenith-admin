import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { AIChatDialogue, AIChatInput, Typography, Button, RadioGroup, Radio, Select, Tag, Toast, Tooltip, Spin, TextArea, Dropdown, Input, Modal } from '@douyinfe/semi-ui';
import type { Message as AIChatMessage } from '@douyinfe/semi-ui/lib/es/aiChatDialogue';
import type { RenderActionProps } from '@douyinfe/semi-ui/lib/es/aiChatDialogue/interface';
import { MessageSquarePlus, Trash2, AlignLeft, AlignJustify, FileText, Settings, MoreHorizontal, Pencil, Pin, PinOff } from 'lucide-react';
import { MasterDetailLayout } from '@/components/MasterDetailLayout';
import { NavListPanel, NavListItem } from '@/components/NavListPanel';
import { useAuth } from '@/hooks/useAuth';
import { PDFPreviewPanel } from './PDFPreviewPanel';
import UserAiConfigModal from '../components/UserAiConfigModal';
import { request } from '@/utils/request';
import { TOKEN_KEY } from '@zenith/shared';
import { config } from '@/config';
import type { AiConversation, AiMessage, AiProviderConfig, UserAiConfig, SystemConfig } from '@zenith/shared';

const { Configure } = AIChatInput;
const { Title } = Typography;

type AIChatDialogueInstance = InstanceType<typeof AIChatDialogue>;

type Message = Omit<AIChatMessage, 'role' | 'content' | 'status' | 'createdAt'> & {
  id: string;
  role: 'system' | 'user' | 'assistant';
  content: NonNullable<AIChatMessage['content']>;
  createdAt: number;
  status?: 'completed' | 'in_progress' | 'failed';
};

interface MessageEditWidgetProps {
  readonly msgId: string;
  readonly defaultText: string;
  readonly onSubmit: (msgId: string, newText: string) => void;
  readonly onCancel: (msgId: string) => void;
}

function MessageEditWidget({ msgId, defaultText, onSubmit, onCancel }: MessageEditWidgetProps) {
  const [editText, setEditText] = React.useState(defaultText);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
      <TextArea
        autosize
        value={editText}
        onChange={(v) => setEditText(v)}
        style={{ fontSize: 14 }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            onSubmit(msgId, editText);
          }
        }}
      />
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button size="small" type="tertiary" onClick={() => onCancel(msgId)}>取消</Button>
        <Button
          size="small"
          type="primary"
          disabled={!editText.trim() || editText.trim() === defaultText.trim()}
          onClick={() => onSubmit(msgId, editText)}
        >
          重新发送
        </Button>
      </div>
    </div>
  );
}

const AI_AVATAR = 'https://lf3-static.bytednsdoc.com/obj/eden-cn/ptlz_zlp/ljhwZthlaukjlkulzlp/other/logo.png';

const DEFAULT_MODEL_OPTIONS: { value: string; label: string; source: 'system' | 'user' }[] = [];

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
    // 映射 DB feedback 字段到 Semi AIChatDialogue 的 like/dislike 显示状态
    ...(m.feedback === 1  && { like: true }),
    ...(m.feedback === -1 && { dislike: true }),
  };
}

function makePdfUploadUpdater(msgId: string, updatedContent: NonNullable<AIChatMessage['content']>) {
  return (prev: Message[]) => prev.map((m) => (m.id === msgId ? { ...m, content: updatedContent } : m));
}

function renderPdfCardItem(item: Record<string, unknown>, onOpen: (file: File) => void) {
  return (
    <PdfFileCard
      filename={item.filename as string}
      size={item.size as string}
      url={item.url as string | null | undefined}
      uploading={item.uploading as boolean | undefined}
      onClick={() => {
        const fi = item.fileInstance;
        if (fi instanceof File) onOpen(fi);
      }}
    />
  );
}

interface PdfFileCardProps {
  readonly filename: string;
  readonly size: string;
  readonly onClick?: () => void;
  readonly url?: string | null;
  readonly uploading?: boolean;
}

function PdfFileCard({ filename, size, onClick, url, uploading }: PdfFileCardProps) {
  let sizeLabel = `PDF · ${size}`;
  let sizeColor = 'var(--semi-color-text-2)';
  if (uploading) {
    sizeLabel = '上传中…';
  } else if (url) {
    sizeLabel = `PDF · ${size} · 已上传`;
    sizeColor = 'var(--semi-color-success)';
  }
  const inner = (
    <>
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 6,
          background: 'var(--semi-color-danger-light-default)',
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
        <div style={{ fontSize: 12, color: sizeColor, marginTop: 2 }}>
          {sizeLabel}
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
  const [renameConvId, setRenameConvId] = useState<number | null>(null);
  const [renameText, setRenameText] = useState('');
  const [modelOptions, setModelOptions] = useState<{ value: string; label: string; source: 'system' | 'user' }[]>(DEFAULT_MODEL_OPTIONS);
  const userConfigsRef = useRef<UserAiConfig[]>([]);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [allowUserCustomKey, setAllowUserCustomKey] = useState(false);
  const [align, setAlign] = useState<'leftRight' | 'leftAlign'>('leftRight');
  const [mode, setMode] = useState<'bubble' | 'noBubble' | 'userBubble'>('bubble');
  const configureValuesRef = React.useRef<Record<string, unknown>>({ model: '' });
  const setConfigureValues = useCallback((v: Record<string, unknown>) => { configureValuesRef.current = v; }, []);
  const dialogueRef = useRef<AIChatDialogueInstance | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfFileUrl, setPdfFileUrl] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const providersRef = useRef<AiProviderConfig[]>([]);

  // Load AI provider configs + user configs as model options
  const loadModelOptions = useCallback((providers: AiProviderConfig[], userConfigs: UserAiConfig[]) => {
    const sysOptions = providers.map((p) => ({ value: String(p.id), label: `${p.name} (${p.model})`, source: 'system' as const }));
    const userOptions = userConfigs
      .filter((uc) => uc.isEnabled && uc.model)
      .map((uc) => ({ value: `user-${uc.id}`, label: `${uc.name ?? '我的配置'} (${uc.model})`, source: 'user' as const }));
    const options = [...userOptions, ...sysOptions];
    setModelOptions(options);
    if (options.length > 0) {
      setConfigureValues({ ...configureValuesRef.current, model: options[0].value });
    }
  }, [setConfigureValues]);

  useEffect(() => {
    void (async () => {
      const [configsRes, providersRes] = await Promise.all([
        request.get<{ list: SystemConfig[] }>('/api/system-configs?keys=ai_allow_user_custom_key').catch(() => null),
        request.get<AiProviderConfig[]>('/api/ai/providers').catch(() => ({ data: [] as AiProviderConfig[] })),
      ]);
      const allowCustom = configsRes?.data?.list?.find((c) => c.configKey === 'ai_allow_user_custom_key')?.configValue === 'true';
      setAllowUserCustomKey(allowCustom);
      const providers = providersRes?.data ?? [];
      providersRef.current = providers;
      let userConfigs: UserAiConfig[] = [];
      if (allowCustom) {
        userConfigs = await request.get<UserAiConfig[]>('/api/ai/user-configs').then((r) => r.data ?? []).catch(() => []);
      }
      userConfigsRef.current = userConfigs;
      loadModelOptions(providers, userConfigs);
    })();
  }, [loadModelOptions]);

  // Load conversations on mount
  useEffect(() => {
    setConvsLoading(true);
    void request.get<AiConversation[]>('/api/ai/conversations').then((res) => {
      const list = res.data ?? [];
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
    void request.get<AiMessage[]>(`/api/ai/conversations/${activeConvId}/messages`).then((res) => {
      setMessages((res.data ?? []).map(convertApiMessage));
    }).catch(() => {}).finally(() => setMsgsLoading(false));
  }, [activeConvId]);

  // AIChatInput 内置上传按钮的拦截处理：选择 PDF 后上传到系统文件服务
  const handleBeforeUpload = useCallback(
    (fileInfo: { file: { fileInstance?: File; name: string; size?: string } }) => {
      const rawFile = fileInfo.file?.fileInstance;
      if (rawFile) {
        setPdfFileUrl(null);
        const msgId = nextMsgId();
        const fileMsg: Message = {
          id: msgId,
          role: 'user',
          content: [
            {
              type: 'pdf_card',
              filename: rawFile.name,
              size: formatFileSize(rawFile.size),
              fileInstance: rawFile,
              uploading: true,
            },
          ] as NonNullable<AIChatMessage['content']>,
          createdAt: Date.now(),
          status: 'completed',
        };
        setMessages((prev) => [...prev, fileMsg]);
        const formData = new FormData();
        formData.append('file', rawFile);
        void (async () => {
          const res = await request.post<{ url: string }>('/api/files/upload-one', formData);
          const url = res.data?.url ?? null;
          setPdfFileUrl(url);
          const updatedContent = [
            { type: 'pdf_card', filename: rawFile.name, size: formatFileSize(rawFile.size), fileInstance: rawFile, uploading: false, url },
          ] as NonNullable<AIChatMessage['content']>;
          setMessages(makePdfUploadUpdater(msgId, updatedContent));
        })();
      }
      return false as const;
    },
    []
  );

  const dialogueRenderConfig = useMemo(() => ({
    // 隐藏分享按钮：从默认操作栏中排除 shareNode
    renderDialogueAction: (props: RenderActionProps) => {
      // DefaultActionNodeObj 没有 shareNode，分享按鈕在 defaultActions 列表里
      // 直接使用 defaultActionsObj，它不包含 share
      if (!props.defaultActionsObj) return null;
      const { copyNode, resetNode, likeNode, dislikeNode, moreNode } = props.defaultActionsObj;
      return <div className={props.className}>{copyNode}{resetNode}{likeNode}{dislikeNode}{moreNode}</div>;
    },
  }) satisfies { renderDialogueAction: (props: RenderActionProps) => React.ReactNode }, []);

  const renderDialogueContentItem = useMemo(() => ({
    pdf_card: (item: Record<string, unknown>) => renderPdfCardItem(item, setPdfFile),
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
      if (!text?.trim()) return;

      // 若当前没有会话，先自动创建一个
      let convId = activeConvId;
      if (!convId) {
        try {
          const res = await request.post<AiConversation>('/api/ai/conversations', { title: '新对话' });
          const newConv = res.data;
          convId = newConv.id;
          setConversations((prev) => [newConv, ...prev]);
          setActiveConvId(convId);
          setMessages([]);
        } catch {
          Toast.error('创建对话失败');
          return;
        }
      }

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
          `${config.apiBaseUrl}/api/ai/conversations/${convId}/chat`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify(
              (() => {
                const selectedModel = configureValuesRef.current.model as string | undefined ?? '';
                if (selectedModel.startsWith('user-')) {
                  const userConfigId = Number.parseInt(selectedModel.replace('user-', ''), 10);
                  return { message: text, configSource: 'user', configId: userConfigId };
                }
                return { message: text, configSource: 'system', configId: Number(selectedModel) || undefined };
              })()
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
                } else if (eventType === 'saved') {
                  // 服务端保存完成，返回了真实的数据库消息 ID，更新本地消息 ID
                  const dbId = (parsed.assistantMsgId as number | undefined);
                  if (dbId) {
                    setMessages((prev) =>
                      prev.map((m) => (m.id === assistantMsgId ? { ...m, id: `api-${dbId}` } : m))
                    );
                  }
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

  /** 重新生成：删除最后一条 assistant 消息，找到前一条 user 消息重发 */
  const handleRegenerate = useCallback(async (msg: Message) => {
    if (generating || !activeConvId) return;
    const dbId = String(msg.id).startsWith('api-') ? Number(String(msg.id).replace('api-', '')) : null;

    // 从当前 messages 里找到这条 assistant 的前一条 user 消息
    const curMessages = messages;
    const idx = curMessages.findIndex((m) => m.id === msg.id);
    const prevUserMsg = idx > 0 ? curMessages.slice(0, idx).reverse().find((m) => m.role === 'user') : null;
    const userText = typeof prevUserMsg?.content === 'string' ? prevUserMsg.content : null;
    if (!userText) { Toast.warning('找不到对应的用户消息，无法重新生成'); return; }

    // 乐观删除 UI 里的 assistant 消息（Semi 的 resetMessage 已处理，但这里确保 DB 同步）
    if (dbId) {
      await request.delete(`/api/ai/conversations/${activeConvId}/messages/${dbId}`).catch(() => {});
    }
    // 去掉最后这条 assistant 消息后重发
    setMessages((prev) => prev.filter((m) => m.id !== msg.id));
    void handleMessageSend({ text: userText });
  }, [generating, activeConvId, messages, handleMessageSend]);

  /** 编辑并重发：修改用户消息内容，删除其后的所有消息，重新生成 */
  const handleEditAndResend = useCallback(async (msgId: string, newText: string) => {
    if (!newText.trim() || !activeConvId) return;
    const curMessages = messages;
    const idx = curMessages.findIndex((m) => m.id === msgId);
    if (idx === -1) return;

    // 删除 DB 里该 user 消息之后的所有 assistant 消息
    const afterMsgs = curMessages.slice(idx + 1);
    for (const m of afterMsgs) {
      const dbId = String(m.id).startsWith('api-') ? Number(String(m.id).replace('api-', '')) : null;
      if (dbId && m.role === 'assistant') {
        await request.delete(`/api/ai/conversations/${activeConvId}/messages/${dbId}`).catch(() => {});
      }
    }
    // 截断 UI 中该消息及其后所有
    setMessages((prev) => prev.slice(0, idx));
    void handleMessageSend({ text: newText });
  }, [activeConvId, messages, handleMessageSend]);

  const handleEditCancel = useCallback((msgId: string) => {
    setMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, editing: false } : m));
  }, []);

  /** messageEditRender：编辑模式下渲染受控文本框 */
  const renderMessageEdit = useCallback(<T extends { inputContents?: Array<{ type: string; text?: string }> }>(props: T) => {
    const defaultText = props.inputContents?.find((c) => c.type === 'text')?.text ?? '';
    const editingMsg = messages.find((m) => (m as Record<string, unknown>).editing && m.role === 'user');
    if (!editingMsg) return null;
    return (
      <MessageEditWidget
        msgId={editingMsg.id}
        defaultText={defaultText}
        onSubmit={handleEditAndResend}
        onCancel={handleEditCancel}
      />
    );
  }, [messages, handleEditAndResend, handleEditCancel]);

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

  const handleRenameConv = async () => {
    if (!renameConvId || !renameText.trim()) return;
    try {
      await request.put(`/api/ai/conversations/${renameConvId}/rename`, { title: renameText.trim() });
      setConversations((prev) => prev.map((c) => c.id === renameConvId ? { ...c, title: renameText.trim() } : c));
      setRenameConvId(null);
    } catch {
      Toast.error('重命名失败');
    }
  };

  const handleTogglePin = async (id: number) => {
    try {
      const res = await request.put<{ isPinned: boolean }>(`/api/ai/conversations/${id}/pin`, {});
      const pinned = res.data?.isPinned ?? false;
      setConversations((prev) => {
        const updated = prev.map((c) => c.id === id ? { ...c, isPinned: pinned } : c);
        // 重新排序：置顶在前
        return [...updated.filter((c) => c.isPinned), ...updated.filter((c) => !c.isPinned)];
      });
      Toast.success(pinned ? '已置顶' : '已取消置顶');
    } catch {
      Toast.error('操作失败');
    }
  };

  const activeConv = conversations.find((c) => c.id === activeConvId);

  return (
    <>
    <MasterDetailLayout
      defaultSize={220}
      minSize={180}
      maxSize={400}
      persistKey="ai-chat"
      showDetail={activeConvId !== null}
      onBack={() => setActiveConvId(null)}
      master={(
        <NavListPanel
          headerExtra={
            <Button
              theme="solid"
              type="primary"
              size="small"
              icon={<MessageSquarePlus size={14} />}
              onClick={() => void handleNewConversation()}
            >
              新建对话
            </Button>
          }
          loading={convsLoading}
          emptyText="暂无对话"
          dataSource={conversations}
          renderItem={(conv) => (
            <NavListItem
              key={conv.id}
              active={activeConvId === conv.id}
              onClick={() => setActiveConvId(conv.id)}
              primary={conv.isPinned ? <><Pin size={11} style={{ verticalAlign: -1, marginRight: 3, color: 'var(--semi-color-primary)' }} />{conv.title}</> : conv.title}
              extraAlwaysVisible={false}
              extra={
                <Dropdown
                  trigger="click"
                  position="bottomRight"
                  clickToHide
                  render={
                    <Dropdown.Menu>
                      <Dropdown.Item onClick={(e) => { (e as React.MouseEvent).stopPropagation(); setRenameText(conv.title); setRenameConvId(conv.id); }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Pencil size={13} />重命名</span>
                      </Dropdown.Item>
                      <Dropdown.Item onClick={(e) => { (e as React.MouseEvent).stopPropagation(); void handleTogglePin(conv.id); }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {conv.isPinned ? <PinOff size={13} /> : <Pin size={13} />}
                          {conv.isPinned ? '取消置顶' : '置顶'}
                        </span>
                      </Dropdown.Item>
                      <Dropdown.Divider />
                      <Dropdown.Item type="danger" onClick={(e) => { (e as React.MouseEvent).stopPropagation(); Modal.confirm({ title: '确定要删除这个会话吗？', okButtonProps: { type: 'danger', theme: 'solid' }, onOk: () => handleDeleteConversation(conv.id) }); }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Trash2 size={13} />删除</span>
                      </Dropdown.Item>
                    </Dropdown.Menu>
                  }
                >
                  <Button
                    theme="borderless"
                    size="small"
                    icon={<MoreHorizontal size={13} />}
                    onClick={(e) => e.stopPropagation()}
                  />
                </Dropdown>
              }
            />
          )}
        />
      )}
      detail={(
        <>
          <MasterDetailLayout.Header
            extra={
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {pdfFile && (
                  <Tooltip content={pdfFileUrl ? '点击关闭预览（已上传）' : '点击关闭预览（上传中…）'}>
                    <Button
                      theme="solid"
                      type="primary"
                      size="small"
                      icon={<FileText size={13} />}
                      onClick={() => { setPdfFile(null); setPdfFileUrl(null); }}
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
                {allowUserCustomKey && (
                  <Tooltip content="我的 AI 配置">
                    <Button
                      theme="borderless"
                      size="small"
                      icon={<Settings size={14} />}
                      onClick={() => setSettingsVisible(true)}
                    />
                  </Tooltip>
                )}
              </div>
            }
          >
            <Title heading={6} style={{ margin: 0 }}>
              {activeConv?.title ?? '智能对话'}
            </Title>
          </MasterDetailLayout.Header>
          <MasterDetailLayout.Body scroll="hidden">
            <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
              {/* 聊天区域 */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
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
                      hints={[]}
                      align={align}
                      mode={mode}
                      onMessageCopy={() => { /* Semi 内置已弹 Toast，此处不重复 */ }}
                      onMessageGoodFeedback={(msg) => {
                        if (!msg) return;
                        const dbId = String(msg.id).startsWith('api-') ? Number(String(msg.id).replace('api-', '')) : null;
                        if (!dbId || !activeConvId) { Toast.success('感谢您的正向反馈'); return; }
                        void request.put(`/api/ai/conversations/${activeConvId}/messages/${dbId}/feedback`, { feedback: 1 })
                          .then(() => Toast.success('感谢您的正向反馈'));
                      }}
                      onMessageBadFeedback={(msg) => {
                        if (!msg) return;
                        const dbId = String(msg.id).startsWith('api-') ? Number(String(msg.id).replace('api-', '')) : null;
                        if (!dbId || !activeConvId) { Toast.info('感谢您的反馈，我们会持续改进'); return; }
                        void request.put(`/api/ai/conversations/${activeConvId}/messages/${dbId}/feedback`, { feedback: -1 })
                          .then(() => Toast.info('感谢您的反馈，我们会持续改进'));
                      }}
                      messageEditRender={renderMessageEdit}
                      onMessageDelete={(msg) => {
                        if (!msg || !activeConvId) return;
                        const dbId = String(msg.id).startsWith('api-') ? Number(String(msg.id).replace('api-', '')) : null;
                        // Semi 已在 UI 上删除该消息（onChatsChange）；后台级联删除该消息及之后所有消息
                        if (dbId) {
                          void request.delete(`/api/ai/conversations/${activeConvId}/messages/${dbId}/cascade`).catch(() => {});
                        }
                      }}
                      onMessageReset={(msg) => msg && !generating && void handleRegenerate(msg as Message)}
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
                    placeholder="向 AI 提问，或点击下方回形针上传 PDF..."
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
                          renderOptionItem={(renderProps: {
                            value: string;
                            label: React.ReactNode;
                            style?: React.CSSProperties;
                            className?: string;
                            onMouseEnter?: React.MouseEventHandler;
                            onClick?: React.MouseEventHandler;
                          }) => {
                            const isUser = renderProps.value === 'user';
                            return (
                              <div
                                role="menuitem"
                                tabIndex={0}
                                style={{ ...renderProps.style, display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px' }}
                                className={renderProps.className}
                                onMouseEnter={renderProps.onMouseEnter}
                                onClick={renderProps.onClick}
                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') renderProps.onClick?.(e as unknown as React.MouseEvent); }}
                              >
                                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{renderProps.label}</span>
                                <Tag color={isUser ? 'violet' : 'blue'} size="small" style={{ flexShrink: 0 }}>
                                  {isUser ? '我的' : '系统'}
                                </Tag>
                              </div>
                            );
                          }}
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
          </MasterDetailLayout.Body>
        </>
      )}
    />
    {allowUserCustomKey && (
      <UserAiConfigModal
        visible={settingsVisible}
        onClose={() => setSettingsVisible(false)}
        onSaved={() => {
          void request.get<UserAiConfig[]>('/api/ai/user-configs').then((r) => {
            userConfigsRef.current = r.data ?? [];
            loadModelOptions(providersRef.current, r.data ?? []);
          }).catch(() => {});
        }}
      />
    )}
    <Modal
      title="重命名会话"
      visible={renameConvId !== null}
      onOk={() => void handleRenameConv()}
      onCancel={() => setRenameConvId(null)}
      confirmLoading={false}
      closeOnEsc
      width={360}
    >
      <Input
        value={renameText}
        onChange={(v) => setRenameText(v)}
        placeholder="请输入新名称"
        maxLength={200}
        showClear
        onEnterPress={() => void handleRenameConv()}
        autoFocus
      />
    </Modal>
    </>
  );
}
