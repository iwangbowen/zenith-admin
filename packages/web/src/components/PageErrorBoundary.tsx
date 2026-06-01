import React from 'react';
import { useLocation } from 'react-router-dom';
import { Button, Empty } from '@douyinfe/semi-ui';
import { IllustrationFailure, IllustrationFailureDark } from '@douyinfe/semi-illustrations';
import { RefreshCw, Home } from 'lucide-react';

interface Props {
  children: React.ReactNode;
  /**
   * 路由路径变更时自动重置错误状态。
   * 推荐传入 `useLocation().pathname`，配合外层函数组件使用。
   */
  resetKey?: string;
}

interface State {
  error: Error | null;
  resetKey: string | undefined;
}

/**
 * 页面级 Error Boundary
 *
 * 捕获子组件的运行时错误，展示友好提示 UI，并提供"重试"与"返回首页"操作。
 * 路由切换时（resetKey 变化）自动清空错误状态，避免跨页面残留。
 *
 * 用法（需配合 useLocation，因为 class 组件不能直接用 hook）：
 * ```tsx
 * function RouteErrorBoundary({ children }) {
 *   const { pathname } = useLocation();
 *   return <PageErrorBoundary resetKey={pathname}>{children}</PageErrorBoundary>;
 * }
 * ```
 */
export class PageErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null, resetKey: props.resetKey };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    // 路由切换时重置
    if (props.resetKey !== state.resetKey) {
      return { error: null, resetKey: props.resetKey };
    }
    return null;
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[PageErrorBoundary] 捕获到运行时错误:', error, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    const isDev = import.meta.env.DEV;
    const error = this.state.error;

    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 400,
          padding: '40px 24px',
        }}
      >
        <Empty
          image={<IllustrationFailure style={{ width: 120, height: 120 }} />}
          darkModeImage={<IllustrationFailureDark style={{ width: 120, height: 120 }} />}
          title="页面加载出错"
          description="当前页面遇到了一个意外错误。你可以尝试刷新页面，或返回首页继续操作。"
        >
          {isDev && (
            <details
              style={{
                width: '100%',
                maxWidth: 640,
                background: 'var(--semi-color-fill-0)',
                border: '1px solid var(--semi-color-border)',
                borderRadius: 8,
                padding: '8px 12px',
                fontSize: 12,
                fontFamily: 'monospace',
                marginTop: 16,
                textAlign: 'left',
              }}
            >
              <summary style={{ cursor: 'pointer', color: 'var(--semi-color-danger)', marginBottom: 8 }}>
                错误详情（仅开发模式可见）
              </summary>
              <div style={{ color: 'var(--semi-color-danger)', marginBottom: 4 }}>
                {error.name}: {error.message}
              </div>
              {error.stack && (
                <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0, color: 'var(--semi-color-text-2)' }}>
                  {error.stack}
                </pre>
              )}
            </details>
          )}
          <div style={{ display: 'flex', gap: 12, marginTop: 16, justifyContent: 'center' }}>
            <Button
              icon={<RefreshCw size={14} />}
              type="primary"
              onClick={this.handleRetry}
            >
              重新加载
            </Button>
            <Button
              icon={<Home size={14} />}
              theme="light"
              onClick={() => { globalThis.location.href = import.meta.env.BASE_URL; }}
            >
              返回首页
            </Button>
          </div>
        </Empty>
      </div>
    );
  }
}

/**
 * 路由感知版 PageErrorBoundary
 *
 * 路由变更时自动重置错误状态。直接替换 Suspense 外层使用。
 * 注意：本组件是函数组件，内部使用 useLocation hook，因此需要在 BrowserRouter 内部使用。
 */
export function RouteErrorBoundary({ children }: { readonly children: React.ReactNode }) {
  const { pathname } = useLocation();
  return (
    <PageErrorBoundary resetKey={pathname}>
      {children}
    </PageErrorBoundary>
  );
}
