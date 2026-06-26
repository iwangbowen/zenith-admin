/**
 * 终端录屏播放器
 *
 * 使用 xterm.js 按时间轴回放 events（同主题、无网络依赖）。
 * 支持播放/暂停/倍速/进度拖拽。
 */
import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Button, Slider, Select, Typography } from '@douyinfe/semi-ui';
import { Play, Pause, RotateCcw } from 'lucide-react';
import { useThemeController } from '@/providers/theme-controller';
import { useTerminalPreferences } from './useTerminalPreferences';
import { resolveTheme, toXtermTheme } from './themes';
import '@xterm/xterm/css/xterm.css';

type RecordingEvent = [number, 'o' | 'i', string];

interface RecordingPlayerProps {
  readonly cols: number;
  readonly rows: number;
  readonly duration: number;
  readonly events: RecordingEvent[];
  readonly initialTime?: number;
}

const SPEED_OPTIONS = [
  { label: '0.5×', value: 0.5 },
  { label: '1×', value: 1 },
  { label: '1.5×', value: 1.5 },
  { label: '2×', value: 2 },
  { label: '4×', value: 4 },
];

function formatTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function RecordingPlayer({ cols, rows, duration, events, initialTime = 0 }: RecordingPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const { isDark } = useThemeController();
  const { terminal } = useTerminalPreferences();

  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [speed, setSpeed] = useState(1);
  const elapsedRef = useRef(0);
  const startWallRef = useRef(0); // wall-clock time when play started
  const startOffsetRef = useRef(0); // recording offset when play started
  const raf = useRef<number | null>(null);

  const theme = resolveTheme(
    isDark ? terminal.themeDark : terminal.themeLight,
    isDark ? 'dark' : 'light',
  );

  // 初始化 xterm（只在 mount 时）
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const term = new Terminal({
      cols,
      rows,
      theme: toXtermTheme(theme),
      fontFamily: terminal.fontFamily,
      fontSize: terminal.fontSize,
      lineHeight: terminal.lineHeight,
      disableStdin: true,
      scrollback: 0,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;
    const ro = new ResizeObserver(() => fit.fit());
    ro.observe(container);
    return () => {
      ro.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 主题跟随切换
  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = toXtermTheme(theme);
  }, [theme]);

  const clearTimers = () => {
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
  };

  const resetTerm = (toOffset = 0) => {
    const term = termRef.current;
    if (!term) return;
    term.reset();
    // 回放到 toOffset 位置（快进）
    for (const [t, type, data] of events) {
      if (t > toOffset) break;
      if (type === 'o') term.write(data);
    }
  };

  const schedulePlay = (fromOffset: number, fromSpeed: number) => {
    clearTimers();
    const term = termRef.current;
    if (!term) return;
    const wall0 = Date.now();

    const pending = events.filter(([t]) => t > fromOffset);
    for (const [t, type, data] of pending) {
      const delay = ((t - fromOffset) / fromSpeed) * 1000;
      const tid = setTimeout(() => {
        if (type === 'o') term.write(data);
      }, delay);
      timeoutsRef.current.push(tid);
    }

    // 结束定时器
    const endDelay = ((duration - fromOffset) / fromSpeed) * 1000;
    const endTid = setTimeout(() => {
      setPlaying(false);
      setElapsed(duration);
      elapsedRef.current = duration;
      if (raf.current) cancelAnimationFrame(raf.current);
    }, endDelay);
    timeoutsRef.current.push(endTid);

    // 进度刷新
    startWallRef.current = wall0;
    startOffsetRef.current = fromOffset;
    const tick = () => {
      const nowOffset = fromOffset + ((Date.now() - wall0) / 1000) * fromSpeed;
      const clamped = Math.min(nowOffset, duration);
      elapsedRef.current = clamped;
      setElapsed(clamped);
      if (clamped < duration) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };

  const handlePlay = () => {
    if (elapsed >= duration) {
      // 重播
      resetTerm(0);
      setElapsed(0);
      elapsedRef.current = 0;
      setPlaying(true);
      schedulePlay(0, speed);
    } else {
      setPlaying(true);
      schedulePlay(elapsedRef.current, speed);
    }
  };

  const handlePause = () => {
    clearTimers();
    setPlaying(false);
  };

  const handleRestart = () => {
    clearTimers();
    setPlaying(false);
    setElapsed(0);
    elapsedRef.current = 0;
    resetTerm(0);
  };

  const handleSeek = (v: number) => {
    const wasPlaying = playing;
    clearTimers();
    setPlaying(false);
    setElapsed(v);
    elapsedRef.current = v;
    resetTerm(v);
    if (wasPlaying && v < duration) {
      setPlaying(true);
      schedulePlay(v, speed);
    }
  };

  const handleSpeedChange = (v: unknown) => {
    const newSpeed = typeof v === 'number' ? v : Number(v);
    const wasPlaying = playing;
    clearTimers();
    setSpeed(newSpeed);
    if (wasPlaying) {
      setPlaying(true);
      schedulePlay(elapsedRef.current, newSpeed);
    }
  };

  useEffect(() => {
    const nextTime = Math.min(Math.max(initialTime, 0), duration);
    clearTimers();
    setPlaying(false);
    setElapsed(nextTime);
    elapsedRef.current = nextTime;
    resetTerm(nextTime);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTime, duration]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%' }}>
      <div ref={containerRef} style={{ flex: 1, minHeight: 0 }} />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '4px 0',
          flexShrink: 0,
        }}
      >
        <Button
          size="small"
          icon={playing ? <Pause size={14} /> : <Play size={14} />}
          theme="borderless"
          onClick={playing ? handlePause : handlePlay}
        />
        <Button size="small" icon={<RotateCcw size={14} />} theme="borderless" onClick={handleRestart} />
        <Slider
          min={0}
          max={duration}
          step={0.1}
          value={elapsed}
          onChange={(v) => {
              const num = Array.isArray(v) ? (v[0] ?? 0) : (v ?? 0);
              handleSeek(num);
            }}
          style={{ flex: 1 }}
        />
        <Typography.Text size="small" type="tertiary" style={{ flexShrink: 0, minWidth: 70 }}>
          {formatTime(elapsed)} / {formatTime(duration)}
        </Typography.Text>
        <Select
          value={speed}
          onChange={handleSpeedChange}
          size="small"
          style={{ width: 72 }}
          optionList={SPEED_OPTIONS}
        />
      </div>
    </div>
  );
}
