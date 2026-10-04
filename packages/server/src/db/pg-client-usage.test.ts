import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isCommentLine, sourceFiles } from '../test-utils/source-files';

const SRC = fileURLToPath(new URL('..', import.meta.url));
const ALLOWED = new Set(['db/client.ts', 'lib/report-external-db.ts', 'db/pg-client-usage.test.ts']);

describe('数据库客户端', () => {
  it('连接主库只经 createPgClient()（会话时区固定 UTC）', () => {
    const hits: string[] = [];
    for (const file of sourceFiles(SRC, true)) {
      const rel = relative(SRC, file).replaceAll('\\', '/');
      if (ALLOWED.has(rel)) continue;
      readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
        if (!isCommentLine(line) && /\bpostgres\(/.test(line)) hits.push(`${rel}:${index + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
