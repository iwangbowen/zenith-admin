import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

function sanitizeChunkName(name: string) {
  return name.replace(/^@/, '').replaceAll('/', '-');
}

function getPackageName(id: string) {
  const packagePath = id.replaceAll('\\', '/').split('/node_modules/').pop();
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
  // Electron 模式下使用相对路径（./ 针对 file:// 协议）
  const isElectron = env.VITE_ELECTRON === 'true';
  const base = isElectron ? './' : (env.VITE_BASE_URL || '/');
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
      alias: [
        { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
        // 精确匹配裸导入 '@douyinfe/semi-ui' → 本地无副作用影子 barrel（见该文件头部说明）：
        // 官方 barrel 被声明为 sideEffect，全量 re-export 无法摇树，
        // aiChatDialogue/MarkdownRender 等重组件会被拖进首屏（~550KB gzip）。
        // 子路径导入（lib/es/*、react19-adapter）不受影响。
        { find: /^@douyinfe\/semi-ui$/, replacement: fileURLToPath(new URL('./src/lib/semi-ui-barrel.ts', import.meta.url)) },
      ],
    },
    build: {
      ...(buildTarget ? { target: buildTarget } : {}),
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        // 影子 barrel（semi-ui-barrel.ts）是纯 re-export，但 @zenith/web 未声明
        // package.json#sideEffects，源码文件默认被视为有副作用、无法摇树；
        // 此处精确豁免该文件（返回 undefined 的模块走默认判定）。
        treeshake: {
          moduleSideEffects: (id: string): boolean | undefined =>
            id.replaceAll('\\', '/').endsWith('/src/lib/semi-ui-barrel.ts') ? false : undefined,
        },
        // 多入口：后台管理（index.html）+ 会员前台（member.html）+ 移动审批轻页（approval.html）
        input: {
          main: fileURLToPath(new URL('./index.html', import.meta.url)),
          member: fileURLToPath(new URL('./member.html', import.meta.url)),
          approval: fileURLToPath(new URL('./approval.html', import.meta.url)),
        },
        output: {
          // 使用 rolldown 原生 codeSplitting.groups（替代 rollup 兼容的 manualChunks 函数）：
          // 兼容层的分组指派是"建议性"的——rolldown 为满足执行顺序约束会把模块挪出指派分组
          // （react 本体曾被并进 vendor-charts / vendor-dnd-kit，jsx-runtime 曾被并进
          // vendor-embedpdf），导致入口 HTML 被迫 preload 这些重型包、首屏体积暴涨。
          // 原生 groups 的指派是权威的，且动态 name() 完整保留了原有按包分组策略。
          codeSplitting: {
            // 仅捕获组内直接匹配的模块：默认的递归捕获会让先建的组（如 aiChatDialogue）
            // 连带吞掉 typography/tooltip/locale 等公共依赖，入口为取公共件被迫预载整包
            includeDependenciesRecursively: false,
            groups: [
              {
                // Vite 运行时 helper（preload polyfill 等虚拟模块）必须独立成组且优先级最高：
                // 它被所有含动态 import 的 chunk 依赖，若落入自动分组会被 rolldown 打进
                // 任意重型 vendor 包（曾被并进 vendor-embedpdf，导致入口为拿 __vitePreload
                // 被迫静态预载 1MB PDF 引擎）。
                name: 'vite-runtime',
                test: (id: string) => id.includes('vite/preload-helper') || id.includes('vite/modulepreload-polyfill') || id.includes('vite/dynamic-import-helper') || id.includes('commonjsHelpers'),
                priority: 20,
              },
              {
                // react 运行时（含 jsx-runtime）独立成组且最高优先级：全应用共享，
                // 绝不允许被合并进任何业务/vendor 大包
                name: 'vendor-react-core',
                test: /node_modules[\\/](?:react|react-dom|scheduler)[\\/]/,
                priority: 10,
              },
              {
                name(id: string): string | null {
                  const normalizedId = id.replaceAll('\\', '/');

                  if (!normalizedId.includes('node_modules')) {
                    return null;
                  }

                  if (normalizedId.includes('/node_modules/@wangeditor/editor-for-react/')) {
                    return 'vendor-editor-react';
                  }

                  if (normalizedId.includes('/node_modules/@wangeditor/editor/')) {
                    return 'vendor-editor-core';
                  }

                  if (normalizedId.includes('/node_modules/@douyinfe/semi-ui/lib/es/')) {
                    const componentName = normalizedId.split('/node_modules/@douyinfe/semi-ui/lib/es/')[1]?.split('/')[0];
                    if (componentName) {
                      return `vendor-semi-${sanitizeChunkName(componentName)}`;
                    }
                  }

                  // semi-foundation 同样按模块拆分：整包聚合会让入口为取 button/nav 等
                  // 基础 foundation 连带预载 markdownRender(→mdx/acorn)、jsonViewer(50KB)
                  // 等重型 foundation
                  if (normalizedId.includes('/node_modules/@douyinfe/semi-foundation/lib/es/')) {
                    const moduleName = normalizedId.split('/node_modules/@douyinfe/semi-foundation/lib/es/')[1]?.split('/')[0];
                    if (moduleName) {
                      return `vendor-semi-fd-${sanitizeChunkName(moduleName)}`;
                    }
                  }

                  // ⚠️ 必须用 /node_modules/ 前缀精确匹配包目录，不能用宽泛子串：
                  // 曾用 includes('/react/') 把 @tiptap/react、@monaco-editor/react 等
                  // 错聚进 vendor-react，诱发跨组合并把重库拖进首屏
                  if (
                    normalizedId.includes('/node_modules/react-router/')
                    || normalizedId.includes('/node_modules/react-router-dom/')
                  ) {
                    return 'vendor-react-router';
                  }

                  if (normalizedId.includes('/node_modules/@iconify/react/')) {
                    return 'vendor-iconify';
                  }

                  // lucide-react 走自动分包：每个图标是独立模块，按包聚合会把全应用
                  // 数百个图标的并集塞进单一 chunk 并被入口预载；自动分包让各页面
                  // 只携带自己用到的图标
                  if (normalizedId.includes('/node_modules/lucide-react/')) {
                    return null;
                  }

                  const packageName = getPackageName(normalizedId);
                  return packageName ? `vendor-${sanitizeChunkName(packageName)}` : 'vendor-misc';
                },
              },
            ],
          },
        },
      },
    },
    optimizeDeps: {
      // decimal.js 是 CJS 包（经 @univerjs 公式引擎等间接引入），Vite 在 HMR 热更新时
      // 有时无法保证其初始化顺序，导致 "not a constructor" 报错。强制预构建后，
      // 模块始终以 ESM 形式完整初始化，消除该竞态问题。
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
