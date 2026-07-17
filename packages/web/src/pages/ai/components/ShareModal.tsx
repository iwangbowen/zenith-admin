import { useState } from 'react';
import { Button, Input, Select, Space, Toast, Typography } from '@douyinfe/semi-ui';
import { Copy, Link2Off } from 'lucide-react';
import AppModal from '@/components/AppModal';
import { useConversationShare, useCreateConversationShare, useRevokeConversationShare } from '@/hooks/queries/ai-extras';

const { Text } = Typography;

interface ShareModalProps {
  readonly convId: number | null;
  readonly onClose: () => void;
}

/** 对话分享弹窗：生成/复制/取消只读分享链接 */
export default function ShareModal({ convId, onClose }: ShareModalProps) {
  const [expiresDays, setExpiresDays] = useState(0);
  const shareQuery = useConversationShare(convId);
  const createMutation = useCreateConversationShare();
  const revokeMutation = useRevokeConversationShare();
  const share = shareQuery.data ?? null;
  const shareUrl = share ? `${globalThis.location.origin}${share.url}` : '';

  const handleCreate = async () => {
    if (!convId) return;
    await createMutation.mutateAsync({ convId, expiresDays });
    Toast.success('分享链接已生成');
  };

  const handleCopy = () => {
    void navigator.clipboard.writeText(shareUrl).then(() => Toast.success('已复制链接'));
  };

  const handleRevoke = async () => {
    if (!convId) return;
    await revokeMutation.mutateAsync(convId);
    Toast.success('已取消分享');
  };

  return (
    <AppModal
      title="分享对话"
      visible={convId !== null}
      onCancel={onClose}
      footer={null}
      width={520}
      closeOnEsc
    >
      <Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 12 }}>
        生成只读链接后，任何拿到链接的人无需登录即可查看当前对话内容（后续新消息也会可见）
      </Text>
      {share ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Input value={shareUrl} readOnly suffix={<Button theme="borderless" size="small" icon={<Copy size={14} />} onClick={handleCopy} />} />
          <Text type="tertiary" size="small">
            {share.expiresAt ? `有效期至 ${share.expiresAt}` : '永久有效'} · 创建于 {share.createdAt}
          </Text>
          <Space>
            <Button icon={<Copy size={14} />} type="primary" onClick={handleCopy}>复制链接</Button>
            <Button icon={<Link2Off size={14} />} type="danger" loading={revokeMutation.isPending} onClick={() => void handleRevoke()}>取消分享</Button>
          </Space>
        </div>
      ) : (
        <Space>
          <Select
            value={expiresDays}
            onChange={(v) => setExpiresDays(Number(v))}
            optionList={[
              { value: 0, label: '永久有效' },
              { value: 7, label: '7 天' },
              { value: 30, label: '30 天' },
            ]}
            style={{ width: 140 }}
          />
          <Button type="primary" loading={createMutation.isPending} onClick={() => void handleCreate()}>
            生成分享链接
          </Button>
        </Space>
      )}
    </AppModal>
  );
}
