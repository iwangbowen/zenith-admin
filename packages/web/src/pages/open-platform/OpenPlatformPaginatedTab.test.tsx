import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PreferencesContext, defaultPreferences } from '@/hooks/usePreferences';
import { OpenPlatformPaginatedTab } from './OpenPlatformPaginatedTab';

vi.mock('@/components/ConfigurableTable', () => ({
  default: (props: { dataSource?: Array<{ id: number; name: string }>; empty?: string; pagination?: { total: number } }) => (
    <div>
      <span>{props.dataSource?.[0]?.name ?? props.empty}</span>
      <span>total:{props.pagination?.total}</span>
    </div>
  ),
}));

describe('OpenPlatformPaginatedTab', () => {
  it('connects paginated query data to the shared table props', () => {
    const refetch = vi.fn();
    render(
      <PreferencesContext.Provider value={{ preferences: defaultPreferences, setPreferences: vi.fn(), resetPreferences: vi.fn(), ready: true }}>
        <OpenPlatformPaginatedTab
          useList={() => ({ data: { list: [{ id: 1, name: '授权记录' }], total: 7 }, isFetching: false, refetch }) as never}
          columns={[]}
          rowKey="id"
          empty="暂无记录"
        />
      </PreferencesContext.Provider>,
    );
    expect(screen.getByText('授权记录')).toBeInTheDocument();
    expect(screen.getByText('total:7')).toBeInTheDocument();
  });
});
