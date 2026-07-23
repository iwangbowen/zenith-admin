# 互动与运营

## 会员互动（点赞 / 收藏 / 浏览历史）

前台详情页底部渲染**互动条**（点赞/收藏按钮 + 计数，静态页可用）：内联 JS 读取会员 token（`zenith_member_token`），已登录调用 `/api/member/cms/contents/{id}/like|favorite` 并自动上报浏览历史；未登录点击跳会员端登录。

- **点赞/收藏**：会员×内容唯一（`cms_content_likes` / `cms_content_favorites`），计数原子回写 `cms_contents.like_count/favorite_count`，后台内容列表展示「赞/藏」列
- **浏览历史**：`cms_member_view_history` 去重累计，每人保留最近 100 条；会员中心「我的收藏」「浏览历史」页支持取消收藏/清空
- **积分联动**：阅读 +1（日限 10）、点赞 +1（日限 5）、收藏 +2（日限 5）、投稿发布 +10，复用积分中心 `changePoints()` 记账（`bizType='cms_interaction'`）；Redis `SET NX`（30 天窗口）防同内容重复给分 + 日限额计数，取消后再操作不重复给分。规则常量：`@zenith/shared` 的 `CMS_INTERACTION_POINTS` / `CMS_INTERACTION_DAILY_LIMITS`

## 统一互动问卷

后台统一入口 `/cms/interactions`（权限 `cms:interaction:list|manage|batch|export`），不再存在独立 poll/survey 表、API 或菜单：

- `kind=survey|poll`；题目统一支持 single/multiple/text，poll 由服务端约束为**恰好一道选择题**。
- 参与范围 `anonymous|member`，重复策略 `once_per_member|once_per_ip|multiple`，结果可见性 `always|after_submit|after_close|hidden`，验证码 `inherit|none|math|turnstile`。Turnstile 复用统一 captcha adapter，密钥只写不回显，验证失败或依赖故障均 fail-closed。
- 前台页 `/interaction/{code}/`，正文嵌入标记 `[互动:code]`；公开提交 `/api/public/cms/interactions/{siteCode}/{code}/submit`，会员提交 `/api/member/cms/interactions/{id}/submit`。
- 答卷写入 `cms_interaction_responses + cms_interaction_answers`，IP 只保存加盐哈希；`repeat_key` 与显式请求幂等键分别有唯一屏障。选择题按参与人数统计，文本题仅管理接口返回，公共状态与提交响应不会包含 `texts`。题目替换与提交共用 interaction 行锁，已有答卷后不能换题。
- 批量发布/关闭走任务中心 `cms-interactions-batch-status`，含 checkpoint、行级 items、权限复验、取消与重试；答卷导出实体为 `cms.interaction-responses`，原始导出另需 `cms:interaction:export-raw`。

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
- 页面渲染后先从 `/api/public/cms/ads/tokens/{siteCode}` 领取 5 分钟一次性事件令牌，再上报曝光或启用 `/api/public/cms/ads/{id}/click?token=`。令牌签名绑定 site/ad/page、可信代理解析后的访客指纹、通道和可选会员；伪造 UA、篡改或重放均拒绝，静态页同样在浏览器渲染后领取新令牌。
- 点击只允许仍在投放且站点仍启用的广告，跳转目标必须是站内相对路径或无凭据的 http/https URL。
- `cms_ad_events` 追加记录 site/ad/slot、impression/click、发生时间、访客/IP 哈希、UA/设备/来源/路径、发布通道及可选会员。曝光按广告+访客+60 秒桶、点击按 10 秒桶去重。
- 事件插入、`cms_ads` 计数与 `cms_ad_stats` 日聚合在同一事务中按**实际插入事件**批量更新，保证三者一致；一次曝光请求最多 50 个广告，不逐事件多表重写。
- 后台 `/cms/ads` 为「广告 / 事件明细 / 统计」页内 Tabs。事件可按完整维度和时间范围筛选，导出实体 `cms.ad-events`；原始导出另需 `cms:ad-event:export-raw`。
- `cms_ad_event_retention_days`（默认 180）控制周期清理；人工清理和每日调度均提交任务中心 `cms-ad-events-cleanup`，支持 checkpoint/items/取消/重试。

## 会员订阅与发布触达

- `cms_member_subscriptions` 统一 site/channel/author。author 键采用 **Unicode NFKC → trim → 连续空白折叠 → locale lowercase**；展示文本只作快照，不参与唯一性。
- 会员 API 全部使用 `memberAuthMiddleware + currentMemberId()`；订阅 upsert、取消留痕、状态查询、通知开关和分页列表均幂等且不接收外部 memberId。只允许启用站点、启用栏目与已发布公开内容中的作者，避免枚举内部对象。
- 站点页头、栏目页、内容作者旁提供关注按钮；会员中心「我的关注」管理订阅，并直接复用既有签到状态/签到 API。
- 首次有效订阅奖励复用积分中心，`bizType='cms_interaction'`，`bizId='subscribe:{site}:{type}:{subjectHash}'`，受每日 `subscribe` 上限控制；`points_awarded_at` 永久保留，取消不倒扣、重新关注不重发。
- 内容发布事务以系统身份写入 `cms-subscription-notify` outbox 任务并固化订阅 cutoff；worker 每批发送前复验站点、栏目、内容版本仍公开，调用既有 `createMemberNotification()`，以内容版本 bizId 去重，不阻塞发布事务。发布者不能查看收件人任务项，也不能取消、恢复或重启内部通知任务。
- 后台 `/cms/subscriptions` 查看聚合与脱敏明细，权限 `cms:subscription:list|export`，导出实体 `cms.subscriptions`，原始导出另需 `cms:subscription:export-raw`。

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
- `cms_page_block_acls` 以 `pageId + blockId + user|role + subjectId` 授权。平台超管旁路；无 ACL 时继承页面编辑权限，配置任一 ACL 后 fail-closed。
- 页面详情返回每个区块的 `canManage/aclConfigured/disabledReason`。页面更新与 ACL 设置先锁站点，再在事务内重读页面和启用角色授权；无权区块内容与其相对顺序必须不变，但允许删除排在其前面的有权区块。新区块仍要求页面编辑权限，设置 ACL 独立要求 `cms:page:acl`。
- 展示条件仅 `always/guest/member/dateRange`。所有条件区块都由服务端按当前会话与时间过滤，绝不先输出再用 CSS 隐藏；为避免静态产物跨时间边界泄露，当前实现将 guest/member/dateRange 页面统一标记为 dynamic。可选会员认证同时校验 JWT、JTI 黑名单、Redis 会话和会员状态，任一失败按游客。

## 碎片与友链

- **碎片**：模板可引用的后台可编辑区块（html/text/image/json），改文案无需改代码；HTML 统一净化后渲染，JSON 必须是合法 JSON、规范化存储并以安全结构化文本展示

## 表单验证与验证码

- 字段支持文本长度、RE2-compatible 规则、邮箱、手机号、URL、数字范围及字段级自定义错误提示；自定义规则由服务端 `re2js` 线性时间引擎编译执行，`(a+)+$` 等表达式不会触发回溯型 ReDoS。浏览器约束仅用于体验，服务端始终重新验证。
- 表单验证码策略支持继承站点、关闭、算术题与 Cloudflare Turnstile。Turnstile 固定调用官方验证地址并通过统一 `http-client` 启用 SSRF 防护、禁止重定向和超时。
- Turnstile Secret 为 write-only：API 仅返回掩码，空串/掩码保留原值，显式 `null` 清除。
- **友情链接**：名称/URL/Logo/排序，前台页脚渲染
