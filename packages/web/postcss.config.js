import { fileURLToPath, URL } from 'node:url';
import postcssGlobalData from '@csstools/postcss-global-data';
import postcssCustomMedia from 'postcss-custom-media';

// 将 src/styles/breakpoints.css 中的 @custom-media 注入到所有 CSS，
// 使业务样式可统一使用 @media (--md-down) 等语义断点（与 src/lib/breakpoints.ts 同源）。
export default {
  plugins: [
    postcssGlobalData({
      files: [fileURLToPath(new URL('./src/styles/breakpoints.css', import.meta.url))],
    }),
    postcssCustomMedia(),
  ],
};
