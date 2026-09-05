# 数据模型与接口速查

本页汇总知识中心的枚举、表结构、权限码、设置键、通知事件与 API 路径。

## 枚举

| 枚举 | 值 |
| --- | --- |
| `wiki_space_visibility` | `public`（全员可读）、`private`（成员可见） |
| `wiki_space_member_role` | `owner`、`admin`、`editor`、`viewer` |
| `wiki_doc_status` | `draft`、`pending`、`published`、`rejected` |
| `wiki_comment_status` | `visible`、`hidden` |
| `wiki_review_action` | `submit`、`approve`、`reject`、`withdraw` |
| `WIKI_GOVERNANCE_KINDS` | `all`、`expired`、`review-due`、`stale`、`no-owner`、`draft-backlog`、`review-backlog`、`archived` |

## 数据表

| 表名 | 关键字段 | 说明 |
| --- | --- | --- |
| `wiki_spaces` | `name`、`visibility`、`status`、`sort`、`ai_sync_enabled`、`tenant_id` | 知识空间 |
| `wiki_space_members` | `space_id`、`user_id`、`role` | 空间成员，复合主键 |
| `wiki_docs` | `space_id`、`parent_id`、`title`、`summary`、`content`、`status`、`reject_reason`、`sort`、`is_pinned`、`view_count`、`current_version`、`revision`、`require_read_receipt`、`owner_id`、`expire_at`、`review_cycle_days`、`next_review_at`、`is_archived`、`published_at`、`deleted_at`、`tenant_id` | 文档主表 |
| `wiki_doc_versions` | `doc_id`、`version`、`title`、`content`、`change_note`、`author_id` | 文档版本快照，`doc_id + version` 唯一 |
| `wiki_templates` | `name`、`description`、`content`、`status`、`sort` | 文档模板 |
| `wiki_tags` | `name`、`color` | 标签，`name` 唯一 |
| `wiki_doc_tags` | `doc_id`、`tag_id` | 文档标签关联，复合主键 |
| `wiki_comments` | `doc_id`、`parent_id`、`content`、`status`、`mentioned_user_ids`、`is_question`、`resolved_at`、`author_id` | 评论与回复 |
| `wiki_doc_favorites` | `doc_id`、`user_id` | 收藏，复合主键 |
| `wiki_doc_views` | `doc_id`、`user_id`、`created_at` | 浏览日志 |
| `wiki_search_logs` | `keyword`、`result_count`、`clicked_doc_id`、`user_id`、`tenant_id`、`created_at` | 搜索日志 |
| `wiki_doc_subscriptions` | `doc_id`、`user_id` | 文档订阅，复合主键 |
| `wiki_review_records` | `doc_id`、`version`、`action`、`actor_id`、`reason` | 审核时间线 |
| `wiki_doc_read_receipts` | `doc_id`、`user_id`、`created_at` | 阅读确认，复合主键 |
| `business_files` | `business_type = 'wiki_doc'`、`business_id = docId` | 文档附件多态关联 |
| `system_settings` | `module = 'wiki'` | 知识中心全局设置（[运行时设置](../backend/settings.md)） |

## 设置字段

运行时设置模块 `wiki`（`getSettings('wiki')` / `useSettings('wiki')`）：

```ts
requireApproval
defaultVisibility
aiSyncEnabled
aiSyncKbId
commentsEnabled
recycleRetentionDays
pendingRemindHours
```

## 通知事件

| 事件 Key | 说明 |
| --- | --- |
| `wiki.doc.published` | 订阅的知识文档发布新版本 |
| `wiki.doc.commented` | 文档收到新评论 |
| `wiki.doc.mentioned` | 评论中被 @ 提及 |
| `wiki.doc.reviewed` | 文档审核结果 |
| `wiki.governance.maintenance_due` | 文档待维护提醒 |
| `wiki.governance.review_due` | 文档复审到期 / 已过有效期 |

## 权限码

```text
wiki:doc:list
wiki:doc:create
wiki:doc:edit
wiki:doc:delete
wiki:doc:publish
wiki:doc:move
wiki:space:list
wiki:space:create
wiki:space:edit
wiki:space:delete
wiki:space:grant
wiki:approval:list
wiki:approval:review
wiki:template:list
wiki:template:create
wiki:template:edit
wiki:template:delete
wiki:tag:list
wiki:tag:create
wiki:tag:edit
wiki:tag:delete
wiki:comment:list
wiki:comment:audit
wiki:comment:delete
wiki:recycle:list
wiki:recycle:restore
wiki:recycle:purge
wiki:stats:view
wiki:setting:view
wiki:setting:edit
wiki:governance:list
wiki:governance:remind
wiki:governance:archive
wiki:governance:edit
```

