import { HttpResponse } from 'msw';
import { CONSOLE_LOG_ROLE_OPTIONS, consoleLogContract, matchesLogCorrelationId, type ConsoleLogRole } from '@zenith/shared/ops';
import { mockOperationLogs } from '@/mocks/data/logs';
import { mockCronJobLogs } from '@/mocks/data/cron-job-logs';
import { mock } from '@/mocks/utils/contract';

/** 使用现有操作演示数据派生应用日志，避免为控制台再维护一套业务场景。 */
function demoLine(role: ConsoleLogRole, sequence: number) {
  if (role === 'worker' || (role === 'all' && sequence % 3 === 0)) {
    const job = mockCronJobLogs[sequence % mockCronJobLogs.length];
    return JSON.stringify({
      level: job.status === 'fail' || job.status === 'timeout' ? 50 : 30, time: Date.now(), hostname: 'zenith-demo', pid: role === 'worker' ? 4201 : 4200,
      role, correlationId: `demo-console-${sequence}`, msg: `[cron] ${job.jobName} · ${job.output ?? job.status}`,
    });
  }
  const item = mockOperationLogs[sequence % mockOperationLogs.length];
  const status = item.responseCode ?? 200;
  return JSON.stringify({
    level: status >= 500 ? 50 : status >= 400 ? 40 : 30,
    time: Date.now(), hostname: 'zenith-demo', pid: 4200,
    role, correlationId: `demo-console-${sequence}`,
    msg: `${item.method} ${item.path} ${status} ${item.durationMs ?? 0}ms · ${item.description}`,
  });
}

const histories = new Map<ConsoleLogRole, string[]>();
function history(role: ConsoleLogRole) {
  let lines = histories.get(role);
  if (!lines) {
    lines = Array.from({ length: 40 }, (_, index) => demoLine(role, index));
    histories.set(role, lines);
  }
  return lines;
}

export const consoleLogsHandlers = [
  mock(consoleLogContract.sources, ({ ok }) => ok({
    currentRole: 'all', hostname: 'zenith-demo', pid: 4200,
    sources: CONSOLE_LOG_ROLE_OPTIONS.map(({ value, label }) => ({ role: value, label, available: true })),
  })),
  mock(consoleLogContract.content, ({ query, ok }) => {
    const lines = history(query.role ?? 'all');
    const limit = query.lines ?? 500;
    if (query.locateCorrelationId) {
      const index = lines.findIndex((line) => matchesLogCorrelationId(line, query.locateCorrelationId!));
      const start = Math.max(0, index - Math.floor(limit / 2));
      return ok({ lines: index < 0 ? lines.slice(-limit) : lines.slice(start, start + limit) });
    }
    if (query.correlationId || query.keyword) {
      const indexes = new Set<number>();
      lines.forEach((line, index) => {
        if (query.correlationId && !matchesLogCorrelationId(line, query.correlationId)) return;
        if (query.keyword && !line.toLowerCase().includes(query.keyword.toLowerCase())) return;
        for (let i = Math.max(0, index - (query.context ?? 0)); i <= Math.min(lines.length - 1, index + (query.context ?? 0)); i += 1) indexes.add(i);
      });
      return ok({ lines: [...indexes].sort((a, b) => a - b).map((index) => lines[index]).slice(-limit) });
    }
    return ok({ lines: lines.slice(-limit) });
  }),
  mock(consoleLogContract.tail, ({ query, headers, request }) => {
    const role = query.role ?? 'all';
    const lines = history(role);
    const prefix = `demo:${role}:`;
    const cursor = headers['last-event-id'];
    const position = cursor?.startsWith(prefix) ? Number(cursor.slice(prefix.length)) : 0;
    const offset = Number.isSafeInteger(position) && position >= 0 && position <= lines.length ? position : 0;
    const encoder = new TextEncoder();
    let timer: ReturnType<typeof setInterval> | undefined;
    let closeStream: (() => void) | undefined;
    const cleanup = () => {
      clearInterval(timer);
      request.signal.removeEventListener('abort', onAbort);
    };
    const onAbort = () => { cleanup(); closeStream?.(); };
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        closeStream = () => controller.close();
        const send = (line: string, index: number) => controller.enqueue(encoder.encode(`id: ${prefix}${index + 1}\nevent: log\ndata: ${line}\n\n`));
        lines.slice(offset).forEach((line, index) => send(line, offset + index));
        if (request.signal.aborted) { controller.close(); return; }
        request.signal.addEventListener('abort', onAbort, { once: true });
        timer = setInterval(() => {
          const line = demoLine(role, lines.length);
          lines.push(line);
          send(line, lines.length - 1);
        }, 2000);
      },
      cancel: cleanup,
    });
    return new HttpResponse(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
  }),
];
