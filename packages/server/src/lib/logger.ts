/**
 * 应用主日志：原生 pino 实例（NDJSON 结构化输出）。
 *
 * 输出（worker 线程 transport，序列化之外的开销不占主线程）：
 *  - 文件：pino-roll 按天轮转 `logs/app.YYYY-MM-DD.N.log`，保留 LOG_MAX_FILES 份，NDJSON
 *  - 控制台：默认输出 NDJSON 到 stdout（交给容器日志采集）；
 *    LOG_CONSOLE_PRETTY=true 时经 pino-pretty 彩色单行输出（本地开发用）
 *  - 例外：Windows 终端直接运行时控制台输出留在主线程（见 consoleOnMainThread）
 *
 * 调用约定（`hooks.logMethod` 归一化，两种写法都支持）：
 *  - pino 原生：`logger.info({ userId }, '登录成功')`，新代码优先用这种
 *  - 消息在前：`logger.info('登录成功', meta)` —— meta 为 Error 记入 `err`（带堆栈），
 *    普通对象作为结构化字段合并，其余类型记入 `meta` 字段
 *  - 请求级子 logger：`logger.child({ requestId })` 原生可用
 *
 * warn / error / fatal 在 logMethod hook 写入点计入 log-metrics 计数器
 * （监控告警的 logErrorPerMin / logWarnPerMin；hook 仅在级别启用时触发）。
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import {
  pino, destination, levels, multistream, stdSerializers, transport,
  type DestinationStream, type Logger, type LogFn, type TransportTargetOptions,
} from 'pino';
import type { PrettyOptions } from 'pino-pretty';
import { trace, isSpanContextValid } from '@opentelemetry/api';
import { currentTraceId } from './trace-context';
import { config } from '../config';
import { recordLogLevel } from './log-metrics';
import { PROCESS_HOSTNAME } from './process-identity';

// pino-pretty 只在 Windows 终端分支于主线程加载；其余场景由 worker 按 target 名自行解析
const require = createRequire(import.meta.url);
const loadPinoPretty = () => require('pino-pretty') as typeof import('pino-pretty');

/**
 * 进程角色标签（日志行 role 字段、日志文件名后缀）。
 * 大量单测以局部对象 mock `../config`，那里没有 roles；日志模块是几乎所有模块图的公共依赖，
 * 不能因此在加载期抛错，缺省按全量进程处理。
 */
const processRoleLabel: string = (config as { roles?: { label?: string } }).roles?.label ?? 'all';

/**
 * 级别方法同时接受两种写法（由 logMethod hook 归一化）：
 *  - pino 原生：`(mergingObject, message?)`
 *  - 消息在前：`(message, meta?)`（meta 只允许一个；多参 printf 请用原生写法）
 */
interface AppLogFn {
  <T extends object>(obj: T, msg?: string, ...args: unknown[]): void;
  (msg: string, meta?: unknown): void;
  (obj: unknown, msg?: string): void;
}
type LevelMethod = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
/** 原生 pino Logger，级别方法放宽为双写法签名；child() 返回原生严格签名的 Logger */
export type AppLogger = Omit<Logger, LevelMethod> & Record<LevelMethod, AppLogFn>;

const WARN = levels.values.warn;
const ERROR = levels.values.error;

/** 消息含 printf 插值符时走 pino 原生插值，不做参数归一 */
const PRINTF_TOKEN_RE = /%[sdjoO]/;

