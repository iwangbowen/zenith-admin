/**
 * Real PostgreSQL / Redis / loopback HTTP probe, isolated from all business data.
 * Run from packages/server: npx tsx scripts/domain-events/benchmark-boundary.mts
 *   --mode legacy --source-root ../../output/outbox-baseline/source/packages/server --out ../../output/outbox-baseline/boundary.json
 * Candidate: --mode durable --schema-sql drizzle/<event-outbox-migration>.sql
 * This measures the production event primitive with synthetic business/effect rows;
 * it does NOT claim end-to-end payment, workflow or production Webhook coverage.
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import dotenv from 'dotenv';
import Redis from 'ioredis';
import postgres from 'postgres';

const argv = process.argv.slice(2);
const option = (name: string, fallback: string) => { const index = argv.indexOf(`--${name}`); return index < 0 ? fallback : argv[index + 1]!; };
const mode = option('mode', 'legacy');
if (!['legacy', 'durable'].includes(mode)) throw new Error('--mode must be legacy or durable');
const serverRoot = resolve(import.meta.dirname, '../..');
const sourceRoot = resolve(option('source-root', serverRoot));
const worker = argv.includes('--worker');
dotenv.config({ path: resolve(serverRoot, '.env'), quiet: true });
const originalConnection = process.env.DATABASE_URL;
if (!originalConnection) throw new Error('DATABASE_URL is required');
const connection = new URL(originalConnection);
if (!['localhost', '127.0.0.1', '[::1]'].includes(connection.hostname)) throw new Error('This benchmark accepts localhost PostgreSQL only');
process.env.NODE_ENV = 'development';
process.env.LOG_LEVEL = 'fatal';
process.env.LOG_CONSOLE_PRETTY = 'false';
process.env.LOG_DIR = resolve(serverRoot, '../../output/outbox-baseline/runtime-logs');
const moduleAt = (file: string) => pathToFileURL(resolve(sourceRoot, file)).href;
const clientOptions = { max: 4, connection: { TimeZone: 'UTC' } };
const domain = 'outbox-boundary-benchmark';
const consumerKey = `${domain}:local-effect`;
const sourcePrefix = option('run-id', randomUUID());

async function registerPrimitive() {
  await import('@hono/zod-openapi');
  const { sql } = await import('drizzle-orm');
  if (mode === 'durable') {
    const registry = await import(moduleAt('src/lib/domain-events/registry.ts'));
    registry.registerEventConsumer({ key: consumerKey, matches: (event: { domain: string }) => event.domain === domain,
      handle: async (tx: { execute: (query: unknown) => Promise<unknown> }, event: { eventId: string; payload: { key: string } }) => {
        await tx.execute(sql`insert into boundary_receipts (key,event_id) values (${event.payload.key},${event.eventId}) on conflict do nothing`);
        return { outcome: 'completed' };
      } });
    const { db } = await import(moduleAt('src/db/index.ts'));
    const { publishEventInTx } = await import(moduleAt('src/lib/domain-events/publish.ts'));
    const engine = await import(moduleAt('src/lib/domain-events/engine.ts'));
    return {
      async publish(key: string, eventId: string) {
        await db.transaction(async (tx: { execute: (query: unknown) => Promise<unknown> }) => {
          await tx.execute(sql`insert into boundary_facts (key) values (${key})`);
          await publishEventInTx(tx, { domain, eventType: `${domain}.created`, tenantId: null, businessKey: key, orderingKey: key,
            subjectRefs: [{ type: 'workflow.instance', key, role: 'primary' }], payload: { key }, eventId });
        });
      },
      async recover() {
        let batches = 0;
        for (;;) {
          const rows = await engine.claimEventConsumers(4);
          if (!rows.length) break;
          await Promise.all(rows.map((row: unknown) => engine.executeEventConsumer(row)));
          if (++batches > 10000) throw new Error('Consumer failed to drain');
        }
      },
    };
  }
  const { openEventBus } = await import(moduleAt('src/lib/open-event-bus.ts'));
  const sqlClient = postgres(process.env.DATABASE_URL!, clientOptions);
  const pending = new Set<Promise<unknown>>();
  openEventBus.onAny((event: { eventId: string; data: { key: string } }) => {
    const operation = sqlClient`insert into boundary_receipts (key,event_id) values (${event.data.key},${event.eventId}) on conflict do nothing`.then(() => undefined);
    pending.add(operation); void operation.finally(() => pending.delete(operation)); return operation;
  });
  return {
    async publish(key: string, eventId: string) {
      await sqlClient.begin((tx) => tx`insert into boundary_facts (key) values (${key})`);
      openEventBus.emit({ type: `${domain}.created`, tenantId: null, eventId, data: { key } });
    },
    async recover() { await new Promise<void>((done) => setImmediate(done)); await Promise.all(pending); },
    close: () => sqlClient.end(),
  };
}

async function closePrimitive() {
  const { closeDb } = await import(moduleAt('src/db/index.ts')); await closeDb();
  const { closeRedis } = await import(moduleAt('src/lib/redis.ts')); await closeRedis();
}
if (worker) {
  const primitive = await registerPrimitive();
  const count = Number(option('samples', '100'));
  const latencies: number[] = [];
  if (argv.includes('--crash-after-publish')) {
    await primitive.publish(`${sourcePrefix}:crash`, randomUUID());
    // The business commit has completed; emit() has queued a microtask, which dies here.
    process.exit(86);
  }
  for (let i = 0; i < count; i++) {
    const start = performance.now(); await primitive.publish(`${sourcePrefix}:${i}`, randomUUID()); latencies.push(performance.now() - start);
  }
  const drainStart = performance.now(); await primitive.recover(); const drainMs = performance.now() - drainStart;
  await primitive.close?.(); await closePrimitive();
  process.stdout.write(`${JSON.stringify({ latencies, drainMs })}\n`);
} else {
  const name = `zenith_outbox_bench_${Date.now()}_${randomUUID().slice(0, 8)}`;
  if (!/^zenith_outbox_bench_\d+_[a-f0-9]{8}$/.test(name)) throw new Error('Invalid disposable database name');
  const admin = postgres(originalConnection, { max: 1, connection: { TimeZone: 'UTC' } });
  connection.pathname = `/${name}`;
  const isolated = connection.toString();
  let probe: ReturnType<typeof postgres> | undefined;
  let redis: Redis | undefined;
  const http = createServer(async (request, response) => { for await (const _chunk of request) { /* consume body */ } response.writeHead(200, { 'content-type': 'application/json' }); response.end('{"accepted":true}'); });
  const samples = Number(option('samples', '100'));
  if (!Number.isInteger(samples) || samples < 10 || samples > 10000) throw new Error('--samples must be from 10 to 10000');
  const percentile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)];
  const stats = (values: number[]) => ({ samples: values.length, p50Ms: percentile(values, .5), p95Ms: percentile(values, .95), p99Ms: percentile(values, .99) });
  const child = (extra: string[]) => new Promise<{ code: number | null; output: string }>((done, reject) => {
    const processChild = spawn(process.execPath, ['--import', 'tsx', import.meta.filename, '--worker', '--mode', mode, '--source-root', sourceRoot,
      '--run-id', sourcePrefix, '--samples', String(samples), ...extra], { cwd: serverRoot, env: { ...process.env, DATABASE_URL: isolated }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => { processChild.kill(); reject(new Error('Benchmark child exceeded its time budget')); }, Math.max(120000, samples * 100));
    let output = '', error = ''; processChild.stdout.on('data', (chunk) => { output += String(chunk); }); processChild.stderr.on('data', (chunk) => { error += String(chunk); });
    processChild.once('error', (failure) => { clearTimeout(timer); reject(failure); });
    processChild.once('exit', (code) => { clearTimeout(timer); const detail = error.replaceAll(originalConnection, '[redacted database]').replaceAll(isolated, '[redacted database]');
      if (code === 0 || code === 86) done({ code, output }); else reject(new Error(`Benchmark child failed (${code}): ${detail.slice(-2000)}`)); });
  });
  try {
    await admin.unsafe(`create database "${name}"`);
    probe = postgres(isolated, clientOptions);
    await probe.unsafe('create table boundary_facts (key text primary key); create table boundary_receipts (key text primary key,event_id uuid unique not null);');
    if (mode === 'durable') {
      const schemaFile = option('schema-sql', ''); if (!schemaFile) throw new Error('Durable mode requires --schema-sql');
      await probe.unsafe('create table tenants (id integer primary key)');
      const schemaSql = await readFile(resolve(schemaFile), 'utf8');
      for (const statement of schemaSql.split('--> statement-breakpoint').filter((part) => part.trim())) await probe.unsafe(statement);
    }
    const crash = await child(['--crash-after-publish']);
    if (crash.code !== 86) throw new Error('Fault injection did not exit at the expected boundary');
    const [before] = await probe`select (select count(*)::int from boundary_facts) facts,(select count(*)::int from boundary_receipts) receipts`;
    const normal = await child([]);
    const lines = normal.output.trim().split(/\r?\n/); const timing = JSON.parse(lines.at(-1)!);
    const [after] = await probe`select (select count(*)::int from boundary_facts) facts,(select count(*)::int from boundary_receipts) receipts`;
    const redisOptions = { maxRetriesPerRequest: 1, connectTimeout: 3000, retryStrategy: () => null };
    redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL, redisOptions) : new Redis({ ...redisOptions, host: process.env.REDIS_HOST ?? '127.0.0.1', port: Number(process.env.REDIS_PORT ?? 6379), password: process.env.REDIS_PASSWORD, db: Number(process.env.REDIS_DB ?? 0) });
    const pings: number[] = []; for (let i = 0; i < samples; i++) { const t = performance.now(); await redis.ping(); pings.push(performance.now() - t); }
    await new Promise<void>((done) => http.listen(0, '127.0.0.1', done));
    const address = http.address(); if (!address || typeof address === 'string') throw new Error('HTTP fixture did not bind');
    const requests: number[] = []; for (let i = 0; i < samples; i++) { const t = performance.now(); const response = await fetch(`http://127.0.0.1:${address.port}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ eventId: randomUUID() }), signal: AbortSignal.timeout(5000) }); await response.text(); if (!response.ok) throw new Error('HTTP fixture failed'); requests.push(performance.now() - t); }
    const result = { kind: 'real-infrastructure-event-primitive-probe', mode, sourceRoot, generatedAt: new Date().toISOString(), node: process.version,
      scope: 'Synthetic source/effect rows using the production event primitive; queue scheduling and business services excluded. HTTP and Redis measured separately.',
      fixture: { postgres: 'unique disposable localhost database', redis: 'PING only; no mutations', http: 'anonymous loopback receiver' },
      crashAfterPublish: { exitCode: crash.code, beforeRecovery: before, afterRecovery: { facts: Number(after.facts) - samples, receipts: Number(after.receipts) - samples } },
      normal: { producerTransaction: stats(timing.latencies), explicitDrainMs: timing.drainMs, expectedFacts: samples + 1, ...after },
      redisPing: stats(pings), loopbackHttpPost: stats(requests) };
    if (Number(after.facts) !== samples + 1 || Number(after.receipts) !== samples + (mode === 'durable' ? 1 : 0)) throw new Error('Unexpected source/effect count after recovery');
    const output = resolve(option('out', '../../output/outbox-boundary.json')); await mkdir(dirname(output), { recursive: true }); await writeFile(output, `${JSON.stringify(result, null, 2)}\n`); console.log(JSON.stringify(result, null, 2));
  } finally {
    if (http.listening) await new Promise<void>((done, reject) => http.close((error) => error ? reject(error) : done()));
    await redis?.quit(); await probe?.end();
    await admin.unsafe(`drop database if exists "${name}" with (force)`); await admin.end();
  }
}
