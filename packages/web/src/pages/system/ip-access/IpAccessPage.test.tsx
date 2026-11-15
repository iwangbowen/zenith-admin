import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
vi.mock('./IpAccessConfig', () => ({ default: () => null }));
vi.mock('@/hooks/useIsPlatformAdmin', () => ({ useIsPlatformAdmin: () => false }));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ hasPermission: () => true }) }));
vi.mock('@/components/ConfigurableTable', () => ({ ConfigurableTable: () => null }));
vi.mock('@/hooks/queries/ip-access', () => ({ useIpAccessLogs: vi.fn(), useIpAccessLogHealth: () => ({}) }));
vi.mock('@/hooks/useListPage', async () => {
  const { ipAccessLogContract } = await import('@zenith/shared/platform');
  return { useListPage: () => ({
    filterSchema: ipAccessLogContract.list.query,
    bind: () => ({ value: undefined, onChange: vi.fn() }),
    bindKeyword: () => ({ value: undefined, onChange: vi.fn(), onSearch: vi.fn() }),
    bindRange: () => ({ value: null, onChange: vi.fn() }),
    toolbarProps: { onSearch: vi.fn(), onReset: vi.fn() }, tableProps: {},
  }) };
});
import IpAccessPage from './IpAccessPage';
describe('IP log filters', () => {
  it('renders the actual contract date range without triggering the page error boundary', () => {
    render(<MemoryRouter initialEntries={['/?tab=logs']}><IpAccessPage /></MemoryRouter>);
    expect(screen.getAllByPlaceholderText('开始时间').length).toBeGreaterThan(0);
    expect(screen.getAllByPlaceholderText('结束时间').length).toBeGreaterThan(0);
    expect(screen.getByRole('tab', { name: '拦截日志' })).toBeVisible();
  });
});
