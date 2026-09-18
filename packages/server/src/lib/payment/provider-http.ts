import { HTTPException } from 'hono/http-exception';
import { config } from '../../config';
import { HttpClientError, type HttpRequestOptions, type HttpResponse } from '../http-client';

const OFFICIAL_GATEWAY_HOSTS: Readonly<Record<'alipay' | 'unionpay', ReadonlySet<string>>> = {
  alipay: new Set(['openapi.alipay.com', 'openapi.alipaydev.com']),
  unionpay: new Set(['gateway.95516.com', 'filedownload.95516.com']),
};

/** 自定义网关只允许渠道官方 HTTPS 主机，避免配置项成为任意出站代理。 */
export function assertApprovedProviderGateway(rawUrl: string, provider: 'alipay' | 'unionpay'): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new HTTPException(400, { message: `${provider === 'alipay' ? '支付宝' : '云闪付'}网关地址无效` });
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new HTTPException(400, { message: '支付渠道网关必须使用 HTTPS，且不得携带用户名或密码' });
  }
  if (!OFFICIAL_GATEWAY_HOSTS[provider].has(url.hostname.toLowerCase())) {
    throw new HTTPException(400, { message: '支付渠道网关主机不在官方允许列表中' });
  }
  return url.toString();
}

/** 渠道外呼统一策略：硬超时、socket 级 SSRF 防护、禁止自动重试资金请求。 */
export function providerHttpOptions(): Pick<HttpRequestOptions, 'timeout' | 'retries' | 'ssrfProtection' | 'httpLog'> {
  return {
    timeout: config.payment.providerTimeoutMs,
    retries: 0,
    ssrfProtection: true,
    httpLog: { level: 'off' },
  };
}

/**
 * Preserve whether a non-2xx provider response is a definitive rejection.
 * 408/429 and 5xx responses cannot prove that a money-moving request was not accepted.
 */
export function providerHttpExceptionStatus(status: number): 400 | 502 {
  return status >= 400 && status < 500 && status !== 408 && status !== 429 ? 400 : 502;
}

/** Response body streaming can still fail after fetch has received the headers. */
export async function readProviderResponseText(response: HttpResponse, providerName: string): Promise<string> {
  try {
    return await response.text();
  } catch {
    throw new HTTPException(502, { message: `${providerName}响应读取失败` });
  }
}

/** A provider call is indeterminate unless the response clearly rejected the request. */
export function isIndeterminateProviderError(error: unknown): boolean {
  if (error instanceof HttpClientError) {
    return error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500;
  }
  if (error instanceof HTTPException) {
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }
  return false;
}
