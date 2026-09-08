import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PREFERENCES_KEY } from '@zenith/shared/core';
import PageLoading from './PageLoading';
import {
  defaultPreferences,
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
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ loadingStyle: 'ring' }));

    render(<PageLoading />);

    expect(screen.getByRole('status')).toHaveAttribute('data-loading-style', 'ring');
  });

  it('uses the live provider preference for route loading', () => {
    render(
      <PreferencesContext.Provider
        value={{
          preferences: { ...defaultPreferences, loadingStyle: 'bars' },
          setPreferences: () => undefined,
          resetPreferences: () => undefined,
          ready: true,
        }}
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
});
