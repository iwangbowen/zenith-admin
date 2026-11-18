/**
 * 剪贴板工具契约测试。
 *
 * 内网以 http://ip 访问时不是安全上下文，navigator.clipboard 为 undefined；
 * 只验证读取能力与拒绝访问的结果，不执行复制回退或 DOM 操作。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@douyinfe/semi-ui', () => ({ Toast: toastMock }));

import { canWriteClipboardItems, readClipboardText } from './clipboard';

const originalClipboard = Object.getOwnPropertyDescriptor(Navigator.prototype, 'clipboard')
  ?? Object.getOwnPropertyDescriptor(navigator, 'clipboard');

function setClipboard(value: Partial<Clipboard> | undefined) {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
}

afterEach(() => {
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else Reflect.deleteProperty(navigator, 'clipboard');
});

describe('readClipboardText / canWriteClipboardItems', () => {
  it('非安全上下文读取返回 null、富内容写入不可用', async () => {
    setClipboard(undefined);
    await expect(readClipboardText()).resolves.toBeNull();
    expect(canWriteClipboardItems()).toBe(false);
  });

  it('读取被拒绝时返回 null，可用时返回文本', async () => {
    setClipboard({ readText: vi.fn().mockRejectedValue(new Error('denied')) });
    await expect(readClipboardText()).resolves.toBeNull();
    setClipboard({ readText: vi.fn().mockResolvedValue('pasted') });
    await expect(readClipboardText()).resolves.toBe('pasted');
  });
});
