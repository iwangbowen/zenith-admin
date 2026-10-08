# 本地开发

本页汇总当前仓库脚本、monorepo 协作方式与开发注意事项。命令均在仓库根目录执行，除非特别说明。

## 常用命令

### 项目开发

```bash
npm run dev            # 单个 all 角色后端 + @zenith/web（开发默认）
npm run dev:split      # 分别启动 api 角色与 worker 角色后端 + @zenith/web
npm run dev:server     # 后端：迁移 → 种子 → tsx watch src/index.ts
npm run dev:web        # 前端：Vite dev server，默认 5373
npm run dev:studio     # Mastra Studio，端口 5380，API 前缀 /api/mastra
npm run dev:demo       # 前端 Demo 模式，读取 packages/web/.env.demo
npm run dev:electron   # 前端 dev server + Electron 主进程 watch + Electron 窗口
```

`npm run dev:server` 由 `packages/server/scripts/dev.mjs` 编排，在 Windows 下会剥离 VS Code Auto Attach 注入的 inspector 环境变量，避免 `node-pty` 与 Windows ConPTY 死锁。默认 `npm run dev` 使用单个 `ZENITH_ROLES=all` 进程；需要验证拆分部署、跨进程 WS 扇出或 worker 健康探针时使用 `npm run dev:split`。VS Code 提供 compound「Debug: Split (api + worker + Web)」。

### 构建与校验

```bash
npm run build                  # shared → analytics-sdk → server → web
npm run build:studio           # 复制并生产化 Mastra Studio 到 packages/web/dist/studio
npm run build:demo             # shared + web demo 构建
npm run build:electron         # Electron 当前平台安装包
npm run build:electron:win     # Windows NSIS 安装包
npm run build:electron:mac     # macOS dmg + zip
npm run build:electron:linux   # Linux AppImage
npm run test                   # server + web vitest
npm run test:server            # 后端测试
npm run test:web               # 前端测试
npm run lint                   # shared + server + analytics-sdk + web
npm run lint:fix               # 四个包自动修复
npm run verify:split           # 本地端到端校验 api/worker 拆分部署链路
```

前端 `lint` 同时运行 ESLint 与 Stylelint：`eslint src && stylelint "src/**/*.css"`。

### 数据库相关

```bash
npm run db:generate    # drizzle-kit generate
npm run db:migrate     # tsx src/db/migrate.ts
npm run db:seed        # tsx src/db/seed.ts
```

### 文档站

```bash
npm run docs:dev       # VitePress dev，http://localhost:4177
npm run docs:build     # VitePress build
npm run docs:preview   # 预览构建产物，http://localhost:4178
```

## monorepo 协作方式

| 工作区 | 职责 | 主要脚本 |
| --- | --- | --- |
| `@zenith/shared` | 跨运行时类型、常量、Zod schema、seed | `build` / `lint` / `lint:fix` |
| `@zenith/analytics-sdk` | 浏览器行为、性能、错误采集 SDK | `build` / `lint` / `lint:fix` |
| `@zenith/server` | Hono API、CMS 前台渲染、后台任务、事件订阅 | `dev` / `build` / `start` / `db:*` / `test` / `lint` |
| `@zenith/web` | React 管理后台、会员前台、移动审批、Demo | `dev` / `dev:demo` / `build` / `build:demo` / `preview` / `test` / `lint` |
| `@zenith/electron` | 桌面壳、preload、在线升级 | `dev` / `build` / `build:win` / `build:mac` / `build:linux` |

依赖方向保持单向：`shared` 位于底层，`server`、`web`、`analytics-sdk` 复用它；`web` 与 `server` 不直接互相 import。

## 推荐开发顺序

1. 先确认业务域与契约：共享枚举、Zod schema、类型放入 `packages/shared/src/{domain}/`。
2. 数据库 schema 变更后通过 `npm run db:generate` 生成迁移，再执行 `npm run db:migrate`。
3. 后端路由保持薄层，业务规则进入 `packages/server/src/services/`。
4. 前端服务端状态通过 `packages/web/src/hooks/queries/` 的 TanStack Query hooks 管理。
5. 涉及 Demo 的接口同步更新 `packages/web/src/mocks/`。
6. 变更会影响使用方式时同步更新 `docs/`。

## 开发约束入口

- 全局与后端硬约束：`.agents/skills/zenith/references/constraints.md`
- 前端硬约束：`.agents/skills/zenith/references/constraints-frontend.md`
- CRUD、模块修改、异步任务、通知、发版等流程：`.agents/skills/zenith/SKILL.md`

文档站的 [AI 辅助开发](/ai/) 只解释这些资产的分工；执行任务时以仓库内文件为准。

## 常见注意事项

### 服务端依赖兼容

`packages/server/package.json` 的外部依赖以 npm 最新稳定版为升级目标，本地 `@zenith/*` 包继续使用工作区引用。
当前依赖要求 Node.js 24.15.0 或更新的 24.x，以及 npm 12.2.0 或更新版本。npm 11.4 无法正确应用工作区内的 peer override，可能报冲突或漏装 `@mastra/evals`；安装与依赖树校验使用 npm 12，已有旧版 npm 时可执行 `npx --yes npm@12.2.0 install`。

npm 12 默认阻止依赖安装脚本。根 `package.json` 的 `allowScripts` 按包名允许当前 lockfile 中所需的安装脚本，包括 `node-pty` / `ssh2` 的原生模块和 `esbuild` 安装步骤，适用于全部工作区与嵌套版本。升级依赖后在仓库根目录执行 `npm install-scripts ls` 检查新增脚本，再按实际需要更新此列表，详见 [npm 安装脚本策略](https://docs.npmjs.com/cli/v12/commands/npm-install-scripts/)。CI、Pages、Release 与 Docker 均先安装 npm 12.2.0。

- `@node-rs/bcrypt` 2 的 `hash` 使用 `{ cost }` 参数；密码统一入口保持成本 10，并通过升级前的固定哈希样本验证存量密码。
- TypeScript 保留两个别名：`@typescript/native` 使用 TypeScript 7 原生 CLI，`typescript` 使用 `@typescript/typescript6` 提供 ESLint 与 `tsc-alias` 所需的 JavaScript API。
- `@mastra/evals` 1.10.5 的可选 Vitest peer 尚未声明支持 Vitest 5。项目仅使用 `scorers/prebuilt`，根 `overrides` 将该 peer 对齐到 Vitest 5；真实工厂注册与打分器替换由 `scorers.test.ts` 验证。项目未使用 `@mastra/evals/vitest`，新增该入口前需单独确认兼容性。上游支持 Vitest 5 后移除此 override。

### 数据库迁移

不要手改已有迁移 SQL。修改 `packages/server/src/db/schema/` 后通过 Drizzle 生成新迁移。

### 时间格式

API 响应、入参、前端显示、MSW Mock 统一使用 `YYYY-MM-DD HH:mm:ss`。后端使用 `packages/server/src/lib/datetime.ts`，前端使用 `packages/web/src/utils/date.ts`。数据库时间列与 SQL 时区写法见[数据库与迁移 → 时间与时区](../backend/database.md#时间与时区)。

### 图标

业务页面和操作入口统一使用 `lucide-react`。

### Windows 与 Electron

根 `build:electron*` 脚本通过 Unix `env VITE_ELECTRON=true` 注入环境变量；Windows 默认 cmd 不支持该写法，使用 Git Bash 或 WSL 执行。

## 版本发布

维护流程见 [项目维护 → 版本发布](./contributing#版本发布)。自动化发布由 `.github/workflows/release.yml` 在 `v*.*.*` tag 或手动触发时执行。
