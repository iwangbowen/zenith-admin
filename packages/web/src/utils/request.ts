import { TOKEN_KEY, REFRESH_TOKEN_KEY } from '@zenith/shared';
import type { ApiResponse } from '@zenith/shared';
import { config } from '@/config';
import { HttpClient, type ApiResponseWithMeta, type HttpRequestOptions } from './http-client';
import { showRequestErrorToast } from './request-toast';

export type { ApiResponseWithMeta } from './http-client';

export type RequestOptions = HttpRequestOptions;

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
      const token = localStorage.getItem(TOKEN_KEY);
      xhr.open('POST', `${this.baseUrl}${url}`);
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
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

  /** Download a file (binary response) - used for Excel export */
  async download(url: string, filename: string): Promise<void> {
    const token = localStorage.getItem(TOKEN_KEY);
    const headers: HeadersInit = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${url}`, { headers });
    } catch {
      showRequestErrorToast('网络请求失败，请检查网络连接');
      return;
    }

    if (res.status === 401) {
      const refreshed = await this.tryRefreshToken();
      if (refreshed) {
        const retryHeaders: HeadersInit = {};
        const newToken = localStorage.getItem(TOKEN_KEY);
        if (newToken) retryHeaders['Authorization'] = `Bearer ${newToken}`;
        try {
          res = await fetch(`${this.baseUrl}${url}`, { headers: retryHeaders });
        } catch {
          showRequestErrorToast('网络请求失败，请检查网络连接');
          return;
        }
        if (res.status === 401) {
          this.clearAuthAndRedirect();
          return;
        }
      } else {
        this.clearAuthAndRedirect();
        return;
      }
    }

    if (!res.ok) {
      try {
        const data = await res.json();
        showRequestErrorToast(data?.message || '下载失败');
      } catch {
        showRequestErrorToast('下载失败');
      }
      return;
    }

    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }
}

export const request = new Request({
  baseUrl: config.apiBaseUrl,
  tokenKey: TOKEN_KEY,
  refreshTokenKey: REFRESH_TOKEN_KEY,
  refreshPath: '/api/auth/refresh',
  loginUrl: () => `${import.meta.env.BASE_URL.replace(/\/$/, '') || ''}/login`,
  unauthorizedFallbackMessage: '密码错误',
  handleMaintenance: true,
});
