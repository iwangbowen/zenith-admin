import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildPgDumpLaunch, parseDatabaseUrl, pgClientEnv, runPgDumpToGzip } from './pg-client';
describe('parseDatabaseUrl', () => {
  it('解析标准连接串', () => {
    expect(parseDatabaseUrl('postgresql://app:secret@db.internal:5433/zenith')).toEqual({
      host: 'db.internal',
      port: '5433',
      user: 'app',
      password: 'secret',
      database: 'zenith',
      sslMode: null,
    });
  });

  it('缺省端口回退 5432 并解码转义字符', () => {
    const parsed = parseDatabaseUrl('postgres://app:p%40ss%20w0rd@localhost/zenith_admin');
    expect(parsed.port).toBe('5432');
    expect(parsed.password).toBe('p@ss w0rd');
  });

  it('透传 sslmode 查询参数', () => {
    expect(parseDatabaseUrl('postgres://u:p@h/db?sslmode=verify-full').sslMode).toBe('verify-full');
  });

  it('缺少数据库名时抛错', () => {
    expect(() => parseDatabaseUrl('postgres://u:p@h:5432/')).toThrow('DATABASE_URL 缺少数据库名');
  });
});

const params = {
  host: 'localhost', port: '5432', user: 'postgres', password: 'pw',
  database: 'zenith_admin', sslMode: null,
};

describe('buildPgDumpLaunch', () => {
  it('凭据只进环境变量，参数带 --no-password 避免缺凭据时交互挂起', () => {
    const launch = buildPgDumpLaunch('pg_dump', params);
    expect(launch.file).toBe('pg_dump');
    expect(launch.args).toEqual(['-h', 'localhost', '-p', '5432', '-U', 'postgres', '-d', 'zenith_admin', '--no-password']);
    expect(launch.args.join(' ')).not.toContain('pw');
    expect(launch.env.PGPASSWORD).toBe('pw');
    expect(launch.env.PGCLIENTENCODING).toBe('UTF8');
    expect(launch.env.PGAPPNAME).toBe('zenith_db_backup');
  });

  it('连接串 sslmode 透传为 PGSSLMODE', () => {
    expect(pgClientEnv({ ...params, sslMode: 'require' }, 'zenith_test').PGSSLMODE).toBe('require');
  });
});

/** 以 node 充当 pg_dump：用 -e 脚本控制 stdout / stderr / 退出码，不依赖真实 PostgreSQL 客户端 */
const fakeDump = (script: string) => ({ file: process.execPath, args: ['-e', script], env: {} });

describe('runPgDumpToGzip', () => {
  let dir: string;
  let out: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zenith-pgdump-'));
    out = path.join(dir, 'dump.sql.gz');
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('退出码 0 时把 stdout 压缩落盘', async () => {
    await runPgDumpToGzip(fakeDump('process.stdout.write("-- PostgreSQL database dump\\nSELECT 1;\\n")'), out);
    expect(gunzipSync(await fs.readFile(out)).toString('utf8')).toBe('-- PostgreSQL database dump\nSELECT 1;\n');
  });

  it('非零退出码视为失败：错误带回 stderr，并删除半成品文件', async () => {
    await expect(runPgDumpToGzip(
      fakeDump('process.stdout.write("partial"); process.stderr.write("pg_dump: error: connection to server failed"); process.exit(1)'),
      out,
    )).rejects.toThrow('pg_dump 退出码 1：pg_dump: error: connection to server failed');
    await expect(fs.access(out)).rejects.toThrow();
  });

  it('可执行文件不存在时提示安装 / PG_DUMP_PATH，且不留下空 gzip', async () => {
    await expect(runPgDumpToGzip(
      { file: path.join(dir, 'no-such-pg_dump'), args: [], env: {} },
      out,
    )).rejects.toThrow(/未找到 pg_dump 可执行文件.*PG_DUMP_PATH/);
    await expect(fs.access(out)).rejects.toThrow();
  });
});