/**
 * 全局兜底的「拒绝分类」契约测试。
 *
 * 弹窗提交必须靠**抛出**来中断（`return` 会让 Semi 的确定按钮一直转圈），
 * 于是「用户校验没过」和「真的出错了」在 Promise 上是同一种信号。
 * 这里锁的就是兜底如何区分两者——分错的代价是**双向**的：
 *
 * - 把中断误判为错误：用户在自己的中文提示之外再吃一个「操作失败：empty content」，
 *   并给 `/api/frontend-errors` 灌进一条由正常操作产生的假告警；
 * - 把错误误判为中断：真故障被静默吞掉。
 *
 * 此前的判据是**消息形状**（`/^\w+$/`），这条规则只写在兜底 hook 的注释里，
 * 调用点看不见，反向还会吞掉 `NetworkError` / `timeout` 一类单词消息的真实异常。
 * `SubmitAborted` 把判据换成类型，消息形状分支已删除。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const toastError = vi.fn();
vi.mock('@douyinfe/semi-ui', () => ({
  Toast: { error: (...args: unknown[]) => toastError(...args) },
}));

const reportError = vi.fn();
vi.mock('@/utils/error-reporter', () => ({
  reportError: (...args: unknown[]) => reportError(...args),
}));

vi.mock('@/utils/breadcrumbs', () => ({ addBreadcrumb: vi.fn() }));

import { useGlobalErrorHandler } from './useGlobalErrorHandler';
import { SubmitAborted, abortSubmit } from '@/lib/abort-submit';
import { ApiError } from '@/lib/query';

/** 模拟一次未处理的 Promise 拒绝（jsdom 不会自动产生 PromiseRejectionEvent） */
function emitRejection(reason: unknown) {
  const event = Object.assign(new Event('unhandledrejection'), { reason });
  globalThis.dispatchEvent(event);
}

describe('未处理拒绝的分类', () => {
  beforeEach(() => {
    toastError.mockClear();
    reportError.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('SubmitAborted 属提交中断：不弹兜底 Toast、不上报', () => {
    const { unmount } = renderHook(() => useGlobalErrorHandler());

    emitRejection(new SubmitAborted());
    // 带可读原因的中断同样必须被放行——这正是消息形状判据管不住的那一类
    emitRejection(new SubmitAborted('公告内容为空'));

    expect(toastError).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
    unmount();
  });

  it('abortSubmit() 抛出的对象可被兜底识别', () => {
    const { unmount } = renderHook(() => useGlobalErrorHandler());

    let thrown: unknown;
    try {
      abortSubmit('empty content');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SubmitAborted);

    emitRejection(thrown);
    expect(toastError).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
    unmount();
  });

  it('ApiError 由 request 层提示：不重复弹、不上报', () => {
    const { unmount } = renderHook(() => useGlobalErrorHandler());

    emitRejection(new ApiError(400, '库存不足'));

    expect(toastError).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
    unmount();
  });

  it('真实错误仍然弹提示并上报', () => {
    const { unmount } = renderHook(() => useGlobalErrorHandler());

    emitRejection(new TypeError('x is not a function'));

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('单词消息的裸 Error 不再被放行：NetworkError 一类真实异常必须上报', () => {
    const { unmount } = renderHook(() => useGlobalErrorHandler());

    emitRejection(new Error('NetworkError'));
    emitRejection(new Error('validation'));

    expect(toastError).toHaveBeenCalledTimes(2);
    expect(reportError).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('React ViewTransition 导航抢占超时属框架噪声：不弹 Toast、不上报', () => {
    const { unmount } = renderHook(() => useGlobalErrorHandler());

    emitRejection(new Error('A ViewTransition timed out because a Navigation stalled. This can happen if a Navigation is blocked on React itself.'));

    expect(toastError).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
    unmount();
  });
});
