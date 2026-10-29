/**
 * 智能对话页：会话侧栏 + 对话区 + 输入区的状态编排。
 * 生成链路 / 分支树 / 模型选择 / 会话操作 / 语音分别在 ./hooks，UI 块在 ./components，纯函数在 ./chat-utils 等。
 */
import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { AIChatDialogue, Typography, Spin, Tag, Toast } from '@douyinfe/semi-ui';
import { Bot } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useDebouncedValue } from '@tanstack/react-pacer';
import { MasterDetailLayout } from '@/components/MasterDetailLayout';
import { compactParams } from '@/lib/query';
import { useAuth } from '@/hooks/useAuth';
import { useEventCallback } from '@/hooks/useEventCallback';
import UserAiConfigModal from '../components/UserAiConfigModal';
import AiSettingsModal from '../components/AiSettingsModal';
import ShareModal from '../components/ShareModal';
import ArenaModal from '../components/ArenaModal';
import { aiConversationContract } from '@zenith/shared/ai';
import type { AiConversation } from '@zenith/shared/ai';
import { api } from '@/lib/contract-query';
import { useAiChatModels } from '@/hooks/queries/ai-providers';
import { useAiUserConfigs, aiUserConfigKeys } from '@/hooks/queries/ai-user-config';
import { useAvailableAiPrompts } from '@/hooks/queries/ai-prompts';
import { useAvailableKnowledgeBases } from '@/hooks/queries/ai-extras';
import { useAiAgentDetail } from '@/hooks/queries/ai-agents';
import {
  useInfiniteAiConversationList,
  useAiConversationMessages,
  useCreateAiConversation,
} from '@/hooks/queries/ai-conversations';
import { useDictItems } from '@/hooks/useDictItems';
import { AI_AVATAR, type ChatMessage as Message } from './message-adapters';
import { buildContentItemRenderers } from './content-renderers';
import { dbIdOf, groupConversations, type AIChatDialogueInstance } from './chat-utils';
import { useModelSelection } from './hooks/useModelSelection';
import { useMessageTree } from './hooks/useMessageTree';
import { useChatGeneration } from './hooks/useChatGeneration';
import { useConversationActions } from './hooks/useConversationActions';
import { useSpeech } from './hooks/useSpeech';
import { useDialogueRenderConfig } from './hooks/useDialogueRenderConfig';
import { MessageEditWidget } from './components/MessageEditWidget';
import { ConversationSidebar, type ConversationActionHandlers } from './components/ConversationSidebar';
import { ChatHeaderActions, type DialogueAlign, type DialogueMode } from './components/ChatHeaderActions';
import { ChatWelcome } from './components/ChatWelcome';
import { ChatComposer } from './components/ChatComposer';
import { ConversationTagsModal, DislikeReasonModal, PromptVariablesModal, RenameConversationModal } from './components/conversation-modals';

const { Title } = Typography;

