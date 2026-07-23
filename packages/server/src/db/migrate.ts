import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { config } from '../config';
import logger from '../lib/logger';
import * as schema from './schema';
import { runAppDataMigrations } from './data-migrations';

const MIGRATIONS_FOLDER = './drizzle';

// ─── 迁移基线检查点 ─────────────────────────────────────────────────────────────
// 旧迁移链（0000..0200，共 201 条）已被压缩为单条基线迁移（0000_baseline）。
// 存量环境升级到基线版本前，必须先升级到 v0.79.x（旧链头 0200_sweet_mulholland_black）跑完全部旧迁移。
const LEGACY_HEAD_WHEN = 1782999778760; // 旧链最后一条迁移在 journal 中的 when 毫秒值
const LEGACY_HEAD_TAG = '0200_sweet_mulholland_black';

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

/**
 * 基线收养（baseline adoption）：
 * drizzle migrator 依据 drizzle.__drizzle_migrations 中最后一条记录的 created_at
 * 与 journal 各条目 when 的比较决定执行哪些迁移。基线化后，已跑完旧链的存量库
 * 若不处理，会试图对已有表重放基线 SQL 而失败。此函数在 migrate() 前将存量库的
 * 旧迁移记录原子替换为基线记录：
 * - 全新库（无记录表或表为空）→ 跳过，migrate() 正常执行基线
 * - 已收养或基线之后的库（max(created_at) >= 基线 when）→ 跳过
 * - 存量库且恰好位于旧链头 → 清空旧记录并写入基线记录（stamp）
 * - 存量库但未到旧链头 → 抛错，提示先升级到检查点版本
 */
async function adoptBaseline(client: postgres.Sql) {
  const [{ present }] = await client<{ present: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations'
    ) AS present`;
  if (!present) return;

  const [{ last }] = await client<{ last: string | null }[]>`
    SELECT max(created_at)::bigint AS last FROM drizzle.__drizzle_migrations`;
  const lastApplied = last === null ? 0 : Number(last);
  if (lastApplied === 0) return;

  const journal = JSON.parse(
    readFileSync(`${MIGRATIONS_FOLDER}/meta/_journal.json`, 'utf8'),
  ) as { entries: JournalEntry[] };
  const baseline = journal.entries[0];
  if (lastApplied >= baseline.when) return;

  if (lastApplied !== LEGACY_HEAD_WHEN) {
    throw new Error(
      `数据库迁移版本低于基线检查点（当前 created_at=${lastApplied}，要求 ${LEGACY_HEAD_WHEN} / ${LEGACY_HEAD_TAG}）。` +
        '请先将部署升级到 v0.79.x 跑完全部旧迁移，再升级到当前版本。',
    );
  }

  const baselineSql = readFileSync(`${MIGRATIONS_FOLDER}/${baseline.tag}.sql`, 'utf8');
  const hash = createHash('sha256').update(baselineSql).digest('hex');
  await client.begin(async (tx) => {
    await tx`TRUNCATE drizzle.__drizzle_migrations`;
    await tx`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${hash}, ${baseline.when})`;
    // 旧链遗留差异对齐：三个唯一索引在基线中是 UNIQUE 约束（同名同义）。
    // 用 UNIQUE USING INDEX 原地转换（复用现有索引，零重建、不锁表扫描）。
    await tx.unsafe(`
      DO $$
      DECLARE
        item record;
      BEGIN
        FOR item IN
          SELECT * FROM (VALUES
            ('tenant_identity_providers', 'tenant_identity_providers_tenant_code_unique'),
            ('user_identity_accounts', 'user_identity_accounts_provider_subject_unique'),
            ('user_identity_accounts', 'user_identity_accounts_user_provider_unique')
          ) AS v(tbl, idx)
        LOOP
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = item.idx)
             AND EXISTS (
               SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE c.relname = item.idx AND c.relkind = 'i' AND n.nspname = 'public'
             ) THEN
            EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I UNIQUE USING INDEX %I', item.tbl, item.idx, item.idx);
          END IF;
        END LOOP;
      END $$;
    `);
  });
  logger.info(`Migration history baselined: legacy chain (…${LEGACY_HEAD_TAG}) adopted as ${baseline.tag}.`);
}

const client = postgres(config.databaseUrl, { max: 1 });
const db = drizzle(client, { schema });
logger.info('Running migrations...');
await adoptBaseline(client);
await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
const appliedDataMigrations = await runAppDataMigrations(db);
if (appliedDataMigrations.length) logger.info(`Application data migrations applied: ${appliedDataMigrations.join(', ')}`);
logger.info('Migrations complete.');
await client.end();
process.exit(0);
