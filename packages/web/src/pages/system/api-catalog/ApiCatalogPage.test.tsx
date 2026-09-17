import { createPreferencesContext } from '@/test-utils/preferences';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import { apiCatalogContract, permissionMatrixContract, type ApiCatalog, type ApiCatalogItem } from '@zenith/shared/identity';
import { PreferencesContext } from '@/hooks/usePreferences';
import { ApiRecorder, createRequestMock, createTestQueryClient } from '@/test-utils/query-harness';
import { desktopToolbar } from '@/test-utils/toolbar';
import { EMPTY_FILTERS, matchesCatalogFilters, summarizeCatalog, toCatalogRows } from './catalog-model';

const recorder = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => recorder) }));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ hasPermission: () => true }) }));

import { apiCatalogKeys } from '@/hooks/queries/permission-matrix';
import ApiCatalogPage from './ApiCatalogPage';

const prefs = createPreferencesContext();

function item(partial: Partial<ApiCatalogItem> & Pick<ApiCatalogItem, 'method' | 'fullPath' | 'summary'>): ApiCatalogItem {
  return {
    domain: 'identity',
    domainLabel: '身份与组织',
    basePath: '/api/users',
    name: partial.method,
    description: null,
    tags: [],
    deprecated: false,
    security: 'bearer',
    accessKind: 'authenticated',
    permissions: [],
    platformOnly: false,
    audit: null,
    feature: null,
    ...partial,
  };
}

const catalog: ApiCatalog = {
  items: [
    item({ method: 'post', fullPath: '/api/auth/login', summary: '登录', basePath: '/api/auth', security: 'none', accessKind: null }),
    item({ method: 'get', fullPath: '/api/auth/me', summary: '当前用户', basePath: '/api/auth' }),
    item({ method: 'get', fullPath: '/api/users', summary: '用户列表', accessKind: 'permission', permissions: ['system:user:list'], audit: '查询用户' }),
    item({ method: 'delete', fullPath: '/api/users/{id}', summary: '删除用户', accessKind: 'permission', permissions: ['system:user:delete'] }),
    item({ method: 'get', fullPath: '/api/tenants', summary: '租户列表', domain: 'platform', domainLabel: '平台', basePath: '/api/tenants', accessKind: 'platform', platformOnly: true }),
    item({ method: 'get', fullPath: '/api/member/profile', summary: '会员资料', domain: 'member', domainLabel: '会员', basePath: '/api/member', security: 'member-bearer', accessKind: null }),
  ],
  permissionLabels: { 'system:user:list': '查看用户', 'system:user:delete': '删除用户' },
};

function renderPage() {
  const qc = createTestQueryClient();
  const view = render(
    <QueryClientProvider client={qc}>
      <PreferencesContext.Provider value={prefs}>
        <MemoryRouter initialEntries={['/system/api-catalog']}><ApiCatalogPage /></MemoryRouter>
      </PreferencesContext.Provider>
    </QueryClientProvider>,
  );
  return { ...view, client: qc };
}

beforeEach(() => {
  recorder.reset();
  recorder.on('GET', apiCatalogContract.get.fullPath, catalog);
  recorder.on('GET', permissionMatrixContract.roles.fullPath, [
    { id: 1, name: '超级管理员', code: 'super_admin', status: 'enabled', tenantId: null, superAdmin: true, permissions: [] },
    { id: 2, name: '只读', code: 'viewer', status: 'enabled', tenantId: null, superAdmin: false, permissions: ['system:user:list'] },
  ]);
});

