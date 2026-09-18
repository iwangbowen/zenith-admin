/**
 * 日志查看器：运维通用工具，可读取本机 / 远端主机的任意绝对路径日志文件。
 *
 * 与终端、SFTP 文件管理器一致，不做目录白名单限制——门禁在权限层：
 * `system:log:view`（远端还需主机访问权 `assertRemoteHostAccess`）。
 * 仅保留形态校验：必须为绝对路径、必须存在、必须为常规文件（拒绝目录、设备与 FIFO）。
 *
 * 读取内核与「日志文件」模块共用（`log-reader.ts`）：本机走 readline 环形缓冲 + 文件增长轮询，
 * 远端走 SSH `tail` / `grep` 管道与 `tail -f` 流式通道，两端输出同样的行数组 / SSE 逐行事件。
 */
import * as fs from 'node:fs';
import * as nodePath from 'node:path';
import { HTTPException } from 'hono/http-exception';
import { getRemoteExecutor, resolveExecutor, type StreamHandle } from '../../lib/host-exec';
import {
  collectTailLines, createLineSplitter, readTailLinesStream, splitLogLines, watchTail, type TailReadOptions,
} from './log-reader';

/**
 * 校验并规范化日志路径。通过则返回应实际读取的路径（本机为 realpath，远端为 POSIX 规范化结果），
 * 否则抛 HTTPException：400 空路径 / 非绝对路径 / 非常规文件，404 文件不存在。
 */
export async function resolveLogPath(filePath: string, hostId?: number | null): Promise<string> {
  const input = filePath.trim();
  if (!input) throw new HTTPException(400, { message: '参数 path 不能为空' });

  if (hostId != null) {
    if (!input.startsWith('/')) throw new HTTPException(400, { message: '路径必须为绝对路径' });
    return nodePath.posix.normalize(input);
  }

  if (!nodePath.isAbsolute(input)) throw new HTTPException(400, { message: '路径必须为绝对路径' });
  let real: string;
  try {
    real = await fs.promises.realpath(input);
  } catch {
    throw new HTTPException(404, { message: '日志文件不存在' });
  }
  const stat = await fs.promises.stat(real);
  if (!stat.isFile()) throw new HTTPException(400, { message: '目标不是常规文件' });
  return real;
}

/** 压缩归档只能静态读取，不支持实时追踪 */
export function assertTailable(filePath: string): void {
  if (filePath.endsWith('.gz')) throw new HTTPException(400, { message: '压缩文件不支持实时追踪' });
}

/** grep -C 在不相邻的命中组之间插入的分隔行 */
const GREP_GROUP_SEPARATOR = '--';

/**
 * 远端读取末尾 N 行：源（gzip 归档用 gzip -dc 解压）→ 可选 grep 全文过滤 → tail 截断，
 * 全部在远端完成，只把结果行传回；参数经 sh 位置参数传递，不拼接进命令串。
 */
async function readRemoteTailLines(hostId: number, target: string, n: number, opts: TailReadOptions): Promise<string[]> {
  const executor = await resolveExecutor(hostId);
  const keyword = opts.keyword?.trim();
  const isGzip = target.endsWith('.gz');
  const execOptions = { timeoutMs: 30000, maxBuffer: 20 * 1024 * 1024 };

  if (!keyword && !isGzip) {
    const { stdout } = await executor.exec('tail', ['-n', String(n), '--', target], execOptions);
    return collectTailLines(splitLogLines(stdout), n);
  }

  const source = isGzip ? 'gzip -dc -- "$1"' : 'cat -- "$1"';
  const filter = keyword ? ' | grep -i -F -C "$3" -e "$2"' : '';
  const script = `${source}${filter} | tail -n "$4"`;
  const context = keyword ? Math.max(0, Math.min(opts.context ?? 0, 10)) : 0;
  const { stdout } = await executor.exec('sh', ['-c', script, 'sh', target, keyword ?? '', String(context), String(n)], execOptions);
  const lines = splitLogLines(stdout).filter((line) => !(context > 0 && line === GREP_GROUP_SEPARATOR));
  return collectTailLines(lines, n);
}

