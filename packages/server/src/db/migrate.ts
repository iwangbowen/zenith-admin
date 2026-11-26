/**
 * 数据库迁移入口。
 *
 * 数据库 schema 的唯一迁移入口；不同部署方式负责在启动服务前调用：
 *   - 开发    `npm run dev`  → scripts/dev.mjs: migrate.ts → seed.ts → 服务
 *   - 生产    显式执行 `npm run start:migrate -w @zenith/server`，初始化时再执行 seed；`npm start` 只启动服务
 *   - 容器    Compose migrate 服务（或 K8s Job）执行迁移，成功后 api / worker 才启动；seed 另行执行
 *
 * 迁移失败必须以非零码退出，让开发脚本和部署依赖阻断服务启动，
 * 避免带着半迁移状态对外提供服务。
 */
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import { config } from '../config';
import logger from '../lib/logger';
import * as schema from './schema';
import { createPgClient } from './client';

const MIGRATIONS_FOLDER = './drizzle';

const client = createPgClient(config.databaseUrl, { max: 1 });
const db = drizzle(client, { schema, casing: 'snake_case' });

try {
  logger.info('Running migrations...');
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  const [schemaState] = await client<{ current: boolean }[]>`
    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'identity_access_grant_items' and column_name = 'menu_id'
    ) and to_regclass('public.identity_access_grant_menus') is null as current
  `;
  if (!schemaState.current) {
    throw new Error('当前数据库使用旧权限基线，请在空库执行迁移和 seed。');
  }
  logger.info('Migrations complete.');
} catch (err) {
  logger.error('Migration failed — 服务不会启动，请修复后重跑。', err);
  await client.end({ timeout: 5 }).catch(() => undefined);
  process.exit(1);
}

await client.end();
process.exit(0);
