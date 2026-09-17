import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PREFERENCES_KEY } from '@zenith/shared/core';
import { preferencePolicySchema } from '@zenith/shared/preferences';
import { writePreferenceCache } from '@/lib/preference-cache';
import { createPreferencesContext } from '@/test-utils/preferences';
import PageLoading, { LoadingIndicator } from './PageLoading';
import {
  PreferencesContext,
} from '@/hooks/usePreferences';

describe('PageLoading', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('uses the flip animation by default', () => {
    render(<PageLoading />);

    expect(screen.getByRole('status')).toHaveAttribute('data-loading-style', 'flip');
  });

  it('uses the cached preference before the preferences provider mounts', () => {
    writePreferenceCache(preferencePolicySchema.parse({}), { loadingStyle: 'ring' });

    render(<PageLoading />);

    expect(screen.getByRole('status')).toHaveAttribute('data-loading-style', 'ring');
  });

  it('uses the live provider preference for route loading', () => {
    render(
      <PreferencesContext.Provider
        value={createPreferencesContext({ loadingStyle: 'bars' })}
      >
        <PageLoading inline />
      </PreferencesContext.Provider>,
    );

    expect(screen.getByRole('status')).toHaveClass('page-loading--inline');
    expect(screen.getByRole('status')).toHaveAttribute('data-loading-style', 'bars');
  });

  it('falls back to flip when the cached preference is invalid', () => {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ loadingStyle: 'unknown' }));

    render(<PageLoading />);

    expect(screen.getByRole('status')).toHaveAttribute('data-loading-style', 'flip');
  });

  it('uses a cached forced system loading style before the provider mounts', () => {
    writePreferenceCache(preferencePolicySchema.parse({
      defaults: { loadingStyle: 'dots' },
      allowUserOverride: { loadingStyle: false },
    }), { loadingStyle: 'ring' });
    render(<PageLoading />);
    expect(screen.getByRole('status')).toHaveAttribute('data-loading-style', 'dots');
  });

  it.each([
    ['spinner', 'page-loading__spinner'],
    ['bounce', 'page-loading__bounce-dot'],
    ['ripple', 'page-loading__ripple'],
    ['progress', 'page-loading__track'],
  ] as const)('renders the %s indicator', (variant, contentClass) => {
    const { container } = render(<LoadingIndicator variant={variant} />);
    const indicator = container.firstElementChild;
    expect(indicator).toHaveAttribute('data-loading-style', variant);
    expect(indicator?.querySelector(`.${contentClass}`)).not.toBeNull();
  });
});
