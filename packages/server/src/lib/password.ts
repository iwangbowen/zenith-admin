/**
 * 密码哈希统一入口。
 *
 * 优先使用 @node-rs/bcrypt（Rust N-API，计算在 libuv/tokio 线程池，不占 JS 主线程）：
 * bcryptjs 是纯 JS 实现，异步 API 虽内部分片让出，但每次 hash/compare 仍消耗
 * ~60-100ms 主线程 CPU——登录高峰或用户批量导入（逐行 hash）会直接拖高事件循环延迟。
 * native 二进制加载失败（未预编译的平台）时自动降级 bcryptjs，行为一致。
 *
 * 两者产出/校验的 $2a$/$2b$ hash 互认（见 password.test.ts 兼容性用例），
 * 存量密码无需迁移。业务代码一律经由本模块，不得直接 import bcryptjs。
 */
import { createRequire } from 'node:module';
import bcryptjs from 'bcryptjs';
import logger from './logger';

export const PASSWORD_HASH_COST = 10;

type NativeBcrypt = Pick<typeof import('@node-rs/bcrypt'), 'hash' | 'verify'>;

const require = createRequire(import.meta.url);

let native: NativeBcrypt | null = null;
try {
  native = require('@node-rs/bcrypt') as NativeBcrypt;
} catch (err) {
  logger.warn('[password] @node-rs/bcrypt 加载失败，降级 bcryptjs（纯 JS，将占用主线程 CPU）', err);
}

export async function hashPassword(plain: string): Promise<string> {
  return native ? native.hash(plain, { cost: PASSWORD_HASH_COST }) : bcryptjs.hash(plain, PASSWORD_HASH_COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return native ? native.verify(plain, hash) : bcryptjs.compare(plain, hash);
}
