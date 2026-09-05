/**
 * 埋点 SDK 的延后加载边界。
 *
 * `@/utils/tracker`（analytics-sdk + web-vitals + 回放钩子）不参与首帧渲染，
 * 不应静态挂在入口的关键路径上：这里把它放到空闲时段再加载并初始化；
 * 身份合并 / 退出前刷写等调用在模块就绪后执行，未就绪时无事件可刷写、直接跳过。
 */
type TrackerModule = typeof import('@/utils/tracker');

let loaded: TrackerModule | null = null;
let loading: Promise<TrackerModule> | null = null;

export function loadTracker(): Promise<TrackerModule> {
  loading ??= import('@/utils/tracker').then((mod) => {
    loaded = mod;
    return mod;
  });
  return loading;
}

/** 空闲时初始化埋点（自动采集 / Web Vitals / API 监控），最迟 3s 内开始 */
export function scheduleTrackerInit(): void {
  const start = () => void loadTracker().then((t) => t.initTracker()).catch(() => {});
  if (typeof requestIdleCallback === 'function') requestIdleCallback(start, { timeout: 3000 });
  else setTimeout(start, 1500);
}

export function trackerIdentify(userId: number | string, username?: string): void {
  void loadTracker().then((t) => t.identify(userId, username)).catch(() => {});
}

export function trackerResetIdentity(): void {
  // 尚未加载 = 尚无匿名身份需要重置
  loaded?.resetIdentity();
}

/** 退出前同步刷写：只有已加载的 SDK 才有待发送事件 */
export function trackerPrepareLogout(): void {
  loaded?.prepareTrackerLogout();
}