describe('catalog model', () => {
  it('gives every item a stable row key and partitions the stats exhaustively', () => {
    const rows = toCatalogRows(catalog);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
    const stats = summarizeCatalog(rows);
    expect(stats).toEqual({ total: 6, permission: 2, authenticated: 1, platform: 1, public: 1, otherCredential: 1 });
  });

  it('filters by module / method / permission code / keyword on path', () => {
    const rows = toCatalogRows(catalog);
    const users = rows.filter((r) => matchesCatalogFilters(r, { ...EMPTY_FILTERS, domain: 'identity', method: 'delete', permission: 'system:user:delete' }));
    expect(users.map((r) => r.fullPath)).toEqual(['/api/users/{id}']);
    const byPath = rows.filter((r) => matchesCatalogFilters(r, { ...EMPTY_FILTERS, keyword: '/api/auth/login' }));
    expect(byPath.map((r) => r.fullPath)).toEqual(['/api/auth/login']);
    const other = rows.filter((r) => matchesCatalogFilters(r, { ...EMPTY_FILTERS, otherCredential: true }));
    expect(other.map((r) => r.fullPath)).toEqual(['/api/member/profile']);
  });
});

describe('ApiCatalogPage', () => {
  it('loads the catalog from the server, narrows by stat card, and filters only after 查询 is clicked', async () => {
    const { container } = renderPage();
    expect(await screen.findByText('共 6 个接口，由契约声明派生')).toBeTruthy();
    expect(recorder.countOf('GET', apiCatalogContract.get.fullPath)).toBe(1);

    // 统计卡即筛选：立即提交
    fireEvent.click(screen.getByRole('button', { name: /公开接口/ }));
    expect(screen.getByText('匹配 1 / 6 个接口')).toBeTruthy();
    expect(screen.getByRole('button', { name: /公开接口/ }).getAttribute('aria-pressed')).toBe('true');
    // 再点一次取消
    fireEvent.click(screen.getByRole('button', { name: /公开接口/ }));
    expect(screen.getByText('共 6 个接口，由契约声明派生')).toBeTruthy();
    expect(recorder.countOf('GET', apiCatalogContract.get.fullPath)).toBe(1);

    // 关键字只进草稿：未点「查询」前结果不变
    const toolbar = desktopToolbar(container);
    fireEvent.change(toolbar.getByPlaceholderText('搜索名称 / 路径 / 权限码（支持拼音）'), { target: { value: '/api/auth/login' } });
    expect(screen.getByText('共 6 个接口，由契约声明派生')).toBeTruthy();
    fireEvent.click(toolbar.getByText('查询'));
    expect(screen.getByText('匹配 1 / 6 个接口')).toBeTruthy();
    expect(recorder.countOf('GET', apiCatalogContract.get.fullPath)).toBe(1);

    const pathCell = await screen.findByText('/api/auth/login');
    // 路径列可复制：单元格自身吞掉点击（避免选中文本触发行动作），点同一行的方法标签打开详情
    const row = pathCell.closest('tr, [role="row"]');
    expect(row).not.toBeNull();
    fireEvent.click(within(row as HTMLElement).getByText('POST'));
    await waitFor(() => expect(screen.getByText('契约组')).toBeTruthy());
    expect(screen.getByText('在 API 文档中查看')).toBeTruthy();

    // 重置回到全量
    fireEvent.click(toolbar.getByText('重置'));
    expect(screen.getByText('共 6 个接口，由契约声明派生')).toBeTruthy();
    expect(recorder.countOf('GET', apiCatalogContract.get.fullPath)).toBe(1);
  });

  it('still downloads fresh catalog data when the active query is explicitly refreshed', async () => {
    const { client } = renderPage();
    await screen.findByText('共 6 个接口，由契约声明派生');
    recorder.on('GET', apiCatalogContract.get.fullPath, {
      ...catalog,
      items: [...catalog.items, item({ method: 'post', fullPath: '/api/auth/logout', summary: '退出登录', basePath: '/api/auth' })],
    });

    await act(async () => {
      await client.refetchQueries({ queryKey: apiCatalogKeys.catalog });
    });

    expect(await screen.findByText('共 7 个接口，由契约声明派生')).toBeTruthy();
    expect(screen.getByText('/api/auth/logout')).toBeTruthy();
    expect(recorder.countOf('GET', apiCatalogContract.get.fullPath)).toBe(2);
  });

  it('shows permission labels from the catalog and lists related operations in the sheet', async () => {
    renderPage();
    const pathCell = await screen.findByText('/api/users');
    fireEvent.click(within(pathCell.closest('tr') as HTMLElement).getByText('GET'));
    await waitFor(() => expect(screen.getByText('契约组')).toBeTruthy());
    const sheet = screen.getByText('契约组').closest('.semi-sidesheet') as HTMLElement;
    expect(within(sheet).getByText('system:user:list', { selector: 'code' })).toBeTruthy();
    expect(within(sheet).getByText('查看用户')).toBeTruthy();
    expect(within(sheet).getByText('查询用户')).toBeTruthy();
  });

  it('lists only the callable operations of the selected role by default and can switch to denied', async () => {
    const user = userEvent.setup();
    const selectRoleOption = async (name: RegExp) => {
      const option = await screen.findByRole('option', { name });
      const popup = option.closest('.semi-popover-wrapper');
      expect(popup).not.toBeNull();
      await user.click(option);
      // Semi 受控 Select 在关闭动画 afterClose 后才提交 onChange；jsdom 不执行 CSS 动画，
      // 且缺少 AnimationEvent 时 React 会监听 WebKit 前缀事件。
      const eventName = 'AnimationEvent' in window ? 'animationend' : 'webkitAnimationEnd';
      fireEvent(popup as HTMLElement, Object.assign(new Event(eventName, { bubbles: true }), { animationName: 'semi-tooltip-zoomOut' }));
    };
    renderPage();
    await screen.findByText('共 6 个接口，由契约声明派生');
    await waitFor(() => expect(recorder.countOf('GET', permissionMatrixContract.roles.fullPath)).toBe(1));

    await user.click(screen.getByText('选择角色，查看它能调用哪些接口'));
    await selectRoleOption(/只读（viewer）/);
    await waitFor(() => expect(screen.getByText('持有 1 个权限码')).toBeTruthy());

    // 默认只看「可调用」：登录即可 + 持有码的接口；非登录令牌接口不计入判定
    const allowedCard = screen.getByRole('button', { name: /可调用/ });
    expect(allowedCard.getAttribute('aria-pressed')).toBe('true');
    expect(within(allowedCard).getByText('2')).toBeTruthy();
    expect(screen.getByText('可调用 2 / 6 个接口')).toBeTruthy();
    expect(screen.getByText('/api/auth/me')).toBeTruthy();
    expect(screen.getByText('/api/users')).toBeTruthy();
    expect(screen.queryByText('/api/users/{id}')).toBeNull();
    expect(recorder.countOf('GET', apiCatalogContract.get.fullPath)).toBe(1);

    // 切到「无权限」
    fireEvent.click(screen.getByRole('button', { name: /无权限/ }));
    expect(screen.getByRole('button', { name: /无权限/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('无权限 1 / 6 个接口')).toBeTruthy();
    expect(screen.getByText('/api/users/{id}')).toBeTruthy();

    // 仅平台超管
    fireEvent.click(screen.getByRole('button', { name: /仅平台超管/ }));
    expect(screen.getByText('仅平台超管 1 / 6 个接口')).toBeTruthy();
    expect(screen.getByText('/api/tenants')).toBeTruthy();
    expect(recorder.countOf('GET', apiCatalogContract.get.fullPath)).toBe(1);

    // 切换查看主体只重新判定已缓存的目录
    await user.click(screen.getByText('只读（viewer）'));
    await selectRoleOption(/超级管理员（super_admin）/);
    expect(await screen.findByText('可调用 4 / 6 个接口')).toBeTruthy();
    expect(screen.getByText('平台超管 · 全部放行')).toBeTruthy();
    expect(recorder.countOf('GET', apiCatalogContract.get.fullPath)).toBe(1);
  });
});
