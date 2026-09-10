import { describe, expect, it } from 'vitest';
import { getIslandsAsset, resetIslandsAssetCache } from './islands-asset';

describe('islands-asset', () => {
  it('开发态内存构建：产出非空 ESM、指纹路径稳定且可缓存复用', async () => {
    resetIslandsAssetCache();
    const first = await getIslandsAsset();
    expect(first.js.length).toBeGreaterThan(0);
    expect(first.relPath).toMatch(/^_assets\/islands\.[0-9a-f]{10}\.js$/);
    expect(first.relPath).toBe(`_assets/islands.${first.hash}.js`);
    // 打包产物不得引入 Node 运行时符号
    expect(first.js).not.toMatch(/\brequire\(|process\.env/);
    const second = await getIslandsAsset();
    expect(second).toBe(first);
  });
});
