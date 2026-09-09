/**
 * PostgreSQL 客户端工具（psql / pg_dump）的公共调用积木：
 * 从 DATABASE_URL 解析连接参数、构造客户端环境变量（凭据只走环境变量，不进程序参数与进程列表），
 * 以及不经 shell 的 pg_dump 执行器。
 */
import { spawn } from 'node:child_process';
import { createWriteStream, promises as fs } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { config } from '../config';

export interface DbConnectionParams {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
  sslMode: string | null;
}

/** 解析 postgres 连接串；密码等字段做 URL 解码 */
export function parseDatabaseUrl(databaseUrl: string): DbConnectionParams {
  const url = new URL(databaseUrl);
  const database = url.pathname.replace(/^\//, '');
  if (!database) throw new Error('DATABASE_URL 缺少数据库名');
  return {
    host: url.hostname || 'localhost',
    port: url.port || '5432',
    user: decodeURIComponent(url.username || 'postgres'),
    password: decodeURIComponent(url.password || ''),
    database: decodeURIComponent(database),
    sslMode: url.searchParams.get('sslmode'),
  };
}

/** libpq 客户端环境变量：密码、编码、应用名与 SSL 模式（连接串 sslmode 优先，其次跟随 DATABASE_SSL） */
export function pgClientEnv(params: DbConnectionParams, appName: string): Record<string, string> {
  const env: Record<string, string> = {
    PGPASSWORD: params.password,
    PGCLIENTENCODING: 'UTF8',
    PGAPPNAME: appName,
  };
  const sslMode = params.sslMode ?? (config.database.ssl ? 'require' : null);
  if (sslMode) env.PGSSLMODE = sslMode;
  return env;
}

/** 连接参数展开为 libpq 工具通用的位置参数（psql / pg_dump 同形） */
export function pgConnectionArgs(params: DbConnectionParams): string[] {
  return ['-h', params.host, '-p', params.port, '-U', params.user, '-d', params.database];
}

export interface PgDumpLaunch {
  file: string;
  args: string[];
  /** 增量环境变量（凭据只走这里，不进程序参数） */
  env: Record<string, string>;
}

/** 构造 pg_dump 启动参数；`--no-password` 让缺凭据时立即失败而不是等待交互输入 */
export function buildPgDumpLaunch(binaryPath: string, params: DbConnectionParams): PgDumpLaunch {
  return {
    file: binaryPath,
    args: [...pgConnectionArgs(params), '--no-password'],
    env: pgClientEnv(params, 'zenith_db_backup'),
  };
}

/** 失败信息里保留的 stderr 尾部长度 */
const STDERR_TAIL_LIMIT = 4000;

/**
 * 运行 pg_dump，把 stdout 经 gzip 写到 filePath。
 *
 * 不经 shell 管道：`pg_dump … | gzip > file` 的退出码只反映 gzip，pg_dump 缺失、连接失败或
 * 认证失败时管道照样返回 0，只留下一个 20 字节的空 gzip 却被记成「成功」。这里直接按 pg_dump 的
 * 退出码与 stderr 判定，任何失败都删除半成品文件后抛错；同时不再依赖系统 gzip、连接串不再进入命令行。
 */
export async function runPgDumpToGzip(launch: PgDumpLaunch, filePath: string): Promise<void> {
  const child = spawn(launch.file, launch.args, {
    env: { ...process.env, ...launch.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr = (stderr + chunk).slice(-STDERR_TAIL_LIMIT);
  });

  // spawn 失败（ENOENT 等）先发 error 再发 close；先到者决定结果
  const exited = new Promise<{ code: number | null; spawnError?: NodeJS.ErrnoException }>((resolve) => {
    child.once('error', (spawnError: NodeJS.ErrnoException) => resolve({ code: null, spawnError }));
    child.once('close', (code) => resolve({ code }));
  });

  let pipeError: unknown;
  try {
    await pipeline(child.stdout, createGzip(), createWriteStream(filePath));
  } catch (err) {
    // 写盘失败时不再让 pg_dump 对着已关闭的管道继续跑
    pipeError = err;
    child.kill();
  }
  const { code, spawnError } = await exited;

  const fail = async (message: string): Promise<never> => {
    await fs.rm(filePath, { force: true });
    throw new Error(message);
  };
  if (spawnError) {
    const hint = spawnError.code === 'ENOENT'
      ? `未找到 pg_dump 可执行文件「${launch.file}」，请安装 PostgreSQL 客户端工具或通过 PG_DUMP_PATH 指定路径`
      : `无法启动 pg_dump「${launch.file}」：${spawnError.message}`;
    return fail(hint);
  }
  if (code !== 0) {
    const detail = stderr.trim();
    return fail(`pg_dump 退出码 ${code ?? 'null'}${detail ? `：${detail}` : ''}`);
  }
  if (pipeError) {
    return fail(`写入备份文件失败：${pipeError instanceof Error ? pipeError.message : String(pipeError)}`);
  }
}
