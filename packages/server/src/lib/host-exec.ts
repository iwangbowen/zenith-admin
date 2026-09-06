/**
 * 统一主机命令执行层（多主机运维基座）
 *
 * 收口运维域各服务对 child_process 的直接调用,提供本机 / SSH 远端两种实现:
 *  - 调用方**只能**以 argv 数组形式提交命令(禁止裸字符串),LocalExecutor 直接
 *    映射 execFile;SshExecutor 经强制 POSIX 单引号编码拼接,杜绝 shell 注入;
 *  - SSH 连接按主机复用(懒建 + 空闲回收),host key 按 TOFU 策略校验:
 *    首连记录 SHA256 指纹,后续不匹配立即拒连(防中间人);
 *  - 统一超时与输出上限,远端异常降级为带 stderr 的错误对象,
 *    与 execFile 的错误形状(err.stdout / err.stderr)保持兼容。
 *
 * 远端仅支持 Linux 主机;凭据从 ops_hosts 读取并即时解密,不落内存缓存。
 */
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { HTTPException } from 'hono/http-exception';
import { requireRow } from './db-assert';
import { and, eq, isNull } from 'drizzle-orm';
import { Client as SshClient } from 'ssh2';
import type { ConnectConfig, SFTPWrapper } from 'ssh2';
import { db } from '../db';
import { opsHosts } from '../db/schema';
import { decryptSecret } from './secret-crypto';
import logger from './logger';

// ─── shell 编码（SshExecutor 注入防线,单测穷举覆盖）─────────────────────────────

/**
 * POSIX 单引号编码:任意字节序列在单引号内均为字面量,唯一需要处理的是
 * 单引号本身(以 `'\''` 缝合)。空串编码为 `''`。
 */
export function shellQuoteArg(arg: string): string {
  if (arg === '') return "''";
  return `'${arg.replaceAll("'", "'\\''")}'`;
}

/** 将 argv 数组编码为可安全执行的 shell 命令字符串 */
export function buildShellCommand(file: string, args: readonly string[]): string {
  return [file, ...args].map(shellQuoteArg).join(' ');
}

// ─── 接口 ─────────────────────────────────────────────────────────────────────

export interface ExecResult {
  stdout: string;
  stderr: string;
}

export interface ExecOptions {
  timeoutMs?: number;
  maxBuffer?: number;
}

export interface StreamOptions {
  onData: (chunk: string) => void;
  onExit?: (code: number | null) => void;
}

export interface StreamHandle {
  kill: () => void;
}

export interface HostExecutor {
  /** null = 本机 */
  readonly hostId: number | null;
  readonly isRemote: boolean;
  /** 执行命令并收集输出;非零退出码 reject(错误对象带 stdout/stderr,与 execFile 兼容) */
  exec(file: string, args?: readonly string[], opts?: ExecOptions): Promise<ExecResult>;
  /** 流式执行(tail -f 等长驻命令);返回句柄用于终止 */
  execStream(file: string, args: readonly string[], opts: StreamOptions): Promise<StreamHandle>;
}

/** 远端执行器额外暴露 SFTP(文件管理 / 日志下载使用,与命令通道共享连接) */
export interface RemoteHostExecutor extends HostExecutor {
  /**
   * 持有 SFTP 租约期间连接不会被空闲回收；流式下载必须在 close/error/end 时 release。
   */
  acquireSftp(): Promise<{ sftp: SFTPWrapper; release: () => void }>;
}

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_BUFFER = 4 * 1024 * 1024;
/** SSH 连接空闲回收时长(与 SFTP 既有策略一致) */
const IDLE_DISCONNECT_MS = 2 * 60 * 1000;
/** 单连接并发 exec 通道上限(超出排队,避免触发 sshd MaxSessions 报错) */
const MAX_CONCURRENT_CHANNELS = 6;

/** 与 child_process 错误形状兼容的执行错误 */
export class HostExecError extends Error {
  constructor(
    message: string,
    public readonly stdout: string,
    public readonly stderr: string,
    public readonly code: number | null,
  ) {
    super(message);
    this.name = 'HostExecError';
  }
}

// ─── 本机实现 ──────────────────────────────────────────────────────────────────

