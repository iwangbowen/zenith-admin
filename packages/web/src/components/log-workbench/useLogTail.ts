import { useCallback, useEffect, useRef, useState } from 'react';
import { Toast } from '@douyinfe/semi-ui';
import { request } from '@/utils/request';
import { readSseStream } from '@/utils/streaming';

export const MAX_TAIL_LINES = 5000;
const TAIL_RETRY_LIMIT = 3;
const TAIL_RETRY_DELAY_MS = 1500;

/**
 * 日志实时追踪的连接状态机：SSE 消费、缓冲上限、暂停 / 积压 / 继续、断线自动重连。
 * 日志文件与日志查看器共用（两者 SSE 协议一致）。组件卸载时自动断开。
 *
 * @param url SSE 地址（event: log，每帧一行）；为 null 时不可追踪
 */
export function useLogTail(url: string | null) {
  const [tailing, setTailing] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [paused, setPaused] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [reconnecting, setReconnecting] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const pausedRef = useRef(false);
  const pendingRef = useRef<string[]>([]);

  const resetPause = useCallback(() => {
    pausedRef.current = false;
    setPaused(false);
    pendingRef.current = [];
    setPendingCount(0);
  }, []);

  /** 断开连接并清理暂停 / 积压状态；来源切换 / 卸载 / 用户停止都走这里 */
  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setTailing(false);
    setReconnecting(false);
    resetPause();
  }, [resetPause]);

  useEffect(() => () => {
    abortRef.current?.abort();
  }, []);

  const appendLines = useCallback((batch: string[]) => {
    setLines((prev) => (prev.length + batch.length > MAX_TAIL_LINES
      ? [...prev, ...batch].slice(-MAX_TAIL_LINES)
      : [...prev, ...batch]));
  }, []);

  const pause = useCallback(() => {
    pausedRef.current = true;
    setPaused(true);
  }, []);

  const resume = useCallback(() => {
    pausedRef.current = false;
    setPaused(false);
    const pending = pendingRef.current;
    pendingRef.current = [];
    setPendingCount(0);
    if (pending.length > 0) appendLines(pending);
  }, [appendLines]);

  const start = useCallback(async () => {
    if (!url || abortRef.current) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setTailing(true);
    setLines([]);
    resetPause();
    setReconnecting(false);

    const appendBatch = (batch: string[]) => {
      // 暂停期间进积压缓冲（同样受 MAX_TAIL_LINES 限制），恢复时一次性合并
      if (pausedRef.current) {
        pendingRef.current = [...pendingRef.current, ...batch].slice(-MAX_TAIL_LINES);
        setPendingCount(pendingRef.current.length);
        return;
      }
      appendLines(batch);
    };

    let failures = 0;
    try {
      // 断线自动重连：收到数据即清零计数，连续失败达到上限才停止
      while (!ctrl.signal.aborted) {
        let gotData = false;
        try {
          const res = await request.fetchRaw(url, { signal: ctrl.signal, silent: true });
          if (res?.ok && res.body) {
            setReconnecting(false);
            await readSseStream(res, (events) => {
              const batch = events.map((e) => e.data).filter(Boolean);
              if (batch.length === 0) return;
              gotData = true;
              appendBatch(batch);
            });
          }
        } catch (e: unknown) {
          if (ctrl.signal.aborted || (e instanceof Error && e.name === 'AbortError')) return;
        }
        if (ctrl.signal.aborted) return;
        failures = gotData ? 0 : failures + 1;
        if (failures >= TAIL_RETRY_LIMIT) {
          Toast.error('实时追踪连接中断，已停止');
          return;
        }
        setReconnecting(true);
        await new Promise((resolve) => setTimeout(resolve, TAIL_RETRY_DELAY_MS));
      }
    } finally {
      if (abortRef.current === ctrl) {
        abortRef.current = null;
        setTailing(false);
        setReconnecting(false);
      }
    }
  }, [url, appendLines, resetPause]);

  return {
    tailing,
    paused,
    reconnecting,
    lines,
    pendingCount,
    capped: lines.length >= MAX_TAIL_LINES,
    start,
    stop,
    pause,
    resume,
  };
}
