import { HTTPException } from 'hono/http-exception';

const WRITE_OR_CONTROL_KEYWORDS = new Set([
  'alter',
  'analyze',
  'call',
  'cluster',
  'comment',
  'copy',
  'create',
  'deallocate',
  'delete',
  'discard',
  'do',
  'drop',
  'execute',
  'exec',
  'grant',
  'insert',
  'listen',
  'load',
  'lock',
  'merge',
  'notify',
  'prepare',
  'refresh',
  'reindex',
  'reset',
  'revoke',
  'set',
  'truncate',
  'update',
  'vacuum',
]);

const DANGEROUS_FUNCTIONS = new Set([
  'benchmark',
  'dblink',
  'dumpfile',
  'load_file',
  'lo_export',
  'lo_import',
  'nextval',
  'openquery',
  'opendatasource',
  'openrowset',
  'pg_advisory_lock',
  'pg_cancel_backend',
  'pg_ls_dir',
  'pg_read_binary_file',
  'pg_read_file',
  'pg_reload_conf',
  'pg_sleep',
  'pg_stat_file',
  'pg_terminate_backend',
  'setval',
  'sleep',
  'xp_cmdshell',
]);
const QUOTED_DANGEROUS_FUNCTION_RE = new RegExp(
  `(?:"(?:${[...DANGEROUS_FUNCTIONS].join('|')})"|` +
  `\`(?:${[...DANGEROUS_FUNCTIONS].join('|')})\`|` +
  `\\[(?:${[...DANGEROUS_FUNCTIONS].join('|')})\\])\\s*\\(`,
  'i',
);

function maskSqlLiteralsAndComments(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (ch === '-' && next === '-') {
      out += '  ';
      i += 2;
      while (i < sql.length && sql[i] !== '\n') {
        out += ' ';
        i++;
      }
      continue;
    }
    if (ch === '/' && next === '*') {
      out += '  ';
      i += 2;
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) {
        out += sql[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < sql.length) {
        out += '  ';
        i += 2;
      }
      continue;
    }
    if (ch === '\'') {
      const close = ch;
      out += ' ';
      i++;
      while (i < sql.length) {
        if (sql[i] === close) {
          if (sql[i + 1] === close) {
            out += '  ';
            i += 2;
            continue;
          }
          out += ' ';
          i++;
          break;
        }
        if (sql[i] === '\\' && i + 1 < sql.length) {
          out += '  ';
          i += 2;
          continue;
        }
        out += sql[i] === '\n' ? '\n' : ' ';
        i++;
      }
      continue;
    }
    if (ch === '"' || ch === '`' || ch === '[') {
      const close = ch === '[' ? ']' : ch;
      out += ' ';
      i++;
      while (i < sql.length) {
        if (sql[i] === close) {
          if (close !== ']' && sql[i + 1] === close) {
            out += '  ';
            i += 2;
            continue;
          }
          out += ' ';
          i++;
          break;
        }
        out += sql[i] === '\n' ? '\n' : ' ';
        i++;
      }
      continue;
    }
    if (ch === '$') {
      const tag = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(i))?.[0];
      if (tag) {
        out += ' '.repeat(tag.length);
        i += tag.length;
        const end = sql.indexOf(tag, i);
        if (end === -1) {
          out += ' '.repeat(sql.length - i);
          break;
        }
        out += sql.slice(i, end).replace(/[^\n]/g, ' ');
        out += ' '.repeat(tag.length);
        i = end + tag.length;
        continue;
      }
    }

    out += ch;
    i++;
  }
  return out;
}

export function normalizeReadonlyReportSql(input: string): string {
  const sql = input.trim().replace(/;\s*$/, '').trim();
  if (!sql) throw new HTTPException(400, { message: '数据集 SQL 不能为空' });
  if (/\/\*(?:!|M!)/i.test(sql)) {
    throw new HTTPException(400, { message: '报表 SQL 禁止使用可执行注释' });
  }
  if (QUOTED_DANGEROUS_FUNCTION_RE.test(sql)) {
    throw new HTTPException(400, { message: '报表 SQL 包含禁止的引号函数调用' });
  }

  const masked = maskSqlLiteralsAndComments(sql);
  if (masked.includes(';')) {
    throw new HTTPException(400, { message: '报表 SQL 仅允许执行单条查询' });
  }

  const tokens = masked.match(/[A-Za-z_][A-Za-z0-9_$]*/g)?.map((token) => token.toLowerCase()) ?? [];
  const first = tokens[0];
  if (first !== 'select' && first !== 'with') {
    throw new HTTPException(400, { message: '报表 SQL 仅允许只读 SELECT/WITH 查询' });
  }
  if (first === 'with' && !tokens.includes('select')) {
    throw new HTTPException(400, { message: 'WITH 查询必须以 SELECT 返回结果' });
  }
  if (tokens.includes('into')) {
    throw new HTTPException(400, { message: '报表 SQL 禁止使用 SELECT INTO' });
  }

  const unsafeToken = tokens.find((token) =>
    WRITE_OR_CONTROL_KEYWORDS.has(token) || DANGEROUS_FUNCTIONS.has(token));
  if (unsafeToken) {
    throw new HTTPException(400, { message: `报表 SQL 包含禁止关键字或函数：${unsafeToken}` });
  }
  return sql;
}

export function isReadonlyReportSql(input: string): boolean {
  try {
    normalizeReadonlyReportSql(input);
    return true;
  } catch {
    return false;
  }
}
