import { TOKEN_KEY, REFRESH_TOKEN_KEY } from '@zenith/shared/core';
import { authContract } from '@zenith/shared/identity';
import type { ApiResponse } from '@zenith/shared/core';
import { config } from '@/config';
import { HttpClient, type ApiResponseWithMeta, type HttpRequestOptions } from './http-client';
import { downloadBlob } from './download';
import { showRequestErrorToast } from './request-toast';

export type { ApiResponseWithMeta } from './http-client';

export type RequestOptions = HttpRequestOptions;
export const ADMIN_AUTH_INVALIDATED_EVENT = 'auth:invalidated';

/**
 * 后台 admin 端 HTTP 客户端。
 * 通用逻辑（token 注入 / 401 刷新重试 / 429 / 错误提示）见 http-client.ts，
 * 本类额外提供带上传进度的 postForm 与二进制下载 download。
 */
class Request extends HttpClient {
  postForm<T>(url: string, body: FormData, opts: RequestOptions & { onProgress?: (percent: number) => void } = {}) {
    const { onProgress, ...restOpts } = opts;
    if (!onProgress) return this.request<T>(url, { method: 'POST', body, ...restOpts });
    // 有进度回调时改用 XMLHttpRequest（fetch 不支持上传进度）
    return new Promise<ApiResponseWithMeta<T>>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${this.baseUrl}${url}`);
      for (const [name, value] of Object.entries(this.authHeaders())) xhr.setRequestHeader(name, value);
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
      });
      xhr.addEventListener('load', () => {
        try {
          const data = JSON.parse(xhr.responseText) as ApiResponse<T>;
          if (data.code !== 0 && !restOpts.silent) showRequestErrorToast(data.message || '操作失败');
          resolve(data);
        } catch {
          const errResp = { code: -1, message: '响应解析失败', data: null as unknown as T };
          if (!restOpts.silent) showRequestErrorToast(errResp.message);
          resolve(errResp);
        }
      });
      xhr.addEventListener('error', () => {
        const errResp = { code: -1, message: '网络请求失败，请检查网络连接', data: null as unknown as T };
        if (!restOpts.silent) showRequestErrorToast(errResp.message);
        resolve(errResp);
      });
      xhr.send(body);
    });
  }

  /**
   * 拉取二进制响应（默认 GET，可传 method / body 走 POST 导出等）：复用 fetchRaw 的鉴权与 401 刷新重试，
   * 非 2xx 按统一错误提示处理。返回 null 表示失败已被处理（含跳转登录），调用方无需再提示。
   */
  async getBlob(url: string, options: RequestInit = {}): Promise<Blob | null> {
    const res = await this.fetchRaw(url, options);
    if (!res) return null;
    if (!res.ok) {
      try {
        const data = await res.json() as { message?: string };
        showRequestErrorToast(data?.message || '请求失败');
      } catch {
        showRequestErrorToast('请求失败');
      }
      return null;
    }
    return res.blob();
  }

  /** Download a file (binary response) - used for Excel export */
  async download(url: string, filename: string): Promise<void> {
    const blob = await this.getBlob(url);
    if (blob) downloadBlob(blob, filename);
  }
}

export const request = new Request({
  baseUrl: config.apiBaseUrl,
  tokenKey: TOKEN_KEY,
  refreshTokenKey: REFRESH_TOKEN_KEY,
  refreshPath: authContract.refresh.fullPath,
  loginUrl: () => `${import.meta.env.BASE_URL.replace(/\/$/, '') || ''}/login`,
  onUnauthorized: () => globalThis.dispatchEvent(new Event(ADMIN_AUTH_INVALIDATED_EVENT)),
  unauthorizedFallbackMessage: '密码错误',
  handleMaintenance: true,
});
