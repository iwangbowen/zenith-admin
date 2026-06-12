/**
 * 终端 Session 存储
 *
 * 将 xterm.js 实例与 WebSocket 连接的生命周期从 React 组件树中解耦：
 * - 组件 mount → attach（将已有 session 的 DOM 移入 React 容器）
 * - 组件 unmount → detach（将 DOM 移回隐藏根，保持 WebSocket 不断线）
 * - 明确关闭面板 → markForDestruction → detach 时销毁
 *
 * 这样，分屏/合并时 TerminalTab 组件虽然重新挂载，
 * 但底层 xterm + WebSocket 实例依然存活，用户不会断线。
 */

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { TOKEN_KEY } from '@zenith/shared';
import { config } from '@/config';
import { request } from '@/utils/request';
import { type TerminalThemeDef, toXtermTheme } from './themes';

export interface SessionCreateOptions {
  shell: string;
  cwd?: string;
  theme: TerminalThemeDef;
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
}

interface SessionState {
  term: Terminal;
  fitAddon: FitAddon;
  ws: WebSocket;
  shell: string;
  container: HTMLDivElement;
  resizeObserver: ResizeObserver | null;
  recording: {
    startTime: number;
    events: [number, 'o' | 'i', string][];
    cols: number;
    rows: number;
  } | null;
}

function buildWsUrl(shell: string, cwd?: string): string {
  const token = localStorage.getItem(TOKEN_KEY) ?? '';
  let wsBase = config.wsBaseUrl;
  if (!wsBase) {
    const base = config.apiBaseUrl || location.origin;
    wsBase = base.replace(/^http/, 'ws');
  }
  const cwdPart = cwd ? `&cwd=${encodeURIComponent(cwd)}` : '';
  return `${wsBase}/api/ws/terminal?token=${encodeURIComponent(token)}&shell=${encodeURIComponent(shell)}${cwdPart}`;
}

class TerminalSessionStore {
  private readonly sessions = new Map<string, SessionState>();
  private readonly pendingDestroy = new Set<string>();
  private hiddenRoot: HTMLDivElement | null = null;

