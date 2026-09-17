import { createPreferencesContext } from '@/test-utils/preferences';
import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreferencesContext } from '@/hooks/usePreferences';
import DateTimeText from './DateTimeText';

function withPrefs(timeDisplay: 'absolute' | 'relative') {
  const value = createPreferencesContext({ timeDisplay });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
  };
}

const NOW = new Date(2026, 8, 14, 10, 0, 0);
const THREE_MIN_AGO = new Date(NOW.getTime() - 3 * 60_000);

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('DateTimeText', () => {
  it('renders the absolute timestamp without a provider and with the default preference', () => {
    render(<DateTimeText value={THREE_MIN_AGO} />);
    expect(screen.getByText('2026-09-14 09:57:00')).toBeTruthy();
    const { container } = render(<DateTimeText value="2026-09-14 09:57:00" />, { wrapper: withPrefs('absolute') });
    expect(container.textContent).toBe('2026-09-14 09:57:00');
  });

  it('renders the placeholder for empty values and honours a custom one', () => {
    const { container } = render(<><DateTimeText value={null} /><DateTimeText value="" empty="永久" /></>);
    expect(container.textContent).toBe('—永久');
  });

  it('renders relative text when preferred and keeps the absolute time in the tooltip trigger', () => {
    render(<DateTimeText value={THREE_MIN_AGO} />, { wrapper: withPrefs('relative') });
    expect(screen.getByText('3 分钟前')).toBeTruthy();
  });

  it('lets callers pin the mode regardless of the preference', () => {
    render(<DateTimeText value={THREE_MIN_AGO} mode="absolute" />, { wrapper: withPrefs('relative') });
    expect(screen.getByText('2026-09-14 09:57:00')).toBeTruthy();
    render(<DateTimeText value={THREE_MIN_AGO} mode="relative" />, { wrapper: withPrefs('absolute') });
    expect(screen.getByText('3 分钟前')).toBeTruthy();
  });

  it('refreshes relative text as time passes', () => {
    render(<DateTimeText value={THREE_MIN_AGO} />, { wrapper: withPrefs('relative') });
    expect(screen.getByText('3 分钟前')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(2 * 60_000); });
    expect(screen.getByText('5 分钟前')).toBeTruthy();
  });
});
