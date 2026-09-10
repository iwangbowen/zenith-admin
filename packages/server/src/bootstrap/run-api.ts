/**
 * api 角色：HTTP / WebSocket 接入面。
 *
 * 从 src/index.ts 抽出：监听业务端口、承载 WS 升级、订阅跨进程 WS fan-out、加载限流规则、预热 OpenAPI 文档，
 * 以及只与「持有连接的进程」有关的运行时（终端会话持久化 / 对账 / reaper——PTY 进程随本进程存在）。
 * pg-boss 的声明与事件订阅者不在这里：它们对所有角色一致，由 index.ts 统一装配。
 */
import { serve, type ServerType } from '@hono/node-server';
import { WebSocketServer } from 'ws';
import { WS_AUTH_SUBPROTOCOL } from '@zenith/shared/platform';
import { createApp } from '../app';
import { config } from '../config';
import logger from '../lib/logger';
import { startWsFanoutSubscriber, stopWsFanoutSubscriber } from '../lib/ws-fanout';
import { startPresenceSync, stopPresenceSync } from '../lib/ws-manager';
import { startWorkerWatchdog, stopWorkerWatchdog } from '../lib/worker-watchdog';
import { bootstrapRateLimitRules } from '../middleware/rate-limit';
import { warmupOpenApiDoc } from './openapi-warmup';
import { withTimeout } from './shutdown';

export interface ApiRoleHandle {
  /** 停止接入：关闭监听（不再接受新连接 / 请求）、退订 fan-out */
  stopIngress(): Promise<void>;
  /** 排空只属于接入面的运行时：IoT 微批缓冲、按设备串行的派生动作、终端会话、远程主机连接 */
  drainRuntime(): Promise<void>;
}

export async function startApiRole(): Promise<ApiRoleHandle> {
  const { app } = createApp();

  logger.info(`Server starting on port ${config.port}...`);
  // WebSocket 由 @hono/node-server 内建支持：serve() 接管 upgrade 事件，
  // 握手请求走正常 fetch 管线，响应头会被带入握手响应。
  // noServer 必须为 true——HTTP 监听由 serve() 持有，wss 只负责协议升级。
  // maxPayload：单帧上限 64 KiB（SDP offer 通常 < 20 KiB；终端输入极小），默认 100 MiB 可被用于内存 DoS。
  // handleProtocols：客户端经 Sec-WebSocket-Protocol: zenith-auth, <token> 传 access token，
  // 服务端只回显 zenith-auth，绝不把 token 回写到握手响应。
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 64 * 1024,
    handleProtocols: (protocols) => (protocols.has(WS_AUTH_SUBPROTOCOL) ? WS_AUTH_SUBPROTOCOL : false),
  });
  const server: ServerType = serve({ fetch: app.fetch, port: config.port, websocket: { server: wss } });

  // 升级请求被拒绝时（如向非 WS 路径发起 upgrade），socket 已脱离 http.Server 托管，
  // 其上的 'error' 无人监听会直接冒泡成 uncaughtException 打死进程——这是可被未认证
  // 远端触发的 DoS（upgrade 到任意非 WS 路径后立刻 RST 即可）。
  // 在 'connection' 阶段统一兜底：此时拿到的 socket 与后续 upgrade 用的是同一个对象。
  server.on('connection', (socket) => {
    socket.on('error', (err: NodeJS.ErrnoException) => {
      logger.debug('[socket] connection error', { code: err.code, message: err.message });
    });
  });

  logger.info(`Server running at http://localhost:${config.port}`);

  // 启动后异步加载限流规则到内存（失败时使用代码内默认规则）
  void bootstrapRateLimitRules();

  // OpenAPI 文档预热：worker 线程生成（~10s CPU），主线程零阻塞
  warmupOpenApiDoc();

  // 其他进程（worker / 别的 api 副本）产生的推送经此到达本进程持有的连接；失败进入降级不阻断启动
  await startWsFanoutSubscriber();
  // 在线状态跨进程同步：立即广播本进程持有情况，并周期快照 / 淘汰失联节点镜像
  startPresenceSync();
  // 纯 api 进程每分钟自查 worker 心跳：worker 全部下线时评估器已停，只有这里还能发出「worker 缺失」告警
  startWorkerWatchdog();

  // 终端会话持久化：先接生命周期回调，再结算上一轮遗留记录，最后启动活跃时间回写。
  // PTY 进程随本进程存在，只有 api 角色需要；独立 try/catch 以免失败牵连其他启动步骤。
  try {
    const { registerTerminalSessionPersistence, reconcileTerminalSessionsOnStartup, startTerminalSessionReaper } =
      await import('../services/ops/terminal-sessions.service');
    registerTerminalSessionPersistence();
    await reconcileTerminalSessionsOnStartup();
    startTerminalSessionReaper();
  } catch (err) {
    logger.error('Failed to initialize terminal session persistence', err);
  }

  return {
    async stopIngress() {
      stopWorkerWatchdog();
      // 先宣告本进程用户离线（其他进程立刻更新镜像；此时 socket 仍在登记表里，宣告的集合完整），
      // 再主动关闭全部 WS 连接：升级后的 socket 不受 server.close() 管辖却会让它一直等待，
      // 不关就要烧满下面 10s 超时；1001 = Going Away，客户端按既有重连退避回到其他副本
      stopPresenceSync();
      for (const client of wss.clients) {
        try { client.close(1001, 'server_shutdown'); } catch { /* 已断开 */ }
      }
      // 10s 超时保护：防止 keep-alive 连接导致 server.close() 永久阻塞
      const closeServer = new Promise<void>((resolve) => server.close(() => resolve()));
      await withTimeout('closeServer', closeServer, 10_000);
      await withTimeout('stopWsFanoutSubscriber', stopWsFanoutSubscriber(), 3_000);
    },
    async drainRuntime() {
      // IoT 接入：先把微批缓冲里未落库的遥测写完，再排空按设备串行的派生动作（告警判定 / 联动 / 流转）
      const { flushIotIngestBuffer } = await import('../services/iot/iot-ingest-buffer');
      await withTimeout('flushIotIngestBuffer', flushIotIngestBuffer(), 5_000);
      const { drainIotDeviceWork } = await import('../services/iot/iot-ingest-queue');
      await withTimeout('drainIotDeviceWork', drainIotDeviceWork(4_000), 5_000);
      // 结束全部终端会话：避免留下孤儿 PTY 进程与永远停留在 active 的记录
      const { endAllSessions } = await import('../lib/terminal-session-registry');
      const { stopTerminalSessionReaper } = await import('../services/ops/terminal-sessions.service');
      stopTerminalSessionReaper();
      endAllSessions('server_shutdown');
      const { closeAllHostConnections } = await import('../lib/host-exec');
      closeAllHostConnections();
    },
  };
}
