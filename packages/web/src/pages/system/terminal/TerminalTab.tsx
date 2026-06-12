import { useEffect, useRef, useMemo } from 'react';
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
  });
  initCfgRef.current = {
    theme: currentTheme,
    fontSize: terminal.fontSize,
    fontFamily: terminal.fontFamily,
    lineHeight: terminal.lineHeight,
  };

  // mount / sessionId 变化时：创建或复用 session，然后 attach
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    const setupSession = async () => {
      if (!terminalSessionStore.has(sessionId)) {
        // 异步创建（会检查录屏开关配置）
        await terminalSessionStore.create(sessionId, { shell, cwd, ...initCfgRef.current });
      }
      if (!cancelled) {
        // 复用或新建的 session 都挂载到当前容器
        terminalSessionStore.attach(sessionId, container);
      }
    };
    void setupSession();

    return () => {
      cancelled = true;
      // 组件卸载（分屏关闭 / 分屏布局变化）时 detach，保持 WebSocket 不断线
      terminalSessionStore.detach(sessionId);
    };
    // shell / cwd 仅在创建时使用，变化不重连
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%' }}
    />
  );
}