export default function AIChatPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [conversations, setConversations] = useState<AiConversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [generating, setGenerating] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [align, setAlign] = useState<DialogueAlign>('leftRight');
  const [mode, setMode] = useState<DialogueMode>('bubble');
  const dialogueRef = useRef<AIChatDialogueInstance | null>(null);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [debouncedSearchKeyword] = useDebouncedValue(searchKeyword, { wait: 300 });
  const [showArchived, setShowArchived] = useState(false);
  const [preferenceVisible, setPreferenceVisible] = useState(false);
  const [preferenceTab, setPreferenceTab] = useState<'instructions' | 'memory'>('instructions');
  const [arenaVisible, setArenaVisible] = useState(false);
  /** 待发送图片（vision，data URL） */
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const { items: dislikeReasons } = useDictItems('ai_dislike_reason');
  const chatModelsQuery = useAiChatModels();
  const chatModels = useMemo(() => chatModelsQuery.data ?? [], [chatModelsQuery.data]);
  const userConfigsQuery = useAiUserConfigs();
  const promptTemplatesQuery = useAvailableAiPrompts();
  const promptTemplates = useMemo(() => promptTemplatesQuery.data ?? [], [promptTemplatesQuery.data]);
  const kbQuery = useAvailableKnowledgeBases();
  const knowledgeBases = useMemo(() => kbQuery.data ?? [], [kbQuery.data]);
  // 边输边筛（防抖）+ 归档开关：勾选才筛选
  const conversationsQuery = useInfiniteAiConversationList(compactParams({
    keyword: debouncedSearchKeyword.trim(),
    archived: showArchived ? true : undefined,
  }));
  const messagesQuery = useAiConversationMessages(activeConvId);
  const createConversationMutation = useCreateAiConversation();

  const { modelOptions, configureValuesRef, setConfigureValues, selectedCapabilities } = useModelSelection({
    chatModels,
    userConfigs: userConfigsQuery.data,
  });

  // 进入页面不默认选中会话：右侧展示欢迎页，直接提问即自动新建对话
  useEffect(() => {
    const pages = conversationsQuery.data?.pages;
    if (!pages) return;
    setConversations(pages.flat());
  }, [conversationsQuery.data]);

  // 侧栏渲染行：置顶 / 今天 / 昨天 / 近 7 天 / 更早 分组
  const convRows = useMemo(() => groupConversations(conversations), [conversations]);

  const { allApiMessages, setAllApiMessages, setActiveLeafId, branchInfo, handleSwitchBranch } = useMessageTree({
    activeConvId, apiMessages: messagesQuery.data, generating, conversations, dialogueRef, setMessages, setConversations,
  });

  /** 新会话入列并激活：onSuccess 的 invalidate 可能已把新会话经列表 refetch 写入,前插必须按 id 去重 */
  const activateNewConversation = useCallback((newConv: AiConversation) => {
    setConversations((prev) => (prev.some((c) => c.id === newConv.id) ? prev : [newConv, ...prev]));
    setActiveConvId(newConv.id);
    setMessages([]);
    setAllApiMessages([]);
    setActiveLeafId(null);
  }, [setAllApiMessages, setActiveLeafId]);

  const { handleMessageSend, handleStopGenerate, handleRegenerate, handleEditAndResend, handleEditCancel } = useChatGeneration({
    queryClient, activeConvId, messages, setMessages, setConversations, allApiMessages, setActiveLeafId,
    generating, setGenerating, pendingImages, setPendingImages, configureValuesRef, dialogueRef,
    createConversationMutation, activateNewConversation,
  });

  const actions = useConversationActions({
    queryClient, activeConvId, setActiveConvId, setConversations, setMessages, setShowArchived,
    createConversationMutation, activateNewConversation,
  });

  const { speakingMsgId, handleToggleSpeak, recording, sttDraft, setSttDraft, handleToggleRecording } = useSpeech();

  /** 自定义内容项：知识库引用列表 */
  // 共享内容项渲染器（与审计/反馈回放一致）；记忆更新卡片可直达设置的「AI 记忆」Tab
  const renderDialogueContentItem = useMemo(() => buildContentItemRenderers({
    onManageMemory: () => {
      setPreferenceTab('memory');
      setPreferenceVisible(true);
    },
  }), []);

  const roleConfig = useMemo(() => ({
    user: {
      name: user?.nickname || user?.username || '我',
      avatar: user?.avatar || undefined,
    },
    assistant: { name: 'AI 助手', avatar: AI_AVATAR },
    system: { name: '系统', avatar: AI_AVATAR },
  }), [user?.nickname, user?.username, user?.avatar]);

  const editingMessage = messages.find((message) => (message as Record<string, unknown>).editing && message.role === 'user');
  const submitMessageEdit = useEventCallback(handleEditAndResend);
  const renderMessageEdit = useCallback(<T extends { inputContents?: Array<{ type: string; text?: string }> }>(props: T) => {
    const defaultText = props.inputContents?.find((c) => c.type === 'text')?.text ?? '';
    const editingMsg = editingMessage;
    if (!editingMsg) return null;
    return (
      <MessageEditWidget
        msgId={editingMsg.id}
        defaultText={defaultText}
        onSubmit={submitMessageEdit}
        onCancel={handleEditCancel}
      />
    );
  }, [editingMessage, submitMessageEdit, handleEditCancel]);

  const activeConv = conversations.find((c) => c.id === activeConvId);

  /** 当前会话关联的智能体（展示开场白 / 建议问题 / 头部徽标） */
  const agentQuery = useAiAgentDetail(activeConv?.agentId ?? null);
  const activeAgent = activeConv?.agentId ? agentQuery.data : undefined;

  const dialogueRenderConfig = useDialogueRenderConfig({
    branchInfo, generating, onSwitchBranch: handleSwitchBranch, speakingMsgId, onToggleSpeak: handleToggleSpeak,
  });

  const renameConversation = useEventCallback(actions.rename.open);
  const togglePin = useEventCallback(actions.handleTogglePin);
  const toggleArchive = useEventCallback(actions.handleToggleArchive);
  const editTags = useEventCallback(actions.tags.open);
  const shareConversation = useEventCallback(actions.share.open);
  const exportConversation = useEventCallback(actions.handleExportConversation);
  const deleteConversation = useEventCallback(actions.handleDeleteConversation);
  const sidebarActions = useMemo<ConversationActionHandlers>(() => ({
    onRename: renameConversation, onTogglePin: togglePin, onToggleArchive: toggleArchive, onEditTags: editTags,
    onShare: shareConversation, onExport: exportConversation, onDelete: deleteConversation,
  }), [renameConversation, togglePin, toggleArchive, editTags, shareConversation, exportConversation, deleteConversation]);
  const toggleArchived = useCallback(() => setShowArchived((value) => !value), []);
  const newConversation = useEventCallback(() => { void actions.handleNewConversation(); });
  const loadMore = useEventCallback(() => { void conversationsQuery.fetchNextPage(); });
  const selectTemplate = useEventCallback(actions.handleSelectTemplate);
  const applyTemplate = useEventCallback(actions.handleApplyTemplate);
  const setKb = useEventCallback(actions.handleSetKb);
  const openArena = useCallback(() => setArenaVisible(true), []);
  const openPreference = useCallback(() => { setPreferenceTab('instructions'); setPreferenceVisible(true); }, []);
  const openSettings = useCallback(() => setSettingsVisible(true), []);
  const sendText = useEventCallback((text: string) => { void handleMessageSend({ text }); });
  const sendMessage = useEventCallback((content: Parameters<typeof handleMessageSend>[0]) => { void handleMessageSend(content); });

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
        <ConversationSidebar
          rows={convRows}
          activeConvId={activeConvId}
          onSelect={setActiveConvId}
          showArchived={showArchived}
          onToggleArchived={toggleArchived}
          onNewConversation={newConversation}
          searchKeyword={searchKeyword}
          onSearchChange={setSearchKeyword}
          loading={conversationsQuery.isLoading}
          hasNextPage={conversationsQuery.hasNextPage}
          isFetchingNextPage={conversationsQuery.isFetchingNextPage}
          onLoadMore={loadMore}
          actions={sidebarActions}
        />
      )}
      detail={(
        <>
          <MasterDetailLayout.Header
            extra={
              <ChatHeaderActions
                activeConv={activeConv}
                promptTemplates={promptTemplates}
                onSelectTemplate={selectTemplate}
                onApplyTemplate={applyTemplate}
                knowledgeBases={knowledgeBases}
                onSetKb={setKb}
                onOpenArena={openArena}
                onOpenPreference={openPreference}
                mode={mode}
                onModeChange={setMode}
                align={align}
                onAlignChange={setAlign}
                onOpenSettings={openSettings}
              />
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
                  {/* isLoading = 无缓存首载;后台 refetch(saved 落库/停止生成等)不得卸载对话组件,否则整屏闪一下 */}
                  {messagesQuery.isLoading ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                      <Spin size="large" />
                    </div>
                  ) : messages.length === 0 ? (
                    <ChatWelcome agent={activeAgent} onAsk={(q) => void handleMessageSend({ text: q })} />
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
                        const dbId = dbIdOf(msg.id);
                        if (!dbId || !activeConvId) { Toast.success('感谢您的正向反馈'); return; }
                        void api(aiConversationContract.submitFeedback, { params: { id: activeConvId, msgId: dbId }, body: { feedback: 1 } })
                          .then(() => Toast.success('感谢您的正向反馈'));
                      }}
                      onMessageBadFeedback={(msg) => {
                        if (!msg) return;
                        const dbId = dbIdOf(msg.id);
                        if (!dbId || !activeConvId) { Toast.info('感谢您的反馈，我们会持续改进'); return; }
                        void api(aiConversationContract.submitFeedback, { params: { id: activeConvId, msgId: dbId }, body: { feedback: -1 } }).catch(() => {});
                        actions.dislike.open(dbId);
                      }}
                      messageEditRender={renderMessageEdit}
                      onMessageDelete={(msg) => {
                        if (!msg || !activeConvId) return;
                        const dbId = dbIdOf(msg.id);
                        // Semi 已在 UI 上删除该消息（onChatsChange）；后台级联删除该消息及之后所有消息
                        if (dbId) {
                          void api(aiConversationContract.removeMessageCascade, { params: { id: activeConvId, msgId: dbId } }).catch(() => {});
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

                <ChatComposer
                  generating={generating}
                  modelOptions={modelOptions}
                  visionEnabled={!!selectedCapabilities?.vision}
                  pendingImages={pendingImages}
                  setPendingImages={setPendingImages}
                  recording={recording}
                  sttDraft={sttDraft}
                  onSttDraftChange={setSttDraft}
                  onToggleRecording={handleToggleRecording}
                  onSendText={sendText}
                  onMessageSend={sendMessage}
                  onStopGenerate={handleStopGenerate}
                  onConfigureChange={setConfigureValues}
                />
              </div>
            </div>
          </MasterDetailLayout.Body>
        </>
      )}
    />
    <UserAiConfigModal
      visible={settingsVisible}
      onClose={() => setSettingsVisible(false)}
      onSaved={() => {
        void queryClient.invalidateQueries({ queryKey: aiUserConfigKeys.all });
      }}
    />
    <AiSettingsModal visible={preferenceVisible} initialTab={preferenceTab} onClose={() => setPreferenceVisible(false)} />
    <ShareModal convId={actions.share.convId} onClose={actions.share.close} />
    <ArenaModal visible={arenaVisible} onClose={() => setArenaVisible(false)} models={chatModels} />
    <RenameConversationModal
      visible={actions.rename.convId !== null}
      value={actions.rename.text}
      onChange={actions.rename.setText}
      onOk={() => void actions.rename.submit()}
      onCancel={actions.rename.close}
    />
    <DislikeReasonModal
      visible={actions.dislike.msgId !== null}
      reasons={dislikeReasons}
      onSubmit={actions.dislike.submit}
      onCancel={actions.dislike.close}
    />
    <PromptVariablesModal
      template={actions.varFill.template}
      formApiRef={actions.varFill.formApiRef}
      onOk={actions.varFill.submit}
      onCancel={actions.varFill.close}
    />
    <ConversationTagsModal
      visible={actions.tags.convId !== null}
      value={actions.tags.draft}
      onChange={actions.tags.setDraft}
      onOk={() => void actions.tags.submit()}
      onCancel={actions.tags.close}
    />
    </>
  );
}