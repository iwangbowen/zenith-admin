import { Typography } from '@douyinfe/semi-ui';
import type { AiFeedbackContext } from '@zenith/shared/ai';
import AppModal from '@/components/AppModal';
import AiMessagesViewer from './AiMessagesViewer';

const { Text } = Typography;

interface AiConversationContextModalProps {
  visible: boolean;
  /** 上下文查询进行中 */
  loading: boolean;
  /** 目标消息前后的会话上下文（反馈 / 审计接口同一形态） */
  context: AiFeedbackContext | undefined;
  onClose: () => void;
  /** 目标消息标签文案与颜色（审计缺省，反馈页标「被反馈」红色） */
  targetLabel?: string;
  targetColor?: 'orange' | 'red';
}

/** 管理端「对话上下文」弹窗：AI 审计与 AI 反馈页共用 */
export function AiConversationContextModal({ visible, loading, context, onClose, targetLabel, targetColor }: Readonly<AiConversationContextModalProps>) {
  return (
    <AppModal
      title={context?.conversationTitle ? `对话上下文 — ${context.conversationTitle}` : '对话上下文'}
      visible={visible}
      onCancel={onClose}
      footer={null}
      width={640}
      closeOnEsc
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: '32px 0' }}>
          <Text type="tertiary">加载中…</Text>
        </div>
      ) : (
        <AiMessagesViewer
          messages={context?.messages ?? []}
          targetMsgId={context?.targetMsgId}
          targetLabel={targetLabel}
          targetColor={targetColor}
          userMeta={context?.user}
        />
      )}
    </AppModal>
  );
}

export default AiConversationContextModal;
