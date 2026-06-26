# 系统运维

Zenith Admin 提供一站式服务器运维能力，无需额外运维工具即可在页面内管理工作机。运维区覆盖 Web SSH 终端、终端录屏、文件管理、进程与端口、Docker、网络诊断、systemd 服务和日志查看等场景，统一接入后台登录态、权限码与审计能力。

---

## 能力总览

| 模块 | 能力 |
|------|------|
| Web 终端 | 基于 WebSocket + xterm.js 的本机 / SSH / Docker exec 终端，支持多 Tab、多分屏、尺寸同步、断线重连、输出缓冲回放 |
| SSH 配置 | 按用户隔离 SSH 配置档案，支持密码、服务端私钥路径、私钥内容、ssh-agent、环境变量、分组和标签 |
| 终端会话 | 活动终端会话监控，支持按关键字与类型筛选、旁观、接管输入、强制终止 |
| 终端录屏 | 终端输入输出事件录制、列表查询、回放、命令提取、删除和按系统配置自动清理 |
| SFTP / 文件管理 | 远程 SFTP 文件浏览与传输；本机文件管理器支持上传 / 下载、新建、编辑、移动、复制、删除、chmod、ZIP 压缩、解压、搜索和校验和 |
| 进程管理 | 进程列表实时推送、资源占用、详情、网络连接、结束进程、优先级调整 |
| 端口监听 | 监听端口列表、协议筛选、常见端口服务名识别、进程关联、自动刷新、结束占用进程 |
| Docker 管理 | 容器、镜像、网络、卷管理，支持启停、重启、删除、拉取、创建、实时日志、资源占用、inspect 与 prune 清理 |
| 网络诊断 | ping、traceroute、nslookup、DNS 记录、反向 DNS、HTTP(S) 探测、TCP 端口检测、本机网卡信息 |
| systemd 服务 | systemd 可用性检查、服务列表、启停、重启、reload、enable / disable、mask / unmask、详情与 journalctl 日志 |
| 日志查看 | 指定路径 tail -f、ANSI 渲染、级别高亮、关键词过滤、下载；服务端日志文件列表、查看、实时追踪、下载、删除 |

---

## Web SSH 终端

Web 终端入口为「系统运维 → Web 终端」（`/system/terminal`），后端 WebSocket 挂载在：

- `GET /api/ws/terminal?token=<accessToken>&shell=<shell>&cwd=<cwd>&sessionId=<id>`
- `GET /api/ws/terminal-monitor?token=<accessToken>&sessionId=<id>&takeover=1`

终端会话由 `terminal-session-registry.ts` 维护为进程内注册表，类型包括：

| 类型 | 说明 |
|------|------|
| `local` | 本机 PTY，shell 来源于 `/api/terminal-files/shells` 探测结果 |
| `ssh` | 使用 `ssh_profiles` 中的连接配置建立 SSH shell |
| `docker` | 通过 `docker exec -it` 进入容器内 `/bin/sh` |

### 终端交互

- 前端使用 xterm.js、FitAddon、WebLinksAddon、SearchAddon。
- 终端输入通过 `terminal:input` 消息写入后端进程，输出通过 `terminal:output` 回写前端。
- 窗口尺寸变化通过 `terminal:resize` 同步列数与行数。
- 客户端发送 `terminal:close` 时立即销毁会话。
- WebSocket 意外断开后，服务端保留 PTY 进程 5 分钟，使用相同 `sessionId` 重连时回放输出缓冲。
- 输出缓冲上限为 50 KB，用于断线重连和监控接入时回放。

### 多分屏与工作区

前端 `TerminalPage` 使用 pane tree 管理布局，支持：

- 多 Tab 会话；
- 水平 / 垂直分屏；
- 分屏尺寸调整；
- 面板关闭与焦点切换；
- 本机文件树、SSH 配置、SFTP 浏览、Docker 容器浏览侧栏；
- 终端内 Ctrl / Command + F 搜索，支持大小写切换、上一条 / 下一条。

### SSH 配置档案

SSH 配置接口挂载在 `/api/ssh-profiles`，权限码为 `system:terminal:execute`。配置存储在 `ssh_profiles` 表，关键字段包括：

