import { useEffect, useRef } from 'react';
import { Toast } from '@douyinfe/semi-ui';
import { reportError } from '@/utils/error-reporter';
import { addBreadcrumb } from '@/utils/breadcrumbs';
import { ApiError } from '@/lib/query';
import { SubmitAborted } from '@/lib/abort-submit';

/**
 * 全局前端异常兜底 + 上报。
 *
 * 捕获并上报到错误监控：
 * - `error`（捕获阶段）：JS 运行时错误 + 资源加载失败
 * - `unhandledrejection`：未处理的 Promise 拒绝
 * - `console.error`：控制台错误（记录面包屑 + 上报）
 *
 * 同时向用户弹出 Toast（去重 + 限流），并记录行为面包屑用于错误现场还原。
 *
 * 以下两类「约定内」的 Promise 拒绝不提示也不上报（Modal onOk 依约定重抛以保持弹窗打开）：
 * - `ApiError`：统一响应业务错误，request 层已自动弹出错误 Toast
 * - `SubmitAborted`：提交中断标记，页面已自行提示（表单内联错误 / Toast），由 `abortSubmit()` 抛出
 *
 * 除上述类型外的一切 rejection（含单词消息如 `NetworkError` / `timeout`）都视为真实错误上报。
 */
export function useGlobalErrorHandler() {
  const recentRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const countRef = useRef(0);
  const countResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const MAX_PER_WINDOW = 3;
    const DEDUP_TTL = 5_000;
    const RATE_WINDOW = 5_000;

    function showToast(message: string) {
      countRef.current += 1;
      countResetTimerRef.current ??= globalThis.setTimeout(() => {
        countRef.current = 0;
        countResetTimerRef.current = null;
      }, RATE_WINDOW);
      if (countRef.current > MAX_PER_WINDOW) return;
      if (recentRef.current.has(message)) return;
      const timer = globalThis.setTimeout(() => recentRef.current.delete(message), DEDUP_TTL);
      recentRef.current.set(message, timer);
      Toast.error({ content: message, duration: 5, stack: true });
    }

    function handleUnhandledRejection(event: PromiseRejectionEvent) {
      const reason = event.reason;
      // 业务错误（unwrap 抛出）：request 层已弹出错误 Toast，避免重复提示；属预期流程，不上报
      if (reason instanceof ApiError) return;
      // 提交中断标记：由 abortSubmit() 抛出，页面已自行提示
      if (reason instanceof SubmitAborted) return;
      const message = reason instanceof Error ? reason.message : String(reason || '发生了未处理的异步错误');
      console.error('[GlobalErrorHandler] 未处理的 Promise rejection:', reason);
      showToast(`操作失败：${message}`);
      reportError('promise_rejection', message, { stack: reason instanceof Error ? reason.stack : undefined });
    }

    function handleWindowError(event: ErrorEvent) {
      // 资源加载错误（img/script/link/...）：target 为元素且非 window
      const target = event.target as (HTMLElement & { src?: string; href?: string }) | null;
      if (target && target !== (globalThis as unknown as EventTarget) && target.tagName) {
        const url = target.src || target.href || '';
        if (!url) return;
        addBreadcrumb({ type: 'custom', message: `资源加载失败: ${target.tagName} ${url}`, level: 'warning' });
        reportError('resource_error', `资源加载失败: ${target.tagName.toLowerCase()} ${url}`, { level: 'warning', sourceUrl: url });
        return;
      }

      if (!event.message || event.message === 'Script error.') return;
      const filename = event.filename ?? '';
      if (filename.startsWith('chrome-extension://') || filename.startsWith('moz-extension://')) return;
      if (event.message.includes('ResizeObserver loop')) return;

      console.error('[GlobalErrorHandler] 未捕获的运行时错误:', event.error ?? event.message);
      showToast(`页面发生错误：${event.message}`);
      reportError('js_error', event.message, {
        stack: event.error instanceof Error ? event.error.stack : undefined,
        sourceUrl: event.filename,
        lineNo: event.lineno,
        colNo: event.colno,
      });
    }

    // console.error 捕获（记录面包屑 + 上报，跳过自身日志）
    const origConsoleError = console.error.bind(console);
    function patchedConsoleError(...args: unknown[]) {
      try {
        const msg = args.map((a) => (a instanceof Error ? a.message : typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ').slice(0, 500);
        if (!msg.startsWith('[GlobalErrorHandler]')) {
          addBreadcrumb({ type: 'console', message: msg.slice(0, 200), level: 'error' });
          const err = args.find((a) => a instanceof Error) as Error | undefined;
          reportError('console_error', msg, { level: 'warning', stack: err?.stack });
        }
      } catch { /* ignore */ }
      origConsoleError(...args);
    }
    console.error = patchedConsoleError;

    globalThis.addEventListener('unhandledrejection', handleUnhandledRejection);
    globalThis.addEventListener('error', handleWindowError, true);

    const recentMap = recentRef.current;
    return () => {
      globalThis.removeEventListener('unhandledrejection', handleUnhandledRejection);
      globalThis.removeEventListener('error', handleWindowError, true);
      console.error = origConsoleError;
      recentMap.forEach((t) => globalThis.clearTimeout(t));
      recentMap.clear();
      if (countResetTimerRef.current !== null) globalThis.clearTimeout(countResetTimerRef.current);
    };
  }, []);
}
