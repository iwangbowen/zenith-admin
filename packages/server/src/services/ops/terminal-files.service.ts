import { randomUUID } from 'node:crypto';
import { promises as fs, createReadStream, createWriteStream, existsSync, readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import * as os from 'node:os';
import path from 'node:path';
import { HTTPException } from 'hono/http-exception';
import { formatDateTime } from '../../lib/datetime';
import { MAX_EDIT_SIZE, assertNotStale, atomicWriteFile, fileEtag, isBinaryBuffer } from '../../lib/fs-text';
import { getSettings } from '../../lib/settings';

const execFileAsync = promisify(execFile);

/**
 * 上传大小上限校验。
 *
 * 分两道：路由层用 Content-Length 预检（在 Hono 的 parseBody 缓冲整个请求体之前
 * 拒掉，这才是真正防内存耗尽的一道）；服务层再用 `File.size` 做权威校验，
 * 兜住缺少 Content-Length 的场景。
 *
 * 注：端到端流式上传需要用流式 multipart 解析替换 parseBody；在那之前，
 * 该上限就是内存占用的封顶值。
 */
export async function getUploadLimitBytes(): Promise<number> {
  const mb = (await getSettings('terminal')).uploadMaxSizeMb;
  return mb > 0 ? mb * 1024 * 1024 : 0;
}

function uploadTooLarge(limit: number): HTTPException {
  return new HTTPException(413, {
    message: `文件超过上传大小上限（${Math.floor(limit / 1024 / 1024)} MB），可在系统配置中调整 terminal_upload_max_size_mb`,
  });
}

/** 路由层预检：读请求头，避免超大请求体被完整读入内存 */
export async function assertContentLengthWithinLimit(contentLength: string | null | undefined): Promise<void> {
  const limit = await getUploadLimitBytes();
  if (limit <= 0) return;
  const declared = Number(contentLength ?? 0);
  if (!Number.isFinite(declared) || declared <= 0) return; // 无 Content-Length：留给服务层按 File.size 兜底
  if (declared > limit) throw uploadTooLarge(limit);
}

/** 服务层权威校验：以实际文件大小为准 */
export async function assertUploadSizeWithinLimit(size: number): Promise<void> {
  const limit = await getUploadLimitBytes();
  if (limit > 0 && size > limit) throw uploadTooLarge(limit);
}

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

/**
 * 保存上传的文件到指定目录。
 *
 * 流式落盘：先前把整个 `File` 读成 Buffer，上传 1 GB 文件就要占 1 GB 常驻内存，
 * 并发几个即可打爆进程。先写同目录临时文件再 rename，避免上传中断留下半截文件。
 */
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
  await assertUploadSizeWithinLimit(file.size);

  const dest = path.join(resolved, path.basename(file.name));
  const tmp = `${dest}.uploading-${randomUUID().slice(0, 8)}`;
  try {
    await pipeline(Readable.fromWeb(file.stream() as never), createWriteStream(tmp));
    await fs.rename(tmp, dest);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }

  return buildEntry(dest);
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
async function detectWslDistros(): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('wsl.exe', ['-l', '-q'], { timeout: 3000, encoding: 'buffer' });
    // wsl.exe -l -q 输出 UTF-16 LE（有 BOM），需转换为 UTF-8
    const text = stdout.toString('utf16le').replaceAll(/[\ufffd\0]/g, '').replaceAll('\r', '');
    return text.split('\n').map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

// 进程生命周期缓存：shell 清单只随软件安装变化。缓存 Promise 而非结果，
// 让并发的首批调用共享同一次探测；探测意外失败时清缓存，避免错误被永久钉死。
let shellListingPromise: Promise<TerminalShellListing> | null = null;

/**
 * 探测当前运行平台可用的 shell 列表与默认 shell（结果按进程生命周期缓存）。
 * - Windows：PowerShell / CMD / Git Bash（探测安装路径）+ WSL 发行版
 * - POSIX（Linux/macOS/WSL）：读取 /etc/shells 并探测 bash/zsh/fish/sh 常见路径，$SHELL 优先作为默认
 */
export function listShells(): Promise<TerminalShellListing> {
  shellListingPromise ??= detectShellListing().catch((err: unknown) => {
    shellListingPromise = null;
    throw err;
  });
  return shellListingPromise;
}

async function detectShellListing(): Promise<TerminalShellListing> {
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
    const wslDistros = await detectWslDistros();
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

export interface TerminalFileContent {
  path: string;
  content: string;
  size: number;
  /** 版本标识，保存时回传以检测并发编辑冲突 */
  etag: string;
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
  return { path: resolved, content: buffer.toString('utf-8'), size: stat.size, etag: fileEtag(stat) };
}

/**
 * 写入文本文件内容（父目录须存在，不能覆盖目录）。
 *
 * 带 baseEtag 时先校验文件未被他人修改，再原子替换；不带则视为强制覆盖。
 */
export async function writeTextFile(
  filePath: string,
  content: string,
  baseEtag?: string | null,
): Promise<TerminalFileEntry> {
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
    assertNotStale(fileEtag(stat), baseEtag);
  } catch (err) {
    if (err instanceof HTTPException) throw err;
    // 文件不存在 → 视为新建
  }
  await atomicWriteFile(resolved, content);
  return buildEntry(resolved);
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

/** 长耗时归档操作的进度回调；返回 true 表示调用方请求取消 */
export type ArchiveProgress = (processed: number, total: number) => Promise<boolean>;

export interface ArchiveOptions {
  onProgress?: ArchiveProgress;
  /** 周期性检查是否被取消（解压走外部命令，无法按条目回调） */
  isCancelled?: () => Promise<boolean>;
}

/** 取消归档操作时抛出，由任务处理器识别为「已取消」而非失败 */
export class ArchiveCancelledError extends Error {
  constructor() {
    super('操作已取消');
    this.name = 'ArchiveCancelledError';
  }
}

/**
 * 将多个文件/目录压缩为 ZIP。
 *
 * 目录用 `archive.directory()` 递归加入——此前一律走 `archive.file()`，
 * 而该 API 只接受单个文件，选中目录压缩会得到一个缺内容的包。
 *
 * @param paths 要压缩的绝对路径列表
 * @param destPath 输出 ZIP 文件的绝对路径（含 .zip 扩展名）
 */
export async function compressToZip(
  paths: string[],
  destPath: string,
  options: ArchiveOptions = {},
): Promise<TerminalFileEntry> {
  const { ZipArchive } = await import('archiver');

  const dst = path.resolve(destPath);
  await fs.mkdir(path.dirname(dst), { recursive: true });

  // 先探明每个入口是文件还是目录：Promise 执行器内无法 await
  const sources = await Promise.all(paths.map(async (p) => {
    const resolved = path.resolve(p);
    const st = await fs.stat(resolved).catch(() => null);
    if (!st) throw new HTTPException(404, { message: `路径不存在: ${resolved}` });
    return { resolved, name: path.basename(resolved), isDir: st.isDirectory() };
  }));

  let cancelled = false;
  try {
    await new Promise<void>((resolve, reject) => {
      const outStream = createWriteStream(dst);
      const archive = new ZipArchive({ zlib: { level: 6 } });
      outStream.on('close', resolve);
      outStream.on('error', reject);
      archive.on('error', reject);
      if (options.onProgress) {
        archive.on('progress', (p: { entries: { total: number; processed: number } }) => {
          void options.onProgress?.(p.entries.processed, p.entries.total)
            .then((cancelRequested) => {
              if (!cancelRequested || cancelled) return;
              cancelled = true;
              // 销毁输出流即可中断归档，不依赖 archiver 版本是否提供 abort()
              outStream.destroy(new ArchiveCancelledError());
            })
            .catch(() => undefined);
        });
      }
      archive.pipe(outStream);
      for (const s of sources) {
        if (s.isDir) archive.directory(s.resolved, s.name);
        else archive.file(s.resolved, { name: s.name });
      }
      void archive.finalize().catch(reject);
    });
  } catch (err) {
    // 失败或取消都不留下半截压缩包
    await fs.rm(dst, { force: true }).catch(() => undefined);
    if (cancelled) throw new ArchiveCancelledError();
    throw err;
  }
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
 * 执行解压命令，支持协作式取消。
 *
 * 用 execFile 拿到子进程句柄后周期性询问是否已请求取消，取消时 kill 子进程；
 * `execFileAsync` 一旦发出就无法中止，用户点了取消也只能干等。
 */
async function runArchiveCommand(file: string, args: string[], isCancelled?: () => Promise<boolean>): Promise<void> {
  const child = execFile(file, args, EXEC_OPTS);
  let cancelled = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  if (isCancelled) {
    timer = setInterval(() => {
      void isCancelled()
        .then((requested) => {
          if (!requested || cancelled) return;
          cancelled = true;
          child.kill('SIGTERM');
        })
        .catch(() => undefined);
    }, 2000);
    timer.unref();
  }
  try {
    await new Promise<void>((resolve, reject) => {
      child.on('error', reject);
      child.on('close', (code) => {
        if (cancelled) { reject(new ArchiveCancelledError()); return; }
        if (code === 0) { resolve(); return; }
        reject(new Error(`命令退出码 ${code}`));
      });
    });
  } finally {
    if (timer) clearInterval(timer);
  }
}

/**
 * 解压压缩包。支持 zip / tar / tar.gz / tgz / tar.bz2 / tar.xz / 单文件 gz。
 * 优先使用系统 tar（Windows bsdtar 同时支持 zip），Unix 下 zip 回退到 unzip。
 * @param archivePath 压缩包路径
 * @param destDir 解压目标目录（默认压缩包所在目录）
 */
export async function extractArchive(
  archivePath: string,
  destDir?: string,
  options: ArchiveOptions = {},
): Promise<TerminalFileEntry> {
  const src = path.resolve(archivePath);
  const stat = await fs.stat(src).catch(() => null);
  if (!stat || !stat.isFile()) throw new HTTPException(404, { message: '压缩文件不存在' });
  const lower = src.toLowerCase();
  const dst = destDir?.trim() ? path.resolve(destDir) : path.dirname(src);
  await fs.mkdir(dst, { recursive: true });
  const isWin = os.platform() === 'win32';
  const { isCancelled } = options;

  try {
    if (lower.endsWith('.zip')) {
      if (isWin) {
        await runArchiveCommand('tar', ['-xf', src, '-C', dst], isCancelled);
      } else {
        try {
          await runArchiveCommand('unzip', ['-o', src, '-d', dst], isCancelled);
        } catch (err) {
          if (err instanceof ArchiveCancelledError) throw err;
          await runArchiveCommand('tar', ['-xf', src, '-C', dst], isCancelled);
        }
      }
    } else if (lower.endsWith('.gz') && !lower.endsWith('.tar.gz') && !lower.endsWith('.tgz')) {
      const zlib = await import('node:zlib');
      const outName = path.basename(src).replace(/\.gz$/i, '') || 'extracted';
      // 流式解压：gunzipSync 会在解压期间完全占住事件循环，
      // 一个几百 MB 的 .gz 足以让整个服务在数秒内不响应任何请求。
      await pipeline(
        createReadStream(src),
        zlib.createGunzip(),
        createWriteStream(path.join(dst, outName)),
      );
    } else {
      // tar / tar.gz / tgz / tar.bz2 / tar.xz：tar 自动识别压缩格式
      await runArchiveCommand('tar', ['-xf', src, '-C', dst], isCancelled);
    }
  } catch (err) {
    if (err instanceof ArchiveCancelledError) throw err;
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

/** 遍历类操作的时间预算：超时即返回已有结果并标记截断，避免请求无限期挂起 */
const WALK_TIME_BUDGET_MS = 10_000;

export interface FileSearchResult {
  entries: TerminalFileEntry[];
  /** 因结果数 / 节点数 / 时间预算触顶而提前结束——调用方必须据此提示用户结果不完整 */
  truncated: boolean;
}

/**
 * 递归搜索文件名（广度优先）。
 *
 * 三个上限（结果数 / 访问节点数 / 时间预算）任一触顶即停止，并通过 `truncated`
 * 明确告知调用方。此前只是静默停在 200 条，用户无从判断「没有更多」还是「没搜完」。
 */
export async function searchFiles(dir: string, keyword: string, maxResults = 200): Promise<FileSearchResult> {
  const root = path.resolve(dir);
  const kw = keyword.trim().toLowerCase();
  if (!kw) return { entries: [], truncated: false };
  const results: TerminalFileEntry[] = [];
  const queue: string[] = [root];
  const deadline = Date.now() + WALK_TIME_BUDGET_MS;
  let visited = 0;
  let truncated = false;
  const MAX_VISITED = 60_000;
  while (queue.length > 0) {
    if (results.length >= maxResults || visited >= MAX_VISITED || Date.now() > deadline) {
      truncated = true;
      break;
    }
    const cur = queue.shift() as string;
    let dirents;
    try { dirents = await fs.readdir(cur, { withFileTypes: true }); } catch { continue; }
    for (const d of dirents) {
      visited += 1;
      const full = path.join(cur, d.name);
      if (d.name.toLowerCase().includes(kw)) {
        try { results.push(await buildEntry(full)); } catch { /* skip */ }
        if (results.length >= maxResults) { truncated = true; break; }
      }
      if (d.isDirectory()) queue.push(full);
    }
  }
  return { entries: results, truncated };
}

/** 递归统计目录大小（节点数与时间双上限，`truncated` 表示结果不完整） */
export async function computeDirSize(dir: string): Promise<{ size: number; files: number; dirs: number; truncated: boolean }> {
  const root = path.resolve(dir);
  const stat = await fs.stat(root).catch(() => null);
  if (!stat) throw new HTTPException(404, { message: '目录不存在' });
  if (!stat.isDirectory()) return { size: stat.size, files: 1, dirs: 0, truncated: false };
  const deadline = Date.now() + WALK_TIME_BUDGET_MS;
  let size = 0;
  let files = 0;
  let dirs = 0;
  let visited = 0;
  const MAX_VISITED = 200_000;
  const queue: string[] = [root];
  let timedOut = false;
  while (queue.length > 0 && visited < MAX_VISITED) {
    if (Date.now() > deadline) { timedOut = true; break; }
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
  return { size, files, dirs, truncated: timedOut || visited >= MAX_VISITED };
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
