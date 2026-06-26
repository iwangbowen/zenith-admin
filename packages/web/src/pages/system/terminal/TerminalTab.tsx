import { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import { Dropdown, Toast } from '@douyinfe/semi-ui';
import {
  ChevronUp,
  ChevronDown,
  X,
  Copy,
  Clipboard,
  Eraser,
  Search,
  CheckSquare,
  FolderOpen,
  SquareTerminal,
  Folder,
  Radio,
  Video,
  Monitor,
} from 'lucide-react';
import { useThemeController } from '@/providers/theme-controller';
import { useTerminalPreferences } from './useTerminalPreferences';
import { resolveTheme } from './themes';
import { terminalSessionStore, type TerminalStatusSnapshot } from './terminalSessionStore';
import '@xterm/xterm/css/xterm.css';

interface TerminalTabProps {
  readonly sessionId: string;
  readonly active: boolean;
  readonly shell: string;
  readonly label?: string;
  readonly cwd?: string;
  /** CWD 变化时回调（OSC 7），用于更新 Tab 标题 */
  readonly onTitleChange?: (newTitle: string) => void;
  /** 在当前目录打开新终端（仅本地终端使用） */
  readonly onOpenTerminalAt?: (cwd: string) => void;
}

export default function TerminalTab({ sessionId, active, shell, label, cwd, onTitleChange, onOpenTerminalAt }: TerminalTabProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const { isDark } = useThemeController();
  const { terminal } = useTerminalPreferences();
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [searchCaseSensitive, setSearchCaseSensitive] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [status, setStatus] = useState<TerminalStatusSnapshot | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [compactStatus, setCompactStatus] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const contextCwd = contextMenu ? (terminalSessionStore.getCwd(sessionId) ?? cwd) : undefined;
  const canOpenLocalTerminalAt = !!contextCwd && !shell.startsWith('ssh:') && !shell.startsWith('docker-exec:');
  const showStatusBar = terminal.showStatusBar ?? true;

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
    cursorStyle: terminal.cursorStyle,
    cursorBlink: terminal.cursorBlink,
    copyOnSelect: terminal.copyOnSelect,
    rendererType: terminal.rendererType,
    fastScrollSensitivity: terminal.fastScrollSensitivity,
    letterSpacing: terminal.letterSpacing,
    fontWeight: terminal.fontWeight,
    rightClickSelectsWord: terminal.rightClickSelectsWord,
    minimumContrastRatio: terminal.minimumContrastRatio,
  });
  initCfgRef.current = {
    theme: currentTheme,
    fontSize: terminal.fontSize,
    fontFamily: terminal.fontFamily,
    lineHeight: terminal.lineHeight,
    scrollback: terminal.scrollback,
    cursorStyle: terminal.cursorStyle,
    cursorBlink: terminal.cursorBlink,
    copyOnSelect: terminal.copyOnSelect,
    rendererType: terminal.rendererType,
    fastScrollSensitivity: terminal.fastScrollSensitivity,
    letterSpacing: terminal.letterSpacing,
    fontWeight: terminal.fontWeight,
    rightClickSelectsWord: terminal.rightClickSelectsWord,
    minimumContrastRatio: terminal.minimumContrastRatio,
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

  const copySelection = useCallback(async () => {
    try {
      const copied = await terminalSessionStore.copySelection(sessionId);
      if (copied) Toast.success('已复制');
      else Toast.warning('请先选中文本');
    } catch {
      Toast.error('复制失败，请检查浏览器剪贴板权限');
    } finally {
      setContextMenu(null);
    }
  }, [sessionId]);

  const pasteFromClipboard = useCallback(async () => {
    try {
      const pasted = await terminalSessionStore.pasteFromClipboard(sessionId);
      if (!pasted) Toast.warning('剪贴板为空');
    } catch {
      Toast.error('粘贴失败，请检查浏览器剪贴板权限');
    } finally {
      setContextMenu(null);
    }
  }, [sessionId]);

  const selectAll = useCallback(() => {
    terminalSessionStore.selectAll(sessionId);
    setContextMenu(null);
  }, [sessionId]);

  const clearTerminal = useCallback(() => {
    terminalSessionStore.clear(sessionId);
    setContextMenu(null);
  }, [sessionId]);

  const openSearchFromMenu = useCallback(() => {
    openSearch();
    setContextMenu(null);
  }, [openSearch]);

  const copyCurrentPath = useCallback(async () => {
    const path = terminalSessionStore.getCwd(sessionId) ?? cwd;
    if (!path) {
      Toast.warning('当前终端尚未上报路径');
      setContextMenu(null);
      return;
    }
    try {
      await navigator.clipboard.writeText(path);
      Toast.success('已复制当前路径');
    } catch {
      Toast.error('复制失败，请检查浏览器剪贴板权限');
    } finally {
      setContextMenu(null);
    }
  }, [cwd, sessionId]);

  const openLocalTerminalAtCurrentPath = useCallback(() => {
    const path = terminalSessionStore.getCwd(sessionId) ?? cwd;
    if (!path || !onOpenTerminalAt) return;
    onOpenTerminalAt(path);
    setContextMenu(null);
  }, [cwd, onOpenTerminalAt, sessionId]);

  // refs 用于在闭包中访问最新的回调/状态（避免 stale closure）
  const openSearchRef = useRef(openSearch);
  openSearchRef.current = openSearch;
  const closeSearchRef = useRef(closeSearch);
  closeSearchRef.current = closeSearch;
  const searchVisibleRef = useRef(searchVisible);
  searchVisibleRef.current = searchVisible;

  // mount / sessionId 变化时：创建或复用 session → attach → 注册 Ctrl+F 拦截器
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
        // 拦截器必须在 session 创建后才能注册
        terminalSessionStore.attachCustomKeyEventHandler(sessionId, (e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
            e.preventDefault(); // 阻止浏览器原生 Ctrl+F
            openSearchRef.current();
            return false;
          }
          if (e.key === 'Escape' && searchVisibleRef.current) {
            closeSearchRef.current();
            return false;
          }
          return true;
        });
      }
    };
    void setupSession();

    return () => {
      cancelled = true;
      terminalSessionStore.attachCustomKeyEventHandler(sessionId, () => true);
      terminalSessionStore.detach(sessionId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // OSC 7：CWD 变化 → 更新 Tab 标题
  useEffect(() => {
    if (!onTitleChange) return;
    const baseLabel = shell || 'bash';
    const handler = (cwd: string) => {
      const dir = cwd.split(/[\\/]/).findLast(Boolean) ?? cwd;
      onTitleChange(`${baseLabel}: ${dir}`);
    };
    terminalSessionStore.onCwdChange(sessionId, handler);
    return () => terminalSessionStore.offCwdChange(sessionId);
  }, [sessionId, shell, onTitleChange]);

  // tab 切换激活时重新 fit

  useEffect(() => {
    if (active) {
      terminalSessionStore.refit(sessionId);
    }
  }, [active, sessionId]);

  useEffect(() => terminalSessionStore.subscribeStatus(sessionId, setStatus), [sessionId]);

  useEffect(() => {
    if (!showStatusBar || status?.connectionState !== 'reconnecting' || !status.reconnectNextAt) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [showStatusBar, status?.connectionState, status?.reconnectNextAt]);

  useEffect(() => {
    if (!showStatusBar) return;
    const root = rootRef.current;
    if (!root) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setCompactStatus(width < 520 || height < 180);
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, [showStatusBar]);

  useEffect(() => {
    terminalSessionStore.refit(sessionId);
  }, [sessionId, showStatusBar, compactStatus]);

  // 主题 / 字体 / 字号 / 行高 / 光标 / 滚动 变化时更新（不重建连接）
  useEffect(() => {
    terminalSessionStore.updateOptions(sessionId, {
      theme: currentTheme,
      fontSize: terminal.fontSize,
      fontFamily: terminal.fontFamily,
      lineHeight: terminal.lineHeight,
      cursorStyle: terminal.cursorStyle,
      cursorBlink: terminal.cursorBlink,
      copyOnSelect: terminal.copyOnSelect,
      fastScrollSensitivity: terminal.fastScrollSensitivity,
      letterSpacing: terminal.letterSpacing,
      fontWeight: terminal.fontWeight,
      rightClickSelectsWord: terminal.rightClickSelectsWord,
      minimumContrastRatio: terminal.minimumContrastRatio,
    });
  }, [
    currentTheme,
    terminal.fontSize, terminal.fontFamily, terminal.lineHeight,
    terminal.cursorStyle, terminal.cursorBlink, terminal.copyOnSelect, terminal.fastScrollSensitivity,
    terminal.letterSpacing, terminal.fontWeight,
    terminal.rightClickSelectsWord, terminal.minimumContrastRatio,
    sessionId,
  ]);

  const statusCwd = status?.cwd ?? cwd;
  const shellLabel = label || status?.shell || shell || 'shell';
  const reconnectSeconds = status?.reconnectNextAt
    ? Math.max(0, Math.ceil((status.reconnectNextAt - now) / 1000))
    : 0;
  const connectionText: Record<NonNullable<TerminalStatusSnapshot['connectionState']>, string> = {
    connecting: '连接中',
    connected: '已连接',
    reconnecting: reconnectSeconds > 0
      ? `${reconnectSeconds}s 后重连 ${status?.reconnectAttempts ?? 0}/${status?.reconnectMaxAttempts ?? 0}`
      : `重连中 ${status?.reconnectAttempts ?? 0}/${status?.reconnectMaxAttempts ?? 0}`,
    disconnected: status?.message ?? '已断开',
    exited: status?.message ?? '已退出',
    error: status?.message ?? '连接异常',
  };

  return (
    <div
      ref={rootRef}
      className="terminal-tab-root"
      data-compact-status={compactStatus ? 'true' : 'false'}
      onContextMenu={(e) => {
        e.preventDefault();
        terminalSessionStore.focus(sessionId);
        setContextMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      {contextMenu && (
        <Dropdown
          trigger="click"
          visible
          clickToHide
          position="bottomLeft"
          onVisibleChange={(v) => { if (!v) setContextMenu(null); }}
          render={(
            <Dropdown.Menu>
              <Dropdown.Item icon={<Copy size={14} />} onClick={() => void copySelection()}>
                复制
              </Dropdown.Item>
              <Dropdown.Item icon={<Clipboard size={14} />} onClick={() => void pasteFromClipboard()}>
                粘贴
              </Dropdown.Item>
              <Dropdown.Item icon={<CheckSquare size={14} />} onClick={selectAll}>
                全选
              </Dropdown.Item>
              <Dropdown.Divider />
              <Dropdown.Item icon={<Search size={14} />} onClick={openSearchFromMenu}>
                搜索
              </Dropdown.Item>
              {searchVisible && (
                <Dropdown.Item icon={<X size={14} />} onClick={closeSearch}>
                  关闭搜索
                </Dropdown.Item>
              )}
              <Dropdown.Divider />
              <Dropdown.Item icon={<FolderOpen size={14} />} disabled={!contextCwd} onClick={() => void copyCurrentPath()}>
                复制当前路径
              </Dropdown.Item>
              <Dropdown.Item
                icon={<SquareTerminal size={14} />}
                disabled={!canOpenLocalTerminalAt || !onOpenTerminalAt}
                onClick={openLocalTerminalAtCurrentPath}
              >
                在当前目录新建终端
              </Dropdown.Item>
              <Dropdown.Divider />
              <Dropdown.Item icon={<Eraser size={14} />} onClick={clearTerminal}>
                清屏
              </Dropdown.Item>
            </Dropdown.Menu>
          )}
        >
          <span style={{ position: 'fixed', left: contextMenu.x, top: contextMenu.y, width: 1, height: 1 }} />
        </Dropdown>
      )}
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
      <div ref={containerRef} className="terminal-tab-body" />
      {showStatusBar && (
        <div className="terminal-status-bar" data-state={status?.connectionState ?? 'connecting'}>
          <span className="terminal-status-bar__item">
            <span className="terminal-status-bar__dot" data-state={status?.connectionState ?? 'connecting'} />
            <span className="terminal-status-bar__text">{connectionText[status?.connectionState ?? 'connecting']}</span>
          </span>
          <span className="terminal-status-bar__item terminal-status-bar__item--shell" title={shellLabel}>
            <Radio size={12} className="terminal-status-bar__icon" />
            <span className="terminal-status-bar__text">{shellLabel}</span>
          </span>
          <span className="terminal-status-bar__item terminal-status-bar__item--path" title={statusCwd || '未获取当前路径'}>
            <Folder size={12} className="terminal-status-bar__icon" />
            <span className="terminal-status-bar__text">{statusCwd || '未获取当前路径'}</span>
          </span>
          <span className="terminal-status-bar__item" title="终端尺寸">
            <Monitor size={12} className="terminal-status-bar__icon" />
            <span className="terminal-status-bar__text">{status?.cols ?? 0}×{status?.rows ?? 0}</span>
          </span>
          <span
            className="terminal-status-bar__item terminal-status-bar__item--recording"
            title={status?.recordingEnabled ? (status.recordingActive ? '录屏中' : '录屏已启用') : '录屏未启用'}
          >
            <Video size={12} className="terminal-status-bar__icon" />
            <span className="terminal-status-bar__text">
              {status?.recordingEnabled ? (status.recordingActive ? '录屏中' : '录屏') : '未录屏'}
            </span>
          </span>
        </div>
      )}
    </div>
  );
}
