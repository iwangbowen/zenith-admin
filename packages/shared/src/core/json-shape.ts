/**
 * JSON 形状度量工具：属性袋（properties / context / breadcrumb data）的体积与深度校验共用。
 *
 * 埋点上报、前端错误上报、服务端事件采集三处都要对「用户可控的自由 JSON」做同一套限制，
 * 三处必须共用同一份实现：口径一旦分叉就会出现「客户端放行、服务端丢弃」的静默数据丢失。
 */

/**
 * 计算 JSON 值的最大嵌套层级（标量为 0，`{}` / `[]` 为 1）。
 *
 * 用显式栈而非递归，避免深层结构爆栈；用 WeakSet 去重，兼容循环引用（不会死循环）。
 */
export function jsonDepth(value: unknown): number {
  if (value === null || typeof value !== 'object') return 0;
  const stack: Array<{ value: object; depth: number }> = [{ value, depth: 1 }];
  const seen = new WeakSet<object>();
  let maxDepth = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (seen.has(current.value)) continue;
    seen.add(current.value);
    maxDepth = Math.max(maxDepth, current.depth);
    const children = Array.isArray(current.value) ? current.value : Object.values(current.value);
    for (const child of children) {
      if (child !== null && typeof child === 'object') stack.push({ value: child, depth: current.depth + 1 });
    }
  }
  return maxDepth;
}

/**
 * 计算 JSON 序列化后的 UTF-8 字节数；无法序列化（循环引用 / BigInt）时返回 `Infinity`，
 * 让调用方的「超限即拒绝」分支自然命中。
 */
export function jsonByteLength(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}
