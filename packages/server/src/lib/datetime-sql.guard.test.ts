import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isCommentLine, sourceFiles } from '../test-utils/source-files';

const SRC = fileURLToPath(new URL('..', import.meta.url));

const RULES = [
  { id: 'current-date', re: /\bCURRENT_DATE\b/i, hint: '用 localDayStart()' },
  { id: 'cast-timestamp', re: /::timestamp\b(?!\s+at\s+time\s+zone)/i, hint: '时刻用 ::timestamptz；当地钟点文本须紧跟 AT TIME ZONE' },
  { id: 'double-zone', re: /at\s+time\s+zone\s+'UTC'\s+at\s+time\s+zone/i, hint: '用 localTime() / localFormat()' },
  { id: 'date-fn', re: /\bdate\(\s*\$\{/i, hint: '用 localDate()' },
  { id: 'to-char-direct', re: /to_char\(\s*\$\{[^}]+\}\s*,/i, hint: '用 localFormat() / localDate()' },
  { id: 'extract-field', re: /extract\(\s*(hour|dow|isodow|day|doy|week|month|year|minute)\s+from\s+\$\{(?!\s*localTime\()/i, hint: 'extract(… from ${localTime(col)})' },
  { id: 'date-trunc-2arg', re: /date_trunc\(\s*'\w+'\s*,\s*(\$\{[^}]+\}|now\(\))\s*\)/i, hint: "用 localTrunc() 或 date_trunc(unit, x, 'UTC')" },
  { id: 'formatted-text-cast', re: /\$\{\s*(formatDateTime|formatDate|currentDateTime)\([^`]*::(timestamp|date)/, hint: '传 Date 或 toISOString()' },
];

/** 例外必须写明理由 */
const ALLOW = [
  { file: 'services/short-link/short-link-stats.service.ts', rule: 'to-char-direct', contains: 'shortLinkDailyStats.statDate', reason: 'stat_date 为 date 列' },
];

describe('SQL 时区写法', () => {
  it('services / lib 不出现依赖会话时区的 SQL', () => {
    const hits: string[] = [];
    for (const base of ['services', 'lib']) {
      for (const file of sourceFiles(join(SRC, base))) {
        const rel = relative(SRC, file).replaceAll('\\', '/');
        if (rel === 'lib/datetime-sql.ts') continue;
        readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
          if (isCommentLine(line)) return;
          for (const rule of RULES) {
            if (!rule.re.test(line)) continue;
            if (ALLOW.some((a) => a.file === rel && a.rule === rule.id && line.includes(a.contains))) continue;
            hits.push(`${rel}:${index + 1} [${rule.id}] ${rule.hint}`);
          }
        });
      }
    }
    expect(hits).toEqual([]);
  });
});
