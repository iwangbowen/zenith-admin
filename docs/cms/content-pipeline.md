# 内容管线

从创建到发布的完整内容生命周期。

## 内容状态机

内容共 5 个状态：`draft`（草稿）→ `pending`（待审核）→ `published`（已发布）/ `rejected`（已驳回）/ `offline`（已下线）。

| 操作 | 允许的源状态 | 目标状态 | 权限 |
|------|-------------|---------|------|
| 提交审核 | draft / rejected | pending | `cms:content:update` |
| 发布 | draft / pending / rejected / offline | published | `cms:content:publish` |
| 驳回（带原因） | pending | rejected | `cms:content:audit` |
| 下线 | published | offline | `cms:content:publish` |
| 移入回收站 | 任意 | offline + deletedAt | `cms:content:delete` |
| 恢复 | 回收站 | draft | `cms:content:delete` |
| 彻底删除 | 仅回收站 | —（硬删除） | `cms:content:delete` |

回收站内容超过 30 天由周期任务自动清理。

## 审核双轨制

站点「内容审核」设置支持两种模式：

- **简单模式**（默认）：提交后进入「待审核」Tab，审核人直接发布/驳回。
- **工作流模式**：`settings.auditMode = 'workflow'`。提交审核自动发起工作流实例（bizType=`cms_content`），流程定义取站点配置或按名称「CMS 内容审核」回退。**流程审核期间禁止手动发布/驳回**；流程通过 → 自动发布 + 静态化 + 推送（回调前会复验内容仍为待审状态，防止长周期流程覆盖人工操作）；驳回 → rejected；撤回 → draft。

## 编辑体验

### 并发保护（编辑锁 + 乐观锁）

- **编辑锁（软锁）**：打开编辑页抢占 Redis 锁（`cms:edit-lock:{id}`，TTL 120s，前端每 30s 心跳续期，离开自动释放）。他人持锁时页面顶部展示「xx 正在编辑」警示，但不阻断操作。
- **乐观锁（硬保护）**：`cms_contents.version` 每次更新 +1。保存时携带 `expectedVersion`，服务端版本不一致返回 **409**，前端提示刷新后重试。二者结合：软锁降低冲突概率，硬锁保证冲突不静默覆盖。

### 自动保存

草稿/驳回状态的既有内容，编辑有改动时**每 30s 静默自动保存**一次，标题栏展示「已自动保存 HH:mm:ss」。新建内容（未落库）不自动保存，避免误创建。

### 草稿预览链接

编辑页「预览」按钮生成**签名临时链接**（HMAC-SHA256，默认 2 小时有效）：

```text
/__cms/{siteCode}/preview/{contentId}?exp={unix}&sig={hmac}
```

免登录访问，可直接分享给审核人；页面顶部注入预览提示条，不缓存、不回写静态文件。预览前有未保存改动会自动落库（保证预览即所见）。

### 版本快照 / 对比 / 回滚

- 每次更新前自动留档版本快照（每内容保留最近 20 版）
- 「历史版本」抽屉支持**对比**（`GET /{id}/versions/{versionId}/diff` 返回字段级差异，前端双栏红绿高亮）与**回滚**（回滚前自动为当前状态留档）

### 媒体库

封面图与模型 image/file 字段支持从**媒体库**（文件中心 `managed_files`）选择已有文件，或就地上传，全站媒资统一复用。组件：`MediaPickerModal`。

## 内容组织

### 内容模型（自定义字段）

模型定义字段元数据（12 种类型：text/textarea/richtext/number/date/datetime/image/file/select/radio/checkbox/switch），值存入 `cms_contents.extend` JSONB。字段可配置必填、纳入检索（searchable）、列表显示。栏目绑定模型后，该栏目下内容编辑页动态渲染模型字段。

### 一文多栏目

内容除主栏目（`channel_id`）外可挂多个**副栏目**（`cms_content_channels`），栏目列表页自动聚合展示主栏目与副栏目内容。副栏目须为本站点列表型栏目。

### 相关文章

编辑页可手动指定**相关文章**（`cms_content_relations`，按选择顺序排序）；前台详情页「相关阅读」区块展示手动关联，不足 5 条时按共同标签自动补齐。

### 定时发布 / 过期下线

- `scheduledAt`：到期自动发布（每分钟检查，Redis 排他锁防多实例重复执行）
- `expireAt`：到期自动下线（同一周期任务处理），适合活动/公告类时效内容

两者都会自动刷新静态页并触发 Webhook。

## 批量操作与导入导出

- **批量**：移动栏目 / 追加标签 / 设置属性（置顶/推荐/热门）/ 站群分发（复制到目标站点为草稿）/ 回收 / 恢复 / 彻底删除，全部事务保护
- **导入**：Excel 批量导入（首行表头：`标题`（必填）/`摘要`/`正文`/`作者`/`来源`），走任务中心异步执行，行级明细 + 断点续跑 + 幂等提交。入口：内容列表「导入」（需先在栏目树选择目标栏目）
- **导出**：接入导出中心（entity `cms.contents`），按当前筛选条件导出 xlsx/csv

## 会员投稿

前台会员可通过投稿接口提交内容（`memberId` 标记来源），提交后直接进入审核流；被驳回可修改后重新提交。
