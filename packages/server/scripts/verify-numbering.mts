import { config as loadEnv } from 'dotenv';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createPgClient } from '../src/db/client';

// Run driver contracts and numbering concurrency checks in a newly created database, never in the application's database.
const serverRoot = resolve(import.meta.dirname, '..');
const root = resolve(serverRoot, '../..');
loadEnv({ path: resolve(serverRoot, '.env'), quiet: true });
const base = new URL(process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/zenith_admin');
if (!['localhost', '127.0.0.1'].includes(base.hostname)) throw new Error('编号集成测试只允许本机 PostgreSQL');
const name = `zenith_numbering_qa_${Date.now()}`;
if (!/^zenith_numbering_qa_\d+$/.test(name)) throw new Error('临时数据库名称无效');
const admin = createPgClient(base.toString(), { max: 1 });
let created = false;
let exitCode = 1;
try {
  await admin`create database ${admin(name)}`;
  created = true;
  const target = new URL(base);
  target.pathname = `/${name}`;
  const env = { ...process.env, DATABASE_URL: target.toString(), NUMBERING_TEST_DATABASE_URL: target.toString(), PG_DRIVER_TEST_DATABASE_URL: target.toString(), NODE_ENV: 'development', MULTI_TENANT_MODE: 'true', LICENSE_MODE: 'off' };
  const migration = spawnSync(process.execPath, [resolve(root, 'node_modules/tsx/dist/cli.mjs'), 'src/db/migrate.ts'], { cwd: serverRoot, env, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (migration.status !== 0) {
    process.stderr.write(`${migration.stdout ?? ''}${migration.stderr ?? ''}`);
    throw new Error('临时 QA 数据库迁移失败');
  }
  const tests = spawnSync(process.execPath, [resolve(root, 'node_modules/vitest/vitest.mjs'), 'run',
    'src/db/client.integration.test.ts',
    'src/services/platform/numbering-runtime.postgres.test.ts', 'src/services/biz-demo/biz-leave-numbering.postgres.test.ts', '--maxWorkers=1',
  ], { cwd: serverRoot, env, stdio: 'inherit' });
  exitCode = tests.status ?? 1;
} finally {
  // Only the exact database successfully created by this invocation can be removed.
  if (created) await admin`drop database ${admin(name)} with (force)`;
  await admin.end();
}
process.exitCode = exitCode;
