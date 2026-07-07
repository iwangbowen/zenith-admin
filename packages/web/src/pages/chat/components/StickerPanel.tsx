import { useRef } from 'react';
import { Button, Empty, Spin, Toast, Typography } from '@douyinfe/semi-ui';
import { Plus, X } from 'lucide-react';
import { request } from '@/utils/request';
import { useAddChatCustomEmoji, useChatCustomEmojis, useDeleteChatCustomEmoji } from '@/hooks/queries/chat';
import type { ChatCustomEmoji } from '@zenith/shared';

const { Text } = Typography;

/** 自定义表情（收藏贴图）面板：网格展示 + 上传 + 删除，点击发送 */
export function StickerPanel({
  onSelect,
}: Readonly<{
  onSelect: (emoji: ChatCustomEmoji) => void;
}>) {
  const emojisQuery = useChatCustomEmojis();
  const addMutation = useAddChatCustomEmoji();
  const deleteMutation = useDeleteChatCustomEmoji();
  const fileRef = useRef<HTMLInputElement>(null);
  const emojis = emojisQuery.data ?? [];

  const handleUpload = async (file: File) => {
    if (!file.type.startsWith('image/')) { Toast.warning('仅支持图片文件'); return; }
    if (file.size > 5 * 1024 * 1024) { Toast.warning('表情图片不能超过 5MB'); return; }
    const fd = new FormData();
    fd.append('file', file);
    const uploadRes = await request.postForm<{ id: string; url: string; originalName: string; size: number }>('/api/files/upload-one', fd);
    if (uploadRes.code !== 0 || !uploadRes.data) { Toast.error('上传失败'); return; }
    try {
      await addMutation.mutateAsync({
        url: uploadRes.data.url,
        fileId: uploadRes.data.id ?? null,
        name: uploadRes.data.originalName,
      });
    } catch {
      return;
    }
    Toast.success('已添加表情');
  };

  return (
    <div style={{ width: 320, maxHeight: 300, overflowY: 'auto', padding: 10, boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <Text strong style={{ fontSize: 12, flex: 1 }}>收藏的表情（{emojis.length}）</Text>
        <Button
          size="small"
          theme="borderless"
          icon={<Plus size={14} />}
          loading={addMutation.isPending}
          onClick={() => fileRef.current?.click()}
        >
          上传
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleUpload(file);
            e.target.value = '';
          }}
        />
      </div>
      {emojisQuery.isLoading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}><Spin /></div>
      )}
      {!emojisQuery.isLoading && emojis.length === 0 && (
        <Empty description={<span style={{ fontSize: 12 }}>暂无收藏表情<br />可上传图片或在聊天图片上右键「收藏为表情」</span>} imageStyle={{ width: 56 }} />
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        {emojis.map((emoji) => (
          <span key={emoji.id} style={{ position: 'relative', display: 'inline-flex' }}>
            <button
              type="button"
              onClick={() => onSelect(emoji)}
              title={emoji.name ?? '表情'}
              style={{
                width: '100%', aspectRatio: '1', border: '1px solid var(--semi-color-border)', borderRadius: 8,
                background: 'var(--semi-color-bg-2)', cursor: 'pointer', padding: 4, overflow: 'hidden',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <img src={emoji.url} alt={emoji.name ?? '表情'} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
            </button>
            <button
              type="button"
              aria-label="删除表情"
              onClick={() => { void deleteMutation.mutateAsync(emoji.id).then(() => Toast.success('已删除')).catch(() => undefined); }}
              style={{
                position: 'absolute', top: -6, right: -6, width: 16, height: 16, borderRadius: '50%',
                border: 'none', background: 'var(--semi-color-danger)', color: '#fff', cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0,
              }}
            >
              <X size={10} />
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}
