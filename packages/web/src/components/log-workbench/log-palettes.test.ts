import { describe, expect, it } from 'vitest';
import { resolveLogPalette } from './log-palettes';

describe('日志配色偏好兼容', () => {
  it.each([undefined, null, {}, 'removed-palette'])('过期 / 非法偏好安全回退', (value) => {
    expect(resolveLogPalette(value).id).toBe('github');
  });
});
