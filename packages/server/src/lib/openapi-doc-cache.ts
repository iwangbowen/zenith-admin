/**
 * OpenAPI 文档进程内缓存。
 *
 * 全量文档生成是 ~10s 的同步 CPU 工作（300+ 路由的 zod → JSON Schema 转换，
 * 产物 ~4.5MB），每请求重建会卡死事件循环并拖垮全部并发请求。路由集在启动后
 * 不再变化，因此生成一次即可永久复用；`servers[].url` 使用相对地址 `/`
 * （按 OpenAPI 规范相对文档 URL 解析），文档完全静态化。
 *
 * 缓存同时保存 gzip 预压缩字节（4.5MB → ~260kB）：命中请求直接吐字节，
 * 跳过每请求的大体积压缩。预热由 bootstrap/openapi-warmup.ts 在监听启动后
 * 经 worker 线程完成（主线程零阻塞）；预热完成前的请求走懒生成兜底。
 */
import { gzipSync } from 'node:zlib';

export interface CachedOpenApiDoc {
  json: string;
  gzip: Uint8Array;
}

let cached: CachedOpenApiDoc | null = null;

export function getCachedOpenApiDoc(): CachedOpenApiDoc | null {
  return cached;
}

/** 写入缓存；未提供预压缩字节时同步压缩一次（~50ms，仅懒生成兜底路径） */
export function setCachedOpenApiDoc(json: string, gzip?: Uint8Array): void {
  cached = { json, gzip: gzip ?? gzipSync(json) };
}

/** 仅供领域契约测试在同一进程连续装配多个路由子集时清理全局缓存。 */
export function resetCachedOpenApiDocForTest(): void {
  cached = null;
}
