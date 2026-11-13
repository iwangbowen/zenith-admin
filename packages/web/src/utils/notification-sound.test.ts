import { afterEach, describe, expect, it, vi } from 'vitest';
import {
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

  it('stays silent without WebAudio support instead of throwing', () => {
    vi.stubGlobal('AudioContext', undefined);
    expect(() => playNotificationSound('chime')).not.toThrow();
  });

  it('starts and stops sound without leaving active oscillators', () => {
    const { ctx, oscillators } = createFakeAudioContext();
    // 必须是可 new 的构造器：箭头函数 mock 无法被 new，模块内会静默失败
    vi.stubGlobal('AudioContext', class FakeAudioContext { constructor() { return ctx; } });
    playNotificationSound('chime');
    expect(ctx.resume).toHaveBeenCalled();
    expect(oscillators.length).toBeGreaterThan(0);
    for (const osc of oscillators) {
      expect(osc.start).toHaveBeenCalledTimes(1);
      expect(osc.stop).toHaveBeenCalledTimes(1);
    }
  });

  it('has a non-empty recipe for every declared style', async () => {
    // 模块缓存共享 AudioContext，重新导入拿到干净实例，单 ctx 累计断言每种音色都有发声
    vi.resetModules();
    const mod = await import('./notification-sound');
    const { ctx, oscillators } = createFakeAudioContext();
    // 必须是可 new 的构造器：箭头函数 mock 无法被 new，模块内会静默失败
    vi.stubGlobal('AudioContext', class FakeAudioContext { constructor() { return ctx; } });
    for (const style of mod.NOTIFICATION_SOUND_STYLES) {
      const before = oscillators.length;
      mod.playNotificationSound(style);
      expect(oscillators.length).toBeGreaterThan(before);
    }
  });
});
