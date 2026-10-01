import { useRef, type MouseEvent } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { Modal } from '@douyinfe/semi-ui';
import type { ModalReactProps } from '@douyinfe/semi-ui/lib/es/modal';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerLaunchLeaveGuard, useLaunchLeaveGuard } from './useLaunchLeaveGuard';

function Harness({ dirty }: { dirty: boolean }) {
  const hasChanges = useRef(dirty);
  const guard = useLaunchLeaveGuard(() => hasChanges.current);
  const navigate = useNavigate();
  const location = useLocation();
  return <>
    <output data-testid="location">{location.pathname}</output>
    <button onClick={() => navigate('/other')}>离开</button>
    <button onClick={() => guard.allowNavigation(() => navigate('/transferred'))}>转交快照</button>
  </>;
}

afterEach(() => vi.restoreAllMocks());

describe('launch form leave protection', () => {
  it('keeps unsubmitted input until the user explicitly discards and permits snapshot handoff', () => {
    let confirmation: ModalReactProps | undefined;
    const confirm = vi.spyOn(Modal, 'confirm').mockImplementation((options) => {
      confirmation = options;
      return { destroy: vi.fn(), update: vi.fn() };
    });
    render(<MemoryRouter initialEntries={['/launch']}><Harness dirty /></MemoryRouter>);
    fireEvent.click(screen.getByText('离开'));
    expect(screen.getByTestId('location').textContent).toBe('/launch');
    expect(confirm).toHaveBeenCalledOnce();
    confirmation?.onCancel?.({} as MouseEvent);
    fireEvent.click(screen.getByText('转交快照'));
    expect(screen.getByTestId('location').textContent).toBe('/transferred');
    expect(confirm).toHaveBeenCalledOnce();
  });

  it('warns on page reload for edited input and leaves untouched forms without confirmation', () => {
    const confirm = vi.spyOn(Modal, 'confirm');
    const view = render(<MemoryRouter initialEntries={['/launch']}><Harness dirty /></MemoryRouter>);
    const reload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(reload);
    expect(reload.defaultPrevented).toBe(true);
    view.unmount();
    render(<MemoryRouter initialEntries={['/launch']}><Harness dirty={false} /></MemoryRouter>);
    fireEvent.click(screen.getByText('离开'));
    expect(screen.getByTestId('location').textContent).toBe('/other');
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe('shared launch navigation registration', () => {
  function navigatorStub() {
    return { push: vi.fn(), replace: vi.fn(), go: vi.fn(), createHref: vi.fn() } as unknown as Parameters<typeof registerLaunchLeaveGuard>[0];
  }

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
    const reload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(reload);
    expect(reload.defaultPrevented).toBe(false);
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
    const reload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(reload);
    expect(reload.defaultPrevented).toBe(false);
    removeOld();
    expect(navigator.push).toBe(originalPush);
  });
});
