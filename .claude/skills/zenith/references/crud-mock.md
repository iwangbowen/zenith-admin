# MSW Mock 实现参考（可选 Demo 演示模式）

本文档适用于需要支持 `VITE_DEMO_MODE=true` 的 Demo 演示场景。当后端不可用时，MSW（Mock Service Worker）拦截所有 API 请求，返回内存中的静态数据。

> **仅在用户确认需要 Demo 演示模式时才实现这部分。**

---

## 文件清单

```
packages/web/src/mocks/
├── data/
│   └── xxxs.ts              # 静态初始数据 + nextId 工具函数
├── handlers/
│   └── xxxs.ts              # HTTP handler 定义
└── handlers/index.ts        # 注册 xxxsHandlers（现有文件，追加即可）
```

---

## Step 10a：`packages/web/src/mocks/data/xxxs.ts`

```ts
import type { Xxx } from '@zenith/shared';

// 与 packages/server/src/db/seed.ts 中的种子数据对齐
export interface MockXxx extends Xxx {
  // 如有 mock 专属字段，在此扩展（通常与 Xxx 一致）
}

// 内存中的静态数据
export const mockXxxs: MockXxx[] = [
  {
    id: 1,
    name: '示例XXX-1',
    description: '初始演示数据',
    status: 'active',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
  {
    id: 2,
    name: '示例XXX-2',
    description: '初始演示数据',
    status: 'active',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
];

// 自增 ID（内存）
let nextXxxId = mockXxxs.length + 1;
export function getNextXxxId(): number {
  return nextXxxId++;
}
```

---

## Step 10b：`packages/web/src/mocks/handlers/xxxs.ts`

```ts
import { http, HttpResponse } from 'msw';
import { mockXxxs, getNextXxxId } from '../data/xxxs';

export const xxxsHandlers = [
  // ─── GET / — 分页列表 + 关键词搜索 + 状态筛选 ───────────────────────
  http.get('/api/xxxs', ({ request }) => {
    const url = new URL(request.url);
    const page     = Number(url.searchParams.get('page'))     || 1;
    const pageSize = Number(url.searchParams.get('pageSize')) || 10;
    const keyword  = url.searchParams.get('keyword')  || '';
    const status   = url.searchParams.get('status')   || '';

    let list = [...mockXxxs];

    if (keyword) {
      list = list.filter(
        (x) =>
          x.name.includes(keyword) ||
          (x.description ?? '').includes(keyword),
      );
    }
    if (status) {
      list = list.filter((x) => x.status === status);
    }

    const total      = list.length;
    const sliced     = list.slice((page - 1) * pageSize, page * pageSize);

    return HttpResponse.json({
      code: 0,
      message: 'ok',
      data: { list: sliced, total, page, pageSize },
    });
  }),

  // ─── GET /:id — 详情 ─────────────────────────────────────────────────
  http.get('/api/xxxs/:id', ({ params }) => {
    const id = Number(params.id);
    const xxx = mockXxxs.find((x) => x.id === id);
    if (!xxx) {
      return HttpResponse.json({ code: 404, message: 'XXX不存在', data: null }, { status: 404 });
    }
    return HttpResponse.json({ code: 0, message: 'ok', data: xxx });
  }),

  // ─── POST / — 创建 ────────────────────────────────────────────────────
  http.post('/api/xxxs', async ({ request }) => {
    const body = (await request.json()) as any;
    const now = new Date().toISOString();
    const newXxx = {
      id: getNextXxxId(),
      name: body.name,
      description: body.description ?? '',
      status: body.status ?? 'active',
      createdAt: now,
      updatedAt: now,
    };
    mockXxxs.push(newXxx);
    return HttpResponse.json({ code: 0, message: '创建成功', data: newXxx });
  }),

  // ─── PUT /:id — 更新 ─────────────────────────────────────────────────
  http.put('/api/xxxs/:id', async ({ params, request }) => {
    const id = Number(params.id);
    const body = (await request.json()) as any;
    const idx = mockXxxs.findIndex((x) => x.id === id);
    if (idx === -1) {
      return HttpResponse.json({ code: 404, message: 'XXX不存在', data: null }, { status: 404 });
    }
    Object.assign(mockXxxs[idx], { ...body, updatedAt: new Date().toISOString() });
    return HttpResponse.json({ code: 0, message: '更新成功', data: mockXxxs[idx] });
  }),

  // ─── DELETE /:id — 删除 ──────────────────────────────────────────────
  http.delete('/api/xxxs/:id', ({ params }) => {
    const id = Number(params.id);
    const idx = mockXxxs.findIndex((x) => x.id === id);
    if (idx === -1) {
      return HttpResponse.json({ code: 404, message: 'XXX不存在', data: null }, { status: 404 });
    }
    mockXxxs.splice(idx, 1);
    return HttpResponse.json({ code: 0, message: '删除成功', data: null });
  }),
];
```

---

## Step 10c：`packages/web/src/mocks/handlers/index.ts`

在现有文件中追加注册（不要替换，只追加）：

```ts
// 在顶部 import 区域追加：
import { xxxsHandlers } from './xxxs';

// 在 handlers 数组中追加（与其他 handlers 同级）：
export const handlers = [
  ...authHandlers,
  ...usersHandlers,
  // ... 其他已有 handlers ...
  ...xxxsHandlers,   // ← 新增这行
];
```

---

## 注意事项

- **数据放内存**：mock 数据在页面刷新后会重置，这是预期行为
- **与 seed 数据对齐**：`mockXxxs` 的初始数据应与 `seed.ts` 的初始数据一致
- **mockXxxs 共享引用**：push/splice 操作直接修改数组，所有 handler 共享同一份数据，无需额外状态管理
- **时间字段**：创建时用 `new Date().toISOString()`，初始数据用 `SEED_DATE`（`'2024-01-01T00:00:00.000Z'`）
