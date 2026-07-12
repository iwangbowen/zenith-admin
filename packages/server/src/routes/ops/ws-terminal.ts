import { Hono } from 'hono';
import type { UpgradeWebSocket } from 'hono/ws';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as inspector from 'node:inspector';
import * as pty from 'node-pty';
import { Client as SshClient } from 'ssh2';
import { verifyToken } from '../../lib/jwt';
import type { JwtPayload } from '../../middleware/auth';
import { isTokenBlacklisted } from '../../lib/session-manager';
import { isSuperAdmin, getUserPermissions } from '../../lib/permissions';
import { getClientIp } from '../../lib/request-helpers';
import { listShells } from '../../services/ops/terminal-files.service';
import { getSshConnectParams } from '../../services/ops/ssh-profiles.service';
import {
  type TerminalProcess,
  type TerminalSession,
  type TerminalKind,
  getSession,
  setSession,
  clearIdleTimer,
  appendOutput,
  touchActivity,
  setSize,
  destroySession,
  attachObserver,
  detachObserver,
  writeToSession,
  getSessionMeta,
} from '../../lib/terminal-session-registry';

/** 终端会话监控权限码 */
const MONITOR_PERMISSION = 'system:terminal:monitor';

const POWERSHELL_CWD_PROMPT = [
  "$global:__zenith_original_prompt = if (Test-Path function:\\prompt) { (Get-Command prompt).ScriptBlock } else { { 'PS ' + (Get-Location) + '> ' } };",
  'function global:prompt {',
  'try {',
  '$p = (Get-Location).ProviderPath;',
  'if (-not $p) { $p = (Get-Location).Path; }',
  "$u = [Uri]::EscapeDataString(($p -replace '\\\\', '/')).Replace('%2F', '/');",
  '[Console]::Write("$([char]27)]7;file://localhost/$u$([char]7)");',
  '} catch {}',
  '& $global:__zenith_original_prompt',
  '}',
].join(' ');

const WSL_BASH_CWD_BOOTSTRAP = [
  'tmp="${TMPDIR:-/tmp}/zenith-terminal-rc-$$.bashrc"',
  'export ZENITH_TERMINAL_RC="$tmp"',
  "cat > \"$tmp\" <<'__ZENITH_RC__'",
  'if [ -f /etc/bash.bashrc ]; then . /etc/bash.bashrc; fi',
  'if [ -f ~/.bashrc ]; then . ~/.bashrc; fi',
  "__zenith_emit_cwd() { printf '\\033]7;file://wsl%s\\007' \"$PWD\"; }",
  'case ";${PROMPT_COMMAND:-};" in',
  '  *";__zenith_emit_cwd;"*) ;;',
  '  *) PROMPT_COMMAND="__zenith_emit_cwd${PROMPT_COMMAND:+;$PROMPT_COMMAND}" ;;',
  'esac',
  'if [ -n "${ZENITH_TERMINAL_RC:-}" ]; then rm -f "$ZENITH_TERMINAL_RC"; unset ZENITH_TERMINAL_RC; fi',
  '__ZENITH_RC__',
  'exec bash --rcfile "$tmp" -i',
].join('\n');

type DockerExecShell = {
  containerId: string;
  shellName: 'bash' | 'sh';
  shellPath: '/bin/bash' | '/bin/sh';
};

function parseDockerExecShell(type: string | undefined): DockerExecShell | null {
  if (!type?.startsWith('docker-exec:')) return null;
  const raw = type.slice('docker-exec:'.length);
  const [containerId, shell = 'sh', extra] = raw.split(':');
  if (extra !== undefined) return null;
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(containerId)) return null;
  if (shell !== 'bash' && shell !== 'sh') return null;
  return {
    containerId,
    shellName: shell,
    shellPath: shell === 'bash' ? '/bin/bash' : '/bin/sh',
  };
}

/**
 * 根据前端选择的 shell id 解析实际可执行文件与启动参数。
 * shell 列表由 listShells() 按当前平台动态探测；前端传入的 id 必须在白名单内，
 * 否则回退到平台默认 shell，避免任意可执行文件注入。
 */
