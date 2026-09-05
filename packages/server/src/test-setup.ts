/**
 * 全局测试 setup（vitest.config.ts → setupFiles，每个测试文件执行前运行一次）。
 *
 * 1. 与 src/index.ts 一致，先加载 @hono/zod-openapi：它把 .openapi() 补丁到 ZodType 原型，
 *    zod v4 实例只在构造时拷贝原型方法，@zenith/shared 的 schema 必须在补丁之后构造，
 *    否则测试文件的导入顺序会决定路由层对 shared 契约 schema 调 .openapi() 是否成立。
 * 2. 把模块加载期就发起真实 TCP 连接的 `lib/redis` 替换成内存替身，
 *    原因与替身语义见 test-utils/redis-stub.ts。这里的 vi.mock 以本文件为基准
 *    解析路径，对所有测试文件生效；单个文件自己的 vi.mock('../lib/redis', ...)
 *    会覆盖此处（后注册者生效），既有断言调用细节的测试不受影响。
 */
import '@hono/zod-openapi';
import { vi } from 'vitest';
import { createRedisStub } from './test-utils/redis-stub';

vi.mock('./lib/redis', () => ({ default: createRedisStub(), closeRedis: vi.fn() }));
