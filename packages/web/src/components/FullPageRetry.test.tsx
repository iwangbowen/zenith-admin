import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { ApiError } from '@/lib/query';
import FullPageRetry from './FullPageRetry';

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true });
  globalThis.dispatchEvent(new Event(value ? 'online' : 'offline'));
}

function advance(seconds: number) {
  act(() => {
    vi.advanceTimersByTime(seconds * 1000);
  });
}

const baseProps = {
  title: '暂时无法连接服务器',
  description: '登录凭证已保留，请检查网络后重试。',
};

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('FullPageRetry', () => {
  it('does not classify an arbitrary 503 as planned maintenance', () => {
    render(<FullPageRetry {...baseProps} error={new ApiError(503, '维护状态暂不可用')} onRetry={vi.fn()} />);
    expect(screen.getByText('服务器返回异常')).toBeTruthy();
    expect(screen.queryByText('系统维护中')).toBeNull();
  });
  it('pauses the countdown while a retry is in flight', () => {
    const onRetry = vi.fn();
    render(<FullPageRetry {...baseProps} retrying onRetry={onRetry} />);

    advance(30);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('stops requesting while the device is offline', () => {
    const onRetry = vi.fn();
    render(<FullPageRetry {...baseProps} onRetry={onRetry} />);

    act(() => setOnline(false));

    advance(60);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('retries immediately when the network comes back', () => {
    const onRetry = vi.fn();
    render(<FullPageRetry {...baseProps} onRetry={onRetry} />);

    act(() => setOnline(false));
    advance(3);
    expect(onRetry).not.toHaveBeenCalled();

    act(() => setOnline(true));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
