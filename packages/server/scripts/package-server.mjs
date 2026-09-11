// 组装 server 部署目录（GitHub Release 的 server zip、Docker server 镜像与本地自行打包共用同一份逻辑）。
//
//   npm run package:server                                  # 默认：子集字体（约 2.5MB），与 Release 产物一致
//   npm run package:server -- --pdf-font=full               # 携带全量 Noto Sans SC（约 8MB，含繁体 / 生僻字）
//   npm run package:server -- --out /tmp/zenith/server      # 输出目录，默认 <仓库根>/release_artifacts/server
//
// 前置：已执行 npm run build -w @zenith/server（产出 dist/ 与 assets/fonts/NotoSansSC-Regular.subset.otf）。
// 输出布局与 Release zip 内的 server/ 目录一致：dist/ · drizzle/ · assets/fonts/ · package.json。
// 字体只放选中的那一份（运行时 src/lib/pdf-font.ts 在全量与子集并存时优先全量，部署后把全量文件
// 复制进 assets/fonts 即可升级，无需改配置）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(SERVER_ROOT, '..', '..');
const FONT_DIR = path.join(SERVER_ROOT, 'assets', 'fonts');
const PDF_FONT_FILES = {
  subset: 'NotoSansSC-Regular.subset.otf',
  full: 'NotoSansSC-Regular.otf',
};

const { values } = parseArgs({
  options: {
    'pdf-font': { type: 'string', default: process.env.PDF_FONT || 'subset' },
    out: { type: 'string', default: path.join(REPO_ROOT, 'release_artifacts', 'server') },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help) {
  console.log('用法：node scripts/package-server.mjs [--pdf-font=subset|full] [--out <目录>]');
  process.exit(0);
}

const pdfFont = values['pdf-font'];
if (!(pdfFont in PDF_FONT_FILES)) {
  console.error(`[package-server] --pdf-font 只接受 subset | full，收到：${pdfFont}`);
  process.exit(1);
}

// --out 的相对路径按调用者所在目录解析（npm run 会把 cwd 切到 packages/server，INIT_CWD 才是用户敲命令的位置）
const outDir = path.resolve(process.env.INIT_CWD || process.cwd(), values.out);
const fontFile = path.join(FONT_DIR, PDF_FONT_FILES[pdfFont]);

const required = [
  [path.join(SERVER_ROOT, 'dist', 'index.js'), '请先执行 npm run build -w @zenith/server'],
  [path.join(SERVER_ROOT, 'drizzle', 'meta', '_journal.json'), 'drizzle/ 迁移目录缺失'],
  [fontFile, pdfFont === 'subset' ? '子集字体未生成，请先执行 npm run build -w @zenith/server（或 npm run build:pdf-font -w @zenith/server）' : '全量字体缺失，请检查仓库 checkout'],
];
for (const [file, hint] of required) {
  if (!fs.existsSync(file)) {
    console.error(`[package-server] 缺少 ${path.relative(SERVER_ROOT, file)}：${hint}`);
    process.exit(1);
  }
}

// 只清理本脚本会写入的顶层条目，不整目录删除：--out 指错位置时不至于误删其他文件
fs.mkdirSync(outDir, { recursive: true });
for (const entry of ['dist', 'drizzle', 'assets', 'package.json']) {
  fs.rmSync(path.join(outDir, entry), { recursive: true, force: true });
}

fs.cpSync(path.join(SERVER_ROOT, 'dist'), path.join(outDir, 'dist'), { recursive: true });
fs.cpSync(path.join(SERVER_ROOT, 'drizzle'), path.join(outDir, 'drizzle'), { recursive: true });
fs.copyFileSync(path.join(SERVER_ROOT, 'package.json'), path.join(outDir, 'package.json'));

const outFontDir = path.join(outDir, 'assets', 'fonts');
fs.mkdirSync(outFontDir, { recursive: true });
fs.copyFileSync(fontFile, path.join(outFontDir, path.basename(fontFile)));
fs.copyFileSync(path.join(FONT_DIR, 'OFL.txt'), path.join(outFontDir, 'OFL.txt'));

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)}MB`;
console.log(`[package-server] 已输出到 ${outDir}（PDF 字体：${pdfFont}，${PDF_FONT_FILES[pdfFont]} ${mb(fs.statSync(fontFile).size)}）`);
