import React, { useCallback, useMemo } from 'react';
import { Button, Space, Tooltip } from '@douyinfe/semi-ui';
import type { RenderActionProps, RenderAvatarProps, RenderTitleProps } from '@douyinfe/semi-ui/lib/es/aiChatDialogue/interface';
import { ChevronLeft, ChevronRight, Square, Volume2 } from 'lucide-react';
import { UserAvatar } from '@/components/UserAvatar';
import { formatMessageTime, type ChatMessage as Message } from '../message-adapters';
import type { BranchInfo } from '../branch-tree';
import { dbIdOf } from '../chat-utils';

interface UseDialogueRenderConfigOptions {
  branchInfo: Map<number, BranchInfo>;
  generating: boolean;
  onSwitchBranch: (siblingDbId: number) => Promise<void>;
  speakingMsgId: string | null;
  onToggleSpeak: (msg: Message) => void;
}

/**
 * AIChatDialogue 的 dialogueRenderConfig：用户头像对齐全站、操作栏追加 TTS 朗读、
 * 标题行追加模型标注 / 时间 / 分支切换器（‹ i/n ›）。
 */
export function useDialogueRenderConfig({ branchInfo, generating, onSwitchBranch, speakingMsgId, onToggleSpeak }: UseDialogueRenderConfigOptions) {
  /** 消息标题行：默认标题 + 模型标注（assistant）+ 时间 + 分支切换器（‹ i/n ›） */
  const renderDialogueTitle = useCallback((props: RenderTitleProps) => {
    const msg = props.message;
    const dbId = dbIdOf(msg?.id);
    const info = dbId ? branchInfo.get(dbId) : undefined;
    // 每条回复标注实际使用的模型(failover 场景下与选择器所选可能不同)
    const modelTag = msg?.role === 'assistant' && msg.model ? (
      <span style={{ fontSize: 11, color: 'var(--semi-color-text-2)', fontWeight: 'normal' }}>{msg.model}</span>
    ) : null;
    const timeTag = msg?.createdAt ? (
      <span style={{ fontSize: 11, color: 'var(--semi-color-text-2)', fontWeight: 'normal' }}>{formatMessageTime(msg.createdAt)}</span>
    ) : null;
    if (!info && !modelTag && !timeTag) return props.defaultTitle;
    return (
      <Space spacing={4}>
        {props.defaultTitle}
        {modelTag}
        {timeTag}
        {info && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 12, color: 'var(--semi-color-text-2)' }}>
          <Button
            theme="borderless"
            size="small"
            disabled={info.index === 0 || generating}
            icon={<ChevronLeft size={12} />}
            style={{ height: 18, width: 18, minWidth: 18, padding: 0 }}
            onClick={() => void onSwitchBranch(info.siblings[info.index - 1])}
          />
          {info.index + 1}/{info.siblings.length}
          <Button
            theme="borderless"
            size="small"
            disabled={info.index === info.siblings.length - 1 || generating}
            icon={<ChevronRight size={12} />}
            style={{ height: 18, width: 18, minWidth: 18, padding: 0 }}
            onClick={() => void onSwitchBranch(info.siblings[info.index + 1])}
          />
        </span>
        )}
      </Space>
    );
  }, [branchInfo, generating, onSwitchBranch]);

  return useMemo(() => ({
    // 用户消息头像与全站一致：有头像显示图片，无头像回退首字母 + 哈希色（Semi 默认无图时是空头像）
    renderDialogueAvatar: ({ role, message, defaultAvatar }: RenderAvatarProps) => {
      if (message?.role !== 'user') return defaultAvatar;
      const className = React.isValidElement(defaultAvatar)
        ? (defaultAvatar.props as { className?: string }).className
        : undefined;
      return (
        <UserAvatar
          className={className}
          name={role?.name ?? '我'}
          avatar={role?.avatar}
          size={null}
          semiSize="extra-small"
        />
      );
    },
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
            onClick={() => onToggleSpeak(msg)}
          />
        </Tooltip>
      ) : null;
      return <div className={props.className}>{copyNode}{resetNode}{likeNode}{dislikeNode}{speakNode}{moreNode}</div>;
    },
    // 标题行：追加分支切换器（‹ i/n ›）
    renderDialogueTitle,
  }), [renderDialogueTitle, speakingMsgId, onToggleSpeak]);
}
