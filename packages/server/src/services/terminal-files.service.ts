import { promises as fs, createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import * as os from 'node:os';
import path from 'node:path';
import { HTTPException } from 'hono/http-exception';
import { formatDateTime } from '../lib/datetime';

export interface TerminalFileEntry {
  name: string;
  path: string;
  type: 'dir' | 'file';
  size: number;
  mtime: string;
}

/**
 * 列出指定目录内容。未指定 path 时默认用户主目录。
 * Web 终端本身即可执行任意命令访问文件系统，故权限边界为 `system:terminal:execute`。
 */
export async function listDirectory(
  dirPath?: string,
): Promise<{ path: string; parent: string | null; entries: TerminalFileEntry[] }> {
  const target = dirPath?.trim() ? dirPath : os.homedir();
  const resolved = path.resolve(target);

  let stat;
  try {
    stat = await fs.stat(resolved);
  } catch {
    throw new HTTPException(404, { message: '路径不存在' });
  }
  if (!stat.isDirectory()) {
    throw new HTTPException(400, { message: '目标不是目录' });
  }

  const names = await fs.readdir(resolved);
  const entries: TerminalFileEntry[] = [];
  for (const name of names) {
    const full = path.join(resolved, name);
    try {
      const s = await fs.stat(full);
      entries.push({
        name,
        path: full,
        type: s.isDirectory() ? 'dir' : 'file',
        size: s.size,
        mtime: formatDateTime(s.mtime),
      });
    } catch {
      // 跳过无权限或损坏的条目
    }
  }
  // 目录在前，同类型按名称排序
  entries.sort((a, b) => {
    if (a.type === b.type) return a.name.localeCompare(b.name);
    return a.type === 'dir' ? -1 : 1;
  });

  const parent = path.dirname(resolved);
  return { path: resolved, parent: parent === resolved ? null : parent, entries };
}

/** 打开文件下载流（校验存在且非目录）。 */
export async function openDownloadStream(
  filePath: string,
): Promise<{ stream: Readable; fileName: string }> {
  const resolved = path.resolve(filePath);
  let stat;
  try {
    stat = await fs.stat(resolved);
  } catch {
    throw new HTTPException(404, { message: '文件不存在' });
  }
  if (stat.isDirectory()) {
    throw new HTTPException(400, { message: '不能下载目录' });
  }
  return { stream: createReadStream(resolved), fileName: path.basename(resolved) };
}

/** 保存上传的文件到指定目录。 */
export async function saveUploadedFile(dirPath: string, file: File): Promise<TerminalFileEntry> {
  const resolved = path.resolve(dirPath?.trim() ? dirPath : os.homedir());
  let stat;
  try {
    stat = await fs.stat(resolved);
  } catch {
    throw new HTTPException(404, { message: '目标目录不存在' });
  }
  if (!stat.isDirectory()) {
    throw new HTTPException(400, { message: '目标不是目录' });
  }

  const dest = path.join(resolved, file.name);
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(dest, buffer);

  const s = await fs.stat(dest);
  return { name: file.name, path: dest, type: 'file', size: s.size, mtime: formatDateTime(s.mtime) };
}
