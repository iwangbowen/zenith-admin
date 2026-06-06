# Electron 桌面客户端

Zenith Admin 支持打包为 Electron 桌面应用，适用于需要将系统以客户端形式分发给用户的场景（无需浏览器，直接安装运行）。

::: warning 架构说明
Electron 客户端仅包含**前端**（渲染层），**后端仍需独立部署**。客户端通过配置的 API 地址访问服务器，本质是将 Web 前端包装为原生桌面窗口。
:::

## 构建要求

| 依赖 | 版本 |
| --- | --- |
| Node.js | >= 22.12 |
| 已完成依赖安装 | `npm install` |

## 构建步骤

### 1. 配置 API 地址

Electron 模式下，前端通过 `VITE_API_BASE_URL` 指定后端地址。在 `packages/web/.env.production` 中添加（如未使用同域部署）：

```ini
VITE_API_BASE_URL=https://your-server.com
```

若前端和后端同域（如通过 Nginx 代理），无需设置。

### 2. 执行构建命令

```bash
# 构建 Windows 安装包（.exe）
npm run build:electron:win

# 构建 macOS 安装包（.dmg）
npm run build:electron:mac

# 构建 Linux 安装包（.AppImage）
npm run build:electron:linux
```

构建命令会自动：

1. 以 Electron 模式构建前端（注入 `VITE_ELECTRON=true`，启用 `HashRouter` 和相对路径资源）
2. 编译 Electron 主进程 TypeScript 代码
3. 通过 `electron-builder` 打包为平台安装包

### 3. 查找产物

构建完成后，安装包位于项目根目录的 `dist/electron/` 目录：

```
dist/electron/
├── Zenith Admin Setup x.y.z.exe        # Windows NSIS 安装包
├── Zenith Admin Setup x.y.z.exe.blockmap
└── win-unpacked/                         # 免安装版本（可直接运行）
    ├── @zenithelectron.exe
    └── resources/
        ├── app.asar                      # 主进程代码
        └── web/                          # 前端静态资源
```

## 开发调试

```bash
# 同时启动后端、前端 dev server 和 Electron 窗口
npm run dev:electron
```

Electron 开发模式会连接本地 `http://localhost:5373` 的 Vite dev server，支持热重载。

## 安全机制

| 配置 | 值 | 说明 |
| --- | --- | --- |
| `contextIsolation` | `true` | 渲染进程与 Node 环境隔离 |
| `nodeIntegration` | `false` | 渲染进程无法直接访问 Node.js API |
| `webSecurity` | `true` | 保持默认 Web 安全策略 |
| Preload 脚本 | 受限 API | 通过 `contextBridge` 仅暴露 `minimize/maximize/close` 窗口控制 |

## 升级版本

1. 重新执行对应平台的构建命令
2. 将新安装包分发给用户安装（覆盖安装即可）

::: tip 自动更新
当前版本暂不包含自动更新功能。如需实现，可接入 `electron-updater` 配合 GitHub Releases 实现 Delta 更新。
:::
