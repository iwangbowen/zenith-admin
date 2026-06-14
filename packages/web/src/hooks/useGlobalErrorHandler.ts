import { useEffect, useRef } from 'react';
import { Toast } from '@douyinfe/semi-ui';
import { TOKEN_KEY } from '@zenith/shared';

// ─── Error Reporter ──────────────────────────────────────────────────────────

/** Simple MD5-like fingerprint for deduplication (FNV-1a hash → hex) */
function hashFingerprint(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.codePointAt(i) ?? 0;
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function reportToBackend(
  errorType: 'js_error' | 'promise_rejection' | 'resource_error' | 'console_error',
  message: string,
  options?: { stack?: string; sourceUrl?: string; lineNo?: number; colNo?: number },
) {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return; // only report for authenticated users

    const fingerprint = hashFingerprint(`${errorType}:${message}:${options?.sourceUrl ?? ''}`);
    const apiBase = (import.meta.env.VITE_API_BASE_URL as string) || '/api';
    const sessionId = sessionStorage.getItem('zenith_tracker_sid') ?? undefined;

    const payload = {
      fingerprint,
      errorType,
      message: message.slice(0, 2000),
      stack: options?.stack?.slice(0, 8000),
      sourceUrl: options?.sourceUrl?.slice(0, 512),
      lineNo: options?.lineNo,
      colNo: options?.colNo,
      pageUrl: globalThis.location.href.slice(0, 512),
      userAgent: navigator.userAgent.slice(0, 512),
      sessionId,
    };

    fetch(`${apiBase}/frontend-errors`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => { /* ignore reporting failures */ });
  } catch {
    // never break the app for monitoring errors
  }
}

/**
 * 全局异步错误兜底。
 *
 * React Error Boundary 无法捕获 Promise rejection 和 window.onerror 级别的错误。
 * 本 hook 在 App 根组件中挂载一次，通过以下两个全局事件托底：
 *
 * - `unhandledrejection`：未被 catch 的 Promise 拒绝
 * - `error`：未被捕获的同步运行时错误（脚本层面）
 *
 * 捕获后以 Toast 通知用户，同时在控制台输出完整信息，并自动上报到后端。
 *
 * 防护机制：
 * - 去重：5 秒内相同消息只弹一次 Toast
 * - 限流：5 秒窗口内最多弹 3 次 Toast，超出后仅 console 输出
 */
export function useGlobalErrorHandler() {
  // 去重 Set：key = 消息内容，5 秒后自动清除
  const recentRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // 限流：记录当前窗口内已弹出的 Toast 次数
  const countRef = useRef(0);
  const countResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const MAX_PER_WINDOW = 3;
    const DEDUP_TTL = 5_000;
    const RATE_WINDOW = 5_000;

    function showToast(message: string) {
      // 限流检查
      countRef.current += 1;
      countResetTimerRef.current ??= globalThis.setTimeout(() => {
        countRef.current = 0;
        countResetTimerRef.current = null;
      }, RATE_WINDOW);
      if (countRef.current > MAX_PER_WINDOW) return;

      // 去重检查
      if (recentRef.current.has(message)) return;
      const timer = globalThis.setTimeout(() => {
        recentRef.current.delete(message);
      }, DEDUP_TTL);
      recentRef.current.set(message, timer);

      Toast.error({ content: message, duration: 5 });
    }

    function handleUnhandledRejection(event: PromiseRejectionEvent) {
      const reason = event.reason;
      const message =
        reason instanceof Error
          ? reason.message
          : String(reason || '发生了未处理的异步错误');

      console.error('[GlobalErrorHandler] 未处理的 Promise rejection:', reason);
      showToast(`操作失败：${message}`);
      reportToBackend('promise_rejection', message, {
        stack: reason instanceof Error ? reason.stack : undefined,
      });
    }

    function handleWindowError(event: ErrorEvent) {
      // 忽略跨域脚本错误（message 为 "Script error."，无法获取详情）
      if (!event.message || event.message === 'Script error.') return;

      // 忽略来自浏览器扩展的错误（React DevTools、广告拦截器等），不属于应用代码
      const filename = event.filename ?? '';
      if (filename.startsWith('chrome-extension://') || filename.startsWith('moz-extension://')) return;

      // 忽略 ResizeObserver 良性警告：由浏览器渲染引擎触发，不影响功能，无需提示用户
      if (event.message.includes('ResizeObserver loop')) return;

      console.error('[GlobalErrorHandler] 未捕获的运行时错误:', event.error ?? event.message);
      showToast(`页面发生错误：${event.message}`);
      reportToBackend('js_error', event.message, {
        stack: event.error instanceof Error ? event.error.stack : undefined,
        sourceUrl: event.filename,
        lineNo: event.lineno,
        colNo: event.colno,
      });
    }

    globalThis.addEventListener('unhandledrejection', handleUnhandledRejection);
    globalThis.addEventListener('error', handleWindowError);

    return () => {
      globalThis.removeEventListener('unhandledrejection', handleUnhandledRejection);
      globalThis.removeEventListener('error', handleWindowError);
      // 清理所有去重计时器
      recentRef.current.forEach((t) => globalThis.clearTimeout(t));
      recentRef.current.clear();
      if (countResetTimerRef.current !== null) {
        globalThis.clearTimeout(countResetTimerRef.current);
      }
    };
  }, []);
}
