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
  },
  log: {
    level: process.env.LOG_LEVEL || 'info',
    dir: process.env.LOG_DIR || 'logs',
    maxFiles: process.env.LOG_MAX_FILES || '30d',
  },
};
