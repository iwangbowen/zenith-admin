# 互动与运营

## 会员互动（点赞 / 收藏 / 浏览历史）

前台详情页底部渲染**互动条**（点赞/收藏按钮 + 计数，静态页可用）：内联 JS 读取会员 token（`zenith_member_token`），已登录调用 `/api/member/cms/contents/{id}/like|favorite` 并自动上报浏览历史；未登录点击跳会员端登录。

- **点赞/收藏**：会员×内容唯一（`cms_content_likes` / `cms_content_favorites`），计数原子回写 `cms_contents.like_count/favorite_count`，后台内容列表展示「赞/藏」列
- **浏览历史**：`cms_member_view_history` 去重累计，每人保留最近 100 条；会员中心「我的收藏」「浏览历史」页支持取消收藏/清空
- **积分联动**：阅读 +1（日限 10）、点赞 +1（日限 5）、收藏 +2（日限 5）、投稿发布 +10，复用积分中心 `changePoints()` 记账（`bizType='cms_interaction'`）；Redis `SET NX`（30 天窗口）防同内容重复给分 + 日限额计数，取消后再操作不重复给分。规则常量：`@zenith/shared` 的 `CMS_INTERACTION_POINTS` / `CMS_INTERACTION_DAILY_LIMITS`

## 调查问卷

问卷（`/cms/surveys`，权限 `cms:survey:list|manage`）支持**单选/多选/文字**三种题型：

- **配置**：访问标识（前台 `/survey/{code}/`）、说明、发布状态、**允许匿名**开关、答卷时间窗；题目全量替换式编辑（选项每行一个）
- **前台提交**：已登录会员 JS 拦截提交走 JSON API（**一人一份**，DB 唯一约束）；匿名走原生 form POST（IP 24h 限一次 + 蜜罐）；仅会员问卷未登录自动跳登录
- **结果统计**：选择题按已答人数计算选项占比（进度条），文字题展示最近 50 条样本；答卷数冗余计数原子累加

## 评论

- **提交**：前台原生 form POST `/api/public/cms/comments`（静态页可用），Redis IP 限流（60s 5 次）+ 蜜罐字段 + 敏感词过滤，入库后待审核
- **树形回复**（v1.6.0+）：支持两级回复树——回复「回复」时自动挂到顶级评论下；前台每条评论带「回复」按钮（内联 JS 定位表单并填充 parentId）
- **点赞**（v1.6.0+）：匿名点赞 `/api/public/cms/comments/{id}/like`，同 IP 对同评论 24h 去重
- **审核**：后台按状态 Tab 批量通过/拒绝/删除（权限 `cms:comment:audit` / `cms:comment:delete`），过审自动触发详情页静态刷新；列表展示回复对象与点赞数

## 自定义表单

- 表单定义（字段：text/textarea/select/radio + 必填 + 选项），前台按栏目 `settings.formCode` 绑定展示，原生 form POST 提交
- 提交防护：IP 限流 + 蜜罐 + 敏感词 + 按字段定义校验
- **通知邮箱**（v1.6.0+）：配置后新提交异步邮件通知（多邮箱逗号分隔）
- **数据导出**（v1.6.0+）：提交数据抽屉支持导出中心导出（entity `cms.form-submissions`，按表单字段动态生成列）

## 广告

- 广告位（模板引用标识）+ 广告（图片/链接/投放时间窗/排序）
- **点击统计**（v1.6.0+）：前台广告链接统一经 `/api/public/cms/ads/{id}/click` 计数中转后 302 跳转（静态页零 JS 可用），后台列表展示点击量

## 敏感词

全局词库，两种处理方式：**拦截**（replaceWith 为空，命中拒绝提交）与**替换**。应用于评论与表单提交。

引擎（v1.6.0+）：**Aho-Corasick 多模式匹配自动机**，单次扫描 O(文本长度) 完成全词库匹配，千级词库高频提交无 CPU 尖刺；词库 60s 内存缓存，增删改即时失效。

## 采集中心

- 规则：列表页 URL（`{page}` 占位翻页）+ CSS 选择器（列表链接/标题/正文/摘要/封面）+ 清洗选择器
- 执行：任务中心异步（进度/取消/明细），URL 级去重（重复标记 skipped）
- 安全：SSRF 防护（内网白名单 `CMS_COLLECT_SSRF_ALLOWLIST`）
- 图片本地化：远程图片下载转存文件中心并替换 src（每篇 10 张、单张 5MB 上限）
- 入库：`autoPublish` 开启直接发布，否则进草稿箱

## 页面搭建

区块 JSON 装配式页面（`/p/{slug}/`，isHome 可接管站点首页），6 种区块：hero / richtext / image / content-list / columns / fragment。

搭建器（v1.6.0 增强）：

- 区块卡片**原生拖拽排序**（保留上移/下移按钮做键盘可达性兜底）
- SideSheet 底部**内嵌 iframe 实时预览**，保存后自动刷新，可新窗口打开

## 碎片与友链

- **碎片**：模板可引用的后台可编辑区块（html/text/image/json），改文案无需改代码
- **友情链接**：名称/URL/Logo/排序，前台页脚渲染
