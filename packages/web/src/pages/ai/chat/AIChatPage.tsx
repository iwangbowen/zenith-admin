import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { AIChatDialogue, AIChatInput, Typography, Button, Form, RadioGroup, Radio, Select, Tag, Toast, Tooltip, Spin, TextArea, Dropdown, Input, Modal } from '@douyinfe/semi-ui';
import type { Message as AIChatMessage } from '@douyinfe/semi-ui/lib/es/aiChatDialogue';
import type { RenderActionProps } from '@douyinfe/semi-ui/lib/es/aiChatDialogue/interface';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { MessageSquarePlus, Trash2, AlignLeft, AlignJustify, Settings, MoreHorizontal, Pencil, Pin, PinOff, Archive, ArchiveRestore, Sparkles, Inbox, Download } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { MasterDetailLayout } from '@/components/MasterDetailLayout';
import { NavListPanel, NavListItem } from '@/components/NavListPanel';
import AppModal from '@/components/AppModal';
import { useAuth } from '@/hooks/useAuth';
import UserAiConfigModal from '../components/UserAiConfigModal';
import { request } from '@/utils/request';
import { TOKEN_KEY } from '@zenith/shared';
import { config } from '@/config';
import type { AiChatModel, AiConversation, AiMessage, AiPromptTemplate, UserAiConfig } from '@zenith/shared';
import { useAiChatModels } from '@/hooks/queries/ai-providers';
import { useAiAllowUserCustomKey, useAiUserConfigs, aiUserConfigKeys } from '@/hooks/queries/ai-user-config';
import { useAvailableAiPrompts, recordAiPromptUse } from '@/hooks/queries/ai-prompts';
import {
  aiConversationKeys,
  useInfiniteAiConversationList,
  useAiConversationMessages,
  useCreateAiConversation,
} from '@/hooks/queries/ai-conversations';
import { useDictItems } from '@/hooks/useDictItems';

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

const SUGGESTED_QUESTIONS = [
  '介绍一下你能做什么',
  '帮我写一封简短的请假邮件',
  '用一句话解释什么是 RBAC 权限模型',
  '把这段话翻译成英文：今天天气很好',
];

let msgIdCounter = 1000;
function nextMsgId() {
  return `msg-${++msgIdCounter}`;
}

/** 组装含思维链的 assistant 消息内容（Semi 内置 Reasoning 折叠面板 + output_text 正文） */
function buildAssistantContent(text: string, reasoning: string | null | undefined, reasoningDone: boolean): NonNullable<AIChatMessage['content']> {
  if (!reasoning) return text;
  return [
    {
      type: 'reasoning',
      status: reasoningDone ? 'completed' : 'in_progress',
      content: [{ type: 'reasoning_text', text: reasoning }],
    },
    { type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text }] },
  ] as NonNullable<AIChatMessage['content']>;
}

function convertApiMessage(m: AiMessage): Message {
  return {
    id: `api-${m.id}`,
    role: m.role,
    content: m.role === 'assistant' ? buildAssistantContent(m.content, m.reasoning, true) : m.content,
    // Semi 对数组型 content 的复制操作取 output_text
    ...(m.reasoning && { output_text: m.content }),
    createdAt: new Date(m.createdAt).getTime(),
    status: 'completed',
    // 映射 DB feedback 字段到 Semi AIChatDialogue 的 like/dislike 显示状态
    ...(m.feedback === 1  && { like: true }),
    ...(m.feedback === -1 && { dislike: true }),
  };
}

/** 提取提示词模板中的 {{变量}} 占位符（去重、保序） */
function extractPromptVariables(content: string): string[] {
  const matches = content.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g);
  const vars: string[] = [];
  for (const m of matches) {
    if (!vars.includes(m[1])) vars.push(m[1]);
  }
  return vars;
}

/** 会话侧栏行：分组标题 或 会话条目 */
type ConvRow = { kind: 'header'; label: string } | { kind: 'conv'; conv: AiConversation };

/** 按 置顶 / 今天 / 昨天 / 近 7 天 / 更早 分组 */
function groupConversations(list: AiConversation[]): ConvRow[] {
  const rows: ConvRow[] = [];
  const today = dayjs().startOf('day');
  let lastLabel: string | null = null;
  for (const conv of list) {
    let label: string;
    if (conv.isPinned) {
      label = '置顶';
    } else {
      const d = dayjs(conv.updatedAt);
      if (!d.isBefore(today)) label = '今天';
      else if (!d.isBefore(today.subtract(1, 'day'))) label = '昨天';
      else if (!d.isBefore(today.subtract(7, 'day'))) label = '近 7 天';
      else label = '更早';
    }
    if (label !== lastLabel) {
      rows.push({ kind: 'header', label });
      lastLabel = label;
    }
    rows.push({ kind: 'conv', conv });
  }
  return rows;
}

