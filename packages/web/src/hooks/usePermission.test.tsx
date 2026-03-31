/**
 * usePermission hook 单元测试
 *
 * 覆盖要点：
 *  1. hasPermission(code)      — 存在 / 不存在 / 通配符 '*'
 *  2. hasAnyPermission(...codes) — 至少一个匹配 / 全不匹配 / 通配符
 *  3. permissions 列表通过 context 正确透传
 */
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { PermissionContext, usePermission } from './usePermission';

// ─── 工具：构造带权限上下文的 Wrapper ─────────────────────────────────────────
function makeWrapper(permissions: string[]) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <PermissionContext.Provider value={permissions}>
        {children}
      </PermissionContext.Provider>
    );
  };
}

// ─── hasPermission ────────────────────────────────────────────────────────────
describe('hasPermission', () => {
  it('权限码存在时返回 true', () => {
    const { result } = renderHook(() => usePermission(), {
      wrapper: makeWrapper(['user:read', 'user:write']),
    });
    expect(result.current.hasPermission('user:read')).toBe(true);
  });

  it('权限码不存在时返回 false', () => {
    const { result } = renderHook(() => usePermission(), {
      wrapper: makeWrapper(['user:read']),
    });
    expect(result.current.hasPermission('user:delete')).toBe(false);
  });

  it('空权限列表时返回 false', () => {
    const { result } = renderHook(() => usePermission(), {
      wrapper: makeWrapper([]),
    });
    expect(result.current.hasPermission('anything')).toBe(false);
  });

  it("权限列表包含 '*' 时任意码返回 true", () => {
    const { result } = renderHook(() => usePermission(), {
      wrapper: makeWrapper(['*']),
    });
    expect(result.current.hasPermission('any:arbitrary:code')).toBe(true);
    expect(result.current.hasPermission('')).toBe(true);
  });
});

// ─── hasAnyPermission ─────────────────────────────────────────────────────────
describe('hasAnyPermission', () => {
  it('至少一个权限码匹配时返回 true', () => {
    const { result } = renderHook(() => usePermission(), {
      wrapper: makeWrapper(['user:read', 'role:read']),
    });
    expect(result.current.hasAnyPermission('user:read', 'user:write')).toBe(true);
  });

  it('全部权限码均不匹配时返回 false', () => {
    const { result } = renderHook(() => usePermission(), {
      wrapper: makeWrapper(['user:read']),
    });
    expect(result.current.hasAnyPermission('user:write', 'user:delete')).toBe(false);
  });

  it("权限列表包含 '*' 时任意组合返回 true", () => {
    const { result } = renderHook(() => usePermission(), {
      wrapper: makeWrapper(['*']),
    });
    expect(result.current.hasAnyPermission('a', 'b', 'c')).toBe(true);
  });

  it('单个参数匹配时返回 true', () => {
    const { result } = renderHook(() => usePermission(), {
      wrapper: makeWrapper(['menu:view']),
    });
    expect(result.current.hasAnyPermission('menu:view')).toBe(true);
  });
});

// ─── permissions 透传 ─────────────────────────────────────────────────────────
describe('permissions 列表', () => {
  it('从 context 正确读取权限列表', () => {
    const perms = ['user:read', 'role:read', 'menu:view'];
    const { result } = renderHook(() => usePermission(), {
      wrapper: makeWrapper(perms),
    });
    expect(result.current.permissions).toEqual(perms);
  });

  it('默认 context（未提供 provider）时权限列表为空', () => {
    const { result } = renderHook(() => usePermission());
    expect(result.current.permissions).toEqual([]);
  });
});
