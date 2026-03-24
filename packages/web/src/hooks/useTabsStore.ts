import { useState, useCallback } from 'react';

export interface TabItem {
  key: string;
  title: string;
  closable: boolean;
}

const HOME_TAB: TabItem = { key: '/', title: '首页', closable: false };

export function useTabsStore(maxCount: number = 20) {
  const [tabs, setTabs] = useState<TabItem[]>([HOME_TAB]);
  const [activeKey, setActiveKey] = useState('/');

  const addTab = useCallback((key: string, title: string) => {
    setTabs((prev) => {
      if (prev.some((t) => t.key === key)) return prev;
      const next = [...prev, { key, title, closable: true }];
      // Evict oldest closable tab if exceeding max
      if (next.length > maxCount) {
        const idx = next.findIndex((t) => t.closable);
        if (idx >= 0) next.splice(idx, 1);
      }
      return next;
    });
    setActiveKey(key);
  }, [maxCount]);

  const removeTab = useCallback((key: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.key === key);
      if (idx < 0 || !prev[idx].closable) return prev;
      return prev.filter((t) => t.key !== key);
    });
    setActiveKey((prevActive) => {
      if (prevActive !== key) return prevActive;
      const idx = tabs.findIndex((t) => t.key === key);
      if (idx > 0) return tabs[idx - 1].key;
      if (tabs.length > 1) return tabs[1].key;
      return '/';
    });
  }, [tabs]);

  const closeOthers = useCallback((key: string) => {
    setTabs((prev) => prev.filter((t) => !t.closable || t.key === key));
    setActiveKey(key);
  }, []);

  const closeAll = useCallback(() => {
    setTabs([HOME_TAB]);
    setActiveKey('/');
  }, []);

  return { tabs, activeKey, setActiveKey, addTab, removeTab, closeOthers, closeAll };
}
