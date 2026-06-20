import { posix as posixPath } from 'node:path';
import { Readable } from 'node:stream';
import SftpClient from 'ssh2-sftp-client';
import { HTTPException } from 'hono/http-exception';
import { formatDateTime } from '../lib/datetime';
import { getSshConnectParams } from './ssh-profiles.service';

/**
 * SSH 远程文件（SFTP）服务
 *
 * 复用 SSH 配置（ssh_profiles）的连接参数，通过 ssh2-sftp-client 访问远程主机文件系统。
 * 权限边界与 Web 终端一致（system:terminal:execute）：能开终端即能传文件。
 *
 * 连接池：按 `${userId}:${profileId}` 缓存 SFTP 连接，空闲 SFTP_IDLE_MS 后自动断开；
 * 同一连接上的操作通过 mutex 串行化，避免并发命令交错。
 */

const SFTP_IDLE_MS = 2 * 60 * 1000;
const MAX_EDIT_SIZE = 5 * 1024 * 1024; // 5MB

export interface SftpFileEntry {
  name: string;
  path: string;
  type: 'dir' | 'file';
  size: number;
  mtime: string;
  permissions?: string;
}

interface PoolEntry {
  client: SftpClient;
  lastUsed: number;
  /** 操作串行化队列尾部 */
  mutex: Promise<unknown>;
  connected: boolean;
}

const pool = new Map<string, PoolEntry>();

function poolKey(userId: number, profileId: number): string {
  return `${userId}:${profileId}`;
}

/** 周期性回收空闲 SFTP 连接 */
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of pool.entries()) {
    if (now - entry.lastUsed > SFTP_IDLE_MS) {
      pool.delete(key);
      void entry.client.end().catch(() => { /* ignore */ });
    }
  }
}, 30_000).unref();

async function connectClient(userId: number, profileId: number): Promise<SftpClient> {
  const params = await getSshConnectParams(profileId, userId);
  const client = new SftpClient();
  const config: Record<string, unknown> = {
    host: params.host,
    port: params.port,
    username: params.username,
    readyTimeout: 10000,
    ...('password' in params ? { password: (params as { password: string }).password } : {}),
    ...('privateKey' in params
      ? { privateKey: (params as { privateKey: string }).privateKey, passphrase: (params as { passphrase?: string }).passphrase }
      : {}),
    ...('agent' in params ? { agent: (params as { agent: string }).agent } : {}),
  };
  await client.connect(config);
  return client;
}

/** 获取（或建立）连接池条目 */
async function acquire(userId: number, profileId: number): Promise<PoolEntry> {
  const key = poolKey(userId, profileId);
  let entry = pool.get(key);
  if (entry?.connected) {
    entry.lastUsed = Date.now();
    return entry;
  }
  try {
    const client = await connectClient(userId, profileId);
    client.on('end', () => {
      const cur = pool.get(key);
      if (cur?.client === client) pool.delete(key);
    });
    client.on('close', () => {
      const cur = pool.get(key);
      if (cur?.client === client) pool.delete(key);
    });
    entry = { client, lastUsed: Date.now(), mutex: Promise.resolve(), connected: true };
    pool.set(key, entry);
    return entry;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new HTTPException(400, { message: `SFTP 连接失败: ${msg}` });
  }
}

/** 在指定连接上串行执行一个 SFTP 操作 */
async function withSftp<T>(userId: number, profileId: number, fn: (c: SftpClient) => Promise<T>): Promise<T> {
  const entry = await acquire(userId, profileId);
  const run = entry.mutex.then(async () => {
    entry.lastUsed = Date.now();
    try {
      return await fn(entry.client);
    } catch (err) {
      if (err instanceof HTTPException) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      throw new HTTPException(400, { message: `SFTP 操作失败: ${msg}` });
    } finally {
      entry.lastUsed = Date.now();
    }
  });
  // mutex 仅用于排队，吞掉错误避免阻断后续操作
  entry.mutex = run.catch(() => undefined);
  return run;
}

