# 接口与页面速查

本页汇总运维相关 API、页面、权限码与核心数据表。详细说明见各专题页。

---

## API 前缀

| 能力 | 前缀 |
| --- | --- |
| Web 终端 | `GET /api/ws/terminal` |
| 会话监控 | `GET /api/ws/terminal-monitor` |
| SSH 配置 | `/api/ssh-profiles` |
| SFTP | `/api/ssh-sftp/:profileId` |
| 运维主机 | `/api/ops-hosts` |
| 运维主机文件 | `/api/host-files/:hostId` |
| 本机文件 | `/api/terminal-files` |
| 终端录屏 | `/api/terminal-recordings` |
| 终端会话 | `/api/terminal-sessions` |
| 进程 | `/api/processes` |
| 端口 | `/api/ports` |
| Docker | `/api/docker` |
| 网络诊断 | `/api/network-diag` |
| systemd | `/api/systemd` |
| 日志查看器 | `/api/log-viewer` |
| 日志文件 | `/api/log-files` |
| 数据库管理 | `/api/db-admin` |
| 防火墙 | `/api/firewall` |
| Nginx 站点 | `/api/nginx-sites` |
| SSL 证书 | `/api/ssl-certificates` |
| 维护模式 | `/api/maintenance` |
| 数据保留 | `/api/retention-policies` |
| 服务监控 | `/api/monitor` |
| 告警中心 | `/api/monitor-alerts` |
| 缓存管理 | `/api/cache` |
| 应用版本管理 | `/api/app-releases` |
| 公开升级 API | `/api/public/app-releases` |

## 页面与权限

| 页面 | 路径 | 组件 | 权限 |
| --- | --- | --- | --- |
| 运维概览 | `/system/ops-overview` | `system/ops-overview/OpsOverviewPage` | `system:ops:overview` |
| 主机管理 | `/system/hosts` | `system/hosts/HostsPage` | `system:host:view`、`system:host:manage`、`system:host:use` |
| Web 终端 | `/system/terminal` | `system/terminal/TerminalPage` | `system:terminal:execute` |
| 终端录屏 | `/system/terminal/recordings` | `system/terminal/TerminalRecordingsPage` | `system:terminal:execute` |
| 文件管理器 | `/system/file-manager` | `system/file-manager/FileManagerPage` | `system:file:use`(终端权限可兼容访问) |
| 进程管理 | `/system/processes` | `system/processes/ProcessesPage` | `system:process:view` |
| 端口监听 | `/system/ports` | `system/ports/PortsPage` | `system:port:view` |
| Docker | `/system/docker` | `system/docker/DockerPage` | `system:docker:view` |
| 网络诊断 | `/system/network-diag` | `system/network-diag/NetworkDiagPage` | `system:network:diag` |
| 服务管理 | `/system/services` | `system/services/ServicesPage` | `system:service:view` |
| 日志查看器 | `/system/log-viewer` | `system/log-viewer/LogViewerPage` | `system:log:view` |
| 终端会话 | `/system/terminal/sessions` | `system/terminal/TerminalSessionsPage` | `system:terminal:monitor` |
| 防火墙管理 | `/system/firewall` | `system/firewall/FirewallPage` | `system:firewall:view` |
| Nginx 站点 | `/system/nginx-sites` | `system/nginx-sites/NginxSitesPage` | `system:nginx:view` |
| SSL 证书 | `/system/ssl-certificates` | `system/ssl-certificates/SslCertificatesPage` | `system:ssl:view` |
| 日志文件 | `/system/log-files` | `system/log-files/LogFilesPage` | `system:log:files` |
| 数据库管理 | `/system/db-admin` | `system/db-admin/DbAdminPage` | `system:db-admin:view` |
| 缓存管理 | `/system/cache` | `system/cache/CacheManagePage` | `system:cache:list` |
| 数据保留 | `/system/retention` | `system/retention/RetentionPage` | `system:retention:view` |
| 服务监控 | `/system/monitor` | `system/monitor/MonitorPage` | `system:monitor:view` |
| 维护模式 | `/system/maintenance` | `system/maintenance/MaintenancePage` | `system:maintenance:manage` |
| 应用版本 | `/system/app-releases` | `system/app-releases/AppReleasesPage` | `system:app-release:list` |
| 告警概览 | `/alerts/overview` | `alerts/overview/AlertOverviewPage` | `alert:overview:list` |
| 告警规则 | `/alerts/rules` | `alerts/rules/AlertRulesPage` | `alert:rule:list` |
| 告警事件 | `/alerts/events` | `alerts/events/AlertEventsPage` | `alert:event:list` |

按钮级权限包括 `system:process:kill`、`system:process:priority`、`system:docker:manage`、`system:service:manage`、`system:terminal:monitor`、`system:log:files:download`、`system:log:files:delete`、`system:firewall:manage`、`system:nginx:manage`、`system:nginx:reload`、`system:ssl:create`、`system:ssl:delete`、`system:db-admin:query`、`system:db-admin:export`、`system:db-admin:write`、`system:db-admin:maintain`、`system:db-admin:terminal`、`system:cache:update`、`system:cache:delete`、`system:retention:edit`、`system:retention:run`、`system:app-release:create`、`system:app-release:update`、`system:app-release:delete`、`system:app-release:publish`、`alert:rule:create`、`alert:rule:update`、`alert:rule:delete`、`alert:rule:test`、`alert:event:handle`、`alert:event:export`。

## 核心数据表

| 表 | 说明 |
| --- | --- |
| `terminal_sessions` | Web 终端 / SSH / Docker 会话元数据 |
| `terminal_recordings` | 终端录屏事件 |
| `ssh_profiles` | 用户 SSH 配置档案 |
| `db_admin_query_history` | 数据库管理台查询历史 |
| `db_query_favorites` | SQL 收藏夹 |
| `db_backups` | 数据库备份记录（数据库管理 → 备份 Tab 与定时任务 `databaseBackup` 写入） |
| `ssl_certificates` | SSL 证书元数据 |
| `maintenance_logs` | 维护模式记录 |
| `retention_policies` | 数据保留策略运行期配置 |
| `system_metric_samples` | 监控指标采样点 |
| `monitor_alert_rules` | 告警规则 |
| `monitor_alert_events` | 告警事件 |
| `client_apps` | 客户端应用 |
| `app_releases` | 应用版本 |
| `app_artifacts` | 发布制品 |
| `app_release_events` | 升级事件流水 |