function resolveShell(type: string | undefined): { file: string; args: string[] } {
  // docker exec 进容器 — 不在 shell 白名单内，提前处理
  if (type?.startsWith('docker-exec:')) {
    const dockerShell = parseDockerExecShell(type);
    if (!dockerShell) throw new Error('无效的 Docker 容器或 Shell');
    // -i 保持 stdin 开启，-t 在容器内分配 TTY（修复 job control 警告）
    // 显式设置 PATH 和 TERM，避免非登录 shell 环境变量缺失
    return {
      file: 'docker',
      args: [
        'exec', '-it',
        '-e', 'TERM=xterm-256color',
        '-e', 'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
        dockerShell.containerId, dockerShell.shellPath,
      ],
    };
  }
  const { shells, defaultShell } = listShells();
  const id = type && shells.some((s) => s.id === type) ? type : defaultShell;
  const shell = shells.find((s) => s.id === id) ?? shells[0];
  if (os.platform() === 'win32' && shell.id.startsWith('wsl:')) {
    const execIndex = shell.args?.indexOf('--exec') ?? -1;
    const prefixArgs = execIndex >= 0 ? shell.args!.slice(0, execIndex) : ['-d', shell.id.slice(4), '--cd', '~'];
    return { file: shell.path, args: [...prefixArgs, '--exec', 'bash', '-lc', WSL_BASH_CWD_BOOTSTRAP] };
  }
  // WSL 发行版：shell.args 已包含 ['-d', '<distro>']
  if (shell.args?.length) {
    return { file: shell.path, args: shell.args };
  }
  if (os.platform() === 'win32' && shell.id === 'powershell') {
    return { file: shell.path, args: ['-NoExit', '-Command', POWERSHELL_CWD_PROMPT] };
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

/** PTY 进程无客户端连接时的最大保活时长（毫秒） */
const PTY_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

type SshShellParams = {
  getSession: () => TerminalSession;
  sessionId: string;
  envVars?: Record<string, string>;
};

function handleSshShell(
  stream: import('ssh2').ClientChannel,
  conn: import('ssh2').Client,
  { getSession: getSess, sessionId, envVars }: SshShellParams,
  resolve: (t: TerminalProcess) => void,
  _reject: (e: Error) => void,
): void {
  for (const [k, v] of Object.entries(envVars ?? {})) {
    stream.write(`export ${k}=${JSON.stringify(v)}\r`);
  }
  const onData = (data: Buffer) => {
    const text = data.toString('utf8');
    const s = getSess();
    appendOutput(s, text);
    try { s.currentWs?.send(JSON.stringify({ type: 'terminal:output', data: text })); } catch { /* ignore */ }
  };
  stream.on('data', onData);
  stream.stderr.on('data', onData);
  stream.on('close', () => {
    conn.end();
    const s = getSess();
    try {
      s.currentWs?.send(JSON.stringify({ type: 'terminal:exit' }));
      s.currentWs?.close(1000, 'SSH session closed');
    } catch { /* ignore */ }
    destroySession(sessionId);
  });
  resolve({
    write: (d) => { try { stream.write(d); } catch { /* ignore */ } },
    resize: (c, r) => { try { stream.setWindow(r, c, 0, 0); } catch { /* ignore */ } },
    kill: () => { try { stream.close(); conn.end(); } catch { /* ignore */ } },
  });
}

/**
 * 建立 SSH shell 频道，返回 TerminalProcess 适配器与展示标签（user@host）。
 * 提取为独立函数以降低 ws-terminal onOpen 的嵌套深度。
 */
async function createSshProcess(
  profileId: number,
  userId: number,
  getSess: () => TerminalSession,
  sessionId: string,
): Promise<{ process: TerminalProcess; label: string }> {
  const params = await getSshConnectParams(profileId, userId);
  const label = `${params.username}@${params.host}:${params.port}`;
  const process = await new Promise<TerminalProcess>((resolve, reject) => {
    const conn = new SshClient();
    conn.on('ready', () => {
      conn.shell({ term: 'xterm-256color', cols: 80, rows: 24 }, (err, stream) => {
        if (err) { conn.end(); reject(err); return; }
        handleSshShell(stream, conn, { getSession: getSess, sessionId, envVars: params.envVars }, resolve, reject);
      });
    });
    conn.on('error', reject);
    conn.connect({
      host: params.host,
      port: params.port,
      username: params.username,
      ...('password' in params ? { password: (params as { password: string }).password } : {}),
      ...('privateKey' in params ? { privateKey: (params as { privateKey: string }).privateKey, passphrase: (params as { passphrase?: string }).passphrase } : {}),
      ...('agent' in params ? { agent: (params as { agent: string }).agent } : {}),
      readyTimeout: 10000,
      keepaliveInterval: 30000,
    });
  });
  return { process, label };
}

export function createWsTerminalRoute(upgradeWebSocket: UpgradeWebSocket) {  const wsApp = new Hono();

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
          const isSA = isSuperAdmin(payload);
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

          // ── 尝试重连已有会话 ──
          const existing = sessionId ? getSession(sessionId) : undefined;
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

          // ── 创建新终端进程（本地 PTY / SSH / Docker） ──
          const isSsh = shellType?.startsWith('ssh:');
          const isDocker = shellType?.startsWith('docker-exec:');
          const kind: TerminalKind = isSsh ? 'ssh' : isDocker ? 'docker' : 'local';
          const clientIp = getClientIp(c);
          // sessionRef 用于 createSshProcess 回调中懒引用 session（session 在 termProcess 之后才赋值）
          const sessionRef: { current: TerminalSession | null } = { current: null };

          let termProcess: TerminalProcess;
          let label: string;
          let initialCwd: string | undefined;
          try {
            if (isSsh) {
              // ── SSH 连接 ──
              const profileId = Number(shellType!.slice(4));
              if (!profileId) throw new Error('无效的 SSH 配置 ID');
              const ssh = await createSshProcess(profileId, payload.userId, () => sessionRef.current!, sessionId);
              termProcess = ssh.process;
              label = ssh.label;
            } else {
              // ── 本地 PTY / Docker exec ──
              const { file: shellFile, args: shellArgs } = resolveShell(shellType);
              const isWsl = shellType?.startsWith('wsl:');
              if (isDocker) {
                const dockerShell = parseDockerExecShell(shellType);
                label = dockerShell
                  ? `docker:${dockerShell.containerId.slice(0, 12)}:${dockerShell.shellName}`
                  : 'docker';
              } else {
                const { shells } = listShells();
                label = shells.find((s) => s.id === shellType)?.label ?? shellType ?? 'shell';
              }

              // 解析工作目录：优先使用前端传入的 cwd（须为已存在目录），否则回退用户主目录
              // WSL 会话使用 Windows 用户主目录作为 cwd（让 WSL 在自身 home 启动；传 Windows 路径给 wsl.exe 是安全的）
              let cwd = os.homedir() || process.cwd();
              if (!isWsl && cwdParam) {
                try {
                  if (fs.existsSync(cwdParam) && fs.statSync(cwdParam).isDirectory()) {
                    cwd = cwdParam;
                  }
                } catch { /* 无效路径回退默认 */ }
              }
              initialCwd = isWsl || isDocker ? undefined : cwd;

              const ptyProcess = pty.spawn(shellFile, shellArgs, {
                name: 'xterm-256color',
                cols: 80,
                rows: 24,
                cwd,
                env: process.env,
              });

              ptyProcess.onData((data) => {
                const currentSession = sessionRef.current;
                if (!currentSession) return;
                appendOutput(currentSession, data);
                try { currentSession.currentWs?.send(JSON.stringify({ type: 'terminal:output', data })); } catch { /* ignore */ }
              });
              ptyProcess.onExit(() => {
                const currentSession = sessionRef.current;
                try {
                  currentSession?.currentWs?.send(JSON.stringify({ type: 'terminal:exit' }));
                  currentSession?.currentWs?.close(1000, 'Process exited');
                } catch { /* ignore */ }
                if (sessionId) destroySession(sessionId);
              });

              termProcess = {
                write: (d) => ptyProcess.write(d),
                resize: (cols, rows) => ptyProcess.resize(Math.max(1, cols), Math.max(1, rows)),
                kill: () => { try { ptyProcess.kill(); } catch { /* ignore */ } },
              };
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            ws.send(JSON.stringify({ type: 'terminal:error', message: `启动终端失败: ${msg}` }));
            ws.close(1011, 'Failed to start terminal');
            return;
          }

          const now = Date.now();
          const session: TerminalSession = {
            sessionId,
            process: termProcess,
            currentWs: ws,
            outputBuffer: '',
            idleTimer: null,
            userId: payload.userId,
            username: payload.username,
            kind,
            label,
            clientIp,
            startedAt: now,
            lastActivityAt: now,
            cols: 80,
            rows: 24,
            observers: new Set(),
            takenOverBy: null,
          };
          sessionRef.current = session;
          if (sessionId) setSession(sessionId, session);
          if (initialCwd) {
            try { ws.send(JSON.stringify({ type: 'terminal:cwd', cwd: initialCwd })); } catch { /* ignore */ }
          }
        },

        onMessage(evt, _ws) {
          // 路由到对应会话
          const session = sessionId ? getSession(sessionId) : undefined;
          if (!session) return;
          try {
            const raw: unknown = typeof evt.data === 'string' ? JSON.parse(evt.data) : null;
            if (!raw || typeof raw !== 'object') return;
            const msg = raw as { type: string; data?: string; cols?: number; rows?: number };

            if (msg.type === 'terminal:input' && typeof msg.data === 'string') {
              session.process.write(msg.data);
              touchActivity(session);
            } else if (msg.type === 'terminal:resize' && msg.cols && msg.rows) {
              session.process.resize(Math.max(1, msg.cols), Math.max(1, msg.rows));
              setSize(session, Math.max(1, msg.cols), Math.max(1, msg.rows));
            } else if (msg.type === 'terminal:close') {
              // 客户端明确要求关闭：立即销毁
              if (sessionId) destroySession(sessionId);
            }
          } catch { /* ignore malformed */ }
        },

        onClose() {
          const session = sessionId ? getSession(sessionId) : undefined;
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

/**
 * Web 终端监控 WebSocket 路由（管理员）
 *
 * 端点：GET /api/ws/terminal-monitor?token=<accessToken>&sessionId=<id>&takeover=1
 *
 * - 权限：超管 或 `system:terminal:monitor`。
 * - 作为 observer 实时镜像目标会话的输出（接入时回放输出缓冲）。
 * - takeover=1 时允许管理员向目标会话注入输入（接管），由 writeToSession 标记 takenOverBy。
 * - 监控端断开时自动移除 observer，不影响被监控会话本身。
 */
export function createWsTerminalMonitorRoute(upgradeWebSocket: UpgradeWebSocket) {
  const wsApp = new Hono();

  wsApp.get(
    '/',
    upgradeWebSocket(async (c) => {
      const token = c.req.query('token');
      const sessionId = c.req.query('sessionId') ?? '';
      const allowTakeover = c.req.query('takeover') === '1';
      let payload: JwtPayload | null = null;

      if (token) {
        try {
          payload = await verifyToken<JwtPayload>(token);
        } catch {
          payload = null;
        }
      }

      let observer: { send: (data: string) => void } | null = null;

      return {
        async onOpen(_evt, ws) {
          if (!payload) {
            ws.close(4001, 'Unauthorized');
            return;
          }
          if (payload.jti) {
            try {
              if (await isTokenBlacklisted(payload.jti)) {
                ws.close(4001, 'Session revoked');
                return;
              }
            } catch { /* Redis 不可用时放行 */ }
          }

          // 权限校验：超管 或 system:terminal:monitor
          if (!isSuperAdmin(payload)) {
            try {
              const perms = await getUserPermissions(payload.userId);
              if (!perms.includes(MONITOR_PERMISSION)) {
                ws.close(4003, 'Forbidden');
                return;
              }
            } catch {
              ws.close(4003, 'Forbidden');
              return;
            }
          }

          const meta = getSessionMeta(sessionId);
          if (!meta) {
            ws.send(JSON.stringify({ type: 'monitor:not-found', message: '会话不存在或已结束' }));
            ws.close(1000, 'Session not found');
            return;
          }

          observer = { send: (data: string) => { try { ws.send(data); } catch { /* ignore */ } } };
          const buffer = attachObserver(sessionId, observer);
          ws.send(JSON.stringify({ type: 'monitor:attached', meta, takeover: allowTakeover }));
          if (buffer) ws.send(JSON.stringify({ type: 'terminal:output', data: buffer }));
        },

        onMessage(evt, _ws) {
          if (!payload || !allowTakeover) return;
          try {
            const raw: unknown = typeof evt.data === 'string' ? JSON.parse(evt.data) : null;
            if (!raw || typeof raw !== 'object') return;
            const msg = raw as { type: string; data?: string };
            if (msg.type === 'terminal:input' && typeof msg.data === 'string') {
              writeToSession(sessionId, msg.data, payload.userId);
            }
          } catch { /* ignore malformed */ }
        },

        onClose() {
          if (observer) detachObserver(sessionId, observer);
        },
      };
    }),
  );

  return wsApp;
}