/** 带本地时区偏移的 ISO 8601 时间戳（如 2026-08-28T22:25:41.649+08:00），人读机读两便 */
function localIsoTime(): string {
  const now = new Date();
  const offsetMinutes = -now.getTimezoneOffset();
  const local = new Date(now.getTime() + offsetMinutes * 60_000).toISOString().slice(0, -1);
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const offset = `${String(Math.trunc(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  return `,"time":"${local}${sign}${offset}"`;
}

/**
 * logMethod hook：
 * 1. warn 及以上写入点计数（fatal 归入 error 桶）
 * 2. 将「消息在前」的两参调用翻转为 pino 原生的 `(mergingObject, message)`
 *    （官方文档 hooks.logMethod 示例即参数翻转用法）
 */
function logMethod(this: Logger, args: Parameters<LogFn>, method: LogFn, level: number): void {
  if (level >= ERROR) recordLogLevel('error');
  else if (level >= WARN) recordLogLevel('warn');

  const [first, second, ...rest] = args as unknown[];
  if (typeof first === 'string' && second !== undefined && rest.length === 0 && !PRINTF_TOKEN_RE.test(first)) {
    const merge = second instanceof Error
      ? { err: second }
      : typeof second === 'object' && second !== null
        ? second
        : { meta: second };
    (method as (obj: object, msg: string) => void).call(this, merge, first);
    return;
  }
  method.apply(this, args);
}

const fileTarget: TransportTargetOptions = {
  target: 'pino-roll',
  // targets 多目标模式下 per-target level 缺省是 'info'（api.md），
  // 必须显式跟随 logger 级别，否则 LOG_LEVEL=debug/trace 的日志到不了输出
  level: config.log.level,
  options: {
    // 同一台机器上 api 与 worker 各自一份文件：pino-roll 带 removeOtherLogFiles，共用前缀会互删轮转文件。
    // 全量进程保持历史文件名 app.*，拆分角色后为 app-api.* / app-worker.*
    file: path.join(config.log.dir, processRoleLabel === 'all' ? 'app' : `app-${processRoleLabel}`),
    frequency: 'daily',
    dateFormat: 'yyyy-MM-dd',
    extension: '.log',
    mkdir: true,
    limit: { count: config.log.maxFiles, removeOtherLogFiles: true },
  },
};

const prettyOptions: PrettyOptions = {
  colorize: true,
  translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
  ignore: 'pid,hostname',
  singleLine: true,
};

const consoleTarget: TransportTargetOptions = config.log.pretty
  ? { target: 'pino-pretty', level: config.log.level, options: prettyOptions }
  : { target: 'pino/file', level: config.log.level, options: { destination: 1 } };

/**
 * Windows 控制台把写入 fd 1 的字节按当前代码页解码（中文系统为 GBK），worker transport 里
 * sonic-boom 直写 fd 的 UTF-8 因此显示为乱码（如 "✔" → "鉁?"）；主线程的 process.stdout 是
 * TTY 流，libuv 经 WriteConsoleW 以 UTF-16 输出，与代码页无关。
 * 仅 Windows 且 stdout 为终端（本地直接起服务 / 跑脚本）时控制台输出留在主线程，文件仍走 worker；
 * 管道 / 容器（concurrently、docker logs）下 stdout 不是 TTY，字节由下游按 UTF-8 解码，不受影响。
 */
const consoleOnMainThread = process.platform === 'win32' && process.stdout.isTTY === true;

/**
 * 测试进程（vitest）直写 stdout，不启用 worker transport：
 * 每个测试进程各起 worker 线程并发写同一日志文件既无意义，
 * 又会在进程 teardown 时产生 thread-stream 竞态导致偶发 unhandled error。
 */
const options = {
  level: config.log.level,
  timestamp: localIsoTime,
  // 每行带进程角色：多进程部署时按 role 过滤 / 聚合日志（pid / hostname 沿用 pino 默认）
  base: { pid: process.pid, hostname: PROCESS_HOSTNAME, role: processRoleLabel },
  // 级别保持 pino 默认的数字形式（10-60，行首第一个键），日志查看器与采集端按数字映射
  serializers: { err: stdSerializers.err, error: stdSerializers.err },
  hooks: { logMethod },
  // 链路关联：所有日志行自动带 reqId（= hono requestId = traceId），
  // 与 pino-http 请求级子 logger 的 reqId 字段同名同值（请求内 child bindings 优先，值相同）；
  // worker / 作业 / 任务等请求作用域之外的日志由此补齐链路键。
  // OTel 启用时追加 trace_id / span_id（W3C 十六进制格式），使外部 APM（Grafana / Datadog 等）
  // 能从日志行直接跳转到对应 trace；@opentelemetry/api 是纯 API 包，无 SDK 依赖，静态导入无负担
  mixin: () => {
    const reqId = currentTraceId();
    const fields: Record<string, string> = reqId ? { reqId } : {};
    if (config.otel.enabled) {
      const spanContext = trace.getActiveSpan()?.spanContext();
      if (spanContext && isSpanContextValid(spanContext)) {
        fields.trace_id = spanContext.traceId;
        fields.span_id = spanContext.spanId;
      }
    }
    return fields;
  },
} satisfies Parameters<typeof pino>[0];

function createLogger(): Logger {
  if (process.env.VITEST) return pino(options, destination({ dest: 1, sync: true }));
  if (!consoleOnMainThread) return pino({ ...options, transport: { targets: [fileTarget, consoleTarget] } });

  const consoleStream: DestinationStream = config.log.pretty
    ? loadPinoPretty()({ ...prettyOptions, destination: process.stdout })
    : process.stdout;
  // multistream 各路 level 缺省同样是 'info'，必须显式跟随 logger 级别
  return pino(options, multistream([
    { level: config.log.level, stream: transport({ targets: [fileTarget] }) },
    { level: config.log.level, stream: consoleStream },
  ]));
}

const logger = createLogger() as unknown as AppLogger;

export default logger;
