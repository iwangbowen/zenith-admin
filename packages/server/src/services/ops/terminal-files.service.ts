import { promises as fs, createReadStream, createWriteStream, existsSync, readFileSync } from 'node:fs';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Readable } from 'node:stream';
import * as os from 'node:os';
import path from 'node:path';
import { HTTPException } from 'hono/http-exception';
import { formatDateTime } from '../../lib/datetime';

const execFileAsync = promisify(execFile);

/** 将 fs.stat().mode 转为 rwxr-xr-x 格式的权限字符串 */
function modeToPermissionString(mode: number): string {
  const chars = '---';
  const bits = ['r', 'w', 'x'];
  let result = '';
  for (let i = 2; i >= 0; i--) {
    for (let j = 2; j >= 0; j--) {
      result += (mode >> (i * 3 + j)) & 1 ? bits[2 - j] : chars[2 - j];
    }
  }
  return result;
}

export interface TerminalFileEntry {
  name: string;
  path: string;
  type: 'dir' | 'file';
  size: number;
  mtime: string;
  permissions?: string;
  uid?: number;
  gid?: number;
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
        permissions: modeToPermissionString(s.mode),
        uid: s.uid,
        gid: s.gid,
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

// ---------- Shell 检测 ----------

export interface TerminalShellInfo {
  id: string;
  label: string;
  path: string;
  /** 传给 shell 可执行文件的额外启动参数（如 WSL distro 的 -d <name>）*/
  args?: string[];
}

export interface TerminalShellListing {
  platform: string;
  shells: TerminalShellInfo[];
  defaultShell: string;
}

function existsSyncSafe(p: string): boolean {
  try {
    return existsSync(p);
  } catch {
    return false;
  }
}

/**
 * 通过 `wsl.exe -l -q` 获取已安装的 WSL 发行版列表。
 * wsl.exe 输出 UTF-16 LE，需要手动解码。
 */
function detectWslDistros(): string[] {
  try {
    const buf = execFileSync('wsl.exe', ['-l', '-q'], { timeout: 3000 });
    // wsl.exe -l -q 输出 UTF-16 LE（有 BOM），需转换为 UTF-8
    const text = buf.toString('utf16le').replaceAll(/[\ufffd\0]/g, '').replaceAll('\r', '');
    return text.split('\n').map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * 探测当前运行平台可用的 shell 列表与默认 shell。
 * - Windows：PowerShell / CMD / Git Bash（探测安装路径）
 * - POSIX（Linux/macOS/WSL）：读取 /etc/shells 并探测 bash/zsh/fish/sh 常见路径，$SHELL 优先作为默认
 */
export function listShells(): TerminalShellListing {
  const platform = os.platform();

  if (platform === 'win32') {
    const shells: TerminalShellInfo[] = [
      { id: 'powershell', label: 'PowerShell', path: 'powershell.exe' },
      { id: 'cmd', label: 'Command Prompt', path: process.env.COMSPEC ?? 'cmd.exe' },
    ];
    const gitBash = [
      process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Git', 'bin', 'bash.exe'),
      process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Git', 'bin', 'bash.exe'),
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe'),
    ]
      .filter((p): p is string => Boolean(p))
      .find((p) => existsSyncSafe(p));
    if (gitBash) shells.push({ id: 'bash', label: 'Git Bash', path: gitBash });
    // WSL 发行版
    const wslDistros = detectWslDistros();
    for (const distro of wslDistros) {
      // --cd ~ 确保 WSL 从 Linux 用户主目录启动，--exec bash -l 避免默认 shell 异常
      shells.push({ id: `wsl:${distro}`, label: `WSL: ${distro}`, path: 'wsl.exe', args: ['-d', distro, '--cd', '~', '--exec', 'bash', '-l'] });
    }
    return { platform, shells, defaultShell: 'powershell' };
  }

  const known: { id: string; label: string; candidates: string[] }[] = [
    { id: 'bash', label: 'Bash', candidates: ['/bin/bash', '/usr/bin/bash', '/usr/local/bin/bash'] },
    { id: 'zsh', label: 'Zsh', candidates: ['/bin/zsh', '/usr/bin/zsh', '/usr/local/bin/zsh', '/opt/homebrew/bin/zsh'] },
    { id: 'fish', label: 'Fish', candidates: ['/usr/bin/fish', '/usr/local/bin/fish', '/opt/homebrew/bin/fish'] },
    { id: 'sh', label: 'sh', candidates: ['/bin/sh', '/usr/bin/sh'] },
  ];

  let etcShells: string[] = [];
  try {
    etcShells = readFileSync('/etc/shells', 'utf-8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
  } catch {
    // /etc/shells 不存在时忽略
  }

  const shells: TerminalShellInfo[] = [];
  for (const k of known) {
    const found = k.candidates.find((p) => existsSyncSafe(p)) ?? etcShells.find((p) => p.endsWith(`/${k.id}`));
    if (found) shells.push({ id: k.id, label: k.label, path: found });
  }
  if (shells.length === 0) {
    shells.push({ id: 'sh', label: 'sh', path: '/bin/sh' });
  }

  let defaultShell = shells[0].id;
  const envShell = process.env.SHELL;
  if (envShell) {
    const match = shells.find((s) => s.path === envShell || envShell.endsWith(`/${s.id}`));
    if (match) defaultShell = match.id;
  } else if (shells.some((s) => s.id === 'bash')) {
    defaultShell = 'bash';
  }

  return { platform, shells, defaultShell };
}

// ---------- 文本文件读写 / 增删改 ----------

const MAX_EDIT_SIZE = 5 * 1024 * 1024; // 5MB

export interface TerminalFileContent {
  path: string;
  content: string;
  size: number;
}

function isBinaryBuffer(buf: Buffer): boolean {
  const len = Math.min(buf.length, 8000);
  for (let i = 0; i < len; i += 1) {
    if (buf[i] === 0) return true;
  }
  return false;
}

/** 读取文本文件内容（校验存在、非目录、大小、非二进制）。 */
export async function readTextFile(filePath: string): Promise<TerminalFileContent> {
  if (!filePath?.trim()) throw new HTTPException(400, { message: '缺少文件路径' });
  const resolved = path.resolve(filePath);
  let stat;
  try {
    stat = await fs.stat(resolved);
  } catch {
    throw new HTTPException(404, { message: '文件不存在' });
  }
  if (stat.isDirectory()) throw new HTTPException(400, { message: '不能读取目录内容' });
  if (stat.size > MAX_EDIT_SIZE) throw new HTTPException(400, { message: '文件过大，无法在线编辑（上限 5MB）' });
  const buffer = await fs.readFile(resolved);
  if (isBinaryBuffer(buffer)) throw new HTTPException(400, { message: '二进制文件无法在线编辑' });
  return { path: resolved, content: buffer.toString('utf-8'), size: stat.size };
}

/** 写入文本文件内容（父目录须存在，不能覆盖目录）。 */
export async function writeTextFile(filePath: string, content: string): Promise<TerminalFileEntry> {
  if (!filePath?.trim()) throw new HTTPException(400, { message: '缺少文件路径' });
  const resolved = path.resolve(filePath);
  const dir = path.dirname(resolved);
  try {
    const dstat = await fs.stat(dir);
    if (!dstat.isDirectory()) throw new HTTPException(400, { message: '父路径不是目录' });
  } catch (err) {
    if (err instanceof HTTPException) throw err;
    throw new HTTPException(404, { message: '父目录不存在' });
  }
  try {
    const stat = await fs.stat(resolved);
    if (stat.isDirectory()) throw new HTTPException(400, { message: '目标是目录，无法写入' });
  } catch (err) {
    if (err instanceof HTTPException) throw err;
    // 文件不存在 → 视为新建
  }
  await fs.writeFile(resolved, content, 'utf-8');
  const s = await fs.stat(resolved);
  return { name: path.basename(resolved), path: resolved, type: 'file', size: s.size, mtime: formatDateTime(s.mtime) };
}

/** 新建文件或目录（同名已存在则拒绝）。 */
export async function createEntry(targetPath: string, type: 'file' | 'dir'): Promise<TerminalFileEntry> {
  if (!targetPath?.trim()) throw new HTTPException(400, { message: '缺少路径' });
  const resolved = path.resolve(targetPath);
  if (existsSyncSafe(resolved)) throw new HTTPException(400, { message: '同名文件或目录已存在' });
  if (type === 'dir') {
    await fs.mkdir(resolved, { recursive: true });
  } else {
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, '', { flag: 'wx' });
  }
  const s = await fs.stat(resolved);
  return { name: path.basename(resolved), path: resolved, type, size: s.size, mtime: formatDateTime(s.mtime) };
}

/** 删除文件或目录（目录递归删除）。禁止删除根目录与用户主目录本身。 */
export async function deleteEntry(targetPath: string): Promise<void> {
  if (!targetPath?.trim()) throw new HTTPException(400, { message: '缺少路径' });
  const resolved = path.resolve(targetPath);
  if (resolved === path.parse(resolved).root || resolved === os.homedir()) {
    throw new HTTPException(400, { message: '禁止删除该路径' });
  }
  try {
    await fs.stat(resolved);
  } catch {
    throw new HTTPException(404, { message: '路径不存在' });
  }
  await fs.rm(resolved, { recursive: true, force: false });
}

/** 重命名 / 移动文件或目录（目标已存在则拒绝）。 */
export async function renameEntry(from: string, to: string): Promise<TerminalFileEntry> {
  if (!from?.trim() || !to?.trim()) throw new HTTPException(400, { message: '缺少路径参数' });
  const src = path.resolve(from);
  const dst = path.resolve(to);
  try {
    await fs.stat(src);
  } catch {
    throw new HTTPException(404, { message: '源路径不存在' });
  }
  if (existsSyncSafe(dst)) throw new HTTPException(400, { message: '目标已存在' });
  await fs.mkdir(path.dirname(dst), { recursive: true });
  await fs.rename(src, dst);
  const s = await fs.stat(dst);
  return {
    name: path.basename(dst),
    path: dst,
    type: s.isDirectory() ? 'dir' : 'file',
    size: s.size,
    mtime: formatDateTime(s.mtime),
  };
}

/**
 * 获取文件系统根目录信息（供文件浏览器初始化使用）。
 * - Unix：根目录为 `/`，无盘符
 * - Windows：根目录为各盘符（C:\、D:\ 等），通过检测是否存在筛选
 */
export async function getRootInfo(): Promise<{
  home: string;
  isWindows: boolean;
  drives: string[];
}> {
  const isWindows = os.platform() === 'win32';
  const home = os.homedir();
  const drives: string[] = [];

  if (isWindows) {
    for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      if (existsSync(`${letter}:\\`)) {
        drives.push(`${letter}:`);
      }
    }
  }

  return { home, isWindows, drives };
}

// ─── 文件管理器扩展操作 ──────────────────────────────────────────────────────────

/**
 * 移动/重命名文件或目录（支持跨目录移动）。
 * 如目标已存在则报 400；目标目录不存在会自动创建。
 */
export async function moveEntry(from: string, to: string): Promise<TerminalFileEntry> {
  if (!from?.trim() || !to?.trim()) throw new HTTPException(400, { message: '缺少路径参数' });
  const src = path.resolve(from);
  const dst = path.resolve(to);
  if (src === dst) return buildEntry(src);
  try { await fs.stat(src); } catch { throw new HTTPException(404, { message: '源路径不存在' }); }
  if (existsSyncSafe(dst)) throw new HTTPException(400, { message: '目标路径已存在' });
  await fs.mkdir(path.dirname(dst), { recursive: true });
  try {
    await fs.rename(src, dst);
  } catch (err) {
    // 跨盘符或跨文件系统时 rename 会抛 EXDEV，降级为 cp + rm
    if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
      await fs.cp(src, dst, { recursive: true });
      await fs.rm(src, { recursive: true, force: true });
    } else {
      throw err;
    }
  }
  return buildEntry(dst);
}

/**
 * 复制文件或目录（递归复制整个目录树）。
 */
export async function copyEntry(from: string, to: string): Promise<TerminalFileEntry> {
  if (!from?.trim() || !to?.trim()) throw new HTTPException(400, { message: '缺少路径参数' });
  const src = path.resolve(from);
  const dst = path.resolve(to);
  try { await fs.stat(src); } catch { throw new HTTPException(404, { message: '源路径不存在' }); }
  if (existsSyncSafe(dst)) throw new HTTPException(400, { message: '目标路径已存在' });
  await fs.cp(src, dst, { recursive: true });
  return buildEntry(dst);
}

/**
 * 将多个文件/目录压缩为 ZIP。
 * @param paths 要压缩的绝对路径列表
 * @param destPath 输出 ZIP 文件的绝对路径（含 .zip 扩展名）
 */
export async function compressToZip(paths: string[], destPath: string): Promise<TerminalFileEntry> {
  const { ZipArchive } = await import('archiver');

  const dst = path.resolve(destPath);
  await fs.mkdir(path.dirname(dst), { recursive: true });

  await new Promise<void>((resolve, reject) => {
    const outStream = createWriteStream(dst);
    const archive = new ZipArchive({ zlib: { level: 6 } });
    outStream.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(outStream);
    for (const p of paths) {
      const resolved = path.resolve(p);
      const name = path.basename(resolved);
      archive.file(resolved, { name });
    }
    void archive.finalize().catch(reject);
  });
  return buildEntry(dst);
}

/**
 * 修改文件/目录权限（chmod）。
 * @param filePath 目标路径
 * @param mode 八进制权限，如 0o755 或数字 493
 */
export async function chmodEntry(filePath: string, mode: number): Promise<void> {
  const resolved = path.resolve(filePath);
  try { await fs.stat(resolved); } catch { throw new HTTPException(404, { message: '路径不存在' }); }
  try {
    await fs.chmod(resolved, mode);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new HTTPException(400, { message: `chmod 失败: ${msg}` });
  }
}

const EXEC_OPTS = { timeout: 180_000, maxBuffer: 64 * 1024 * 1024 } as const;

/**
 * 解压压缩包。支持 zip / tar / tar.gz / tgz / tar.bz2 / tar.xz / 单文件 gz。
 * 优先使用系统 tar（Windows bsdtar 同时支持 zip），Unix 下 zip 回退到 unzip。
 * @param archivePath 压缩包路径
 * @param destDir 解压目标目录（默认压缩包所在目录）
 */
export async function extractArchive(archivePath: string, destDir?: string): Promise<TerminalFileEntry> {
  const src = path.resolve(archivePath);
  const stat = await fs.stat(src).catch(() => null);
  if (!stat || !stat.isFile()) throw new HTTPException(404, { message: '压缩文件不存在' });
  const lower = src.toLowerCase();
  const dst = destDir?.trim() ? path.resolve(destDir) : path.dirname(src);
  await fs.mkdir(dst, { recursive: true });
  const isWin = os.platform() === 'win32';

  try {
    if (lower.endsWith('.zip')) {
      if (isWin) {
        await execFileAsync('tar', ['-xf', src, '-C', dst], EXEC_OPTS);
      } else {
        try {
          await execFileAsync('unzip', ['-o', src, '-d', dst], EXEC_OPTS);
        } catch {
          await execFileAsync('tar', ['-xf', src, '-C', dst], EXEC_OPTS);
        }
      }
    } else if (lower.endsWith('.gz') && !lower.endsWith('.tar.gz') && !lower.endsWith('.tgz')) {
      const zlib = await import('node:zlib');
      const data = await fs.readFile(src);
      const out = zlib.gunzipSync(data);
      const outName = path.basename(src).replace(/\.gz$/i, '') || 'extracted';
      await fs.writeFile(path.join(dst, outName), out);
    } else {
      // tar / tar.gz / tgz / tar.bz2 / tar.xz：tar 自动识别压缩格式
      await execFileAsync('tar', ['-xf', src, '-C', dst], EXEC_OPTS);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new HTTPException(400, { message: `解压失败: ${msg.slice(0, 200)}` });
  }
  return buildEntry(dst);
}

/** 计算文件校验和（md5 / sha1 / sha256），流式读取避免大文件占用内存 */
export async function computeChecksum(filePath: string, algo: 'md5' | 'sha1' | 'sha256'): Promise<{ algo: string; hash: string; size: number }> {
  const src = path.resolve(filePath);
  const stat = await fs.stat(src).catch(() => null);
  if (!stat || !stat.isFile()) throw new HTTPException(404, { message: '文件不存在' });
  const crypto = await import('node:crypto');
  const hash = crypto.createHash(algo);
  await new Promise<void>((resolve, reject) => {
    const s = createReadStream(src);
    s.on('data', (chunk) => hash.update(chunk));
    s.on('end', () => resolve());
    s.on('error', reject);
  });
  return { algo, hash: hash.digest('hex'), size: stat.size };
}

/** 递归搜索文件名（广度优先，限制访问节点数与结果数防止过载） */
export async function searchFiles(dir: string, keyword: string, maxResults = 200): Promise<TerminalFileEntry[]> {
  const root = path.resolve(dir);
  const kw = keyword.trim().toLowerCase();
  if (!kw) return [];
  const results: TerminalFileEntry[] = [];
  const queue: string[] = [root];
  let visited = 0;
  const MAX_VISITED = 60_000;
  while (queue.length > 0 && results.length < maxResults && visited < MAX_VISITED) {
    const cur = queue.shift() as string;
    let dirents;
    try { dirents = await fs.readdir(cur, { withFileTypes: true }); } catch { continue; }
    for (const d of dirents) {
      visited += 1;
      const full = path.join(cur, d.name);
      if (d.name.toLowerCase().includes(kw)) {
        try { results.push(await buildEntry(full)); } catch { /* skip */ }
        if (results.length >= maxResults) break;
      }
      if (d.isDirectory()) queue.push(full);
    }
  }
  return results;
}

/** 递归统计目录大小（限制访问节点数防止超大目录拖垮） */
export async function computeDirSize(dir: string): Promise<{ size: number; files: number; dirs: number; truncated: boolean }> {
  const root = path.resolve(dir);
  const stat = await fs.stat(root).catch(() => null);
  if (!stat) throw new HTTPException(404, { message: '目录不存在' });
  if (!stat.isDirectory()) return { size: stat.size, files: 1, dirs: 0, truncated: false };
  let size = 0;
  let files = 0;
  let dirs = 0;
  let visited = 0;
  const MAX_VISITED = 200_000;
  const queue: string[] = [root];
  while (queue.length > 0 && visited < MAX_VISITED) {
    const cur = queue.shift() as string;
    let dirents;
    try { dirents = await fs.readdir(cur, { withFileTypes: true }); } catch { continue; }
    for (const d of dirents) {
      visited += 1;
      if (visited >= MAX_VISITED) break;
      const full = path.join(cur, d.name);
      if (d.isDirectory()) {
        dirs += 1;
        queue.push(full);
      } else {
        try {
          const s = await fs.stat(full);
          size += s.size;
          files += 1;
        } catch { /* skip */ }
      }
    }
  }
  return { size, files, dirs, truncated: visited >= MAX_VISITED };
}

/** 构建单个条目的 TerminalFileEntry（含权限信息） */
async function buildEntry(filePath: string): Promise<TerminalFileEntry> {
  const s = await fs.stat(filePath);
  return {
    name: path.basename(filePath),
    path: filePath,
    type: s.isDirectory() ? 'dir' : 'file',
    size: s.size,
    mtime: formatDateTime(s.mtime),
    permissions: modeToPermissionString(s.mode),
    uid: s.uid,
    gid: s.gid,
  };
}
