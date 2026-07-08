/**
 * HTTP 流量日志核心模块（对标 Zalando Logbook）
 *
 * 提供入站（Hono 中间件）和出站（http-client.ts）请求/响应的结构化日志能力。
 * 支持：
 *  - 5 档日志级别（off / access / headers / body / full）
 *  - 全局 + 方法级别覆盖配置
 *  - 3 种输出格式（json / text / curl）
 *  - 自动脱敏（Headers 中的 Authorization/Cookie，Body 中的 password/secret/token）
 *  - 独立日志文件（http-traffic-YYYY-MM-DD.log）或合并进主日志
 *  - 关联 ID（correlation = request-id）将同一对请求/响应关联
 */

import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import type { HttpLogLevel, HttpLogFormat, HttpLogMethod } from '../config';
import { config } from '../config';
import appLogger from './logger';
import { redactBody } from './sanitize';

export type { HttpLogLevel, HttpLogFormat, HttpLogMethod };

// ─── Header Redaction ─────────────────────────────────────────────────────────

const REDACT_HEADER_NAMES = /^(authorization|cookie|set-cookie|proxy-authorization|x-auth-token|x-api-key)$/i;
const REDACT_HEADER_VALUE_KEYS = /(token|secret|password|api[_-]?key)/i;

/**
 * 对 Headers 中的敏感字段进行遮蔽（替换为 "***"）。
 * 匹配规则：
 *  1. Header 名称在已知敏感名称列表中（Authorization、Cookie 等）
 *  2. Header 名称包含 token / secret / password / api-key 等关键词
 */
export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = REDACT_HEADER_NAMES.test(k) || REDACT_HEADER_VALUE_KEYS.test(k) ? '***' : v;
  }
  return out;
}

/** 将标准 `Headers` 对象转换为普通 `Record<string, string>` */
export function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((v, k) => { out[k] = v; });
  return out;
}

// ─── Log Level Resolution ─────────────────────────────────────────────────────

/**
 * 确定某个 HTTP 方法的有效日志级别。
 * 方法级覆盖 > 全局默认级别。
 *
 * @param method  HTTP 方法（大写），如 'GET'
 * @param globalLevel  全局默认级别
 * @param methodOverrides  方法级别覆盖映射
 */
export function resolveLevel(
  method: string,
  globalLevel: HttpLogLevel,
  methodOverrides?: Partial<Record<HttpLogMethod, HttpLogLevel>>,
): HttpLogLevel {
  return methodOverrides?.[method.toUpperCase() as HttpLogMethod] ?? globalLevel;
}

// ─── Log Entry Type ───────────────────────────────────────────────────────────

/**
 * 单条 HTTP 日志条目。
 * 请求和响应分开记录，通过 `correlation` 关联。
 */
