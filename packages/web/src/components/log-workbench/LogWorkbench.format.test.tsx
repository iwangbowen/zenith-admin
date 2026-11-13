import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRecorder, createRequestMock, createTestQueryClient } from '@/test-utils/query-harness';
import { copyTextWithToast } from '@/utils/clipboard';
import type { LogContentViewProps } from './LogContentView';
import { LogWorkbench } from './LogWorkbench';
import { useLogTail } from './useLogTail';

const recorder = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => recorder) }));
vi.mock('@/utils/clipboard', () => ({ copyTextWithToast: vi.fn().mockResolvedValue(true) }));
vi.mock('./useLogTail', () => ({ MAX_TAIL_LINES: 5000, useLogTail: vi.fn() }));
// 不渲染虚拟列表的 DOM；本组只验证请求、流连接和复制输出。
vi.mock('./LogContentView', () => ({
  LogContentView: ({ lines, visibleIndexes, levels }: LogContentViewProps) => <div data-testid="log-output">{visibleIndexes.map((index) => <pre key={index} data-level={levels[index]}>{lines[index]}</pre>)}</div>,
}));

const TARGET = 'request-target-123';
const RAW_LINES = [
  JSON.stringify({ level: 30, correlationId: TARGET, msg: '业务请求完成', role: 'api', pid: 123, hostname: 'server' }),
  JSON.stringify({ level: 50, correlationId: 'other-request', msg: `定位 API ${TARGET}`, err: { stack: 'Error: failed\n    at run (job.ts:42)' } }),
];

beforeEach(() => {
  localStorage.clear();
  recorder.reset();
  vi.mocked(copyTextWithToast).mockClear();
  vi.mocked(useLogTail).mockReturnValue({
    tailing: true, paused: false, reconnecting: false, lines: RAW_LINES, pendingCount: 0, capped: false,
    start: vi.fn(), stop: vi.fn(), pause: vi.fn(), resume: vi.fn(),
  });
});

function renderConsole(extra: Partial<Parameters<typeof LogWorkbench>[0]> = {}) {
  return render(<QueryClientProvider client={createTestQueryClient()}><LogWorkbench source={{ kind: 'console', role: 'api' }} autoTail {...extra} /></QueryClientProvider>);
}

describe('控制台展示格式', () => {
  it('仅原始 JSON 模式开放全文搜索，切换格式清除服务端全文过滤', async () => {
    vi.mocked(useLogTail).mockReturnValue({
      tailing: false, paused: false, reconnecting: false, lines: [], pendingCount: 0, capped: false,
      start: vi.fn(), stop: vi.fn(), pause: vi.fn(), resume: vi.fn(),
    });
    recorder.on('GET', '/api/console-logs/content', { lines: RAW_LINES });
    renderConsole({ autoTail: false });
    fireEvent.click(screen.getByText('原始JSON'));
    fireEvent.change(screen.getByPlaceholderText('搜索日志内容'), { target: { value: 'level' } });
    fireEvent.click(screen.getByText('全文'));
    await waitFor(() => expect(recorder.urls('GET').some((url) => new URL(url, window.location.origin).searchParams.get('keyword') === 'level')).toBe(true));
    fireEvent.click(screen.getByText('控制台'));
    await waitFor(() => expect(recorder.urls('GET').some(url => !new URL(url, window.location.origin).searchParams.has('keyword'))).toBe(true));
    fireEvent.click(screen.getByText('原始JSON'));
  });

  it('切换日志格式不会重复创建或中断追踪连接', () => {
    renderConsole({ initialKeyword: '"level"' });
    const start = vi.mocked(useLogTail).mock.results[0].value.start;
    const stop = vi.mocked(useLogTail).mock.results[0].value.stop;
    expect(start).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByText('原始JSON'));
    fireEvent.click(screen.getByText('控制台'));
    expect(start).toHaveBeenCalledOnce();
    expect(stop).not.toHaveBeenCalled();
  });

  it('复制只包含所选级别的日志内容', async () => {
    renderConsole({ initialLevel: 'error' });
    fireEvent.click(screen.getByRole('button', { name: '更多日志操作' }));
    fireEvent.click(await screen.findByText('复制当前视图（1 行）'));
    await waitFor(() => expect(copyTextWithToast).toHaveBeenCalledOnce());
    expect(vi.mocked(copyTextWithToast).mock.calls[0][0]).toContain('ERROR: 定位 API');
    expect(vi.mocked(copyTextWithToast).mock.calls[0][0]).toContain('\n        at run (job.ts:42)');
    expect(vi.mocked(copyTextWithToast).mock.calls[0][0]).not.toContain('业务请求完成');
  });
});
