# MSW Mock 实现参考（Step 11）

Demo 演示模式（`VITE_DEMO_MODE=true`）下，MSW 拦截所有 API 请求并返回内存中的静态数据。
**仅在 Step 0 确认需要 Demo 模式时才实现这部分。**

约束条目见 [constraints.md → MSW Mock 层](./constraints.md)。

```text
packages/web/src/mocks/
├── utils/
│   ├── array.ts             # 内存数组的共享原地变更工具
│   ├── contract.ts          # mock(op, resolver)：契约绑定的 handler 构造
│   ├── handlers.ts          # 失败响应构造与分页工具（直接用，勿另起炉灶）
│   └── date.ts              # mockDateTime() 等时间工具
├── data/
│   └── xxxs.ts              # 静态初始数据 + nextId 工具函数
├── handlers/
│   └── xxxs.ts              # 契约 handler 定义
└── handlers/index.ts        # 注册 xxxsHandlers（追加即可）
```

---

## 共享工具

`mock(op, resolver)`（`mocks/utils/contract.ts`）给 resolver 的上下文：

| 字段 | 含义 |
| --- | --- |
| `params` / `query` / `headers` / `body` | 已按契约 schema 解析（含 coerce 与默认值，类型即 schema 输出，带 `.default()` 的字段不再可选）；multipart 的 `body` 为 `FormData`；无 JSON 头的请求按 `{}` 进入校验（与服务端一致） |
| `ok(data, message?, init?)` | 成功响应，`data` 必须满足契约响应类型；`message` 默认 `'ok'`，需要 `data: null` 就显式传 `null` |
| `paginate(list)` | 按 `query.page` / `query.pageSize` 切片成 `{ list, total, page, pageSize }` |
| `request` / `url` | 原始请求与 URL（极少需要） |

失败响应与 ID 工具（`mocks/utils/handlers.ts`）：

| 构造函数 | 用途 |
| --- | --- |
| `badRequest` / `unauthorized` / `forbidden` / `notFound` / `conflict` / `locked` | 400 / 401 / 403 / 404 / 409 / 423，`data` 固定 `null` |
| `fail(code, message, init?)` | 上述之外的业务 code |
| `pageResult(list, page, pageSize)` | 页码来自 query 之外时用这个 |
| `nextIdFrom(list)` | 由现有列表推下一个自增 ID，空列表返回 1 |

批量删除或级联清理内存数组时用 `mocks/utils/array.ts` 的 `removeWhere(list, predicate)`，
它保持原数组引用并返回实际移除数量。

所有构造函数的末位参数是原样透传的 `ResponseInit`：默认只在响应体里写 `code`（HTTP 仍是 200），
需要同时设置 HTTP 状态码时显式写 `notFound('XXX 不存在', { status: 404 })`。

---

## 11a：`mocks/data/xxxs.ts`

```ts
import { SEED_XXXS } from '@zenith/shared/seed';   // 与 DB seed 同一份数据源
import type { Xxx } from '@zenith/shared/{业务域}';
import { mockDateTime } from '@/mocks/utils/date';
import { nextIdFrom } from '@/mocks/utils/handlers';

// Xxx 类型有 mock 专属字段（如运行时计数）时在此扩展
export interface MockXxx extends Xxx {
  // extraField?: number;
}

const now = mockDateTime();
export const mockXxxs: MockXxx[] = SEED_XXXS.map((x) => ({
  ...x,
  // extraField: 0,
  createdAt: now,
  updatedAt: now,
}));

let nextXxxId = nextIdFrom(mockXxxs);
export function getNextXxxId(): number {
  return nextXxxId++;
}
```

新增模块时**先**在 `shared/src/seed/{业务域}.ts` 添加 `SEED_XXXS`（见 [seed-config.md](./seed-config.md)），
**再**在 mock data 中导入。demo 模式需要额外字段时用 `.map()` 展开后追加，不要整体复制一份静态数组。

## 11b：`mocks/handlers/xxxs.ts`

每条 handler 由契约操作绑定：`mock(op, resolver)` 负责路径（`{id}` → `:id`）、方法与入参解析——
`params` / `query` / `body` 已按契约 schema 解析（含 coerce 与默认值，非法输入同样返回 400），
`ok(data)` 的载荷按契约响应类型检查，`paginate(list)` 按解析后的 `page` / `pageSize` 切片。

