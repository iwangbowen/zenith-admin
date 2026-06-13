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
import { SearchAddon } from '@xterm/addon-search';
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
  /** 滚回缓冲行数，默认 5000 */
  scrollback?: number;
}

interface SessionState {
  term: Terminal;
  fitAddon: FitAddon;
  ws: WebSocket;
  searchAddon: SearchAddon;
  shell: string;
  cwd?: string;
  /** OSC 7 追踪到的当前工作目录 */
  currentCwd?: string;
  container: HTMLDivElement;
  resizeObserver: ResizeObserver | null;
  recording: {
    startTime: number;
    events: [number, 'o' | 'i', string][];
    cols: number;
    rows: number;
  } | null;
  /** 是否启用录屏（由系统配置 terminal_recording_enabled 决定） */
  recordingEnabled: boolean;
  /** 指数退退重连状态 */
  reconnect: {
    attempts: number;
    timer: ReturnType<typeof setTimeout> | null;
    /** true = 已被标记待销毁，不再重连 */
    stopped: boolean;
  };
}

function buildWsUrl(sessionId: string, shell: string, cwd?: string): string {
  const token = localStorage.getItem(TOKEN_KEY) ?? '';
  let wsBase = config.wsBaseUrl;
  if (!wsBase) {
    const base = config.apiBaseUrl || location.origin;
    wsBase = base.replace(/^http/, 'ws');
  }
  const cwdPart = cwd ? `&cwd=${encodeURIComponent(cwd)}` : '';
  return `${wsBase}/api/ws/terminal?token=${encodeURIComponent(token)}&shell=${encodeURIComponent(shell)}${cwdPart}&sessionId=${encodeURIComponent(sessionId)}`;
}

