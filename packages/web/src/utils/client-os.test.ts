import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPreciseOs } from './client-os';

const WIN11_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function stubNavigator(userAgent: string, platformVersion?: string) {
  vi.stubGlobal('navigator', {
    userAgent,
    userAgentData: platformVersion === undefined ? undefined : {
      getHighEntropyValues: vi.fn(async () => ({ platformVersion })),
    },
  });
}

describe('getPreciseOs', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('Win11（platformVersion ≥ 13）→ Windows 11', async () => {
    stubNavigator(WIN11_UA, '15.0.0');
    await expect(getPreciseOs()).resolves.toBe('Windows 11');
  });

  it('Win10（platformVersion < 13）→ undefined（交服务端回退）', async () => {
    stubNavigator(WIN11_UA, '10.0.0');
    await expect(getPreciseOs()).resolves.toBeUndefined();
  });

  it('非冻结 UA 不查询 hints', async () => {
    const getHighEntropyValues = vi.fn(async () => ({ platformVersion: '15.0.0' }));
    vi.stubGlobal('navigator', { userAgent: MAC_UA, userAgentData: { getHighEntropyValues } });
    await expect(getPreciseOs()).resolves.toBeUndefined();
    expect(getHighEntropyValues).not.toHaveBeenCalled();
  });

  it('不支持 userAgentData → undefined', async () => {
    vi.stubGlobal('navigator', { userAgent: WIN11_UA });
    await expect(getPreciseOs()).resolves.toBeUndefined();
  });

  it('hints 异常或超时 → undefined，不阻塞', async () => {
    vi.stubGlobal('navigator', {
      userAgent: WIN11_UA,
      userAgentData: { getHighEntropyValues: vi.fn(async () => { throw new Error('denied'); }) },
    });
    await expect(getPreciseOs()).resolves.toBeUndefined();
  });
});
