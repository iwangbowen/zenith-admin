/**
 * 日志工作台正文搜索与链路定位：
 * 挂载时预填搜索框并高亮匹配；无深链时搜索框为空。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRecorder, createRequestMock, createTestQueryClient } from '@/test-utils/query-harness';
import { LogWorkbench, type LogWorkbenchProps } from './LogWorkbench';
import { useLogTail } from './useLogTail';

const recorder = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => recorder) }));
vi.mock('./useLogTail', () => ({ MAX_TAIL_LINES: 20000, useLogTail: vi.fn() }));

const FILENAME = 'app.2026-10-12.1.log';
const KEYWORD = 'trace-abc-12345';

beforeEach(() => {
  localStorage.removeItem('logWorkbench.palette');
  recorder.reset();
  vi.mocked(useLogTail).mockReturnValue({
    tailing: false, paused: false, reconnecting: false, lines: [], pendingCount: 0, capped: false,
    start: vi.fn(), stop: vi.fn(), pause: vi.fn(), resume: vi.fn(),
  });
  recorder.on('GET', `/api/log-files/${FILENAME}/content`, {
    lines: [
      '{"level":30,"correlationId":"other-trace","msg":"GET /api/users 200 5ms"}',
      `{"level":30,"correlationId":"${KEYWORD}","msg":"POST /api/mp/fans/unblacklist 200 60ms"}`,
    ],
  });
});

function renderWorkbench(initialKeyword?: string, extra: Partial<LogWorkbenchProps> = {}) {
  const client = createTestQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <LogWorkbench source={{ kind: 'file', filename: FILENAME }} canTail={false} initialKeyword={initialKeyword} {...extra} />
    </QueryClientProvider>,
  );
}

describe('精确链路定位', () => {
  it('控制台模式自动开始追踪，卸载时停止；旧文件页面保持静态读取', async () => {
    const start = vi.fn();
    const stop = vi.fn();
    vi.mocked(useLogTail).mockReturnValue({
      tailing: false, paused: false, reconnecting: false, lines: [], pendingCount: 0, capped: false, pause: vi.fn(), resume: vi.fn(),
      start, stop,
    });
    recorder.on('GET', '/api/console-logs/content', { lines: [] });
    const view = renderWorkbench(undefined, { source: { kind: 'console', role: 'api' }, canTail: true, autoTail: true });
    expect(start).toHaveBeenCalledOnce();
    view.unmount();
    expect(stop).toHaveBeenCalledOnce();
    renderWorkbench();
    await waitFor(() => expect(recorder.countOf('GET', `/api/log-files/${FILENAME}/content`)).toBe(1));
    expect(start).toHaveBeenCalledOnce();
  });

  it('控制台链路定位复用应用日志精确查询', async () => {
    recorder.on('GET', '/api/console-logs/content', { lines: [] });
    renderWorkbench(undefined, { source: { kind: 'console', role: 'worker' }, initialCorrelationId: KEYWORD });
    await waitFor(() => expect(recorder.countOf('GET', '/api/console-logs/content')).toBe(1));
    const params = new URLSearchParams(recorder.urls('GET')[0].split('?')[1]);
    expect(params.get('role')).toBe('worker');
    expect(params.get('locateCorrelationId')).toBe(KEYWORD);
  });

  it('发送 locateCorrelationId 加载连续日志并预填搜索，普通正文搜索保留定位窗口', async () => {
    renderWorkbench(undefined, { initialCorrelationId: KEYWORD });

    await waitFor(() => expect(recorder.countOf('GET', `/api/log-files/${FILENAME}/content`)).toBe(1));
    const params = new URLSearchParams(recorder.urls('GET')[0].split('?')[1]);
    expect(params.get('locateCorrelationId')).toBe(KEYWORD);
    expect(params.has('correlationId')).toBe(false);
    expect(params.has('keyword')).toBe(false);

    fireEvent.change(screen.getByPlaceholderText('搜索日志内容'), { target: { value: 'unblacklist' } });
    expect(recorder.countOf('GET', `/api/log-files/${FILENAME}/content`)).toBe(1);
  });
});

