import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // 全量套件用 app.contract 验证完整装配；领域项目单独运行同源的领域契约断言。
    exclude: ['src/domain-contract.test.ts'],
    // 运行时密钥：config 在非 development 环境不再有内置默认值（vitest 的 NODE_ENV=test）。
    // 这里给一组固定的测试值，让未 mock config 的用例（如 encryption / secret-crypto 闭环）可用；
    // 值本身在 lib/secrets 的占位检测里被视为不安全，不会流入任何真实部署。
    env: {
      JWT_SECRET: 'vitest-only-jwt-secret-0123456789abcdefghijklmnopqrstuvwxyz',
      FIELD_ENCRYPTION_KEY: '0123456789abcdef'.repeat(4),
    },
    // 全局替换模块加载期就建 TCP 连接的 lib/redis，见 src/test-setup.ts
    setupFiles: ['src/test-setup.ts'],
    // fork 拥有独立 libuv 线程池，避免压缩 / 文件 I/O 测试共享线程池时相互阻塞。
    pool: 'forks',
    // 限制并发转译与模块加载的资源开销；需要调优时使用同口径的测试基准。
    maxWorkers: 8,
    // 普通用例 / hook 的预算；完整 App 与领域装配在各自套件声明独立预算。
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // 保留 per-file mock 和模块状态隔离，防止单跑通过、组合运行时互相污染。
    isolate: true,
    coverage: {
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/db/seed.ts', 'src/db/migrate.ts'],
    },
  },
});
