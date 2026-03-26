import { useState, useCallback, useRef, useEffect } from 'react';

export interface TabItem {
  key: string;
  title: string;
  closable: boolean;
}

const HOME_TAB: TabItem = { key: '/', title: '首页', closable: false };

export function useTabsStore(maxCount: number = 20) {
  const [tabs, setTabs] = useState<TabItem[]>([HOME_TAB]);
  const [activeKey, setActiveKey] = useState('/');

  // 我们使用一个 ref 来在回调中获取最新的状态，以决定要返回的 nextActive
  const stateRef = useRef({ tabs, activeKey });
  useEffect(() => {
    stateRef.current = { tabs, activeKey };
  }, [tabs, activeKey]);

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
    const nextTabs = stateRef.current.tabs.filter((t) => !t.closable || t.key === key);
    setTabs(nextTabs);
    setActiveKey(key);
    return key;
  }, []);

  const closeLeft = useCallback((key: string) => {
    const { tabs: currentTabs, activeKey: currentActive } = stateRef.current;
    const idx = currentTabs.findIndex((t) => t.key === key);
    if (idx < 0) return currentActive;
    const nextTabs = currentTabs.filter((t, i) => !t.closable || i >= idx);
    const nextActive = nextTabs.some((t) => t.key === currentActive) ? currentActive : key;
    setTabs(nextTabs);
    setActiveKey(nextActive);
    return nextActive;
  }, []);

  const closeRight = useCallback((key: string) => {
    const { tabs: currentTabs, activeKey: currentActive } = stateRef.current;
    const idx = currentTabs.findIndex((t) => t.key === key);
    if (idx < 0) return currentActive;
    const nextTabs = currentTabs.filter((t, i) => !t.closable || i <= idx);
    const nextActive = nextTabs.some((t) => t.key === currentActive) ? currentActive : key;
    setTabs(nextTabs);
    setActiveKey(nextActive);
    return nextActive;
  }, []);

  const closeAll = useCallback(() => {
    setTabs([HOME_TAB]);
    setActiveKey('/');
  }, []);

  return { tabs, activeKey, setActiveKey, addTab, removeTab, closeOthers, closeLeft, closeRight, closeAll };
}
