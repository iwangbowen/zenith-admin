import { useEffect, useState } from 'react';
import { Button, Spin, Toast, Typography } from '@douyinfe/semi-ui';
import { QRCodeSVG } from 'qrcode.react';
import { Copy, RotateCcw } from 'lucide-react';
import { AppModal } from '@/components/AppModal';
import { useChatGroupInvite, useResetChatGroupInvite } from '@/hooks/queries/chat';
import type { ChatGroupInvite } from '@zenith/shared';

const { Text } = Typography;

function inviteUrl(token: string): string {
  return `${globalThis.location.origin}/chat?invite=${token}`;
}

/** 群邀请弹窗：链接 + 二维码 + 复制 + 重置 */
export function GroupInviteModal({
  conversationId, groupName, visible, onClose,
}: Readonly<{
  conversationId: number;
  groupName: string;
  visible: boolean;
  onClose: () => void;
}>) {
  const [invite, setInvite] = useState<ChatGroupInvite | null>(null);
  const getInviteMutation = useChatGroupInvite();
  const resetInviteMutation = useResetChatGroupInvite();

  useEffect(() => {
    if (!visible) return;
    getInviteMutation.mutateAsync(conversationId).then(setInvite).catch(() => setInvite(null));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, conversationId]);

  const url = invite ? inviteUrl(invite.token) : '';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(`邀请你加入群聊「${groupName}」，打开链接即可加入：${url}`);
      Toast.success('邀请链接已复制');
    } catch {
      Toast.error('复制失败，请手动复制');
    }
  };

  const handleReset = async () => {
    try {
      const next = await resetInviteMutation.mutateAsync(conversationId);
      setInvite(next);
      Toast.success('已重置，旧链接立即失效');
    } catch {
      /* Toast handled by request layer */
    }
  };

  return (
    <AppModal title={`邀请加入「${groupName}」`} visible={visible} onCancel={onClose} footer={null} width={400}>
      {getInviteMutation.isPending && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}><Spin /></div>
      )}
      {!getInviteMutation.isPending && invite && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <div style={{ padding: 12, background: '#fff', borderRadius: 8, border: '1px solid var(--semi-color-border)' }}>
            <QRCodeSVG value={url} size={168} />
          </div>
          <Text
            copyable={{ content: url }}
            type="tertiary"
            style={{ fontSize: 12, wordBreak: 'break-all', textAlign: 'center' }}
          >
            {url}
          </Text>
          <Text type="tertiary" style={{ fontSize: 11 }}>
            {invite.expiresAt ? `有效期至 ${invite.expiresAt}` : '永久有效'} · 已使用 {invite.usedCount} 次
          </Text>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button type="primary" icon={<Copy size={14} />} onClick={() => { void handleCopy(); }}>复制邀请</Button>
            <Button type="tertiary" icon={<RotateCcw size={14} />} loading={resetInviteMutation.isPending} onClick={() => { void handleReset(); }}>重置链接</Button>
          </div>
        </div>
      )}
    </AppModal>
  );
}
