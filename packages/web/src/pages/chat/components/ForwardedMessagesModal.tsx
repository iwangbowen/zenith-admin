import { Modal, Typography } from '@douyinfe/semi-ui';
import { getFileTypeIcon } from '@/utils/file-utils';
import type { ChatMessageExtra } from '@zenith/shared';

const { Text } = Typography;

export function ForwardedMessagesModal({
  visible, items, title, onCancel,
}: Readonly<{
  visible: boolean;
  items: NonNullable<ChatMessageExtra['forwardedMessages']>;
  title: string;
  onCancel: () => void;
}>) {
  return (
    <Modal
      title={title}
      visible={visible}
      onCancel={onCancel}
      footer={null}
      width={560}
    >
      <div style={{ maxHeight: 520, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {items.length === 0 && <Text type="tertiary" style={{ textAlign: 'center', display: 'block', padding: '20px 0' }}>暂无消息</Text>}
        {items.map((item, idx) => (
          <div
            key={idx}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              padding: '8px 10px',
              background: 'var(--semi-color-fill-0)',
              borderRadius: 8,
              border: '1px solid var(--semi-color-border)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <Text strong style={{ fontSize: 12 }}>{item.senderName ?? '未知'}</Text>
              {item.createdAt && (
                <Text type="tertiary" style={{ fontSize: 11 }}>{item.createdAt}</Text>
              )}
            </div>
            {item.type === 'image' ? (
              <a
                href={item.content}
                target="_blank"
                rel="noreferrer"
                style={{ display: 'inline-block' }}
              >
                <img
                  src={item.asset?.thumbnailUrl ?? item.content}
                  alt={item.asset?.name ?? '图片'}
                  style={{ maxWidth: '100%', maxHeight: 260, borderRadius: 6, display: 'block', cursor: 'zoom-in' }}
                />
              </a>
            ) : item.type === 'file' ? (
              <a
                href={item.content}
                download={item.asset?.name ?? '文件'}
                style={{ color: 'var(--semi-color-primary)', fontSize: 13, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6 }}
              >
                {getFileTypeIcon(item.asset?.mimeType, 16)}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 380 }}>
                  {item.asset?.name ?? '文件'}
                </span>
              </a>
            ) : (
              <Text style={{ fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{item.content}</Text>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}
