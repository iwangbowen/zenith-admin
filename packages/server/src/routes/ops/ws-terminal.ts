import { maintenanceRealtimeAllowed } from '../../lib/maintenance-realtime';
import { Hono } from 'hono';
import type { UpgradeWebSocket } from 'hono/ws';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as inspector from 'node:inspector';
import * as pty from 'node-pty';
import { Client as SshClient } from 'ssh2';
import type { JwtPayload } from '../../middleware/auth';
import { authenticateAdminWs } from '../../lib/ws-auth';
import { isTokenBlacklisted } from '../../lib/session-manager';
import { isSuperAdmin, getUserPermissions } from '../../lib/permissions';
import { getClientIp } from '../../lib/request-helpers';
import { listShells } from '../../services/ops/terminal-files.service';
import { getSshConnectParams } from '../../services/ops/ssh-profiles.service';
import {
  type TerminalProcess,
  type TerminalSession,
  type TerminalKind,
  type ClientConn,
  acquireOwnedSession,
  registerSession,
  reattachClient,
  detachClient,
  appendOutput,
  touchActivity,
  setSize,
  endSession,
  attachObserver,
  detachObserver,
  writeToSession,
  toSessionMeta,
} from '../../lib/terminal-session-registry';
import {
  acquireSessionForMonitor,
  checkSessionQuota,
  newTerminalSessionId,
  persistNewTerminalSession,
  recordTerminalSessionFailure,
} from '../../services/ops/terminal-sessions.service';
import { parseDbTerminalShellType, resolveDbPsqlLaunch } from '../../services/ops/db-admin-terminal.service';
import { getHostSshConnectionOptions, shellQuoteArg } from '../../lib/host-exec';

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

function parseManagedHostId(type: string | undefined): number | null {
  const match = /^host:([1-9]\d*)$/.exec(type ?? '');
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) ? id : null;
}

