/**
 * 入口首条 import：补齐浏览器在非安全上下文（内网 `http://ip` 访问）下不暴露的平台 API。
 *
 * 只 polyfill 能 100% 等价实现的 API。`navigator.clipboard` 做不到——readText / write 在 HTTP 下
 * 无法回退，补一个残缺对象会误导第三方库（如 @univerjs/ui）的特征检测，剪贴板统一走 @/utils/clipboard。
 */
import { uuidV4 } from '@zenith/shared/core';
import { installScopedStorage } from './utils/storage';

// 必须在任一业务模块读取 localStorage / sessionStorage 前安装，确保三个 SPA 入口一致隔离。
installScopedStorage();

// Crypto.prototype.randomUUID 标记 [SecureContext]，HTTP 下实例上不存在该属性；挂到实例即可，不动原型
if (globalThis.crypto && typeof globalThis.crypto.randomUUID !== 'function') {
  Object.defineProperty(globalThis.crypto, 'randomUUID', { value: uuidV4, configurable: true, writable: true });
}
