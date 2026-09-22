import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useOptionalPreferences } from '@/hooks/usePreferences';

function parseTab<T extends string>(
  params: URLSearchParams,
  paramName: string,
  validTabs: readonly T[],
  defaultTab: T,
): T {
  const raw = params.get(paramName);
  return raw && (validTabs as readonly string[]).includes(raw) ? (raw as T) : defaultTab;
}

/**
 * 将页面级 Tabs 的激活项与 URL 查询参数双向同步（如 `?tab=`）：
 * - 初次渲染从 URL 恢复，非法值回退默认 Tab；
 * - 切换 Tab 以 replace 写回 URL，默认 Tab 不写参数保持地址干净，且不污染浏览器历史；
 * - URL 外部变化（页签导航、前进/后退）时跟随切换；
 * - 只读写自己的参数，页面上其他查询参数原样保留。
 *
 * 受偏好「页面状态同步到地址栏」（`syncPageStateToUrl`，默认关）控制：
 * 关闭时降级为「消费即焚」——带参深链进入仍生效一次，随后参数从地址栏移除，
 * 切换 Tab 不再写 URL。无 PreferencesProvider 的入口（会员端等）保持始终同步。
 */
export function useUrlTabState<T extends string>(
  validTabs: readonly T[],
  defaultTab: T,
  paramName = 'tab',
): [T, (tab: T) => void] {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const prefs = useOptionalPreferences();
  const syncToUrl = prefs ? (prefs.preferences.syncPageStateToUrl ?? false) : true;
  const validRef = useRef(validTabs);
  validRef.current = validTabs;
  const [activeTab, setActiveTab] = useState<T>(
    () => parseTab(searchParams, paramName, validRef.current, defaultTab),
  );
  const search = searchParams.toString();
  const configKey = [paramName, defaultTab, ...validTabs].join('\0');
  const activeTabRef = useRef(activeTab);
  const searchRef = useRef(search);
  const syncRef = useRef<boolean | null>(null);
  const configRef = useRef(configKey);

  // 在同一个 effect 内判定变化来源，避免 URL→状态与状态→URL 两个 effect 用旧快照互相覆盖。
  useEffect(() => {
    const urlChanged = search !== searchRef.current;
    const stateChanged = activeTab !== activeTabRef.current;
    const syncChanged = syncToUrl !== syncRef.current;
    const configChanged = configKey !== configRef.current;
    if (!urlChanged && !stateChanged && !syncChanged && !configChanged) return;

    let nextTab = activeTab;
    if (urlChanged) {
      if (syncToUrl) {
        nextTab = parseTab(searchParams, paramName, validRef.current, defaultTab);
      } else {
        // 消费模式：仅参数在场且合法时跟随——参数应用后即被移除，缺参不代表回默认
        const raw = searchParams.get(paramName);
        if (raw && (validRef.current as readonly string[]).includes(raw)) nextTab = raw as T;
      }
    } else if (configChanged && !(validRef.current as readonly string[]).includes(nextTab)) {
      nextTab = defaultTab;
    }

    // 基于 router 提供的最新 searchParams 只改自己的参数（兼容 BrowserRouter 与
    // HashRouter——后者的 query 在 hash 段内，window.location.search 读不到）。
    const nextParams = new URLSearchParams(searchParams);
    if (!syncToUrl || nextTab === defaultTab) nextParams.delete(paramName);
    else nextParams.set(paramName, nextTab);
    const nextSearch = nextParams.toString();

    activeTabRef.current = nextTab;
    searchRef.current = nextSearch;
    syncRef.current = syncToUrl;
    configRef.current = configKey;

    if (nextTab !== activeTab) setActiveTab(nextTab);
    if (nextSearch !== search) navigate({ search: nextSearch, hash: location.hash }, { replace: true, state: location.state });
  }, [
    activeTab,
    location.hash,
    location.state,
    configKey,
    defaultTab,
    paramName,
    search,
    searchParams,
    navigate,
    syncToUrl,
  ]);

  return [activeTab, setActiveTab];
}
