# 同域子路径部署与浏览器存储隔离

多个派生项目如果部署在同一个 Origin 的不同子路径下，例如：

```text
https://example.com/project-a/
https://example.com/project-b/
```

浏览器不会按子路径隔离 `localStorage`、`sessionStorage`、IndexedDB、Cache Storage 或 Service Worker。两套前端如果使用相同 key，可能互相覆盖登录态、偏好、草稿、上传断点和埋点离线队列。

## 部署标识

每个派生项目必须在构建时设置唯一的 `VITE_DEPLOYMENT_ID`：

```ini
VITE_BASE_URL=/project-a/
VITE_DEPLOYMENT_ID=project-a
```

另一个项目使用不同值：

```ini
VITE_BASE_URL=/project-b/
VITE_DEPLOYMENT_ID=project-b
```

`VITE_BASE_URL` 只负责资源路径、路由 basename 和 PWA scope；`VITE_DEPLOYMENT_ID` 负责浏览器运行时隔离。不要用标题、版本号、租户名称或可变 URL 代替部署标识。

标识必须匹配：

```text
^[a-z][a-z0-9_-]*$
```

同一派生项目的 admin、member、approval 入口共用同一个 deployment ID；入口类型仍由各自的 admin / member scope 或 analytics `appId` 区分。

## 隔离范围

前端入口启动时会安装 deployment-scoped Storage facade。所有直接使用 `localStorage` / `sessionStorage` 的一方存储都会映射到当前项目的 namespace，且 `clear()` 只清理当前项目，不会删除其他子路径项目的数据。

必须保持隔离的状态包括：

- admin、approval、member 的 access token / refresh token；
- 停靠账号、模拟登录、账号切换广播、锁屏状态和认证失效原因；
- 偏好、主题、标签页、表格列宽、面板布局和列表筛选记忆；
- 聊天 / 工作流草稿、表单模板、站点 / 公众号 / 主机选择；
- 分片上传断点、OAuth 往返状态和审批最近使用记录；
- analytics anonymous ID、session、采样、实验分流、会话回放和离线队列；
- Service Worker、Workbox precache 和 runtime cache。

业务代码不得调用 `localStorage.clear()` 清理全 Origin；只能调用当前 namespace 的 storage facade，或删除当前项目的明确 key。

## analytics SDK

Web 适配层必须向 SDK 注入同一个 deployment ID。SDK 的 session、实验、回放和离线队列 key 使用：

```text
zenith:{deploymentId}:analytics:{key}:{appId}
```

`appId=admin/member` 仍表示入口类型，不能用来替代 deployment ID。

## PWA / Service Worker

开启 PWA 时：

- manifest 的 `start_url` / `scope` 必须落在 `VITE_BASE_URL` 下；
- Service Worker 不得注册到根路径；
- Workbox `cacheId` 必须使用 deployment ID；
- API 保持 Network Only，不把项目数据写入共享 runtime cache；
- 发布升级时只能清理当前 deployment 的 cache。

## 发布前检查

1. 在同一浏览器同时打开两个派生项目；
2. 分别登录不同账号，确认刷新、登出、账号切换互不影响；
3. 分别修改主题、标签页、表格布局、草稿和上传断点；
4. 检查埋点 session、离线队列和实验分流不互相读取；
5. 在 DevTools 的 Application 面板确认 Service Worker scope 和 Cache Storage 名称；
6. 更新一个项目的静态资源，确认另一个项目不会被刷新或清理缓存。

本项目不提供旧无 namespace key 的兼容迁移；切换到该机制后，旧 key 不再被读取。
