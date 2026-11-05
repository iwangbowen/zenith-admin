import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const gzipAsync = promisify(gzip);
const settings = vi.hoisted(() => ({ log: { dir: '' } }));

vi.mock('../../config', () => ({ config: settings }));

const { locateCorrelationLogs } = await import('./log-locator.service');

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'zenith-log-locator-'));
  settings.log.dir = path.join(tmpRoot, 'logs');
  await fsp.mkdir(settings.log.dir);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fsp.rm(tmpRoot, { recursive: true, force: true });
});

function logPath(name: string): string {
  return path.join(settings.log.dir, name);
}

function record(fields: Record<string, unknown>): string {
  return JSON.stringify(fields);
}

async function write(name: string, value: string | Buffer): Promise<void> {
  await fsp.writeFile(logPath(name), value);
}

async function writeGzip(name: string, value: string): Promise<void> {
  await write(name, await gzipAsync(Buffer.from(value)));
}

describe('locateCorrelationLogs', () => {
  it('扫描所有角色、日期和轮转序号，并读取 gzip 文件', async () => {
    const correlationId = 'corr-20261106-001';
    await write('app-api.2026-11-05.1.log', [
      record({ hostname: 'api-host', pid: 101, msg: 'before' }),
      record({ correlationId, hostname: 'api-host', pid: 101, msg: 'api first' }),
      record({ correlationId, hostname: 'api-host', pid: 101, msg: 'api second' }),
      record({ hostname: 'api-host', pid: 101, msg: 'after' }),
    ].join('\n'));
    await write('app-api.2026-11-05.2.log', record({ msg: 'same day later rotation' }));
    await writeGzip('app-worker.2026-11-04.1.log.gz', [
      record({ msg: 'worker before' }),
      record({ correlationId, hostname: 'worker-host', pid: 202, msg: 'delayed worker' }),
      record({ msg: 'worker after' }),
    ].join('\n'));
    await write('app.2026-11-06.1.log', record({ correlationId, hostname: 'all-host', pid: 303, msg: 'all role' }));

    const result = await locateCorrelationLogs({ correlationId, context: 1 });

    expect(result.status).toBe('matched');
    expect(result.truncated).toBe(false);
    expect(result.matches).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'api',
        filename: 'app-api.2026-11-05.1.log',
        date: '2026-11-05',
        sequence: 1,
        isGzip: false,
        hostname: 'api-host',
        pid: 101,
        matchCount: 2,
        context: expect.arrayContaining([
          expect.stringContaining('before'),
          expect.stringContaining('api first'),
          expect.stringContaining('api second'),
        ]),
      }),
      expect.objectContaining({
        role: 'worker',
        filename: 'app-worker.2026-11-04.1.log.gz',
        isGzip: true,
        hostname: 'worker-host',
        pid: 202,
        matchCount: 1,
      }),
      expect.objectContaining({
        role: 'all',
        filename: 'app.2026-11-06.1.log',
        hostname: 'all-host',
        pid: 303,
        matchCount: 1,
      }),
    ]));
    expect(result.matches).toHaveLength(3);
    expect(result.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'api', status: 'scanned', scannedFiles: 2 }),
      expect.objectContaining({ role: 'worker', status: 'scanned', scannedFiles: 1 }),
      expect.objectContaining({ role: 'all', status: 'scanned', scannedFiles: 1 }),
    ]));
  });

  it('只匹配顶层 correlationId 的完全相等值，不接受 OTel、嵌套或正文中的同串', async () => {
    const correlationId = 'corr-20261106-002';
    await write('app-api.2026-11-06.1.log', [
      record({ trace_id: correlationId, msg: 'OTel id only' }),
      record({ span_id: correlationId, msg: 'span id only' }),
      record({ payload: { correlationId }, msg: 'nested field only' }),
      record({ msg: `request URL contains ${correlationId}` }),
      record({ correlationId: `${correlationId}-suffix`, msg: 'different value' }),
    ].join('\n'));

    const result = await locateCorrelationLogs({ correlationId });

    expect(result.status).toBe('not_found');
    expect(result.matches).toEqual([]);
    expect(result.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'api', status: 'scanned', error: null }),
    ]));
  });

  it('返回首个命中的上下文并统计同文件精确命中次数', async () => {
    const correlationId = 'corr-20261106-003';
    await write('app.2026-11-06.1.log', [
      record({ msg: 'line-0' }),
      record({ msg: 'line-1' }),
      record({ correlationId, msg: 'line-2' }),
      record({ msg: 'line-3' }),
      record({ msg: 'line-4' }),
      record({ correlationId, msg: 'line-5' }),
      record({ msg: 'line-6' }),
    ].join('\n'));

    const result = await locateCorrelationLogs({ correlationId, context: 2 });

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({ matchCount: 2 });
    expect(result.matches[0]?.context).toEqual([
      record({ msg: 'line-0' }),
      record({ msg: 'line-1' }),
      record({ correlationId, msg: 'line-2' }),
      record({ msg: 'line-3' }),
      record({ msg: 'line-4' }),
    ]);
  });

  it('日志目录不存在时返回 source_unavailable，而不是 not_found', async () => {
    await fsp.rm(settings.log.dir, { recursive: true, force: true });

    const result = await locateCorrelationLogs({ correlationId: 'corr-20261106-004' });

    expect(result).toMatchObject({ status: 'source_unavailable', scannedFiles: 0, scannedBytes: 0, truncated: false });
    expect(result.sources).toEqual([
      expect.objectContaining({ role: 'all', status: 'unavailable', error: 'log_directory_missing' }),
      expect.objectContaining({ role: 'api', status: 'unavailable', error: 'log_directory_missing' }),
      expect.objectContaining({ role: 'worker', status: 'unavailable', error: 'log_directory_missing' }),
    ]);
  });

  it('日志目录不可读取时返回 source_error 且不暴露底层路径', async () => {
    await fsp.rm(settings.log.dir, { recursive: true, force: true });
    await fsp.writeFile(settings.log.dir, 'not a directory');

    const result = await locateCorrelationLogs({ correlationId: 'corr-20261106-005' });

    expect(result.status).toBe('source_error');
    expect(result.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'error', error: 'log_directory_unavailable' }),
    ]));
    expect(JSON.stringify(result)).not.toContain(tmpRoot);
  });

  it('单个文件打开失败时标记 source_error，不把异常变成 HTTP 500 或未命中', async () => {
    const filename = 'app-api.2026-11-06.1.log';
    await write(filename, record({ correlationId: 'corr-20261106-006' }));
    const failure = Object.assign(new Error(`EACCES ${logPath(filename)}`), { code: 'EACCES' });
    vi.spyOn(fsp, 'open').mockRejectedValueOnce(failure);

    const result = await locateCorrelationLogs({ correlationId: 'corr-20261106-006' });

    expect(result.status).toBe('source_error');
    expect(result.matches).toEqual([]);
    expect(result.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'api', status: 'error', error: 'file_open_error' }),
    ]));
    expect(JSON.stringify(result)).not.toContain(tmpRoot);
  });

  it('同一角色后续文件仍命中时保留先前 source_error 标记', async () => {
    const correlationId = 'corr-20261106-006b';
    const failedFile = 'app-api.2026-11-06.2.log';
    await write(failedFile, record({ correlationId }));
    await write('app-api.2026-11-06.1.log', record({ correlationId, hostname: 'api-host', pid: 606 }));
    const failure = Object.assign(new Error(`EACCES ${logPath(failedFile)}`), { code: 'EACCES' });
    vi.spyOn(fsp, 'open').mockRejectedValueOnce(failure);

    const result = await locateCorrelationLogs({ correlationId });

    expect(result.status).toBe('matched');
    expect(result.matches).toEqual([expect.objectContaining({ filename: 'app-api.2026-11-06.1.log', pid: 606 })]);
    expect(result.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'api', status: 'error', error: 'file_open_error', scannedFiles: 1 }),
    ]));
  });

  it('gzip 损坏或单行超限时保留受控错误状态', async () => {
    const correlationId = 'corr-20261106-007';
    await write('app-worker.2026-11-06.1.log.gz', 'not gzip');
    await write('app-api.2026-11-06.1.log', `${'x'.repeat(16 * 1024 + 1)}\n`);

    const result = await locateCorrelationLogs({ correlationId });

    expect(result.status).toBe('source_error');
    expect(result.matches).toEqual([]);
    expect(result.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'worker', status: 'error', error: 'invalid_gzip' }),
      expect.objectContaining({ role: 'api', status: 'error', error: 'line_too_long' }),
    ]));
  });

  it('按打开时的快照大小读取，文件随后增长的内容不会越过扫描边界', async () => {
    const correlationId = 'corr-20261106-growth';
    const filename = 'app-api.2026-11-06.1.log';
    await write(filename, record({ msg: 'snapshot only' }));
    const originalOpen = fsp.open.bind(fsp);
    vi.spyOn(fsp, 'open').mockImplementation(async (...args) => {
      const handle = await originalOpen(...args);
      return new Proxy(handle, {
        get(target, property, receiver) {
          if (property === 'createReadStream') {
            return (options: Parameters<FileHandle['createReadStream']>[0]) => {
              void fsp.appendFile(logPath(filename), `\n${record({ correlationId })}`);
              return target.createReadStream(options);
            };
          }
          const value = Reflect.get(target, property, receiver);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    });

    const result = await locateCorrelationLogs({ correlationId });

    expect(result.status).toBe('not_found');
    expect(result.matches).toEqual([]);
  });

  it('达到命中保护上限时停止扫描并标记 truncated', async () => {
    const correlationId = 'corr-20261106-008';
    const lines = Array.from({ length: 101 }, (_, index) => record({ correlationId, index }));
    await write('app.2026-11-06.1.log', lines.join('\n'));

    const result = await locateCorrelationLogs({ correlationId });

    expect(result.status).toBe('matched');
    expect(result.truncated).toBe(true);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.matchCount).toBe(100);
  });

  it('严格忽略目录和不符合轮转白名单的文件名', async () => {
    const correlationId = 'corr-20261106-009';
    await fsp.mkdir(logPath('app-api.2026-11-06.1.log'));
    await write('app-api.2026-11-06.0.log', record({ correlationId }));
    await write('app-api.2026-11-06.1.log.secret', record({ correlationId }));
    await write('application.2026-11-06.1.log', record({ correlationId }));

    const result = await locateCorrelationLogs({ correlationId });

    expect(result.status).toBe('source_unavailable');
    expect(result.matches).toEqual([]);
    expect(result.scannedFiles).toBe(0);
  });
});
