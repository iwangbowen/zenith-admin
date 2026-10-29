# 项目维护

本页面向维护者，记录文档站、Demo 站、CI 与 Release 的当前自动化方式。

## 文档站与 Demo 站

### 本地命令

```bash
npm run docs:dev       # VitePress dev，http://localhost:4177
npm run docs:build     # 构建 docs/.vitepress/dist
npm run docs:preview   # 预览构建产物，http://localhost:4178
npm run build:demo     # shared + web demo 构建，产物在 packages/web/dist
```

Demo 模式由 `packages/web/.env.demo` 的 `VITE_DEMO_MODE=true` 激活，详见 [Demo 演示模式](./demo-mode.md)。

### GitHub Pages

`.github/workflows/pages.yml` 负责文档站与 Demo 站：

| 项 | 当前配置 |
| --- | --- |
| 触发 | `master` push、PR、手动触发 |
| 路径过滤 | `docs/**`、`packages/web/**`、`packages/shared/**`、根 `package.json` / `package-lock.json`、工作流自身 |
| Node | 24 |
| 构建 | `npm run docs:build` + `npm run build:demo` |
| Demo 合并 | `cp -r packages/web/dist docs/.vitepress/dist/demo` |
| 发布 | 非 PR 时使用 GitHub Pages artifact 部署 |

访问地址：

- 文档站：`https://iwangbowen.github.io/zenith-admin/`
- Demo 站：`https://iwangbowen.github.io/zenith-admin/demo/`

首次启用 GitHub Pages 时，仓库 Settings → Pages 的 Source 选择 GitHub Actions。

### `base` 路径

VitePress 按环境切换：本地为 `/`，GitHub Pages 构建为 `/zenith-admin/`。Pages 工作流通过 `GITHUB_REPOSITORY` 提供上下文，无需手动修改配置。

### 文档写作约定

- 只描述当前实现状态，不写版本迁移故事。
- 命令、端口、环境变量与脚本以 `package.json`、`.env.example`、Docker / Workflow 文件为准。
- 产品能力以路由、菜单 seed、页面、服务和 mock 的当前代码为准。
- 开发规范正文只放在 `.agents/skills/zenith/references/`；文档站只做说明与链接。

## CI

`.github/workflows/ci.yml` 支持 `master` push、pull request、手动执行和每日 UTC 19:00 调度。

```bash
npm ci
npm run lint
npm run test:shared
npm run test:web
npm run build
```

Server 由独立的计划、分片与汇总门禁执行：PR 按 affected 文件图选择测试，`master` push、手动与定时运行使用全量。
计划阶段运行测试选择器守卫，最多三个分片执行精确文件清单；完整计划包含完整 App 契约与路由快照。
汇总门禁要求计划及所需分片全部成功。详见 [后端测试 · CI](../backend/testing.md#ci)。

CI 使用 Node 24 与 npm 12.2.0，通过 concurrency 取消同一 ref 的旧任务；构建后检查 bundle 预算，
Demo 构建与三入口启动冒烟独立执行。

## 版本发布

### 本地准备

发布前维护者通常需要：

1. 更新根目录与各 workspace 的版本号（root、server、web、shared、analytics-sdk、electron）。
2. 运行 `npm install --package-lock-only` 同步 lockfile。
3. 更新 `docs/changelog/index.md` 中对应版本段落。
4. 在本地按变更范围运行必要校验。
5. 提交到 `master` 后创建并推送 `vX.Y.Z` tag。

```bash
npm install --package-lock-only
npm run lint
npm test
npm run build
npm run docs:build
npm run build:demo

git add .
git commit -m "chore: release vX.Y.Z"
git push origin master

git tag vX.Y.Z
git push origin vX.Y.Z
```

### Release 工作流

`.github/workflows/release.yml` 的触发方式：

- 推送 `v*.*.*` tag
- `workflow_dispatch` 手动输入 tag

工作流行为：

1. Node 24 + `npm ci`。
2. `npm run build` 构建全部包。
3. 打包 `zenith-admin-server-${tag}.zip`：`packages/server/dist`、`packages/server/drizzle`、`packages/server/package.json`。
4. 打包 `zenith-admin-web-${tag}.zip`：`packages/web/dist`。
5. 从 `docs/changelog/index.md` 提取对应 tag 的 Release Notes。
6. 创建 GitHub Release 并上传两个 zip。

tag 包含 `-beta`、`-rc` 或 `-alpha` 时，Release 标记为 prerelease。

## Changelog 维护规范

`docs/changelog/index.md` 按版本倒序维护。Release 工作流通过标题 `## vX.Y.Z` 定位对应段落，因此 tag 之前需先提交 changelog。

推荐结构：

```markdown
## vX.Y.Z - YYYY-MM-DD

### Added
#### 功能分类
- 变更项

### Changed
- 变更项

### Fixed
- 修复项
```
