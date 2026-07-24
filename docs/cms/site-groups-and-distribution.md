# 站群层级、继承与内容分发

CMS 站群是平台级全局能力，不带 `tenant_id`。Stage 5 只实现站点层级、显式配置继承和受治理内容分发；不包含结构化多语言、专题或插件。

## 站点层级

`cms_sites.parent_id` 形成父子树，根站点为 `null`，站点 `code` 继续全局唯一。

- 根深度为 1，最大 8 层。
- 移动以整棵子树为单位，在事务和全局层级 advisory lock 内检查目标父级、环、子树高度和状态。
- 启用子站点要求全部祖先启用；停用父站点前必须先停用全部子站点。站点仍被启用中的分发规则引用时也禁止停用。
- 有子站点、栏目或分发规则引用的站点不能删除，不做隐式级联。
- 非平台超管仍必须在 `cms_site_users` 显式绑定。树、继承链、移动和整组发布不会静默裁剪越权站点。

接口：

- `GET /api/cms/sites/tree`
- `GET /api/cms/sites/{id}/inheritance-chain`
- `PUT /api/cms/sites/{id}/parent`
- `POST /api/cms/publishing/group-submit`

整组发布先校验全部目标站点和栏目 ACL，再为每个启用站点提交独立 `cms-publish-build`。每个任务带当前 theme/template/deployment revision fence，可取消、恢复和重试。

## 显式逐项继承

继承开关存于 `cms_site_inheritances`，值仍保存在各站点自身。resolver 不做不可见的 JSON 魔法合并，而是对每一项沿父链选择唯一来源：

| 继承项 | 值 |
|---|---|
| SEO | `title`、`keywords`、`description` 分别选择来源 |
| 静态化 | `staticMode` |
| 审核 | `auditMode`、`auditWorkflowDefinitionId` |
| Webhook | URL 与签名 secret 作为一组 |
| CDN | purge URL 与 token 作为一组 |
| 主题 | theme code 与活动 package deployment |
| 主题参数 | `themeConfig`、主题色/暗色配置 |
| 模板 | `defaultTemplates` 与站点模板解析链 |

开关关闭表示 `own`，开启表示 `inherited`。恢复本站覆盖时，原先保存的本站值重新生效。根站点不能开启继承。

`GET /api/cms/sites/{id}/effective-config` 返回 `resolved + sources`。Webhook secret、CDN token 等敏感值只返回 `********` 或 `null`；即使来源是无权查看的父站点，也不返回父级名称/id 或明文 secret。

运行时、静态化、审核、Webhook、CDN、主题健康检查和模板选择器共用有效配置 resolver。继承策略或父级有效配置变化会递增受影响站点 revision，并以事务 outbox 提交重建任务。

### 主题与模板解析顺序

主题来源由 `theme` 继承项决定。活动 package deployment 同样取该来源站点，不会在子站点偷偷回退。

手工模板统一按以下顺序解析：

1. 当前站点活动模板；
2. `templates` 开关允许的最近父级到更远父级；
3. 主题级全局模板；
4. 仓库内置可信模板。

同名子站模板会遮蔽父级模板。运行时、健康检查和模板选择器使用同一 scope chain。父级主题/模板生命周期操作先计算真正受影响且未被子级覆盖的站点，要求完整 ACL，并为每个站点创建 fenced 重建任务。

## 受治理内容分发

规则存于 `cms_distribution_rules`，执行记录与行级结果复用任务中心 `async_tasks` / `async_task_items`，不创建第二套任务状态表。

规则包含：

- 来源站点及可选来源栏目；
- 目标站点和目标栏目；
- `copy`（独立草稿）、`mapping`（正文/扩展跟随来源）、`scheduled`（Cron 物化同步）；
- `skip`、`overwrite`、`create-new` 冲突策略；
- 内容形态、关键词和发布时间过滤；
- 启停状态、Cron、下一次/最近执行时间和 revision。

安全约束：

- 来源和目标站点/栏目均执行 fail-closed ACL；来源与目标不能同站。
- 固定只读取 `published` 且未回收/归档的来源内容，草稿不会跨站泄露。
- 新内容始终是 `draft`，必须走目标站点审核/发布管道。
- HTML 每次物化均经过 `sanitizeCmsHtml`。
- 目标持久锁存在时，所有冲突策略都拒绝覆盖。
- 已发布目标更新复用 `updateCmsContent`，保留版本、操作日志、发布 outbox 和静态产物清理语义。
- `rule + source content` 唯一物化索引、来源 version 和任务幂等键共同提供有限幂等。
- 规则 revision 变化会协作取消旧任务；任务按来源 id 排序保存 checkpoint，支持断点、取消、重试和行级结果。
- 删除规则保留物化内容；映射内容先在同一事务内复制最后正文并解除映射。映射目标被锁定时拒绝删除规则。

`mapping` 来源更新后由系统身份提交跟随任务；目标若已发布，会重新进入增量发布 outbox，不会只改正文而漏掉静态产物。

接口：

- `GET/POST /api/cms/distributions`
- `GET/PUT/DELETE /api/cms/distributions/{id}`
- `POST /api/cms/distributions/{id}/run`
- `GET /api/cms/distributions/runs`
- `GET /api/cms/distributions/runs/{id}`

定时扫描由系统调度任务 `cms-distribution-schedule` 每分钟执行，到期后仅提交任务中心任务。同步明细通过导出中心实体 `cms.distribution-runs` 导出。

## 权限

- 站群：`cms:site:hierarchy`
- 整组发布：`cms:publish:group`
- 分发：`cms:distribution:list|create|update|delete|run|export`

权限菜单由版本化应用数据迁移 `2026-07-cms-stage5-site-groups-v1` 同步到已有生产库；不是只依赖 seed。
