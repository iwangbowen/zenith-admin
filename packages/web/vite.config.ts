import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

function sanitizeChunkName(name: string) {
  return name.replace(/^@/, '').replace(/[\/]/g, '-');
}

function getPackageName(id: string) {
  const packagePath = id.replace(/\\/g, '/').split('/node_modules/').pop();
  if (!packagePath) {
    return null;
  }

  const segments = packagePath.split('/');
  if (segments[0]?.startsWith('@')) {
    return segments.slice(0, 2).join('/');
  }

  return segments[0] ?? null;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // 仅用于 Vite dev server 代理目标，不会暴露到客户端
  const apiTarget = env.VITE_API_PROXY_TARGET || 'http://localhost:3300';
  const port = Number(env.VITE_PORT) || 5373;
  // GitHub Pages 部署时通过环境变量注入 base 路径（如 /zenith-admin/）
  const base = env.VITE_BASE_URL || '/';
  // 使用 esnext 目标（React 19 要求现代浏览器）
  const buildTarget = 'esnext';

  const pwaEnabled = env.VITE_PWA_ENABLED === 'true';

  return {
    base,
    plugins: [
      react(),
      ...(pwaEnabled ? [VitePWA({
        registerType: 'autoUpdate',
        // 预缓存 Vite 构建产物中的静态资源
        includeAssets: ['favicon.svg', 'icons/*.png'],
        manifest: {
          name: env.VITE_APP_TITLE || 'Zenith Admin',
          short_name: env.VITE_APP_SHORT_NAME || 'Zenith',
          description: env.VITE_APP_DESCRIPTION || '企业级后台管理系统',
          theme_color: env.VITE_APP_THEME_COLOR || '#07c160',
          background_color: '#ffffff',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          lang: 'zh-CN',
          icons: [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
          ],
        },
        workbox: {
          // 只缓存静态资源（JS/CSS/字体/图片），API 请求完全走网络
          globPatterns: ['**/*.{js,css,woff2,png,svg,ico}'],
          // API 请求不缓存，保证数据实时性
          navigateFallback: 'index.html',
          navigateFallbackDenylist: [/^\/api\//],
          runtimeCaching: [
            {
              // API 请求：Network Only（不缓存）
              urlPattern: /^\/api\//,
              handler: 'NetworkOnly',
            },
          ],
        },
        devOptions: {
          // 开发模式下也启用 Service Worker（方便调试）
          enabled: false,
        },
      })] : []),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    build: {
      ...(buildTarget ? { target: buildTarget } : {}),
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        output: {
          manualChunks(id) {
            const normalizedId = id.replace(/\\/g, '/');

            if (!normalizedId.includes('node_modules')) {
              return undefined;
            }

            if (normalizedId.includes('/node_modules/@wangeditor/editor-for-react/')) {
              return 'vendor-editor-react';
            }

            if (normalizedId.includes('/node_modules/@wangeditor/editor/')) {
              return 'vendor-editor-core';
            }

            if (normalizedId.includes('/node_modules/recharts/')) {
              return 'vendor-charts';
            }

            if (normalizedId.includes('/node_modules/@douyinfe/semi-ui/lib/es/')) {
              const componentName = normalizedId.split('/node_modules/@douyinfe/semi-ui/lib/es/')[1]?.split('/')[0];
              if (componentName) {
                return `vendor-semi-${sanitizeChunkName(componentName)}`;
              }
            }

            if (
              normalizedId.includes('/react/')
              || normalizedId.includes('/react-dom/')
              || normalizedId.includes('/react-router/')
              || normalizedId.includes('/react-router-dom/')
            ) {
              return 'vendor-react';
            }

            if (normalizedId.includes('/node_modules/@iconify/react/')) {
              return 'vendor-iconify';
            }

            const packageName = getPackageName(normalizedId);
            return packageName ? `vendor-${sanitizeChunkName(packageName)}` : 'vendor-misc';
          },
        },
      },
    },
    optimizeDeps: {
      // decimal.js 是 CJS 包，Vite 有时在 HMR 热更新时无法保证初始化顺序，
      // 导致 recharts -> victory-vendor -> decimal.js 出现 "not a constructor" 报错。
      // 强制预构建后，模块始终以 ESM 形式完整初始化，消除该竞态问题。
      include: ['decimal.js'],
    },
    server: {
      port,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          ws: true,
        },
      },
    },
  };
});
