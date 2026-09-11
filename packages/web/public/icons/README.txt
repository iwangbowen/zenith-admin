PWA / 桌面端图标目录
- icon-192.png (192x192 像素)
- icon-512.png (512x512 像素)
两者均为透明底、仅含 logo 本体，由 ../favicon.svg 生成：
  npm run icons -w @zenith/web
修改 favicon.svg（几何与配色比例以 src/lib/brand-logo.ts 为准）后请重新生成，不要手工编辑 PNG。
运行时标签页图标由 brand-logo.ts 按当前主题色动态生成，此处的静态文件仅作首屏 / PWA / 桌面端兜底。
