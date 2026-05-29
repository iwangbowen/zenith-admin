import { useCallback, useState } from 'react';

/**
 * 将异步代码 / 事件处理器中的错误抛入最近的 React Error Boundary。
 *
 * React Error Boundary 只能捕获渲染阶段的错误，无法直接捕获事件处理器或异步代码中的错误。
 * 本 hook 通过 setState 触发重新渲染，在渲染时 throw，借助 React 的机制传递给最近的 ErrorBoundary。
 *
 * @example
 * ```tsx
 * const throwToErrorBoundary = useErrorHandler();
 *
 * async function handleClick() {
 *   try {
 *     await riskyOperation();
 *   } catch (err) {
 *     throwToErrorBoundary(err instanceof Error ? err : new Error(String(err)));
 *   }
 * }
 * ```
 */
export function useErrorHandler() {
  const [error, setError] = useState<Error | null>(null);

  // 若错误已设置，在渲染阶段 throw，触发最近的 ErrorBoundary 捕获
  if (error) throw error;

  return useCallback((err: Error) => {
    setError(err);
  }, []);
}
