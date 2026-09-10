// 构建后置步骤：把 CMS 前台岛脚本（src/cms/islands/**）用 esbuild 打成单个 ESM 写入 dist。
// 服务端 tsc 不编译该目录（浏览器端代码，见 tsconfig.json exclude / tsconfig.islands.json）；
// 运行时由 cms/themes/islands-asset.ts 读取本产物并按内容指纹以 _assets/islands.{hash}.js 交付。
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const ENTRY = path.resolve('src/cms/islands/index.ts');
const OUT_FILE = path.resolve('dist/cms/islands/islands.js');

mkdirSync(path.dirname(OUT_FILE), { recursive: true });
// 与 islands-asset.ts 的 ISLANDS_BUILD_OPTIONS 保持一致
const result = await build({
  entryPoints: [ENTRY],
  outfile: OUT_FILE,
  bundle: true,
  minify: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2018',
  legalComments: 'none',
  metafile: true,
});
const bytes = Object.values(result.metafile.outputs).reduce((sum, out) => sum + out.bytes, 0);
console.log(`[build-islands] 已生成 ${path.relative(process.cwd(), OUT_FILE)}（${bytes} bytes）`);
