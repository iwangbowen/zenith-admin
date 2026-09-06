import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileViewerRenderers } from '@file-viewer/vite-plugin';
import { VitePWA } from 'vite-plugin-pwa';
import entriesManifest from './entries.json';

/**
 * 三个 SPA 入口的内容安全策略（构建期注入 <meta http-equiv="Content-Security-Policy">）。
 *
 * - 生产构建没有内联脚本（Vite 只输出 <script type="module" src>），因此 script-src 不放行
 *   'unsafe-inline'：注入型 <script> / 事件属性 / javascript: 一律不执行；'unsafe-eval' 与
 *   'wasm-unsafe-eval' 保留给文档预览、公式等运行时编译的库；jsdelivr 是 @monaco-editor/react 的默认加载源。
 * - 样式允许内联（Semi UI / ECharts / 富文本大量使用 style 属性）。
 * - 图片 / 媒体 / 字体 / 连接 / 子框架允许任意来源：报表 iframe 组件、地图瓦片、外部图片、
 *   自定义 API 数据源都是产品能力，白名单由各自的业务校验（如 http(s)-only）负责。
 * - frame-ancestors 只能由响应头下发（docker/nginx.conf），meta 无法表达。
 * - 开发服务器（React Fast Refresh 需要内联脚本）与 Electron（file:// 源）不注入。
 */
const SPA_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' blob: https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  'img-src * data: blob:',
  'media-src * data: blob:',
  'font-src * data:',
  'connect-src *',
  'frame-src *',
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

function cspMetaPlugin(): Plugin {
  return {
    name: 'zenith-csp-meta',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: () => [{
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: SPA_CSP },
        injectTo: 'head-prepend',
      }],
    },
  };
}

/**
 * 构建入口：各 SPA 独立构建（同一 dist、不同 assetsDir），由 `scripts/build.mjs` 顺序驱动。
 * 原因：rolldown 的 `$initial`（入口静态闭包）标签对「任一用户入口」取并集，多入口共建时
 * 后台入口的关键路径会混入会员 / 审批入口的模块，且每个共享模块的「入口集合」都掺进几十个懒加载页面，
 * 关键路径无法收敛成少数几个 chunk。管理后台、C 端会员、移动审批面向三类用户，跨入口共享 chunk 收益≈0。
 * 未设置 ZENITH_WEB_ENTRY 时保留多入口共建（dev server 与直接 `vite build` 仍可用）。
 *
 * 入口清单的唯一来源是 `entries.json`（build.mjs / bundle-analyze.mjs 同样读取它）；新增入口只需在那里加一行。
 */
const ENTRY_INPUTS = entriesManifest.entries as Record<string, { input: string; assetsDir: string }>;
type BuildEntry = keyof typeof ENTRY_INPUTS;
/** 第一个入口负责清空 dist，其余入口追加写入 */
const FIRST_ENTRY = Object.keys(ENTRY_INPUTS)[0];

function resolveBuildEntry(): BuildEntry | null {
  const raw = process.env.ZENITH_WEB_ENTRY;
  if (!raw) return null;
  if (raw in ENTRY_INPUTS) return raw as BuildEntry;
  throw new Error(`ZENITH_WEB_ENTRY 只能是 ${Object.keys(ENTRY_INPUTS).join(' / ')}，收到：${raw}`);
}

/**
 * 重型且自洽的第三方库：各自独立成 chunk，只被懒加载页面按需拉取，长期缓存互不干扰。
 * 判定：单库 > 150KB、内部无对 Semi / 应用代码的反向依赖。d3 单列一组，供 xyflow / vchart / mermaid 共享。
 */