export default function AIChatPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [conversations, setConversations] = useState<AiConversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [generating, setGenerating] = useState(false);
  const [renameConvId, setRenameConvId] = useState<number | null>(null);
  const [renameText, setRenameText] = useState('');
  const [modelOptions, setModelOptions] = useState<{ value: string; label: string; source: 'system' | 'user' }[]>(DEFAULT_MODEL_OPTIONS);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [align, setAlign] = useState<'leftRight' | 'leftAlign'>('leftRight');
  const [mode, setMode] = useState<'bubble' | 'noBubble' | 'userBubble'>('bubble');
  const configureValuesRef = React.useRef<Record<string, unknown>>({ model: '' });
  const setConfigureValues = useCallback((v: Record<string, unknown>) => { configureValuesRef.current = v; }, []);
  const dialogueRef = useRef<AIChatDialogueInstance | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [debouncedSearchKeyword, setDebouncedSearchKeyword] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const didInitConvRef = useRef(false);
  const [dislikeMsgId, setDislikeMsgId] = useState<number | null>(null);
  const [varFillTemplate, setVarFillTemplate] = useState<AiPromptTemplate | null>(null);
  const varFormApi = useRef<FormApi | null>(null);
  const { items: dislikeReasons } = useDictItems('ai_dislike_reason');
  const allowUserCustomKeyQuery = useAiAllowUserCustomKey();
  const allowUserCustomKey = allowUserCustomKeyQuery.data ?? false;
  const chatModelsQuery = useAiChatModels();
  const userConfigsQuery = useAiUserConfigs(allowUserCustomKey);
  const promptTemplatesQuery = useAvailableAiPrompts();
  const promptTemplates = promptTemplatesQuery.data ?? [];
  const conversationsQuery = useInfiniteAiConversationList({
    keyword: debouncedSearchKeyword.trim() || undefined,
    archived: showArchived ? 'true' : undefined,
  });
  const messagesQuery = useAiConversationMessages(activeConvId);
  const createConversationMutation = useCreateAiConversation();

  // Load AI chat models + user configs as model options
  const loadModelOptions = useCallback((models: AiChatModel[], userConfigs: UserAiConfig[]) => {
    const sysOptions = models.map((m) => ({ value: String(m.id), label: `${m.name} (${m.model})`, source: 'system' as const }));
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
    loadModelOptions(chatModelsQuery.data ?? [], allowUserCustomKey ? (userConfigsQuery.data ?? []) : []);
  }, [allowUserCustomKey, loadModelOptions, chatModelsQuery.data, userConfigsQuery.data]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearchKeyword(searchKeyword), 300);
    return () => clearTimeout(t);
  }, [searchKeyword]);

  useEffect(() => {
    const pages = conversationsQuery.data?.pages;
    if (!pages) return;
    const list = pages.flat();
    setConversations(list);
    if (!didInitConvRef.current && list.length > 0) setActiveConvId(list[0].id);
    didInitConvRef.current = true;
  }, [conversationsQuery.data]);

  // 侧栏渲染行：置顶 / 今天 / 昨天 / 近 7 天 / 更早 分组
  const convRows = useMemo(() => groupConversations(conversations), [conversations]);

  useEffect(() => {
    if (!activeConvId) {
      setMessages([]);
      return;
    }
    const apiMessages = messagesQuery.data;
    if (!apiMessages) return;
    setMessages(apiMessages.map(convertApiMessage));
    const scrollTimer = setTimeout(() => dialogueRef.current?.scrollToBottom(false), 120);
    return () => clearTimeout(scrollTimer);
  }, [activeConvId, messagesQuery.data]);

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

  const roleConfig = {
    user: {
      name: user?.nickname || user?.username || '我',
      avatar: user?.avatar || undefined,
    },
    assistant: { name: 'AI 助手', avatar: AI_AVATAR },
    system: { name: '系统', avatar: AI_AVATAR },
  };

  const handleMessageSend = useCallback(
    async (
      content: { inputContents?: { type: string; text?: string }[]; text?: string },
      opts?: { regenerate?: boolean },
    ) => {
      const regenerate = opts?.regenerate ?? false;
      const text = content.text ?? content.inputContents?.find((c) => c.type === 'text')?.text;
      if (!regenerate && !text?.trim()) return;

      // 若当前没有会话，先自动创建一个（重新生成必然已有会话）
      let convId = activeConvId;
      if (!convId) {
        if (regenerate) return;
        try {
          const newConv = await createConversationMutation.mutateAsync({ title: '新对话' });
          convId = newConv.id;
          setConversations((prev) => [newConv, ...prev]);
          setActiveConvId(convId);
          setMessages([]);
        } catch {
          Toast.error('创建对话失败');
          return;
        }
      }

      const assistantMsgId = nextMsgId();
      const assistantMsg: Message = {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        createdAt: Date.now() + 1,
        status: 'in_progress',
      };

      if (regenerate) {
        // 重新生成：不追加 user 气泡，仅追加新的 assistant 占位
        setMessages((prev) => [...prev, assistantMsg]);
      } else {
        const userMsg: Message = {
          id: nextMsgId(),
          role: 'user',
          content: text!,
          createdAt: Date.now(),
          status: 'completed',
        };
        setMessages((prev) => [...prev, userMsg, assistantMsg]);
      }
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
                const base = regenerate ? { regenerate: true } : { message: text };
                if (selectedModel.startsWith('user-')) {
                  const userConfigId = Number.parseInt(selectedModel.replace('user-', ''), 10);
                  return { ...base, configSource: 'user', configId: userConfigId };
                }
                return { ...base, configSource: 'system', configId: Number(selectedModel) || undefined };
              })()
            ),
            signal: abortController.signal,
          }
        );

        if (!response.ok) {
          // 非流式错误（配额超限 / 校验失败等）：透出服务端 message
          const errBody = await response.json().catch(() => null) as { message?: string } | null;
          throw new Error(errBody?.message || `HTTP ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response body');

        const decoder = new TextDecoder();
        let buffer = '';
        let accContent = '';
        let accReasoning = '';

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
                  const nextContent = buildAssistantContent(accContent, accReasoning, true);
                  setMessages((prev) =>
                    prev.map((m) => (m.id === assistantMsgId ? { ...m, content: nextContent, output_text: accContent } : m))
                  );
                } else if (eventType === 'reasoning' && parsed.content) {
                  accReasoning += (parsed.content as string | undefined) ?? '';
                  // 正文尚未开始时思维链保持"思考中"展开态
                  const nextContent = buildAssistantContent(accContent, accReasoning, accContent.length > 0);
                  setMessages((prev) =>
                    prev.map((m) => (m.id === assistantMsgId ? { ...m, content: nextContent, output_text: accContent } : m))
                  );
                } else if (eventType === 'saved') {
                  // 服务端保存完成，返回了真实的数据库消息 ID，更新本地消息 ID
                  const dbId = (parsed.assistantMsgId as number | undefined);
                  if (dbId) {
                    setMessages((prev) =>
                      prev.map((m) => (m.id === assistantMsgId ? { ...m, id: `api-${dbId}` } : m))
                    );
                  }
                } else if (eventType === 'title') {
                  // 服务端 LLM 自动命名完成，同步会话标题
                  const title = parsed.title as string | undefined;
                  if (title && convId) {
                    setConversations((prev) => prev.map((c) => (c.id === convId ? { ...c, title } : c)));
                  }
                } else if (eventType === 'done') {
                  setMessages((prev) =>
                    prev.map((m) => (m.id === assistantMsgId ? { ...m, status: 'completed' } : m))
                  );
                  void queryClient.invalidateQueries({ queryKey: aiConversationKeys.lists });
                } else if (eventType === 'error') {
                  Toast.error((parsed.message as string | undefined) ?? 'AI 服务出错');
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
          Toast.error((err as Error)?.message || '消息发送失败');
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
    [activeConvId, createConversationMutation, queryClient]
  );

  const handleStopGenerate = useCallback(() => {
    abortRef.current?.abort();
    setGenerating(false);
    setMessages((prev) =>
      prev.map((m) => (m.status === 'in_progress' ? { ...m, status: 'completed' } : m))
    );
  }, []);

  /** 重新生成：删除最后一条 assistant 消息，服务端基于已有历史重答（不重复保存 user 消息） */
  const handleRegenerate = useCallback(async (msg: Message) => {
    if (generating || !activeConvId) return;
    if (msg.role !== 'assistant') return;
    const dbId = String(msg.id).startsWith('api-') ? Number(String(msg.id).replace('api-', '')) : null;

    // 确认这条 assistant 前面有 user 消息，否则无从重新生成
    const curMessages = messages;
    const idx = curMessages.findIndex((m) => m.id === msg.id);
    const prevUserMsg = idx > 0 ? curMessages.slice(0, idx).reverse().find((m) => m.role === 'user') : null;
    if (!prevUserMsg) { Toast.warning('找不到对应的用户消息，无法重新生成'); return; }

    // 先删除 DB 中旧的 assistant 回复，保证服务端历史末条为 user 消息
    if (dbId) {
      await request.delete(`/api/ai/conversations/${activeConvId}/messages/${dbId}`).catch(() => {});
    }
    // 去掉 UI 中这条 assistant 消息后以 regenerate 模式重发
    setMessages((prev) => prev.filter((m) => m.id !== msg.id));
    void handleMessageSend({ text: '' }, { regenerate: true });
  }, [generating, activeConvId, messages, handleMessageSend]);

  /** 编辑并重发：级联删除该 user 消息及其后所有消息，再以新内容重新发送 */
  const handleEditAndResend = useCallback(async (msgId: string, newText: string) => {
    if (!newText.trim() || !activeConvId) return;
    const curMessages = messages;
    const idx = curMessages.findIndex((m) => m.id === msgId);
    if (idx === -1) return;

    // 删除 DB 里该 user 消息及之后的所有消息（旧 user 消息也一并清除，避免重复）
    const dbId = String(msgId).startsWith('api-') ? Number(String(msgId).replace('api-', '')) : null;
    if (dbId) {
      await request.delete(`/api/ai/conversations/${activeConvId}/messages/${dbId}/cascade`).catch(() => {});
    } else {
      // 本地临时消息（尚未落库）：仅需清理其后已落库的 assistant 消息
      const afterFirstDbMsg = curMessages.slice(idx + 1).find((m) => String(m.id).startsWith('api-'));
      if (afterFirstDbMsg) {
        const afterDbId = Number(String(afterFirstDbMsg.id).replace('api-', ''));
        await request.delete(`/api/ai/conversations/${activeConvId}/messages/${afterDbId}/cascade`).catch(() => {});
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
      setShowArchived(false);
      const newConv = await createConversationMutation.mutateAsync({ title: '新对话' });
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
      void queryClient.invalidateQueries({ queryKey: aiConversationKeys.all });
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
      void queryClient.invalidateQueries({ queryKey: aiConversationKeys.all });
      setConversations((prev) => prev.map((c) => c.id === renameConvId ? { ...c, title: renameText.trim() } : c));
      setRenameConvId(null);
    } catch {
      Toast.error('重命名失败');
    }
  };

  const handleTogglePin = async (id: number) => {
    try {
      const res = await request.put<{ isPinned: boolean }>(`/api/ai/conversations/${id}/pin`, {});
      void queryClient.invalidateQueries({ queryKey: aiConversationKeys.all });
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

  const handleToggleArchive = async (id: number) => {
    try {
      const res = await request.put<{ isArchived: boolean }>(`/api/ai/conversations/${id}/archive`, {});
      void queryClient.invalidateQueries({ queryKey: aiConversationKeys.all });
      const archived = res.data?.isArchived ?? false;
      // 归档状态改变后，会话从当前视图（与归档状态相反）移除
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeConvId === id) { setActiveConvId(null); setMessages([]); }
      Toast.success(archived ? '已归档' : '已取消归档');
    } catch {
      Toast.error('操作失败');
    }
  };

  const handleApplyTemplate = async (content: string | null, templateId?: number) => {
    if (!activeConvId) { Toast.warning('请先选择或创建对话'); return; }
    try {
      await request.put(`/api/ai/conversations/${activeConvId}/system-prompt`, { systemPrompt: content });
      setConversations((prev) => prev.map((c) => c.id === activeConvId ? { ...c, systemPromptOverride: content } : c));
      Toast.success(content ? '已应用角色' : '已清除角色');
      // 使用统计（fire-and-forget）
      if (content && templateId) void recordAiPromptUse(templateId);
    } catch {
      Toast.error('操作失败');
    }
  };

  /** 选择模板：含 {{变量}} 时先弹出填充表单，否则直接应用 */
  const handleSelectTemplate = (t: AiPromptTemplate) => {
    if (!activeConvId) { Toast.warning('请先选择或创建对话'); return; }
    const vars = extractPromptVariables(t.content);
    if (vars.length === 0) {
      void handleApplyTemplate(t.content, t.id);
      return;
    }
    setVarFillTemplate(t);
  };

  const handleVarFillOk = async () => {
    const t = varFillTemplate;
    if (!t) return;
    let values: Record<string, string>;
    try {
      values = (await varFormApi.current?.validate()) as Record<string, string>;
    } catch {
      throw new Error('validation');
    }
    const filled = t.content.replaceAll(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, name: string) => values[name]?.trim() ?? '');
    await handleApplyTemplate(filled, t.id);
    setVarFillTemplate(null);
  };

  const handleExportConversation = (id: number, title: string, format: 'md' | 'json') => {
    void request.download(`/api/ai/conversations/${id}/export?format=${format}`, `${title || '对话'}.${format}`);
  };

  const submitDislikeReason = useCallback((reason: string | null) => {
    const dbId = dislikeMsgId;
    setDislikeMsgId(null);
    if (!dbId || !activeConvId || !reason) return;
    void request.put(`/api/ai/conversations/${activeConvId}/messages/${dbId}/feedback`, { feedback: -1, reason })
      .then(() => Toast.success('感谢反馈，已记录'))
      .catch(() => {});
  }, [dislikeMsgId, activeConvId]);

  const activeConv = conversations.find((c) => c.id === activeConvId);

  const renderConvActions = (conv: AiConversation) => (
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
          <Dropdown.Item onClick={(e) => { (e as React.MouseEvent).stopPropagation(); void handleToggleArchive(conv.id); }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {conv.isArchived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
              {conv.isArchived ? '取消归档' : '归档'}
            </span>
          </Dropdown.Item>
          <Dropdown.Item onClick={(e) => { (e as React.MouseEvent).stopPropagation(); handleExportConversation(conv.id, conv.title, 'md'); }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Download size={13} />导出 Markdown</span>
          </Dropdown.Item>
          <Dropdown.Item onClick={(e) => { (e as React.MouseEvent).stopPropagation(); handleExportConversation(conv.id, conv.title, 'json'); }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Download size={13} />导出 JSON</span>
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
  );

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
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Tooltip content={showArchived ? '返回对话列表' : '查看已归档'}>
                <Button
                  theme="borderless"
                  size="small"
                  type={showArchived ? 'primary' : 'tertiary'}
                  icon={showArchived ? <Inbox size={14} /> : <Archive size={14} />}
                  onClick={() => setShowArchived((v) => !v)}
                />
              </Tooltip>
              {!showArchived && (
                <Button
                  theme="solid"
                  type="primary"
                  size="small"
                  icon={<MessageSquarePlus size={14} />}
                  onClick={() => void handleNewConversation()}
                >
                  新建对话
                </Button>
              )}
            </div>
          }
          search={{ value: searchKeyword, onChange: setSearchKeyword, placeholder: '搜索对话 / 消息内容' }}
          loading={conversationsQuery.isFetching && !conversationsQuery.isFetchingNextPage}
          emptyText={showArchived ? '暂无已归档对话' : (searchKeyword ? '未找到匹配的对话' : '暂无对话')}
          dataSource={convRows}
          footer={conversationsQuery.hasNextPage ? (
            <Button
              theme="borderless"
              type="tertiary"
              size="small"
              block
              loading={conversationsQuery.isFetchingNextPage}
              onClick={() => void conversationsQuery.fetchNextPage()}
            >
              加载更多
            </Button>
          ) : undefined}
          renderItem={(row) => row.kind === 'header' ? (
            <div
              key={`header-${row.label}`}
              style={{
                padding: '8px 8px 4px',
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--semi-color-text-2)',
                userSelect: 'none',
              }}
            >
              {row.label}
            </div>
          ) : (
            <NavListItem
              key={row.conv.id}
              active={activeConvId === row.conv.id}
              onClick={() => setActiveConvId(row.conv.id)}
              primary={row.conv.isPinned ? <><Pin size={11} style={{ verticalAlign: -1, marginRight: 3, color: 'var(--semi-color-primary)' }} />{row.conv.title}</> : row.conv.title}
              extraAlwaysVisible={false}
              extra={renderConvActions(row.conv)}
            />
          )}
        />
      )}
      detail={(
        <>
          <MasterDetailLayout.Header
            extra={
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Dropdown
                  trigger="click"
                  position="bottomLeft"
                  clickToHide
                  render={
                    <Dropdown.Menu>
                      {promptTemplates.length === 0 && <Dropdown.Item disabled>暂无可用角色模板</Dropdown.Item>}
                      {promptTemplates.map((t) => (
                        <Dropdown.Item
                          key={t.id}
                          active={activeConv?.systemPromptOverride === t.content}
                          onClick={() => handleSelectTemplate(t)}
                        >
                          {t.name}
                        </Dropdown.Item>
                      ))}
                      {activeConv?.systemPromptOverride && (
                        <>
                          <Dropdown.Divider />
                          <Dropdown.Item type="danger" onClick={() => void handleApplyTemplate(null)}>清除角色</Dropdown.Item>
                        </>
                      )}
                    </Dropdown.Menu>
                  }
                >
                  <span style={{ display: 'inline-flex' }}>
                    <Tooltip content="选择角色 / 提示词模板（作用于当前对话）">
                      <Button
                        theme={activeConv?.systemPromptOverride ? 'light' : 'borderless'}
                        type="primary"
                        size="small"
                        icon={<Sparkles size={14} />}
                      >
                        {activeConv?.systemPromptOverride
                          ? (promptTemplates.find((t) => t.content === activeConv.systemPromptOverride)?.name ?? '自定义角色')
                          : '角色'}
                      </Button>
                    </Tooltip>
                  </span>
                </Dropdown>
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
                  {messagesQuery.isFetching ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                      <Spin size="large" />
                    </div>
                  ) : messages.length === 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 14, padding: 24, textAlign: 'center' }}>
                      <Sparkles size={40} color="var(--semi-color-primary)" />
                      <Title heading={4} style={{ margin: 0 }}>有什么可以帮您？</Title>
                      <Typography.Text type="tertiary">选择下面的问题快速开始，或在下方输入框直接提问</Typography.Text>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', maxWidth: 560, marginTop: 4 }}>
                        {SUGGESTED_QUESTIONS.map((q) => (
                          <Button key={q} theme="light" type="primary" onClick={() => void handleMessageSend({ text: q })}>{q}</Button>
                        ))}
                      </div>
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
                        void request.put(`/api/ai/conversations/${activeConvId}/messages/${dbId}/feedback`, { feedback: -1 }).catch(() => {});
                        setDislikeMsgId(dbId);
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
                      dialogueRenderConfig={dialogueRenderConfig}
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
                    placeholder="向 AI 提问，Enter 发送..."
                    generating={generating}
                    showUploadButton={false}
                    onMessageSend={(c) => void handleMessageSend(c)}
                    onStopGenerate={handleStopGenerate}
                    onConfigureChange={(value) => setConfigureValues(value)}
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
                            const isUser = String(renderProps.value).startsWith('user-');
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
                    style={{ borderRadius: 'var(--semi-border-radius-large)' }}
                  />
                </div>
              </div>
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
          void queryClient.invalidateQueries({ queryKey: aiUserConfigKeys.all });
        }}
      />
    )}
    <AppModal
      title="重命名会话"
      visible={renameConvId !== null}
      onOk={() => void handleRenameConv()}
      onCancel={() => setRenameConvId(null)}
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
    </AppModal>
    <Modal
      title="可以告诉我们哪里需要改进吗？"
      visible={dislikeMsgId !== null}
      footer={null}
      onCancel={() => setDislikeMsgId(null)}
      closeOnEsc
      width={380}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {dislikeReasons.map((r) => (
          <Button key={r.value} onClick={() => submitDislikeReason(r.value)}>{r.label}</Button>
        ))}
      </div>
      <div style={{ marginTop: 16, textAlign: 'right' }}>
        <Button theme="borderless" type="tertiary" onClick={() => setDislikeMsgId(null)}>跳过</Button>
      </div>
    </Modal>
    <AppModal
      title={`填写角色变量 — ${varFillTemplate?.name ?? ''}`}
      visible={varFillTemplate !== null}
      onOk={handleVarFillOk}
      onCancel={() => setVarFillTemplate(null)}
      closeOnEsc
      width={480}
    >
      {varFillTemplate && (
        <Form
          key={varFillTemplate.id}
          getFormApi={(api) => { varFormApi.current = api; }}
          labelPosition="top"
        >
          <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 8 }}>
            该角色模板包含变量占位符，填写后将替换到提示词中
          </Typography.Text>
          {extractPromptVariables(varFillTemplate.content).map((name) => (
            <Form.Input
              key={name}
              field={name}
              label={name}
              placeholder={`请输入${name}`}
              rules={[{ required: true, message: `请输入${name}` }]}
            />
          ))}
        </Form>
      )}
    </AppModal>
    </>
  );
}
