# 应用版本与在线升级

应用版本管理用于统一发布桌面端、移动端与 Web 热更新制品。管理侧位于「系统设置 → 应用版本」（`/system/app-releases`），接口前缀为 `/api/app-releases`；公开升级接口前缀为 `/api/public/app-releases`，免登录访问。

---

## 模型分层

应用升级采用三层模型：

```text
client_apps（应用）
  └─ app_releases（版本，按应用 + 渠道 + 版本号唯一）
       └─ app_artifacts（制品，按版本 + 文件名唯一）
app_release_events（检查 / 下载 / 安装回执流水）
```

| 表 | 作用 |
| --- | --- |
| `client_apps` | 客户端侧应用标识、名称、描述与启停状态；公开 API 通过 `app_key` 定位应用 |
| `app_releases` | 渠道、semver 版本号、更新说明、发布状态、强制更新、最低版本、灰度比例与发布时间 |
| `app_artifacts` | 平台、CPU 架构、制品类型、托管文件、外链、文件名、大小、SHA256 与下载次数 |
| `app_release_events` | `check`、`download`、`install_success`、`install_fail` 追加型事件，用于升级看板统计 |

种子数据 `SEED_CLIENT_APPS` 预置 `zenith-desktop` 与 `zenith-mobile` 两个应用；版本与制品由管理员发布产生。Demo 模式通过 `SEED_APP_RELEASES` 与 `SEED_APP_ARTIFACTS` 派生示例数据。

## 枚举与约束

| 维度 | 取值 |
| --- | --- |
| 发布渠道 | `stable`（正式版）、`beta`（测试版）、`internal`（内部版） |
| 发布状态 | `draft`（草稿）、`published`（已发布）、`revoked`（已撤回） |
| 平台 | `windows`、`macos`、`linux`、`android`、`ios`、`web` |
| 架构 | `x64`、`arm64`、`universal` |
| 制品类型 | `installer`（安装包）、`hotupdate`（热更新包）、`metadata`（latest.yml / blockmap）、`external`（外部链接） |
| 事件类型 | `check`、`download`、`install_success`、`install_fail` |

版本号必须符合 semver（允许预发布与构建元数据后缀，如 `1.2.3-beta.1`）。`app_key` 只允许小写字母、数字和连字符，创建后不可修改。`app_releases` 对 `(app_id, channel, version)` 加唯一约束，`app_artifacts` 对 `(release_id, file_name)` 加唯一约束。

## 管理侧能力

「应用版本」页包含两个 Tab：

| Tab | 能力 |
| --- | --- |
| 版本管理 | 应用管理、版本列表、版本创建 / 编辑 / 删除、发布 / 撤回、灰度比例调整、制品上传、外链制品、复制公开下载链接 |
| 统计图表 | 检查、下载、安装成功、安装失败总量，按日趋势、平台分布、近 30 天活跃设备版本分布 |

权限码：

| 权限码 | 说明 |
| --- | --- |
| `system:app-release:list` | 查看应用、版本、制品与升级看板 |
| `system:app-release:create` | 创建应用、创建版本、上传文件制品、添加外链制品 |
| `system:app-release:update` | 更新应用、更新版本、调整灰度比例 |
| `system:app-release:delete` | 删除应用、删除版本、删除制品 |
| `system:app-release:publish` | 发布版本、撤回版本 |

## 发布状态机

版本以 `draft` 创建，发布后进入 `published`，撤回后进入 `revoked`。`revoked` 可重新发布；重新发布会刷新 `published_at`，公开侧按最新发布时间选择“最新版本”。

状态规则：

- 发布前必须至少存在一个制品，否则 `POST /api/app-releases/releases/{id}/publish` 返回 400。
- 已发布版本不可删除，需先撤回。
- 版本号和渠道属于发布事实，只有草稿可修改；发布后只允许调整更新说明和升级策略。
- 应用下存在版本记录时不可删除应用。
- 公开 API 只读取 `status = published` 且应用 `status = enabled` 的数据。

## 制品上传与分发

文件制品通过 `POST /api/app-releases/releases/{id}/artifacts` 上传，multipart 字段为 `file`、`platform`、`arch`、`kind`。`kind` 仅允许 `installer`、`hotupdate`、`metadata`。服务端读取文件内容计算 SHA256，使用生成文件通道保存到统一文件存储，并在 `app_artifacts.sha256` 落库。

