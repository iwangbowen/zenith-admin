import { useEffect, useRef, useState } from 'react';
import { Play } from 'lucide-react';
import { Spin, Typography } from '@douyinfe/semi-ui';
import { fetchProtectedFile, formatFileSize } from '@/utils/file-utils';
import type { ChatMessage } from '@zenith/shared';
import { getMessageExtra } from '../utils';

const { Text } = Typography;

/** 视频消息气泡：点击加载（受保护文件走 blob）后内联播放 */
export function VideoMessage({ msg, isSelf }: Readonly<{ msg: ChatMessage; isSelf: boolean }>) {
  const asset = getMessageExtra(msg)?.asset ?? null;
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
  }, []);

  const handleLoad = async () => {
    if (videoUrl || loading) return;
    setLoading(true);
    try {
      const blob = await fetchProtectedFile(msg.content);
      const url = URL.createObjectURL(blob);
      objectUrlRef.current = url;
      setVideoUrl(url);
    } catch {
      setVideoUrl(null);
    } finally {
      setLoading(false);
    }
  };

  // 按素材宽高比约束占位区域，缺省 16:9
  const maxW = 280;
  const ratio = asset?.width && asset?.height ? asset.height / asset.width : 9 / 16;
  const height = Math.min(280, Math.round(maxW * ratio));

  if (videoUrl) {
    return (
      <video
        src={videoUrl}
        controls
        autoPlay
        style={{ maxWidth: maxW, maxHeight: 320, borderRadius: 8, display: 'block', background: '#000' }}
      >
        <track kind="captions" />
      </video>
    );
  }

  return (
    <button
      type="button"
      onClick={() => { void handleLoad(); }}
      aria-label="播放视频"
      style={{
        position: 'relative',
        width: maxW,
        height,
        border: 'none',
        borderRadius: 8,
        cursor: 'pointer',
        background: 'linear-gradient(135deg, #2b2b2b, #444)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        color: '#fff',
        overflow: 'hidden',
      }}
    >
      {loading ? (
        <Spin />
      ) : (
        <span
          style={{
            width: 44, height: 44, borderRadius: '50%',
            background: 'rgba(255,255,255,0.22)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Play size={22} style={{ marginLeft: 2 }} />
        </span>
      )}
      <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)', maxWidth: maxW - 24, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {asset?.name ?? '视频'}{asset?.size ? ` · ${formatFileSize(asset.size)}` : ''}
      </Text>
    </button>
  );
}