class TerminalSessionStore {
  private readonly sessions = new Map<string, SessionState>();
  private readonly cwdCallbacks = new Map<string, (cwd: string) => void>();
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
  async create(sessionId: string, options: SessionCreateOptions): Promise<void> {
    if (this.sessions.has(sessionId)) return;

    // 查询录屏开关（默认关闭）
    let recordingEnabled = false;
    try {
      const res = await request.get<{ configValue: string }>(
        '/api/system-configs/public/terminal_recording_enabled',
        { silent: true },
      );
      if (res.code === 0) recordingEnabled = res.data?.configValue === 'true';
    } catch { /* 查询失败则不录屏 */ }

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
      scrollback: options.scrollback ?? 5000,
    });

    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(searchAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(container);

    const ws = new WebSocket(buildWsUrl(sessionId, options.shell, options.cwd));
    const { shell, cwd } = options;

    const session: SessionState = {
      term,
      fitAddon,
      searchAddon,
      ws,
      shell,
      cwd,
      container,
      resizeObserver: null,
      recording: null,
      recordingEnabled,
      reconnect: { attempts: 0, timer: null, stopped: false },
    };
    this.sessions.set(sessionId, session);

    // OSC 7：Shell 报告当前工作目录（需 Shell 配置，如 bash/zsh PROMPT_COMMAND）
    term.parser.registerOscHandler(7, (data: string) => {
      try {
        // 格式：file://hostname/path/to/dir
        const match = /^file:\/\/[^/]*(\/[^?#]*)/.exec(data);
        if (match) {
          const newCwd = decodeURIComponent(match[1]);
          session.currentCwd = newCwd;
          this.cwdCallbacks.get(sessionId)?.(newCwd);
        }
      } catch { /* ignore */ }
      return false;
    });

    this.setupWsHandlers(sessionId, ws, session, shell);

    // term.onData / term.onResize 使用 session.ws（每次重连后更新），保证重连后输入仍发送
    term.onData((data) => {
      const currentWs = session.ws;
      if (currentWs.readyState === WebSocket.OPEN) {
        session.recording?.events.push([(Date.now() - (session.recording?.startTime ?? 0)) / 1000, 'i', data]);
        currentWs.send(JSON.stringify({ type: 'terminal:input', data }));
      }
    });

    term.onResize(({ cols, rows }) => {
      const currentWs = session.ws;
      if (currentWs.readyState === WebSocket.OPEN) {
        currentWs.send(JSON.stringify({ type: 'terminal:resize', cols, rows }));
      }
    });
  }

  /**
   * 为 WebSocket 设置事件处理器（初始化和重连时复用）。
   */
  private setupWsHandlers(sessionId: string, ws: WebSocket, session: SessionState, shell: string): void {
    const { term } = session;

    ws.onopen = () => {
      // 重连成功时重置计数
      session.reconnect.attempts = 0;
      const { cols, rows } = term;
      ws.send(JSON.stringify({ type: 'terminal:resize', cols, rows }));
      // 仅在系统配置启用录屏时初始化录制状态
      if (session.recordingEnabled && !session.recording) {
        session.recording = { startTime: Date.now(), events: [], cols, rows };
      }
    };

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data as string) as {
          type: string;
          data?: string;
          message?: string;
        };
        if (msg.type === 'terminal:reconnected') {
          // 服务端确认重连，回放的 output 数据随后发送，无需特殊处理
          term.write('\r\n\x1b[32m[已重新连接]\x1b[0m\r\n');
        } else if (msg.type === 'terminal:output' && msg.data) {
          session.recording?.events.push([(Date.now() - (session.recording?.startTime ?? 0)) / 1000, 'o', msg.data]);
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
      // onerror 之后通常会触发 onclose，重连逻辑在 onclose 中统一处理
    };

    ws.onclose = (evt) => {
      // 保存录屏片段
      const rec = session.recording;
      if (rec && rec.events.length > 0) {
        const duration = (Date.now() - rec.startTime) / 1000;
        request.post(
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
        session.reconnect.stopped = true;
      } else if (evt.code === 4003) {
        term.write('\r\n\x1b[31m[无权限访问终端]\x1b[0m\r\n');
        session.reconnect.stopped = true;
      } else if (evt.code === 1000) {
        // 正常关闭（进程退出 / 明确关闭），不重连
      } else if (!session.reconnect.stopped) {
        // 意外断线：指数退避重连
        this.scheduleReconnect(sessionId);
      }
    };
  }

  /** 安排下一次重连（指数退避，最大 30 s） */
  private scheduleReconnect(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.reconnect.stopped) return;

    const MAX_ATTEMPTS = 8;
    if (session.reconnect.attempts >= MAX_ATTEMPTS) {
      session.term.write('\r\n\x1b[31m[已达最大重连次数，停止重连]\x1b[0m\r\n');
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, session.reconnect.attempts), 30_000);
    session.reconnect.attempts++;
    const attemptsText = `${session.reconnect.attempts}/${MAX_ATTEMPTS}`;
    session.term.write(`\r\n\x1b[33m[连接已断开，${delay / 1000}s 后自动重连…（${attemptsText}）]\x1b[0m\r\n`);

    session.reconnect.timer = setTimeout(() => {
      session.reconnect.timer = null;
      const s = this.sessions.get(sessionId);
      if (!s || s.reconnect.stopped) return;

      s.term.write('\r\n\x1b[33m[正在重新连接…]\x1b[0m\r\n');
      const newWs = new WebSocket(buildWsUrl(sessionId, s.shell, s.cwd));
      s.ws = newWs;
      this.setupWsHandlers(sessionId, newWs, s, s.shell);
    }, delay);
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
      // 立即停止重连
      const session = this.sessions.get(sessionId);
      if (session) {
        session.reconnect.stopped = true;
        if (session.reconnect.timer !== null) {
          clearTimeout(session.reconnect.timer);
          session.reconnect.timer = null;
        }
      }
      this.pendingDestroy.add(sessionId);
    }
  }

  /** 立即销毁 session（通知服务端关闭 PTY、释放 xterm DOM） */
  destroy(sessionId: string): void {
    this.pendingDestroy.delete(sessionId);
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.reconnect.stopped = true;
    if (session.reconnect.timer !== null) {
      clearTimeout(session.reconnect.timer);
      session.reconnect.timer = null;
    }
    session.resizeObserver?.disconnect();
    // 通知服务端明确关闭 PTY（保活 5 min 后由服务端自动销毁的预防措施）
    if (session.ws.readyState === WebSocket.OPEN) {
      try { session.ws.send(JSON.stringify({ type: 'terminal:close' })); } catch { /* ignore */ }
    }
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

  // ── 搜索 ──────────────────────────────────────────────────────────────────

  /** 向下查找下一个匹配项 */
  findNext(sessionId: string, text: string, opts?: { caseSensitive?: boolean; regex?: boolean; wholeWord?: boolean }): boolean {
    return this.sessions.get(sessionId)?.searchAddon.findNext(text, opts) ?? false;
  }

  /** 向上查找上一个匹配项 */
  findPrevious(sessionId: string, text: string, opts?: { caseSensitive?: boolean; regex?: boolean; wholeWord?: boolean }): boolean {
    return this.sessions.get(sessionId)?.searchAddon.findPrevious(text, opts) ?? false;
  }

  /** 清除搜索高亮 */
  clearSearch(sessionId: string): void {
    this.sessions.get(sessionId)?.searchAddon.clearDecorations();
  }

  // ── CWD (OSC 7) ───────────────────────────────────────────────────────────

  /** 获取通过 OSC 7 追踪到的当前工作目录 */
  getCwd(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.currentCwd;
  }

  /** 注册 CWD 变化回调（每次 OSC 7 触发时调用） */
  onCwdChange(sessionId: string, cb: (cwd: string) => void): void {
    this.cwdCallbacks.set(sessionId, cb);
  }

  /** 取消 CWD 变化回调 */
  offCwdChange(sessionId: string): void {
    this.cwdCallbacks.delete(sessionId);
  }

  /**
   * 注册自定义按键事件处理器（在 xterm 处理前拦截）。
   * handler 返回 false → xterm 不处理该按键；返回 true → 正常处理。
   */
  attachCustomKeyEventHandler(sessionId: string, handler: (event: KeyboardEvent) => boolean): void {
    this.sessions.get(sessionId)?.term.attachCustomKeyEventHandler(handler);
  }
}

export const terminalSessionStore = new TerminalSessionStore();
