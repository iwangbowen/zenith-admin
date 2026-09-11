/**
 * PDF 导出用 CJK 字体定位。
 *
 * pdfkit 内置的 14 种标准字体没有汉字字形，含中文的 PDF（报表打印 / 审批单）必须嵌入 TTF / OTF。
 * 解析顺序：`REPORT_PDF_FONT_PATH` 显式覆盖 → 随包内置的 Noto Sans SC（`assets/fonts`，SIL OFL 许可，
 * 开发机 / 容器 / 各平台同一份字体，排版一致）→ 常见系统字体路径兜底。
 *
 * 本模块只依赖 Node 内置模块：启动自检与导出库共用，不把 docx / bwip-js 等重依赖拖进启动链路。
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from '../config';

/** 随包内置字体：src/lib 与 dist/lib 相对 assets/ 的目录深度相同，开发与构建产物按同一相对路径解析 */
export const BUNDLED_PDF_FONT_PATH = fileURLToPath(new URL('../../assets/fonts/NotoSansSC-Regular.otf', import.meta.url));

const PDF_FONT_CANDIDATES = [
  ...(config.report.pdfFontPath ? [config.report.pdfFontPath] : []),
  BUNDLED_PDF_FONT_PATH,
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

// 字体安装状态运行期不变：首次探测后缓存，避免每次导出重复 existsSync
let cachedPdfFontPath: string | null | undefined;

export function resolvePdfFontPath(): string | null {
  if (cachedPdfFontPath === undefined) {
    cachedPdfFontPath = PDF_FONT_CANDIDATES.find((candidate) => fs.existsSync(candidate)) ?? null;
  }
  return cachedPdfFontPath;
}

/** 启动自检：找不到任何 CJK 字体时告警一次，而不是等用户点导出才报错 */
export function warnIfPdfFontMissing(logger: { warn: (msg: string) => void }): void {
  if (resolvePdfFontPath()) return;
  logger.warn(
    `[pdf-font] 未找到 CJK 字体（内置字体 ${BUNDLED_PDF_FONT_PATH} 缺失），报表打印 / 审批单 PDF 导出含中文时将失败；`
    + '请恢复 assets/fonts 目录或通过 REPORT_PDF_FONT_PATH 指定字体文件',
  );
}
