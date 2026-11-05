/**
 * 日志文件路由的匹配与分发。
 *
 * 重点回归：`DELETE /api/log-files/batch` 与 `DELETE /api/log-files/{filename}` 同方法、同段数，
 * Hono 按注册顺序匹配。批量路由若排在参数路由之后，请求会被 `/{filename}` 抢走
 * （filename="batch" → 查目录里名为 batch 的文件 → 404「文件不存在」），
 * 表现为「点了批量删除只弹文件不存在」。这里用真实 router 发请求守住分发归属。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 门禁与审计在本文件之外，路由分发才是被测对象
vi.mock('../../middleware/guard', () => ({
  setAuditBeforeData: vi.fn(),
  guard: () => async (_c: unknown, next: () => Promise<void>) => { await next(); },
}));
vi.mock('../../middleware/auth', () => ({ authMiddleware: async (_c: unknown, next: () => Promise<void>) => { await next(); } }));
vi.mock('../../middleware/platform-admin', () => ({ platformAdminOnly: () => async (_c: unknown, next: () => Promise<void>) => { await next(); } }));

const batchDeleteLogFiles = vi.fn(async () => 2);
const deleteLogFile = vi.fn(async () => {});
const getLogFileBeforeAudit = vi.fn(async (name: string) => ({ name, size: 1, modifiedAt: '2026-10-13 00:00:00', isGzip: false }));
const getLogFilesBeforeAudit = vi.fn(async (names: string[]) => names.map((name) => ({ name, size: 1, modifiedAt: '2026-10-13 00:00:00', isGzip: false })));
const listLogFiles = vi.fn(async () => []);
const locateCorrelationLogs = vi.fn(async (query: { correlationId: string; context?: number }) => ({
  correlationId: query.correlationId,
  status: 'matched' as const,
  matches: [],
  sources: [],
  scannedFiles: 0,
  scannedBytes: 0,
  truncated: false,
}));

/** 打包下载的双模服务：同步返回 zip 流 / 超阀值返回任务信封 */
const batchDownloadLogFiles = vi.fn();

vi.mock('../../services/ops/log-files-download.service', () => ({
  batchDownloadLogFiles: (names: string[]) => batchDownloadLogFiles(names),
}));

vi.mock('../../services/ops/log-locator.service', () => ({
  locateCorrelationLogs: (query: { correlationId: string; context?: number }) => locateCorrelationLogs(query),
}));

vi.mock('../../services/ops/log-files.service', () => ({
  listLogFiles: () => listLogFiles(),
  readLogFileLines: vi.fn(async () => []),
  deleteLogFile: (name: string) => deleteLogFile(name),
  resolveLogFile: vi.fn(async (name: string) => ({ name, filepath: `/logs/${name}` })),
  getLogFileBeforeAudit: (name: string) => getLogFileBeforeAudit(name),
  batchDeleteLogFiles: (names: string[]) => batchDeleteLogFiles(names),
  getLogFilesBeforeAudit: (names: string[]) => getLogFilesBeforeAudit(names),
}));

const { default: logFilesRouter } = await import('./log-files');

// 直接用装配好的 router 发请求；basePath 由运维域统一挂载，这里补上前缀便于断言完整路径
const app = logFilesRouter.basePath('/api/log-files');

beforeEach(() => {
  batchDeleteLogFiles.mockClear();
  deleteLogFile.mockClear();
  batchDownloadLogFiles.mockReset();
  locateCorrelationLogs.mockClear();
});

describe('GET /api/log-files/locate 的分发与校验', () => {
  it('命中静态 locator 路由而非 /{filename}/content 系列，并把解析后的 query 传给服务', async () => {
    const res = await app.request('/locate?correlationId=corr-20261106-001&context=4');

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ code: 0, data: { status: 'matched' } });
    expect(locateCorrelationLogs).toHaveBeenCalledWith({ correlationId: 'corr-20261106-001', context: 4 });
  });

  it.each([
    '/locate?correlationId=short',
    `/locate?correlationId=${'x'.repeat(65)}`,
    '/locate?correlationId=corr-20261106-001&context=-1',
    '/locate?correlationId=corr-20261106-001&context=11',
    '/locate?correlationId=corr-20261106-001&context=not-a-number',
  ])('非法 locator query 在服务层之前被拒绝：%s', async (url) => {
    const res = await app.request(url);
    expect(res.status).toBe(400);
    expect(locateCorrelationLogs).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/log-files/batch 的分发归属', () => {
  it('命中批量处理器而非 /{filename}', async () => {
    const res = await app.request('/batch', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filenames: ['a.log', 'b.log'] }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ code: 0, message: '已删除 2 个日志文件', data: { deleted: 2 } });
    expect(batchDeleteLogFiles).toHaveBeenCalledWith(['a.log', 'b.log']);
    expect(deleteLogFile).not.toHaveBeenCalled();
  });

  it('单个删除仍走 /{filename}，文件名 batch 之外的正常值不受影响', async () => {
    const res = await app.request('/app.2026-10-13.1.log', { method: 'DELETE' });

    expect(res.status).toBe(200);
    expect(deleteLogFile).toHaveBeenCalledWith('app.2026-10-13.1.log');
    expect(batchDeleteLogFiles).not.toHaveBeenCalled();
  });

  it('空数组按契约 400，不落到批量处理器', async () => {
    const res = await app.request('/batch', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filenames: [] }),
    });

    expect(res.status).toBe(400);
    expect(batchDeleteLogFiles).not.toHaveBeenCalled();
  });
});

describe('POST /api/log-files/batch-download 的双模响应', () => {
  const post = (filenames: unknown) => app.request('/batch-download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filenames }),
  });

  it('同步模式下响应体是 zip 流（含附件文件名，不套 JSON 外壳）', async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    batchDownloadLogFiles.mockResolvedValue({
      mode: 'sync',
      stream: new Blob([bytes]).stream(),
      filename: 'logs_1.zip',
    });

    const res = await post(['app.1.log']);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/zip');
    expect(res.headers.get('content-disposition')).toContain('logs_1.zip');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
    expect(batchDownloadLogFiles).toHaveBeenCalledWith(['app.1.log']);
  });

  it('超阀值时以 JSON 信封返回任务信息（同一接口的另一种响应形态）', async () => {
    batchDownloadLogFiles.mockResolvedValue({ mode: 'task', result: { mode: 'task', taskId: 42 } });

    const res = await post(['a.log', 'b.log']);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    await expect(res.json()).resolves.toMatchObject({ code: 0, data: { mode: 'task', taskId: 42 } });
  });

  it('静态段 batch-download 不被 /{filename} 系列路由抢走', async () => {
    batchDownloadLogFiles.mockResolvedValue({ mode: 'task', result: { mode: 'task', taskId: 1 } });

    const res = await post(['a.log']);

    expect(res.status).toBe(200);
    expect(batchDownloadLogFiles).toHaveBeenCalledTimes(1);
  });

  it('空数组按契约 400，不落到服务层', async () => {
    const res = await post([]);

    expect(res.status).toBe(400);
    expect(batchDownloadLogFiles).not.toHaveBeenCalled();
  });
});