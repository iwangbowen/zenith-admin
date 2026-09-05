# 治理、统计与设置

内容治理负责发现需要维护的文档，统计看板呈现空间、文档、评论、搜索与审批指标，设置页控制发布、评论、回收站和 AI 同步策略。

## 治理清单

治理页 `/wiki/governance` 以 Tab 展示 `WIKI_GOVERNANCE_KINDS`：

| `kind` | 中文名 | 判定条件 |
| --- | --- | --- |
| `all` | 全部文档 | 未删除且未归档 |
| `expired` | 已过期 | `expireAt` 非空且小于等于当前时间，且未归档 |
| `review-due` | 待复审 | `nextReviewAt` 非空且小于等于当前时间，且未归档 |
| `stale` | 长期未更新 | 已发布且 `updatedAt` 早于 180 天前，且未归档 |
| `no-owner` | 无负责人 | `ownerId` 为空，且未归档 |
| `draft-backlog` | 草稿积压 | 草稿且 `updatedAt` 早于 30 天前，且未归档 |
| `review-backlog` | 审核积压 | 待审核且超过 `wiki.pendingRemindHours` 小时未更新，且未归档 |
| `archived` | 已归档 | `isArchived = true` |
| `no-result` | 无结果搜索词 | 近 30 天 `resultCount = 0` 的搜索关键词聚合 |

治理清单只包含当前租户、未删除、当前用户可访问空间内的文档。

## 批量治理

| 操作 | 接口 | 权限 | 说明 |
| --- | --- | --- | --- |
| 提醒负责人 | `POST /api/wiki/governance/remind` | `wiki:governance:remind` | 对所选文档的 `ownerId` 发送维护提醒；无负责人时提醒创建人 |
| 归档 / 取消归档 | `POST /api/wiki/governance/archive` | `wiki:governance:archive` | 设置 `isArchived`；归档文档默认从目录树 / 列表 / 搜索隐藏 |
| 指定负责人 | `POST /api/wiki/governance/owner` | `wiki:governance:edit` | 批量写入 `ownerId` |
| 设置复审 / 有效期 | `POST /api/wiki/governance/review-cycle` | `wiki:governance:edit` | 设置 `reviewCycleDays`、`nextReviewAt` 与可选 `expireAt` |
| Markdown 导入 | `POST /api/wiki/governance/import` | `wiki:doc:create` | 最多 20 个文件，单文件 500KB，导入为草稿 |

Markdown 导入标题取文件内容中的首个 `# 标题`；没有一级标题时使用文件名（去除 `.md` / `.markdown` / `.txt` / `.html` 后缀）。导入文档追加到目标层级末尾，并创建 `wiki_doc_versions` 初始版本。

## 每日治理任务

`runWikiGovernanceTick()` 由系统任务注册调用，执行两类维护动作：

1. 扫描未删除、未归档且已过有效期或到达复审时间的文档，向 `ownerId` 或创建人发送 `wiki.governance.review_due`。
2. 当 `wiki.recycleRetentionDays > 0` 时，物理删除超过保留天数的回收站文档，并同步清理 `business_files`。

复审到期通知使用 `dedupeKey = wiki-governance:{docId}:{YYYY-MM-DD}`，同一天重复执行不会重复投递。

## 统计看板

`/wiki/stats` 聚合基础统计、运营统计与榜单。

| 区域 | 指标 / 列表 | 接口 |
| --- | --- | --- |
| 概览卡 | 知识空间、文档总数、已发布、待审核、评论数、本周新增文档、本周浏览量 | `GET /api/wiki/stats/overview` |
| 运营卡 | 近 30 天搜索量、搜索成功率、近 30 天审核通过 / 驳回、审核积压、已过期、待复审、无负责人、已归档 | `GET /api/wiki/stats/ops` |
| 趋势图 | 近 30 天新建文档趋势 | `GET /api/wiki/stats/ops` |
| 分布图 | 空间文档分布 | `GET /api/wiki/stats/ops` |
| 热门文档 | 按 `viewCount` 排序的 Top N，可跳转文档中心 | `GET /api/wiki/stats/hot-docs` |
| 贡献榜 | 按创建文档数统计用户贡献 | `GET /api/wiki/stats/contributors` |
| 沉睡文档 | 已发布且超过 90 天未更新的文档 | `GET /api/wiki/stats/stale-docs` |

