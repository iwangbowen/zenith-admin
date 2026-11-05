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
// 虚拟列表依赖浏览器尺寸；这里保留可见行和级别语义，验证工作台的展示/搜索/复制流水线。
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
    expect(screen.queryByText('全文')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('原始JSON'));
    fireEvent.change(screen.getByPlaceholderText('搜索日志内容'), { target: { value: 'level' } });
    fireEvent.click(screen.getByText('全文'));
    await waitFor(() => expect(recorder.urls('GET').some((url) => new URL(url, window.location.origin).searchParams.get('keyword') === 'level')).toBe(true));
    fireEvent.click(screen.getByText('控制台'));
    expect(screen.queryByText('全文')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('搜索日志内容')).toBeInTheDocument();
    expect(screen.queryByText('全文过滤：level')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('原始JSON'));
    expect(screen.getByPlaceholderText('搜索日志内容')).toBeInTheDocument();
    expect(screen.queryByText('全文过滤：level')).not.toBeInTheDocument();
  });

  it('默认可读格式，切换原始 JSON 保留缓冲与追踪连接，搜索计数跟随展示文本', async () => {
    renderConsole({ initialKeyword: '"level"' });
    const output = screen.getByTestId('log-output');
    expect(output).toHaveTextContent('INFO: 业务请求完成');
    expect(output.textContent).toContain('Error: failed\n        at run (job.ts:42)');
    expect(output.textContent).not.toContain('"hostname"');
    expect(await screen.findByText('0/0')).toBeInTheDocument();
    const start = vi.mocked(useLogTail).mock.results[0].value.start;
    const stop = vi.mocked(useLogTail).mock.results[0].value.stop;
    expect(start).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByText('原始JSON'));
    expect(output.textContent).toBe(RAW_LINES.join(''));
    expect(await screen.findByText('1/2')).toBeInTheDocument();
    fireEvent.click(screen.getByText('控制台'));
    expect(output).toHaveTextContent('INFO: 业务请求完成');
    expect(start).toHaveBeenCalledOnce();
    expect(stop).not.toHaveBeenCalled();
  });

  it('格式化后的精确链路搜索仍按原始顶层 correlationId 归属，并保留级别过滤', async () => {
    renderConsole({ initialCorrelationId: TARGET });
    expect(await screen.findByText('1/1')).toBeInTheDocument();
    expect(screen.getByTestId('log-output').children).toHaveLength(2);
    fireEvent.click(screen.getByText('原始JSON'));
    expect(await screen.findByText('1/1')).toBeInTheDocument();
  });

  it('复制当前视图使用所选格式，file 来源继续显示原始记录', async () => {
    const view = renderConsole({ initialLevel: 'error' });
    expect(screen.getByTestId('log-output').children).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '更多日志操作' }));
    fireEvent.click(await screen.findByText('复制当前视图（1 行）'));
    await waitFor(() => expect(copyTextWithToast).toHaveBeenCalledOnce());
    expect(vi.mocked(copyTextWithToast).mock.calls[0][0]).toContain('ERROR: 定位 API');
    expect(vi.mocked(copyTextWithToast).mock.calls[0][0]).toContain('\n        at run (job.ts:42)');
    view.unmount();
    renderConsole({ source: { kind: 'file', filename: 'app.log' } });
    expect(screen.getByTestId('log-output').textContent).toBe(RAW_LINES.join(''));
    expect(screen.queryByText('原始JSON')).not.toBeInTheDocument();
  });
});