/** 读取文件末尾 N 行（可选关键词 / 上下文过滤）；本机与远端返回同样的行数组 */
export async function readLastLines(
  filePath: string,
  lines: number,
  hostId?: number | null,
  opts: TailReadOptions = {},
): Promise<string[]> {
  const target = await resolveLogPath(filePath, hostId);
  if (hostId != null) return readRemoteTailLines(hostId, target, lines, opts);
  return readTailLinesStream(target, lines, opts);
}

/** 远端 `tail -f`：分块输出经行切分器拆成整行，写入串行化保证顺序；进程退出或客户端断开时结束 */
async function followRemoteLines(
  hostId: number,
  target: string,
  signal: AbortSignal,
  emit: (lines: string[]) => Promise<void>,
): Promise<void> {
  const executor = await resolveExecutor(hostId);
  await new Promise<void>((resolve) => {
    let handle: StreamHandle | null = null;
    let writes = Promise.resolve();
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', finish);
      handle?.kill();
      void writes.finally(resolve);
    };
    const splitter = createLineSplitter((lines) => {
      writes = writes.then(() => emit(lines)).catch(finish);
    });
    signal.addEventListener('abort', finish, { once: true });
    executor.execStream('tail', ['-f', '-n', '0', '--', target], {
      onData: (chunk) => { if (!settled) splitter.push(chunk); },
      onExit: () => { splitter.flush(); finish(); },
    }).then((h) => {
      handle = h;
      if (settled) h.kill();
    }).catch(finish);
  });
}

/**
 * 实时追踪：持续推送新增行直到 signal 中止。本机按文件增长轮询（无需 tail 二进制，Windows 可用），
  * 远端走 SSH `tail -f`。返回前已完成路径形态校验，调用方应先用 `resolveLogPath` 把错误以 JSON 返回。
 */
export async function followLogLines(
  filePath: string,
  hostId: number | null | undefined,
  signal: AbortSignal,
  emit: (lines: string[]) => Promise<void>,
): Promise<void> {
  const target = await resolveLogPath(filePath, hostId);
  if (hostId != null) {
    await followRemoteLines(hostId, target, signal, emit);
    return;
  }
  const position = (await fs.promises.stat(target)).size;
  await watchTail(target, signal, position, (lines) => emit(lines));
}

/** 为下载读取日志文件（容量上限保护），返回文件名与可读流 */
export async function openLogForDownload(
  filePath: string,
  maxBytes = 100 * 1024 * 1024,
  hostId?: number | null,
): Promise<{ filename: string; size: number; stream: NodeJS.ReadableStream & { destroy(): void } }> {
  const target = await resolveLogPath(filePath, hostId);
  if (hostId != null) {
    const lease = await (await getRemoteExecutor(hostId)).acquireSftp();
    const sftp = lease.sftp;
    let stat: { size: number; isFile(): boolean };
    try {
      stat = await new Promise<{ size: number; isFile(): boolean }>((resolve, reject) => {
        sftp.stat(target, (err, attrs) => err ? reject(err) : resolve(attrs));
      });
    } catch (err) {
      lease.release();
      throw err;
    }
    if (!stat.isFile()) {
      lease.release();
      throw new Error('目标不是文件');
    }
    if (stat.size > maxBytes) {
      lease.release();
      throw new Error(`文件过大（${(stat.size / 1024 / 1024).toFixed(1)}MB），超出下载上限 ${maxBytes / 1024 / 1024}MB`);
    }
    const stream = sftp.createReadStream(target) as NodeJS.ReadableStream & { destroy(): void };
    stream.once('close', lease.release);
    stream.once('error', lease.release);
    stream.once('end', lease.release);
    return {
      filename: nodePath.posix.basename(target),
      size: stat.size,
      stream,
    };
  }
  const stat = await fs.promises.stat(target);
  if (stat.size > maxBytes) throw new Error(`文件过大（${(stat.size / 1024 / 1024).toFixed(1)}MB），超出下载上限 ${maxBytes / 1024 / 1024}MB`);
  return { filename: nodePath.basename(target), size: stat.size, stream: fs.createReadStream(target) };
}