const HEAVY_LIBRARIES: Array<[name: string, test: RegExp]> = [
  ['univerjs', /node_modules[\\/]@univerjs[\\/]/],
  ['monaco', /node_modules[\\/](?:monaco-editor|@monaco-editor)[\\/]/],
  ['xterm', /node_modules[\\/]@xterm[\\/]/],
  ['visactor', /node_modules[\\/]@visactor[\\/]/],
  ['maplibre', /node_modules[\\/]maplibre-gl[\\/]/],
  ['mermaid', /node_modules[\\/](?:mermaid|@mermaid-js|cytoscape[^\\/]*|cose-base|layout-base|dagre-d3-es|khroma|elkjs)[\\/]/],
  ['d3', /node_modules[\\/](?:d3|d3-[^\\/]+|internmap|delaunator|robust-predicates)[\\/]/],
  ['embedpdf', /node_modules[\\/]@embedpdf[\\/]/],
  ['wangeditor', /node_modules[\\/]@wangeditor[\\/]/],
  ['rrweb', /node_modules[\\/](?:rrweb|rrweb-player|@rrweb)[\\/]/],
  ['emoji', /node_modules[\\/](?:emoji-mart|@emoji-mart)[\\/]/],
  ['heic2any', /node_modules[\\/]heic2any[\\/]/],
  ['exceljs', /node_modules[\\/](?:exceljs|@styled[\\/]exceljs)[\\/]/],
  ['file-viewer', /node_modules[\\/]@file-viewer[\\/]/],
  ['xyflow', /node_modules[\\/](?:@xyflow|dagre)[\\/]/],
  ['lottie', /node_modules[\\/]lottie-web[\\/]/],
  ['lunar', /node_modules[\\/]lunar-typescript[\\/]/],
  ['sql-formatter', /node_modules[\\/]sql-formatter[\\/]/],
  ['pinyin', /node_modules[\\/]pinyin-pro[\\/]/],
  ['unicode-regex', /node_modules[\\/]unicode-regex[\\/]/],
  ['semi-illustrations', /node_modules[\\/]@douyinfe[\\/]semi-illustrations[\\/]/],
  ['semi-json-viewer', /node_modules[\\/]@douyinfe[\\/]semi-json-viewer-core[\\/]/],
];

