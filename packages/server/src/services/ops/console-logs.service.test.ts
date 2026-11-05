import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const settings = vi.hoisted(() => ({ log: { dir: '' }, roles: { label: 'api' } }));
vi.mock('../../config', () => ({ config: settings }));
vi.mock('./log-reader', async (original) => ({ ...await original<typeof import('./log-reader')>(), TAIL_POLL_INTERVAL_MS: 10 }));

const { getConsoleLogSources, readConsoleLogLines, tailConsoleLogLines } = await import('./console-logs.service');
const fileA = 'app-api.2026-10-22.1.log';
const fileB = 'app-api.2026-10-23.1.log';
let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'zenith-consolelogs-'));
  settings.log.dir = path.join(tmpRoot, 'logs');
  settings.roles.label = 'api';
  await fsp.mkdir(settings.log.dir);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fsp.rm(tmpRoot, { recursive: true, force: true });
});

function write(name: string, value: string | Buffer): Promise<void> { return fsp.writeFile(path.join(settings.log.dir, name), value); }
function append(name: string, value: string | Buffer): Promise<void> { return fsp.appendFile(path.join(settings.log.dir, name), value); }
async function receivedCount(records: unknown[], count: number) {
  await vi.waitFor(() => expect(records).toHaveLength(count), { timeout: 2000, interval: 5 });
}

function follow(cursor?: string, role?: 'api' | 'all' | 'worker') {
  const controller = new AbortController();
  const records: Array<{ line: string; id: string }> = [];
  const done = tailConsoleLogLines({ role }, controller.signal, async (record) => { records.push(record); }, cursor);
  return { records, done, stop: async () => { controller.abort(); await done; } };
}

/** 观测真实文件 I/O；旧文件一旦被不必要地打开即失败。 */
function observeRecentReads() {
  const metrics = { bytesRead: 0, opened: [] as string[] };
  const open = fsp.open.bind(fsp);
  vi.spyOn(fsp, 'open').mockImplementation(async (...args) => {
    const filename = path.basename(String(args[0]));
    metrics.opened.push(filename);
    if (filename === fileA) throw new Error('读取近期窗口不应打开旧文件');
    const handle = await open(...args);
    return new Proxy(handle, {
      get(target, key) {
        const member = Reflect.get(target, key);
        if (key === 'read') return async (...readArgs: unknown[]) => {
          const result = await Reflect.apply(target.read, target, readArgs) as { bytesRead: number };
          metrics.bytesRead += result.bytesRead;
          return result;
        };
        return typeof member === 'function' ? member.bind(target) : member;
      },
    });
  });
  return metrics;
}

describe('应用日志来源和历史窗口', () => {
  it('当前角色始终可见，只发现严格 Pino 文件名，不读取其他日志与目录', async () => {
    await write('app-worker.2026-10-23.1.log', 'worker\n');
    await write('app.2026-10-23.1.log', 'all\n');
    await write('app-api.2026-10-23.0.log', 'not a roll file\n');
    await write('app-api.2026-10-23.1.log.gz', 'compressed\n');
    await write('app-api.2026-10-23.1.log.secret', 'secret\n');
    await write('secret.log', 'secret\n');
    await fsp.mkdir(path.join(settings.log.dir, fileA));
    expect(await getConsoleLogSources()).toMatchObject({ currentRole: 'api', pid: process.pid,
      sources: [{ role: 'all', available: true }, { role: 'api', available: false }, { role: 'worker', available: true }] });
    await expect(readConsoleLogLines({})).resolves.toEqual([]);
    await expect(readConsoleLogLines({ role: 'worker' })).resolves.toEqual(['worker']);
    await expect(readConsoleLogLines({ role: 'all' })).resolves.toEqual(['all']);
  });

  it('目录尚未创建返回空来源；目录不可读等错误继续上抛', async () => {
    await fsp.rmdir(settings.log.dir);
    await expect(readConsoleLogLines({})).resolves.toEqual([]);
    await expect(getConsoleLogSources()).resolves.toMatchObject({ sources: [{ role: 'api', available: false }] });
    await fsp.writeFile(settings.log.dir, 'this is a file');
    await expect(readConsoleLogLines({})).rejects.toMatchObject({ code: 'ENOTDIR' });
    await expect(getConsoleLogSources()).rejects.toMatchObject({ code: 'ENOTDIR' });
  });

  it('按日期与数字序号跨文件读取最后 N 行，并复用关键词上下文和 correlationId 定位', async () => {
    const original = JSON.stringify({ correlationId: 'request-one', msg: 'business error' });
    await write('app-api.2026-10-22.9.log', `old\n${original}\n`);
    await write('app-api.2026-10-22.10.log', 'after\n');
    await write(fileB, 'latest\npartial');
    await expect(readConsoleLogLines({ lines: 3 })).resolves.toEqual([original, 'after', 'latest']);
    await expect(readConsoleLogLines({ lines: 5, keyword: 'ERROR', context: 1 })).resolves.toEqual(['old', original, 'after']);
    await expect(readConsoleLogLines({ lines: 3, locateCorrelationId: 'request-one' })).resolves.toEqual(['old', original, 'after']);
    await expect(readConsoleLogLines({ lines: 5, correlationId: 'request-one' })).resolves.toEqual([original]);
  });

  it('文件打开失败向调用者报告，不能伪装成没有日志', async () => {
    await write(fileA, 'known\n');
    const failure = Object.assign(new Error('access denied'), { code: 'EACCES' });
    vi.spyOn(fsp, 'open').mockRejectedValueOnce(failure);
    await expect(readConsoleLogLines({})).rejects.toBe(failure);
  });

  it('无过滤的近期窗口仅反向读取最新文件末尾，空白关键词也不触发全文扫描', async () => {
    await write(fileA, 'old file\n');
    await write(fileB, `${'historical line\n'.repeat(150_000)}tail-one\n\n  \ntail-two\npartial`);
    const metrics = observeRecentReads();
    await expect(readConsoleLogLines({ lines: 2, keyword: '   ' })).resolves.toEqual(['tail-one', 'tail-two']);
    expect(metrics.opened).toEqual([fileB]);
    expect(metrics.bytesRead).toBeLessThan(70 * 1024);
  });
});

