import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { AIChatDialogue, AIChatInput, Typography, Button, Form, RadioGroup, Radio, Select, Tag, Toast, Tooltip, Spin, TextArea, Dropdown, Input, Modal, TagInput, Space } from '@douyinfe/semi-ui';
import type { Message as AIChatMessage } from '@douyinfe/semi-ui/lib/es/aiChatDialogue';
import type { RenderActionProps, RenderTitleProps } from '@douyinfe/semi-ui/lib/es/aiChatDialogue/interface';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { MessageSquarePlus, Trash2, AlignLeft, AlignJustify, Settings, MoreHorizontal, Pencil, Pin, PinOff, Archive, ArchiveRestore, Sparkles, Inbox, Download, Share2, UserRoundPen, Swords, Library, ImagePlus, X, ChevronLeft, ChevronRight, Volume2, Square, Mic, MicOff, Tags, Bot } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { MasterDetailLayout } from '@/components/MasterDetailLayout';
import { NavListPanel, NavListItem } from '@/components/NavListPanel';
import AppModal from '@/components/AppModal';
import { useAuth } from '@/hooks/useAuth';
import UserAiConfigModal from '../components/UserAiConfigModal';
import PreferenceModal from '../components/PreferenceModal';
import ShareModal from '../components/ShareModal';
import ArenaModal from '../components/ArenaModal';
import { request } from '@/utils/request';
import { TOKEN_KEY } from '@zenith/shared';
import { config } from '@/config';
import type { AiChatModel, AiConversation, AiMessage, AiPromptTemplate, UserAiConfig } from '@zenith/shared';
import { useAiChatModels } from '@/hooks/queries/ai-providers';
import { useAiAllowUserCustomKey, useAiUserConfigs, aiUserConfigKeys } from '@/hooks/queries/ai-user-config';
import { useAvailableAiPrompts, recordAiPromptUse } from '@/hooks/queries/ai-prompts';
import { useAvailableKnowledgeBases, setConversationKb, setConversationTags, switchConversationBranch, getActiveGeneration, cancelGeneration } from '@/hooks/queries/ai-extras';
import { useAiAgentDetail } from '@/hooks/queries/ai-agents';
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

/** 工具调用过程（SSE tool_call 事件） */
interface ToolCallDisplay {
  name: string;
  arguments: string;
  result: string;
}

/** 知识库引用（SSE references 事件） */
interface KbRefDisplay {
  docName: string;
  content: string;
  score: number;
}

/** 组装 assistant 消息内容：思维链折叠面板 + 工具调用过程 + 正文 + 知识库引用 */
function buildAssistantContent(
  text: string,
  reasoning: string | null | undefined,
  reasoningDone: boolean,
  toolCalls?: ToolCallDisplay[],
  references?: KbRefDisplay[],
): NonNullable<AIChatMessage['content']> {
  const hasExtras = !!reasoning || (toolCalls?.length ?? 0) > 0 || (references?.length ?? 0) > 0;
  if (!hasExtras) return text;
  const items: Record<string, unknown>[] = [];
  if (reasoning) {
    items.push({
      type: 'reasoning',
      status: reasoningDone ? 'completed' : 'in_progress',
      content: [{ type: 'reasoning_text', text: reasoning }],
    });
  }
  for (const tc of toolCalls ?? []) {
    items.push({ type: 'function_call', status: 'completed', name: tc.name, arguments: tc.arguments, output: tc.result });
  }
  items.push({ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text }] });
  if (references?.length) {
    items.push({ type: 'kb_references', refs: references });
  }
  return items as NonNullable<AIChatMessage['content']>;
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

// ─── 消息分支树（与服务端算法对齐）────────────────────────────────────────────

interface BranchInfo {
  /** 同父同角色的兄弟消息 ID（时间序） */
  siblings: number[];
  index: number;
}

/** 激活路径：activeLeaf 祖先链；未设置 / 失效时取最新消息为叶子 */
function resolveActivePath(rows: AiMessage[], activeLeafMsgId: number | null): AiMessage[] {
  if (rows.length === 0) return [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const leafId = activeLeafMsgId !== null && byId.has(activeLeafMsgId) ? activeLeafMsgId : rows[rows.length - 1].id;
  const path: AiMessage[] = [];
  let cur: number | null = leafId;
  const guard = new Set<number>();
  while (cur !== null && !guard.has(cur)) {
    guard.add(cur);
    const node = byId.get(cur);
    if (!node) break;
    path.unshift(node);
    cur = node.parentId;
  }
  return path;
}

/** 每条消息的兄弟分支信息（同父 + 同角色，数量 > 1 时展示切换器） */
function computeBranchInfo(rows: AiMessage[]): Map<number, BranchInfo> {
  const groups = new Map<string, number[]>();
  for (const r of rows) {
    const key = `${r.parentId ?? 'root'}|${r.role}`;
    const list = groups.get(key) ?? [];
    list.push(r.id);
    groups.set(key, list);
  }
  const info = new Map<number, BranchInfo>();
  for (const ids of groups.values()) {
    if (ids.length < 2) continue;
    ids.forEach((id, idx) => info.set(id, { siblings: ids, index: idx }));
  }
  return info;
}

/** 浏览器 TTS 朗读（不支持时静默） */
function speakText(text: string, onEnd: () => void): boolean {
  if (!('speechSynthesis' in window) || !text.trim()) return false;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text.slice(0, 4000));
  utter.lang = 'zh-CN';
  utter.onend = onEnd;
  utter.onerror = onEnd;
  window.speechSynthesis.speak(utter);
  return true;
}

