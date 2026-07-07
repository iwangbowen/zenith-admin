import { useState } from 'react';
import { Button, Spin, TextArea, Toast, Typography } from '@douyinfe/semi-ui';
import { Users } from 'lucide-react';
import { AppModal } from '@/components/AppModal';
import { useChatInviteInfo, useJoinChatByInvite } from '@/hooks/queries/chat';

const { Text, Title } = Typography;

/** 邀请链接落地弹窗：展示群概况，加入或提交入群申请 */
export function JoinInviteModal({
  token, onClose, onJoined,
}: Readonly<{
  token: string;
  onClose: () => void;
  /** 直接入群成功（无需审批）回调，参数为群会话 ID */
  onJoined: (conversationId: number) => void;
}>) {
  const infoQuery = useChatInviteInfo(token);
  const joinMutation = useJoinChatByInvite();
  const [message, setMessage] = useState('');
  const info = infoQuery.data;

  const handleJoin = async () => {
    if (!info) return;
    let result: { joined: boolean };
    try {
      result = await joinMutation.mutateAsync({ token, message: message.trim() || undefined });
    } catch {
      return;
    }
    if (result.joined) {
      Toast.success('已加入群聊');
      onJoined(info.conversationId);
    } else {
      Toast.success('申请已提交，等待群主/管理员审批');
    }
    onClose();
  };

  return (
    <AppModal title="加入群聊" visible onCancel={onClose} footer={null} width={380}>
      {infoQuery.isLoading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}><Spin /></div>
      )}
      {!infoQuery.isLoading && !info && (
        <Text type="tertiary" style={{ display: 'block', textAlign: 'center', padding: '24px 0' }}>
          邀请链接不存在、已失效或已过期
        </Text>
      )}
      {info && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <span
            style={{
              width: 56, height: 56, borderRadius: 12, background: 'var(--semi-color-primary-light-default)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Users size={26} style={{ color: 'var(--semi-color-primary)' }} />
          </span>
          <Title heading={5} style={{ margin: 0 }}>{info.groupName ?? '群聊'}</Title>
          <Text type="tertiary" style={{ fontSize: 12 }}>{info.memberCount} 位成员</Text>
          {info.alreadyMember ? (
            <Text type="tertiary">你已在该群聊中</Text>
          ) : (
            <>
              {info.joinApproval && (
                <TextArea
                  placeholder="申请附言（可选，如：我是市场部小王）"
                  rows={2}
                  maxCount={255}
                  value={message}
                  onChange={(v) => setMessage(v)}
                  style={{ width: '100%' }}
                />
              )}
              <Button
                type="primary"
                theme="solid"
                block
                loading={joinMutation.isPending}
                onClick={() => { void handleJoin(); }}
              >
                {info.joinApproval ? '申请加入（需审批）' : '加入群聊'}
              </Button>
            </>
          )}
        </div>
      )}
    </AppModal>
  );
}
