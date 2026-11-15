import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button, Typography } from '@douyinfe/semi-ui';
import { ApiError } from '@/lib/query';

const { Title, Text } = Typography;

/** 自动重试退避序列（秒），末位为上限：持续失败时不会无限拉长，也不会一直高频打服务端 */
const AUTO_RETRY_DELAYS = [5, 10, 20, 30, 60] as const;

function delayAt(attempt: number): number {
  return AUTO_RETRY_DELAYS[Math.min(attempt, AUTO_RETRY_DELAYS.length - 1)];
}

function subscribeOnline(onChange: () => void) {
  globalThis.addEventListener('online', onChange);
  globalThis.addEventListener('offline', onChange);
  return () => {
    globalThis.removeEventListener('online', onChange);
    globalThis.removeEventListener('offline', onChange);
  };
}

/** 浏览器在线状态；非浏览器环境降级为在线，避免误报离线文案 */
function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

type FailureKind = 'offline' | 'network' | 'server';

interface Reason {
  kind: FailureKind;
  title: string;
  description: string;
}

/**
 * 区分失败原因：「断网」「连不上」「服务端报错」是三种完全不同的处置动作，
 * 统一显示「请检查网络」会把用户引向错误的排查方向。
 */
function resolveReason(params: {
  online: boolean;
  error: Error | null;
  title: string;
  description: string;
  offlineDescription?: string;
}): Reason {
  const { online, error, title, description, offlineDescription } = params;

  if (!online) {
    return {
      kind: 'offline',
      title: '网络连接已断开',
      description: offlineDescription ?? '设备当前处于离线状态，恢复网络后会自动重试。',
    };
  }

  // code=-1 是 http-client 统一的连接层失败（fetch 抛错 / 响应无法解析），仍按调用方文案展示；
  // 正数业务码说明服务端已经应答，属于另一类故障
  if (error instanceof ApiError) {
    if (error.code > 0) {
      return {
        kind: 'server',
        title: '服务器返回异常',
        description: `${error.message}（错误码 ${error.code}）`,
      };
    }
  }

  return { kind: 'network', title, description };
}

export interface FullPageRetryProps {
  title: string;
  description: string;
  onRetry: () => void;
  /** 重试进行中：按钮转圈并暂停自动重试倒计时 */
  retrying?: boolean;
  /** 失败原因，用于区分文案与开发态诊断 */
  error?: Error | null;
  /** 离线时的替代描述（默认给通用文案） */
  offlineDescription?: string;
  /** 关闭倒计时自动重试 */
  autoRetry?: boolean;
  /** 次要出口，避免用户被困在本页（如「重新登录」） */
  secondaryAction?: { label: string; onClick: () => void };
}

/**
 * 全屏失败重试页
 *
 * 用于会话校验、导航菜单等「拿不到就没法进应用」的首载失败：
 * 保留凭证、区分失败原因、离线感知 + 指数退避自动重试，并提供次要出口。
 */
export default function FullPageRetry({
  title,
  description,
  onRetry,
  retrying = false,
  error = null,
  offlineDescription,
  autoRetry = true,
  secondaryAction,
}: Readonly<FullPageRetryProps>) {
  const online = useOnline();
  // 重试期间 TanStack Query 会先把 error 清空（无数据的查询重新 fetch 会重置状态），
  // 保留最近一次失败原因，文案才不会在重试瞬间跳回通用文案
  const [lastError, setLastError] = useState<Error | null>(error);
  useEffect(() => {
    if (error) setLastError(error);
  }, [error]);

  const reason = resolveReason({ online, error: lastError, title, description, offlineDescription });

  // onRetry 多为调用方内联的箭头函数，引用每次渲染都变；放进 ref 后倒计时 effect 只依赖原始值，
  // 否则定时器会被反复重建，倒计时永远走不到 0
  const retryRef = useRef(onRetry);
  useEffect(() => {
    retryRef.current = onRetry;
  }, [onRetry]);

  const [attempt, setAttempt] = useState(0);
  const [countdown, setCountdown] = useState(() => delayAt(0));
  const paused = !autoRetry || !online || retrying;

  useEffect(() => {
    if (paused) return;
    const timer = setInterval(() => setCountdown((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => clearInterval(timer);
  }, [paused]);

  useEffect(() => {
    if (paused || countdown > 0) return;
    const next = attempt + 1;
    setAttempt(next);
    setCountdown(delayAt(next));
    retryRef.current();
  }, [paused, countdown, attempt]);

  // 离线期间不做无谓请求；网络恢复的瞬间立刻重试一次，而不是等下一个退避窗口
  const wasOfflineRef = useRef(!online);
  useEffect(() => {
    if (!online) {
      wasOfflineRef.current = true;
      return;
    }
    if (!wasOfflineRef.current) return;
    wasOfflineRef.current = false;
    setAttempt(0);
    setCountdown(0);
  }, [online]);

  const handleRetry = useCallback(() => {
    setAttempt(0);
    setCountdown(delayAt(0));
    onRetry();
  }, [onRetry]);

  let hint = '';
  if (retrying) hint = '正在重新连接…';
  else if (!online) hint = '网络恢复后将自动重试';
  else if (autoRetry) hint = `${countdown} 秒后自动重试`;

  return (
    <div className="page-status" data-failure-kind={reason.kind}>
      {/* 倒计时留在 alert 区域之外：读屏软件会逐秒播报，把真正的错误信息淹没 */}
      <div className="page-status__body" role="alert">
        <Title heading={5} style={{ margin: 0 }}>{reason.title}</Title>
        <Text type="secondary" className="page-status__desc">{reason.description}</Text>
      </div>

      <div className="page-status__actions">
        <Button theme="solid" type="primary" loading={retrying} onClick={handleRetry}>
          重试
        </Button>
        {secondaryAction && (
          <Button theme="borderless" type="tertiary" onClick={secondaryAction.onClick}>
            {secondaryAction.label}
          </Button>
        )}
      </div>

      {hint && (
        <Text type="tertiary" size="small" aria-live="off">{hint}</Text>
      )}
    </div>
  );
}
