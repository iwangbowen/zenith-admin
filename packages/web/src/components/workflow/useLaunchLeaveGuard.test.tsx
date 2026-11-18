import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerLaunchLeaveGuard } from './useLaunchLeaveGuard';
afterEach(() => vi.restoreAllMocks());

describe('shared launch navigation registration', () => {
  function navigatorStub() {
    return { push: vi.fn(), replace: vi.fn(), go: vi.fn(), createHref: vi.fn() } as unknown as Parameters<typeof registerLaunchLeaveGuard>[0];
  }

  it('keeps same-page navigation unchanged unless the registration explicitly protects it', () => {
    const navigator = navigatorStub();
    const originalPush = navigator.push;
    const confirm = vi.fn();
    const registration = {
      pathname: '/settings', activePathname: () => '/settings', confirmLeave: confirm, shouldWarnBeforeUnload: () => true,
    };
    const removeDefault = registerLaunchLeaveGuard(navigator, registration);
    navigator.push('/settings?module=wiki');
    expect(originalPush).toHaveBeenCalledOnce();
    expect(confirm).not.toHaveBeenCalled();
    removeDefault();

    const removeSettings = registerLaunchLeaveGuard(navigator, { ...registration, protectSamePage: () => true });
    navigator.push('/settings?module=drive');
    expect(confirm).toHaveBeenCalledOnce();
    expect(originalPush).toHaveBeenCalledOnce();
    removeSettings();
    expect(navigator.push).toBe(originalPush);
  });

  it('installs once and restores original methods after the older registration cleans up first', () => {
    const navigator = navigatorStub();
    const originals = { push: navigator.push, replace: navigator.replace, go: navigator.go };
    let activePath = '/launchpad';
    const oldConfirm = vi.fn((run: () => void) => run());
    const newConfirm = vi.fn((run: () => void) => run());
    const removeOld = registerLaunchLeaveGuard(navigator, {
      pathname: '/launchpad', activePathname: () => activePath, confirmLeave: oldConfirm, shouldWarnBeforeUnload: () => true,
    });
    const sharedPush = navigator.push;
    activePath = '/launch/42';
    const removeNew = registerLaunchLeaveGuard(navigator, {
      pathname: '/launch/42', activePathname: () => activePath, confirmLeave: newConfirm, shouldWarnBeforeUnload: () => true,
    });
    expect(navigator.push).toBe(sharedPush);
    removeOld();
    navigator.push('/target');
    expect(newConfirm).toHaveBeenCalledOnce();
    expect(oldConfirm).not.toHaveBeenCalled();
    expect(originals.push).toHaveBeenCalledOnce();
    removeNew();
    expect(navigator.push).toBe(originals.push);
    expect(navigator.replace).toBe(originals.replace);
    expect(navigator.go).toBe(originals.go);
  });

  it('ignores an older hidden page when the newest registration is removed before it', () => {
    const navigator = navigatorStub();
    const originalPush = navigator.push;
    let activePath = '/launch/first';
    const oldConfirm = vi.fn();
    const removeOld = registerLaunchLeaveGuard(navigator, {
      pathname: '/launch/first', activePathname: () => activePath, confirmLeave: oldConfirm, shouldWarnBeforeUnload: () => true,
    });
    activePath = '/launch/second';
    const removeNew = registerLaunchLeaveGuard(navigator, {
      pathname: '/launch/second', activePathname: () => activePath, confirmLeave: vi.fn(), shouldWarnBeforeUnload: () => true,
    });
    removeNew();
    navigator.push('/finished');
    expect(oldConfirm).not.toHaveBeenCalled();
    expect(originalPush).toHaveBeenCalledOnce();
    removeOld();
    expect(navigator.push).toBe(originalPush);
  });
});
