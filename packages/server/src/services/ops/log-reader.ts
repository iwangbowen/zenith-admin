/**
 * 日志读取内核：「日志文件」（应用日志目录）与「日志查看器」（白名单目录 / 远端主机）共用。
 *
 * - 末尾 N 行：逐行流经固定容量环形缓冲，峰值内存 O(N)，普通文本与 gzip 归档同一入口；
 *   关键词过滤在整个文件范围内匹配（大小写不敏感子串），命中行前后可保留上下文；
 * - 实时追踪：按文件增长轮询追加内容并逐批回调，不依赖 `tail` 二进制，Windows 同样可用；
 * - 行切分器：把分块到达的文本流（SSH `tail -f` 输出）拆成完整行，跨块的半行留待下一块。
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import readline from 'node:readline';
import zlib from 'node:zlib';

/** 固定容量环形缓冲：流式读取时只保留最后 N 行，避免整文件驻留内存 */
export class TailRingBuffer {
  private readonly buf: string[];
  private idx = 0;
  private filled = false;

  constructor(private readonly capacity: number) {
    this.buf = new Array<string>(capacity);
  }

  push(line: string): void {
    this.buf[this.idx] = line;
    this.idx = (this.idx + 1) % this.capacity;
    if (this.idx === 0) this.filled = true;
  }

  toArray(): string[] {
    return this.filled
      ? [...this.buf.slice(this.idx), ...this.buf.slice(0, this.idx)]
      : this.buf.slice(0, this.idx);
  }
}

export interface TailReadOptions {
  /** 大小写不敏感的子串过滤；空串 / 纯空格视为不过滤 */
  keyword?: string;
  /** keyword 命中行前后额外保留的上下文行数（0-10，仅 keyword 存在时生效） */
  context?: number;
}

/** 空行不计入行数（日志末尾常见的空行会挤占有效行） */
function isBlank(line: string): boolean {
  return line.trim() === '';
}

/**
 * 从任意行序列收集「末尾 N 行」（可选关键词 + 上下文过滤）。
 * 文件读取与远端命令输出都走这里，保证两端过滤语义一致。
 */
export async function collectTailLines(
  source: AsyncIterable<string> | Iterable<string>,
  n: number,
  opts: TailReadOptions = {},
): Promise<string[]> {
  const keyword = opts.keyword?.trim().toLowerCase();
  const context = keyword ? Math.max(0, Math.min(opts.context ?? 0, 10)) : 0;

  const ring = new TailRingBuffer(n);
  // 上下文窗口：before 保留匹配前的候选行，afterRemaining 统计匹配后还需保留的行数
  const before: string[] = [];
  let afterRemaining = 0;

  for await (const line of source) {
    if (isBlank(line)) continue;
    if (!keyword) {
      ring.push(line);
      continue;
    }
    if (line.toLowerCase().includes(keyword)) {
      for (const b of before) ring.push(b);
      before.length = 0;
      ring.push(line);
      afterRemaining = context;
    } else if (afterRemaining > 0) {
      ring.push(line);
      afterRemaining -= 1;
    } else if (context > 0) {
      before.push(line);
      if (before.length > context) before.shift();
    }
  }
  return ring.toArray();
}

/**
 * 流式读取本机文件最后 N 行（普通文本与 gzip 统一入口）。
 * 逐行经过环形缓冲，替代整文件 readFile / gunzip（大文件 OOM 风险）。
 */
export async function readTailLinesStream(filepath: string, n: number, opts: TailReadOptions = {}): Promise<string[]> {
  const source = fs.createReadStream(filepath);
  const input = filepath.endsWith('.gz') ? source.pipe(zlib.createGunzip()) : source;
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  try {
    return await collectTailLines(rl, n, opts);
  } finally {
    rl.close();
    source.destroy();
  }
}

/** 把一段文本拆成非空行 */
export function splitLogLines(text: string): string[] {
  return text.split(/\r?\n/).filter((line) => !isBlank(line));
}

/**
 * 行切分器：分块文本 → 完整行批次；块末尾的半行缓存到下一块，`flush()` 在流结束时吐出残余。
 */
export function createLineSplitter(onLines: (lines: string[]) => void): { push: (chunk: string) => void; flush: () => void } {
  let carry = '';
  return {
    push(chunk) {
      const text = carry + chunk;
      const parts = text.split(/\r?\n/);
      carry = parts.pop() ?? '';
      const lines = parts.filter((line) => !isBlank(line));
      if (lines.length > 0) onLines(lines);
    },
    flush() {
      const rest = carry;
      carry = '';
      if (!isBlank(rest)) onLines([rest]);
    },
  };
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

/** 实时追踪轮询周期 */
export const TAIL_POLL_INTERVAL_MS = 1000;

/** 实时追踪建立连接时先回放的末尾行数 */
export const TAIL_REPLAY_LINES = 100;

/**
 * 轮询本机文件的新增内容并回调，直到 signal 中止或文件消失（删除 / 轮转）。
 * 全程异步 I/O，await 回调形成背压。
 */
export async function watchTail(
  filepath: string,
  signal: AbortSignal,
  initialPosition: number,
  onLines: (lines: string[], newPosition: number) => Promise<void>,
): Promise<void> {
  let position = initialPosition;
  while (!signal.aborted) {
    await sleep(TAIL_POLL_INTERVAL_MS, signal);
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
    const newLines = splitLogLines(buf.toString('utf-8'));
    if (newLines.length > 0) {
      await onLines(newLines, position);
    }
  }
}
