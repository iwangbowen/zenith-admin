import { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import { ChevronUp, ChevronDown, X } from 'lucide-react';
import { useThemeController } from '@/providers/theme-controller';
import { useTerminalPreferences } from './useTerminalPreferences';
import { resolveTheme } from './themes';
import { terminalSessionStore } from './terminalSessionStore';
import '@xterm/xterm/css/xterm.css';

interface TerminalTabProps {
  readonly sessionId: string;
  readonly active: boolean;
  readonly shell: string;
  readonly cwd?: string;
}

export default function TerminalTab({ sessionId, active, shell, cwd }: TerminalTabProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { isDark } = useThemeController();
  const { terminal } = useTerminalPreferences();
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [searchCaseSensitive, setSearchCaseSensitive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const currentTheme = useMemo(
    () => resolveTheme(isDark ? terminal.themeDark : terminal.themeLight, isDark ? 'dark' : 'light'),
    [isDark, terminal.themeDark, terminal.themeLight],
  );

  // 用 ref 持有最新配置，供仅在 mount 时执行的初始化闭包读取
  const initCfgRef = useRef({
    theme: currentTheme,
    fontSize: terminal.fontSize,
    fontFamily: terminal.fontFamily,
    lineHeight: terminal.lineHeight,
    scrollback: terminal.scrollback,
  });
  initCfgRef.current = {
    theme: currentTheme,
    fontSize: terminal.fontSize,
    fontFamily: terminal.fontFamily,
    lineHeight: terminal.lineHeight,
    scrollback: terminal.scrollback,
  };

  // 搜索操作
  const doSearch = useCallback((text: string, direction: 'next' | 'prev') => {
    if (!text) return;
    const opts = { caseSensitive: searchCaseSensitive };
    if (direction === 'next') terminalSessionStore.findNext(sessionId, text, opts);
    else terminalSessionStore.findPrevious(sessionId, text, opts);
  }, [sessionId, searchCaseSensitive]);

  const openSearch = useCallback(() => {
    setSearchVisible(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const closeSearch = useCallback(() => {
    setSearchVisible(false);
    setSearchText('');
    terminalSessionStore.clearSearch(sessionId);
  }, [sessionId]);

  // mount / sessionId 变化时：创建或复用 session，然后 attach
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    const setupSession = async () => {
      if (!terminalSessionStore.has(sessionId)) {
        await terminalSessionStore.create(sessionId, { shell, cwd, ...initCfgRef.current });
      }
      if (!cancelled) {
        terminalSessionStore.attach(sessionId, container);
      }
    };
    void setupSession();

    return () => {
      cancelled = true;
      terminalSessionStore.detach(sessionId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // 使用 xterm 内置钩子拦截 Ctrl+F，避免 ^F 被发送到终端
  const openSearchRef = useRef(openSearch);
  openSearchRef.current = openSearch;
  const closeSearchRef = useRef(closeSearch);
  closeSearchRef.current = closeSearch;
  const searchVisibleRef = useRef(searchVisible);
  searchVisibleRef.current = searchVisible;

  useEffect(() => {
    terminalSessionStore.attachCustomKeyEventHandler(sessionId, (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        openSearchRef.current();
        return false; // xterm 不再处理此键
      }
      if (e.key === 'Escape' && searchVisibleRef.current) {
        closeSearchRef.current();
        return false;
      }
      return true;
    });
    return () => {
      // 组件卸载时移除拦截器
      terminalSessionStore.attachCustomKeyEventHandler(sessionId, () => true);
    };
  }, [sessionId]);

  // tab 切换激活时重新 fit
  useEffect(() => {
    if (active) {
      terminalSessionStore.refit(sessionId);
    }
  }, [active, sessionId]);

  // 主题 / 字体 / 字号 / 行高变化时更新（不重建连接）
  useEffect(() => {
    terminalSessionStore.updateOptions(sessionId, {
      theme: currentTheme,
      fontSize: terminal.fontSize,
      fontFamily: terminal.fontFamily,
      lineHeight: terminal.lineHeight,
    });
  }, [currentTheme, terminal.fontSize, terminal.fontFamily, terminal.lineHeight, sessionId]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', display: 'flex', flexDirection: 'column' }}>
      {/* 搜索栏（Ctrl+F 唤出，Escape 关闭） */}
      {searchVisible && (
        <div style={{
          position: 'absolute', top: 4, right: 4, zIndex: 20,
          display: 'flex', alignItems: 'center', gap: 4,
          background: 'var(--semi-color-bg-2)',
          border: '1px solid var(--semi-color-border)',
          borderRadius: 6, padding: '3px 6px',
          boxShadow: 'var(--semi-shadow-elevated)',
        }}>
          <input
            ref={inputRef}
            value={searchText}
            onChange={(e) => {
              setSearchText(e.target.value);
              if (e.target.value) terminalSessionStore.findNext(sessionId, e.target.value, { caseSensitive: searchCaseSensitive });
              else terminalSessionStore.clearSearch(sessionId);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); doSearch(searchText, e.shiftKey ? 'prev' : 'next'); }
              if (e.key === 'Escape') closeSearch();
            }}
            placeholder="搜索终端..."
            style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 13, width: 180, color: 'var(--semi-color-text-0)' }}
          />
          <button
            type="button"
            title={`大小写${searchCaseSensitive ? '敏感' : '不敏感'}`}
            onClick={() => setSearchCaseSensitive((v) => !v)}
            style={{ border: 'none', background: searchCaseSensitive ? 'var(--semi-color-primary-light-default)' : 'none', borderRadius: 3, padding: '1px 4px', cursor: 'pointer', fontSize: 11, fontWeight: 700, color: searchCaseSensitive ? 'var(--semi-color-primary)' : 'var(--semi-color-text-2)' }}
          >Aa</button>
          <button type="button" title="上一个（Shift+Enter）" onClick={() => doSearch(searchText, 'prev')} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 2, display: 'flex', color: 'var(--semi-color-text-1)' }}><ChevronUp size={14} /></button>
          <button type="button" title="下一个（Enter）" onClick={() => doSearch(searchText, 'next')} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 2, display: 'flex', color: 'var(--semi-color-text-1)' }}><ChevronDown size={14} /></button>
          <button type="button" title="关闭（Esc）" onClick={closeSearch} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 2, display: 'flex', color: 'var(--semi-color-text-2)' }}><X size={14} /></button>
        </div>
      )}
      <div ref={containerRef} style={{ flex: 1, minHeight: 0 }} />
    </div>
  );
}
