/**
 * navigateWithDirection 单元测试：后退方向附加 Transition 类型，前进方向不附加；两种情况都必须真正触发导航。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const addTransitionType = vi.fn();
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, addTransitionType };
});

const { navigateWithDirection, ROUTE_BACK_TRANSITION_TYPE } = await import('./route-transition-types');

describe('navigateWithDirection', () => {
  beforeEach(() => addTransitionType.mockClear());

  it('后退方向：先附加 route-back 类型再导航', () => {
    const navigate = vi.fn();
    navigateWithDirection(navigate, '/system/users', true);
    expect(addTransitionType).toHaveBeenCalledWith(ROUTE_BACK_TRANSITION_TYPE);
    expect(navigate).toHaveBeenCalledWith('/system/users');
    expect(addTransitionType.mock.invocationCallOrder[0]).toBeLessThan(navigate.mock.invocationCallOrder[0]);
  });

  it('前进方向：只导航，不附加类型', () => {
    const navigate = vi.fn();
    navigateWithDirection(navigate, '/system/roles', false);
    expect(addTransitionType).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/system/roles');
  });
});
