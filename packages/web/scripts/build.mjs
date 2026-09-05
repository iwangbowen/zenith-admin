#!/usr/bin/env node
/**
 * 生产构建编排：三个 SPA 入口各自独立构建到同一 dist（不同 assetsDir），随后生成预压缩文件。
 *
 *   node scripts/build.mjs                 # 生产
 *   node scripts/build.mjs --mode demo     # Demo（MSW）
 *   node scripts/build.mjs --entry main    # 只构建某个入口（调试）
 *
 * 为什么分开构建：见 vite.config.ts 中 ENTRY_INPUTS 的说明。类型检查（tsc -b）仍由 package.json 的
 * build 脚本在本脚本之前执行。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const mode = readArg('--mode');
const only = readArg('--entry');
const entries = only ? [only] : ['main', 'member', 'approval'];
const outDir = resolve(webRoot, 'dist');
// 直接执行 vite 的 bin 脚本：不经 shell，跨平台且无参数转义问题
const viteBin = resolve(dirname(createRequire(import.meta.url).resolve('vite/package.json')), 'bin/vite.js');

if (!only && existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });

for (const entry of entries) {
  const started = Date.now();
  console.log(`\n▶ 构建入口 ${entry}${mode ? `（mode=${mode}）` : ''}`);
  const viteArgs = [viteBin, 'build', '--logLevel', 'warn', ...(mode ? ['--mode', mode] : [])];
  const result = spawnSync(process.execPath, viteArgs, {
    cwd: webRoot,
    stdio: 'inherit',
    env: { ...process.env, ZENITH_WEB_ENTRY: entry },
  });
  if (result.status !== 0) {
    console.error(`✖ 入口 ${entry} 构建失败`);
    process.exit(result.status ?? 1);
  }
  console.log(`✔ 入口 ${entry} 完成，${((Date.now() - started) / 1000).toFixed(1)}s`);
}

const compress = spawnSync(process.execPath, [resolve(webRoot, 'scripts/precompress.mjs'), outDir], { stdio: 'inherit' });
if (compress.status !== 0) process.exit(compress.status ?? 1);

function readArg(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
