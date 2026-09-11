import { within } from '@testing-library/react';

/**
 * `ListSearchToolbar` / `SearchToolbar` 会同时渲染桌面与移动两套控件（由 CSS 决定显示哪一套），
 * 所以 `screen.getByPlaceholderText('搜索…')` / `getByText('查询')` 在 jsdom 下会命中两个元素。
 * 页面测试统一在桌面工具栏内查找：`const toolbar = desktopToolbar(container); toolbar.getByText('查询')`。
 */
export function desktopToolbar(container: HTMLElement) {
  const desktop = container.querySelector<HTMLElement>('.responsive-toolbar__desktop');
  if (!desktop) throw new Error('未找到桌面工具栏（.responsive-toolbar__desktop）——页面是否渲染了 SearchToolbar？');
  return within(desktop);
}