/** 提取消息纯文本（数组 content 取 output_text） */
function extractPlainText(msg: Message): string {
  if (typeof msg.content === 'string') return msg.content;
  const outputText = (msg as Record<string, unknown>).output_text;
  if (typeof outputText === 'string') return outputText;
  return '';
}

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function createSpeechRecognition(): SpeechRecognitionLike | null {
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = 'zh-CN';
  rec.continuous = true;
  rec.interimResults = true;
  return rec;
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
  /** 选中模型（state 镜像，驱动 vision 按钮等 UI 随切换刷新） */
  const [selectedModelValue, setSelectedModelValue] = useState('');
  const setConfigureValues = useCallback((v: Record<string, unknown>) => {
    configureValuesRef.current = v;
    setSelectedModelValue(String(v.model ?? ''));
  }, []);
  const dialogueRef = useRef<AIChatDialogueInstance | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [debouncedSearchKeyword, setDebouncedSearchKeyword] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const didInitConvRef = useRef(false);
  const [dislikeMsgId, setDislikeMsgId] = useState<number | null>(null);
  const [varFillTemplate, setVarFillTemplate] = useState<AiPromptTemplate | null>(null);
  const varFormApi = useRef<FormApi | null>(null);
  const [preferenceVisible, setPreferenceVisible] = useState(false);
  const [shareConvId, setShareConvId] = useState<number | null>(null);
  const [arenaVisible, setArenaVisible] = useState(false);
  /** 待发送图片（vision，data URL） */
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  /** 当前生成任务 ID（停止 / 断线续传用） */
  const currentGenIdRef = useRef<string | null>(null);
  /** 分支树：全量 API 消息与激活叶子（本地镜像，切换分支即时生效） */
  const [allApiMessages, setAllApiMessages] = useState<AiMessage[]>([]);
  const [activeLeafId, setActiveLeafId] = useState<number | null>(null);
  /** 标签编辑 */
  const [tagsConvId, setTagsConvId] = useState<number | null>(null);
  const [tagsDraft, setTagsDraft] = useState<string[]>([]);
  /** TTS 朗读中的消息 ID */
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);
  /** STT 语音输入 */
  const [recording, setRecording] = useState(false);
  const [sttDraft, setSttDraft] = useState('');
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const { items: dislikeReasons } = useDictItems('ai_dislike_reason');
  const allowUserCustomKeyQuery = useAiAllowUserCustomKey();
  const allowUserCustomKey = allowUserCustomKeyQuery.data ?? false;
  const chatModelsQuery = useAiChatModels();
  const chatModels = useMemo(() => chatModelsQuery.data ?? [], [chatModelsQuery.data]);
  const userConfigsQuery = useAiUserConfigs(allowUserCustomKey);
  const promptTemplatesQuery = useAvailableAiPrompts();
  const promptTemplates = promptTemplatesQuery.data ?? [];
  const kbQuery = useAvailableKnowledgeBases();
  const knowledgeBases = kbQuery.data ?? [];
  const conversationsQuery = useInfiniteAiConversationList({
    keyword: debouncedSearchKeyword.trim() || undefined,
    archived: showArchived ? 'true' : undefined,
  });
  const messagesQuery = useAiConversationMessages(activeConvId);
  const createConversationMutation = useCreateAiConversation();

  // Load AI chat models + user configs as model options（value: `${configId}:${model}` / `user-${id}`）
  const loadModelOptions = useCallback((models: AiChatModel[], userConfigs: UserAiConfig[]) => {
    const sysOptions = models.map((m) => ({ value: `${m.id}:${m.model}`, label: `${m.name} (${m.model})`, source: 'system' as const }));
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
    loadModelOptions(chatModels, allowUserCustomKey ? (userConfigsQuery.data ?? []) : []);
  }, [allowUserCustomKey, loadModelOptions, chatModels, userConfigsQuery.data]);

  /** 当前选中模型的能力（vision / tools），用户自定义配置无能力标注 */
  const selectedCapabilities = useMemo(() => {
    if (!selectedModelValue || selectedModelValue.startsWith('user-')) return null;
    const [idStr, ...modelParts] = selectedModelValue.split(':');
    const model = modelParts.join(':');
    return chatModels.find((m) => m.id === Number(idStr) && m.model === model)?.capabilities ?? null;
  }, [chatModels, selectedModelValue]);

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
      setAllApiMessages([]);
      setActiveLeafId(null);
      return;
    }
    const apiMessages = messagesQuery.data;
    if (!apiMessages) return;
    setAllApiMessages(apiMessages);
    // 激活叶子以会话记录为准（本地分支切换后由 switch 流程更新）
    const conv = conversations.find((c) => c.id === activeConvId);
    setActiveLeafId(conv?.activeLeafMsgId ?? null);
    const scrollTimer = setTimeout(() => dialogueRef.current?.scrollToBottom(false), 120);
    return () => clearTimeout(scrollTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- conversations 仅作初始叶子来源，避免列表刷新反复重置
  }, [activeConvId, messagesQuery.data]);

  /** 分支信息（同父同角色兄弟 > 1 时展示切换器） */
  const branchInfo = useMemo(() => computeBranchInfo(allApiMessages), [allApiMessages]);

  // 激活路径变化 → 重算展示消息（生成中不重置，避免打断流式气泡）
  useEffect(() => {
    if (generating) return;
    const path = resolveActivePath(allApiMessages, activeLeafId);
    setMessages(path.map(convertApiMessage));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- generating 变为 false 时由 done 流程主动 invalidate
  }, [allApiMessages, activeLeafId]);

  /** 自定义内容项：知识库引用列表 */
  const renderDialogueContentItem = useMemo(() => ({
    kb_references: (item: Record<string, unknown>) => {
      const refs = (item.refs as KbRefDisplay[] | undefined) ?? [];
      if (refs.length === 0) return null;
      return (
        <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 'var(--semi-border-radius-medium)', background: 'var(--semi-color-fill-0)', fontSize: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--semi-color-text-1)' }}>📚 知识库引用</div>
          {refs.map((r, i) => (
            <div key={`${r.docName}-${i}`} style={{ color: 'var(--semi-color-text-2)', marginTop: 2 }}>
              【{i + 1}】《{r.docName}》（相关度 {r.score}）：{r.content}…
            </div>
          ))}
        </div>
      );
    },
  }), []);

  const roleConfig = {
    user: {
      name: user?.nickname || user?.username || '我',
      avatar: user?.avatar || undefined,
    },
    assistant: { name: 'AI 助手', avatar: AI_AVATAR },
    system: { name: '系统', avatar: AI_AVATAR },
  };

  /** SSE 事件消费（发送与断线续传共用）。skipUserEvent：发起端已本地渲染 user 气泡时跳过缓冲中的 user 事件 */
  const consumeSSEStream = useCallback(async (
    response: Response,
    ctx: { convId: number; assistantMsgId: string; localUserMsgId: string | null; skipUserEvent: boolean },
  ) => {
    const { convId, assistantMsgId, localUserMsgId, skipUserEvent } = ctx;
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';
    let accContent = '';
    let accReasoning = '';
    const accToolCalls: ToolCallDisplay[] = [];
    let accReferences: KbRefDisplay[] = [];

    const refreshAssistant = () => {
      const nextContent = buildAssistantContent(accContent, accReasoning, accContent.length > 0, accToolCalls, accReferences);
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantMsgId ? { ...m, content: nextContent, output_text: accContent } : m))
      );
    };

    // eventType 必须在读循环外持有：SSE 帧可能被拆到两次 read 之间
    // （event: 行与 data: 行分属不同 chunk），循环内声明会导致事件被静默丢弃
    let eventType = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          eventType = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          const dataStr = line.slice(6).trim();
          if (!dataStr) continue;
          try {
            const parsed = JSON.parse(dataStr) as Record<string, unknown>;
            if (eventType === 'gen') {
              // 生成任务 ID：停止 / 断线续传凭据
              currentGenIdRef.current = (parsed.genId as string) ?? null;
            } else if (eventType === 'user') {
              // 续传场景：缓冲中回放的用户消息（发起端已本地渲染，跳过）
              if (!skipUserEvent && parsed.content) {
                const userMsg: Message = { id: nextMsgId(), role: 'user', content: parsed.content as string, createdAt: Date.now() - 1, status: 'completed' };
                setMessages((prev) => {
                  const idx = prev.findIndex((m) => m.id === assistantMsgId);
                  if (idx === -1) return [...prev, userMsg];
                  return [...prev.slice(0, idx), userMsg, ...prev.slice(idx)];
                });
              }
            } else if (eventType === 'delta' && parsed.content) {
              accContent += (parsed.content as string | undefined) ?? '';
              refreshAssistant();
            } else if (eventType === 'reasoning' && parsed.content) {
              accReasoning += (parsed.content as string | undefined) ?? '';
              refreshAssistant();
            } else if (eventType === 'tool_call') {
              // function calling 执行过程
              accToolCalls.push({
                name: (parsed.name as string) ?? '',
                arguments: (parsed.arguments as string) ?? '',
                result: (parsed.result as string) ?? '',
              });
              refreshAssistant();
            } else if (eventType === 'references') {
              // 知识库检索引用
              accReferences = (parsed.references as KbRefDisplay[]) ?? [];
              refreshAssistant();
            } else if (eventType === 'failover') {
              Toast.info(`当前模型响应异常，已自动切换到备用模型（${(parsed.to as string) ?? ''}）`);
            } else if (eventType === 'saved') {
              // 服务端保存完成：本地气泡映射数据库 ID，并同步分支叶子与消息树
              const dbId = (parsed.assistantMsgId as number | undefined);
              const userDbId = (parsed.userMsgId as number | null | undefined);
              setMessages((prev) =>
                prev.map((m) => {
                  if (dbId && m.id === assistantMsgId) return { ...m, id: `api-${dbId}` };
                  if (userDbId && localUserMsgId && m.id === localUserMsgId) return { ...m, id: `api-${userDbId}` };
                  return m;
                })
              );
              if (dbId) setActiveLeafId(dbId);
              void queryClient.invalidateQueries({ queryKey: aiConversationKeys.messages(convId) });
            } else if (eventType === 'title') {
              // 服务端 LLM 自动命名完成，同步会话标题
              const title = parsed.title as string | undefined;
              if (title) {
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
  }, [queryClient]);

  const handleMessageSend = useCallback(
    async (
      content: { inputContents?: { type: string; text?: string }[]; text?: string },
      opts?: { regenerate?: boolean; parentMsgId?: number | null },
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
          setAllApiMessages([]);
          setActiveLeafId(null);
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

      // user 气泡本地 ID：saved 事件到达后映射为数据库 ID（编辑/删除依赖真实 ID）
      const localUserMsgId = regenerate ? null : nextMsgId();
      if (regenerate) {
        // 重新生成：不追加 user 气泡，仅追加新的 assistant 占位（旧回复保留为兄弟分支）
        setMessages((prev) => [...prev, assistantMsg]);
      } else {
        const userMsg: Message = {
          id: localUserMsgId!,
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
      currentGenIdRef.current = null;
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
                const base: Record<string, unknown> = regenerate ? { regenerate: true } : { message: text };
                if (opts?.parentMsgId !== undefined) base.parentMsgId = opts.parentMsgId;
                if (!regenerate && pendingImages.length > 0) base.images = pendingImages;
                if (selectedModel.startsWith('user-')) {
                  const userConfigId = Number.parseInt(selectedModel.replace('user-', ''), 10);
                  return { ...base, configSource: 'user', configId: userConfigId };
                }
                // `${configId}:${model}` 组合（多模型配置）
                const [idStr, ...modelParts] = selectedModel.split(':');
                const model = modelParts.join(':');
                return { ...base, configSource: 'system', configId: Number(idStr) || undefined, ...(model && { model }) };
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

        // 发送成功后清空待发图片
        if (!regenerate && pendingImages.length > 0) setPendingImages([]);

        await consumeSSEStream(response, { convId, assistantMsgId, localUserMsgId, skipUserEvent: true });
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
    [activeConvId, createConversationMutation, pendingImages, consumeSSEStream]
  );

  /** 断线续传：进入会话时发现有进行中的生成任务 → 挂载恢复流 */
  const attachToGeneration = useCallback(async (convId: number, genId: string) => {
    if (generating) return;
    currentGenIdRef.current = genId;
    const assistantMsgId = nextMsgId();
    setMessages((prev) => [...prev, {
      id: assistantMsgId,
      role: 'assistant' as const,
      content: '',
      createdAt: Date.now(),
      status: 'in_progress' as const,
    }]);
    setGenerating(true);
    const abortController = new AbortController();
    abortRef.current = abortController;
    const token = localStorage.getItem(TOKEN_KEY);
    try {
      const response = await fetch(`${config.apiBaseUrl}/api/ai/generations/${genId}/stream?offset=0`, {
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        signal: abortController.signal,
      });
      if (!response.ok) throw new Error('恢复生成流失败');
      Toast.info('检测到进行中的回复，已恢复实时输出');
      await consumeSSEStream(response, { convId, assistantMsgId, localUserMsgId: null, skipUserEvent: false });
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        // 恢复失败：移除占位气泡，改为静默刷新消息
        setMessages((prev) => prev.filter((m) => m.id !== assistantMsgId));
        void queryClient.invalidateQueries({ queryKey: aiConversationKeys.messages(convId) });
      }
    } finally {
      setGenerating(false);
      abortRef.current = null;
    }
  }, [generating, consumeSSEStream, queryClient]);

  // 会话切换时探测未完成的生成任务（刷新 / 断网恢复场景）
  useEffect(() => {
    if (!activeConvId) return;
    let cancelled = false;
    void getActiveGeneration(activeConvId)
      .then((res) => {
        if (!cancelled && res.genId) void attachToGeneration(activeConvId, res.genId);
      })
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在切换会话时探测一次
  }, [activeConvId]);

  const handleStopGenerate = useCallback(() => {
    // 生成与连接解耦：优先通知服务端停止（保存已生成部分），再断开本地流
    const genId = currentGenIdRef.current;
    if (genId) {
      void cancelGeneration(genId).catch(() => {});
    }
    abortRef.current?.abort();
    setGenerating(false);
    setMessages((prev) =>
      prev.map((m) => (m.status === 'in_progress' ? { ...m, status: 'completed' } : m))
    );
    // 服务端保存部分内容后同步一次消息树
    const convId = activeConvId;
    if (convId) {
      setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: aiConversationKeys.messages(convId) });
      }, 1200);
    }
  }, [activeConvId, queryClient]);

  /** 重新生成：保留旧回复为兄弟分支，基于同一条 user 消息重答（可用分支切换器来回对比） */
  const handleRegenerate = useCallback(async (msg: Message) => {
    if (generating || !activeConvId) return;
    if (msg.role !== 'assistant') return;

    // 确认这条 assistant 前面有 user 消息，否则无从重新生成
    const curMessages = messages;
    const idx = curMessages.findIndex((m) => m.id === msg.id);
    const prevUserMsg = idx > 0 ? curMessages.slice(0, idx).reverse().find((m) => m.role === 'user') : null;
    if (!prevUserMsg) { Toast.warning('找不到对应的用户消息，无法重新生成'); return; }

    // 仅从展示中移除旧回复（数据保留为兄弟分支），以 regenerate 模式重发
    setMessages((prev) => prev.filter((m) => m.id !== msg.id));
    void handleMessageSend({ text: '' }, { regenerate: true });
  }, [generating, activeConvId, messages, handleMessageSend]);

  /** 编辑并重发：以被编辑消息的父节点为分支点创建新的兄弟分支（旧分支保留，可切换回看） */
  const handleEditAndResend = useCallback(async (msgId: string, newText: string) => {
    if (!newText.trim() || !activeConvId) return;
    const curMessages = messages;
    const idx = curMessages.findIndex((m) => m.id === msgId);
    if (idx === -1) return;

    const dbId = String(msgId).startsWith('api-') ? Number(String(msgId).replace('api-', '')) : null;
    // 分支点 = 被编辑消息的父节点（null = 根）；未落库的本地消息按普通发送兜底
    let parentMsgId: number | null | undefined;
    if (dbId) {
      const apiMsg = allApiMessages.find((m) => m.id === dbId);
      parentMsgId = apiMsg ? apiMsg.parentId : undefined;
    }
    // 截断 UI 中该消息及其后所有（旧分支数据保留）
    setMessages((prev) => prev.slice(0, idx));
    void handleMessageSend({ text: newText }, parentMsgId !== undefined ? { parentMsgId } : undefined);
  }, [activeConvId, messages, allApiMessages, handleMessageSend]);

  const handleEditCancel = useCallback((msgId: string) => {
    setMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, editing: false } : m));
  }, []);
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
      setAllApiMessages([]);
      setActiveLeafId(null);
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

  /** 挂载 / 取消挂载知识库 */
  const handleSetKb = async (kbId: number | null) => {
    if (!activeConvId) { Toast.warning('请先选择或创建对话'); return; }
    try {
      await setConversationKb(activeConvId, kbId);
      setConversations((prev) => prev.map((c) => c.id === activeConvId ? { ...c, knowledgeBaseId: kbId } : c));
      Toast.success(kbId ? '已挂载知识库' : '已取消挂载');
    } catch {
      Toast.error('操作失败');
    }
  };

  /** 选择 vision 图片（转 data URL，单张 ≤2MB，最多 3 张） */
  const handlePickImages = (files: FileList | null) => {
    if (!files) return;
    const list = [...files].slice(0, 3 - pendingImages.length);
    for (const file of list) {
      if (!file.type.startsWith('image/')) continue;
      if (file.size > 2 * 1024 * 1024) {
        Toast.warning(`图片 ${file.name} 超过 2MB，已跳过`);
        continue;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const url = reader.result as string;
        setPendingImages((prev) => (prev.length >= 3 ? prev : [...prev, url]));
      };
      reader.readAsDataURL(file);
    }
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

  /** 当前会话关联的智能体（展示开场白 / 建议问题 / 头部徽标） */
  const agentQuery = useAiAgentDetail(activeConv?.agentId ?? null);
  const activeAgent = activeConv?.agentId ? agentQuery.data : undefined;

  // ?agentId= 入口：从智能体页跳转，自动以该智能体开启新对话
  const agentParamHandled = useRef(false);
  useEffect(() => {
    const agentIdStr = searchParams.get('agentId');
    if (!agentIdStr || agentParamHandled.current) return;
    agentParamHandled.current = true;
    const agentId = Number(agentIdStr);
    setSearchParams({}, { replace: true });
    if (!Number.isFinite(agentId)) return;
    void (async () => {
      try {
        setShowArchived(false);
        const newConv = await createConversationMutation.mutateAsync({ title: '新对话', agentId });
        setConversations((prev) => [newConv, ...prev]);
        setActiveConvId(newConv.id);
        setMessages([]);
        setAllApiMessages([]);
        setActiveLeafId(null);
      } catch { /* 请求层已提示 */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅处理一次入口参数
  }, [searchParams]);

  /** 分支切换：以目标兄弟消息为起点下探最新叶子并激活 */
  const handleSwitchBranch = useCallback(async (siblingDbId: number) => {
    if (!activeConvId || generating) return;
    try {
      const res = await switchConversationBranch(activeConvId, siblingDbId);
      setActiveLeafId(res.activeLeafMsgId);
      setConversations((prev) => prev.map((c) => (c.id === activeConvId ? { ...c, activeLeafMsgId: res.activeLeafMsgId } : c)));
    } catch { /* 请求层已提示 */ }
  }, [activeConvId, generating]);

  /** 消息标题行：默认标题 + 分支切换器（‹ i/n ›） */
  const renderDialogueTitle = useCallback((props: RenderTitleProps) => {
    const msg = props.message;
    const dbId = msg && String(msg.id).startsWith('api-') ? Number(String(msg.id).replace('api-', '')) : null;
    const info = dbId ? branchInfo.get(dbId) : undefined;
    if (!info) return props.defaultTitle;
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {props.defaultTitle}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 12, color: 'var(--semi-color-text-2)' }}>
          <Button
            theme="borderless"
            size="small"
            disabled={info.index === 0 || generating}
            icon={<ChevronLeft size={12} />}
            style={{ height: 18, width: 18, minWidth: 18, padding: 0 }}
            onClick={() => void handleSwitchBranch(info.siblings[info.index - 1])}
          />
          {info.index + 1}/{info.siblings.length}
          <Button
            theme="borderless"
            size="small"
            disabled={info.index === info.siblings.length - 1 || generating}
            icon={<ChevronRight size={12} />}
            style={{ height: 18, width: 18, minWidth: 18, padding: 0 }}
            onClick={() => void handleSwitchBranch(info.siblings[info.index + 1])}
          />
        </span>
      </span>
    );
  }, [branchInfo, generating, handleSwitchBranch]);

  /** 标签编辑保存 */
  const handleSaveTags = async () => {
    if (!tagsConvId) return;
    try {
      const cleaned = await setConversationTags(tagsConvId, tagsDraft);
      setConversations((prev) => prev.map((c) => (c.id === tagsConvId ? { ...c, tags: cleaned.tags } : c)));
      Toast.success('标签已更新');
      setTagsConvId(null);
    } catch { /* 请求层已提示 */ }
  };

  /** TTS：朗读 / 停止朗读 assistant 消息 */
  const handleToggleSpeak = useCallback((msg: Message) => {
    if (speakingMsgId === msg.id) {
      window.speechSynthesis?.cancel();
      setSpeakingMsgId(null);
      return;
    }
    const text = extractPlainText(msg);
    if (!text) return;
    const ok = speakText(text, () => setSpeakingMsgId(null));
    if (ok) setSpeakingMsgId(msg.id);
    else Toast.warning('当前浏览器不支持语音朗读');
  }, [speakingMsgId]);

  // 卸载时停止朗读 / 录音
  useEffect(() => () => {
    window.speechSynthesis?.cancel();
    recognitionRef.current?.stop();
  }, []);

  /** STT：开始 / 停止语音输入（识别文本进入待发草稿条） */
  const handleToggleRecording = useCallback(() => {
    if (recording) {
      recognitionRef.current?.stop();
      setRecording(false);
      return;
    }
    const rec = createSpeechRecognition();
    if (!rec) {
      Toast.warning('当前浏览器不支持语音识别（建议使用 Chrome / Edge）');
      return;
    }
    recognitionRef.current = rec;
    rec.onresult = (e) => {
      let final = '';
      for (let i = 0; i < e.results.length; i++) {
        final += e.results[i][0]?.transcript ?? '';
      }
      setSttDraft(final);
    };
    rec.onend = () => setRecording(false);
    rec.onerror = () => setRecording(false);
    rec.start();
    setRecording(true);
  }, [recording]);

  const dialogueRenderConfig = useMemo(() => ({
    // 操作栏：默认操作（去掉分享）+ 追加 TTS 朗读按钮（assistant 消息）
    renderDialogueAction: (props: RenderActionProps) => {
      if (!props.defaultActionsObj) return null;
      const { copyNode, resetNode, likeNode, dislikeNode, moreNode } = props.defaultActionsObj;
      const msg = props.message as Message | undefined;
      const speakNode = msg && msg.role === 'assistant' && msg.status !== 'in_progress' ? (
        <Tooltip content={speakingMsgId === msg.id ? '停止朗读' : '朗读回复'}>
          <Button
            theme="borderless"
            size="small"
            type="tertiary"
            icon={speakingMsgId === msg.id ? <Square size={13} /> : <Volume2 size={13} />}
            onClick={() => handleToggleSpeak(msg)}
          />
        </Tooltip>
      ) : null;
      return <div className={props.className}>{copyNode}{resetNode}{likeNode}{dislikeNode}{speakNode}{moreNode}</div>;
    },
    // 标题行：追加分支切换器（‹ i/n ›）
    renderDialogueTitle,
  }), [renderDialogueTitle, speakingMsgId, handleToggleSpeak]);

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
          <Dropdown.Item onClick={(e) => { (e as React.MouseEvent).stopPropagation(); setTagsDraft(conv.tags ?? []); setTagsConvId(conv.id); }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Tags size={13} />标签</span>
          </Dropdown.Item>
          <Dropdown.Item onClick={(e) => { (e as React.MouseEvent).stopPropagation(); setShareConvId(conv.id); }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Share2 size={13} />分享</span>
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
                <Dropdown
                  trigger="click"
                  position="bottomLeft"
                  clickToHide
                  render={
                    <Dropdown.Menu>
                      {knowledgeBases.length === 0 && <Dropdown.Item disabled>暂无知识库，请先到「知识库」页创建</Dropdown.Item>}
                      {knowledgeBases.map((kb) => (
                        <Dropdown.Item
                          key={kb.id}
                          active={activeConv?.knowledgeBaseId === kb.id}
                          onClick={() => void handleSetKb(kb.id)}
                        >
                          {kb.name}（{kb.documentCount} 篇）
                        </Dropdown.Item>
                      ))}
                      {activeConv?.knowledgeBaseId && (
                        <>
                          <Dropdown.Divider />
                          <Dropdown.Item type="danger" onClick={() => void handleSetKb(null)}>取消挂载</Dropdown.Item>
                        </>
                      )}
                    </Dropdown.Menu>
                  }
                >
                  <span style={{ display: 'inline-flex' }}>
                    <Tooltip content="挂载知识库（回答优先引用知识库内容）">
                      <Button
                        theme={activeConv?.knowledgeBaseId ? 'light' : 'borderless'}
                        type="primary"
                        size="small"
                        icon={<Library size={14} />}
                      >
                        {activeConv?.knowledgeBaseId
                          ? (knowledgeBases.find((kb) => kb.id === activeConv.knowledgeBaseId)?.name ?? '知识库')
                          : '知识库'}
                      </Button>
                    </Tooltip>
                  </span>
                </Dropdown>
                <Tooltip content="模型对比（Arena）">
                  <Button
                    theme="borderless"
                    size="small"
                    icon={<Swords size={14} />}
                    onClick={() => setArenaVisible(true)}
                  />
                </Tooltip>
                <Tooltip content="个人指令（AI 全局记住你的偏好）">
                  <Button
                    theme="borderless"
                    size="small"
                    icon={<UserRoundPen size={14} />}
                    onClick={() => setPreferenceVisible(true)}
                  />
                </Tooltip>
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
            <Title heading={6} style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              {activeAgent && <span title={activeAgent.description ?? undefined}>{activeAgent.avatar}</span>}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeConv?.title ?? '智能对话'}</span>
              {activeAgent && <Tag size="small" color="violet" style={{ flexShrink: 0 }}><Bot size={11} style={{ verticalAlign: -1, marginRight: 2 }} />{activeAgent.name}</Tag>}
              {(activeConv?.tags ?? []).map((t) => <Tag key={t} size="small" color="white" style={{ flexShrink: 0 }}>{t}</Tag>)}
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
                      {activeAgent ? (
                        <>
                          <span style={{ fontSize: 44, lineHeight: 1 }}>{activeAgent.avatar}</span>
                          <Title heading={4} style={{ margin: 0 }}>{activeAgent.name}</Title>
                          <Typography.Text type="tertiary" style={{ maxWidth: 520, whiteSpace: 'pre-wrap' }}>
                            {activeAgent.openingMessage || activeAgent.description || '有什么可以帮您？'}
                          </Typography.Text>
                          {activeAgent.suggestedQuestions.length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', maxWidth: 560, marginTop: 4 }}>
                              {activeAgent.suggestedQuestions.map((q) => (
                                <Button key={q} theme="light" type="primary" onClick={() => void handleMessageSend({ text: q })}>{q}</Button>
                              ))}
                            </div>
                          )}
                        </>
                      ) : (
                        <>
                          <Sparkles size={40} color="var(--semi-color-primary)" />
                          <Title heading={4} style={{ margin: 0 }}>有什么可以帮您？</Title>
                          <Typography.Text type="tertiary">选择下面的问题快速开始，或在下方输入框直接提问</Typography.Text>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', maxWidth: 560, marginTop: 4 }}>
                            {SUGGESTED_QUESTIONS.map((q) => (
                              <Button key={q} theme="light" type="primary" onClick={() => void handleMessageSend({ text: q })}>{q}</Button>
                            ))}
                          </div>
                        </>
                      )}
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
                  {/* STT 语音识别草稿条 */}
                  {(recording || sttDraft) && (
                    <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center', padding: '6px 10px', borderRadius: 'var(--semi-border-radius-medium)', background: 'var(--semi-color-fill-0)' }}>
                      {recording && <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--semi-color-danger)', flexShrink: 0, animation: 'pulse 1.2s infinite' }} />}
                      <Input
                        value={sttDraft}
                        onChange={setSttDraft}
                        placeholder={recording ? '正在聆听…' : '语音识别结果'}
                        style={{ flex: 1 }}
                        size="small"
                      />
                      <Button
                        size="small"
                        type="primary"
                        disabled={!sttDraft.trim() || generating}
                        onClick={() => {
                          const text = sttDraft.trim();
                          setSttDraft('');
                          if (recording) handleToggleRecording();
                          void handleMessageSend({ text });
                        }}
                      >发送</Button>
                      <Button size="small" type="tertiary" onClick={() => { setSttDraft(''); if (recording) handleToggleRecording(); }}>清除</Button>
                    </div>
                  )}
                  {/* vision 待发送图片缩略图条 */}
                  {pendingImages.length > 0 && (
                    <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                      {pendingImages.map((url, i) => (
                        <div key={`img-${i}`} style={{ position: 'relative', width: 56, height: 56 }}>
                          <img src={url} alt={`待发送图片 ${i + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'var(--semi-border-radius-medium)', border: '1px solid var(--semi-color-border)' }} />
                          <Button
                            theme="solid"
                            type="tertiary"
                            size="small"
                            icon={<X size={10} />}
                            style={{ position: 'absolute', top: -6, right: -6, width: 18, height: 18, minWidth: 18, borderRadius: '50%', padding: 0 }}
                            onClick={() => setPendingImages((prev) => prev.filter((_, idx) => idx !== i))}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                    <Tooltip content={recording ? '停止语音输入' : '语音输入（识别结果可编辑后发送）'}>
                      <Button
                        theme="borderless"
                        type={recording ? 'danger' : 'tertiary'}
                        icon={recording ? <MicOff size={16} /> : <Mic size={16} />}
                        style={{ marginBottom: 8 }}
                        onClick={handleToggleRecording}
                      />
                    </Tooltip>
                    {selectedCapabilities?.vision && (
                      <>
                        <input
                          ref={imageInputRef}
                          type="file"
                          accept="image/*"
                          multiple
                          style={{ display: 'none' }}
                          onChange={(e) => { handlePickImages(e.target.files); e.target.value = ''; }}
                        />
                        <Tooltip content="添加图片（当前模型支持图片理解，≤3 张 / 单张 ≤2MB）">
                          <Button
                            theme="borderless"
                            icon={<ImagePlus size={16} />}
                            style={{ marginBottom: 8 }}
                            onClick={() => imageInputRef.current?.click()}
                          />
                        </Tooltip>
                      </>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
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
    <PreferenceModal visible={preferenceVisible} onClose={() => setPreferenceVisible(false)} />
    <ShareModal convId={shareConvId} onClose={() => setShareConvId(null)} />
    <ArenaModal visible={arenaVisible} onClose={() => setArenaVisible(false)} models={chatModels} />
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
    <AppModal
      title="编辑对话标签"
      visible={tagsConvId !== null}
      onOk={() => void handleSaveTags()}
      onCancel={() => setTagsConvId(null)}
      closeOnEsc
      width={420}
    >
      <Space vertical align="start" style={{ width: '100%' }}>
        <Typography.Text type="tertiary" size="small">最多 10 个标签，每个不超过 20 字，回车添加</Typography.Text>
        <TagInput
          value={tagsDraft}
          onChange={(v) => setTagsDraft((v as string[]).slice(0, 10))}
          placeholder="输入标签后回车"
          max={10}
          maxLength={20}
          style={{ width: '100%' }}
          autoFocus
        />
      </Space>
    </AppModal>
    </>
  );
}