| 字段 | 说明 |
|------|------|
| `user_id` | 配置归属用户，列表与连接均按用户隔离 |
| `name` / `host` / `port` / `username` | 连接名称、主机、端口、用户名 |
| `auth_type` | `password` / `key_path` / `key_content` / `agent` |
| `password_encrypted` | 加密存储的 SSH 密码 |
| `key_path` | 服务端私钥路径，如 `~/.ssh/id_rsa` |
| `key_content_encrypted` | 加密存储的私钥内容 |
| `key_passphrase_encrypted` | 加密存储的私钥口令 |
| `env_vars` | 连接后写入 SSH shell 的环境变量 |
| `group_name` / `tags` / `order_num` | 分组、标签与排序 |

SSH 敏感字段由服务端加密存储，接口返回 `hasPassword`、`hasKeyContent`、`hasKeyPassphrase` 等布尔标识，不返回明文。

### 会话监控与接管

「终端会话」（`/system/terminal/sessions`）使用权限码 `system:terminal:monitor`。管理员可查看活动会话的用户、类型、标签 / 主机、客户端 IP、尺寸、开始时间、空闲时长、连接状态、旁观人数与接管状态。

监控端通过 `/api/ws/terminal-monitor` 附加为 observer，接入时回放输出缓冲；携带 `takeover=1` 时可向目标会话注入输入，注册表会将会话标记为接管中。强制终止通过 `POST /api/terminal-sessions/:sessionId/terminate` 执行。

---

## 终端录屏

终端录屏由系统配置控制：

| 配置 Key | 默认值 | 说明 |
|----------|--------|------|
| `terminal_recording_enabled` | `false` | 是否启用 Web 终端录屏 |
| `terminal_recording_retain_days` | `30` | 按保留天数自动清理，`0` 表示不按天数清理 |
| `terminal_recording_max_size_mb` | `500` | 录屏总容量上限，`0` 表示不限制容量 |

前端创建终端 session 时读取 `GET /api/system-configs/public/terminal_recording_enabled`。启用后，前端记录终端输入输出事件，并在 WebSocket 关闭时提交到 `POST /api/terminal-recordings`。

录屏数据存储在 `terminal_recordings` 表：

| 字段 | 说明 |
|------|------|
| `title` | 录屏标题 |
| `user_id` / `tenant_id` | 操作人和租户 |
| `shell` | 终端类型或 shell 标识 |
| `cols` / `rows` | 录制时终端尺寸 |
| `duration` | 录制时长，单位秒 |
| `events` | JSONB 事件数组，元素为 `[timeOffset, 'o' \| 'i', data]` |
| `created_at` / `updated_at` | 创建与更新时间 |

「终端录屏」（`/system/terminal/recordings`）支持：

- 按标题关键字查询；
- 分页展示 Shell、终端尺寸、时长、命令数、操作人、录制时间；
- xterm.js 本地回放录屏事件；
- 提取输入事件中的命令并支持复制全部命令；
- 删除单条录屏；
- 按 1 / 3 / 6 / 12 个月或全部范围批量清理。

定时任务 `cleanupTerminalRecordings` 每天凌晨 4 点执行，根据 `terminal_recording_retain_days` 和 `terminal_recording_max_size_mb` 从旧到新清理录屏。

---

## SFTP 文件管理器

SFTP 功能复用 SSH 配置档案，接口前缀为 `/api/ssh-sftp/:profileId`，权限码为 `system:terminal:execute`。服务端通过 `ssh2-sftp-client` 建立远程连接，并按 `${userId}:${profileId}` 缓存连接；空闲 2 分钟后自动断开，同一连接上的操作通过队列串行执行。

远程 SFTP 支持：

