import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OutputOf } from '@zenith/shared/core';
import { consoleLogContract } from '@zenith/shared/ops';
import { consoleLogsHandlers } from './handlers/console-logs';

async function call(path: string, init?: RequestInit) {
  const request = new Request(`${window.location.origin}${consoleLogContract.basePath}${path}`, init);
  for (const handler of consoleLogsHandlers) {
    const result = await (handler as unknown as { run(args: unknown): Promise<{ response?: Response } | null> }).run({ request, requestId: `console-${Math.random()}` });
    if (result?.response) return result.response;
  }
  throw new Error(`No handler matched ${path}`);
}

afterEach(() => { vi.useRealTimers(); });

describe('控制台日志 Demo', () => {
  it('角色、近期日志与精确链路定位由同一契约提供', async () => {
    const sources = await (await call('')).json() as { data: OutputOf<typeof consoleLogContract.sources> };
    expect(sources.data.sources.map((item) => item.role)).toEqual(['all', 'api', 'worker']);
    const content = await (await call('/content?role=worker&correlationId=demo-console-4')).json() as { data: { lines: string[] } };
    expect(content.data.lines).toHaveLength(1);
    expect(JSON.parse(content.data.lines[0])).toMatchObject({ role: 'worker', correlationId: 'demo-console-4' });
    const located = await (await call('/content?role=worker&locateCorrelationId=demo-console-4&lines=5')).json() as { data: { lines: string[] } };
    expect(located.data.lines).toHaveLength(5);
    expect(located.data.lines.some((line) => JSON.parse(line).correlationId === 'demo-console-4')).toBe(true);
  });

  it('SSE 支持续传与后续实时帧，取消读取释放定时器', async () => {
    vi.useFakeTimers();
    const response = await call('/tail?role=api', { headers: { 'Last-Event-ID': 'demo:api:39' } });
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const first = await reader.read();
    expect(decoder.decode(first.value)).toContain('id: demo:api:40\nevent: log');
    await vi.advanceTimersByTimeAsync(2000);
    const live = await reader.read();
    expect(decoder.decode(live.value)).toContain('id: demo:api:41\nevent: log');
    await reader.cancel();
    expect(vi.getTimerCount()).toBe(0);
  });
});
