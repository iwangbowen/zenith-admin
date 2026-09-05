#!/usr/bin/env node
/**
 * 为构建产物生成预压缩文件（.gz = gzip level 9，.br = brotli quality 11），供 nginx `gzip_static` /
 * `brotli_static` 直接下发：压缩率优于动态 gzip（默认 level 1），且零运行时 CPU。
 *
 *   node scripts/precompress.mjs <distDir>
 *
 * 只处理文本类资源且 ≥ 1KB；已压缩格式（图片 / 字体 / wasm）跳过。brotli 11 单线程很慢，
 * 这里按 CPU 数开 worker 并行；产物随 dist 一起打包进镜像。
 */
import { readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { availableParallelism } from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { brotliCompressSync, constants as zc, gzipSync } from 'node:zlib';

const TEXT_EXT = new Set(['.js', '.mjs', '.css', '.html', '.svg', '.json', '.txt', '.xml', '.webmanifest']);
const MIN_BYTES = 1024;

if (!isMainThread) {
  const stats = { files: 0, raw: 0, gz: 0, br: 0 };
  for (const p of workerData.files) {
    const buf = readFileSync(p);
    const gz = gzipSync(buf, { level: 9 });
    const br = brotliCompressSync(buf, { params: { [zc.BROTLI_PARAM_QUALITY]: 11, [zc.BROTLI_PARAM_SIZE_HINT]: buf.length } });
    writeFileSync(`${p}.gz`, gz);
    writeFileSync(`${p}.br`, br);
    stats.files++;
    stats.raw += buf.length;
    stats.gz += gz.length;
    stats.br += br.length;
  }
  parentPort.postMessage(stats);
} else {
  const dist = process.argv[2];
  if (!dist) {
    console.error('用法：node scripts/precompress.mjs <distDir>');
    process.exit(2);
  }
  const started = Date.now();
  const files = [];
  walk(dist, files);
  const workers = Math.max(1, Math.min(availableParallelism(), files.length));
  const buckets = Array.from({ length: workers }, () => []);
  files.forEach((f, i) => buckets[i % workers].push(f));
  const results = await Promise.all(buckets.map((bucket) => new Promise((resolve, reject) => {
    const w = new Worker(new URL(import.meta.url), { workerData: { files: bucket } });
    w.once('message', resolve);
    w.once('error', reject);
  })));
  const total = results.reduce((a, s) => ({ files: a.files + s.files, raw: a.raw + s.raw, gz: a.gz + s.gz, br: a.br + s.br }), { files: 0, raw: 0, gz: 0, br: 0 });
  console.log(`预压缩完成：${total.files} 个文件，raw ${mb(total.raw)} → gz ${mb(total.gz)} / br ${mb(total.br)}，${workers} 线程 ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { walk(p, out); continue; }
    if (!TEXT_EXT.has(extname(name)) || st.size < MIN_BYTES) continue;
    out.push(p);
  }
}

function mb(n) {
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
