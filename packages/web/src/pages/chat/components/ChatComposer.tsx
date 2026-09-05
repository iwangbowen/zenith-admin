import { lazy, Suspense, useCallback, useRef, useState } from 'react';
import type { ClipboardEvent, RefObject } from 'react';
import { Button, Tooltip, Typography } from '@douyinfe/semi-ui';
import { BarChart3, CornerDownLeft, ImagePlus, Mic, Paperclip, Send, Smile } from 'lucide-react';
import type { ChatCustomEmoji, ChatGroupMember, ChatMessage } from '@zenith/shared/chat';
import type { PendingFile, PendingImage, Setter, TypingUsersMap } from '../types';
import { createComposerKeyDownHandler, getReplyPreviewText } from '../utils-state';
import type { VoiceRecorderResult } from '../useVoiceRecorder';
import type { MentionInput } from '../hooks/useMentionInput';
import type { MuteState } from '../hooks/useMuteState';
import { ComposerExtras } from './ComposerExtras';
import { MultiSelectActionBar } from './MultiSelectActionBar';
import { PendingAttachments } from './PendingAttachments';
import { MentionPopup } from './MentionPopup';
import { TypingIndicator } from './TypingIndicator';

// emoji-mart（~490KB 含全量表情元数据）仅在用户首次打开表情浮层时才加载
const ComposerEmojiPicker = lazy(() => import('./ComposerEmojiPicker').then((m) => ({ default: m.ComposerEmojiPicker })));

const { Text } = Typography;

interface ChatComposerProps {
  isQuick: boolean;
  activeConvId: number | null;
  input: string;
  setInput: Setter<string>;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  sending: boolean;
  muteState: MuteState;
  replyTo: ChatMessage | null;
  setReplyTo: Setter<ChatMessage | null>;
  typingUsers: TypingUsersMap;
  // ── 待发附件 ──
  pendingImages: PendingImage[];
  pendingFiles: PendingFile[];
  handleRemovePendingImage: (id: string) => void;
  handleRemovePendingFile: (id: string) => void;
  setPreviewSrcList: Setter<string[]>;
  setPreviewCurrentIndex: Setter<number>;
  setPreviewVisible: Setter<boolean>;
  // ── 表情 / 贴纸 ──
  emojiVisible: boolean;
  setEmojiVisible: Setter<boolean>;
  emojiContainerRef: RefObject<HTMLDivElement | null>;
  emojiPickerRef: RefObject<HTMLDivElement | null>;
  sendSticker: (emoji: ChatCustomEmoji) => Promise<void>;
  // ── 工具栏动作 ──
  handleSelectImages: (files: File[]) => void;
  handleSelectFile: (files: File[]) => void;
  setShowVoteModal: Setter<boolean>;
  saveDraft: (convId: number, text: string) => void;
  voiceRecorder: VoiceRecorderResult;
  // ── 输入与发送 ──
  mention: MentionInput;
  insertMention: (member: ChatGroupMember) => void;
  handleSend: () => Promise<void>;
  handleInputPaste: (e: ClipboardEvent<HTMLTextAreaElement>) => void;
  handleTyping: (value: string) => void;
  // ── 多选模式 ──
  multiSelectMode: boolean;
  selectedMessageIds: number[];
  handleForwardSelected: (mode: 'merge' | 'individual') => void;
  handleFavoriteSelected: () => void;
  handleDeleteSelected: () => void;
  handleExitMultiSelect: () => void;
}

