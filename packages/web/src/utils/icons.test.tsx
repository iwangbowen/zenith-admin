import { describe, it, expect } from 'vitest';
import { ICON_REGISTRY, ALL_ICON_NAMES, renderLucideIcon } from './icons';
import { render } from '@testing-library/react';

describe('icons utility', () => {
  it('should export an ICON_REGISTRY object', () => {
    expect(ICON_REGISTRY).toBeDefined();
    expect(typeof ICON_REGISTRY).toBe('object');
  });

  it('should have a list of all icon names', () => {
    expect(Array.isArray(ALL_ICON_NAMES)).toBe(true);
    expect(ALL_ICON_NAMES.length).toBeGreaterThan(0);
  });

  it('ALL_ICON_NAMES should be sorted alphabetically', () => {
    const sorted = [...ALL_ICON_NAMES].sort((a, b) => a.localeCompare(b));
    expect(ALL_ICON_NAMES).toEqual(sorted);
  });

  it('should filter out createLucideIcon from registry', () => {
    expect(ICON_REGISTRY['createLucideIcon']).toBeUndefined();
    expect(ALL_ICON_NAMES).not.toContain('createLucideIcon');
  });

  it('should not contain keys ending with Icon', () => {
    const hasIconSuffix = ALL_ICON_NAMES.some(name => name.endsWith('Icon'));
    expect(hasIconSuffix).toBe(false);
  });

  it('renderLucideIcon should return null for unknown icon', () => {
    const el = renderLucideIcon('NonExistentIconXYZ' + Date.now());
    expect(el).toBeNull();
  });

  it('renderLucideIcon should return a valid React element for known icon', () => {
    const el = renderLucideIcon('Activity');
    expect(el).not.toBeNull();
    if (el) {
      const { container } = render(el);
      expect(container.querySelector('svg')).toBeInTheDocument();
    }
  });

  it('renderLucideIcon should pass custom size correctly', () => {
    const el = renderLucideIcon('Activity', 24);
    if (el) {
      const { container } = render(el);
      const svg = container.querySelector('svg');
      expect(svg).toHaveAttribute('width', '24');
    }
  });

  it('renderLucideIcon uses default size 16', () => {
    const el = renderLucideIcon('Activity');
    if (el) {
      const { container } = render(el);
      const svg = container.querySelector('svg');
      expect(svg).toHaveAttribute('width', '16');
    }
  });
});