const APP_SOURCE = /[\\/]packages[\\/](?:web|shared|analytics-sdk)[\\/]src[\\/]/;
// 应用公共层只收 hooks / lib / utils / 契约等「纯逻辑」模块：组件会把图表 / 编辑器等重型依赖静态拖进公共层，
// 让登录页为一个共享组件下载 2MB 图表库
const APP_SHARED_LOGIC = /[\\/]packages[\\/](?:shared|analytics-sdk)[\\/]src[\\/]|[\\/]packages[\\/]web[\\/]src[\\/](?:hooks|lib|utils|providers|config)[\\/.]/;
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // 仅用于 Vite dev server 代理目标，不会暴露到客户端
  const apiTarget = env.VITE_API_PROXY_TARGET || 'http://localhost:3300';
  const port = Number(env.VITE_PORT) || 5373;
  // GitHub Pages 部署时通过环境变量注入 base 路径（如 /zenith-admin/）
  // Electron 模式下使用相对路径（./ 针对 file:// 协议）
  const isElectron = env.VITE_ELECTRON === 'true';
  const rawBase = isElectron ? './' : (env.VITE_BASE_URL || '/');
  // 统一保证尾斜杠，供 manifest 等手动拼接场景使用（Vite 内部也会做同样的规范化）
  const base = rawBase.endsWith('/') ? rawBase : `${rawBase}/`;
  // 使用 esnext 目标（React 19 要求现代浏览器）
  const buildTarget = 'esnext';

  const entry = resolveBuildEntry();
  const pwaEnabled = env.VITE_PWA_ENABLED === 'true';
  const appVersion = env.VITE_APP_VERSION || process.env.npm_package_version || 'dev';

  return {
    base,
    define: {
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion),
    },
    plugins: [
      fileViewerRenderers({
        // Presentation and Archive are registered explicitly in FileViewerPreviewPanel.
        // Keeping them out prevents copyAssets from duplicating resources that
        // Vite already emits under assets/.
        formats: ['word', 'spreadsheet', 'ofd', 'email', 'xmind', 'mermaid', 'drawio', 'dio', 'excalidraw', 'plantuml', 'puml', 'data', 'geo'],
        inject: false,
        copyAssets: { baseDir: 'file-viewer', mode: 'both' },
        chunkStrategy: 'none',
        stabilizeInteropChunks: false,
      }),
      react(),
      ...(isElectron ? [] : [cspMetaPlugin()]),
      ...(pwaEnabled ? [VitePWA({
        registerType: 'autoUpdate',
        // 预缓存 Vite 构建产物中的静态资源
        includeAssets: ['favicon.svg', 'icons/*.png'],
        manifest: {
          name: env.VITE_APP_TITLE || 'Zenith Admin',
          short_name: env.VITE_APP_SHORT_NAME || 'Zenith',
          description: env.VITE_APP_DESCRIPTION || '企业级后台管理系统',
          theme_color: env.VITE_APP_THEME_COLOR || '#3370ff',
          background_color: '#ffffff',
          display: 'standalone',
          // 手写的 manifest 字段不会被 Vite base 自动改写，子路径部署时需显式拼接
          start_url: base,
          scope: base,
          lang: 'zh-CN',
          icons: [
            { src: `${base}icons/icon-192.png`, sizes: '192x192', type: 'image/png' },
            { src: `${base}icons/icon-512.png`, sizes: '512x512', type: 'image/png' },
            { src: `${base}icons/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
          ],
        },
        workbox: {
          // 只缓存静态资源（JS/CSS/字体/图片），API 请求完全走网络
          globPatterns: ['**/*.{js,css,woff2,png,svg,ico}'],
          // 超大懒加载文档引擎（univerjs/rtf 等）超过 workbox 2MiB 上限，排除出预缓存，按需经网络加载
          globIgnores: ['**/vendor-univerjs-*.js', '**/vendor-rtf.js-*.js'],
          maximumFileSizeToCacheInBytes: 2 * 1024 * 1024,
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
      assetsDir: entry ? ENTRY_INPUTS[entry].assetsDir : 'assets',
      // 多入口分多次构建写入同一 dist：只有第一个入口清空目录，由 scripts/build.mjs 控制顺序
      emptyOutDir: entry === null || entry === FIRST_ENTRY,
      rollupOptions: {
        // 影子 barrel（semi-ui-barrel.ts）是纯 re-export，但 @zenith/web 未声明
        // package.json#sideEffects，源码文件默认被视为有副作用、无法摇树；
        // 此处精确豁免该文件（返回 undefined 的模块走默认判定）。
        treeshake: {
          moduleSideEffects: (id: string): boolean | undefined =>
            id.replaceAll('\\', '/').endsWith('/src/lib/semi-ui-barrel.ts') ? false : undefined,
        },
        input: entry
          ? { [entry]: fileURLToPath(new URL(`./${ENTRY_INPUTS[entry].input}`, import.meta.url)) }
          : Object.fromEntries(
            (Object.keys(ENTRY_INPUTS) as BuildEntry[]).map((key) => [key, fileURLToPath(new URL(`./${ENTRY_INPUTS[key].input}`, import.meta.url))]),
          ),
        output: {
          /**
           * 静态资源（字体 / wasm / 图片 / CSS）各入口共用 `assets/`：文件名含内容 hash，相同内容在各入口构建中
           * 得到相同文件名，落到同一目录即只保留一份。JS chunk 仍按入口分目录（`assetsDir`），互不干扰。
           */
          assetFileNames: 'assets/[name]-[hash][extname]',
          /**
           * 三层分包（rolldown 原生 codeSplitting.groups，分组指派是权威的）：
           *
           * ① 关键路径层 `initial-*`：入口静态闭包内的全部模块（第三方 / 应用各一个 chunk）。
           *    闭包对 import 封闭——闭包内模块的依赖必然也在闭包内，因此不会与任何其它 chunk 成环；
           *    也不按「哪些页面用到」再拆：这些模块在任何页面运行前都已加载，拆出来只会制造请求。
           * ② 壳层：非关键路径的 Semi 全部落在 `vendor-semi` 一个 chunk（Semi 内部 button↔iconButton、
           *    form↔各控件 等强连通分量全部留在 chunk 内；Semi 只被外部单向引用，不会形成跨 chunk 环）；
           *    被 ≥10 个页面共享的第三方 / 应用纯逻辑模块各合成一个 `vendor-common` / `app-shared`，登录后一次加载长期缓存。
           * ③ 页面层：重型库各自独立；其余第三方按「消费页面集合」精确分组（entriesAware，不做侧向合并）。
           *
           * 不要做的事（均已实测翻车，见 docs/frontend/bundle-performance.md）：
           * - `entriesAwareMergeThreshold` / `minSize` 回落：把消费方不同的子组合并，会把邻组的静态依赖
           *   （图表 / 编辑器）一并拖进消费方，登录页因此多出 3MB；
           * - `strictExecutionOrder: true`：模块包装器给 chunk 图加边，关键路径层会因一个 init 包装器
           *   引用整个公共层；
           * - 把 Semi 按组件拆散或与其 foundation 分开：跨 chunk 环 → TDZ（"reading 'PREFIX'"）白屏，构建仍 exit 0；
           * - 把 prismjs 与 Semi codeHighlight 分开：语言组件依赖 core 先设置全局 Prism，跨 chunk 后顺序丢失。
           * 任何分包改动都必须通过 `npm run check:bundle`（预算）与 `npm run smoke`（真实浏览器启动）。
           */
          codeSplitting: {
            includeDependenciesRecursively: false,
            groups: [
              {
                // Vite 运行时 helper（preload polyfill 等虚拟模块）独立成组且优先级最高：
                // 它被所有含动态 import 的 chunk 依赖，落入任何 vendor 包都会让入口被迫预载该包
                name: 'vite-runtime',
                test: (id: string) => id.includes('vite/preload-helper') || id.includes('vite/modulepreload-polyfill') || id.includes('vite/dynamic-import-helper') || id.includes('commonjsHelpers'),
                priority: 40,
              },
              // react 运行时（含 jsx-runtime）独立成组：全应用共享，绝不允许被合并进任何业务 / vendor 大包
              { name: 'vendor-react-core', test: /node_modules[\\/](?:react|react-dom|scheduler)[\\/]/, priority: 30 },
              ...HEAVY_LIBRARIES.map(([name, test]) => ({ name: `vendor-${name}`, test, priority: 20 })),
              { name: 'initial-vendor', tags: ['$initial'], test: /node_modules/, priority: 16 },
              { name: 'initial-app', tags: ['$initial'], test: APP_SOURCE, priority: 16 },
              // Semi 中带重型依赖、且核心组件从不反向引用的部分单独成 chunk：markdownRender / chat（MDX + acorn +
              // micromark ≈ 650KB）、codeHighlight（连同其唯一消费的 prismjs：core 必须先于语言组件求值，二者不可分离）、
              // jsonViewer。它们只单向依赖核心，不会形成跨 chunk 环。
              // cropper 被 upload 引用、image 被多处引用，必须留在核心。
              { name: 'vendor-semi-markdown', test: /node_modules[\\/](?:@douyinfe[\\/](?:semi-ui|semi-foundation)[\\/]lib[\\/]es[\\/](?:aiChatDialogue|aiChatInput|chat|markdownRender|codeHighlight|jsonViewer)|prismjs)[\\/]/, priority: 15 },
              // 媒体播放器与 markdown 族分开：文件预览只用播放器，不应连带 MDX 解析器
              { name: 'vendor-semi-media', test: /node_modules[\\/]@douyinfe[\\/](?:semi-ui|semi-foundation)[\\/]lib[\\/]es[\\/](?:lottie|videoPlayer|audioPlayer)[\\/]/, priority: 15 },
              { name: 'vendor-semi', test: /node_modules[\\/]@douyinfe[\\/](?:semi-ui|semi-foundation|semi-icons|semi-animation)[\\/]/, priority: 14 },
              { name: 'vendor-common', test: /node_modules/, priority: 10, minShareCount: 10 },
              { name: 'app-shared', test: APP_SHARED_LOGIC, priority: 8, minShareCount: 10 },
              { name: 'vendor', test: /node_modules/, priority: 5, entriesAware: true, entriesAwareMergeThreshold: 0 },
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
        // CMS 前台预览（/__cms/{siteCode}/...）由后端 SSR 渲染，需转发到 server
        '/__cms': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
  };
});
