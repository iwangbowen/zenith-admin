/**
 * 剪贴板工具契约测试。
 *
 * 内网以 http://ip 访问时不是安全上下文，navigator.clipboard 为 undefined；
 * 保留剪贴板兼容、复制内容和失败回退，Toast 文案不在本组固定。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@douyinfe/semi-ui', () => ({ Toast: toastMock }));

import { canWriteClipboardItems, copyText, readClipboardText } from './clipboard';

const originalClipboard = Object.getOwnPropertyDescriptor(Navigator.prototype, 'clipboard')
  ?? Object.getOwnPropertyDescriptor(navigator, 'clipboard');

function setClipboard(value: Partial<Clipboard> | undefined) {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
}

beforeEach(() => {
  toastMock.success.mockClear();
  toastMock.error.mockClear();
  document.execCommand = vi.fn(() => true);
});

afterEach(() => {
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else Reflect.deleteProperty(navigator, 'clipboard');
});

describe('copyText', () => {
  it('安全上下文优先 Clipboard API，不触发 execCommand', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    await expect(copyText('hello')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
    expect(document.execCommand).not.toHaveBeenCalled();
  });

  it('非安全上下文（navigator.clipboard 不存在）回退 execCommand 且不残留 textarea', async () => {
    setClipboard(undefined);
    await expect(copyText('内网复制')).resolves.toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith('copy');
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('Clipboard API 被拒绝时回退 execCommand', async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError')) });
    await expect(copyText('x')).resolves.toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith('copy');
  });

  it('回退路径也失败时返回 false 而不抛错', async () => {
    setClipboard(undefined);
    document.execCommand = vi.fn(() => false);
    await expect(copyText('x')).resolves.toBe(false);
  });

  it('回退路径复制后把焦点还给原活动元素', async () => {
    setClipboard(undefined);
    const button = document.createElement('button');
    document.body.appendChild(button);
    button.focus();
    await copyText('x');
    expect(document.activeElement).toBe(button);
    button.remove();
  });

  it('回退路径不破坏用户原有的页面选区', async () => {
    setClipboard(undefined);
    const p = document.createElement('p');
    p.textContent = '先选中这段文字再点复制';
    document.body.appendChild(p);
    const range = document.createRange();
    range.selectNodeContents(p);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    await copyText('别的内容');
    expect(selection.toString()).toBe('先选中这段文字再点复制');
    p.remove();
  });
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
