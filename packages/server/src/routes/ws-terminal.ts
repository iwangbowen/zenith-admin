import { Hono } from 'hono';
import type { UpgradeWebSocket } from 'hono/ws';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as inspector from 'node:inspector';
import * as pty from 'node-pty';
import { verifyToken } from '../lib/jwt';
import type { JwtPayload } from '../middleware/auth';
import { isTokenBlacklisted } from '../lib/session-manager';
import { isSuperAdmin, getUserPermissions } from '../lib/permissions';
import { listShells } from '../services/terminal-files.service';

/**
 * 根据前端选择的 shell id 解析实际可执行文件与启动参数。
 * shell 列表由 listShells() 按当前平台动态探测；前端传入的 id 必须在白名单内，
 * 否则回退到平台默认 shell，避免任意可执行文件注入。
 */
function resolveShell(type: string | undefined): { file: string; args: string[] } {
  const { shells, defaultShell } = listShells();
  const id = type && shells.some((s) => s.id === type) ? type : defaultShell;
  const shell = shells.find((s) => s.id === id) ?? shells[0];
  // WSL 发行版：shell.args 已包含 ['-d', '<distro>']
  if (shell.args?.length) {
    return { file: shell.path, args: shell.args };
  }
  // Windows 下 Git Bash 使用 login + interactive
  if (os.platform() === 'win32' && shell.id === 'bash') {
    return { file: shell.path, args: ['--login', '-i'] };
  }
  return { file: shell.path, args: [] };
}

/**
/**
 * Web 终端 WebSocket 路由
 *
 * 端点：GET /api/ws/terminal?token=<accessToken>&sessionId=<id>
 *
 * 支持断线重连（Session Persistence）：
 * - 客户端每个终端拥有唯一 sessionId，首次连接时携带该 id。
 * - WS 断开后 PTY 进程保活 PTY_IDLE_TIMEOUT_MS 毫秒，等待重连。
 * - 重连时携带相同 sessionId，服务端将新 WS 附接到存活的 PTY，并回放输出缓冲区。
 * - 若客户端发送 terminal:close 消息，或 PTY 进程自行退出，则立即清理会话。
 */

/** PTY 会话的输出缓冲区上限（字节），用于断线重连后回放 */
const OUTPUT_BUFFER_MAX = 50 * 1024;
/** PTY 进程无客户端连接时的最大保活时长（毫秒） */
const PTY_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

interface PtySession {
  ptyProcess: pty.IPty;
  /** 当前连接的 WebSocket（无连接时为 null） */
  currentWs: { send: (data: string) => void; close: (code: number, reason: string) => void } | null;
  /** 近期输出缓冲，断线重连后回放 */
  outputBuffer: string;
  /** 进程保活计时器 */
  idleTimer: ReturnType<typeof setTimeout> | null;
  /** 会话归属用户，防止越权重连 */
  userId: number;
}

/** 模块级 PTY 会话表（sessionId → PtySession） */
const ptySessions = new Map<string, PtySession>();

function appendBuffer(session: PtySession, data: string): void {
  session.outputBuffer += data;
  if (session.outputBuffer.length > OUTPUT_BUFFER_MAX) {
    session.outputBuffer = session.outputBuffer.slice(-OUTPUT_BUFFER_MAX);
  }
}

function clearIdleTimer(session: PtySession): void {
  if (session.idleTimer !== null) {
    clearTimeout(session.idleTimer);
    session.idleTimer = null;
  }
}

function destroySession(sessionId: string): void {
  const s = ptySessions.get(sessionId);
  if (!s) return;
  clearIdleTimer(s);
  try { s.ptyProcess.kill(); } catch { /* ignore */ }
  ptySessions.delete(sessionId);
}