- 获取远程 home 目录：`GET /api/ssh-sftp/:profileId/home`
- 浏览目录：`GET /api/ssh-sftp/:profileId/list`
- 读取 / 保存文本文件：`GET` / `PUT /api/ssh-sftp/:profileId/content`
- 新建文件或目录：`POST /api/ssh-sftp/:profileId/create`
- 重命名 / 移动：`POST /api/ssh-sftp/:profileId/rename`
- 删除文件或目录：`DELETE /api/ssh-sftp/:profileId/entry`
- chmod 修改权限：`POST /api/ssh-sftp/:profileId/chmod`
- 下载 / 上传：`GET /api/ssh-sftp/:profileId/download`、`POST /api/ssh-sftp/:profileId/upload`

远程文本编辑有 5 MB 上限，并会拒绝二进制文件。目录列表返回名称、路径、类型、大小、修改时间和权限字符串。

同一运维区还提供本机「文件管理器」（`/system/file-manager`），接口前缀为 `/api/terminal-files`，同样使用 `system:terminal:execute` 权限。它面向服务器本机文件系统，能力包括：

| 能力 | 接口 |
|------|------|
| 根信息与盘符 | `GET /api/terminal-files/root-info` |
| 目录浏览 | `GET /api/terminal-files/list` |
| 上传 / 下载 | `POST /api/terminal-files/upload`、`GET /api/terminal-files/download` |
| 文本读取 / 保存 | `GET` / `PUT /api/terminal-files/content` |
| 新建 / 重命名 / 删除 | `POST /create`、`POST /rename`、`DELETE /entry` |
| 移动 / 复制 | `POST /move`、`POST /copy` |
| ZIP 压缩 | `POST /compress` |
| 解压 | `POST /extract`，支持 `zip`、`tar`、`tar.gz`、`tgz`、`tar.bz2`、`tar.xz`、单文件 `gz` |
| chmod | `POST /chmod` |
| 校验和 | `GET /checksum`，算法为 `md5` / `sha1` / `sha256` |
| 递归搜索 | `GET /search`，广度优先搜索文件名，最多返回 200 条 |

本机文件编辑同样限制 5 MB，并拒绝二进制文件；删除操作禁止删除系统根目录和当前用户主目录本身。

---

## 进程管理

「进程管理」（`/system/processes`）使用权限码：

| 权限码 | 说明 |
|--------|------|
| `system:process:view` | 查看进程列表、详情和导出 |
| `system:process:kill` | 结束进程 |
| `system:process:priority` | 调整进程优先级 |

后端 `/api/processes` 根据运行平台采集进程：

- Linux / macOS 使用 `ps`，Linux 详情补充 `/proc/:pid/environ` 与 `/proc/:pid/cwd`；
- Windows 使用 PowerShell `Get-Process` 和 `Win32_Process`；
- 监听端口按 PID 缓存 15 秒并合并到进程列表；
- 进程详情包含 PID、父 PID、用户、状态、CPU、内存、线程数、nice / priorityClass、启动时间、命令行、端口、网络连接、工作目录与环境变量。

实时列表通过 `GET /api/processes/stream` 以 SSE 推送，首帧返回完整列表，之后每 3 秒刷新一次，并每 30 秒发送心跳。页面支持关键字与状态筛选、详情弹窗、结束进程和优先级调整。

结束进程时：

- Windows 使用 `Stop-Process -Id <pid> -Force`；
- Linux / macOS 支持 `SIGTERM`、`SIGKILL`、`SIGINT`、`SIGHUP`；
- Linux / macOS 优先级调整使用 `renice`，Windows 使用 `PriorityClass`。

---

## 端口监听

「端口监听」（`/system/ports`）调用 `/api/ports` 获取监听端口列表，查看权限复用 `system:process:view`，结束占用进程使用 `system:process:kill`。

端口采集方式：

- Linux / macOS 优先使用 `ss -tlnp`，回退到 `netstat -tlnp`；
- Windows 使用 `netstat -ano`；
- 返回协议、本地地址、本地端口、状态、PID、进程名和服务名。

服务名由内置常见端口映射识别，例如 `22 → SSH`、`80 → HTTP`、`443 → HTTPS`、`5432 → PostgreSQL`、`6379 → Redis`、`5173 → Vite`、`3300 → Zenith-API`。

前端支持：

- 按 TCP / UDP 协议筛选；
- 按端口、进程、服务、地址关键字过滤；
- 手动刷新或 5 / 10 / 30 秒自动刷新；
- 对存在 PID 的监听项执行「结束进程」。