describe('应用日志实时追踪', () => {
  it('100 行初次回放只读取大文件的必要末尾块，不打开无关旧文件', async () => {
    await write(fileA, 'unrelated old file\n');
    const recent = Array.from({ length: 100 }, (_, index) => `recent-${index}`);
    await write(fileB, `${'historical line\n'.repeat(150_000)}${recent.join('\n')}\npartial`);
    const metrics = observeRecentReads();
    const watcher = follow();
    try {
      await receivedCount(watcher.records, 100);
      expect(watcher.records.map((record) => record.line)).toEqual(recent);
      expect(metrics.opened).not.toContain(fileA);
      expect(metrics.bytesRead).toBeLessThan(100 * 1024);
    } finally { await watcher.stop(); }
  });

  it('最新文件不足 N 行时按需向前补足，空白行与最后半行不占窗口', async () => {
    const old = Array.from({ length: 80 }, (_, index) => `old-${index}`);
    const recent = Array.from({ length: 40 }, (_, index) => `recent-${index}`);
    await write(fileA, `${old.join('\n')}\n`);
    await write(fileB, `${recent.join('\n')}\n\n  \n半行`);
    const watcher = follow();
    try {
      await receivedCount(watcher.records, 100);
      expect(watcher.records.map((record) => record.line)).toEqual([...old.slice(20), ...recent]);
      await append(fileB, '完成\n');
      await receivedCount(watcher.records, 101);
      expect(watcher.records[100].line).toBe('半行完成');
    } finally { await watcher.stop(); }
  });

  it('回放最后 100 行，回放回调期间追加的内容从同一快照继续，无重复或缺行', async () => {
    await write(fileA, `${Array.from({ length: 110 }, (_, i) => `line-${i}`).join('\n')}\n`);
    const records: string[] = [];
    const controller = new AbortController();
    const done = tailConsoleLogLines({}, controller.signal, async ({ line }) => {
      records.push(line);
      if (records.length === 1) await append(fileA, 'during-replay\n');
      if (records.length === 101) controller.abort();
    });
    try {
      await receivedCount(records, 101);
      expect(records).toEqual([...Array.from({ length: 100 }, (_, i) => `line-${i + 10}`), 'during-replay']);
    } finally { controller.abort(); await done; }
  });

  it('启动时没有日志文件也保持等待，创建文件后正常推送，abort 及时结束', async () => {
    await fsp.rmdir(settings.log.dir);
    const watcher = follow();
    try {
      await delay(25);
      expect(watcher.records).toEqual([]);
      await fsp.mkdir(settings.log.dir);
      await write(fileA, 'first\n');
      await receivedCount(watcher.records, 1);
      expect(watcher.records[0].line).toBe('first');
    } finally { await watcher.stop(); }
  });

  it('中文 UTF-8 和半行跨轮询、跨 64 KiB 块后仍只推送完整行', async () => {
    const prefix = 'x'.repeat(64 * 1024 - 1);
    const chinese = Buffer.from('中文日志');
    await write(fileA, Buffer.concat([Buffer.from(prefix), chinese.subarray(0, 1)]));
    const watcher = follow();
    try {
      await delay(25);
      expect(watcher.records).toEqual([]);
      await append(fileA, chinese.subarray(1));
      await delay(25);
      expect(watcher.records).toEqual([]);
      await append(fileA, '\r\nsecond\n\n');
      await receivedCount(watcher.records, 2);
      expect(watcher.records.map((record) => record.line)).toEqual([`${prefix}中文日志`, 'second']);
    } finally { await watcher.stop(); }
  });

  it('同文件截短后重读，即使截短后新内容已超过原 offset 也能识别', async () => {
    await write(fileA, 'before\n');
    const watcher = follow();
    try {
      await receivedCount(watcher.records, 1);
      await write(fileA, 'after truncation is longer\nnext\n');
      await receivedCount(watcher.records, 3);
      expect(watcher.records.map((record) => record.line)).toEqual(['before', 'after truncation is longer', 'next']);
    } finally { await watcher.stop(); }
  });

  it('同名文件被替换时从新文件开头继续，轮转前的剩余完整记录先于新文件', async () => {
    await write(fileA, 'old\n');
    const watcher = follow();
    try {
      await receivedCount(watcher.records, 1);
      await fsp.rename(path.join(settings.log.dir, fileA), path.join(tmpRoot, 'retired.log'));
      await write(fileA, 'replacement\n');
      await receivedCount(watcher.records, 2);
      await append(fileA, 'late-old\n');
      await write(fileB, 'rotated\n');
      await receivedCount(watcher.records, 4);
      expect(watcher.records.map((record) => record.line)).toEqual(['old', 'replacement', 'late-old', 'rotated']);
    } finally { await watcher.stop(); }
  });

  it('Last-Event-ID 从准确行后续传，补齐同文件及跨轮转的记录', async () => {
    await write(fileA, 'one\ntwo\nthree\n');
    const first = follow();
    await receivedCount(first.records, 3);
    await first.stop();
    await append(fileA, 'four\n');
    await write(fileB, 'five\nsix\n');
    const resumed = follow(first.records[1].id);
    try {
      await receivedCount(resumed.records, 4);
      expect(resumed.records.map((record) => record.line)).toEqual(['three', 'four', 'five', 'six']);
      expect(new Set(resumed.records.map((record) => record.id)).size).toBe(4);
    } finally { await resumed.stop(); }
  });

  it('cursor 的 offset 在多块 UTF-8 与 CRLF 后仍可准确续传', async () => {
    const line = `${'汉'.repeat(30_000)}末尾`;
    await write(fileA, `${line}\r\nsecond\nthird\n`);
    const first = follow();
    await receivedCount(first.records, 3);
    await first.stop();
    const resumed = follow(first.records[0].id);
    try {
      await receivedCount(resumed.records, 2);
      expect(resumed.records.map((record) => record.line)).toEqual(['second', 'third']);
    } finally { await resumed.stop(); }
  });

  it('cursor 非法、角色不匹配、路径越界或文件已清理时安全回放近期日志', async () => {
    await write(fileA, 'api\n');
    const first = follow();
    await receivedCount(first.records, 1);
    await first.stop();
    await write('app-worker.2026-10-23.1.log', 'worker\n');
    const forged = JSON.parse(Buffer.from(first.records[0].id, 'base64url').toString('utf8'));
    const traversal = Buffer.from(JSON.stringify({ ...forged, file: '../secret.log' })).toString('base64url');
    for (const cursor of ['invalid cursor!', traversal]) {
      const watcher = follow(cursor);
      try {
        await receivedCount(watcher.records, 1);
        expect(watcher.records[0].line).toBe('api');
      } finally { await watcher.stop(); }
    }
    const worker = follow(first.records[0].id, 'worker');
    try {
      await receivedCount(worker.records, 1);
      expect(worker.records[0].line).toBe('worker');
    } finally { await worker.stop(); }
    await fsp.unlink(path.join(settings.log.dir, fileA));
    await write(fileB, 'fresh\n');
    const cleaned = follow(first.records[0].id);
    try {
      await receivedCount(cleaned.records, 1);
      expect(cleaned.records[0].line).toBe('fresh');
    } finally { await cleaned.stop(); }
  });

  it('回调提供背压且错误向上传播，文件句柄在失败后关闭', async () => {
    await write(fileA, `${Array.from({ length: 5 }, (_, i) => `line-${i}`).join('\n')}\n`);
    const failure = new Error('socket disconnected');
    const controller = new AbortController();
    let inFlight = 0;
    let maximum = 0;
    let seen = 0;
    await expect(tailConsoleLogLines({}, controller.signal, async () => {
      inFlight += 1;
      maximum = Math.max(maximum, inFlight);
      await delay(1);
      inFlight -= 1;
      if (++seen === 3) throw failure;
    })).rejects.toBe(failure);
    expect(maximum).toBe(1);
    await fsp.rename(path.join(settings.log.dir, fileA), path.join(tmpRoot, 'closed.log'));
    controller.abort();
  });

  it('实时写入正在等待背压时 abort 仍能结束读取并关闭文件', async () => {
    await write(fileA, 'existing\n');
    const controller = new AbortController();
    let blocked = false;
    const done = tailConsoleLogLines({}, controller.signal, async ({ line }) => {
      if (line !== 'blocked') return;
      blocked = true;
      await new Promise<void>(() => {});
    });
    try {
      await delay(25);
      await append(fileA, 'blocked\n');
      await vi.waitFor(() => expect(blocked).toBe(true), { timeout: 2000, interval: 5 });
      controller.abort();
      await expect(done).resolves.toBeUndefined();
      await fsp.rename(path.join(settings.log.dir, fileA), path.join(tmpRoot, 'aborted.log'));
    } finally { controller.abort(); await done; }
  });
});