function rightsToString(rights?: { user?: string; group?: string; other?: string }): string | undefined {
  if (!rights) return undefined;
  const pad = (s?: string) => (s ?? '').padEnd(3, '-').slice(0, 3);
  return `${pad(rights.user)}${pad(rights.group)}${pad(rights.other)}`;
}

function isBinaryBuffer(buf: Buffer): boolean {
  const len = Math.min(buf.length, 8000);
  for (let i = 0; i < len; i += 1) {
    if (buf[i] === 0) return true;
  }
  return false;
}

/** 远程 home 目录（realpath('.')） */
export async function sftpHome(userId: number, profileId: number): Promise<{ home: string }> {
  const home = await withSftp(userId, profileId, (c) => c.realPath('.'));
  return { home: home || '/' };
}

/** 列出远程目录内容 */
export async function sftpList(
  userId: number,
  profileId: number,
  dirPath?: string,
): Promise<{ path: string; parent: string | null; entries: SftpFileEntry[] }> {
  return withSftp(userId, profileId, async (c) => {
    const target = dirPath?.trim() ? dirPath : await c.realPath('.');
    const resolved = posixPath.resolve('/', target);
    const exists = await c.exists(resolved);
    if (exists !== 'd') throw new HTTPException(400, { message: '目标不是目录或不存在' });

    const items = await c.list(resolved);
    const entries: SftpFileEntry[] = items
      .filter((it) => it.name !== '.' && it.name !== '..')
      .map((it) => ({
        name: it.name,
        path: posixPath.join(resolved, it.name),
        type: it.type === 'd' ? ('dir' as const) : ('file' as const),
        size: it.size,
        mtime: formatDateTime(new Date(it.modifyTime)),
        permissions: rightsToString(it.rights),
      }));
    entries.sort((a, b) => {
      if (a.type === b.type) return a.name.localeCompare(b.name);
      return a.type === 'dir' ? -1 : 1;
    });
    const parent = posixPath.dirname(resolved);
    return { path: resolved, parent: parent === resolved ? null : parent, entries };
  });
}

/** 读取远程文本文件（含大小/二进制校验） */
export async function sftpReadText(
  userId: number,
  profileId: number,
  filePath: string,
): Promise<{ path: string; content: string; size: number }> {
  if (!filePath?.trim()) throw new HTTPException(400, { message: '缺少文件路径' });
  const resolved = posixPath.resolve('/', filePath);
  return withSftp(userId, profileId, async (c) => {
    const st = await c.stat(resolved).catch(() => null);
    if (!st) throw new HTTPException(404, { message: '文件不存在' });
    if (st.isDirectory) throw new HTTPException(400, { message: '不能读取目录内容' });
    if (st.size > MAX_EDIT_SIZE) throw new HTTPException(400, { message: '文件过大，无法在线编辑（上限 5MB）' });
    const buf = (await c.get(resolved)) as Buffer;
    if (isBinaryBuffer(buf)) throw new HTTPException(400, { message: '二进制文件无法在线编辑' });
    return { path: resolved, content: buf.toString('utf-8'), size: st.size };
  });
}

/** 写入远程文本文件 */
export async function sftpWriteText(
  userId: number,
  profileId: number,
  filePath: string,
  content: string,
): Promise<SftpFileEntry> {
  if (!filePath?.trim()) throw new HTTPException(400, { message: '缺少文件路径' });
  const resolved = posixPath.resolve('/', filePath);
  return withSftp(userId, profileId, async (c) => {
    await c.put(Buffer.from(content, 'utf-8'), resolved);
    return statEntry(c, resolved);
  });
}

/** 新建远程文件或目录 */
export async function sftpCreate(
  userId: number,
  profileId: number,
  targetPath: string,
  type: 'file' | 'dir',
): Promise<SftpFileEntry> {
  if (!targetPath?.trim()) throw new HTTPException(400, { message: '缺少路径' });
  const resolved = posixPath.resolve('/', targetPath);
  return withSftp(userId, profileId, async (c) => {
    if (await c.exists(resolved)) throw new HTTPException(400, { message: '同名文件或目录已存在' });
    if (type === 'dir') {
      await c.mkdir(resolved, true);
    } else {
      await c.put(Buffer.from(''), resolved);
    }
    return statEntry(c, resolved);
  });
}

