import React from 'react';
import { useLocation } from 'react-router-dom';
import { Button, Empty } from '@douyinfe/semi-ui';
import { RefreshCw, Home, Copy } from 'lucide-react';
import { formatDateTime } from '@/utils/date';
import { copyTextWithToast } from '@/utils/clipboard';
import { emptyIllustration } from '@/components/EmptyIllustration';

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
  componentStack: string | null;
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
/**
 * 判定是否为动态模块（chunk）加载失败：网络中断，或发版后旧产物已被清理。
 * 覆盖 Chrome/Firefox/Safari 的原生 dynamic import 报错与 webpack 风格 ChunkLoadError。
 */
function isChunkLoadError(error: Error): boolean {
  return (
    error.name === 'ChunkLoadError' ||
    /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(error.message)
  );
}

export class PageErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null, componentStack: null, resetKey: props.resetKey };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    // 路由切换时重置
    if (props.resetKey !== state.resetKey) {
      return { error: null, componentStack: null, resetKey: props.resetKey };
    }
    return null;
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[PageErrorBoundary] 捕获到运行时错误:', error, info.componentStack);
    this.setState({ componentStack: info.componentStack ?? null });
  }

  handleRetry = () => {
    // chunk 加载失败时浏览器已缓存 rejected 的 module promise，
    // 仅重置边界状态会立即再次失败，必须整页刷新拉取最新产物。
    if (this.state.error && isChunkLoadError(this.state.error)) {
      globalThis.location.reload();
      return;
    }
    this.setState({ error: null, componentStack: null });
  };

  handleCopy = () => {
    const { error, componentStack } = this.state;
    if (!error) return;
    const report = [
      `[Zenith Admin 页面错误报告]`,
      `时间: ${formatDateTime(new Date())}`,
      `页面: ${globalThis.location.href}`,
      `浏览器: ${navigator.userAgent}`,
      ``,
      `${error.name}: ${error.message}`,
      error.stack ? `\n堆栈:\n${error.stack}` : '',
      componentStack ? `\n组件栈:${componentStack}` : '',
    ].filter(Boolean).join('\n');
    void copyTextWithToast(report, { success: '错误信息已复制，可粘贴给开发人员排查', error: '复制失败，请手动选择复制' });
  };

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    const isDev = import.meta.env.DEV;
    const error = this.state.error;
    const chunkFailed = isChunkLoadError(error);

    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          // Keep compact errors centered, but align expanded diagnostics to the scroll start.
          justifyContent: 'safe center',
          minHeight: 'min(400px, 100dvh)',
          maxHeight: '100dvh',
          overflowY: 'auto',
          padding: '40px 24px',
        }}
      >
        <Empty
          {...emptyIllustration('Failure', 120)}
          title={chunkFailed ? '页面资源加载失败' : '页面加载出错'}
          description={chunkFailed
            ? '可能是网络不稳定，或系统刚刚发布了新版本。点击重新加载获取最新页面。'
            : '当前页面遇到了一个意外错误。你可以尝试刷新页面，或返回首页继续操作。'}
        >
          {isDev && (
            <details
              style={{
                width: '100%',
                maxWidth: 640,
                background: 'var(--semi-color-fill-0)',
                border: '1px solid var(--semi-color-border)',
                borderRadius: 'var(--semi-border-radius-medium)',
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
              theme="solid"
              type="primary"
              onClick={this.handleRetry}
            >
              重新加载
            </Button>
            <Button
              icon={<Home size={14} />}
              theme="light"
              type="primary"
              onClick={() => { globalThis.location.href = import.meta.env.BASE_URL; }}
            >
              返回首页
            </Button>
            <Button
              icon={<Copy size={14} />}
              theme="light"
              type="tertiary"
              onClick={this.handleCopy}
            >
              复制错误信息
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
