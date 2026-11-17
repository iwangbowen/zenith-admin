import type { MiddlewareHandler } from 'hono';

/**
 * 原始请求体缓存：必须在任何 JSON 解析 / 日志中间件之前读取。
 *
 * - 只对需要原文验签的路径挂载（当前为 workflow 公开回调）；
 * - 以 Request 为键，响应结束后清理；
 * - 捕获失败或超过上限时不合成 body，调用方必须失败关闭。
 */
const rawBodyByRequest = new WeakMap<Request, string>();
const MAX_RAW_BODY_BYTES = 1024 * 1024;

export const captureRawBody: MiddlewareHandler = async (c, next) => {
  let captured = false;
  try {
    const contentLength = Number(c.req.header('content-length') ?? '');
    if (!Number.isFinite(contentLength) || contentLength <= MAX_RAW_BODY_BYTES) {
      const rawBody = await c.req.raw.clone().text();
      if (rawBody.length <= MAX_RAW_BODY_BYTES) {
        rawBodyByRequest.set(c.req.raw, rawBody);
        captured = true;
      }
    }
  } catch {
    // 读取失败时保持未捕获，验签侧失败关闭。
  }
  try {
    await next();
  } finally {
    if (captured) rawBodyByRequest.delete(c.req.raw);
  }
};

/** 返回本次请求的精确原始字节；未捕获时返回 undefined。 */
export function getRawBody(req: Request): string | undefined {
  return rawBodyByRequest.get(req);
}
