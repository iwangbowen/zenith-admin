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
    // 保持默认 forks 池，不要换 threads：worker_threads 共享**同一个进程级
    // libuv 线程池**（默认 4 线程），zlib/fs 密集用例（如 exceljs 导出）在
    // 四路并行争抢下被饿死——~1s 的用例实测放大到 40s+ 撞破超时；forks 每个
    // 子进程各有独立线程池。threads 的收益仅 ~7%（108.7s → 101.5s），不值。
    // 显式写出默认值：vitest 5 会在跑完后对**未显式设置**的 pool / isolate 打印
    // 「换池 / 关隔离可提速」的性能提示，显式声明后就不再建议改动这两项。
    pool: 'forks',
    // 每个 worker 都要独立执行整套 app（300+ 路由文件）的模块图，worker 越多重复越多，
    // 到某个点后收益反转：16 核实测默认档（核数-1=15）transform 累计 1432s、墙钟 307s，
    // 且 app.contract（装配 app + 1800 次进程内请求）撞破超时；
    // 限到 8 后 transform 231s、墙钟 121s 且全绿（12 已开始劣化并偶发超时）。
    // 这是上限而非目标值：CI 的 4 核 runner 本就只起 3 个 worker，不受影响。
    maxWorkers: 8,
    // 发布流程多路并行抢满 CPU 时（按受影响包各一对 lint / test 再加 docs 一路），
    // 秒级用例会被放大 10-40 倍：exceljs 渲染这类 ~0.5s 的用例实测撞破过 vitest 默认 5s。
    // 16 核机器上按 5b 的多包 profile 并行 5 路实测 15s 仍被撞破——ws-manager 的
    // presence 合并广播、log-viewer 的实时追踪两条（独占跑分别 4.8s / 1.0s，独占全量
    // 499 个文件全绿），失败形态也全是超时而非断言失败，见 troubleshooting.md → 性能。
    // 放宽到 30s；真死锁仍会在 30s 内快速失败。app.contract 的装配另有专属 480s 超时。
    // web 侧保持 15s：其测试路在同样 5 路并行下全绿，没有证据需要放宽。
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // 不要用 isolate: false 换速度：本套测试重度依赖 per-file vi.mock，关闭隔离会
    // 产生跨文件模块状态泄漏（单跑全绿、混跑必挂），且文件→worker 的分配随时序
    // 变化，泄漏组合不可复现、白名单不可维护。
    isolate: true,
    coverage: {
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/db/seed.ts', 'src/db/migrate.ts'],
    },
  },
});
