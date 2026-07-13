import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Toast } from '@douyinfe/semi-ui';
import { showRequestErrorToast, showRequestWarningToast } from './request-toast';

vi.mock('@douyinfe/semi-ui', () => ({
  Toast: {
    close: vi.fn(),
    error: vi.fn(() => 'error-toast-id'),
    warning: vi.fn(() => 'warning-toast-id'),
  },
}));

describe('request toast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps only one request toast visible', () => {
    showRequestErrorToast('响应解析失败');
    showRequestWarningToast('系统维护中，请稍后重试');

    expect(Toast.error).toHaveBeenCalledTimes(1);
    expect(Toast.warning).toHaveBeenCalledTimes(1);
    expect(Toast.close).toHaveBeenCalledWith('error-toast-id');
  });

  it('deduplicates the same request toast while it is visible', () => {
    showRequestErrorToast('网络请求失败，请检查网络连接');
    showRequestErrorToast('网络请求失败，请检查网络连接');

    expect(Toast.error).toHaveBeenCalledTimes(1);
  });

  it('allows the same toast again after the previous one closes', () => {
    let capturedOnClose: (() => void) | undefined;
    vi.mocked(Toast.error).mockImplementation((opts) => {
      capturedOnClose = (opts as { onClose?: () => void }).onClose;
      return 'error-toast-id';
    });

    showRequestErrorToast('响应解析失败');
    capturedOnClose?.();
    showRequestErrorToast('响应解析失败');

    expect(Toast.error).toHaveBeenCalledTimes(2);
  });
});