class LocalExecutor implements HostExecutor {
  readonly hostId = null;
  readonly isRemote = false;

  exec(file: string, args: readonly string[] = [], opts: ExecOptions = {}): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
      execFile(
        file,
        [...args],
        { timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, maxBuffer: opts.maxBuffer ?? DEFAULT_MAX_BUFFER },
        (err, stdout, stderr) => {
          if (err) {
            reject(new HostExecError(err.message, String(stdout ?? ''), String(stderr ?? ''), (err as { code?: number }).code ?? null));
            return;
          }
          resolve({ stdout: String(stdout), stderr: String(stderr) });
        },
      );
    });
  }

  execStream(file: string, args: readonly string[], opts: StreamOptions): Promise<StreamHandle> {
    const child = spawn(file, [...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let exited = false;
    child.stdout.on('data', (d: Buffer) => opts.onData(d.toString('utf8')));
    child.stderr.on('data', (d: Buffer) => opts.onData(d.toString('utf8')));
    child.on('error', (err) => {
      if (exited) return;
      exited = true;
      opts.onData(err.message);
      opts.onExit?.(null);
    });
    child.on('close', (code) => {
      if (exited) return;
      exited = true;
      opts.onExit?.(code);
    });
    return Promise.resolve({ kill: () => { try { child.kill(); } catch { /* ignore */ } } });
  }
}

export const localExecutor: HostExecutor = new LocalExecutor();

// ─── SSH 远端实现 ─────────────────────────────────────────────────────────────

interface PooledConnection {
  client: SshClient;
  ready: Promise<void>;
  inFlight: number;
  waiters: Array<{ resolve: () => void; reject: (error: Error) => void }>;
  idleTimer: ReturnType<typeof setTimeout> | null;
  sftp: SFTPWrapper | null;
  sftpReady: Promise<SFTPWrapper> | null;
  closed: boolean;
}

const pool = new Map<number, PooledConnection>();
const pendingConnections = new Map<number, Promise<PooledConnection>>();
/** 配置更新/删除时递增，使尚在建连的旧配置连接无法进入连接池。 */
const connectionGenerations = new Map<number, number>();

function disposeConnection(hostId: number, conn: PooledConnection): void {
  if (conn.closed) return;
  conn.closed = true;
  if (conn.idleTimer) clearTimeout(conn.idleTimer);
  const closedError = new HTTPException(409, { message: '主机连接已关闭，请重试' });
  for (const waiter of conn.waiters.splice(0)) waiter.reject(closedError);
  try { conn.client.end(); } catch { /* ignore */ }
  if (pool.get(hostId) === conn) pool.delete(hostId);
}

function touchIdle(hostId: number, conn: PooledConnection): void {
  if (conn.idleTimer) clearTimeout(conn.idleTimer);
  conn.idleTimer = setTimeout(() => {
    if (conn.inFlight === 0) disposeConnection(hostId, conn);
  }, IDLE_DISCONNECT_MS);
  conn.idleTimer.unref?.();
}

/** 删除 / 修改主机后必须调用:丢弃旧连接,避免继续用旧凭据或旧指纹 */
export function evictHostConnection(hostId: number): void {
  connectionGenerations.set(hostId, (connectionGenerations.get(hostId) ?? 0) + 1);
  // 旧配置的建连 Promise 会通过 generation 检查自行关闭；先从 map 移除，
  // 让后续请求立即按新配置启动新连接。
  pendingConnections.delete(hostId);
  const conn = pool.get(hostId);
  if (conn) disposeConnection(hostId, conn);
}

async function loadHostRow(hostId: number) {
  const [maybeRow] = await db.select().from(opsHosts).where(eq(opsHosts.id, hostId)).limit(1);
  const row = requireRow(maybeRow, '主机不存在');
  return row;
}

function decryptField(value: string | null): string | null {
  if (!value) return null;
  try {
    return decryptSecret(value);
  } catch {
    return null;
  }
}

export interface HostSshConnectionOptions {
  config: ConnectConfig;
  label: string;
  fingerprintMismatch: () => { expected: string; observed: string | null } | null;
  /** 首次连接必须等待指纹持久化成功后，才能执行任何命令 / 打开 Shell。 */
  ensureFingerprintRecorded: () => Promise<void>;
  /** 配置/凭据在握手期间发生变化时拒绝接受该连接。 */
  assertCurrent: () => Promise<void>;
}

/**
 * 构造平台主机 SSH 连接参数（执行层与交互终端共用）。
 * 凭据只在服务端内存短暂存在；hostVerifier 统一实施 TOFU / 指纹固定。
 */
export async function getHostSshConnectionOptions(hostId: number): Promise<HostSshConnectionOptions> {
  const row = await loadHostRow(hostId);
  if (!row.enabled) throw new HTTPException(400, { message: `主机「${row.name}」已停用` });

  const auth: Partial<ConnectConfig> = {};
  if (row.authType === 'password') {
    const password = decryptField(row.passwordEncrypted);
    if (!password) throw new HTTPException(400, { message: '主机密码未配置或解密失败' });
    auth.password = password;
  } else {
    const privateKey = decryptField(row.keyContentEncrypted);
    if (!privateKey) throw new HTTPException(400, { message: '主机私钥未配置或解密失败' });
    auth.privateKey = privateKey;
    const passphrase = decryptField(row.keyPassphraseEncrypted);
    if (passphrase) auth.passphrase = passphrase;
  }

  let fingerprintMismatch = false;
  let observedFingerprint: string | null = null;
  let fingerprintWrite: Promise<void> = Promise.resolve();
  const config: ConnectConfig = {
    host: row.host,
    port: row.port,
    username: row.username,
    ...auth,
    readyTimeout: 10_000,
    keepaliveInterval: 30_000,
    // TOFU:首连记录指纹,此后不匹配直接拒绝握手
    hostVerifier: (key: Buffer) => {
      observedFingerprint = createHash('sha256').update(key).digest('base64');
      if (!row.hostKeyFingerprint) {
        const fingerprint = observedFingerprint;
        fingerprintWrite = (async () => {
          // CAS：多进程同时首连时只有一个实例能从 null 写入；失败者必须读取并比对，
          // 不能无条件覆盖另一个实例刚固定的指纹。
          const [claimed] = await db.update(opsHosts)
            .set({ hostKeyFingerprint: fingerprint })
            .where(and(
              eq(opsHosts.id, hostId),
              eq(opsHosts.connectionVersion, row.connectionVersion),
              isNull(opsHosts.hostKeyFingerprint),
            ))
            .returning({ fingerprint: opsHosts.hostKeyFingerprint });
          if (claimed) return;
          const [current] = await db.select({ fingerprint: opsHosts.hostKeyFingerprint })
            .from(opsHosts)
            .where(eq(opsHosts.id, hostId))
            .limit(1);
          if (!current || current.fingerprint !== fingerprint) {
            throw new HTTPException(409, { message: 'SSH host key 在首次连接期间发生冲突，连接已拒绝' });
          }
        })();
        return true;
      }
      if (row.hostKeyFingerprint === observedFingerprint) return true;
      fingerprintMismatch = true;
      return false;
    },
  };
  return {
    config,
    label: `${row.username}@${row.host}:${row.port}`,
    fingerprintMismatch: () => fingerprintMismatch && row.hostKeyFingerprint
      ? { expected: row.hostKeyFingerprint, observed: observedFingerprint }
      : null,
    ensureFingerprintRecorded: async () => {
      try {
        await fingerprintWrite;
      } catch (err) {
        logger.error({ err, hostId }, '[host-exec] host key 指纹持久化失败，拒绝继续连接');
        throw new HTTPException(500, { message: 'SSH host key 指纹持久化失败，连接已拒绝' });
      }
    },
    assertCurrent: async () => {
      const [current] = await db.select({
        version: opsHosts.connectionVersion,
        enabled: opsHosts.enabled,
      }).from(opsHosts).where(eq(opsHosts.id, hostId)).limit(1);
      if (!current || !current.enabled || current.version !== row.connectionVersion) {
        throw new HTTPException(409, { message: '主机配置在连接期间已变更，请重试' });
      }
    },
  };
}

async function createConnection(hostId: number): Promise<PooledConnection> {
  const target = await getHostSshConnectionOptions(hostId);
  const client = new SshClient();

  const ready = new Promise<void>((resolve, reject) => {
    client.on('ready', () => {
      void target.ensureFingerprintRecorded()
        .then(() => target.assertCurrent())
        .then(resolve)
        .catch((err) => {
          try { client.end(); } catch { /* ignore */ }
          reject(err);
        });
    });
    client.on('error', (err) => {
      const mismatch = target.fingerprintMismatch();
      if (mismatch) {
        reject(new HTTPException(409, {
          message: `主机指纹不匹配(可能是主机重装或中间人攻击)。当前指纹 ${mismatch.observed},`
            + '确认无风险后请在主机管理中重置指纹。',
        }));
        return;
      }
      reject(new HTTPException(502, { message: `SSH 连接失败: ${err.message}` }));
    });
    client.connect(target.config);
  });

  const conn: PooledConnection = {
    client,
    ready,
    inFlight: 0,
    waiters: [],
    idleTimer: null,
    sftp: null,
    sftpReady: null,
    closed: false,
  };
  client.on('close', () => {
    conn.sftp = null;
    conn.sftpReady = null;
    disposeConnection(hostId, conn);
  });
  return conn;
}

async function acquireConnection(hostId: number): Promise<PooledConnection> {
  let conn = pool.get(hostId);
  if (!conn || conn.closed) {
    let pending = pendingConnections.get(hostId);
    if (!pending) {
      const generation = connectionGenerations.get(hostId) ?? 0;
      const tracked = createConnection(hostId)
        .then((created) => {
          if ((connectionGenerations.get(hostId) ?? 0) !== generation) {
            disposeConnection(hostId, created);
            throw new HTTPException(409, { message: '主机配置已变更，请重试' });
          }
          pool.set(hostId, created);
          return created;
        })
        .finally(() => {
          if (pendingConnections.get(hostId) === tracked) pendingConnections.delete(hostId);
        });
      pending = tracked;
      pendingConnections.set(hostId, tracked);
    }
    conn = await pending;
  }
  try {
    await conn.ready;
  } catch (err) {
    disposeConnection(hostId, conn);
    throw err;
  }
  return conn;
}

async function acquireChannelSlot(conn: PooledConnection): Promise<void> {
  if (conn.inFlight < MAX_CONCURRENT_CHANNELS) {
    conn.inFlight += 1;
    return;
  }
  await new Promise<void>((resolve, reject) => conn.waiters.push({ resolve, reject }));
  conn.inFlight += 1;
}

function releaseChannelSlot(hostId: number, conn: PooledConnection): void {
  conn.inFlight = Math.max(0, conn.inFlight - 1);
  const next = conn.waiters.shift();
  if (next) next.resolve();
  if (conn.inFlight === 0) touchIdle(hostId, conn);
}

class SshExecutor implements RemoteHostExecutor {
  readonly isRemote = true;

  constructor(readonly hostId: number) {}

  async exec(file: string, args: readonly string[] = [], opts: ExecOptions = {}): Promise<ExecResult> {
    const conn = await acquireConnection(this.hostId);
    await acquireChannelSlot(conn);
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxBuffer = opts.maxBuffer ?? DEFAULT_MAX_BUFFER;
    // LANG=C 固定命令输出语言,保证各服务的文本解析稳定
    const command = `LANG=C LC_ALL=C ${buildShellCommand(file, args)}`;

    try {
      return await new Promise<ExecResult>((resolve, reject) => {
        conn.client.exec(command, (err, stream) => {
          if (err) {
            reject(new HTTPException(502, { message: `SSH 执行失败: ${err.message}` }));
            return;
          }
          let stdout = '';
          let stderr = '';
          let settled = false;
          const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            try { stream.close(); } catch { /* ignore */ }
            reject(new HostExecError(`命令执行超时(${timeoutMs}ms)`, stdout, stderr, null));
          }, timeoutMs);

          const guard = (chunk: string, target: 'out' | 'err') => {
            if (target === 'out') stdout += chunk; else stderr += chunk;
            if (stdout.length + stderr.length > maxBuffer && !settled) {
              settled = true;
              clearTimeout(timer);
              try { stream.close(); } catch { /* ignore */ }
              reject(new HostExecError('命令输出超出上限', stdout.slice(0, 4096), stderr.slice(0, 4096), null));
            }
          };
          stream.on('data', (d: Buffer) => guard(d.toString('utf8'), 'out'));
          stream.stderr.on('data', (d: Buffer) => guard(d.toString('utf8'), 'err'));
          stream.on('close', (code: number | null) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (code === 0) resolve({ stdout, stderr });
            else reject(new HostExecError(`命令退出码 ${code ?? 'unknown'}${stderr ? `: ${stderr.slice(0, 500)}` : ''}`, stdout, stderr, code));
          });
        });
      });
    } finally {
      releaseChannelSlot(this.hostId, conn);
    }
  }

  async execStream(file: string, args: readonly string[], opts: StreamOptions): Promise<StreamHandle> {
    const conn = await acquireConnection(this.hostId);
    await acquireChannelSlot(conn);
    const command = `LANG=C LC_ALL=C ${buildShellCommand(file, args)}`;

    return await new Promise<StreamHandle>((resolve, reject) => {
      conn.client.exec(command, (err, stream) => {
        if (err) {
          releaseChannelSlot(this.hostId, conn);
          reject(new HTTPException(502, { message: `SSH 执行失败: ${err.message}` }));
          return;
        }
        let released = false;
        const release = () => {
          if (released) return;
          released = true;
          releaseChannelSlot(this.hostId, conn);
        };
        stream.on('data', (d: Buffer) => opts.onData(d.toString('utf8')));
        stream.stderr.on('data', (d: Buffer) => opts.onData(d.toString('utf8')));
        stream.on('close', (code: number | null) => {
          release();
          opts.onExit?.(code);
        });
        resolve({
          kill: () => {
            try {
              // 长驻命令(tail -f)对 close 无响应,发 SIGKILL 信号后强制关通道
              stream.signal('KILL');
            } catch { /* ignore */ }
            try { stream.close(); } catch { /* ignore */ }
            release();
          },
        });
      });
    });
  }

  private async getSftp(): Promise<SFTPWrapper> {
    const conn = await acquireConnection(this.hostId);
    if (conn.sftp) {
      touchIdle(this.hostId, conn);
      return conn.sftp;
    }
    if (!conn.sftpReady) {
      const pending = new Promise<SFTPWrapper>((resolve, reject) => {
        conn.client.sftp((err, sftp) => {
          if (err) {
            reject(new HTTPException(502, { message: `SFTP 通道建立失败: ${err.message}` }));
            return;
          }
          conn.sftp = sftp;
          const clear = () => {
            if (conn.sftp === sftp) conn.sftp = null;
          };
          sftp.on('end', clear);
          sftp.on('close', clear);
          touchIdle(this.hostId, conn);
          resolve(sftp);
        });
      }).finally(() => {
        if (conn.sftpReady === pending) conn.sftpReady = null;
      });
      conn.sftpReady = pending;
    }
    return conn.sftpReady;
  }

  async acquireSftp(): Promise<{ sftp: SFTPWrapper; release: () => void }> {
    const conn = await acquireConnection(this.hostId);
    await acquireChannelSlot(conn);
    try {
      const sftp = await this.getSftp();
      let released = false;
      return {
        sftp,
        release: () => {
          if (released) return;
          released = true;
          releaseChannelSlot(this.hostId, conn);
        },
      };
    } catch (err) {
      releaseChannelSlot(this.hostId, conn);
      throw err;
    }
  }
}

// ─── 解析入口 ──────────────────────────────────────────────────────────────────

/** hostId 为空 → 本机;否则校验主机存在且启用,返回远端执行器 */
export async function resolveExecutor(hostId?: number | null): Promise<HostExecutor> {
  if (hostId == null) return localExecutor;
  return getRemoteExecutor(hostId);
}

export async function getRemoteExecutor(hostId: number): Promise<RemoteHostExecutor> {
  const row = await loadHostRow(hostId);
  if (!row.enabled) throw new HTTPException(400, { message: `主机「${row.name}」已停用` });
  return new SshExecutor(hostId);
}

/** 优雅停机:关闭全部远端连接 */
export function closeAllHostConnections(): void {
  for (const [hostId, conn] of pool) disposeConnection(hostId, conn);
}
