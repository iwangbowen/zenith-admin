# 系统运维

Zenith Admin 的运维文档按能力拆分维护。运维能力覆盖服务器运行态、Web 终端、文件与 SFTP、Docker、网络诊断、systemd、日志、数据库工作台、备份、数据保留、缓存、服务监控、告警中心、Nginx、SSL、维护模式与应用在线升级。

---

## 文档导航

| 文档 | 内容 |
| --- | --- |
| [终端与文件](./terminal.md) | Web 终端、SSH 配置、终端会话监控、终端录屏、SFTP、本机文件管理器 |
| [主机与中间件](./host-infra.md) | 进程、端口、Docker、网络诊断、systemd、日志查看、日志文件、防火墙、Nginx、SSL、维护模式 |
| [数据库、缓存与保留策略](./data-platform.md) | 数据库管理台、数据库备份、Redis 缓存管理、数据保留策略 |
| [监控与告警](./observability.md) | 服务监控、时序指标、WebSocket 指标、告警规则、告警事件与通知闭环 |
| [应用版本与在线升级](./app-releases.md) | 应用 / 版本 / 制品三层模型、多端升级、灰度、公开升级 API、升级看板 |
| [接口与页面速查](./reference.md) | API 前缀、权限码、前端页面、核心数据表 |

---

## 能力总览

| 能力 | 当前实现 |
| --- | --- |
| Web 终端 | 基于 WebSocket + xterm.js 的本机、SSH、Docker exec 终端，支持多 Tab、多分屏、尺寸同步、断线重连和输出缓冲回放 |
| SSH / SFTP | 按用户隔离 SSH 配置档案，支持密码、服务端私钥路径、私钥内容、ssh-agent、环境变量、分组、标签与远程 SFTP 文件操作 |
| 本机文件管理 | 浏览、上传、下载、新建、编辑、移动、复制、删除、chmod、ZIP 压缩、解压、搜索、目录大小与校验和 |
| 主机运行态 | 进程列表 / 详情 / SSE 推送、端口监听、Docker 容器 / 镜像 / 网络 / 卷、网络诊断、systemd 服务 |
| 多主机运维 | 平台级 Linux 主机注册、SSH TOFU 指纹校验、连接池、资源快照、远端进程 / 端口 / systemd / 日志 / 文件 / 防火墙只读与交互终端 |
| 配置与证书 | 防火墙规则、Nginx 站点、SSL 证书和维护模式均接入权限与审计 |
| 日志 | 任意路径日志 tail / 下载，服务端日志目录列表、查看、实时追踪、正则搜索、复制导出、下载和删除 |
| 数据库 | PostgreSQL 工作台：对象浏览、表数据编辑、只读 SQL、EXPLAIN、导入导出、ER 图、索引健康、Schema 漂移、活动连接、表维护 |
| 备份与保留 | `pg_dump` / Drizzle 导出备份，统一数据保留策略与手动清理 |
| 缓存 | Redis 概览、按命名空间扫描 key、查看值、修改 TTL / 字符串值、单个 / 批量 / 分类 / 全量清理 |
| 监控告警 | 服务实时监控、历史趋势、WebSocket 指标、告警规则评估、告警事件处理与通知结果追踪 |
| 应用升级 | 应用 / 版本 / 制品三层模型，桌面、移动、Web 热更新统一发布，公开 check / latest / 制品分发 / 安装回执 API |

---

## 菜单边界

系统运维目录下的页面来自 `packages\shared\src\seed\menus\settings.ts` 的「系统运维」目录：运维概览、Web 终端、终端会话、终端录屏、文件管理器、进程管理、端口监听、Docker、服务管理、日志查看器、网络诊断、防火墙管理、Nginx 站点、SSL 证书和主机管理。

数据库管理、数据库备份、缓存管理、数据保留、服务监控、维护模式和应用版本属于同一系统设置域，但不挂在「系统运维」目录内；告警中心使用独立顶级菜单。

## 监控告警

监控指标、日志级别频率、告警规则与事件闭环详见[监控与告警](./observability.md)。
## 相关文档

- [功能模块：系统运维](../product/features.md#运维与可观测性)
- [WebSocket 事件](../backend/websocket-events.md)
- [维护模式](../backend/maintenance-mode.md)
- [安全体系](../backend/security.md)
- [运行时设置](../backend/settings.md)
- [定时任务](../backend/cron-jobs.md)
