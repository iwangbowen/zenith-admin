// PDF 导出字体子集的字符集定义（build-pdf-font.mjs 与测试共用，只依赖 Node 内置模块）。
//
// - 汉字：GB 2312 ∪《通用规范汉字表》(2013)，共 8230 字，数据文件在本目录（来源与格式见各文件头部）。
//   前者是历史兼容基线，后者补入姓氏人名 / 地名 / 科技术语用字（喆、玥、淼、昇……），审批单里最常见的缺字来源就是人名。
// - 符号：按 Unicode 区段整段收录，覆盖 GB 2312 符号区（A1–A9 区）及报表 / 审批单常用的单位、货币、带圈数字、勾叉等。
// 不在此范围的字符（繁体、日韩汉字、Ext-B 生僻字）需要全量字体，见 docs/guide/deployment.md「PDF 字体」。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CHARSET_DIR = path.dirname(fileURLToPath(import.meta.url));

/** 汉字数据文件（本目录内） */
export const HANZI_CHARSET_FILES = ['gb2312.txt', 'tgh2013.txt'];

/** 符号区段 [起, 止, 说明]，首尾均含 */
export const SYMBOL_RANGES = [
  [0x0020, 0x007e, 'ASCII'],
  [0x00a0, 0x00ff, 'Latin-1 补充（¥ § © ° ± × ÷ 及带声调拉丁字母）'],
  [0x0100, 0x024f, '拉丁扩展 A / B（拼音 ā ē ǎ ǐ ǖ 等）'],
  [0x02b0, 0x02ff, '修饰字母（ˇ ˉ ˊ ˋ ˙）'],
  [0x0370, 0x03ff, '希腊字母'],
  [0x0400, 0x04ff, '西里尔字母'],
  [0x2000, 0x206f, '通用标点（— … ‘ ’ “ ” ‰ ※）'],
  [0x2070, 0x209f, '上下标'],
  [0x20a0, 0x20cf, '货币符号（€ ₩ ₹）'],
  [0x2100, 0x214f, '类字母符号（℃ ℉ № ™）'],
  [0x2150, 0x218f, '数字形式（Ⅰ ⅰ 与分数）'],
  [0x2190, 0x21ff, '箭头'],
  [0x2200, 0x22ff, '数学运算符（∈ ∑ √ ∞ ≠ ≤ ≥）'],
  [0x2460, 0x24ff, '带圈 / 带括号字母数字（① ⑴ ⒈ ⓐ）'],
  [0x2500, 0x257f, '制表符'],
  [0x25a0, 0x25ff, '几何图形（■ □ ▲ ○ ●）'],
  [0x2600, 0x26ff, '杂项符号（☆ ★ ☐ ☑ ☒ ♂ ♀）'],
  [0x2700, 0x27bf, '装饰符号（✓ ✔ ✕ ✗ ❶）'],
  [0x3000, 0x303f, 'CJK 标点（、。〈〉《》「」【】〔〕）'],
  [0x3040, 0x30ff, '日文平假名 / 片假名'],
  [0x3100, 0x312f, '注音符号'],
  [0x3200, 0x32ff, '带圈 CJK（㈠ ㊀ ㊣）'],
  [0x3300, 0x33ff, 'CJK 兼容（㎡ ㎏ ㎝ ㏄）'],
  [0xfe30, 0xfe4f, 'CJK 兼容形式（竖排标点）'],
  [0xff00, 0xffef, '全角 / 半角形式（，．：；？！（）０-９ Ａ-Ｚ ａ-ｚ）'],
];

/** 读取一个汉字数据文件，返回码点集合；`#` 行为注释，空白忽略 */
export function readCharsetFile(file) {
  const text = fs.readFileSync(path.join(CHARSET_DIR, file), 'utf8');
  const codePoints = new Set();
  for (const line of text.split('\n')) {
    if (line.startsWith('#')) continue;
    for (const ch of line.replace(/\s+/g, '')) codePoints.add(ch.codePointAt(0));
  }
  return codePoints;
}

/** 子集字体应覆盖的全部码点（汉字数据文件 ∪ 符号区段） */
export function buildPdfFontCodePoints() {
  const codePoints = new Set();
  for (const file of HANZI_CHARSET_FILES) {
    for (const cp of readCharsetFile(file)) codePoints.add(cp);
  }
  for (const [from, to] of SYMBOL_RANGES) {
    for (let cp = from; cp <= to; cp++) codePoints.add(cp);
  }
  return codePoints;
}
