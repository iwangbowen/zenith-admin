import React from 'react';
import type { RenderAvatarProps } from '@douyinfe/semi-ui/lib/es/aiChatDialogue/interface';
import { UserAvatar } from '@/components/UserAvatar';

/**
 * AIChatDialogue 的用户消息头像渲染：与全站一致——有头像显示图片，无头像回退首字母 + 哈希色
 * （Semi 默认无图时是空头像）；非用户消息沿用默认头像。聊天页与只读回放共用。
 */
export function renderUserDialogueAvatar(fallbackName: string) {
  return ({ role, message, defaultAvatar }: RenderAvatarProps) => {
    if (message?.role !== 'user') return defaultAvatar;
    const className = React.isValidElement(defaultAvatar)
      ? (defaultAvatar.props as { className?: string }).className
      : undefined;
    return (
      <UserAvatar
        className={className}
        name={role?.name ?? fallbackName}
        avatar={role?.avatar}
        size={null}
        semiSize="extra-small"
      />
    );
  };
}
