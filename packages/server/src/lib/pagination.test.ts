/**
 * RQB 分页 offset 换算单测（全局复用）。
 */
import { describe, it, expect } from 'vitest';
import { pageOffset } from './pagination';

describe('pageOffset', () => {
  it('第 1 页 offset 为 0', () => {
    expect(pageOffset(1, 10)).toBe(0);
  });

  it('第 3 页 × 20 条 → offset 40', () => {
    expect(pageOffset(3, 20)).toBe(40);
  });

  it('pageSize=1 时 offset = page - 1', () => {
    expect(pageOffset(5, 1)).toBe(4);
  });
});
