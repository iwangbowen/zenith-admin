import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  select: vi.fn(),
}));

const permissionMocks = vi.hoisted(() => ({
  isSuperAdmin: vi.fn(),
  getUserMenuIds: vi.fn(),
}));
const packageMocks = vi.hoisted(() => ({
  getTenantPackageFeatureSet: vi.fn(async () => null as ReadonlySet<string> | null),
}));
const deployment = vi.hoisted(() => ({ multiTenantMode: false }));
vi.mock('../../config', () => ({ config: deployment }));

vi.mock('../../db', () => ({
  db: {
    select: dbMocks.select,
  },
}));

vi.mock('../../lib/context', () => ({
  currentUser: vi.fn(() => ({ userId: 1, roles: [] })),
}));

vi.mock('../../lib/tenant', () => ({
  getEffectiveTenantId: vi.fn(() => null),
  isPlatformAdmin: () => false,
}));

vi.mock('../../lib/tenant-package', () => ({
  getTenantPackageFeatureSet: packageMocks.getTenantPackageFeatureSet,
}));

vi.mock('../../lib/permissions', () => ({
  isSuperAdmin: permissionMocks.isSuperAdmin,
  getUserMenuIds: permissionMocks.getUserMenuIds,
  clearUserPermissionCache: vi.fn(),
}));

import { excludeDisabledSubtrees, listUserMenuTree } from './menus.service';

