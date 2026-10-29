/** Run the existing multi-role relation integration suite in a disposable localhost database. */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { config } from '../src/config';
import { createPgClient } from '../src/db/client';

const endpoint = new URL(config.databaseUrl);
if (!['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)) throw new Error('Only localhost PostgreSQL is allowed');
const database = `zenith_entity_relations_qa_${Date.now()}`;
const admin = createPgClient(config.databaseUrl, { max: 1 });
const require = createRequire(import.meta.url);
const run = (args: string[], env: NodeJS.ProcessEnv) => new Promise<void>((resolve, reject) => {
  const child = spawn(process.execPath, args, { stdio: 'inherit', env, windowsHide: true });
  child.once('error', reject);
  child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Verification child exited ${code}`)));
});
try {
  await admin.unsafe(`CREATE DATABASE "${database}"`);
  endpoint.pathname = `/${database}`;
  const env = { ...process.env, DATABASE_URL: endpoint.toString(), TEST_ENTITY_DATABASE_URL: endpoint.toString() };
  await run(['--import', 'tsx', 'src/db/migrate.ts'], env);
  await run([join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs'), 'run', 'src/services/platform/relations/postgres.integration.test.ts'], env);
} finally {
  // The name is generated here, checked again before the only destructive operation.
  if (!/^zenith_entity_relations_qa_\d+$/.test(database)) throw new Error('Invalid QA database name');
  await admin.unsafe(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
  await admin.end({ timeout: 5 });
}
