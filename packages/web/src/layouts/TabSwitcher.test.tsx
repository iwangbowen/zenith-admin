/**
 * TabSwitcher 单元测试（Chrome 风格：副标题 / 最近关闭 / 快捷键）
 *
 * 覆盖点：
 * 1. 打开面板显示「打开的标签页」分组，行副标题含路径与相对时间
 * 2. 「最近关闭的标签页」默认折叠，展开后点击重开回调
 * 3. Ctrl+Shift+A 开合面板
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TabSwitcher, type RecentlyClosedTab } from './TabSwitcher';
import type { TabItem } from '@/hooks/useTabsStore';

/**
 * 副标题里的相对时间（「30 秒前」/「1 分钟前」）与真实时钟耦合，而这些时间戳在模块求值时就算好了：
 * 整套测试满载时（本文件从 import 到执行可拉开几十秒）「30 秒前」会漂成「1 分钟前」而偶发失败。
 * 只伪造 `Date`（保留真实定时器，`setTimeout` 聚焦与 React 调度照常），把系统时间钉在基准时刻。
 */
const BASE_TIME = new Date('2026-09-26 12:00:00').getTime();

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
  vi.setSystemTime(BASE_TIME);
  // jsdom 未实现 scrollIntoView（组件内高亮项滚动用）
  Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', { value: vi.fn(), configurable: true });
});

afterAll(() => {
  vi.useRealTimers();
});

const tabs: TabItem[] = [
  { key: '/', title: '首页', closable: false, lastUsedAt: BASE_TIME - 5_000 },
  { key: '/system/users', title: '用户管理', closable: true, lastUsedAt: BASE_TIME - 65_000 },
];

const closed: RecentlyClosedTab[] = [
  { key: '/cms/contents', title: '内容管理', closedAt: BASE_TIME - 30_000 },
];

function renderSwitcher(override: Partial<Parameters<typeof TabSwitcher>[0]> = {}) {
  const props = {
    tabs,
    activeKey: '/system/users',
    onNavigate: vi.fn(),
    onClose: vi.fn(),
    onReopen: vi.fn(),
    recentlyClosed: closed,
    ...override,
  };
  const result = render(<TabSwitcher {...props} />);
  return { ...result, props };
}

function openPanel() {
  fireEvent.click(screen.getByRole('button', { name: '所有标签页' }));
}

describe('TabSwitcher', () => {
  it('打开面板显示分组与副标题（路径 • 相对时间）', () => {
    renderSwitcher();
    openPanel();
    expect(screen.getByText('打开的标签页')).toBeTruthy();
    expect(screen.getByText('用户管理')).toBeTruthy();
    // 副标题：路径 + 相对时间（65 秒前 → 1 分钟前）
    expect(screen.getByText('/system/users • 1 分钟前')).toBeTruthy();
  });

  it('最近关闭默认折叠，展开后点击触发重开', () => {
    const { props } = renderSwitcher();
    openPanel();
    expect(screen.getByText('最近关闭的标签页')).toBeTruthy();
    expect(screen.queryByText('内容管理')).toBeNull();
    fireEvent.click(screen.getByText('最近关闭的标签页'));
    const row = screen.getByText('内容管理');
    expect(row).toBeTruthy();
    expect(screen.getByText('/cms/contents • 30 秒前')).toBeTruthy();
    fireEvent.click(row);
    expect(props.onReopen).toHaveBeenCalledWith('/cms/contents');
  });

  it('无最近关闭时不渲染该分组', () => {
    renderSwitcher({ recentlyClosed: [], onReopen: undefined });
    openPanel();
    expect(screen.queryByText('最近关闭的标签页')).toBeNull();
  });

  it('Ctrl+Shift+A 开合面板', () => {
    renderSwitcher();
    expect(screen.queryByPlaceholderText('搜索标签页')).toBeNull();
    fireEvent.keyDown(window, { key: 'A', ctrlKey: true, shiftKey: true });
    expect(screen.getByPlaceholderText('搜索标签页')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'A', ctrlKey: true, shiftKey: true });
    // 再次触发后收起：用分组标题是否还在判断
    expect(screen.queryByText('打开的标签页')).toBeNull();
  });
});
