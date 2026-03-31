import React from 'react';
import { render, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom';
import NProgress from './NProgress';

const TestComponent = () => {
  const navigate = useNavigate();
  return (
    <div>
      <button onClick={() => navigate('/route1')}>Go 1</button>
      <button onClick={() => navigate('/route2')}>Go 2</button>
    </div>
  );
};

const setup = () => render(
  <MemoryRouter initialEntries={['/']}>
    <NProgress />
    <Routes>
      <Route path="*" element={<TestComponent />} />
    </Routes>
  </MemoryRouter>
);

describe('NProgress', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing initially when route is not changing', () => {
    const { container } = setup();
    expect(container.querySelector('.nprogress-bar')).not.toBeInTheDocument();
  });

  it('shows progress bar on route change', async () => {
    const { getByText, container } = setup();
    
    act(() => {
      getByText('Go 1').click();
    });

    expect(container.querySelector('.nprogress-bar')).toBeInTheDocument();
  });

  it('animates back to 0 width and hidden after timeout', async () => {
    const { getByText, container } = setup();
    
    act(() => {
      getByText('Go 1').click();
    });
    
    expect(container.querySelector('.nprogress-bar')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(200);
    });

    act(() => {
      vi.advanceTimersByTime(500); // Trigger hide timer
    });

    // One more tick to hide it
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(container.querySelector('.nprogress-bar')).not.toBeInTheDocument();
  });

  it('clears timers on unmount', () => {
    const { getByText, unmount } = setup();

    act(() => {
      getByText('Go 1').click();
    });

    unmount();
    
    // Attempting to advance timers should not error after unmount
    expect(() => {
      act(() => {
        vi.advanceTimersByTime(1000);
      });
    }).not.toThrow();
  });

  it('handles multiple rapid navigation gracefully', () => {
    const { getByText, container } = setup();

    act(() => {
      getByText('Go 1').click();
    });
    
    act(() => {
      vi.advanceTimersByTime(50);
    });
    
    act(() => {
      getByText('Go 2').click();
    });

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(container.querySelector('.nprogress-bar')).not.toBeInTheDocument();
  });
});