  private getHiddenRoot(): HTMLDivElement {
    if (!this.hiddenRoot) {
      this.hiddenRoot = document.createElement('div');
      this.hiddenRoot.style.cssText =
        'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;overflow:hidden;visibility:hidden;pointer-events:none;';
      document.body.appendChild(this.hiddenRoot);
    }
    return this.hiddenRoot;
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /** 创建新 session（xterm + WebSocket），初始挂载到隐藏根 */
  create(sessionId: string, options: SessionCreateOptions): void {
    if (this.sessions.has(sessionId)) return;

    const container = document.createElement('div');
    container.style.cssText = 'width:100%;height:100%;';
    this.getHiddenRoot().appendChild(container);

    const term = new Terminal({
      theme: toXtermTheme(options.theme),
      fontFamily: options.fontFamily,
      fontSize: options.fontSize,
      lineHeight: options.lineHeight,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 5000,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(container);

    const ws = new WebSocket(buildWsUrl(options.shell, options.cwd));
    const { shell } = options;

    const session: SessionState = {
      term,
      fitAddon,
      ws,
      shell,
      container,
      resizeObserver: null,
      recording: null,
    };
    this.sessions.set(sessionId, session);

    ws.onopen = () => {
      const { cols, rows } = term;
      ws.send(JSON.stringify({ type: 'terminal:resize', cols, rows }));
      session.recording = { startTime: Date.now(), events: [], cols, rows };
    };

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data as string) as {
          type: string;
          data?: string;
          message?: string;
        };
        if (msg.type === 'terminal:output' && msg.data) {
          if (session.recording) {
            session.recording.events.push([(Date.now() - session.recording.startTime) / 1000, 'o', msg.data]);
          }
          term.write(msg.data);
        } else if (msg.type === 'terminal:exit') {
          term.write('\r\n\x1b[33m[进程已退出]\x1b[0m\r\n');
        } else if (msg.type === 'terminal:error' && msg.message) {
          term.write(`\r\n\x1b[31m[错误] ${msg.message}\x1b[0m\r\n`);
        }
      } catch {
        /* ignore parse errors */
      }
    };

    ws.onerror = () => {
      term.write('\r\n\x1b[31m[WebSocket 连接错误]\x1b[0m\r\n');
    };

    ws.onclose = (evt) => {
      const rec = session.recording;
      if (rec && rec.events.length > 0) {
        const duration = (Date.now() - rec.startTime) / 1000;
        void request.post(
          '/api/terminal-recordings',
          {
            title: `${shell || 'terminal'} 录屏 - ${new Date().toLocaleString('zh-CN')}`,
            shell: shell || null,
            cols: rec.cols,
            rows: rec.rows,
            duration,
            events: rec.events,
          },
          { silent: true },
        );
        session.recording = null;
      }
      if (evt.code === 4001) {
        term.write('\r\n\x1b[31m[认证失败，请重新登录]\x1b[0m\r\n');
      } else if (evt.code === 4003) {
        term.write('\r\n\x1b[31m[无权限访问终端]\x1b[0m\r\n');
      } else if (evt.code !== 1000) {
        term.write('\r\n\x1b[33m[连接已断开]\x1b[0m\r\n');
      }
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        if (session.recording) {
          session.recording.events.push([(Date.now() - session.recording.startTime) / 1000, 'i', data]);
        }
        ws.send(JSON.stringify({ type: 'terminal:input', data }));
      }
    });

    term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'terminal:resize', cols, rows }));
      }
    });
  }

  /**
   * 将 session 的 xterm 容器挂载到 React 管理的 div 内，
   * 并设置 ResizeObserver 监听尺寸变化以自动 fit。
   */
  attach(sessionId: string, parent: HTMLDivElement): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // DOM appendChild 自动将容器从当前父节点移入新父节点
    parent.appendChild(session.container);

    // 重新绑定 ResizeObserver 到新父节点
    session.resizeObserver?.disconnect();
    session.resizeObserver = new ResizeObserver(() => {
      session.fitAddon.fit();
    });
    session.resizeObserver.observe(parent);

    // 延迟一帧 fit，确保布局已稳定
    setTimeout(() => {
      session.fitAddon.fit();
    }, 0);
  }

  /**
   * 将 xterm 容器从 React div 移回隐藏根，保持 WebSocket 不断线。
   * 若已被标记为待销毁，则执行销毁。
   */
  detach(sessionId: string): void {
    if (this.pendingDestroy.has(sessionId)) {
      this.destroy(sessionId);
      return;
    }
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.resizeObserver?.disconnect();
    session.resizeObserver = null;
    this.getHiddenRoot().appendChild(session.container);
  }

  /** 标记 session 待销毁（在 TerminalTab 下次 detach 时执行） */
  markForDestruction(sessionId: string): void {
    if (this.sessions.has(sessionId)) {
      this.pendingDestroy.add(sessionId);
    }
  }

  /** 立即销毁 session（关闭 WebSocket，释放 xterm DOM） */
  destroy(sessionId: string): void {
    this.pendingDestroy.delete(sessionId);
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.resizeObserver?.disconnect();
    session.ws.close(1000);
    session.term.dispose();
    session.container.remove();
    this.sessions.delete(sessionId);
  }

  /** 触发 fit（用于 tab 切换激活时） */
  refit(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    setTimeout(() => {
      session.fitAddon.fit();
    }, 50);
  }

  /** 更新终端外观选项，不重建 WebSocket */
  updateOptions(
    sessionId: string,
    opts: {
      theme?: TerminalThemeDef;
      fontSize?: number;
      fontFamily?: string;
      lineHeight?: number;
    },
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (opts.theme !== undefined) session.term.options.theme = toXtermTheme(opts.theme);
    if (opts.fontSize !== undefined) session.term.options.fontSize = opts.fontSize;
    if (opts.fontFamily !== undefined) session.term.options.fontFamily = opts.fontFamily;
    if (opts.lineHeight !== undefined) session.term.options.lineHeight = opts.lineHeight;
    session.fitAddon.fit();
  }
}

export const terminalSessionStore = new TerminalSessionStore();
