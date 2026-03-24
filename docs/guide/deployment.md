# 部署说明

本页整理 Zenith Admin 的构建与部署信息，重点包括业务项目的构建方式，以及文档站通过 GitHub Pages 自动发布的方案。

## 应用构建

在仓库根目录执行：

```bash
npm run build
```

构建顺序：

1. `@zenith/shared`
2. `@zenith/server`
3. `@zenith/web`

构建产物：

- 后端：`packages/server/dist/`
- 前端：`packages/web/dist/`

## 文档站构建

```bash
npm run docs:build
```

构建产物位于：`docs/.vitepress/dist/`

本地预览：

```bash
npm run docs:preview
```

## 文档站自动部署（GitHub Pages）

文档站已经按 **GitHub Pages 官方 Actions 方案**接入自动部署。

### 工作流文件

仓库中会新增：

- `.github/workflows/docs-pages.yml`

### 触发方式

- 推送到 `master` 时：构建并发布文档站
- Pull Request 时：只做构建校验，不执行发布
- 支持手动触发工作流

### 访问地址

当前仓库为 `iwangbowen/zenith-admin`，如果启用 GitHub Pages，默认访问地址会是：

`https://iwangbowen.github.io/zenith-admin/`

### `base` 路径策略

文档站配置已经按环境自动切换：

- 本地开发：`/`
- GitHub Pages 构建：`/zenith-admin/`

这样本地调试和线上发布都能正常工作，不需要手动来回改配置。

## 生产部署建议

### 后端

- 使用 Node.js 运行构建后的 `packages/server/dist/`
- 生产环境应收紧 CORS 配置
- 生产数据库应通过环境变量提供 `DATABASE_URL`

### 前端

- 可部署到任意静态托管平台
- 需要正确配置 `VITE_API_BASE_URL`

### 文档站

- 适合部署到 GitHub Pages、Vercel、Netlify 等静态平台
- 当前已接入 GitHub Pages 自动化部署
- 如果仓库名发生变化，需要同步确认线上 `base` 路径是否仍然正确

## 你需要手动做的事

代码侧的配置我可以补齐，但 GitHub 仓库设置里还有几步需要你自己在网页上完成：

1. 打开仓库 **Settings → Pages**
2. 在 **Build and deployment** 中将 Source 设为 **GitHub Actions**
3. 确认默认分支是 `master`
4. 推送当前改动到 GitHub
5. 到 **Actions** 页面确认 `Docs Pages` 工作流执行成功

## 发布后建议检查

工作流首次成功后，建议你实际检查这些页面：

- 首页：`/zenith-admin/`
- 快速开始：`/zenith-admin/guide/getting-started`
- 产品概览：`/zenith-admin/product/overview`
- Changelog：`/zenith-admin/changelog/`

重点确认：

- 页面样式是否正常
- favicon 是否正常
- 暗色模式切换是否正常
- 内页刷新是否正常
- 静态资源是否没有 404

## 后续可选项

- 如果后续接自定义域名，`base` 策略可能需要调整
- 如果想让 PR 先做更严格校验，可以再单独拆分一个 docs check workflow