---

## Docker 管理

「Docker」（`/system/docker`）接口前缀为 `/api/docker`，主要复用 `system:process:view` 权限，并在启停、删除、创建、拉取、清理等操作中写入审计日志。服务端通过 Dockerode 连接 Docker Engine。

### 容器

容器能力包括：

- `GET /api/docker`：容器列表，包含 ID、名称、镜像、命令、创建时间、状态、端口、Compose 项目信息；
- `POST /api/docker/:id/start`、`/stop`、`/restart`：启动、停止、重启；
- `GET /api/docker/:id/logs?tail=500`：读取容器日志；
- `GET /api/docker/:id/stats`：读取 CPU 与内存占用；
- `GET /api/docker/:id/inspect`：返回 `docker inspect` 详情；
- `GET /api/docker/:id/files`、`GET /api/docker/:id/files/content`：浏览与读取容器内文件；
- Web 终端可通过 `docker-exec:<containerId>` 进入容器 shell。

### 镜像、网络、卷

| 对象 | 能力 |
|------|------|
| 镜像 | 列表、删除、按 `repoTag` 拉取 |
| 网络 | 列表、创建、删除 |
| 卷 | 列表、创建、删除 |

### 清理

Docker 清理接口包括：

- `POST /api/docker/prune/containers`：清理已停止容器；
- `POST /api/docker/prune/images`：清理悬空镜像；
- `POST /api/docker/prune/images?all=true`：清理所有未被容器使用的镜像；
- `POST /api/docker/prune/networks`：清理未使用网络；
- `POST /api/docker/prune/volumes`：清理未使用存储卷；
- `POST /api/docker/prune/system`：系统清理，包含已停止容器、悬空镜像和未使用网络。

---

## 网络诊断

「网络诊断」（`/system/network-diag`）接口前缀为 `/api/network-diag`，所有接口需要登录态。

| 能力 | 接口 | 实现 |
|------|------|------|
| ping | `GET /api/network-diag/stream?type=ping&host=...` | Windows 使用 `ping -n 4`，其他平台使用 `ping -c 4 -W 3` |
| traceroute | `GET /api/network-diag/stream?type=traceroute&host=...` | Windows 使用 `tracert -h 30`，其他平台使用 `traceroute -m 30 -w 3` |
| nslookup | `GET /api/network-diag/nslookup?host=...` | 执行 `nslookup` 并返回文本输出 |
| DNS 记录 | `GET /api/network-diag/dns?host=...&type=A` | 支持 `A` / `AAAA` / `MX` / `TXT` / `NS` / `CNAME` / `SOA` |
| 反向 DNS | `GET /api/network-diag/reverse?ip=...` | 使用 PTR 反查主机名 |
| HTTP(S) 探测 | `POST /api/network-diag/http-probe` | 返回状态码、耗时、Server、Content-Type、Content-Length、Location 和错误信息 |
| TCP 端口检测 | `POST /api/network-diag/port-check` | 5 秒超时，返回是否连通与延迟 |
| 本机网卡 | `GET /api/network-diag/interfaces` | 返回网卡名、地址、掩码、IP 版本、MAC、是否内网和 CIDR |

主机名参数会通过正则限制为字母、数字、点、下划线和连字符，避免命令注入。

---

## systemd 服务管理

「服务管理」（`/system/services`）面向 Linux systemd 环境，接口前缀为 `/api/systemd`，所有接口需要登录态。页面先调用 `GET /api/systemd/check` 检查 `systemctl --version` 是否可用；不可用时展示提示。

服务列表来自：

```bash
systemctl list-units --type=service --all --no-pager --plain --no-legend
```

返回字段包括服务名、描述、加载状态、活动状态和子状态。后端列表会移除 `.service` 后缀，控制接口调用时再拼接 `.service`。

支持的操作：

