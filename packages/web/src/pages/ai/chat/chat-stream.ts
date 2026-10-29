import type { Dispatch, SetStateAction } from 'react';
import { Throttler } from '@tanstack/react-pacer';
import { readSseStream } from '@/utils/streaming';
import { healStreamingMarkdown } from '@/utils/streaming-markdown';
import { buildAssistantContent, type ChatMessage, type ToolCallDisplay, type KbRefDisplay } from './message-adapters';
import { nextMsgId } from './chat-utils';

export interface ChatStreamContext {
  assistantMsgId: string;
  localUserMsgId: string | null;
  skipUserEvent: boolean;
  isCurrent: () => boolean;
}

interface ChatStreamCallbacks {
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  onGeneration: (id: string) => void;
  onSaved: (id: number) => void;
  onTitle: (title: string) => void;
  onDone: () => void;
  onError: (message: string) => void;
  onFailover: (model: string) => void;
}

/** Coalesce text work, while preserving structural SSE events and the saved message identity. */
export async function consumeChatStream(response: Response, ctx: ChatStreamContext, callbacks: ChatStreamCallbacks): Promise<void> {
  let assistantId = ctx.assistantMsgId;
  let content = '';
  let reasoning = '';
  const tools: ToolCallDisplay[] = [];
  let references: KbRefDisplay[] = [];
  let dirty = false;
  let finished = false;
  let failed = false;

  const patchAssistant = (patch: Partial<ChatMessage>) => {
    if (!ctx.isCurrent()) return;
    const targetId = assistantId;
    callbacks.setMessages((previous) => {
      if (!ctx.isCurrent()) return previous;
      const index = previous.findIndex((message) => message.id === targetId);
      if (index < 0) return previous;
      const next = [...previous];
      next[index] = { ...previous[index], ...patch };
      return next;
    });
  };
  const refresh = () => {
    if (!dirty || !ctx.isCurrent()) return;
    dirty = false;
    patchAssistant({ content: buildAssistantContent(healStreamingMarkdown(content), healStreamingMarkdown(reasoning), finished || content.length > 0, tools, references) });
  };
  const render = new Throttler(refresh, { wait: 40, leading: true, trailing: true });
  const schedule = () => { dirty = true; render.maybeExecute(); };
  const flush = () => { render.flush(); refresh(); };

  try {
    await readSseStream(response, (events) => {
      for (const { event, data } of events) {
        if (!data || !ctx.isCurrent()) continue;
        let parsed: Record<string, unknown>;
        try { parsed = JSON.parse(data) as Record<string, unknown>; } catch { continue; }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
        if (event === 'gen' && typeof parsed.genId === 'string') callbacks.onGeneration(parsed.genId);
        else if (event === 'user' && !ctx.skipUserEvent && typeof parsed.content === 'string') {
          const message: ChatMessage = { id: nextMsgId(), role: 'user', content: parsed.content, createdAt: Date.now() - 1, status: 'completed' };
          const targetId = assistantId;
          callbacks.setMessages((previous) => {
            const index = previous.findIndex((item) => item.id === targetId);
            return index < 0 ? previous : [...previous.slice(0, index), message, ...previous.slice(index)];
          });
        } else if (!finished && (event === 'delta' || event === 'reasoning') && typeof parsed.content === 'string') {
          if (event === 'delta') content += parsed.content;
          else reasoning += parsed.content;
          schedule();
        } else if (!finished && event === 'tool_call') {
          tools.push({ name: String(parsed.name ?? ''), arguments: String(parsed.arguments ?? ''), result: String(parsed.result ?? '') });
          schedule();
        } else if (!finished && event === 'references' && Array.isArray(parsed.references)) {
          references = parsed.references as KbRefDisplay[];
          schedule();
        } else if (event === 'failover') callbacks.onFailover(String(parsed.to ?? ''));
        else if (event === 'saved') {
          flush(); // Pending text belongs to the local id, before it is replaced.
          const id = parsed.assistantMsgId;
          const userId = parsed.userMsgId;
          if (typeof id === 'number') {
            const nextId = `api-${id}`;
            patchAssistant({ id: nextId, ...(typeof parsed.model === 'string' ? { model: parsed.model } : {}) });
            assistantId = nextId;
          }
          if (typeof userId === 'number' && ctx.localUserMsgId) {
            callbacks.setMessages((previous) => previous.map((message) => message.id === ctx.localUserMsgId ? { ...message, id: `api-${userId}` } : message));
          }
          if (typeof id === 'number') callbacks.onSaved(id);
        } else if (event === 'title' && typeof parsed.title === 'string') callbacks.onTitle(parsed.title);
        else if (event === 'done' || event === 'error') {
          finished = true;
          failed ||= event === 'error';
          dirty = true;
          flush();
          patchAssistant({ status: failed ? 'failed' : 'completed' });
          if (event === 'error') callbacks.onError(String(parsed.message ?? 'AI 服务出错'));
          else callbacks.onDone();
        }
      }
    });
  } catch (error) {
    flush();
    if ((error as Error).name !== 'AbortError') patchAssistant({ status: 'failed' });
    throw error;
  } finally {
    flush();
    render.cancel();
  }
}
