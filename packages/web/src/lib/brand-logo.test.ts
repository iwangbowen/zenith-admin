import { beforeEach, describe, expect, it } from 'vitest';
import { applyThemeFavicon, buildLogoSvg, LOGO_FACES } from './brand-logo';

describe('buildLogoSvg', () => {
  it('按 color-mix(in srgb) 语义把主色混成三块折面的实色', () => {
    const svg = buildLogoSvg('#3370ff');
    expect(svg).not.toBeNull();
    // 顶杠首个端点：#3370ff 52% + #fff 48%
    expect(svg).toContain('stop-color="#95b5ff"');
    // 底杠末端点：#3370ff 66% + #000 34%
    expect(svg).toContain('stop-color="#224aa8"');
    for (const face of LOGO_FACES) {
      expect(svg).toContain(`id="${face.key}"`);
      expect(svg).toContain(`d="${face.d}"`);
    }
  });

  it('支持 3 位 hex，非法颜色返回 null', () => {
    expect(buildLogoSvg('#fff')).toContain('stop-color="#ffffff"');
    expect(buildLogoSvg('blue')).toBeNull();
    expect(buildLogoSvg('rgba(0,0,0,0.1)')).toBeNull();
  });
});

describe('applyThemeFavicon', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
  });

  it('把现有 <link rel="icon"> 改写为带主色的 data URL', () => {
    document.head.innerHTML = '<link rel="icon" type="image/svg+xml" href="/favicon.svg">';
    applyThemeFavicon('#07c160');
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    expect(link?.href.startsWith('data:image/svg+xml,')).toBe(true);
    expect(decodeURIComponent(link!.href)).toContain(buildLogoSvg('#07c160')!);
    expect(document.querySelectorAll('link[rel="icon"]')).toHaveLength(1);
  });

  it('缺少 <link rel="icon"> 时自动创建；非法主色不改动现有图标', () => {
    applyThemeFavicon('#c026d3');
    expect(document.querySelector('link[rel="icon"]')).not.toBeNull();
    const before = document.querySelector<HTMLLinkElement>('link[rel="icon"]')!.href;
    applyThemeFavicon('not-a-color');
    expect(document.querySelector<HTMLLinkElement>('link[rel="icon"]')!.href).toBe(before);
  });
});