/** 输入区：多选操作条 / 回复引用条、待发附件、工具栏（表情 / 图片 / 文件 / 投票 / 扩展 / 录音）、@提及浮层、正在输入与文本框 */
export function ChatComposer({
  isQuick, activeConvId, input, setInput, inputRef, sending, muteState, replyTo, setReplyTo, typingUsers,
  pendingImages, pendingFiles, handleRemovePendingImage, handleRemovePendingFile, setPreviewSrcList, setPreviewCurrentIndex, setPreviewVisible,
  emojiVisible, setEmojiVisible, emojiContainerRef, emojiPickerRef, sendSticker,
  handleSelectImages, handleSelectFile, setShowVoteModal, saveDraft, voiceRecorder,
  mention, insertMention, handleSend, handleInputPaste, handleTyping,
  multiSelectMode, selectedMessageIds, handleForwardSelected, handleFavoriteSelected, handleDeleteSelected, handleExitMultiSelect,
}: Readonly<ChatComposerProps>) {
  const [emojiAnchor, setEmojiAnchor] = useState<{ top: number; left: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileAttachRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = createComposerKeyDownHandler({
    mentionState: mention.mentionState, mentionClosed: mention.mentionClosed, mentionCandidates: mention.mentionCandidates,
    mentionActiveIndex: mention.mentionActiveIndex, setMentionActiveIndex: mention.setMentionActiveIndex,
    mentionListRef: mention.mentionListRef, insertMention, setMentionClosed: mention.setMentionClosed, handleSend,
  });

  const handleEmojiSelect = useCallback((emoji: { native: string }) => {
    const ta = inputRef.current;
    if (!ta) {
      setInput((prev) => prev + emoji.native);
      return;
    }
    const start = ta.selectionStart ?? input.length;
    const end = ta.selectionEnd ?? input.length;
    setInput((prev) => prev.slice(0, start) + emoji.native + prev.slice(end));
    setEmojiVisible(false);
    requestAnimationFrame(() => {
      const pos = start + emoji.native.length;
      ta.setSelectionRange(pos, pos);
      ta.focus();
    });
  }, [input, inputRef, setInput, setEmojiVisible]);

  return (
    <div style={{ padding: isQuick ? '6px 8px' : '4px 8px', borderTop: '1px solid var(--semi-color-border)' }}>
      {multiSelectMode ? (
        <MultiSelectActionBar
          selectedMessageIds={selectedMessageIds} handleForwardSelected={handleForwardSelected} handleFavoriteSelected={handleFavoriteSelected}
          handleDeleteSelected={handleDeleteSelected} handleExitMultiSelect={handleExitMultiSelect}
        />
      ) : (
        <>
      {replyTo && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, padding: '4px 10px', background: 'var(--semi-color-fill-0)', borderRadius: 'var(--semi-border-radius-medium)', fontSize: 12, color: 'var(--semi-color-text-2)' }}>
          <CornerDownLeft size={12} />
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            回复 {replyTo.senderName}：{getReplyPreviewText(replyTo)}
          </span>
          <Button size="small" theme="borderless" type="tertiary" onClick={() => setReplyTo(null)} style={{ padding: '0 4px', height: 'auto', minWidth: 'auto' }}>✕</Button>
        </div>
      )}

      <PendingAttachments
        pendingImages={pendingImages} pendingFiles={pendingFiles} setPreviewSrcList={setPreviewSrcList}
        setPreviewCurrentIndex={setPreviewCurrentIndex} setPreviewVisible={setPreviewVisible} handleRemovePendingImage={handleRemovePendingImage}
        handleRemovePendingFile={handleRemovePendingFile}
      />

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 1, alignItems: 'center' }}>
        <div ref={emojiContainerRef}>
          <Tooltip content="表情">
            <Button
              size="small" theme="borderless" type="tertiary"
              icon={<Smile size={16} />}
              aria-label="表情"
              onClick={() => {
                if (emojiVisible) { setEmojiVisible(false); return; }
                const rect = emojiContainerRef.current?.getBoundingClientRect();
                if (rect) setEmojiAnchor({ top: rect.top, left: rect.left });
                setEmojiVisible(true);
              }}
            />
          </Tooltip>
        </div>
        {emojiVisible && emojiAnchor && (
          <Suspense fallback={null}>
            <ComposerEmojiPicker
              emojiPickerRef={emojiPickerRef} emojiAnchor={emojiAnchor} handleEmojiSelect={handleEmojiSelect}
              sendSticker={sendSticker}
            />
          </Suspense>
        )}

        <Tooltip content="选择图片">
          <Button
            size="small" theme="borderless" type="tertiary"
            icon={<ImagePlus size={16} />}
            aria-label="选择图片"
            onClick={() => fileInputRef.current?.click()}
          />
        </Tooltip>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length > 0) handleSelectImages(files);
            e.target.value = '';
          }}
        />
        <Tooltip content="发送文件">
          <Button
            size="small" theme="borderless" type="tertiary"
            icon={<Paperclip size={16} />}
            aria-label="发送文件"
            loading={false}
            onClick={() => fileAttachRef.current?.click()}
          />
        </Tooltip>
        <Tooltip content="发起投票">
          <Button
            size="small" theme="borderless" type="tertiary"
            icon={<BarChart3 size={16} />}
            aria-label="发起投票"
            onClick={() => setShowVoteModal(true)}
            disabled={!activeConvId}
          />
        </Tooltip>
        <ComposerExtras
          conversationId={activeConvId}
          draft={input}
          onInsert={(text) => {
            setInput((prev) => (prev ? `${prev}${text}` : text));
            inputRef.current?.focus();
          }}
          onScheduled={() => {
            setInput('');
            if (activeConvId) saveDraft(activeConvId, '');
          }}
        />
        {voiceRecorder.supported && (
          <Tooltip content="按住说话（点击开始/结束录音）">
            <Button
              size="small" theme="borderless" type={voiceRecorder.isRecording ? 'primary' : 'tertiary'}
              icon={<Mic size={16} />}
              aria-label={voiceRecorder.isRecording ? '结束录音' : '开始录音'}
              onClick={() => { if (voiceRecorder.isRecording) voiceRecorder.stop(); else void voiceRecorder.start(); }}
              disabled={!activeConvId}
            />
          </Tooltip>
        )}
        {voiceRecorder.isRecording && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 4, padding: '2px 10px', borderRadius: 'var(--semi-border-radius-large)', background: 'var(--semi-color-danger-light-default)' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--semi-color-danger)', animation: 'qcVoicePulse 1s infinite' }} />
            <Text style={{ fontSize: 12, color: 'var(--semi-color-danger)', fontVariantNumeric: 'tabular-nums' }}>
              录音中 {String(Math.floor(voiceRecorder.seconds / 60)).padStart(2, '0')}:{String(voiceRecorder.seconds % 60).padStart(2, '0')} / 01:00
            </Text>
            <Button size="small" theme="borderless" type="tertiary" onClick={() => voiceRecorder.cancel()}>取消</Button>
            <Button size="small" theme="solid" type="primary" icon={<Send size={12} />} onClick={() => voiceRecorder.stop()}>发送</Button>
          </div>
        )}
        <input
          ref={fileAttachRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length > 0) handleSelectFile(files);
            e.target.value = '';
          }}
        />
      </div>

      <div style={{ position: 'relative', flex: 1 }}>
        {mention.mentionState && !mention.mentionClosed && mention.mentionCandidates.length > 0 && (
          <MentionPopup
            mentionListRef={mention.mentionListRef} mentionCandidates={mention.mentionCandidates} mentionActiveIndex={mention.mentionActiveIndex}
            setMentionActiveIndex={mention.setMentionActiveIndex} insertMention={insertMention}
          />
        )}
        {Object.values(typingUsers).length > 0 && (
          <TypingIndicator
            typingUsers={typingUsers}
          />
        )}
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => { setInput(e.target.value); mention.setMentionClosed(false); handleTyping(e.target.value); }}
          onKeyDown={handleKeyDown}
          onPaste={handleInputPaste}
          placeholder={muteState ? muteState.placeholder : '输入消息…'}
          disabled={!!muteState}
          rows={isQuick ? 2 : 3}
          style={{
            width: '100%', resize: 'none', borderRadius: 'var(--semi-border-radius-medium)', padding: '8px 48px 8px 12px',
            border: '1px solid var(--semi-color-border)',
            background: 'var(--semi-color-bg-2)',
            color: 'var(--semi-color-text-0)',
            fontSize: 14, fontFamily: 'inherit', outline: 'none',
            lineHeight: 1.5, boxSizing: 'border-box',
            ...(muteState ? { cursor: 'not-allowed', opacity: 0.6 } : {}),
          }}
        />
        <Button
          theme="solid" type="primary"
          icon={<Send size={14} />}
          aria-label="发送"
          loading={sending}
          disabled={!!muteState || (!input.trim() && pendingImages.length === 0 && pendingFiles.length === 0)}
          onClick={() => { void handleSend(); }}
          style={{
            position: 'absolute', bottom: 8, right: 8,
            borderRadius: 'var(--semi-border-radius-medium)', width: 32, height: 32, padding: 0,
          }}
        />
      </div>
      {!isQuick && (
        <Text type="tertiary" style={{ fontSize: 10, marginTop: 2, display: 'block', opacity: 0.7 }}>Enter 发送 · Shift+Enter 换行 · 支持粘贴图片</Text>
      )}
        </>
      )}
    </div>
  );
}
