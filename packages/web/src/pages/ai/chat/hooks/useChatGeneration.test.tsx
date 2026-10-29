import { act, renderHook } from '@testing-library/react';
import { useEffect, useRef, useState } from 'react';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiConversation } from '@zenith/shared/ai';
import type { ChatMessage } from '../message-adapters';

const state = vi.hoisted(() => ({ fetchRaw: vi.fn(), create: vi.fn() }));
vi.mock('@/utils/request', () => ({ request: { fetchRaw: state.fetchRaw } }));
vi.mock('@douyinfe/semi-ui', () => ({ Toast: { error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock('@/hooks/queries/ai-extras', () => ({ getActiveGeneration: async () => ({ genId: null }), cancelGeneration: async () => {} }));
import { useChatGeneration } from './useChatGeneration';

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const wire = 'event: delta\ndata: {"content":"完整尾部"}\n\nevent: saved\ndata: {"assistantMsgId":42,"userMsgId":41}\n\nevent: done\ndata: {}\n\n';

function useHarness(id: number | null) {
  const [activeConvId, setActiveConvId] = useState(id);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversations, setConversations] = useState<AiConversation[]>([]);
  const [generating, setGenerating] = useState(false);
  const [images, setImages] = useState<string[]>([]);
  const [, setLeaf] = useState<number | null>(null);
  useEffect(() => setActiveConvId(id), [id]);
  const configureValuesRef = useRef<Record<string, unknown>>({});
  const dialogueRef = useRef(null);
  const generation = useChatGeneration({
    queryClient: client, activeConvId, messages, setMessages, setConversations, allApiMessages: [], setActiveLeafId: setLeaf,
    generating, setGenerating, pendingImages: images, setPendingImages: setImages, configureValuesRef, dialogueRef,
    createConversationMutation: { mutateAsync: state.create },
    activateNewConversation: (conv) => { setActiveConvId(conv.id); setConversations([conv]); },
  });
  return { ...generation, messages, generating, activeConvId, conversations };
}

beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); client.clear(); });

describe('chat generation lifecycle', () => {
  it('keeps queued React content, saved ids and completion after the stream controller is released', async () => {
    state.fetchRaw.mockResolvedValue(new Response(wire));
    const { result } = renderHook(() => useHarness(1));
    await act(async () => { await result.current.handleMessageSend({ text: '问题' }); });
    expect(result.current.generating).toBe(false);
    expect(result.current.messages.at(-1)).toMatchObject({ id: 'api-42', content: '完整尾部', status: 'completed' });
    expect(result.current.messages.at(-2)?.id).toBe('api-41');
  });

  it('does not abort the first stream when automatic conversation creation changes the active id', async () => {
    state.create.mockResolvedValue({ id: 7, title: '新对话' });
    state.fetchRaw.mockResolvedValue(new Response(wire));
    const { result } = renderHook(() => useHarness(null));
    await act(async () => { await result.current.handleMessageSend({ text: '创建并发送' }); });
    expect(result.current.activeConvId).toBe(7);
    expect(result.current.messages.at(-1)).toMatchObject({ id: 'api-42', content: '完整尾部', status: 'completed' });
  });

  it('flushes trailing text on stop, without losing a message whose id was saved', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    state.fetchRaw.mockImplementation((_url: unknown, options: { signal: AbortSignal }) => {
      const body = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
      options.signal.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')));
      return Promise.resolve(new Response(body));
    });
    const { result } = renderHook(() => useHarness(1));
    let sending!: Promise<void>;
    await act(async () => { sending = result.current.handleMessageSend({ text: '停止测试' }); });
    await act(async () => {
      controller.enqueue(new TextEncoder().encode('event: delta\ndata: {"content":"已保存"}\n\nevent: saved\ndata: {"assistantMsgId":42}\n\nevent: delta\ndata: {"content":"尾部"}\n\n'));
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => { result.current.handleStopGenerate(); await sending; });
    expect(result.current.messages.at(-1)).toMatchObject({ id: 'api-42', content: '已保存尾部', status: 'completed' });
    expect(result.current.generating).toBe(false);
  });

  it('aborts a superseded view without allowing its late finally to stop the next generation', async () => {
    let firstSignal!: AbortSignal;
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    state.fetchRaw.mockImplementationOnce((_url: unknown, options: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      firstSignal = options.signal;
      options.signal.addEventListener('abort', () => setTimeout(() => reject(new DOMException('aborted', 'AbortError')), 20));
    }));
    state.fetchRaw.mockResolvedValueOnce(new Response(new ReadableStream({ start(c) { controller = c; } })));
    const { result, rerender, unmount } = renderHook(({ id }) => useHarness(id), { initialProps: { id: 1 } });
    let first!: Promise<void>;
    await act(async () => { first = result.current.handleMessageSend({ text: '旧问题' }); });
    rerender({ id: 2 });
    expect(firstSignal.aborted).toBe(true);
    let second!: Promise<void>;
    await act(async () => { second = result.current.handleMessageSend({ text: '新问题' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(20); await first; });
    expect(result.current.generating).toBe(true);
    await act(async () => { controller.enqueue(new TextEncoder().encode(wire)); controller.close(); await second; });
    expect(result.current.generating).toBe(false);
    expect(result.current.messages.at(-1)).toMatchObject({ id: 'api-42', status: 'completed', content: '完整尾部' });
    unmount();
  });
});
