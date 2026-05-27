import { httpRequest } from '../../http-client';

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
  | { type: 'done'; tokensInput: number; tokensOutput: number }
  | { type: 'error'; error: string };

/**
 * OpenAI 兼容格式的流式聊天适配器（覆盖 OpenAI、DeepSeek、Qwen、Kimi、GLM、Ollama 等）
 * 使用 httpRequest 发送请求，通过 res.raw.body 读取 SSE 流
 */
export async function* streamChatOpenAICompatible(
  config: StreamChatConfig,
  messages: ChatMessage[],
): AsyncGenerator<StreamChunk> {
  const allMessages: ChatMessage[] = config.systemPrompt
    ? [{ role: 'system', content: config.systemPrompt }, ...messages]
    : messages;

  let res;
  try {
    res = await httpRequest(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
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
        max_tokens: config.maxTokens,
        temperature: Number.parseFloat(config.temperature) || 0.7,
      }),
      timeout: 0,
      retries: 0,
    });
  } catch (err: unknown) {
    yield { type: 'error', error: err instanceof Error ? err.message : 'LLM API 调用失败' };
    return;
  }

  const body = res.raw.body;
  if (!body) {
    yield { type: 'error', error: '响应体为空' };
    return;
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let tokensInput = 0;
  let tokensOutput = 0;

  try {
    while (true) {
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
          yield { type: 'done', tokensInput, tokensOutput };
          return;
        }

        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;
          if (typeof content === 'string' && content) {
            yield { type: 'delta', content };
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
  } finally {
    reader.releaseLock();
  }

  yield { type: 'done', tokensInput, tokensOutput };
}
