import 'dotenv/config';

const otelEnabledEnv = process.env.OTEL_ENABLED;
const otelEndpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

function positiveNumberEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// ─── HTTP Log Types ───────────────────────────────────────────────────────────

/**
 * HTTP 日志记录级别（从低到高）：
 * - off:     不记录任何内容
 * - access:  仅记录方法/URL/状态码/耗时（最轻量，无 body 开销）
 * - headers: access + 请求/响应 Headers
 * - body:    access + 请求/响应 Body（不含 Headers）
 * - full:    全量：access + Headers + Body（对标 Logbook 默认模式）
 */
export type HttpLogLevel = 'off' | 'access' | 'headers' | 'body' | 'full';

/** 日志输出格式 */
export type HttpLogFormat = 'text' | 'json' | 'curl';

/** HTTP 方法枚举 */
export type HttpLogMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD';

/**
 * 解析方法级日志级别覆盖。
 * 读取形如 `{prefix}_GET`、`{prefix}_POST` 的环境变量。
 * 示例：HTTP_LOG_INCOMING_METHOD_GET=off, HTTP_LOG_INCOMING_METHOD_POST=full
 */
function parseMethodOverrides(envPrefix: string): Partial<Record<HttpLogMethod, HttpLogLevel>> {
  const methods: HttpLogMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'];
  const valid = new Set<string>(['off', 'access', 'headers', 'body', 'full']);
  const result: Partial<Record<HttpLogMethod, HttpLogLevel>> = {};
  for (const m of methods) {
    const val = process.env[`${envPrefix}_${m}`];
    if (val && valid.has(val)) result[m] = val as HttpLogLevel;
  }
  return result;
}

