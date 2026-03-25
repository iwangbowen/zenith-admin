# 项目维护

本页面向项目维护者，说明文档站自动部署、版本发布以及 Demo 站的维护方式。

## 文档站与 Demo 站

### 构建方式

文档站基于 **VitePress** 构建，Demo 站将前端以 MSW Mock 模式打入文档站目录。

```bash
# 本地开发预览文档
npm run docs:dev

# 构建文档（生产）
npm run docs:build

# 构建 Demo 站
npm run build:demo

# 本地预览构建结果
npm run docs:preview
```

### GitHub Pages 自动部署

文档站与 Demo 站通过 `.github/workflows/pages.yml` 自动部署到 GitHub Pages。

**触发条件：**

- 推送到 `master` 分支
- PR 时仅构建校验，不发布
- 支持手动触发（`workflow_dispatch`）

**访问地址：**

- 文档站：`https://iwangbowen.github.io/zenith-admin/`
- Demo 站：`https://iwangbowen.github.io/zenith-admin/demo/`

### 首次启用 GitHub Pages

首次使用时，需要在 GitHub 仓库设置中完成以下配置：

1. 打开仓库 **Settings → Pages**
2. 将 **Build and deployment → Source** 设为 **GitHub Actions**
3. 确认默认分支是 `master`
4. 推送代码后到 **Actions** 页面确认 `Pages (Docs + Demo)` 工作流执行成功

### `base` 路径策略

VitePress 配置已按环境自动切换 `base` 路径：

- 本地开发：`/`
- GitHub Pages 构建：`/zenith-admin/`

无需手动修改，CI 通过环境变量 `GITHUB_REPOSITORY` 自动确定。

---

## 版本发布

### 发布流程

Zenith Admin 采用 **tag 触发 Release** 的自动化发布流程：

1. 更新四个 `package.json` 中的版本号（根 / server / web / shared）
2. 在 `docs/changelog/index.md` 顶部追加当前版本的变更记录
3. 提交并推送到 `master`
4. 本地打 tag 并推送，触发 Release 工作流

```bash
git add .
git commit -m "chore: release vX.Y.Z"
git push origin master

git tag vX.Y.Z
git push origin vX.Y.Z
```

### Release 工作流（`release.yml`）

推送 `v*.*.*` 格式的 tag 后，`.github/workflows/release.yml` 自动完成：

1. 构建全部产物（shared → server → web）
2. 打包发布产物：
   - `zenith-admin-server-vX.Y.Z.zip`（后端 `dist/` + `drizzle/` + `package.json`）
   - `zenith-admin-web-vX.Y.Z.zip`（前端静态文件）
3. 从 `docs/changelog/index.md` 提取对应版本的 Release Notes
4. 在 GitHub Releases 页面创建 Release，并上传两个产物

> tag 含 `-beta`、`-rc`、`-alpha` 时，Release 自动标记为 Pre-release。

### 手动重新触发 Release

如果 Release 工作流执行失败，可以通过以下方式重新触发：

**方式一：在 GitHub Actions 页面重跑**

打开 [Actions](https://github.com/iwangbowen/zenith-admin/actions/workflows/release.yml) → 点击失败的 Run → **Re-run all jobs**

**方式二：workflow_dispatch 手动指定 tag**

在 [release.yml 工作流页面](https://github.com/iwangbowen/zenith-admin/actions/workflows/release.yml) 点击 **Run workflow**，在 `tag` 输入框填入目标 tag（如 `v0.1.0`）后触发。

---

## Changelog 维护规范

所有版本记录统一维护在 `docs/changelog/index.md`，按版本倒序。

每个版本遵循以下结构：

```markdown
## vX.Y.Z - YYYY-MM-DD

### Added
#### 功能分类
- 具体变更

### Changed
- 变更内容

### Fixed
- 修复内容
```

Release 工作流会自动提取对应版本段落作为 GitHub Release 描述，因此 **Changelog 需要在打 tag 之前** 写好并推送。