/** 删除远程文件或目录 */
export async function sftpDelete(userId: number, profileId: number, targetPath: string): Promise<void> {
  if (!targetPath?.trim()) throw new HTTPException(400, { message: '缺少路径' });
  const resolved = posixPath.resolve('/', targetPath);
  if (resolved === '/') throw new HTTPException(400, { message: '禁止删除根目录' });
  await withSftp(userId, profileId, async (c) => {
    const kind = await c.exists(resolved);
    if (!kind) throw new HTTPException(404, { message: '路径不存在' });
    if (kind === 'd') await c.rmdir(resolved, true);
    else await c.delete(resolved);
  });
}

/** 修改远程文件/目录权限（chmod） */
export async function sftpChmod(userId: number, profileId: number, targetPath: string, mode: number): Promise<void> {
  if (!targetPath?.trim()) throw new HTTPException(400, { message: '缺少路径' });
  const resolved = posixPath.resolve('/', targetPath);
  await withSftp(userId, profileId, async (c) => {
    if (!(await c.exists(resolved))) throw new HTTPException(404, { message: '路径不存在' });
    await c.chmod(resolved, mode);
  });
}

/** 重命名 / 移动远程文件或目录 */
export async function sftpRename(
  userId: number,
  profileId: number,
  from: string,
  to: string,
): Promise<SftpFileEntry> {
  if (!from?.trim() || !to?.trim()) throw new HTTPException(400, { message: '缺少路径参数' });
  const src = posixPath.resolve('/', from);
  const dst = posixPath.resolve('/', to);
  return withSftp(userId, profileId, async (c) => {
    if (!(await c.exists(src))) throw new HTTPException(404, { message: '源路径不存在' });
    if (await c.exists(dst)) throw new HTTPException(400, { message: '目标已存在' });
    await c.rename(src, dst);
    return statEntry(c, dst);
  });
}

/** 打开远程文件下载流 */
export async function sftpDownload(
  userId: number,
  profileId: number,
  filePath: string,
): Promise<{ stream: Readable; fileName: string }> {
  if (!filePath?.trim()) throw new HTTPException(400, { message: '缺少文件路径' });
  const resolved = posixPath.resolve('/', filePath);
  return withSftp(userId, profileId, async (c) => {
    const st = await c.stat(resolved).catch(() => null);
    if (!st) throw new HTTPException(404, { message: '文件不存在' });
    if (st.isDirectory) throw new HTTPException(400, { message: '不能下载目录' });
    const buf = (await c.get(resolved)) as Buffer;
    return { stream: Readable.from(buf), fileName: posixPath.basename(resolved) };
  });
}

/** 上传文件到远程目录 */
export async function sftpUpload(
  userId: number,
  profileId: number,
  dirPath: string,
  file: File,
): Promise<SftpFileEntry> {
  const dir = posixPath.resolve('/', dirPath?.trim() ? dirPath : '/');
  const dest = posixPath.join(dir, file.name);
  const buffer = Buffer.from(await file.arrayBuffer());
  return withSftp(userId, profileId, async (c) => {
    const kind = await c.exists(dir);
    if (kind !== 'd') throw new HTTPException(404, { message: '目标目录不存在' });
    await c.put(buffer, dest);
    return statEntry(c, dest);
  });
}

/** 读取单个远程条目信息 */
async function statEntry(c: SftpClient, filePath: string): Promise<SftpFileEntry> {
  const st = await c.stat(filePath);
  return {
    name: posixPath.basename(filePath),
    path: filePath,
    type: st.isDirectory ? 'dir' : 'file',
    size: st.size,
    mtime: formatDateTime(new Date(st.modifyTime)),
  };
}
