/**
 * 精确操作系统自报：Win11 的 UA 冻结为 `Windows NT 10.0`，用 Client Hints 区分。
 *
 * 只在能判定得比服务端更准时返回值（Win11），其余一律返回 undefined 交服务端回退 UA 解析。
 * best-effort：不支持 / 超时 / 异常都不抛错，绝不阻塞登录。返回值仅用于日志与会话展示。
 */
export async function getPreciseOs(timeoutMs = 500): Promise<string | undefined> {
  try {
    const nav = globalThis.navigator as (Navigator & {
      userAgentData?: { getHighEntropyValues: (hints: string[]) => Promise<{ platformVersion?: string }> };
    }) | undefined;
    const uaData = nav?.userAgentData;
    if (typeof uaData?.getHighEntropyValues !== 'function') return undefined;
    // UA 不是冻结的 Win10 就没必要问：服务端解析已足够准
    if (!/Windows NT 10\.0/.test(nav?.userAgent ?? '')) return undefined;
    const result = await Promise.race([
      uaData.getHighEntropyValues(['platformVersion']),
      new Promise<null>((resolve) => { setTimeout(() => resolve(null), timeoutMs); }),
    ]);
    const major = Number.parseInt((result?.platformVersion ?? '').replace(/"/g, '').split('.')[0] ?? '', 10);
    // Client Hints 平台版本 major ≥ 13 即 Win11（Chromium 约定）
    return Number.isFinite(major) && major >= 13 ? 'Windows 11' : undefined;
  } catch {
    return undefined;
  }
}

let warmed = false;
let cachedOs: string | undefined;

/**
 * 同步读缓存的精确 OS（供请求层逐请求携带）。
 * 首次调用时后台触发一次计算（不等待），就绪后后续请求自动带上；算不出时保持缺省，
 * 服务端回退 UA + CH 解析。各端（管理/会员/审批）共用同一份缓存。
 */
export function getCachedPreciseOs(): string | undefined {
  if (!warmed) {
    warmed = true;
    void getPreciseOs().then((os) => { cachedOs = os; });
  }
  return cachedOs;
}