export function createWsTerminalRoute(upgradeWebSocket: UpgradeWebSocket) {
  const wsApp = new Hono();

  wsApp.get(
    '/',
    upgradeWebSocket(async (c) => {
      const token = c.req.query('token');
      const shellType = c.req.query('shell');
      const cwdParam = c.req.query('cwd');
      const sessionId = c.req.query('sessionId') ?? '';
      let payload: JwtPayload | null = null;

      if (token) {
        try {
          payload = await verifyToken<JwtPayload>(token);
        } catch {
          payload = null;
        }
      }

      return {
        async onOpen(_evt, ws) {
          if (!payload) {
            ws.close(4001, 'Unauthorized');
            return;
          }

          // 检查 token 黑名单
          if (payload.jti) {
            try {
              const blacklisted = await isTokenBlacklisted(payload.jti);
              if (blacklisted) {
                ws.close(4001, 'Session revoked');
                return;
              }
            } catch { /* Redis 不可用时放行 */ }
          }

          // 权限校验：超管 或 拥有 system:terminal:execute
          const isSA = isSuperAdmin(payload.roles);
          if (!isSA) {
            try {
              const perms = await getUserPermissions(payload.userId);
              if (!perms.includes('system:terminal:execute')) {
                ws.close(4003, 'Forbidden');
                return;
              }
            } catch {
              ws.close(4003, 'Forbidden');
              return;
            }
          }

          // ⚠️ node-pty 在 Windows 上与 Node Inspector（调试器）附加存在已知死锁：
          // 当 inspector 激活时调用 pty.spawn() 会同步阻塞、冻结整个 Node 事件循环，
          // 导致后端所有请求无响应。检测到调试器时拒绝启动 pty，避免卡死整个服务。
          // 正常开发请用 `npm run dev`（已通过 scripts/dev.mjs 剖离 inspector）。
          if (os.platform() === 'win32' && inspector.url() !== undefined) {
            ws.send(JSON.stringify({
              type: 'terminal:error',
              message:
                '检测到 Node 调试器（Inspector）已附加。Windows 下 node-pty 与调试器冲突会导致后端卡死，' +
                'Web 终端已自动禁用。请改用 `npm run dev` 运行后端（已自动剖离调试器）。',
            }));
            ws.close(1011, 'Inspector attached');
            return;
          }

          // ── 尝试重连已有 PTY 会话 ──
          const existing = sessionId ? ptySessions.get(sessionId) : undefined;
          if (existing?.userId === payload.userId) {
            // 合法重连：附接到已有 PTY，回放缓冲区
            clearIdleTimer(existing);
            existing.currentWs = ws;
            ws.send(JSON.stringify({ type: 'terminal:reconnected' }));
            if (existing.outputBuffer) {
              ws.send(JSON.stringify({ type: 'terminal:output', data: existing.outputBuffer }));
            }
            return;
          }

          // ── 创建新 PTY 进程 ──
          const { file: shellFile, args: shellArgs } = resolveShell(shellType);
          const isWsl = shellType?.startsWith('wsl:');

          // 解析工作目录：优先使用前端传入的 cwd（须为已存在目录），否则回退用户主目录
          // WSL 会话使用 Windows 用户主目录作为 cwd（让 WSL 在自身 home 启动；传 Windows 路径给 wsl.exe 是安全的）
          let cwd = isWsl ? os.homedir() : (process.env.HOME ?? process.cwd());
          if (!isWsl && cwdParam) {
            try {
              if (fs.existsSync(cwdParam) && fs.statSync(cwdParam).isDirectory()) {
                cwd = cwdParam;
              }
            } catch { /* 无效路径回退默认 */ }
          }

          let ptyProcess: pty.IPty;
          try {
            ptyProcess = pty.spawn(shellFile, shellArgs, {
              name: 'xterm-256color',
              cols: 80,
              rows: 24,
              cwd,
              env: process.env,
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            ws.send(JSON.stringify({ type: 'terminal:error', message: `启动终端失败: ${msg}` }));
            ws.close(1011, 'Failed to start terminal');
            return;
          }

          const session: PtySession = {
            ptyProcess,
            currentWs: ws,
            outputBuffer: '',
            idleTimer: null,
            userId: payload.userId,
          };
          if (sessionId) ptySessions.set(sessionId, session);

          ptyProcess.onData((data) => {
            appendBuffer(session, data);
            try {
              session.currentWs?.send(JSON.stringify({ type: 'terminal:output', data }));
            } catch { /* ws 可能已关闭 */ }
          });

          ptyProcess.onExit(() => {
            try {
              session.currentWs?.send(JSON.stringify({ type: 'terminal:exit' }));
              session.currentWs?.close(1000, 'Process exited');
            } catch { /* ignore */ }
            if (sessionId) destroySession(sessionId);
          });
        },

        onMessage(evt, _ws) {
          // 路由到对应 PTY 会话
          const session = sessionId ? ptySessions.get(sessionId) : undefined;
          if (!session) return;
          try {
            const raw: unknown = typeof evt.data === 'string' ? JSON.parse(evt.data) : null;
            if (!raw || typeof raw !== 'object') return;
            const msg = raw as { type: string; data?: string; cols?: number; rows?: number };

            if (msg.type === 'terminal:input' && typeof msg.data === 'string') {
              session.ptyProcess.write(msg.data);
            } else if (msg.type === 'terminal:resize' && msg.cols && msg.rows) {
              session.ptyProcess.resize(Math.max(1, msg.cols), Math.max(1, msg.rows));
            } else if (msg.type === 'terminal:close') {
              // 客户端明确要求关闭：立即销毁
              if (sessionId) destroySession(sessionId);
            }
          } catch { /* ignore malformed */ }
        },

        onClose() {
          const session = sessionId ? ptySessions.get(sessionId) : undefined;
          if (!session) return;

          // WS 断开时不立即 kill PTY：保活等待重连
          session.currentWs = null;
          session.idleTimer = setTimeout(() => {
            destroySession(sessionId);
          }, PTY_IDLE_TIMEOUT_MS);
        },
      };
    }),
  );

  return wsApp;
}