| 操作 | 接口 |
|------|------|
| 启动 / 停止 / 重启 / reload | `POST /api/systemd/:name/start`、`/stop`、`/restart`、`/reload` |
| 开机自启 | `POST /api/systemd/:name/enable` |
| 取消自启 | `POST /api/systemd/:name/disable` |
| 屏蔽服务 | `POST /api/systemd/:name/mask` |
| 取消屏蔽 | `POST /api/systemd/:name/unmask` |
| 服务详情 | `GET /api/systemd/:name/detail` |
| 近期日志 | `GET /api/systemd/:name/logs` |
| 实时日志 | `GET /api/systemd/:name/logs/stream` |

服务详情使用 `systemctl show` 读取 `Id`、`Description`、`LoadState`、`ActiveState`、`SubState`、`UnitFileState`、`MainPID`、`ExecMainStartTimestamp`、`MemoryCurrent`、`CPUUsageNSec`、`Restart`、`FragmentPath`、`TriggeredBy`、`Requires`、`WantedBy` 等字段。

日志读取使用 `journalctl -u <name>.service --output=short-iso`，实时日志使用 `journalctl -f`。前端支持运行中、已停止、失败状态筛选，并在存在失败服务时提供「失败服务」快捷筛选。

---

## 日志查看

系统提供两类日志能力。

### 日志查看器

「日志查看器」（`/system/log-viewer`）面向任意绝对路径日志文件，接口前缀为 `/api/log-viewer`：

| 接口 | 说明 |
|------|------|
| `GET /api/log-viewer/content?path=...&lines=500` | 读取日志末尾内容，最多 5000 行 |
| `GET /api/log-viewer/stream?path=...` | 通过 `tail -f -n 0` 流式追踪 |
| `GET /api/log-viewer/download?path=...` | 下载日志文件，默认最大 100 MB |

前端使用 ANSI 渲染日志行，支持：

- 关键词高亮；
- 仅显示匹配行；
- `ERROR` / `WARN` / `INFO` / `DEBUG` 级别识别、颜色高亮与级别筛选；
- 下载当前日志文件。

### 日志文件

「日志文件」（`/system/log-files`）面向服务端配置的日志目录 `config.log.dir`，接口前缀为 `/api/log-files`。该模块只允许访问目录内的 `.log` 与 `.log.gz` 文件，并通过文件名校验防止路径穿越。

| 接口 | 权限 | 说明 |
|------|------|------|
| `GET /api/log-files` | `system:log:files` | 日志文件列表 |
| `GET /api/log-files/:filename/content` | `system:log:files` | 读取最后 N 行，支持关键词过滤 |
| `GET /api/log-files/:filename/tail` | `system:log:files` | SSE 实时追踪，`.gz` 文件不支持实时追踪 |
| `GET /api/log-files/:filename/download` | `system:log:files:download` | 下载日志文件 |
| `DELETE /api/log-files/:filename` | `system:log:files:delete` | 删除日志文件 |

普通日志通过文件读取末尾行，`.log.gz` 通过 gzip 解压后读取末尾行。实时追踪通过轮询文件追加内容实现，周期为 1 秒。

---

## 接口一览

