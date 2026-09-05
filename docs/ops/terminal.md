# 终端与文件

本页描述 Web 终端、SSH 配置、平台运维主机终端、终端会话监控、终端录屏、本机与远程文件管理。

---

## Web SSH 终端

Web 终端入口为「系统运维 → Web 终端」（`/system/terminal`），后端 WebSocket 挂载在：

- `GET /api/ws/terminal?shell=<shell>&cwd=<cwd>[&sessionId=<id>]`
- `GET /api/ws/terminal-monitor?sessionId=<id>&takeover=1`

access token 不放在 URL，而是经 `Sec-WebSocket-Protocol: zenith-auth, <accessToken>` 子协议头传递（与 `/api/ws` 一致，见 [WebSocket 事件清单](../backend/websocket-events#连接认证)）；鉴权复用管理端 HTTP 口径并检查吊销黑名单。

会话标识由服务端生成（UUIDv7），客户端不能自选：

- 不带 `sessionId` 连接表示新建会话，服务端通过 `terminal:session` 消息下发权威标识；
- 带 `sessionId` 连接表示重连，仅当该会话存在且归属本人时接入，否则以关闭码 `4004` 拒绝；
- 单用户活动会话数上限为 20，超限时以关闭码 `4008` 拒绝。

活动会话运行态由 `terminal-session-registry.ts` 维护为进程内注册表，元数据落库在 `terminal_sessions` 表。会话类型包括：

| 类型 | 说明 |
| --- | --- |
| `local` | 本机 PTY，shell 来源于 `/api/terminal-files/shells` 探测结果 |
| `ssh` | 使用 `ssh_profiles` 中的连接配置建立 SSH shell |
| `docker` | 通过 `docker exec -it` 进入容器内 `/bin/sh` |
| `ssh`（`host:<id>`） | 连接平台运维主机；额外要求 `system:host:use`，复用主机 TOFU 指纹校验 |

### 终端交互

- 前端使用 xterm.js、FitAddon、WebLinksAddon、SearchAddon。
- 输入通过 `terminal:input` 写入后端进程，输出通过 `terminal:output` 回写前端。
- 尺寸变化通过 `terminal:resize` 同步列数与行数。
- 客户端发送 `terminal:close` 时立即销毁会话。
- WebSocket 意外断开后，服务端保留进程 5 分钟；使用相同 `sessionId` 重连时回放输出缓冲区。
- 输出缓冲上限为 50 KB，用于断线重连和监控接入回放。

### 会话记录

`terminal_sessions` 表记录活动与历史会话：

| 字段 | 说明 |
| --- | --- |
| `id` | 服务端生成的 UUIDv7 会话标识 |
| `user_id` / `tenant_id` | 归属用户与租户，监控、接管、终止按此隔离 |
| `kind` / `target` / `label` | 会话类型、连接目标与展示标签 |
| `client_ip` | 发起连接的客户端 IP |
| `node_id` | 承载会话进程的服务实例（`hostname:port`） |
| `state` | `active` / `detached` / `terminated` / `failed` |
| `cols` / `rows` | 终端字符网格 |
| `started_at` / `last_activity_at` / `ended_at` | 开始、最近活跃与结束时间 |
| `end_reason` | `client_closed`、`process_exited`、`idle_timeout`、`terminated_by_admin`、`server_shutdown`、`start_failed` |

服务启动会结算本实例遗留的 `active` / `detached` 记录；运行期每 30 秒回写活跃时间与终端尺寸；优雅停机时结束全部会话并回收进程组。

### 多分屏与工作区

`TerminalPage` 使用 pane tree 管理布局，支持多 Tab、多分屏、本机 Shell、用户 SSH 配置、平台运维主机、Docker exec、断线重连与搜索。「选择 Shell 类型」菜单同时列出已启用的平台主机。平台主机会话以 `target=host:<id>` 留痕；主机连接配置或凭据变更时主动结束旧会话。

## SSH 配置档案

SSH 配置接口挂载在 `/api/ssh-profiles`，权限码为 `system:terminal:execute`。配置存储在 `ssh_profiles` 表，关键字段包括：

| 字段 | 说明 |
| --- | --- |
| `user_id` | 配置归属用户，列表与连接均按用户隔离 |
| `name` / `host` / `port` / `username` | 连接名称、主机、端口、用户名 |
| `auth_type` | `password` / `key_path` / `key_content` / `agent` |
| `password_encrypted` | 加密存储的 SSH 密码 |
| `key_path` | 服务端私钥路径，如 `~/.ssh/id_rsa` |
| `key_content_encrypted` | 加密存储的私钥内容 |
| `key_passphrase_encrypted` | 加密存储的私钥口令 |
| `env_vars` | 连接后写入 SSH shell 的环境变量 |
| `group_name` / `tags` / `order_num` | 分组、标签与排序 |

敏感字段由服务端加密存储，接口仅返回 `hasPassword`、`hasKeyContent`、`hasKeyPassphrase` 等布尔标识。

## 会话监控与接管

「终端会话」（`/system/terminal/sessions`）使用权限码 `system:terminal:monitor`。管理员可查看活动会话的用户、类型、标签 / 主机、客户端 IP、尺寸、开始时间、空闲时长、连接状态、旁观人数与接管状态。

监控端通过 `/api/ws/terminal-monitor` 附加为 observer，接入时回放输出缓冲；携带 `takeover=1` 时可向目标会话注入输入，注册表会将会话标记为接管中。强制终止通过 `POST /api/terminal-sessions/:sessionId/terminate` 执行。

## 终端录屏

终端录屏由运行时设置模块 `terminal`（通用设置页 `/system/settings?module=terminal`，见[运行时设置](../backend/settings.md)）控制：

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `recordingEnabled` | `false` | 是否启用 Web 终端录屏 |
| `recordingRetainDays` | `30` | 按保留天数自动清理，`0` 表示不按天数清理 |
| `recordingMaxSizeMb` | `500` | 录屏总容量上限，`0` 表示不限制容量 |
| `uploadMaxSizeMb` | `200` | 文件管理器 / SFTP 单文件上传上限，`0` 表示不限制 |

前端创建终端 session 时从登录用户设置投影 `GET /api/settings/me` 读取 `terminal.recordingEnabled`（租户套餐未含 `ops` 特性时该段缺省，视为关闭）。启用后，前端记录终端输入输出事件，并在 WebSocket 关闭时提交到 `POST /api/terminal-recordings`。

`terminal_recordings` 表存储录屏标题、操作人、租户、shell、终端尺寸、持续时长、事件数组与审计时间。事件数组元素为 `[timeOffset, 'o' | 'i', data]`。

「终端录屏」（`/system/terminal/recordings`）支持标题、操作人与时间范围查询，分页展示 Shell、尺寸、时长、命令数、操作人与录制时间；支持 xterm.js 本地回放、命令提取、复制全部命令、导出 asciinema `.cast`、删除单条录屏以及按 1 / 3 / 6 / 12 个月或全部范围批量清理。

定时任务 `cleanupTerminalRecordings` 每天凌晨 4 点执行，根据 `recordingRetainDays` 和 `recordingMaxSizeMb` 从旧到新清理录屏。

## SFTP 文件管理器

SFTP 功能复用 SSH 配置档案，接口前缀为 `/api/ssh-sftp/:profileId`，权限码为 `system:terminal:execute`。服务端通过 `ssh2-sftp-client` 建立远程连接，并按 `${userId}:${profileId}` 缓存连接；空闲 2 分钟后自动断开，同一连接上的操作通过队列串行执行。

远程 SFTP 支持：

- `GET /api/ssh-sftp/:profileId/home`：获取远程 home 目录；
- `GET /api/ssh-sftp/:profileId/list`：浏览目录；
- `GET` / `PUT /api/ssh-sftp/:profileId/content`：读取 / 保存文本文件；
- `POST /api/ssh-sftp/:profileId/create`：新建文件或目录；
- `POST /api/ssh-sftp/:profileId/rename`：重命名 / 移动；
- `DELETE /api/ssh-sftp/:profileId/entry`：删除文件或目录；
- `POST /api/ssh-sftp/:profileId/chmod`：修改权限；
- `GET /api/ssh-sftp/:profileId/download`、`POST /api/ssh-sftp/:profileId/upload`：下载 / 上传。

远程文本编辑有 5 MB 上限，并拒绝二进制文件。目录列表返回名称、路径、类型、大小、修改时间和权限字符串。

## 本机文件管理器

「文件管理器」（`/system/file-manager`）接口前缀为 `/api/terminal-files`，权限码为 `system:file:use`（Web 终端页的文件树 / shell 探测复用同组接口，持有 `system:terminal:execute` 亦可访问），面向服务器本机文件系统。

二期在同一页面加入 HostSelector。选择平台主机后改用 `/api/host-files/:hostId`：基于统一 SSH 连接池的 SFTP 通道提供浏览、文本读写（5 MB 上限与 ETag 冲突检测）、新建、重命名/移动、递归删除、chmod、上传和流式下载。远端模式不提供本机的压缩/解压、递归搜索、校验和与目录大小统计。

| 能力 | 接口 |
| --- | --- |
| 根信息与盘符 | `GET /api/terminal-files/root-info` |
| 目录浏览 | `GET /api/terminal-files/list` |
| 上传 / 下载 | `POST /api/terminal-files/upload`、`GET /api/terminal-files/download` |
| 文本读取 / 保存 | `GET` / `PUT /api/terminal-files/content` |
| 新建 / 重命名 / 删除 | `POST /create`、`POST /rename`、`DELETE /entry` |
| 移动 / 复制 | `POST /move`、`POST /copy` |
| ZIP 压缩 | `POST /compress`，提交异步任务 |
| 解压 | `POST /extract`，提交异步任务，支持 `zip`、`tar`、`tar.gz`、`tgz`、`tar.bz2`、`tar.xz`、单文件 `gz` |
| chmod | `POST /chmod` |
| 校验和 | `GET /checksum`，算法为 `md5` / `sha1` / `sha256` |
| 递归搜索 | `GET /search`，广度优先搜索文件名，最多返回 200 条，触顶返回 `truncated` |
| 目录大小 | `GET /dir-size`，递归统计目录占用，触顶返回 `truncated` |

本机文件编辑限制 5 MB，并拒绝二进制文件；删除操作禁止删除系统根目录和当前用户主目录本身。

### 文件写入与并发编辑

本机与 SFTP 文本保存共用 `lib/fs-text.ts` 的约束与写入策略：

- **原子写**：先写同目录临时文件、还原权限位，再 `rename` 覆盖；SFTP 侧优先使用 OpenSSH 的 `posix-rename` 扩展，不支持时回退为先删后改。
- **冲突检测**：读取接口返回 `etag`（mtime + 大小），保存时回传 `baseEtag`；服务端发现版本变化返回 409，前端提示重新加载。不传 `baseEtag` 表示强制覆盖。

### 上传大小上限

`terminal_upload_max_size_mb`（默认 200，0 表示不限制）同时约束文件管理器与 SFTP 上传。路由层按 `Content-Length` 预检，服务层以实际文件大小校验。上传体会读入内存，该配置也是内存占用封顶值。

### 长耗时操作

压缩与解压接入任务中心，任务类型为 `terminal-file-compress` / `terminal-file-extract`，支持进度、取消和追溯。目录统计与文件名搜索是同步接口，通过节点数与 10 秒时间预算约束，并以 `truncated` 标识结果不完整。
