import { dbAdminContract, type DbQueryFavorite } from '@zenith/shared/ops';
import { mock } from '@/mocks/utils/contract';
import { notFound } from '@/mocks/utils/handlers';
import { mockDateTime } from '@/mocks/utils/date';

let nextId = 4;

const mockFavorites: DbQueryFavorite[] = [
  {
    id: 1,
    name: '查询所有用户',
    sql: 'SELECT id, username, email, created_at FROM users ORDER BY created_at DESC LIMIT 100;',
    description: '查询用户基本信息，按创建时间倒序',
    tags: ['用户', '查询'],
    createdAt: '2025-06-01 10:00:00',
    updatedAt: '2025-06-01 10:00:00',
  },
  {
    id: 2,
    name: '统计各角色用户数',
    sql: `SELECT r.name AS role_name, COUNT(ur.user_id) AS user_count
FROM roles r
LEFT JOIN user_roles ur ON r.id = ur.role_id
GROUP BY r.id, r.name
ORDER BY user_count DESC;`,
    description: '按角色统计用户数量',
    tags: ['统计', '角色'],
    createdAt: '2025-06-02 14:30:00',
    updatedAt: '2025-06-02 14:30:00',
  },
  {
    id: 3,
    name: '最近登录日志',
    sql: 'SELECT username, ip_address, login_time, status FROM login_logs ORDER BY login_time DESC LIMIT 50;',
    description: '查看最近50条登录记录',
    tags: ['日志', '监控'],
    createdAt: '2025-06-03 09:15:00',
    updatedAt: '2025-06-03 09:15:00',
  },
];

export const dbQueryFavoritesHandlers = [
  // 获取收藏夹列表
  mock(dbAdminContract.favorites, ({ ok }) => ok([...mockFavorites], 'success')),

  // 新增收藏
  mock(dbAdminContract.createFavorite, ({ body, ok }) => {
    const now = mockDateTime();
    const newFav: DbQueryFavorite = {
      id: nextId++,
      name: body.name,
      sql: body.sql,
      description: body.description ?? null,
      tags: body.tags ?? [],
      createdAt: now,
      updatedAt: now,
    };
    mockFavorites.push(newFav);
    return ok(newFav, 'success', { status: 201 });
  }),

  // 更新收藏
  mock(dbAdminContract.updateFavorite, ({ params, body, ok }) => {
    const idx = mockFavorites.findIndex((f) => f.id === params.id);
    if (idx === -1) {
      return notFound('收藏不存在', { status: 404 });
    }
    const current = mockFavorites[idx];
    const updated: DbQueryFavorite = {
      ...current,
      name: body.name ?? current.name,
      sql: body.sql ?? current.sql,
      description: body.description === undefined ? current.description : body.description,
      tags: body.tags ?? current.tags,
      updatedAt: mockDateTime(),
    };
    mockFavorites[idx] = updated;
    return ok(updated, 'success');
  }),

  // 删除收藏
  mock(dbAdminContract.removeFavorite, ({ params, ok }) => {
    const idx = mockFavorites.findIndex((f) => f.id === params.id);
    if (idx !== -1) {
      mockFavorites.splice(idx, 1);
    }
    return ok(null, 'success');
  }),
];
