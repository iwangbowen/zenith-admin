import { useRef, useState, useEffect } from 'react';
import { Play, Pause } from 'lucide-react';
import { fetchProtectedFile } from '@/utils/file-utils';
import type { ChatMessage } from '@zenith/shared';
import { getMessageExtra } from '../utils';

/** 秒数格式化为 m:ss 或 N″ */
function formatDuration(sec: number): string {
  if (!sec || sec <= 0) return '0″';
  if (sec < 60) return `${sec}″`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}'${String(s).padStart(2, '0')}″`;
}

/** 装饰性声波条（稳定 key，避免索引 key） */
const VOICE_BARS = Array.from({ length: 14 }, (_, i) => ({ id: `bar-${i}`, seed: i * 7 }));

/** 语音消息气泡：播放/暂停 + 时长 + 简易声波 */
export function VoiceMessage({ msg, isSelf }: Readonly<{ msg: ChatMessage; isSelf: boolean }>) {
  const asset = getMessageExtra(msg)?.asset ?? null;
  const duration = Math.max(1, Math.round(asset?.duration ?? 0));
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => () => {
    audioRef.current?.pause();
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
  }, []);

  const ensureAudio = async (): Promise<HTMLAudioElement | null> => {
    if (audioRef.current) return audioRef.current;
    setLoading(true);
    try {
      // 走受保护文件接口取 blob，兼容鉴权后的音频流
      const blob = await fetchProtectedFile(msg.content);
      const url = URL.createObjectURL(blob);
      objectUrlRef.current = url;
      const audio = new Audio(url);
      audio.onended = () => setPlaying(false);
      audio.onpause = () => setPlaying(false);
      audio.onplay = () => setPlaying(true);
      audioRef.current = audio;
      return audio;
    } catch {
      return null;
    } finally {
      setLoading(false);
    }
  };

  const toggle = async () => {
    const audio = await ensureAudio();
    if (!audio) return;
    if (audio.paused) {
      void audio.play().catch(() => setPlaying(false));
    } else {
      audio.pause();
    }
  };

  // 宽度随时长增长（90~220px）
  const width = Math.min(220, 90 + duration * 3);
  const fg = isSelf ? '#fff' : 'var(--semi-color-text-0)';
  const barColor = isSelf ? 'rgba(255,255,255,0.85)' : 'var(--semi-color-primary)';

  return (
    <button
      type="button"
      onClick={() => { void toggle(); }}
      style={{
        background: isSelf ? 'var(--semi-color-primary)' : 'var(--semi-color-fill-1)',
        color: fg,
        padding: '8px 12px',
        borderRadius: isSelf ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
        border: 'none',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width,
        minWidth: 90,
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {playing ? <Pause size={16} /> : <Play size={16} />}
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 2, flex: 1, height: 18, opacity: loading ? 0.5 : 1 }}>
        {VOICE_BARS.map((bar) => {
          const h = 4 + ((bar.seed + duration) % 12);
          return (
            <span
              key={bar.id}
              style={{ width: 2, height: h, borderRadius: 2, background: barColor, opacity: playing ? 0.9 : 0.55 }}
            />
          );
        })}
      </span>
      <span style={{ fontSize: 12, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{formatDuration(duration)}</span>
    </button>
  );
}
