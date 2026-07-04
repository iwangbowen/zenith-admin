/**
 * pinyin-pro 异步加载封装：把 ~290KB 的拼音词典移出首屏关键路径。
 *
 * 未就绪时 pinyinMatch 返回 null 并自动触发后台加载；
 * 所有调用方均需（且现均已）叠加普通子串匹配兜底，因此加载完成前仅拼音搜索暂不可用。
 */
type MatchFn = typeof import('pinyin-pro').match;

let matchFn: MatchFn | null = null;
let loadPromise: Promise<void> | null = null;

/** 触发（幂等）pinyin-pro 动态加载；可在空闲时机预热 */
export function ensurePinyin(): Promise<void> {
  loadPromise ??= import('pinyin-pro').then((m) => {
    matchFn = m.match;
  });
  return loadPromise;
}

/** 与 pinyin-pro 的 match 同签名；词典未就绪时返回 null 并触发加载 */
export function pinyinMatch(...args: Parameters<MatchFn>): ReturnType<MatchFn> | null {
  if (!matchFn) {
    void ensurePinyin();
    return null;
  }
  return matchFn(...args);
}
