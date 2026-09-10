// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { mountIslands } from './mount';

function dom(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
}

describe('mountIslands', () => {
  it('按 data-island 名称挂载已注册的岛，并把容器交给挂载函数', () => {
    const root = dom('<div data-island="a" data-x="1"></div><p data-island="b"></p>');
    const a = vi.fn();
    const b = vi.fn();
    expect(mountIslands(root, { a, b })).toBe(2);
    expect(a).toHaveBeenCalledTimes(1);
    expect((a.mock.calls[0][0] as HTMLElement).dataset.x).toBe('1');
    expect((b.mock.calls[0][0] as HTMLElement).tagName).toBe('P');
  });

  it('同一容器只挂载一次；未注册的岛名静默跳过', () => {
    const root = dom('<div data-island="a"></div><div data-island="unknown"></div>');
    const a = vi.fn();
    expect(mountIslands(root, { a })).toBe(1);
    expect(mountIslands(root, { a })).toBe(0);
    expect(a).toHaveBeenCalledTimes(1);
  });

  it('单个岛抛错不影响其他岛', () => {
    const root = dom('<div data-island="bad"></div><div data-island="good"></div>');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const good = vi.fn();
    expect(mountIslands(root, { bad: () => { throw new Error('boom'); }, good })).toBe(1);
    expect(good).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});
