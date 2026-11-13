import { describe, it, expect, beforeAll } from 'vitest';
import { ensureLucideIcons, renderLucideIcon } from './icons';
import { renderHook } from '@testing-library/react';
import { useAllIconNames, useLucideIconsReady } from './icons';

describe('icons utility (async registry)', () => {
  beforeAll(async () => {
    await ensureLucideIcons();
  });

  it('useLucideIconsReady should be true after ensure', () => {
    const { result } = renderHook(() => useLucideIconsReady());
    expect(result.current).toBe(true);
  });

  it('loads registered icon names', () => {
    const { result } = renderHook(() => useAllIconNames());
    expect(Array.isArray(result.current)).toBe(true);
    expect(result.current.length).toBeGreaterThan(0);
  });

  it('should filter out createLucideIcon and *Icon aliases', () => {
    const { result } = renderHook(() => useAllIconNames());
    expect(result.current).not.toContain('createLucideIcon');
    expect(result.current.some((name) => name.endsWith('Icon'))).toBe(false);
  });

  it('renderLucideIcon should return null for unknown icon', () => {
    const el = renderLucideIcon('NonExistentIconXYZ' + Date.now());
    expect(el).toBeNull();
  });
});
