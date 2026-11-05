/** 应用自身的日志：仅读取 LOG_DIR 内 Pino 按角色生成的文件，与进程启动管理器无关。 */
import { createHash } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import fsp, { type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { QueryOutputOf } from '@zenith/shared/core';
import { CONSOLE_LOG_ROLES, CONSOLE_LOG_ROLE_LABELS, type ConsoleLogRole, type consoleLogContract } from '@zenith/shared/ops';
import { config } from '../../config';
import { PROCESS_HOSTNAME, PROCESS_PID } from '../../lib/process-identity';
import { collectTailLines, TAIL_POLL_INTERVAL_MS, TAIL_REPLAY_LINES } from './log-reader';

const READ_CHUNK_BYTES = 64 * 1024;
// 限制未完成单行的内存；正常 Pino 记录不会接近此值，异常巨行明确报错而不静默丢失。
const MAX_LINE_BYTES = 8 * 1024 * 1024;
const ANCHOR_BYTES = 64;
const FILE_PATTERN = /^app(?:-(api|worker))?\.(\d{4}-\d{2}-\d{2})\.([1-9]\d{0,14})\.log$/;

interface AppLogFile { name: string; role: ConsoleLogRole; date: string; sequence: number }
interface LogRecord { line: string; id: string }
interface ReadPosition {
  file: AppLogFile;
  identity: string;
  offset: number;
  pending: Buffer;
  anchor: Buffer;
}
interface Cursor { v: 1; role: ConsoleLogRole; file: string; identity: string; offset: number; fingerprint: string }

function currentRole(): ConsoleLogRole {
  const role = (config as { roles?: { label?: string } }).roles?.label;
  return CONSOLE_LOG_ROLES.find((value) => value === role) ?? 'all';
}

function logDirectory(): string { return path.resolve(config.log.dir); }
function isMissing(error: unknown): boolean { return (error as NodeJS.ErrnoException).code === 'ENOENT'; }
function fileIdentity(stat: Stats): string { return `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`; }
function fingerprint(bytes: Buffer): string { return createHash('sha256').update(bytes).digest('base64url'); }

function parseFilename(name: string): AppLogFile | undefined {
  const match = FILE_PATTERN.exec(name);
  if (!match) return undefined;
  return { name, role: (match[1] ?? 'all') as ConsoleLogRole, date: match[2], sequence: Number(match[3]) };
}

function compareFiles(a: AppLogFile, b: AppLogFile): number {
  return a.date.localeCompare(b.date) || a.sequence - b.sequence;
}

async function discoverFiles(): Promise<AppLogFile[]> {
  try {
    const entries = await fsp.readdir(logDirectory(), { withFileTypes: true });
    return entries.flatMap((entry) => {
      const file = entry.isFile() ? parseFilename(entry.name) : undefined;
      return file ? [file] : [];
    }).sort(compareFiles);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}

/** 白名单由目录枚举产生；拒绝链接和枚举后被替换的非普通文件。 */
async function openLogFile(file: AppLogFile): Promise<{ handle: FileHandle; stat: Stats } | undefined> {
  const filepath = path.join(logDirectory(), file.name);
  let handle: FileHandle | undefined;
  try {
    const before = await fsp.lstat(filepath);
    if (!before.isFile()) return undefined;
    handle = await fsp.open(filepath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = await handle.stat();
    if (!stat.isFile() || fileIdentity(before) !== fileIdentity(stat)) {
      await handle.close();
      return undefined;
    }
    return { handle, stat };
  } catch (error) {
    await handle?.close();
    if (isMissing(error)) return undefined;
    throw error;
  }
}

async function readAnchor(handle: FileHandle, offset: number): Promise<Buffer> {
  const size = Math.min(offset, ANCHOR_BYTES);
  const bytes = Buffer.alloc(size);
  const { bytesRead } = await handle.read(bytes, 0, size, offset - size);
  return bytes.subarray(0, bytesRead);
}

function appendAnchor(before: Buffer, bytes: Buffer): Buffer {
  return Buffer.from(bytes.length >= ANCHOR_BYTES
    ? bytes.subarray(bytes.length - ANCHOR_BYTES)
    : Buffer.concat([before, bytes]).subarray(-ANCHOR_BYTES));
}

function encodeCursor(position: ReadPosition, offset: number, anchor: Buffer): string {
  return Buffer.from(JSON.stringify({ v: 1, role: position.file.role, file: position.file.name,
    identity: position.identity, offset, fingerprint: fingerprint(anchor) } satisfies Cursor)).toString('base64url');
}

/** SSE 客户端离开时释放读取句柄，即使最后一次网络写仍在等待背压。 */
async function emitUntilAborted(signal: AbortSignal, emit: (record: LogRecord) => Promise<void>, record: LogRecord): Promise<void> {
  if (signal.aborted) return;
  let onAbort: () => void = () => {};
  const aborted = new Promise<void>((resolve) => {
    onAbort = resolve;
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try { await Promise.race([emit(record), aborted]); }
  finally { signal.removeEventListener('abort', onAbort); }
}

function decodeCursor(value: string, role: ConsoleLogRole): Cursor | undefined {
  if (!value || value.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(value)) return undefined;
  try {
    const cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<Cursor>;
    if (cursor.v !== 1 || cursor.role !== role || typeof cursor.file !== 'string'
      || parseFilename(cursor.file)?.role !== role || typeof cursor.identity !== 'string' || cursor.identity.length > 128
      || !Number.isSafeInteger(cursor.offset) || cursor.offset! <= 0
      || typeof cursor.fingerprint !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(cursor.fingerprint)) return undefined;
    return cursor as Cursor;
  } catch { return undefined; }
}

async function restorePosition(value: string | undefined, role: ConsoleLogRole, files: AppLogFile[]): Promise<ReadPosition | undefined> {
  const cursor = value ? decodeCursor(value, role) : undefined;
  const file = cursor && files.find((item) => item.name === cursor.file);
  if (!cursor || !file) return undefined;
  const opened = await openLogFile(file);
  if (!opened) return undefined;
  try {
    if (fileIdentity(opened.stat) !== cursor.identity || opened.stat.size < cursor.offset) return undefined;
    const anchor = await readAnchor(opened.handle, cursor.offset);
    if (anchor.at(-1) !== 10 || fingerprint(anchor) !== cursor.fingerprint) return undefined;
    return { file, identity: cursor.identity, offset: cursor.offset, pending: Buffer.alloc(0), anchor };
  } finally { await opened.handle.close(); }
}

/**
 * 在同一个 fd 的固定 size 快照上读取，返回的字节位置直接用于下一次 follow。
 * 只在 LF 到齐后解码 UTF-8；pending 保留跨块 / 跨轮询的中文与半行。
 */
async function readSnapshot(
  file: AppLogFile,
  previous: ReadPosition | undefined,
  signal: AbortSignal | undefined,
  emit: (record: LogRecord) => Promise<void>,
): Promise<ReadPosition | undefined> {
  if (signal?.aborted) return previous;
  const opened = await openLogFile(file);
  if (!opened) return undefined;
  const { handle, stat } = opened;
  try {
    const identity = fileIdentity(stat);
    let position: ReadPosition | undefined = previous;
    if (!position || position.file.name !== file.name || position.identity !== identity || position.offset > stat.size
      || !(await readAnchor(handle, position.offset)).equals(position.anchor)) {
      position = { file, identity, offset: 0, pending: Buffer.alloc(0), anchor: Buffer.alloc(0) };
    }
    const chunk = Buffer.alloc(READ_CHUNK_BYTES);
    while (position.offset < stat.size && !signal?.aborted) {
      const { bytesRead }: { bytesRead: number } = await handle.read(chunk, 0, Math.min(chunk.length, stat.size - position.offset), position.offset);
      if (bytesRead === 0) break;
      const bytes: Buffer = chunk.subarray(0, bytesRead);
      const pendingLength: number = position.pending.length;
      const joined: Buffer = pendingLength ? Buffer.concat([position.pending, bytes]) : bytes;
      let start = 0;
      for (let end = joined.indexOf(10); end !== -1; end = joined.indexOf(10, start)) {
        if (signal?.aborted) return position;
        if (end - start > MAX_LINE_BYTES) throw new Error('应用日志单行超过 8 MiB，无法在控制台显示');
        const line = joined.subarray(start, end).toString('utf8').replace(/\r$/, '');
        const consumed = end + 1 - pendingLength;
        if (line.trim()) {
          const anchor = appendAnchor(position.anchor, bytes.subarray(0, consumed));
          await emit({ line, id: encodeCursor(position, position.offset + consumed, anchor) });
        }
        start = end + 1;
      }
      const pending: Buffer = joined.subarray(start);
      if (pending.length > MAX_LINE_BYTES) throw new Error('应用日志单行超过 8 MiB，无法在控制台显示');
      position = { ...position, offset: position.offset + bytesRead,
        pending: Buffer.from(pending), anchor: appendAnchor(position.anchor, bytes) };
    }
    return position;
  } finally { await handle.close(); }
}

/**
 * 从固定 size 快照末尾按块反向找完整行，凑足窗口立即停止。
 * 最后半行单独保留；follow 从该快照的 EOF 接续，不会把回放期间的新字节跳过去。
 */
async function readRecentSnapshot(
  file: AppLogFile,
  limit: number,
  signal: AbortSignal | undefined,
  withIds: boolean,
): Promise<{ records: LogRecord[]; position: ReadPosition } | undefined> {
  if (signal?.aborted) return undefined;
  const opened = await openLogFile(file);
  if (!opened) return undefined;
  const { handle, stat } = opened;
  try {
    const position: ReadPosition = { file, identity: fileIdentity(stat), offset: stat.size,
      pending: Buffer.alloc(0), anchor: await readAnchor(handle, stat.size) };
    const records: LogRecord[] = [];
    const chunk = Buffer.alloc(READ_CHUNK_BYTES);
    let offset = stat.size;
    let lineEnd = stat.size;
    let complete = false;
    let fragments: Buffer[] = [];
    let fragmentBytes = 0;
    const addFragment = (bytes: Buffer) => {
      fragmentBytes += bytes.length;
      if (fragmentBytes > MAX_LINE_BYTES) throw new Error('应用日志单行超过 8 MiB，无法在控制台显示');
      if (bytes.length) fragments.push(Buffer.from(bytes));
    };
    const takeLine = async () => {
      const bytes = Buffer.concat(fragments.reverse(), fragmentBytes);
      fragments = [];
      fragmentBytes = 0;
      if (!complete) {
        position.pending = bytes;
        complete = true;
        return;
      }
      const line = bytes.toString('utf8').replace(/\r$/, '');
      if (line.trim()) records.push({ line,
        id: withIds ? encodeCursor(position, lineEnd, await readAnchor(handle, lineEnd)) : '' });
    };
    while (offset > 0 && records.length < limit && !signal?.aborted) {
      const start = Math.max(0, offset - chunk.length);
      const { bytesRead } = await handle.read(chunk, 0, offset - start, start);
      if (bytesRead !== offset - start) {
        // 不能把使用旧 offset 的残缺快照伪装成正常近期窗口；SSE 重连后读取新快照。
        throw new Error('应用日志在读取期间被截短，请重试');
      }
      let end = bytesRead;
      for (let newline = chunk.lastIndexOf(10, end - 1); newline >= 0; newline = chunk.lastIndexOf(10, end - 1)) {
        if (signal?.aborted) return undefined;
        addFragment(chunk.subarray(newline + 1, end));
        await takeLine();
        lineEnd = start + newline + 1;
        end = newline;
        if (records.length >= limit || end === 0) break;
      }
      if (records.length >= limit) break;
      addFragment(chunk.subarray(0, end));
      offset = start;
    }
    if (!signal?.aborted && records.length < limit && offset === 0) await takeLine();
    return { records: records.reverse(), position };
  } finally { await handle.close(); }
}

async function readRecentRecords(files: AppLogFile[], limit: number, signal?: AbortSignal, withIds = false) {
  const batches: LogRecord[][] = [];
  let position: ReadPosition | undefined;
  let remaining = limit;
  for (let index = files.length - 1; index >= 0 && remaining > 0 && !signal?.aborted; index -= 1) {
    const snapshot = await readRecentSnapshot(files[index], remaining, signal, withIds);
    if (!snapshot) continue;
    position ??= snapshot.position;
    remaining -= snapshot.records.length;
    batches.push(snapshot.records);
  }
  return { records: batches.reverse().flat(), position };
}

export async function getConsoleLogSources() {
  const role = currentRole();
  const files = await discoverFiles();
  const availableRoles = new Set(files.map((file) => file.role));
  return { currentRole: role, hostname: PROCESS_HOSTNAME, pid: PROCESS_PID,
    sources: CONSOLE_LOG_ROLES.filter((value) => value === role || availableRoles.has(value))
      .map((value) => ({ role: value, label: CONSOLE_LOG_ROLE_LABELS[value], available: availableRoles.has(value) })) };
}

export async function readConsoleLogLines(query: QueryOutputOf<typeof consoleLogContract.content>): Promise<string[]> {
  const role = query.role ?? currentRole();
  const files = (await discoverFiles()).filter((file) => file.role === role);
  if (!query.keyword?.trim() && !query.correlationId && !query.locateCorrelationId) {
    return (await readRecentRecords(files, query.lines ?? 500)).records.map((record) => record.line);
  }
  // 复用日志工作台的过滤、上下文与 correlationId 定位语义；跨轮转文件视为连续行序列。
  async function* lines() {
    for (const file of files) {
      const opened = await openLogFile(file);
      if (!opened) continue;
      const { handle, stat } = opened;
      try {
        const chunk = Buffer.alloc(READ_CHUNK_BYTES);
        let offset = 0;
        let pending = Buffer.alloc(0);
        while (offset < stat.size) {
          const { bytesRead } = await handle.read(chunk, 0, Math.min(chunk.length, stat.size - offset), offset);
          if (!bytesRead) break;
          offset += bytesRead;
          const joined = pending.length ? Buffer.concat([pending, chunk.subarray(0, bytesRead)]) : chunk.subarray(0, bytesRead);
          let start = 0;
          for (let end = joined.indexOf(10); end !== -1; end = joined.indexOf(10, start)) {
            if (end - start > MAX_LINE_BYTES) throw new Error('应用日志单行超过 8 MiB，无法在控制台显示');
            yield joined.subarray(start, end).toString('utf8').replace(/\r$/, '');
            start = end + 1;
          }
          pending = Buffer.from(joined.subarray(start));
          if (pending.length > MAX_LINE_BYTES) throw new Error('应用日志单行超过 8 MiB，无法在控制台显示');
        }
      } finally { await handle.close(); }
    }
  }
  return collectTailLines(lines(), query.lines ?? 500, query);
}

export async function tailConsoleLogLines(
  query: QueryOutputOf<typeof consoleLogContract.tail>,
  signal: AbortSignal,
  emit: (record: LogRecord) => Promise<void>,
  cursor?: string,
): Promise<void> {
  if (signal.aborted) return;
  const role = query.role ?? currentRole();
  let files = (await discoverFiles()).filter((file) => file.role === role);
  let position = await restorePosition(cursor, role, files);
  if (!position) {
    const recent = await readRecentRecords(files, TAIL_REPLAY_LINES, signal, true);
    position = recent.position;
    for (const record of recent.records) {
      if (signal.aborted) return;
      await emitUntilAborted(signal, emit, record);
    }
  }
  while (!signal.aborted) {
    // 首轮立即读取，回放期间追加的字节从原快照 offset 接续，不重取文件 size 跳到 EOF。
    files = (await discoverFiles()).filter((file) => file.role === role && (!position || compareFiles(file, position.file) >= 0));
    for (const file of files) {
      if (signal.aborted) return;
      position = await readSnapshot(file, position?.file.name === file.name ? position : undefined, signal,
        (record) => emitUntilAborted(signal, emit, record)) ?? position;
    }
    try { await delay(TAIL_POLL_INTERVAL_MS, undefined, { signal }); }
    catch (error) { if (!signal.aborted) throw error; }
  }
}
