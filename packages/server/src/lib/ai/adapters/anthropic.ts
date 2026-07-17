import { httpRequest } from '../../http-client';
import { estimateTokens } from '../tokens';
import { AI_SSRF_OPTIONS } from '../outbound';
import type { StreamChatConfig, ChatMessage, StreamChunk } from './openai-compatible';

const STREAM_IDLE_TIMEOUT_MS = Number(process.env.AI_STREAM_IDLE_TIMEOUT_MS) || 90000;
const ANTHROPIC_VERSION = '2023-06-01';

/** 从 Anthropic 错误响应体提取可读信息 */
function extractError(body: string, status: number): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    if (parsed.error?.message) return parsed.error.message;
  } catch { /* ignore */ }
  return `Anthropic API 调用失败（HTTP ${status}）`;
}

/** 把统一 ChatMessage（含 vision 数组内容）转为 Anthropic messages 格式；过滤 system/tool 角色（分别走 system 参数 / 仅 openai_compatible 支持） */
function toAnthropicMessages(messages: ChatMessage[]) {
  return messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => {
      if (typeof m.content === 'string') return { role: m.role, content: m.content };
      // vision 数组：text + image_url(data url) → Anthropic source.base64
      const parts = m.content.map((p) => {
        if (p.type === 'text') return { type: 'text' as const, text: p.text ?? '' };
        const url = p.image_url?.url ?? '';
        const match = /^data:(image\/[a-zA-Z+.-]+);base64,(.+)$/.exec(url);
        if (match) {
          return { type: 'image' as const, source: { type: 'base64' as const, media_type: match[1], data: match[2] } };
        }
        return { type: 'image' as const, source: { type: 'url' as const, url } };
      });
      return { role: m.role, content: parts };
    });
}

/**
 * Anthropic Messages API 流式适配器（/v1/messages + x-api-key）。
 * SSE 事件：message_start（input usage）→ content_block_delta（text_delta / thinking_delta）
 * → message_delta（output usage）→ message_stop。
 */
export async function* streamChatAnthropic(
  config: StreamChatConfig,
  messages: ChatMessage[],
  signal?: AbortSignal,
): AsyncGenerator<StreamChunk> {
  const base = config.baseUrl.replace(/\/$/, '');
  const url = base.endsWith('/v1') ? `${base}/messages` : `${base}/v1/messages`;

  const ac = new AbortController();
  let idleTimedOut = false;
  const onExternalAbort = () => ac.abort();
  if (signal) {
    if (signal.aborted) ac.abort();
    else signal.addEventListener('abort', onExternalAbort, { once: true });
  }
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const armIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { idleTimedOut = true; ac.abort(); }, STREAM_IDLE_TIMEOUT_MS);
  };
  const cleanup = () => {
    if (idleTimer) clearTimeout(idleTimer);
    if (signal) signal.removeEventListener('abort', onExternalAbort);
  };

  let res;
  try {
    armIdle();
    res = await httpRequest(url, {
      method: 'POST',
      headers: {
        'x-api-key': config.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: config.maxTokens,
        temperature: Number.parseFloat(config.temperature) || 0.7,
        ...(config.systemPrompt && { system: config.systemPrompt }),
        messages: toAnthropicMessages(messages),
        stream: true,
      }),
      timeout: 0,
      retries: 1,
      signal: ac.signal,
      ...AI_SSRF_OPTIONS,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      yield { type: 'error', error: extractError(errText, res.status) };
      cleanup();
      return;
    }
  } catch (err: unknown) {
    cleanup();
    if (signal?.aborted) return;
    if (idleTimedOut) { yield { type: 'error', error: '连接 AI 服务超时，请重试' }; return; }
    if (err instanceof Error && err.name === 'AbortError') return;
    yield { type: 'error', error: err instanceof Error ? err.message : 'Anthropic API 调用失败' };
    return;
  }

  const body = res.raw.body;
  if (!body) {
    cleanup();
    yield { type: 'error', error: '响应体为空' };
    return;
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let tokensInput = 0;
  let tokensOutput = 0;
  let accumulated = '';
  let reasoningAccumulated = '';

  const finalizeTokens = () => {
    if (!tokensInput) {
      tokensInput = messages.reduce((sum, m) => sum + estimateTokens(typeof m.content === 'string' ? m.content : JSON.stringify(m.content)), 0);
    }
    if (!tokensOutput && (accumulated || reasoningAccumulated)) {
      tokensOutput = estimateTokens(accumulated) + estimateTokens(reasoningAccumulated);
    }
  };

  try {
    while (true) {
      armIdle();
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (!data) continue;
        try {
          const parsed = JSON.parse(data) as {
            type?: string;
            message?: { usage?: { input_tokens?: number; output_tokens?: number } };
            delta?: { type?: string; text?: string; thinking?: string };
            usage?: { output_tokens?: number };
            error?: { message?: string };
          };
          switch (parsed.type) {
            case 'message_start':
              tokensInput = parsed.message?.usage?.input_tokens ?? 0;
              break;
            case 'content_block_delta': {
              const d = parsed.delta;
              if (d?.type === 'text_delta' && d.text) {
                accumulated += d.text;
                yield { type: 'delta', content: d.text };
              } else if (d?.type === 'thinking_delta' && d.thinking) {
                reasoningAccumulated += d.thinking;
                yield { type: 'reasoning', content: d.thinking };
              }
              break;
            }
            case 'message_delta':
              if (parsed.usage?.output_tokens) tokensOutput = parsed.usage.output_tokens;
              break;
            case 'error':
              yield { type: 'error', error: parsed.error?.message ?? 'Anthropic 流式响应错误' };
              return;
            case 'message_stop':
              finalizeTokens();
              yield { type: 'done', tokensInput, tokensOutput };
              return;
            default:
              break;
          }
        } catch { /* 忽略格式异常的 chunk */ }
      }
    }
  } catch (err: unknown) {
    if (signal?.aborted) return;
    if (idleTimedOut) { yield { type: 'error', error: 'AI 响应超时，请重试' }; return; }
    if (err instanceof Error && err.name === 'AbortError') return;
    yield { type: 'error', error: err instanceof Error ? err.message : '读取响应流失败' };
    return;
  } finally {
    cleanup();
    reader.releaseLock();
  }

  finalizeTokens();
  yield { type: 'done', tokensInput, tokensOutput };
}