统计查询跟随租户与空间访问边界；评论与浏览量通过关联文档继承文档访问边界。

## 系统设置

知识中心全局设置是[运行时设置](../backend/settings.md)的 `wiki` 模块（`packages/shared/src/settings/modules/wiki.ts`，平台作用域，License 特性 `wiki`），读写 `GET/PUT /api/settings/wiki`，服务端 `getSettings('wiki')`。

| 字段 | 类型 | 默认 | 页面文案 | 影响 |
| --- | --- | --- | --- | --- |
| `requireApproval` | boolean | `true` | 发布需审核 | 开启时提交进入 `pending`；关闭时提交即发布 |
| `defaultVisibility` | string | `public` | 空间默认可见性 | 新建知识空间默认可见范围 |
| `aiSyncEnabled` | boolean | `false` | 同步 AI 知识库 | 全局 AI 同步开关 |
| `aiSyncKbId` | number \| null | `null` | 同步目标知识库 | 目标 AI 知识库 ID；`null` 表示未指定 |
| `commentsEnabled` | boolean | `true` | 允许评论 | 关闭后暂停新评论 |
| `recycleRetentionDays` | number | `0` | 回收站保留天数 | `0` 表示永久保留；大于 0 时每日任务清理超期文档 |
| `pendingRemindHours` | number | `48` | 审核积压提醒时限 | 影响治理清单 `review-backlog` |

开启 AI 同步时，前端要求选择目标 AI 知识库。文档发布后只有在全局 `aiSyncEnabled = true`、`aiSyncKbId` 有效且文档所属空间 `aiSyncEnabled = true` 时才同步。

## 治理与统计 API

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/api/wiki/governance/docs` | `wiki:governance:list` | 治理清单，必传 `kind` |
| `GET` | `/api/wiki/governance/no-result-keywords` | `wiki:governance:list` | 近 30 天无结果搜索关键词 |
| `POST` | `/api/wiki/governance/remind` | `wiki:governance:remind` | 批量提醒负责人 |
| `POST` | `/api/wiki/governance/archive` | `wiki:governance:archive` | 批量归档 / 取消归档 |
| `POST` | `/api/wiki/governance/owner` | `wiki:governance:edit` | 批量指定负责人 |
| `POST` | `/api/wiki/governance/review-cycle` | `wiki:governance:edit` | 批量设置复审周期与有效期 |
| `POST` | `/api/wiki/governance/import` | `wiki:doc:create` | 批量导入 Markdown 文件为草稿 |
| `GET` | `/api/wiki/stats/overview` | `wiki:stats:view` | 知识库概览统计 |
| `GET` | `/api/wiki/stats/hot-docs` | `wiki:stats:view` | 热门文档 Top N，`limit` 1-50 |
| `GET` | `/api/wiki/stats/contributors` | `wiki:stats:view` | 贡献榜 Top N，`limit` 1-50 |
| `GET` | `/api/wiki/stats/stale-docs` | `wiki:stats:view` | 沉睡文档 Top N，`limit` 1-50 |
| `GET` | `/api/wiki/stats/ops` | `wiki:stats:view` | 运营统计 |
| `GET` | `/api/settings/wiki` | `wiki:setting:view` | 读取知识库设置信封（生效值 / 默认值 / 版本） |
| `PUT` | `/api/settings/wiki` | `wiki:setting:edit` | 整体替换知识库设置（携带 `version`，冲突返回 409） |

