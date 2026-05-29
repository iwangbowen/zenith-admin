import { useEffect } from 'react';
import { Toast } from '@douyinfe/semi-ui';

/**
 * 全局异步错误兜底。
 *
 * React Error Boundary 无法捕获 Promise rejection 和 window.onerror 级别的错误。
 * 本 hook 在 App 根组件中挂载一次，通过以下两个全局事件托底：
 *
 * - `unhandledrejection`：未被 catch 的 Promise 拒绝
 * - `error`：未被捕获的同步运行时错误（脚本层面）
 *
 * 捕获后以 Toast 通知用户，同时在控制台输出完整信息，不影响页面正常使用。
 */
export function useGlobalErrorHandler() {
  useEffect(() => {
    function handleUnhandledRejection(event: PromiseRejectionEvent) {
      const reason = event.reason;
      const message =
        reason instanceof Error
          ? reason.message
          : String(reason || '发生了未处理的异步错误');

      console.error('[GlobalErrorHandler] 未处理的 Promise rejection:', reason);

      Toast.error({
        content: `操作失败：${message}`,
        duration: 5,
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

      Toast.error({
        content: `页面发生错误：${event.message}`,
        duration: 5,
      });
    }

    globalThis.addEventListener('unhandledrejection', handleUnhandledRejection);
    globalThis.addEventListener('error', handleWindowError);

    return () => {
      globalThis.removeEventListener('unhandledrejection', handleUnhandledRejection);
      globalThis.removeEventListener('error', handleWindowError);
    };
  }, []);
}
