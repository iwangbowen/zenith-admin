import { createContext, useContext, useEffect } from 'react';
import { useLocation } from 'react-router-dom';

export interface TabsMetaContextValue {
  /** 多页签是否启用 */
  enabled: boolean;
  /** 动态设置某个标签页的标题/图标 */
  setTabMeta: (key: string, meta: { title?: string; icon?: string }) => void;
}

export const TabsMetaContext = createContext<TabsMetaContextValue | null>(null);

/**
 * 在整页路由（非菜单页面，如工作流业务表单整页）中动态设置当前多页签的标题/图标。
 * 页面加载到数据后调用，会写入当前 location.pathname 对应的标签页（覆盖 pathname 兜底标题、补充图标）。
 */
export function useTabMeta(meta: { title?: string | null; icon?: string | null }) {
  const ctx = useContext(TabsMetaContext);
  const location = useLocation();
  const title = meta.title ?? undefined;
  const icon = meta.icon ?? undefined;
  useEffect(() => {
    if (!ctx?.enabled) return;
    if (!title && !icon) return;
    ctx.setTabMeta(location.pathname, { title, icon });
  }, [ctx, location.pathname, title, icon]);
}
