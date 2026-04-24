import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { config } from '../config';

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
export function readLastLines(filepath: string, n: number): string[] {
  const content = fs.readFileSync(filepath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim() !== '');
  return lines.slice(-n);
}

/** 读取 gzip 文件最后 N 行 */
export function readGzipLastLines(filepath: string, n: number): string[] {
  const compressed = fs.readFileSync(filepath);
  const content = zlib.gunzipSync(compressed).toString('utf-8');
  const lines = content.split('\n').filter(l => l.trim() !== '');
  return lines.slice(-n);
}

/** 轮询文件新增内容并回调，直到 signal 中止 */
export async function watchTail(
  filepath: string,
  signal: AbortSignal,
  initialPosition: number,
  onLines: (lines: string[], newPosition: number) => Promise<void>,
): Promise<void> {
  let position = initialPosition;
  return new Promise<void>((resolve) => {
    if (signal.aborted) { resolve(); return; }

    const interval = setInterval(() => {
      if (signal.aborted) { clearInterval(interval); resolve(); return; }
      if (!fs.existsSync(filepath)) { clearInterval(interval); resolve(); return; }
      const stat = fs.statSync(filepath);
      if (stat.size > position) {
        const fd = fs.openSync(filepath, 'r');
        const newBytes = stat.size - position;
        const buf = Buffer.alloc(newBytes);
        fs.readSync(fd, buf, 0, newBytes, position);
        fs.closeSync(fd);
        position = stat.size;
        const newLines = buf.toString('utf-8').split('\n').filter(l => l.trim() !== '');
        if (newLines.length > 0) {
          void onLines(newLines, position);
        }
      }
    }, 1000);

    signal.addEventListener('abort', () => { clearInterval(interval); resolve(); });
  });
}
