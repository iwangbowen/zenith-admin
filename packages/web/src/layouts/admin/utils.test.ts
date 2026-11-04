/**
 * computeTabClosableFlags 单元测试
 *
 * 这是页签右键菜单「关闭左侧 / 右侧 / 其他 / 全部」的禁用判据，
 * O(n) 前缀扫描实现（对照基准为 O(n²) slice/some），需保证结果完全一致。
 */
import { describe, it, expect } from 'vitest';
import { computeTabClosableFlags } from './utils';

type T = { key: string; closable: boolean };

/** 原始 O(n²) 实现，作为对照基准 */
function reference(tabs: T[]) {
  return tabs.map((tab, i) => ({
    hasClosableLeft: i > 0 && tabs.slice(0, i).some((t) => t.closable),
    hasClosableRight: tabs.slice(i + 1).some((t) => t.closable),
    hasClosableOthers: tabs.some((t) => t.closable && t.key !== tab.key),
    hasAnyClosable: tabs.some((t) => t.closable),
  }));
}

describe('computeTabClosableFlags', () => {
  it('典型场景：首页不可关闭 + 若干可关闭页签', () => {
    const tabs: T[] = [
      { key: '/', closable: false },
      { key: '/a', closable: true },
      { key: '/b', closable: true },
    ];
    expect(computeTabClosableFlags(tabs)).toEqual([
      { hasClosableLeft: false, hasClosableRight: true, hasClosableOthers: true, hasAnyClosable: true },
      { hasClosableLeft: false, hasClosableRight: true, hasClosableOthers: true, hasAnyClosable: true },
      { hasClosableLeft: true, hasClosableRight: false, hasClosableOthers: true, hasAnyClosable: true },
    ]);
  });

  it('仅有一个不可关闭页签时全部为 false', () => {
    const tabs: T[] = [{ key: '/', closable: false }];
    expect(computeTabClosableFlags(tabs)).toEqual([
      { hasClosableLeft: false, hasClosableRight: false, hasClosableOthers: false, hasAnyClosable: false },
    ]);
  });

  it('唯一可关闭页签：自身可关但无「其他」', () => {
    const tabs: T[] = [{ key: '/a', closable: true }];
    expect(computeTabClosableFlags(tabs)).toEqual([
      { hasClosableLeft: false, hasClosableRight: false, hasClosableOthers: false, hasAnyClosable: true },
    ]);
  });

  it('空列表返回空数组', () => {
    expect(computeTabClosableFlags([])).toEqual([]);
  });

  it('与原始 O(n²) 实现在各种固定/混排组合下结果一致', () => {
    const shapes: boolean[][] = [
      [false],
      [true],
      [false, true],
      [true, false],
      [false, false, false],
      [true, true, true],
      [false, true, false, true],
      [false, false, true, true, false],
      [true, false, false, true, true, false, true],
    ];
    for (const shape of shapes) {
      const tabs: T[] = shape.map((closable, i) => ({ key: `/t${i}`, closable }));
      expect(computeTabClosableFlags(tabs)).toEqual(reference(tabs));
    }
  });
});
