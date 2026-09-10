#!/usr/bin/env node
/**
 * 由 `public/favicon.svg` 生成 PWA / 桌面端所需的透明底 PNG 图标（192×192、512×512）。
 * 图标只包含 logo 本体、无底色，Electron 打包（electron-builder.config.js）与 PWA manifest 共用同一份产物。
 *
 *   npm run icons -w @zenith/web                 # 默认用系统 Chrome（与 smoke 脚本一致）
 *   npm run icons -w @zenith/web -- --channel chromium
 *
 * 修改 favicon.svg 后重新执行即可；`AppLogo.tsx` 与 favicon.svg 共用同一套几何，二者需同步调整。
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const channelIdx = args.indexOf('--channel');
const channel = channelIdx >= 0 ? args[channelIdx + 1] : 'chrome';
const sizes = [192, 512];

const svg = await readFile(resolve(webRoot, 'public/favicon.svg'), 'utf8');
const browser = await chromium.launch(channel === 'chromium' ? { headless: true } : { channel, headless: true });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const size of sizes) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<!doctype html><html><head><style>html,body{margin:0;background:transparent}svg{display:block}</style></head><body>${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`,
    );
    const png = await page.locator('svg').screenshot({ omitBackground: true, type: 'png' });
    const out = resolve(webRoot, `public/icons/icon-${size}.png`);
    await writeFile(out, png);
    console.log(`✓ ${out} (${png.length} bytes)`);
  }
} finally {
  await browser.close();
}
