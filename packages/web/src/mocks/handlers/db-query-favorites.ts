import { http, HttpResponse } from 'msw';
import { mockDateTime } from '@/mocks/utils/date';

const API = import.meta.env.VITE_API_BASE_URL || '';

let nextId = 4;

type MockFavorite = {
  id: number;
  name: string;
  sql: string;
  description: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

const mockFavorites: MockFavorite[] = [
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
  http.get(`${API}/api/db-admin/query-favorites`, () => {
    return HttpResponse.json({ code: 0, message: 'success', data: [...mockFavorites] });
  }),

  // 新增收藏
  http.post(`${API}/api/db-admin/query-favorites`, async ({ request }) => {
    const body = await request.json() as { name: string; sql: string; description?: string; tags?: string[] };
    const now = mockDateTime();
    const newFav = {
      id: nextId++,
      name: body.name,
      sql: body.sql,
      description: body.description ?? null,
      tags: body.tags ?? [],
      createdAt: now,
      updatedAt: now,
    };
    mockFavorites.push(newFav);
    return HttpResponse.json({ code: 0, message: 'success', data: newFav }, { status: 201 });
  }),

  // 更新收藏
  http.patch(`${API}/api/db-admin/query-favorites/:id`, async ({ params, request }) => {
    const id = Number(params.id);
    const body = await request.json() as Partial<{ name: string; sql: string; description?: string; tags?: string[] }>;
    const idx = mockFavorites.findIndex((f) => f.id === id);
    if (idx === -1) {
      return HttpResponse.json({ code: 404, message: '收藏不存在', data: null }, { status: 404 });
    }
    const updated = {
      ...mockFavorites[idx],
      ...body,
      updatedAt: mockDateTime(),
    };
    mockFavorites[idx] = updated;
    return HttpResponse.json({ code: 0, message: 'success', data: updated });
  }),

  // 删除收藏
  http.delete(`${API}/api/db-admin/query-favorites/:id`, ({ params }) => {
    const id = Number(params.id);
    const idx = mockFavorites.findIndex((f) => f.id === id);
    if (idx !== -1) {
      mockFavorites.splice(idx, 1);
    }
    return HttpResponse.json({ code: 0, message: 'success', data: null });
  }),
];
