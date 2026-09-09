/**
 * 数据库管理页 psql 终端
 *
 * 服务端从自身 DATABASE_URL 构造 psql 启动参数并经 PTY 环境变量注入凭据，
 * 连接信息全程不下发前端。会话经 ws-terminal 以 kind='db' 登记，
 * 录制、旁观、配额与落库审计由既有终端基建承担。
 *
 * psql 内置 `\!`（执行 shell）与 `\copy`（读写服务端本地文件），因此打开 psql 终端等价于
 * 拿到服务器 shell：权限边界与主机终端对齐，要求 system:terminal:execute + system:db-admin:terminal
 * （读写额外要求 system:db-admin:write）。
 *
 * 只读模式通过 PGOPTIONS 设置 default_transaction_read_only=on 并切换到 zenith_readonly 角色——
 * 这是防误操作的安全默认值，不是权限边界（会话内可被 SET / RESET ROLE 覆盖）。
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../../config';
import { DB_READONLY_ROLE, isDbReadonlyRoleAvailable } from '../../lib/db-readonly-role';
import { parseDatabaseUrl, pgClientEnv, pgConnectionArgs, type DbConnectionParams } from '../../lib/pg-client';

const execFileAsync = promisify(execFile);

export type DbTerminalMode = 'ro' | 'rw';

/** db 终端 shell 标识：db-psql（只读，默认） / db-psql:rw（读写） */
export function parseDbTerminalShellType(type: string | undefined): DbTerminalMode | null {
  if (type === 'db-psql') return 'ro';
  if (type === 'db-psql:rw') return 'rw';
  return null;
}

export interface PsqlLaunch {
  file: string;
  args: string[];
  /** 注入 PTY 的增量环境变量（凭据只走这里，不进程序参数） */
  env: Record<string, string>;
  label: string;
}

/** 构造 psql 启动参数。导出仅为单测（binaryPath 由调用方解析）。 */
export function buildPsqlLaunch(
  mode: DbTerminalMode,
  binaryPath: string,
  params: DbConnectionParams,
  options: { readonlyRole?: boolean } = {},
): PsqlLaunch {
  const env = pgClientEnv(params, 'zenith_db_terminal');
  if (mode === 'ro') {
    const opts = ['-c default_transaction_read_only=on'];
    if (options.readonlyRole) opts.push(`-c role=${DB_READONLY_ROLE}`);
    env.PGOPTIONS = opts.join(' ');
  }
  return {
    file: binaryPath,
    args: pgConnectionArgs(params),
    env,
    label: `psql:${params.database} · ${mode === 'ro' ? '只读' : '读写'}`,
  };
}

/** 成功探测结果进程内缓存；失败不缓存，装好 psql 后无需重启即可用 */
let cachedPsql: { path: string; version: string } | null = null;

async function locatePsql(): Promise<{ path: string; version: string } | null> {
  if (cachedPsql) return cachedPsql;
  const candidate = config.psqlPath ?? 'psql';
  try {
    const { stdout } = await execFileAsync(candidate, ['--version'], { timeout: 5000, windowsHide: true });
    cachedPsql = { path: candidate, version: stdout.trim() };
    return cachedPsql;
  } catch {
    return null;
  }
}

export interface DbTerminalAvailability {
  available: boolean;
  version: string | null;
  reason: string | null;
}

export async function getDbTerminalAvailability(): Promise<DbTerminalAvailability> {
  const psql = await locatePsql();
  if (!psql) {
    return {
      available: false,
      version: null,
      reason: '服务端未找到 psql 客户端。请安装 postgresql-client，或通过 PSQL_PATH 环境变量指定可执行文件路径。',
    };
  }
  try {
    parseDatabaseUrl(config.databaseUrl);
  } catch (err) {
    return {
      available: false,
      version: psql.version,
      reason: `DATABASE_URL 无法解析为 psql 连接参数：${err instanceof Error ? err.message : String(err)}`,
    };
  }
  return { available: true, version: psql.version, reason: null };
}

/** 为 ws-terminal 解析 db 终端启动方式；不可用时抛出带用户可读信息的错误 */
export async function resolveDbPsqlLaunch(mode: DbTerminalMode): Promise<PsqlLaunch> {
  const psql = await locatePsql();
  if (!psql) {
    throw new Error('服务端未安装 psql 客户端，无法打开数据库终端（可设置 PSQL_PATH 指定路径）');
  }
  return buildPsqlLaunch(mode, psql.path, parseDatabaseUrl(config.databaseUrl), {
    readonlyRole: mode === 'ro' && await isDbReadonlyRoleAvailable(),
  });
}
