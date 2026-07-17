import { httpRequest } from '../../http-client';
import { estimateTokens } from '../tokens';
import type { StreamChatConfig, ChatMessage, StreamChunk } from './openai-compatible';

const STREAM_IDLE_TIMEOUT_MS = Number(process.env.AI_STREAM_IDLE_TIMEOUT_MS) || 90000;

function extractError(body: string, status: number): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    if (parsed.error?.message) return parsed.error.message;
  } catch { /* ignore */ }
  return `Gemini API 调用失败（HTTP ${status}）`;
}

/** 把统一 ChatMessage 转为 Gemini contents 格式（system 走 systemInstruction） */
function toGeminiContents(messages: ChatMessage[]) {
  return messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => {
      const role = m.role === 'assistant' ? 'model' : 'user';
      if (typeof m.content === 'string') return { role, parts: [{ text: m.content }] };
      const parts = m.content.map((p) => {
        if (p.type === 'text') return { text: p.text ?? '' };
        const url = p.image_url?.url ?? '';
        const match = /^data:(image\/[a-zA-Z+.-]+);base64,(.+)$/.exec(url);
        if (match) return { inlineData: { mimeType: match[1], data: match[2] } };
        return { text: `[图片: ${url}]` };
      });
      return { role, parts };
    });
}

/**
 * Google Gemini 流式适配器（generateContent SSE：`:streamGenerateContent?alt=sse`）。
 * baseUrl 形如 `https://generativelanguage.googleapis.com/v1beta`（可含或不含 /v1beta，自动补全）。
 */
export async function* streamChatGemini(
  config: StreamChatConfig,
  messages: ChatMessage[],
  signal?: AbortSignal,
): AsyncGenerator<StreamChunk> {
  let base = config.baseUrl.replace(/\/$/, '');
  if (!/\/v1(beta)?$/.test(base)) base = `${base}/v1beta`;
  const url = `${base}/models/${encodeURIComponent(config.model)}:streamGenerateContent?alt=sse`;

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
        'x-goog-api-key': config.apiKey,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        contents: toGeminiContents(messages),
        ...(config.systemPrompt && { systemInstruction: { parts: [{ text: config.systemPrompt }] } }),
        generationConfig: {
          maxOutputTokens: config.maxTokens,
          temperature: Number.parseFloat(config.temperature) || 0.7,
        },
      }),
      timeout: 0,
      retries: 1,
      signal: ac.signal,
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
    yield { type: 'error', error: err instanceof Error ? err.message : 'Gemini API 调用失败' };
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

  const finalizeTokens = () => {
    if (!tokensInput) {
      tokensInput = messages.reduce((sum, m) => sum + estimateTokens(typeof m.content === 'string' ? m.content : JSON.stringify(m.content)), 0);
    }
    if (!tokensOutput && accumulated) tokensOutput = estimateTokens(accumulated);
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
            candidates?: { content?: { parts?: { text?: string }[] } }[];
            usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
            error?: { message?: string };
          };
          if (parsed.error?.message) {
            yield { type: 'error', error: parsed.error.message };
            return;
          }
          const text = parsed.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
          if (text) {
            accumulated += text;
            yield { type: 'delta', content: text };
          }
          if (parsed.usageMetadata) {
            tokensInput = parsed.usageMetadata.promptTokenCount ?? tokensInput;
            tokensOutput = parsed.usageMetadata.candidatesTokenCount ?? tokensOutput;
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
