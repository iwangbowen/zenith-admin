import type { ChatMessage } from './factory';

/**
 * 轻量 token 估算（无需引入 tokenizer 依赖）。
 * CJK 字符约 1 token/字，其余字符约 0.3 token/字（英文/数字 ≈ 3-4 char/token）。
 * 仅用于上下文裁剪的相对预算控制，非精确计费。
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let tokens = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    const isCjk =
      (code >= 0x2e80 && code <= 0x9fff) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0x3000 && code <= 0x30ff) ||
      (code >= 0xff00 && code <= 0xffef);
    tokens += isCjk ? 1 : 0.3;
  }
  return Math.ceil(tokens);
}

/** 消息内容 token 估算（vision 数组内容：文本累计 + 每图约 200 token） */
function estimateContentTokens(content: ChatMessage['content']): number {
  if (typeof content === 'string') return estimateTokens(content);
  return content.reduce((sum, p) => sum + (p.type === 'text' ? estimateTokens(p.text ?? '') : 200), 0);
}

export interface TruncateOptions {
  /** 历史消息 token 预算上限（不含 systemPrompt 与本次提问） */
  maxTokens?: number;
  /** 历史消息条数硬上限（兜底，防止超大对话全量扫描） */
  maxCount?: number;
}

/**
 * 按 token 预算对历史消息做「保留最近、丢弃更早」的滑动窗口裁剪。
 * 入参为「时间倒序」的消息（最近的在前），返回「时间升序」的裁剪结果。
 * 至少保留最近 1 条，避免预算过小导致空上下文。
 */
export function truncateHistoryByBudget<T extends Pick<ChatMessage, 'content'>>(
  recentFirst: T[],
  options: TruncateOptions = {},
): T[] {
  const maxTokens = options.maxTokens ?? 6000;
  const maxCount = options.maxCount ?? 20;
  const kept: T[] = [];
  let budget = maxTokens;
  for (const msg of recentFirst) {
    if (kept.length >= maxCount) break;
    const cost = estimateContentTokens(msg.content);
    if (kept.length > 0 && budget - cost < 0) break;
    budget -= cost;
    kept.push(msg);
  }
  return kept.reverse();
}
