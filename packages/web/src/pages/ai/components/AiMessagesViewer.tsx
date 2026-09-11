import { useMemo } from 'react';
import { AIChatDialogue, Tag, Typography } from '@douyinfe/semi-ui';
import type { RenderTitleProps } from '@douyinfe/semi-ui/lib/es/aiChatDialogue/interface';
import type { AiMessage } from '@zenith/shared/ai';
import { renderUserDialogueAvatar } from '../chat/dialogue-avatar';
import { AI_AVATAR, convertApiMessage, formatMessageTime } from '../chat/message-adapters';
import { buildContentItemRenderers } from '../chat/content-renderers';

const { Text } = Typography;

interface AiMessagesViewerProps {
  readonly messages: AiMessage[];
  /** 高亮的目标消息 ID（审计/反馈上下文定位） */
  readonly targetMsgId?: number | null;
  /** 目标消息标签文案与颜色 */
  readonly targetLabel?: string;
  readonly targetColor?: 'orange' | 'red';
  /** 发送人（会话属主）信息：展示真实用户名与头像 */
  readonly userMeta?: { username: string; nickname: string | null; avatar: string | null } | null;
  readonly maxHeight?: number;
}

/**
 * 只读对话回放：与智能对话页共用同一套消息适配层（message-adapters），
 * 思维链 / 图片 / 模型标注 / 时间的渲染形态与聊天页保持一致。
 */
export default function AiMessagesViewer({ messages, targetMsgId, targetLabel = '目标消息', targetColor = 'orange', userMeta, maxHeight = 480 }: AiMessagesViewerProps) {
  const chats = useMemo(() => messages.map(convertApiMessage), [messages]);

  // 与聊天页共用内容项渲染器（工具调用 / 记忆更新 / 知识库引用）；只读场景无管理入口
  const contentRenderers = useMemo(() => buildContentItemRenderers(), []);

  const roleConfig = useMemo(() => ({
    user: {
      name: userMeta ? (userMeta.nickname || userMeta.username) : '用户',
      avatar: userMeta?.avatar || undefined,
    },
    assistant: { name: 'AI 助手', avatar: AI_AVATAR },
    system: { name: '系统', avatar: AI_AVATAR },
  }), [userMeta]);

  const dialogueRenderConfig = useMemo(() => ({
    renderDialogueAvatar: renderUserDialogueAvatar('用户'),
    // 标题行与聊天页对齐：角色名 + 模型标注 + 完整时间;审计场景追加目标消息标记
    renderDialogueTitle: (props: RenderTitleProps) => {
      const msg = props.message;
      const isTarget = targetMsgId != null && msg?.id === `api-${targetMsgId}`;
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {props.defaultTitle}
          {msg?.role === 'assistant' && msg.model && (
            <Text type="tertiary" size="small" style={{ fontWeight: 'normal' }}>{msg.model}</Text>
          )}
          {msg?.createdAt && (
            <Text type="tertiary" size="small" style={{ fontWeight: 'normal' }}>{formatMessageTime(msg.createdAt)}</Text>
          )}
          {isTarget && <Tag color={targetColor} size="small">{targetLabel}</Tag>}
        </span>
      );
    },
    // 只读回放：隐藏复制/重置/点赞等操作栏
    renderDialogueAction: () => null,
  }), [targetMsgId, targetLabel, targetColor]);

  return (
    <div style={{ maxHeight, overflowY: 'auto' }}>
      <AIChatDialogue
        chats={chats}
        roleConfig={roleConfig}
        align="leftRight"
        mode="bubble"
        dialogueRenderConfig={dialogueRenderConfig}
        renderDialogueContentItem={contentRenderers}
      />
    </div>
  );
}
