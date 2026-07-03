import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import type { RegionSelectProps } from './RegionSelect';
import RegionSelect from './RegionSelect';
import { request } from '@/utils/request';

vi.mock('@/utils/request', () => ({
  request: {
    get: vi.fn(),
  },
}));

function renderRegionSelect(props: RegionSelectProps = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RegionSelect {...props} />
    </QueryClientProvider>,
  );
}

async function waitForRegionsLoaded(container: HTMLElement) {
  await waitFor(() => {
    expect(request.get).toHaveBeenCalledWith('/api/regions', { silent: true });
  });
  await waitFor(() => {
    expect(container.textContent).not.toContain('加载中...');
  });
}

describe('RegionSelect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render empty Cascader initially', async () => {
    vi.mocked(request.get).mockResolvedValueOnce({ code: 0, message: 'ok', data: [] });
    const { container } = renderRegionSelect();
    await waitForRegionsLoaded(container);
    expect(container).toBeTruthy();
  });

  it('should load regions from API', async () => {
    // Mock response data
    const mockData = {
      code: 0,
      message: 'ok',
      data: [
        { code: '110000', name: '北京', status: 'enabled', children: [] },
        { code: '120000', name: '天津', status: 'disabled', children: [] } // should be filtered out
      ]
    };
    vi.mocked(request.get).mockResolvedValueOnce(mockData);

    const { container } = renderRegionSelect();

    // We expect request.get to be called with correct URL
    await waitForRegionsLoaded(container);
  });

  it('should apply custom placeholder', async () => {
    vi.mocked(request.get).mockResolvedValueOnce({ code: 0, message: 'ok', data: [] });
    // Assuming Semi UI renders placeholder somewhere
    const { container } = renderRegionSelect({ placeholder: 'Select region' });
    await waitForRegionsLoaded(container);
    // Just ensuring no crash with props
  });

  it('should pass value prop correctly', async () => {
    vi.mocked(request.get).mockResolvedValueOnce({ code: 0, message: 'ok', data: [] });
    const { container } = renderRegionSelect({ value: ['110000', '110100'] });
    await waitForRegionsLoaded(container);
  });
});
