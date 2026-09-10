/**
 * CMS 前台岛脚本入口（浏览器端）。
 *
 * 以 `<script type="module" src="/_assets/islands.{hash}.js">` 外链交付：module 脚本默认 defer，
 * 执行时整份文档已解析完毕，无需 DOMContentLoaded。构建：scripts/build-islands.mjs（生产预构建）
 * 与 cms/themes/islands-asset.ts（开发态内存构建）。
 */
import { mountIslands } from './mount';
import { pageIslands, registry } from './registry';

mountIslands(document, registry);
for (const run of pageIslands) {
  try {
    run(document);
  } catch (error) {
    console.error('[cms-islands] 页面岛执行失败', error);
  }
}
