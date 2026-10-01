import { useContext, useEffect, useRef, type ContextType } from 'react';
import { UNSAFE_NavigationContext, useLocation, type To } from 'react-router-dom';
import { Modal } from '@douyinfe/semi-ui';

type Navigator = ContextType<typeof UNSAFE_NavigationContext>['navigator'];
interface GuardRegistration {
  pathname: string;
  activePathname: () => string;
  confirmLeave: (action: () => void) => void;
  shouldWarnBeforeUnload: () => boolean;
}
interface GuardRegistry {
  registrations: Map<symbol, GuardRegistration>;
  release: () => void;
}
const registries = new WeakMap<Navigator, GuardRegistry>();

/** 一个 navigator 只安装一组代理；任意注册/清理顺序都不会留下旧表单的闭包。 */
export function registerLaunchLeaveGuard(navigator: Navigator, registration: GuardRegistration): () => void {
  let registry = registries.get(navigator);
  if (!registry) {
    const registrations = new Map<symbol, GuardRegistration>();
    const originalPush = navigator.push;
    const originalReplace = navigator.replace;
    const originalGo = navigator.go;
    // 只保护当前路径。过渡阶段暂时共存的隐藏页和抽屉不得拦截新页面。
    const active = () => [...registrations.values()].reverse().find((entry) => entry.activePathname() === entry.pathname);
    const samePage = (entry: GuardRegistration, to: To) => {
      const base = new URL(entry.pathname, window.location.href);
      const target = typeof to === 'string' ? new URL(to, base).pathname : to.pathname ?? entry.pathname;
      return target === entry.pathname;
    };
    const push: typeof originalPush = (...args) => {
      const entry = active();
      const run = () => originalPush.apply(navigator, args);
      if (!entry || samePage(entry, args[0])) run();
      else entry.confirmLeave(run);
    };
    const replace: typeof originalReplace = (...args) => {
      const entry = active();
      const run = () => originalReplace.apply(navigator, args);
      if (!entry || samePage(entry, args[0])) run();
      else entry.confirmLeave(run);
    };
    const go: typeof originalGo = (...args) => {
      const entry = active();
      const run = () => originalGo.apply(navigator, args);
      if (entry) entry.confirmLeave(run);
      else run();
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!active()?.shouldWarnBeforeUnload()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    navigator.push = push;
    navigator.replace = replace;
    navigator.go = go;
    window.addEventListener('beforeunload', beforeUnload);
    registry = {
      registrations,
      release: () => {
        if (navigator.push === push) navigator.push = originalPush;
        if (navigator.replace === replace) navigator.replace = originalReplace;
        if (navigator.go === go) navigator.go = originalGo;
        window.removeEventListener('beforeunload', beforeUnload);
      },
    };
    registries.set(navigator, registry);
  }
  const key = Symbol('workflow-launch');
  const currentRegistry = registry;
  currentRegistry.registrations.set(key, registration);
  return () => {
    currentRegistry.registrations.delete(key);
    if (currentRegistry.registrations.size > 0) return;
    currentRegistry.release();
    if (registries.get(navigator) === currentRegistry) registries.delete(navigator);
  };
}

/** 仅在发起页面启用保护；BrowserRouter 没有 data-router blocker。 */
export function useLaunchLeaveGuard(hasUnsavedChanges: () => boolean, enabled = true) {
  const { navigator } = useContext(UNSAFE_NavigationContext);
  const location = useLocation();
  const currentPath = useRef(location.pathname);
  currentPath.current = location.pathname;
  const check = useRef(hasUnsavedChanges);
  check.current = hasUnsavedChanges;
  const allowed = useRef(false);
  const confirming = useRef(false);
  const confirmLeave = (action: () => void) => {
    if (!enabled || allowed.current || !check.current()) { action(); return; }
    if (confirming.current) return;
    confirming.current = true;
    Modal.confirm({
      title: '放弃未保存的申请？',
      content: '申请尚未提交或保存为草稿，离开后当前填写内容将丢失。',
      okText: '放弃并离开',
      cancelText: '继续填写',
      onCancel: () => { confirming.current = false; },
      onOk: () => { confirming.current = false; action(); },
    });
  };
  const confirmRef = useRef(confirmLeave);
  confirmRef.current = confirmLeave;
  useEffect(() => {
    if (!enabled) return;
    return registerLaunchLeaveGuard(navigator, {
      pathname: location.pathname,
      activePathname: () => currentPath.current,
      confirmLeave: (action) => confirmRef.current(action),
      shouldWarnBeforeUnload: () => !allowed.current && check.current(),
    });
  }, [enabled, location.pathname, navigator]);
  return {
    confirmLeave,
    /** 已提交、已保存或快照已转交时，导航无需提示丢失。 */
    allowNavigation: (action: () => void) => {
      allowed.current = true;
      try { action(); } finally { allowed.current = false; }
    },
  };
}