```ts
import { xxxContract } from '@zenith/shared/{业务域}';
import type { Xxx } from '@zenith/shared/{业务域}';
import { mock } from '@/mocks/utils/contract';
import { badRequest, notFound } from '@/mocks/utils/handlers';
import { mockXxxs, getNextXxxId } from '../data/xxxs';
import { mockDateTime } from '../utils/date';

export const xxxsHandlers = [
  // ─── 列表：关键词搜索 + 状态筛选 + 分页 ────────────────────────────────
  mock(xxxContract.list, ({ query, ok, paginate }) => {
    let list = [...mockXxxs];
    if (query.keyword) list = list.filter((x) => x.name.includes(query.keyword!) || (x.description ?? '').includes(query.keyword!));
    if (query.status) list = list.filter((x) => x.status === query.status);
    return ok(paginate(list));
  }),

  // ─── 详情 ───────────────────────────────────────────────────────────────
  mock(xxxContract.detail, ({ params, ok }) => {
    const xxx = mockXxxs.find((x) => x.id === params.id);
    return xxx ? ok(xxx) : notFound('XXX 不存在', { status: 404 });
  }),

  // ─── 创建：body 即 CreateXxxInput（已校验、已补默认值）────────────────
  mock(xxxContract.create, ({ body, ok }) => {
    if (mockXxxs.some((x) => x.name === body.name)) return badRequest('名称已存在', { status: 400 });
    const now = mockDateTime();
    const newXxx: Xxx = {
      id: getNextXxxId(),
      name: body.name,
      description: body.description ?? null,
      status: body.status,
      createdAt: now,
      updatedAt: now,
    };
    mockXxxs.push(newXxx);
    return ok(newXxx, '创建成功');
  }),

  // ─── 更新 ───────────────────────────────────────────────────────────────
  mock(xxxContract.update, ({ params, body, ok }) => {
    const xxx = mockXxxs.find((x) => x.id === params.id);
    if (!xxx) return notFound('XXX 不存在', { status: 404 });
    Object.assign(xxx, body, { updatedAt: mockDateTime() });
    return ok(xxx, '更新成功');
  }),

  // ─── 删除 ───────────────────────────────────────────────────────────────
  mock(xxxContract.remove, ({ params, ok }) => {
    const idx = mockXxxs.findIndex((x) => x.id === params.id);
    if (idx === -1) return notFound('XXX 不存在', { status: 404 });
    mockXxxs.splice(idx, 1);
    // 显式传 null 保留 `data: null`；省略则响应体不含 data 字段
    return ok(null, '删除成功');
  }),
];
```

### 可选端点

契约声明 `all` 时，在 `detail` handler **之前**添加：

```ts
mock(xxxContract.all, ({ ok }) =>
  ok(mockXxxs.filter((x) => x.status === 'enabled').map(({ id, name, status }) => ({ id, name, status })))),
```

契约声明 `removeBatch` 时，在 `remove` handler **之前**添加：

```ts
import { removeWhere } from '@/mocks/utils/array';

mock(xxxContract.removeBatch, ({ body, ok }) => {
  if (body.ids.length === 0) return badRequest('请选择要删除的记录', { status: 400 });
  const selected = new Set(body.ids);
  const deleted = removeWhere(mockXxxs, (x) => selected.has(x.id));
  return ok(null, `已删除 ${deleted} 条记录`);
}),
```

`/all`、`/batch` 都是静态路径，必须排在动态 `/{id}` 之前；契约声明的操作在服务端与 Mock 同时实现。

上传类操作（`multipart(...)`）的 `body` 是原始 `FormData`；非 JSON 响应（`kind: 'excel'` 等）的 handler 直接返回
`new HttpResponse(blob, { headers })`。

## 11c：`mocks/handlers/index.ts`

在现有文件中**追加**注册（不要替换）：

```ts
import { xxxsHandlers } from './xxxs';

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
- **共享引用**：`push` / `splice` 直接修改数组，所有 handler 共享同一份数据，无需额外状态管理
- **时间字段**：创建 / 更新用 `mockDateTime()`，初始数据用 `SEED_DATE`，与 API 的
  `YYYY-MM-DD HH:mm:ss` 契约一致
- **异步任务类型**：新增业务任务类型时还需改 `mocks/handlers/async-tasks.ts`，
  见 [async-tasks.md](./async-tasks.md)