type MenuRow = {
  id: number;
  parentId: number;
  title: string;
  name: string | null;
  path: string | null;
  component: string | null;
  icon: string | null;
  type: 'directory' | 'menu';
  permission: string | null;
  query: string | null;
  isExternal: boolean;
  embed: boolean;
  keepAlive: boolean;
  sort: number;
  status: 'enabled' | 'disabled';
  visible: boolean;
  featureKey: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function menuRow(partial: Pick<MenuRow, 'id' | 'parentId' | 'title'> & Partial<MenuRow>): MenuRow {
  return {
    name: null,
    path: null,
    component: null,
    icon: null,
    type: 'menu',
    permission: null,
    query: null,
    isExternal: false,
    embed: false,
    keepAlive: false,
    sort: 0,
    status: 'enabled',
    visible: true,
    featureKey: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...partial,
  };
}

function createSelectChain(result: unknown[]) {
  const chain = {
    from: vi.fn(),
    orderBy: vi.fn(),
    then: (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  chain.from.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  return chain;
}

/** 系统管理（禁用）→ 用户管理（启用）→ 查询按钮；系统设置（启用）→ 字典管理（启用）；孤儿页面（父级不存在） */
const rows: MenuRow[] = [
  menuRow({ id: 1000, parentId: 0, title: '系统管理', type: 'directory', status: 'disabled' }),
  menuRow({ id: 1010, parentId: 1000, title: '用户管理', path: '/system/users' }),
  menuRow({ id: 1011, parentId: 1010, title: '用户详情', type: 'menu', path: '/users/detail', permission: 'user:list' }),
  menuRow({ id: 1020, parentId: 1000, title: '角色管理', path: '/system/roles', status: 'disabled' }),
  menuRow({ id: 2000, parentId: 0, title: '系统设置', type: 'directory' }),
  menuRow({ id: 2010, parentId: 2000, title: '字典管理', path: '/settings/dicts' }),
  menuRow({ id: 2020, parentId: 2000, title: '参数配置', path: '/settings/params', status: 'disabled' }),
  menuRow({ id: 9000, parentId: 8888, title: '孤儿页面', path: '/orphan' }),
];

beforeEach(() => {
  vi.resetAllMocks();
  deployment.multiTenantMode = false;
});

describe('excludeDisabledSubtrees', () => {
  it('drops disabled menus together with their whole subtree', () => {
    const kept = excludeDisabledSubtrees(rows).map((row) => row.id);

    expect(kept).toEqual([2000, 2010, 9000]);
  });

  it('keeps orphan rows for buildMenuTree to handle as before', () => {
    const kept = excludeDisabledSubtrees([rows[7]]);

    expect(kept).toHaveLength(1);
  });

  it('terminates on cyclic parent references instead of looping forever', () => {
    const cyclic = [
      menuRow({ id: 1, parentId: 2, title: 'A' }),
      menuRow({ id: 2, parentId: 1, title: 'B' }),
    ];

    expect(excludeDisabledSubtrees(cyclic)).toHaveLength(2);
  });
});

describe('listUserMenuTree', () => {
  it('omits global maintenance for tenant principals even if assigned', async () => {
    deployment.multiTenantMode = true;
    permissionMocks.isSuperAdmin.mockReturnValue(false);
    permissionMocks.getUserMenuIds.mockResolvedValue([2410]);
    dbMocks.select.mockReturnValueOnce(createSelectChain([menuRow({ id: 2410, parentId: 0, path: '/system/maintenance' })]));
    expect(await listUserMenuTree()).toEqual([]);
  });
  it('omits platform-only IP settings for tenant principals even if assigned', async () => {
    deployment.multiTenantMode = true;
    permissionMocks.isSuperAdmin.mockReturnValue(false);
    permissionMocks.getUserMenuIds.mockResolvedValue([2170]);
    dbMocks.select.mockReturnValueOnce(createSelectChain([menuRow({ id: 2170, parentId: 0, title: 'IP', path: '/system/ip-access' })]));
    expect(await listUserMenuTree()).toEqual([]);
  });
  it('preserves ordinary directories when a platform setting has no dedicated page', async () => {
    deployment.multiTenantMode = true;
    permissionMocks.isSuperAdmin.mockReturnValue(false);
    permissionMocks.getUserMenuIds.mockResolvedValue([2010]);
    dbMocks.select.mockReturnValueOnce(createSelectChain(rows));
    const tree = await listUserMenuTree();
    expect(tree.map((node) => node.id)).toEqual([2000]);
    expect(tree[0].children?.map((node) => node.id)).toEqual([2010]);
  });
  it('does not promote children of a disabled directory to sidebar roots for super admins', async () => {
    permissionMocks.isSuperAdmin.mockReturnValue(true);
    dbMocks.select.mockReturnValueOnce(createSelectChain(rows));

    const tree = await listUserMenuTree();

    expect(tree.map((node) => node.id)).toEqual([2000, 9000]);
    expect(tree[0].children?.map((node) => node.id)).toEqual([2010]);
    expect(JSON.stringify(tree)).not.toContain('"id":1010');
  });

  it('does not promote children of a disabled directory even when the user is granted them directly', async () => {
    permissionMocks.isSuperAdmin.mockReturnValue(false);
    permissionMocks.getUserMenuIds.mockResolvedValue([1010, 2010]);
    dbMocks.select.mockReturnValueOnce(createSelectChain(rows));

    const tree = await listUserMenuTree();

    expect(tree.map((node) => node.id)).toEqual([2000]);
    expect(tree[0].children?.map((node) => node.id)).toEqual([2010]);
  });

  it('filters stale page grants after a tenant package is reduced', async () => {
    deployment.multiTenantMode = true;
    permissionMocks.isSuperAdmin.mockReturnValue(false);
    permissionMocks.getUserMenuIds.mockResolvedValue([2440, 2450, 2000, 2010]);
    packageMocks.getTenantPackageFeatureSet.mockResolvedValue(new Set(['workflow']));
    dbMocks.select.mockReturnValueOnce(createSelectChain([
      menuRow({ id: 2000, parentId: 0, title: '系统设置', type: 'directory', featureKey: null }),
      menuRow({ id: 2010, parentId: 2000, title: '系统设置', path: '/system/settings', featureKey: null }),
      menuRow({ id: 2440, parentId: 2000, title: '系统运维', type: 'directory', featureKey: 'ops' }),
      menuRow({ id: 2450, parentId: 2440, title: 'Web 终端', path: '/system/terminal', featureKey: 'ops' }),
      menuRow({ id: 4000, parentId: 0, title: '工作流', type: 'directory', featureKey: 'workflow' }),
    ]));

    const tree = await listUserMenuTree();

    expect(JSON.stringify(tree)).not.toContain('Web 终端');
    expect(tree.map((node) => node.id)).toEqual([2000]);
    expect(tree[0].children?.map((node) => node.id)).toEqual([2010]);
  });
});
