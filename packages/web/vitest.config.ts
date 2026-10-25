import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    // jsdom 声明在 workspace 根 package.json：vitest 被提升到根 node_modules，
    // 它是从自身目录发起 import('jsdom') 的，向上查找进不到 packages/web/node_modules。
    // 若在本包重复声明，两处版本一旦不一致就无法去重，web 那份会被嵌套且永远加载不到。
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test-setup.ts'],
    css: true,
    // jsdom 里渲染 Semi Design 组件（尤其 SideSheet / Modal 这类带动画的浮层）
    // 叠加 userEvent 的逐事件派发，单个交互用例普遍要 2-3s；机器负载高时轻易翻倍。
    // vitest 默认 5s 会让这些用例随机报超时（并非真的卡死），故整体放宽。
    // 发布流程四路并行（与 lint / build / docs 抢转译 + CPU）时还嫌挤，
    // 曾在 17-21s 区间撞破 15s 线而单独跑能过，故与 server 一致放宽到 30s：
    // 失败仍是超时而非断言失败，独立复跑可证实用例本身有效。
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // 与 server 同理压住 worker 数：不设上限时 16 核默认起满 jsdom fork，与 build
    // （rolldown 全量转译）并行时会把 CPU 打满，导致 worker 启动超时。
    // CI 的 4 核 runner 本就只起 3 个 worker，不受影响。
    maxWorkers: 8,
    // 显式写出默认值：vitest 5 会对未显式设置的 pool / isolate 打印「换 vmThreads /
    // 关隔离可省下重复创建 jsdom 的时间」的性能提示。web 有 50+ 个测试文件依赖
    // 顶层 vi.mock 与各自独立的 jsdom，两项都不接受；若要评估 vmThreads，单独立项实测。
    pool: 'forks',
    isolate: true,
    // Semi 的 CJS 产物里直接 require CSS，node_modules 无法走原生加载，只能进
    // vite 管线逐模块转译+执行；隔离模式下每个测试文件的 worker 都要重复执行
    // 这几千个包装模块。esbuild 预打包把它们压成单一 chunk（缓存在
    // node_modules/.vite/deps），22 核实测全量从 288.6s 降到 139.4s（累计
    // import 1306s → 551s），用例行为不变。
    deps: {
      optimizer: {
        web: {
          enabled: true,
          include: ['@douyinfe/semi-ui', '@douyinfe/semi-icons', '@douyinfe/semi-illustrations', 'lucide-react'],
        },
      },
    },
  },
});