function requiredPermissionsForTarget(target: string | undefined): string[] {
  const dbMode = parseDbTerminalShellType(target);
  if (dbMode) {
    // psql 的 \! 与 \copy 等价于服务器 shell，权限边界必须与主机终端对齐
    return ['system:terminal:execute', 'system:db-admin:terminal', ...(dbMode === 'rw' ? ['system:db-admin:write'] : [])];
  }
  if (parseManagedHostId(target) != null) return ['system:terminal:execute', 'system:host:use'];
  return ['system:terminal:execute'];
}

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
async function resolveShell(type: string | undefined): Promise<{
  file: string;
  args: string[];
  /** 追加到 PTY 的环境变量（如 psql 凭据） */
  env?: Record<string, string>;
  /** 预置会话展示标签（数据库终端使用） */
  label?: string;
}> {
  // 数据库管理页 psql 终端 — 连接参数由服务端从自身配置构造
  const dbMode = parseDbTerminalShellType(type);
  if (dbMode) return resolveDbPsqlLaunch(dbMode);
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
  const { shells, defaultShell } = await listShells();
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
 * Web 终端 WebSocket 路由
 *
 * 端点：GET /api/ws/terminal?shell=<type>[&sessionId=<id>]（access token 经 Sec-WebSocket-Protocol: zenith-auth, <token> 传递）
 *
 * 会话标识由服务端生成：
 * - 不带 sessionId ⇒ 新建会话，服务端下发 `terminal:session` 告知权威 ID。
 * - 带 sessionId ⇒ 重连，仅当该会话存在且归属本人时接入；否则一律拒绝，
 *   绝不按客户端给定的 ID 创建会话——ID 因此不是可自选的凭证。
 * - WS 断开后进程保活 PTY_IDLE_TIMEOUT_MS 毫秒等待重连，超时回收。
 * - 客户端发送 terminal:close，或进程自行退出，则立即清理会话。
 */

/** PTY 进程无客户端连接时的最大保活时长（毫秒） */
const PTY_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

type SshShellParams = {
  getSession: () => TerminalSession | null;
  /** 输出投递：登记完成前先缓存，避免首屏丢字 */
  emit: (data: string) => void;
  envVars?: Record<string, string>;
  initialCommand?: string;
};

function handleSshShell(
  stream: import('ssh2').ClientChannel,
  conn: import('ssh2').Client,
  { getSession: getSess, emit, envVars, initialCommand }: SshShellParams,
  resolve: (t: TerminalProcess) => void,
  _reject: (e: Error) => void,
): void {
  for (const [k, v] of Object.entries(envVars ?? {})) {
    stream.write(`export ${k}=${JSON.stringify(v)}\r`);
  }
  if (initialCommand) stream.write(`${initialCommand}\r`);
  const onData = (data: Buffer) => { emit(data.toString('utf8')); };
  stream.on('data', onData);
  stream.stderr.on('data', onData);
  stream.on('close', () => {
    conn.end();
    const s = getSess();
    if (!s) return;
    try {
      s.currentWs?.send(JSON.stringify({ type: 'terminal:exit' }));
      s.currentWs?.close(1000, 'SSH session closed');
    } catch { /* ignore */ }
    // 用本连接持有的会话 ID 结束，避免误杀同名的他人会话
    endSession(s.sessionId, 'process_exited');
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
  getSess: () => TerminalSession | null,
  emit: (data: string) => void,
): Promise<{ process: TerminalProcess; label: string }> {
  const params = await getSshConnectParams(profileId, userId);
  const label = `${params.username}@${params.host}:${params.port}`;
  const process = await new Promise<TerminalProcess>((resolve, reject) => {
    const conn = new SshClient();
    conn.on('ready', () => {
      conn.shell({ term: 'xterm-256color', cols: 80, rows: 24 }, (err, stream) => {
        if (err) { conn.end(); reject(err); return; }
        handleSshShell(stream, conn, { getSession: getSess, emit, envVars: params.envVars }, resolve, reject);
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

/** 平台运维主机交互 Shell：连接参数与 TOFU host key 校验复用 host-exec。 */
async function createManagedHostProcess(
  hostId: number,
  getSess: () => TerminalSession | null,
  emit: (data: string) => void,
  cwd?: string,
): Promise<{ process: TerminalProcess; label: string }> {
  const target = await getHostSshConnectionOptions(hostId);
  const process = await new Promise<TerminalProcess>((resolve, reject) => {
    const conn = new SshClient();
    conn.on('ready', () => {
      void target.ensureFingerprintRecorded().then(() => target.assertCurrent()).then(() => {
        conn.shell({ term: 'xterm-256color', cols: 80, rows: 24 }, (err, channel) => {
          if (err) { conn.end(); reject(err); return; }
          handleSshShell(channel, conn, {
            getSession: getSess,
            emit,
            initialCommand: cwd?.startsWith('/') ? `cd -- ${shellQuoteArg(cwd)}` : undefined,
          }, resolve, reject);
        });
      }).catch((err) => {
        conn.end();
        reject(err);
      });
    });
    conn.on('error', (err) => {
      const mismatch = target.fingerprintMismatch();
      reject(mismatch
        ? new Error(`SSH host key 指纹不匹配（当前 ${mismatch.observed}，预期 ${mismatch.expected}）`)
        : err);
    });
    conn.connect(target.config);
  });
  return { process, label: `主机:${target.label}` };
}

export function createWsTerminalRoute(upgradeWebSocket: UpgradeWebSocket) {  const wsApp = new Hono();

  wsApp.get(
    '/',
    upgradeWebSocket(async (c) => {
      const shellType = c.req.query('shell');
      const cwdParam = c.req.query('cwd');
      const sessionId = c.req.query('sessionId') ?? '';
      // 鉴权与 /api/ws 一致：token 走 Sec-WebSocket-Protocol，实时校验主体状态与黑名单
      const payload: JwtPayload | null = (await authenticateAdminWs(c))?.payload ?? null;

      // 本连接持有的会话引用与 WebSocket。所有 handler 只能操作它们，
      // 绝不用客户端传入的 sessionId 反查注册表——否则任何知道 ID 的人都能
      // 向他人会话注入输入、掐断其输出，或直接安排销毁。
      const ownedSession: { current: TerminalSession | null } = { current: null };
      let ownWs: ClientConn | null = null;

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

          // 权限校验：普通终端要求 system:terminal:execute；
          // 数据库终端在此基础上还要求 system:db-admin:terminal；平台主机终端额外要求 system:host:use。
          const requestedDbMode = parseDbTerminalShellType(shellType);
          const managedHostRequest = shellType?.startsWith('host:') ?? false;
          const requestedHostId = parseManagedHostId(shellType);
          if (!sessionId && managedHostRequest && requestedHostId == null) {
            ws.close(4000, 'Invalid managed host');
            return;
          }
          if (!sessionId && requestedHostId != null && payload.tenantId != null) {
            ws.close(4003, 'Managed hosts are platform-only');
            return;
          }
          const isSA = isSuperAdmin(payload);
          let userPermissions: string[] | null = null;
          if (!isSA) {
            try {
              userPermissions = await getUserPermissions(payload.userId);
              // 新建按请求目标校验；重连必须等拿到服务端会话后按 existing.target 校验。
              if (!sessionId && !requiredPermissionsForTarget(shellType).every((p) => userPermissions!.includes(p))) {
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

          if (!sessionId) {
            // 新建会话：不接受客户端指定标识，落到下方创建流程
          } else {
            // ── 重连已有会话 ──
            // acquireOwnedSession 是取得句柄的唯一入口，归属不符直接返回 null，
            // 因此这里既不可能接到他人会话，也不会按客户端给的 ID 凭空创建。
            const existing = acquireOwnedSession(sessionId, payload.userId);
            if (!existing) {
              ws.send(JSON.stringify({ type: 'terminal:error', message: '会话不存在或已结束，请重新打开终端' }));
              ws.close(4004, 'Session not found');
              return;
            }
            // 重连的全部权限只取服务端保存的 target，完全忽略客户端可篡改的 shell 查询参数。
            if (!isSA && !requiredPermissionsForTarget(existing.target).every((p) => userPermissions?.includes(p))) {
              ws.close(4003, 'Forbidden');
              return;
            }
            if (existing.target.startsWith('host:') && payload.tenantId != null) {
              ws.close(4003, 'Managed hosts are platform-only');
              return;
            }
            reattachClient(existing, ws);
            ownedSession.current = existing;
            ownWs = ws;
            ws.send(JSON.stringify({ type: 'terminal:session', sessionId: existing.sessionId }));
            ws.send(JSON.stringify({ type: 'terminal:reconnected' }));
            if (existing.outputBuffer) {
              ws.send(JSON.stringify({ type: 'terminal:output', data: existing.outputBuffer }));
            }
            return;
          }

          const quotaError = checkSessionQuota(payload.userId);
          if (quotaError) {
            ws.send(JSON.stringify({ type: 'terminal:error', message: quotaError }));
            ws.close(4008, 'Session quota exceeded');
            return;
          }

          // ── 创建新终端进程（本地 PTY / 用户 SSH / 平台主机 / Docker / 数据库 psql） ──
          const isSsh = shellType?.startsWith('ssh:');
          const isDocker = shellType?.startsWith('docker-exec:');
          const isDb = requestedDbMode !== null;
          const canonicalTarget = requestedHostId != null ? `host:${requestedHostId}` : (shellType ?? '');
          const kind: TerminalKind = (isSsh || requestedHostId != null) ? 'ssh' : isDocker ? 'docker' : isDb ? 'db' : 'local';
          const clientIp = getClientIp(c);

          let termProcess: TerminalProcess;
          let label: string;
          let initialCwd: string | undefined;
          // 进程可能在登记完成前就吐出 shell 提示符；先缓存，登记后补发，
          // 避免首屏丢字。
          let pendingOutput = '';
          const emitOutput = (data: string) => {
            const currentSession = ownedSession.current;
            if (!currentSession) {
              pendingOutput += data;
              return;
            }
            appendOutput(currentSession, data);
            try { currentSession.currentWs?.send(JSON.stringify({ type: 'terminal:output', data })); } catch { /* ignore */ }
          };
          try {
            if (requestedHostId != null) {
              const host = await createManagedHostProcess(
                requestedHostId,
                () => ownedSession.current,
                emitOutput,
                cwdParam,
              );
              termProcess = host.process;
              label = host.label;
            } else if (isSsh) {
              // ── SSH 连接 ──
              const profileId = Number(shellType!.slice(4));
              if (!profileId) throw new Error('无效的 SSH 配置 ID');
              const ssh = await createSshProcess(profileId, payload.userId, () => ownedSession.current, emitOutput);
              termProcess = ssh.process;
              label = ssh.label;
            } else {
              // ── 本地 PTY / Docker exec / 数据库 psql ──
              const { file: shellFile, args: shellArgs, env: shellEnv, label: shellLabel } = await resolveShell(shellType);
              const isWsl = shellType?.startsWith('wsl:');
              if (isDb) {
                label = shellLabel ?? 'psql';
              } else if (isDocker) {
                const dockerShell = parseDockerExecShell(shellType);
                label = dockerShell
                  ? `docker:${dockerShell.containerId.slice(0, 12)}:${dockerShell.shellName}`
                  : 'docker';
              } else {
                const { shells } = await listShells();
                label = shells.find((s) => s.id === shellType)?.label ?? shellType ?? 'shell';
              }

              // 解析工作目录：优先使用前端传入的 cwd（须为已存在目录），否则回退用户主目录
              // WSL 会话使用 Windows 用户主目录作为 cwd（让 WSL 在自身 home 启动；传 Windows 路径给 wsl.exe 是安全的）
              let cwd = os.homedir() || process.cwd();
              if (!isWsl && !isDb && cwdParam) {
                try {
                  // 单次异步 stat 即可判定存在性与目录类型，避免 existsSync+statSync 双重同步调用
                  if ((await fs.promises.stat(cwdParam)).isDirectory()) {
                    cwd = cwdParam;
                  }
                } catch { /* 无效路径回退默认 */ }
              }
              initialCwd = isWsl || isDocker || isDb ? undefined : cwd;

              const ptyProcess = pty.spawn(shellFile, shellArgs, {
                name: 'xterm-256color',
                cols: 80,
                rows: 24,
                cwd,
                env: shellEnv ? { ...process.env, ...shellEnv } : process.env,
              });

              ptyProcess.onData((data) => { emitOutput(data); });
              ptyProcess.onExit(() => {
                const currentSession = ownedSession.current;
                if (!currentSession) return;
                try {
                  currentSession.currentWs?.send(JSON.stringify({ type: 'terminal:exit' }));
                  currentSession.currentWs?.close(1000, 'Process exited');
                } catch { /* ignore */ }
                // 用本连接持有的会话 ID 结束，避免误杀同名的他人会话
                endSession(currentSession.sessionId, 'process_exited');
              });

              termProcess = {
                write: (d) => ptyProcess.write(d),
                resize: (cols, rows) => ptyProcess.resize(Math.max(1, cols), Math.max(1, rows)),
                kill: () => { try { ptyProcess.kill(); } catch { /* ignore */ } },
                pid: ptyProcess.pid,
              };
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            recordTerminalSessionFailure({
              userId: payload.userId,
              tenantId: payload.tenantId ?? null,
              kind,
              target: canonicalTarget,
              label: shellType ?? '',
              clientIp,
            });
            ws.send(JSON.stringify({ type: 'terminal:error', message: `启动终端失败: ${msg}` }));
            ws.close(1011, 'Failed to start terminal');
            return;
          }

          const newSessionId = newTerminalSessionId();
          const session = registerSession({
            sessionId: newSessionId,
            process: termProcess,
            currentWs: ws,
            userId: payload.userId,
            username: payload.username,
            tenantId: payload.tenantId ?? null,
            kind,
            target: canonicalTarget,
            label,
            clientIp,
          });
          if (!session) {
            // UUIDv7 撞号只可能是程序错误；宁可放弃本次会话也不覆盖已登记会话
            try { termProcess.kill(); } catch { /* ignore */ }
            ws.close(1011, 'Failed to register session');
            return;
          }
          ownedSession.current = session;
          ownWs = ws;
          persistNewTerminalSession(newSessionId, {
            userId: payload.userId,
            tenantId: payload.tenantId ?? null,
            kind,
            target: canonicalTarget,
            label,
            clientIp,
          });

          // 下发权威会话标识，客户端据此重连
          ws.send(JSON.stringify({ type: 'terminal:session', sessionId: newSessionId }));
          if (pendingOutput) {
            const buffered = pendingOutput;
            pendingOutput = '';
            emitOutput(buffered);
          }
          if (initialCwd) {
            try { ws.send(JSON.stringify({ type: 'terminal:cwd', cwd: initialCwd })); } catch { /* ignore */ }
          }
        },

        async onMessage(evt, _ws) {
          // 只操作本连接持有的会话：未通过 onOpen 授权的连接在此直接返回
          const session = ownedSession.current;
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
              // 客户端明确要求关闭：立即结束
              endSession(session.sessionId, 'client_closed');
            }
          } catch { /* ignore malformed */ }
        },

        onClose() {
          const session = ownedSession.current;
          if (!session || !ownWs) return;
          // detachClient 内部比对当前连接：会话被本用户的新连接接管后，
          // 旧连接的关闭事件不得掐断存活会话。
          detachClient(session, ownWs, PTY_IDLE_TIMEOUT_MS);
        },
      };
    }),
  );

  return wsApp;
}

/**
 * Web 终端监控 WebSocket 路由（管理员）
 *
 * 端点：GET /api/ws/terminal-monitor?sessionId=<id>&takeover=1（access token 经 Sec-WebSocket-Protocol 传递）
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
      const sessionId = c.req.query('sessionId') ?? '';
      const allowTakeover = c.req.query('takeover') === '1';
      const payload: JwtPayload | null = (await authenticateAdminWs(c))?.payload ?? null;

      let observer: { send: (data: string) => void } | null = null;
      // 通过租户与权限校验后取得的会话句柄；接管写入以此为准，
      // 避免仅凭 sessionId 就能向他租户会话注入输入。
      let monitored: TerminalSession | null = null;

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

          // acquireSessionForMonitor 内含租户判定；跨租户按「不存在」处理，
          // 避免暴露他租户会话的存在性
          const watched = acquireSessionForMonitor(sessionId, payload);
          if (!watched) {
            ws.send(JSON.stringify({ type: 'monitor:not-found', message: '会话不存在或已结束' }));
            ws.close(1000, 'Session not found');
            return;
          }

          monitored = watched;
          observer = { send: (data: string) => { try { ws.send(data); } catch { /* ignore */ } } };
          const buffer = attachObserver(watched, observer);
          ws.send(JSON.stringify({ type: 'monitor:attached', meta: toSessionMeta(watched), takeover: allowTakeover }));
          if (buffer) ws.send(JSON.stringify({ type: 'terminal:output', data: buffer }));
        },

        async onMessage(evt, _ws) {
          if (!payload || !allowTakeover || !monitored) return;
          if (!(await maintenanceRealtimeAllowed(payload))) { _ws.close(1013, 'Maintenance'); return; }
          try {
            const raw: unknown = typeof evt.data === 'string' ? JSON.parse(evt.data) : null;
            if (!raw || typeof raw !== 'object') return;
            const msg = raw as { type: string; data?: string };
            if (msg.type === 'terminal:input' && typeof msg.data === 'string') {
              writeToSession(monitored, msg.data, payload.userId);
            }
          } catch { /* ignore malformed */ }
        },

        onClose() {
          if (monitored && observer) detachObserver(monitored, observer);
        },
      };
    }),
  );

  return wsApp;
}