超过分片阈值（运行时设置 `files.chunkThresholdMb`，默认 5MB）的制品由前端自动改走分片上传：`POST /{id}/artifacts/upload/init`（带 `platform` / `arch` / `kind`）→ `POST /{id}/artifacts/upload/chunk` → `POST /{id}/artifacts/upload/complete`，
另有 `GET /{id}/artifacts/upload/{uploadId}/status` 与 `DELETE /{id}/artifacts/upload/{uploadId}`。分片路径同样由服务端在合并后计算 SHA256，
init 阶段即校验同名制品，支持断点续传与取消，不再受反向代理单请求体上限约束；机制细节见[存储：归属模块接入分片上传](../storage/index.md#归属模块接入分片上传)。

外链制品通过 `POST /api/app-releases/releases/{id}/artifacts/external` 创建，适用于 App Store、TestFlight 等外部分发场景，`kind` 固定为 `external`，`size` 为 0，下载时返回外部链接或 302 跳转。

公开制品下载地址格式：

```text
/api/public/app-releases/{app}/{channel}/{platform}/{filename}
```

该格式兼容 electron-updater generic provider：客户端可把 feed 基地址配置到 `{origin}/api/public/app-releases/{app}/{channel}/{platform}`，然后按 `latest.yml`、安装包和 `.blockmap` 文件名请求。托管文件支持 Range：本地与 S3 存储返回 `Accept-Ranges: bytes`，合法 Range 返回 206，非法 Range 返回 416。`metadata` 制品使用 `Cache-Control: no-store`，二进制制品使用 `public, max-age=3600`。

## 升级选择策略

`GET /api/public/app-releases/check` 根据 `app`、`channel`、`platform`、`arch`、`version` 和 `deviceId` 选择目标版本：

1. 只考虑应用启用、状态已发布、渠道匹配且版本号高于客户端当前版本的版本。
2. 制品选择优先级为 `hotupdate` → `installer` → `external`，`metadata` 不参与 check 响应。
3. 架构选择优先匹配请求 `arch`，同时允许 `universal`；未传 `arch` 时不按架构过滤。
4. 灰度比例小于 100 时使用 `sha256(releaseId:deviceId)` 落桶，同一设备对同一版本命中结果稳定。
5. 未携带 `deviceId` 的请求对灰度版本不可见。
6. `mandatory = true` 或当前版本低于 `minVersion` 时，响应中的 `mandatory` 为 `true`。

`deviceId` 可来自 query 参数，也可来自 `x-device-id` 请求头；electron-updater 可通过 requestHeaders 传入。

## 公开 API

| 方法与路径 | 说明 |
| --- | --- |
| `GET /api/public/app-releases/check` | 检查更新，查询参数为 `app`、`platform`、`arch`、`channel`、`version`、`deviceId` |
| `GET /api/public/app-releases/latest` | 查询最新已发布版本，查询参数为 `app`、`channel`、可选 `platform` |
| `GET /api/public/app-releases/{app}/{channel}/{platform}/{filename}` | 按文件名分发制品，支持 latest.yml、blockmap、安装包、热更新包和外链跳转 |
| `POST /api/public/app-releases/events` | 安装回执上报，仅接受 `install_success` / `install_fail` |

### check 响应

无可见更新时返回：

```json
{ "hasUpdate": false }
```

有更新时返回强制策略、版本信息和制品下载地址：

```json
{
  "hasUpdate": true,
  "mandatory": false,
  "version": "1.90.0",
  "notes": "...",
  "publishedAt": "2026-08-26 10:00:00",
  "artifact": {
    "kind": "hotupdate",
    "fileName": "web-1.90.0.zip",
    "size": 18874368,
    "sha256": "...",
    "downloadUrl": "/api/public/app-releases/zenith-desktop/stable/windows/web-1.90.0.zip"
  }
}
```

### latest 响应

`latest` 面向官网或下载页，返回最新已发布版本及非 `metadata` 制品列表。指定 `platform` 时只返回该平台制品；未指定时返回该版本全部非 `metadata` 制品。

### 安装回执

`POST /api/public/app-releases/events` 写入 `app_release_events`。客户端只能上报 `install_success` 或 `install_fail`；`check` 由 `check` 接口自动记录，`download` 由制品下载路由在整文件或首个 Range 分片时自动记录。

## 升级看板

`GET /api/app-releases/stats?appId=<id>&days=<1-90>` 统计指定应用在时间范围内的升级事件：

| 字段 | 说明 |
| --- | --- |
| `totals.checks` | 检查更新次数 |
| `totals.downloads` | 下载次数 |
| `totals.devices` | 去重设备数 |
| `totals.installSuccess` / `totals.installFail` | 安装成功 / 失败次数 |
| `trend` | 按日聚合的检查、下载、安装成功、安装失败趋势 |
| `platforms` | 按平台聚合的事件数量 |
| `versions` | 近 30 天活跃设备的客户端版本分布（按 check 事件设备去重） |

`app_release_events` 由数据保留策略统一清理，默认保留 180 天。

## 管理侧 API

| 方法与路径 | 说明 |
| --- | --- |
| `GET /api/app-releases/apps` | 应用分页列表，支持 `keyword`、`status` |
| `GET /api/app-releases/apps/all` | 全部启用应用，用于应用切换器 |
| `POST /api/app-releases/apps` | 创建应用 |
| `PUT /api/app-releases/apps/{id}` | 更新应用（不允许修改 `appKey`） |
| `DELETE /api/app-releases/apps/{id}` | 删除应用 |
| `GET /api/app-releases/releases` | 版本分页列表，支持 `appId`、`channel`、`status`、`keyword` |
| `GET /api/app-releases/releases/{id}` | 版本详情，包含制品列表 |
| `POST /api/app-releases/releases` | 创建草稿版本 |
| `PUT /api/app-releases/releases/{id}` | 更新版本 |
| `DELETE /api/app-releases/releases/{id}` | 删除草稿或已撤回版本 |
| `POST /api/app-releases/releases/{id}/publish` | 发布版本 |
| `POST /api/app-releases/releases/{id}/revoke` | 撤回版本 |
| `PUT /api/app-releases/releases/{id}/rollout` | 调整灰度比例 |
| `POST /api/app-releases/releases/{id}/artifacts` | 上传文件制品并自动计算 SHA256 |
| `POST /api/app-releases/releases/{id}/artifacts/external` | 添加外链制品 |
| `DELETE /api/app-releases/artifacts/{id}` | 删除制品，托管文件尽力清理 |
| `GET /api/app-releases/stats` | 升级看板统计 |