## API 路径清单

### 空间

| 方法 | 路径 |
| --- | --- |
| `GET` | `/api/wiki/spaces` |
| `GET` | `/api/wiki/spaces/my` |
| `GET` | `/api/wiki/spaces/{id}` |
| `POST` | `/api/wiki/spaces` |
| `PUT` | `/api/wiki/spaces/{id}` |
| `DELETE` | `/api/wiki/spaces/{id}` |
| `GET` | `/api/wiki/spaces/{id}/members` |
| `PUT` | `/api/wiki/spaces/{id}/members` |

### 文档

| 方法 | 路径 |
| --- | --- |
| `GET` | `/api/wiki/docs` |
| `GET` | `/api/wiki/docs/search` |
| `POST` | `/api/wiki/docs/search/click` |
| `GET` | `/api/wiki/docs/recent` |
| `GET` | `/api/wiki/docs/reviews/processed` |
| `GET` | `/api/wiki/docs/tree` |
| `GET` | `/api/wiki/docs/favorites` |
| `GET` | `/api/wiki/docs/recycle` |
| `GET` | `/api/wiki/docs/{id}` |
| `POST` | `/api/wiki/docs` |
| `PUT` | `/api/wiki/docs/{id}` |
| `DELETE` | `/api/wiki/docs/{id}` |
| `POST` | `/api/wiki/docs/{id}/move` |
| `POST` | `/api/wiki/docs/{id}/submit` |
| `POST` | `/api/wiki/docs/{id}/withdraw` |
| `POST` | `/api/wiki/docs/{id}/review` |
| `POST` | `/api/wiki/docs/{id}/favorite` |
| `POST` | `/api/wiki/docs/{id}/subscribe` |
| `POST` | `/api/wiki/docs/{id}/read-receipt` |
| `GET` | `/api/wiki/docs/{id}/read-receipts` |
| `GET` | `/api/wiki/docs/{id}/review-records` |
| `POST` | `/api/wiki/docs/{id}/view` |
| `GET` | `/api/wiki/docs/{id}/versions` |
| `GET` | `/api/wiki/docs/{id}/versions/{version}` |
| `POST` | `/api/wiki/docs/{id}/rollback` |
| `POST` | `/api/wiki/docs/{id}/restore` |
| `DELETE` | `/api/wiki/docs/{id}/purge` |

### 模板、标签、评论、治理、统计、设置

| 方法 | 路径 |
| --- | --- |
| `GET` | `/api/wiki/templates` |
| `GET` | `/api/wiki/templates/all` |
| `GET` | `/api/wiki/templates/{id}` |
| `POST` | `/api/wiki/templates` |
| `PUT` | `/api/wiki/templates/{id}` |
| `DELETE` | `/api/wiki/templates/{id}` |
| `GET` | `/api/wiki/tags` |
| `GET` | `/api/wiki/tags/all` |
| `POST` | `/api/wiki/tags` |
| `PUT` | `/api/wiki/tags/{id}` |
| `DELETE` | `/api/wiki/tags/{id}` |
| `GET` | `/api/wiki/comments/doc/{id}` |
| `POST` | `/api/wiki/comments` |
| `POST` | `/api/wiki/comments/{id}/resolve` |
| `DELETE` | `/api/wiki/comments/mine/{id}` |
| `GET` | `/api/wiki/comments` |
| `PUT` | `/api/wiki/comments/{id}/status` |
| `DELETE` | `/api/wiki/comments/{id}` |
| `GET` | `/api/wiki/governance/docs` |
| `GET` | `/api/wiki/governance/no-result-keywords` |
| `POST` | `/api/wiki/governance/remind` |
| `POST` | `/api/wiki/governance/archive` |
| `POST` | `/api/wiki/governance/owner` |
| `POST` | `/api/wiki/governance/review-cycle` |
| `POST` | `/api/wiki/governance/import` |
| `GET` | `/api/wiki/stats/overview` |
| `GET` | `/api/wiki/stats/hot-docs` |
| `GET` | `/api/wiki/stats/contributors` |
| `GET` | `/api/wiki/stats/stale-docs` |
| `GET` | `/api/wiki/stats/ops` |
| `GET` | `/api/settings/wiki` |
| `PUT` | `/api/settings/wiki` |

