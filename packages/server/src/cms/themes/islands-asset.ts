/**
 * 岛脚本资产装配：浏览器端源码 src/cms/islands/**（不参与服务端 tsc）由 esbuild 打成单个 ESM，
 * 以 `_assets/islands.{hash}.js` 内容指纹外链交付（与 theme.{hash}.css 同一套落盘 / 自愈 / immutable 机制）。
 *
 * - 生产：读取 scripts/build-islands.mjs 预构建到 dist/cms/islands/islands.js 的产物，进程内缓存。
 * - 开发 / 测试：按源码 mtime 签名在内存中按需构建（改岛源码刷新即生效，不触发进程重启）。
 * - 内容与站点无关（站点参数经 data-* 属性传入），全部站点共用同一份 hash。
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** 开发态源码入口（src/cms/islands/index.ts） */
const ISLANDS_SRC_DIR = path.resolve(HERE, '../islands');
const ISLANDS_ENTRY = path.join(ISLANDS_SRC_DIR, 'index.ts');
/** 生产预构建产物（dist/cms/islands/islands.js） */
const ISLANDS_DIST_FILE = path.resolve(HERE, '../islands/islands.js');
const IS_PROD = process.env.NODE_ENV === 'production';

export interface IslandsAsset {
  /** 打包后的 ESM 源码 */
  js: string;
  /** 内容指纹 */
  hash: string;
  /** 站点静态目录内的相对路径：_assets/islands.{hash}.js */
  relPath: string;
}

let cache: { signature: string; asset: IslandsAsset } | null = null;

function toAsset(js: string): IslandsAsset {
  const hash = createHash('sha1').update(js).digest('hex').slice(0, 10);
  return { js, hash, relPath: `_assets/islands.${hash}.js` };
}

/** 源码目录（不含测试）的 mtime + size 签名，作为开发态缓存失效依据 */
function sourceSignature(dir: string): string {
  const parts: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
        const stat = statSync(abs);
        parts.push(`${path.relative(dir, abs)}:${stat.mtimeMs}:${stat.size}`);
      }
    }
  };
  walk(dir);
  return parts.sort().join('|');
}

/** esbuild 打包参数：生产脚本 scripts/build-islands.mjs 与此保持一致 */
export const ISLANDS_BUILD_OPTIONS = {
  bundle: true,
  minify: true,
  format: 'esm',
  platform: 'browser',
  // 与 fetch / closest / type=module 同代浏览器；?. 与 ?? 由 esbuild 降级
  target: 'es2018',
  legalComments: 'none',
} as const;

async function buildInMemory(): Promise<string> {
  const { build } = await import('esbuild');
  const result = await build({ ...ISLANDS_BUILD_OPTIONS, entryPoints: [ISLANDS_ENTRY], write: false, logLevel: 'silent' });
  return result.outputFiles[0]?.text ?? '';
}

/** 获取当前岛脚本资产（生产读预构建；开发按源码签名内存构建并缓存） */
export async function getIslandsAsset(): Promise<IslandsAsset> {
  if (IS_PROD) {
    if (!cache) cache = { signature: 'dist', asset: toAsset(readFileSync(ISLANDS_DIST_FILE, 'utf8')) };
    return cache.asset;
  }
  const signature = sourceSignature(ISLANDS_SRC_DIR);
  if (cache?.signature === signature) return cache.asset;
  const asset = toAsset(await buildInMemory());
  cache = { signature, asset };
  return asset;
}

/** 仅供测试：清空进程内缓存 */
export function resetIslandsAssetCache(): void {
  cache = null;
}
