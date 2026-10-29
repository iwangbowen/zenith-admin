import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';

const state = vi.hoisted(() => ({ listRender: vi.fn() }));
vi.mock('@douyinfe/semi-ui', () => ({ Button: () => null, Tooltip: () => null }));
vi.mock('@/components/NavListPanel', () => ({ NavListPanel: (props: unknown) => { state.listRender(props); return null; }, NavListItem: () => null, NavListItemActions: () => null }));
vi.mock('@/utils/confirm', () => ({ confirmDelete: vi.fn() }));
import { ConversationSidebar } from './ConversationSidebar';

describe('conversation sidebar render isolation', () => {
  it('skips unrelated message updates and still responds to actual sidebar state', () => {
    const props: ComponentProps<typeof ConversationSidebar> = {
      rows: [], activeConvId: 1, onSelect: vi.fn(), showArchived: false, onToggleArchived: vi.fn(), onNewConversation: vi.fn(),
      searchKeyword: '', onSearchChange: vi.fn(), loading: false, hasNextPage: false, isFetchingNextPage: false, onLoadMore: vi.fn(),
      actions: { onRename: vi.fn(), onTogglePin: vi.fn(), onToggleArchive: vi.fn(), onEditTags: vi.fn(), onShare: vi.fn(), onExport: vi.fn(), onDelete: vi.fn() },
    };
    const { rerender } = render(<ConversationSidebar {...props} />);
    const before = state.listRender.mock.calls.length;
    for (let index = 0; index < 100; index++) rerender(<ConversationSidebar {...props} />);
    expect(state.listRender).toHaveBeenCalledTimes(before);
    rerender(<ConversationSidebar {...props} searchKeyword="真实搜索" />);
    expect(state.listRender).toHaveBeenCalledTimes(before + 1);
    expect(state.listRender.mock.lastCall?.[0]).toMatchObject({ search: { value: '真实搜索' } });
  });
});
