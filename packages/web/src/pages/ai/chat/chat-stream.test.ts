import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SetStateAction } from 'react';
import { consumeChatStream } from './chat-stream';
import { extractPlainText, type ChatMessage } from './message-adapters';

vi.mock('@/utils/request', () => ({ request: {} }));
const encoder = new TextEncoder();
const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const assistant = (): ChatMessage => ({ id: 'local-a', role: 'assistant', content: '', status: 'in_progress', createdAt: 1 });

function harness(defer = false) {
  const historical: ChatMessage = { id: 'old', role: 'assistant', content: '历史消息', status: 'completed', createdAt: 0 };
  let messages: ChatMessage[] = [historical, { id: 'local-u', role: 'user', content: '问题', createdAt: 1 }, assistant()];
  let current = true;
  const queued: SetStateAction<ChatMessage[]>[] = [];
  const apply = (update: SetStateAction<ChatMessage[]>) => { messages = typeof update === 'function' ? update(messages) : update; };
  const callbacks = {
    setMessages: vi.fn((update: SetStateAction<ChatMessage[]>) => { if (defer) queued.push(update); else apply(update); }),
    onGeneration: vi.fn(), onSaved: vi.fn(), onTitle: vi.fn(), onDone: vi.fn(), onError: vi.fn(), onFailover: vi.fn(),
  };
  const context = { assistantMsgId: 'local-a', localUserMsgId: 'local-u', skipUserEvent: true, isCurrent: () => current };
  return { callbacks, context, historical, messages: () => messages, last: () => messages.at(-1)!, deactivate: () => { current = false; }, commit: () => { queued.splice(0).forEach(apply); } };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('AI chat stream batching and lifecycle', () => {
  it('coalesces a burst before healing Markdown and updating React, retaining all text', async () => {
    const h = harness();
    const deltas = Array.from({ length: 500 }, (_, i) => frame('delta', { content: `${i},` })).join('');
    await consumeChatStream(new Response(deltas + frame('done', {})), h.context, h.callbacks);
    expect(extractPlainText(h.last())).toBe(Array.from({ length: 500 }, (_, i) => `${i},`).join(''));
    expect(h.last().status).toBe('completed');
    expect(h.callbacks.setMessages.mock.calls.length).toBeLessThan(8);
    expect(h.messages()[0]).toBe(h.historical);
    const calls = h.callbacks.setMessages.mock.calls.length;
    await vi.runAllTimersAsync();
    expect(h.callbacks.setMessages).toHaveBeenCalledTimes(calls);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('flushes pending rich content before saved and follows the new id for later events, including deferred React updaters', async () => {
    const h = harness(true);
    const stream = 'event: delta\ndata: invalid json\n\n' + frame('gen', null) + [
      frame('gen', { genId: 'generation-1' }), frame('delta', { content: '中文😀' }),
      frame('reasoning', { content: '思考' }), frame('tool_call', { name: 'lookup', arguments: '{}', result: 'ok' }),
      frame('references', { references: [{ docName: '证据', content: '片段', score: 1 }] }),
      frame('saved', { assistantMsgId: 102, userMsgId: 101, model: 'actual-model' }),
      frame('delta', { content: '尾巴' }), frame('title', { title: '新标题' }), frame('done', {}),
    ].join('');
    await consumeChatStream(new Response(stream), h.context, h.callbacks);
    h.commit();
    expect(h.messages()[1].id).toBe('api-101');
    expect(h.last()).toMatchObject({ id: 'api-102', status: 'completed', model: 'actual-model' });
    expect(extractPlainText(h.last())).toBe('中文😀尾巴');
    expect(h.last().content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'reasoning', status: 'completed' }),
      expect.objectContaining({ type: 'function_call', name: 'lookup' }),
      expect.objectContaining({ type: 'kb_references' }),
    ]));
    expect(h.callbacks.onGeneration).toHaveBeenCalledWith('generation-1');
    expect(h.callbacks.onSaved).toHaveBeenCalledWith(102);
    expect(h.callbacks.onTitle).toHaveBeenCalledWith('新标题');
  });

  it('keeps an error status when persistence and done follow the error event', async () => {
    const h = harness();
    await consumeChatStream(new Response(frame('delta', { content: '部分回复' }) + frame('error', { message: '模型失败' }) + frame('saved', { assistantMsgId: 7 }) + frame('done', {})), h.context, h.callbacks);
    expect(h.last()).toMatchObject({ id: 'api-7', status: 'failed', content: '部分回复' });
    expect(h.callbacks.onError).toHaveBeenCalledWith('模型失败');
  });

  it('continues rendering long streams within the throttle window and flushes on EOF', async () => {
    const h = harness();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const response = new Response(new ReadableStream({ start(c) { controller = c; } }));
    const consuming = consumeChatStream(response, h.context, h.callbacks);
    controller.enqueue(encoder.encode(frame('delta', { content: '首段' })));
    await vi.advanceTimersByTimeAsync(0);
    controller.enqueue(encoder.encode(frame('delta', { content: '第二段' })));
    await vi.advanceTimersByTimeAsync(20);
    expect(h.last().content).toBe('首段');
    await vi.advanceTimersByTimeAsync(20);
    expect(h.last().content).toBe('首段第二段');
    controller.enqueue(encoder.encode(frame('delta', { content: '最后一段' })));
    controller.close();
    await consuming;
    expect(h.last().content).toBe('首段第二段最后一段');
    await vi.runAllTimersAsync();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('discards queued updates and callbacks when the view or stream is superseded', async () => {
    const h = harness(true);
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const consuming = consumeChatStream(new Response(new ReadableStream({ start(c) { controller = c; } })), h.context, h.callbacks);
    controller.enqueue(encoder.encode(frame('delta', { content: '旧会话内容' })));
    await vi.advanceTimersByTimeAsync(0);
    h.deactivate();
    controller.enqueue(encoder.encode(frame('saved', { assistantMsgId: 8 }) + frame('done', {})));
    controller.close();
    await consuming;
    h.commit();
    await vi.runAllTimersAsync();
    expect(h.last()).toMatchObject({ id: 'local-a', content: '', status: 'in_progress' });
    expect(h.callbacks.onSaved).not.toHaveBeenCalled();
    expect(h.callbacks.onDone).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('flushes partial text and marks the saved id failed on a transport error', async () => {
    const h = harness();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const consuming = consumeChatStream(new Response(new ReadableStream({ start(c) { controller = c; } })), h.context, h.callbacks);
    controller.enqueue(encoder.encode(frame('delta', { content: '部分' }) + frame('saved', { assistantMsgId: 9 }) + frame('delta', { content: '尾部' })));
    await vi.advanceTimersByTimeAsync(0);
    controller.error(new Error('network lost'));
    await expect(consuming).rejects.toThrow('network lost');
    expect(h.last()).toMatchObject({ id: 'api-9', content: '部分尾部', status: 'failed' });
    await vi.runAllTimersAsync();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('completes reasoning-only content and restores the user event on reconnect', async () => {
    const h = harness();
    await consumeChatStream(new Response(frame('user', { content: '恢复问题' }) + frame('reasoning', { content: '仅思考' }) + frame('done', {})), { ...h.context, skipUserEvent: false }, h.callbacks);
    expect(h.messages().at(-2)).toMatchObject({ role: 'user', content: '恢复问题' });
    expect(h.last().content).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'reasoning', status: 'completed' })]));
  });
});
