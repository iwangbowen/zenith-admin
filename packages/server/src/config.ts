import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT) || 3300,
  jwtSecret: process.env.JWT_SECRET || 'zenith-admin-secret',
  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/zenith_admin',
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
