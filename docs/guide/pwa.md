# PWA 支持

Zenith Admin 内置 PWA 支持（由 `vite-plugin-pwa` 提供），可让用户将系统"添加到主屏幕"像原生 App 一样使用。默认**关闭**，需从源码重新构建前端开启。

## 启用方式

在 `packages/web/.env.production` 中追加以下配置后重新构建：

```ini
VITE_PWA_ENABLED=true
VITE_APP_SHORT_NAME=Zenith        # 主屏幕显示的短名称
VITE_APP_DESCRIPTION=企业级后台管理系统
VITE_APP_THEME_COLOR=#07c160      # 标题栏颜色，建议与系统主题色一致
```

```bash
# 重新构建前端
npm run build -w @zenith/web
```

构建产物中会包含 `sw.js`（Service Worker）和 `manifest.webmanifest`。

## 技术细节

| 策略 | 说明 |
| --- | --- |
| API 请求 `/api/*` | Network Only — 数据始终实时，不缓存 |
| 静态资源 JS/CSS/字体 | Cache First — 预缓存，首屏加载更快 |
| Service Worker 更新 | 新版本检测到时自动弹出提示，用户确认后刷新 |

## 注意事项

::: tip
- **需要 HTTPS**：Service Worker 要求在 HTTPS 下运行（`localhost` 除外）
- **自定义图标**：可将品牌图标替换 `packages/web/public/icons/icon-192.png` 和 `icon-512.png`（需 192×192 和 512×512 像素）
:::

## 图标生成

如果有 `favicon.svg`，可使用 ImageMagick 生成标准尺寸 PNG 图标：

```bash
cd packages/web/public
magick -background none favicon.svg -resize 192x192 icons/icon-192.png
magick -background none favicon.svg -resize 512x512 icons/icon-512.png
```
