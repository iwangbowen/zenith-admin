/**
 * 数据库迁移入口。
 *
 * 三条启动链路都先跑它、再跑服务，因此这里是唯一的 schema 收敛点：
 *   - 开发    `npm run dev`  → scripts/dev.mjs: migrate.ts → seed.ts → 服务
 *   - 生产    `npm start`    → node dist/db/migrate.js && node dist/index.js
 *   - 容器    docker/entrypoint.sh → node dist/db/migrate.js → node dist/index.js
 *
 * 迁移失败必须以非零码退出，让 `migrate && start` 链路阻断服务启动，
 * 避免带着半迁移状态对外提供服务。
 */
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { config } from '../config';
import logger from '../lib/logger';
import * as schema from './schema';

const MIGRATIONS_FOLDER = './drizzle';

const client = postgres(config.databaseUrl, { max: 1, options: `-c TimeZone=${process.env.APP_TIME_ZONE || process.env.TZ || 'Asia/Shanghai'}` });
const db = drizzle(client, { schema, casing: 'snake_case' });

try {
  logger.info('Running migrations...');
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  logger.info('Migrations complete.');
} catch (err) {
  logger.error('Migration failed — 服务不会启动，请修复后重跑。', err);
  await client.end({ timeout: 5 }).catch(() => undefined);
  process.exit(1);
}

await client.end();
process.exit(0);