| 模块 | 方法与路径 | 说明 |
|------|------------|------|
| Web 终端 | `GET /api/ws/terminal` | 本机 / SSH / Docker 终端 WebSocket |
| 会话监控 | `GET /api/ws/terminal-monitor` | 旁观与接管终端会话 |
| SSH 配置 | `GET /api/ssh-profiles` | 我的 SSH 配置列表 |
| SSH 配置 | `GET /api/ssh-profiles/:id` | SSH 配置详情 |
| SSH 配置 | `POST /api/ssh-profiles` | 创建 SSH 配置 |
| SSH 配置 | `PUT /api/ssh-profiles/:id` | 更新 SSH 配置 |
| SSH 配置 | `DELETE /api/ssh-profiles/:id` | 删除 SSH 配置 |
| SFTP | `GET /api/ssh-sftp/:profileId/home` | 获取远程 home |
| SFTP | `GET /api/ssh-sftp/:profileId/list` | 远程目录列表 |
| SFTP | `GET /api/ssh-sftp/:profileId/content` | 读取远程文本文件 |
| SFTP | `PUT /api/ssh-sftp/:profileId/content` | 保存远程文本文件 |
| SFTP | `POST /api/ssh-sftp/:profileId/create` | 新建远程文件或目录 |
| SFTP | `POST /api/ssh-sftp/:profileId/rename` | 重命名 / 移动远程文件或目录 |
| SFTP | `DELETE /api/ssh-sftp/:profileId/entry` | 删除远程文件或目录 |
| SFTP | `POST /api/ssh-sftp/:profileId/chmod` | 修改远程权限 |
| SFTP | `GET /api/ssh-sftp/:profileId/download` | 下载远程文件 |
| SFTP | `POST /api/ssh-sftp/:profileId/upload` | 上传远程文件 |
| 终端文件 | `GET /api/terminal-files/root-info` | 文件系统根信息 |
| 终端文件 | `GET /api/terminal-files/list` | 目录列表 |
| 终端文件 | `GET /api/terminal-files/download` | 下载文件 |
| 终端文件 | `POST /api/terminal-files/upload` | 上传文件 |
| 终端文件 | `GET /api/terminal-files/shells` | 可用 shell 列表 |
| 终端文件 | `GET /api/terminal-files/content` | 读取文本文件 |
| 终端文件 | `PUT /api/terminal-files/content` | 保存文本文件 |
| 终端文件 | `POST /api/terminal-files/create` | 新建文件或目录 |
| 终端文件 | `POST /api/terminal-files/rename` | 重命名 / 移动 |
| 终端文件 | `DELETE /api/terminal-files/entry` | 删除文件或目录 |
| 终端文件 | `POST /api/terminal-files/move` | 移动文件或目录 |
| 终端文件 | `POST /api/terminal-files/copy` | 复制文件或目录 |
| 终端文件 | `POST /api/terminal-files/compress` | 压缩为 ZIP |
| 终端文件 | `POST /api/terminal-files/chmod` | chmod |
| 终端文件 | `POST /api/terminal-files/extract` | 解压 |
| 终端文件 | `GET /api/terminal-files/checksum` | 文件校验和 |
| 终端文件 | `GET /api/terminal-files/search` | 递归搜索文件名 |
| 终端录屏 | `GET /api/terminal-recordings` | 录屏分页列表 |
| 终端录屏 | `POST /api/terminal-recordings` | 保存录屏 |
| 终端录屏 | `GET /api/terminal-recordings/:id` | 录屏详情 |
| 终端录屏 | `DELETE /api/terminal-recordings/:id` | 删除录屏 |
| 终端录屏 | `DELETE /api/terminal-recordings/clean` | 清除录屏记录 |
| 终端会话 | `GET /api/terminal-sessions` | 活动终端会话列表 |
| 终端会话 | `POST /api/terminal-sessions/:sessionId/terminate` | 强制终止会话 |
| 进程 | `GET /api/processes` | 进程列表 |
| 进程 | `GET /api/processes/stream` | SSE 实时进程列表 |
| 进程 | `GET /api/processes/:pid` | 进程详情 |
| 进程 | `DELETE /api/processes/:pid` | 结束进程 |
| 进程 | `PUT /api/processes/:pid/priority` | 调整优先级 |
| 端口 | `GET /api/ports` | 监听端口列表 |
| 端口 | `DELETE /api/ports/{pid}` | 结束占用端口的进程 |
| Docker | `GET /api/docker` | 容器列表 |
| Docker | `POST /api/docker/:id/start` / `stop` / `restart` | 控制容器 |
| Docker | `GET /api/docker/:id/logs` | 容器日志 |
| Docker | `GET /api/docker/:id/stats` | 容器资源占用 |
| Docker | `GET /api/docker/:id/inspect` | 容器详情 |
| Docker | `GET /api/docker/images` | 镜像列表 |
| Docker | `POST /api/docker/images/pull` | 拉取镜像 |
| Docker | `DELETE /api/docker/images/:id` | 删除镜像 |
| Docker | `GET /api/docker/networks` | 网络列表 |
| Docker | `POST /api/docker/networks` | 创建网络 |
| Docker | `DELETE /api/docker/networks/:id` | 删除网络 |
| Docker | `GET /api/docker/volumes` | 卷列表 |
| Docker | `POST /api/docker/volumes` | 创建卷 |
| Docker | `DELETE /api/docker/volumes/:name` | 删除卷 |
| Docker | `GET /api/docker/:id/files` | 容器内目录列表 |
| Docker | `GET /api/docker/:id/files/content` | 读取容器内文件 |
| Docker | `POST /api/docker/prune/*` | 容器 / 镜像 / 网络 / 卷 / 系统清理 |
| 网络诊断 | `GET /api/network-diag/stream` | ping / traceroute 流式输出 |
| 网络诊断 | `GET /api/network-diag/nslookup` | nslookup |
| 网络诊断 | `GET /api/network-diag/dns` | DNS 记录查询 |
| 网络诊断 | `GET /api/network-diag/reverse` | 反向 DNS |
| 网络诊断 | `POST /api/network-diag/http-probe` | HTTP(S) 探测 |
| 网络诊断 | `POST /api/network-diag/port-check` | TCP 端口检测 |
| 网络诊断 | `GET /api/network-diag/interfaces` | 本机网卡信息 |
| systemd | `GET /api/systemd/check` | systemd 可用性 |
| systemd | `GET /api/systemd` | 服务列表 |
| systemd | `POST /api/systemd/:name/:action` | 控制服务 |
| systemd | `GET /api/systemd/:name/detail` | 服务详情 |
| systemd | `GET /api/systemd/:name/logs` | 近期日志 |
| systemd | `GET /api/systemd/:name/logs/stream` | 实时日志 |
| 日志查看器 | `GET /api/log-viewer/content` | 读取指定路径日志末尾 |
| 日志查看器 | `GET /api/log-viewer/stream` | tail -f 指定路径日志 |
| 日志查看器 | `GET /api/log-viewer/download` | 下载指定路径日志 |
| 日志文件 | `GET /api/log-files` | 日志文件列表 |
| 日志文件 | `GET /api/log-files/:filename/content` | 读取日志文件 |
| 日志文件 | `GET /api/log-files/:filename/tail` | SSE 实时追踪 |
| 日志文件 | `GET /api/log-files/:filename/download` | 下载日志文件 |
| 日志文件 | `DELETE /api/log-files/:filename` | 删除日志文件 |

