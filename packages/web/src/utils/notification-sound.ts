/**
 * 通知提示音：用 WebAudio 即时合成，不依赖音频资源文件（与聊天提示音、来电铃声同一路线）。
 *
 * 浏览器自动播放策略要求 AudioContext 在用户手势后才可出声：首次交互后 `resume()` 即可，
 * 通知设置里的「试听」按钮同时充当解锁手势。播放失败一律静默，不影响通知本身。
 */
import { createLabelOptionsFromMap } from '@zenith/shared/core';

export const NOTIFICATION_SOUND_STYLES = ['chime', 'ding', 'pop'] as const;
export type NotificationSoundStyle = (typeof NOTIFICATION_SOUND_STYLES)[number];

export const NOTIFICATION_SOUND_STYLE_LABELS: Record<NotificationSoundStyle, string> = {
  chime: '清脆双音',
  ding: '单音提示',
  pop: '轻柔气泡',
};

export const NOTIFICATION_SOUND_STYLE_OPTIONS = createLabelOptionsFromMap(NOTIFICATION_SOUND_STYLE_LABELS);

export const DEFAULT_NOTIFICATION_SOUND_STYLE: NotificationSoundStyle = 'chime';

/** 一个音符：起止频率（Hz）、起始时刻与时长（秒）、波形与峰值音量 */
interface Tone {
  freq: number;
  /** 结束频率，缺省保持不变；用于滑音 */
  freqEnd?: number;
  start: number;
  duration: number;
  type?: OscillatorType;
  peak?: number;
}

const RECIPES: Record<NotificationSoundStyle, readonly Tone[]> = {
  // 与既有聊天提示音一致：880 → 660 的双音
  chime: [
    { freq: 880, start: 0, duration: 0.14, peak: 0.18 },
    { freq: 660, start: 0.12, duration: 0.22, peak: 0.18 },
  ],
  ding: [
    { freq: 1046.5, start: 0, duration: 0.45, type: 'triangle', peak: 0.16 },
  ],
  pop: [
    { freq: 520, freqEnd: 390, start: 0, duration: 0.12, peak: 0.12 },
  ],
};

let sharedCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  const scope = globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext };
  const Ctor = scope.AudioContext ?? scope.webkitAudioContext;
  if (!Ctor) return null;
  sharedCtx = sharedCtx ?? new Ctor();
  return sharedCtx;
}

function scheduleTone(ctx: AudioContext, tone: Tone): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  const start = ctx.currentTime + tone.start;
  const end = start + tone.duration;
  osc.type = tone.type ?? 'sine';
  osc.frequency.setValueAtTime(tone.freq, start);
  if (tone.freqEnd !== undefined) osc.frequency.exponentialRampToValueAtTime(tone.freqEnd, end);
  // 指数包络：快起、缓落，避免爆音
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(tone.peak ?? 0.15, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
  osc.start(start);
  osc.stop(end + 0.02);
}

/** 播放一声通知提示音；无 WebAudio 或被自动播放策略拦截时静默 */
export function playNotificationSound(style: NotificationSoundStyle = DEFAULT_NOTIFICATION_SOUND_STYLE): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    void ctx.resume?.();
    for (const tone of RECIPES[style] ?? RECIPES[DEFAULT_NOTIFICATION_SOUND_STYLE]) scheduleTone(ctx, tone);
  } catch { /* ignore */ }
}
