import 'dotenv/config';

const otelEnabledEnv = process.env.OTEL_ENABLED;
const otelEndpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

function positiveNumberEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const config = {
  port: Number(process.env.PORT) || 3300,
  jwtSecret: process.env.JWT_SECRET || 'zenith-admin-secret',
  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/zenith_admin',
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
