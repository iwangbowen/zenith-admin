import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { config } from '../../config';
import { formatDateTime } from '../../lib/datetime';

const gunzipAsync = promisify(zlib.gunzip);

export const LOG_DIR = path.resolve(config.log.dir);

/**
 * 安全校验文件名：防止路径穿越。
 * 返回 null 表示非法文件名。
 */
export function safeFilename(filename: string): string | null {
  if (!filename || filename.includes('/') || filename.includes('\\') || filename.includes('..') || filename.startsWith('.')) {
    return null;
  }
  return filename;
}

/** 解析文件完整路径并验证在 LOG_DIR 内（双重保护） */
export function resolveLogPath(filename: string): string | null {
  const resolved = path.resolve(LOG_DIR, filename);
  if (!resolved.startsWith(LOG_DIR + path.sep) && resolved !== LOG_DIR) {
    return null;
  }
  return resolved;
}

/** 读取普通文本文件最后 N 行 */
function normalizeLogLines(content: string): string[] {
  return content.split(/\r?\n/).filter(l => l.trim() !== '');
}

function filterLogLines(lines: string[], keyword?: string): string[] {
  const normalizedKeyword = keyword?.trim().toLowerCase();
  if (!normalizedKeyword) return lines;
  return lines.filter((line) => line.toLowerCase().includes(normalizedKeyword));
}

export async function readLastLines(filepath: string, n: number, keyword?: string): Promise<string[]> {
  const content = await fsp.readFile(filepath, 'utf-8');
  const lines = normalizeLogLines(content);
  return filterLogLines(lines, keyword).slice(-n);
}

/** 读取 gzip 文件最后 N 行 */
export async function readGzipLastLines(filepath: string, n: number, keyword?: string): Promise<string[]> {
  const compressed = await fsp.readFile(filepath);
  const content = (await gunzipAsync(compressed)).toString('utf-8');
  const lines = normalizeLogLines(content);
  return filterLogLines(lines, keyword).slice(-n);
}

/** 可中止的延时（abort 时提前 resolve） */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(); return; }
    const onAbort = () => { clearTimeout(timer); resolve(); };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** 轮询文件新增内容并回调，直到 signal 中止（全程异步 I/O，await 回调形成背压） */
export async function watchTail(
  filepath: string,
  signal: AbortSignal,
  initialPosition: number,
  onLines: (lines: string[], newPosition: number) => Promise<void>,
): Promise<void> {
  let position = initialPosition;
  while (!signal.aborted) {
    await sleep(1000, signal);
    if (signal.aborted) return;

    let stat: Awaited<ReturnType<typeof fsp.stat>>;
    try {
      stat = await fsp.stat(filepath);
    } catch {
      return; // 文件被删除/轮转
    }
    if (stat.size <= position) continue;

    const newBytes = stat.size - position;
    const buf = Buffer.alloc(newBytes);
    const fh = await fsp.open(filepath, 'r');
    try {
      await fh.read(buf, 0, newBytes, position);
    } finally {
      await fh.close();
    }
    position = stat.size;
    const newLines = buf.toString('utf-8').split(/\r?\n/).filter(l => l.trim() !== '');
    if (newLines.length > 0) {
      await onLines(newLines, position);
    }
  }
}

// ─── 业务逻辑 ─────────────────────────────────────────────────────────────────
import { HTTPException } from 'hono/http-exception';

export async function listLogFiles() {
  let entries;
  try {
    entries = await fsp.readdir(LOG_DIR, { withFileTypes: true });
  } catch {
    return []; // 日志目录尚未创建
  }
  const logEntries = entries.filter(e => e.isFile() && (e.name.endsWith('.log') || e.name.endsWith('.log.gz')));
  const files = await Promise.all(logEntries.map(async (e) => {
    const stat = await fsp.stat(path.join(LOG_DIR, e.name));
    return {
      name: e.name,
      size: stat.size,
      modifiedAt: formatDateTime(stat.mtime),
      isGzip: e.name.endsWith('.gz'),
    };
  }));
  return files.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

export async function readLogFileLines(filename: string, lines: number, keyword?: string) {
  const { name, filepath } = await resolveLogFile(filename);
  const isGzip = name.endsWith('.gz');
  return isGzip ? readGzipLastLines(filepath, lines, keyword) : readLastLines(filepath, lines, keyword);
}

export async function deleteLogFile(filename: string) {
  const { filepath } = await resolveLogFile(filename);
  await fsp.unlink(filepath);
}

export async function getLogFileBeforeAudit(filename: string) {
  const { name, filepath } = await resolveLogFile(filename);
  const stat = await fsp.stat(filepath);
  return {
    name,
    size: stat.size,
    modifiedAt: formatDateTime(stat.mtime),
    isGzip: name.endsWith('.gz'),
  };
}

export async function resolveLogFile(filename: string) {
  const name = safeFilename(filename);
  if (!name) throw new HTTPException(400, { message: '无效的文件名' });
  const filepath = resolveLogPath(name);
  if (!filepath) throw new HTTPException(404, { message: '文件不存在' });
  try {
    await fsp.access(filepath);
  } catch {
    throw new HTTPException(404, { message: '文件不存在' });
  }
  return { name, filepath };
}
