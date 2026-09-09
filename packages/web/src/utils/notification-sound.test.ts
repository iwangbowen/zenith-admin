import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_NOTIFICATION_SOUND_STYLE,
  NOTIFICATION_SOUND_STYLES,
  NOTIFICATION_SOUND_STYLE_OPTIONS,
  playNotificationSound,
} from './notification-sound';

function createFakeAudioContext() {
  const oscillators: Array<{ type: string; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }> = [];
  const ctx = {
    currentTime: 0,
    destination: {},
    resume: vi.fn(),
    createOscillator: vi.fn(() => {
      const osc = {
        type: 'sine',
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      };
      oscillators.push(osc);
      return osc;
    }),
    createGain: vi.fn(() => ({
      connect: vi.fn(),
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    })),
  };
  return { ctx, oscillators };
}

describe('notification sound', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('derives select options from the label map in declaration order', () => {
    expect(NOTIFICATION_SOUND_STYLE_OPTIONS.map((o) => o.value)).toEqual([...NOTIFICATION_SOUND_STYLES]);
    expect(NOTIFICATION_SOUND_STYLES).toContain(DEFAULT_NOTIFICATION_SOUND_STYLE);
  });

  it('stays silent without WebAudio support instead of throwing', () => {
    vi.stubGlobal('AudioContext', undefined);
    expect(() => playNotificationSound('chime')).not.toThrow();
  });

  it('schedules one oscillator per tone of the recipe and resumes the shared context', () => {
    const { ctx, oscillators } = createFakeAudioContext();
    // 必须是可 new 的构造器：箭头函数 mock 无法被 new，模块内会静默失败
    vi.stubGlobal('AudioContext', class FakeAudioContext { constructor() { return ctx; } });
    playNotificationSound('chime');
    expect(ctx.resume).toHaveBeenCalled();
    expect(oscillators).toHaveLength(2);
    for (const osc of oscillators) {
      expect(osc.start).toHaveBeenCalledTimes(1);
      expect(osc.stop).toHaveBeenCalledTimes(1);
    }
  });
});
