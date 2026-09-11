// 构建后置步骤：从随仓库的全量 Noto Sans SC 生成 PDF 导出用的字体子集。
//
// 全量字体 assets/fonts/NotoSansSC-Regular.otf（约 8.3MB，3.1 万字形）覆盖 GB 18030 全部汉字与繁体，
// 但发布包 / 镜像默认只携带子集 assets/fonts/NotoSansSC-Regular.subset.otf（约 2.5MB）：
// GB 2312 ∪《通用规范汉字表》8230 字 + 常用符号，字符集定义在 pdf-font-charset/charset.mjs。
// 子集化用 harfbuzz（subset-font → harfbuzzjs WASM），纯 Node，无需 Python / fonttools，耗时约 0.3s。
//
// 子集文件已 gitignore，`npm run build -w @zenith/server` 每次重新生成；运行时解析顺序见 src/lib/pdf-font.ts，
// 打包 / 镜像选用哪一份见 scripts/package-server.mjs（--pdf-font）与 Dockerfile（--build-arg PDF_FONT）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fontkit from 'fontkit';
import subsetFont from 'subset-font';
import { buildPdfFontCodePoints } from './pdf-font-charset/charset.mjs';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FULL_FONT = path.join(SERVER_ROOT, 'assets', 'fonts', 'NotoSansSC-Regular.otf');
const SUBSET_FONT = path.join(SERVER_ROOT, 'assets', 'fonts', 'NotoSansSC-Regular.subset.otf');

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)}MB`;
const rel = (file) => path.relative(SERVER_ROOT, file).replaceAll(path.sep, '/');
const hex = (cp) => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;

if (!fs.existsSync(FULL_FONT)) {
  console.error(`[build-pdf-font] 全量字体缺失：${rel(FULL_FONT)}，无法生成子集`);
  process.exit(1);
}

const source = fs.readFileSync(FULL_FONT);
const codePoints = buildPdfFontCodePoints();
const text = Array.from(codePoints, (cp) => String.fromCodePoint(cp)).join('');
const output = await subsetFont(source, text, { targetFormat: 'sfnt' });

// 自检：全量字体里有、子集里却丢了的码点 → 子集化配置错误，直接失败而不是发出一份缺字的字体
const full = fontkit.openSync(FULL_FONT);
const subset = fontkit.create(output);
const lost = [...codePoints].filter((cp) => full.hasGlyphForCodePoint(cp) && !subset.hasGlyphForCodePoint(cp));
if (lost.length > 0) {
  console.error(`[build-pdf-font] 子集丢失 ${lost.length} 个字形，示例：${lost.slice(0, 10).map(hex).join(' ')}`);
  process.exit(1);
}

fs.writeFileSync(SUBSET_FONT, output);
const unavailable = [...codePoints].filter((cp) => !full.hasGlyphForCodePoint(cp)).length;
console.log(
  `[build-pdf-font] ${codePoints.size} 个码点（全量字体本身不含 ${unavailable} 个）→ ${rel(SUBSET_FONT)}：`
  + `${mb(source.length)} → ${mb(output.length)}，${subset.numGlyphs} 个字形`,
);
