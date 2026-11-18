import { createPreferencesContext } from '@/test-utils/preferences';
/**
 * 保留筛选参数语义、操作权限及删除载荷边界，不限定列宽、动作顺序或展示文案。
 */
import { renderHook } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import * as z from 'zod';
import { dateRangeQuery, defineContract, entityStatusQuery, idParam, idQuery, keywordQuery, op, paginated, paginationQuery, queryBool, queryEnum } from '@zenith/shared/core';
import { PermissionContext } from '@/hooks/usePermission';
import { PreferencesContext } from '@/hooks/usePreferences';
import { useListPage } from '@/hooks/useListPage';
import { createTestQueryClient } from '@/test-utils/query-harness';
import { deriveFilterControls } from './ContractFilters';

vi.mock('@/hooks/useDictItems', () => ({
  useDictItems: (code: string) => ({
    items: [], loading: false, getLabel: (v: string) => v, getColor: () => undefined,
    options: code === 'common_status' ? [{ value: 'enabled', label: '启用' }, { value: 'disabled', label: '禁用' }] : [{ value: 'a', label: '甲' }],
  }),
}));

const rowSchema = z.object({ id: z.int(), name: z.string() });
const rowContract = defineContract('/api/test-filter-rows', {
  list: op.get('/', { access: 'authenticated',
    query: paginationQuery.extend({
      keyword: keywordQuery('名称 / 编码'),
      status: entityStatusQuery,
      level: queryEnum(['low', 'high'], { description: '等级；空 = 全部', options: [{ value: 'low', label: '低' }, { value: 'high', label: '高' }] }),
      kind: queryEnum(['x', 'y'], { description: '类型', dict: 'demo_kind' }),
      pinned: queryBool('是否置顶'),
      enabled: queryBool('启用状态', { labels: ['已启用', '已停用'] }),
      channelId: idQuery('栏目 ID'),
      ...dateRangeQuery('创建时间'),
      plain: z.string().optional(),
    }),
    response: paginated(rowSchema),
    summary: 'list',
  }),
  detail: op.get('/{id}', { access: 'authenticated', params: idParam, response: rowSchema, summary: 'detail' }),
});

const useListMock = vi.fn(() => ({ data: { list: [] as Array<{ id: number; name: string }>, total: 0 }, isFetching: false, refetch: vi.fn() }));

function wrapper(permissions: string[] = []) {
  const client = createTestQueryClient();
  const preferences = createPreferencesContext();
  return function Wrapper({ children }: { readonly children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <PreferencesContext.Provider value={preferences}>
          <PermissionContext.Provider value={permissions}>{children}</PermissionContext.Provider>
        </PreferencesContext.Provider>
      </QueryClientProvider>
    );
  };
}

describe('deriveFilterControls / ListSearchToolbar 契约写法', () => {
  it('未声明 x-filter 语义的键与单独出现的范围端点直接报错，而不是渲染空控件', () => {
    const page = renderHook(() => useListPage({ contract: rowContract, useList: useListMock }), { wrapper: wrapper() }).result.current;
    expect(() => deriveFilterControls({ page, specs: ['plain'] })).toThrow(/plain/);
    expect(() => deriveFilterControls({ page, specs: ['startTime'] })).toThrow(/成对/);
  });
});
