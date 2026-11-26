import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { request } from '@/utils/request';
import { Toast } from '@douyinfe/semi-ui';
import { useLogTail } from './useLogTail';

vi.mock('@/utils/request', () => ({ request: { fetchRaw: vi.fn() } }));

function openStream(signal: AbortSignal) {
  return new Response(new ReadableStream({
    start(controller) {
      signal.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true });
    },
  }));
}

beforeEach(() => { vi.mocked(request.fetchRaw).mockReset(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('useLogTail', () => {
  it('收到后端错误帧后停止追踪，不重试或把错误当日志', async () => {
    vi.useFakeTimers();
    vi.spyOn(Toast, 'error').mockImplementation(() => 'toast-id');
    const message = '无法读取后端运行日志，请检查日志目录权限或服务端错误记录';
    vi.mocked(request.fetchRaw).mockResolvedValueOnce(new Response(new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode(`event: log\ndata: 已输出的日志\n\nevent: error\ndata: ${message}\n\n`));
        controller.enqueue(encoder.encode(`event: error\ndata: ${message}\n\nevent: log\ndata: 不应接收\n\n`));
        controller.close();
      },
    })));
    const { result, unmount } = renderHook(() => useLogTail('/console-tail'));
    await act(async () => { await result.current.start(); });
    expect(result.current.tailing).toBe(false);
    expect(result.current.reconnecting).toBe(false);
    expect(result.current.lines).toEqual(['已输出的日志']);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(request.fetchRaw).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    unmount();
  });

  it('重连使用最后日志帧 id 续传，控制帧不进入日志且不覆盖游标', async () => {
    vi.useFakeTimers();
    vi.mocked(request.fetchRaw)
      .mockResolvedValueOnce(new Response('id: cursor-1\nevent: log\ndata: 第一条\n\nid: cursor-2\nevent: log\ndata: 第二条\n\nid: heartbeat-id\nevent: ready\ndata: connected\n\n'))
      .mockImplementationOnce(async (_url, options) => openStream(options!.signal!));
    const { result, unmount } = renderHook(() => useLogTail('/console-tail'));
    await act(async () => { void result.current.start(); });
    expect(result.current.lines).toEqual(['第一条', '第二条']);
    expect(result.current.reconnecting).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(request.fetchRaw).toHaveBeenCalledTimes(2);
    expect(vi.mocked(request.fetchRaw).mock.calls[1][1]?.headers).toEqual({ 'Last-Event-ID': 'cursor-2' });
    expect(result.current.lines).toEqual(['第一条', '第二条']);
    act(() => result.current.stop());
    unmount();
  });

  it('旧日志流无 id 时重连不发送续传头，暂停积压仍继续消费', async () => {
    vi.useFakeTimers();
    let push: ReadableStreamDefaultController<Uint8Array>;
    vi.mocked(request.fetchRaw)
      .mockImplementationOnce(async (_url, options) => new Response(new ReadableStream({
        start(controller) {
          push = controller;
          options!.signal!.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true });
        },
      })))
      .mockImplementationOnce(async (_url, options) => openStream(options!.signal!));
    const { result, unmount } = renderHook(() => useLogTail('/legacy-tail'));
    await act(async () => { void result.current.start(); });
    act(() => result.current.pause());
    await act(async () => { push!.enqueue(new TextEncoder().encode(': heartbeat\n\nevent: log\ndata:\n\nevent: log\ndata: legacy\n\n')); });
    expect(result.current.lines).toEqual([]);
    expect(result.current.pendingCount).toBe(2);
    act(() => result.current.resume());
    expect(result.current.lines).toEqual(['', 'legacy']);
    await act(async () => { push!.close(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(vi.mocked(request.fetchRaw).mock.calls[1][1]?.headers).toBeUndefined();
    act(() => result.current.stop());
    unmount();
  });

  it('卸载时取消持续连接', async () => {
    let signal: AbortSignal | undefined;
    vi.mocked(request.fetchRaw).mockImplementation(async (_url, options) => {
      signal = options!.signal!;
      return openStream(signal);
    });
    const { result, unmount } = renderHook(() => useLogTail('/console-tail'));
    act(() => { void result.current.start(); });
    await waitFor(() => expect(request.fetchRaw).toHaveBeenCalledOnce());
    unmount();
    expect(signal?.aborted).toBe(true);
  });
});
