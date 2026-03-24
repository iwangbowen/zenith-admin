import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT) || 3300,
  jwtSecret: process.env.JWT_SECRET || 'zenith-admin-secret',
  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/zenith_admin',
  log: {
    level: process.env.LOG_LEVEL || 'info',
    dir: process.env.LOG_DIR || 'logs',
    maxFiles: process.env.LOG_MAX_FILES || '30d',
  },
};
