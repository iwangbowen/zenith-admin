import { useEffect, useState } from 'react';
import { Button, Tooltip } from '@douyinfe/semi-ui';
import { Mic, MicOff, Video, VideoOff, MonitorUp, PhoneOff, Minus, Maximize2 } from 'lucide-react';
import { MediaTile } from './MediaTile';
import { callManager } from './callManager';
import type { CallSnapshot } from './callManager';
import type { RtcPeerInfo } from '@zenith/shared';

function formatDuration(startedAt: number | null): string {
  if (!startedAt) return '00:00';
  const sec = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function gridColumns(count: number): number {
  if (count <= 1) return 1;
  if (count <= 4) return 2;
  return 3;
}

export function CallWindow({ snapshot, self }: Readonly<{ snapshot: CallSnapshot; self: RtcPeerInfo }>) {
  const [, force] = useState(0);
  useEffect(() => {
    if (snapshot.phase !== 'connected') return;
    const t = setInterval(() => force((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, [snapshot.phase]);

  const isVideo = snapshot.callType === 'video';
  const remote = snapshot.participants;
  const tileCount = remote.length + 1;
  const cols = gridColumns(tileCount);

  if (snapshot.minimized) {
    return (
      // eslint-disable-next-line no-restricted-syntax -- 通话最小化浮窗的强调投影（最顶层浮动元素）
      <div style={{ position: 'fixed', right: 24, bottom: 24, zIndex: 2000, width: 240, background: 'var(--semi-color-bg-2)', border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-large)', boxShadow: '0 8px 28px rgba(0,0,0,0.28)', padding: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--semi-color-success)', flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {snapshot.mode === 'group' ? (snapshot.conversationName ?? '群通话') : (remote[0]?.info.nickname ?? '通话中')}
          </div>
          <div style={{ fontSize: 12, color: 'var(--semi-color-text-2)', fontVariantNumeric: 'tabular-nums' }}>{formatDuration(snapshot.startedAt)}</div>
        </div>
        <Tooltip content="展开">
          <Button size="small" theme="borderless" type="tertiary" icon={<Maximize2 size={15} />} onClick={() => callManager.setMinimized(false)} />
        </Tooltip>
        <Button size="small" theme="solid" type="danger" icon={<PhoneOff size={15} />} onClick={() => callManager.hangup()} />
      </div>
    );
  }

  const title = snapshot.mode === 'group'
    ? `${snapshot.conversationName ?? '群通话'} · ${tileCount} 人`
    : (remote[0]?.info.nickname ?? snapshot.incoming?.from.nickname ?? '通话中');

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.82)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 20px', color: '#fff' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', fontVariantNumeric: 'tabular-nums' }}>
            {snapshot.phase === 'outgoing' ? '正在呼叫…' : formatDuration(snapshot.startedAt)}
          </div>
        </div>
        <Tooltip content="最小化">
          <Button theme="borderless" type="tertiary" icon={<Minus size={18} style={{ color: '#fff' }} />} onClick={() => callManager.setMinimized(true)} />
        </Tooltip>
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: '0 20px 12px', display: 'grid', gap: 12, gridTemplateColumns: `repeat(${cols}, 1fr)`, alignContent: 'center', justifyItems: 'stretch' }}>
        <div style={{ aspectRatio: '16 / 10', minHeight: 0 }}>
          <MediaTile
            stream={snapshot.localStream}
            name={self.nickname}
            avatar={self.avatar}
            muted
            mirror={!snapshot.screenSharing}
            label={`${self.nickname}（我）`}
            audioOnly={snapshot.muted}
          />
        </div>
        {remote.map((p) => (
          <div key={p.info.userId} style={{ aspectRatio: '16 / 10', minHeight: 0 }}>
            <MediaTile
              stream={p.stream}
              name={p.info.nickname}
              avatar={p.info.avatar}
              muted
              label={p.connected ? p.info.nickname : `${p.info.nickname} · 连接中…`}
            />
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, padding: '16px 20px 28px' }}>
        <CallControlButton
          active={!snapshot.muted}
          activeIcon={<Mic size={22} />}
          inactiveIcon={<MicOff size={22} />}
          label={snapshot.muted ? '取消静音' : '静音'}
          onClick={() => callManager.toggleMute()}
        />
        {isVideo && (
          <CallControlButton
            active={!snapshot.cameraOff}
            activeIcon={<Video size={22} />}
            inactiveIcon={<VideoOff size={22} />}
            label={snapshot.cameraOff ? '开启摄像头' : '关闭摄像头'}
            onClick={() => callManager.toggleCamera()}
          />
        )}
        <CallControlButton
          active={snapshot.screenSharing}
          activeIcon={<MonitorUp size={22} />}
          inactiveIcon={<MonitorUp size={22} />}
          label={snapshot.screenSharing ? '停止共享' : '屏幕共享'}
          highlight={snapshot.screenSharing}
          onClick={() => { void callManager.toggleScreenShare(); }}
        />
        <button
          type="button"
          onClick={() => callManager.hangup()}
          style={{ width: 56, height: 56, borderRadius: '50%', border: 'none', background: 'var(--semi-color-danger)', color: '#fff', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
          title="挂断"
        >
          <PhoneOff size={24} />
        </button>
      </div>
    </div>
  );
}

function CallControlButton({
  active, activeIcon, inactiveIcon, label, onClick, highlight,
}: Readonly<{
  active: boolean;
  activeIcon: React.ReactNode;
  inactiveIcon: React.ReactNode;
  label: string;
  onClick: () => void;
  highlight?: boolean;
}>) {
  let bg = 'rgba(255,255,255,0.16)';
  if (highlight) bg = 'var(--semi-color-primary)';
  else if (!active) bg = 'rgba(255,255,255,0.32)';
  return (
    <Tooltip content={label}>
      <button
        type="button"
        onClick={onClick}
        style={{ width: 52, height: 52, borderRadius: '50%', border: 'none', background: bg, color: '#fff', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
      >
        {active ? activeIcon : inactiveIcon}
      </button>
    </Tooltip>
  );
}
