import type { Context } from 'hono';
import { stream, streamSSE } from 'hono/streaming';
import type { StreamHandle } from './host-exec';

/**
 * 把长驻子进程（tail -f、journalctl -f 等）的输出转发为 HTTP 流式响应。
 * 写入串行化避免并发 write 交错；客户端断开时终止进程，进程退出时结束响应。
 *
 * @param spawn 启动进程：`onData` 收到每块输出，`onExit` 在进程结束时调用；返回可 kill 的句柄。
 */
export function streamProcessOutput(
  c: Context,
  spawn: (onData: (chunk: string) => void, onExit: () => void) => Promise<StreamHandle>,
): Response {
  return stream(c, async (s) => {
    let finish!: () => void;
    const done = new Promise<void>((resolve) => { finish = resolve; });
    let aborted = false;
    let handle: StreamHandle | null = null;
    let writes = Promise.resolve();
    s.onAbort(() => {
      aborted = true;
      handle?.kill();
      finish();
    });
    handle = await spawn(
      (chunk) => {
        writes = writes
          .then(async () => { await s.write(chunk); })
          .catch(() => { handle?.kill(); finish(); });
      },
      () => { void writes.finally(finish); },
    );
    if (aborted) handle.kill();
    try {
      await done;
      await writes;
    } finally {
      handle.kill();
    }
  });
}

export interface LogTailSource {
  /** 连接建立时先回放的历史行（通常为末尾 100 行） */
  replay: () => Promise<string[]>;
  /**
   * 持续推送新增行，直到 signal 中止或来源结束（文件被删除 / 远端进程退出）。
   * `emit` 带背压（await SSE 写入完成），实现方须串行调用。
   */
  follow: (signal: AbortSignal, emit: (lines: string[]) => Promise<void>) => Promise<void>;
}

/**
 * 日志实时追踪的 SSE 响应：每行一个 `event: log` 事件。
 * 日志文件（本机轮询）与日志查看器（本机轮询 / 远端 tail -f）共用同一协议，前端用一套消费逻辑。
 */
export function streamLogTail(c: Context, source: LogTailSource): Response {
  return streamSSE(c, async (s) => {
    const emit = async (lines: string[]) => {
      for (const line of lines) {
        await s.writeSSE({ data: line, event: 'log' });
      }
    };
    await emit(await source.replay());
    await source.follow(c.req.raw.signal, emit);
  });
}