---

## 前端页面

系统运维页面由菜单种子 `SEED_MENUS` 配置，主要入口如下：

| 页面 | 路径 | 组件 | 权限 |
|------|------|------|------|
| Web 终端 | `/system/terminal` | `system/terminal/TerminalPage` | `system:terminal:execute` |
| 终端录屏 | `/system/terminal/recordings` | `system/terminal/TerminalRecordingsPage` | `system:terminal:execute` |
| 文件管理器 | `/system/file-manager` | `system/file-manager/FileManagerPage` | `system:terminal:execute` |
| 进程管理 | `/system/processes` | `system/processes/ProcessesPage` | `system:process:view` |
| 端口监听 | `/system/ports` | `system/ports/PortsPage` | `system:process:view` |
| Docker | `/system/docker` | `system/docker/DockerPage` | `system:process:view` |
| 网络诊断 | `/system/network-diag` | `system/network-diag/NetworkDiagPage` | `system:process:view` |
| 服务管理 | `/system/services` | `system/services/ServicesPage` | `system:process:view` |
| 日志查看器 | `/system/log-viewer` | `system/log-viewer/LogViewerPage` | `system:process:view` |
| 终端会话 | `/system/terminal/sessions` | `system/terminal/TerminalSessionsPage` | `system:terminal:monitor` |
| 日志文件 | `/system/log-files` | `system/log-files/LogFilesPage` | `system:log:files` |

按钮级权限包括 `system:process:kill`、`system:process:priority`、`system:terminal:monitor`、`system:log:files:download`、`system:log:files:delete` 等。

---

## 相关文档

- [功能模块：系统运维](../product/features.md#系统运维)
- [WebSocket 事件](../backend/websocket-events.md)
- [安全体系](../backend/security.md)
- [系统内置配置](../backend/system-configs.md)
- [定时任务](../backend/cron-jobs.md)