export interface HttpLogEntry {
  /** 关联 ID（= request-id），将同一次交互的请求和响应条目链接在一起 */
  correlation: string;
  /** 流量方向：incoming = 进入本系统，outgoing = 本系统发出 */
  direction: 'incoming' | 'outgoing';
  /** 请求阶段或响应阶段 */
  phase: 'request' | 'response';
  method: string;
  /** 完整 URL（入站为路径，出站为完整 URL） */
  url: string;
  /** HTTP 响应状态码（仅 response 阶段） */
  statusCode?: number;
  /** 请求耗时（毫秒，仅 response 阶段） */
  durationMs?: number;
  /** 脱敏后的请求 Headers（level >= headers 时存在） */
  requestHeaders?: Record<string, string>;
  /** 响应 Headers（level >= headers 时存在） */
  responseHeaders?: Record<string, string>;
  /** 脱敏后的请求 Body（level >= body 时存在） */
  requestBody?: unknown;
  /** 响应 Body（level >= body 且 logResponseBody=true 时存在） */
  responseBody?: unknown;
  /** 出站请求重试序号（仅出站 outgoing 有效，从 1 开始） */
  attempt?: number;
  /** 错误信息（仅出站请求失败时存在） */
  error?: string;
  /** 记录时间（YYYY-MM-DD HH:mm:ss） */
  timestamp: string;
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function jsonFormat(entry: HttpLogEntry): string {
  return JSON.stringify(entry);
}

function textFormat(entry: HttpLogEntry): string {
  const dirLabel = entry.direction === 'incoming' ? 'IN' : 'OUT';
  const lines: string[] = [];

  if (entry.phase === 'request') {
    const attemptSuffix = entry.attempt && entry.attempt > 1 ? ` (attempt ${entry.attempt})` : '';
    lines.push(`>> [${dirLabel}] ${entry.method} ${entry.url}${attemptSuffix}`);
    if (entry.requestHeaders) {
      for (const [k, v] of Object.entries(entry.requestHeaders)) {
        lines.push(`   ${k}: ${v}`);
      }
    }
    if (entry.requestBody !== undefined) {
      const bodyStr = typeof entry.requestBody === 'string'
        ? entry.requestBody
        : JSON.stringify(entry.requestBody);
      lines.push(`   body: ${bodyStr}`);
    }
  } else {
    const status = entry.statusCode ?? '-';
    const ms = entry.durationMs === undefined ? '' : ` (${entry.durationMs}ms)`;
    lines.push(`<< [${dirLabel}] ${entry.method} ${entry.url} → ${status}${ms}`);
    if (entry.responseHeaders) {
      for (const [k, v] of Object.entries(entry.responseHeaders)) {
        lines.push(`   ${k}: ${v}`);
      }
    }
    if (entry.responseBody !== undefined) {
      const bodyStr = typeof entry.responseBody === 'string'
        ? entry.responseBody
        : JSON.stringify(entry.responseBody);
      lines.push(`   body: ${bodyStr}`);
    }
    if (entry.error) {
      lines.push(`   error: ${entry.error}`);
    }
  }

  return lines.join('\n');
}

/** curl 格式中单引号的转义替换字符串 */
const ESCAPE_SINGLE_QUOTE = String.raw`\'`;

function curlFormat(entry: HttpLogEntry): string {
  // 响应阶段使用 text 格式（curl 命令只能表达请求）
  if (entry.phase === 'response') return textFormat(entry);

  const parts: string[] = [`curl -X ${entry.method} '${entry.url}'`];
  if (entry.requestHeaders) {
    for (const [k, v] of Object.entries(entry.requestHeaders)) {
      parts.push(`  -H '${k}: ${v.replaceAll("'", ESCAPE_SINGLE_QUOTE)}'`);
    }
  }
  if (entry.requestBody !== undefined) {
    const body = typeof entry.requestBody === 'string'
      ? entry.requestBody
      : JSON.stringify(entry.requestBody);
    parts.push(`  -d '${body.replaceAll("'", ESCAPE_SINGLE_QUOTE)}'`);
  }
  return parts.join(' \\\n');
}

export function formatEntry(entry: HttpLogEntry, format: HttpLogFormat): string {
  switch (format) {
    case 'json': return jsonFormat(entry);
    case 'curl': return curlFormat(entry);
    case 'text':
    default:     return textFormat(entry);
  }
}

// ─── Separate HTTP Traffic Logger ─────────────────────────────────────────────

let _httpTrafficLogger: winston.Logger | null = null;

/**
 * 懒加载独立的 HTTP 流量 winston logger。
 * 写入 http-traffic-YYYY-MM-DD.log，每行是原始的格式化字符串（不带 winston 元信息）。
 */
function getHttpTrafficLogger(): winston.Logger {
  if (_httpTrafficLogger) return _httpTrafficLogger;

  const { combine, timestamp, printf } = winston.format;
  // 独立文件使用原始格式：每行只写时间戳 + 消息体，不添加 level 标签
  const rawLine = printf(({ message, timestamp: ts }) => `${ts as string} ${message as string}`);

  _httpTrafficLogger = winston.createLogger({
    level: 'info',
    transports: [
      new DailyRotateFile({
        dirname: config.log.dir,
        filename: 'http-traffic-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        maxFiles: config.log.maxFiles,
        zippedArchive: true,
        format: combine(
          timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
          rawLine,
        ),
      }),
    ],
  });

  return _httpTrafficLogger;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/**
 * 截断过大的 body。超出 maxBytes 时返回描述字符串（保留原始大小信息）。
 * maxBytes <= 0 时不截断。
 */
export function truncateBody(body: unknown, maxBytes: number): unknown {
  if (body === null || body === undefined) return body;
  const str = typeof body === 'string' ? body : JSON.stringify(body);
  if (maxBytes > 0 && str.length > maxBytes) {
    return `[truncated, ${str.length} bytes > limit ${maxBytes}]`;
  }
  return body;
}

/** 尝试将字符串解析为 JSON 对象；失败时返回原始字符串 */
export function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * 对 body 进行脱敏处理。
 * 支持对象（深度脱敏）和 JSON 字符串（先解析再脱敏）。
 */
export function safeRedactBody(body: unknown): unknown {
  if (body === null || body === undefined) return body;
  if (typeof body === 'string') {
    try {
      return redactBody(JSON.parse(body));
    } catch {
      return body; // 非 JSON 字符串，不脱敏
    }
  }
  return redactBody(body);
}

/**
 * 将出站请求 body 转换为可安全记录的日志表示。
 *
 * 对二进制、流式、表单等非 JSON 类型**不记录内容**，仅记录类型和大小占位符，
 * 避免将文件内容或二进制数据写入日志。
 *
 * @param body      原始请求 body（来自 HttpRequestOptions.body）
 * @param maxBytes  body 截断阈值
 */
export function safeRedactBodyForLog(body: unknown, maxBytes: number): unknown {
  if (body === null || body === undefined) return undefined;
  // FormData（文件上传）：只记录字段名，不记录内容
  if (body instanceof FormData) {
    const keys = [...body.keys()].join(',');
    return `[FormData fields: ${keys || '(empty)'}]`;
  }
  // Blob（二进制数据）：只记录大小和 MIME 类型
  if (body instanceof Blob) {
    return `[Blob: ${body.size} bytes, type=${body.type || 'unknown'}]`;
  }
  // ArrayBuffer / TypedArray（原始二进制）
  if (body instanceof ArrayBuffer) {
    return `[ArrayBuffer: ${body.byteLength} bytes]`;
  }
  if (ArrayBuffer.isView(body)) {
    return `[Binary: ${body.byteLength} bytes]`;
  }
  // ReadableStream（流式上传）
  if (body instanceof ReadableStream) {
    return '[ReadableStream]';
  }
  // URLSearchParams：安全的键值对，直接记录字符串
  if (body instanceof URLSearchParams) {
    return body.toString();
  }
  // 普通 JSON 对象 / 字符串：使用现有脱敏逻辑
  return truncateBody(safeRedactBody(body), maxBytes);
}

// ─── Write ────────────────────────────────────────────────────────────────────

/**
 * 将 HttpLogEntry 格式化后写入日志。
 *
 * @param entry       日志条目
 * @param format      输出格式（json / text / curl）
 * @param separateFile 是否写入独立的 http-traffic-*.log（false = 合并进 app-*.log）
 */
export function writeHttpLogEntry(
  entry: HttpLogEntry,
  format: HttpLogFormat,
  separateFile: boolean,
): void {
  const msg = formatEntry(entry, format);
  if (separateFile) {
    getHttpTrafficLogger().info(msg);
  } else {
    // 合并进主日志，带方向前缀便于 grep
    const tag = entry.direction === 'incoming' ? '[http-in]' : '[http-out]';
    appLogger.info(`${tag} ${msg}`);
  }
}