export const config = {
  port: Number(process.env.PORT) || 3300,
  jwtSecret: process.env.JWT_SECRET || 'zenith-admin-secret',
  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/zenith_admin',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  database: {
    maxConnections: positiveNumberEnv('DATABASE_MAX_CONNECTIONS', 10),
    idleTimeoutSeconds: positiveNumberEnv('DATABASE_IDLE_TIMEOUT_SECONDS', 20),
    connectTimeoutSeconds: positiveNumberEnv('DATABASE_CONNECT_TIMEOUT_SECONDS', 10),
    ssl: process.env.DATABASE_SSL === 'true',
  },
  multiTenantMode: process.env.MULTI_TENANT_MODE === 'true',
  serverTimingEnabled: process.env.SERVER_TIMING_ENABLED === 'true',
  // Body size limits（单位：字节）。0 表示不限制（使用运行时默认）
  requestBodyLimit: Number(process.env.REQUEST_BODY_LIMIT) || 0,
  // 请求超时（毫秒）。0 或未设置表示不启用超时中间件
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS) || 0,
  // CSRF 允许的来源列表，逗号分隔。留空则不限制（开发模式）
  // 生产环境示例：ALLOWED_ORIGINS=https://admin.example.com,https://app.example.com
  allowedOrigins: (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  redis: {
    // 优先使用 REDIS_URL（支持带密码的连接，如 redis://:password@127.0.0.1:6379/0）
    url: process.env.REDIS_URL,
    // 无 REDIS_URL 时使用逐项配置
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    db: Number(process.env.REDIS_DB) || 0,
    // 所有 key 的统一命名空间前缀，避免与其他应用串 key
    keyPrefix: process.env.REDIS_KEY_PREFIX ?? 'zenith:',
  },
  log: {
    level: process.env.LOG_LEVEL || 'info',
    dir: process.env.LOG_DIR || 'logs',
    maxFiles: process.env.LOG_MAX_FILES || '30d',
  },
  /**
   * HTTP 流量日志配置（对标 Zalando Logbook）。
   *
   * 入站（incoming）：拦截进入本系统的请求，通过 Hono 中间件实现。
   * 出站（outgoing）：拦截本系统通过 http-client.ts 发出的外部请求。
   *
   * 级别说明：off | access | headers | body | full
   *   - 支持全局默认级别 + 方法级别覆盖（互相独立）
   *   - GET 类查询通常设为 access，POST/PUT/PATCH 写接口设为 body 或 full
   *
   * 格式：text（多行可读）| json（结构化 NDJSON）| curl（可直接重放的 curl 命令）
   */
  httpLog: {
    incoming: {
      /** 全局开关，默认关闭。生产环境按需开启 */
      enabled: process.env.HTTP_LOG_INCOMING_ENABLED === 'true',
      /** 默认记录级别，未被方法级别覆盖时生效 */
      level: (process.env.HTTP_LOG_INCOMING_LEVEL ?? 'access') as HttpLogLevel,
      /** 方法级别覆盖：HTTP_LOG_INCOMING_METHOD_{GET|POST|PUT|PATCH|DELETE}=level */
      methods: parseMethodOverrides('HTTP_LOG_INCOMING_METHOD'),
      /** 输出格式：text | json | curl */
      format: (process.env.HTTP_LOG_INCOMING_FORMAT ?? 'json') as HttpLogFormat,
      /** 单个 body 最大捕获字节数，超出时截断。0 = 不限制 */
      maxBodyBytes: positiveNumberEnv('HTTP_LOG_INCOMING_MAX_BODY', 65536),
      /**
       * 是否同时记录响应体。需克隆 Response，有轻微内存/CPU 开销，默认关闭。
       * 建议仅在排查问题时临时开启，或在开发环境启用。
       */
      logResponseBody: process.env.HTTP_LOG_INCOMING_RESPONSE_BODY === 'true',
      /**
       * 不记录日志的路径前缀，逗号分隔（追加在内置排除列表之后）。
       * 内置排除：/api/health、/api/ws、/docs、/api/ui、/api/metrics
       * 可额外追加：HTTP_LOG_INCOMING_EXCLUDE=/api/files,/api/db-backups
       */
      excludePaths: (process.env.HTTP_LOG_INCOMING_EXCLUDE ?? '').split(',').map((s) => s.trim()).filter(Boolean),
      /**
       * 是否写入独立的 http-traffic-YYYY-MM-DD.log 文件（每日滚动）。
       * false = 合并进 app-*.log（带 [http-in] 前缀）
       * true  = 独立文件，适合流量分析场景（日志量大时推荐）
       */
      separateFile: process.env.HTTP_LOG_INCOMING_FILE === 'true',
    },
    outgoing: {
      /** 全局开关，默认关闭 */
      enabled: process.env.HTTP_LOG_OUTGOING_ENABLED === 'true',
      /** 默认记录级别（出站默认 full，便于排查第三方集成问题） */
      level: (process.env.HTTP_LOG_OUTGOING_LEVEL ?? 'full') as HttpLogLevel,
      /** 方法级别覆盖：HTTP_LOG_OUTGOING_METHOD_{GET|POST|PUT|PATCH|DELETE}=level */
      methods: parseMethodOverrides('HTTP_LOG_OUTGOING_METHOD'),
      /** 输出格式：text | json | curl */
      format: (process.env.HTTP_LOG_OUTGOING_FORMAT ?? 'json') as HttpLogFormat,
      /** 单个 body 最大捕获字节数（出站默认较小，第三方接口 body 通常不大） */
      maxBodyBytes: positiveNumberEnv('HTTP_LOG_OUTGOING_MAX_BODY', 4096),
      /**
       * 是否记录出站响应体。
       * 出站接口关注响应，默认开启（可通过 HTTP_LOG_OUTGOING_RESPONSE_BODY=false 关闭）。
       */
      logResponseBody: process.env.HTTP_LOG_OUTGOING_RESPONSE_BODY !== 'false',
      /**
       * 是否将出站日志写入独立的 http-traffic-*.log 文件（而非合并进 app-*.log）。
       * 默认 false（合并写入），设为 true 可避免与应用日志混淆。
       */
      separateFile: process.env.HTTP_LOG_OUTGOING_FILE === 'true',
    },
  },
  otel: {
    enabled: otelEnabledEnv === 'true' || (otelEnabledEnv !== 'false' && Boolean(otelEndpoint)),
    serviceName: process.env.OTEL_SERVICE_NAME || 'zenith-admin-server',
    serviceVersion: process.env.OTEL_SERVICE_VERSION || process.env.npm_package_version || 'unknown',
  },
  oauth: {
    github: {
      clientId: process.env.OAUTH_GITHUB_CLIENT_ID || '',
      clientSecret: process.env.OAUTH_GITHUB_CLIENT_SECRET || '',
    },
    dingtalk: {
      clientId: process.env.OAUTH_DINGTALK_CLIENT_ID || '',
      clientSecret: process.env.OAUTH_DINGTALK_CLIENT_SECRET || '',
    },
    wechatWork: {
      corpId: process.env.OAUTH_WECHAT_WORK_CORP_ID || '',
      agentId: process.env.OAUTH_WECHAT_WORK_AGENT_ID || '',
      secret: process.env.OAUTH_WECHAT_WORK_SECRET || '',
    },
    callbackBaseUrl: process.env.OAUTH_CALLBACK_BASE_URL || 'http://localhost:5373',
  },
};
