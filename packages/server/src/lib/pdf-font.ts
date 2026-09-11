/**
 * PDF 导出用 CJK 字体定位。
 *
 * pdfkit 内置的 14 种标准字体没有汉字字形，含中文的 PDF（报表打印 / 审批单）必须嵌入 TTF / OTF。
 * 解析顺序：
 *   1. `REPORT_PDF_FONT_PATH` 显式覆盖（企业自有字体）
 *   2. 随包内置 Noto Sans SC **全量**（`assets/fonts/NotoSansSC-Regular.otf`，约 8MB，含繁体 / 生僻字；
 *      源码 checkout 天然存在，发布包 / 镜像仅在打包时选择 `--pdf-font=full` / `PDF_FONT=full` 才携带）
 *   3. 随包内置 Noto Sans SC **子集**（`assets/fonts/NotoSansSC-Regular.subset.otf`，约 2.5MB，
 *      GB 2312 ∪ 通用规范汉字表 + 常用符号，由 scripts/build-pdf-font.mjs 构建生成，发布包 / 镜像默认携带）
 *   4. 常见系统字体路径兜底
 * 全量与子集并存时优先全量：把全量字体文件放进 assets/fonts 即完成升级，无需改配置。
 *
 * 本模块只依赖 Node 内置模块：启动自检与导出库共用，不把 docx / bwip-js 等重依赖拖进启动链路。
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from '../config';

/** 随包内置字体：src/lib 与 dist/lib 相对 assets/ 的目录深度相同，开发与构建产物按同一相对路径解析 */
const bundledFontPath = (file: string) => fileURLToPath(new URL(`../../assets/fonts/${file}`, import.meta.url));

export const BUNDLED_PDF_FONT_FULL_PATH = bundledFontPath('NotoSansSC-Regular.otf');
export const BUNDLED_PDF_FONT_SUBSET_PATH = bundledFontPath('NotoSansSC-Regular.subset.otf');

export type PdfFontSource = 'custom' | 'bundled-full' | 'bundled-subset' | 'system';

export interface ResolvedPdfFont {
  path: string;
  source: PdfFontSource;
}

export const PDF_FONT_SOURCE_TEXT: Record<PdfFontSource, string> = {
  custom: 'REPORT_PDF_FONT_PATH 指定的字体',
  'bundled-full': '内置 Noto Sans SC 全量字体',
  'bundled-subset': '内置 Noto Sans SC 子集字体（GB 2312 ∪ 通用规范汉字表；繁体 / 生僻字需换全量字体）',
  system: '系统字体',
};

const SYSTEM_FONT_PATHS = [
  'C:\\Windows\\Fonts\\simhei.ttf',
  'C:\\Windows\\Fonts\\msyh.ttc',
  'C:\\Windows\\Fonts\\simsun.ttc',
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
  '/System/Library/Fonts/PingFang.ttc',
  '/System/Library/Fonts/Hiragino Sans GB.ttc',
];

const PDF_FONT_CANDIDATES: readonly ResolvedPdfFont[] = [
  ...(config.report.pdfFontPath ? [{ path: config.report.pdfFontPath, source: 'custom' as const }] : []),
  { path: BUNDLED_PDF_FONT_FULL_PATH, source: 'bundled-full' },
  { path: BUNDLED_PDF_FONT_SUBSET_PATH, source: 'bundled-subset' },
  ...SYSTEM_FONT_PATHS.map((path) => ({ path, source: 'system' as const })),
];

// 字体安装状态运行期不变：首次探测后缓存，避免每次导出重复 existsSync
let cachedPdfFont: ResolvedPdfFont | null | undefined;

export function resolvePdfFont(): ResolvedPdfFont | null {
  if (cachedPdfFont === undefined) {
    cachedPdfFont = PDF_FONT_CANDIDATES.find((candidate) => fs.existsSync(candidate.path)) ?? null;
  }
  return cachedPdfFont;
}

/** 启动自检：记录实际选用的字体；找不到任何 CJK 字体时告警一次，而不是等用户点导出才报错 */
export function logPdfFontStatus(logger: { info: (msg: string) => void; warn: (msg: string) => void }): void {
  const font = resolvePdfFont();
  if (font) {
    logger.info(`[pdf-font] PDF 导出使用${PDF_FONT_SOURCE_TEXT[font.source]}：${font.path}`);
    return;
  }
  logger.warn(
    `[pdf-font] 未找到 CJK 字体（内置字体 ${BUNDLED_PDF_FONT_SUBSET_PATH} 缺失），报表打印 / 审批单 PDF 导出含中文时将失败；`
    + '请恢复 assets/fonts 目录或通过 REPORT_PDF_FONT_PATH 指定字体文件',
  );
}
