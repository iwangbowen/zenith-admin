# 部署说明

当前阶段优先完成**本地开发与预览验证**。本页先整理部署相关信息，方便后续接入正式发布流程。

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
- 如果部署到 GitHub Pages，后续需要根据仓库路径设置正确的 `base`

## 当前状态

GitHub Pages 的自动化部署流程**暂未接入**，等本地效果确认后再补充：

- 工作流配置
- Pages 构建与发布
- 仓库路径 `base` 调整
- 自定义域名（如需要）
