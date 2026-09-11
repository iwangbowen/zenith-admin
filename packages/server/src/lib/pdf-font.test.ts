/**
 * PDF 字体定位与内置子集字符集。
 *
 * 覆盖：
 * - resolvePdfFont 解析顺序：REPORT_PDF_FONT_PATH → 内置全量 → 内置子集 → 系统字体 → null，并缓存首次结果
 * - logPdfFontStatus：找到时 info 记录来源，找不到时 warn
 * - scripts/pdf-font-charset：GB 2312 / 通用规范汉字表数据文件完整（6763 / 8105 字），
 *   合并后 8230 字，人名用字（喆 / 玥）与常用符号在子集内、繁体与 Ext-B 生僻字不在
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildPdfFontCodePoints, HANZI_CHARSET_FILES, readCharsetFile, SYMBOL_RANGES } from '../../scripts/pdf-font-charset/charset.mjs';

const state = vi.hoisted(() => ({ existing: new Set<string>(), customFontPath: '' as string | undefined }));

// 只替换 existsSync：pdf-font.ts 用它探测字体文件；charset.mjs 读数据文件仍走真实 readFileSync
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, default: { ...actual.default, existsSync: (file: string) => state.existing.has(file) } };
});
vi.mock('../config', () => ({ config: { report: { get pdfFontPath() { return state.customFontPath || undefined; } } } }));

async function loadModule() {
  vi.resetModules();
  return import('./pdf-font');
}

describe('resolvePdfFont', () => {
  beforeEach(() => {
    state.existing.clear();
    state.customFontPath = '';
  });

  it('REPORT_PDF_FONT_PATH 优先于内置字体', async () => {
    state.customFontPath = '/opt/fonts/corp.otf';
    const mod = await loadModule();
    state.existing.add('/opt/fonts/corp.otf').add(mod.BUNDLED_PDF_FONT_FULL_PATH).add(mod.BUNDLED_PDF_FONT_SUBSET_PATH);
    expect(mod.resolvePdfFont()).toEqual({ path: '/opt/fonts/corp.otf', source: 'custom' });
  });

  it('全量与子集并存时优先全量', async () => {
    const mod = await loadModule();
    state.existing.add(mod.BUNDLED_PDF_FONT_FULL_PATH).add(mod.BUNDLED_PDF_FONT_SUBSET_PATH);
    expect(mod.resolvePdfFont()).toEqual({ path: mod.BUNDLED_PDF_FONT_FULL_PATH, source: 'bundled-full' });
  });

  it('发布包默认只有子集时使用子集', async () => {
    const mod = await loadModule();
    state.existing.add(mod.BUNDLED_PDF_FONT_SUBSET_PATH).add('C:\\Windows\\Fonts\\msyh.ttc');
    expect(mod.resolvePdfFont()).toEqual({ path: mod.BUNDLED_PDF_FONT_SUBSET_PATH, source: 'bundled-subset' });
  });

  it('内置字体缺失时兜底到系统字体，且首次结果被缓存', async () => {
    const mod = await loadModule();
    state.existing.add('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc');
    expect(mod.resolvePdfFont()).toEqual({ path: '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', source: 'system' });
    state.existing.add(mod.BUNDLED_PDF_FONT_FULL_PATH);
    expect(mod.resolvePdfFont()?.source).toBe('system');
  });

  it('配置的自定义字体文件不存在时按内置顺序继续', async () => {
    state.customFontPath = '/missing/font.otf';
    const mod = await loadModule();
    state.existing.add(mod.BUNDLED_PDF_FONT_SUBSET_PATH);
    expect(mod.resolvePdfFont()?.source).toBe('bundled-subset');
  });

  it('什么都找不到返回 null', async () => {
    const mod = await loadModule();
    expect(mod.resolvePdfFont()).toBeNull();
  });
});

describe('logPdfFontStatus', () => {
  beforeEach(() => {
    state.existing.clear();
    state.customFontPath = '';
  });

  it('找到字体时 info 记录来源与路径', async () => {
    const mod = await loadModule();
    state.existing.add(mod.BUNDLED_PDF_FONT_SUBSET_PATH);
    const logger = { info: vi.fn(), warn: vi.fn() };
    mod.logPdfFontStatus(logger);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info.mock.calls[0][0]).toContain(mod.PDF_FONT_SOURCE_TEXT['bundled-subset']);
    expect(logger.info.mock.calls[0][0]).toContain(mod.BUNDLED_PDF_FONT_SUBSET_PATH);
  });

  it('找不到字体时 warn 一次', async () => {
    const mod = await loadModule();
    const logger = { info: vi.fn(), warn: vi.fn() };
    mod.logPdfFontStatus(logger);
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).toContain('REPORT_PDF_FONT_PATH');
  });
});

describe('pdf-font-charset（内置子集字符集）', () => {
  const codePoints = buildPdfFontCodePoints();
  const has = (ch: string) => codePoints.has(ch.codePointAt(0)!);

  it('数据文件完整：GB 2312 6763 字、通用规范汉字表 8105 字，合并 8230 字', () => {
    expect(HANZI_CHARSET_FILES).toEqual(['gb2312.txt', 'tgh2013.txt']);
    const gb2312 = readCharsetFile('gb2312.txt');
    const tgh2013 = readCharsetFile('tgh2013.txt');
    expect(gb2312.size).toBe(6763);
    expect(tgh2013.size).toBe(8105);
    expect(new Set([...gb2312, ...tgh2013]).size).toBe(8230);
    for (const set of [gb2312, tgh2013]) {
      for (const cp of set) expect(cp >= 0x3400, `U+${cp.toString(16)} 不是汉字`).toBe(true);
    }
  });

  it('符号区段合法且不重叠', () => {
    const sorted = [...SYMBOL_RANGES].sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < sorted.length; i++) {
      expect(sorted[i][0]).toBeLessThanOrEqual(sorted[i][1]);
      if (i > 0) expect(sorted[i][0]).toBeGreaterThan(sorted[i - 1][1]);
    }
  });

  it('常用字、人名用字与报表符号在子集内', () => {
    for (const ch of ['中', '国', '鑫', '壹', '贰', '叁', '喆', '玥', '淼', '昇', '㵐']) expect(has(ch), ch).toBe(true);
    for (const ch of ['A', '9', '￥', '¥', '€', '％', '，', '。', '《', '》', '①', '⑩', 'Ⅲ', '℃', '㎡', '√', '×', '≤', '☑', '✓', '—', '…', 'ā', 'ǔ']) {
      expect(has(ch), ch).toBe(true);
    }
  });

  it('繁体、日文汉字与 Ext-B 生僻字不在子集内（需全量字体）', () => {
    for (const ch of ['國', '藝', '龘', '𠀀']) expect(has(ch), ch).toBe(false);
  });
});
