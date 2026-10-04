import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { sourceFiles } from '../test-utils/source-files';

const SERVER = fileURLToPath(new URL('../..', import.meta.url));

describe('跨实例缓存失效触发器', () => {
  it('onInvalidate 订阅的每张表都在 0001_extensions.sql 挂了 notify_cache_invalidate 触发器', () => {
    const topics = new Set<string>();
    for (const file of sourceFiles(join(SERVER, 'src'))) {
      for (const m of readFileSync(file, 'utf8').matchAll(/onInvalidate\(\s*'([a-z_]+)'/g)) topics.add(m[1]);
    }
    const ddl = readFileSync(join(SERVER, 'drizzle/0001_extensions.sql'), 'utf8');
    const triggered = new Set(
      [...ddl.matchAll(/ON "([a-z_]+)"\s+FOR EACH ROW EXECUTE FUNCTION notify_cache_invalidate/g)].map((m) => m[1]),
    );
    expect([...topics].filter((topic) => !triggered.has(topic)).sort()).toEqual([]);
  });
});
