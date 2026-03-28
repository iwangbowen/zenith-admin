# Demo 演示模式（MSW Mock）

Zenith Admin 支持无后端服务的纯前端演示模式，通过 [MSW（Mock Service Worker）](https://mswjs.io/) 拦截所有 API 请求，在浏览器中直接返回预设的 Mock 数据。Demo 站即使用此模式构建，托管在 GitHub Pages 上。

---

## 工作原理

```
浏览器发出 fetch/XHR 请求
    ↓
Service Worker（mockServiceWorker.js）拦截请求
    ↓
MSW Handler 匹配路径和方法
    ↓
返回 Mock 数据（无实际网络请求）
    ↓
前端像收到真实接口响应一样正常渲染
```

整个过程对前端业务代码（`request.ts`）完全透明，无需修改任何业务逻辑。

---

## 开启 Demo 模式

在 `packages/web/.env` 中设置：

```ini
VITE_DEMO_MODE=true
```

启动后，页面右下角会有一个 MSW 激活提示（开发模式），终端日志中也会出现 `[MSW] Mocking enabled` 字样。

---

## 构建 Demo 站

```bash
npm run build:demo
```

此命令使用 `packages/web/.env.demo` 中的变量构建前端，并将产物输出到文档站目录（用于 GitHub Pages 部署）。

```ini
# packages/web/.env.demo 的关键变量
VITE_DEMO_MODE=true
VITE_APP_TITLE=Zenith Admin Demo
```

Demo 站与文档站通过 `.github/workflows/pages.yml` 一同部署到 GitHub Pages。

---

## 目录结构

```text
packages/web/src/mocks/
├── data/               # 静态 Mock 数据（与 seed.ts 对齐）
│   ├── users.ts
│   ├── roles.ts
│   ├── menus.ts
│   ├── departments.ts
│   ├── positions.ts
│   ├── dicts.ts
│   ├── system.ts
│   ├── notices.ts
│   ├── logs.ts
│   └── index.ts        # 汇总导出
├── handlers/           # MSW Handler 定义（每个模块一个文件）
│   ├── auth.ts
│   ├── users.ts
│   ├── roles.ts
│   ├── menus.ts
│   ├── departments.ts
│   ├── positions.ts
│   ├── dicts.ts
│   ├── system-configs.ts
│   ├── notices.ts
│   ├── files.ts
│   ├── sessions.ts
│   ├── login-logs.ts
│   ├── operation-logs.ts
│   ├── cron-jobs.ts
│   ├── monitor.ts
│   └── index.ts        # 汇总所有 handlers
├── browser.ts          # setupWorker（浏览器环境）
└── index.ts            # enableMocking() 入口，VITE_DEMO_MODE 控制是否激活
```

---

## 维护规范

### 新增业务模块时

1. 在 `data/` 下创建对应数据文件（模拟真实 seed 数据）
2. 在 `handlers/` 下创建对应的 Handler 文件，实现 CRUD 接口模拟
3. 在 `handlers/index.ts` 中导入并注册新 Handler
4. 在 `data/index.ts` 中导出新数据

### 修改 API 接口格式时

如果后端接口的请求/响应格式发生变化，需要同步更新对应的 MSW Handler，确保 Demo 模式不出现格式不一致的问题。

---

## Handler 示例

```typescript
// packages/web/src/mocks/handlers/positions.ts
import { http, HttpResponse } from 'msw';
import { mockPositions } from '../data';

export const positionHandlers = [
  http.get('/api/positions', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page') ?? 1);
    const pageSize = Number(url.searchParams.get('pageSize') ?? 10);
    const list = mockPositions.slice((page - 1) * pageSize, page * pageSize);
    return HttpResponse.json({
      code: 0,
      message: 'success',
      data: { list, total: mockPositions.length, page, pageSize },
    });
  }),
];
```

---

## 访问 Demo 站

线上 Demo 站地址：[https://iwangbowen.github.io/zenith-admin/demo/](https://iwangbowen.github.io/zenith-admin/demo/)

默认登录账号：

| 账号 | 密码 | 说明 |
|------|------|------|
| `admin` | `123456` | 超级管理员，拥有所有权限 |
