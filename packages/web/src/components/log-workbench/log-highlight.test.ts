import { describe, expect, it } from 'vitest';
import { tokenizeLogLine } from './log-highlight';

/** token 文本拼接必须恒等于原行：搜索区间按整行偏移映射的前提 */
function expectRoundTrip(line: string) {
  const tokens = tokenizeLogLine(line);
  expect(tokens).not.toBeNull();
  expect(tokens!.map((t) => t.text).join('')).toBe(line);
}

describe('tokenizeLogLine', () => {
  it('NDJSON 处理保留所有字段和原始文本', () => {
    const line = '{"level":50,"time":"2026-10-14T10:59:07.478+08:00","ok":true,"off":false,"nothing":null,"pid":42516}';
    expectRoundTrip(line);
  });

  it('key 判定容忍冒号前的空白；转义引号不提前终结字符串', () => {
    const line = '{"msg" : "a\\"b", "n" : -12.5e+3}';
    const tokens = tokenizeLogLine(line)!;
    expect(tokens.map((t) => t.text).join('')).toBe(line);
  });

  it('非法 JSON 走 pretty 路径，不抛错且拼接恒等', () => {
    const line = '{"level":50, broken';
    expectRoundTrip(line);
  });

  it('超长行跳过着色返回 null', () => {
    const line = `{"msg":"${'x'.repeat(30_000)}"}`;
    expect(tokenizeLogLine(line)).toBeNull();
  });

  it('token 超限时合并剩余部分，拼接仍恒等', () => {
    // 大量短 kv 对把 token 数推过上限
    const pairs = Array.from({ length: 400 }, (_, i) => `"k${i}":${i}`).join(',');
    const line = `{${pairs}}`;
    expect(line.length).toBeLessThan(20_000);
    const tokens = tokenizeLogLine(line)!;
    expect(tokens.length).toBeLessThanOrEqual(500);
    expect(tokens.map((t) => t.text).join('')).toBe(line);
  });

  it('空行不抛错', () => {
    expect(tokenizeLogLine('')!.map((t) => t.text).join('')).toBe('');
  });
});


describe('日志原文与资源边界', () => {
  it.each(['[ERROR] failed', '[WARN] retry', '[worker] started'])('保留级别与来源标记的完整文本：%s', (line) => {
    expectRoundTrip(line);
  });

  it('密集的 pretty 键值也在扫描期间限额且保留全部原文', () => {
    const line = 'k=v '.repeat(1200);
    const tokens = tokenizeLogLine(line)!;
    expect(tokens.length).toBeLessThanOrEqual(500);
    expect(tokens.map((token) => token.text).join('')).toBe(line);
  });

  it.each(['a'.repeat(19000), ' '.repeat(19000), '"' + '\\'.repeat(15000)])('长的未结构化输入保持完整', (line) => {
    expectRoundTrip(line);
  });
});
