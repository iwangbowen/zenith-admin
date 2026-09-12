import { createContext } from 'react';

/**
 * 当前控件所在的工具栏槽位。`SearchToolbar` 在移动端「更多操作」菜单内提供 `'mobile-actions'`：
 * 容器 CSS 已把菜单里的按钮平铺、撑满一行，需要按槽位改变结构的控件（如 `ExportButton` 在菜单内展开为逐格式按钮）
 * 据此自适应，页面不必再为移动端另传一份 `mobileActions`。
 */
export const ToolbarSlotContext = createContext<'mobile-actions' | null>(null);
