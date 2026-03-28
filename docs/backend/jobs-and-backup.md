# 定时任务与数据库备份

本页介绍定时任务的配置与管理方式，以及数据库备份的操作流程。

---

## 定时任务

定时任务模块基于 Node.js 的 `node-cron` 库实现，支持在后台 UI 中创建、启停、手动执行任务，并可查看每次执行的历史日志。

### 概念说明

| 概念 | 说明 |
|------|------|
| **Handler（处理器）** | 实际执行业务逻辑的 TypeScript 函数，需在代码中预先注册 |
| **任务（Job）** | 在后台 UI 中创建，将 Cron 表达式与某个 Handler 关联起来 |
| **执行日志** | 每次任务执行（手动或定时）的详情记录，包含开始/结束时间、状态、输出 |

### 菜单入口

**系统管理 → 定时任务**（路由：`/system/cron-jobs`，权限：`system:cronjob:list`）

### Cron 表达式格式

支持标准 5 段式 Cron：

```text
┌───── 分钟 (0–59)
│ ┌───── 小时 (0–23)
│ │ ┌───── 日期 (1–31)
│ │ │ ┌───── 月份 (1–12)
│ │ │ │ ┌───── 星期 (0–7，0 和 7 均表示周日)
│ │ │ │ │
* * * * *
```

常用示例：

| 表达式 | 含义 |
|--------|------|
| `0 2 * * *` | 每天凌晨 2 点执行 |
| `*/15 * * * *` | 每 15 分钟执行一次 |
| `0 9 * * 1` | 每周一上午 9 点执行 |
| `0 0 1 * *` | 每月 1 日零点执行 |

UI 中提供 Cron 表达式校验按钮，填写后可即时验证格式是否正确。

### 如何注册新的 Handler

在代码中注册 Handler：

```typescript
// packages/server/src/lib/cron-scheduler.ts
import { registerHandler } from './cron-scheduler';

registerHandler('cleanup_expired_sessions', async () => {
  // 清理过期会话的业务逻辑
  console.log('清理过期会话...');
});
```

注册后，在后台「定时任务」页面的「处理器」下拉框中即可看到该 Handler，并为其配置触发时间。

### 相关接口

| 接口 | 说明 |
|------|------|
| `GET /api/cron-jobs` | 获取任务列表（支持按名称筛选）|
| `POST /api/cron-jobs` | 创建任务 |
| `PUT /api/cron-jobs/:id` | 更新任务 |
| `DELETE /api/cron-jobs/:id` | 删除任务 |
| `POST /api/cron-jobs/:id/run` | 立即执行一次（不影响定时计划）|
| `POST /api/cron-jobs/:id/toggle` | 启用 / 暂停任务 |
| `GET /api/cron-jobs/:id/logs` | 查看执行日志（分页）|
| `GET /api/cron-jobs/handlers` | 获取已注册的 Handler 列表 |
| `POST /api/cron-jobs/validate` | 校验 Cron 表达式格式 |

### 数据库表

| 表 | 说明 |
|----|------|
| `cron_jobs` | 任务定义（名称、Handler、Cron 表达式、状态）|
| `cron_job_logs` | 任务执行历史（开始时间、结束时间、状态、输出）|

---

## 数据库备份

从 v0.1.4 起，系统内置数据库备份功能，基于 `pg_dump` 命令生成 PostgreSQL 完整备份文件。

### 菜单入口

**系统设置 → 数据库备份**（路由：`/system/db-backups`，权限：`system:db-backup:list`）

### 操作说明

| 操作 | 说明 |
|------|------|
| **立即备份** | 手动触发 `pg_dump`，生成 `.sql` 备份文件并保存到服务器本地 |
| **下载备份** | 下载指定备份文件到本地 |
| **删除备份** | 删除服务器上的指定备份文件 |

### 前置条件

服务器环境必须安装 `pg_dump` 工具（PostgreSQL 客户端工具包），且版本需与数据库服务端版本兼容：

```bash
# Ubuntu / Debian
apt-get install postgresql-client

# 验证安装
pg_dump --version
```

### 备份文件存储位置

备份文件默认保存在后端服务的 `./backups/` 目录下。路径可通过后端环境变量 `BACKUP_DIR` 自定义：

```ini
# packages/server/.env
BACKUP_DIR=./backups
```

### 相关接口

| 接口 | 说明 |
|------|------|
| `GET /api/db-backups` | 获取备份文件列表 |
| `POST /api/db-backups` | 触发立即备份 |
| `GET /api/db-backups/:filename/download` | 下载备份文件 |
| `DELETE /api/db-backups/:filename` | 删除指定备份文件 |

### 定期自动备份建议

当前内置功能仅支持手动触发。如需定期自动备份，可通过**定时任务模块**实现：

1. 在 `cron-scheduler.ts` 中注册一个备份 Handler
2. 在「定时任务」页面创建任务，绑定该 Handler，设置适合的 Cron 表达式（如每天凌晨 2 点）

> **生产建议**：建议将备份文件定期同步到对象存储（如阿里云 OSS、AWS S3），避免仅依赖本地磁盘存储。
