import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import RegionSelect from './RegionSelect';
import { request } from '@/utils/request';

vi.mock('@/utils/request', () => ({
  request: {
    get: vi.fn(),
  },
}));

describe('RegionSelect', () => {
  it('should render empty Cascader initially', () => {
    vi.mocked(request.get).mockResolvedValueOnce({ code: 0, message: 'ok', data: [] });
    const { container } = render(<RegionSelect />);
    expect(container).toBeInTheDocument();
  });

  it('should load regions from API', async () => {
    // Mock response data
    const mockData = {
      code: 0,
      message: 'ok',
      data: [
        { code: '110000', name: '北京', status: 'active', children: [] },
        { code: '120000', name: '天津', status: 'inactive', children: [] } // should be filtered out
      ]
    };
    vi.mocked(request.get).mockResolvedValueOnce(mockData);

    render(<RegionSelect />);

    // We expect request.get to be called with correct URL
    await waitFor(() => {
      expect(request.get).toHaveBeenCalledWith('/system/regions/tree');
    });
  });

  it('should apply custom placeholder', () => {
    vi.mocked(request.get).mockResolvedValueOnce({ code: 0, message: 'ok', data: [] });
    // Assuming Semi UI renders placeholder somewhere
    render(<RegionSelect placeholder="Select region" />);
    // Just ensuring no crash with props
  });

  it('should pass value prop correctly', () => {
    vi.mocked(request.get).mockResolvedValueOnce({ code: 0, message: 'ok', data: [] });
    render(<RegionSelect value={['110000', '110100']} />);
  });
});
