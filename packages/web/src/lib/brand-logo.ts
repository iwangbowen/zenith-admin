/**
 * 品牌 logo（Z 形折带）的几何与配色比例——唯一来源。
 *
 * - 页面内：`components/AppLogo.tsx` 用 `logoStopCssColor()` 生成 `color-mix(var(--semi-color-primary))`，
 *   颜色跟随所在区域的主题色（含分区深色）；
 * - 标签页：favicon 读不到页面 CSS 变量，`applyThemeFavicon()` 用同一比例在 JS 侧算出实色，
 *   以 data URL 写回 `<link rel="icon">`；
 * - 静态兜底：`public/favicon.svg` 与 `icons/*.png` 为默认飞书蓝，由 `scripts/gen-icons.mjs` 生成。
 */

export const LOGO_VIEW_BOX = '0 0 64 64';
export const LOGO_STROKE_WIDTH = 2.5;

/** 一个渐变端点：主色占比（%）+ 与之混合的黑 / 白 */
export type LogoMixStop = readonly [primaryPercent: number, mixWith: '#fff' | '#000'];

export interface LogoFace {
  readonly key: 'top' | 'band' | 'base';
  readonly d: string;
  readonly axis: 'horizontal' | 'vertical';
  readonly stops: readonly [LogoMixStop, LogoMixStop];
}

/** 三块折面：顶杠（远，偏浅）/ 斜带（主色）/ 底杠（近，偏深） */
export const LOGO_FACES: readonly LogoFace[] = [
  { key: 'top', d: 'M14 7 L56 7 L33.9 19 L14 19Z', axis: 'horizontal', stops: [[52, '#fff'], [70, '#fff']] },
  { key: 'band', d: 'M56 7 L33.9 19 L6.84 57 L32.62 43Z', axis: 'vertical', stops: [[92, '#000'], [88, '#fff']] },
  { key: 'base', d: 'M32.62 43 L58 43 L58 57 L6.84 57Z', axis: 'horizontal', stops: [[80, '#000'], [66, '#000']] },
];

export function logoGradientAxis(axis: LogoFace['axis']): { x1: string; y1: string; x2: string; y2: string } {
  return axis === 'vertical'
    ? { x1: '0', y1: '0', x2: '0', y2: '1' }
    : { x1: '0', y1: '0', x2: '1', y2: '0' };
}

/** 页面内用：交给 CSS 按当前 --semi-color-primary 混色 */
export function logoStopCssColor([percent, mixWith]: LogoMixStop): string {
  return `color-mix(in srgb, var(--semi-color-primary) ${percent}%, ${mixWith})`;
}

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const s = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return [0, 2, 4].map((i) => Number.parseInt(s.slice(i, i + 2), 16)) as [number, number, number];
}

/** 与 CSS `color-mix(in srgb, primary p%, other)` 等价的 sRGB 线性混合 */
function mixHex(primary: [number, number, number], [percent, mixWith]: LogoMixStop): string {
  const other = mixWith === '#fff' ? 255 : 0;
  const k = percent / 100;
  return `#${primary.map((c) => Math.round(c * k + other * (1 - k)).toString(16).padStart(2, '0')).join('')}`;
}

/** 生成独立 SVG 文档（不依赖页面 CSS）；主色不是合法 hex 时返回 null */
export function buildLogoSvg(primaryHex: string): string | null {
  const rgb = parseHex(primaryHex);
  if (!rgb) return null;
  const defs = LOGO_FACES.map((face) => {
    const { x1, y1, x2, y2 } = logoGradientAxis(face.axis);
    return `<linearGradient id="${face.key}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">`
      + `<stop offset="0" stop-color="${mixHex(rgb, face.stops[0])}"/>`
      + `<stop offset="1" stop-color="${mixHex(rgb, face.stops[1])}"/>`
      + '</linearGradient>';
  }).join('');
  const paths = LOGO_FACES.map((face) => (
    `<path d="${face.d}" fill="url(#${face.key})" stroke="url(#${face.key})" stroke-width="${LOGO_STROKE_WIDTH}" stroke-linejoin="round"/>`
  )).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${LOGO_VIEW_BOX}" fill="none"><defs>${defs}</defs>${paths}</svg>`;
}

/** 让标签页 favicon 跟随主题主色；主色不可解析时保留现有图标 */
export function applyThemeFavicon(primaryHex: string): void {
  if (typeof document === 'undefined') return;
  const svg = buildLogoSvg(primaryHex);
  if (!svg) return;
  const href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (link?.href === href) return;
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.append(link);
  }
  link.type = 'image/svg+xml';
  link.href = href;
}
