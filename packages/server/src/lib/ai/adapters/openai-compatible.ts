import { httpRequest } from '../../http-client';
import { estimateTokens } from '../tokens';

export interface StreamChatConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens: number;
  temperature: string;
  systemPrompt?: string | null;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type StreamChunk =
  | { type: 'delta'; content: string }
  | { type: 'reasoning'; content: string }
  | { type: 'done'; tokensInput: number; tokensOutput: number }
  | { type: 'error'; error: string };

/**
 * OpenAI 兼容格式的流式聊天适配器（覆盖 OpenAI、DeepSeek、Qwen、Kimi、GLM、Ollama 等）
 * 使用 httpRequest 发送请求，通过 res.raw.body 读取 SSE 流。
 * - 连接阶段失败自动重试（AI_STREAM_CONNECT_RETRIES，默认 2）
 * - 读流空闲超时中断（AI_STREAM_IDLE_TIMEOUT_MS，默认 90s）
 */
const STREAM_IDLE_TIMEOUT_MS = Number(process.env.AI_STREAM_IDLE_TIMEOUT_MS) || 90000;
const STREAM_CONNECT_RETRIES = Number(process.env.AI_STREAM_CONNECT_RETRIES ?? 2);

/** 从上游错误响应体中提取可读错误信息 */
function extractApiError(body: string, status: number): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } | string; message?: string };
    if (typeof parsed.error === 'object' && parsed.error?.message) return parsed.error.message;
    if (typeof parsed.error === 'string') return parsed.error;
    if (parsed.message) return parsed.message;
  } catch { /* ignore */ }
  return `LLM API 调用失败（HTTP ${status}）`;
}

export async function* streamChatOpenAICompatible(
  config: StreamChatConfig,
  messages: ChatMessage[],
  signal?: AbortSignal,
): AsyncGenerator<StreamChunk> {
  const allMessages: ChatMessage[] = config.systemPrompt
    ? [{ role: 'system', content: config.systemPrompt }, ...messages]
    : messages;

  // 内部 controller：合并外部中断信号 + 空闲超时，用于中断上游请求
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
  const doConnect = (includeUsage: boolean) =>
    httpRequest(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        model: config.model,
        messages: allMessages,
        stream: true,
        // 显式要求流式响应返回 usage（OpenAI 等默认不带），用于 token 用量统计
        ...(includeUsage && { stream_options: { include_usage: true } }),
        max_tokens: config.maxTokens,
        temperature: Number.parseFloat(config.temperature) || 0.7,
      }),
      timeout: 0,
      retries: STREAM_CONNECT_RETRIES,
      signal: ac.signal,
    });
  try {
    armIdle();
    res = await doConnect(true);
    if (!res.ok && res.status === 400) {
      // 个别老网关不认识 stream_options 字段并报 400，去掉后降级重试一次
      const errText = await res.text().catch(() => '');
      if (errText.includes('stream_options')) {
        armIdle();
        res = await doConnect(false);
      } else {
        yield { type: 'error', error: extractApiError(errText, res.status) };
        cleanup();
        return;
      }
    }
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      yield { type: 'error', error: extractApiError(errText, res.status) };
      cleanup();
      return;
    }
  } catch (err: unknown) {
    cleanup();
    // 用户主动中断：静默结束，由上层保存已生成内容
    if (signal?.aborted) return;
    if (idleTimedOut) { yield { type: 'error', error: '连接 AI 服务超时，请重试' }; return; }
    if (err instanceof Error && err.name === 'AbortError') return;
    yield { type: 'error', error: err instanceof Error ? err.message : 'LLM API 调用失败' };
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

  // 上游未返回 usage 时（部分兼容网关不支持 stream_options），用本地估算兜底，
  // 保证用量统计有量级正确的数据
  const finalizeTokens = () => {
    if (!tokensInput) tokensInput = allMessages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
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
        if (!trimmed.startsWith('data: ')) continue;

        const data = trimmed.slice(6);
        if (data === '[DONE]') {
          finalizeTokens();
          yield { type: 'done', tokensInput, tokensOutput };
          return;
        }

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta;
          const content = delta?.content;
          if (typeof content === 'string' && content) {
            accumulated += content;
            yield { type: 'delta', content };
          }
          // 推理模型思维链（DeepSeek-R1 等：reasoning_content；部分网关：reasoning）
          const reasoning = delta?.reasoning_content ?? delta?.reasoning;
          if (typeof reasoning === 'string' && reasoning) {
            reasoningAccumulated += reasoning;
            yield { type: 'reasoning', content: reasoning };
          }
          // 有些 API 会在最后一个 chunk 附带 usage 信息
          if (parsed.usage) {
            tokensInput = parsed.usage.prompt_tokens ?? 0;
            tokensOutput = parsed.usage.completion_tokens ?? 0;
          }
        } catch {
          // 忽略格式异常的 chunk
        }
      }
    }
  } catch (err: unknown) {
    // 用户主动中断读流：静默结束，保留已产出的 delta
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

/**
 * 非流式单次补全（用于对话自动命名等轻量后台任务）。
 * 失败 / 超时抛错，由调用方决定回退策略。
 */
export async function chatOnceOpenAICompatible(
  config: StreamChatConfig,
  messages: ChatMessage[],
  opts: { timeoutMs?: number } = {},
): Promise<string> {
  const allMessages: ChatMessage[] = config.systemPrompt
    ? [{ role: 'system', content: config.systemPrompt }, ...messages]
    : messages;
  const res = await httpRequest(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      messages: allMessages,
      stream: false,
      max_tokens: config.maxTokens,
      temperature: Number.parseFloat(config.temperature) || 0.7,
    }),
    timeout: opts.timeoutMs ?? 10000,
    retries: 0,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(extractApiError(body, res.status));
  }
  const data = await res.json<{ choices?: { message?: { content?: string } }[] }>();
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('LLM 返回内容为空');
  return content.trim();
}
