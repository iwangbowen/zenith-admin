/**
 * 锁定 src/index.ts 的前两条 import 顺序：
 *  1. lib/fatal-handlers —— 进程级兜底必须先于任何可能在加载期抛错的模块；
 *  2. @hono/zod-openapi —— 把 .openapi() 补丁到 ZodType 原型；zod v4 实例只在构造时拷贝
 *     原型方法，@zenith/shared 的契约 schema 必须在补丁之后构造，路由层对它们调 .openapi(...) 才成立。
 * 顺序一旦被打乱，只会在 dev / 生产启动时以 "xxx.openapi is not a function" 崩溃，测试图无法自然覆盖。
 */
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('src/index.ts 启动入口 import 顺序', () => {
  it('前两条 import 依次为 lib/fatal-handlers 与 @hono/zod-openapi', async () => {
    const source = await readFile(new URL('./index.ts', import.meta.url), 'utf8');
    const imports = [...source.matchAll(/^import\b[^;]*?from\s+'([^']+)';|^import\s+'([^']+)';/gm)]
      .map((m) => m[1] ?? m[2]);
    expect(imports.slice(0, 2)).toEqual(['./lib/fatal-handlers', '@hono/zod-openapi']);
  });
});
