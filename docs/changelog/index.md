# Changelog

> 按版本倒序记录 Zenith Admin 的功能更新与变更历史。

---

## v2.18.0 - 2026-09-05

**全域 API 契约统一**：实体 schema、操作路径、入参、响应与凭证类型统一在 shared 定义，服务端路由、前端数据访问、MSW Mock 和 OpenAPI 由同一份契约派生，减少跨层重复声明与接口漂移。

> 本版无新增数据库迁移。二次开发代码若仍依赖服务端 `lib/dtos`、`lib/openapi-dtos` 或前端 `lib/crud-queries`，需改用共享契约与 `contract-query`；这些旧入口已移除。

### Added

#### API 契约基础设施

- `shared/core` 新增 `defineContract` / `op` DSL、实体与操作类型推导，以及主键、分页、日期范围、查询枚举、multipart 等契约积木；`queryEnum()` 将空串视为未筛选
- 契约支持声明业务请求头及管理员 Bearer、设备签名、开放网关凭证类型，服务端校验、OpenAPI 安全方案、前端输入与 Mock 解析保持一致
- 服务端 `defineContractRoute` 从契约生成路由与 OpenAPI，并通过 `typecheck:contracts` 在编译期约束 handler 输入输出
- 前端 `contract-query` 提供 `api`、`urlOf`、`contractKey`、`useApiQuery`、`useApiMutation` 和 `createResourceQueries`；资源工厂支持数值 / UUID 主键及没有详情端点的资源
- MSW 新增契约绑定的 `mock(op, resolver)`；共享层接入 Vitest，前端 API 路径测试对照服务端路由快照，约束仍以字面量声明的请求与 Mock 路径

### Changed

#### 全域接入与旧实现收口

- 权限组织、平台基础能力、规则、License、文件、企业网盘、任务、通知、Chat、会员、支付、工作流、CMS、Wiki、报表、分析、AI、公众号、开放平台、IoT、短链、营销及业务示例统一接入共享 API 契约
- 服务端挂载取契约 `basePath`，实体类型由 schema 推导；移除手写 DTO 层及其漂移基线检查，`openapi-schemas` 保留响应信封与校验钩子，通用输入积木归入 `shared/core`
- 前端域 hooks 与页面调用统一使用契约输入形状，上传、下载、流式请求地址和查询缓存键由契约派生；会员端、移动审批端继续使用各自请求客户端
- 开放 CMS / IoT 端点目录从契约生成；Mock 的路径、请求解析与响应类型绑定同一操作，清理无真实服务端对应的旧 handler
- 用户行为事件类型与枚举归入 analytics，清理残余手写类型与无引用 schema；根测试命令纳入 shared 契约用例
- 架构文档、Zenith Skill 与 CRUD 指引同步契约标准；新增平台基础能力专题，明确 `platform` / `files` / `drive` 的领域与文档映射

### Fixed

- 修正邮件 / 短信测试发送、工作流实例迁移预检与迁移的错误请求 URL
- 数据库查询收藏的更新方法由 PATCH 对齐服务端实际的 PUT
- 应用版本统计接口按静态前缀优先挂载，避免 `/api/app-releases/stats` 被参数路由遮蔽
- Mock 在缺少 JSON 请求头时按空对象进入请求体校验，与服务端保持一致：可选字段允许省略，必填字段仍返回 400
- 功能文档将过时的「18 个路由领域」修正为当前 22 个，并补充统计来源；文件存储文档对齐公开内容读取与网盘秒传边界

---

## v2.17.0 - 2026-09-05

**新增「企业网盘」领域**：面向组织内文件存放、协作共享与治理的完整模块。以空间（个人 / 部门 / 协作）为容量与权限边界，
提供文件夹树、四级协作角色 × 四类授权主体、外链分享、版本、回收站、全文检索与治理审计，并完全复用文件与存储模块的
`managed_files` / 多 provider / 分片上传底座。专题文档见 [企业网盘](/drive/)。

> 本版含数据库迁移 `0008_drive_module`（新增 15 张 `drive_*` 表；`managed_files` 新增 `visibility` / `content_hash` 列，`size` 扩为 bigint）。
> 升级后执行 `npm run db:migrate && npm run db:seed` 以写入 19000 段菜单、`drive_*` 系统配置并为「普通用户」角色授予网盘基础权限；
> 授权版需在套餐中启用 `drive` 功能（`pro` 预设已包含）。

### Added

#### 企业网盘：空间与权限

- 三类空间：个人空间（用户首次访问自动创建）、部门空间（管理员创建或按设置为用户所属部门自动创建，部门及子部门成员按默认成员角色访问）、协作空间（用户自建，成员表 + 可选全员默认角色，支持所有权转让）
- 四级协作角色 `viewer` 仅预览 / `downloader` 可下载 / `editor` 可编辑 / `manager` 管理者；有效角色 = 菜单 RBAC ∧ max(空间角色, 节点授权)，`viewer` 在内容接口层被拒绝 `?download=true`
- 节点授权支持用户 / 部门 / 角色 / 用户组四类主体，沿目录树继承，任意文件夹可断开继承重新定义访问边界；空间成员与节点授权共用同一套主体编辑器
- 每个空间独立配额（跟随系统默认或自定义）、版本上限、外链开关；上传时原子预留配额，达到阈值向管理者发送配额预警

#### 企业网盘：文件操作

- 目录浏览列表 / 网格双视图、面包屑、排序、目录内搜索、右键菜单、多选批量（下载 / 移动 / 复制 / 删除）、拖拽上传、图片缩略图
- 上传：≤ 5MB 简单上传，大文件分片断点续传；客户端 SHA-256 秒传；同名冲突策略（保留两者 / 覆盖为新版本 / 跳过，可对本批次统一）；扩展名黑名单 + 可执行文件头识别，绕过通用 MIME 白名单
- 版本：覆盖上传或手动上传新版本；历史版本可下载、回滚（生成新版本）、删除；超出上限自动清理最早版本并释放容量
- 外链分享：令牌 SHA-256 存储 + 加密副本；可选访问密码、有效期（受全局最长天数约束）、访问次数、仅预览 / 可下载；公开页 `/public/drive/:token` 密码门 → Redis 访问会话；访问 / 下载 / 密码错误留痕；登录用户可将外链内容转存到自己的网盘；公开端点独立限流
- 回收站：删除进入回收站，支持还原（原目录已删时回落到空间根并自动改名）、彻底删除、清空；超期项目由保留策略彻底清除并释放存储对象
- 个人视图：与我共享（含授权来源）、我的收藏、最近访问、我的外链；全站搜索支持「包含正文」检索文本文件正文并返回命中片段
- 协作：签出锁定、空间标签、评论、节点动态时间线
- 批量打包下载小于阈值同步返回 zip，超阈值转任务中心并在完成后通知；跨空间大子树复制、容量重算、全文索引补建走任务中心

#### 企业网盘：治理与设置

- 空间治理：统计概览（空间 / 文件 / 占用 / 回收站与版本占用 / 有效外链 / 今日上传下载）、14 天趋势与文件类型占用图、空间列表治理（配额 / 状态 / 默认角色 / 所有者 / 外链开关）、创建部门空间、删除空间
- 外链治理：全站外链检索、访问记录、管理员撤销；动态审计：按空间 / 操作人 / 动作 / 时间检索全部网盘动态
- 网盘设置：各类空间默认配额、部门空间自动创建、回收站保留天数、版本上限、配额预警阈值、外链总开关 / 最长有效期 / 强制密码、禁止扩展名、缩略图与正文索引开关
- 通知事件 `drive.node.shared` / `drive.space.member_added` / `drive.space.quota_warning` / `drive.batch_download.ready` 接入通知中心；`drive_activities`、`drive_share_access_logs`、`drive_nodes` 回收站接入数据保留策略
- Demo 模式：`/api/drive/*` 全量 MSW 实现（含外链密码门、上传同名策略、治理统计）

### Changed

- `managed_files` 新增 `visibility`（`public` / `restricted`）与 `contentHash`：`restricted` 文件在通用 `GET /api/files/{id}/content` 返回 404，只能经业务域自己的内容接口读取；文件管理列表默认只展示 `public` 文件；`size` 改为 bigint
- 分片上传 `chunkedUpload` 支持自定义 `endpointBase` / `initExtra` / `resumeScope`，供业务域复用同一套断点续传
- `fetchProtectedFile` 对 `/api/drive/public/*` 公开端点裸请求，匿名访客预览失败不再触发登录态刷新与跳转
- 授权功能目录新增 `drive` 功能项（菜单根 19000），`pro` 预设默认包含

---

## v2.16.0 - 2026-09-04

**全库重复代码收口 + 列表筛选统一**：对 server / web / shared 做了一次全域重复代码排查，把多套并存的等价写法收口为单一实现（WHERE 构造、模糊匹配、共享 Zod 契约、鉴权请求与流式读取、危险操作确认、通用小工具、树形转换、HTTP Range、运维路由 host 解析、租户可用性判定、CMS 主题公共件与发布副作用取数），并把列表页所有单选枚举筛选统一到 `FilterSelect` / `StatusSelect`，枚举选项统一由 shared 导出。

> 本版无数据库迁移。前端用户可感知的变化：列表页筛选下拉统一为「占位描述空值 + ✕ 清除」形态（不再有「全部 X」选项或「请选择 X」占位），宽度统一；日志文件页级别筛选的「全部级别」不再展示总行数计数。

### Changed

#### 前端：列表筛选与枚举选项

- `components/search-filters` 新增 `FilterSelect`（占位「全部 X」、`showClear`、默认宽度 120、清空回调 `undefined`，支持平铺 `items` 与分组 `groups`），`StatusSelect` 改为其占位固定「全部状态」的特化；列表页搜索栏（含 Tab / 抽屉 / 展开行内子列表）的 406 处单选枚举筛选全部改用，去掉手写 `showClear` / `style={{ width }}`、「全部」哨兵选项与「请选择 X」占位
- 筛选字段空值统一为 `undefined`：各页 `SearchParams` 枚举字段声明为可选、`defaults` 与重置写 `undefined`，去掉 `''` / `'all'` 哨兵比较；相关 query hook 参数类型同步
- 枚举下拉选项由 shared 各域导出的 `XXX_OPTIONS`（`createLabelOptionsFromMap(XXX_LABELS)` 派生）提供，页面不再手写 `Object.entries(XXX_LABELS).map(...)`；shared 补齐 cms / payment / open-platform 共 38 组 `_OPTIONS`

#### 前端：请求层、确认框与工具

- 带鉴权的非 JSON 请求统一经 `request` 层：`request.fetchRaw(url, init)` 返回原生 `Response`（token、401 刷新重试、失败统一提示、Demo 拦截），`utils/streaming.ts` 提供 `streamText` / `readTextStream` / `readSseStream`，二进制走 `request.getBlob(url, init?)`，第三方上传组件的请求头取 `request.authHeaders()`；日志 / 网络诊断 / 服务日志流、进程与监控 SSE、AI 对话与竞技场、文件预览与下载、富文本与图片上传、分片上传全部接入，`chunked-upload` 不再接收 `apiBaseUrl` / `token`
- 危险操作确认统一走 `confirmDanger` / `confirmDelete`，async 流程用新增的 `confirmDangerAsync` 取布尔结果；移除页面内 `new Promise<boolean>` 包 `Modal.confirm` 与手写 `okButtonProps: { type: 'danger' }`
- `@zenith/shared/core` 新增 `escapeHtml` / `escapeRegExp` / `clamp` / `formatBytes` / `buildTree` / `mapTree`，前后端与 Mock 的等价本地实现全部删除；`web/utils/format.ts` 只保留 `formatDurationMs`；CMS 栏目选择树收口到 `pages/cms/channel-tree.ts`
- 平铺转树统一用 `buildTree`（菜单 / 部门 / 区域 / CMS 栏目・站点・素材目录 / 报表目录 / Wiki 目录 / Mock 栏目树），树节点映射统一用 `mapTree`

#### 后端

- WHERE 条件合并只保留 `buildWhere`，模糊匹配只保留 `keywordCondition`（支持 `SQL` 列表达式与 `prefix` 模式），转义在其内部完成
- 路由请求体 / 查询 schema 统一引用 shared（identity / member / messaging / platform / workflow 等域），shared 侧 Zod 契约按现网接口对齐（登录设备信息、用户性别与头像、菜单查询串 / 外链 / 嵌入 / 保活、排序参数 `z.coerce`、套餐功能必填、脱敏字符长度、配置类型枚举、流程分类与发起范围等）
- 启动入口 `src/index.ts` 固定第二条 import 为 `@hono/zod-openapi`（测试 `setupFiles` 同步），保证 shared 的 schema 一律在 `.openapi()` 原型补丁之后构造；新增 `index.import-order.test.ts` 锁定前两条 import 顺序
- 租户可用性判定统一为 `lib/tenant` 的 `isTenantActive` / `isTenantExpired`：管理员与会员鉴权中间件、登录 / 续签、OAuth2 令牌、企业身份源共用，到期边界统一为 `expireAt <= now`
- HTTP Range 解析与分片响应头收口到 `lib/http-range`（文件下载与公开应用包下载共用）；运维路由 `hostId` 查询参数统一为 `HostQuery` / `resolveHostIdQuery`，子进程输出转发统一为 `lib/http-stream` 的 `streamProcessOutput`
- CMS：发布后搜索引擎推送与分享短链共用 `loadPublishedContentTarget` 取内容目标；主题 `_shared` 新增 `ArticleNav` / `RelatedArticles` / `AttachmentList`，default / magazine / gov-portal / news-portal 详情模板复用（渲染 HTML 不变）

#### 依赖

- Vitest 4.1.11 → 5.0.0

### Fixed

- 模糊搜索关键字含 `%` / `_` / `\` 时 9 处手写 `like` 未转义导致的误匹配
- 租户到期时刻在 OAuth2 令牌校验与企业身份源登录路径按开区间判定、与管理员 / 会员鉴权不一致的问题
- 接口限流规则表「命中 / 拦截」列加宽，避免计数折行
## v2.15.0 - 2026-09-04

**安全审计整改 + IoT 遥测接入性能重构**：按一次全库安全审计逐项收口——租户 / 平台超管边界、运行时密钥、OAuth state、会话吊销与 refresh 轮换、WebSocket 鉴权、数据库控制台最小权限角色、URL 与富文本注入面、日志查看器路径、Electron 更新链路、部署暴露面与 CSP / 帧保护；IoT 遥测明细改为原生日分区表，接入热路径微批写入，单帧 CPU 降至约 1/9。

> ⚠️ 本版有数据库迁移（0005 ~ 0007）与**不兼容变更**（不考虑历史兼容，直接切换）：
> - 运行时密钥：非开发环境 `JWT_SECRET` 无默认值且新增必填 `FIELD_ENCRYPTION_KEY`（字段加密不再派生自 JWT_SECRET），`npm run secret:generate` 生成；已加密字段（MFA 密钥、SSH 凭据、渠道密钥等）需重新录入。
> - 会话模型：refresh token 改为一次性消费并轮换，登出 / 强制下线 / 改密即吊销；升级后存量 refresh token 全部失效，用户需重新登录。
> - WebSocket：`?token=` 查询串不再接受，access token 经 `Sec-WebSocket-Protocol: zenith-auth, <token>` 传递（前端已同步）。
> - 迁移 0007 创建只读角色 `zenith_readonly` 需要应用数据库用户具备 `CREATEROLE`（或 superuser）；不满足时迁移只打 WARNING，数据库控制台退化为「只读事务 + 闸门」防护。
> - Docker Compose：`POSTGRES_PASSWORD` / `REDIS_PASSWORD` 改为必填、PostgreSQL / Redis 不再映射宿主机端口、API 端口默认只绑定 `127.0.0.1`；`npm run secret:generate -- --docker` 一次生成四个必填项。
> - 日志查看器只允许读取 `LOG_DIR` 与 `LOG_VIEWER_ROOTS`（默认 `/var/log`）内的文件。
> - psql 数据库终端额外要求 `system:terminal:execute`。
> - IoT 遥测明细表重建为分区表，不迁移历史明细（影子与小时聚合不受影响）。

### Security

#### 身份与租户边界

- 企业身份源 / 通讯录同步 / SCIM / 第三方 OAuth 自动建号全部经 `role-grant.ts` 校验：默认角色不得含平台保留角色（`super_admin`），角色必须归属目标租户，非平台管理员只能选择本租户角色；身份源 / 同步源改为按 `resolveManagedTenantId` 归属租户，跨租户读写按不存在处理；SSO 登录进入统一 `completeLoginWithMfa`（MFA 策略与新设备风控生效），前端登录 / 回调页处理 MFA 挑战；平台超管账号不参与自动匹配与目录同步
- 自动关联既有账号改为显式开启（`identity_providers.auto_link_by_email`、`oauth_configs.auto_link_by_email`，迁移 0005 / 0006）：仅 OIDC `email_verified` 且邮箱唯一、账号启用、非平台超管才关联；移除按用户名匹配
- 第三方 OAuth：`state` 改为 Redis 单次令牌（含 provider / 意图 / 绑定用户），回调与绑定必须携带并匹配；新增 `GET /api/auth/oauth/{provider}/bind` 绑定授权入口，绑定意图不能用于登录；OAuth 配置管理改为平台级（多租户下仅平台管理员）；GitHub 通过 `/user/emails` 取已验证邮箱
- 在线会话管理按租户范围隔离：平台超管平台视角看全部、租户视角只看该租户，租户管理员只看本租户，非平台超管看不到也不能踢掉平台超管会话，越界按 404 处理

#### 密钥与会话

- 运行时密钥：`lib/secrets.ts` 统一生成 / 校验 / 开发回退，`FIELD_ENCRYPTION_KEY` 独立承担字段级 AES-256-GCM，非开发环境缺失或占位值时服务拒绝启动（`assertRuntimeSecrets`）；解密失败抛 `SecretDecryptError` 并映射为可读错误
- 会话吊销闭环：Redis 新增 `refresh:{jti}` 授权 key，`/api/auth/refresh` 与 `/api/member/auth/refresh` 一次性消费并轮换到新 `jti`（旧 access / refresh 同时作废，重放 401，被盗 refresh token 最多只能用一次）；登出、强制下线、改密 / 重置密码、管理员重置密码、禁用 / 删除用户统一吊销（拉黑 access + 删会话 + 删授权），修复「强制下线 2h 后复活」；前端刷新后以响应中的新 refresh token 覆盖本地保存，账号切换器同步
- 短信验证码：`devCode` 仅 `NODE_ENV=development` 回传，明文永不落日志；未配置渠道返回 503、发送失败 502 并回滚发码计数；修复匿名上下文下默认短信配置查询失败导致从未真正发送的问题

#### 注入面与输出编码

- 数据库控制台 / 导出 / 报表数据集 / 数据质量自定义 SQL 全部在只读事务内 `SET LOCAL ROLE zenith_readonly` 执行（迁移 0007 创建的 NOLOGIN 最小权限角色，运行期新 schema 自动补齐授权），`pg_read_file` / `COPY TO PROGRAM` / `lo_export` / `pg_authid` 等由 PostgreSQL 直接拒绝；危险函数黑名单收口到 `assertNoDangerousSqlFunctions` 并扩充 `set_config`、`table_to_xml` / `query_to_xml`、`dblink_*`、备份 / 复制控制与 Unicode 转义标识符；导出与 EXPLAIN 补齐只读白名单校验，原生 WHERE 片段同样过闸门
- 工作流域全部出站 HTTP（数据源、连接器、事件订阅、自动化 Webhook、节点监听、触发器、外部派发、补偿动作）改走 `lib/workflow-outbound.ts`：强制 SSRF 防护 + `WORKFLOW_OUTBOUND_ALLOWED_HOSTS` 内网白名单，连接器路径限定同源，URL 模板占位值百分号编码，保存时校验静态地址
- 用户可控 URL 统一限定 `http(s)`：`shared/core` 新增 `url.ts` 判定与 `httpUrl` / `linkUrl` 构造器（`z.url()` 会放过 `javascript:` / `file:` / `data:`），聊天链接预览 / 媒体消息 / 卡片、短链、AI、运维外链制品、CMS 采集、开放平台 logo、公众号回复与模板消息、工作流数据源 / 连接器 / 按钮 / Webhook / 附件 / 补偿动作、报表 Webhook / 环境地址 / 嵌入来源、营销与埋点落地页、OIDC redirectUri、IoT 转发目标全部切换；报表下钻 URL 仅 http(s) 模板、iframe 组件 src 仅 http(s)、图片允许站内路径；前端 `utils/safe-url` 过滤 href / src / `window.open`，iframe 同源嵌入去掉 `allow-same-origin`
- 公告富文本在服务端经 `sanitizeCmsHtml` 净化落库；`stripHtml` 改用惰性 `DOMParser`，消除 `<img onerror>` 解析期触发的存储型 XSS
- CMS 前台表单回跳地址改用 URL 解析判定同源，堵住 `/\evil.com` 开放重定向
- 日志查看器限定目录白名单（`LOG_DIR` + `LOG_VIEWER_ROOTS`）：本机 realpath 后判定归属并拒绝目录 / 设备 / FIFO，远端路径 POSIX 规范化后同样限定；新增 `GET /api/log-viewer/roots` 供页面提示

#### 实时通道与终端

- WebSocket 升级鉴权对齐 HTTP 口径（`lib/ws-auth.ts`）：拒绝会员 / refresh token、实时校验用户与租户状态、检查吊销黑名单，`/api/ws` 与终端 / 监控端点共用；`WebSocketServer` 设置 `maxPayload` 64 KiB，只回显 `zenith-auth` 子协议
- `/api/ws` 入站帧 zod 校验（仅 `ping` / `chat:typing` / `rtc:*`）与每连接令牌桶限速；typing 与 rtc 的身份字段由服务端按连接主体覆写；`callId` 绑定发起时的会话，后续信令只在会话成员间中继、定向目标必须是会话成员，房间随 reject / busy / cancel / leave / 断线回收
- psql 数据库终端视同服务器 shell（`\!` / `\copy`），新增要求 `system:terminal:execute`；只读模式 PGOPTIONS 追加 `role=zenith_readonly`

#### 客户端、部署与响应头

- Electron：移除渲染进程改写更新服务器的 IPC，地址来源固定为 `userData/update-config.json` > 打包期 `ZENITH_UPDATE_SERVER` > 开发环境变量且强制 https；制品下载须与更新服务器同源、热更包 SHA256 必需；`safe-unzip.ts`（yauzl）替代存在符号链接越界写入漏洞的 `extract-zip`；`will-navigate` 只允许应用自身，`setWindowOpenHandler` 仅对 http(s) / mailto 调用 `shell.openExternal`；electron-builder 配置收口为单一来源并支持 `ZENITH_WIN_PUBLISHER_NAME` 启用安装包签名校验
- Docker：`docker-compose.yml` 去掉 PostgreSQL / Redis 宿主机端口映射并要求口令，Redis 始终 `requirepass`，API 端口默认绑定 `127.0.0.1`（`API_BIND` 可放开）；新增 `docker-compose.debug.yml` 排障叠加文件；Dockerfile server 阶段以 `USER node` 运行，nginx 升级 1.30-alpine
- CSP 与帧保护：服务端直出 HTML（CMS SSR / 静态化产物、表单提示页、短链 / 退订页）按正文内联脚本 sha256 哈希下发 CSP（不含 `'unsafe-inline'`），`object-src 'none'` / `base-uri 'self'` / `frame-ancestors 'self'`，`secureHeaders` 的 `X-Frame-Options` 改为 `SAMEORIGIN`；Vite 构建期向三个 SPA 入口注入 CSP `<meta>`；nginx 全站 nosniff / Referrer-Policy / 帧保护，仅 `/public/report/` 公开仪表盘嵌入不下发帧保护头

### Added

#### IoT

- 告警记录「处理详情」查看：弹窗展示设备 / 级别 / 告警内容、触发与升级时间、认领人、处理方式 / 处理人 / 处理时间与备注；列表接口补充 `resolvedByName`
- 新增 `scripts/iot-load-test.ts` 接入压测脚本（HTTP / WS，吞吐与延迟分位，按 5s 窗口时间线）

#### 工具

- `npm run secret:generate -- --docker` 额外输出 URL 安全的 `POSTGRES_PASSWORD` / `REDIS_PASSWORD`；根脚本支持透传参数

### Changed

#### IoT 遥测接入（性能）

- `iot_telemetry` 重建为按 `reported_at` 的 PostgreSQL 原生 RANGE 日分区表（迁移 0004），去掉从不按值查询的 bigint 主键与冗余 `created_at`，新增 BRIN 索引；`iot-partitions.service` 启动 + 每小时滚动预建未来 7 天分区，写入命中「无分区」按批次内日期补建后重试；保留策略按分区上界整表 DROP
- 新增 `iot-ingest-buffer`：≤100ms / ≤1000 行攒批，明细多行 INSERT + 影子多行 upsert（RETURNING 直供推送）+ 一次 INCRBY，停机前排空；影子合并改为批量版；设备行按 SN 缓存并在管理端变更时主动失效；WS 单连接帧串行处理 + 积压上限 100 帧
- 产品 `validationMode` 并入物模型缓存；阈值告警 / 场景联动 / 异常检测 / 数据流转移出接入响应路径，进入按设备串行的派生队列；仪表盘「今日上报」改读 Redis 日计数器
- 新增 `lib/ttl-cache`（单飞 + 过期用旧值后台刷新 + 抖动），物模型 / 设备行 / 告警规则 / 联动 / 流转 / 异常基线 / 保留天数缓存全部切换，修复高并发上报时缓存同刻击穿导致事件循环卡死；`lib/datetime` 的 Date / 时间戳格式化走缓存的 `Intl.DateTimeFormat` 快路径

#### 数据库运维

- 索引健康判重改为按 `pg_get_indexdef` 定义正文比较（表达式索引、部分索引谓词、不同访问方法不再误判），分区叶子索引沿 `pg_inherits` 归并到父索引统计并显示「N 分区」标签

#### 文档站

- 首页 Bento 插画精修：共享 `art-base.css` 基元与 `ArtIcon.vue` 线性图标，修复溢出、截断与失真

### Fixed

- 迁移 `0001_extensions` 不再创建 `ai_kb_chunks.embedding_vec` 孤儿列（向量已全部存放于 Mastra PgVector）
- 表格 Tag 列宽不足导致的标签溢出（49 处）；数据库运维活动连接 / 索引健康 / 表维护表格列宽与换行

---

## v2.14.0 - 2026-09-03

**表格列宽体系重构 + 登录入口按配置显示**：全站表格改为「单弹性主列 + 其余固定宽」布局，操作列宽度按统一公式重算并把状态特有 / 低频动作收进「更多」，`scroll.x` 全部由组件推导；登录页第三方登录入口只显示后台已启用且凭据完整的 provider；文档站首页重构为模块矩阵落地页。

> ℹ️ 本版无数据库迁移。前端约定变更：列定义新增 `minWidth`（弹性主列专用），`createOperationColumn` 的 `width` 改为必填，页面不再传 `scroll.x`——开发期违反时控制台会给出一次告警。

### Added

#### 表格布局

- 新增 `components/table-flex-columns.ts`：`ConfigurableTable` 按「有且只有一个弹性主列（`minWidth`）+ 其余固定 `width`」解析列布局，`scroll.x` 由各列宽度之和（含勾选 / 展开列各 48px）推导，容器更宽时只有主列吸收剩余空间，操作列等固定列不再被按比例拉宽；虚拟化表格为弹性列计算显式宽度并锁定表头 `<table>` 宽度，纵向滚动条出现 / 消失与 body 重建都会重新度量，表头 / 表体不再错位
- `ConfigurableTable` 开发期告警：所有列都写了 `width`（兜底挑列）、页面传入 `scroll.x`（被忽略）、操作列内容宽超过列内可用宽（溢出）三类问题各提示一次，指向对应规范
- `copyableNoColumn(title, key, { flex: true })` 可把可复制编号列声明为弹性主列
- 新增 `table-flex-columns.test.ts`（12 例）锁定普通 / 虚拟化 / 兜底 / 分组表头等解析行为

#### 登录与第三方账号

- 新增公开接口 `GET /api/auth/oauth/providers`，只返回已启用且凭据完整的 provider key（企业微信另需 corpId）；登录页只渲染返回的入口，接口不可用时整块不显示；个人中心只列已启用的 provider，已绑定但后来停用的仍可解绑
- `shared/identity` 新增 `OAUTH_PROVIDER_LABELS`，新增 `OAuthProviderIcon` 组件，登录页 / 个人中心 / OAuth 配置页文案与图标定义收口

#### 文档站

- 首页改为 Bento 模块矩阵落地页：Hero → 20 个功能格子（内嵌纯 CSS 微型界面、整卡跳转对应文档）→ 数据条 → 三步启动 → 技术栈 → CTA，支持亮 / 暗色与移动端单列；版本号由 Vite define 从根 `package.json` 注入

### Changed

#### 操作列

- `createOperationColumn` 的 `width` 改为必填，取值统一为「最宽内联组合的内容宽 + 40，向上取整到 10」（编辑 / 删除 150、单个 2 字动作 100、编辑 / 删除 + 更多 180、三个 2 字动作 210）；全站 210 处操作列按此重算
- 桌面端内联动作不超过 3 个；动作随行状态变化的页面只保留各状态都存在的高频动作内联，状态特有 / 低频动作收进「更多」（告警事件、公告、待审批、用户组、优惠券、公众号群发、事件订阅、终端录制、CMS 资源库、用户分群、补偿工单、意见反馈、目录同步源、报表数据集、CMS 产物 / 评论、频道消息等），「设为默认 / 测试连接 / 重置密钥」类一次性动作统一进「更多」
- 按 Tab 分状态的列表（CMS 内容 / 评论、填报记录）按 `activeTab` 分别给 `width` 与 `desktopInlineKeys`
- 操作日志、会话时间轴、埋点站点、工作流 Token / 作业、链路失败、通知策略 7 处手写操作列改用 `createOperationColumn`；作业重试 / 跳过等由 `Popconfirm` 包裹 label 改为 `Modal.confirm` / `confirmDanger`
- 171 个页面的主文本列 `width` 改为 `minWidth`，菜单 / 地区 / 进程管理去掉手工测量容器宽度的 ResizeObserver；101 处页面手写的 `scroll.x` 删除，`OperationLogsTable` 不再接受 `scroll`

#### 后端

- 登录页 OAuth provider 列表与 `isProviderConfigured` 共用同一判定，顺序固定为 `OAUTH_PROVIDERS` 声明顺序

#### 文档

- skill：`constraints-frontend` 新增弹性主列 / 禁止 `scroll.x` / 操作列内联数与宽度公式约束；`ui-patterns` 的「操作列宽度估算」「虚拟化表格」重写为「表格列宽」「操作列」「虚拟化表格」三节（度量常量以实测为准，「更多」按钮 24）；`crud-frontend` 模板改为 `minWidth` 主列；`module-modification` 加字段 / 加动作时的列宽复核；`troubleshooting` 新增列宽异常症状定位
- `docs/frontend/components.md` / `ui-conventions.md` 同步弹性主列与操作列规则；`oauth.md` / IAM 文档补登录入口接口与展示规则

### Fixed

- 表格操作列被拉宽到配置值的一到三倍（所有列固定宽 + `table-layout: fixed` 按比例分配余量），共 66 处
- 菜单 / 地区 / 进程管理虚拟表格横向溢出，以及收起 / 展开侧边栏后表头与行错位
- A/B 实验操作列「删除」被裁切；邮件 / 短信 / 站内信模板、标签、签到规则、IoT 告警等 14 处操作按钮贴边挤压 padding；14 处操作列明显偏宽（单个「详情」占 200 等）
- 告警事件操作列按最宽状态配 300px、常见行仅两个按钮留下大片空白；公告定时发布态四个动作超出列宽；存储文件浏览抽屉文件行动作溢出
- 链路追踪「最近失败」与通知策略事件表为原生 `Table`，操作列随容器被拉宽
- 登录页 GitHub / 钉钉 / 企业微信 / 飞书入口未配置时仍常显、点击才报「尚未配置」
- 文档站本地 `docs:dev` 因 fastdom CJS 互操作白屏（显式预构建 mermaid）

---

## v2.13.0 - 2026-09-02

**内网 HTTP 可用性 + 部分更新语义修正**：管理后台在非安全上下文（`http://内网IP`）下补齐 `crypto.randomUUID` 与剪贴板能力；PUT / PATCH 部分更新统一经 `partialForUpdate` 派生，杜绝省略字段被默认值改写；菜单种子改为只新增不更新，后台对内置菜单的调整不再被重跑 seed 回写。

> ℹ️ 本版无数据库迁移。两处行为变更需留意：① 集合赋值端点（用户角色 / 菜单 / 数据权限、CMS 站点 / 栏目成员、套餐功能、Wiki 成员）与 OAuth 配置更新不再为缺失字段填默认值，字段缺失返回 400；② 修改既有内置菜单的结构字段需单独提供数据迁移（`drizzle-kit generate --custom`），种子只负责新菜单的初始定义。

### Added

#### 平台 API 兜底（非安全上下文）

- `@zenith/shared/core` 新增 `uuidV4`（仅 `getRandomValues` 组装 RFC 4122 v4）与 `randomUUID`（优先原生）；web 三个入口首条 import `polyfills.ts`，`crypto.randomUUID` 缺失时挂到实例上，业务代码与第三方库继续使用标准 API；analytics-sdk 嵌入第三方页面不改宿主全局，改为直接调用共享实现
- 新增 `@/utils/clipboard`：`copyText`（Clipboard API → 隐藏 textarea + `execCommand` 回退，复制后还原原有选区与焦点）、`copyTextWithToast`、`readClipboardText`、`canWriteClipboardItems`；全站 43 处复制 / 粘贴调用收口，删除 4 份本地实现，粘贴与图片写入不可用时给出明确降级提示
- ESLint 防复发：web 禁止裸调 `navigator.clipboard.writeText` / `readText`，analytics-sdk 禁止直接调用 `crypto.randomUUID`，server / shared 禁止直接调用 `.partial()`

#### 部分更新原语

- `partialForUpdate()` 改为递归剥离默认值（穿透 optional / nullable / readonly / pipe 并保留包装，只移除 ZodDefault / ZodPrefault），新增 `partial-for-update.test.ts` 锁定行为；`app.contract.test.ts` 新增部分更新契约——PUT / PATCH 请求体顶层属性不得带 default，整体替换 / upsert 端点显式登记并自动清理失效条目

### Changed

#### 后端

- server 路由内联 schema、`lib/dtos` 与 shared 各域共 41 处 `.partial()` 全部改为 `partialForUpdate(...)`；payment / cms 的更新 schema 清理与之重复的字段重声明
- 菜单种子由按 id upsert 改为 `onConflictDoNothing`：改名 / 图标 / 排序 / 禁用 / 隐藏 / 换父级等后台调整在 `npm run dev` 重跑 seed 后保留
- `listUserMenuTree` 剔除禁用菜单的整棵子树，禁用目录下仍启用的子菜单不再因父级缺失被提升为侧边栏根节点
- 日志：Windows 且 stdout 为终端时控制台输出留在主线程走 `process.stdout`（pretty 模式惰性加载 pino-pretty，文件仍走 pino-roll worker，`multistream` 合并）；管道 / 容器场景保持原有全 worker 输出

#### Web 体验

- 偏好设置：「飞书蓝」置于主题色预设首位并作为默认值，导入偏好占位示例与 PWA manifest `theme_color` 兜底值（`VITE_APP_THEME_COLOR` 默认 `#3370ff`）同步对齐
- 日志文件：关闭自动换行横向滚动时行号列固定在左侧，激活行指示条随列一起固定

#### 文档

- `constraints` / `crud-backend` / `module-modification` / `api-conventions` / `swagger` 同步部分更新规范（请求体不带 default、关联集合「省略即不改动」的服务层写法）；`constraints-frontend` 记录剪贴板 / `randomUUID` 收口位置与 polyfill 边界；`seed-config` / `getting-started` / `deployment` 说明重跑 seed 不覆盖已调整的内置数据

### Fixed

- 内网以 `http://ip` 访问时登录（设备 ID）、支付幂等键、复制按钮等因 `crypto.randomUUID` / `navigator.clipboard` 不存在直接报错
- PUT 只修改 `status` 却同时改写 `type` / `parentId` / `sort` 等未提交字段（菜单禁用后目录变菜单即此类）
- Windows 终端下 pino 控制台输出中文与符号显示为乱码（worker 直写 fd 被按 GBK 代码页解码）
- 日志文件页横向滚动时行号随正文一起滚出视口

---

## v2.12.0 - 2026-09-02

**CMS 安全与边界收敛 + 会话主体实时校验**：对照 CMS 全页面巡检结论集中修复存储型 XSS / URL 协议、跨站读取、规范路径分裂、发布缓存一致性、导入导出闭环与前端选中/能力状态问题；管理员与会员令牌每次请求回读账号与租户真实状态。

> ℹ️ 本版新增增量迁移 `0002`/`0003`（`cms_sites`、`cms_publish_artifacts` 增加 `public_revision` 列），部署后执行 `npm run db:migrate` 即可，无需重建数据库。

### Added

#### CMS

- 服务端统一生成内容 `canonicalUrl` / `previewUrl`（按栏目归档规则与自定义静态路径），内容列表预览、发布中心、检索测试（新增「访问地址」列）全部消费同一结果
- 站点 `publicRevision` 公开修订号：影响公开渲染的写入原子递增，发布任务与静态产物以此 fence 拒绝旧任务晚写；站点配置类变更（互动、模板引用、内链词等）统一走 outbox 触发站点级刷新
- 内联脚本与 JSON-LD 使用 `serializeJsonForScript` 安全序列化，`</script>` 无法打断脚本
- 内容批量属性补齐「标记 / 取消原创」；素材移动改为独立「移动到目录」弹窗选择目标，不再借左侧树切换表达目标
- 导出按钮支持 `permission` 门禁；种子菜单补充 `cms:content:export` 按钮权限

### Changed

#### CMS 安全边界

- URL 策略收紧（shared `link.ts`）：只接受站内绝对路径与 http(s) / mailto / tel 外链；协议相对地址、`javascript:` / `data:` 等未知协议、反斜杠、编码分隔符、控制与双向字符一律拒绝。媒体 / 附件 / 封面 / Logo 字段另用 asset URL schema（仅站内路径、http(s)、`cms-res://`），页面区块 props 中的 URL 类属性递归校验
- 内容正文与栏目单页写入统一经 `sanitizeCmsHtml`；词库替换只作用于已清洗文本并二次清洗，无法重新打开标签 / 属性边界
- 内容 `staticPath` 仅支持 `.html`，并拒绝与系统保留路径（`p/`、`tag/`、`search/`、`sitemap.xml` 等）冲突
- 前台请求路径只解码一次并拒绝 `..`、编码分隔符与控制字符；开放 API 分页 / 日期 / cursor 参数严格校验

#### CMS 站点隔离与授权

- 内容模型 list / all / detail / refs / update / delete 统一要求 `siteId` 并共用同一访问断言，普通操作者无法读取其他站点专属模型
- 素材引用同步与解析同时限定 `siteId`，跨站 `cms-res://` 句柄拒绝；引用重建补扫页面部件 draft / published 数据
- 开放 API 写入使用独立 `CmsOpenApiAccessContext` principal（client → site → channel → scope），不再借用后台超管权限
- 内容导出复用列表查询的可访问栏目与数据范围谓词，不再成为权限旁路
- 栏目引入 effectiveEnabled（自身与全部父栏目均启用）：前台渲染、聚合、检索、死链、会员互动、订阅与分发规则统一使用；公开可见性单一判定（`isCmsContentPubliclyVisible`）覆盖到期内容

#### CMS 发布与缓存

- 动态站点写入后同样执行 Redis 页面 / sitemap 缓存失效，`staticMode` 只决定是否生成文件；会员点赞 / 收藏同步失效站点缓存
- `cms-static-build`、`cms-theme-rebuild` 任务类型并入 `cms-publish-build`，发布中心与站点静态化面板只跟踪统一任务
- 标签、友链、广告、表单、内链词、模板引用等变更统一进入发布 outbox

#### CMS 分发与迁移

- 站群分发移除 `mapping` 共享正文模式，一律生成可独立编辑的完整快照；分发规则已有物化内容时禁止修改来源 / 目标 / 模式，来源与目标栏目必须为有效启用的列表栏目
- 整站导入导出补齐闭环：站点 modelId / extend、栏目 modelId / staticMode / detailPathRule、标签分组、内容 titleStyle / attachments / staticPath、友链分组、页面 path / requiresDynamic 均可往返；模型按稳定 code 映射并恢复字段定义，实体链接、content-list 区块 channelId、部件引用与素材句柄递归重映射，非法引用拒绝导入

#### 认证

- 管理员与会员 JWT 每次请求回读用户 / 会员状态、租户状态与过期时间：令牌内租户声明与库不一致或租户停用即失效，平台管理员的 viewingTenant 声明同样实时校验；refresh 链路同步收紧且不再受 `multiTenantMode` 开关影响

#### Web 体验

- 内容 / 评论 / 素材 / 检索词典 / 部件 / 互动等表格 rowKey 统一为字符串，勾选态与批量操作对象一致；切站、筛选、翻页自动清空选中
- 内容编辑页、SEO 页签、导出按钮、附件与媒体库上传按 capability 显示或禁用，无编辑权限时内容编辑页以只读模式打开
- 广告事件页不再以 `pageSize=1000` 请求越界；切站时清空广告位 / 草稿 / 详情
- 表单预览 radio 字段渲染为单选组；表单字段标识去重校验；采集分页 `pageEnd >= pageStart` 在 service 层强制
- 友链分组、广告投放时间清空时显式提交 `null`，不再因 `undefined` 被序列化省略而保留旧值
- 支付中心、会员中心、开放平台多处不定长列加宽并省略渲染，空值占位统一 `EMPTY_PLACEHOLDER`；钱包 / 积分流水补 `member_recharge_refund` 业务类型映射

#### 文档

- `docs/cms/` 十篇专题按当前实现修订（内容模型、内容管线、互动、开放 API、检索、SEO、站群分发、静态化与渲染、主题）

### Fixed

- 内容列表预览地址手工拼接，导致按栏目归档规则或自定义静态路径的内容打开 404
- 发布中心「产物」页刷新后「任务详情」依赖历史页缓存而无法查看
- 互动问卷复制丢失 allowOther / ratingMax / matrixRows / pageNo / visibleWhen 等高级题目字段
- 分发规则允许把 page / link / 已停用栏目作为来源或目标
- 分发策略源码断言测试同步快照化实现（`updateCmsContent` / `offlineCmsContent` 已改为事务内版本围栏更新）

---

## v2.11.0 - 2026-09-01

**支付安全加固 + 全域 UI 一致性治理**：支付写入与执行链路继续收紧租户/状态门禁，恢复 Webhook 管理视图；前端完成列宽审计、可复制列收编、弹窗改抽屉与 Cron 输入统一。

### Added

#### Web 体验

- 手输 cron 字段统一接入 CronBuilderPopover，可视化构建替代裸文本输入
- `copyableNoColumn` 支持展示/复制分离，收编派生值复制列

### Changed

#### 支付中心

- 支付写入接口强制租户范围，杜绝跨租户越权写入
- 转账与分账执行链路安全加固：状态门禁与并发防护
- 沙箱工作流门禁修复：模拟操作严格受沙箱状态约束
- 恢复支付 Webhook 管理视图（复用开放平台 Webhook 路由工厂，支付域限定支付/退款事件）

#### Web 体验

- 全域列宽审计：修复 15 处数据/操作列溢出换行，统一省略展示
- 同步源、短链、设备编辑、我的应用、开放平台应用管理等新增/编辑弹窗改为抽屉承载
- 物模型新增属性弹窗双列布局，抽屉标识符列加宽省略
- CMS 访问统计与渠道分析筛选组恢复默认尺寸，与同行控件对齐

### Fixed

- 支付应用管理客户端选择状态错乱
- 会话回放点击热点错位到播放区域外；热点提示语改为图标 Tooltip 消除切换抖动

---

## v2.10.0 - 2026-08-31

**支付中心整备 + 会员资金一致性**：沙箱与资金台账完整性重构、11 项高/中优先级缺陷修复、财务报表专业化、多租户边界系统性收紧；迁移基线随本轮增量再次重建。

> ⚠️ **破坏性变更**：数据库迁移基线再次重建（0002-0008 增量并入基线），已部署数据库的 `__drizzle_migrations` 记录与新迁移链不兼容。部署此版本需**重建数据库**（`DROP DATABASE` 后由 `db:migrate + db:seed` 全新建库），不保留历史数据。

### Added

#### 支付中心

- 财务报表专业化增强：分账口径入报表、逐日走势、行级环比与 CSV 导出
- 结算批次支持增量出账，同期可多次结算未覆盖流水

### Changed

#### 支付中心

- 沙箱与资金台账完整性重构：沙箱链路与真实台账隔离，账本口径统一
- 多租户边界收紧：支付应用租户完整性强校验、操作按所选租户隔离、渠道配置写入强制租户范围、支付方式随租户视图正确过滤，租户视图在管理员会话中持久化
- 引擎与资金链路加固：恢复路径同样受引擎门禁约束、周期代扣幂等加固、支付链接兑付加固、事件 outbox 与可选 Webhook 解耦、对账调整按账单来源门禁、操作反馈与实际结果一致
- UI 系统性优化：操作列审计、长列防换行与省略、展开按钮并入首列、可复制单号列改为省略 + 常显复制按钮（成功反馈行内对勾）、多个弹窗双列化或改 SideSheet 承载

#### 会员中心

- 充值退款自动回冲会员钱包，保持资金一致
- UI：优惠券新增/编辑改 SideSheet、会员详情改分节 Descriptions 并补充用户名、侧边栏菜单溢出不再与收起按钮重叠

#### 数据库

- 迁移基线重建：0002-0008 增量迁移并入 `0000_baseline.sql`（含手写的支付活跃单 partial 索引最终形态），`0001_extensions.sql` 保持 pgvector 条件 DDL 唯一收口，已在全新数据库验证 migrate + seed
- 移除页面右下角 TanStack Query Devtools 图标

### Fixed

- 支付中心 11 项高/中优先级缺陷（接口契约、资金一致性、沙箱回调）
- 结算动作可达性：符合条件的批次操作入口不再缺失
- 预授权与签约代扣搜索栏应用筛选后重复渲染
- 后台创建/编辑会员时必须至少保留一个登录凭证，避免产生无法登录的账号

---

## v2.9.0 - 2026-08-30

**依赖底座全量升级 + 迁移基线重建**：39 项依赖升到最新（含 3 组 major），数据库迁移链从 62 个文件压缩为基线 + 扩展两文件。

> ⚠️ **破坏性变更**：迁移基线已重建，旧数据库的 `__drizzle_migrations` 记录与新迁移链不兼容。部署此版本需**重建数据库**（`DROP DATABASE` 后由 `db:migrate + db:seed` 全新建库），不保留历史数据。

### Changed

#### 依赖升级（39 项 → 全部最新）

- **major ×3**：`@file-viewer/*` 2.x → 3.0（12 包）、`maplibre-gl` 5 → 6、`electron` 43 → 44，使用面零改动兼容；同步修正 electron-builder 硬编码的 `electronVersion` 版本漂移
- **minor/patch**：hono 4.13.5、AWS SDK、TanStack Query 5.102.8、sharp、mysql2、pg-boss、eslint、typescript-eslint、electron-updater 等

#### 数据库迁移基线重建

- 62 个迁移文件压缩为 `0000_baseline.sql`（全量 schema，pg_trgm 前置）+ `0001_extensions.sql`（手写 DDL 收口）
- trigram 索引全部收进 schema DSL 由 drizzle-kit 生成——包括 `async_tasks.payload/result` 的「表达式 + gin_trgm_ops」形态（drizzle-kit 新版已支持，旧注释「超出表达范围」过时）
- 手写 DDL 仅剩 pgvector 条件块（条件 DDL + 扩展创建 + 无维度 vector 列不可表达，且该列刻意不进 schema 以兼容无 pgvector 部署）
- 测试池回退 forks：threads 池的 worker 共享进程级 libuv 线程池，zlib/fs 密集用例在并行争抢下被饿死

#### CI 提速

- 按 lockfile 哈希缓存 node_modules 本体（含 web 的 `.vite/deps` 预打包产物），命中时整跳 Install：端到端 6m31s → 4m53s（-25%）

### Fixed

- hono 4.13.4 修复路由登记缺陷后，`GET /api/analytics/event-meta/references` 恢复在 `app.routes` 登记表中出现（运行时匹配一直正常，仅登记表漏记），路由表快照同步

---

## v2.8.0 - 2026-08-30

**会话回放收官 + Zod / Drizzle 底座升级**：回放补齐合规审计与热力真实底图；zod 升级 4.5 并全面对齐 v4 最佳实践，数据库层对齐 Drizzle 最佳实践，测试与发布验证大幅提速。

### Added

#### 会话回放收官

- **访问审计**：查看回放详情自动留痕（同人同录像 10 分钟去重、异步不阻塞查看），回放中心新增「访问审计」Tab（manage 权限，时间/操作人/动作/录像归属/回放深链/IP），保留 180 天
- **热力页面底图**：点击热力自动取最近一条访问该页面的回放，rrweb-player 静态渲染该时刻的真实 DOM 快照作底图、热点叠加其上；无可用回放回落纯网格，支持开关

### Changed

#### Zod 4 底座

- **升级 zod 4.4.3 → 4.5.4**：每 schema 实例内存 7.5KB → 784B（启动构建数千个 DTO schema，RSS 可观下降），safeParse 失败路径快约 7.5 倍
- **对齐 Zod 4 最佳实践**：39 处废弃字符串格式方法改顶层函数（z.uuid/z.email/…）、39 处 `.strict()`/`.passthrough()` 改 `z.strictObject()`/`z.looseObject()`、校验错误映射按 v4 issue code 重写并生成带字段名的中文提示
- **热点公开入口 z.compile AOT 预编译**：埋点批量采集解析提速 3.3x、回放分片 meta 10.2x，错误上报与 IoT WS 帧解析同型收益；一律 strict 模式，schema 不可编译则启动即报错

#### Drizzle 底座

- **主键全库改 identity**（379 列 serial → `generatedAlwaysAsIdentity()`），启用 `casing: 'snake_case'` 删除 5131 处显式列名，drizzle-kit 校验零 DDL 偏差
- **CMS 检索向量写入收口**为唯一入口；新增 `readSnapshot()` 只读快照事务，应用于报表执行统计

#### 测试与发布验证提速

- **web 测试全量 288.6s → 139.4s（-52%）**：esbuild 预打包 Semi 等 CJS 依赖，消除隔离 worker 重复执行几千个包装模块
- **server 测试全量 108.8s → 89.0s（-18%）**：路由表快照并入契约测试共享一次 app 装配、改用 threads 池、全局 redis 内存替身（测试不再发真实 TCP 连接）
- **发布四路并行验证墙钟约 6.5 分钟全绿**：两包 `testTimeout` 统一 15s，消除 CPU 争抢下秒级用例的偶发超时

### Fixed

- 查询串布尔参数「筛选否」端到端无法表达（`z.coerce.boolean` 把 `'false'` 强转为 `true`），新增 `queryBool()` 助手替换 15 处路由
- 会员端同意采集后会话回放不启动
- 回放分片 clickPoints 全部为空 path 时上报 500
- identity 迁移后全新建库 seed 因显式 id 报错（补 `overridingSystemValue` 与 setval 续位）

---

## v2.7.0 - 2026-08-30

**会话回放（四/五期）+ 存储配额治理**：回放从「能看录像」升级为「DevTools 式排障工作台 + 点击洞察」，存储总量纳入滚动淘汰治理。

### Added

#### 会话回放四期（排障深度）

- **DevTools 同步面板**：播放器下方「网络 / 错误控制台」双 Tab，HTTP 请求（状态/耗时）与错误按回放时间轴排列，行点击 seek、播放进度实时高亮当前行（数据源为录制流内面包屑事件，零额外采集）
- **性能标记**：回放期间的 Web Vitals（LCP/INP/CLS）投影为时间轴紫色打点
- **内容检索**：按「访问过的页面路径」「点击过的内容」模糊检索回放（SDK 分片提取 + 会话行 jsonb 索引去重合并）
- **旅程拼接**：同一浏览器会话的多段录像时间排序横条，一键切换播放

#### 会话回放五期（洞察广度）

- **页面点击热力**：回放中心新增「点击热力」Tab——回放录像的真实点击坐标按页面聚合（2% 网格），密度渐变热点渲染；坐标独立事实表与回放解耦（回放删除后热力保留，独立 90 天保留期）
- **导出自包含 HTML**：回放详情一键导出内嵌播放器与完整事件流的单文件，可发给无系统权限的人离线播放

#### 存储配额治理

- **回放存储配额**（默认 4GB，0=不限）：超限异步滚动淘汰到 90% 低水位（滞回防抖），价值分级——无错误回放最旧优先；录制中会话不淘汰
- **硬顶熔断**：用量超配额 120% 时静默丢弃纯采样分片，错误触发现场永远接收
- **容量看板**：回放中心统计卡（占用/使用率/今日新增/总数），75%/90% 变色预警
- **监控告警**：新增「数据分析」指标组与 `replayStorageMb` 指标，内置规则「回放存储接近配额」

### Changed

- 采集设置新增「回放存储配额」配置项；意见反馈操作列加宽并内联「查看回放」
- 文档站数据分析目录全面更新：新增会话回放篇，同步 23 张表/定时任务/权限码等最新架构，移除已实现的「Session Replay 暂不立项」评估

### Fixed

- 采集设置滑块轨道塌陷导致拖动采样率显示 NaN%（Semi Slider 不透传 style，改 CSS 类布局 + Number.isFinite 防御）

---

## v2.6.0 - 2026-08-29

**会话回放（一/二/三期）**：错误现场从「堆栈 + 面包屑」升级为「像素级录像回放」，与错误监控、意见反馈、数据保留全链路打通。

### Added

#### 会话回放一期（底座 + 错误回放闭环）

- **统一分段流式采集**：SDK 双模式流水线（rrweb 懒加载，关闭时零体积零开销）——buffer 模式内存环形缓冲错误前约 60s 现场，错误触发后上传并转持续录制；stream 模式按采样率全程录制；两种模式共用一条 streamer，触发器仅决定流的启动时机
- **精确双向关联**：错误上报自动注入活跃回放 ID（`error_events.replay_id`），错误监控详情/事件弹窗「查看会话回放」与回放详情关联错误列表互跳
- **回放中心**（数据分析 → 会话回放）：列表筛选（状态/触发方式/来源/仅看有错误）、详情侧栏播放器、批量删除
- **传输与存储**：分片 gzip 上报（(replayId, seq) 幂等重传安全）、bytea 直存事务一致、gzip 透传拉流（服务端零解压）、独立限流 `replay-ingest`
- **隐私默认安全**：输入框恒打码、可配全文本打码与屏蔽选择器；采集设置新增回放配置组（开关/错误触发/采样率/打码/屏蔽/保留天数），远程热更新一键熔断
- **治理接入**：数据保留登记（逐租户保留天数，默认 30 天）；调度任务每 5 分钟收尾闲置会话

#### 会话回放二期（时间轴与触发器扩展）

- **播放器时间轴标注**：错误（红）/页面跳转（蓝）/行为信号（橙）打点，点击 seek 到对应时刻；行为面包屑经 rrweb 自定义事件写入录制流
- **rage click 触发器**：暴躁点击自动触发缓冲上传；白屏检测天然覆盖（走错误触发链路）
- **意见反馈联动**：提交反馈自动附带回放 ID（`user_feedbacks.replay_id`），反馈管理「查看回放」直达用户操作现场

#### 会话回放三期（实时旁观与洞察）

- **实时旁观**：recording 会话详情 3s 轮询增量追流（liveMode addEvent 不重建播放器），LIVE 呼吸指示灯
- **点击热点**：本次会话点击坐标按录制视口归一化叠加热点层（纯前端提取，零上报开销）

### Fixed

- 终包送达可靠性：pagehide 场景旁路异步 gzip 与串行上传链，原始 JSON + keepalive 立即发出（服务端按 gzip magic 兜底压缩），会话不再滞留 recording

---

## v2.5.0 - 2026-08-29

**限流防护三期 + 事件循环保护**：自研限流核心落地三期演进；对照生产经验清单系统性补齐进程级可观测与 CPU 阻塞治理。

### Added

#### 限流防护（一/二/三期）

- **一期重构**：自研限流核心替换原实现，新增观察模式（只记录不拦截）与管理页重设计
- **二期**：滑动窗口算法、白名单豁免与手动封禁
- **三期**：拦截突增告警、Top 攻击源分析与 30 天趋势

#### 系统运维

- **多主机运维平台**：跨主机的进程 / 端口 / 网络诊断与文件管理
- **运维一期**：运维概览、深链联动、权限治理与平台降级
- **SQL 控制台**：内嵌 psql 数据库终端

#### 稳定性与可观测（事件循环保护）

- **进程级崩溃兜底**：`uncaughtException` / `unhandledRejection` 统一 fatal 处理（stderr + 崩溃哨兵 + 限时冲刷日志/遥测后退出）；下次启动读哨兵经通知中心补投「服务崩溃后已重启」告警（新事件 `ops.server.crashed`），偶发崩溃不再被自动重启静默
- **loopLag 告警可用化**：事件循环延迟直方图窗口化（每帧重置），告警指标改用窗口峰值 max（mean/p99 会稀释阻塞尖峰）；新增默认告警规则「事件循环阻塞 ≥200ms 持续 3 分钟」与 Prometheus `zenith_event_loop_lag_max_ms`
- **导出行数硬上限**：`execution.maxRows`（默认 50000，sync/async 通用），提交时快速失败 + writer 渲染兜底（xlsx / CSV），封住无界导出对事件循环与内存的冲击

#### Web

- 多页签悬浮显示完整菜单路径

### Changed

- **导出中心流式渲染**：table 模式改用 `stream.xlsx.WorkbookWriter` 逐行增量序列化，消除整本 workbook 终局序列化的主线程 CPU 连续段（多级表头 / 水印 / 冻结 / 隐藏元信息表不受影响）
- **密码哈希原生化**：收口 `lib/password.ts` 统一入口，优先 `@node-rs/bcrypt`（线程池计算，不占 JS 主线程，批量导入逐行 hash 受益最大），存量 `$2a$/$2b$` hash 双向互认无需迁移
- **sourcemap 堆栈还原缓存**：SourceMapConsumer 按 `id:updatedAt` 键做 64MB 字节预算 LRU，错误组详情重复查看零解析；引用计数杜绝并发淘汰的悬空销毁
- 页面级初始加载统一改用 PageLoading 组件；导入中心改列表优先布局；我的消息 / 公告中心列表分页对齐表格分页形态；文档站首页功能矩阵滚动性能优化

### Fixed

- 限流管理页背后的七处实现缺陷
- OTel 可观测性缺口补齐
- 终端页 serverSessionId 回调链引发的渲染死循环；终端页自动聚焦光标
- 我的消息 / 公告中心未读 tab 徽标改用全量未读统计

---

## v2.4.0 - 2026-08-29

**数据导入中心二期**：补齐「导入 → 改错 → 再导」体验闭环，实体扩编至五个。

### Added

#### 数据导入中心 · 体验闭环

- **错误行回导**：存在失败行时自动生成错误行 Excel（原数据 + 红字「错误原因」列）存入文件中心，进度弹窗一键下载，修正后可直接重新上传
- **导入预检（dry-run）**：「预检文件」入口仅逐行校验不落库，输出同款行级报告与错误文件；预检可反复执行不受幂等限制
- **CSV 支持**：上传解析兼容 .csv（模板仍为 xlsx）；文件上传 MIME 白名单补充 `text/csv`
- **上下文参数**：Definition 支持 `contextSchema` 声明页面上下文（提交与执行双重校验），支撑 CMS 内容等需要站点/栏目上下文的导入
- **实体扩编**：新增字典项（`platform.dict-items`）；CMS 内容导入收编为 `cms.contents` definition，与其余实体共享全部导入中心能力

### Changed

- **BREAKING**：CMS 内容旧导入接口 `POST /api/cms/contents/import` 下线，统一走 `/api/import-jobs`（内容页导入按钮已同步切换，需先选定站点与栏目）

### Removed

- cms-tasks 私有任务 `cms-content-import` 与前端 `useImportCmsContents` hook

---

## v2.3.0 - 2026-08-29

**数据导入中心一期**：与导出中心对偶的统一导入框架，收口全站散落的 Excel 导入轮子。

### Added

#### 数据导入中心（系统管理）

- **统一框架** `lib/import-center`：实体以 Definition 声明（模板列 / 行校验 / 落库），框架统一承担模板生成（必填标星 + 枚举下拉 + 示例行 + 批注）、表头定位校验、单元格类型归一、逐行解析与行级错误报告
- **执行复用任务中心**（taskType `data-import`，零新表）：进度、取消、断点续跑、行级成败明细、幂等（同文件同实体只跑一次）与链路追踪全部继承
- **导入中心页** `/system/import-center`（菜单 2730）：按模块分组的可导入实体卡片墙 + 导入历史
- **ImportButton 通用组件**（对偶 ExportButton）：下载模板 / 上传 xlsx / 提交 → 进度弹窗 + 实时行级明细，可后台运行
- **首批实体**：会员（`member.members`，新能力）、用户（`identity.users`）、IoT 设备（`iot.devices`）
- API：`GET /api/import-jobs/entities`（权限过滤）、`GET /{entity}/template`、`POST /api/import-jobs`

### Changed

- **BREAKING**：用户与 IoT 设备的同步导入接口（`/api/users/import*`、`/api/iot/devices/import*`）下线，统一走导入中心；同步导入升级为异步任务，大文件不再超时
- 会员注册来源新增 `import`（批量导入渠道统计口径）

### Removed

- users.service 与 iot-devices.service 中的私有 exceljs 模板/解析实现（~260 行），用户页与设备页的两套导入 Modal

---

## v2.2.0 - 2026-08-29

链路追踪二期 M2+M3：时间线从「平铺」升级为「因果树」，链路 ID 走出系统边界。

### Added

#### 链路追踪 · 因果树

- 作业 / 通知 / 异步任务记录**因果父引用**（`parent_ref`，迁移 0050）：请求内产生的挂请求节点下，作业执行产生的挂 `job:{id}`，任务执行产生的挂 `task:{id}`——三个执行器建立作用域，写入点自动继承
- 时间线树形渲染：按父子关系 DFS 缩进展示（↳ 标记），一眼看清「谁触发了谁」；父引用超出查询窗口时兜底平铺

#### 链路追踪 · 传播与互查

- **外呼传播**：服务端统一 HTTP 封装自动为全部外呼（webhook、触发器、外部审批、补偿动作等）携带 `X-Request-Id`；链路 ID 为 UUID 时同发 W3C `traceparent`，第三方 APM 可原生接续
- **前端错误互查**：analytics-sdk 捕获接口 5xx 时随 context 上报服务端链路 ID；前端错误详情出现链路 ID 时展示「查看服务端链路」一键跳转，前端报错 ↔ 服务端时间线闭环

---

## v2.1.0 - 2026-08-29

链路追踪二期 M1：解决「不知道链路 ID 时从哪进」的排障入口问题。

### Added

#### 链路追踪 · 排障入口

- **最近失败页签**：`GET /api/trace/recent-failures` 聚合四类失败留痕（请求 5xx、作业失败/死信、异步任务失败、通知派发失败），支持时间窗（1/3/7/30 天）与节点类型过滤，失败行一键跳转对应链路时间线
- **日志跨天检索**：链路日志面板支持在近 7 天的应用日志文件间切换（原先仅查最新文件）
- **完整性说明**：页面标注各锚点数据受保留策略约束，超窗节点缺失属正常现象

---

## v2.0.0 - 2026-08-28

本版本交付**链路追踪查看器**：一枚链路 ID 贯穿一次操作触发的请求、后台作业、领域事件、通知派发与异步任务，管理后台内即可按 ID 拉出完整时间线排障。版本升为 2.0 的原因：请求关联协议做了一次破坏性收敛（移除自造的 `X-Trace-Id` 响应头，统一为标准 `X-Request-Id`）。

### Added

#### 链路追踪查看器（系统管理 → 审计日志）

- **时间线页** `/system/trace`（菜单 2720，`system:trace:view` 权限）：按链路 ID 聚合五类锚点为统一时间线（HTTP 请求 / 后台作业 / 领域事件 / 通知派发含渠道级投递结果 / 异步任务），节点状态归一四态、附耗时，支持 URL `?traceId=` 直达与节点明细抽屉
- **应用日志联查**：时间线页内折叠面板复用日志文件接口按链路 ID 全文过滤（`system:log:files` 权限可见）
- **联动入口**：操作日志详情与任务中心详情新增「链路 ID + 查看链路」一键跳转
- **报障闭环**：接口业务错误 Toast 自动附带可复制的链路 ID，用户报障直接提供 ID 即可按链路定位
- 聚合接口 `GET /api/trace/{traceId}`：五锚点并行查询、租户隔离、单类节点上限 200

#### 链路贯穿基础设施

- **一枚 ID 设计**：traceId 与 hono requestId 合并（请求中间件直接复用 requestId 建立 AsyncLocalStorage 作用域），`operation_logs.request_id` 天然成为链路键，访问日志 / HTTP 详细日志 / OTel 采集属性零改造对齐
- **pino 日志全量注入 `reqId`**：mixin 方式为请求作用域之外（worker / 作业 / 任务 / 订阅者）的日志行补齐链路键，与 pino-http 请求内字段同名同值；`traceIdStore` 抽离为零依赖模块避免 logger↔db 循环导入
- **任务中心接入链路**：`async_tasks` 新增 `trace_id`（迁移 0049），提交时继承请求链路，worker 执行时恢复链路作用域使任务内副作用继续同链
- 检索索引补齐：`operation_logs.request_id`、`notification_outbox.trace_id`、`async_tasks.trace_id`

### Changed

- **BREAKING**：移除自造的 `X-Trace-Id` 请求/响应头，客户端透传链路 ID 统一使用标准 `X-Request-Id`；CORS 增加 `Access-Control-Expose-Headers: X-Request-Id`
- workspace 内部依赖声明从 `^1.82.0` 同步为 `^2.0.0`（major 升级下旧区间无法匹配）

---

## v1.99.0 - 2026-08-28

本版本完成**日志框架从 winston 到 pino 的全面迁移**：NDJSON 结构化落盘、worker 线程输出、官方 pino-http 访问日志；并消除多处热路径串行查询，优化若干界面细节。

### Changed

#### 日志框架迁移（winston → pino）

- **主日志**：原生 pino 实例输出 NDJSON（数字级别、本地时区偏移 ISO 时间戳），文件经 pino-roll worker transport 按天轮转——命名 `app.YYYY-MM-DD.N.log`，保留 `LOG_MAX_FILES` 份，不再 gzip 归档；`logMethod` hook 归一化「消息在前」的调用签名并承担 ERROR/WARN 频率计数（`lib/log-metrics.ts` 口径不变），业务调用点零改动，child logger 等原生能力可用
- **访问日志**：`hono/logger` 文本行改为官方 pino-http 集成——结构化访问行含 reqId 与耗时，5xx 记 error 级，`/api/health`、`/api/metrics`、`/api/ws` 不记；请求级子 logger 经 `c.get('logger')` 可用；移除 `strip-ansi` 依赖
- **控制台格式**：新增 `LOG_CONSOLE_PRETTY`（默认 `false` 输出 NDJSON；本地开发设 `true` 得 pino-pretty 彩色单行。只影响控制台，日志文件始终 NDJSON）
- **配置收紧**：`LOG_LEVEL` 校验为 pino 级别枚举（fatal/error/warn/info/debug/trace）；`LOG_MAX_FILES` 改为数字份数——**原 `30d` 写法需改为 `30`**
- **日志查看器**：级别识别新增 NDJSON 行首数字 level 键分支（精确识别，不再依赖大写单词猜测），`http-traffic` 等文本日志回退保留；告警事件「查看日志」跳转适配新文件名
- HTTP 流量日志（Logbook 风格深度排障）格式化/脱敏/关联逻辑不变，仅写入后端换为 pino-roll，独立文件更名 `http-traffic.YYYY-MM-DD.N.log`
- 热路径查询优化：站内信/短信/邮件日志列表 count 与 list 并行；CMS 批量回收/归档的映射副本锁校验改单次 `inArray` 批量查询；工作流批量催办 DISTINCT ON 一次取数 + 批量插入（2N 次 → 2 次）

#### 界面

- 联动规则编辑弹窗改为 SideSheet，冷却期与决策表 Key 拆为两行
- 计划任务弹窗布局与调度列优化
- SideSheet 页脚统一右对齐并写入前端规范

### Fixed

- pino 多 target 模式下 per-target level 缺省为 `info`，显式跟随 `LOG_LEVEL` 修复 `debug`/`trace` 级日志被静默过滤
- 决策表 Key 标签折行——「可选」移入占位文案

---

## v1.98.0 - 2026-08-28

本版本交付 **IoT 设备管理六期 —— 运维闭环与智能升级**：告警从「看见」走向「处理完成」的闭环，OTA 引入灰度发布，新增时间驱动的设备计划任务、一型一密动态注册与 AI 设备助手。

### Added

#### IoT 六期 —— 运维闭环与智能升级

- **告警处理闭环**：告警状态机新增「已认领」（firing→acknowledged→resolved），认领人/处理人/处理备注全程留痕；活跃告警唯一索引改为 `status <> 'resolved'`，认领中不重复触发；阈值回落/设备上线自动恢复同时覆盖 firing 与 acknowledged
- **告警超时升级**：规则可配置「N 分钟未认领升级」与升级接收人，每分钟系统任务扫描（先抢占 `escalatedAt` 再通知，防并发重复），新增通知事件 `iot.alarm.escalated`（严重级、必达、绕过免打扰）
- **维护窗口**：按产品/分组/设备圈定时间窗，窗口内告警触发与升级通知静默（恢复通知不静默），告警中心第三 Tab 管理
- **设备计划任务** `/iot/schedules`（菜单 18090）：cron 周期 / 定时一次两型，时间驱动下发服务指令或期望属性（与场景联动的事件驱动互补）；目标按 设备 > 分组 > 产品 圈定（上限 500 台）；`nextRunAt` 游标调度（先推游标防并发重复，enabled 无游标自愈补算）；执行记录留痕（目标数/成功/失败/错误明细，保留 90 天）
- **OTA 灰度发布**：升级任务可设「灰度批次大小」与「失败率熔断阈值」；设备按序分批，创建仅推送首批，手动「放量下一批」推进；已放量范围失败率达阈值自动熔断暂停，支持恢复；未放量批次不下发升级载荷
- **一型一密动态注册** `/iot/register`（菜单 18100）：产品注册密钥（开启/重置/关闭，明文仅一次性展示）+ SN 白名单（批量导入/统计/已核销禁删）；设备侧 `POST /api/iot/ingest/register` 以 HMAC-SHA256 签名注册（±300s 时间窗、timingSafeEqual 比对、白名单原子核销、SN 重复 409 幂等拒绝），注册成功返回设备密钥并自动建档
- **AI 设备助手**：Mastra 编程式内置智能体（设备概览/活跃告警/近期事件/设备统计 4 个工具），出现在智能助手列表，可对话查询设备在线状态、告警摘要与异常事件

### Changed

- 告警列表新增处理人列与处理备注 Tooltip、升级标记；告警规则表单支持升级策略配置
- OTA 任务列表新增批次进度列（`当前批 / 总批次`）与「放量下一批」「恢复」操作；创建表单新增灰度字段
- 产品 DTO 新增 `registrationEnabled` 标记（密钥明文不下发）
- Demo 模式（MSW）同步覆盖：计划任务/执行记录、维护窗口、白名单/注册密钥、告警认领与处理备注、OTA 灰度放量与恢复

---

本版本连续交付 **IoT 设备管理二期～五期**：从自由 jsonb 遥测升级为物模型驱动的设备运营平台，补齐告警、可视化、OTA、场景联动、实时推送、开放集成、网关拓扑、数据流转与智能运维能力。

### Added

#### IoT 二期 —— 物模型驱动（不向后兼容重建）

- **物模型（TSL 三元组）**：产品下声明属性（类型/量程/读写/枚举/关键属性）、服务（参数 schema 驱动表单化下发、高危二次确认）与事件（级别与参数声明）；物模型编辑器抽屉 + TSL JSON 导入导出；遥测按物模型校验（loose 丢弃不合规键 / strict 仅接受已声明属性）
- **设备影子**：reported（最新上报快照，列表 O(1) 读）/ desired（期望属性下发，设备确认后按键收敛，版本号防乱序）；WS 在线即时推送 `shadow:desired` 帧，离线设备心跳补收
- **统一事件流**：生命周期事件（激活/上下线/重置密钥）与物模型事件（设备上报）单表倒序展示，级别筛选
- **告警中心** `/iot/alarms`（菜单 18030）：阈值（连续 N 次）/ 离线（超时分钟）/ 事件三类规则，firing→resolved 状态机（活跃告警部分唯一索引去重），阈值回落与设备上线自动恢复，通知中心事件 `iot.alarm.triggered/resolved`（接收人显式指定、必达、绕过免打扰）
- **设备分组与批量操作**：静态分组圈选目标，批量指令/批量期望属性走任务中心（进度、失败明细、可重试）
- **设备详情四 Tab 重构**：属性状态（reported/desired 对照、单属性下发）、遥测曲线、指令下发、事件流

#### IoT 三期 —— 可视化与规模化运维

- **总览仪表盘** `/iot/dashboard`（菜单 18040）：设备总数/在线率/今日遥测/告警统计卡、在线率趋势（分钟级采样）、告警趋势、产品分布、最近告警与事件
- **遥测降采样**：小时聚合表（min/max/avg/last，每小时系统任务物化），详情曲线长窗口自动切聚合三线，明细保留期可独立缩短
- **固件升级（OTA）** `/iot/ota`（菜单 18050）：固件包管理（版本语义校验 + SHA256 完整性）、升级任务（目标圈选、单设备状态机 notified→downloading→installing→succeeded/failed、进度回报、超时收敛、取消）；设备升级后以新版本上报即自动确认成功；固件下载走签名 302 直链
- **设备导入导出**：Excel 模板批量导入（逐行校验、失败明细）、导出走导出中心
- **告警中心统计卡**：活跃严重/警告、今日新增一屏可读

#### IoT 四期 —— 自动化、实时与开放

- **场景联动** `/iot/automations`（菜单 18060，`iot:automation:*` 权限）：触发器四类（属性条件/设备事件/上线/离线）× 动作编排（下发指令、设置期望属性——目标支持触发设备/指定设备/设备分组、发送通知、发起工作流），Redis 冷却抑制（联动×设备粒度），可选规则中心决策表二次判定（按 key 软引用），执行留痕（触发上下文 + 逐动作结果）
- **管理端实时推送**：`iot:telemetry` / `iot:shadow` / `iot:device-event` 三类 WS 帧（遥测/影子按设备 300ms 节流）；设备详情抽屉实时合并缓存免轮询刷新，标题栏实时连接状态
- **开放 API** `/api/open/v1/iot/*`：设备列表/详情+影子（`iot:read`）、下发指令/期望属性（`iot:write`），对外以 SN 寻址，经网关签名/计量/限流三层中间件
- **开放 Webhook**：新增 `iot.device.online/offline`、`iot.alarm.triggered/resolved`、`iot.ota.task_completed` 五个平台域事件，支持无 clientId 的平台域订阅匹配
- **通知事件**：`iot.automation.triggered`（联动「发送通知」动作，带限流）

#### IoT 五期 —— 规模接入与智能运维

- **网关与子设备拓扑**：设备形态 direct/gateway/sub（仅一层拓扑，服务端校验防环），网关代理通道（`gateway:batch`/`gateway:event` 帧 + HTTP 端点）子设备免密接入，网关触达批量续期在线子设备；拓扑视图（React Flow 自动布局、在线状态点/告警红点/离线虚线、上下线实时刷新、>50 台退化表格）
- **数据流转** `/iot/forwards`（菜单 18070，`iot:forward:*` 权限）：遥测/事件/告警/生命周期四类数据源 × 产品/分组过滤 → HTTP POST 目的地（可选 HMAC 签名 `X-Iot-Signature`），出站 SSRF 防护，投递日志留痕，连续失败 10 次自动停用
- **设备地图** `/iot/map`（菜单 18080）：设备地理位置（经纬度/地址），maplibre + OSM 底图散点（在线着色、悬浮详情、点击进抽屉、自适应视野）
- **遥测异常检测**：物模型属性级开关（数值型），近 7 天小时聚合统计基线（产品维度缓存），ingest 逐点 3σ 偏离判定 + 600s 去抖，产出 `anomaly` 类设备事件（含统计上下文），可再被告警/联动/流转消费
- **设备日志通道**：设备上报运行日志（`log` 帧 / `POST /api/iot/ingest/logs`，级别/模块/内容），详情抽屉「设备日志」Tab 级别筛选，保留 30 天

### Changed

- IoT 域数据模型破坏性重建（迁移 0041–0046）：物模型三元组、设备影子、事件流、告警、分组、聚合、OTA、联动、流转、设备日志等 19 张表；`iot_telemetry` 等追加型表全部登记数据保留策略
- 开放平台 API Scope 种子新增 `iot:read` / `iot:write`
- 模拟设备脚本扩展 `--hot`（高温触发告警/联动）、`--event`（上报故障事件）、`--fw`（固件版本）、`--gateway`（网关代理子设备）、`--log`（周期上报运行日志）模式
- 管理端 WS 消息契约（`WsMessage`）扩展 IoT 三类实时帧；设备事件 kind 枚举扩展 `anomaly`

### Fixed

- 固件列表 SHA256 列单行省略显示（复制图标不再换行）
- 设备列表形态列子设备标签溢出（网关名移入 Tooltip）；数据流转/场景联动操作列宽度不足

---

## v1.96.0 - 2026-08-28

本版本交付 **IoT 设备管理一期**：新增 `iot` 业务域，提供产品/设备台账、一机一密安全接入、遥测采集展示与 WS 即时指令下发，覆盖中小规模设备接入的完整闭环。

### Added

#### IoT 设备管理（新业务域）

- **产品管理** `/iot/products`（菜单 18010，`iot:product:*` 权限）：产品（设备类型）CRUD，声明关键指标（设备列表快照与遥测图表默认展示项），产品下存在设备时禁止删除
- **设备管理** `/iot/devices`（菜单 18020，`iot:device:*` 权限）：设备注册（SN 留空自动生成，一经接入不可变更）、SN/名称搜索与产品筛选、实时在线 Badge、最近指标快照列、批量删除、重置接入密钥（旧密钥立即失效）、清空遥测
- **设备详情抽屉**：接入凭证（密钥掩码展示 + 复制 + 重置）与接入方式说明、遥测曲线（指标切换、近 24 时 / 7 天 / 30 天窗口）、指令下发表单与记录表（状态机全程可见）
- **安全接入协议**：一机一密 HMAC-SHA256 签名（`sn + 时间戳 + 请求体`，±300s 防重放窗口，常量时间比较），设备禁用即拒绝接入
- **双通道设备接入**：
  - HTTP `/api/iot/ingest/*`：批量遥测上报、心跳（响应顺带下发待执行指令，轮询设备无需单独拉取）、指令回执
  - WebSocket `/api/iot/ws`：连接即在线、断开即离线，上线自动补推 pending 指令，支持遥测/心跳/回执帧
- **指令状态机**：pending → delivered → acked/failed；WS 在线即时推送秒级送达，离线设备上线/心跳补收；超时未回执惰性收敛为 expired（无 cron 依赖）
- **在线状态**：Redis TTL 键承载实时在线态（不入库避免写放大），`lastSeenAt` 60 秒节流落库
- **遥测存储**：自由 jsonb 指标袋（无物模型门槛），`(device_id, reported_at)` 索引 + 数据保留策略（默认 90 天，平台「数据保留」可调）
- **演示与联调**：seed 内置温湿度传感器产品与两台演示设备（含近 24h 遥测曲线）；`packages/server/scripts/simulate-iot-device.ts` 模拟设备脚本一键跑通「WS 接入 → 遥测上报 → 指令接收 → 回执」全链路；Demo 模式 MSW Mock 全覆盖

#### 数据分析

- **内置用户分群**：seed 预置 7 个常用分群（短链点击人群、新注册会员、签到活跃会员、支付成功用户、优惠券核销会员等），开箱即用作为触达与归因的圈人起点

### Changed

- 分群编辑弹窗的事件条件输入框增加「近 N 天内」「≥ N 次」语义前后缀，消除数字含义歧义
- 分群列表描述列加宽并省略显示（悬浮查看完整内容）

### Fixed

- 修复设备遥测快照查询中 drizzle sql 模板将 JS 数组展开为元组导致 `ANY` 报错的问题（改用 `selectDistinctOn`）
- 产品删除按钮在产品下存在设备时正确禁用并提示原因

---

## v1.95.0 - 2026-08-27

本版本是**运营中心二期**：围绕短链一期打下的数据底座，交付「圈人 → 触达 → 点击回流 → 渠道归因」的增长闭环与营销活动获客能力。

### Added

#### 分群触达增强（数据分析）

- **短信渠道**：分群触达在邮件/站内信/Webhook 之外新增短信（按手机号去重，走 `sendSms` 留痕与计费口径），触达抽屉支持短信模板选择
- **落地页短链闭环**：触达活动可配置落地页，执行时幂等生成短链（bizType=campaign）并注入 `{{shortUrl}}` 模板变量（邮件/站内信/短信通用）；触达列表回显短链与累计点击，点击数据回流活动指标
- 分群圈选条件天然支持 `shortlink.link.clicked` 事件（圈出「点过短链的人」）

#### 营销活动中心（运营中心）

- **抽奖活动管理** `/growth/marketing-campaigns`（菜单 17020，`marketing:*` 权限）：活动时间窗、每人总/每日次数限制、状态机（草稿→进行中→已结束）、发布门槛（至少一个奖品）与落地页分享短链；管理页含列表、编辑弹窗、奖品抽屉（权重占比与库存台账）、参与记录抽屉（只看中奖筛选）
- **并发安全抽奖**：pg advisory 事务锁串行化同会员请求防止绕过次数限制；奖品库存 `UPDATE ... WHERE stock > 0` 原子扣减，抢空自动降级未中奖
- **中奖发放最终一致**：事务提交后复用会员域 `changePoints` / `issueCoupon` 自动发放，失败标记 `grantStatus=failed` 留痕；实物奖线下发放；中奖经 `notify()` 发会员通知（`marketing.award.won`）
- **会员端 API** `/api/member/marketing`：活动信息（不泄露权重与库存）、抽奖、我的记录，供会员前台或外部 H5 活动页对接
- 新增 marketing 业务域（三表迁移 0039）、seed 演示活动与奖品、MSW Mock

#### 渠道推广分析（运营中心）

- **归因看板** `/growth/channel-analysis`（菜单 17030，`shortlink:analysis:view` 权限）：短链点击/独立访客按 `utm_source` / `utm_medium` / `utm_campaign` 维度聚合，可选转化事件（事件字典）按 `user_events` 同维度归因输出转化数与转化率；维度/窗口切换、点击趋势与 Top 渠道图、明细表与口径说明，无卡片扁平样式

### Fixed

- 渠道分析聚合查询 GROUP BY 表达式因兜底值参数化编号不一致（`$1`/`$4`）被 PG 判定为不同表达式而报错，改为内联字面量

---

## v1.94.0 - 2026-08-27

本版本主线是**短链服务**：新增「运营中心」域，短链 CRUD、公开跳转与访问统计一步到位，并向支付、消息、CMS 与开放平台四路接入；前端将全库手写防抖/节流统一收敛到 TanStack Pacer。

### Added

#### 短链服务（运营中心）

- **短链管理页** `/growth/short-links`：标准列表 + 新增/编辑弹窗（自定义/自动短码）、二维码、批量启停/删除、统计抽屉（趋势/设备/地域/来源/浏览器）；新增 17000 段「运营中心」菜单与 `shortlink:*` 权限、导出中心实体与 MSW Mock
- **公开跳转** `/s/:code`：Redis 缓存寻址 + 负缓存、301/302、UTM 自动拼接、有效期/次数上限/访问密码；异步点击落库（UA/IP 归属地解析、爬虫标记）；短码 base62 去易混字符 + 保留字黑名单，目标 URL 协议白名单与内网拦截
- **业务接入**：`POST /api/short-links/ensure` 幂等取短链（同 bizType+bizRef 复用、改址同步更新）；收款码弹窗一键生成短链、短信模板/消息广播编辑器「插入短链」按钮、CMS 内容发布自动生成分享短链
- **数据治理**：系统任务「短链访问日聚合」（02:30，幂等 upsert）先于保留清理执行；点击明细默认保留 180 天，统计读路径按日聚合与明细合并，明细裁剪后长周期趋势仍可用
- **生态接入**：开放网关 `POST /api/open/v1/short-links`（data:write）与 `GET /v1/short-links/{code}/stats`（data:read）；点击桥接为语义事件 `shortlink.link.clicked`（爬虫不上报）；「短链过期提醒扫描」任务（09:00）对 72 小时内到期短链经 `notify()` 通知创建人，通知中心新增 growth 分组与 `shortlink.link.expiring` 事件

#### 账号安全

- **MFA 因子管理**：支持删除待验证/已停用的身份验证器（已启用须先停用）；重新发起绑定自动清理遗留待验证记录；停用语义独立为 `POST /api/auth/mfa/factors/{id}/disable`

### Changed

- **前端防抖/节流统一 TanStack Pacer**：全库 24 处手写 `setTimeout` / `Date.now()` 防抖节流收敛为 `useDebouncedValue` / `useDebouncedCallback` / `useThrottledCallback` 等，卸载自动取消；使用规范入册（一次性定时器不在此范围，服务端与 SDK 不引入）
- **统计页扁平面板统一**：告警概览、推送记录、任务中心统计 Tab 补挂 `.zx-flat-panels`，与全站统计页视觉语言一致；`.zx-flat-panels` 规范成文并修正与实现的偏移
- 短链编辑弹窗与统计视图体验优化；移除 CMS 演示头像素材

### Fixed

- 子路径部署下手写绝对路径导致的 404

---

## v1.93.0 - 2026-08-27

本版本是 **App 推送二期**：推送凭证按应用一对一绑定、供应商送达/点击回执、无效设备自动清理、通知测试台、推送统计与通知中心级的运营群发。

### Added

#### 送达回执与设备治理

- **公开回执回调** `POST /api/public/push/callbacks/jpush`：接收极光送达/点击回执（宽松解析单/批事件），按供应商消息 ID 写回发送记录——点击蕴含送达、重复回执幂等、未匹配事件静默忽略恒返 200；新增 `push_public_callback` 限流预设
- **发送记录送达状态**：`push_send_logs` 新增 `delivery_status / delivered_at / clicked_at`，推送记录页新增「送达状态」列（Tooltip 展示送达/点击时间）
- **无效设备自动清理**：发送响应 1003（点名非法 RegistrationID）/1011（整批目标无效）自动清除设备推送绑定，测试发送与事件派发两条链路均生效；设备档案保留，重新登录绑定即恢复

#### 通知测试台与推送统计

- **通知策略页「测试触发」**：事件行一键以当前管理员为收件人真实走完整 `notify()` 链路（模板 `{{var}}` 提取变量填示例值），逐渠道派发决策在投递日志可查；新权限 `system:notify-policy:test`
- **推送记录页统计区**：总发送/成功/失败/送达/点击五卡 + 近 N 天按日趋势（`GET /api/push-send-logs/stats`，连续日期轴补零）

#### 运营群发（通知中心级）

- **群发活动管理页**（通知管理 → 运营群发，权限 `system:broadcast:*`）：受众（全体用户/全体会员/指定名单）× 渠道（站内信/App 推送/邮件）× 文案，发送确认后经任务中心分批派发
- **任务中心接入**：`messaging-broadcast` 任务 500 人/批调用 `notify()` 派发 hidden 事件 `messaging.broadcast`，批次 `dedupeKey` 保证断点重跑/自动重试幂等；渠道投递、用户免打扰与投递留痕全部复用通知派发层
- **状态机**：草稿 → 发送中 → 已发送，任务取消/失败回写活动状态，失败/取消/草稿可编辑后重新发送；列表页实时展示任务进度

### Changed

- **推送凭证按应用一对一绑定**：`push_configs.app_id` 必填且唯一，移除"全局默认配置"语义与 `PUT /api/push-configs/{id}/default`；派发按设备所属应用分组各取凭证投递，无凭证应用（如桌面端）的设备按 `unreachable` 留痕；部分应用组失败不再触发渠道级重投（避免重复推送），全部失败才由 outbox 补投兜底
- 推送配置页表单新增「所属应用」（创建后不可改），列表新增应用列；发送记录关联所属应用
- 测试发送的缓存失效范围从记录列表扩大到记录域（含统计卡）

### Fixed

- 推送配置创建/更新响应缺失 `appName` 的问题（改为落库后带关联应用重查）

---

## v1.92.0 - 2026-08-27

本版本主线是 **App 推送与统一设备中心**：通知中心新增 `push` 渠道（聚合供应商极光,厂商通道零感知），设备升级为一等公民——升级灰度、推送寻址与在网统计共用一份设备档案。

### Added

#### App 推送（通知中心新渠道）

- **推送服务端**：极光 REST v3 发送适配（Basic Auth、1000 设备/批自动分批、供应商可插拔）；`push_configs` 凭证管理（密钥脱敏、唯一默认、APNs 生产/开发环境）与 `push_send_logs` 发送留痕
- **通知渠道接入**：`push` 注册进通知渠道枚举与适配器注册表,偏好矩阵、通知策略、投递日志自动跟随；按收件人查在活绑定设备,多设备聚合一次投递,无设备按 `unreachable` 留痕；`channelOptions.push` 支持标题/透传参数覆盖,通知 `link` 自动映射为点击跳转
- **首批开放事件**：收到新待办审批、待办被催办、系统监控告警、前端错误监控告警
- **管理端页面**：通知管理下新增「App 推送」目录——推送配置页（含测试发送直发 RegistrationID）与推送记录页
- **客户端绑定接口**：管理端 `/api/push/devices` 与会员端 `/api/member/push/devices`（登录绑定、登出解绑、RegistrationID 换机自动迁移）

#### 统一设备中心

- **`client_devices` 设备档案**：以客户端匿名 deviceId 为锚点,升级检查心跳自动登记(桌面端零改动),登录绑定推送写入绑定人与推送标识
- **应用版本页新增「设备」Tab**：按应用/平台/绑定人/推送绑定筛选,支持解绑推送与删除档案
- **升级看板取数升级**:在网设备数与版本分布改为直查设备中心(一台设备只算一次,替代事件流水去重估算)

#### 文档

- 新增[通知中心 → App 推送](/notification/push)：架构、设备中心、服务端 API、事件接入、极光配置流程与客户端接入指引

### Changed

- 数据保留新增两项策略:推送发送日志(180 天)、不活跃客户端设备(按最近活跃 180 天)

### Upgrade Notes

- 包含数据库迁移(`client_devices` / `push_configs` / `push_send_logs` 三表 + `notification_channel` 枚举扩展),执行 `npm run db:migrate && npm run db:seed` 生效
- 推送发送依赖「系统设置 → 通知管理 → App 推送 → 推送配置」中的极光凭证;厂商通道(华为/小米/OV/荣耀/APNs)在极光后台配置

---

## v1.91.0 - 2026-08-26

本版本三条主线：**数据保留统一治理**（分散清理任务全部收口保留策略）、**8 条代码质量与安全修复**（登录 IP 防伪造、公开分享路由、工作流口径对齐，含 1 个数据库迁移），以及**文档站全量对齐**（131 文件重写校准，新增规则中心 / 知识中心 / 开放平台三个章节）。

### Added

#### 数据保留

- **统一清理任务到数据保留策略**：分散的定时清理任务收口到数据保留策略中心并补齐遗漏表；策略列表数据表列拆分为「名称 + 物理表」两列；CMS 发布任务保留期覆盖为 180 天

#### 系统

- **登录 / 操作日志统计面板首载骨架**：统计面板首次加载展示骨架屏，避免布局抖动

### Fixed

#### 安全

- **客户端 IP 采集收口可信代理链**：登录 / OAuth / 企业身份源 / 会员认证的 `getClientInfo()`，以及幂等键、短信 / 邮件发送日志共 4 处直读 `x-forwarded-for` 的位置，统一复用 `getClientIp()` 的可信代理判定（`trustedProxyCidrs`），杜绝登录日志、风险事件、账号锁定与发送留痕中的 IP 伪造；新增防伪造单测

#### 工作流

- **活跃业务键唯一索引纳入 `returned`**：部分唯一索引谓词与 shared 活跃状态常量对齐（迁移 0030），退回待重提的实例正确占用业务键，杜绝退回期间并发插入同业务键实例
- **自动化列表 trigger 筛选补 `created`**：按「流程发起时」筛选不再 400
- **审批人类型 zod 枚举补 `decision`**：与 TS 类型、设计器 UI、服务端解析器三端对齐

#### 平台与前端

- **`workflow_public_callback` 限流规则注册进内置具名集合**：获得 DB 加载失败时的内存兜底，且不再能被当作自定义规则误删
- **公开 AI 对话分享页匿名可达**：`/public/ai-chat/:token` 补进未登录路由表，分享链接不再强制跳登录
- **CMS 表单联系字段判定使用 `fieldType`**：替换不存在的 `type` 属性引用
- 日志文件实时追踪时工具栏不再换行；成员预览弹窗改用栅格 List 展示
- http-client import 拼行与 file-utils Avro 注释失实修正

### Changed

- **文档站全量对齐 v1.90 实现**：131 个文件重写校准，新增规则中心（8 篇）、知识中心（6 篇）、开放平台（9 篇）三个章节，系统运维拆分为 7 页并补齐应用版本管理与在线升级；全站只描述当前实现、清除历史叙事表述；修复 5 处跨文档锚点链接

---

## v1.90.0 - 2026-08-26

本版本将规则中心从独立配置工具升级为**全系统统一决策底座**：统一求值门面 `decide()` + 通用执行留痕，并接入支付风控、会员反滥用、工作流网关、开放平台、CMS 提交守卫、交易投诉分流六类业务消费方；决策流/评分卡补齐版本历史与回滚。

### Added

#### 规则中心（决策底座）

- **统一求值门面 `decide()`**：全部业务消费方唯一入口，支持决策表（含灰度分桶）/决策流/评分卡/名单四类资产分发；`optional` 语义（资产缺失/异常静默放行，业务零风险接入）与 `required` 语义（缺失即 400）；只跑发布快照，编辑态不影响线上
- **通用执行留痕**：`rule_executions` 记录资产类型/Key/版本/调用方/业务关联对象（bizRef）/输入输出/命中行，异步批写不阻塞业务；执行记录页新增「调用方名称」「关联对象」列，开放平台调用自动解析为应用名
- **决策流/评分卡版本治理**：发布写入不可变版本快照（`rule_asset_versions`），版本列表与一键回滚 UI，对齐决策表已有能力
- **名单库删除保护**：删除前检查风控规则/工作流等引用方（where-used），有引用时拒绝删除

#### 业务接入

- **支付风控两层裁决**：L2 `payment_risk` 决策表（发布即接管，输出 block/review/pass）→ L1 原生维度 + 名单库批量判定；风控规则黑白名单改为引用名单库 key，多选配置
- **会员反滥用**：注册/登录前置 `risk_blacklist` 名单判定，命中 403 拦截
- **工作流路由网关三类资产**：网关节点 `decisionRef` 支持决策表/评分卡/决策流三类引用，设计器按类型联动下拉选择
- **开放平台决策 API**：`POST /api/open/v1/rules/evaluate`（新 scope `rules:evaluate`），第三方应用可远程求值三类资产，留痕调用方为应用身份
- **CMS 公开提交名单守卫**：评论/表单提交前置黑名单拦截（403）+ 灰名单观察标注，审核队列展示「观察主体」徽标辅助人工审核
- **交易投诉智能分流**：新工单按投诉类型/金额/投诉人 90 天投诉数走 `dispute_triage` 决策表，输出分流路由（加急/人工/建议自动退款）、优先级与 SLA（只收紧不放松时效）；`auto_refund_suggest` 仅为建议——详情页徽标 + 预填退款，资金动作仍人工确认；列表分流列徽标与筛选，system 时间线留痕

### Changed

- **执行留痕表通用化**：`rule_decision_executions`（决策表专用）重建为 `rule_executions`（四类资产通用），工作流专有的流程实例/节点列泛化为业务关联对象 `biz_ref`（`workflow:{instanceId}#{nodeKey}`、`payment:dispute:{disputeNo}` 等前缀语义）
- 存量消费方（工作流网关/审批人矩阵/优惠券资格）统一切换 `decide()` 门面，不再直连求值内部实现
- 执行记录数据注册 90 天保留策略（append-only 观测流水，删除零业务影响）

---

## v1.89.0 - 2026-08-26

本版本对标国内主流规则引擎补齐**规则中心四项能力**：评分卡引擎、决策表灰度发布、批量仿真、名单匹配模式；并在实测中发现并修复决策表/决策流发布门禁被误拦的存量缺陷。

### Added

#### 规则中心

- **评分卡引擎**（新页面 `/rules/scorecards`）：变量分段打分（数值区间/等值/集合/兜底）× 权重 + 基础分 → 总分 → 等级/决策映射；发布固化单快照运行时隔离编辑态，编辑乐观锁；结构化编辑器（变量分段卡片 + 等级映射）与求值测试弹窗（总分/等级/决策 + 逐变量命中追踪）；`POST /api/rules/scorecards/evaluate-by-key` 供业务方运行时调用；含纯函数求值引擎单测与种子示例「信用评分卡」
- **决策表灰度发布**：发布时可设灰度百分比（1-99）与灰度主体表达式，运行时按主体 FNV-1a 稳定分桶——同一主体灰度期内始终命中同一版本，灰度外流量走上一版本快照；支持「灰度转正」全量与「放弃灰度」（旧版本前滚为新版本的不可变回滚）；列表状态列展示灰度标签
- **决策表批量仿真**：`POST /{id}/simulate` 以编辑态逐行求值（单次 ≤200 行），弹窗粘贴 JSON Lines 输出命中率、规则行命中分布与逐行结果
- **名单条目匹配模式**：新增 精确/前缀/正则 三种匹配（正则创建时校验可编译）；命中判定精确条目走索引等值、模式条目回退逐条匹配；条目管理支持模式选择与展示

### Fixed

- **决策表/决策流发布门禁误拦（存量 P0）**：`validateExpression` 返回校验对象被当作错误字符串判真，导致所有发布均报「表达式无效：[object Object]」被拒；实测发现并修复
- 评分卡 dirty（未发布修改）判定改键序稳定比较，修复 jsonb 键序重排导致刚发布即误报

---

## v1.88.0 - 2026-08-26

本版本聚焦**报表中心页面体验**：浏览器逐页实测 13 个页面后，完成表格单行化治理、数据源列表信息整合与预警/订阅表单体验修复。

### Added

#### 报表中心

- **预警监控字段按聚合过滤**：非 count 聚合时监控字段只列出数值类型字段并附说明，不再允许选中文本字段后提交才报「非 count 聚合字段必须可数值化」
- **订阅弹窗补可订阅前提说明**：定时推送在无用户上下文执行，使用数据权限变量（`${__userId}` 等）、必填参数或行级权限数据集的仪表盘无法订阅——此前只能提交后从报错得知

### Changed

- **报表中心全部表格单元格单行化**：逐页换行审计后，自由文本列（名称/数据源/编码/时区/Cron/调度/规则/详情/原因/维度/来源公式等）统一省略号 + tooltip，复合单元格（预警来源）改不换行截断，覆盖数据源/数据集/仪表盘/订阅/打印/预警/指标/质量/治理六个页签/资产/填报等 14 个文件；残留的 `-` 空值占位统一为 `—`
- **数据源列表 14 列精简为 11 列**：最近测试/测试延迟/连续失败/最近错误并入健康状态 tooltip，连续失败 >0 时状态旁追加 ×N 红色角标

---

## v1.87.0 - 2026-08-25

本版本聚焦**知识中心文档目录体验**：目录树拖拽排序与移动、节点就地操作菜单、展开状态持久化，以及阅读视图的面包屑 / 上下篇 / 正文大纲；并修复目录树标题搜索失效的问题。

### Added

#### 知识中心

- **目录树拖拽排序与移动**：同层拖拽调序、跨层级移动、拖放到节点上成为其子文档；`POST /api/wiki/docs/{id}/move` 升级为 `{parentId, index}` 插入位语义，服务端在事务内对目标层级整层重排排序，兄弟文档保留原「更新于」与更新人；搜索过滤态自动暂停拖拽防止错位
- **树节点就地操作菜单**：悬停 / 选中节点露出操作入口——新建子文档（直达编辑页并挂到该节点下）、置顶 / 取消置顶、移动、删除；editor 仅可删除自己创建的文档（目录树节点新增 `createdBy`），与服务端权限规则一致
- **文档置顶补全 UI 入口**：详情「更多」菜单与树节点菜单均可置顶 / 取消置顶（空间管理员可用，审核中隐藏），此前服务端能力一直无入口
- **展开状态持久化**：目录树展开状态按空间记忆到本地，数据刷新与再次进入不再整树重置；新增「展开 / 收起全部」；选中文档（含深链、正文内链、搜索 / 收藏 / 最近选中）自动展开其祖先链
- **阅读视图导航增强**：嵌套文档展示可点击的层级面包屑；正文尾部按目录树阅读序提供上一篇 / 下一篇；新增正文大纲（TOC）浮层，点击平滑定位到对应章节（标题 ≥ 2 时展示）
- **目录空态引导**：空间无文档时提供「新建文档」按钮（权限门控）

### Changed

- 知识中心新建与批量导入的文档追加到目标层级末尾，不再固定排序值插到最前
- 文档中心切换文档时阅读区滚动回顶，不再残留上一篇的阅读位置

### Fixed

- 修复文档中心目录树标题搜索永远无结果的问题（JSX label 导致过滤永不命中，改按纯文本字段过滤）

---

## v1.86.0 - 2026-08-25

本版本三条主线：**多账号切换**（GitHub 风格账号切换器，免密秒切），**客户端在线升级**（应用版本管理模块 + Electron 双层更新客户端），以及 **AI 聊天体验增强**（流式 markdown 自愈、工具调用语义化展示与持久化）。

### Added

#### 账号与身份

- **GitHub 风格账号切换器**：右上角头像菜单新增当前账号块与切换弹层，最多同时保持 5 个账号登录；停靠账号仅保存资料快照 + refreshToken（accessToken 不落盘），切换经 `/api/auth/refresh` 换发新令牌并整页重载，跨标签页广播同步重载，避免新旧身份串号
- **添加账号与快捷恢复**：登录页支持 `?add_account=1` 添加账号模式（保留当前登录，成功后停靠原账号）；匿名落地登录页时展示停靠账号快捷卡片，一键免密继续
- **退出语义对齐 GitHub**：退出当前账号自动回落最近使用的停靠账号；切换弹层支持注销单个停靠账号与「退出全部账号」；新增免登录接口 `POST /api/auth/logout-by-refresh` 按 refreshToken 注销停靠会话；Demo 模式 MSW 按用户名签发多身份 token，切换器全流程可演示

#### 应用版本管理与在线升级

- **应用版本管理模块**（系统设置 → 应用版本）：应用/版本/制品三层模型，覆盖桌面端、移动端与 Web 热更新多端升级形态；发布状态机（草稿→发布→撤回）、deviceId 哈希灰度、强制更新与最低版本策略、制品上传自动 SHA256、升级看板统计；配套菜单权限种子与 MSW Mock
- **公开升级 API（免登录）**：check 检查更新、按文件名分发制品（兼容 electron-updater generic provider 的 latest.yml/blockmap 布局，支持 Range 差量下载）、latest 查询与安装回执
- **Electron 在线升级客户端（双层更新）**：Web 热更包下载 → SHA256 校验 → 解压加载，壳升级后自动清理过期热更资源；壳全量更新走 electron-updater 差量下载；支持强制更新、灰度命中与安装回执上报

#### AI 聊天

- **工具调用语义化展示与落库持久化**：工具调用以折叠卡片渲染（`updateWorkingMemory` 显示为「已更新 AI 记忆」，画像 markdown 结构化渲染并直达记忆设置）；`ai_messages` 新增 `tool_calls` / `kb_references` 列，流结束、刷新与审计回放不再丢失工具卡片与知识库引用
- **流式 markdown 自愈（remend）**：流式帧渲染前补全未闭合的粗体/斜体/行内代码/链接，消除原始符号闪现；竞技场仅生成中自愈，完成后原文直渲

### Changed

- AI 能力文档全量重写，对齐 Mastra 运行时形态（12 页）
- README 功能模块表述精简合并，补齐 v1.78-v1.85 增量；AGENTS 架构导航修正 4 处偏移

---

## v1.85.0 - 2026-08-25

本版本三条主线：**会员中心可视化增强**（看板 10 图 + 签到日历视图与悬浮名单），**公众号演示沙箱**（示例账号全部微信写操作可用），以及**行内展开表格模式落地**（6 处轻量 payload 详情从弹窗迁移为行内展开）；另有频道数据看板、操作日志统计与开放平台的多项增强修复。

### Added

#### 会员中心

- **会员看板新增 4 张图表**（6→10）：累计会员增长（近30天）、钱包收支双线（入账/支出）、注册来源分布环形图、卡券状态分布柱状图
- **签到记录新增日历视图**：列表/日历双形态切换，月历格子渲染「N 人签到 / 补签 N」徽标；新增按月聚合接口 `GET /api/member-checkins/calendar`
- **签到日历悬浮名单**：徽标悬浮展示当日摘要与签到会员列表，Semi List 固定高度滚动 + 「加载更多」按钮按日分页懒加载（每页 20），大名单不全量下发；点击日期下钻到列表明细

#### 公众号

- **微信 API 沙箱模式**：appId 以 `wxdemo` 开头的演示账号在 API 收口层短路返回模拟响应（二维码 ticket、群发 msg_id、草稿 media_id、内容安全 pass 等），客服消息、群发、菜单发布、打标、模板消息等全部写操作在无真实凭证的环境可用；19 个 mp service 零改动，真实账号行为不变

#### 频道与运营

- **频道数据看板新增五张统计图表**：订阅增长趋势（近30天）、按小时消息分布（近7天）、消息类型分布、会话评分分布（含平均分）、自动回复命中类型占比，契约 / DTO / 聚合服务 / 页面 / Mock 全链路同步

#### 平台与体验

- **操作日志统计分析新增按模块操作分布饼图**：抽取共享组件 ModuleOperationPie，超 8 个模块尾部聚合「其他」
- **偏好设置主题色新增 10 个预设**（25→35）：克莱因蓝、蒂芙尼青、翡翠绿、马尔斯青、竹青、藤萝紫、樱绯、黛蓝、古铜、梅紫

### Changed

- **6 处轻量详情迁移为行内展开**（Semi expandedRowRender，可多行同开对比）：事件调试（同时去 3s 轮询与 50 条上限、改标准分页）、决策执行记录（输入/输出双栏对比）、支付回调日志、支付事件、商户 Webhook 投递、开放平台 Webhook 投递
- **站内信直插收口到通知中心 `notify()` 统一入口**
- **错误 Issue 详情抽屉对齐非卡片报表风格**（portal 渲染逃过页面级扁平化，显式挂类）
- **开放平台应用管理与我的应用弹窗加宽至 800**，labelWidth 统一 140

### Fixed

- **会员前台实测修复三项**：公开「等级体系」页从硬编码假等级改接真实等级数据（接口去登录门槛）；特权/优惠/关于三页移除「示例占位」横幅；「我的关注」页移除与专属页重复的签到卡片
- **API 调试台**：无 appId 参数时应用选择器显示「0」且自动选中失效；补 placeholder
- **菜单种子**：删除开放平台重复的「管理应用」按钮权限行
- **频道退订确认弹窗**收敛到统一实现

---

## v1.84.0 - 2026-08-25

本版本两条主线：**频道消息富文本全链路**（图文群发与自动回复统一接入富文本编辑，发布端 / 接收端 / 服务端净化闭环，内容编辑收敛为公共组件），以及**表格展示治理**（通知策略、AI 服务商落地 Semi 原生分组表格）；消息中心补齐在线状态双态、双侧头像与频道右键菜单，AI 评测中心接入 LLM-as-judge 打分器。

### Added

#### 频道 · 图文富文本全链路

- **图文群发接入富文本编辑器**：发布弹窗改为 1100px SideSheet，正文富文本整行独占（wangEditor，支持标题 / 加粗 / 列表 / 引用 / 图片混排），预览改为按钮弹窗；服务端 `sanitizeCmsHtml` 白名单净化正文随卡片投递，`content` 存纯文本摘录供列表 / 会话预览
- **自动回复图文支持富文本正文**：`ChannelRichReplyExtra` 新增 `bodyHtml`，保存规则时净化入库、命中时随卡片下发；编辑弹窗加宽至 760px 并新增图文预览
- **接收端「阅读全文」**：卡片消息携带正文时可点击打开阅读弹窗（DOMPurify 双保险渲染），图文卡片链接经「查看详情」按钮打开
- **内容编辑公共组件**：新增 `ChannelContentEditor` + `channel-content`（值对象 / 校验 / 字段渲染 / 正文富文本 / 图文预览），群发与自动回复共用同一实现，消除两处手写漂移

#### 消息中心

- **在线状态双态化**：头像状态点区分在线（绿）/ 离线（灰），消息气泡双侧显示头像（气泡头像不叠状态点）
- **频道右键菜单**：会话列表频道条目补上下文菜单（退订频道，带确认）

#### AI · 评测中心

- **LLM-as-judge 打分器**：接入 Mastra 内置裁判模型打分器；移除对中文语料无效的英文 NLP 打分器

#### 偏好设置

- **6 个新主题色预设**

### Changed

- **通知策略事件表改用 Semi 原生分组表格**：分组名整行组头展示、点击可折叠；事件列 / 特性列加宽保证单行完整显示
- **AI 服务商页改用 Semi 原生分组表格**：组头整行渲染「服务商名 · N 个配置」，删除前端聚合造树与全部分组行特判，数据源回归扁平列表
- **租户管理新增 / 编辑弹窗改为 SideSheet**
- **智能对话页默认不选中首个会话**，进入时展示欢迎页
- **未读消息分割线**由危险红改为主题色

### Fixed

- **通知策略事件表渲染错乱**：原「分组」列以 antd 风格 `onCell → rowSpan: 0` 做合并，Semi 将其透传为 `<td rowspan="0">`（HTML 语义为贯穿到表格末尾），每行多出一个贯穿全表的单元格导致整表错位
- **AppModal 全屏时正文区无法滚动**：全屏态 content 锁定视口高但 body 无滚动约束，内容超高被裁剪；content 转纵向 flex、body 占余量滚动
- **富文本编辑器粘贴丢失列表语义**：默认粘贴管线丢弃 ul / ol 结构，`customPaste` 拦截走 `dangerouslyInsertHtml` 保留
- **自动回复编辑弹窗保存取错回复类型**：打开后未改动表单字段时 `onValueChange` 收集为空，改用 `formApi.getValues()` 快照
- **自动回复抽屉列溢出**：抽屉 620px 塞 8 列导致关键词逐字折行、内容与状态列重叠；加宽至 1000px 并固定列宽
- **表格文件预览恒用亮色渲染**，规避暗色主题下文件内嵌样式不可读
- **租户套餐弹窗 label 过窄**导致必填星号折行

---

## v1.83.0 - 2026-08-24

本版本三条主线：**AI 用户级能力**（个人 AI 配置对齐全局服务商形态 + working memory 记忆画像 + Studio 日志页打通）、**工作流可观测性**（流程详情新增流转记录、死信失败聚类树形下钻、触发器执行接入统一实例详情），以及流程监控页的组件统一与视觉治理；并完成全量依赖升级。

### Added

#### AI · 用户级 AI 能力

- **用户级 AI 设置与记忆画像**：新表 `ai_user_settings`（用户 1:1，settings jsonb 稀疏存储）替换 `ai_user_preferences`，个人指令归入 instructions 域并新增 memory 域；开启 Mastra working memory（resource 域用户画像，按 `user:{id}` 物理隔离），模型自动从对话中维护跨对话用户信息；前端 PreferenceModal 升级为 AiSettingsModal（个人指令 / AI 记忆两个 Tab，画像可编辑可清空）
- **个人 AI 配置 v2 对齐全局服务商形态**：`user_ai_configs` 重建为 models[] / defaultModel / headers / providerOptions / capabilities（与系统服务商配置同构的用户子集）；解析收敛复用系统同款 `applyModelOverride`，聊天选择器按 `user-{id}:{model}` 逐模型展开，capabilities 判定统一（用户配置的图片上传 / 工具按钮不再失效）；服务商表单 user 模式共享系统的模型区与能力区
- **「我的 AI 配置」入口常显**：移除 `ai_allow_user_custom_key` 系统开关及前后端全部门控点

#### AI · Mastra Studio 日志

- **Studio 日志页接入**：存储升级 PostgresStoreVNext（观测域落 `mastra_log_events`），Mastra 实例配 PinoLogger 经 DualLogger 双路分发，Studio /logs 正常展示运行日志
- **控制台与观测两级独立**：控制台保持 info 级干净输出，观测存储收 debug 全量（含 usage tokens 等结构化数据）

#### 工作流 · 流程详情与死信下钻

- **流程详情新增「流转记录」Tab**：通用详情面板增加审批流转表格（审批节点 / 审批人 / 开始与结束时间 / 审批状态 / 审批建议 / 耗时），支持显示范围切换（仅审批环节（默认，与审批链口径一致）/ 含抄送 / 全部记录）；实例监控、我的申请、审批详情、健康巡检、触发器执行等复用入口同时生效
- **失败聚类树形明细**：作业账本失败聚类弹窗改为树形表格（簇为父行、成员作业为子行），每簇附首次 / 最近失败时间、涉及实例数与成员明细（作业 ID、流程实例、执行进程 lockedBy、尝试次数、完整错误），成员可直达作业详情；配全部展开 / 折叠
- **触发器执行接入统一实例详情**：列表与详情补实例标题（后端 join 实例表），实例列可点击打开统一流程详情抽屉

### Changed

- **作业账本运行状态去卡片化**：自绘边框卡片改为 StatGrid / StatCard 报表式细线分栏，与其他统计页视觉一致
- **流程监控实例列组件统一**：数据分析·超时待办、引擎诊断·动作样本、补偿工单、触发器执行的实例列统一改用 WorkflowInstanceCell；实例标题链接从 Semi 默认蓝改为主题主色（含 hover / active 状态）
- **首页移除「活跃用户」统计卡**：该指标实际统计启用状态账号数，与「活跃」语义不符且与用户总数高度重复；7 天用户活跃度图表（登录日活口径）保留
- **依赖升级**：28 项 patch/minor（TanStack Query 5.102、vite 8.2.2、file-viewer 2.3.x、pg-boss 12.28、mysql2 3.24、AWS SDK 等），手动升级 electron 43.4.1 与 pdfkit 0.20.1；根 package.json 显式声明 vite ^8.2.2 修复 vitepress 传递依赖把 vite 5 提升到根导致的构建失败

### Fixed

- **死信弹窗误复现**：关闭失败聚类弹窗后切换作业类型 Tab，新面板挂载重复消费旧下钻信号导致弹窗凭空弹出
- **作业账本摘要溢出**：长幂等键 Tag 无宽度约束压进相邻列，限宽后省略号截断、Tooltip 保留完整值；最近错误列同步设固定宽度
- **事件订阅操作列挤压**：按动作宽度公式修正主表（280→310）与投递记录表（130→170）操作列
- **StatCard 包裹层竖线**：被 Tooltip 包裹时 button 形态 UA 默认左边框在数值旁露出多余竖线

---

## v1.82.0 - 2026-08-23

本版本聚焦**智能对话体验打磨**：打通私有 OpenAI 兼容网关的思维链透出（会话级推理力度选择 + 思考过程折叠面板），图片消息持久化与粘贴截图上传，气泡标注实际模型与完整时间；审计/反馈上下文弹窗改为复用聊天对话渲染组件，知识库文档支持回看原文。

### Added

#### AI · 思维链与推理力度

- **OpenAI 兼容网关思维链透出**：Mastra 统一推理档位只对 V4 目录模型生效，兼容直连（V2）会静默忽略；`buildModelChain` 新增推理档位兼容层，把档位翻译为 providerOptions 的 `reasoningEffort` + `thinking.type` 请求体字段，网关据此回传 `reasoning_content`，思考过程实时流入折叠面板并持久化
- **会话级推理力度选择**：聊天输入框配置区新增「推理力度」下拉（跟随配置 / 厂商默认 / 关闭 / 极低→极高七档），优先级：会话选择 > 智能体 modelSettings > 服务商配置；服务商表单同步新增推理力度字段

#### AI · 图片消息

- **图片消息持久化**：发送的图片经统一文件存储落盘（`ai_messages.images` 列存文件引用），刷新 / 切换会话后气泡回显图片（`/api/files/{id}/content` 稳定 URL），不再只当轮可见；解除图片数量与单张大小限制
- **粘贴截图上传**：剪贴板图片直接进入待发图片条（vision 模型），无需手动选文件

#### AI · 对话气泡信息

- **模型标注**：每条回复的气泡标题显示实际使用的模型（failover 后为切换目标），流式生成结束即时标注，刷新后持久显示
- **消息时间**：气泡标题行显示完整年月日时分秒（用户与 AI 消息均显示）

#### AI · 治理页面

- **审计 / 反馈上下文回放复用聊天渲染**：抽取 `message-adapters` 共享适配层与 `AiMessagesViewer` 只读回放组件，上下文弹窗以 AIChatDialogue 渲染思维链 / 图片 / 模型标注 / 完整时间，与智能对话保持一致；上下文接口补发送人（用户名 / 昵称 / 头像），目标消息带高亮标记
- **知识库文档回看**：新增文档分块内容查询端点，文档管理表新增「查看」操作，弹窗按分块卡片展示原文（含 token 数）

### Fixed

- **聊天区生成中闪烁**：对话区与左侧会话列表在流式生成 / 保存刷新时整屏闪动（`isFetching` 条件渲染导致组件被 Spin 替换卸载），改绑 `isLoading` 后零闪烁
- **配置区选择静默失效**：AIChatInput 配置区双层 Configure 包裹导致内层 Context 拦截取值，模型切换等配置从未实际生效；同时修复选项加载后 Select 重挂触发 Semi onRemove 清空已选模型（vision 能力判断失效、上传按钮消失）
- **对话审计与 AI 反馈页面无法滚动**：非标布局（`overflow:hidden` + 未配 `scroll.y`）致页面级与表格级滚动双双失效，改回项目标准列表页布局
- **带思维链的消息不渲染思考面板**：`output_text` 字段短路 Semi 数组 content 渲染管线，删除后思考 / 工具调用 / 引用块正常展示

---

## v1.81.0 - 2026-08-23

本版本完成 **AI 域全量迁移至 Mastra 框架**的三阶段工程：模型层接入 178+ 服务商目录与多级降级链，运行时以 Mastra Memory / PgVector 重建上下文引擎与知识库检索，智能体去市场化改为「创建即注册」的一等 Mastra Agent，评测迁移 Datasets/Experiments，并经官方 Hono 适配器挂载 Mastra 标准 API 作为 **Mastra Studio** 后端（开发一键起、生产静态部署），全链路（对话 / 智能体 / 评测 / 工作流 / 追踪）在 Studio 实测打通。

### Added

#### AI · Mastra 模型层（Phase 1）

- **服务商目录接入**：服务商配置改为 Mastra 模型目录形态（`providerId` + 多模型 + 默认模型），支持 178+ 服务商与私有 OpenAI 兼容网关（`custom` 直连 baseUrl）；新增目录查询接口（`GET /ai/providers/catalog`、`catalog/{id}/models`）
- **多级模型降级链**：配置级 `fallbacks` 级联（每级独立重试次数 / 模型设置 / providerOptions），5xx / 限流 / 超时自动切换下一级
- 服务商表单重构：目录选择器、从 API 拉取模型清单、降级链编辑器

#### AI · Mastra 运行时（Phase 2）

- **Memory 上下文引擎**：对话上下文改由 Mastra Memory 承载（近 20 条 + 可选语义召回），业务消息账本与 Memory thread 确定性映射，分支操作（重新生成 / 编辑重发 / 切分支 / 删消息）自动重建镜像
- **PgVector 知识库检索**：RAG 迁移 MDocument 分块 + ModelRouterEmbeddingModel + PgVector（每库独立索引，metadata 零回表）；Mastra 运行时数据落同库独立 `mastra` schema
- 未配置 embedding 模型时语义检索自动退化为关键词检索

#### AI · 智能体与评测（Phase 3）

- **智能体去市场化**：删除市场 / 上架审核 / 克隆概念，创建即用；参数向 Mastra 对齐（instructions / modelSettings / maxSteps），创建 / 更新 / 停用 / 删除全程与 Mastra 注册表同步（`agent-{id}`），可作为评测目标并在 Studio 调试
- **编程式内置智能体示例**：`biz-demo/demo-agent` 演示 zod 工具查询真实运营数据、`.agent()` 步骤 + structuredOutput 的周报 Workflow，及 Agent×Workflow 双向整合（workflows 自动转工具）
- **评测迁移 Mastra Datasets/Experiments**：数据集版本化管理条目，实验异步执行 + 内置 ground-truth 打分器，按打分器聚合平均分与逐条结果对比；评测页重写为数据集 + 条目管理 + 实验发起 / 轮询 / 结果视图

#### AI · Mastra Studio 接入

- **Hono 官方适配器挂载 Mastra 标准 API**（`/api/mastra/*`）：agents / workflows / datasets / experiments / scorers / traces / memory 全部端点，懒初始化零冷启动成本，上游系统鉴权 + `ai:studio:access` 权限门控（菜单「Studio 接入」）
- **开发一键起 Studio**：`npm run dev:studio`（端口 5380 直连后端），`MASTRA_STUDIO_ALLOW_ANONYMOUS` 开发免贴 token（生产强制失效）；VS Code 新增「Mastra Studio」与「Full Stack + Studio」运行配置
- **生产静态部署**：`npm run build:studio` 产出同源自适应静态产物（Docker 镜像内置 `/studio` 入口，手动部署文档含 Nginx 配置与鉴权说明）
- **执行链路可观测**：后台对话 / 智能体 / 评测 / 工作流每次执行的完整 traces（模型调用 / 工具 / Memory 操作）落 `mastra_ai_spans`，Studio 追踪页可查，敏感数据自动脱敏

### Changed

- **BREAKING**：AI 服务商配置 schema v2（providerId / models / defaultModel / fallbacks）、智能体 schema v2（instructions / modelSettings / maxSteps），评测数据全部迁移 mastra schema，历史 AI 配置与评测数据不保留
- 智能体创建 / 编辑改用 SideSheet（标签加宽不折行）
- AI 评测不再挂任务中心，由 Mastra Experiments 自带异步执行承载
- 全局 CORS `allowHeaders` 改为预检反射；`/api/mastra` 单独反射 Origin + 允许凭据（Studio 请求带 credentials）
- mastra CLI 进根 devDependencies，版本随锁文件统一管理

### Fixed

- 新建对话在侧栏出现两条重复行（TanStack Query v5 mutateAsync 等待 invalidate refetch 完成后手动前插未去重）
- zenith-chat 无 requestContext 注入时（Studio 详情 / 评测目标）模型解析为 undefined 报 Agent not found，现回退系统默认服务商配置
- Mastra OpenAPI spec 因子 app 路径错位返回空 paths（改用官方 prefix 选项后修复）
- AI 服务商「名称 / 供应商」列过窄；智能对话页用户头像缺失（接入通用 UserAvatar 首字母兜底）

---

## v1.80.0 - 2026-08-22

本版本围绕**工作流运行时正确性**、**开放平台协议合规**与**报表中心可用性**三条线：修复门控触发器 token 提前越过、业务接入桥同名随机命中两处引擎级缺陷；审批代理新增**直接代批模式**（解决委托人缺席流程卡死）；流程自动化补齐**动作执行留痕**、定时发起支持**表单数据预填**；OAuth2 标准端点改为 **RFC 合规顶层格式**；ChatBI 治理数据集解锁敏感表引用。以上均基于工作流引擎全目录（18 页）、开放平台（9 页）与报表中心（14 页）的端到端浏览器实测。

### Added

#### 工作流 · 流程自动化与定时发起

- **自动化动作执行留痕**：新增 `workflow_automation_runs` 记录表，站内信 / Webhook / 发起流程 / 回写字段每次执行（成功 / 失败 / 幂等去重跳过）均落库，含耗时与错误摘要；规则列表新增「执行记录」抽屉（触发实例 / 时机 / 动作序号 / 结果 / 耗时），管理员可核对 Webhook 等副作用是否真实生效
- **定时发起表单数据预填**：规则表单支持配置发起实例的 formData（JSON），选定流程后动态提示可用字段（designer 表单字段含必填标注 / custom 变量声明）——此前发起的实例恒为空表单，条件分支按 undefined 求值
- 自动化「所属流程 / 目标流程」下拉仅列已发布且非业务系统主导的定义；动作列表补充异步执行 / 重试 / 幂等去重说明

#### 工作流 · 审批代理

- **直接代批模式**（`mode=full`，新默认）：代理人审批即推进流程，时间线留痕「[代 xxx 审批]」——解决委托的核心场景（委托人出差 / 休假）下建议制回执仍卡在委托人身上的问题；原建议制（`suggest`）保留可选，手动委派（任务级）维持建议制语义
- 委托模式在任务分派时**快照固化**（规则后续修改不影响已派任务）；待办列表委托任务显示「代 xxx」标识，悬浮说明两种模式语义

### Changed

- **OAuth2 标准端点 RFC 合规**：`/oauth2/userinfo`（OIDC claims）、`/token/introspect`（RFC 7662 `{active,...}`）、`/token/revoke`（RFC 7009 空响应）去除业务信封改顶层格式，标准 OAuth2 / OIDC 客户端库可直接对接
- 工作流事件订阅新增 / 编辑与投递详情弹窗改为 SideSheet（与流程自动化一致），投递详情叠加在投递记录抽屉之上
- 流程设计器工具栏改 grid 三段布局：步骤导航严格居中，流程名称用满真实剩余空间（修复窄窗截断为单字符且不随变宽恢复）
- 顶栏移除最近访问图标，菜单搜索改用全局最近访问记录
- 开放平台各页表格单行化：多标签列（授权类型 / 权限范围 / 订阅事件 / Scope）改 TagGroup 收纳 + 悬浮展开，长文本列 ellipsis + tooltip

### Fixed

- **门控触发器 token 提前越过**（引擎级）：token 推进此前仅对 callback 触发器停驻，而任务展开把 callback / block / 数据变更均建为 waiting——作业完成推进时报「缺少执行 Token」，任务永久残留、数据未落库时后续条件分支已求值；现三处（token 引擎 / 任务展开 / 作业执行）统一 `isGatedTrigger` 判定，updateData / deleteData / callback / 失败阻塞全链路实测通过
- **业务接入桥同名定义随机命中**：按名称解析流程定义无排序取 `limit(1)`，同名多版本时随机命中旧定义（实测命中已停用定义导致实例秒批）；现取最新发布版本，多匹配告警
- **ChatBI 治理数据集引用敏感表被拒**：数据集 SQL 已过治理审核仍被表级黑名单拦截（403），治理数据集上下文基本不可用；现数据集模式放行其引用表的列结构，密码 / 密钥等敏感列仍然过滤
- **弹窗表单静默失败**（全局）：`useEditModal` 中 silent mutation 提交失败后既无提示也不关弹窗；现兜底捕获业务错误统一 Toast（自带去重，非 silent 场景不双弹）并保持弹窗供修正
- 填报记录列表显示裸 ID（「模板 #1」「用户 #1」）→ 解析为模板名称与提交人昵称
- 定时发起状态文案统一「启用 / 禁用」（此前下拉与列表两处不一致）

---

## v1.79.0 - 2026-08-22

本版本为 **CMS 建站主题冲刺**：以 5 个国内典型站型（政府门户 / 企业官网 / 游戏资讯 / 融媒体 / 高校）从零建站实测为驱动，新增 **news-portal 新闻门户主题**（含 4 个变体模板），完成**主题样式体系重构**（样式外置 CSS 文件 + 指纹外链资产，列表页 HTML 约 29KB → 7KB）与全部内置主题的国内门户审美升级；修复编辑站点时主题切换被静默丢弃、CMS 静态化触发 dev 后端重启等问题，并全量校对 CMS 文档站内容对齐当前实现。

### Added

#### CMS · news-portal 新闻门户主题

- **第五套内置主题**：面向地方融媒体 / 行业资讯门户的报纸风版式——居中大报头 + 口号、主色主导航（固定高度，高亮与导航条严格重叠）、首页头条区（置顶文章自动升为大标题 + 摘要 + 子链）、多栏新闻区块、热点排行侧栏、新闻详情（来源 / 记者 / 责编脚注）
- **四个变体模板**：`list-headline`（纯标题两栏，时政要闻 / 通知类栏目）、`list-photo`（图片网格，图集「N 图」/ 视频「▶」角标）、`detail-plain`（简洁正文，公告 / 启事弱化新闻元信息）、`detail-wide`（宽幅版式，视频 / 图集大屏内容）——覆盖站点默认 / 栏目级 / 内容级三级模板引用
- 主题参数：报头口号（`slogan`）、首页栏目区块（`homeChannels`）、页脚文案；支持站点主色覆盖与首页侧栏部件插槽

#### CMS · 主题样式体系

- **样式源文件化**：主题样式从 tsx 内联模板字符串迁出为同目录 `styles.css`，跨主题公共样式收口 `_shared/base.css`（模型字段表 / 图集网格与播放器 / 内链词），`theme-css.ts` 统一装配（base + 主题 + 站点级主色 / 暗色覆盖）并计算内容指纹；开发模式直读文件——改 CSS 刷新即生效、不触发后端重启
- **输出双模式**：渲染管线注入 `ctx.assets` 由 `SeoHead` 统一消费——预览路径内联（改主题 / 参数即时可见、不落盘）；正式渲染外链 `/_assets/theme.{hash}.css`（`Cache-Control: immutable`），资产 miss 时前台路由现场生成自愈，孤儿清扫豁免 `_assets/` 目录
- 暗色变量组升级为 `CmsTheme.darkVars` 接口字段（default / docs 主题声明）；`build` 后置 `copy-theme-assets` 把主题 CSS 拷入 dist

#### 日志

- 登录日志与操作日志**操作人昵称化展示**（昵称 + 用户名悬浮）并支持按昵称搜索

### Changed

- **CMS 内置主题视觉升级（对齐国内门户审美）**：default 重做为「品牌区 + 实色主色导航横条」两段式头部、首页渐变 hero（无横幅图时以站名 + 简介兜底）、左色块区块标题、排行编号侧栏卡片、主色顶线居中版权页脚，多站点仅调 `themePrimary` 即可差异化；gov-portal 办事入口图标渐变与悬停反色、页脚主色顶线；magazine 霓虹发光品牌 / 评分徽章、卡片悬停上浮 + 发光描边；docs 侧栏 active 指示条与列表悬停反馈
- workflow 表单设计器三栏布局响应式适配；运维与集成页面（事件订阅 / 作业平台等）一轮体验统一
- CMS 文档站全量校对（10 篇通读，4 篇更新）：主题清单 / 样式体系 / 变体模板 / 上下文契约等全部对齐当前实现

### Fixed

- **编辑站点时主题切换未持久化**：保存 payload 此前刻意剔除 `theme` 字段（对应的独立切换流程实际不存在），用户切换主题提示成功但数据库未变、主题专属参数丢失；现编辑态正常提交，切换主题或主题参数变更后提示重建全站静态页
- **CMS 静态化触发 dev 后端重启**：静态产物写入 `storage/cms-static/` 被 tsx watch 监视，每次发布导致后端自动重启（API 间歇 502、WebSocket 断开）；dev 脚本 watch 排除 `storage/` 与 `logs/`
- gov-portal 导航项高度由 padding + line-height 推算导致缩放下高亮与导航条错位（改固定高度 + stretch 对齐）；报头红色底边与导航条黏连造成高亮上方假空隙；桌面端 overflow 裁剪绝对定位下拉子菜单
- wiki 文档浏览上报跟随选中态，默认选中首篇同样计数
- member 优惠券发放校验收口与上架配置完整性
- workflow 表单设计器联动失效、导入崩溃与工具栏窄屏适配；`useEditModal` key spread 的 React 警告

---

## v1.78.0 - 2026-08-21

本版本基于 **10 个国内典型审批场景的端到端实测**（条件分档 / 并行评审 / 顺序·比例会签 / 办理执行 / 自选审批人 / 转办加签退回撤回等全链路），对工作流引擎完成一轮**正确性与体验加固**：修复普通员工选人 403、办理节点被自动跳过、首节点无法退回发起人等 6 处高优缺陷，时间线升级为**按表单求值的预测路径**，多人节点展示**审批进度徽标**，所有自动跳过统一具名留痕。

### Added

#### 工作流 · 时间线与留痕

- **实例详情预测剩余路径**（`predictedPath`）：服务端沿定义快照从当前活动节点前向求值条件（网关语义与 token 引擎一致），时间线未来段只展示**将会执行**的节点并携带分支标签——不再把未命中分支罗列为"待审批"误导审批人
- **多人节点进度徽标**：会签 / 顺序会签 / 比例会签节点按当前轮任务展示「已同意 x/y（比例附 需 n%）」，审批人可直观判断还差几票
- **运行时排除具名留痕**：多人节点中被「同发起人 / 审批人去重」剔除的人员落 `signType='excluded'` 的跳过任务行（含原因说明），与单人节点自动跳过口径统一；留痕行不参与节点完成判定与比例分母
- **退回目标恒含「发起人（退回修改后重新提交）」**：任意节点（含首个审批节点）可将申请退回发起人补充材料，走 `returnStart` 链路（实例转 `returned`，发起人原单修改重提）；同时修复退回目标会被拒绝按钮跳转配置覆盖的隐患
- **已驳回 / 已撤回实例详情就地重提**：详情抽屉 footer 新增「重新提交」主按钮，生成草稿后自动打开预填编辑抽屉，一步进入编辑态

### Changed

- **办理（handler）节点豁免自动跳过**：打款 / 建档 / 盖章等执行动作不再被「审批人去重」「与发起人同一人」策略跳过——此前出纳先在会签中通过后，其"执行打款"节点会被静默跳过导致流程显示完成但无人执行
- **审批动作交互统一**：实例详情页「同意」与待办列表行为一致——恒弹意见弹窗（意见选填），一键快速通过收进 split 下拉作为显式选项，消除误触瞬时通过
- **办理任务措辞**：待办列表行、详情按钮与确认弹窗按执行语义显示「完成办理 / 无法办理」（节点自定义文案优先），与审批动作区分
- **发布体检口径与运行时对齐**：「部门负责人」审批人来源（空 deptIds 动态解析为发起人部门负责人）不再被判为不可解析而阻断发布
- 表单设计器字段标识（key）编辑：失焦 / 回车提交带成功与失败 Toast（非法值不再静默回退），输入框下提示提交时机

### Fixed

- **P0：普通员工发起时「人员选择」控件无任何选项**——表单 userSelect 控件数据源从需管理权限的 `/api/users/all`（403）切换为面向全员的工作流协作选人接口，与转办 / 委派 / 抄送选人同源；含必填人员字段的流程（如离职单交接人）普通员工此前无法提交
- **优雅停机挂起**：停机清理（pg-boss / DB / Redis 关闭）此前无超时，任一环节卡住导致进程失联且 watch 不自愈；现加 15s 硬闸强退 + 单步 5s 超时 + 重复信号立即强退
- SideSheet 全局视口宽度兜底（`max-width: calc(100vw - 48px)`）：消除 992px～抽屉宽度之间的保护盲区，1080px 宽的工作流抽屉在分屏 / 小笔记本视口不再向左溢出裁掉标题栏

---

## v1.77.0 - 2026-08-21

本版本聚焦**工作流引擎的可观测与运维能力**：流程监控新增跨实例的**任务监控** Tab，作业平台引入**进程内快路径**（事件 / 触发器投递延迟 5-15s → 约 1.3s），并修复一个 fire-and-forget 触发器在终态清场时被误取消的 P0 缺陷；任务中心与操作日志同步扩展内容级检索。

### Added

#### 工作流 · 任务监控

- **流程监控新增「任务监控」Tab**：跨实例的任务级视角，支持按状态 / 节点类型 / 审批人 / 发起时间等组合筛选，统计卡（待处理 / 已通过 / 已驳回 / 已挂起 / 已取消）与列表联动；行内支持催办（带确认与防重）、点击直达实例诊断
- **任务表格公共列组件**（`workflow-task-columns.tsx`）：任务编号 / 节点 / 节点类型 / 审批状态 / 审批人 / 处理意见 / 耗时等列工厂统一收口，任务监控与实例诊断任务表共用；诊断任务表补齐任务起止时间、审批人、审批状态、处理意见、耗时列
- **处理意见区分人工意见与系统留痕**：非人工节点、跳过与无审批人的留痕标注灰色「系统」标签，避免与真实审批意见混淆
- 事件订阅投递记录新增**详情弹窗**（事件 ID、HTTP 状态、请求负载、响应体、错误信息），事件类型列显示具体业务事件而非泛化类型

#### 任务中心与操作日志

- 任务中心支持按 **payload / result 内容检索**任务；统计页签重构，扩充统计维度并接入 VChart
- 操作日志支持**变更内容检索**（覆盖请求体），审计快照写入结构化裁剪

### Changed

- **作业拾取快路径**：入队后 150ms/800ms 双跳进程内直接拾取（乐观锁与 pg-boss / drain 互斥），事件通知与触发器投递延迟从 5-15s 降至约 1.3s
- **引擎诊断口径修正**:「自动化失败率」更名「作业失败率」，比率类 KPI 标注累计口径；健康分的失败触发器统计限定近 24h，不再被历史失败长期压制；活动问题条目全部携带实例定位入口
- **运行状态栏**：Worker 计数收窄至近 10 分钟心跳窗口（开发期频繁重启的历史进程行不再计入分母）；死信卡片可点击下钻失败原因聚类；数据分析 Tab 新增手动刷新
- 流程定义列表操作按钮随状态切换（草稿显示发布、已发布显示禁用 / 启用），不再以禁用态占位；监控统计卡加载期显示占位符
- 顶栏菜单搜索改为搜索框样式触发器（窄屏退化为图标）；我的任务托盘改为紧凑布局；首页欢迎区头像复用 `UserAvatar`

### Fixed

- **P0：fire-and-forget 触发器在「审批 → 触发器 → 结束」形态下永不执行**——实例进入终态时的作业清场不再取消 `trigger_dispatch`，处理器仅对 waiting 门控任务要求实例 running（已发生事实照常外呼，与 Webhook 同语义），补引擎回归测试
- 流程图路由分支节点显示字段**业务标签**而非原始表单 key
- 任务监控催办双提示（补 `unwrap`）、「系统」标签被挤压截断、长文本列统一单行省略 + Tooltip


---

## v1.76.0 - 2026-08-20

本版本新增**动态用户组**（成员按规则自动物化，权限 / 工作流 / 报表 ACL 等消费方零改动生效）与**页面状态深链体系**（分栏选中项同步 URL + 偏好开关）；数据库迁移链完成第二次基线化（42 条 → 2 条），**存量库需重建**。

### Added

#### 身份与权限 · 动态用户组

- **成员模式**：用户组新增 static（手工）/ dynamic（规则自动维护）两种成员模式，规则物化到 `user_group_members` 同一张表，权限 / 数据权限 / 工作流审批人 / 报表 ACL / 成员预览全部消费方零改动即自动生效
- **规则模型**：命中部门（可含子树）AND 命中岗位（任一）+ 强制包含 / 排除名单；隐含仅启用用户、与组同租户，排除名单优先级最高
- **同步引擎**：整组集合式重算与按用户增量评估两种粒度，diff 写入并清理前后成员权限缓存；触发点覆盖管理端增改 / 批量启停 / 批量导入、SSO JIT、SCIM、目录同步、部门移动，夜间校准任务兜底漂移
- **API 与界面**：规则 dry-run 预览（加入 / 移除 diff 明细）、手动同步接口；编辑改用 SideSheet 容纳规则构建器，成员抽屉动态组只读化（展示 + 立即同步），列表新增成员模式列；Demo 模式全量支持
- 模式互转：dynamic→static 冻结当前成员为手工维护并清空规则，static→dynamic 按预览重算

#### 前端 · 页面状态深链

- **分栏页选中项同步 URL**（`useUrlSelectionState` / `useUrlSelectionParams`）：字典、CMS 栏目、缓存管理、公众号消息、日志文件等页面的选中项以领域名参数（`?dict=`、`?site=&channel=`、`?account=&openid=`、`?file=`）双向同步，深链直达、replace 写回不污染历史；复合上下文参数单实例原子写回
- **偏好「页面状态同步到地址栏」**（默认关闭）：开启后页面级 Tab 与分栏选中项写入地址栏，刷新 / 收藏 / 分享可直达当前视图；关闭时降级为「消费即焚」——外部深链（告警跳转、分享链接）进入仍生效一次，参数应用后即移除

### Changed

- **迁移基线化（第二次）**：42 条迁移压缩为 `0000_baseline.sql` + `0001_extensions.sql` 两条，`drizzle/` 目录约 2.5MB 快照精简为两份；基线顶部前置 `CREATE EXTENSION pg_trgm`（修正 schema 内 trgm 索引先于扩展创建导致全新库迁移失败的顺序问题）。**基线不保留向后数据兼容：存量库需重建**（新建库 `db:migrate` + `db:seed` 一步完成），验证方式为旧链 / 新基线双空库结构化 diff 零差异
- **我的消息 / 公告中心改版**：表格改为 Semi List 紧凑两行列表（标题行 + 单行摘要省略），未读以圆点 + 标题加粗 + 已读淡化表达；两页统一为 page-tabs-page 结构与「Tabs 下方工具栏」按钮顺序（批量操作 → 全部标记为已读 → 刷新），我的消息保留全选 / 批量已读 / 批量删除
- **用户组授权口径统一**（`lib/user-group-access.ts` 共享内核）：禁用组不再参与工作流审批路由（并补上禁用用户不被选为审批人）、禁用组成员立即失去按组授予的报表资源、权限诊断视图补启用状态过滤
- 日志文件页低频操作（跳行、行号 / 换行开关、复制导出、下载、删除）收进「更多」菜单

### Fixed

- 分栏选中深链三类问题：同页 Tab 与选中项竞写 URL（以 tab 为准，选中项退回本地状态）、分页列表深链目标不在当前页被误清（按 id 拉详情兜底）、CMS 栏目单参数深链落到错误站点（改为 site+channel 复合参数成组盖章）
- 替换已被 simple-icons 移除的 lark 图标（改用 icon-park-outline:lark），修复登录 / 个人中心 / OAuth 配置页飞书图标空白

---

## v1.75.0 - 2026-08-20

本版本把**日志接入告警中心**：新增日志级别频率指标，使后台任务、事件订阅者与启动期错误（不经过 HTTP、`errorRate` 覆盖不到）也能触发告警；日志文件页同步完成十项体验与性能优化，并打通「收到告警 → 查看出错日志」的跳转闭环。含 1 个数据库迁移（0040）。

### Added

#### 告警中心 · 日志级别频率指标

- **两个新指标 `logErrorPerMin` / `logWarnPerMin`**：统计近 5 分钟应用日志对应级别的平均每分钟条数，补足 `errorRate`（仅 HTTP 5xx）的盲区——后台任务、事件订阅者、worker 与启动期错误只出现在日志里，过去只能靠人工翻日志发现
- **计数在 winston Transport 写入点拦截**（`lib/log-metrics.ts`）：零文件 I/O 与解析开销，不受日志轮转与 gzip 归档影响；按 epoch 分钟分桶的滚动窗口，内存恒定
- **两条内置开箱规则**：ERROR ≥ 10 条/分持续 3 分钟（严重）、WARN ≥ 30 条/分持续 5 分钟（警告），种子规则总数 14 → 16
- **告警到日志的跳转闭环**：日志类告警事件操作列新增「查看日志」，按触发日期深链到日志文件页并预置级别过滤，当天文件已归档时自动回退到 `.gz`

#### 日志文件页

- **搜索增强**：正则表达式与区分大小写切换（无效正则红框提示并安全降级）、「仅显示匹配行」grep 模式，与级别筛选叠加生效
- **复制 / 导出**：复制当前视图、复制全部、导出筛选结果为 txt——虚拟滚动下 `Ctrl+A` 只能选到可视区行，此前无法完整复制
- **实时追踪支持暂停 / 继续**：暂停期间新行进积压缓冲并显示积压行数、可正常搜索定位，恢复后一次性合并；断线重连期间显示状态标签
- **服务端上下文行**：`content` 接口新增 `context` 参数（0-10），关键词命中行前后保留上下文
- 级别下拉显示各级别行数统计、跳到指定行号、回到顶部按钮、一键清理全部 `.gz` 归档
- 选中文件同步到 URL `?file=`，刷新、分享链接与告警跳转均可直达

#### 偏好设置

- 新增「子菜单箭头位置」（左 / 右）：控制侧边栏可展开菜单的展开收起箭头位置，覆盖垂直 / 混合、双列与移动端抽屉三处导航

### Changed

- 日志文件读取改为 **readline 流式逐行 + 固定容量环形缓冲**，普通日志与 `.gz`（管道 gunzip）走同一路径，峰值内存由文件大小降为 O(N 行)
- 告警中心指标总数 19 → 30（文档口径修正，覆盖基础设施 / 流程引擎 / 支付 / 开放平台四类）

### Fixed

- **修复 Windows 磁盘采集长期失效**：`getDisks` 依赖冷启动 PowerShell 引擎（1-3 秒），5 秒超时在采样并发时被击穿，`execFile` 杀进程后抛出无 stderr 的 "Command failed"，导致磁盘使用率长期为空、「磁盘空间不足」规则形同虚设并持续刷 warn 日志；改用 `wmic logicaldisk` 直查 WMI（约 300ms）并回退 `Get-CimInstance`，超时放宽，错误日志补 `killed` / `code` / `stderr`
- **修复大 `.gz` 日志预览的 OOM 风险**：此前将整个文件解压后全量读入内存再切行
- 对账明细状态列加宽、告警事件触发时间列取消左固定

---

## v1.74.0 - 2026-08-19

本版本新增 **License 与功能授权体系**：以「功能目录」为唯一事实源，重构租户套餐从菜单白名单到功能授权制，并交付 Ed25519 离线签名 License 全链路（激活 / 巡检 / 席位配额 / 三级运行模式），含 2 个数据库迁移（0038-0039）。

### Added

#### License 授权 · 功能目录与套餐功能制

- **功能目录（Feature Catalog）**：13 个可授权功能（工作流 / 数据分析 / 报表 / CMS / 知识中心 / AI / 支付 / 会员 / 公众号 / 消息 / 开放平台 / 规则 / 系统运维）唯一定义在 `shared/licensing`，菜单 `featureKey` 由目录 `menuRoots` 子树在种子装配时自动派生（689 个菜单自动归类），核心能力（组织架构 / 系统管理 / 文件 / 任务等）featureKey 为空不可关闭
- **租户套餐功能制**：`tenant_package_menus` 菜单白名单整体删除，改为 `tenant_package_features` 功能分配 + `quotas` 席位配额（迁移 0038）；权限解析、角色 / 直授菜单分配、可选菜单树全部改为功能集交集（禁用套餐 = 空集 fail-closed）
- **套餐管理页改版**：菜单树弹窗改为功能开关组（3+N 标签折叠单行展示），新增席位上限配额表单

#### License 授权 · 离线签名 License（系统管理 → License 授权，菜单 2660-2662）

- **Ed25519 离线验签**：先对 payload 原始字节验签再解析（拒绝重序列化伪造），audience / keyId / 算法 / 版本显式校验；内置公开测试密钥对开箱可测，生产强制 `LICENSE_ISSUER_PUBLIC_KEY` 自有密钥
- **三级运行模式 `LICENSE_MODE`**：`off`（默认，开发 / 演示零感知）、`warn`（全放行 + 未授权调用限流记录 feature_denied 事件）、`required`（未授权功能 403、License 失效进入受限模式；登录 / 健康 / 维护 / License 管理面 break-glass 永不拦截）
- **安装身份与跨节点收敛**：`system_installations` 首启生成安装 ID（advisory lock 防并发重复建行），`licenseEpoch` 单调版本号使激活 / 停用在多节点 10 秒内收敛；进程内 SWR 快照（TTL + singleflight + 失败降级沿用旧快照），请求路径零验签开销
- **License 管理页**：授权概览（当前授权 / 部署信息 / 功能授权矩阵，支持 `?tab=` 深链）、粘贴 .zenlic 激活（自动替换旧证）、事件日志（激活 / 校验 / 状态迁移 / 功能拒绝审计，保留策略 365 天）
- **每日巡检任务**（系统调度 license-inspection）：重新验签、grace / expired 状态迁移、时钟回拨检测、到期前 30/7/3/1 天与失效时通知平台超管（通知事件 `ops.license.expiring` / `ops.license.invalid`）
- **签发 CLI `scripts/license-issue.ts`**：`--gen-keys` 生成生产密钥对；按版本预设（community / pro / enterprise）或显式功能列表签发 .zenlic

#### License 授权 · 席位配额

- **`reserveTenantSeats(tx)` 事务内席位预留**：pg advisory 事务锁串行化校验，消灭 check-then-insert 竞态；管理端创建 / 批量导入 / 自助注册 / 企业 SSO JIT / SCIM / 目录同步 / 租户初始管理员七条建号路径全部收口
- **双层上限（祖父条款语义，存量永不回收）**：部署级 License `limits.maxUsers`（required 拒绝 / warn 放行并记录 limit_warning）+ 租户级上限（租户 maxUsers 与套餐 quotas.maxUsers 取最小值）

#### 日志与观测

- 登录 / 操作日志统计分析全面增强；操作日志功能模块列加宽并以 Tooltip 展示溢出内容

### Changed

- 租户统计「套餐菜单数」改为「套餐功能数」；套餐 DTO `menuIds/menuCount` 替换为 `features/quotas/featureCount`
- 套餐分配接口 `PUT /api/tenant-packages/{id}/menus` 替换为 `PUT /api/tenant-packages/{id}/features`
- 前后端依赖版本更新

### Fixed

- 日志表写入全面加固：字段溢出截断与进程崩溃风险防护；登录日志写入失败不再阻断登录主流程；设备信息超长导致登录失败
- 数据分析成功 / 失败趋势面积图取消堆叠，修复两线重合
- License 功能门控 403 携带可读中文消息（含功能名），前端 toast 可直接展示

---

## v1.73.0 - 2026-08-18

本版本新增**通知中心**：把此前分散在 14 个文件、24 处直调渠道函数的通知发送统一收口为 `notify()` 事件派发链路，交付类型安全事件目录（26 个事件）、可靠投递（Outbox + 兜底重投）、用户级订阅偏好矩阵、免打扰 / 邮件摘要、管理员策略覆盖与投递归因日志、退订合规链接。含 2 个数据库迁移（0036-0037）。

### Added

#### 通知中心 · 统一派发内核

- **类型安全事件目录**：事件唯一定义源在 `shared/messaging/notification-events.ts`（26 个事件、10 个分组），事件 key 拼写错误与变量缺传在编译期即报错；数据库只存与默认不同的稀疏覆盖
- **`notify()` 唯一发送入口**：业务域只声明「发生了什么、发给谁」；渠道选择、偏好、免打扰、幂等、留痕全部由派发层负责，并以 ESLint `no-restricted-imports` 护栏禁止业务域直调底层渠道函数
- **可靠投递 Outbox**：支持事务内登记（业务回滚通知不发出）、`setImmediate` 低延迟派发、cron 每分钟兜底补投（任务 #31）、条件认领防多实例重复、5 次重试上限
- **渠道适配器注册表**：站内信 / 邮件 / 短信 / Webhook / 聊天卡片五个适配器，新增渠道零改派发器；邮件与短信投递自动落既有发送记录页
- **派发归因留痕**：每个「收件人 × 渠道」记录结论（已发送 / 抑制 / 延后 / 去重 / 失败）与归因码（偏好关闭 / 全局静音 / 不可达 / 免打扰 / 摘要 / 频控 / 投递失败），「为什么他没收到」不再靠翻服务器日志
- **事件级频控**：评论 / 提及类事件默认同一收件人同渠道 10 条 / 小时，超限抑制并留痕

#### 通知中心 · 用户偏好（个人中心 → 通知设置）

- **订阅偏好矩阵**：按分组折叠的「事件 × 渠道」开关，即点即存；必达事件与管理员锁定项显示锁定态
- **全局设置**：全局静音（必达通知除外）、按用户时区的免打扰时段（支持跨零点，紧急事件穿透，站内信不受影响、外发渠道自动延后到窗口结束）、邮件摘要模式（实时 / 每小时 / 每日定点）
- **邮件摘要聚合**：非实时模式下邮件按收件人合并为一封汇总邮件定时发出（任务 #32，每 10 分钟聚合到期分组）

#### 通知中心 · 管理员策略（系统设置 → 通知管理 → 通知策略，菜单 2650-2652）

- **事件策略**：事件目录直读代码常量（级别 / 必达 / 穿透免打扰特性一目了然）；平台 / 租户两级渠道覆盖，支持**锁定**（用户不可自行修改）与一键恢复默认；覆盖实时联动个人偏好矩阵
- **投递日志**：按事件 / 渠道 / 结论 / 时间范围筛选每次派发的决策与归因明细

#### 通知中心 · 退订合规

- 非必达事件的通知邮件自动附带 `List-Unsubscribe` / `List-Unsubscribe-Post`（RFC 8058 One-Click）头与退订页脚链接
- HMAC 无状态签名令牌 + 公开确认页：GET 展示确认按钮（防邮件客户端预取误退订），POST 应用退订；退订状态落偏好表，可在个人中心随时恢复
- 新增环境变量 `PUBLIC_BASE_URL`（默认 `http://localhost:3300`）用于出站链接拼接

### Changed

- **告警派发重构**：监控告警 / 错误告警 / 系统调度告警的 `dispatchAlertChannels` 重写为通知中心之上的薄层，保留「到底通知到人了没有」的结果回写语义；告警类事件标记为必达 + 穿透免打扰
- **工作流通知收口**：待办 / 抄送 / 催办 / 转交 / 审批结果通知不再直插站内信表（此前绕过幂等与留痕），统一走 `notify()`；流程设置里的邮件 / 短信开关语义不变（作为管理员渠道策略叠加用户偏好）
- **既有通知迁移**：知识中心（发布 / 评论 / 提及 / 审核 / 治理提醒）、租户到期提醒、开放平台（应用审核 / Webhook 失败 / 配额告警）、仪表盘评论提及、定时任务失败告警全部迁移至事件派发，并补齐站内信深链
- 移除已无调用方的 `sendSystemInApp` 底层原语

---

## v1.72.0 - 2026-08-18

本版本新增**通讯录同步模块**（三期完整落地）：支持从 LDAP/AD、钉钉、企业微信、飞书拉取组织架构与人员并保持一致，含定时调度、平台事件回调准实时增量与 SCIM 2.0 推送接入；顺带交付飞书扫码登录。含 3 个数据库迁移（0033-0035）。

### Added

#### 通讯录同步（系统设置 → 通讯录同步，菜单 2610-2643）

- **同步源管理**：支持 LDAP/AD（凭证复用企业身份源）、钉钉 / 企业微信 / 飞书（凭证复用 OAuth 配置，企微另配独立通讯录 Secret）与 SCIM 2.0 五类源；凭证单一事实源、密钥写入不回显（仅暴露已配置状态）
- **同步引擎**：部门树拓扑同步、按匹配键（手机/邮箱/用户名）绑定既有账号、字段级 diff 更新；冲突三策略（源优先/本地优先/挂起裁决），suspend 策略基于上次快照三方对比只挂起"本地被手工改过"的字段；离职自动禁用 + 强制下线 + 默认角色授予；单次禁用比例超阈值自动**熔断**防源侧误操作
- **调度与执行**：`directory-sync-tick` 系统调度每分钟扫描到期源；手动同步 / 差异预览（dry-run 不落库）接入任务中心（托盘进度、失败透传）；同步记录页含分类 diff 明细与失败重试；冲突处理页支持逐条裁决与批量忽略
- **平台事件回调（准实时增量）**：`/api/directory-sync/callbacks/{随机key}` 承接钉钉/企微/飞书通讯录变更事件——完整验签解密（钉钉/企微复用 WXBizMsgCrypt，飞书 sha256 方案新增 `lib/feishu-crypto` 含单测）与 URL 验证握手；事件仅置位标记，由调度 tick 触发幂等全量同步，多事件天然合并
- **SCIM 2.0 Server**：`/api/directory-sync/scim/{key}/v2` 提供 ServiceProviderConfig 与 Users 全套端点（Bearer Token 认证、userName/externalId 等值过滤、Azure AD 风格 PATCH active 停用并按策略踢会话、DELETE 降级为停用防误删），支持 Azure AD / Okta 用户开通推送
- **字段映射**：每个源可配置本地字段（登录名/姓名/邮箱/手机）取自哪个源侧字段或不同步，建号/绑定/更新全路径生效
- 同步运行记录纳入数据保留策略（默认 90 天，明细随记录级联清理）

#### 认证

- **飞书扫码登录**：OAuth 提供方新增飞书（授权 / 换码 / 用户信息全链路），登录页、个人中心账号绑定与 OAuth 配置页同步支持

### Changed

- **导航未读徽标全布局补齐**：垂直侧边栏展开态文字旁数字徽标、收起态图标红点，移动端抽屉与 double 子导航接入；徽标配色统一为 danger 红色（新增共享 `decorateNavItemsWithBadges`，无徽标时保持 items 引用稳定）

---

## v1.71.0 - 2026-08-18

本版本为**工作流设计体验重构与会员中心闭环优化**：工作流引擎基于 Nielsen 启发式设计评审（双代理评审 + 浏览器实测度量）落地信息架构与认知负载四项改进；会员中心完成三轮（P1-P3）跨页闭环与语义澄清；另含全站表格数字列对齐规范化（216 处）。无数据库迁移。

### Changed

#### 工作流引擎（设计评审驱动）

- **菜单 IA 重组为三组分层**：工作流引擎下 17 个平铺子菜单按使用角色重组为「审批中心」（发起/待办/申请/抄送/已办/审批代理，全员日常）、「流程管理」（定义/模板/表单库/自动化/定时发起，流程管理员）与「运维与集成」（监控/巡检/事件订阅/触发器/数据源/连接器，运维人员）——普通员工不再被运维概念干扰；所有菜单保留原 ID 仅改归属，权限绑定、收藏与最近访问不受影响
- **审批人配置渐进披露**：19 种审批人来源改为「常用」6 种默认展示，其余按组织架构/表单驱动/动态与联动分组折叠（已选类型强制展开，选中态永不隐身）；拒绝/超时/为空/同人/去重五类兜底策略与外部审批由全展开改为折叠面板，面板头常驻当前策略摘要、偏离默认值标「已配置」、配置不完整自动展开——配置面板默认可见高度由 2005px 降至 1225px（约一屏）
- **设计器步骤完成态指示**：4 步向导导航实时显示 ✓ 已完成 / ⚠ 有缺失（悬停查看明细），判定与保存/发布校验同源（流程名、发起范围、表单绑定、未配置处理人节点、分支完整性），错误左移不再等发布时撞校验；切换表单后选择器立即显示新表单名

#### 会员中心

- **钱包退款语义澄清**：退款弹窗顶部 Banner 说明"退款为入账操作"消除与扣款的歧义；新增业务单号字段落流水供审计；退款原因改为必填（前端 + 服务端双重校验）
- **业务类型本地化**：shared 新增 `MEMBER_BIZ_TYPE_LABELS`（注册赠送/后台调整/每日签到/生日礼/邀请奖励等），积分与钱包流水列接入
- **会员看板统计卡布局**：minItemWidth 200→300，宽屏由 6+2 失衡排布改为稳定 4×2；封禁/恢复正常快速操作进折叠菜单（带确认）
- 领券记录券码列补复制按钮；签到设置三字段补说明文案

#### 全站

- **数字与金额列统一右对齐**：两轮扫描（按列名语义 + 按 dataIndex/格式化函数）共补齐 216 处表格列 `align: right`，覆盖 analytics/payment/workflow/system/cms/report/open-platform/ai/mp/wiki 与会员前台；有意保留排名徽章、评分星星、进度条等非纯数字展示

### Added

#### 会员中心（跨页闭环）

- **会员详情抽屉跨页闭环**：积分/钱包/卡券/签到四个统计卡与最近记录区可点击跳转对应管理页并按会员 ID 精确筛选，不再是只读死端；新增 `useListDeepLink` hook（一次性深链筛选，消费即焚），六个流水页接入 `?memberKeyword=` 深链
- **看板/等级/优惠券下钻**：看板 8 个统计卡、等级"会员数"、优惠券"已发/总量"全部可点击下钻至对应列表并自动带筛选（`?levelId=` / `?couponId=` 深链）
- 后台创建会员未指定等级时按成长值 0 匹配初始等级，消除"无等级"空档

### Fixed

- 工作流仿真时间轴动画改走合成器（transform 替代 width/height 过渡），消除拖动回放的布局重排；仿真检查器 3px 色条降为 1px 标准边框；流程分类颜色输入改用 Semi Input 统一质感
- 会员管理用户名列防换行（150 宽 + 省略号 Tooltip）；标签管理说明列省略显示、操作列加宽

---

## v1.70.0 - 2026-08-18

本版本为**开放平台安全架构重构**：通过内置浏览器与真实 API 调用对开放平台目录 9 个页面 + OAuth2 授权流程做端到端实测，发现并修复零鉴权、数据完整性与事件风暴级缺陷，并将割裂的「OAuth2 令牌」与「AppKey 签名」两套鉴权体系统一为单一 principal 模型。含 1 个数据库迁移（`open_api_call_logs` 新增鉴权通道与调用用户字段）。

### Added

#### 开放平台

- **统一 principal 双通道鉴权**：网关中间件重构为 `openGatewayAuth`，同时接受 `Authorization: Bearer oat_` 令牌与 `X-App-Key` + HMAC 签名，两条通道归一为 `{ app, channel, userId, scopes }`。OAuth2 授权码 / client_credentials 签发的令牌**首次可用于调用开放 API**（此前令牌只能调 userinfo / introspect，与网关完全隔离）
- **我的已授权应用**：个人中心新增「已授权应用」页签，用户可查看自己授权给第三方应用的权限范围与授权时间并一键撤销；撤销会连带作废该用户在该应用下的全部令牌与未兑换授权码
- **调用日志鉴权维度**：调用日志与统计页新增「鉴权通道」列（Bearer / HMAC 签名）与调用用户记录，此前恒空的 Scope 列现在承载真实的令牌级 scope
- **API Scope 引用计数**：Scope 列表新增「被引用」列，删除前即可看到风险
- **调试台端点目录**：`GET /api/developer-apps/debug/endpoints` 按实际注册路由派生端点清单，调试台从 3 个演示端点扩展到全部开放端点（含 CMS Headless 8 个），支持路径参数与 PUT / DELETE
- **Webhook 开发白名单**：新增 `OPEN_WEBHOOK_ALLOWED_HOSTS` 配置，开发环境可放行本机回调地址，使投递链路在本地即可端到端验证

### Changed

#### 开放平台

- **`signEnabled` 语义变更为「AppKey 签名通道开关」**：关闭时应用仅支持 OAuth2 Bearer 调用；开启后 AppKey 通道强制签名，不再存在「裸 AppKey 免签名」路径
- **scope 校验从应用级改为令牌级**：网关按 `principal.scopes`（令牌授予 ∩ 应用允许）判定，用户的授权粒度在调用侧真正生效；应用被收窄权限后存量令牌同步降权
- **OAuth2 协议端点改用 RFC 6749 错误格式**：`/token`、`/token/revoke`、`/token/introspect` 返回 `{ error, error_description }` 而非业务包装，标准 OAuth2 客户端库可正确区分 `invalid_grant` 与 `invalid_client`
- **应用审核流程重做**：通过与驳回均需显式确认；驳回必须填写审核意见（前后端双重强制），意见写入 `reviewComment` 并通知开发者
- **删除应用改为级联清理**：事务内清理 Webhook 订阅与投递日志、令牌、令牌族、授权码、用户授权与配额告警；调用日志作为审计快照保留
- **Webhook 投递错误分类重试**：SSRF 拦截、DNS 失败、证书错误、4xx 等永久性错误一次即终止，不再占用重试队列；仅 5xx / 超时 / 连接失败走指数退避
- **校验错误文案友好化**：`validationHook` 不再把 zod 字段名与英文原文直出，自定义中文文案原样展示，内置错误翻译为「缺少必填参数「x」」等可读提示
- **个人 API Token 迁回 identity 域**：路由与服务从 `open-platform` 移至 `identity`，与个人中心入口的归属一致

### Fixed

#### 开放平台

- **修复开放 API 零鉴权漏洞**：`signEnabled=false`（新建应用默认值）时 `X-App-Key` 是唯一凭证，而 client_id 在应用列表、授权页与回调 URL 中公开可见——任何知道 client_id 的人都能以该应用身份调用开放 API。现已封死该路径
- **修复 CSRF 中间件阻断机器对机器调用**：hono `csrf()` 对无 Origin 的表单 POST 直接 403 且不调用自定义 origin 回调，导致 curl / SDK / 第三方服务端完全无法调用令牌端点（返回 403 且 message 为空），SDK 示例页全部代码实际跑不通。令牌端点与开放网关已加入排除清单
- **修复授权页「同意授权」静默失败**：授权端点强制 PKCE，但前端不校验 `code_challenge`，缺失时照常渲染同意页，点击后服务端返回 400 而界面无任何反馈。现改为进入同意页前校验并明确报错
- **修复删除被引用的 API Scope 无任何检查**：被应用引用的 scope 可直接删除，在应用侧留下悬挂引用
- **修复默认限流套餐可被删除**：删除后所有未显式绑定套餐的应用限流回退行为悬空
- **修复配额超限事件风暴**：每个被限流的 429 请求都会发出一次 `app.quota.exceeded` 事件并生成 Webhook 投递，一次流量尖峰即产生投递洪水。现按「应用 + 维度 + 周期」加冷却窗口节流
- **修复删除应用后 Webhook 变孤儿**：订阅记录残留且仍可触发投递，所属应用列退化为裸 client_id
- **修复签名工具可对任意应用代签**：仅凭公开的 clientId 即可让服务端用该应用密钥计算签名。现校验应用所有权（owner 或应用管理权限）
- **修复 Webhook 回调地址不校验可达性**：内网地址创建时一路放行，直到首次投递才被 SSRF 防护拒绝
- **修复授权页 scope 描述回退为编码**：描述取自硬编码映射而非 API Scope 表，`user:read` 等 scope 只显示编码本身
- **修复调用统计 KPI 与筛选条件语义矛盾**：KPI 走预聚合表（时间 / 应用 / 环境），日志表支持明细筛选，两者口径不同却无任何说明。现在使用明细筛选时显式提示口径差异

---

## v1.69.0 - 2026-08-17

本版本为**数据分析与数据库管理双线体验加固**：通过内置浏览器对数据分析目录（行为分析 13 页签、数据管理 8 页签、错误监控 6 页签）与数据库管理全部 7 个页签逐项实测，围绕深链直达、统计口径一致性、枚举本地化与信息降噪落地三阶段优化。无数据库迁移。

### Added

#### 数据分析

- **全目录 URL 深链**：新增通用 `useUrlTabState` hook，行为分析 / 数据管理 / 错误监控三页共 27 个子页签的激活项与 `?tab=` 双向同步——初始从 URL 恢复、切换以 replace 写回、默认页签保持地址干净、外部导航跟随，刷新与分享不再丢失位置
- **错误 Issue 直达**：错误监控支持 `?issue=id` 深链直接打开对应 Issue 详情抽屉，关闭详情自动清除参数，告警通知可携带链接精确定位
- **行为分析日期区间共享**：概览 / 页面停留 / 功能使用 / 漏斗 / 路径 / 用户分析 / 点击分布 / 获客归因八个即时响应型页签共享「近 N 天」区间（统一 7/14/30/90 天），切换页签统计口径不再漂移（事件分析为提交型、留存为周期型、实时无日期，不参与共享）
- **事件分析自动首查**：进入页签即按默认条件（全部事件 / 按日分组 / 近 30 天）自动查询，不再停留「请配置筛选条件」空态；重置回到默认查询

#### 数据库管理

- **URL 深链**：`?tab=` 与 `?table=schema.name` 同步当前页签与选中表，刷新恢复、可直接分享；登录重定向完整保留深链
- **最近打开的表**：数据浏览左栏新增最近打开区（最多 8 张，本地记忆），三种入口（树、快捷打开、深链）均计入
- **详情内层页签记忆**：表详情的结构 / 数据 / DDL 内层页签选择本地持久化，跨表与跨会话保持

### Changed

#### 数据分析

- **行为事件类型标签收口 SSOT**：shared 新增 `USER_BEHAVIOR_EVENT_TYPE_LABELS/OPTIONS`，事件字典分类列、事件调试类型 / 来源 / 环境列、会话时间轴统一消费，消除 `api_request` / `feature_use` 等裸英文与「点击 vs 功能点击」两处文案不一致
- **错误监控页签顺序**：「错误 Issue」移至第一位，与默认激活页签一致
- **事件明细详情降噪**：30+ 字段改为只平铺有值字段，空字段收敛为底部「未采集：…」一行，API / 性能类事件不再满屏「–」
- **无语义元素兜底**：功能使用 / 点击分布中 elementLabel 为裸标签名或缺失时显示「未命名 button」，UI 区域未标记时 Tag 转灰色弱化；事件字典显示名为空显示「未设置」占位
- **数据质量页签降噪**：未启用多租户时「租户事件启停覆盖」仅保留说明文字，不再渲染整套禁用状态的查询 / 新增操作面与空表

#### 数据库管理

- **SQL 控制台只读错误友好化**：前端白名单预检非只读语句（剔除字符串字面量后按分号切分判定），服务端取 PG 底层错误原因、只读事务违规归一为可读文案，不再抛出裸驱动错误
- **枚举列显示类型名**：数据浏览枚举列 oid 解析为 `pg_type` 类型名（进程内缓存），不再显示裸数字
- **操作确认与提示**：暂存超过 1 处修改时放弃需确认；查询计划 / 导出下拉按钮补充展开箭头；快捷打开输入框提示 Ctrl+P 快捷键

---

## v1.68.0 - 2026-08-17

本版本为**报表中心与工作流引擎双线实测加固**：通过内置浏览器对报表中心与工作流引擎全部页面逐页实测，修复报表侧 4 项阻断性缺陷在内的 22 项问题并落地 3 项高频操作体验优化；工作流侧根治表单库删除静默失败锁死页面的缺陷，并让系统自动执行的审批任务全程可解释。另含知识中心文档深链与跨页导航优化。无数据库迁移。

### Added

#### 报表中心

- **设计器组件删除单步撤销**：删除组件后弹出「已删除·撤销」Toast（6 秒），点击撤销原位恢复组件、布局与大屏坐标——此前删除即时生效且被自动草稿保存，误删无法挽回
- **数据集「试跑预览」按钮**：取数配置 Tab 内一键切到「预览与字段」并执行，消除改一次 SQL 就要手动切 Tab 再点预览的往返
- **列表名称可点击直达**：仪表盘名称→预览页、打印模板名称→生成预览、指标名称→指标预览、数据集名称→编辑抽屉（按权限渲染，无权限保持纯文本）
- **数据源 API 类型连接测试**：连接测试支持 API 类型（含 SSRF 防护），API 表单增加测试连接按钮

#### 知识中心

- **文档中心深链**：选中态同步 URL（`?spaceId=&docId=`），刷新恢复当前文档、地址栏可直接分享、登录重定向后精确回到原文档；深链只带 `docId` 时自动跟随所属空间，目录树定位正确
- **跨页可点导航**：知识空间「空间名称」→文档中心对应空间，评论管理「所属文档」→直达文档，知识统计「热门文档」→直达文档

#### 工作流引擎

- **发起工作台空态引导**：有流程管理权限的用户显示「去流程定义」按钮，不再对管理员展示「请联系管理员」

### Changed

#### 工作流引擎

- **系统自动任务全程可解释**：同人跳过 / 审批人去重 / 空审批人策略 / 异常兜底等自动通过（拒绝）的任务在留痕中写入可读原因，审批时间线显示「系统自动」+ 原因标注，取代原先令人困惑的「? 未指定」
- **发布前体检权重归一化**：各维度权重调整为 30/25/20/10/15，总和恒为 100%（此前字面值相加 115%）
- **流程设计器保存保持步骤**：新建流程首次保存后停留在当前步骤，不再被重置回第 1 步

#### 知识中心

- **正文站内文档链接页内切换**：`/wiki/docs?docId=N` 链接拦截为页内切换选中，不再整页跳转；外部 http(s) 链接改为新窗口打开（`rel=noopener`）

### Fixed

#### 报表中心（阻断）

- **预警表单无限递归崩溃**：`onValueChange` 同步重入 `setValue` 造成无限递归，选择数据集即整页崩溃；改为仅响应 `changedValues` 中实际变更的字段
- **无参数打印模板预览/导出无响应**：`formApi` 为 null 被拦截；无参数时直接跳过参数弹窗执行
- **打印设计器冷加载 Univer 永不挂载**：加载态早退不渲染容器导致 ref 不触发 effect；容器改 callback-ref 入 state
- **填报日期字段全部被拒**：DatePicker 提交 Date 对象序列化为 ISO 串，服务端硬编码 `YYYY-MM-DD` 校验全部拒绝；改存格式化字符串，服务端按字段 `dateFormat` 粒度校验，月粒度渲染月份选择器

#### 报表中心（其他）

- 发布仪表盘移除全局评估校验（发布走用户上下文；分享/嵌入/订阅/预警处保留）
- 全局筛选器弹窗改本地副本编辑，取消可回滚
- 治理目录列表服务端分组统计真实资源数（原恒为 0）
- 指标预览单位重复（如「2.00人人」）；来源/维度/时间字段改数据集字段下拉
- 质量运行历史/异常显示规则与数据集名称，触发方式/异常状态/维度明细本地化，评分 Tab 选中即查询
- 资产目录生命周期/状态、治理环境与发布状态、SLA 违规状态、订阅触发方式本地化
- 订阅立即推送后延时刷新列表；静态数据源隐藏检测按钮与健康状态
- 设计/预览/填报页签标题携带资源名（修复已存在页签不更新标题）；ChatBI 会话显示数据集名称，错误信息去重

#### 工作流引擎

- **表单库删除静默失败锁死页面**：删除被流程引用的表单时后端 400 但前端无任何提示、确认弹窗永不关闭、重试累积遮罩挡住整页；现展示后端错误信息，被引用表单直接禁用删除按钮并以 tooltip 说明原因，复制失败同步修复
- 知识中心种子文档死链 `[考勤与休假制度](#)` 改为真实深链

---

## v1.67.0 - 2026-08-16

本版本为**支付中心全面加固**：通过内置浏览器对全部 20 个子模块逐页实测（渠道→订单→退款→对账→结算→分账→代扣→预授权→风控→Webhook 等），修复评估发现的资金一致性 P0 缺陷与一批阻断性问题，补齐退款手续费按比例冲销（对齐渠道真实返还行为），并重构订单详情为抽屉式分组布局。共 2 个数据库迁移（0030 无 schema 变更快照、0031 台账幂等索引重建）。另含消息中心两项修复。

### Added

#### 支付中心

- **退款按比例冲销手续费**：新增 `refund.succeeded` 订阅按退款比例四舍五入冲销手续费（台账 `fee/in` 流水），全额退款末笔补差消除多笔部分退款的舍入残差——此前全额退款后手续费不返还，业务净额出现负值，与微信/支付宝真实返还行为不符；fee 聚合全链路方向敏感改造（账户余额映射、快照核对、报表实时聚合与每日快照），订单 `feeAmount` 保持下单快照（结算单为应结快照口径），资金事实以台账为准
- **支付事件详情弹窗**：事件页新增「详情」展示事件载荷 JSON（美化缩进）、最近错误全文与投递次数，`payload` 字段贯通 shared 类型 / DTO / 映射，运营排障不再需要查库
- **Webhook 端点删除审计保护**：有历史投递记录的端点拒绝删除（投递日志随端点级联删除会丢失审计），引导改为停用
- **退款审批阈值系统配置化**：`payment_refund_approval_threshold` 系统配置优先于环境变量 `PAYMENT_REFUND_APPROVAL_THRESHOLD`，后台可管理
- **`.env.example` 支付段**：登记回调基址、审批阈值与模拟投诉开关三个变量

### Changed

#### 支付中心

- **订单详情重构为 560px 右侧抽屉**（与投诉/渠道/工作流详情形态统一）：金额大字 + 状态摘要头、金额构成微指标、单号 / 业务与渠道 / 时间分组展示、错误信息 Banner 化，替代原先超出视口 300+px 的 17 字段平铺弹窗
- **单号列全域统一**：新增 `copyableNoColumn` 公共列工厂（宽 280、单行不换行、复制按钮、空值 `—`），14 个支付页面 26 处单号列统一替换——根治 Semi `ellipsis`+`copyable` 组合的 JS 测量误截断（定长单号列宽足够仍被截断且不随列宽恢复）；渠道侧单号列宽 300，结算账期列 240 防换行，风控名称列 150→220
- **财务报表分组维度切换即时生效**：业务类型 / 渠道 / 按日切换改用 `applySearch` 立即提交查询，不再需要手动点「查询」；报表过滤空 key 全零行
- **示例单「模拟支付成功」走完整支付链路**：改经统一 `simulateOrderPaid`（订单状态机 → Outbox 事件 → 台账/手续费 → Webhook → 订阅器履约），消除业务侧已支付但支付订单停在「支付中」、无台账无事件的数据分裂
- **沙箱渠道连通性测试**：直接返回模拟成功提示，不再真实外呼渠道报「配置缺失」
- **模拟投诉 Cron 默认关闭**：需显式 `PAYMENT_MOCK_DISPUTES=true` 开启（演示环境用），手动「模拟投诉」按钮不受限

### Fixed

#### 支付中心（资金一致性）

- **退款完成非原子（P0）**：新增 `settleRefundSuccess` 单事务收口（退款单置 success + 订单状态重算 + `refund.succeeded` 事件原子持久化），渠道受理 / 异步回调 / 主动查单三条路径统一——此前退款单更新与订单状态流转分属两个事务，中间崩溃导致退款成功但订单状态不变、事件与台账退款支出丢失
- **订单状态机裸更新（P0）**：下单失败置 failed 限 `pending/paying`、退款置 refunding 限 `success`、退款单渠道结果更新限 `pending/processing`、订单退款流转限 `success/refunding`——防止渠道慢响应与并发回调下 success 被覆盖为 failed
- **回调地址校验后置产生脏订单**：`assertNotifyUrl` 前移至订单落库前（fail-fast），且沙箱渠道豁免公网地址校验——此前配置缺失时每次下单尝试都留下一条 failed 脏订单
- **下单接口 `appKey` 字段被静默剥离**：下单/退款入参改用 shared 契约 schema（路由本地副本漏 `appKey` 导致 Zod 剥离后静默回退默认渠道），无效 appKey 现在正确返回 400「支付应用不存在」
- **台账幂等键扩展**（迁移 0031）：带 `refundNo` 的记账（退款支出 / 手续费冲销）按 `refundNo+type` 去重，部分唯一索引重建（原始记账限 `refund_no is null`，新增 `refund_no+type` 唯一）

#### 消息中心

- 消息收藏按人隔离 + 群消息置顶权限收敛
- 群主退群守卫 / 解散群聊 / 实时性收口

### Docs

- 支付文档同步：审批阈值配置优先级（`security.md` / `integration.md` / `admin.md`）与新增环境变量说明

---

## v1.66.0 - 2026-08-16

本版本为**工作流引擎收尾加固**：延续 v1.65 的真实浏览器实测驱动，根治「退回发起人 → 修改重提」链路的运行数据一致性缺陷（旧轮任务残留导致待办重复行与「节点缺少执行 Token」500），把审批表单附件、流程分类等按角色权限放行，为强制干预补齐留痕护栏，并让诊断 / 巡检覆盖此前的观测盲区。共 1 个数据库迁移（0029，含运行数据重置与两条部分唯一索引）。工作流与 CMS 文档全量重写为当前行为。

### Added

- **审批表单附件专用上传接口** `POST /api/workflows/attachments`：按工作流身份（可发起或可审批任一权限）放行，复用受管文件的大小上限与 magic bytes 真实类型校验并计入工作流审计；表单渲染器附件 / 图片字段接入，`FileAttachment` 组件支持 `uploadPath` 覆盖——旧实现直传文件中心管理端接口（要求 `system:file:upload`），普通发起 / 审批角色一律 403，含必填附件的流程（如付款申请）被完全阻断
- **运行数据硬性不变量**（迁移 0029）：`workflow_tasks` 激活轮次 `activation_id` 收紧为非空，新增部分唯一索引「同实例同节点同轮次同处理人的活动任务唯一」与「同实例同节点同分支路径的 active Token 唯一」，从数据库层杜绝并存轮次与重复待办
- **协作重复处理人预检**：转办 / 委派 / 加签 / 管理员改派 / 离职交接在写入前校验目标人是否已在同节点同轮持有活动任务，命中返回带姓名的 409（如「赵六·财务主管 已是本节点待办处理人」）而非撞索引报 500；委派回执遇最早委派人已持有活动任务时不再重建任务，由既有任务承接确认；离职交接冲突条目自动跳过不阻断其余
- **诊断 Task→Token 反向校验**：活动任务所在节点无 active Token 时运行时诊断报 critical「活动任务缺少执行 Token」并指引强制跳转修复——旧诊断只查 Token→Task 单向，孤儿任务型卡死实例显示「未发现明显运行时异常」
- **健康巡检补盲区**：新增 `token_task_mismatch`（critical，同上反向校验）与 `waiting_task_stuck`（warning，普通人工待办超阈值滞留）两类问题——旧巡检对无异常特征的超龄待办零感知；每条任务只报最高优先级问题
- **强制跳转影响面预览**：确认框列出将被终止的活动任务清单（任务号 / 节点 / 处理人 / 状态），跳转前可见波及范围
- **设计器未保存更改守卫**：返回列表时对当前设计与最近加载 / 保存快照比对，有改动弹确认「放弃更改并离开 / 留在此页」，防误触丢失设计

### Changed

- **待我审批切换任务视角**：同一实例的多条并行待办（并行会签、加签）各占一行、可独立勾选处理，行键与总数均按任务口径；批量操作以任务为粒度并做提交前陈旧检查——旧实现按实例渲染导致重复行键、批量选择互相干扰、总数与行数不一致
- **终态 / 退回全量清场**：驳回终止、退回发起人、撤回、取消、自动拒绝与正常完结统一清场「活动任务 + 活动 Token + 在途推进类作业」（延时唤醒 / 超时 / 触发器 / 外部派发 / 子流程六类；事件与 Webhook 等通知类不取消），退回发起人不再遗留并行分支的跨节点待办；`returned` 实例重提前追加防御性清场
- **联动跳过全量留痕**：或签 / 比例会签联动、同节点拒绝联动、退回发起人、撤回、取消、自动拒绝、流程完结、管理员强制跳转产生的 `skipped` 任务统一写入来源注释（如「[退回发起人] 流程退回修改，本待办作废」），时间线可追溯任务因何作废
- **抄送送达即完成**：「抄送我的」抄送时间改为 CC 任务送达时间（运行中补加按补加时刻计，旧实现误用实例发起时间）；节点列表、流程图卡片、审批时间线、监控任务明细四处运行态视图统一显示「已抄送」（成功色）替代「已跳过 / 待抄送」
- **强制干预原因必填**：强制跳转 comment 与批量推进卡死实例 reason 改为必填（schema 与 UI 双端），写入审计与被终止任务备注
- **流程分类与发起深链按角色放行**：`GET /api/workflows/categories/all` 放行发起 / 审批权限——旧守卫仅 `workflow:definition:list`，普通审批角色每次审批 / 发起成功触发缓存刷新后重取 403，全站弹「权限不足」幽灵 toast；发起整页深链 `/workflow/launch/:id` 改从「已发布定义」同源取数，普通发起人可直接打开（旧实现调管理端定义详情接口恒 403）
- **作业面板 Worker 口径修正**：「存活 Worker」分母只统计近 24 小时有心跳的调度节点（节点 ID 含进程号、每次重启新增一行，旧口径按全历史计数显示「存活 1/496」）；新增 `system_scheduler_nodes` 数据保留策略（按最后心跳 7 天）清理历史节点行

### Fixed

- **退回发起人后修改重提产生并存轮次**（迁移 0029 配套）：旧实现退回时只清理同节点任务，并行分支的跨节点待办残留 `pending`，重提后新旧两轮任务并存——待办列表出现重复行，处理旧轮任务因执行 Token 已终止报 500「节点缺少执行 Token」，实例卡死且诊断报「未发现异常」；本版全量清场 + 唯一索引 + 反向诊断三层根治，实测退回 → 重提 → 再审批全链路通过
- **待办列表 keyword 搜索计数联表缺失**：总数查询补齐流程定义联表，关键字命中流程名称时不再因缺表报错
- **审批时间线抄送任务误标「已跳过」**：与其余三处运行态视图统一为「已抄送」语义

### Docs

- **工作流文档按最新引擎行为全量重写**：实例生命周期新增「激活轮次与运行不变量」「全量清场语义」章节；审批协作新增任务视角与预检说明；监控运维补双向 Token 一致性规则表、巡检 13 类问题清单与强制干预留痕；权限页新增公共读取接口与文件上传双端点权限表
- **CMS 文档目录重构**：按当前功能全量更新

---

## v1.65.0 - 2026-08-16

本版本为**工作流引擎正确性冲刺**：以多账号真实浏览器实测（6 部门角色 × 发起 / 审批 / 驳回 / 转办 / 委派 / 加签全操作矩阵）为驱动，修复三处引擎级严重缺陷（退回发起人语义、前加签死锁、协作选人越权依赖），并完成设计器可用性修复与 operations 双轨设计债清理。共 1 个数据库迁移（0028），流程 flowData schema 升级至 v2。

### Added

- **实例「已退回」状态（returned）**（迁移 0028）：「退回发起人」驳回策略重做——驳回后实例进入 returned 状态并清场执行 token，发起人在「我的申请」通过「修改重提」编辑表单后重新提交，同一实例保留审计历史与业务编号；新增 `instance.returned` 事件并接入站内信 / IM 卡片 / WebSocket 推送与事件订阅；流程监控新增「已退回」统计卡与筛选。旧实现把退回做成从头重新物化任务，审批人陷入「驳回 → 再收到 → 再驳回」死循环，发起人没有任何修改入口
- **工作流协作选人接口** `GET /api/workflows/selectable-users`：面向发起人 / 审批人开放（发起 / 审批 / 查询权限任一），返回租户内启用用户的最小协作字段（不含手机号邮箱等管理字段）。审批详情面板、发起表单、协办、转发、加抄送、审批代理共 6 处员工场景从系统管理接口 `/api/users/all` 切换至此——旧实现要求 system:user:list 权限，普通审批角色转办 / 委派 / 加签选人下拉恒为「暂无数据」且反复弹「权限不足」
- **诊断死锁检测**：running 实例仅剩无唤醒来源（无外部回调 / 触发器 / 子流程 / 同节点 pending）的 waiting 任务时，运行时诊断报 critical「等待任务无法被唤醒」并给出解卡建议，旧诊断对此类死锁报「未发现异常」

### Changed

- **operations 收窄为审批要求单一职责**：节点 `operations` 仅承载签名必填 / 意见必填两个审批要求开关，按钮值（approve/reject/comment）从类型、Zod、种子与设计器默认值中移除——按钮启停 / 展示名 / 附件要求的唯一事实源是 `actionButtons`（旧双轨下按 operations 配置转办等按钮会被服务端静默 403）；`workflowActionButtonKeySchema` 补齐缺失的 reduceSign；流程 flowData schema 版本升至 v2，导入旧版 JSON 自动清洗（幂等 upcast）
- **自审默认策略改为自动跳过**：审批人解析为发起人本人时默认不再生成自审任务（自批有合规风险），需要自审的流程在节点上显式配置「由发起人自己审批」；设计器选项排序推荐项优先
- **详情表单只读文本化**：详情 / 审批 / 移动审批的查看态表单将简单值字段渲染为纯文本（金额千分位 + 大写、空值「—」占位），可读性 / 可复制性 / 打印 / 无障碍均优于旧的 disabled 输入框；设计器结构预览与复杂类型（附件 / 签名 / 明细等）保持控件形态
- **审批动作文案统一**：待我审批列表行内与批量操作统一为「同意 / 拒绝」（与审批详情面板一致，旧为「通过 / 驳回」两套叫法）

### Fixed

- **前加签死锁**（迁移 0028）：`workflow_tasks` 新增 `sign_type` 专用列，加签任务写入、委派回执任务继承，before 挂起原任务的恢复判定改用该列——旧实现依赖 comment 前缀 `[加签-前]`，审批意见 / 委派回执覆盖 comment 后原审批人永远卡在 waiting（前加签 + 委派组合必死锁，实测复现）；减签的加签任务识别（前后端）同步改用 sign_type
- **前加签越权完成节点**：前加签任务定位为前置关卡，不再参与节点 and/or/sequential/ratio 完成判定——旧实现在或签节点下加签人通过会立即完成节点、跳过刚恢复的原审批人
- **金额字段配不出数值条件**：条件编辑器把金额 / 滑块 / 评分 / NPS / 公式并入数值族，可配置大于 / 小于 / 区间等操作符（旧实现仅 number 类型有数值操作符，「金额>1万走高层审批」这一最常见条件配不出来）
- **发布前体检误报**：体检抽屉经 ref 读取最新画布，修复 useCallback 闭包捕获挂载时旧 flowData 导致体检结果与画布无关（画布 4 个审批节点仍报「至少需要一个审批节点」）
- **仿真默认分支误报**：默认分支判定仅对显式标记或网关无条件出边生效，普通顺序连线不再被标注「默认分支被采用」；路径摘要优先展示实际被走的边
- **重新提交丢失优先级**：撤回 / 驳回后重新提交生成的新草稿保留原申请优先级（旧实现高优先级重提后降为普通）

---

## v1.64.0 - 2026-08-16

本版本为**数据分析可信度冲刺**：以双账号真实浏览器实测为驱动，系统性修复采集正确性（停留时长丢失、身份膨胀、错误漏报）与统计口径（在线人数、影响用户、聚合断档、站点用量）两大类问题，并完成错误监控噪音治理与分析页产品精简。共 3 个数据库迁移（0025-0027）。另含一批 CMS 建站增强（magazine 主题、列表区块标签聚合等）。

### Added

#### 数据分析：身份与采集

- **身份映射与回溯合并**（迁移 0026）：新增 `analytics_identity_map`（匿名 anonymousId → 权威 distinctId 首绑映射，防共享设备串号）；匿名事件入库前前向合并，`$identify` 落库后回溯改写历史匿名事件、会话归属与画像并入，消除 UV / 留存 / 漏斗的匿名 distinctId 膨胀（实测 3 真人不再被算作 68 访客）
- **导航失败语义事件**：404 / 403 页面上报 `page_not_found` / `page_forbidden`（含被访问路径），事件字典预置，支持失效链接与越权尝试分析
- **事件明细接口摘要列**：`$api` 事件行内显示接口 URL 与状态码 Tag（400+ 橙 / 500+ 红），免逐条点开详情排查
- **错误忽略规则**：采集设置新增 `errorIgnorePatterns` 正则列表（60 秒缓存、保存即生效），命中 message 的前端错误上报直接丢弃，用于压制框架开发告警 / 浏览器插件噪音

#### 数据分析：一致性与自愈

- **错误分组环境维度**（迁移 0027）：`error_groups` 增加 environment 并掺入指纹，同一错误在 development / production 分开成组；错误 Issue 列表支持环境筛选
- **影响用户 O(1) 维护**（迁移 0025）：新增 `error_group_identities` 身份去重表，上报事务内增量累计 `affected_users`，替代详情页懒回写（修复列表恒 0、列表与详情不一致）
- **每日聚合断档自愈**：服务启动时 `catchUpRollupGaps` 检测缺口自动补齐（最多回补 30 天）；每日定时重建窗口 2 → 7 天，容忍数日停机

### Changed

- **页面停留采集重做**：页面生命周期（可见时长累计 / 滚动深度 / 终态兜底）收口到 analytics-sdk，`pagehide` + `beforeunload` 双监听在整页刷新 / 关标签 / 直达 URL 时补发 `page_leave`——此前这些场景停留数据全部丢失，页面停留 / 会话时长 / 跳出率系统性失真；`usePageTracker` 瘦身为只报路由边界
- **首页「当前在线」口径统一**：改用近 5 分钟活跃登录用户数（与行为分析实时看板同源），替代持续累积的令牌会话计数（实测 61 → 1）
- **站点「今日用量」真实化**：按 appId 实时统计当日事件（含登录态采集），修复默认站点恒显示 0 的误导
- **热力图元素排行与坐标解耦**：无坐标点击也计入榜单（与「功能使用」同口径，修复排行恒空）；`avgX/avgY` 仅对有坐标行取平均；SDK 对程序化点击（clientX/Y 为 0）回退元素几何中心，避免左上角假热区
- **autocapture 选择器扩展**：覆盖 `[role="tab"|"menuitem"|"option"]`，Tabs 等 div 基交互控件的点击不再漏采
- **行为分析页精简**：删除「维度分布」Tab 全链路（能力由「事件分析」groupBy 1-2 维覆盖）；「获客归因」移至末位

### Fixed

- **未处理 Promise 拒绝漏报**：删除单词消息放行分支（`NetworkError` / `timeout` 类真实异常此前被静默丢弃），50 个文件 88 处 `throw new Error('word')` 控制流统一迁移为类型化 `abortSubmit()`
- **画像身份降级**：匿名批次写入不再把已识别画像（admin / member）的 identityType 刷回 anonymous

#### CMS 建站增强（随本版本发布）

- 新增 magazine 资讯杂志主题（暗色）；页面搭建内容列表区块支持按标签聚合；列表项注入 showInList 模型字段；模型编辑器补手工选项输入框

---

## v1.63.0 - 2026-08-15

本版本为 **CMS 建站能力冲刺**：新增 Theme API 与 gov-portal 政府门户主题，打通「主题参数声明取数 → 模型字段详情渲染 → 站群治理」链路，并以真实政府站从零建站实操为验收，补齐一批国内 CMS 高频运营体验。共 2 个数据库迁移（0023-0024）。另包含 Wiki 知识中心二期验收的一轮体验与治理修复。

### Added

#### CMS：主题与渲染

- **Theme API 最小闭环**：`defineHomeTemplate` 支持类型安全的 `load()` 声明式取数；`CmsThemeDataApi` 站点隔离只读门面（仅启用栏目已发布内容、URL 统一走 `contentUrl`、同参数去重、单次渲染 ≤20 次取数限流）
- **gov-portal 政府门户主题**：大页头（站名 + 副标题 + 搜索）+ 主色导航横条 + 深色页脚（主办单位 / 备案号）；首页栏目区块（要闻区含置顶角标）、办事入口图标导航、侧栏部件插槽；紧凑公文列表与政策文件详情（居中标题 + 文件信息表头）
- **主导航多级下拉菜单**：gov-portal 支持三级栏目，纯 CSS hover 展开（静态页零 JS），窄屏回落一级横滑
- **政务详情页工具条**：字号大中小切换 + 打印（含 `@media print` 打印样式），并渲染「相关阅读」
- **模型字段详情展示配置**（迁移 0023）：字段可配置「详情展示 / 分组 / 排序」，渲染管线组装为格式化后的 `modelFields`（日期格式化、选项 / 字典翻译），共享片段 `ModelFieldTable` 按分组双栏键值表渲染

#### CMS：站群治理与内容运营

- **内容模型站群治理**（迁移 0024）：模型归属「平台共享 / 站点专属」，跨站群互不可见，栏目绑定与站点扩展校验专属模型归属；新增 `GET /api/cms/models/{id}/refs` 引用统计
- **批量状态流转**：`POST /api/cms/contents/batch-status` 批量提审 / 发布 / 驳回 / 下线，逐条独立事务与状态机校验，返回部分成功明细；内容列表新增对应批量按钮
- **内容列表定时感知**：状态列新增「定时」「限时」徽标（tooltip 显示计划时间），未发布时发布时间列显示定时计划
- **站点切换器树形化**：按站群层级树形展示（TreeSelect + 搜索），当前站点持久化到 localStorage，20+ 管理页跨页面 / 刷新自动恢复
- **自动 slug**：标签建档按名称自动生成拼音 slug（手改后不覆盖）；批量建栏目默认首字母缩写（政务公开→zwgk），支持「名称|slug」显式指定
- **模型默认值**：模型编辑器补「默认值」输入框，服务端创建时回填 + 编辑器新建内容合并默认值

### Changed

- 图集 / 音视频形态渲染提为 `_shared` 共享片段：gov-portal 详情接入主图渲染，default 主题去重复用
- 内容编辑器模型必填改为「发布必填」：保存草稿放行缺失字段，提审 / 发布时由服务端按模型定义强校验并逐字段报错
- 模型字段服务端兜底校验：创建 / 更新按草稿级校验类型与选项，覆盖导入 / 采集 / 分发 / Headless 等非表单通道
- 部件条目列表显示栏目名 / 内容标题而非裸 #ID
- 会话被动失效跳登录页时提示原因（过期 / 他端注销 / 管理员强退）

### Fixed

- CMS 站内检索三级召回：截断词（如「不动产权证书遗」）不再因 AND 全命中语义整体落空，逐级放宽为精确 AND → 前缀 OR 近似（ts_rank_cd 排序）→ 标题 ILIKE 兜底（≤32 字）
- 搜索结果 URL 改走统一 `contentUrl()`：修复归档目录 / 自定义静态路径内容搜索后 404，外链形态新窗口直跳
- 站点管理树视图查询 / 重置失效：`useListSearch` 补 extraKeys 同时失效站点树；标识列加宽至 160px
- 已有权限页面的不存在子路由（如 `/cms/contents/new`）误报 403，现按 404 处理
- Wiki 二期验收修复：审核时间线 / 已处理列表 / 知识统计缓存失效、审核通过发布确认、内容治理全部文档入口与复审周期设置、审核积压按配置时限计算、无结果搜索时间时区偏差、评论关闭状态前置展示等

---

## v1.62.0 - 2026-08-15

本版本新增**知识中心（Wiki）**业务域：面向企业内部的文档协作与知识沉淀平台，与既有 AI 个人知识库（`ai:kb`）定位区分、独立建权（`wiki:*`）。涵盖空间 / 文档 / 版本 / 模板 / 标签 / 评论 / 回收站全套管理能力，以及全文检索、审核流、订阅通知、阅读确认与内容治理运营。共 4 个数据库迁移（0019-0022）、16 张新表、40+ 个 `/api/wiki/*` 端点、11 个前端页面（菜单段 16000-16104），Demo 模式 MSW 全覆盖。

### Added

#### 知识中心：文档协作主链路

- **知识空间**：公开 / 私有两种可见性，空间成员三角色（管理员 / 编辑 / 只读），成员授权抽屉管理；私有空间对非成员完全隐藏
- **文档中心工作台**：左树右详情布局，空间切换、文档树（拖拽排序 / 层级）、置顶、收藏；详情区含 Markdown 渲染、目录锚点、标签、附件、评论、版本入口
- **全屏 Markdown 编辑器**：编辑 / 预览双栏，自动保存草稿到本地（异常退出可恢复），基于 revision 的乐观锁（并发编辑冲突时弹窗提示刷新合并）
- **版本管理**：每次发布自动存档版本，版本历史列表 + 任意两版本 diff 对比 + 一键回滚
- **文档模板**：模板 CRUD 与启停，创建文档时可套用模板预填内容
- **标签体系**：标签 CRUD（含颜色），文档多标签关联与按标签筛选
- **评论**：文档评论与楼中楼回复、@提及（站内信通知被提及人）、问题标记与解决闭环；评论功能支持全局开关
- **回收站**：软删除文档进入回收站，支持恢复 / 彻底删除，按设置的保留天数自动清理

#### 知识中心：检索与个人工作台

- **全文检索**：基于 pg_trgm 的标题 / 摘要 / 正文加权模糊检索（GIN 索引），结果高亮 snippet；检索行为落库并支持点击回报
- **个人工作台 Tab**：文档中心新增「最近浏览」「我的文档」「搜索」三个视图
- **附件**：文档支持上传附件（复用统一文件中心），彻底删除时级联清理

#### 知识中心：审核与协作闭环

- **发布审核流**：草稿 → 提交审核 → 通过发布 / 驳回（可撤回），审核时间线记录每次流转与对应版本；审核开关关闭时直接发布
- **审核中心**：待审核 / 我提交的 / 已处理三个 Tab，支持通过 / 驳回（含理由）
- **订阅通知**：订阅文档后，文档发布更新时站内信提醒
- **阅读确认**：重要文档可开启「需要阅读确认」，读者点击确认后进入已读名单，作者可查看已读 / 未读
- **知识统计**：文档 / 空间 / 标签 / 评论计数、浏览量榜单、活跃作者榜、状态分布（按当前用户可见范围统计）

#### 知识中心：内容治理与运营

- **治理字段**：文档负责人、有效期、复审周期（迁移 0022），归档状态默认从树 / 列表 / 搜索隐藏
- **内容治理页**：过期 / 待复审 / 长期未更新 / 无负责人 / 草稿积压 / 审核积压 / 已归档七类清单 + 无结果搜索词分析，支持批量提醒负责人 / 归档 / 指定负责人 / 设置复审周期
- **每日治理扫描**（系统任务 `wiki-governance-tick`）：到期 / 应复审文档自动站内信提醒负责人（按天去重），回收站超期文档自动清理
- **Markdown 批量导入**：文档中心支持选择多个 `.md` 文件一键导入为草稿（首个 `#` 标题自动作为文档标题）
- **运营统计区块**：30 天新建趋势图、空间文档分布图、搜索量 / 审批 / 治理指标卡
- **知识库设置**：审核开关、评论开关、回收站保留天数、审核积压时限等全局配置
- **AI 知识库同步**：可选将指定空间的已发布文档同步进 AI 知识库向量检索（发布 / 更新 / 删除自动同步）

### Changed

- 普通用户角色对知识中心默认只读（仅浏览 / 搜索 / 评论），管理动作需管理员或空间内授权

---

## v1.61.0 - 2026-08-14

本版本为**深色底色体系专项**：暗色模式下侧边栏、顶部与主区域此前分处两档明度，主区域偏黑。本次将三区拉平到同一档，并新增偏好允许逐区调节深浅；随后对全仓做了一轮底色审计，把散落各处「复制画布色」的写法收敛为按层级取语义变量——这类写法在浅色下取值恰好等于白色而不可见，深色下则表现为比所在容器深一档。另修复 Semi Switch 内置文案在中文下换行压住滑块的问题。

### Added

#### 主题与个性化

- 新增**深色底色档位偏好**：侧边栏、顶部（顶栏 / 头部 / 面包屑栏 / 标签栏）、主区域各自可选「标准」（`bg-1`）或「更深」（`bg-0`），在偏好设置「外观」分区按区域独立配置，深色模式与浅色下的分区深色均生效；偏好随账号同步，支持拼音搜索

### Changed

#### 深色底色统一

- 暗色下主区域底色由 `bg-0`（`#16161a`）抬到 `bg-1`（`#232429`），与侧边栏、顶栏拉平：整屏一个底色，靠边框与阴影分层，与浅色下「全白 + 边框」的分层方式一致
- 拆出 `--color-header-bg`：此前顶栏跟随侧边栏变量、面包屑栏与标签栏跟随内容区变量，顶部无法作为独立区域配置；新变量统一承载顶部各条，默认取值不变
- 全仓库统一底色层级：画布 / 底衬取 `--color-content-bg`，卡片 / 面板取 `--surface-card`，浮起元素取 `bg-2`；`--semi-color-bg-0` 不再作为常规 UI 表面，仅保留给用户显式选择的「更深」档位
- 卡片底色改用语义变量 `--surface-card`（74 处）：弹窗与抽屉的表面本身处于卡片层级，其中写死 `bg-1` 的卡片与所在弹层同色、只能靠边框区分；改用该变量后组件只声明「我是卡片」，在页面内解析为 `bg-1`、在弹层内自动提升为 `bg-2`
- 删除与容器同色的冗余背景声明，改为继承：复制一份色值会在容器改动时集体失配，正是本次问题的根因。侧边栏导航、双列子栏、表单设计器外壳、标签切换器、表单画布内的嵌套块等一并清理，`.admin-content` 在 CSS 与内联样式中的重复声明去重

### Fixed

- 流程设计器深色下底色比外壳深一档：基础信息面板、流程画布、表单设计器三栏与模拟运行图按所在层级归位，流程画布跟随主区域底色档位
- 预览类组件在弹层内比弹层更深：Markdown 预览面板、PDF 预览侧栏与流程图画布同时复用在页面与弹窗 / 抽屉中，此前写死内容画布色
- ER 图与字段依赖图的画布和节点卡同为 `bg-0`，节点仅靠 1px 边框区分、没有填充层次（浅色下同样存在），现改为画布 `bg-1` + 节点 `bg-2`
- `PDFPreviewPanel` 的主题桥接从 `documentElement` 读取 Semi token，而 Semi 将 `--semi-color-*` 挂在 `body` 上，导致取值始终为空并回落到硬编码兜底色——阅读器主题从未真正跟随过明暗与主题色
- 文件网格勾选框 hover 态取 `bg-0`，深色下翻转为近黑，与同组其余规则（近白）矛盾
- 浅色主题开启「顶部栏深色」时，头部与顶栏底色不一致
- Semi Switch 的 `checkedText` / `uncheckedText` 轨道固定 20px 宽，两个中文字在 12px 字号下需 24px，超宽后换行竖排压住滑块；Webhook 机器人弹窗改为由 label 表达语义，前端错误页与站点继承抽屉将双态文案移到轨道外渲染

---

## v1.60.0 - 2026-08-14

本版本为**全栈性能专项**：对全仓做了一轮系统性性能审计（数据库查询、事件循环阻塞、React 重渲染、包体积），按影响排序修复了后端 5 处 N+1 / 逐条写入、4 处请求路径同步阻塞与资源风险，以及前端 4 个高频页面的重渲染热点；包体积经审计已有完善的懒加载与分包策略，无需改动。含一个数据库迁移（公众号素材唯一索引）。另新增系统配置名称字段，修复水印两处渲染缺陷。

### Added

#### 系统配置

- `system_configs` 新增「配置名称」字段（迁移 0016）：类型 / 校验 / DTO / 服务 / 路由 / 导出中心全链路同步，关键字搜索覆盖键 / 名称 / 描述，42 条种子配置补齐中文名称，前端列表与表单、MSW Mock 同步

### Changed

#### 后端性能：消除 N+1 与逐条写入

- 埋点事件字典 `touchEventMeta`（采集热路径）从按事件名逐条串行 upsert 改为单条多行 upsert，冲突行经 `excluded` 引用各自批次计数
- 公众号素材同步从「每条素材一次查重 + 一次写入」（每页 40 次查询）改为页级批量查重 + 多行 upsert（每页 2 次），新增 `(account_id, wechat_media_id)` 部分唯一索引作为冲突目标（迁移 0017）
- 会员生日礼发放从逐会员两次存在性查询（1000 人 ≈ 2000+ 次）改为批量预取当年已发放集合（2 次）
- 定时群发扫描从循环内逐条查公众号 / 标签改为 `inArray` 批量预取
- CMS 内容批量发布从循环内逐条查栏目归属改为一次性批量预取，快照查找同步改用 Map 消除 O(n²)

#### 后端性能：请求路径同步阻塞与资源上限

- SSH 私钥读取（每次 SSH 终端 / SFTP 连接）从 `readFileSync` 改为异步读取
- 日志文件下载的 `statSync` 改为异步；终端 cwd 校验合并 `existsSync + statSync` 双同步调用为单次异步 `stat`
- PDF 导出字体路径探测结果缓存（含未命中态）：字体安装状态运行期不变，此前每次导出重复探测最多 9 个路径
- 数据集文件解析（`/parse-file`）增加 20MB 大小上限：`REQUEST_BODY_LIMIT` 默认不挂载时此前无任何校验，超大 xlsx 经 exceljs 解压放大可耗尽内存，现按 `file.size` 元数据在缓冲前拦截并返回 413

#### 前端性能：高频重渲染治理

- 聊天页：`visibleMessages` 记忆化避免每次渲染产出新数组身份直喂 Virtuoso；Header / Footer 提升到模块级消除反复卸载重挂；读回执预计算成 Map；`MessageBubble` 以 `React.memo` 包装，未变化气泡跳过重渲染
- `MasterDetailLayout`（全站通用布局）：两处 `PaneContext.Provider value` 由每次渲染新建对象改为 `useMemo` 稳定身份；拖拽分栏期间不再每次 pointermove 同步写 localStorage，改为松手一次性落盘
- 工作流引擎诊断页：顶层每秒 `setState` 滴答（令整个含图表面板每秒全量 reconcile）隔离到独立的 `FreshnessLabel` 小组件，无数据时不启动定时器
- 音视频通话窗口：通话时长每秒强制重渲染整个 overlay（含全部媒体瓦片）隔离到自滴答的 `CallDuration` 小组件

#### 工程

- 移除 5 个默认跳过、依赖本地 PostgreSQL 的 DB 集成测试（资金链路 / 任务幂等 / 工作流 Token / 支付可靠性 / 会员成长），发布流程与贡献指南中的对应规范同步清理
- 发布验证提速：本地按受影响包增量快验，全量 lint + test + build 由 push master 后的 CI 把关

### Fixed

- 水印深色模式下几乎不可见：改用纯白文字并按 1.6 系数上调等效不透明度（浅色不变）；补充 `background-size` 抵消 DPR 放大，修复高分屏水印被放大且模糊；水印随主题切换重绘

---

## v1.59.0 - 2026-08-14

本版本无新增业务功能，聚焦**前端与 Semi Design 的一致性**，两条主线：一是配色体系全面对齐 Semi token——项目手写的冷蓝调色盘与 Semi 组件的中性灰色盘长期同屏并存，深浅两档共 57 处偏色来源，本次全部改为引用 Semi 对应 token，并把深色明度层次对齐 Semi 官网（内容画布暗一档、仅侧边导航提升）；二是手写实现收敛到 Semi 既有组件——JSON 展示、验证码输入、分割线、行内间距、Tabs 溢出五类共 130 余处替换，均为「项目里已在用但用得不一致」的补齐而非引入新依赖。纯前端改动，无数据库迁移。

### Changed

#### 配色对齐 Semi 官方

- 顶栏 / 侧边栏的分区深色从手写「深色皮肤」（硬编码覆盖 14 个 `--semi-color-*` 变量加 6 处 `!important`）改为 Semi 官方局部暗色实践：根元素挂 `.semi-always-dark`，整套色盘由 Semi 深色 token 提供；导航类弹出层经 `getPopupContainer` 挂进暗色作用域，修复弹出菜单恒为浅色的问题
- 深色与浅色语义变量统一对齐 Semi token：此前深色边框 / 次要文字 / 正文是手写冷蓝调（39 + 10 + 8 处偏色来源），浅色也有同向偏差，观感上「项目深色比 Semi 官网更蓝更暗」；现全部映射到 `nav-bg` / `fill-0` / `text-0` / `text-2` / `border`，不再手写色值
- 深色明度层次对齐 Semi 官网：新增 `--color-content-bg` 语义变量，内容画布、顶栏、面包屑栏、标签栏与终端 / 文件管理页画布深色下统一取 `bg-0`（暗一档），仅侧边导航保持 `nav-bg` 提升一档，形成与官网一致的明度阶梯；浅色模式三 token 同值，无视觉变化

#### 收敛到 Semi 组件

- JSON 展示：14 处 `<pre>{JSON.stringify(v, null, 2)}</pre>` 统一改用 Semi JsonViewer，新增 `JsonBlock` 封装收口三个易错点（height 按行数估算并夹在上下限之间、非法 JSON 降级为 `<pre>`、不加多余 key）；`semi-json-viewer-core` 已在包内，无边际体积成本
- 定长验证码输入：登录 MFA、个人中心 TOTP 绑定、会员端验证码共 9 处从普通 Input 改用 Semi PinCode，自带自动跳格、退格回跳与整串粘贴分配；会员端按标准移动端 OTP 形式重排
- 分割线：9 处 `div` / `span` / `hr` 手绘分割线统一改用 Semi Divider（含竖向、线 + 文字 + 线两种形态），删除随之废弃的 4 段 CSS，保持原视觉不变
- 行内间距：全量扫描 895 处内联 flex + gap，只改「零残留」的一档——`inline-flex` 且除 display / gap / alignItems 外无其他属性的 34 处替换为 Semi Space，style 属性整个消失；其余 861 处因 `justifyContent` 无法表达、块级 flex 语义不等价或残留属性过多而刻意不动
- Tabs 溢出：68 处 `<Tabs>` 开启 `collapsible="auto"`，窄容器（抽屉、弹窗、分栏面板）里标签放不下时自动折叠成带箭头的滚动条，宽度充足时渲染与此前一致；2 处裸 `collapsible`（常驻箭头）一并升级为 `auto`

#### 其他

- 个人中心「我的设备」去掉卡片外框与图标块，压成单行列表，与同页登录记录 / 操作记录 / API Token 三个表格 tab 风格统一；当前设备的整行染底一并去掉，避免被误认为选中态

---

## v1.58.0 - 2026-08-13

本版本聚焦**表格与表单的呈现缺陷**，无新增业务功能。主线是操作列宽度：该宽度一直是手写数值，与按钮内容没有任何关联，加了动作却没同步宽度时不报错也不截断——单元格没有 `overflow: hidden`，内容会先吃掉两侧留白，再挤压相邻的固定列，因而长期未被发现。本次按 Semi 的实测度量静态扫描全部 209 个调用点，修复 19 处宽度不足与 8 处明显偏宽，并把判定方法固化进开发规范。另有两处重复实现的收敛，其中成员摘要查询顺带修复了一个多租户越权缺口。

### Changed

#### 操作列宽度

- 修复 19 处列宽小于按钮内容宽度的操作列。其中 `db-admin` 表维护（四个全大写动作需 375px，列宽 90）、支付收款链接、请假单、CMS 资源库四处加宽到所需尺寸并不合理，改为用 `desktopInlineKeys` 保留 1–2 个高频动作内联、其余收进「更多」菜单；其余仅调整宽度，交互不变
- 「编辑 / 删除」这一最常见组合此前并存 120 / 130 / 140 / 160 四种宽度，将其中留白仅剩 6px 的 10 处统一到 130
- 收窄 8 处明显偏宽的操作列（单个「打开」占 180、单个「详情」占 160 等），为相邻业务列让出横向空间

#### 表单布局

- AI 服务商表单：长标签（如「输入单价（分/百万Token）」「降级配置（首字前失败自动切换）」，最长 13 字而未设 `labelWidth`）拆为短标签加说明文案，最长降至 5 字；消除 `span=12` 内嵌 `6+6` 造成的跨行错位与 `span=8` 三列的不一致；18 个平铺字段按接入信息 / 模型 / 成本与可靠性 / 其他四组归拢
- 智能体与 AI 工具表单改为双列，长文本与多选保持全宽
- AI 服务商与支付渠道配置改为右侧抽屉：前者字段较多，后者按渠道展开微信 / 支付宝 / 银联三套凭证，含多个 PEM 私钥文本域，弹窗内需反复滚动

#### 内部重构

- 部门、角色、岗位、用户组四处各自实现的「成员数量 + 前 5 位头像预览」收敛为统一查询。原实现把范围内**全部**关联用户取回应用层再截断（部门树会读取当前租户全部部门用户），现由窗口函数在库内完成精确计数并只返回每范围前 5 行，返回行数从「成员总数」降为「范围数 × 5」。响应字段不变
- 菜单、部门、地区、字典、站点、AI 服务商六处树形表格的展开态收敛为 `useTreeExpansion`

### Fixed

- 菜单管理的「全部展开」在筛选状态下失效：可展开节点取自未筛选的全量树，而表格渲染的是筛选后的数据，命中项已自动展开时按钮仍显示「全部展开」，点击后可见区域没有任何变化
- 树形表格在筛选无结果时显示「全部折叠」：残留的旧展开 key 与空数据比较得出「已全部展开」
- 岗位与用户组的成员分配未校验用户所属租户（此前仅角色有校验）；且校验须绑定**目标范围所属租户**而非操作者可见范围，否则平台超管在无租户上下文时可跨租户加人

---

## v1.57.0 - 2026-08-13

本版本聚焦**告警中心的可观测性与处理闭环**。此前告警只做到「触发并尝试通知」：`notified` 字段在派发之前就按渠道数量写死，配了渠道却没送达无从发现；事件只有 `firing` / `resolved` 两态，指标自动恢复会把「压根没人管」的告警悄悄掩盖。现在通知派发返回真实结果并落库展示，事件引入与系统状态正交的人工处理状态，并新增告警概览页与规则试发通知。规则与事件列表的筛选条件也从「只过滤当前页」修正为全部下推服务端。含 2 个数据库迁移。前端侧另有三处查询缓存的失效收敛与重复缓存消除。

### Added

#### 告警处理闭环

- 告警事件新增人工处理状态 `pending` / `acknowledged` / `closed`，与系统按指标判定的 `firing` / `resolved` **正交**：指标掉回阈值下方只说明系统恢复了，不代表有人看过、查过原因
- 支持认领、标记已处理与撤销认领，记录处理人、处理时间与处理备注，单条与批量均可操作；撤销认领清空全部处理痕迹，事件重新回到待处理池
- 确认时间只在**首次**响应时写入并保持不变——它是 MTTA 的分子，被后续的「标记已处理」覆盖会让确认耗时统计失真；直接关闭未认领的告警同样计入一次响应

#### 告警概览页

- 新增 `/alerts/overview`：当前告警中数量（按级别）、待处理数与最久未认领时长、时间范围内的触发 / 恢复 / 通知失败数、MTTA、MTTR、按天趋势与触发最频繁的 TOP 5 规则，支持近 24 小时 / 7 天 / 30 天
- 统计卡可点击直达告警事件页的对应筛选，避免「看到数字却不知道去哪查」
- 工作台在具备 `alert:overview:list` 权限时展示同一份数据的紧凑版

#### 规则试发通知

- 新增 `POST /api/monitor-alerts/{id}/test`（权限 `alert:rule:test`）：用规则当前的渠道与接收人发一条测试消息，在真实告警到来之前验证配置
- 直接返回派发结果，前端按「已送达 / 部分失败 / 全部失败 / 未配置渠道」分级提示并列出失败原因——统一报「已发送」会把「渠道配错、根本没送出去」也说成成功
- 不写事件表、不改规则运行态与 `last_triggered_at`：一次配置验证不应出现在告警历史里，更不能顶掉静默期让真实告警被抑制

#### 通知投递结果可见

- 事件记录本次派发的真实结果 `skipped` / `success` / `partial` / `failed`、实际尝试的渠道快照、失败原因与通知时间，事件列表以「通知状态」列展示，失败原因在 tooltip 中给出
- `skipped`（未配置任何渠道）与失败分开建模：混为一谈会让「配了渠道却没人收到」无法从列表上被发现

#### 其他

- 告警规则支持批量删除与批量启停；批量启用逐条校验投递配置，任一条不合格即整批拒绝，不做部分成功
- 告警事件接入导出中心（实体 `alert.monitor-alert-events`，权限 `alert:event:export`），导出条件与当前筛选一致
- 告警规则新增「查看事件」，跳转到 `/alerts/events?ruleId=N` 做规则联查

### Changed

#### 查询缓存失效范围收敛

- CMS、支付协议、异步任务、导出任务、公众号模板、Docker 六个域的 mutation 失效由「域根广播」改为按真实副作用建模：开启站点统计不再连带重拉主题模板与站点下拉两个 5 分钟长缓存，取消异步任务不再连带重拉任务类型元数据
- 已发布流程定义此前分散在三份缓存中，「发布」只能命中其中一份，新发布的流程在设计器的关联流程选择器里最长 5 分钟不出现；现统一到单一来源并保留原有长缓存意图
- 顶栏公告铃铛与工作台公告卡片读同一个接口却各建缓存，从顶栏标记已读时工作台未读圆点不消失；直接消除重复缓存而非再补一条互相同步的失效

### Fixed

#### 告警筛选只过滤当前页

- 告警规则的关键词搜索此前在已分页的当前页数据上做过滤：翻到第 2 页搜不到第 1 页的规则，且分页总数仍是未过滤的值，列表与页码对不上
- 规则列表的关键词、指标、级别、启用状态与告警状态，事件列表的关键词、指标、级别、告警状态、通知状态、处理状态与触发时间范围，全部下推服务端

#### 告警通知的静默失效

- 「邮件接收目标没有可用邮箱」与「站内信未匹配到任何启用用户」此前只记一行警告日志就返回，被计为一次成功派发——而这正是用户配置看起来正确却收不到通知的典型成因，现改为计入该渠道失败

#### 其他

- 修复告警概览接口 500：时间范围条件把裸 JS `Date` 插进 `sql` 模板时不携带列的类型编码器，驱动序列化参数时抛 `ERR_INVALID_ARG_TYPE`，改用 `gte()`
- 修复整站导入实际写入 19 张表却只失效站点列表，栏目 / 内容 / 标签 / 资源 / 广告 / 表单 / 单页等列表停留在导入前数据
- 修复公众号模板列表 key 是日志与行业设置的前缀导致三者互相干扰、CMS 互动文案的 `pageSize` 未进 query key
- 放宽告警事件操作列宽度，并统一行内按钮与弹窗的处理动作措辞

---


本版本包含两条主线：**告警中心独立成一级功能**（规则 / 事件拆分为顶级目录，接收人从手填邮箱升级为选人 + 邮箱双通道），以及**服务端索引体系补齐**（多租户 `tenant_id`、业务外键与热点关联列共 159 个索引，含 5 个数据库迁移）。前端侧把 9 个字段过多的长表单弹窗改为右侧抽屉、互动问卷设计器独立成页；种子菜单由清空重建改为按 id upsert，自建菜单与授权不再被开发启动清空。

### Added

#### 告警中心

- 告警规则与告警事件从系统运维中拆出，独立为顶级目录「告警中心」
- 告警接收人支持从用户列表选人，与手填邮箱并存为两条独立通道

### Changed

#### 长表单弹窗改为右侧抽屉

- 报表预警、指标中心、身份源管理、工作流连接器、文件存储配置、CMS 采集规则 / 分发配置 / 表单管理、公众号账号共 9 处新增编辑表单由居中弹窗改为右侧抽屉：全屏高度承载长表单、操作按钮固定在底部不随内容滚动，字段按 `Form.Section` 分组
- 工作流连接器的凭据字段按鉴权方式条件渲染，同屏字段由 24 降至 15 左右
- 文件存储配置的「测试连接」移入抽屉底部操作区，「设为默认服务」改用 `Form.Slot` 与其余字段对齐，存储类型下拉改用 `FILE_STORAGE_PROVIDER_OPTIONS` 统一枚举来源
- 互动问卷设计器（分步表单 + 题目设计 + 前台预览三栏）由全屏弹窗改为独立页面 `/cms/interactions/edit`，按项目既有约定注册为隐藏菜单而非硬编码路由

#### 种子菜单改为按 id upsert

- 菜单不再 `TRUNCATE` 重建：开发环境每次 `npm run dev` 启动执行 seed 时，手工创建的菜单及其角色 / 用户授权、租户套餐菜单与用户收藏均原样保留
- 仅内容真正变化的行才写 `UPDATE`，避免每次启动刷新全部 881 行的 `updated_at`
- 手工创建菜单的 id 起点抬至 100000，与种子 id 段隔离，避免后续新增种子菜单覆盖自建菜单

### Fixed

#### 数据库索引缺失

- 补齐 89 张多租户表的 `tenant_id` 索引、40 个业务外键 `user_id` / `operator_id` 索引与 30 个热点表关联列索引
- 修复 CORS 允许方法遗漏 `PATCH`

#### 页签图标在动态路由页面缺失

- 页签标题有前缀回退而图标是精确查表，导致 `/workflow/designer/:id` 等带动态参数的页面有标题却无图标；标题与图标统一走同一套解析
- 前缀回退由「首个匹配」改为「最长匹配」，修复 `/workflow/forms/designer/:id` 的页签标题落到父级菜单「表单库」的问题
- 补齐流程设计、表单设计、内容编辑页、页面部件编辑、互动问卷设计页 5 个隐藏菜单的图标

#### 其他

- 修复告警规则接收用户选择后选择框不回显
- 修复告警规则触发条件列与操作列、工作流连接器操作列宽度不足，收窄报表数据集过宽的操作列
- 明确告警规则生命周期语义

---

## v1.55.0 - 2026-08-12

本版本聚焦**服务端运行时依赖与查询效率**：WebSocket 从已废弃的 `@hono/node-ws` 迁移到 `@hono/node-server` v2 内建实现，消除同时装载两份 HTTP 适配器的依赖分叉，并修复被拒绝的协议升级请求可打死进程的问题；租户、会员等级与会员标签三个列表接口的按行 `COUNT` 收敛为单条 `GROUP BY` 聚合，查询数不再随页大小线性增长。前端侧统一表格时间列的宽度与渲染行为，并收敛时区选择组件。无数据库迁移。

### Changed

#### WebSocket 迁移到 @hono/node-server 内建实现

- `@hono/node-ws` 已被 Hono 官方文档标记废弃，WebSocket 支持已内建进 `@hono/node-server` v2。此前二者并存导致依赖分叉：`serve()` 来自 2.1.0，而 WS 层编译在 node-ws 传递依赖的 1.19.14 上，产物中同时存在两份适配器
- `serve()` 改用 `websocket` 选项接管 upgrade，移除 `injectWebSocket`；握手请求走正常 fetch 管线，响应头会被带入握手响应
- 移除 `DomainCtx`：v2 的 `upgradeWebSocket` 是模块级导出，不再需要绑定 app 实例，域挂载不必再透传上下文。WS 路由文件与工厂签名未改动
- 依赖变更：移除 `@hono/node-ws`，`ws` 与 `@types/ws` 转为直接依赖

#### 表格时间列与时区选择

- 统一按字段语义识别的时间列尺寸，时间列去除装饰性 render 全部收敛到工厂；复合时间列拆分，附加信息独立成列
- 统一时区选择组件并补充统一时区选择规范文档

### Fixed

#### 被拒绝的 WebSocket 升级请求可打死进程

- 向非 WS 路径发起 upgrade 后立刻 RST 时，socket 已脱离 `http.Server` 托管，其 `error` 事件无人监听会冒泡成 `uncaughtException` 终止进程，未认证远端即可触发
- 改为在 `connection` 阶段统一挂载错误兜底

#### 列表接口按行 COUNT 导致连接池饥饿

- 租户、会员等级、会员标签三个列表此前用 `Promise.all(rows.map(db.$count(...)))` 逐行统计关联数量，查询数随行数线性增长
- 租户列表的 `pageSize` 由调用方控制且上限 200，单个请求即可并发打出 200 条 COUNT，而连接池默认 `DATABASE_MAX_CONNECTIONS=10`，会令同实例其他请求（含登录、健康检查）排队等待
- 改为一条 `inArray + GROUP BY` 聚合，查询数与页大小解耦；聚合结果中不存在的行兜底为 0，会员等级的软删过滤原样保留
- 补充 14 条单测锁定回归，断言查询数与页大小无关

#### 报表中心

- 修复数据源连续失败列宽不足与数据质量规则弹窗排布问题

---

## v1.54.0 - 2026-08-11

本版本聚焦**技术债清理与报表中心交互打磨**：删除全仓遗留的旧名别名、废弃字段与向后兼容读取路径，`TODO / FIXME / HACK` 与 `@deprecated` 全部归零；工作流触发器执行记录收敛为单一实现与单一状态口径，修复同一作业在不同页面显示不同状态、按 `pending` 筛选恒为空的问题；报表设计器的仪表盘、漏斗、雷达从手搓 SVG 改为 VChart 渲染并跟随部件尺寸；同时按 Semi 实测尺寸修正报表中心表格的时间列与操作列宽度。含一个删除历史残留空表的迁移（`0008`），不新增运行时依赖。

### Changed

#### 仪表盘、漏斗与雷达改用 VChart 渲染

- 三种图表此前是硬编码尺寸的手搓 SVG，且在尺寸守卫之前返回、完全不消费 `chartHeight`，部件从 4x4 拖到 8x8 时图形纹丝不动；现与同文件的热力图、词云、水波图保持一致的实现路径
- 仪表盘改用半环 `circularProgress` 加中心指标，比例夹紧到 `[0,1]`，越界值不再画出超过半环的弧；漏斗改为真梯形并显示层间转化率；雷达支持多系列与极坐标网格
- 漏斗与雷达接入统一的图表点击事件，联动钻取行为与其余图表一致；删除 63 行手搓 SVG 组件。VChart 原生支持这三种图表，无新增依赖

#### 报表中心表格与弹窗排布

- 数据源弹窗按数据源类型分组为两列布局，各行统一等分栅格；数据集弹窗从纵向堆叠 8 个区块的弹窗改为侧边抽屉加标签页（基本信息 / 取数配置 / 预览与字段 / 参数定义 / 高级），静态类型自动隐藏参数定义页
- 报表中心 15 个页面共 34 处时间列宽度统一为公共列宽，仪表盘、打印模板与数据源的创建时间列改用公共列定义

#### 收敛工作流触发器执行记录

- 三处各自派生状态的 mapper 合并为单一实现，状态口径由 `deriveTriggerExecutionStatus` 统一定义：仍有预算时区分已尝试与未开始，预算耗尽、死信与取消统一为终态
- 节点名改从任务行的非空列读取，不再复制进作业负载（负载可被死信中心「改参重放」整体覆盖，而任务行不可变）；触发器执行记录可显示真实节点名与触发类型
- 权限缓存清理改为异步并在全部调用点等待，撤权在调用方返回时确定生效；批量失效由串行改为并行，避免 N 次串行往返

### Removed

#### 旧名别名与转发导出

- 删除仅作转发的模块与重命名别名，调用点改为直接引用源头；保留少数有注释说明的模块内本地简名
- 删除生产代码零调用的单 sheet 打印旧接口，测试改用当前实现，覆盖不变

#### 废弃字段与向后兼容读取路径

- 审批节点的单数指派字段、同人自动通过开关与零读写的超时动作字段整条链路移除（类型、Zod schema、UI 写入、服务端回退读取）
- 实例表单快照收窄为对象形态，服务端与前端不再接受旧的裸数组；MSW 实例数据同步为与服务端同构
- 删除随迁移链基线化后遗留的空表 `app_data_migrations`（迁移 `0008`），以及未声明指派类型时的旧数据回退分支
- 全仓 `TODO / FIXME / HACK` 与 `@deprecated` 归零

### Fixed

#### 报表中心操作列按钮被裁切

- 操作列容器为 `white-space: nowrap`，宽度不足时按钮被直接裁掉。按 Semi 实测尺寸重算后，报表中心 19 个操作列中有 10 个溢出
- 告警规则、订阅推送、打印模板与数据集将「删除」移入更多菜单，兼顾危险操作防误触；资产、仪表盘、填报模板与容量配额按实测所需宽度加宽

#### 触发器执行记录状态不一致

- 修复同一作业在实例诊断页显示「失败」、在触发器执行页显示「重试中」，以及诊断页漏回落父作业错误信息与租户的问题
- 列表筛选改用与展示等价的状态表达式，此前按 `pending` 筛选恒定返回空；任务级派发状态修正「已取消」被计入「待派发」的错误

---

## v1.53.0 - 2026-08-11

本版本聚焦**终端会话安全与文件操作可靠性**：终端会话改由服务端签发身份、持久化生命周期并按用户和租户校验归属，修复客户端可控会话 ID 带来的跨用户操作风险；文件写入、上传、压缩与解压链路补齐并发冲突、内存上限、流式处理、进度和取消能力。同时统一剩余监控与数据页面的无卡片视觉，并重构 Zenith 开发规范与文档导航。含一张新增的 `terminal_sessions` 表及两组 PostgreSQL 枚举，不新增运行时依赖。

### Added

#### 服务端托管终端会话生命周期

- 终端会话 ID 改为服务端签发的 UUIDv7，客户端只能通过 `registerSession` / `acquireOwnedSession` 获取本人会话句柄，不能再自行指定或覆盖活动会话 ID
- 新增 `terminal_sessions` 表，记录用户、租户、终端类型、连接目标、承载节点、网格尺寸、活动时间、结束状态与原因；服务重启后可结算遗留记录，终端操作具备完整追溯链路
- 会话注册表补齐单用户并发上限、断开回收、进程组清理与停机结算；本地、SSH、Docker 三类终端使用统一的所有权与生命周期语义

#### 文件压缩与解压接入任务中心

- 文件管理器的压缩与解压从长连接 HTTP 请求迁移到统一任务中心，支持进度、取消、失败记录与后台执行
- `.gz` 解压改为流式管道，避免同步解压阻塞事件循环；任务类型与系统种子同步登记，重启后继续由既有 worker 运行

### Changed

#### 强化文件写入、上传与目录操作

- 文本保存改为临时文件原子替换，并通过 ETag 条件写入检测并发编辑；文件已被他人修改时返回冲突，不再静默覆盖，进程异常也不会留下截断文件
- 终端文件上传增加 `terminal_upload_max_size_mb` 配置上限并采用流式落盘，避免把完整请求体常驻内存；分片与普通上传统一执行大小校验
- 服务端文件读写与三套前端目录树操作收口为共享原语，剩余文件请求统一经过 Request Adapter，减少本地文件、SFTP 与终端资源管理之间的行为漂移

#### 统一诊断与数据页面视觉

- 服务监控、工作流引擎诊断、行为数据、公众号统计、会员看板和数据保留页移除残留卡片外壳，改用细线分隔、确定列数栅格与统一响应式规则
- 终端网格尺寸字段补齐语义化标签，页面与可访问性工具可明确区分列数和行数

#### 重构 Zenith 开发规范

- 将单体 Skill 拆分为硬约束、前后端 CRUD、查询缓存、UI 模式、异步任务、发布和排障等按需参考，减少重复规则与上下文加载
- 新增后端模式、前端约束与 CRUD 信息收集入口，修正文档站、README 与 `AGENTS.md` 中的导航和失效链接

### Fixed

#### 终端会话越权与资源抢占

- WebSocket 处理器不再按客户端传入的 ID 查找会话，而是绑定连接已获取的服务端会话；拒绝覆盖活动 ID，并按用户、租户和承载节点限制监控、接管与销毁操作
- 修复 ID 碰撞时可能驱动他人 Shell、遗留 PTY 或提前回收会话的问题；Docker 容器文件接口补齐显式权限守卫，不再只校验登录状态

---

## v1.52.0 - 2026-08-10

本版本聚焦**可观测性与数据治理**：把分散在 13 处的日志清理收敛为单一保留策略框架，让约 30 张此前完全无清理的追加型表进入统一回收；把支付与开放平台的关键失效信号接入既有告警引擎，并修掉「站内信渠道配了却从不发送」这一静默失效；同时补齐任务中心的执行质量视图，统一多字段详情弹窗的排布。含一个纯追加的数据库迁移（扩展监控指标枚举）与一张新表（`retention_policies`）。

### Added

#### 全库数据保留策略框架

- 保留策略以代码声明为唯一来源（`lib/retention/policies.ts`，42 条覆盖全部追加型表），运行期天数存库可调，删除由唯一执行引擎完成，每天由一个 `data-retention` 系统任务驱动
- 执行引擎按 ctid 定位 + LIMIT 分批删除并统计 rowCount，内存占用与删除行数无关；支持 age / ageAndCap / expiresAt 三种模式，以及按租户区分天数与删除后的副作用钩子
- 新增「数据保留」管理页：策略列表、行内编辑保留天数、删除前试算与确认、立即清理；管理员调整过的配置不会被重启覆盖，代码中已删除的策略在启动时自动清理
- 为 `operation_logs`、`login_logs`、`ip_access_logs` 等 12 张此前零索引的日志表补时间列索引
- 新增断言：新增追加型表必须登记保留策略或显式豁免，避免新表悄悄逃过清理

#### 支付与开放平台业务告警指标

- 告警引擎此前只接了基础设施与流程引擎指标，支付域完全没有业务告警——失败率飙升、卡单、对账差异只能靠人盯。本次接入 9 个业务指标，复用既有的阈值状态机、持续时长抑制、静默期与恢复通知
- 支付（按租户统计）：支付失败率、支付卡单数、对账差异待处理、支付事件积压、支付回调失败率。失败率分母只取「成功 + 失败」，把用户主动放弃的关单计入会让指标随下单量波动失真，掩盖真正的渠道故障
- 开放平台（平台级统计）：开放 API 错误率、单应用最高错误率（仅统计调用量 ≥ 20 次的应用，避免小样本噪声）、应用 Webhook 失败率、自动停用订阅数
- 预置 14 条开箱告警规则，覆盖基础设施容量兜底与支付、开放平台、流程引擎的关键信号
- 单应用配额耗尽仍由既有的开放平台配额预警负责（80% / 95% 双阈值、直达应用负责人），按应用维度更贴合，未重复实现

#### 任务中心执行质量视图

- 新增「任务统计」页签展示整体健康度：成功率、待执行积压与最久等待时长、发生过重试的任务数
- 执行统计（累计执行 / 成功率 / 平均耗时）并入「任务类型」表格，与重复提交、自动重试、保留天数等配置同屏对照——配得对不对与跑得好不好本是同一主键的两个侧面
- 成功率按 90% / 99% 分档着色；已下线但仍有历史记录的类型补在末尾并标记「已下线」，不丢失统计口径

### Changed

#### 监控告警指标收口为单一来源

- 指标此前在 pgEnum、Zod 校验、服务端标签表、前端标签表 4 处各写一份，漏改任何一处都不报错，只表现为「下拉里没这个指标」或「告警消息显示裸英文 key」；现全部由 shared 的指标元信息派生，并以一致性断言锁定
- 数值格式化下沉为共享函数，服务端与前端不再各写一份（原先服务端按百分比渲染、前端按裸数字渲染的偏差没有任何测试能发现）
- 指标下拉改为按业务域分组且可搜索，阈值输入提示随指标单位变化，选中指标后展示口径说明
- 新增指标的租户口径声明：业务指标按规则所属租户过滤，宿主机与平台级指标共享同一次取数；某租户取数失败时跳过其规则而非按 0 处理，避免把采集故障误判成「指标已恢复」

#### 保留期口径归一

- 保留期时间单位全部归一为「天」，0 统一表示永久保留；登录日志、操作日志、定时任务日志、终端录屏的手动清除改为复用统一的分批删除实现
- 移除 `analyticsRetention`、`cleanupSystemMetrics`、`cleanupRuleExecutions` 等分散的清理任务及其种子记录，以及 `member_login_log_retention_days` 等散装配置键与硬编码常量
- 广告事件人工清理默认天数与开放 API 统计可查询窗口改为读取统一策略，避免调整保留策略后出现「统计查得到但数据已被删」的偏差

#### 统一多字段详情弹窗排布

- `Descriptions row` 是给少量指标做大字号横排看板用的，字段多时折行位置不可控、键值大小失衡，长文本还会挤占相邻字段宽度。支付订单、支付退款、SSL 证书、开放平台应用、进程、Webhook 投递、系统调度运行日志 7 处详情弹窗改为双列横排，长文本字段独占整行
- 会员概要、租户用量、填报记录等仍保留原排布：字段不超过 8 个且全为短值，横排紧凑摘要正是该模式的适用场景

### Fixed

#### 告警站内信渠道从未真正发送

- 监控告警与错误告警的站内信分支此前只有一行日志，从未调用发送。而新建规则表单的默认渠道就是站内信，校验还强制要求填接收人——用户配置完全正确却零送达、零报错
- 三渠道派发统一收口，接收人按邮箱或用户名解析到启用中的用户后真实送达；解析不到任何用户时记录告警而非静默丢弃

#### 启动期任务对账失效

- 清理代码中已移除任务的残留调度与配置行，避免失效处理器每日执行失败并触发告警
- 对账条件改用 `notInArray`：原写法会编译成 PostgreSQL 不接受的元组语法，且该异常被后台工作线程注册的兜底捕获吞掉，导致系统调度任务列表与任务中心类型列表双双为空
- 补空集合短路：对空数组求值为真，直接用作删除条件会清空整表

#### 数据保留页交互

- 移除「待清理」列：它展示的是一次性试算结果，不落库且刷新后回到空值，长期占着列宽却不携带信息
- 试算改为「立即清理」的前置步骤，先算出待删行数与裁剪时间点再确认，无超期数据时直接提示；表格补回刷新按钮，保留天数为 0 的策略不显示清理入口

---

## v1.51.0 - 2026-08-09

本版本聚焦**全仓重复代码治理与交互组件统一**：将前后端、Analytics SDK 中反复出现的查询、日期、校验、配置解析和数据映射逻辑收口为可测试的公共模块；同时统一进度、度量、数据条与滑块输入语义，并为主从布局补齐左右切换和持久化能力。改动保持现有业务协议与数据语义不变，不包含数据库迁移或新增运行时依赖。

### Added

#### 主从布局支持左右切换

- `MasterDetailLayout` 新增受控与非受控的左右位置切换；DOM 始终保持 master → divider → detail 的稳定顺序，仅通过布局方向改变视觉位置，切换时不会重新挂载面板或丢失页面状态
- 布局宽度与左右位置分别按 `persistKey` 持久化，重新进入页面后恢复上次选择；窄屏自动隐藏不适用的切换入口，并根据当前位置动态生成按钮文案
- `MasterDetailLayout.Header` 与 `NavListPanel` 自动注入公共切换按钮，缓存管理、日志文件、字典、智能对话、数据库表等页面无需重复实现；无标题列表场景下按钮统一靠右

#### 滑块与精确数值输入联动

- 新增 `SliderInput` / `FormSliderInput`，把 Semi Slider 与 InputNumber 封装为双向同步的公共输入组件，同时支持拖动预览和键盘精确录入
- CMS 水印不透明度与 A/B 实验参与流量改用该组件；参与流量独占一行，避免在双列表单中压缩滑块与数值输入

### Changed

#### 统一进度、度量与数据条语义

- 文件上传与 KPI 目标完成度改用 Semi `Progress`，移除手写进度条和对应局部样式
- 新增 `MetricMeter` 表达 CPU、内存、配额、健康度等有界度量，并提供标准 `role="meter"` 可访问性语义
- 新增 `DataBar` 表达排名、占比和分布等相对数据编码；监控、Docker、租户、报表、Analytics、CMS、规则、聊天等页面统一复用，不再各自维护相似的条形样式

#### 收口查询与日期范围处理

- 会员积分、钱包、签到与优惠券服务共用分页、排序和总数查询辅助函数，消除同一查询骨架在多个 Service 中的复制
- Web 端统一 URL 查询状态、表格查询列与搜索参数处理，CMS、支付、报表、规则和 Analytics 页面复用相同约定
- 新增日期时间范围序列化函数，集中处理 Date → API 字符串转换；纯日期与日期时间继续保持不同语义，避免时区转换或手写 `[0]` / `[1]` 带来的遗漏

#### 全仓公共逻辑模块化

- Server 抽取告警校验、IP 区域映射、文本规范化、支付渠道配置解析、报表复制命名、字段元数据和工作流用户映射等公共模块，并为关键边界补充单元测试
- Analytics SDK 统一 HTTP 发送与运行时配置读取，Tracker 与 Error Reporter 不再维护两套相同基础逻辑
- 报表、工作流、支付、身份、数据库运维、SSL 证书和 AI 对话等服务复用统一辅助函数，减少分支漂移风险并保持既有接口行为
- Zenith 开发规范同步补充日期范围、数据可视化、滑块输入与主从布局约束，后续模块默认复用公共能力

---

## v1.50.0 - 2026-08-09

本版本聚焦**文件预览**：把已装但只用了四分之一的 File Viewer Drawing renderer 打通，补齐 draw.io / Excalidraw / PlantUML；修掉 HEIC 与 TIFF「点了预览却是裂图」的既有缺陷；再接入 Data 与 Geo renderer，让字体、PSD、SQLite、Parquet 与地理数据从「只能下载」变为可在线查看。可预览格式由 16 类增至 22 类，且全部在浏览器本地解析，不新增任何外部预览或转换服务。

### Added

#### 图形文件预览：draw.io / Excalidraw / PlantUML

- `@file-viewer/renderer-drawing` 早已在依赖树中，但只接了 Mermaid，其余三类图形一直闲置。本次打通 `.drawio/.dio`、`.excalidraw`、`.plantuml/.puml`，**未引入任何新依赖**
- 四类格式共用同一个 renderer，追加扩展名不产生新的 renderer 包或离线资源
- draw.io 使用 renderer 内置的离线 SVG 渲染：`@file-viewer/vite-plugin` 的 `copyAssets` 并不分发 `vendor/drawio/viewer-static.min.js`（仅 `*-full` 包自带），保留默认值只会先 404、再等超时才回退，故显式配置 `drawing.preferOfficial: false`
- Excalidraw 使用 renderer 自带的 `roughjs` 生成只读 SVG；PlantUML 默认离线展示源码，可通过 `drawing.plantumlServerUrl` 指向内网自托管服务出图

#### 数据资产预览：字体 / PSD / SQLite / Parquet

- 接入 `@file-viewer/renderer-data`，补上一批此前完全不可预览的格式：字体 `.ttf/.otf/.woff/.woff2`（FontFace 样张）、`.psd`（`ag-psd` 解析画布与图层，支持图层显隐重绘）、`.sqlite`（`sql.js` 展示表结构与样例数据）、`.parquet`（`hyparquet`）、`.wasm`（导入导出表）
- `sql.js` 的 WASM 由插件复制到 `file-viewer/wasm/data/sql-wasm.wasm`，运行时不访问外部服务

#### 地理数据预览：GeoJSON / KML / GPX / SHP

- 接入 `@file-viewer/renderer-geo`，与报表地图组件形成闭环——此前用户要在 `mapGeojsonUrl` 里配置 geojson，却无法先在文件管理中确认文件内容
- 显式配置 `geo.basemap: 'offline'` 使用离线空底图。renderer 内置的 OpenFreeMap / OSM / 天地图 瓦片源均需显式配置才启用，默认本就不外联，显式声明是为防止将来默认值变化后悄悄请求外部服务
- 首屏增量为 0：`maplibre-gl` 等四个重依赖都是命中格式时才动态 `import()`。打开一个 WGS84 的 `.geojson` 实际下载约 275KB（gzip）

#### 成员列可点击查看完整名单

- 部门 / 角色 / 岗位 / 用户组四个列表页的「成员」列此前只能看到最多 4 个头像和一个总数，想知道具体是谁必须去用户管理页反查筛选；现在可点击弹出带搜索的分页名单
- 采用 4 条各挂自身 `:list` 权限的独立端点而非 1 条通用端点：`guard({ permission: [...] })` 是 OR 语义，通用端点挂四权限并集会让只有 `role:list` 的人读到部门成员，形成横向越权

### Fixed

#### HEIC / HEIF 与 TIFF 预览为裂图

- Chrome / Edge / Firefox 均无法原生解码 HEIC/HEIF 与 TIFF。`tiff` 早已映射为 `image/tiff`、浏览器给 `.heic` 设的也是 `image/heic`，两者都会通过 `image/*` 前缀判断进入 Semi `ImagePreview` 图集，直接渲染成裂图
- 新增 `utils/image-decode.ts`，在创建 Object URL **之前**转成 PNG（HEIC 走 `heic2any` 的 Web Worker，TIFF 走 `utif2` + canvas），使其与普通图片共用同一套图集交互，**不为个别格式引入第二套预览机制**
- 统一收口四处图集加载点：托管文件、服务器文件管理器、消息图片与文件附件；解码器均懒加载、独立异步 chunk，解码失败回退原始 Blob，单张异常不会中断整个图集

#### PSD 被当作普通图片

- PSD 的规范 MIME 是 `image/vnd.adobe.photoshop`，**以 `image/` 开头**，会被 `startsWith('image/')` 判断吞进图集。新增 `isGalleryImageFile` 明确「交给 `ImagePreview` 的图片」语义（`image/*` 且非 data-asset），并替换相关判断

#### 独立 Spin 的 tip 文案逐字换行

- Semi 的 `.semi-spin` 根节点宽高被写死为 spinner 尺寸（large 32px），而 `.semi-spin-wrapper` 是 `position:absolute` + `width:100%`，tip 渲染在其中被挤成逐字换行——「加载预览组件...」在 32px 内被拆成 4 行，`ChatBiPage` 的长句更是拆成 12 行
- 带 `children` 的 Spin 由 Semi 自身的 `.semi-spin-block` 设为 `width:auto`，不受影响；故在 `global.css` 中限定 `:not(.semi-spin-block)` 放开 wrapper 宽度，共修复 4 处

#### 表格在宽容器下铺满整行

- 表格的 `scroll.x` 是固定宽度而非最小宽度，容器比它更宽时表格不跟着拉伸（告警历史在 1900px 容器上空掉约 800px）。在 `ConfigurableTable` 作用域内统一兜底 `min-width: 100%`，容器更窄时横向滚动照旧保留

#### 收敛数据分析弹窗高度与维度分布表格宽度

- A/B 实验与告警规则新增弹窗由单列改双列（约 780px → 594px / 426px）；告警规则按所选渠道显示 Webhook / 收件人字段，`new_error` 条件下隐藏不生效的阈值
- 维度分布从窄侧栏移出，改为图表全宽在上、分页表格全宽在下，与同类 Tab 一致
- A/B 实验起止时间由手输文本框改为 `DatePicker`，并补充 `toApiDateTime` 单测——漏做 `Date` → 字符串转换不会报错，却会让后端按本地时区解析产生数小时偏移

### Changed

- 文件预览可用格式由 16 类增至 22 类，`canPreviewFile` 同步覆盖 drawing / data-asset / geo 三类
- 新增前端依赖：`@file-viewer/renderer-data`、`@file-viewer/renderer-geo`、`heic2any`、`utif2`；全部为按需加载的独立异步 chunk，`dist/index.html` 无相关 modulepreload，首屏体积不受影响
- **不提供 Avro 预览**：`avsc` 的浏览器入口是为 browserify 编写的，模块加载期即执行 `util.inherits(BlobReader, stream.Readable)`，而 Vite 会将 `stream` / `util` 外部化为空模块，`import` 阶段直接抛错；要支持须为整个 web 包引入 Node 内置 polyfill，代价与收益不匹配

---

## v1.49.0 - 2026-08-09

本版本聚焦**数据分析模块**：先修掉三处「看起来能用、实际不可用」的能力（留存硬编码 8 列、属性过滤全表逐行求值、A/B 实验只给转化率不给置信度），再把分析补成「能拆分、能对比、能定位到人」——漏斗与留存新增统一对比轴与图表下钻，事件工作台扩展到 10 种指标，并新增获客与归因报表。行为分析页由 13 个 Tab 增至 14 个。

### Added

#### 留存分析：日 / 周 / 月粒度

- 解除 `Math.min(days, 8)` 硬编码：此前选 60 天窗口也只能看到 Day0~Day7，**周留存与月留存完全不可用**
- 新增 `periodType`（day/week/month）与 `maxPeriods`；SQL 改用 `date_trunc` 分桶，前端队列轴与 PostgreSQL 对齐（周从周一、月从 1 日起算），跨月/跨年边界逐日比对一致
- 各粒度的回溯窗口与列数上限收敛在 `ANALYTICS_RETENTION_PERIOD_LIMITS`：周留存最多 26 列、月留存 24 列
- 留存接口改为 `POST /api/analytics/retention`——对比轴是判别联合对象，query string 无法自然承载

#### A/B 实验统计推断

- 新增 `analytics-experiment-stats.ts`（纯函数）：双比例 Z 检验、95% 置信区间、SRM 卡方检验、样本量估算
- 报告展示 p 值、绝对/相对提升与置信区间；p 值用合并比例（pooled）标准误，置信区间用 unpooled，两者不混用，避免出现「显著但区间跨 0」的自相矛盾结论
- **显著性为三态**：任一组成功/失败数不足 5 时正态近似不成立，标记「样本过少 · p 值不可信」而非「不显著」——后者会误导使用者提前停止实验
- **SRM 分流健康度**：实际曝光分布与配置权重做卡方拟合优度检验，p < 0.001 时报告顶部红色告警。SRM 命中意味着分流链路本身有问题，此时转化率对比整体不可信
- 样本量参考：按对照组当前转化率估算「检测 10% 相对提升、80% 功效」所需曝光量，未达量级时提示「不显著」只代表证据不足

#### 统一对比轴（维度拆分 / 群组对比）

- 漏斗与留存共用一条对比轴，来源二选一：`{ type: 'dimension' }` 或 `{ type: 'segments' }`。采用判别联合而非可选字段组合，把「二选一」焊死在类型层
- **不做「维度 × 分群」组合**：两者叠加会产生笛卡尔积序列（6 浏览器 × 3 分群 = 18 条线），图表无法阅读，且每条序列的样本量被摊薄到失去统计意义
- 13 个维度，含由 `utm_medium` / `utm_source` / `referrer` 派生的 `channel`；保留 Top 6，长尾合并「其他」——不合并则各序列之和小于总量，看图的人会以为数据丢了
- 漏斗/留存响应统一为 `series[]`（无对比时长度为 1），前端只保留一条渲染路径
- **对比轴只作用于漏斗首步**：漏斗语义是「从同一批人出发」，若每步都按维度过滤，用户中途换设备/换渠道就会被算作流失，转化率被系统性低估
- 留存新增按队列规模**加权**的各周期平均留存率；算术平均会让 3 人小队列与 3 万人大队列等权，多序列对比时结论被噪音主导

#### 图表下钻用户列表

- 新增 `POST /api/analytics/drill-users`：漏斗第 N 步已转化/已流失、留存第 D 周期已回访/未回访 → 具体用户名单
- 复用产生该图表的**同一套 SQL 构造**（漏斗 CTE、留存分桶、对比轴条件）。两处各写一份会出现「图上 3000 人、下钻出 2874 人」，这种对不上的数字会直接摧毁对数据的信任
- 首步不存在「流失」（没有上一步），schema 层直接拒绝该组合——放行只会静默返回空列表，让人误以为「没有人流失」
- 画像用 `LEFT JOIN LATERAL ... LIMIT 1`：平台视角无租户过滤时，同一 `distinctId` 可能在多租户各有一条画像，普通 JOIN 会把一个用户放大成多行，分页与命中人数立刻对不上

#### 事件分析工作台：属性过滤与多指标

- 补齐属性过滤条件构建器（最多 10 条）与分群限定，对接后端早已支持但前端闲置的 `propertyFilters` / `segmentId`；key 或值未填完整的条件行不提交，避免服务端因空 key 返回 400
- 指标由 2 种扩展到 10 种：新增 `eventsPerUser` 与 `sum` / `avg` / `min` / `max` / `p50` / `p90` / `p95`
- jsonb 同名属性类型不受控（同一个 `amount` 可能既有 `12.5` 也有 `"N/A"`），直接 `::numeric` 会让**一行脏数据打崩整条查询**；改为先用正则筛出合法数值再转换，并附加键存在条件排除无该属性的事件，避免 `avg` 被无关事件稀释

#### 获客与归因报表

- 新增 `GET /api/analytics/acquisition` 与「获客归因」Tab，支持 `first_touch` / `last_touch` 双归因模型
- 一次转化算给首次触点还是末次触点，结论常常相反，因此报表显式声明模型：首次触点衡量拉新贡献，末次触点衡量促单贡献
- 每个用户只归属一条触点，故各行用户数之和等于总用户数，可直接比较渠道贡献（区别于按事件计数的维度分布，后者同一用户多次访问会重复计入）
- 新用户按**全历史首见时间**判定，而非「窗口内首次出现」——后者会把老用户的回访误计为新用户

#### 行为分析页其他增强

- 点击分布补齐 SDK 已采集但从未展示的数据：元素身份、访客维度与挫败点击（Rage Click）。散点图颜色改编码人均重复点击（原先与点大小同为次数，通道冗余），新增设备与来源筛选（落点是视口百分比，桌面与移动端混算会让热区失真）
- 路径分析改为桑基图，破环改用 Eades-Lin-Smyth 贪心反馈弧集；桑基只渲染非回边以保证喂给布局的是 DAG，明细表展示全部链路并标注回流，指标卡给出被排除的链路数与流量，不静默丢数据
- 错误 Issue 表格拆分 Release 独立列，操作列支持单条删除

### Changed

- 5 个统计表格（页面停留 / 功能使用 / 用户分析 / 维度分布 / 事件分析）由「服务端 limit 截断」改为后端分页：此前超出 limit 的数据既翻不到也没有任何提示。`total` 取分组后的行数而非事件数，否则页码会多出十几倍、后面全是空页
- 维度分布的占比分母固定为全量样本量，翻页不会让占比重新归一
- 数据保留策略补齐 `analytics_event_quality_daily`——该表随事件采集持续写入，此前不在清理范围内，会无限增长
- 新增定时任务 `analyticsSegmentRefresh`（每日 3:30）重算启用中的分群；分群快照不刷新会让触达按过期名单发送且不报错。单个分群失败不阻塞整批
- 错误 Issue 的忽略/删除收入更多菜单，加宽错误事件浏览器列

### Fixed

- **属性过滤全表逐行求值**：`user_events.properties` 与 `analytics_user_profiles.properties` 补 GIN(`jsonb_path_ops`) 索引；过滤条件附加 `properties ? key` 合取项——该条件被除 `neq` 外所有运算符逻辑蕴含（结果集不变），但可命中索引，`EXPLAIN` 确认走 Bitmap Index Scan。`neq` 语义上包含「该 key 不存在」的行，故不附加
- **原生 SQL 中的裸 `Date` 无法编码**：无列类型可推断，驱动直接报错；显式转 ISO 字符串并标注 `::timestamptz`
- **percentile 指标运行时报错**：PostgreSQL 没有 `ROUND(double precision, int)`（只有 `ROUND(numeric, int)`），`p50/p90/p95` 全部失败；补 `::numeric` 转换
- **会话失败页缺主题与逃生出口**：`checking` / `unavailable` 分支在 Router 之前 return，深色用户会先吃一屏纯白，Electron 下还缺自定义标题栏导致窗口无法拖动关闭；同时修掉点「重试」整页闪回加载点再弹回错误页的问题，并补「重新登录」出口
- **A/B 实验与触达表格固定列错位**：状态列设了 `fixed:'right'` 却排在列数组中间，Semi 会把它抽到右侧固定层渲染，原位留下空洞，表现为首列被挤成一条缝、后续列之间断裂。规则中心与工作流表格同类问题一并归位

---

## v1.48.0 - 2026-08-09

本版本把首页确立的「分栏细线」视觉语言推广到全站统计页面：去掉统计卡与图表面板的卡片外壳，改用细线分栏 + 留白分层，减少嵌套盒子带来的视觉噪音。共覆盖 21 个页面，桌面端分栏比例与原设计保持一致，390 / 1500 两档宽度均实测验证。

### Changed

#### 统计卡片改用分栏细线

- 首页指标区与图表区去掉方格描边，改为竖线分栏；`.dashboard-top-grid` 由 `align-items: start` 改为 `stretch`，避免左右两栏各自收缩导致分隔线只有半截
- `StatGrid` 改为「外层裁切 + 内层负外边距」结构：`auto-fit` 的列数在布局时才确定，`:nth-child` 无法识别行首，改由几何裁切让每行首项的竖线落在容器之外
- 统计卡去掉 44px 图标方块，改用 14px 内联图标；可点击卡片的选中态由整块底色改为底部 2px 指示条，焦点环内缩避免被裁切
- 缓存管理概览由 `flex-wrap` 改用 `StatGrid`，修复 390px 下 7 项挤成 5 行、各行项数参差的问题

#### 图表面板去除卡片外壳

- 新增 `.zx-flat-panels`，加在页面根容器即可让区域内的 Semi `Card` 统一扁平化，共覆盖 39 个卡片
- 并排面板由「各自绘制顶线」改为「整行一条通栏横线 + 面板之间竖线」，与首页图表区一致
- `.chart-grid` 列数由 `auto-fit` 改为确定的 2 / 1，并新增 `.chart-grid--3` 三栏变体承载频道数据页的 1.4 / 1 / 1 比例
- 面板行换行到第二行起补一条横线，避免多行面板之间没有任何分隔（接口限流页 13 个图表排 7 行）

#### 页面覆盖

- 统计卡与面板改造：首页、数据分析、前端错误、CMS 概览与统计、会员概览、公众号统计、开放接口统计、AI 用量、支付流水与报表、定时任务、工作流分析、频道数据、接口限流
- 补齐 5 个使用 Semi `Row/Col` 布局的统计区：文件列表、登录日志、操作日志、支付统计面板、积分与钱包

### Fixed

- **统计卡分隔线不是直线**：`global.css` 中一段历史遗留的 `.stat-card` 与公共组件同名，带来圆角与多余横线；删除死代码，并给公共组件类名统一加 `zx-` 前缀防止再次撞名
- **主图 + 侧栏变体窄屏不收敛**：`.chart-grid--aside` 的列定义与单列规则同特异性且顺序在后，390px 下仍是两列，主图被侧栏最小宽挤到 48px；列定义限定在宽屏生效
- **频道数据页统计未扁平化**：页面局部样式的 `border-radius !important` 压过公共规则，卡片外壳仍在
- **接口限流页状态标签被截断**：标题行被操作按钮占去大半，`Tag` 默认参与 flex 压缩使「启用中」显示为「启...」；状态标签移至卡片底部统计行，并让面板标题内的标签不参与压缩
- **接口限流页卡内分隔线造成分组歧义**：卡内横线与卡片之间的分隔线同色同粗，在无卡片布局下被读成跨卡分组；卡内改用留白分层


本版本聚焦移动端使用体验：抽取统计卡片与自适应栅格公共组件，把全站 27 个统计页面和 34 处写死列数的栅格统一改造为随容器收敛的布局；同时修复主从布局、工具栏、触控热区等多处窄屏缺陷。所有改动均在 390 / 768 / 992 / 1440 四档宽度实测验证，桌面端列数与原设计保持一致。

### Added

#### 统计卡片与自适应栅格公共组件

- 新增 `StatCard` / `StatGrid`（`components/charts/StatCard.tsx`）：统一数值、标题、图标、副文案、环比与可点击筛选态；`deltaFormat` 区分差值与比率两种环比语义，可点击卡片渲染为 `button` 并带 `aria-pressed`
- 新增 `.chart-grid` 图表分栏栅格，`.chart-grid--aside` 承载「主图 + 侧栏」非对称布局，分栏权重可用 CSS 变量覆盖以保留各页原有比例
- 新增 `.auto-grid` 通用栅格工具类：轨道下限取「内容最小宽」与「N 等分宽」的较大者，窄屏自动降列的同时保留设计列数上限
- 移动端导航抽屉补上菜单搜索入口

### Changed

- 27 个统计页面移除各自的 `StatCard` / `MetricCard` / `KpiCard` / `Kpi` / `SummaryItem` 实现，统一接入公共组件
- 34 处内联写死列数的栅格（表单多列、卡片网格、选择器画廊）改用 `.auto-grid`；8 处 `repeat(auto-*, minmax(Npx, 1fr))` 补 `min(Npx, 100%)` 兜底
- 主从布局单栏断点由 560 提高到 720，避免桌面端窄窗口意外掉入单栏
- 移动端工具栏由两行收敛为单行，按钮图标化并修复窄容器下的输入框挤压
- 频道数据看板改用容器自适应栅格，移除两处按视口判断（未计侧边栏占宽）的手写断点

### Fixed

- **多客服会话窄屏不可用**：手写双栏固定 340px 使 390px 下详情面板仅剩 16px，改用 `MasterDetailLayout` 后转为单栏满宽
- **主从布局窄屏死路**：流程定义等页进入分类树后无返回入口，新增 `onMasterBack`；并移除字典、缓存、AI 对话三处在单栏下自动选中首项的行为，使根视图回到列表
- **会员前台营销页栅格破碎**：等级卡 390px 下仅 75px、优惠卡 107px、关于页 45px，改造后均正常降列
- **工作流健康巡检卡片挤压**：`Space wrap` 使卡片收缩至 120px，标签换行
- **定时任务概览图表压扁**：固定 14/10 分栏在 390px 下压成 224px / 160px，改为窄屏单列且桌面比例不变
- **首页统计网格空格子**：网格未填满时露出容器边框色，改由卡片自身绘制分隔线
- **后台外壳视口高度**：`100vh` 改用 `dvh`，修复移动浏览器地址栏收起时的高度偏差与导航抽屉嵌套滚动
- **移动端列表控件热区**：扩大点击目标，实测命中而非仅调整尺寸
- 修复移动端工具栏主操作按钮被裁切、会员首页资产入口溢出

### Docs

- 补充统计卡片、自适应栅格与主从布局窄屏规范；明确固定像素列、等分缩略图等不适用场景
- 记录抽屉与弹窗窄屏宽度已由全局样式兜底，页面无需重复编写 `isMobile` 判断

---

## v1.46.0 - 2026-08-07

本版本聚焦后台视觉体验与个性化：新增全局加载动画偏好，首页改为无卡片布局，并完善文件网格右键操作。同时增强发布验证在高并发负载下的稳定性，重构 AI 协作文档为面向整体架构的项目导航。

### Added

#### 全局加载动画偏好

- 个性化设置新增「加载动画」，提供跳动圆点、旋转圆环、翻转方块和律动条四种效果
- 首次进入系统、菜单首载与页面懒加载统一读取该偏好；设置写入本地持久化并在偏好上下文未就绪时安全回退
- 翻转方块取代旧版脉冲方块实现，移除遗留兼容分支，避免同一效果维护两套语义

### Changed

#### 首页无卡片布局

- 欢迎区、核心指标、趋势图表、通知公告、日历和项目资料移除 Card 容器，改用留白、排版与细分隔线建立层级
- 统计概览、图表懒加载占位和首页骨架屏同步采用无卡片结构，避免加载前后视觉跳变
- 桌面端保持三列图表与双栏信息区，窄屏自动收敛为单列内容流；390px 视口下统计项保持两列且无横向溢出

### Fixed

- **文件网格右键菜单**：右键监听从预览按钮扩展到整张文件卡片，复选框和其他卡片区域也能打开上下文菜单
- **Server 测试超时**：限制 Vitest worker 上限并放宽应用路由快照用例超时，避免重复转译整套路由图导致资源反超
- **Excel 导出测试并发超时**：为 ExcelJS 冷加载用例保留发布并行验证所需余量；独占运行仍维持秒级完成

### Docs

- `AGENTS.md` 重构为项目架构导航，聚焦系统边界、工作区依赖、业务域、前后端运行时和跨领域能力
- 发布流程补充并发验证的故障判读与测试超时排查，明确区分真实失败和被连带终止的任务

---

## v1.45.0 - 2026-08-07

本版本以性能优化为主：消除工作流指派人解析的 N+1 查询、工作流设计器的 lookup 请求改为按消费方就绪懒加载、限流命中统计移出请求路径、AdminLayout 页签栏重渲染成本大幅下降。另修正了测试依赖 jsdom 因重复声明导致上一版升级从未生效的问题。

### Performance

#### 工作流指派人解析消除 N+1 查询

- `walkDeptUp` / `collectDeptWithChildren` / `getDeptAncestors` 此前逐层发起数据库往返，`getDeptLeader` 更是每轮迭代查一次；改为按访问形态分别选型，而非一刀切预加载
- 单跳查询（1 级 manager、部门兜底、`startUserDeptResponsible`、`resolveUserManagerId` / `resolveUserDeptHeadId`）保留走索引的单行查询
- 1 级 `formDepartment` 由「每部门一次查询」改为一次 `IN` 批量取 leader
- 真正无界的遍历（`multiLevelManager` / `multiLevelDeptHead`、角色范围展开、`deptMember` 子级展开）走 `createDeptTree()`：首次使用时才查询，并同时记忆节点表与 parent→children 索引
- `ResolveAssigneeContext` 接受共享的 `deptTree`，`expandTasksToRows` 每次物化最多加载一次，而非每个节点一次；`buildStarterContext` 在发起人无部门时完全不碰部门表

#### 工作流设计器 lookup 懒加载

- 设计器挂载时曾一次性发起 6 个全量 lookup 请求（全部用户、角色、扁平部门、用户组、岗位、已发布定义），而这些数据仅被基础信息步骤、节点配置抽屉、条件/路由编辑器与模拟抽屉消费
- 改为按**消费方的实际前置条件**触发，而非抽屉开合：节点配置抽屉与条件/路由、模拟抽屉均只能从第 3 步进入，故在进入流程设计画布时预热；第 1 步仅在发起人范围不为「全部」时才渲染范围选择器，此时才加载人员/部门/角色数据
- 默认落地状态（第 1 步、范围「全部」）不发出任何 lookup 请求，同时打开节点不再出现下拉框空白后再弹出的回退

#### 限流命中统计移出请求路径

- 命中统计此前让每个经过具名限流器的请求都 `await` 一次 Redis MULTI/EXEC 往返（INCR + HINCRBY + EXPIRE ×2）；改为即发即忘，登录、验证码、AI 对话、ChatBI 等受保护接口不再为看板统计付出延迟
- 限流判定本身仍同步完成，统计失败只记录、绝不阻断请求

#### AdminLayout 页签栏重渲染优化

- 页签栏原内联在 `AdminLayout` 中，并为每个页签急切构建完整右键菜单（14 个 `Dropdown.Item` + 图标）。默认 `maxCount=20` 时每次渲染凭空创建 600+ 个几乎从不展示的 React 元素，并对每个页签重复 slice/some 扫描（O(n²)）与 `flatMenus.find`
- 而 `AdminLayout` 重渲染极频繁：WebSocket 未读数、锁屏、偏好面板、移动端浮层等任意 state 变化都会触发；业务页面因 `useOutlet` 内部的 `useMemo` 得以 bailout，页签栏却无此保护
- 抽出 memo 化的 `TabBarItem`，无关 state 变化时整体跳过 reconciliation；右键菜单改为首次 `contextMenu` 时才构建，与 Semi 的显示逻辑同批次执行，弹层挂载时菜单已就位不会闪空
- 新增 `useEventCallback` 保证页签操作集合引用恒定，避免父组件重建内联函数导致 memo 全部落空；关闭左侧/右侧/其他/全部的可用性改为一次 O(n) 前缀扫描（`computeTabClosableFlags`），收藏态按 path 建索引
- `useNavItems` 拆为深层转换 + 浅层徽标，聊天未读数变化不再重建整棵导航树
- 行为保持不变，补充 16 个测试覆盖 memo 生效、菜单懒构建不闪空、菜单项禁用/切换语义，以及前缀扫描与原 O(n²) 实现的等价性

### Fixed

- **限流统计失败日志刷屏**：统计移出请求路径时把原先刻意的静默吞异常换成了无条件 `logger.warn`，Redis 故障期间每个经过受保护接口的请求都会输出一条告警，恰在最需要日志诊断时将其淹没。改为每分钟最多一条并携带被抑制的发生次数，blocked 侧统计写入同样处理以保持两侧行为一致

### Changed

#### 依赖

- mermaid 11.16.0 → 11.16.1
- jsdom 29 → 30（仅测试环境）。上一版记录的同名升级实际从未生效：根与 `packages/web` 各声明一份且版本不一致（`^29.1.1` / `^30.0.1`），npm 无法去重而把 web 那份嵌套到 `packages/web/node_modules`；被提升到根 `node_modules` 的 vitest 是从自身目录发起 `import('jsdom')` 的，向上查找进不到该目录，因此实际加载的一直是根上的 29.1.1。现收敛为根单一声明 `^30.0.1`，磁盘副本由 2 份变为 1 份，从结构上杜绝两处声明的版本漂移
- 伴随 jsdom 30 的行为变化：`getComputedStyle` 开始对 `calc()` 求值（默认视口下 `calc(100vh - 16px)` 解析为 `752px`），`CursorContextDropdown` 与 `FormDesigner` 共 3 处 `toHaveStyle` 断言改为核对内联声明，避免耦合 jsdom 默认视口高度

---


文件预览能力扩展到邮件、XMind 脑图与 Mermaid 图表，并继续沿用 File Viewer 的浏览器本地解析链路；同时补齐格式识别、预览入口、离线资源装配与回归测试。

### Added

#### 邮件、XMind 与 Mermaid 本地预览

- `FilePreviewModal` 新增 `.eml`、`.msg`、`.mbox`、`.xmind`、`.mermaid` 与 `.mmd` 文件预览，并将宽屏格式统一接入 `FileViewerPreviewPanel`
- File Viewer 新增 Email、Mind Map 与 Drawing renderer：邮件支持正文、头信息和附件只读展示，XMind 支持多 sheet 与节点画布，Mermaid 支持安全渲染、平移、缩放和打印
- 新增对应扩展名与 MIME 类型推断、可预览性判断及回归测试，文件管理器和全站统一预览入口可直接识别新增格式

### Changed

- Vite 的 File Viewer 资源装配新增 `email`、`xmind` 与 `mermaid`，相关解析器和运行时资源随 Web 产物本地部署，不依赖外部预览服务
- 更新文件预览组件文档与格式矩阵，明确邮件、XMind、Mermaid 的渲染方式、安全边界和 MBOX 当前行为

---

## v1.43.0 - 2026-08-07

文件预览进一步统一到 File Viewer：开放完整 Office 扩展名识别，新增 30 种压缩包与 OFD 本地预览，并统一文件列表和服务器文件管理器的 MIME 推断；同时优化 CMS 与前端加载路径，抽取共享枚举和 Mock 数组工具以减少重复实现。

### Added

#### 扩展本地文件预览格式

- Office 预览由 7 种基础格式扩展到 28 种扩展名，覆盖宏文档、模板、放映文件、OpenDocument、RTF、TSV 与 Apple Numbers 等 File Viewer 已支持格式
- 新增 ZIP、7Z、RAR、TAR、GZIP、BZIP2、XZ、Zstandard、ISO、CAB、JAR、APK、CBZ、CBR 等 30 种压缩包或归档格式的浏览器本地目录预览
- 新增 OFD 文档浏览器本地预览，支持页面渲染与印章外观展示；该预览不执行电子签章密码学验签

### Changed

#### 统一文件类型识别与预览入口

- 文件列表、文件管理器、附件与聊天文件统一通过 `FileViewerPreviewPanel` 预览 Office、压缩包和 OFD 文件
- 抽取共用扩展名到 MIME 映射，服务器文件管理器不再维护独立映射，避免相同文件在不同入口被判定为不同类型
- 移除原压缩包专用 `ZipPreviewPanel`，保留 File Viewer 所需的 `libarchive.js` 运行时，并通过显式 renderer chunk 与资源复制策略避免重复打包

### Performance

- 优化 CMS 公共接口与广告事件令牌处理，减少不必要的数据加载和重复计算
- 收紧前台布局、数据集、数据库管理、工作流表单与页面注册表的加载边界，降低非当前功能进入首屏依赖图的概率
- 新增共享枚举选项与 Mock 数组操作工具，替换多业务域的重复转换和列表更新代码

---

## v1.42.0 - 2026-08-06

统一鼠标定位上下文菜单的定位与视口边界处理，覆盖聊天、文件、数据库、终端和表单设计器；同时修复文件预览与文件管理器在窄视口下的布局问题，并完成前后端依赖升级。

### Changed

#### 统一鼠标定位上下文菜单

- 新增共用 `CursorContextDropdown`，统一按鼠标坐标打开、视口碰撞修正、关闭与事件处理
- 聊天列表与消息、文件管理器、文件网格、数据库管理、终端和表单设计器改用同一套上下文菜单实现
- 表单设计器不再依赖画布内绝对定位，缩放、滚动及靠近视口边缘时菜单位置保持正确

#### 依赖升级

- Server 升级 AWS SDK、`ip-range-check` 与 `tsx`，移除 `bcryptjs` 已内置类型后不再需要的占位类型包
- Web 升级 Vite 8.2.1 与 Lucide React 1.29，移除 DOMPurify 已内置类型后不再需要的占位类型包
- Analytics SDK 升级 `web-vitals` 6.1，Electron 升级至 43.3 并补齐打包所需仓库元数据

### Fixed

- 文件预览弹窗统一使用 Semi Modal 的 `centered` 布局，避免额外顶部偏移导致底部溢出视口
- 文件管理器选择文件后切换为上下文操作工具栏，并修复选择态操作在窄宽度下溢出
- 收紧文件管理器网格宽度与滚动边界，避免卡片和工具栏撑破内容区域
- 上下文菜单在视口右侧或底部空间不足时自动回退，避免菜单被窗口裁切

---

## v1.41.0 - 2026-08-06

Office 文件预览进一步统一到 File Viewer：Excel、CSV、Word、PowerPoint 均在浏览器本地解析；同时消除 Presentation 运行时资源的重复打包，保持离线预览能力并缩小 Web 发布产物。

### Changed

#### 统一 Office 文件预览

- Excel、CSV 改用 File Viewer Spreadsheet renderer，与 Word、PowerPoint 共用 `FileViewerPreviewPanel`
- 文件列表、文件管理器、附件与聊天文件预览统一通过同一套格式识别和预览入口处理 `.xls`、`.xlsx`、`.csv`、`.doc`、`.docx`、`.ppt`、`.pptx`
- 移除原 `ExcelPreviewPanel`、`/api/files/{id}/sheet-preview` 接口及服务端 XLSX/CSV 转 Univer 转换器，前端直接读取鉴权文件 Blob 进行只读预览

### Performance

#### 消除 Presentation 资源重复打包

- Presentation renderer 改为组件显式注册，Vite 插件仅复制 Word、Spreadsheet 所需的 3 个 Worker 资源
- 删除 PPT 字体、WASM、PPTX Worker 在 `assets/` 与 `file-viewer/` 各生成一份的重复链路；哈希扫描确认最终正式版与 Demo 版产物均无 Presentation 重复文件
- 正式版 Web 解压产物由约 72 MiB 降至 54.16 MiB，减少约 18 MiB；`.ppt`、`.pptx` 离线预览能力保持不变

### Docs

- 更新文件预览组件、格式矩阵、离线资源装配和依赖保留说明，明确 Presentation 资源不得再次加入插件复制清单

---

## v1.40.0 - 2026-08-06

文件预览能力扩展到 Word 与 PowerPoint，并统一由 File Viewer 在浏览器本地解析；同时优化任务中心列表信息密度和自动刷新交互。

### Added

#### Word / PowerPoint 本地预览

- `FilePreviewModal` 新增 `.doc`、`.docx`、`.ppt`、`.pptx` 预览，统一懒加载 `OfficePreviewPanel`，不依赖外部预览或文档转换服务
- Vite 构建接入 File Viewer 插件，将 Worker、WASM、字体等 12 项运行时资源复制到站点产物，支持离线部署
- 文件管理器补齐 `.ppt` / `.pptx` MIME 推断与回归测试，避免文件在进入统一预览组件前被误判为不支持
- 旧版 `.ppt` 使用 File Viewer 公开版二进制引擎，运行时会显示水印；`.pptx` 不受此限制

### Changed

#### 统一 Office 预览实现

- 移除原 `docx-preview` 依赖和 `DocxPreviewPanel`，Word 与 PowerPoint 统一走 File Viewer，减少重复的 Office 渲染链路
- 更新文件预览组件文档，补充格式、MIME、鉴权加载、离线资源与旧版 `.ppt` 授权边界

#### 任务中心列表与刷新交互

- 将任务名称和任务类型拆为独立列，模块和进度说明改为省略/悬浮展示，提升表格横向扫描效率
- 自动刷新默认关闭，支持 5 / 10 / 30 / 60 秒间隔；后台轮询不再触发表格遮罩，手动刷新保留独立 loading 状态

### Docs

- 发布流程改为 lint、测试、正式/Demo 构建和文档构建四路并行，并记录各轨道耗时与失败状态

---

## v1.39.0 - 2026-08-06

服务端冷启动性能专项。实测定位 `dev`/生产启动的主要耗时在「启动即加载全部重型 SDK」：将 OTel、云厂商短信/存储、报表外部库驱动、Excel/PDF/图像处理等重依赖改为首次使用时惰性加载，`createApp` 前的模块图加载中位耗时 27.1s → 8.2s（-70%）。相应规范沉淀进 zenith skill，防止后续开发回退。

### Performance

#### 重型 SDK 懒加载，冷启动提速约 70%

- 启动模块图静态加载了 `@opentelemetry/sdk-node`（~6.8s）、`mssql`（~3.8s）、`@alicloud/dysmsapi`（~3.5s）、`cheerio`（~3s）、`exceljs`（~2.4s）、`@azure/storage-blob`（~2.3s）、`dockerode`、`ali-oss`、`sharp`、`pdfkit`、`mysql2` 等仅特定功能使用的重依赖，seed 完成到首行日志之间长时间无输出
- 16 个文件改为 `createRequire` 惰性加载 + `import type`（编译期擦除）：telemetry（启用 OTel 时才动态 `import()`）、file-storage（7 个云存储 SDK）、sms-sender、report-external-db、docker.service、cms 采集/死链/图像/资源、excel-export、export-center writer、xlsx-to-univer、report-file-parse、report-print-export、users.service
- 基准（`import('./src/app')` + `createApp()`，3 轮取中位）：27.1s → 8.2s；dev 与生产 `node dist` 冷启动同等受益；`createApp()` 本身仅 ~50ms

### Fixed

- file-storage 华为云 OBS 路径使用裸 `require()`，ESM 运行时会抛 `require is not defined`（改为 `createRequire`）
- `@baiducloud/sdk` 本地类型声明写成 default 导出，运行时实为命名导出 `BosClient`，`new BosClient()` 会在运行时崩溃（声明与取用改为命名导出）

### Docs

- zenith skill 新增「重型依赖懒加载」规范：constraints.md 硬约束与禁用清单、crud-backend.md 写法模板（含双格式包类型收敛技巧）、troubleshooting.md 启动缓慢与 `require is not defined` 排查条目

---

## v1.38.0 - 2026-08-05

服务端性能收尾与前端查询工厂迁移收官。全库排查「循环内逐行查询 / 写扇出 / 同步阻塞」后修掉最后四处真实热点；`createCrudQueries` 工厂经三批补迁覆盖全部 21 个标准形状域；提交中断从「猜消息形状」换成类型判据。server 与 web 依赖例行升级并经全量测试验证。

### Fixed

#### 中断提交的裸 Error 穿透全局兜底

- `useGlobalErrorHandler` 靠消息形状（`/^\w+$/`）区分「用户校验没过」与「真的出错了」，判据只写在兜底 hook 的注释里。`useEditModal` 迁移期间写下的多词 `throw new Error(...)` 成批穿透：用户在业务提示之外再吃一个「操作失败」Toast，同时向 `/api/frontend-errors` 灌入由正常操作产生的假告警
- 新增 `lib/abort-submit.ts`（`SubmitAborted` + `abortSubmit()`），判据从消息形状换成类型判断，调用点自我说明；兜底保留启发式向后兼容
- 20 处调用点按语义分四类处理：已有提示的静默中断；此前全靠兜底 Toast 顶着的三处先补 `Toast.error` 再中断；真实不变量违反（4 处 missing id）刻意保留为真错误继续上报，只把文案改中文

#### CmsPagesPage 表单不随详情重挂载

- 搭建器写 `key={editablePage?.id ?? 'new'}`，详情到达前后 id 不变、key 不变，Semi 不重挂载，详情数据永远进不了表单——正是 `useEditModal` 契约四要消除的缺陷
- key 公式（`${id}:${详情是否已到达}`）提为共用函数，页面与 hook 共用同一实现

### Changed

#### createCrudQueries 工厂迁移收官（21 个标准域）

- 三批补迁：`tags` / `data-mask` / `ai-prompts` / `payment-channels` 四域先行；二次全量排查确认首轮对「嵌套 key / `.all` 粗失效」的排除过于保守，补迁 workflow 系列 5 域等 11 个；4 个并行子代理对剩余 134 个手写域文件穷尽比对、人工复核后再迁 6 个（`identity-providers` / `system-configs` / `file-storage-configs` 等）
- 派生视图与子键（分组键、密码策略、默认项标记、monitor / deliveries）经 `onSaved` / `onDeleted` 回调保留原失效覆盖面；`keyPrefix` 保留 `['workflow', *]` 嵌套键
- 净删约 400 行手抄失效样板；剩余手写域均为形状不同构的合法保留

#### 移除两个基线护栏

- 删除 `check-edit-modal-baseline` / `check-invalidation-baseline` 脚本、基线清单与 `npm run lint` 接线；规范正文全部保留，被移除的只是迁移期的自动执行层

#### 依赖升级

- server：hono 4.13、@hono/node-server 2.1、pg-boss 12.27、cron-parser 5.7、AWS SDK 等；`@types/css-tree` 2→3 为修正与运行时（3.2.1）的类型错配
- web：semi-ui 2.102、embedpdf 2.15、dompurify 3.4.13、jsdom 29→30（仅测试环境）等
- 两侧升级后全量构建、测试、lint 均通过

### Performance

#### shell 探测改异步并按进程生命周期缓存

- `listShells()` 此前每次调用同步 `execFileSync('wsl.exe')`（timeout 3s）探测 WSL 发行版，Windows 上阻塞整个事件循环最多 3 秒，且每次 WS 连接实际触发两次，期间所有请求停摆
- 改用异步 `execFileAsync`，结果按进程生命周期缓存（shell 清单只随软件安装变化）

#### 消除四处按行查询扇出 / 逐条写

- `buildChannelRank`：1+2N 条 COUNT 改为 2 条 GROUP BY 聚合 + 内存合并，查询数恒定为 3，排名行为不变
- `deleteMessagesForUser`：上限 100 条的逐条读改写 UPDATE（默认连接池仅 10，一次请求即挤占整池）改为单条原子 UPDATE
- `listChannelsAdmin` 与报表治理列表：每页 2×pageSize 条 COUNT 改为 `inArray` + GROUP BY 聚合，口径不变
- 全库排查确认其余循环均为定时任务、事务内逐行账本或管理员罕用同步，属合理形态不动

## v1.37.0 - 2026-08-05

前端 CRUD 抽象专项，外加两项幂等作用域安全修复。页面层此前把「新增/编辑弹窗」的编排样板手抄了 335 处，其中四条契约漏写不会报错、测试也不会变红，只能靠人工逐页 review；新增 `useEditModal` 把它们焊死在一处，124 个页面完成迁移。服务端 1603 项、前端 588 项测试全部通过，任务中心幂等（7 项）与资金链路（15 项）DB 集成测试在真实 PostgreSQL 上通过，`npm run build` / `docs:build` / `build:demo` 三项构建均通过。

### Fixed

#### 任务中心幂等键跨租户/跨用户泄漏

- `async_tasks.idempotency_key` 此前是单列全局唯一，冲突后仅按 key 回查一行并整行返回。runner 不校验 user / tenant / taskType，而 `mapAsyncTask` 会输出 `payload` / `result` / `errorMessage` / `createdBy` / `tenantId`——撞上 key 即可拿到他人的任务内容
- 现成攻击面在 `POST /api/task-demo/submit`：请求体直接接收任意 `idempotencyKey`，且该路由的 `guard` 只配了 `audit` 没配 `permission`，任意登录用户可达；analytics 的 key 格式可预测，枚举即可跨租户拖取任务的输入与产出
- 唯一性改为 `(tenant_id, created_by, task_type, idempotency_key)`。因 PG 唯一约束视 NULL 互不相等（单租户模式与平台级任务的 `tenant_id` 恒为 null），拆成互补的两个部分索引，与 `analytics_user_segments_{tenant,global}_name_uq` 同一手法
- runner 冲突回查改为按完整作用域过滤，查不到则报错而非退回单 key 命中；`createdBy` 改为显式写入

#### 幂等中间件把所有会员归并为同一身份，导致响应互相回放

- `memberAuthMiddleware` 写的是 `c.set('member')`，而幂等中间件只试 `currentUser()`（读 `c.get('user')`），对会员请求必然抛异常并落入 catch，把**所有会员**归并为固定身份 `'0.0.0.0'`。命中缓存时会回放此前的完整响应体，于是 TTL 窗口内后到会员的写入被静默跳过、且拿到前一位会员的响应
- 受影响会员端点 12 个。最严重两处：`POST /checkin` 无请求体，`bodyHash` 恒为 `'nobody'`，签到高峰期指纹必然相同是常态而非竞态；`POST /wallet/recharge` 响应含 `orderNo` / `payUrl` / `codeUrl` / `formHtml`，两名会员短时间内充值同一档位会导致后者拿到前者的支付链接，付款后资金入前者钱包
- 现按管理员 / 会员 / 开放平台 / 匿名四类调用方分别取身份；顺带修掉一处死代码：原 `x-forwarded-for` 兜底永远不可达（`currentUser()` 无上下文时抛异常而非返回假值），匿名请求同样退化为 `'0.0.0.0'`，原测试只断言状态码故一直是绿的

#### 编辑弹窗详情数据进不了表单

- Semi 的 `initValues` 只在 `Form` **挂载时**读取一次。弹窗打开瞬间详情请求未返回，表单先拿列表行占位；详情到达后若没有变化的 `key` 强制重挂载，详情数据永远进不了表单
- `TenantsPage` / `TenantPackagesPage` 已处于该状态，只因两者的列表与详情恰好经同一个 `mapTenant` 返回相同字段集而未暴露——一旦详情新增一个列表没有的字段，编辑就会把它静默提交为空。另有若干页面在 `openEdit` 里用 `formApi.setValues()` 打补丁绕过，而该写法在首次打开时因表单尚未挂载而失效
- `useEditModal` 的 `formProps.key` 由 `${id}:${详情是否已到达}` 派生，按构造消除该缺陷。全站复扫确认此类缺陷已归零

### Changed

#### 新增/编辑弹窗编排收敛到 `useEditModal`

- 新增 `packages/web/src/hooks/useEditModal.ts`，焊死四条漏写不报错的契约：校验失败必须 `throw`（否则确定按钮永远转圈）、Toast 文案区分新增/编辑、保存后关闭并清空 `editing`（否则下次「新增」带出上次记录）、表单按记录重挂载
- 做成 hook 而非页面级模板组件：全站 39 个页面存在 ≥2 个编辑单元（如 `FriendLinksPage` 的友链 + 分组），模板组件无法承载
- 支持单模式弹窗（只有新增或只有编辑）、`beforeSave` 转换提交载荷、`onSaved` 处理保存后副作用、`successMessage: () => null` 抑制默认提示
- 迁移 124 个页面；手写样板 335 处 → 115 处，涉及文件 151 → 63
- 保留手写的均为合法自持表单实例：页面级全局配置表单、登录/找回密码等认证流程、工作流设计器与运行时表单、db-admin 行编辑器

#### 9 个标准域 hooks 改用 `createCrudQueries`

- 新增 `packages/web/src/lib/crud-queries.ts`，生成标准 CRUD 域的 key 工厂与列表/详情/保存/删除/下拉源，并固定保存与删除的失效契约
- 选取判据是三条同时成立：key 工厂只有 `all/lists/list/detail`、保存是标准 POST/PUT 分支、且 `onSuccess` 当前在广播 `xxxKeys.all`。第三条是主要收益来源——域根广播 376 处 → 352 处
- 刻意**不**迁移两类：已有刻意精确失效的标准域（`data-mask`、`identity-providers`），以及非同构域（`cms.ts` 有 21 个 list / 22 个 save；`positions`、`roles`、`cron-jobs`、`oauth2-apps` 的 `onSuccess` 是逐条带注释论证过的决策）。工厂定位是「标准域与新建域的正确性下限」，不是全域去重
- 调用方同步：单条删除签名由 `(id)` 变为 `(ids[])`，列表 `enabled` 参数由对象变为 boolean；导出名保持不变

### Performance

#### CMS 两页改懒加载富文本编辑器

- `ChannelsPage` 与 `ContentEditPage` 静态 `import RichTextEditor`，构建产物形成到 `vendor-editor-core`（778 KB）的静态链；Vite 的 preload helper 会在进入页面时一并拉取，属「进页面即下载」而非按需。而编辑器本身是条件渲染（前者仅单页栏目、后者仅非外链且未映射时才渲染）
- 改为 `lazy()` + `Suspense`，与 `AnnouncementsPage`、`WorkflowFormRenderer` 既有写法一致
- 传递静态闭包实测（gzip）：`ChannelsPage` 867.2 → 602.7 KB（-30.5%），`ContentEditPage` 762.4 → 497.9 KB（-34.7%）

### Tests

- 新增 `useEditModal.test.tsx`（13 项）与 `crud-queries.test.ts`（11 项）。后者断言全部落在可观测行为上（实际请求、真正进入 fetching 的查询、缓存条目存亡），不 spy `invalidateQueries` 调用参数
- 新增防回潮护栏 `scripts/check-edit-modal-baseline.mjs`（基线清单 + 只减不增，机制对齐 `check-invalidation-baseline.mjs`），已挂进 `npm run lint`
- 迁移清单最初只认 `useRef<FormApi>` 一种写法，漏掉了 `useState<FormApi>` 与只通过 `getFormApi={...}` 拿实例的页面，本版补迁 8 个（其中 `AnnouncementsPage`、`AiProviderFormModal` 带详情查询，正属「详情到达后表单不重挂载」的高危形态）
- **本版护栏自身仍带同一盲区**：只检测 `useRef<FormApi>`，对 `useState<FormApi>` 与 `getFormApi={...}` 形同虚设，回潮时不会报警。上述统计（115 处 / 63 文件）即在这个较窄的检测面下得出
- mutation 广播失效基线由 376 收紧至 352

---

## v1.36.0 - 2026-08-03

数据获取与索引专项：前端把绕过 TanStack Query 的裸 `request()` 取数收敛回域 hook，消除三处「手写进程级缓存 + 在途去重」与一处「四处独立取数 + CustomEvent 手工广播失效」；后端为身份/权限关联表补齐反向索引，修复联合主键左前缀之外的等值查询与级联删除退化为顺序扫描的问题。服务端 1595 项、前端 564 项测试全部通过，资金链路 DB 集成测试 15 项在真实 PostgreSQL 上通过，`npm run build` / `docs:build` / `build:demo` 三项构建均通过。

### Fixed

#### 身份/权限关联表缺少反向索引（`0002` 迁移）

- `core.ts` 的 9 张身份/权限表此前没有任何显式索引。联合主键 `PK(a, b)` 只覆盖左前缀 `a`，按右列等值查询以及父表 `ON DELETE CASCADE` 触发的子表扫描均无索引可用
- 补齐 9 个索引：`user_group_members.user_id`（`lib/permissions.ts` 与 `lib/data-scope.ts` 的权限解析热路径按 user_id 反查用户组，主键前导列却是 group_id）、`user_roles.role_id`、`user_positions.position_id`、`users.department_id`（工作流按部门/角色/岗位解析审批人、公告按部门圈选）、`role_menus.menu_id`、`user_menus.menu_id`、`user_group_roles.role_id`、`role_dept_scopes.dept_id`、`user_dept_scopes.dept_id`
- PostgreSQL 17 实测（40 万行，模拟 `user_group_members` 形态按 user_id 反查）：建索引前走主键 skip scan，`Index Searches=502`、1606 buffers、3.220ms；建索引后 `Index Searches=1`、4 buffers、0.033ms，且退化程度随用户组数量线性增长
- `tenantId` 未单独建索引：`users` / `roles` / `departments` / `positions` / `user_groups` 的 `UNIQUE(tenant_id, ...)` 约束已隐式提供以 `tenant_id` 为前导列的索引

> 生产库若这几张表已有大量数据，建议先手工 `CREATE INDEX CONCURRENTLY` 再执行迁移，避免写锁。

#### 共享下拉源双缓存导致数据陈旧

- `UserSelect` / `useUserOptions` / `DepartmentSelect` 各自持有模块级 `let cache` + `let inflight`，与 `useAllUsers`（`/api/users/all`）、`useDepartmentTree`（`/api/departments`）打同一端点却各存一份。手写缓存**永不失效**，改了用户昵称或新建部门后下拉需整页刷新才更新——现统一复用域 hook，随用户/部门管理页的 `invalidateQueries` 一并刷新
- 租户下拉此前在 `identityProviderKeys.tenants` 下另存一份，而租户切换器常驻 `AdminLayout`，两者会同时在线重复请求 `/api/tenants/all`；现收敛到 `tenants` 域共享 lookup

### Changed

#### 维护状态收敛为单一查询

- 维护状态此前在 `App.tsx`、`MaintenanceOverlay`、`useMaintenanceBanner` 三处各取一次（前两处为裸 `fetch`），并靠 `maintenance:enabled` / `maintenance:statusChanged` 两个 `CustomEvent` 在 5 个文件间手工同步——等同于手写了一份 `invalidateQueries`
- 新增 `usePublicMaintenanceStatus`（公开端点 `/api/maintenance/status`，与需权限的管理端 `/api/maintenance` 区分 key）作为唯一数据源；`http-client` 在 React 树之外拦截 503，故保留事件但降级为纯失效触发器
- `MaintenanceOverlay` 的 `setInterval` 轮询改为查询的 `refetchInterval`，组件仅在维护期挂载，恢复后随卸载自动停止

#### app shell 与页面取数改域 hook

- `useSystemConfigFlags`（水印配置、快捷聊天开关）、`useTenantSwitch`、`useInAppNotifications` 由 `useEffect + request + useState` 改为域 hook；通知类 setter 底层换成 `setQueryData`，对外形状不变，`useLayoutWs` 的 WebSocket 推送无需改动
- 写操作与上传改走 mutation：任务托盘取消任务 → `useAsyncTaskAction('cancel')`；CMS 图片上传 → `useUploadCmsImage`；工作流补偿附件 → `useUploadOneFile`
- 新增域查询/变更：公告未读数与已发布公告、我的站内信与未读数、聊天未读数聚合、CMS 标题查重与栏目样例内容

#### 数据获取白名单文档化

- `docs/frontend/data-fetching.md` 的「不走 TanStack Query 的场景」补充两类并说明判据：**本地优先 + 防抖回写的单属主存储**（`PreferencesProvider` —— localStorage 必须同步提供初值否则主题闪烁，全站仅一个消费方）与**认证前置**（登录、重置密码、OAuth 回调、OAuth2 授权页）
- 同时写明反例判据：手写进程缓存与 `CustomEvent` 广播失效是在重新实现 `staleTime` 与 `invalidateQueries`

### Tests

- `lookup-collateral.test.tsx` 的租户下拉断言跟随 key 收敛调整为 `tenantKeys.allTenants`，「保存身份源不波及租户下拉」的原意保持不变
- mutation 广播失效基线由 377 收紧至 376（`profile.ts` 的漂移为 `b1f9ff391` 遗留，只减不增的护栏不会报错故一直未同步）

---

## v1.35.0 - 2026-08-02

巨型页面拆解专项：`FileManagerPage.tsx`（2071 行）与 `SitesPage.tsx`（1697 行）两个最大的前端单体组件重构为「装配层 + 页面私有 hooks/组件」结构，行为保持不变；顺带修复跨页缓存失效缺口与命令面板体验问题，settings 表单映射与文件工具函数补上 35 项单元测试。服务端 1595 项、前端 564 项测试全部通过，`npm run build` / `docs:build` / `build:demo` 三项构建均通过。

### Fixed

#### terminal-files 跨页缓存失效缺口

- 合并 `hooks/queries/file-manager.ts` 与 `hooks/queries/terminal-files.ts` 为 `/api/terminal-files/*` 的唯一域文件。此前两文件各用独立 query key 命名空间（`['file-manager',…]` 与 `['terminal-files',…]`）指向同一后端资源，文件管理器中的增删改不会失效终端页本地文件 Explorer 的同目录缓存；统一命名空间后所有目录浏览缓存一致失效

#### 命令面板与最近访问

- 命令面板 / 顶栏弹层 / 移动端面板的最近访问条目此前硬编码时钟图标，改为优先渲染菜单自身 icon，缺失时才兜底
- 命令面板由垂直居中改为顶部锚定（margin 12vh），搜索时列表增减不再上下跳动

### Changed

#### 文件管理器（system/file-manager）拆解

- 入口 `FileManagerPage.tsx` 从 2071 行瘦身为约 465 行装配层，内部实现拆分至同目录：`fs-utils.ts`（15 个纯函数）、`types.ts`、`entry-actions.ts`（表格操作列与右键菜单共享的动作契约）、`hooks/`（导航历史、选择+剪贴板+冲突传输、四途径上传、画廊预览 blob 生命周期、下载、全局快捷键、收藏夹）、`components/`（工具栏、侧栏、列表/网格视图、右键菜单及全部弹层共 12 个组件）
- 页面内 checksum / 深度搜索 / 目录大小三处内联 `request.get` 收编为声明式域查询（`useTerminalChecksum` / `useTerminalSearch` / `useTerminalDirSize`），冲突检测目录读取改走 queryClient（`staleTime: 0` 保证新鲜清单）
- 深度搜索弹窗打开即显示「搜索中」状态（原为等待响应后才弹出），同词回车强制重新搜索

#### 站点管理（cms/sites）拆解

- 入口 `SitesPage.tsx` 从 1697 行瘦身为约 356 行装配层，六个独立工作流拆分至 `cms/sites/`，签名统一 `{ site, onClose }`、查询与变更各自持有（关闭即停止请求/轮询）：`SiteEditSheet`（8-tab 编辑）、`SiteUsersModal`（授权用户）、`SiteOpenGrantsModal`（开放授权）、`SiteMoveModal`（移动）、`SiteInheritanceSheet`（继承配置）、`SiteStaticSheet`（静态化）；打开任一弹窗不再重渲染整棵站点树
- settings JSONB ⇄ 表单字段映射抽为纯函数 `site-form-mapping.ts`（46 字段初值构造 + 保存序列化），往返不丢键、`clear*` 凭证语义、legacy h5 键剔除、编辑模式 `theme` 不进 payload 均由单测锁定
- 授权用户弹窗消除 render 期 `setState` 反模式，改为受控初始化并保持「每次打开只初始化一次」语义；保存后静态化提示的内联 `request.post` 收编为 `useCmsStaticBuild` 域 hook

### Tests

- 新增 35 项单元测试：`fs-utils`（副本命名、跨平台名称校验、权限字符串/八进制转换、面包屑、MIME 判定等 19 项）与 `site-form-mapping` / `site-tree-utils`（settings 往返、凭证清除、主题参数变更判定、树工具等 16 项）

---

## v1.34.0 - 2026-08-02

文档站全站对齐专项：112 个文档页面逐条与 v1.33.0 代码核实并刷新，消除长期漂移；文档只描述当前状态，删除历史变迁叙述；同步调整侧边栏结构。无任何应用代码改动。服务端 1595 项、前端 529 项测试全部通过，`npm run build` / `docs:build` / `build:demo` 三项构建均通过。

### Changed

#### 文档全站刷新（docs/）

- **开发规范**：`frontend/routing.md`、`frontend/auth-request.md` 按认证集中化（AuthProvider + `['auth','me']`）与菜单 TanStack Query 化整页重写；`backend/export-center.md` 修正与代码相反的脱敏默认值描述（实际默认 `raw=false`）；`backend/database.md` 迁移基线与 31 个 schema 文件映射重写；`backend/task-center.md` 补事务性 outbox 与 `bootstrap/workers.ts` 注册时机；`backend/api-conventions.md` 路由装配改为 `defineRouteDomain` / `ROUTE_DOMAINS` 三段式并补请求防护总章
- **安全与基础设施**：`backend/idempotency.md` 修正核心语义（成功响应缓存并回放，非一律 429）；`backend/cron-jobs.md` 调度器更正为 pg-boss 双层结构（业务 cron_jobs + 系统调度）；`backend/security.md` 补受信代理、个人 API Token、12 条限流规则；`backend/system-configs.md` 配置项 24→43 项全量重列；`backend/oauth.md` 对齐 OAuth2 服务端安全收敛（去 implicit、PKCE 仅 S256、token 家族重放检测）；`backend/websocket-events.md` 补齐 channel/mp-kf/analytics/payment 等约 10 个缺失事件
- **业务模块**：IAM 补认证与账号安全（MFA/可信设备/企业身份源）与租户套餐整块；通知中心补频道系统；即时通讯补群治理与效率工具 10 项能力；会员补 VIP 续费/签到运营/看板；运维补数据库管理/备份/防火墙/Nginx/SSL/维护模式 6 大模块；CMS 补页面部件（widgets）模块并重写 Webhook 管线（开放平台统一托管）；支付补渠道能力矩阵（3 渠道 11 方式）、退款审批链、风控引擎，后台页面 4→20 个，并删除已不存在的导出接口描述；公众号补多客服路由治理 `enabled` 总开关语义并修正菜单按钮类型；数据分析表清单 9→19 张并补 Tracking Plan/治理配额/A/B 实验/错误告警历史；报表中心补数据源健康检查、增量物化、分享访问控制（次数上限/IP 白名单/两步会话）、异步晋级五态机与 pg-boss 统一调度；AI 能力删除虚构的 `user` SSE 事件、修正上下文预算并补 Arena/审计/分享接口参考；工作流移除已下线的侧边栏待办角标描述、修正 `taskFinished` 触发面并补抄送节点 `onlyOnApprove`
- **产品与首页**：功能清单补齐规则中心、CMS、开放平台三个整块缺失的一级模块；首页 features 卡片 11→15 张并全部补链接；`FeatureMatrixFlow` 能力矩阵 104→129 条
- **开始使用**：部署文档按当前可用链路重写（源码部署 + PM2/tsx）；Docker 部署补种子数据步骤；lint 覆盖更正为 4 包；Demo 模式主推 `npm run dev:demo`
- **AI 辅助开发**：对齐 AGENTS.md「只做项目导航、规范唯一来源在 skill」的定位，重写三页职责分工

#### 文档目录结构（.vitepress/config.mts）

- 报表中心 15 页平铺改为「总览 / 数据接入 / 设计与消费 / 智能能力 / 平台治理 / 运行时」六段分组
- CMS 分组补入此前缺失的「站群与内容分发」页
- 开发规范组调序：Swagger 紧跟 API 规范、任务中心提前至导出中心之前、前端按「UI 规范→认证→路由→数据获取→组件」阅读动线排列；安全与基础设施组同步微调

---

## v1.33.0 - 2026-08-01

菜单路由治理专项：修复一处路由级授权缺口，导航菜单加载全面接入 TanStack Query，权限变更即时刷新当前登录者的可见范围。服务端 1595 项、前端 529 项测试全部通过，`npm run build` / `docs:build` / `build:demo` 三项构建均通过。

### Fixed

#### 路由级授权缺口（安全）

- 移除 `App.tsx` 中无权限守卫的 `/system/ssl-certificates` 硬编码路由。该路径同时存在于动态菜单（种子 id 2590），React Router 对同一路径按声明顺序取先者，硬编码版本恒遮蔽权限过滤的动态版本——未分配该菜单的用户此前可直接打开页面。修复后页面仅由用户菜单树承载，未授权访问统一落 catch-all 403
- 页面 chunk 加载失败（网络中断 / 发版后旧产物被清理）时，错误边界的「重新加载」改为整页刷新并展示针对性文案。此前仅重置边界状态，而浏览器缓存 rejected 的 module promise，重试必然立即再次失败

### Changed

#### 导航菜单接入 TanStack Query

- 新增 `useCurrentUserMenuTree`（`/api/menus/user`），与既有管理树查询统一由 `menuKeys`（`all` / `tree` / `userTree` / `detail`）管理；两棵树的 queryFn 均静默，错误展示责任在消费方
- `AdminRouteLoader` 直接消费查询：仅首载 gate，后台 refetch 保留旧数据不闪烁；导航树加载失败渲染显式重试页，不再以空菜单伪装成「全部页面 404」；管理树失败仅降级 403→404 判别
- `AdminLayout` 直接渲染菜单 props，删除本地 `menuTree` state 副本与永不执行的 `/api/menus` 兜底请求（`presetMenus` 为空数组时该分支不可达）
- 菜单管理页新增加载失败横幅，静默查询的故障对管理员可见

#### 权限变更即时生效

- 菜单增删改失效用户导航树；角色菜单分配、用户直接授权、用户组角色分配、租户套餐菜单分配成功后，经 `invalidateCurrentUserAccess` 无条件失效当前登录者的导航树与 `auth/me` 权限码快照（客户端无法判断变更是否覆盖自己；无活跃订阅的查询仅标脏不发请求）。全部使用精确子键，失效粒度基线不受影响

### Tests

- 新增 33 项回归测试：菜单双树查询与静默错误态、`useSaveMenu` 与访问变更的失效扇出、SSL 路由策略（菜单承载注册 / 403 判别 / 硬编码防回潮源码扫描）、chunk 失败整页重载与普通运行时错误的边界重置
- 修复 `StatusSelect` 回调断言在高负载下的偶发失败（改用 `waitFor`）

---

## v1.32.0 - 2026-08-01

前端首屏性能专项：三个 SPA 入口全面瘦身，登录关键路径与移动审批入口体积大幅下降。无新增业务功能，无破坏性变更。服务端 1595 项、前端 513 项测试全部通过，`npm run build` / `docs:build` / `build:demo` 三项构建均通过。

### Performance

#### 三入口首屏预载实测对比（vite build，modulepreload + entry JS 合计）

| 入口 | 优化前 | 优化后 |
| --- | --- | --- |
| `index.html`（后台管理） | 235 个 JS / 2.36MB raw / 686KB gzip | 62 个 JS / 1.03MB raw / 280KB gzip |
| `approval.html`（移动审批） | 313 个 JS / 3.13MB raw | 27 个 JS / 0.55MB raw / 172KB gzip |
| `member.html`（会员前台） | 150 个 JS / 1.44MB raw / 462KB gzip | 124 个 JS / 1.42MB raw / 452KB gzip |

#### 移动审批入口瘦身

移动审批「轻页」此前是三个入口中最重的一个：5 个页面全部静态 import，TaskDetail / LaunchForm 经 `WorkflowFormRenderer` 静态拖进 wangeditor（~780KB raw）、react-markdown、FileAttachment、RegionSelect 等全能表单依赖。

- `App-approval.tsx` 5 个页面改 `React.lazy` + 路由级 Suspense
- `WorkflowFormRenderer` 的富文本编辑器改懒加载，Suspense 收在字段内部——编辑器 chunk 加载期间仅该字段显示占位，不打断整表单渲染；同时惠及 admin 端所有承载该渲染器的页面（工作流发起 / 审批 / 设计器预览）

#### admin 入口瘦身：登录页卸下后台布局依赖图

`App.tsx` 此前静态 import `AdminLayout`，使登录页与公开页（支付链接 / 公开报表 / OAuth 授权）被迫预载后台布局的完整静态依赖：通知弹层、公告详情（→FileAttachment→FilePreviewModal）、偏好设置面板、dnd-kit、DatePicker+date-fns、semi-illustrations 等。

- `AdminLayout` 改 `React.lazy`，与登录页彻底分离
- `AnnouncementDetailModal` 改懒加载 + 打开时挂载
- `PageErrorBoundary` 错误插图改懒加载——插图只在错误态渲染，~130KB 的 semi-illustrations 不再进入口静态图

#### 首页仪表盘图表区懒加载

DashboardPage 是登录后默认落地页，此前静态引 `@/components/charts`，模块求值即接入 VChart 主题并拖入 ~1.9MB（raw）的 @visactor 依赖树。三张图表卡片抽为独立懒加载组件：欢迎横幅 / 统计卡 / 公告 / 日历先渲染，图表 chunk 就绪后骨架占位无缝补齐；非管理员现在完全不加载 visactor。

#### vendor 微 chunk 收敛

按包分组此前产出 1346 个 JS chunk，其中 500+ 个小于 10KB（semi 按组件拆分后大量组件只有 1-6KB），每次页面导航触发几十个微请求。rolldown `codeSplitting` 的按包动态分组加 `minSize: 20KB`，不足阈值的组回落自动分配：chunk 总数 1346 → 1106，产物总量不增（无跨页复制回归）。`vite-runtime` 与 `vendor-react-core` 两个关键组刻意不受影响——历史上这两组被合并进重型包曾导致入口预载暴涨。

同时以实测否决并备注了 date-fns 自动分包方案：semi 的 locale / DatePicker foundation 成组消费大量 date-fns 模块，自动分包只会拆出难以命名的共享微块，总量不降、请求数反增。

### Changed

- 认证状态收敛集中管理（`refactor(web): centralize authentication state`）
- Node.js 版本统一到 24（`engines` 字段与 CI 保持一致）

### Fixed

- 表情选择器：修复未跟随应用主题的问题，稳定首次展开尺寸
- 路由契约测试：数据库桩化，无 PostgreSQL 环境也能通过
- 移除声称锁定挂载顺序但实际无效的域装配清单快照，保留仍在发挥作用的路由表快照，相关注释改为如实描述

---

## v1.31.0 - 2026-08-01

质量加固版本：跨大版本升级 ioredis（v5→v6，默认切 RESP3），为此前几乎无测试的 267 个路由文件补上契约层测试并修正其暴露的 37 处声明缺陷，消除 payment / CMS 的 11 处 N+1 查询。无新增业务功能，无破坏性变更。服务端 1596 项、前端 507 项测试全部通过，资金链路与支付可靠性 DB 集成测试 25 项通过，`npm run build` / `docs:build` / `build:demo` 三项构建均通过。

### Added

#### 路由契约层测试

267 个路由文件此前只有 2 个测试。`app.ts` 顶部注释写明重构 `createApp()` 为纯函数的动机就是这件事，但该能力从未被使用；`_kit.ts`、`routes/index.ts`、`app.ts` 三处注释引用的 `src/app.routes.test.ts` 也根本不存在。

新增契约测试，一次装配覆盖全部 1843 个操作（约 22 秒），锁定 6 类不变量：

1. 声明 `BearerAuth` 的操作，无凭证访问必须返回 401（捕获漏挂 `authMiddleware`）
2. 声明 `security: []` 的操作，无凭证访问不得返回 401（捕获错误的公开声明）
3. 公开端点总数设阈值，攻击面增长必须被评审看见
4. 返回 JSON 的操作必须声明 400/401/403/404/500
5. 200 响应必须是 `{ code, message, data }` 包络
6. 无重复 method + path 注册；未匹配路径返回标准 404 包络

第 4 条的豁免是原则而非白名单：不返回 JSON 的端点不适用 JSON 错误契约。微信/支付宝回调必须按渠道协议返回纯文本 ACK，判据取 200 响应的 content-type，随代码自动演进。

同时把 `@zenith/shared` 纳入 CI lint：该包 111 个文件承载前后端共用的全部类型与 Zod schema，此前零 lint 配置、根 lint 脚本也不覆盖，一处 schema 改错可同时打穿两端而无人拦截。

### Performance

#### 消除 payment / CMS 的 11 处 N+1 查询

全部改写严格保持可观测行为不变——相同结果、相同报错顺序、相同写入行，只减少数据库往返：

| 位置 | 改前 | 改后 |
| --- | --- | --- |
| `evaluateRisk` | 每条命中规则一次当日聚合，且处在下单同步路径上 | 按 `scope` 记忆（聚合条件只由 scope 决定），≤3 次且仍惰性——没配日限额的规则依然 0 次查询 |
| `closeExpiredOrders` / `runReconciliation` | 无 limit 扫描 + 每单重查渠道配置 | 单次上限 500（cron 周期消化余量）+ 整批共用配置解析器 |
| `retryFailedSharingOrders` / `syncProcessingSharingOrders` | 每条分账单 1~2 次点查 | `inArray` 预取订单与接收方 |
| `syncProcessingTransfers` | 每单一次渠道配置点查 | `inArray` 去重预取 |
| `checkAccounts` / `rebuildAccountsFromLedger` | 每个维度 3~4 次聚合点查 | GROUP BY 全量聚合，查询数与维度数量脱钩 |
| `batchAddCmsContentTags` | 每条内容重查同一批标签（只有 siteId 不同） | 按 siteId 一次取回，站点级完整性校验口径不变 |
| `cleanupCmsRecycleBin` | 每个站点各扫一次回收站 | 按 `recycleKeepDays` 分组的单条 OR 查询（通常只剩一条分支） |
| `submitCmsSiteGroupPublish` / `applyCmsContentPublishSnapshot` | 逐站点 / 逐栏目点查 | 事务内 `inArray` 预取 |
| `flushViewCountBuffer` | 每分钟逐条 UPDATE | 单条 `UPDATE ... FROM (VALUES ...)`（5000 行分片） |

`rebuildSearchVectors` 刻意保持逐行写入：其取值内嵌整篇正文（≤20000 字符），批量化会产生 MB 级单语句，而该任务本就 IO-bound 在 `to_tsvector` 计算上，收益远小于风险。

这些函数原本零单元覆盖，因此正确性由差分验证保证——在真实 PostgreSQL 上同时运行改前的逐行实现与改后的批量实现，逐字段断言结果一致（22 项）。

### Changed

- **ioredis 5.11.1 → 6.0.0**：要求 Node ≥ 20（项目运行 24），默认改用 RESP3（发 `HELLO 3`，服务端不支持时自动降级 RESP2）。`replyMapping` 默认为 `"legacy"`，因此 `hgetall` 仍返回对象、`zrange`/`zrevrange WITHSCORES` 仍是扁平字符串数组、`zincrby` 仍返回字符串、`multi`/`pipeline.exec()` 仍是 `[err, result][]`——服务端用到的 39 个命令已在真实 Redis 7.2.4 上逐一验证形状不变。另需留意两处默认值变化：TCP `keepAlive` 由 0 改为 30s，重连退避由线性（50ms 步进 / 2s 封顶）改为指数 + 抖动（5s 封顶）。v6 生成的类型定义漏掉了 ZRANGE `stop` 参数的 `number` 重载（上游回归 [redis/ioredis#2162](https://github.com/redis/ioredis/issues/2162)），3 处调用改为传字符串下标，线上编码完全等价
- **`FileManagerPage` 垫片消除**：`FileManagerPage.tsx` 此前只有一行 `export { default } from './FileManagerPage2'`，且追溯首个提交可见它从第一天起就是垫片——从不存在被取代的 v1。这是 408 个页面文件中唯一一处此种写法。实现文件回归 `FileManagerPage.tsx`，头注释改为说明该页面是什么（操作宿主机真实文件系统、走 `/api/terminal-files/*`、权限码刻意复用 `system:terminal:execute`），并显式标注与 `FilesPage`（托管文件库，`/api/files/*` + 存储抽象层）的区别，避免再被误读为「重构未收尾」。构建产物由 3 个 chunk 减为 2 个

### Fixed

#### 公开端点声明缺陷（契约测试暴露）

- **23 处公开端点漏写 `security: []`**（14 个文件），其中 4 个无凭证直接返回 200。危害不止于文档撒谎——这些噪声混在「已声明受保护」集合里，未来某个敏感路由真的漏挂认证时无法与它们区分
- **14 处缺失 `commonErrorResponses`**（cache 9 条、health、maintenance/status）

#### N+1 改写过程中自查发现并修复

- **浏览计数批量 UPDATE 漏刷 `updated_at`**：drizzle 的 `.update()` 会自动带上 `$onUpdate` 列，手写 SQL 不会。而开放平台增量同步以 `cms_contents.updated_at` 为水位线、`viewCount` 又在同步载荷内，漏刷会让集成方再也收不到浏览数变更
- **`rebuildAccountsFromLedger` 并发竞态**：维度扫描与聚合放进同一个 `Promise.all` 后失去先后关系，READ COMMITTED 下聚合快照可能早于维度扫描，出现「维度已被发现、聚合却缺失」从而回落到默认 0，用 0 覆盖真实余额
- **批量语句的 65535 绑定参数上限**：两处批量语句每行 2 个绑定参数，而输入侧（路由 schema 与真实访问量）都没有上限。浏览计数刷新尤其危险——Redis 缓冲已先行删除，抛错等于丢掉整个窗口的计数。两处均改为 5000 行分片

---

## v1.30.0 - 2026-08-01

巨型文件拆分版本：把全仓最大的 7 个 god-file（合计约 15,300 行）机械拆分为 80+ 个内聚模块，原路径一律保留为门面（facade）或编排层，导出符号集逐一核对一致，所有外部导入零改动。后端逐行 diff 确证函数体字节级一致；前端 hook 调用序列展开对比 218 个完全一致、state 归属未变。服务端 1585 项、前端 507 项测试全部通过，资金链路 DB 集成测试 15 项通过，`npm run build` / `docs:build` / `build:demo` 三项构建均通过。

### Changed

#### 巨型文件拆分（零行为变更）

| 文件 | 前 | 后 | 拆出 |
| --- | --- | --- | --- |
| `web/pages/chat/ChatPage.tsx` | 3,898 | 1,317 | 16 个 hooks + 23 个子组件 + utils-state |
| `web/layouts/AdminLayout.tsx` | 3,137 | 1,006 | `layouts/admin/` 下 32 个文件（15 hooks + 15 组件 + utils/constants） |
| `server/services/report/report-dataset.service.ts` | 2,027 | 47 | params / crud / execution / execution-logs / refresh + shared |
| `server/services/chat/chat.service.ts` | 1,957 | 23 | conversations / groups / messages / reactions / bot / rtc / directory + shared |
| `server/services/cms/cms-contents.service.ts` | 1,771 | 51 | query / write / ops + internal |
| `server/services/cms/cms-interactions.service.ts` | 1,335 | 46 | forms / stats / responses + shared |
| `server/services/cms/cms-distributions.service.ts` | 1,136 | 27 | rules / sync / runs + shared |

跨模块共用的私有 helper 统一下沉到 shared/internal 模块防止循环依赖；子模块不回引 facade。唯一的非搬移改动是 6 个「源码文本扫描类」测试中的文件名字符串同步指向新模块（import 语句未动）。

#### 搜索工具栏筛选控件收敛

关键字、状态、时间范围三类筛选统一收敛到 `search-filters.tsx` 的 `KeywordInput` / `StatusSelect` / `DateRangeFilter`，装饰性属性（搜索图标、`showClear`、固定宽度）由公共组件兜底。

### Performance

- **ChatPage 表情选择器懒加载**：`ComposerEmojiPicker` 与 `ReactionPickerOverlay` 改为 `React.lazy` + `Suspense`，emoji-mart 的 ~494KB chunk（419KB 表情元数据 + 75KB picker）不再随聊天页加载，首次点击表情按钮时才按需下载

### Fixed

- **workflow 外部数据源选项出现 `[object Object]`**：外部接口字段配置错误（值为对象/数组）时，`String()` 会生成 `[object Object]` 垃圾选项；新增 `toOptionText()` 窄化 helper，仅原始类型可字符串化，对象/数组直接过滤，选项生成与记录回查口径保持一致
- **SonarLint 静态检查告警清理**：`instances/shared.ts` 重复导入合并、三处 `void` 操作符改写为等价提前返回；`AiAuditPage` 嵌套模板字面量与嵌套三元拆平（渲染结果不变）

---

## v1.29.0 - 2026-08-01

重复代码收敛版本：先用 jscpd 与精确 grep 摸清全仓重复分布，再把四类「同一件事有多套写法」的样板收敛到共享模块。过程中暴露并修掉三个真实缺陷——时间范围末端漏掉当天数据、7 个页面点「查询」不回源、64 处破坏性操作的确认按钮不是红色。服务端 1585 项、前端 491 项测试全部通过，资金链路 DB 集成测试 15 项通过，`npm run build` / `docs:build` / `build:demo` 三项构建均通过。

> jscpd 只能发现逐字克隆（本仓 164 处 / 3907 行，0.85%）。本次收敛的四类重复都是**结构性**的——同一套写法只换实体名，且多为逐行重复，12 行阈值的克隆检测本就抓不到。因此各项以调用点计数衡量。

### Fixed

#### 时间范围末端漏掉当天数据

`parseDateRangeEnd('2026-08-01')` 取当天 `23:59:59.999`，而 `parseDateTimeInput('2026-08-01')` 取 `00:00:00`。后者被用在 20 个列表接口的范围末端上（`users` / `roles` / `positions` / `login-logs` / `operation-logs` / `files` / `payment*` / `async-tasks` / `export-jobs` 等），「筛选到 8 月 1 日」会漏掉整个 8 月 1 日的数据；起止选同一天时区间长度为 0，结果全空。

后台页面传的是完整时间戳所以看不出来，但这些查询参数一律是裸 `z.string().optional()`，从 Swagger、开放平台或脚本传 `?endTime=2026-08-01` 就会中招；且项目里已有 14 个页面在用只选日期的 `dateRange` 选择器，换上去即刻上线。

范围端点统一改走 `dateRangeConditions()`。判定按「解析结果是否流入 `gte`/`lte` 过滤」逐条核对，写入实体字段的 27 处（广告投放起止、定时发送、凭证过期等）保持不动——对这些字段套用范围口径会把存储值悄悄挪到 23:59:59。

#### 非法时间参数被静默当成「无筛选」

`?endTime=abc` 或 `?endTime=2026/08/01` 此前不报错，解析返回 `null` 后条件被丢弃，用户拿到的是未经筛选的全量列表。routes 下 104 个时间参数补上 `dateRangeBound()` 格式校验，只接受 `YYYY-MM-DD` 与 `YYYY-MM-DD HH:mm:ss`。

#### 7 个页面点「查询」不回源

条件未变化时 query key 不变，`staleTime` 内 TanStack Query 不会重新发请求，而本系统的「查询」按钮兼具刷新语义。这段 `invalidateQueries` 此前由每个列表页手写，91 个页面里有 7 个漏掉：analytics 事件调试流、cms 链接选择器、cms 检索测试与自定义词典、渠道客服会话等。表现只是「点了没反应」——不报错、列表仍有数据，几乎不可能在自测中被发现。

#### 64 处破坏性操作的确认按钮不是红色

全仓 368 个 `Modal.confirm` 中 223 个是破坏性操作（删除、清空、彻底移除、重置密钥、撤销令牌、截断表、终止流程…），其中 64 个没写 `okButtonProps: { type: 'danger', theme: 'solid' }`，确认按钮渲染成与「确定提交」无异的蓝色主按钮。

#### 两处查询语义修正

- `cms-contents` 的时间范围用 `gt`/`lt` 开区间，边界时刻创建的内容会被漏掉，改为闭区间
- `cms-open` 的起点用裸 `sql\`>=\``、终点用 `lte`，两端口径不一致

### Changed

#### MSW mock 响应信封与分页收敛

`mocks/utils/handlers.ts` 的 `ok` / `notFound` / `paginate` 早已存在，但 127 个 handler 只有 7 个在用，其余各写各的：内联信封 1269 处、各文件自建同名局部 helper 57 个（默认 message 还不一致，`'ok'` 与 `'success'` 并存）、`page`/`pageSize` 声明对 83 处、手写自增 ID 18 处。

| 项 | 前 | 后 |
| --- | --- | --- |
| 内联 `HttpResponse.json` 信封 | 1269 | 24 |
| 局部自建 helper 定义 | 57 | 10 |
| `page`/`pageSize` 声明对 | 83 | 10 |
| 手写分页 slice | 107 | 60 |
| 手写 `Math.max` 自增 ID | 18 | 13 |

HTTP 状态码不做统一（61 个文件设、111 个不设，且 `http-client` 对 401/429/503 有特殊处理、`mocks/*.test.ts` 有 `expect(res.status)` 断言），helper 一律透传可选 `ResponseInit`。默认 pageSize 的 10/20/50/100 四种取值作为参数按原值传入。

#### Service 层 WHERE 构造收敛

`or()` 返回 `SQL | undefined`，全项目三种处理方式并存：非空断言、隐式吞 `undefined`、显式 guard。`lib/where-helpers.ts` 新增 `keywordCondition` / `dateRangeConditions` / `buildWhere`，关键字条件 41 处 / 32 文件迁移完毕，`or(like...)` 由 58 降至 19。

条件数组类型由 `SQL[]` 放宽为 `(SQL | undefined)[]`——这才如实反映「条件可能不存在」，drizzle 的 `and()` 本就接受 `undefined` 并自动过滤，比逐处 `!` 断言更安全。

#### 列表页搜索三件套收敛

91 个列表页各自手抄 draft/submitted 双状态、页码重置与失效调用。新增 `hooks/useListSearch.ts` 把契约焊进 hook，91 个页面全部迁移，净减 669 行。

另提供 `applySearch(params)` 覆盖「点部门树 / 收藏开关 / 应用保存的视图」这类不经输入框的直接筛选——此前这些地方各自手写四行，同样容易漏失效；暴露裸 `setSubmittedParams` 会让调用方绕过页码重置与失效，因此不提供。`defaults` 支持惰性函数，「最近 7 天」这类相对区间在每次重置时重新求值。

迁移中顺带修正：`ai/feedback` 的 draft 与 submitted 初值不一致（draft 少了 `startDate`/`endDate`）；payment 的 contracts/disputes/preauths 把 draft 拆成一字段一个 `useState`，合并回单一对象；terminal 与 workflow-monitor 用 `searchParams` 命名 draft，统一为 `draftParams`。

#### 危险操作确认收敛

新增 `utils/confirm.ts` 的 `confirmDanger` / `confirmDelete`，注入红色实心确认按钮。手写 `okButtonProps` 由 185 降至 31，`Modal.confirm` 由 368 降至 145（保留的都是良性确认：提交、发布、启用、退出、导出）。

文案刻意不做统一——`'确定要删除该评测集吗？'` 这类指明对象的具体文案比通用文案更能防误操作，helper 只在调用方未传 `title` 时才用默认值。破坏性词表之外的（重置密钥、截断表、转让群主、切换表单类型）逐条人工核对后走定向改写，不放宽正则，避免误伤 107 处良性确认。

#### 修正已失效的路径引用

`packages/shared/src/seed-data.ts` 在共享层按域拆分时已被删除，但仍有 7 处文档与注释指向它。其中 `permission-audit.test.ts` 那处是 CI 拦到权限码漂移时打给开发者的提示信息，「请先补 seed 按钮再引用」却指路到一个不存在的文件。

### Added

#### 新增的共享模块与配套测试

| 模块 | 内容 |
| --- | --- |
| `web/src/mocks/utils/handlers.ts` | `ok` / `fail` / `badRequest` / `unauthorized` / `forbidden` / `notFound` / `conflict` / `locked` / `pageParams` / `pageResult` / `paginate` / `nextIdFrom` |
| `server/src/lib/where-helpers.ts` | `keywordCondition` / `dateRangeConditions` / `buildWhere` |
| `server/src/lib/openapi-schemas.ts` | `dateRangeBound()` 时间范围参数校验 |
| `web/src/hooks/useListSearch.ts` | 列表页搜索状态与「查询必回源」契约 |
| `web/src/utils/confirm.ts` | `confirmDanger` / `confirmDelete` |

新增 48 项测试（server +17、web +31）。其中时间范围用「同一天的纯日期范围必须覆盖整天」这类时区无关断言锁住口径，而非断言具体时分秒——后者会随机器时区飘。

#### skill 与文档站同步

四类规范全部写进 `constraints.md` 作为单一来源，`crud-mock.md` / `crud-backend.md` / `crud-frontend.md` 的代码模板同步更新，`troubleshooting.md` 新增按日期筛选查不到当天、非法时间参数返回全量、LIKE 元字符未转义三条症状条目。

`crud-backend.md` 的 service 模板此前缺少分页列表函数（最常写的反而没有），本次补上并演示 `buildWhere` + `keywordCondition` + `dateRangeConditions` 的标准组合；dataScope 与 tenantScope 两处示例原本写在 route handler 里 push conditions，与薄路由约定冲突，一并改到 service。

---

## v1.28.1 - 2026-08-01

Skill 治理版本：把 v1.28.0 缓存一致性工作中沉淀下来、但只落到代码里的规则补进 zenith skill，并按「规则单一来源 + 渐进式披露」重整 skill 的文件分工。**无代码变更**，服务端 1568 项、前端 460 项测试全部通过，`npm run build` / `docs:build` / `build:demo` 三项构建均通过。

### Added

#### skill 补齐 v1.28.0 沉淀的三类规则

v1.28.0 期间写进 skill 的只有契约的前半部分（按副作用精确失效 + 可证伪的测试要求）。后半程在 20 个业务域收敛时暴露的另外三类问题，此前只存在于代码与提交记录中：

- **key 结构设计**：`all` 只能是本域自己的根；独立生命周期的子资源另起命名空间（群成员挂 `['chat','group-members',id]`，嵌在会话之下会让「刷新会话列表」连带打掉每个会话的成员名单）；同一实体的多变体查询导出 `detailOf(id)` / `dataOf(id)` / `lookupPrefix` 前缀键；静态 lookup、数据库元数据与昂贵的派生取数不与列表同前缀
- **下拉源必须归属所有者域**：禁止用本域 key 请求别域资源。这类「藏键」在所有者域增删改时没有任何来源会失效它，界面静默显示旧列表——它不会报错，因此评审时最容易放过
- **回填的可见性红线**：`setQueryData` 仅限写接口与详情接口同源。详情按查看者脱敏（用户域写接口返回明文、详情按角色脱敏，回填等于把明文手机号邮箱写进本不该展示它们的界面）、详情多出关联数据、写接口不回传编辑过的关联字段、列表/树含聚合字段这四种情形一律改为失效 `detail(id)`

同时补上 `check-invalidation-baseline.mjs` 护栏的使用说明（只减不增、合法广播先写注释理由再 `--update`），以及 `troubleshooting.md` 新增的「缓存与失效问题」章节：lint 报粒度回退、操作后不刷新、改一条数据整屏重拉、回填导致菜单勾选被清空或明文泄露四个症状的定位路径。

### Changed

#### skill 规则改为单一来源，SKILL.md 只做路由

同一条规则此前散落在 `SKILL.md` 自检清单、`constraints.md` 约束条目、`crud-*.md` 展开说明三处，改一处必然漏掉另外两处——这正是 v1.24.0 收敛 `AGENTS.md`、v1.27.0 收敛文档站前端页时反复遇到的同一类问题，只是这次发生在 skill 内部。现固定分工并写进 `SKILL.md` 顶部：

- `SKILL.md`（152 → 133 行）只做场景识别、Step 编排、验收动作与文件路由。三个 ⚠️ 提示块由复述改为三条一句话约束加指针；27 条自检清单换成 7 条验收动作 + 「按 `constraints.md` 分层逐组对照」——约束条目本身就是核对项，没有必要再改写一遍
- `constraints.md` 只写一句话可机械核对的「必须 / 禁止」。搜索栏布局、页面级多 Tab、弹窗表单、左右分栏、缓存契约等条目压缩为断言 + 指针，`labelWidth` 取值、高度链写法等交还 `crud-frontend.md`
- `crud-*.md` 是代码写法与展开说明的唯一存放处。`constraints.md` 里 14 行的 `NavListPanel` 组件 API 属于模板内容，移入 `crud-frontend.md` 新增的「左侧平铺列表」小节

#### skill 不再记录规范变迁

skill 是「当前该怎么写」的单一来源，规范演进属于 changelog 的职责。逐条改写读起来像迁移说明的表述：「路由不再逐条注册到 `src/index.ts`」改为直接陈述挂载点在域 barrel；重构统计（「曾在 165 个文件里复制 513 次」）从约束条目中删除；「已删除的 `/types`、`/validation`…」改为陈述 `exports` 当前只暴露域子路径与 `/seed`。

#### 文档站按同一分工更新引用

`docs/frontend/data-fetching.md` 的缓存契约正文改为引用 skill，只保留分层结构、基建 API 与页面写法。`docs/frontend/ui-conventions.md` 的规范索引表按新分工重写——查约束去 `constraints.md`，查写法去 `crud-frontend.md`，并补上缓存契约与左侧平铺列表两行。skill 内部链接与锚点已全量校验。

### Fixed

- `constraints.md` 中两条 Step 8 约束因换行丢失被粘连在同一行，后一条「ConfigurableTable 刷新按钮」在渲染后并入前一条正文，不再是独立可核对条目
- `module-modification.md` 的「多对一关联」场景仍在指导用 `useEffect` 加载关联下拉数据，与项目的数据获取规范直接冲突；已改为复用所有者域的共享 lookup hook

---

## v1.28.0 - 2026-07-31

缓存一致性版本：把前端「mutation 一律失效整个域」的写法，按每个写操作的**真实副作用**重建模型。**无业务功能变更**，服务端 1568 项、前端 460 项测试全部通过，另有 11 个写操作场景的真实浏览器验证。

起因是一次实测：全仓 716 处 `invalidateQueries` 里有 525 处广播 `xxxKeys.all`，而 140 个 key factory 早已定义了 `lists`、94 个定义了 `detail(id)` —— 粒度基础设施建好了却没被使用。

### Changed

#### 缓存一致性契约（`.agents/skills/zenith/`）

原规范要求 mutation 的 `onSuccess` 一律 `invalidateQueries(xxxKeys.all)`，CRUD 模板也照此生成，等于把「把同根下详情、统计、日志、下拉源一并打掉」批量复制到每个新模块。经 positions 与 cron-jobs 两个试点验证后替换为按副作用建模的契约，同步更新 `SKILL.md` 自检清单、`constraints.md` 硬约束、`crud-frontend.md` 模板与文档站 `data-fetching.md`。

判据是「**有没有已挂载的查询读了这次被改动的状态**」，而不是接口像不像命令 —— 手动执行 cron 任务只返回一句提示文案，却会改写 lastRun、写执行日志、变更概览统计。

两条推论来自 `invalidateQueries` 的真实语义（默认只立即重拉活跃查询，未挂载的仅标脏）：失效**未挂载**的缓存代价接近零，该失效的别漏；真正的浪费是打掉与本次改动无关、却正好同屏挂载的查询。

#### 20 个业务域按副作用收敛（广播失效 525 → 377）

- **静态下拉源不再被写操作连坐**：cron-jobs 的 `handlers`（5 分钟 staleTime，长期挂载）此前每次增删改跑都被打回源；chat 域单根 `['chat']` 下压着常用语、自定义表情、组织架构、用户搜索四个 lookup；file-storage 保存配置会重新拉取整个目录浏览结果；identity-providers 保存身份源会重拉租户下拉；payment-sharing 新增分账单会重拉分账方名单
- **昂贵的派生查询受保护**：report-dashboards 的 `dashboardData`（一屏可能扇出数十个数据集查询）与列表同根，「收藏一个看板」会把整屏图表全部重跑；report-datasets 的 `metaTables` / `metaColumns` 是数据库元数据，与数据集增删改毫无关系；cms 互动问卷的答卷聚合分析（stats / cross / trend）不该因改问卷定义而重算
- **跨域藏键归还所有者域**：公告收件人选项、数据脱敏豁免角色两处拉的都是 `/api/roles/all`，却分别以 `announcementKeys` / `dataMaskKeys` 为键 —— 角色被增删改后没有任何来源会失效它们，会静默显示旧列表。改为复用 `useAllRoles` / `useFlatDepartments`
- **消除空转**：`xxxKeys.all` 是 `detail(id)` 的前缀，channels 有 5 处、report-dashboards 有 4 处「先 `.all` 再补具体键」，后补的调用完全不产生额外效果
- **删除改用 `removeQueries`**：实体已不存在，失效会让仍缓存的详情去请求一个必然 404 的资源

#### key 结构修正

- `workflowMonitorKeys.all` 实为 `['workflow']` —— 整个工作流域根，覆盖 definitions / instances / tasks / forms / connectors 等 17 个 key factory，是全仓最大的连坐面。按 monitor / jobs / compensations 子树重新建模，任务交接改为显式列出跨文件依赖而非靠广播兜底
- chat 域的群成员与入群申请原先嵌在 `['chat','conversations',id,...]` 之下，使得「刷新会话列表」这一意图会因前缀匹配连带打掉每个会话的成员名单。改挂独立命名空间
- 新增 `detailOf(id)` / `dataOf(id)` / `lookupPrefix` 等前缀键，让「某看板的全部模式详情」「某看板的全部取数」这类意图可被精确表达

#### 回填前必须核对数据形状

只有写接口与详情接口同源（服务端同一个 `mapXxx`）时才能 `setQueryData` 回填。实践中有四个域**不能**回填：announcements（详情多 recipients / attachments）、roles（写接口不带 menuIds，回填会清空菜单勾选）、departments（树与扁平列表含聚合字段）、以及 **users —— 写接口返回未脱敏数据，详情接口按查看者角色脱敏，回填会把明文手机号与邮箱写进本不该展示它们的界面**。测试对此加了断言。

### Added

- `packages/web/src/test-utils/query-harness.ts`：缓存行为观测工具。`ApiRecorder` 记录并桩化请求，`observeFetches` 基于 query-core 的 fetch action 精确区分「真的重拉」与「只是被标脏」，配套 `isFresh` / `isInvalidated` / `hasCacheEntry` 缓存断言
- 55 项域 hooks 行为测试（positions / cron-jobs / announcements / channels / chat / roles / departments / report-dashboards / users / lookup 连坐批次）。断言一律落在实际请求数、进入 fetching 的查询与缓存内容上 —— 只 spy「调用了 `invalidateQueries(某 key)`」在旧的冗余写法和被改坏的新写法下都会通过，等于没测
- `packages/web/scripts/check-invalidation-baseline.mjs`：防回潮护栏，已接入 `npm run lint`。刻意不做全仓 `.all` 禁令（`.all` 在批量覆盖、切租户等场景合法，页面的 `handleSearch` / `handleReset` 也必须失效 `lists`），改为按作用域精确识别 mutation `onSuccess` 内的广播，基线只减不增

### Fixed

- **聊天页群主判定使用过期数据**：ChatPage 把群成员镜像成本地 `useState`、只在切换会话时手工拉一次，而 GroupMembersPanel 用的是 Query 缓存。同一份服务端状态存在两份副本，成员类 mutation 只刷新面板那份 —— 转让群主后页面仍按旧数据判断操作权限。改为共享 `useChatGroupMembers`，顺带减少一次重复请求
- **岗位/角色列表的成员统计陈旧**：分配成员后列表的 `userCount` / `userPreview` 列需要回源，收敛过程中据此补齐（这类欠失效比多失效更危险）
- **标记公告已读不刷新已读统计**：管理端的已读统计此前没有任何来源会失效它
- **个人 AI Key 保存波及整个供应商域**：收窄为只失效聊天可选模型
- CMS 内容审核种子的非法流程变量类型；系统配置放行冒号命名空间键名、json 类型改用 JSON 编辑器；深色模式下 JsonViewer 光标不可见；db-admin 的 EXPLAIN 原始 JSON 视图补上 `readOnly`

---

## v1.27.0 - 2026-07-31

代码去重版本：用 jscpd 全量扫描后，把跨包重复的逻辑与组件收敛为共享模块，并顺带修掉「测试超时」这一长期误报。**无业务功能变更**，服务端 1568 项、前端 410 项测试全部通过（首次实现 `npm test` 零失败）。

### Changed

#### 服务端逻辑去重

- **`jsonDepth` / `jsonByteLength`**：分别有 4 份和 2 份副本（`shared/core/validation.ts`、`server/lib/dtos/analytics.ts`、`server/lib/dtos/frontend-errors.ts`、`server/services/analytics/analytics-server-events.service.ts`）。这三处对「用户可控自由 JSON」做同一套体积/深度限制，口径一旦分叉就会出现「客户端放行、服务端静默丢弃」的丢数据。收敛为 `packages/shared/src/core/json-shape.ts` 单一来源
- **Aho-Corasick 自动机**：敏感词过滤、易错词替换、编辑器词库检查三个 service 各复制了一份完整实现（构建 + fail 指针 + 扫描 + 重叠区间剔除 + TTL 缓存）。收敛为 `packages/server/src/lib/aho-corasick.ts` 泛型实现，载荷类型由调用方决定；顺带补齐两处原实现缺失的行为：并发读取共享同一次加载（避免缓存失效瞬间的重复查库）、加载失败不写入缓存
- **AI 流式适配器脚手架**：OpenAI 兼容 / Anthropic / Gemini 三个适配器的差异只在「请求怎么拼、chunk 怎么解」，而中断控制、空闲超时、SSE 分帧、错误信息提取、token 兜底估算五段完全一致且各存一份。抽出 `packages/server/src/lib/ai/adapters/_stream-kit.ts`，三个适配器合计减少约 200 行
- **CMS 主题公共件**：`default` 与 `docs` 两套主题重复了 SEO `<head>`（TDK + Open Graph + Twitter Card + JSON-LD）、暗色主题脚本、埋点 beacon、分页与面包屑。抽出 `packages/server/src/cms/themes/_shared.tsx`；此前新增 SEO 字段只有一套主题吃得到

#### 前端组件去重

- **搜索工具栏按钮**：「查询 / 重置 / 新增」三个按钮的 `type`、图标与图标尺寸在 165 个文件里逐字复制了 513 次，改一次视觉要动几百处。抽出 `packages/web/src/components/toolbar-controls.tsx` 的 `SearchButton` / `ResetButton` / `CreateButton`，经 codemod 全量迁移；复审后又补齐 48 个文件里 64 处「同 type + 同图标、仅文案不同」的调用点（用 `children` 覆盖文案）
  - 新增 `RefreshButton`：与 `ResetButton` 视觉相同但语义是「重新拉取数据」而非「清空筛选条件」，拆成两个组件避免将来只想调整其中一个时被同一次改动误伤
  - 刻意保留两类原生 `Button`：仅仅复用了同一图标的独立操作（「测试发送」「生成链接」「发起分账」等 25 处）、视觉本就不同的写法（`theme="borderless"` / `size="small"` / 其他图标，9 处）。判据是「将来改『新增』按钮的图标，该不该连带改掉它」
- **单图上传字段**：渠道自动回复与消息模板两个抽屉里各有两份完全相同的「预览 + 悬浮删除 + 上传」组合，连上传地址、鉴权头、响应取值都各自复制。抽出 `packages/web/src/components/ImageUploadField.tsx`

#### 文档与 skill 单一来源治理

- zenith skill 的前端模板仍在教被本次重构掉的旧按钮写法，导入块还留着已失效的 `Button` / `RotateCcw` / `Plus`——照模板生成的下一个 CRUD 页会立刻把重复代码写回来。已同步模板，并在 `constraints.md` 新增「搜索栏公共按钮」「单图上传字段」两条 Step 8 约束
- 文档站前端模块把 skill 的硬性约束又抄了一份并已产生漂移：`docs/ai/skills.md` 写「删除使用 `Popconfirm` 二次确认」而实际代码用 `Modal.confirm`，skill 文件清单漏了 `async-tasks.md`。按 v1.24.0 处理 `AGENTS.md` 的同一思路收敛——`docs/frontend/ui-conventions.md` 从 273 行精简到 30 行，只保留「规范索引 + 指向 skill 的链接」与 skill 未覆盖的**页面设计原则**（取向判断，不适合写成机械条目）；`docs/frontend/components.md` 保留组件 Props 与用法示例，摘掉三处重复的「必须 / 统一」条目
- `docs/frontend/` 的 `auth-request` / `routing` / `file-preview` / `data-fetching` 四页与 skill 无重叠，未改动

### Added

- `packages/server/src/lib/aho-corasick.test.ts`（13 项）与 `packages/server/src/lib/ai/adapters/_stream-kit.test.ts`（20 项）：为两个新共享模块补齐单测，覆盖 fail 链命中、码点级区间（emoji 不错位）、重叠剔除、TTL 与并发共享加载、SSE 跨块分帧、中断与空闲超时的静默/报错分流、token 兜底估算
- `docs/frontend/components.md` 新增 `toolbar-controls` 章节（四个组件的视觉与默认文案对照表、`children` 覆盖用法、什么时候不该用）

### Fixed

- **测试超时误报**：`npm test` 长期有 3 个用例报 `Test timed out in 5000ms`，看似 flake，实测是稳定超标而非卡死——vitest 默认 5s 低于用例本身的工作量：FilterBar 移动端筛选抽屉 11.5s（jsdom 渲染 Semi `SideSheet` + userEvent 跑完展开→重置→输入→应用全链路）、`openapi-doc` 逐 DTO 生成 6.2s、汇总生成 5.2s（后者此前偶尔通过纯属侥幸，v1.25.0 的发布说明也记录过同一用例卡在超时边界）。这三个都是有价值的回归护栏（Swagger 递归 schema 栈溢出防线、移动端筛选交互），不应删除，改为按实际耗时给足余量：web 全局 `testTimeout` / `hookTimeout` 提到 15s，FilterBar 与两个 `openapi-doc` 用例显式 30s；server 全局仍保持默认 5s，让真正卡死的 node 用例继续快速失败

---

## v1.26.0 - 2026-07-31

工程配置精简版本：移除 v1.25.0 引入的值环检测脚本，并移除两个在无 Redis 环境下会产生未捕获拒绝的应用级测试。**无业务功能变更**。

### Removed

#### 值环检测脚本

- 移除 `scripts/check-value-cycles.mjs` 及 `npm run lint:cycles`，`npm run lint` 恢复为仅运行三个包的 eslint
- 该检测所防范的问题本身依然存在，改由规范约束：**供跨域 `z.enum()` 使用的常量数组必须放在域的 `constants.ts`**，不得留在 `validation.ts`（否则 validation 之间互相引用会形成 ESM 值环，初始化期取到 `undefined` 直接崩溃）。相关约束已写入 `AGENTS.md` 与 zenith skill；需要排查环路时可用 `npx madge --circular --extensions ts packages/shared/src`，但要注意它不区分 `import` 与 `import type`，只有值导入构成的环才有害

#### 应用级测试

- 移除 `src/app.routes.test.ts`（路由表快照）与 `src/app.auth-invariants.test.ts`（认证不变量），连同 77KB 的路由快照文件
- 两者都会构造完整 app，从而触发 `middleware/rate-limit.ts` 在模块加载期执行 `redis.script('LOAD')`。该调用未接 `.catch()`，在没有 Redis 的环境（如 CI）中会在 ioredis 重试 20 次后抛出无人捕获的 `MaxRetriesPerRequestError` —— 测试本身全部通过，但 vitest 因未捕获拒绝而判定失败
  - 该问题自 v1.24.0 引入这两个测试起就已存在，v1.24.0 的 CI 通过属于时序侥幸：未捕获拒绝需约 20~30 秒才浮现，套件更早跑完则不会被 vitest 捕获。v1.25.0 因拆分改变了测试耗时而暴露
  - 移除后，模拟无 Redis 环境的全量服务端测试为 178 通过 / 0 错误（此前 5 个未捕获错误）

### Changed

- zenith skill 与 `crud-backend.md` 中「改完路由挂载后更新快照」的指引，改为「执行 `npm run dev:server` 冒烟验证，并人工确认挂载顺序不会造成路径遮蔽」

---

## v1.25.0 - 2026-07-30

共享层治理版本：`@zenith/shared` 从 4 个巨石文件拆为 18 个业务域 + 独立种子入口，并新增值环门禁。**无业务功能变更**，服务端 1544 项、前端 410 项测试全部通过（拆分前 `openapi-doc` 递归用例卡在 5s 超时边界偶发失败，拆分后耗时下降而稳定通过）。

### Changed

#### 共享层按业务域拆分

- `packages/shared` 此前用 4 个文件承载全部 2728 个导出：`types.ts` 365KB、`seed-data.ts` 357KB、`validation.ts` 307KB、`constants.ts` 78KB。近 300 次提交里 `types.ts` 被改 300 次（100%）、`validation.ts` 255 次、`seed-data.ts` 237 次，而单次改动平均只有 10~100 行——每加一个字段都要先在 37 万字符的文件里定位。服务端早已按 17 个域拆好 `routes` / `services` / `db/schema`，共享层是唯一没有域边界的一层
- 按服务端路由域切出 18 个业务域（`core` / `identity` / `platform` / `messaging` / `workflow` / `payment` / `member` / `report` / `analytics` / `ai` / `chat` / `mp` / `cms` / `open-platform` / `rules` / `ops` / `tasks` / `biz`），每域固定 `types.ts` + `validation.ts` + `constants.ts` + `index.ts`；11 个运行时模块归位（`workflow-formula` → `workflow/formula`、`rule-cell` → `rules/cell`、`cms-link` → `cms/link` 等）
- 种子数据剥离出根入口：只服务 `db/seed.ts` 与 MSW mock，不再进入生产依赖图；`SEED_MENUS` 再按一级目录 ID 段拆为 15 个分片（`seed/menus/system.ts`、`settings.ts`、`workflow.ts`、`cms.ts` …），新增模块只改对应段
- `package.json` 补全 `exports` 子路径映射；域 `index.ts` 刻意不导出 seed
- 消费方 1313 个文件 / 1580 条 import 改写为域子路径，旧巨石文件与过渡 shim 全部删除
- 枚举改为以 `constants.ts` 为唯一来源：常量数组 + 派生 union type + `XXX_LABELS` / `XXX_OPTIONS` 一并定义，`validation.ts` 只做 `z.enum(XXX_TYPES)` 引用

> **成果**：共享层由 16 个文件变为 110 个，最大单文件从 365KB 降至 92.7KB，超过 100KB 的文件为 0；根入口导入 1583 → 1（仅保留元编程全量扫描一处），域子路径导入 3 → 1899；2727 个符号全部归类，0 未归类。

### Added

#### 依赖方向门禁

- 新增 `scripts/check-value-cycles.mjs`（`npm run lint:cycles`，已并入 `npm run lint`）：只拦截会触发 ESM 初始化期 TDZ 的**值环**，`import type` 形成的类型环运行时无害不报。`madge --circular` 不区分二者——拆分后它报的 5 个环里 4 个是 type-only，照单全消会白做 80% 的功
  - 该检测的必要性由实际事故确认：拆分过程中 `mp/validation` 与 `messaging/validation` 形成值环（`MP_CUSTOM_MSG_TYPES` 供 messaging 的 `z.enum()` 使用），初始化期取到 `undefined`，一次崩掉 133 个测试文件；修复即「枚举 SSOT 归 constants」。随后它又当场拦下了拆分 `SEED_MENUS` 时引入的 15 个环（分片 → 聚合器 → 分片），`SEED_DATE` 因此独立为 `seed/_base.ts`
- ESLint 禁用 `@zenith/shared` 根入口及四条已删除的旧巨石路径（server + web 双端）。唯一豁免是 `update-schema-defaults.test.ts` 对所有 `update*Schema` 的全量扫描

### Docs

- `AGENTS.md` 与 zenith skill 同步域化约定：CRUD 各步的写入路径改为 `packages/shared/src/{业务域}/`，新增「域子路径导入」「枚举 SSOT 在 constants」「新增域需建 `index.ts` 并登记 `exports`」三条约束与对应自检项
- 复查修正 skill 中 7 处会误导代码生成的残留，其中 2 处会直接产出编译不过的代码：域 hooks 模板把 `PaginatedResponse`（属 `core` 域）与实体类型写在同一条业务域导入；路由模板注释仍示范已被 ESLint 拦截的根入口写法
- `troubleshooting.md`「共享包类型找不到」由 tsconfig paths 排错改写为域子路径 / `exports` 登记排错，并新增 `z.enum()` 取到 `undefined`（值环 / TDZ）的排查条目
- `seed-config.md` 补入 15 个菜单分片的段位对照表，说明分片内 `SEED_DATE` 必须从 `../_base` 导入，以及新增 seed 分片需在 `seed/index.ts` 注册

---

## v1.24.0 - 2026-07-30

服务端启动文件治理版本：按业务域拆解 786 行的 `index.ts`，抽出纯函数 `createApp()`。**运行时行为经逐条比对证明零变化**，无业务功能变更。

### Changed

#### 应用装配与路由

- `src/index.ts` 此前把应用装配、路由挂载、启动编排挤在一起（776 行 / 296 个 import / 236 个 `app.route()`），带来四个问题：任何域新增端点都要改这唯一的公共文件（合并冲突高发）；顶层就有 `serve()` 导致 app 无法在测试中构造（250 个路由文件里仅 2 个有测试的根因）；`/api/analytics` 挂 4 次、`/api/ai/conversations` 挂 3 次，挂载顺序只能靠人肉连读 236 行；整个应用图无条件全量加载
- 新增 `src/routes/_kit.ts` 定义域契约。`fallback` 槽把「CMS 前台 SSR 必须最后挂载」这条隐式约束变成结构约束，不再依赖注释与行号
- 17 个业务域各自在 `src/routes/{业务域}/index.ts` 声明挂载清单（域内保序），`src/routes/index.ts` 只声明域顺序
- 抽出 `src/app.ts` 的 `createApp()`：纯函数，不启动服务器、不注册 worker、不订阅事件、不启动采样器
- 抽出 `src/bootstrap/workers.ts`（后台 worker 注册）与 `src/bootstrap/subscribers.ts`（事件总线订阅者）
- `src/index.ts` 收缩为 71 行启动编排

> **等价性验证**：新旧两版 app 在同一进程构造，逐 `method + path` 比对 handler 函数引用——路由表 7456 = 7456 条，唯一 `(method, path)` 1892 = 1892，handler 数量不一致 0 处，1874/1892 的引用序列完全一致；余下 18 条全部是工厂/闭包产物（ws ×3、`public/cms` ×10、文档路由 ×3、`GET /*`、`ALL /*`）。中间件块位置一致，表尾一致（CMS 兜底仍在最后），通配/参数模式集合 696 = 696。

### Added

- `src/app.routes.test.ts`：域装配清单 + 路由表双快照，锁定域顺序与域内挂载顺序；另断言兜底挂载在最后、全局中间件在最前、同路径重复挂载需显式登记
- `src/app.auth-invariants.test.ts`：遍历全部 1843 个 OpenAPI 操作，断言匿名可访问的写接口必须登记在白名单（当前 17 条，均为认证入口与公开支付页）。新增公开写接口会让测试失败，强制走 review

### Docs

- 同步路由装配重构后失效的指引：CRUD Step 7「注册路由」、异步任务 handler 注册位置、全局 `onError` 与中间件栈位置、Swagger/404 排错清单
- `AGENTS.md` 改为纯导航文档（302 → 184 行）。此前它与 `.agents/skills/zenith/` 各写一份开发规范，已产生实际危害：同一条「注册路由」指引重构后两处同时失效；「页面布局规范」在教 skill 明令禁止的旧写法（`SearchToolbar` 只演示 children 写法、操作列手写 `Space`+`Button`）；清单类内容早已过期（mocks 目录树列 ~40 个文件，实际 127 handlers + 66 data）。现规范单一来源归 skill，`AGENTS.md` 只保留项目导航与 skill 未覆盖的子系统事实，并新增「动手改代码前必读 `constraints.md`」的强制指令——用指令替代复制，堵住「skill 按场景触发、规范却对所有改动适用」的缺口

---

## v1.23.0 - 2026-07-30

数据库迁移链治理版本：将 116 条迁移压缩为单条基线，并移除挂在启动路径上的历史数据补齐逻辑。无业务功能变更。

### Changed

#### 迁移链与启动路径

- 历史数据补齐逻辑此前以顶层 `await` 挂在 `src/index.ts` 启动路径上，每次启动都要全表重扫 12 张表并开启 2 个写事务，且发生在 `serve()` 之前——一次数据库抖动即导致进程永远起不来，多副本滚动发布时还会并发写同一批行。经核查 4 个 backfill 均只服务于历史数据，新建路径已自洽，故全部移除：
  - `backfillLegacyDashboardLifecycle` —— 仪表盘建/改时已写入 `lifecycleInitialized: true`
  - `migrateLegacyReportSecrets` —— `prepareReportSecret()` 写入即 `encryptField()` 加密
  - `backfillLegacyReportTenants` —— 建时已调用 `reportCreateTenantId()`
  - `invalidateLegacyOAuthTokens` —— 新 token 必有 `familyId`
- 116 条迁移压缩为单条基线（338 张表），`drizzle/` 由 233 文件 / 134.1 MB 降至 5 文件 / 3.50 MB
- 移除 `migrate.ts` 中仅为存量库服务的 `adoptBaseline()` 基线收养机制（旧链检查点校验与 `UNIQUE USING INDEX` 差异对齐），文件由 92 行降至 35 行
- 新增 `0001_extensions.sql` 保留两处无法由 `drizzle-kit generate` 重新生成的手写 DDL：`pg_trgm` 扩展与 `cms_contents_title_trgm_idx`（`gin_trgm_ops` 不在 Drizzle 索引 DSL 表达范围内）、`vector` 扩展与 `ai_kb_chunks.embedding_vec`（条件启用，该列不进入 Drizzle schema）

### Fixed

- `db/migrate.ts` 补充 `try/catch` 并以非零码退出，使 `migrate && start` 链路能够阻断服务带着半迁移状态启动；此前迁移异常表现为进程静默退出，排查方向易被误导
- 修复分析事件查询使用位置式 `GROUP BY`（`ad49b3cc`）
- 修复终端设置面板缺少底部内边距（`bdd52c5f`）
- 面包屑显示偏好默认改为关闭（`86c5da08`）

> ⚠️ **升级提示**：本版本不保留向后数据兼容。迁移链已重建基线，存量数据库无法从旧链平滑升级，需重新初始化数据库（`npm run db:migrate && npm run db:seed`）。

---

## v1.22.0 - 2026-07-30

依赖升级维护版本：全量刷新 36 个依赖（含 8 个跨大版本），并修复随之而来的破坏性变更。无业务功能变更。

### Changed

#### 依赖升级

- **后端**：hono 4.12.32、@hono/zod-openapi 1.5.1、@hono/node-server 2.0.12、@hono/node-ws 1.3.1、@hono/otel 1.1.2、pg-boss 12.26.3、mysql2 3.23.2、mssql 12.7.0、nodemailer 9.0.3、@aws-sdk/* 3.1098.0、@azure/storage-blob 12.33.0、@alicloud/dysmsapi20170525 4.6.0、dockerode 5.0.1
- **前端**：@douyinfe/semi-ui 与 semi-illustrations 2.101.1、lucide-react 1.28.0、react-router-dom 7.18.2、@visactor/react-vchart 2.1.4、@tanstack/react-virtual 3.14.9、react-grid-layout 2.2.4、react 与 react-dom 19.2.8
- **跨大版本**：cos-nodejs-sdk-v5 2→3、ldapts 8→9、web-vitals 4→6、source-map 0.7→0.8、@opentelemetry/sdk-node 与 exporter-trace-otlp-http 0.220→0.221、@testing-library/jest-dom 6→7、react-resizable-panels 3→4、electron 42→43
- **工具链**：eslint 10.8.0、typescript-eslint 8.65.0、@vitest/coverage-v8 4.1.10、tsx 4.23.1、electron-builder 26.15.3、wait-on 9.1.0、concurrently 10.0.4

> jest-dom 7、ldapts 9、electron 43 均要求 Node ≥ 22（CI 使用 Node 24）。

#### 终端分屏

- 适配 react-resizable-panels v4 的 API 重命名：`PanelGroup` → `Group`、`PanelResizeHandle` → `Separator`、`direction` → `orientation`，并移除已废弃的 `order` 属性
- v4 起 `minSize` 数字表示像素、字符串表示百分比，分屏最小尺寸改用 `minSize="8"` 以保持原有的 8% 下限；拖拽条高亮样式从 `[data-resize-handle-active]` 迁移到 `[data-separator]`
- Panel 的 `id` / `key` 稳定性保持不变，分屏开合时终端不重建、WebSocket 不断线

### Fixed

- 修复 pg-boss 12.26 起 `getQueueStats()` 返回快照序列（按 `capturedOn` 倒序）而非单个对象，导致系统队列监控取不到队列深度的问题，现取首项作为当前读数
- 同步 `packages/electron/package.json` 与 `electron-builder.config.js` 中滞留在 42.3.3 的 `electronVersion`，与实际 electron 依赖版本保持一致

---

## v1.21.0 - 2026-07-30

CMS 新增结构化页面部件，并补齐 SSR 预览、引用治理、并发控制与批量任务闭环。

### Added

#### 页面部件

- 新增可复用的 `manual-list` 页面部件，数据与样式结构分离：运营维护手工条目或实时引用内容/栏目，可信 TSX renderer 负责输出侧边栏列表、卡片宫格和轮播
- 支持草稿、发布、下线生命周期；页面搭建可插入 `widget-ref`，default/docs 主题可在 `home.sidebar` 绑定已发布部件，动态、混合和静态站点共用同一 SSR 结果
- 新增真实主题首页预览及桌面/平板/手机视口切换；预览文档移除脚本并使用沙箱，避免触发线上统计、广告事件或同源存储副作用
- 新增内容/栏目的页面部件引用诊断，可定位具体部件和条目；栏目诊断同时覆盖通过栏目内容形成的间接引用
- 新增影响页面数与高扇出标记，单个及批量发布前展示预计刷新范围

### Changed

- 草稿保存增加 `expectedRevision` 乐观锁，部件编码创建后不可修改；名称、数据、展示模板和备注变更均推进草稿修订
- 来源连续更新按站点和 5 秒时间桶合并，在桶末按当前全部已发布部件统一刷新页面、首页、Redis 页面缓存与 CDN，避免任务风暴且不丢失后续失效事件
- 批量发布、下线、删除结果区分成功、失败与业务跳过；恢复执行保持幂等，列表在任务结束后自动回源
- 主题插槽绑定拆分为独立 `cms:widget:bind` 权限；站点导入明确提示部件降级为草稿及跳过的主题插槽绑定
- 同一搭建页面包含多个部件时只注入一次公共样式；站点导入结果补齐素材、部件、警告与跳过计数
- Demo 模式同步页面部件 CRUD、修订冲突、来源诊断、主题预览、任务合并和批量结果

### Fixed

- 修复部件删除与新增引用、来源下线与部件发布之间的竞态窗口
- 修复定时过期或批量操作遇到引用保护时结果不明确，以及任务恢复后可能遗漏页面刷新
- 修复父栏目路径变更后，引用子栏目或其内容的部件页面未被刷新

---

## v1.20.0 - 2026-07-29

CMS 互动问卷从「能用」补齐到「够用」：设计器重做、题型扩展、统计重构、前台校验补全。

### Added

#### 互动问卷设计器

- **全屏三步设计器**：此前 14 个表单字段和整个题目设计器都挤在 800px 弹窗里，外层滚动套着题目区 360px 内滚。现拆为「基本信息 / 题目设计 / 参与与展示」三步，弹窗体不滚动、左右两栏各自内滚，右侧常驻前台样式实时预览（≥lg 宽度）
- **复制新建**：`POST /api/cms/interactions/{id}/copy` 克隆配置与题目，标识自动加 `-copy` / `-copy-N` 去重（不会累加成 `-copy-copy`），状态强制草稿、答卷数归零。此前「已有答卷不可替换题目」的 409 提示推荐「复制新建」，但这个功能根本不存在
- **题目模板库**：满意度调查 / NPS / 活动报名 / 体验评分 / 单题投票，一键生成题目骨架
- 题目与选项均可上下移、题目可复制，选项支持行内增删或「批量编辑」按行粘贴；标题自动生成拼音访问标识

#### 题型与问卷能力（迁移 `0114`）

- 新增 **rating（评分，可设 2-10 满分）/ nps（固定 0-10，自动算净推荐值）/ matrix（矩阵）/ date / number** 五种题型
- **「其他 ___」自由填空**（`allow_other` / `other_label`）：答案存 `__other__:自由文本`，统计归入同一桶且原文回传给运营
- **分页问卷**（`page_no`）：前台一页一屏 + 进度与上一页/下一页，页码强制连续
- **条件显示**（`visible_when`）：只能依赖排在前面的单选/多选题；条件未命中的题目服务端既不做必答校验也不落库，避免脏数据混入统计。题目排序/删除/复制后条件引用自动重算，失效即清空

#### 统计分析

- 新增 `GET /{id}/stats/texts`：文本 / 日期 / 数字与「其他」填空的完整答案分页 + 关键词搜索，替代此前只给前 50 条且无法翻页的一次性样本
- 新增 `GET /{id}/stats/cross`：两道单选/多选题的交叉分析
- 新增 `GET /{id}/stats/trend`：按天补齐空缺日期的提交趋势
- 结果面板从单列进度条重构为三个 Tab（题目分布 / 交叉分析 / 提交趋势），矩阵题以行列表格呈现

#### 前台表单

- **断点续答**：填写内容按 `站点:标识` 存 localStorage，刷新后自动恢复（含所在页码）并提示「已恢复上次填写的内容 / 清空重填」，提交成功后清除

### Changed

- **统计聚合下推到 SQL**：旧实现把最多 100000 条 answers 拉进内存后逐题 `.filter()`，复杂度 O(题数 × 答案数)，超过 10 万条直接静默截断、统计悄悄失真。现值直方图、作答人数、数字均值各一条 `GROUP BY`，数组与标量答案由 `LATERAL` 统一摊平，结果规模只与题目/选项数相关，与答卷量无关。评分/NPS 的均值与净推荐值由直方图还原，不再回表扫行
- **答卷可读化**：答卷明细与详情此前只给 `{"12":"opt-3"}` 这样的题目 id + 选项 value，运营看不懂。服务端新增 `answerDetails` 关联题目把选项 value 反查成文案（选项被改名/删除时回退原始 value，不吞内容）；列表新增「作答摘要」列，详情面板按题渲染
- **导出改宽表**：此前把全部答案挤在一个「答案 JSON」单元格，无法做透视。选定单份问卷时按题目展开为一题一列（表头即题干），跨问卷导出题目结构不一致时回退 JSON 单列
- **前台校验前置**：多选的必答与最少/最多选择数、矩阵每行必答、「其他」填空非空、数字题格式此前在浏览器侧完全不校验，全靠服务端 400 + 原生 `alert()`。现改为浏览器先校验并把错误内联渲染到对应题目下，提交失败也不再用 `alert()`
- 答卷明细补「互动问卷」筛选下拉（后端 `interactionId` 早已支持，UI 没暴露）；`kind=poll` 在 UI 层即收敛为单道选择题、隐藏其他题型与分页；「每位会员一次」在参与范围非仅会员时禁选并自动回退
- `slugifyName` 抽到 `utils/slug.ts`，CMS 栏目页一并复用

### Fixed

- **条件显示整条失效**：前台 `esc()` 只转义 `&<>` 未转义引号，`data-cond` 的 JSON 被首个引号截断；选项 `value` 未做字符限制时同样能破坏属性。现统一转义引号，属性与文本上下文都安全
- **分页丢答案**：非当前页的 fieldset 被一并 `disabled`，收集答案时丢掉其他页的作答，提交必然报「必答题」。现改为分页只影响可见性，仅条件未命中才 `disabled`；提交出错时自动翻回出错那一页再高亮
- **选项标识随位置漂移**：选项 id 此前按下标生成（`opt-1`、`opt-2`…），中间插入或排序会整体串位。现改为稳定 id
- 选项重复不再静默去重，改为行内标红提示

---

## v1.19.1 - 2026-07-28

安全修复：部分更新接口会静默改写未提交的字段（[#7](https://github.com/iwangbowen/zenith-admin/issues/7)）。

### Fixed

- **部分更新 schema 不再注入默认值**：Zod 的 `.partial()` **保留** `.default()`，所以 `createXxxSchema.partial()` 在字段省略时反而会主动填入默认值。服务层普遍用 `.set({ ...data })` 写库，于是一次 `PUT { "remark": "x" }` 会静默改写一批根本没提交的字段。四条链路均已实测复现并修复：
  - **角色数据范围提权**：`updateRoleSchema` 注入 `dataScope: 'all'`，把 `dept` / `self` 范围的角色提权为全量可见，且紧接着 `clearUserPermissionCache()` 对所有持有该角色的用户立即生效；同时把已禁用的角色重新启用
  - **身份源停用 + TLS 降级**：`updateTenantIdentityProviderSchema` 注入 `status: 'disabled'`（走该 IdP 的用户登录中断）与 `ldapStartTls: false`（LDAP 降级为明文，bind 凭据裸奔），另有 `jitEnabled` / `defaultRoleIds` / `attributeMapping` 被整体重置
  - **栏目被挂回站点根**：`updateCmsChannelSchema` 注入 `parentId: 0`（`0 ?? x` 结果是 `0`），父栏目权限校验与防环检查一并跳过，并级联改写全部子栏目的公开 URL；`status` 注入还会连带 bump 该栏目下每条内容的 `updated_at`，污染 Headless 增量同步
  - **内容关联被清空**：`updateCmsContentSchema` 注入 `tagIds: []`（JS 里 `[]` 是 truthy），清空全部标签、副栏目与相关内容关联，并重置 `extend` / `isTop` / `isRecommend` / `isHot`

  修法是引入 `partialForUpdate()`：先剥离 `.default()` 再 `.partial()`。默认值只属于**创建**语义——创建时字段缺失需要合理初值，更新时缺失的语义是「别动它」，两者不能共用一份 shape。

### Changed

- 全仓另外 82 个同类 update schema 一并迁移。这批迁移是**类型安全**的：`.partial()` 早已把这些字段在类型上标成 optional，服务层本就必须处理 `undefined`，只有运行时在骗人。其中同样含高危字段的还有 `updateMenuSchema`（`parentId` / `status` / `visible`）、`updateDepartmentSchema`（`parentId`）、`updateFileStorageConfigSchema`（`isDefault`）、`updateWorkflowConnectorSchema`（状态与熔断 / 限流开关）等
- `updateOauthConfigSchema` 保持原样并注明理由：它是**整体替换**语义（表单每次提交全部字段、服务端 upsert 且把 `clientId` / `enabled` 声明为必填），默认值在那里是有意的兜底
- 新增 `update-schema-defaults.test.ts` 全仓守卫：扫描所有导出的 `update*Schema`，断言空对象与单字段输入都不会凭空多出字段。逐个写用例挡不住新增的 schema，例外需在 `FULL_REPLACE_SCHEMAS` 中显式登记并说明理由

---

## v1.19.0 - 2026-07-28

移除 CMS 碎片管理。这不是精简功能，而是纠正一个在当前架构下站不住的抽象。

> **破坏性变更**：碎片功能整体移除——`cms_fragments` 表、`/api/cms/fragments/*` 接口、碎片管理菜单与 `cms:fragment:*` 权限均不再存在；页面搭建的 `fragment` 区块类型一并移除，迁移会清除存量区块及其区块级 ACL。

### Removed

- **CMS 碎片管理**：碎片是「按 `code` 引用的 HTML 字符串袋」。在 in-repo TSX + SSR 架构下，模板在编译期就知道自己有哪些插槽，所以插槽应当被**声明**，而不是靠魔法字符串去猜。主题里其实早有更好的机制——`settingsSchema` 声明式列出可配置项（类型 / label / 分组 / 默认值），后台按 `fieldType` 自动渲染表单，运营看到的就是主题真正支持的东西。相比之下碎片：
  - **后台完全没有可发现性**：主题需要哪些 `code` 只写在 TSX 里，碎片列表既不显示「主题使用中」也不显示「无人引用」。运营建一个不存在的 `code` 不会在任何地方渲染，也没有任何提示
  - **三种类型里 `text` / `image` 与 `settingsSchema` 的 `textarea` / `image` 完全冗余**，仅 `html` 独有
  - **两套机制曾渲染进同一个视觉位置**：`themeConfig.bannerImage` 与 `home-banner` 碎片都输出到 `.fragment-banner` 且前后紧邻，主题作者不得不在字段说明里写「与 home-banner 碎片可并存，横幅在前」——一句话暴露了抽象重叠
  - **成本上也没有优势**：两者都在 `buildBaseContext` 里进入每个页面上下文，改任一个都要整站重建

  移除范围覆盖表与枚举、搭建页区块类型、菜单与权限、路由 / service / DTO / 主题插槽 / 渲染上下文 `fragments` / 素材治理扫描项 / 站点导出段、前端页面与 MSW handler。旧导出包若仍带 `fragments` 段会被直接忽略而非报错。

  后续若需要富文本插槽，正确的做法是给 `settingsSchema` 增加 `richtext` 字段类型，复用已有的净化白名单与编辑器，而不是另起一套无类型的全局字符串表。

### Changed

- 首页横幅归一由 `themeConfig.bannerImage` 承担，CSS 类 `.fragment-banner` 更名 `.home-banner`
- `renderBlocksHtml` 去掉 `ctx` 参数——`fragment` 区块是它唯一的消费方
- 移除 `cms-page-cache.service`：它随碎片发布链路引入，唯一调用方消失后不留死代码，页面缓存前缀回归 `frontend.ts`

---

## v1.18.0 - 2026-07-27

CMS 碎片（模板可引用的后台可编辑区块）的一轮完整改造：先修好「改了不生效」，再按类型重做编辑体验。过程中发现并修复了两个影响面超出碎片本身的安全问题。

> **破坏性变更**：碎片 `json` 类型已移除，存量数据自动降级为 `text`（内容字符串原样保留）。

### Added

#### CMS 碎片

- **改动即时生效**：新增 / 修改 / 删除启用中的碎片会入队一次**站点级重建**并清空该站 dynamic 模式的 Redis 页面缓存。此前四个写入口完全没接发布链路——static 模式永远是旧产物、hybrid 命中旧静态文件、dynamic 最长 10 分钟才过期，「应急公告」「合规文案」这类核心用法根本不成立。只有 `code` / `type` / `status` / `content` 参与渲染，改名称或备注不会触发整站重建
- **按类型分流的编辑控件**：`image` 走媒体库选择（自动登记进站点素材库并归一为 `cms-res://` 句柄，素材替换时碎片同步生效），`text` 为带字数上限的自适应文本域，`html` 提供「源码（Monaco）/ 可视化（富文本）」双模式。切到可视化前若检测到自定义容器或内联样式会先提示——富文本只认自己的文档模型，往返会重排甚至丢弃这些结构
- **实时预览**：编辑弹窗 640 → 1080，左编辑右预览。预览内容由**服务端净化器**产出，展示的是「保存后真正会存下来的样子」（前端复刻白名单必然漂移）；净化结果与输入不一致时明确提示哪些内容将被移除。渲染走 `sandbox=""` 的 iframe，既关掉脚本执行也隔离样式
- **内联样式白名单**：净化器放行 `style`，逐属性限定取值格式（颜色 / 长度 / 枚举词），**有意不放行** `position` / `z-index` / `transform`（可覆盖站点导航做点击劫持）、`url()`、`expression()`、`behavior`、`-moz-binding`

#### CMS 素材中心

- 列表页名称与备注拆为独立两列，上传时间列宽对齐全站日期时间列规范
- 引用弹窗改为表格展示（引用方 / ID / 标题 / 引用字段），支持重新扫描

### Changed

- **移除碎片 `json` 类型**：它没有真正的消费方——主题拿到后只用 `<pre>` 原样展示，seed 里也没有示例，而站点扩展模型（`cms_sites.model_id` + `extend`）已经能承担结构化配置的角色。迁移 `0112` 先把存量 `json` 行降级为 `text` 再重建枚举；导入包里的 `json` 碎片同样降级，而不是让整包导入失败

### Fixed

- **净化器抹掉一切内联样式**：属性白名单是 `'*': ['class']`，`style` 一律丢弃。代价是「所见非所得」——富文本调的字号颜色、碎片里写的渐变横幅，落库时被静默抹掉。本仓 seed 的 `home-banner` 就是典型受害者：任何人在后台打开它点保存，首页横幅当场从渐变卡片变成一段黑字
- **渐变白名单可被绕过**（安全，影响面超出碎片）：`sanitizeCmsHtml` 同时是**会员投稿正文**的唯一过滤器，正文经主题 `dangerouslySetInnerHTML` 输出到公开文章页，前台没有 CSP 兜底。三类绕过已修复并补齐回归测试：① 换行——JS 正则的 `.` 不匹配行终止符，前瞻只扫第一行；② CSS 转义——`\75 rl(` 在浏览器 tokenizer 里等于 `url(`；③ **非 `url()` 的取 URL 函数**——`image-set('https://evil/x.png' 1x)`、`src()`、`image()`、`element()` 都能引用外部资源（实测 Chrome / Edge 会真的发出请求）。现改为**函数白名单**，新增的 CSS 函数默认被拒，不再追着规范补黑名单
- **部分更新夹带默认值**（碎片链路）：Zod 的 `.partial()` 保留 `.default()`，`PUT {"remark":"x"}` 会解析出 `type:'html'` + `status:'enabled'` 并被 `...data` 写库——刻意停用的碎片被静默启用、`text` 碎片被改成 `html`、纯文本正文被按 HTML 重新净化，且被新发布链路立刻推到线上。碎片 schema 改由不带 `.default()` 的基础 shape 派生
- **改备注会破坏排版**：更新时的净化条件把「类型字段存在」当成「类型变了」，导致只改备注也会把已落库正文重洗一遍，内联样式被抹掉

---

## v1.17.0 - 2026-07-26

CMS 面向「内容中台」的两项底座改造：素材由 URL 直存改为 **ID 句柄引用**，以及补齐 **Headless 开放 API**。两者都不保留向后兼容路径，存量数据由迁移一次性归一。

> **破坏性变更**：`cms_contents.cover_thumb` 已移除（改为读取时派生）；所有 CMS 素材字段落库形态由 URL 改为 `cms-res://{id}` 句柄；CMS Webhook 由直接投递改为 outbox 投递；Headless 游标格式改为微秒基准。

### Added

#### CMS 素材引用

- **`cms-res://` 句柄引用**：内容正文、封面、媒体数据、栏目图、页面区块等所有素材位置改为存 `cms-res://{id}` 句柄，写入时归一、读取时解析（批量 + 60s 进程内缓存）。素材替换后全站引用同步生效，不再出现「换了图但正文还指向旧 URL」
- **反向引用索引**：新增 `cms_resource_refs`，在属主自身的写事务内按属主重建。素材治理从「每个素材对 9 张表各做一次全表 `LIKE '%url%'` 扫描」降为一次索引查询，治理任务不再是 O(N×M)
- **素材替换接口**：保留素材 id 直接替换其指向的文件，所有引用点自动跟随；`cms_resources.owns_file` 标记素材是否拥有底层文件，删除自动登记的素材不会连带删掉文件中心里其他模块正在使用的文件
- **统一媒体库**：从文件中心选取的素材自动登记进站点素材库，纳入 CMS 素材治理视野
- **跨站素材接管**：站点导出包含素材库，内容分发到目标站时素材一并接管（`adoptCmsResourcesIntoSite`），源站删除不会让目标站断链

#### CMS Headless 开放 API

- **查询 DSL**：`/api/open/v1/cms/contents` 支持栏目 / 栏目路径 / 标签 / 内容类型 / 关键词 / 作者 / 模型 / 布尔位 / 发布时间区间 / `extend.*` 扩展字段过滤，配合 `sort`、`fields` 裁剪与 `include`（tags/channel/relations/attachments/body/extend）。白名单一律 **fail-closed 返回 400**，不做静默忽略——静默忽略会让调用方误以为过滤生效、拿到比预期更宽的数据集；`extend.*` 额外要求字段在模型中标记为可检索
- **游标翻页**：keyset 推进，深翻不退化为大 offset。时间列按**微秒**比较（PG `timestamp` 是微秒精度、JS `Date` 只到毫秒），`ORDER BY` 强制 `nulls last` 让空值组在两个方向恒在尾部；多字段排序无法用单游标准确表达边界，直接 400 而非静默降级
- **增量同步**：`/cms/contents/sync` 按 `updated_at` 输出变更集，内容与墓碑合并为同一条 keyset 流；彻底删除的行靠新增的 `cms_content_tombstones` 补齐，客户端本地缓存不会残留已删内容
- **受治理的写入**：创建 / 更新 / 提交审核 / 移入回收站，复用后台既有 `createCmsContent` / `updateCmsContent` 管线，版本快照、操作日志、发布 outbox、静态产物、敏感词、编辑锁、素材句柄归一化与引用索引全部自动生效，不另起写路径；更新支持 `expectedVersion` 乐观锁（冲突 409）
- **站点级开放授权（fail-closed）**：新增 `cms_open_app_grants`，持有 `cms:write` 不等于能写任意站点，须在「站点 → 开放授权」显式授权（可再限定栏目白名单）。直接发布要求 `cms:publish` scope + 授权行开关 + 站点内容策略三者同时成立，默认关闭——外部写入一律先落草稿走审核管道
- **内容 Webhook**：由 fire-and-forget 改为**事务性 outbox**，复用开放平台既有投递管线（重试 / 去重 / 自动停用 / 投递日志）。站点级订阅只广播给持有该站点授权的应用

### Changed

- **可见性口径统一**：开放 API 只返回已发布、未回收、未归档、**且所属栏目处于启用状态**的内容。栏目启停会 bump 其下内容的 `updated_at`，让增量同步能把这批上下线变更推给集成方；此前不带 `channel` 参数的站级 feed 会吐出停用栏目的内容，而显式指定该栏目反而 404
- **幂等中间件按调用方分命名空间**：客户端 Token 与自动指纹两种模式的 Redis key 统一按身份（AppKey / userId / IP）哈希，指纹纳入完整 URL（含 query）。此前不同开放应用可读到彼此的缓存响应，而开放 API 的 `siteCode` 恰好就在 query 里

### Fixed

- **`/api/openapi.json` 整份 500**：递归 Zod schema 无限展开导致栈溢出，Swagger 与 SDK 生成全不可用。根因是 `z.lazy(() => z.object({...}))` 每次取值都新建实例，生成器无法通过实例识别环路——新增 `lazyRecursive()` 缓存内部实例，并为嵌套的递归 schema 补注册 refId（两个条件缺一不可）。新增 `openapi-doc.test.ts` 作为回归防线
- **开放网关子路由不进文档**：`open-gateway` 是普通 `Hono`，而 `OpenAPIHono.route()` 只在父子同为 `OpenAPIHono` 时合并子路由的 registry，端点可访问但进不了 `openapi.json`
- **富文本清洗会吞掉素材句柄**：`sanitizeCmsHtml` 的协议白名单不含 `cms-res`，导入 / 物化 / 分发链路会把正文里的图片永久删掉
- **开放授权删除缺站点 ACL**：`DELETE /open-grants/{grantId}` 未校验该授权行所属站点的访问权

---

## v1.16.1 - 2026-07-26

### Fixed

- **详情页归档目录时区错位**：归档目录（`detailPathRule` 的年 / 年月 / 年月日 / 日期串规则）此前用裸 dayjs 按**操作系统本地时区**计算，而后台展示的发布时间走 `APP_TIME_ZONE`（`APP_TIME_ZONE` → `TZ` → `Asia/Shanghai` 兜底）。部署机时区与 `APP_TIME_ZONE` 不一致时（例如容器内 `TZ` 未设置、OS 为 UTC），跨年/跨月边界发布的内容会落进与后台显示不符的目录。现统一走 `APP_TIME_ZONE`，与 `formatDateTime()` 同源
- **归档目录用例随时区漂移**：`cms-urls.test.ts` 的日期夹具改用 `APP_TIME_ZONE` 正午构造，避开任意 runner 时区的日界，使断言与 CI/本地时区无关（该用例此前在 UTC runner 上暴露了上述真实缺陷）

---

## v1.16.0 - 2026-07-26

以 [ChestnutCMS](https://github.com/liweiyi/ChestnutCMS) 为参照做了一轮完整的功能对标与架构瘦身：补齐 12 项经消费方核实的真实缺口，同时**移除发布通道**这一从 ChestnutCMS 直译、在响应式 React SSR 架构下已成负债的机制。

> **破坏性变更**：`cms_publish_channels` 表与 `/api/cms/publish-channels` 接口已移除，站点默认模板配置结构由「按通道分组」拍平为单份（迁移 `0105` 自动 reshape 存量数据）。详见下方「Removed」。

### Added

#### CMS 内容模型

- **站点级扩展模型**：`cms_sites` 新增 `model_id` + `extend`，内容模型补齐**站点 / 栏目 / 内容三级绑定**。站点级运营元数据（备案信息、客服电话、App 下载地址等）不必再塞进无结构的 `settings`，主题上下文通过 `site.extend` 读取；站点编辑页新增「扩展模型」页签，按所选模型动态渲染字段；解绑模型时同步清空 `extend`，不留残余异构字段
- **字段选项支持字典来源**：`select` / `radio` / `checkbox` 三类模型字段的选项新增「系统字典」来源，只填字典编码即可，选项在读取模型时实时解析自 `dict_items`（仅取启用项、按 sort 排序）。字典维护一处，所有引用它的模型字段自动同步

#### CMS 友情链接

- **友链分组**：新建 `cms_friend_link_groups`（名称 + 稳定标识 code + 排序 + 启停），主题按组分块渲染页脚，未分组友链归入默认块、空组不渲染；列表页新增分组筛选与分组列、「分组管理」抽屉；分组删除后组内友链自动转为未分组，不连带删除运营数据；跨站引用防护拒绝把友链挂到别站分组

#### CMS 页面搭建

- **自定义访问路径**：搭建页新增 `path`，可把默认的 `/p/{slug}/` 换成 `/about.html`、`/zh/about/` 等形态。入库前归一为「无前后斜杠、无 `/index.html`」，使 URL 生成、静态产物路径与前台路由查表共用同一个 key；设了自定义路径后 `/p/{slug}/` 返回 302 指向规范 URL，既不产生重复内容、旧链接也不断
- **路径冲突双向拦截**：页面侧拒绝系统保留首段（`p` / `tag` / `interaction` / `search` / `preview` / `api` / `assets`）、`index.html`、站点内重复、以及落在任一栏目路径空间内（含详情页与分页命名空间）；栏目侧对称校验新栏目路径不得等于或成为任一自定义路径的前缀，批量建栏目时遇冲突自动改名而非中途报错

#### CMS 静态化与发布

- **栏目级静态化开关**：栏目可覆盖站点静态化模式（`inherit` / `dynamic` / `hybrid` / `static`），支持把个别高频变动栏目单独切为纯动态
- **详情页目录归档**：栏目可配置详情页产物目录规则（不归档 / 年 / 年月 / 年月日 / `YYYY-MM-DD` / id 取模），控制单目录文件数并改善 SEO 路径语义。日期口径走 dayjs 本地时区，与后台展示的发布时间同源，不会出现错位一天
- **内容附件**：内容支持附件清单（名称 / 大小 / 类型），详情页模板可渲染下载区
- **标题样式**：内容支持标题样式（颜色 / 加粗 / 斜体），列表页与详情页统一生效
- **站点内容策略**：回收站保留天数、已发布内容是否可直接编辑、发布内容时重建列表页数上限等运营开关下沉到站点设置
- **跨栏目复制**：内容操作列「复制到其他栏目」可选本站任意栏目，换栏目时 `modelId` 跟随目标栏目

### Changed

#### CMS 模板解析

- **模板配置降维**：站点 `settings.defaultTemplates` 与栏目 `settings.templates` 去掉发布通道维度，由 `{[通道code]: {...}}` 拍平为 `{list, detail, detailByModel}`；栏目上原本并存的两层模板槽（`listTemplate` / `detailTemplate` 列 + `settings.templates` 的 `list` / `detail`）语义完全重合，收敛为「通用走栏目自身字段、按模型细分走 JSONB」
- **解析链收敛**：列表页 = 试穿 → 栏目 → 站点默认 → 主题默认；详情页 = 试穿 → 内容 → 栏目 `detailByModel` → 栏目 → 站点 `detailByModel` → 站点 → 主题默认
- 站点与栏目编辑页的模板配置去掉通道页签，拍平为单组下拉

#### CMS 静态产物

- **单棵产物树**：静态产物统一落在 `{siteCode}/` 下，不再按发布通道复制 `__{code}/` 子树（实测两棵树的 HTML 逐字节相同）。dynamic 模式 Redis 页面缓存 key 简化为 `cms:page:{siteId}:{path}`
- **内容发布快照**：`CmsContentPublishSnapshot.targets`（按通道分组）降为扁平的 `paths: string[]`

#### CMS 数据分析

- **设备维度取代通道维度**：访问统计与广告事件的「发布通道」分布改为基于 UA 派生的设备类型（PC / 移动 / 爬虫）。原通道维度依赖运营给通道绑定第二个域名才有值，而设备列本就一直可用且更准

### Removed

- **发布通道（publish pipe）**：删除 `cms_publish_channels` 表、`/api/cms/publish-channels` 接口、后台「发布通道」菜单与 `cms:publish-channel:*` 权限（迁移内一并回收菜单，角色绑定经 `role_menus` 外键级联删除）
- **UA 302 互跳**：响应式站点做 PC / 移动双 URL 跳转是 SEO 负面（需 `rel=alternate` + `canonical` 双向配对，且 Googlebot 要以两种 UA 各抓一遍）
- **通道预览段** `/__cms/{site}/__{code}/`
- 广告事件的通道归属推导逻辑、`cms_ad_events.publish_channel_id`、`cms_publish_artifacts.publish_channel_id`、`cms_visit_logs.channel_code`

> **替代方案**：同一站点绑多个域名走 `cms_sites.aliasDomains`；设备差异由响应式主题的 CSS 断点解决（主题 CSS 全量内联在 HTML 中，加断点零额外请求）；确需 PC / 移动两套完全不同的前台时建子站点 + 站群映射分发，子站还可拥有独立的栏目结构。

### Fixed

- **孤儿静态产物清扫**：整站重建引入 mark & sweep，本次未写入的历史产物自动回收（改归档规则、删内容、改栏目路径后残留的死文件）。续跑与取消时明确跳过清扫，避免把前半程的有效产物误判为孤儿
- **失效模板引用自愈**：主题移除模板变体后，站点 `settings.defaultTemplates` 里的历史引用会变成死配置，并因「按合并后完整 settings 校验」连带卡住该站点所有与模板无关的设置写入。保存前自动摘除未改动的失效引用；本次新提交的失效模板名仍抛 400，保留拼写错误的即时反馈
- **模板下拉清空不生效**：站点 settings 深合并会让被清空的项保留旧值（表单提交的是完整状态对象，清空项在请求体里直接消失），`defaultTemplates` 改为整体替换
- **模板覆盖参数错位**：整站重建时发布通道编码被误传进 `templateOverride` 形参（同为 `string`，编译期无感知），实际会去查找名为 `pc` 的模板
- **栏目种子字段遗漏**：`db/seed.ts` 写入栏目时解构漏了 `staticMode` 与 `detailPathRule`，全新 seed 的新闻栏目归档策略会退回数据库默认值
- **模型列表不返回字段**：`GET /api/cms/models/all` 此前不返回 `fields`，导致依赖该接口的下拉无法渲染模型字段

---

## v1.15.0 - 2026-07-25

CMS 编辑体验集中改版：新增**站内链接协议**（内链稳定引用，目标改 slug / 换栏目自动跟随），内容编辑页属性面板改为横向分组页签，栏目管理 / 内容管理 / 素材中心三页统一为**左侧树 + 右侧工作区**的两栏结构。

### Added

#### CMS 站内链接

- **链接协议**：链接字段（内容 `externalLink` / 栏目 `linkUrl`）引入 URI scheme 分层，内链外链共用一列——`entity:content/123`、`entity:channel/45`（站内实体稳定引用）、`internal:/news/`（手填站内路径）、`https://…`（站外原样透传）
- **内部链接选择器**：内容编辑页链接字段右侧新增「内部链接」下拉，可选择站内内容或栏目；输入框下方实时回显解析结果（目标名称 / 站内路径 / 链接已失效）
- **内容选择弹窗**：左侧栏目树定位 + 右侧标题检索，表格展示标题、状态、发布时间，窄屏自动改为上下堆叠
- **服务端解析**：新增 `GET /api/cms/contents/link-target` 供编辑页回显；前台渲染（首页聚合、内容列表区块、栏目页）批量解析内链为真实 URL，目标已删除/下线时降级为不可点，避免指向必然 404 的详情页；站点复制/迁移时同步重写实体链接

#### CMS 内容编辑

- **内容形态选择**：内容列表「新增」改为分段按钮，可直接选择图文 / 图集 / 音视频 / 外链形态进入编辑页
- **SEO 分组**：属性面板新增 SEO 页签（SEO 标题、关键词、描述、社交图 ALT 等）

### Changed

#### CMS 内容编辑页

- **属性面板改版**：右侧属性从 `Collapse` 折叠面板改为横向 `Tabs` 分组（基础信息 / 归属与来源 / SEO / 发布计划 / 高级设置），提交校验失败时自动切到出错分组并高亮提示，避免错误藏在未展开的面板里
- **表单密度统一**：属性面板输入框、下拉、日期选择统一尺寸与栅格，正文编辑区可用高度增加
- **链接型内容**：`contentType=link` 时链接地址输入框直接展示在主编辑区（原先藏在高级设置），并附说明 Banner

#### CMS 后台布局

- **栏目管理**：由「表格 + 抽屉编辑」改为 `MasterDetailLayout` 两栏——左侧栏目树（内置搜索、节点标注单页/外链/隐藏/停用、行内菜单含访问前台/添加子栏目/授权用户/清空栏目/删除），右侧内联编辑区（保存后停留在当前栏目）；批量新增、栏目合并、刷新、访问站点收进左栏「⋯」菜单
- **站点切换器归位**：栏目管理 / 内容管理 / 素材中心的站点选择器统一移到左栏顶部，与其作用范围（左树 + 右侧数据）一致；三页容器改用 `page-container--stretch`，两栏布局自适应视口高度，顶部间距对齐
- **素材中心**：改用 `MasterDetailLayout.Header` / `.Body` 结构，素材筛选与批量操作移到右栏表格上方，孤立扫描 / 清理 / 治理时间范围 / 导出报告移到「素材治理任务」表格上方
- **页面错误边界**：「重新加载 / 返回首页 / 复制错误信息」三个按钮统一为同一填充形态，主次关系改由颜色区分

#### 依赖

- React / React DOM 升至 19.2.8；lucide-react 1.26、monaco-editor 0.56、docx-preview 0.4、dompurify 3.4.12、msw 2.15、vite 8.1.5、eslint 10.8、typescript-eslint 8.65、vitest 4.1.10 等同步升级

### Fixed

- **素材中心窄屏不可用**：窄屏单栏模式下此前只能看到文件夹树、素材列表无法访问，现支持默认进列表 + 「返回」回到文件夹树，选择文件夹自动切到列表
- **内容编辑页栏目下拉**：链接选择弹窗与栏目选择弹窗排除自身，避免选到自己形成跳转死循环

---

## v1.14.0 - 2026-07-25

侧边栏导航体验集中修复：刷新后目录自动展开、选中菜单智能滚动居中、手风琴模式收起完善，并新增页签「复制链接」。

### Added

#### 页签栏

- **复制链接**：页签右键菜单新增「复制链接」，一键复制当前页签的完整 URL（位于「复制名称」与「复制面包屑路径」之间）

### Fixed

#### 侧边栏导航

- **刷新后目录不展开**：修复开启「悬停展开侧边栏」时整页刷新后当前页面所属目录只高亮不展开的问题（展开状态同步不再受折叠态门控，收起态由渲染层统一屏蔽）
- **选中菜单滚动定位**：重写菜单自动滚动逻辑——等待目录展开动画与异步菜单数据布局稳定后再将选中项滚动至容器中部，已在舒适区内则不滚动，解决切换页签时选中项贴边、被 sticky 目录标题遮挡或不滚动的问题
- **手风琴模式收起**：修复点击「首页」等无父目录的顶级菜单时，手风琴模式下已展开目录不自动收起的问题；路径不在菜单树中的页面（如详情页）保持当前展开状态

### Changed

- **README**：功能清单同步至最新（规则中心决策表/名单库、报表中心数据源/仪表盘等），修复多租户小节渲染问题
- **CMS**：清理签名主题包移除后的残留配置项、孤儿策略文件与 Mock 文案

---

## v1.13.0 - 2026-07-24

CMS 渲染架构简化：**移除在线模板子系统（声明式 DSL 模板 + 签名主题包 + 部署生命周期），前台渲染统一为仓库内置 React TSX 主题（React SSR）**。模板由开发者随代码维护，运营侧保留内置主题选择与变体模板下拉。**升级需执行 `npm run db:migrate`（删除 4 张模板/主题包表）与 `npm run db:seed`。**

### Changed

- **前台渲染统一 React SSR**：站点/栏目/内容/搜索/标签/404 等页面全部由内置主题（`default` / `docs`）TSX 组件渲染，移除「DB 模板优先、内置回退」的解析链；栏目/内容引用的失效模板名静默回退主题默认模板
- **站点主题切换回归站点编辑**：站点管理编辑弹窗直接选择内置主题，服务端校验注册表并原子递增 `themeRevision`（发布过期栅栏保留 themeRevision / templateRefsRevision 两级）
- **发布中心目标类型收敛**：移除「模板影响重建」目标（`template`），保留内容/批量内容/栏目/整站/主题影响重建/搭建页面
- 模板健康检查与站点/栏目/内容的模板名校验改为仅对照内置主题注册表

### Removed

- **声明式模板 DSL**：`renderCmsTemplateDsl` 解释器、模板管理页（`/cms/themes`）、模板版本链/回滚/diff/预览/激活 API（`/api/cms/templates/*`）
- **签名主题包**：Ed25519 验签导入、ZIP 安全边界、CSS AST 校验、主题包资源服务（`/api/public/cms/theme-assets/*`）、部署生命周期 API（`/api/cms/themes/*`）
- **数据库表**：`cms_templates`、`cms_template_versions`、`cms_theme_packages`、`cms_theme_deployments`；`cms_publish_artifacts` 移除 `theme_package_id` / `template_id` / `template_version` 列
- 菜单「模板与主题」（14230 段）及 `cms:template:*` / `cms:theme:*` 权限码；相关 shared 类型/校验 schema/常量与 MSW mock

---

## v1.12.0 - 2026-07-24

菜单权限模型重构：**显示与操作解耦**。目录/菜单节点成为纯显示资源，全部权限码（含查询）由按钮型权限点承载；配套完成菜单 ID 分段重编与种子清空重建。**升级需重跑 `npm run db:seed`（菜单及角色/用户/套餐绑定清空重建，用户收藏菜单重置）。**

### Added

#### 权限管理

- **「查询」权限点**：每个页面菜单新增第一个按钮「查询」（`sort: 0`，权限码 `xxx:list`，共 183 个），控制页面数据加载；仅授予「查询」按钮即可开放 API（跨页面下拉、集成场景）而不显示页面
- **授权面板联动**：角色/用户/租户套餐菜单授权面板勾选页面时自动带上其「查询」按钮，并新增解耦规则说明提示

### Changed

- **菜单与权限解耦**：`directory` / `menu` 节点不再携带权限码；勾选按钮不再带出所属页面（用户菜单树排除按钮节点，祖先补全仅从目录/页面节点出发）；授权树改为父子不联动（精确授权）
- **菜单 ID 分段重编**：每个一级目录独占 1000 段（系统管理 1000、系统设置 2000……CMS 内容管理 14000），页面菜单落 10 的倍数槽位、按钮顺延编号，平台独立页占 1–999；角色/套餐种子引用改为结构化推导（`collectMenuSubtreeIds` 等），消除硬编码菜单 ID
- **菜单种子清空重建**：`db:seed` 对菜单及绑定表改为 TRUNCATE 后全量重建，`SEED_MENUS` 成为唯一权威来源；租户套餐菜单白名单自动包含按钮权限点
- **菜单管理页虚拟表格**：改用 Semi 虚拟化树形表格（880+ 节点流畅渲染），表格高度自适应视口，操作列收窄
- **菜单选择弹窗体验**：角色/用户/租户套餐的菜单授权弹窗统一加宽至 640px，菜单树默认折叠（可一键展开全部）
- **菜单表单**：权限标识字段仅按钮类型显示且必填，目录/菜单类型不再填写

### Removed

- 移除过时的 CMS 菜单存量数据迁移（`data-migrations.ts` / `cms-menu-seed.ts` 及相关测试），菜单变更统一走种子清空重建

---

## v1.11.0 - 2026-07-24

CMS 模块全面对标增强：定位为平台级全局内容管理模块（不做 CMS 租户隔离），围绕安全基线、内容与媒体治理、主题模板与发布中心、运营互动、站群继承五个阶段重构。**本版本不保证 CMS 向后兼容，升级需重建 CMS 数据。**

### Added

#### 内容与媒体治理

- **持久化内容锁**：管理员可锁定/解锁内容（权限 `cms:content:lock`），锁定期间禁止编辑、发布、下线、审核、回收、移动、分发、批量标记及定时/工作流/采集变更，并阻止到期自动下线；操作留痕
- **素材文件夹与治理**：素材库支持文件夹树（新增/移动/重命名/删除）、按目录筛选；引用扫描覆盖站点/内容/栏目/碎片/广告/页面/表单/友链等真实引用点；孤儿素材扫描与清理走任务中心（dry-run + 进度 + 取消），治理报告接入导出中心
- **检索词典与热词**：检索词典站点级化，区分扩展词/停用词并支持分组、批量维护；停用词参与分词过滤；热词支持分组管理
- **表单强校验与验证码策略**：表单字段支持长度/格式/正则（RE2 线性时间引擎，杜绝 ReDoS）/数值范围/自定义错误；表单级验证码策略（none/math/Cloudflare Turnstile）
- **社交 SEO**：补齐 Open Graph 完整字段与 Twitter Card

#### 主题模板与发布中心

- **声明式模板 DSL**：版本化、可校验、非可执行的模板 DSL（节点/绑定白名单、深度与体量上限），支持预览、版本对比与回滚，运行时/健康检查/选择器同源解析
- **签名主题包**：主题包仅含 manifest + DSL 模板 + 受限静态资源，Ed25519 签名校验、ZIP 穿越/软链/炸弹防护、CSS AST 校验（禁止外部 `@import`/远程 url），支持导入/校验/预览/激活/回滚/停用/导出，站点作用域资源访问
- **发布中心**：站点/栏目/内容/主题发布统一建模在既有任务中心之上，提供队列、逐路径产物与日志、失败重试、取消、断点续跑与 revision 栅栏；产物/日志接入导出中心

#### 运营与互动

- **广告事件分析**：新增广告曝光/点击明细事件（IP/UA 哈希脱敏），服务端签发一次性签名事件令牌防刷，保留期清理、时间范围筛选与导出
- **会员订阅**：会员可订阅站点/栏目/作者，内容发布后经消息中心去重通知，联动积分与签到；后台可查看订阅明细与聚合
- **页面区块 ACL**：页面搭建支持区块级管理 ACL（用户/角色授权，`cms:page:acl`），前台仅支持非敏感展示条件（always/日期区间静态，member/guest 走动态渲染，敏感内容不静态泄露）
- **统一互动问卷**：合并原问卷与投票为单一互动模型（survey/poll），统一题型、参与范围、重复策略、结果可见性、验证码与结果统计

#### 站群与继承

- **父子站点**：站点支持父子层级（防环、深度上限、子树移动）与站群树视图
- **显式继承与覆盖**：子站点可逐项继承或覆盖 SEO 默认值、静态化/审核模式、Webhook/CDN、主题与模板，密钥不因继承泄露；主题/模板解析扩展为「本站 → 继承父级 → 全局/内置」
- **受治理内容分发**：分发规则（copy/mapping/scheduled + 冲突策略 + 过滤条件），同步走任务中心，保护锁定内容并复用发布管道，结果可查询与导出；支持站群级批量发布

### Changed

- **CMS 改为平台级全局模块**：移除历史 `cms_sites.tenant_id`，站点编码与默认站点全局唯一；站点/栏目采用 fail-closed 数据权限（未显式授权即不可访问，平台超管例外）
- **统一发布副作用与内容状态原子化**：发布/下线/回收/清理与静态刷新、搜索推送、通知通过发布 outbox 与任务中心统一处理
- **敏感配置只写**：站点 Webhook Secret、CDN Token 等改为写时更新/掩码，列表与详情不再回显
- 文件管理器与文件浏览器文件名展示优化（Tooltip、文本溢出处理）；页面错误边界支持一键复制错误信息

### Fixed

- 修复内容详情/版本/操作日志/预览链接的对象级越权，统一站点/栏目授权校验
- 会员投稿与采集内容统一 HTML 白名单净化，站点导入的碎片/页面区块同样净化，杜绝存储型 XSS
- 采集自动发布强制校验发布权限并走标准发布管道
- 站点导入编码校验与静态目录穿越防护；CDN 外呼启用 SSRF 防护与域名白名单
- 公共接口统一使用受信代理 IP 解析，修复 `X-Forwarded-For` 伪造绕过防刷

---

## v1.10.0 - 2026-07-21

CMS 模板机制专项优化：引用完整性、主题参数化、主题变更自动重建与模板试穿预览。

### Added

#### CMS 模板引用校验与主题健康检查

- **写入校验**：站点默认模板（`settings.defaultTemplates`）、栏目列表/详情模板（含按通道覆盖 `settings.templates`）、内容详情模板保存时校验模板名存在于主题注册表，失败返回 400 并附可用模板清单
- **健康检查接口**：`GET /api/cms/sites/{id}/template-health?theme=` 扫描站点/栏目/内容三级失效模板引用（内容级按模板名聚合计数），支持 `?theme=` 预检切换目标主题的影响面
- **前端联动**：站点编辑切换主题时自动清理本地失效的默认模板配置（Toast 告知），「模板与通道」页签 Banner 展示栏目/内容级失效清单
- **渲染回退日志**：模板解析回退默认模板、未注册主题回退 default 时记录去重 warn 日志

#### CMS 主题参数面板（settingsSchema）

- **主题参数声明**：`CmsTheme` 新增 `settingsSchema`，主题声明可配置参数（text/textarea/color/number/switch/select/image 七种字段类型，支持分组、默认值、说明）
- **动态配置表单**：站点编辑「主题与图片」页签按 schema 分组渲染表单（image 复用 CMS 上传管线，color 带取色器），值存 `settings.themeConfig`，select 值服务端校验
- **渲染注入**：渲染上下文 `site.themeConfig` 注入「schema 默认值 ⊕ 站点配置」合并结果（类型宽容解析），模板零缺省处理直接消费
- **default 主题示范参数**：页头联系电话、首页横幅图/跳转链接、热门排行开关、页脚附加文案
- **静态站提醒**：主题参数变更且站点非纯动态时，保存后提示一键提交全站静态化任务

#### CMS 主题代码变更零维护自动检测

- **内容指纹检测**：服务启动时对 `cms/themes` 目录计算 SHA-256 指纹（共享根文件计入所有主题，主题子目录独立），与 `system_configs` 记录对比，变更主题自动提交受影响非 dynamic 站点的静态页重建——无需维护版本号，改完主题代码发版即自动生效
- **新任务类型 `cms-theme-rebuild`**：单任务串行重建多站点，进度按站点推进，任务中心可见可取消
- **安全防护**：首次运行仅登记指纹不触发重建；Redis NX 锁 + 指纹幂等键防多实例重复提交；检测失败仅记日志不阻塞启动

#### CMS 模板试穿预览

- **`?__template=` 试穿参数**：预览路径（`/__cms/...`）渲染支持临时覆盖列表/详情模板（解析链最高优先级），仅预览模式生效、非法模板名静默忽略，不回写静态文件、不写页面缓存，对线上零影响
- **栏目编辑预览按钮**：「全通道通用」列表/详情模板下拉旁一键试穿预览（详情取该栏目最新已发布内容）
- **内容编辑试穿按钮**：「详情模板」下拉旁试穿本文（仅已发布内容；草稿提示走签名预览链接）

### Changed

- **静态化管理整合进站点管理**：「静态化管理」独立菜单下线，功能整合为站点管理操作列「静态化」抽屉（全站生成 + 该站点任务进度 + 访问站点）；菜单 1745 幂等迁移为站点管理下的按钮，权限 `cms:static:build` 与角色绑定保留
- **主题接口**：`GET /api/cms/sites/themes/{code}/settings-schema` 新增主题参数声明查询

---

## v1.9.0 - 2026-07-21

对标 ChestnutCMS 第二轮查缺补漏（P1 评论会员化 → P4 编辑体验增强）。

### Added

#### CMS 评论会员化（P1）

- **会员身份评论**：`cms_comments` 新增 `member_id`，前台评论区检测会员登录态自动切换会员通道（JSON API + 幂等防重），昵称自动取会员资料；游客保持零 JS 原生表单提交，双模式并存
- **我的评论**：会员端新增「我的评论」页（`/api/member/cms/comments`），支持查看审核状态、获赞数、跳转内容页与删除（已审核评论删除同步刷新详情页静态文件）
- **后台评论治理**：评论列表新增来源筛选（会员/游客）与会员徽标展示，前台已审核评论展示「会员」标识

#### CMS 素材中心（P2）

- **站点级素材库**：新表 `cms_resources` + 素材中心页面（权限 `cms:resource:*`），支持图片/视频/音频/文档/其他分类浏览、名称搜索、上传、重命名/备注、批量删除
- **上传管线复用**：图片上传按站点配置执行压缩/水印/缩略图，其他类型原样入库并自动识别分类
- **引用统计**：单素材站内引用扫描（内容封面/正文/形态数据 + 广告图 + 碎片），存在引用时拒绝删除防断链；删除素材联动清理底层物理文件
- **图片在线裁剪**：素材列表拖拽框选裁剪区域（自动映射原图像素坐标），服务端 sharp 裁剪，非破坏另存为新素材

#### CMS 轻量投票（P3）

- **投票管理**：新表 `cms_polls` / `cms_poll_votes`，后台管理页（权限 `cms:poll:*`）支持选项编辑、单选/多选上限、游客开关、发布/结束、实时计票结果
- **正文嵌入**：正文插入 `[投票:标识]` 标记即在内容页嵌入投票组件，前台脚本拉取实时计票，已投/已结束自动展示结果条
- **防重复投票**：会员一人一票（DB 唯一约束）+ 游客一 IP 一票（部分唯一索引），投票事务内原子累计总票数；登录会员走会员 API，游客走公开 API

#### CMS 前台图形验证码（P3）

- **算术验证码**：自研 SVG 算术题验证码（零依赖），答案存 Redis 5 分钟一次性校验（GETDEL 防爆破重放）
- **站点级开关**：站点配置新增「图形验证码」开关，开启后游客提交评论/自定义表单必须完成验证码，登录会员免验证；静态页由前端脚本按需加载题目、点击刷新

#### CMS 编辑体验增强（P4）

- **同站标题查重**：编辑页标题失焦即查重（`GET /api/cms/contents/check-title`），发现重复弹出提示（含重复内容 id），不阻断保存
- **标签分组**：`cms_tags` 新增 `group_name`，标签管理页支持分组维护与展示
- **内容属性自动标记**：保存时按正文/形态数据/封面自动检测「含图/含视频/含附件」，内容列表新增属性图标列一目了然

### Changed

- **CMS 菜单**：新增「素材中心」「投票管理」入口；修复种子菜单 id 1790 重复占用（数据看板改为 1701）
- **前台评论表单**：支持会员登录态自动增强（隐藏昵称输入、显示会员提示），登录过期自动回退游客模式

### Fixed

- **种子数据**：`SEED_MENUS` 中「数据看板」与「易错词库」菜单 id 冲突导致按 id 更新时相互覆盖的问题

---

## v1.8.0 - 2026-07-21

对标 ChestnutCMS 完成 CMS 模块五阶段查缺补漏（P1 内容内核 → P5 企业级治理）。

### Added

#### CMS 内容内核补齐（P1）

- **内容字段增强**：新增副标题、短标题、来源链接、原创标记、责任编辑字段，列表/编辑/详情/静态页全链路支持
- **置顶增强**：置顶权重（数值越大越靠前）+ 置顶到期时间（周期任务自动取消置顶）
- **内容归档**：已发布/已下线内容可归档（`archived_at`），归档内容前台详情保留但不参与列表聚合，独立「已归档」视图，支持批量归档/取消归档
- **复制与站群分发双模式**：内容复制为草稿；站群分发支持「独立复制」与「映射」两种模式——映射内容正文/扩展字段运行时透传来源、源改动即时生效、来源删除时自动物化为独立内容
- **内容操作日志**：新表 `cms_content_op_logs` 记录 12 种动作（创建/更新/提交/发布/驳回/下线/回收/恢复/彻底删除/归档/取消归档/复制），编辑页时间线抽屉展示
- **栏目运维**：栏目合并（内容迁移后删除来源栏目）、清空栏目（内容移入回收站）、批量新增栏目（每行一个名称，slug 自动取拼音、路径冲突自动加序号）
- **易错词库**：新表 `cms_error_prone_words` + 管理页（权限 `cms:word:*`），AC 自动机检查内容正文，一键替换错误词

#### CMS 多形态内容（P2）

- **内容形态**：`content_type` 枚举（图文/图集/音视频/外链）+ `media_data` JSONB 结构化数据，创建后形态不可变更
- **图集内容**：编辑页多图管理（上传/排序/说明），前台九宫格展示 + 灯箱浏览
- **音视频内容**：视频/音频地址 + 封面 + 时长，前台原生播放器
- **外链内容**：列表点击直跳外部地址，发布时校验外链必填
- **正文分页**：正文 `[分页]` 标记拆分多页，静态化逐页生成 `{id}_n.html`，SEO 页码导航 + 越界 404
- **封面缩略图**：打通上传管线缩略图生成，`cover_thumb` 落库，前台列表优先用缩略图

#### CMS 会员互动（P3）

- **点赞/收藏**：新表 `cms_content_likes` / `cms_content_favorites`，计数原子回写冗余列，前台详情页互动条（会员登录态）
- **浏览历史**：新表 `cms_member_view_history`，按会员去重记录、自动裁剪保留最近 100 条
- **会员中心**：前台 SPA 新增「我的收藏」「浏览历史」页
- **积分联动**：会员点赞/收藏/投稿发布联动积分发放（复用 `changePoints` 记账，Redis NX 30 天防重 + 日限额）
- **问卷调查**：新表 `cms_surveys` / `cms_survey_questions` / `cms_survey_answers`，单选/多选/文字题，会员一人一份与匿名 IP 限重双通道，管理页结果统计（权限 `cms:survey:*`）

#### CMS 统计分析（P4）

- **服务端访问埋点**:静态命中/Redis 缓存/SSR 三路全覆盖（预览不计入），新表 `cms_visit_logs`，UV 按 ip+ua 哈希去重，UA 解析设备分类（爬虫独立归类不计入 PV/UV）
- **访问统计看板**：`/cms/stats` 双 Tab（权限 `cms:stat:view`）——PV/UV 趋势、内容 TOP、来源/设备/发布通道分布；搜索分析（搜索趋势、热词榜、无结果词榜）
- **广告曝光统计**：前台曝光 beacon 批量上报，新表 `cms_ad_stats` 日聚合，广告列表新增曝光量与 CTR 列
- **搜索日志**：新表 `cms_search_logs` 记录站内搜索（关键词/结果数/IP），支撑无结果词优化
- **日志保留策略**：访问/搜索日志 90 天自动清理周期任务

#### CMS 企业级治理（P5）

- **栏目级数据权限**：新表 `cms_channel_users`，栏目绑定授权用户后仅授权用户可管理该栏目下内容（列表可见性、增删改、状态流转、批量操作、移动、分发全部受限，按主栏目判定）；未绑定/超管不受限
- **部门数据权限**：`cms_contents` 新增 `dept_id`（创建时快照创建人部门）+ `created_by`，内容列表接入系统数据权限（本部门/含子部门/指定部门/仅本人）
- **站点导入导出**：整站 JSON 打包下载（站点配置/栏目树/标签/内容及关联/碎片/友链/重定向/内链词/广告位/表单/搭建页，不含运行数据）；导入创建新站点，内部 id 全部重映射、站点 code 冲突自动加序号、映射内容自动物化
- **CDN 刷新**：站点配置 purge webhook（地址 + Bearer 令牌）后，增量静态化自动推送变更路径、整站重建推送全站刷新标记，失败仅记日志不阻塞
- **多语言站点关联**：站点配置本站语言与关联语言站点后，前台全页面输出 `hreflang` alternate 标签 + 页头语言切换

### Changed

- **内容列表**：默认排除归档内容；排序规则升级为 置顶 > 置顶权重 > id
- **静态化**：增量刷新与全量重建完成后自动触发 CDN purge（未配置时零开销）

### Fixed

- **统计 IP 兜底**：访问日志 IP 为空时回退 visitorHash，避免来源 TOP 统计漏行
- **Semi 圆角规范**：CMS 新页面内联圆角统一改用 `var(--semi-border-radius-*)` 变量，跟随「圆角大小」偏好

---

## v1.7.0 - 2026-07-20

### Added

#### CMS 模板体系（对标主流 CMS 模板配置能力）

- **主题变体模板**：主题可注册带展示名的变体模板，default 主题内置 `list-card`（卡片网格）、`list-compact`（紧凑标题）、`detail-plain`（简洁正文）；新增 `GET /api/cms/sites/themes/{code}/templates` 模板清单接口，后台下拉动态取
- **站点级默认模板**：站点编辑新增「模板与通道」页签，按发布通道分别配置列表/详情默认模板，支持按内容模型（文章/产品等）细分详情模板
- **栏目级模板配置**：栏目编辑「模板配置」区按「全通道通用 + 各通道」页签配置，每通道支持列表/详情模板 + 按内容模型细分详情模板（存 `settings.templates`，原 `listTemplate`/`detailTemplate` 列降级为全通道通用兜底）
- **内容级模板覆盖**：`cms_contents` 新增 `detail_template` 列，内容编辑页可为单篇内容指定详情模板
- **模板解析链**：内容 → 栏目[通道].按模型 → 栏目[通道] → 栏目通用 → 站点默认[通道].按模型 → 站点默认[通道] → 主题默认，逐级回退

#### CMS 发布通道（用户自建输出端）

- **发布通道实体**：新表 `cms_publish_channels`（名称/编码/独立域名/UA 正则/默认标记），新增「CMS 内容管理 → 发布通道」管理页（权限 `cms:publish-channel:*`），PC/H5/小程序等输出端按站点自由创建；默认通道不可删除/停用
- **通道路由**：非默认通道支持绑定独立域名（Host 精确匹配）；主域名与通道域名按通道 UA 正则 302 互跳（响应带 `Vary: User-Agent`）；预览走 `/__cms/{site}/__{code}/` 前缀
- **静态化多通道**：静态产物按通道逐份生成（默认通道在站点根目录，非默认通道在 `__{code}/` 子树），增量刷新与全量重建全覆盖；dynamic 模式 Redis 页面缓存 key 含通道维度
- **零迁移兼容**：无通道记录的站点自动回退虚拟 PC 默认通道

### Changed

- **站点编辑交互重构**：编辑弹窗改为 SideSheet（宽 720），内容按类型拆分为基础信息 / SEO 与推送 / 审核与 Webhook / 主题与图片 / 模板与通道 / 备案与备注六个页签；必填项校验失败自动跳回基础信息页；补齐缩略图宽度配置项

### Fixed

- **Vite dev 代理**：开发服务器代理补充 `/__cms` 前缀转发，修复本地 CMS 前台预览 404

---

## v1.6.0 - 2026-07-20

### Added

#### CMS 编辑体验（P1）

- **并发编辑保护**：内容乐观锁（`version` 列 + `expectedVersion` 比对，冲突返回 409）+ Redis 编辑软锁（120s TTL / 30s 心跳，编辑页展示「xx 正在编辑」警示）
- **自动保存**：草稿/驳回态内容有改动时每 30s 静默保存，标题栏展示自动保存时间
- **草稿预览链接**：HMAC 签名临时链接（2 小时有效），免登录分享给审核人预览未发布内容，页面注入预览提示条
- **版本差异对比**：历史版本与当前内容字段级 diff 接口 + 前端双栏红绿高亮视图
- **媒体库选择器**：新增 `MediaPickerModal` 组件（文件中心媒资复用 + 就地上传），接入封面图与模型 image/file 字段

#### CMS 内容运营（P2）

- **一文多栏目**：内容可挂多个副栏目（`cms_content_channels`），栏目列表页聚合主/副栏目内容
- **相关文章**：手动关联（`cms_content_relations`）+ 前台详情页「相关阅读」区块，不足按共同标签自动补齐
- **内容过期下线**：`expire_at` 到期自动下线并刷新静态页（与定时发布同一周期任务）
- **评论树形回复与点赞**：两级回复树（前台回复定位）、匿名点赞（IP 24h 去重）、后台展示回复对象与点赞数
- **广告点击统计**：前台点击经计数中转 302 跳转（静态页零 JS 可用），后台展示点击量
- **表单增强**：新提交邮件通知（`notify_email` 多收件人）、提交数据接入导出中心（按表单字段动态列）
- **内容导入导出**：Excel 批量导入（任务中心异步，行级明细 + 断点续跑 + 幂等），内容列表按筛选条件导出

#### CMS 平台化（P3）

- **数据看板**：新增 `/cms/dashboard` 页面（状态分布 / 今日发布 / 累计浏览 / 待审评论 / 14 天发布趋势 / 热文 TOP10 / 栏目分布）
- **Headless 内容 API**：开放网关 `/api/open/v1/cms/{channels,contents,contents/:id}` 只读端点（scope `cms:read`，走签名/计量/限流网关）
- **Webhook 事件外推**：站点配置回调地址后，内容发布/下线/回收事件自动 POST 推送（HMAC 签名 + SSRF 防护）
- **页面搭建升级**：区块原生拖拽排序 + 搭建器内嵌 iframe 实时预览（保存自动刷新）

#### 文档

- 新增 `docs/cms/` 独立文档目录（总览 / 内容管线 / 渲染与静态化 / SEO 与流量 / 全文检索 / 互动与运营 / 开放能力），VitePress 导航与侧栏注册

### Changed

- **敏感词引擎重构**：Aho-Corasick 多模式匹配自动机替换逐词遍历，单次扫描 O(文本长度) 完成全词库匹配
- **浏览计数 Redis 缓冲**：INCR 聚合 + 每分钟批量落库，Redis 不可用自动降级直写，消除高并发行锁排队
- **前台缓存分级**：SSR 响应按页面类型分级 TTL（详情 600s / 首页 300s / 列表 180s）+ 弱 ETag / Cache-Control 协商缓存（304）
- **审计增强**：内容提交/发布/驳回/下线接口补操作前快照，操作日志可见状态流转 diff

### Fixed

- **内链词 XSS**：正文内链替换对 URL 做 HTML 属性转义，防止恶意 URL 注入静态页
- **开放重定向**：301/302 目标地址增加可信校验（仅站内路径或本系统站点域名），写入与解析双重防护
- **定时发布重复执行**：加 Redis 排他锁 + 条件更新兜底，防多实例部署/任务重叠重复发布
- **批量操作原子性**：批量移动/站群分发补事务包裹；标签计数改单条关联子查询，消除 N+1 与并发计数漂移
- **工作流回调竞态**：审核通过回调前复验内容仍为待审状态，防长周期流程覆盖人工操作
- 版本快照裁剪由逐条删除改为单条 DELETE 子查询

---

## v1.5.0 - 2026-07-20

### Added

#### CMS 内容管理（全新模块）

- **多站点站群**：站点 CRUD（域名/别名域名绑定、Host 匹配路由、默认站点兜底）、`/__cms/{code}` 预览前缀、站点级数据权限（`cms_site_users` 授权用户绑定，未绑定/超管不受限）
- **内容体系**：栏目树（列表/单页/外链三类，栏目级模板与 TDK）、内容模型（自定义字段动态表单）、内容全生命周期（草稿→提交审核→发布→下线→回收站，驳回原因留痕）、标签、碎片、友情链接
- **SSR 静态化**：React `renderToStaticMarkup` 主题渲染；三种模式（动态渲染 / 混合推荐 / 全静态），混合模式访问未命中即渲染并原子回写；发布/下线/审核通过自动增量刷新；任务中心全量构建（进度/取消）
- **SEO 全家桶**：站点/栏目/内容三级 TDK 覆盖、canonical、OG 标签、JSON-LD 结构化数据、sitemap.xml、robots.txt、301/302 重定向管理、内链词自动替换、百度普通收录 + IndexNow 主动推送（发布自动推送 + 推送日志）、死链检测（站内查库校验 + 外链探测，任务中心行级明细）
- **全文检索（PostgreSQL 原生，零 ES 依赖）**：jieba 应用层分词 + `tsvector`/GIN + `ts_rank_cd` 排序，标题 `pg_trgm` ILIKE 短词回退；自定义词典（热加载生效）；搜索热词统计（Redis ZSET，前台搜索自动记录）；`CMS_TSVECTOR_CONFIG` 环境变量可切 zhparser 等 PG 解析器；索引重建任务（断点续跑）
- **内容运营**：定时发布（到期自动发布+静态化+推送）、版本快照与回滚、批量移动栏目/批量属性（置顶/推荐/热门）/批量打标、内容复制、站群跨站分发、回收站 30 天自动清理
- **前台互动**：评论（原生 form POST + 蜜罐反垃圾 + IP 限流 + 敏感词过滤，审核通过自动刷新静态页）、自定义表单（栏目绑定，提交数据管理）、广告位/广告投放（时间窗渲染）、敏感词库
- **标签聚合与分发**：`/tag/{slug}/` 标签聚合页（SSR+静态化+sitemap 收录）、站点级与栏目级 RSS 2.0 订阅
- **图片处理管道**：sharp 超宽等比压缩 + 文字水印（九宫格位置/不透明度）+ 缩略图，站点级配置，编辑器与封面上传自动生效
- **主题系统**：代码化 React 主题包（default 企业门户 + docs 文档站双主题）、站点级主题参数（主色覆盖、暗色模式 light/auto/dark 带前台切换按钮）、栏目级扩展模板
- **工作流审核**：站点级审核模式（简单审核 / 工作流审核），工作流模式下提交审核自动发起审批流程（`bizType=cms_content`），通过自动发布+静态化+推送，驳回/撤回自动回写状态；种子流程定义「CMS 内容审核」+ 审批查看组件
- **会员投稿**：前台会员 SPA 投稿页（我的投稿列表/写投稿/驳回原因展示/修改重提），投稿进入统一审核管道，后台内容列表投稿标记；全程 `currentMemberId` 过滤防越权
- **采集中心**：列表页翻页（`{page}` 占位）+ CSS 选择器抽取（标题/正文/摘要/封面）+ 清洗选择器 + 远程图片本地化转存文件中心 + URL 级去重 + 任务中心执行（进度/取消/明细留痕）+ 自动发布可选；`CMS_COLLECT_SSRF_ALLOWLIST` 内网源站白名单
- **可视化页面搭建**：6 类区块（Hero/富文本/图片/内容列表/多列卡片/碎片引用）JSON 装配，`/p/{slug}/` 访问，可接管站点首页，区块搭建器（排序/属性表单/预览），保存自动增量静态化并收录 sitemap
- **行为统计打通**：站点一键开通统计（自动建 analytics 站点），前台页面注入轻量 beacon 采集脚本（page_view 上报），浏览计数改 beacon 模式（静态页也能计数，Redis 60s 去重防刷）

### Changed

- 收件箱消息查看支持上一条/下一条快速切换

### Fixed

- **评论管理页面崩溃**：`cms_comments` 正文列与 RQB 关系名 `content` 同名冲突导致正文被 `{ title }` 对象覆盖，改用 leftJoin 并重命名关系为 `targetContent`
- **CMS 列表页列宽被压缩**：宽表补充 `scroll.x`（Semi Table 缺失时列宽按容器等比压缩），时间列统一对齐 180px 基准
- 支付争议服务日期比较边界（`<=` → `<`）；报表投递/工作流引擎操作时间戳序列化显式转换
- 决策表统计日期参数驱动序列化问题
- zod `.partial()` 后 `.default()` 字段仍注入默认值导致部分更新重置未提交字段（采集规则/搭建页面更新接口）

---

## v1.4.0 - 2026-07-19

### Added

#### 规则中心 · 决策流（新页面）

- **多决策表顺序编排**（DRD 简化版）：步骤按序执行，前序输出并入求值上下文供后续步骤的条件与输入表达式引用；支持步骤前置条件（安全表达式，不满足即跳过）与输出命名空间（防键冲突）
- **决策流生命周期**：草稿/发布/停用；发布时把编辑态步骤固化为运行时快照，并校验引用的决策表均已发布（按「本租户优先、回退平台级」语义解析）；编辑已发布流显示「改动未发布」标记，更新携带乐观锁
- **逐步 Trace 测试**：JSON 输入测试面板展示每步命中/跳过原因/输出与最终合并结果；运行时按 key 求值并为每步写入执行流水（`flow:{key}#n`，记录真实命中策略与该步骤求值时的输入快照）

#### 规则中心 · 名单库（新页面）

- **黑/白/灰名单管理**：名单 CRUD、启停；条目支持标签、备注与**过期时间**（到期自动不命中）
- **条目批量导入**：粘贴多值一键导入（去重、单次上限 500 条）、一键清理过期条目、面板内命中测试
- **运行时命中判定**：`POST /api/rules/lists/check` 租户感知判定（本租户名单优先、回退平台级），供风控/资格判定场景调用

#### 规则中心 · 决策执行记录（新页面）

- **跨表执行流水**：分页 + 按 Key/来源/命中结果/时间范围筛选，详情抽屉展示输入/输出/命中行/流程上下文
- **保留策略**：新增「清理决策执行记录」定时任务（默认保留 90 天），执行流水改为**异步批量落盘**（2 秒/50 条，查询前强制刷盘），降低求值热路径开销

#### 决策表增强

- **运行时快照语义**：运行时/对外求值始终基于**发布版本快照**（支持按版本 pin），编辑态修改不再影响线上；进程内快照缓存（60s TTL，全部变更操作即时失效）；按 key 解析租户感知（本租户优先、回退平台级）
- **条件 DSL 扩展**（前后端 + MSW 单一实现 `@zenith/shared/rule-cell`）：新增 `in`/`not in` 集合、`!=` 不等、FEEL 开闭区间 `[a..b)`、**日期类型**（dayjs 比较/区间）、字符串列**字典绑定**（条件多选生成 in 集合，测试/用例表单联动下拉）
- **输出表达式**：输出单元格支持 `= form.amount * 0.8` 表达式（安全表达式引擎求值，发布门禁静态校验）
- **collect 聚合与未命中回退**：collect 策略支持 sum/min/max/count/distinct/list 聚合；可开启「未命中回退默认值」
- **命中策略语义补齐**：`any` 策略按 DMN 语义校验多命中输出一致性；求值结果新增 `reason`（无命中/唯一命中冲突/输出不一致）并在测试面板展示
- **规则体检静态分析**：unique/any 策略行间重叠检测、first 策略不可达行检测、单数值列未覆盖区间（gap）检测
- **发布审批（四眼原则）**：新增系统配置「决策表发布审批」，开启后需「申请发布 → 他人批准」两步生效；申请前先过全部发布门禁，待审批期间修改内容自动作废申请；新增「审批发布」权限按钮
- **命中分析**：近 7/30/90 天求值总量、命中率、按日趋势、规则行命中分布与零命中行提示、来源分布
- **影子对比**：以最近执行记录的输入重放当前编辑态，量化「若现在发布」的行为差异（差异样本对照）
- **治理与效率**：启用/停用开关、编辑乐观锁（并发修改返回 409）、「改动未发布」标记、版本任意两版对比、引用分析（where-used，删除被工作流引用的表将被阻断）、整表复制、表定义 JSON 导入/导出、规则矩阵 CSV 导出、测试用例 JSON 导入/导出
- **编辑器体验**：规则行上移/下移排序、输出列 key 重命名自动迁移行数据（含重复 key 中间态保护）、新增输入列自动为既有行补齐通配条件、数值/日期条件结构化编辑（比较/开闭区间/集合）、状态筛选
- **测试矩阵增强**：手动测试保存为用例改用弹窗命名；批跑覆盖率门禁保持不变

#### 开放集成

- 决策表/决策流求值与名单判定接口挂载敏感接口限流；`zat_` API Token（PAT）可直接调用求值接口，便于外部系统接入

### Changed

- **决策表运行时行为**：从「读编辑态」改为「读最新发布快照」，未发布的草稿在运行时不可用（历史已发布但无快照的数据自动回退当前配置）
- **执行记录接口**：`GET /api/rules/decision-tables/executions` 改为分页响应并支持多条件筛选（原 limit 模式移除）
- 决策流页面 Key 列加宽至 240px

### Fixed

- **执行记录跨租户泄露**：执行流水列表补充租户过滤，租户用户不再能查看其他租户的求值输入/输出
- **执行流水输入被污染**：异步批写改为入队时深拷贝输入快照，避免工作流在落盘前改写表单数据导致审计与影子对比失真
- **影子对比误报**：修正回退默认值场景下 before/after 比较不对称导致的全量误报
- **四眼审批绕过**：待审批期间修改决策表内容会自动作废发布申请，杜绝「提交后偷改再获批」
- **并发发布冲突**：并发发布/并发审批命中版本唯一约束时返回明确的 409 提示（原为 500）
- **编辑器条件录入**：修复选择比较/区间/集合操作符后因操作数未填而跳回「任意」、无法录入数值与日期条件的问题
- **引用分析租户边界**：租户表的 where-used 只扫描本租户工作流，他租户同名引用不再误阻删除

---

## v1.3.0 - 2026-07-19

### Added

#### 缓存管理

- **缓存分类全覆盖**：分类映射从 6 个前缀扩充至 24 个，覆盖代码库全部 Redis key 前缀（AI 服务、限流统计、幂等控制、开放平台限流/防重放/配额告警、OIDC/SAML 登录状态、工作流自动化/连接器、会员会话/下线黑名单/安全、公众号凭证、报表中心、埋点分析等），不再大量落入「其他」；左侧分类列表为新分类补充专属配色
- **全类型值查看**：`hash` / `list` / `set` / `zset` 类型的缓存值支持查看（分别经 HGETALL / LRANGE / SMEMBERS / ZRANGE WITHSCORES 序列化为 JSON 展示），此前仅支持 string；编辑仍限 string 类型

### Changed

- **登录页改版**：重构页面布局，新增背景渐变装饰、特性列表与入场动画；优化表单字段间距与错误提示样式，完善响应式设计
- **缓存列表操作列对齐**：「查看」按钮不再因类型不支持而整个隐藏导致错位，统一常驻显示

### Fixed

- **服务监控刷新按钮尺寸**：顶部「刷新」按钮改为 small 尺寸，与旁边的刷新间隔下拉框高度一致

---

## v1.2.0 - 2026-07-18

### Added

#### 日志管理

- **日志搜索与实时追踪增强**：重构日志文件搜索逻辑，增加日志级别检测；优化实时追踪（tail）连接管理

### Changed

- **依赖升级**：`hono` → 4.12.30（含 serve-static 路径穿越与 CORS 相关安全修复）、OpenTelemetry → 0.220.0、`@types/archiver` → 8（`archiver` 用法随之迁移到 `ZipArchive` 命名导出）、`source-map` / `@types/node` / `vitest` 等一并更新

### Fixed

- **链接预览 SSRF 加固**：`/api/chat/link-preview` 抓取外链改用带 SSRF 防护的 `http-client`（DNS 解析 + 逐 IP 校验，拦截私网 / 保留 / 云元数据地址并防 DNS rebinding），并移除可被利用的重定向跟随路径
- **会员登录防暴破**：新增会员账号级登录失败锁定与短信验证码校验尝试次数上限（超限即作废验证码），并启用登录接口 IP 限流
- **分片上传权限校验**：`/api/files/upload/chunk` 补齐 `system:file:upload` 权限校验，与 init / complete / abort 保持一致

---

## v1.1.0 - 2026-07-18

### Added

#### 服务监控增强

- **总览服务健康卡片**：新增 QPS（瞬时 + 60s 均值）、错误率（超阈值染色 + 4xx/5xx 累计）、P95 延迟（附 P50/P99）、WebSocket 连接（在线用户/累计连接）4 张卡片，服务健康一屏尽览
- **历史趋势峰值口径**：分桶聚合同时计算均值与峰值（max），新增「均值 / 峰值」切换——容量规划不再被平均值抹平毛刺；历史数据支持一键导出 CSV（含全部 avg/max 列，带 BOM 兼容 Excel）
- **实时趋势图补齐**：磁盘 Tab 新增磁盘 IO 读写趋势；数据库 Tab 新增连接数趋势；Redis Tab 新增内存与窗口命中率趋势。采样器新增外部采集器机制，每个采样周期异步采集 `pg_stat_activity` 连接数与 Redis INFO（命中率按两次采样间 delta 计算）
- **Prometheus 指标导出**：20 个 `zenith_*` 业务指标（CPU / 内存 / 堆 / 事件循环延迟 / QPS / 错误率 / HTTP 累计 / WS 连接 / DB 连接 / Redis 内存与命中率 / 网络与磁盘吞吐）注册至既有 `GET /metrics` 端点，抓取时惰性求值零常驻开销，可直接接入 Prometheus / Grafana
- **GC 速率化**：Node.js Tab 垃圾回收新增「近 1 分钟次数 / 耗时」估算行（快照 delta，进程重启自动丢弃异常值）

### Changed

- **SSE 实时推送协议扩展**：首帧推送完整快照 + 全量时序 + WS 指标，每个采样 tick 追加差量 patch、最新时序点与 WS 指标——实时模式下趋势图与 WebSocket Tab 不再冻结
- **监控页偏好持久化**：当前 Tab、刷新间隔、历史范围、统计口径存 localStorage，刷新页面不再重置；恢复的 Tab 在当前平台不可用时自动回退总览
- **体验打磨**：慢查询 SQL / Redis 慢日志命令改为单行截断 + Tooltip 全文 + 一键复制；Top 进程区新增「查看全部进程」跳转；Windows 等无网络指标平台自动隐藏网络 Tab；WS 连接「已持续 / 最近活动」列每 30s 自动刷新；页面与 Mock 的手写时间格式化统一替换为 dayjs
- **指标保留期对齐**：系统指标采样保留期默认 7 天 → 30 天，与历史趋势「近 30 天」范围选项一致

### Fixed

- **SSE 断线自动重连**：实时推送连接中断后按指数退避（1s → 30s 封顶）自动重连，连接存活超 30s 自动重置退避；断开仅提示一次，状态标签显示「已断开，自动重连中」

---

## v1.0.0 - 2026-07-18

> 🎉 首个正式版里程碑：核心后台能力（身份权限 / 系统运维 / 消息 / 支付 / 会员 / 工作流 / 智能助手 / 文件管理）全面就绪。

### Added

#### 文件管理器全面增强

- **在线编辑**：文本 / 代码文件直接在抽屉中用 Monaco 编辑器打开编辑保存（复用终端编辑器，含 Ctrl+S、脏状态提示）
- **全套快捷键**：Ctrl+A 全选、Ctrl+C/X/V 复制剪切粘贴、Delete 删除、F2 重命名、Enter 打开、Backspace 上级、Esc 取消选择、Ctrl+L 路径直达
- **拖拽上传**：从桌面拖入文件即上传到当前目录，含全屏 dropzone 视觉反馈
- **上传文件夹**：按原目录结构自动重建目录树后逐文件上传
- **同名冲突处理**：复制 / 移动 / 粘贴遇同名弹出「覆盖 / 跳过 / 保留两者」三选；同目录复制自动生成「xxx - 副本」
- **路径直达**：面包屑旁编辑按钮或 Ctrl+L 直接输入绝对路径跳转
- **批量下载**：多选下载自动压缩为临时 zip 下载后清理
- **列表排序**：名称 / 大小 / 修改时间三列可排序，文件夹恒置顶，中文数字自然排序
- **收藏夹**：工具栏一键收藏当前目录（localStorage 持久化），侧栏收藏区直达、悬停可移除
- **目录大小统计**：属性面板「计算大小」递归统计目录总大小 / 文件数 / 子目录数（20 万条上限保护）
- **名称合法性校验**：新建 / 重命名 / 压缩包名拦截非法字符与 Windows 保留名（CON、PRN 等）
- **深度搜索定位**：搜索结果「前往」跳转父目录并高亮选中目标项
- **校验和并入属性面板**：MD5 / SHA1 / SHA256 一键计算与复制，右键与操作列直达
- **Windows 平台适配**：Windows 环境自动隐藏权限 / UID / GID 列与 chmod 菜单

### Changed

- **全站文件图标统一 vscode-icons**：文件列表、文件管理器、聊天附件、ZIP / PDF 预览、日志文件、导入弹窗等全部按扩展名 / MIME 精确匹配 vscode-icons 图标（300+ 扩展名与文件夹映射，全部经 Iconify API 校验）；文件夹展开态图标同步修正
- **文件管理器交互统一**：列表 / 网格双视图统一「单击选中、双击打开」；剪切中的条目半透明提示；粘贴 / 删除 / 对话框确认按钮增加进行中 loading 反馈；操作列「下载」收纳至更多菜单
- **导航体验**：切换目录保留旧列表并显示顶部进度条（不再整屏 Spin 闪烁）；图片预览改为懒加载（仅加载当前 ±2 张，翻页按需补载）

### Fixed

- **文件管理器单击导航**：修复切换目录时占位数据触发路径回写、导致第一次单击被回退（表现为需点两次才能进入目录）的问题

---

## v0.99.0 - 2026-07-18

### Added

#### 智能助手 P3：智能体化与生产级可靠性

- **自定义智能体**（对标 GPTs / Coze）：新增「智能体」页，提示词 + 模型 + 知识库 + 工具组合成可复用助手，含开场白与建议问题；上架审核流（私有→待审核→已上架/已驳回，`ai:agent:review`）、智能体市场与一键克隆；`?agentId=` 一键开聊自动应用全部预设
- **消息分支树**（对标 ChatGPT）：`parentId + activeLeafMsgId` 分支模型，重新生成 / 编辑重发不再删除旧内容而是创建兄弟分支，消息标题行「‹ i/n ›」切换器回看任意分支；消息删除改为子树级联并自动回退激活叶子；历史线性数据隐式父节点兼容
- **SSE 断线续传**：生成与客户端连接解耦——生成任务后台运行写入 Redis 缓冲（TTL 10min），刷新 / 断网后自动探测并恢复实时输出（`/api/ai/generations/{genId}/stream`）；「停止生成」走 cancel 端点，已生成部分仍保存；同会话同时仅一个生成任务
- **HTTP API 工具**：新增「AI 工具」页（`ai:tool:list/manage`），零代码把企业内部 / 第三方 HTTP API 注册为 Function Calling 工具（参数 schema + query/body/path 位置映射），与内置工具统一命名空间，出站 SSRF 防护
- **知识库升级**：pgvector 运行时探测（条件迁移，`embedding::vector` 物化 + SQL 余弦检索，JS 兜底）；URL 网页抓取入库（正文去噪提取）；混合检索（向量 0.7 + 关键词 0.3 加权）
- **模型评测**：新增「模型评测」页（`ai:eval:*`），评测集维护 + 任务中心异步逐题运行（断点续跑 / 取消），记录逐题回答 / 耗时 / token，多模型回归对比
- **可观测 Trace**：assistant 消息落生成调用链（检索 / 工具 / failover / LLM 轮次耗时），对话审计页新增 Trace 抽屉
- **提示词版本管理**：模板内容变更自动快照历史版本，版本抽屉查看与一键恢复（恢复前当前内容同样留档）
- **多供应商可靠性**：服务商配置新增「降级配置」（首字前失败自动主备切换一次 + failover 事件提示）与「并发流上限」（超限排队 15s）
- **语音交互**：浏览器 TTS 朗读回复（消息操作栏）与 STT 语音输入（识别草稿条可编辑后发送）
- **图片生成**：`ai_image_model` 系统配置启用内置 `generate_image` 工具（`/images/generations`），模型按需生成配图
- **对话标签**：会话自定义标签（最多 10 个），标题栏展示，列表按标签过滤

### Changed

- **文档站重构**：AI 能力文档从单页拆分为独立目录（总览 / 智能对话 / 智能体 / 服务商 / 知识库 / 工具 / 提示词 / 运营治理 / 安全合规 / 数据模型与接口速查 共 10 页），侧栏升级为独立「AI 能力」分组，并补齐 P2/P3 全部能力说明
- **聊天历史**：生成上下文按当前激活分支路径读取；导出 Markdown / JSON 仅导出激活分支

### Fixed

- **AI 反馈 / 审计页**：修复「AI 回复内容」「消息内容」列未设宽度导致被挤压成窄缝的问题

---

## v0.98.0 - 2026-07-18

### Added

#### 智能助手平台化（P1 / P2）

- **多供应商原生适配**：新增 Anthropic（`/v1/messages` + thinking）与 Google Gemini（`streamGenerateContent` SSE）原生流式适配器，与 OpenAI Compatible 并列；百度千帆表单明确禁用引导走兼容网关
- **多模型与能力标签**：单个服务商配置支持「附加模型」列表（聊天下拉自动展开），`POST /api/ai/providers/fetch-models` 从供应商 `/models` API 自动发现；能力标签声明 vision / tools / 上下文窗口
- **思维链展示**：透传 `reasoning_content` 为 SSE `reasoning` 事件，聊天页以 Semi 原生 Reasoning 折叠面板渲染，reasoning 落库可回放
- **Function Calling**：内置工具注册表 + 服务端执行循环（最多 5 轮），聊天页展示工具调用卡片
- **视觉输入**：具备 vision 能力的模型支持图片上传提问（多模态 parts 消息）
- **知识库 RAG**：个人知识库管理（文本/Markdown 文档分块入库、可选 embeddings 向量化），对话可挂载知识库，检索优先余弦相似度、关键词兜底，回答附引用来源
- **对话分享**：一键生成免登录公开链接（192-bit token），支持过期时间与撤销，新增公开回放页
- **模型竞技场（Arena）**：双模型同题对比回答与投票，投票记录落库
- **个人偏好指令**：用户级自定义指令（关于我 / 回复风格），自动注入系统提示词
- **LLM 自动命名**：新会话首轮后调用轻量模型生成标题（SSE `title` 事件实时更新侧栏）
- **会话侧栏增强**：按日期分组（今天/昨天/近 7 天/更早）+ 无限滚动加载
- **提示词模板变量**：支持 `{{变量}}` 占位符填充弹窗，模板使用次数统计
- **用量统计增强**：assistant 消息口径统计、按供应商单价（分/百万 token）成本估算、TTFT 与耗时指标、Redis 成功率计数
- **反馈闭环增强**：反馈列表关联用户/对话/前置提问，支持上下文回放与 CSV 导出
- **每日 Token 配额**：`ai_daily_token_quota` 系统配置 + Redis 计数，超限拦截发送
- **AI 审计页**：管理员按用户/时间检索全量对话消息（含敏感词命中标记）

#### 安全合规

- **API Key 加密存储**：服务商 API Key 以 AES-256-GCM 加密入库（`enc:v1:` 前缀，历史明文兼容读取；密钥 `FIELD_ENCRYPTION_KEY` 或 `JWT_SECRET` 派生）
- **出站 SSRF 防护**：聊天流/连接测试/模型发现/embedding 全部出站请求默认拒绝内网地址，新增 `AI_OUTBOUND_PRIVATE_ALLOWLIST` 环境变量（默认放行 localhost 兼容 Ollama）
- **敏感词过滤**：发送前内容检查（字典 13），命中拦截并记录审计
- **发送限流**：`ai_chat_send` / `ai_share_view` 接口级限流规则

### Changed

- **Token 用量统计**：流式请求携带 `stream_options: { include_usage: true }` 获取精确用量（老网关自动降级重试），无 usage 时按字符估算兜底
- **模型参数**：聊天调用尊重服务商配置的 `maxTokens` / `temperature`，禁用配置从聊天下拉过滤
- **自定义 Key**：后端强制校验 `ai_allow_user_custom_key` 开关；连接测试接口补权限校验
- **轻量模型接口**：新增 `GET /api/ai/models`（仅返回聊天页所需字段，不含密钥信息）
- **移除 PDF 上传**：聊天附件去除 PDF 解析（避免额外依赖与扫描件解析问题），预览组件迁至公共目录

### Fixed

- **重复消息**：重新生成（regenerate）模式不再重复保存用户消息
- **SSE 跨 chunk 丢事件**：前端解析 `eventType` 提升至读循环外，修复 `event:` 与 `data:` 行被拆分到不同 TCP chunk 时静默丢弃事件
- **消息 ID 映射**：发送成功后 user 气泡同步映射为持久化 ID（saved 事件补发 `userMsgId`），避免后续操作引用临时 ID 错乱
- **RAG 一致性**：知识库检索校验 embedding 模型与向量维度一致性，更换 embedding 模型后自动降级关键词匹配，杜绝伪相似度
- **vision 按钮状态**：切换模型后图片上传入口未跟随能力标签更新（stale ref）
- **错误路径保留内容**：流式中断时已生成的部分回答仍保存落库
- **用量统计卡片**：修复统计卡片高度不一致

---

## v0.97.0 - 2026-07-17

### Added

#### 工作流表单类型（designer / custom / external）

- **custom 审批可编辑**：审批详情对具有「可编辑」字段权限的当前处理人以 `approve` 模式渲染自定义业务表单，审批提交时按 edit 白名单收集业务表单修改并合并进实例数据，兑现业务表单契约中的 approve 模式
- **external 终态后重新发起**：业务键（bizType + bizId）唯一约束收窄为仅活跃实例（草稿/运行中/挂起），流程通过/驳回/撤回/取消后业务记录可修改后重新发起新流程；请假示例新增「重新编辑」操作（`POST /api/biz/leaves/{id}/reopen`）形成驳回→改单→重提完整闭环
- **designer 发布门禁**：流程分支条件/审批人字段/表达式/延迟日期/子流程字段引用了表单字段但未绑定表单，或绑定表单已停用/被删除时阻断发布；新增 `collectReferencedFormFieldKeys` 共享收集器
- **external 发起路由变量守卫**：节点按表单人员/部门字段解析审批人且未配置空审批人兜底策略时，路由变量缺失即阻断发起并返回缺失明细，避免节点被默认「自动通过」静默跳过
- **移动审批端业务表单**：审批 SPA 详情页以只读模式渲染 custom/external 业务查看组件（原为「请到桌面端查看」提示）

### Changed

- **发布前业务表单 gate**：custom 创建组件 / external 查看组件路径必须在 `src/pages` 下可解析方可发布；变量声明 key 增加格式与重复内联校验
- **表单类型切换确认**：已有表单绑定或业务表单配置时切换类型弹出确认，提示配置清空与字段引用失效风险
- **external 配置面板**：隐藏无用的「创建/填写页组件」输入；节点表单权限的「编辑」列对 external 禁用（数据归属业务系统）
- **存草稿免校验**：发起页存草稿改为直取当前值（与服务端草稿宽松语义一致），正式提交仍全量校验
- **custom 草稿提交**：列表「提交」对 custom 草稿引导到编辑页经业务组件校验后提交，不再绕过校验直接发起
- **Demo 模式**：MSW 发布接口对齐 designer 发布门禁，消除与真实 API 的行为漂移

### Fixed

- **custom 草稿回填丢失**：编辑草稿时业务表单未传入已保存数据、渲染为空，保存即覆盖丢数据
- **external 详情监控访问**：流程监控管理员/超管打开 external 实例详情时业务详情接口 403，与实例详情权限口径不一致
- **实例状态常量**：`WORKFLOW_INSTANCE_STATUSES` 补全 `suspended`/`cancelled`，与 DB 枚举、TS 类型三方同步

---

## v0.96.0 - 2026-07-16

### Added

#### 开放平台与开发者中心

- **开发者自助应用**：新增「我的应用」工作台，支持应用创建/编辑、生产与沙箱环境、提交审核、密钥轮换、实时配额用量和在线 API 调试
- **OAuth 2.1 服务端**：授权码流程全面启用 PKCE S256，保留客户端凭证与刷新令牌模式；新增可锁定 Token Family、Refresh Token 轮换与重放检测、令牌撤销/自省及 UserInfo
- **开放 API 网关**：新增 HMAC-SHA256 双密钥宽限轮换、Nonce 防重放、应用 IP/CIDR 白名单、审核门禁和沙箱免配额调用
- **配额与套餐**：支持 QPS、每日、每月三维配额，提供 80%/95% 告警、持久化告警 Outbox、站内信与 Webhook 补偿投递
- **Webhook 运维**：支持订阅管理、签名投递、阶梯重试、失败自动停用、投递日志筛选、批量重试和测试投递
- **调用分析**：新增应用详情工作区、调用总览/趋势/应用与端点排行、P95/P99 延迟、日志多维筛选及导出
- **个人 API Token**：后台接口支持 `zat_` Token 鉴权，Token 改为 SHA-256 摘要存储并记录最近使用时间

### Changed

- **安全策略**：移除 OAuth implicit 与 PKCE plain，生产应用默认必须审核通过；应用 Scope、授权类型、状态或环境变化时撤销既有令牌和授权码
- **可靠性治理**：调用日志按应用时区进行日聚合并支持漏跑补齐；原始日志按保留期清理，历史查询自动合并聚合数据与未聚合尾部
- **开放平台页面**：限流套餐名称与编码拆列展示；「我的应用」Scope 列加宽，应用详情按用户实际权限裁剪统计、Webhook 与令牌操作
- **工作流查询**：流程实例查询增加 `definitionId` 条件

### Fixed

- **OAuth 并发与越权**：修复 Refresh Token 重放未撤销后代、用户或租户停用后仍可刷新、Scope 缩减后旧授权恢复、客户端更新与令牌签发竞态等问题
- **Webhook 安全与幂等**：修复首次投递进程退出后永久滞留、并发重复投递、内网 SSRF、无界响应体读取及过期 Worker 覆盖新状态
- **配额告警可靠性**：修复进程启动窗口、临时故障或 Worker 过期导致告警丢失/重复的问题
- **统计与导出**：修复日切至聚合任务执行前统计缺失、历史范围边界不准确、活跃日志 Offset 导出重复或遗漏，以及大数据量同步导出阻塞

---

## v0.95.0 - 2026-07-15

### Added

#### 工作流表单设计器

- **画布所见即所得**：画布字段按真实控件渲染预览（选项/开关/评分/明细表格等），超 80 字段自动降级为轻量占位并提供 WYSIWYG 开关
- **画布交互全面升级**：字段右键菜单（复制/剪切/粘贴/删除/上移下移）、内部剪贴板 Ctrl+C/V、Delete/方向键/Esc 键盘操作、大纲树视图快速定位；支持多选字段批量设置（必填/占宽/删除）与一键合并为分栏
- **拖拽与布局体验**：拖拽至画布边缘自动滚动、插槽落点指示、拖拽幽灵预览；分栏列宽拖拽调整与双击均分；容器嵌套放开（分栏⊃分组/明细、分组⊃一行多列/明细，深度≤3）
- **公式引擎增强**：公式编辑器支持光标插入、字段 chips、实时试算与循环依赖检测；新增 NETWORKDAYS/DATEADD/LOOKUP/FORMAT/ISEMPTY 等函数；新增默认值公式与自定义校验公式（含自定义提示文案）
- **联动与规则深化**：显隐/必填条件支持嵌套条件组（且/或多层组合）；明细表行内公式、行内显隐与行级校验公式；数据源联动支持选中记录自动回填表单字段（双模式配置）
- **明细表增强**：行复制、Excel 剪贴板批量粘贴、列宽配置
- **模板中心**：内置 6 套完整表单模板画廊（请假/报销/采购等），支持将字段保存为「我的模板」（localStorage）复用
- **新控件**：级联选择（缩进文本批量编辑选项）、NPS 净推荐值、矩阵量表、定位、图片选项（单选/多选选项支持配图）、Markdown 说明文字与分割线标题
- **编辑安全**：表单保存乐观锁（并发编辑冲突 409 提示）；字段 key 重命名自动级联重写流程定义全部引用点（节点权限/条件分支/自动化模板/摘要字段/单号模板等）；本地草稿自动暂存与恢复提示；保存前变更摘要对比
- **设计器易用性**：配置面板 Tab 徽标与属性搜索跳转、撤销历史面板（按操作标签跳转任意步骤）、选项批量文本编辑

#### 工作流运行时

- **服务端表单全量规则校验**：公式引擎与求值逻辑下沉 `@zenith/shared` 前后端同源，发起/提交时服务端强制校验必填（含条件必填与明细行内显隐）、文本长度/正则、数值与日期范围、跨字段比较、自定义校验公式、明细列唯一与行级规则，非法提交一律 400 拦截
- **数据源记录接口**：新增按主键取单条记录接口（GET /api/workflow/data-sources/{id}/record）支撑联动回填

#### 系统

- **预设头像选择**：用户头像管理新增系统内置头像选择弹窗
- **日期时间选择**：字典配置的日期格式含时间时，日期选择器自动切换为 dateTime 模式并启用内嵌输入

### Changed

- **导出中心**：导出文件不再叠加水印；用户邮箱/手机号列不再标记为敏感列
- **聊天提醒**：短时间多条提醒改为堆叠展示并去重，避免刷屏
- **代码去重**：前端三套 HTTP 客户端统一核心实现；管理员/会员 Redis 会话存储合并为通用模块；统一 blob 下载、字节格式化、毫秒时长格式化等工具

### Fixed

- **管理后台分页**：补齐部分列表页缺失的每页条数选择器
- **公式循环依赖**：字段公式互相引用时检测并报错，避免运行时死循环

---

## v0.94.0 - 2026-07-13

### Added

#### 支付中心

- **签约代扣**：新增扣款计划与签约协议管理（周期 daily/weekly/monthly/custom），支付方式扩展微信委托代扣（papay）与支付宝周期扣款；扣款单复用支付订单完整履约链，扣款成功按锚点幂等推进排期，失败次日重试、达上限自动暂停，cron 每分钟扫描到期协议；打通会员 VIP 自动续费（签约/解约/立即续费，advisory lock 幂等延长有效期），会员 SPA 新增续费页
- **交易投诉/争议管理**：新增投诉工单（退款诉求/服务问题/欺诈举报等类型）与处理时间线，支持商户回复、协商完结、投诉退款（复用退款审批链路）；处理时效超时红标预警，统计待处理/超时/30 天投诉率/平均处理时长；沙箱渠道 cron 自动生成模拟投诉供演示
- **风控中心增强**：风控规则新增命中动作（直接拦截 / 挂起人工审核）与白名单（openid/用户 ID/IP 任一命中跳过），黑名单匹配扩展 IP 维度；新增拦截留痕与人工审核队列，审核放行后重新下单幂等复用挂起订单继续支付，拒绝则关闭订单；页面改造为限额规则/拦截记录/审核队列三 Tab
- **商户资金账户体系**：新增渠道×租户维度资金账户（待结算/可用/冻结余额快照），随资金台账落库原子联动；支持按流水聚合核对快照、从全量流水重建快照、人工调账（走 adjust 流水保证账目一致）
- **统一收银台升级与支付立减**：收银台公开页新增支付状态轮询、待支付倒计时与支付结果页；支付订单支持会员优惠券立减，券生命周期与订单对齐防双花防丢券（下单锁券 → 支付成功核销 → 关单/失败释放），满减券按面值、折扣券受封顶约束；会员钱包充值接入充值满减（实付立减、到账按原额平台补贴）
- **预授权（资金冻结）**：新增预授权模块支持资金冻结/解冻/转支付（押金场景），支付方式扩展微信/支付宝预授权；转支付原子占用防并发并走完整履约链，支持部分转支付剩余自动解冻；资金账户冻结余额联动并纳入核对口径

#### 文档站

- **Mermaid 图表支持**：文档站接入 mermaid 渲染流程图与状态机图
- **文档重构**：工作流文档按流程设计/发起审批/集成自动化/运维治理四组重排（补审批代理、保存视图、移动审批等章节）；报表中心文档按功能拆分指标中心/数据质量/资源治理/资产目录/智能问数/数据填报等页面；公众号管理补消息回调接入文档

### Changed

- **沙箱渠道零凭据演示**：微信/支付宝适配器的下单/查单/关单/退款/退款查询补齐沙箱模拟分支，无需真实凭据即可完整演示收银下单与退款流程

### Fixed

- **渠道配置部分更新被静默重置**：修复更新渠道配置时 partial schema 未剥离 default 值，导致沙箱开关/默认渠道/状态字段被静默重置的问题
- **种子数据外键失败**：移除 seed 中硬编码 userId 的用户反馈示例数据，避免在 admin id 漂移的库中触发外键约束失败

---

## v0.93.0 - 2026-07-12

### Added

#### 工作流

- **历史版本侧边抽屉与后端分页**：定义历史版本由弹窗改为侧边抽屉，版本列表接入后端分页（count 与列表并行查询，表单快照按页加载），版本对比下拉取最近 100 个版本

#### 权限与安全基建

- **权限清单对账测试**：新增 CI 级契约测试，扫描全部路由 guard 权限码对照 SEED_MENUS 声明，引用 seed 未声明的权限码时测试失败，防止权限契约漂移；并借此修复 2 个存量缺口（站内信管理员标记已读、流程仿真用例的权限码此前对非超管永远不可获得）
- **Redis 权限缓存**：用户权限缓存主存储迁移至 Redis（perm:{userId}，TTL 5 分钟），角色/菜单/套餐变更清缓存后多实例部署下撤权即时生效；Redis 不可用自动降级进程内缓存
- **菜单默认路由参数**：菜单管理的 query 字段接入前端动态导航，侧边栏/双栏/混合导航跳转时自动拼接 querystring
- **地区行政层级校验**：省/市/区县层级组合强约束（省仅根级、市挂省、区县挂市），变更层级时校验与既有子级兼容，MSW Demo 同步
- **用户授权按钮**：种子菜单补「用户授权」按钮（system:user:assign），角色分配/菜单授权/数据权限设置等入口不再仅超管可用

### Changed

- **导出默认脱敏**：导出中心默认按脱敏模式导出（raw=false 三端统一），敏感列按数据脱敏中心规则打码、未配置规则按字段名回退内置脱敏；用户导出的明文模式强制校验 system:user:export-raw 独立权限
- **禁用即时失权**：权限解析过滤禁用角色与禁用菜单（含直授与用户组继承链路），禁用菜单对所有人（含超管）从导航与动态路由中剔除；角色更新即时清权限缓存
- **租户套餐治理**：删除在用套餐改为 409 前置拦截 + 外键 restrict 兜底（迁移 0051），杜绝删除后白名单静默失效；禁用套餐按空白名单处理（fail-closed）；白名单页面的按钮子节点运行时自动并入，套餐圈选到页面粒度即可，解决角色无法分配按钮权限的死锁
- **全局资源平台边界**：多租户模式下菜单/地区/数据脱敏规则的写操作要求平台管理员身份（单租户部署不受影响），新增公共 platformAdminOnly 中间件并统一租户/套餐路由的重复实现
- **授权弹窗竞态防护**：9 处授权弹窗（角色菜单/用户/数据权限、岗位成员、套餐菜单、用户组成员/角色、用户菜单/数据权限）在详情查询成功前禁用保存，查询未完成或失败时不再可能保存空集合清空既有关联
- **MSW Demo 对齐**：补角色用户分配、岗位成员、用户角色分配、批量重置密码接口；修正重置密码路径与真实接口一致；Demo 同步保留角色编码与菜单禁用过滤行为

### Fixed

- **租户伪造超管提权（安全）**：超管判定收紧为「角色编码 + 平台归属（tenantId 为空）」双条件并覆盖全部 17 处判定点（接口守卫/导出/菜单树/工作流/报表/终端/DB 管理/数据范围），角色创建与改名拒绝 super_admin 保留编码——租户自建同名角色不再获得任何超管能力
- **导出脱敏失效（安全）**：修复导出中心声明的敏感列脱敏配置从未执行的问题（此前无论是否明文模式均导出明文邮箱/手机号）
- **跨租户关联写入（安全）**：角色分配用户、用户直授菜单、用户角色分配补租户归属与套餐白名单校验并去重输入，杜绝跨租户 IDOR
- **数据范围绕过（安全）**：用户详情/更新/删除/改密/批量操作/解锁/授权读写等 12 处操作统一接入「租户 + 数据范围」可管理校验，全量用户下拉与列表口径一致；self/dept 范围用户无法再绕过管理超出范围的账号
- **禁用租户续命（安全）**：刷新令牌补租户禁用/过期检查，租户停用后 refresh token 不再可续期最长 30 天
- **超管撤权残留（安全）**：失去平台超管角色绑定的用户立即撤销全部在线会话，收敛 JWT 2 小时权限残留窗口

---

## v0.92.0 - 2026-07-12

### Added

#### 工作流

- **节点激活轮次（activationId）**：任务表新增激活轮次标识，节点重入（驳回回退/退回重审）后会签/或签/比例完成判定只统计当前轮，历史轮 rejected 任务不再卡死节点；加签与委派回执任务继承同轮参与判定，存量数据自动回退旧行为（迁移 `0050`）
- **服务端表单必填校验**：新增 `@zenith/shared` 表单运行时求值模块（显隐联动/条件必填与前端渲染器同源），发起与草稿提交按表单快照服务端强制必填校验，绕过前端直调 API 无法以空必填字段发起
- **发布版本表单快照**：发布时冻结绑定表单的 schema 快照，表单库后续编辑不再影响已发布版本的历史查看与对比（迁移 `0050`）
- **热点索引**：补 `workflow_tasks(assignee_id, status)`、`workflow_instances(tenant_id, status)`、`workflow_instances(initiator_id, status)` 组合索引（迁移 `0050`）

### Changed

- **实例详情按查看者脱敏**：`formData` 按查看者身份过滤——发起人按 start 节点字段权限、参与人按其任务节点权限并集，仅所有相关映射均 hidden 才剔除；未配置字段权限的流程不受影响，监控管理员与超管不脱敏
- **操作按钮服务端强制**：通过/拒绝/转办/委派/加签/减签/退回七个入口强制节点「操作按钮设置」的启用态，默认口径与前端一致（approve/reject 默认开、其余默认关）；系统路径（超时自动处理、外部回调、管理员改派）不受限
- **审批撤回保留审计链**：撤回不再物理删除后续任务与覆盖原任务——后续未处理任务作废为 skipped，原任务保留原始意见/签名并标记「已撤回」，新建同轮重审行承接后续审批
- **定义发布/启用状态机**：发布校验移入行级锁内消除并发竞争窗口；启用（含批量）同样通过发布前体检门禁；禁用态修改定义自动回草稿，杜绝改完直接启用绕过校验
- **权限契约对齐**：实例详情接口权限扩为 list/handle/monitor 任一（纯审批角色可打开详情），流程监控管理员可查看全局实例详情；「我的申请」菜单权限对齐为 `workflow:instance:list` 并补发起按钮；事件订阅/投递管理补 5 个按钮权限进种子菜单
- **WS 缓存失效收窄**：实例结束事件的前端缓存失效范围由全域 workflow 收窄至 instances/tasks/monitor，设计器等编辑态查询不再被动 refetch；设计器加载增加同定义初始化守卫，防止 refetch 覆盖未保存画布
- **连接器类型收口**：`mq`/`database` 类型暂无运行时实现，关闭新建入口（存量数据仍可显示与管理）
- 移除旧版流程设计器死代码页面，隐藏菜单统一指向现行设计器

### Fixed

- **回调密钥泄漏（安全）**：实例详情下发的流程定义快照剥离外部审批/触发器回调 HMAC 密钥与出站凭证请求头，杜绝实例参与人伪造公开回调批准/拒绝流程
- **跨租户发起（安全）**：发起实例的定义查询补租户过滤，多租户模式下无法再跨租户发起他租户流程
- **挂起计时器被吞**：作业领取增加到期时间守卫，实例挂起冻结的 SLA 超时/延时唤醒作业不再被此前入队的 pg-boss 消息提前消费；恢复挂起后按剩余时长重排唤醒
- **强制跳转事件语义**：管理员强制跳转不再重复发射 `instance.created`，订阅「发起」触发器的流程自动化不会被误触发
- **定时发起重复执行**：到期扫描改为 `FOR UPDATE SKIP LOCKED` 锁内先推进下次执行时间再发起，多副本部署与慢 tick 重叠不再重复发起同一规则
- **审批事件丢失**：审批/驳回/撤回/取消的事件发射全部移入事务内 outbox，与状态变更原子提交，提交后进程崩溃不再丢事件
- **抄送 onlyOnApprove 误判**：「已完成节点」判定改为当前激活轮且仅 approved 口径，驳回连带跳过/撤回作废/取消清场的任务行不再让抄送节点误判上游已通过

---

## v0.91.0 - 2026-07-11

### Added

#### 工作流

- **批量审批与转办幂等**：批量审批/转办引入 Redis 动作去重与事务改进，确保并发下任务状态一致；补偿工单补充实例级联外键并清理历史孤儿数据（迁移 `0048`）
- **调度时区支持**：工作流调度新增时区字段，cron 表达式按指定时区计算（迁移 `0049`）
- **任务体验与运行监控**：增强任务超时提醒，评论支持实时通知（@提及），新增健康诊断项；待办/已办/我的申请/抄送列表接入保存视图与批量操作缓存同步
- **事件订阅**：订阅列表新增更新时间、投递次数、HTTP 状态、耗时、错误信息、创建时间字段

### Changed

- 移除工作流旧线性流程兼容代码；补充表单公式/树/校验工具测试
- 发布流程文档：版本号同步范围扩展至 `packages/` 下所有包（含 analytics-sdk、electron）

---

## v0.90.0 - 2026-07-11

### Added

#### 行为中心 P1 产品分析升级

- **平台化数据模型**：事件/会话/错误增加 `source`、`appId`、`environment`、`sdkVersion`、`memberId` 平台维度；新增用户画像、用户分群、事件租户覆盖、质量日聚合表（迁移 `0043`）
- **会员端采集**：会员 SPA 接入行为采集与错误上报，隐私同意 Banner 驱动采集开关；SDK 运行时参数化、按应用命名空间存储、远程配置热更新
- **Tracking Plan 治理**：事件字典 propertySchema 校验（宽松/严格模式）、租户级事件启停覆盖、质量看板（缺失必填/类型不符/非法枚举日聚合）、实时事件调试流
- **分析工作台**：通用事件分析（维度分组/趋势）、有序转化漏斗（转化窗口）、双口径留存（真实首访/窗口首现）、用户分群圈选与物化
- **服务端权威语义事件**：29 个语义事件（支付 5 / 工作流 14 / 会员 10）经事件总线桥接落库，与前端采集共用治理与画像，幂等且不阻塞业务流程
- **报表中心集成**：内置行为分析数据集与概览看板种子数据

#### 行为中心 P2 平台化与增长

- **独立 SDK 包**：埋点/错误上报/面包屑核心抽为 `@zenith/analytics-sdk` workspace 包，web 保留薄适配层，业务调用点零改动，构建链 shared → analytics-sdk → server → web
- **站点管理**：`analytics_sites` 站点模型 + Site Key，匿名请求凭 Key 归属租户并强制 appId（事件与错误两条链路），支持重新生成 Key（迁移 `0044`）
- **配额与白名单**：站点级日事件配额（Redis 计数、事务内按新鲜落库行消费、超限静默拒收）与来源 Origin 白名单校验；质量看板新增 `origin_rejected` / `quota_exceeded` 拒收计数（迁移 `0045`）
- **分群触达**：分群成员快照经任务中心分批触达，支持邮件 / 站内信 / Webhook 三渠道（Webhook 走 SSRF 防护），原子状态机防并发重复群发（迁移 `0046`）
- **A/B 实验**：sha256 确定性分流（无状态、不落分组表）、SDK `getVariant` 自动会话去重曝光、首曝光后转化口径报告、公开分流端点限流与身份反伪造（迁移 `0047`）
- **容量演进文档**：`docs/analytics/capacity.md` 明确三项架构触发条件（2 亿行 / p95 > 3s / 2k events/s）、自查 SQL 与「PG 分区 + BRIN → 队列 + OLAP」两级演进路径

#### 文件管理

- 文件访问 URL 策略：代理 / 公开直链 / 临时签名三种模式，文件 DTO 返回 `directUrl` 稳定直链

### Changed

- 事件调试、用户分群、站点管理表格列宽与列序优化（时间/类型/环境/成员数/Site Key/操作列加宽，站点状态列贴近操作列）

---

## v0.89.0 - 2026-07-11

### Added

#### 报表中心 P2 平台化

- **指标语义与资源治理**：新增指标中心、资源目录、负责人、查看者/编辑者 ACL、发布审批、所有权转移及多环境晋级/回滚能力，仪表盘和预警可统一绑定已发布指标
- **数据质量与容量治理**：新增质量规则、评分、异常与异步运行历史，提供持久化/增量物化、查询配额、成本趋势、SLA、资产目录、使用统计和弃用治理
- **智能问数与填报闭环**：新增受治理 ChatBI 多轮问数、图表建议及结果沉淀；新增填报模板、记录审核、Workflow 审批和消费数据集同步
- **高级打印**：支持交叉表、重复块、子报表、多数据集绑定和 Word（DOCX）导出，增强 PDF/HTML 精确分页与中文渲染
- **移动阅读与嵌入 SDK**：仪表盘支持移动端单列阅读和筛选抽屉；嵌入组件新增受控筛选、命令/事件协议、来源校验和只读模式
- **Demo 与文档**：补齐 P2 种子数据、MSW Mock、异步任务模拟、平台文档及数据库迁移 `0040_keen_sage.sql`

#### 用户认证

- 用户手机号增加唯一约束；邮箱调整为可选字段，登录链路支持手机号识别

#### 行为中心 P0 数据可信加固

- **租户安全**：数据保留改为逐租户策略清理，采集配置与 IP 匿名化按登录租户读取，设置表增加租户唯一约束，错误指派校验用户租户归属
- **入口与权限**：匿名埋点/错误端点增加默认 IP 限流，清理数据拆分 `analytics:clean` 权限，事件屏蔽仅允许平台超管，告警 Webhook 启用 SSRF 防护
- **写入正确性**：事件新增 `eventId` 幂等键，事件/会话及错误 Issue/明细写入事务化，登录身份由服务端强制归一
- **SDK 可靠性**：修复账号切换缓冲错配、identify 采样、离线周期重试、重复白屏与 API 自监控盲区；错误遥测遵循采集开关，Source Map 打通 release 并限制 20MB
- **契约与测试**：按事件类型校验必填字段，限制 JSON 属性袋，补充租户保留、配置竞态、幂等重放、身份切换及遥测策略测试

### Changed

- 填报模板编辑器改为两步式 SideSheet，基本信息与字段设计分离，长表单空间和滚动体验优化
- 报表中心及聊天搜索等 Overlay 表单下拉框统一占满所在列，时间列与编码列宽度统一优化
- 数据质量与数据预警 Cron 输入统一接入可视化 Cron 构建器；质量列表拆分 Cron 与时区列

### Fixed

- 修复资产使用趋势和查询成本趋势 `date_trunc` 分组参数不一致导致的 PostgreSQL 查询失败
- 修复数据质量运行历史通过率被重复乘以 100、显示为 `10000.00%` 的问题
- 修复报表 SQL 表引用、质量自定义 SQL、ACL/租户、填报审批竞态及异步导出截断等集成安全边界

### Infrastructure

- CI 安装 Noto CJK 字体，保证 Linux runner 上报表 PDF 中文渲染测试稳定

---

## v0.88.0 - 2026-07-10

### Added

#### 报表中心（生产能力完善）

- **取数与查询治理**：统一数据集取数链路与运行时查询治理（外部数据源连接治理、查询超时/行数上限等防护），新增文档 `docs/report/runtime-governance.md`
- **打印导出**：打印报表接入导出中心，支持后端渲染导出（`report-print-export`），打印视图与参数对话框（`ReportParamDialog`）增强
- **发布与分享协作**：公开分享/订阅链路增强，报表密钥迁移至加密存储，敏感凭据安全落库与访问
- **预警与嵌入**：报表预警设置表单改为响应式布局，嵌入组件（`ReportEmbed`）与相关查询 hooks 完善

#### 系统配置

- **验证码复杂度**：新增 `captcha_complexity` 配置（`low` / `medium` / `high`，默认 `medium`），按档位控制干扰线数量与算式运算范围，非法值自动按 `medium` 处理，仅在开启登录验证码后生效

#### 组件与字典

- **ThemedReactFlow**：新增主题化流程图组件，深浅色主题自动跟随，替换数据集引用图、ER 图、工作流设计器、字段依赖图中的裸 ReactFlow
- **字典项**：新增「请假类型」（年假/病假/事假/婚假/其他）与「AI 点踩理由」（不准确/不相关/有害信息/其他）字典

### Changed

- **导出流程重构**：`ExportButton` 重构为基于 `useExportJobRunner` hook 的统一导出作业流程，简化调用并增强可复用性
- **枚举标签统一收敛**：全站枚举标签迁移至共享常量或字典（禁止页面内联定义并写入核心规范），覆盖支付渠道/通知渠道/支付状态、AI 提供者、工作流审批方式与实例/任务状态、审批状态、用户反馈类别与状态、文件存储提供方、导出中心状态、监控指标、设备类型/消息类型、报表数据源与字段类型、公告类型与优先级等
- **细节优化**：数据源页面「最近测试」「创建时间」列宽调整

---

## v0.87.0 - 2026-07-09

### Added

#### 意见反馈（全局用户反馈闭环）

- **用户反馈入口**：用户头像下拉菜单新增「意见反馈」项，点击唤起 Semi Design `Feedback` 组件弹层（右下角浮出，不打断当前操作），支持五星满意度评分、分类单选（功能建议 / 问题反馈 / 体验问题 / 其他）、文本描述（评分与内容至少填一项），提交后展示「感谢您的反馈」完成态，并自动附带当前页面路由便于定位问题来源
- **入口系统开关**：新增系统配置 `feedback_entry_enabled`（默认关闭），控制反馈入口显隐；关闭时用户侧完全不可见
- **后台管理页**：系统设置下新增「意见反馈」菜单（`/system/feedbacks`），支持关键词 / 分类 / 状态 / 提交时间范围筛选、处理弹窗（状态流转 pending → processing → resolved / ignored + 处理备注，自动记录处理人与处理时间）、批量删除、导出中心 Excel / CSV 导出；当入口配置关闭时页面顶部 Banner 提示当前状态并提供「前往系统配置开启」快捷链接
- **后端接口**：`POST /api/feedbacks` 提交（所有登录用户可用，幂等防重复提交）；列表 / 处理 / 删除接口带 `system:feedback:list|handle|delete` 权限码与操作审计（含处理前后快照 diff）；新表 `user_feedbacks`（提交人 / 评分 / 分类 / 内容 / 来源页面 / 处理状态四态枚举 / 处理人）
- **Demo 演示模式**：MSW Mock 全覆盖（列表筛选 / 提交 / 处理 / 批量删除），种子数据含 4 条覆盖全部状态的示例反馈

### Infrastructure

- **TypeScript 6 兼容包别名（消除 tsc bin 冲突）**：按 TS 7.0 官方迁移指引，将 4 个 `package.json` 中的 `typescript@^6.0.3` 改为 `npm:@typescript/typescript6@^6.0.2` 别名。兼容包提供 `tsc6` 可执行文件（不再与 TS7 的 `tsc` 同名冲突），从根源上保证 `npx tsc` 确定性指向 7.0.2 原生编译器；同时继续 re-export TS 6.0 programmatic API，typescript-eslint 等依赖 peer dependency 的工具不受影响

---

## v0.86.0 - 2026-07-09

### Infrastructure

- **接入 TypeScript 7 原生编译器**：新增 `@typescript/native`（`npm:typescript@^7.0.2`）依赖，`tsc` CLI 使用全新 Go 原生编译器构建；`typescript-eslint` 仍解析到原有 `typescript@6.0.3`（保留其依赖的 programmatic API），两者并存互不冲突，无需改动任何 tsconfig 严格性配置。实测 server/web 冷构建耗时提速约 4-5 倍（server 116.6s → 29.2s，web 65.6s → 13.4s）。
- **修复 Docker 构建失败（node-pty 原生编译缺工具链）**：`packages/server` 生产依赖 `node-pty` 不提供 Linux 预编译二进制，安装时需 `node-gyp` 从源码编译，缺 Python3/C++ 工具链导致 `builder`/`server` 两个镜像阶段构建失败。`Dockerfile` 补充 `apk add python3 make g++`；生产阶段（`server`）额外保留运行时依赖的 `libstdc++`，构建工具装入可清理的 apk virtual 分组，`npm ci` 完成后立即删除，避免镜像体积膨胀。经 `docker build` 全量验证及容器内 `node-pty` 运行时冒烟测试确认修复有效。

---

## v0.85.0 - 2026-07-08

### Added

#### 偏好设置（对标 vben / soybean / pure-admin 全面增强）

- **面板分组导航**：偏好面板 30+ 设置项重组为「布局 / 外观 / 导航与工具栏 / 侧边栏 / 通用 / 表格 / 标签页」7 个分区（带横线分区标题，搜索时自动隐藏保持扁平结果）
- **全局圆角调节**：新增「圆角大小」偏好（直角 / 小 / 默认 / 大），通过覆盖 body 上的 Semi 圆角 token 生效，Portal 弹层与全站自绘元素同步跟随
- **深浅色切换圆形扩散动画**：基于 View Transition API，从点击位置扩散切换主题；不支持的浏览器与 `prefers-reduced-motion` 自动降级
- **复制 / 导入偏好**：一键复制偏好 JSON 到剪贴板；导入侧带 key 白名单 + 类型 + 枚举合法值三重校验，未知字段自动忽略
- **登录默认页面**：登录成功后跳转指定页面（可搜索的菜单选择器）；仅登录落地生效，不影响日常点击「首页」菜单；覆盖账号 / MFA / 注册 / LDAP / OAuth / 企业 SAML 全部登录路径
- **页面加载进度条开关**：路由切换顶部进度条可关闭
- **全局快捷键开关**：统一管控 Alt+L 锁屏 / Alt+S 侧边栏 / Alt+C 内容全屏 / Ctrl+K 命令面板；Esc 关闭行为不受影响
- **无操作自动锁屏**：5 / 10 / 30 分钟无操作自动锁定屏幕（需开启屏幕锁），切回标签页重置计时
- **减弱动效**：一键禁用路由 / 标签页 / 主题切换等装饰性动画与过渡（加载指示保留），适合低配设备与动效敏感用户
- **退出登录二次确认开关**：可关闭退出确认弹窗直接退出
- **谷歌（Chrome）标签页风格**：标签页新增第 4 种风格——激活标签连体式圆弧造型 + 悬停浮动圆角矩形 + 相邻分隔线，还原现行 Chrome 浏览器形态

#### 消息中心（Phase 3 富媒体）

- **视频消息、自定义表情、群邀请链接与入群审批**
- **群聊治理**：禁言 / 解除禁言 / 全员禁言开关 / 设置管理员角色
- **会话归档与定时消息**：会话归档管理，支持创建定时发送消息
- **发送限流与成员缓存**：聊天消息发送接入限流规则，会话成员内存缓存降低数据库访问

### Changed

- **设计 token 治理（圆角 / 颜色 / 阴影全站统一）**：
  - 圆角：478 处字面量（CSS 142 + TSX 内联 336）迁移为 `var(--semi-border-radius-*)`，「圆角大小」偏好全站真正生效；Chrome 标签造型值、圆形 / 胶囊等形状值显式保留
  - 颜色：26 处状态语义色（密码强度、进程监控、工作流状态等）迁移为 `var(--semi-color-danger/warning/success/info)` 等语义变量，修复暗色模式下的刺眼异物；图表 canvas 色板、主题定义源头、品牌装饰经审计后保留
  - 阴影：12 处自写黑色阴影迁移为 `var(--semi-shadow-elevated)`（暗色自动适配），方向性 / 强调性投影显式豁免
- **修复悬浮展开侧边栏刷新失效**：开启「悬浮展开侧边栏」后刷新页面，侧边栏正确保持收起；开关切换即时联动收起 / 还原
- **工作流节点卡片阴影架构简化**：移除永远无效的 `--semi-shadow-elevated-hover` 变量包装与冗余暗色覆盖块

### Fixed

- **进程页 SSE 状态光环失效**：状态色变量化后 hex 透明度拼接产生非法 CSS，改用 `color-mix()` 修复
- **偏好面板标签页风格选项换行**：「Chrome」文案改为「谷歌」，与其余两字选项等宽

### Infrastructure

- **stylelint 接入（token 纪律防复发）**：新增 3 条守门规则（禁字面量圆角 2~14px / 禁非白界面色 hex / 禁纯黑自写阴影），设计特区（大屏 / 打印 / 登录页）整文件豁免，存量刻意保留处逐一显式注明理由；ESLint 同步新增 2 条 TSX 内联样式 AST 规则；`lint` 脚本与 CI 自动带上 stylelint

---

## v0.84.0 - 2026-07-07

### Added

#### 会员中心（等级成长闭环 + 运营能力对标主流）

- **成长值闭环**：签到 / 补签的经验奖励同事务累加 `growthValue` 并按等级门槛自动升降级；新增后台「调整成长值」接口与入口（`POST /api/members/{id}/growth`，审计 + 幂等）；手动指定等级时自动抬升成长值至门槛，防止后续自动定级回退
- **会员标签 / 分群**：新表 `member_tags` + `member_tag_bindings`；标签 CRUD（会员管理页「标签管理」弹窗）、单会员设置标签、批量打标签，列表 / 详情 / 导出支持标签展示与 `tagId` 筛选，含 3 个示例种子标签
- **积分兑换优惠券**：券模板新增「兑换积分」字段；前台「我的卡券 → 积分兑换」Tab（`GET /coupons/exchangeable` + `POST /coupons/exchange`），事务内条件扣积分（防超扣）+ 发券（防超发 / 限领），双向流水标记，幂等保护
- **券码核销工具**：领券记录页新增核销弹窗（按券码查询预览 → 确认核销），`GET /api/coupons/code/{code}` + `POST /api/coupons/redeem`（审计 + 幂等 + `manual_redeem` 来源标记，原子条件更新防双花）
- **会员站内通知**：新表 `member_notifications`；前台消息中心页（列表 / 未读数 / 单条已读 / 全部已读），侧边栏与移动端 TabBar 未读红点（60s 轮询）；已接入生日礼到账、券到期提醒、管理员积分 / 余额调整、邀请奖励四类通知
- **邀请裂变**：会员邀请码（懒生成、部分唯一索引）+ 邀请关系（`invited_by`）；注册支持邀请码（弹窗输入 + 链接 `#/?invite=CODE` 预填），邀请人按 `member_invite_reward_points` 配置自动得积分（流水幂等）；前台邀请页（邀请码 / 链接复制、已邀人数、累计奖励、最近邀请）
- **生日礼自动发放**：生日当天自动发积分 / 优惠券（`member_birthday_points` / `member_birthday_coupon_id` 配置），按年幂等防重发
- **账户自助注销**：`POST /api/member/auth/deactivate`（密码或短信验证码验身 + 限流），软删除 + 强制下线；前台个人设置「危险区」入口
- **会员软删除**：删除会员改为软删除（保留积分 / 钱包流水、券码、签到等审计数据），`phone` / `email` / `username` 改部分唯一索引，注销后标识符可再次注册；全链路（认证 / 列表 / 导出 / 统计 / 发券 / 补签）过滤已删除会员
- **等级折扣消费侧落地**：`member-benefits.service` 提供 `getMemberDiscount()` / `applyDiscount()` 供订单链路调用；前台 `GET /api/member/benefits` 返回当前折扣与升级差距，等级权益页展示升级进度条
- **会员数据例行维护**：系统周期任务 `member-housekeeping`（每日 02:10）——到期券批量置 expired、积分不活跃过期（`member_point_expire_days`，expire 流水可审计）、生日礼发放、券到期提醒通知、登录日志清理（`member_login_log_retention_days`）
- **流水导出**：导出中心新增 6 个会员实体（积分流水 / 钱包流水 / 领券记录 / 签到记录 / 充值记录 / 会员登录日志，`execution: auto` 大数据量自动转异步），对应列表页接入导出按钮
- **补签原因**：管理端补签必填原因（记入签到备注与操作审计），签到记录新增备注列
- **RFM 看板增强**：会员看板新增「活跃分层」（7 天 / 30 天 / 90 天 / 沉睡 / 从未登录）与「充值能力分层」两张图表
- **会员画像增强**：详情侧滑补充成长值 / 经验、标签、邀请码 / 邀请人 / 已邀人数、累计签到、绑定公众号粉丝
- **前台移动端 TabBar**：会员中心 ≤768px 视口改用底部固定 TabBar（首页 / 卡券 / 签到 / 消息 / 我的），消息项带未读徽标

#### 定时任务

- **执行统计增强**：任务统计支持 P95 耗时、最近执行状态与连续失败次数

#### 移动审批轻页

- **底部标签栏与发起入口**：新增底部 TabBar 与发起申请按钮；**连续审批与批量同意**：审批完成自动跳转下一条待办，支持批量同意模式与页面切换动画；**移动端自选审批人**：新增审批人选择组件（单选 / 多选），整合审批链路预测

### Changed

- **资金调整幂等加固**：积分调整、余额调整、钱包退款、发券接口统一挂 `idempotencyGuard`，防双击 / 网络重试重复入账；调整类操作校验会员存在且未删除，并向会员发送变动通知
- **看板统计口径**：会员总量 / 余额 / 积分等统计一律排除软删除会员
- **登录日志治理**：`member_login_logs` 新增 `(member_id, created_at)` 复合索引
- **前端缓存策略**：会员域全部 mutation 由全量失效改为按资源段精准失效，修复重置密码后缓存未回源问题
- **下拉刷新**：支持鼠标拖拽操作

### Fixed

- **等级折扣字段空转**：`member_levels.discount` 此前无任何消费场景，本版接通查询与计价入口
- **券过期统计失真**：到期未使用券此前不会被置为 `expired`，现由每日任务批量修正

---

## v0.83.0 - 2026-07-06

### Added

#### 文件存储

- **对象读写权限（canned ACL）**：文件存储配置新增对象 ACL 选项（default / private / public-read / public-read-write，default 为继承 Bucket），上传链路（简单上传 + 分片初始化）按配置注入各云厂商 ACL 头（OSS / S3 / COS / OBS / BOS）；shared 新增 `FILE_OBJECT_ACL_SUPPORT` 支持矩阵，前端选项、Zod 校验、上传链路三处共用；配置表单含 S3 桶 ACL 禁用与公共读风险提示；云厂商拒绝设置 ACL 的已知错误统一映射为友好业务提示

#### 站内信

- **批量操作**：我的消息页面支持多选，新增「批量标记已读」「批量删除」（`POST /api/in-app-messages/batch-read`、`DELETE /api/in-app-messages/batch`），仅作用于当前用户自己的消息，操作后顶栏未读角标经 WS 实时同步

### Changed

- **审批结果通知类型**：站内信「审批被驳回」由 错误(error) 调整为 警告(warning)，「流程已撤回」由 警告(warning) 调整为 通知(info)，避免正常业务结果被误读为系统故障
- **移除侧边栏待办角标**：工作流「待我审批」菜单不再展示待办数量红点角标（WS 实时刷新与新待办弹窗提醒保留）
- **空状态插画统一**：纯展示型空状态（顶栏公告 / 消息弹层、任务托盘、我的消息、公告中心、表单未选择）由带添加符号的 NoContent 插画更换为中性 Idle 插画，仅保留真正可添加数据场景使用 NoContent；业务表单组件缺失改用 Failure 插画
- **移动审批轻页样式**：调整高度与滚动行为，改善页面滚动体验

### Fixed

- **Modal 底部间距**：`footer={null}` 的弹窗底部间距缺失（Semi 默认由 footer margin 提供），全局补齐 body 为最后元素时的 20px 底部内边距
- **MSW handler 顺序**：站内信批量删除 mock 注册顺序在 `/:id` 之后导致被吞掉，调整为优先匹配

---

## v0.82.0 - 2026-07-05

### Added

#### 工作流引擎（体验对齐钉钉 / 飞书）

- **移动审批轻页**：全新独立 SPA 入口 `/approval.html`（后台头像菜单 → 移动审批），与后台共享登录态；四 Tab（待办 / 已办 / 我的申请 / 抄送我）+ 待办数与抄送未读角标、关键词搜索、下拉刷新、触底自动加载；卡片式列表展示摘要字段 / SLA / 优先级 / 发起人头像，支持「极速同意」卡片直批（无签名、无下游选人时可用，服务端校验兜底）；审批详情整页滚动分区（当前进度提示 → 表单 → 流转记录 → 沟通评论），支持节点字段权限过滤与可编辑字段提交、手写签名、审批意见快捷短语、底部操作抽屉（同意 / 驳回 / 转办）；发起人可撤回 / 催办；发起申请支持流程搜索与最近使用置顶；业务表单与自选审批人场景自动引导回桌面端
- **表单字段权限运行态闭环**：节点级字段权限（隐藏 / 只读 / 可编辑）在发起表单、审批详情、审批提交（`formUpdates` 白名单合并）三处全链路生效，前后端共用同一套纯函数
- **实时待办与通知**：新增待我审批总数接口 + 侧边栏菜单待办角标，WebSocket 工作流事件前端消费（新待办 / 审批结果 / 抄送即时 Toast，可点击跳转）
- **列表摘要字段**：流程「更多设置」可配置最多 3 个表单字段作为列表摘要（钉钉式卡片摘要），待办 / 申请列表与移动轻页统一展示
- **实例挂起 / 恢复**：流程监控支持挂起（冻结审批超时与延迟唤醒作业，恢复按剩余时长重排）与恢复，挂起实例全端展示横幅并禁止审批
- **离职交接**：交接预览（检出写死审批人的定义）+ 一键批量转移待办任务，新增权限码 `workflow:task:handover` 与交接向导
- **评论增强**：评论支持回复引用（父评论摘要）与附件；全部工作流站内信携带深链，消息中心 / WS 弹窗点击直达对应单据（待办 / 我的申请 / 抄送三页支持 URL 参数自动打开详情）
- **任务转办明细**：新表 `workflow_task_transfers` 记录转办 / 委派 / 改派 / 交接 / 超时转交全量明细，时间线逐条展示流转轨迹，防折返校验改查明细表

#### 报表中心

- **报表公开分享**：分享链接支持过期时间、访问日志（次数 / 最近访问）与访问频率限制
- **订阅 KPI 快照**：报表订阅推送当前 KPI 值与环比趋势；报警通知新增 Webhook 通道；数据集参数定义与可视化建模（数据集引用弹窗）

### Changed

- **工程加固**：事件订阅密钥与远程数据源请求头改为 AES-256-GCM 加密存储（读取脱敏 `******`）；工作流事件 payload 列 text → jsonb；补充 biz_key（含租户）、迁移记录 FK 等索引与约束
- **测试补齐**：新增中间件（IP 访问控制 / 开放 API 网关 / 路由守卫）、查询构造辅助（keywordCondition / withPagination）、并发受限映射、请求辅助、会员认证、支付可靠性链路 DB 集成等 170+ 单测

### Fixed

- **种子菜单 ID 冲突**：审批代理菜单 id 与引擎运维按钮重复（478）导致被静默丢弃，调整为 898 并连续化排序
- **WS 推送字段误用**：工作流事件 `instanceTitle` 误取节点名，修正为实例标题
- **工作流模拟数据**：待办任务补齐 `signatureRequired` 字段，与真实接口对齐

---

## v0.81.0 - 2026-07-05

### Added

#### 支付中心（阶段一 ~ 五）

- **正确性与自动化闭环**：下单业务幂等（活跃单复用 + 部分唯一索引兜底）、费率计提竞态修复（条件 UPDATE claim + 台账幂等索引）、结算批次幂等、风控日累计仅统计已支付订单、回调失败 ACK 触发渠道重发；分账自动化（接收方 autoShare + 失败重试 cron）、T+1 自动结算、对账差异处理流（调账自动记台账 + 新权限 `payment:recon:handle`）
- **资金能力扩展**：转账/代付新模块（`payment_transfers` 表 + 幂等键 + 重试上限防双付 + 主动查单 cron）；微信真实分账、商家转账到零钱与交易账单下载；支付宝单笔转账；渠道账单自动拉取对账（每日 cron + 手动触发）
- **体验与生态**：聚合收银台一码多付（UA 识别环境智能推荐支付方式、支付链接 token 轮换）；财务报表日切快照（cron 重建 + 历史走快照 + 环比对照）；支付运维健康指标卡；云闪付（银联全渠道）新渠道；App 应用维度（`payment_apps` + appKey 下单路由）

#### 数据分析

- **埋点 SDK 加固**：采集文本脱敏与敏感元素跳过、卸载兜底 sendBeacon 分片、事件类型远程开关与配置就绪前缓冲、最大滚动深度、rage click 连击检测、白屏检测、客户端时间戳离线保真
- **查询与告警**：趋势查询走每日预聚合（五维 rollup），漏斗/留存纯 SQL 化去内存截断；错误告警实时评估 + 触发历史表与「告警历史」Tab；自定义时间区间与环比对照、漏斗报表保存、零配置全页热力图、会话时间轴回放、维度交叉堆叠分析、实时看板 WS 推送
- **治理与安全**：字典 blocked 事件入口拒收、IP 匿名化存储、SourceMap 上传大小限制、会话/影响用户数原子回写修正

#### 系统管理

- **页面缓存 keepAlive**：基于 React 19 `<Activity>` 的路由级页面缓存，菜单管理按页配置，多页签切换保留搜索条件/滚动位置等状态，关闭页签即释放（LRU 上限 10 页）
- **外链菜单内嵌打开**：外链支持 iframe 内嵌模式，保留侧边栏与页签
- **用户组绑定角色**：用户组可绑定角色并向组内成员继承权限
- **租户自动化**：租户创建自动初始化与到期巡检自动化
- **安全加固**：系统管理 P0 安全加固三项

#### 其它

- **数据网格**：表尾常驻快速输入草稿行，点击即新增
- **CI**：新增持续集成工作流（lint / test / build）

### Changed

- **工作流巨石拆分**：`workflow-instances.service.ts` 按业务域拆为 17 个子模块（无环 DAG）、路由拆为 12 个分组文件（OpenAPI 61 操作零 diff）、表单设计器 FieldConfigPanel 1965 行拆为 13 个文件
- **会话续期**：Redis GETEX 原子化续期 + lastActiveAt 节流，减少往返
- **前端查询规范**：接入 `@tanstack/eslint-plugin-query` 静态检查

### Fixed

- **菜单编辑回显错误**（数据级）：Semi Form field 级 `initValue` 覆盖编辑回显值，导致「页面缓存/排序/是否外链/打开方式」四字段永远显示默认值且保存时覆盖数据库真实值
- **keepAlive 页签切回状态丢失**：用户管理部门树、字典项、AI 服务商分组、Docker 分组的「数据加载→重置展开状态」effect 在页签切回时重放覆盖用户操作，统一加初始化守卫（init-once / seen-ref / per-dict）
- **全局分页页码越界**：`usePagination` 内置页码钳制，删除（单条/批量）后停留空页的问题在 110+ 列表页统一修复
- **系统管理安全加固**：菜单父级存在性 + BFS 环引用校验、地区多层环引用校验、用户自我删除/禁用四入口拦截、岗位更新补审计 after 数据、批量删除返回实际删除行数

### Docs

- 清理各模块文档中装饰性的代码文件路径引用

---

## v0.80.0 - 2026-07-04

### Changed

#### 数据库 Schema 按业务域拆分

- **schema 多文件化**：5500+ 行单体 `db/schema.ts` 按业务域拆分为 `db/schema/` 下 29 个文件（`core` / `payment` / `workflow` / `member` / `mp` / `report` 等），143 个 `xxxRelations` 统一收敛至 `relations.ts`；`schema.ts` 改为纯 re-export barrel，全仓 230+ 处导入方式与 drizzle 配置零改动。拆分经导出清单快照对比（482 项完全一致）与 `drizzle-kit generate` 零 diff 双重验证
- **迁移基线化**：201 条历史迁移压缩为单条基线迁移，全新环境初始化更快、迁移目录更易维护

#### 首屏性能优化（首屏 JS gzip 2.20MB → 0.58MB，−74%）

- **入口静态图治理**：VChart 主题初始化从入口下沉至图表收口模块；PDF 预览面板（@embedpdf ~1MB）、快捷聊天、音视频通话宿主、聊天通知、锁屏（lunar 农历）全部改为懒加载；拼音搜索词典（pinyin-pro ~290KB）改为空闲预热的异步单例，未就绪时自动回退子串匹配
- **分包策略迁移至 rolldown 原生 `codeSplitting.groups`**：修复 manualChunks 兼容层静默改写分组导致 react 运行时被并入重型 vendor 包、`__vitePreload` helper 被打进 PDF 引擎包等问题；react 运行时与 Vite 虚拟模块设最高优先级独立分组；关闭组递归捕获避免公共内件被巨型组吞并；semi-foundation 按模块拆分
- **Semi barrel 摇树修复**：官方 barrel 因内联 base.css 被声明为 sideEffect，导致 AIChatDialogue（tiptap/prosemirror）、MarkdownRender（acorn）等重组件无条件进入首屏；通过本地无副作用影子 barrel + 精确别名接管裸导入恢复摇树，base.css 改由入口显式引入
- **lucide 图标双实例隔离**：全量图标注册表（~600KB）改为从独立模块实例异步加载（`useLucideIconsReady` / `useAllIconNames` 钩子），静态按需图标走自动分包，各页面仅携带自己使用的图标
- **@zenith/shared 声明 `sideEffects: false`**：修复入口因引用常量被迫携带 zod schema 与 demo 种子数据的问题（种子数据不再进入生产包）
- **member 前台入口**：移除多余的 VChart 主题静态初始化（前台无图表页面）

#### 前端数据获取规范统一

- **TanStack Query 重构**：工作流（待审批 / 模板 / 触发器执行 / 保存视图）、用户数据权限与菜单权限、会员管理等模块改用 react-query 域 hooks 管理服务端状态，移除手写 loading / fetch / useEffect 拉取模式，统一缓存失效策略
- **文档**：新增前端数据获取与服务端状态规范文档

### Fixed

- **代码质量**：清零全仓 eslint error（移除工作流实例服务中已由 `workflow_jobs` 账本取代的死代码 `wakeAt` / `timeoutAt` / `isPending`、身份提供者服务未使用变量、工作流版本比较冗余常量等 7 处）
- **错误监控文档**：补充 Promise 拒绝与 ApiError 处理说明

### Docs

- **文档瘦身**：移除各模块文档中的「相关文件 / 实现位置 / 相关目录」类源码路径清单段落（易过时且用户可自行检索），IAM 前端页面表保留路由与交互说明、去除文件路径列

## v0.79.0 - 2026-07-03

### Added

#### 数据库管理（自研 DataGrid 数据网格）

- **通用虚拟滚动数据网格**：新增 `data-grid` 通用组件（TanStack Virtual 行虚拟化、滚动分页加载、键盘导航、区域/离散/整行选区、TSV/CSV/JSON/Markdown 复制、类型化单元格渲染、列宽采样自适应与持久化、主键固定列、单元格详情抽屉转置视图、明暗主题自动适配），数据库管理「数据」页替换旧即时保存表格
- **内联编辑（暂存-预览-事务保存）**：借鉴 dbx 编辑模型——字符串态编辑+提交时类型 coercion（NULL 关键字/大整数防精度/智能弯引号），类型化编辑器（枚举下拉/日期时间/布尔/JSON/文本），单行编辑器像素级贴合单元格；暂存按主键定位跨刷新稳定，脏格角标高亮，保存条 Monaco SQL 预览，新增 `batch-mutate` 单事务接口（整体成功或回滚+审计）；显式展示五种只读原因（权限/视图/物化视图/系统表/无主键）
- **编辑闭环**：新增行（表尾绿色草稿行）、删除标记（红色删除线）、100 快照撤销/重做（Ctrl+Z / Ctrl+Shift+Z）、Ctrl+V 粘贴 TSV 逐格类型转换、SQL 预览含 INSERT/UPDATE/DELETE
- **排序**：表头下拉五项排序菜单（数据库升/降序、当前页本地升/降序、清除），本地排序 NULL 恒尾+类型感知+稳定排序；stale-while-revalidate 实现排序/筛选切换零闪烁
- **M5 浏览增强**：WHERE 快捷条（原生 SQL 片段过滤，后端 sanitize+只读事务+权限校验）、Ctrl+P 快速打开（多级模糊打分搜表）、行状态筛选（全部/已修改/新增/删除）、右键克隆为新行（自动清空主键）、右键导出 XLSX/CSV/Markdown（选区或已加载行，jszip 手写最小 XLSX）、图片 URL 单元格预览角标
- **SQL 控制台换装**：查询结果集改用只读 DataGrid（虚拟滚动、区域复制、详情抽屉），保留服务端分页
- **Excel 粘贴导入**：导入弹窗新增「从 Excel 粘贴」页签，内嵌懒加载 Univer 可编辑表格，粘贴后列映射+事务导入

### Fixed

- **数据库管理**：双击左侧表名导致结构/数据显示为空（同表重复选中改为忽略，顺带避免同表点击丢弃暂存修改）；新增行被滚动加载推入已有行区间；固定列 sticky 失效导致表头与数据列错位

## v0.78.0 - 2026-07-02

### Added

#### 任务中心（通用异步任务框架）

- **任务中心框架**：新增 `async_tasks` 表与 `lib/task-center/` 通用异步任务框架（迁移 0199/0200）——业务模块通过 `registerTaskHandler` 注册任务类型、`submitAsyncTask` 提交任务，pg-boss 队列执行；`ctx.progress()` 一次调用完成进度上报、断点（checkpoint）持久化、心跳刷新与 WS 推送（`task:progress`，300ms 节流）；协作式取消、断点恢复（保留进度续跑）、重新开始（清空进度重跑）；每分钟兜底扫描回收心跳超时的卡死任务并从断点重投（崩溃/重启恢复），每日自动清理超过保留期的已结束任务
- **自动重试**：任务类型可声明 `maxAttempts` + `retryDelayMs`，失败自动按指数退避重试（上限 15 分钟），断点保留、从中断处续跑；退避中的任务显示「等待重试」并可随时取消
- **任务项明细**：新增 `async_task_items` 表与 `ctx.reportItems()` API，行级处理状态（成功/失败/跳过 + 错误信息）按 `taskId+key` 幂等 upsert，重试自动覆盖；详情抽屉支持按状态筛选分页查看，适配导入类场景的逐行错误报告
- **幂等提交**：`submitAsyncTask({ idempotencyKey })` 相同 key 重复提交直接返回已存在任务（唯一索引兜底），防止重复点击
- **类型级运行时策略**：新增 `async_task_type_configs` 表，任务中心「任务类型」页可覆盖注册默认值——暂停提交、允许并发、最大执行次数、重试退避、记录保留天数（权限 `system:async-task:config`）
- **任务中心管理页**：系统设置 → 任务中心（权限 `system:async-task:list/manage/cleanup/config`），统计卡（状态计数 / 近 24h 平均耗时 / 近 7 天提交趋势）+ 全局任务列表（类型/状态/关键词/提交人筛选、批量取消、批量删除、清理过期记录）+ 详情抽屉（参数/结果/错误/行级明细）
- **全局任务托盘**：顶栏「我的任务」入口跨页面展示当前用户进行中与最近完成的任务，Badge 实时计数、Popover 内进度条与快捷取消
- **业务示例页**：业务示例 → 异步任务示例（`/biz/task-demo`），可交互演示提交/实时进度/取消/断点恢复/重新开始/自动重试/行级明细/重复提交拦截；MSW Mock 完整支持 Demo 演示模式
- **文档**：新增 `docs/backend/task-center.md`（架构 / 接入三步 / TaskRunContext API / 自动重试 / 生命周期 / API 一览），WebSocket 事件清单补充 `task:progress`

#### 工作流

- **业务编号生成**：流程定义支持业务编号生成配置与预览（结构化 / 自定义模板两种模式）
- **运维动作预览**：工作流引擎运维动作支持执行前预览（按实例 ID / 入库时长筛选，返回将被处理的作业统计与样本）

#### 系统调度

- **执行节点分页**：节点列表接口与页面改为分页展示，适配长期运行积累的大量节点记录

### Changed

- **工作流监控**：组件健康状态统计与样式优化（ComponentRow 重构、Tooltip 描述）
- **任务中心列表**：操作列/时间列宽度优化，避免换行

### Fixed

- **流程发起表单**：标题生成时间格式补全至 `YYYY-MM-DD HH:mm`

## v0.77.0 - 2026-07-01

### Added

#### 工作流补偿 / Saga

- **补偿 / Saga 能力**：节点级统一失败策略（重试 / 补偿 / 兜底 / 通知 / 终止 / 继续）；新增反向动作作业 `compensation_action`（http / 连接器 / 短信 / 邮件 / 回填）；补偿工单支持处理历史、附件、恢复续跑与重试；Saga 反序回滚；subProcess 接入统一失败策略；设计器新增失败策略编辑器与工单详情抽屉（迁移 0198）
- **撤回申请**：工作流实例支持发起人撤回申请（DTO 新增 `allowWithdraw`）

#### 工作流监控

- **监控指标与操作**：扩展监控指标类型，支持死信聚类与条件重放

### Changed

- **导出中心原生化**：移除 legacy 兼容层，将地区 / 部门 / 岗位 / 角色 / 字典 / 租户 / 系统配置 / 文件配置 / 定时任务 / 进程 / 公告 / 登录 · 操作日志 / 邮件 · 短信发送记录 / 会员 / 频道订阅者 / 埋点 / 支付订单 · 退款 / 流程实例共 21 个导出重写为原生 `defineExport`（真实 `countRows` + `streamRows` + 结构化列），删除约 788 行死代码；列渲染声明式化（datetime / enumMap / money / boolean）
- **重放过滤器界面**：使用 Form 组件重构并增加表单字段，提升筛选体验

### Fixed

- **导出进度显示 0 条**：修复地区等导出完成后「进度」列恒显示 0 条的问题——流式导出（Excel / CSV）新增行数统计，任务完成后回写真实行数
- **数据库迁移**：修复全新（未 seed）数据库上执行数据迁移时的外键安全问题 (#6)

## v0.76.0 - 2026-06-30

### Added

#### 工作流发起 / 审批体验重构

- **两栏布局**：发起与详情/审批页改为左右两栏（左表单 + 右审批流程），以分割线替代卡片，流程图改为按钮触发的 SideSheet 查看
- **发起人自选审批人**：支持「发起人自选 / 发起人自选(范围)」节点，在审批链路时间线内内联选择，提交前校验必选
- **下一节点审批人自选**：支持「审批人自选」节点——上一审批人在通过时为紧邻的下一节点指定审批人，候选人按节点范围（成员/角色/部门/用户组）服务端解析收窄；新增 `/api/workflows/tasks/:id/selectable-next-approvers` 接口，`selectedNextApprovers` 支持按节点分组
- **一键快速同意**：无必填意见/签名/附件且下一节点无需自选时，「同意」分裂按钮可一步通过，下拉提供「填写意见后同意」
- **审批链路摘要与自动刷新**：链路顶部显示「共 N 步 · 约 M 人审批」，发起表单变更时防抖自动刷新预测链路，并提供手动刷新与预测失败重试
- **当前节点高亮**：运行态时间线高亮「轮到你处理」的待办节点
- **批量审批预标注**：待办列表对「需单独审批」（紧邻下一节点为自选）的任务加标签并禁用批量勾选

### Changed

- **审批操作分层**：审批操作按钮主次分层，次要操作（转办/委派/加签/减签/退回）收纳到「更多」菜单
- **节点配置抽屉**：加宽配置抽屉与「操作按钮」表格列宽，修正附件下拉选项显示截断
- **移动端体验**：抽屉底部操作条在窄屏改为全宽吸底、加大点击区
- **加载与视觉**：流程详情加载改为骨架屏；优先级在发起下拉与详情头部统一为彩色标签
- **统一模态框**：找回密码、强制改密、批量改密、镜像/网络/存储卷、SQL 控制台收藏等多处弹窗统一为 `AppModal`，统一表单校验与布局
- **发起防重**：发起接口增加幂等保护，前端提交携带幂等 key，避免双击/重试导致重复发起

### Fixed

- **附件预览**：修复文件预览地址重复 `/api/files` 导致表格（xlsx）预览失败的问题——从下载地址正确解析文件 ID
- **批量审批**：批量通过遇「下一节点自选审批人」任务时跳过并给出清晰提示，避免表单式报错语义不清

## v0.75.0 - 2026-06-29

### Added

#### 规则中心与决策表

- **决策表管理**：新增决策表创建、编辑、删除、发布、求值、测试和版本管理能力，并补充 MSW Mock 与数据库种子数据
- **决策表治理**：新增版本对比、版本回滚、发布门禁、网关治理、测试矩阵、执行 trace 和审计能力
- **业务接入**：优惠券发放支持接入决策表资格判定，工作流审批人来源支持从已发布决策表中选择

#### 工作流运维与运行时

- **异常补偿闭环**：新增异常补偿与人工修复工单闭环，补偿工单工作台 Tab 和积压趋势分析
- **死信与迁移**：新增作业死信中心，支持一键重放死信和失败原因聚类；运行中实例支持迁移到最新版本
- **连接器运行时**：工作流连接器 email/sms 运行时接入，数据分析新增自动化失败率、Webhook 成功率和子流程失败率等运维指标
- **操作按钮配置**：审批操作按钮支持附件上传策略，设计器保存节点时会持久化当前按钮状态到 `actionButtons`

### Changed

- **流程体检体验**：增强流程体检，发布前阻断严重问题，并在节点配置中内联展示严重问题和修复建议
- **规则中心体验**：优化决策表录入、编辑、测试交互，调整操作列高频按钮、弹窗布局、表头和编辑器对齐
- **界面细节**：优化侧边栏品牌区、标题、溢出处理和工作流组件健康矩阵卡片样式

### Fixed

- **审批退回**：退回目标限制为当前节点之前且已审批通过的节点，同时保持退回按钮按配置显示
- **审批附件**：修复工作流附件处理逻辑，避免将空附件写为 `null`
- **工作流接口**：统一补偿接口路径为 `/api/workflows/compensation`
- **埋点上报**：重试队列按批次上报，避免超过后端限制后持续堆积
- **调度清理**：清理已迁移的旧工作流 Cron 任务，补充对应数据库变更脚本

## v0.74.0 - 2026-06-28

### Added

#### 工作流引擎与诊断

- **显式执行 Token 引擎**：新增显式执行 Token 模型与纯函数推进逻辑，替代隐式节点状态推导，并补充活动 Token 统计、视图展示和数据库集成测试
- **Token 运维能力**：新增跳过卡死 Token、从 Token 节点重放流程、批量推进卡死实例和实例诊断包导出能力
- **链路追踪诊断**：新增请求链路追踪中间件、traceId 作业链路查询、traceId 诊断包导出和按筛选条件批量重放投递能力
- **流程健康检查**：增强流程定义健康检查，支持表单字段解析、表达式与条件字段引用校验，以及版本结构差异对比

#### 工作流连接器

- **连接器管理**：新增工作流连接器创建、编辑、删除、测试和凭据管理能力，并接入触发器节点配置
- **连接器调用治理**：新增连接器熔断、限流开关、时间窗、最大调用次数、调用统计和最近调用记录能力

#### 流程设计器与仿真

- **审批人预览**：新增审批人预览抽屉，支持基于表单数据和发起人实时预览审批链路并展示体检结果
- **仿真用例管理**：新增仿真用例保存、列表和删除能力，支持按流程定义归档、重名覆盖和数据库持久化

### Changed

- **流程设计器体验**：移除草稿审批链路预览功能，统一到新的审批人预览能力，并优化节点配置抽屉建议文本间距
- **待审批列表**：调整待审批页面操作列宽度，改善操作按钮展示空间
- **依赖升级**：升级 `mssql` 至 `12.6.0`，升级 `nodemailer` 至 `9.0.1`

### Fixed

- **工作流引擎**：修复节点缺少执行 Token 时的异常处理，并移除引擎诊断图表中不适用的堆叠配置

## v0.73.0 - 2026-06-28

### Added

#### 企业身份源与身份安全

- **企业身份源管理**：新增 OIDC、SAML、LDAP/AD 身份源管理能力，支持身份源创建、更新、删除、连接测试、用户搜索与同步
- **企业登录**：新增企业身份源登录入口、回调页面、SAML ACS 回调处理与票据交换接口，支持企业身份源选择登录
- **身份安全**：新增多因素认证、TOTP 绑定、登录风险策略与风险事件管理能力

#### 工作流引擎与监控

- **统一作业账本**：新增 `workflow_jobs` 与 `workflow_job_executions` 作业账本表，整合延时唤醒、事件派发、外部审批、子流程、任务超时、触发器调度与 Webhook 投递等异步任务处理
- **作业监控**：新增工作流作业列表、详情、重试、跳过、批量重试/跳过、作业摘要与按类型聚合的状态统计
- **引擎诊断**：新增工作流引擎健康快照、健康历史、队列积压、事件吞吐、实例生命周期、队列饱和度与实例运行轨迹视图
- **定义健康检查**：流程定义新增发布前健康体检，展示健康评分、分支覆盖分析与修复建议
- **版本对比**：流程定义新增版本差异对比，支持展示节点和连线的新增、删除与修改
- **仿真增强**：流程仿真新增耗时预估、阻塞点展示、当前步骤详情和节点可见性优化
- **SLA 展示**：待办任务新增 SLA 标签，展示任务时限状态与剩余时间

#### 系统调度

- **系统调度任务**：新增系统调度任务管理页面、运行日志查询、任务配置与手动执行能力
- **队列 Worker 描述**：增强工作流定时任务与队列 Worker 的标题、模块、描述、手动运行权限和运行状态展示

#### 报表与测试

- **报表设计器**：新增多屏轮播配置、页签栏、自动/手动切换控制与钻取面包屑
- **报表 Mock 与测试**：补充报表数据源、数据集、仪表盘 Mock 处理和冒烟测试，新增文件解析、格式化、AI 安全、预警、计算字段、数据集与数据源单元测试

### Changed

- **工作流调度架构**：移除旧的延迟恢复、事件交付、触发执行与子流程恢复逻辑，迁移到统一作业引擎和作业账本
- **工作流监控体验**：优化引擎诊断视图、作业类型面板、表格列宽、状态标签与监控页面批量操作体验
- **流程设计器体验**：优化仿真抽屉、节点卡片、发起人节点、调试模式、分支处理和画布节点可见性
- **页面布局规范**：补充页面级多 Tab 布局规范，并调整相关页面容器样式
- **报表数据处理**：优化数据集取数复用、CSV 解析、数据源类型、组件类型定义与敏感信息处理

### Fixed

- **工作流引擎**：修复时间条件查询、运维动作失败日志格式，以及事件派发错误信息和状态描述
- **公告管理**：修复公告页面分页逻辑，优化公告标签页、搜索工具栏、内容渲染和空状态展示

## v0.72.0 - 2026-06-27

### Added

#### 报表中心

- **报表设计器**：新增仪表盘设计页面、大屏画布模式、全局筛选器、组件配置面板与公开看板视图，支持拖拽缩放、主题背景和筛选联动
- **打印报表**：新增打印报表模板管理、打印设计器、数据渲染引擎与打印视图，支持模板 CRUD、数据填充和页面打印样式
- **数据源与数据集**：新增 MySQL、PostgreSQL、SQL Server 和静态数据源支持，提供连接测试、字段格式化、汇总行与物化快照刷新任务
- **报表组件**：新增矩形树图、散点图、漏斗图、雷达图、双轴图、桑基图、词云、热力图、水波球、图片、iframe、翻牌器和滚动榜单等组件能力
- **报表协作与预警**：新增仪表盘评论、报表订阅、Cron 表达式构建器、报表预警规则和多通知通道分发能力
- **报表 AI**：新增自然语言转只读 SQL 接口，支持通过自然语言生成报表查询语句

#### 开放平台

- **API Scope 与限流套餐**：新增 API Scope、限流套餐、开放平台统计页面和相关后台管理能力
- **OAuth2 应用增强**：新增限流套餐、API 范围和签名设置，菜单结构调整为统一归入开放平台
- **开放网关**：新增开放签名、网关中间件、开放 API 统计、应用 Webhook 与 SDK 示例页面

#### 导出中心

- **统一导出中心**：新增导出任务模型、导出任务页面、导出定义注册表、文件写入器与导出接口文档
- **统一导出按钮**：多个列表页改用 `ExportButton` 创建导出任务，支持动态查询条件、权限校验和移动端样式适配
- **生成文件入库**：新增生成文件保存能力，导出产物可纳入文件管理

#### 工作流仿真

- **流程仿真**：新增流程仿真服务、仿真数据结构、仿真抽屉、测试数据生成、用例保存与结果时间线展示
- **仿真交互**：流程设计器支持节点和分支点击、右键菜单、断点、条件命中原因、健康问题和决策选项展示
- **运行态展示**：工作流节点、发起人节点和节点卡片支持运行态高亮与当前状态显示

#### 终端与运维

- **终端工作区**：新增终端工作目录同步、当前目录打开终端、标签标题和状态栏显示能力
- **终端体验**：新增 WebGL 渲染、关闭未保存文件确认、WSL Bash 工作目录引导和终端分屏样式优化
- **Docker 容器操作**：终端侧新增容器启动、停止、重启、日志和统计信息查看
- **终端录屏**：新增 asciinema 录屏导出和按操作人、时间范围查询

#### 审计与日志

- **审计快照**：新增操作前后实体快照记录能力，支持在响应体为空时补充操作后数据
- **登录日志**：新增登录和登出事件类型记录
- **操作日志**：增强操作日志快照注入和响应体为空场景记录

#### 体验与基础能力

- **月历组件**：新增月历组件并在签到页和仪表盘中接入
- **移动端工具栏**：优化移动端操作按钮、导出按钮、搜索和重置按钮样式
- **依赖升级**：升级 React Router、Vite、Vitest、lucide-react、cron-parser、react-virtuoso、sql-formatter 等多项依赖

### Changed

- **导出架构**：多个业务模块从本地导出路由迁移到统一导出中心，后续又清理登录日志、操作日志、短信/邮件发送日志、公告、文件存储配置、进程、定时任务、工作流实例等模块的旧导出路由，简化接口维护面
- **报表页面**：优化打印设计器工作簿创建与样式映射，备注字段改为省略展示，组件元数据拆分到独立模块
- **支付示例**：优化支付接入示例的页面样式、支付时间列、操作列和信息提示
- **配置表格**：优化列过滤逻辑和类型定义，测试断言更新为更清晰的形式
- **文档与技能**：更新导出中心文档、后端接口约定及 Zenith 开发辅助技能说明

### Fixed

- **导出维护性**：移除多模块重复导出路由和处理逻辑，降低同类功能分散实现带来的维护成本
- **终端录制页面**：清理不必要的 ESLint 禁用注释并调整操作列宽度
- **着陆页资源**：删除不再使用的旧着陆页 HTML 输出文件

## v0.71.0 - 2026-06-26

### Added

#### 图表与分析增强

- **图表组件**：新增散点图、柱状图与组合柱线图配置能力，支持点击分布、登录统计、操作日志等分析场景使用统一图表组件展示
- **VChart 主题**：新增 Semi Design 半主题初始化能力，统一图表在后台主题下的视觉表现
- **留存分析**：留存数据改为热力矩阵展示，优化留存率的横向对比体验
- **登录日志统计**：重构登录统计可视化展示，使用新的图表组件和补齐后的每日统计数据
- **操作日志统计**：新增按星期操作分布图，便于观察操作活跃周期

#### 工作流诊断增强

- **工作流监控**：新增引擎诊断、引擎遥测与流程诊断视图，展示运行状态、风险标签和建议动作
- **运行时诊断**：优化流程监控运行时诊断 SideSheet，增强触发器执行映射和诊断信息展示
- **触发器调度**：新增触发器调度状态、尝试次数、开始时间、下一次重试时间和最近错误信息
- **请假工作流**：增强请假单提交与工作流实例关联逻辑，支持幂等保护和已提交单据的实例检查

#### 响应式表格与操作列

- **响应式表格**：新增移动端适配的紧凑分页配置，以及 `useMediaQuery` / `useIsMobile` 响应式 Hook
- **操作列**：新增统一的响应式操作列能力，支持桌面端内联高频操作、移动端自动收纳到更多菜单
- **列表页面**：数据库管理、文件管理、频道管理、容器管理、聊天机器人、防火墙、短信配置、邮件模板、公告管理等页面接入统一操作列

#### 用户管理

- **用户编辑**：编辑用户时支持维护用户名字段，并优化表单布局

### Changed

- **图表体系**：监控页面、操作日志统计、速率限制页面、工作流分析视图迁移到新的图表组件体系
- **行为分析**：行为热力图调整为点击分布图，并更新页面说明文档
- **图表配色**：统一图表配色常量和分析页面统计卡片颜色逻辑
- **可配置表格**：精简默认始终可见列配置，配合响应式操作列统一处理移动端展示
- **工作流设计器**：增强只读模式支持，高级设置改用表单级禁用逻辑，节点抽屉只读状态更稳健
- **请求处理**：后台和会员端请求错误提示接入统一 Toast 展示逻辑

### Fixed

- **工作流健康**：修复触发器卡住统计条件，纳入执行失败的触发器
- **工作流监控**：调整操作列宽度和滚动条宽度，优化遥测指标和诊断标签样式
- **构建质量**：修复 server 与 web 的 ESLint 报错，清理未使用导入、变量和失效注释

## v0.70.0 - 2026-06-25

### Added

#### 移动端体验优化

- **搜索工具栏**：全面升级移动端搜索工具栏，支持结构化模式——核心搜索常驻、高频筛选项常驻、低频筛选进底部抽屉、低频操作进「更多」菜单
- **工作流页面**：新增移动端等待阈值过滤器，优化分类按钮布局
- **支付页面**：新增渠道过滤器，优化移动端工具栏布局
- **数据库备份页面**：优化移动端操作按钮和筛选器布局
- **终端会话、文件管理、操作日志** 等多个页面完成移动端适配重构

#### 工作流引擎增强

- **子流程恢复**：新增 `recoverStuckSubProcesses` 定期扫描并恢复挂起子流程，支持多实例汇聚对账（`reconcileMultiSubProcess`）
- **延迟任务唤醒**：新增 `recoverDueDelayTasks` 定期扫描并自动唤醒已到期延迟任务
- **外部审批/触发器恢复**：新增 `recoverPendingExternalApprovals` 和 `recoverPendingWorkflowTriggers` 定时恢复机制
- **多实例支持**：新增 `parentTaskItemKey` / `parentTaskItemIndex` 字段，完善超时处理与异常捕获节点兜底
- **分支/环路并行网关**：新增 `makeBranchedFlow`、`makeLoopBackParallelFlow` 函数
- **工作流实例**：新增 `currentNodeKeys` / `currentNodeNames` 字段，增加幂等性保护
- **健康巡检**：新增工作流健康巡检接口，支持阈值查询，返回任务和事件健康状态

#### 支付接入示例

- 新增完整支付接入示例（`payment-example`），含创建示例单、发起支付、模拟支付成功及履约逻辑
- 新增「业务接入实战示例」文档

#### 功能增强

- **移动端导航**：新增移动快速页面面板（已打开页面 + 最近访问记录）；新增移动端导航头部和侧边栏
- **用户/部门/角色/租户/地区管理**：新增 Excel / CSV 导出功能
- **用户管理**：新增用户导入功能
- **菜单管理**：重构搜索工具栏，支持移动端适配
- **字典管理**：新增字典项搜索和状态过滤

### Changed

- 进程管理最后更新时间统一使用 `formatDateTime` 格式化
- 多个页面操作按钮渲染逻辑重构为条件渲染，提升可读性（粉丝管理、会话管理、素材管理、模板消息页面）

---

## v0.69.0 - 2026-06-25

### Added

#### 微信公众号（MP）增强

- **自动回复**：新增未命中关键词记录功能及统计接口；扩展回复内容类型支持图片、语音、视频、图文等富媒体格式
- **多客服会话**：新增会话数据报表和满意度评分功能，支持记录和查询会话满意度
- **多客服账号管理**：新增客服账号 CRUD 及同步功能
- **二维码管理**：扫码关注支持设置奖励积分
- **统计分析**：新增图文分享转发统计和接口分析数据表
- **群发消息**：新增群发预览和发送结果查询；支持定时群发（scheduledAt 字段）；新增定时任务自动处理待发送群发消息
- **JS-SDK**：新增 JS-SDK wx.config 签名生成接口
- **模板消息**：新增获取/设置所属行业、批量发送模板消息；新增模板消息送达回执（TEMPLATESENDJOBFINISH）处理
- **个性化菜单**：新增条件菜单管理功能（创建/更新/删除/发布/匹配测试）
- **内容安全**：新增文本内容安全校验接口，支持内容检查开关
- **粉丝管理**：新增黑名单管理（批量拉黑/移出黑名单/同步黑名单）；新增粉丝与会员绑定/解绑功能；增加 unionid 和 memberId 字段
- **网页授权（OAuth）**：新增网页授权链接生成及回调处理
- **公众号账号**：新增自动创建会员功能（autoCreateMember 字段）
- **微信数据立方**：新增微信数据立方接口集成

#### 工作流审批增强

- **审批要求配置**：新增审批要求配置 Tab，支持手写签名和审批意见的操作权限分组配置
- **审批附件**：工作流审批任务新增附件字段，支持上传和展示附件（集成 FileAttachment 组件）
- **审批时间线**：新增发起人节点展示；新增流程后续节点展示功能
- **审批时间线样式**：修正圆点对齐，优化时间线视觉效果

#### 表单设计器增强

- **字段类型扩展**：新增约 40 种字段类型，涵盖 tabs（标签页）、steps（分步）等容器类型
- **公式函数库**：完善公式函数库及公式函数插入助手
- **跨字段比较校验**：新增 CompareRulesEditor 组件，支持跨字段比较规则的添加/更新/删除
- **自定义日期范围校验**：表单校验新增自定义日期范围规则
- **字段选项编辑器**：新增选项编辑器样式，支持选项颜色选择和自定义选项值

### Changed

- **工作流表单渲染器**：重构公式评估模块，迁移至独立 `form-formula` 模块；移除 `evalFormula` 导出
- **工作流流程图**：WorkflowFlowTab 替换为 WorkflowGraphView，简化组件结构
- **聊天页面**：合并频道与会话列表，按最后消息时间排序

### Fixed

- 修复节点配置抽屉审批人描述和操作权限标签显示问题
- 修复频道切换时消息重载逻辑（仅在频道 ID 变化时重载，避免因频道元信息更新导致页面闪烁）
- 修复公众号群发发送按钮图标显示问题
- 修复菜单项 ID 重复问题，确保群发/二维码菜单结构正确

---

## v0.68.0 - 2026-06-24

### Added

#### 频道公众号

- **图文群发**：支持带标题的图文消息群发；新增定时草稿功能，可提前编辑并延迟发送
- **双向客服（2D）**：完整的人工双向客服系统，含 ChannelMessageView 双向消息视图、底部功能菜单、菜单/自动回复 Drawer、客服工作台独立页面
- **客服工作台**：独立客服工作台页面，支持实时消息和快捷回复
- **快捷回复**：客服可管理常用快捷回复语，一键插入
- **2B 订阅管理 + 2C 消息中心聚合**：后台订阅管理与前台消息中心整合
- **2A 公众号管理后台**：完整的公众号后台管理功能

#### 公众号管理套件（MP）

- **标签管理**：新增粉丝标签 CRUD 管理页（MpTagsPage）
- **粉丝管理**：新增粉丝列表、同步、标签绑定管理页（MpFansPage）
- **素材管理**：新增图文素材 CRUD 管理页（MpMaterialsPage）
- **模板消息管理**：新增模板库管理与发送记录（MpTemplateMessagesPage）；支持模板同步、发送及日志查询
- **草稿管理**：新增草稿箱 CRUD 管理页（MpDraftsPage），内容编辑升级为 TextArea
- **公众号统计**：新增粉丝/消息趋势统计页面（MpStatisticsPage），含骨架屏加载占位
- **自定义菜单**：新增公众号自定义菜单管理，支持获取、保存、发布、拉取、删除
- **自动回复**：新增关注、关键词、默认三种自动回复类型管理

#### 运维管理

- **防火墙管理**：新增 iptables/ufw 规则可视化管理
- **Nginx 站点管理**：新增 Nginx 虚拟主机站点管理
- **SSL 证书管理**：新增 SSL/TLS 证书管理

#### 其他

- **文件管理器**：新增显示隐藏文件、前进/后退导航历史、文件属性详情面板
- **WebSocket Demo 模式**：Demo 模式下跳过 WebSocket 连接，避免反复连接/断开提示
- **工作流审批**：审批详情抽屉新增任务 ID 透传，聊天卡片支持 workflowInstanceId 直接打开流程详情
- **用户管理**：新增用户注册功能，支持表单验证和 API 调用
- **微信签名**：使用 `timingSafeEqual` 常量时间签名比较，消除计时侧信道风险
- **支付中心**：完善支付事件流和业务流程；账单/分析页面新增骨架屏加载态

### Changed

- **快捷常用语权限**：`/api/workflows/quick-phrases` 所有接口去除 `workflow:task:handle` 权限校验，改为仅要求登录
- **频道列表布局**：创建时间列宽 170→180，操作列宽 280→360，防止时间戳折行和按钮换行
- **工作流审批**：操作权限 Tab 移除与操作按钮设置重复的转办/加签/退回项，减少冗余配置
- **客服待回复数**：基于最近一次人工回复计算，自动回复不再清零未读数
- **页签栏**：修复鼠标滚轮无法横向滚动
- **支付**：风控限额、支付链接、费率管理弹窗改为两列布局

### Fixed

- 修复频道菜单 id 冲突导致频道管理菜单丢失
- 修复工作流设计器窄屏下步骤条与保存/发布按钮重叠
- 修复工作流流程定义页窄屏下只显示分类列表无法切换到流程列表
- 修复工作流设计器草稿状态下「发送」按钮显示逻辑
- 修复待审批任务页面 `setPage` 缺失依赖导致的加载异常
- 修复分账管理弹窗 label 宽度异常
- 修复财务报表维度 Select `prefix` 属性引起的布局异常
- 修复粉丝同步功能 `total` 类型声明不一致
- 修复通过独立幂等迁移清理历史 bot 假用户数据

---

## v0.67.0 - 2026-06-23

### Added

#### 工作流表单设计器

- **表单远程数据源**：新增「远程数据源」管理模块（CRUD + 启用/停用 + 在线测试拉取）；`select` 字段可选「远程数据源」作为选项来源，运行时经服务端代理按路径映射拉取并支持远程搜索（仅登记 URL 可被调用，防 SSRF，带 30s 缓存）
- **字段依赖关系图**：可视化字段间的公式/显隐/必填/只读/级联/天数/联动赋值引用（驱动方 → 被影响方），缺失字段红色提示、按类型配色、点击高亮相关、可只看有依赖的字段
- **条件必填 / 条件只读**：复用多条件规则引擎，满足条件时字段动态变为必填或只读
- **公式函数增强**：支持 `IF/SUM/AVG/MAX/MIN/ROUND/ABS/CEIL/FLOOR` 与比较/逻辑/三元运算，明细汇总用 `{明细key.列key}`；标识符+字符双白名单防注入
- **动态默认值**：默认值支持 `${currentUser}` `${currentDept}` `${today}` `${now}` 等占位，发起时按登录人/部门/时间解析
- **金额大写**：金额字段可联动显示人民币中文大写
- **联动赋值**：`select` 选中某选项时按映射自动填充其它字段
- **分组折叠**：分组容器支持「可折叠 / 默认折叠」，便于长表单分区
- **可编辑字段标识(key)**：支持手动编辑 key 并级联同步所有引用，或根据名称一键生成（中文转拼音）
- **设计器工程化**：JSON 可编辑导入、常用字段模板、批量设置、保存前体检面板、预览支持填写/只读/审批态切换

#### 工作流引擎

- **审批人自动去重三模式**：`approverDedupMode`（不自动通过 / 审批一次后续重复节点均自动通过 / 仅连续审批节点自动通过），向后兼容旧布尔开关
- **流程模板管理**：新增流程模板管理页
- **定时发起**：接入可视化 Cron 表达式组件
- **审批常用语**：管理弹窗支持编辑
- **流程图增强**：节点列表并入流程图，审批记录显示节点耗时
- **表单库**：支持复制表单；流程定义列表新增「表单类型」列

### Changed

- 流程表单上传态与只读附件统一复用公共 `FileAttachment` 组件
- 移除表单设计器字段搜索功能，简化组件结构

### Fixed

- 修复表单设计/控件设置共 14 项问题（附件控件不可用、评分不回写、明细仅占位、空容器渲染、公式缺失依赖按 0 兜底等）
- 修复字段依赖关系图连线未对齐节点中点（弹窗进场动画期间 React Flow 量测 handle 导致 handleBounds 缓存偏移）
- 修复「远程数据源」选项来源点击后单选回弹未选中
- 修复公式字段填写态向发起人暴露原始公式表达式
- 修复「我的申请」打印/保存 PDF 预览空白
- 修复节点列表/流程图单审批人重复显示节点状态
- 修复聊天中工作流审批卡片的接口路径、置灰可靠性与重复提示
- 修复发起工作台未分类流程卡片图标对比度过低
- 加宽事件订阅 / 流程自动化弹窗表单 label

---

## v0.66.0 - 2026-06-22

### Added

#### 工作流引擎

- **模板克隆增强**：支持克隆模板时指定分类 ID，优化模板管理流程
- **流程定义导入功能**：支持导入工作流定义文件，包含表单类型和自定义表单数据
- **批量操作**：新增批量禁用、启用和删除流程定义功能
- **删除保护**：删除流程定义前检查是否存在发起实例，存在则阻止删除
- **定义快照支持**：工作流实例支持携带定义快照，避免流程定义修改后历史实例数据丢失
- **表单快照处理**：新增表单快照处理函数，确保历史实例的表单数据完整性
- **自动化动作验证**：增加自动化动作的目标定义验证和流程定义启动检查
- **流程节点发起人信息**：在流程节点列表中展示实例发起人姓名和头像
- **操作按钮优化**：使用网格布局调整按钮排列，重构复制与导出按钮为下拉菜单形式

#### 工作流发起页

- **表单布局优化**：使用栅格布局调整优先级与抄送人选择组件，移除不必要的侧边栏
- **审批链路预览**：支持流程图与节点详情的弹出预览
- **表单逻辑重构**：复用 WorkflowLaunchForm 组件，简化表单数据收集与提交逻辑
- **列表展示优化**：使用 List 组件替换卡片布局，优化流程定义卡片的渲染与内容展示
- **响应式设计**：增加响应式布局，优化按钮样式与交互

#### 请假管理（Demo）

- **请假审批流程**：新增请假单提交审批功能，支持保存草稿与提交审批
- **工作流实例创建**：请假单提交时自动创建工作流实例

#### 分析

- **错误事件详情**：新增错误事件的详情操作
- **错误事件表格扩展**：优化错误事件表格的展示
- **报告指标修正**：修正报告指标的统计逻辑

#### 维护模式

- **维护窗口记录**：新增维护窗口记录功能，显示维护历史记录列表

#### 其他

- **工作流文档更新**：补充三种表单类型与业务系统接入文档
- **定时任务执行概览**：增强定时任务执行信息的展示

### Changed

- **工作流业务桥接**：修正业务类型与 ID 的处理逻辑，增加对模板库支持的表单类型检查

### Fixed

- **工作流监控页**：修复获取工作流定义时的快照处理逻辑
- **工作流定义页面**：修复文件解析错误提示
- **智能对话**：修复回答结束后会话列表被清空的问题
- **智能对话**：修复点击角色按钮无反应的问题
- **智能对话**：打开对话时自动定位到最新消息
- **数据库管理**：修复序列等无固定列表格占满整行的问题
- **工作流 review 修复**：自定义表单草稿/发布校验、空提交防护、页签元信息与发起页签清理

---

## v0.65.0 - 2026-06-22

### Added

#### 文件上传

- **分片上传功能**：新增初始化、上传分片、完成上传、查询进度和中止上传的 API，支持大文件的断点续传
- **云原生分片上传**：添加 S3、OSS、COS、OBS、Azure Blob、BOS 的云原生分片上传支持
- **分片上传会话清理**：新增定时任务清理过期分片上传会话及孤儿目录，增加相关配置项

#### 文件管理

- **文件 ID 改为 UUIDv7**：将文件 ID 类型从自增数字改为 UUIDv7 字符串，避免自增 ID 可枚举
- **文件存储配置密钥脱敏**：密钥字段在列表/详情接口中不返回，编辑时留空表示沿用原密钥
- **存储配置连接测试**：新增测试接口及前端按钮，支持测试新配置和已保存配置的连接
- **扩展存储提供者**：添加 OBS、Kodo、BOS、Azure、SFTP 等存储提供者支持

#### 日志文件

- **行号显示功能**：日志文件页面新增行号显示按钮，支持切换行号显示状态
- **换行符处理优化**：改进换行符分隔符处理逻辑，支持不同操作系统的换行符

#### 工作流

- **行级锁与乐观并发控制**：增强审批与任务处理逻辑，防止并发操作导致状态不一致
- **流程实例设置**：新增允许重新提交与评论的设置
- **流程实例评论功能**：在工作流实例中添加评论功能
- **自定义业务表单**：流程定义新增 `formType=custom`，可绑定用户在 `src/pages` 下自写的 React 页面承载发起填写与查看（创建/查看按 `mode` 区分），数据存入流程 `formData`，并支持声明流程变量驱动条件分支
- **业务系统接入（external）**：流程定义新增 `formType=external`，业务模块自存数据后通过 `startWorkflowForBiz` 以 businessKey（`bizType`+`bizId`）关联工作流，流程终态经事件订阅回写业务状态；提供桥 SDK（`startWorkflowForBiz`/`onWorkflowResult`/`getWorkflowStatusByBiz`）及「请假」最小 Demo
- **流程整页多页签**：发起与流程详情支持以独立多页签整页打开（`/workflow/launch/:id`、`/workflow/instance/:id`）并带图标

#### 会员管理

- **会员签到设置**：新增会员签到设置页面
- **会员登录日志**：新增会员登录日志展示与管理
- **会员充值记录**：新增会员充值记录展示与管理

#### 缓存管理

- **缓存概览功能**：新增缓存概览页面，展示缓存统计信息

#### 分析页面

- **数据获取优化**：根据活动标签动态调用数据获取函数，使用 useRef 优化性能
- **时间处理优化**：引入 APP_TIME_ZONE，调整时间格式化，确保数据一致性

### Changed

- **文件存储配置操作优化**：新增下拉菜单支持测试连接和删除操作，优化操作按钮样式
- **登录日志统计面板**：增强统计卡片功能，添加图标和背景色支持
- **用户分析页面**：调整用户时间线项的样式，简化布局
- **工作流页面**：添加权限控制、优化 JSON 解析、改进用户界面交互

### Fixed

- **日志文件换行符处理**：修复不同操作系统换行符的分隔逻辑

---

## v0.64.0 - 2026-06-21

### Added

#### 支付中心

- **支付中心 A 档高价值模块**：新增退款审批、Webhook 管理、资金台账、运营工具及完整前端页面
- **支付中心 B 档**：新增费率管理、结算管理、分账规则、支付链接、风控规则、支付方式配置、财务报表等 B 档功能模块
- **支付对账**：新增对账批次与对账明细数据模型，支持解析渠道账单 CSV 并与本地订单比对，提供对账批次的创建、查询、删除接口

#### 租户套餐管理

- **租户套餐管理模块**：新增租户套餐的增删改查功能
- **套餐菜单约束**：多租户模式下按套餐白名单强制约束租户可见菜单（Scope B）
- **租户用量概览**：新增 `maxUsers` 用户数上限强制校验，并提供租户用量概览统计

#### 工作流增强

- **工作流定时发起规则**：新增定时发起规则管理页面，支持规则的增删改查
- **抄送转发**：在抄送页面实现转发功能，支持选择抄送人及备注
- **关联审批单字段**：在字段配置面板中添加关联流程字段，支持选择已发布流程
- **审批链路预览**：在我的申请和工作流发起页面新增审批链路标签页
- **优先级字段**：在工作流实例中添加优先级字段，支持优先级筛选与展示
- **工作流导入导出**：支持 JSON 格式导入导出工作流定义
- **版本对比与复制**：新增工作流定义版本对比和复制功能
- **已办任务页面**：新增已办任务列表，支持搜索和详情查看
- **批量撤回与催办**：在我的申请中实现批量撤回和催办功能
- **加签功能**：在待审批任务中增加加签位置和会签方式选择
- **工作流发起页面**：实现工作流发起入口，支持搜索选择流程定义、动态表单渲染和提交申请

#### 音视频通话

- **WebRTC 音视频通话**：新增基于 WebRTC 的 1v1 和群组通话功能，支持音频和视频通话，包含通话记录

#### 智能对话增强

- **导出与反馈闭环**：第二期增强，新增消息记模型、流式响应健壮性优化和空会话引导

#### 数据库管理增强

- **数据导入功能**：新增 ImportModal 组件，支持 CSV / JSON 文件导入
- **查询结果图表**：新增 ResultChart 组件，支持查询结果的图表可视化
- **数据库对象管理**：新增 ObjectsPanel 和 OpsPanel 组件，整合数据库对象与运维相关操作（物化视图刷新、活动连接管理、表维护、索引健康检查及结构校验）

### Changed

- **操作菜单优化**：将工作流定义的禁用/启用按钮移至下拉菜单，调整操作按钮样式
- **活动连接面板**：SQL 列宽调整为 360，分页调整为每页 50 条

### Fixed

- **多处样式调整**：修复工作流定义页面容器布局、模板画廊模态框底部内边距、待审批操作列宽度等细节样式问题

---

## v0.63.0 - 2026-06-20

### Added

#### AI 功能增强

- **AI 服务商测试连接**：新增测试连接接口，支持验证 AI 服务商配置的有效性
- **提示词模板管理**：新增提示词模板的增删改查功能，支持在聊天页面中应用预设模板
- **AI 使用统计**：新增 AI 使用统计页面，支持按模型和用户维度查看使用数据
- **聊天机器人管理**：新增聊天机器人的创建、编辑、删除及令牌重置功能

#### 工作流引擎增强

- **工作流分类管理**：新增工作流分类的增删改查接口
- **流程模板管理**：新增创建和更新流程模板的功能
- **协办功能**：新增协办邀请与回复功能，优化条件编辑器支持聚合与区间条件
- **手写签名**：在工作流实例中增加手写签名字段，支持签名上传
- **多渠道通知**：在高级设置中添加邮件和短信通知选项
- **流程监控增强**：新增强制跳转和改派处理人功能
- **工作流分析视图**：新增数据可视化、批量审批和常用语管理功能

#### 系统监控与运维

- **监控告警**：新增监控告警菜单及其管理规则
- **历史趋势**：新增历史数据查询、图表展示及温度传感器信息展示
- **网络诊断**：新增 DNS 查询和 HTTP 探测功能
- **端口管理**：支持服务名和状态过滤
- **服务管理**：增加服务状态过滤和操作下拉菜单
- **进程管理**：新增进程工作目录和环境变量展示功能
- **SFTP 管理**：新增修改远程文件/目录权限功能

#### 文件管理增强

- **文件解压**：新增文件解压缩功能
- **校验和计算**：新增文件校验和计算功能
- **深度搜索**：支持深度搜索文件
- **可访问性优化**：将文件卡片从 div 改为 button 元素

#### 数据分析

- **页面跟踪**：实现全局页面浏览埋点功能，自动记录后台页面的 PV 和停留时长
- **错误上报**：实现前端错误上报功能，记录行为面包屑与会话信息
- **数据分析文档**：新增架构、行为分析、数据管理、错误监控等相关文档

#### 其他功能

- **登录日志统计**：新增登录日志的统计数据接口
- **文件统计**：新增文件总数、总大小及各类型文件数量的统计接口
- **偏好设置与收藏菜单**：新增获取和保存用户偏好设置及收藏菜单的功能
- **终端录屏**：新增终端录屏的获取、删除和清理功能
- **SSH SFTP 面板**：新增 SSH SFTP 面板、会话监控/接管、刷新恢复、SSH 分组标签

### Changed

- **工作流接口路径**：将协办列表和回复接口的路径从 '/consults' 修改为 '/instances/consults'
- **已发布流程定义**：修改列表接口返回格式为数组形式
- **顶部导航优化**：重构导航项渲染逻辑，支持祖先目录高亮
- **页面样式优化**：优化各页面的 Tabs 组件样式和结构
- **依赖更新**：更新 dompurify 依赖至 3.4.11 版本

### Fixed

- **顶部导航**：修复导航项宽度计算逻辑，确保导航项正确显示
- **会员等级接口**：修复获取会员等级接口的返回格式
- **聊天页面**：优化通知设置的提示信息
- **分析服务**：修复查询参数类型和时间戳处理逻辑
- **路由管理**：添加已登录用户访问登录页的重定向守卫

---

## v0.62.0 - 2026-06-20

### Added

#### 工作流引擎增强

- **子流程配置**：支持子流程调用模式、执行方式、驳回策略等配置项，支持父子流程之间的跳转与数据映射
- **发起人维度条件**：条件编辑器支持发起人相关字段选项，支持多选和条件运算符的动态切换
- **超时处理升级机制**：超时提醒耗尽后，支持自动同意、自动拒绝或转交给上级处理
- **节点运行态展示**：工作流图增加节点运行态与分支状态展示功能，支持运行态聚合逻辑
- **只读模式**：工作流图增加只读模式支持，隐藏按钮与选择面板
- **监控表格增强**：监控表格增加当前节点/耗时列与取消、删除操作
- **审批时间线增强**：添加发起人信息与流程结束状态展示，重构节点运行态聚合逻辑

#### 数据库管理

- 新增**数据库概览面板**（OverviewPanel）：展示数据库基本信息
- 新增**SQL 控制台**（SqlConsole）：支持 SQL 查询执行
- 新增数据库管理模拟数据和 API 处理逻辑（MockTableDef、MockColumn 类型）

#### 支付管理

- 新增**退款查询与统计面板**：在 PaymentRefundsPage 中增加时间范围查询，优化退款查询操作
- 新增 **PaymentStatsPanel** 组件：展示支付统计与趋势图表

#### 聊天功能

- 新增**语音消息发送与接收**：使用 MediaRecorder 实现语音录制
- 新增**通知偏好设置**：支持桌面通知与提示音
- 新增**音频预览底部固定播放条**：使用 createPortal 将音频播放器固定在页面底部

### Changed

- 工作流模块文档更新：添加比例会签、随机一人等新审批方式，完善节点审批人指定方式及操作按钮设置
- 音频预览播放器样式优化：统一使用语义文字色，确保明暗主题下可读性
- 节点卡片运行态信息展示样式优化：调整布局，增加信息容器

### Fixed

- 修复支付统计退款日期处理逻辑：优化退款日期的 SQL 查询，确保正确处理退款状态和日期聚合
- 修复数据库管理表格可写性判断逻辑：增加对表格类型的判断，确保只有表格类型的项可写入
- 修复工作流实例子流程发起人候选人初始化逻辑：移除候选人变量的初始值设定，确保根据配置动态赋值
- 修复工作流条件值空串被误解析为 id 0 的问题，并补充分支节点文档

---

## v0.61.0 - 2026-06-19

### Added

#### 工作流表单设计器与表单库（Form Library）

- 新增「表单库」模块（工作流引擎下）：独立的**表单列表页**与**独立表单设计器页**，支持表单的创建、编辑、预览、删除；权限码 `workflow:form:*`，会员/超管菜单自动绑定
- 流程定义第二步「表单设计」改为从表单库**下拉选择**已设计的表单，并支持在流程设计器内**内联新建 / 编辑**表单（不离开当前页）
- **历史实例表单快照**：流程实例发起时冻结当时的表单结构进 `formSnapshot`，后续表单修改不影响历史实例的展示与审批（流程定义始终实时引用最新表单）
- 表单设计器大幅增强（对标钉钉 / 飞书）：
  - **丰富控件**：单/多行文本、数字、金额、日期、日期区间、时间、下拉单选/多选、单选框组、复选框组、开关、滑块、标签、颜色选择器、手机号、邮箱、身份证、网址、密码、验证码（PinCode）、自动完成、评分、公式、附件、图片、省市区、手写签名、富文本、明细、说明文字、流水号、分栏、分割线、分组
  - **系统组件**：用户选择器、部门选择器、数据字典选择器，与系统用户 / 组织 / 字典联动
  - **撤销 / 重做**（支持 Ctrl+Z、Ctrl+Shift+Z 快捷键，连续编辑合并为一步）
  - **嵌套拖拽**：控件可拖入分栏列与分组内，支持顶层 ↔ 分栏 ↔ 分组的跨容器移动与排序
  - **响应式列宽**：字段按整行 / 1/2 / 1/3 / 1/4 自动并排
  - **标签设置**：表单级与字段级均支持 `labelPosition`（顶部/左侧/内嵌）、`labelAlign`（左/右）、`labelWidth`，字段级覆盖表单级
  - 字段复制、只读、默认隐藏、字段级多条件显隐联动（and / or）
  - PC / 移动双端预览，以及表单 **JSON 预览**（一键复制）

#### 会员签到与会员管理增强

- 新增**会员签到模块**：连续签到规则、积分 / 经验奖励、签到日历展示本月签到、按日期范围筛选签到历史
- 会员管理新增**关键词搜索**（昵称 / ID）与**导出会员 CSV**
- 会员前台支持**用户自定义主题色**；会员列表昵称列展示头像

#### 终端与运维增强

- Web 终端新增**字体设置**（字号、字母间距、字体粗细）、最小对比度、右键选词等终端偏好
- 新增**终端主题选择器**（暗色 / 亮色主题，选中自动滚动到视图）
- **镜像管理**增强：镜像分组展示、自动展开、镜像树结构构建

### Changed

- 日期格式统一为 **date-fns 标准 token**（`yyyy-MM-dd`），并对历史 / 用户数据做兼容归一化，避免 Semi DatePicker 在 date-fns v2 下因 `YYYY`/`DD` 受保护 token 抛错
- 终端标签页右键菜单改用 Semi `Dropdown` 组件（自动处理边界翻转）
- 容器管理列表移除分页以简化界面
- SSH 配置表单改为响应式栅格布局

### Fixed

- 修复表单设计器隐藏菜单 ID 与「数据脱敏」菜单 ID 冲突（470 → 474），导致管理员打开表单设计器提示「没有访问权限」的问题
- 修复嵌套字段（分栏列 / 分组内）无法编辑、删除的问题（字段树改为递归查找 / 更新 / 删除）
- 修复登录历史、会员详情交易记录等列宽展示问题

## v0.60.0 - 2026-06-17

### Added

#### 系统运维工具箱（Ops Toolbox）

- 新增"系统运维"子菜单（系统设置下），提供一站式服务器运维能力，无需离开管理后台
- **Web 终端**：基于 WebSocket 的全功能 SSH 终端，支持多分屏、实时输入输出、分辨率自适应
- **终端录屏**：自动录制终端操作并支持回放，可按时间/大小筛选，支持自动清理策略
- **文件管理器**：服务器文件系统浏览、上传/下载、重命名、删除、权限查看
- **进程管理**：进程列表与实时资源占用、结束进程、调整优先级（nice）
- **端口监听**：当前监听端口列表、进程关联、内外网标识
- **Docker 管理**：容器/镜像列表、启停/重启/删除、实时日志查看
- **网络诊断**：ping、traceroute、DNS 转换、端口连通性检测
- **服务管理**：systemd 服务列表、状态查看、启停/重启/设置开机自启
- **日志查看器**：实时流式日志浏览，支持内容书签标记与内容加载

#### 数据分析与前端错误监控

- 新增"数据分析"一级菜单，权限码 `analytics:*` / `monitor:error:*`
- **行为分析**：PV/UV、停留时长、点击事件等埋点指标采集与大盘展示，支持时间范围、设备、操作系统多维筛选
- **前端错误监控**：自动采集 JS 异常与 Promise 拒绝并上报，错误列表 + 堆栈详情查看，支持按错误类型/页面/异常信息筛选
- **分析数据管理**：请求历史列表与按条件清除

### Changed

#### 种子数据统一来源（shared/seed-data.ts）

- 将原散落在 `seed.ts` 的业务实体数据迁移至 `packages/shared/src/seed-data.ts`，新增 8 个 SEED 常量：`SEED_TAGS`、`SEED_DATA_MASK_CONFIGS`、`SEED_MEMBER_LEVELS`、`SEED_COUPONS`、`SEED_EMAIL_TEMPLATES`、`SEED_SMS_TEMPLATES`、`SEED_INAPP_TEMPLATES`、`SEED_TENANTS`
- `seed.ts` 改为 import 并使用这些常量；MSW mock data 文件同步改为 `import + spread`，彻底消除前端 Demo 模式与 DB 种子数据的重复定义（之前数据脱敏规则 mock 少一条 idCard 规则的问题也一并修复）
- 邮件/短信/站内信模板统一为 3 条，模板内容与 code 在 Demo 模式和真实 DB 中完全一致
- `users.ts` mock 中的 `superAdminRole`、`normalUserRole`、管理员岗位改为直接从 `SEED_ROLES`/`SEED_POSITIONS` 派生，消除重复定义
- 更新 `crud-mock.md` 与 `seed-config.md` Skill 模板，规范新模块的 SEED 常量声明步骤

### Fixed

- 修复 `db:seed` 因 `email_templates` 表 PK 冲突（`id=1` 已被旧模板占用）导致种子数据执行失败的问题；对 email/sms/inapp 模板及 tags 去掉显式 `id` 插入，改为 DB 自动分配，与 `onConflictDoNothing({ target: code/name })` 策略匹配
- 修复 `MemberLayout.tsx` 的两处预存类型错误：`NAV_ITEMS as const` 导致 readonly 不兼容，以及 `collapseText` 回调参数 `boolean` 未声明为可选

### Docs

- 文档站首页 features 卡片从 6 → 9，新增「支付中心」「会员中心」「数据分析与错误监控」，更新「运维与可观测」补充系统运维工具箱描述
- 核心能力矩阵（`FeatureMatrixFlow`）新增 19 个条目：系统运维 8 项 + 数据分析 3 项 + 支付中心 3 项 + 会员中心 5 项
- `docs/product/features.md` 补充「系统运维」独立章节（9 项）+ 新增「数据分析」「支付中心」「会员中心」三个完整章节
- `docs/product/overview.md` 产品价值新增 4 项：支付中心、会员体系、数据分析/错误监控、一站式系统运维

## v0.59.0 - 2026-06-17

### Added

#### 前台会员体系（Members）

- 新增面向 C 端普通用户的**前台会员体系**，与后台管理员体系**完全隔离**：独立 `members` 表、独立 JWT（payload 带 `type:'member'`，`memberAuthMiddleware` 强制校验，杜绝与管理员 token 互窜）、独立 Redis 会话前缀（`member-session:`）
- **会员认证**（`/api/member/auth/*`）：支持手机号+短信验证码、手机号+密码、邮箱+密码、用户名+密码 4 种登录方式；含注册、登录、刷新、登出、改资料、改密码、短信重置密码；验证码存 Redis + 发码限流；密码 `bcryptjs` 加密
- **会员自助**（`/api/member/*`，按 `currentMemberId()` 过滤防越权）：积分账户与流水、钱包与流水、发起充值、会员等级权益、我的优惠券、领券中心、领取优惠券
- **积分系统**：积分账户（`version` 乐观锁）+ 追加型流水，统一记账 API `changePoints()`（事务 + 乐观锁 + 原子写流水，防并发超扣），封装 earn/redeem/adjust/refund，预留供未来订单系统接入
- **会员等级**：等级配置（成长值门槛、折扣、权益）+ 按成长值自动定级
- **钱包余额**：余额账户（单位分，`version` 乐观锁）+ 流水；充值接入已有支付中心（`bizType='member_recharge'`），监听支付成功事件原子入账，充值接口幂等
- **优惠券**：模板（满减 / 折扣）+ 券码，支持发券 / 领取 / 核销 / 作废 / 过期，原子防超发；核销预留统一 API
- **后台管理**：新增"会员中心"一级菜单（会员管理、会员等级、积分管理、钱包管理、优惠券管理、领券记录 6 个页面），权限码 `member:*`，全部带操作审计；含会员 CRUD / 启禁 / 重置密码 / 导出、积分钱包手动调整 / 退款、优惠券模板管理与发券核销
- **前台 SPA**：Vite 多入口新增 `member.html` 独立入口（独立 React 根、HashRouter、移动优先 UI、底部 TabBar），独立请求实例 `member-request`；含登录/注册、个人中心、积分、钱包充值、优惠券、等级权益、资料/密码页
- 新增 8 张表（`members` / `member_levels` / `member_point_accounts` / `member_point_transactions` / `member_wallets` / `member_wallet_transactions` / `coupons` / `member_coupons`）及迁移；同步覆盖 MSW Demo Mock（前台 + 后台）与种子数据（4 级会员等级、演示会员 `13800138000 / 123456`、示例优惠券）

### Security

- 前后台双用户体系严格隔离：会员 token 与管理员 token 通过 `type:'member'` 双向拒绝互窜；所有 `/api/member/*` 自助接口强制按会员自身 ID 过滤，防止越权访问他人数据
- 短信发码限流 + Redis 存码，防爆破 / 防刷；钱包充值幂等（`idempotencyGuard`）；积分 / 钱包记账事务 + 乐观锁防并发超扣

## v0.58.1 - 2026-06-16

### Added

#### 支付中心

- 新增支付事件 Outbox 机制（`payment_events` 表）：状态更新与事件写入同事务原子持久化，进程崩溃后由 cron `dispatchPaymentEvents` 兜底补投，杜绝「已支付但业务未履约」
- 新增支付/退款统计接口（`GET /api/payment/stats`）及仪表盘统计卡（今日金额、总金额、订单数、成功数、退款额）
- 新增订单/退款 Excel/CSV 导出接口（`GET /api/payment/orders/export` 等）及前端导出按钮
- 新增手动下单弹窗与微信 native 二维码渲染（基于 `qrcode.react`）
- 下单、退款接口接入 `idempotencyGuard`（15s 窗口）防重复提交

#### 文档

- 新增「幂等防重复提交」独立文档页（`/backend/idempotency`），涵盖两种工作模式、配置项、工作机制与注意事项
- 工作流文档从后端子节点提升为顶级文档节点（`/workflow/`），顶部导航新增独立入口，补全「节点类型」页

### Fixed

- 修复支付统计查询 `todayAmount` 因向 Drizzle sql 模板裸插 `Date` 对象导致的 `ERR_INVALID_ARG_TYPE` 500 错误
- 修复支付/退款回调并发场景下事件重复触发问题（原子条件更新，仅当真正更新到行时发事件）
- 修复渠道关单 cron 可能误关已支付订单（先查单确认状态再关闭）
- 修复回调通知公开端点未进入 Swagger 文档（改用 `defineOpenAPIRoute`）
- 修复订单列表 dataScope `self` 归属列由付款人 `userId` 改为创建人 `createdBy`，与全局数据权限语义一致
- 修复 VitePress 配置 `lastUpdated` 类型错误（根级改为 `boolean`，文本/格式选项移入 `themeConfig`）

## v0.58.0 - 2026-06-15

### Added

#### 支付中心

- 新增统一支付中心模块，提供与渠道无关的统一支付接口，业务模块一行代码即可接入，无需关注各渠道签名与回调细节
- **多渠道支持**：微信支付（Native 扫码 / JSAPI / H5）、支付宝（电脑网站 / 手机网站 / APP），采用「适配器接口 + 注册表」架构，新增渠道零改动业务层
- **统一门面**：`createPayment` / `queryPayment` / `refund` / `closePayment` 四个方法，金额全链路整数分
- **真实签名/验签**：Node 原生 crypto 实现微信 v3（RSA-SHA256 鉴权头 + AES-256-GCM 回调解密 + 平台证书按 `Wechatpay-Serial` 自动下载选证）与支付宝（RSA2 签名/验签 + 同步响应验签），外呼全程经 `http-client`
- **异步通知**：公开回调端点 `/api/public/payment/notify/{channel}` 验签后经进程内事件总线 `paymentEventBus` 通知业务模块，并通过 WebSocket 实时推送付款用户
- **退款**：统一退款接口，支持部分退款与退款查询，退款回调原子幂等处理
- **后台管理**：支付渠道配置（密钥加密存储 + 掩码）、支付订单（查单 / 关单 / 退款）、退款记录、回调日志四个管理页面
- **对账与关单**：新增 `closeExpiredPaymentOrders`、`paymentReconciliation` 定时任务处理器（回调 + 主动查单双保险）
- 新增 4 张表（`payment_channel_configs` / `payment_orders` / `payment_refunds` / `payment_notify_logs`）及对应迁移
- 同步覆盖 MSW Demo Mock 与设计文档 `docs/backend/payment.md`

### Security

- 渠道密钥（APIv3 Key / 商户私钥 / 支付宝应用私钥）`encryptField` 加密落库，响应仅以 `hasXxx` 布尔位标识，绝不返回明文
- 渠道创建 / 更新不记录请求体，避免密钥写入操作日志
- 支付成功与退款回调采用原子条件更新 + 幂等发事件，杜绝并发回调重复履约
- 回调地址强制校验为公网 http(s) 绝对地址

---

## v0.57.0 - 2026-06-14

### Added

#### 数据脱敏

- 新增「扫描敏感字段」功能：自动扫描数据库 `information_schema.columns`，识别字段名含 `phone`、`mobile`、`email`、`id_card`、`idCard`、`certNo`、`bank`、`bankCard`、`real_name`、`realName` 等关键字的敏感列
- 扫描结果以表格形式展示，支持内联编辑实体名、字段标签和脱敏类型，默认勾选未配置规则的字段
- 支持一键批量生成脱敏规则（`POST /api/data-mask-configs/batch-create`），重复规则自动跳过
- 新增 `GET /api/data-mask-configs/scan` 接口，同步覆盖 MSW Demo Mock

#### 行为分析

- 新增用户行为分析页面（页面停留时长、功能使用频率、点击热力图统计）
- 新增用户行为统计接口及 `UserStatsDTO`、`UserStatItemDTO`
- 新增埋点事件列表与清除数据功能

#### 前端错误监控

- 新增前端错误上报功能及错误列表管理页面

### Fixed

- 修复功能使用统计表格行键类型导致的类型错误
- 修复事件列表接口返回类型（`EventListDTO` → `EventListItemDTO`）

---

## v0.56.0 - 2026-06-14

### Added

#### 系统运维 — Docker 管理

- **容器管理**：新增 Docker 管理页面（`/system/docker`），支持容器列表（按 docker-compose 项目分组树形展示）、启动/停止/重启、查看实时日志（2s 轮询，支持暂停/继续追踪）、资源占用（CPU%、内存进度条）、容器检查详情（JSON）
- **镜像管理**：支持列出所有镜像、删除镜像、拉取新镜像（通过弹窗输入镜像标签）
- **网络管理**：支持列出网络（含 IP 配置/驱动/容器数）、删除网络、创建网络（支持 bridge/overlay/host/macvlan 驱动及内部网络选项）
- **存储卷管理**：支持列出卷（含驱动/挂载点）、删除卷、创建卷
- **容器文件浏览器**：终端页面新增 Docker 侧边栏，可浏览容器内文件树（懒加载）、只读预览文件（Monaco Editor）、一键 Attach Shell 进入容器终端
- **容器 Shell 接入**：支持通过 `docker exec -it` 在新终端 Tab 中接入正在运行的容器（自动设置 PATH 和 TERM 环境变量）

#### 系统运维 — SSH 快捷连接

- **SSH 配置管理**：终端侧边栏新增 SSH 配置面板，支持新增/编辑/删除 SSH 连接配置（主机、端口、用户名）
- **多种认证方式**：支持密码、私钥路径、私钥内容、SSH Agent 四种认证方式
- **字段级加密**：密码、私钥等敏感字段通过 AES-256-GCM 加密存储，密钥由 `FIELD_ENCRYPTION_KEY` 或 `JWT_SECRET` 派生
- **一键连接**：点击「连接」在新终端 Tab 中建立 SSH 会话

#### 系统运维 — 新增三个运维工具页面

- **端口监听**（`/system/ports`）：展示当前系统所有 TCP 监听端口，包括协议/本地地址/端口/PID/进程名，支持关键词过滤
- **网络诊断**（`/system/network-diag`）：支持 ping（实时流式输出）、traceroute（实时流式输出 + 逐跳延迟可视化表格，含彩色进度条）、nslookup（DNS 查询）、TCP 端口检测
- **systemd 服务管理**（`/system/services`）：列出所有 systemd 服务（加载状态/活动状态/子状态），支持启动/停止/重启操作、查看近期日志（SideSheet）、实时日志追踪（journalctl -f）；非 Linux 系统显示不可用提示
- **日志查看器**（`/system/log-viewer`）：支持读取服务器端任意日志文件末尾 500 行、`tail -f` 实时追踪、关键词高亮（行级黄色指示）、仅显示匹配行过滤、**ANSI 颜色序列渲染**（支持 16 色前景/背景、粗体/斜体/暗淡）

#### 终端增强

- **Ctrl+F 内置搜索**：xterm.js 内新增搜索栏，支持上下导航、大小写切换，通过 `attachCustomKeyEventHandler` 拦截按键防止发送 `^F` 到终端
- **OSC 7 工作目录追踪**：监听 Shell 输出的 OSC 7 序列，Tab 标题实时更新为当前目录
- **WSL 发行版支持**：Windows 下自动检测已安装的 WSL 发行版并加入 Shell 选择列表，支持一键进入各 WSL 环境
- **终端设置新增选项**：光标样式（块/下划线/竖线）、光标闪烁、选中自动复制（默认开启）、渲染模式（Canvas/WebGL）、Alt 快速滚动倍率、滚回行数
- **xterm 滚动条美化**：将 xterm.js 自定义滚动条宽度收窄至 5px，颜色跟随 Semi Design 主题变量

#### 终端录屏

- **命令计数**：录屏列表新增「命令数」列，实时统计每条录屏中的命令输入次数
- **清除录屏**：新增「清除录屏」分裂按钮（SplitButtonGroup），支持清除 1/3/6/12 个月前记录或清除全部，操作前弹窗确认
- **录屏详情**：操作列新增「详情」按钮，解析用户输入事件流并展示命令历史（含时间戳、可单独复制）

#### 文件预览

- **Monaco Editor 代码预览**：`FilePreviewModal` 的代码文件和纯文本文件预览改用 Monaco Editor（取代等宽字体 pre 元素），支持语法高亮和行号

### Fixed

- 修复终端分屏关闭后布局错乱问题：`closePane` 折叠时继承 split 节点 id，保持父 Panel key 稳定；根层折叠始终包裹在 `PanelGroup+Panel` 中防止 TerminalTab 重建
- 修复 Docker 容器文件 API 永久挂起：`execInContainer` 改为监听原始 stream 的 `end` 事件（而非 passthrough），加入 `Tty: false` 和 `hijack: true` 参数
- 修复 docker exec 进容器 TTY 问题：添加 `-t` 标志并显式设置 PATH 和 TERM 环境变量，解决非登录 shell 命令找不到的问题

---

## v0.55.0 - 2026-06-13

### Added

#### 进程管理

- **进程列表**：系统运维新增「进程管理」页面，使用 SSE 实时推送（每 3 秒更新一次），展示 PID、进程名、用户、状态、CPU%、内存、线程数、Nice/优先级类、启动时间、监听端口等字段，使用虚拟化表格（Semi UI virtualized）无分页展示所有进程
- **跨平台支持**：Linux/macOS 通过 `ps` 命令获取进程信息，Windows 通过 PowerShell `Get-Process` 获取；端口列表（Linux 用 `ss -tlnpH`，macOS 用 `lsof -i`，Windows 用 `Get-NetTCPConnection`），每 15 秒缓存一次
- **进程操作**：支持向进程发送终止信号（SIGTERM/SIGKILL/SIGINT/SIGHUP）；支持调整优先级（Linux/macOS 的 nice 值，Windows 的优先级类）
- **进程详情**：点击「详情」按钮查看完整进程信息，包括完整命令行（带 lstart 启动时间）和当前网络连接（TCP 连接状态、本地/远端地址端口）
- **数据导出**：支持导出 Excel 和 CSV 格式，包含所有进程字段及端口信息
- **客户端过滤**：进程列表支持按名称/PID/用户关键词过滤，以及按状态（运行中/休眠/停止/僵尸等）过滤
- **菜单配置**：在系统运维目录下新增进程管理菜单（ID: 505）及结束进程、调整优先级按钮权限（ID: 506/507）

#### 文件管理器

- **权限编辑器**：新增文件权限编辑组件（ChmodEditor），支持权限字符串与八进制值的转换和编辑
- **文件夹选择器**：新增 FolderPickerModal 组件，支持移动/复制操作；Windows 下支持盘符切换
- **文件删除确认**：删除操作改为 Modal.confirm 弹窗确认，提升误操作防护
- **虚拟化网格**：文件列表的网格视图引入虚拟化渲染，大目录下性能显著提升

#### 终端管理

- **自定义按键处理器**：新增自定义按键事件处理器，在 xterm 处理前拦截按键事件，修复 stale closure 问题
- **滚回行数设置**：终端设置面板新增滚回缓冲行数配置，默认 5000 行

### Changed

- **地区管理表格**：去掉斑马纹配置，禁用条纹行样式
- **虚拟化表格固定列修复**：修复地区管理和进程管理页面 `fixed: 'right'` 列在全宽模式下无法生效的问题；根因为外层容器 `overflowX: auto` 拦截了 Semi UI Table 内部的 sticky 滚动容器，移除后 sticky 正常生效；同时调整名称列最小宽度，确保表格内容宽度超出容器，使 fixed:right 的粘性效果始终可见
- **终端偏好 scrollback 字段**：补充 `usePreferences.tsx` 中 `TerminalPreferences` 缺少的 `scrollback` 默认值

### Fixed

- 修复 `FileExplorer.tsx` 中 `Tree` 组件 `ref` 类型错误（`ref={treeRef as never}` → `@ts-expect-error` 注释处理）

---

## v0.54.0 - 2026-06-12

### Added

#### Web 终端全面增强

- **Shell 自动检测**：后端按平台动态探测可用 Shell（Linux/WSL 读 `/etc/shells` + 探测 bash/zsh/fish/sh；Windows 探测 PowerShell/CMD/Git Bash）；前端终端标签和下拉菜单改为动态加载，修复 WSL 下仍显示 Windows Shell 名称的问题
- **文件编辑 Tab**：文件树点击文本文件在终端 Tab 界面新增编辑 Tab，使用 Monaco Editor（已有依赖），支持代码高亮、Ctrl+S 保存、dirty 圆点标记，编辑器配色与终端主题一致
- **文件操作增强**：新增文本文件读写、新建文件/文件夹、删除（含二次确认）、重命名/移动接口；文件树右键菜单支持全套文件操作
- **终端主题系统**：内置 23 套 vscode/Catppuccin/Dracula/Nord/Gruvbox 等经典配色方案，xterm 终端与 Monaco 编辑器共用同一调色板；跟随应用明暗模式，亮/暗可分别选主题
- **终端设置面板**：侧边抽屉支持配置默认 Shell、暗色/亮色主题、字体、字号、行高；配置实时生效，保存到 `users.preferences.terminal`（零 schema 改动）
- **文件夹收藏**：文件树目录可收藏，收藏夹以折叠面板展示，点击定位到文件树对应节点（自动展开路径 + 滚动到位），可从菜单在该目录新建终端
- **Tab 拖拽排序**：终端/编辑器 Tab 支持拖拽重排；右键上下文菜单支持关闭/关闭其他/关闭右侧/全部关闭
- **文件图标**：文件树节点展示 vscode-icons 风格图标（基于 `@iconify/react`），覆盖 300+ 扩展名/特殊文件名/文件夹语义名称；文件夹展开/折叠状态切换图标
- **OS 文件拖拽上传**：可从本地文件管理器直接拖拽文件到文件树区域上传；拖拽时高亮当前目标目录（事件委托 `data-node-path`）并在顶部状态条显示目标路径
- **文件树虚拟化**：Semi Tree 开启 `virtualize`，通过 `ResizeObserver` 动态测量容器高度传入像素值，解决 `height:"100%"` 在 flex 布局下读到 0 导致空树的问题
- **终端 Session 录屏**：所有终端会话自动录制输入/输出事件（`[timeOffset, 'o'|'i', data][]` 格式存 JSONB），WebSocket 关闭时自动 POST 保存；`terminal_recordings` 新表（含 db migration）；新增录屏管理页（`SearchToolbar` + `ConfigurableTable` + `usePagination`），支持关键词搜索、xterm.js 自定义播放器（播放/暂停/倍速/进度拖拽）、删除

---

## v0.53.0 - 2026-06-11


### Added

#### Cron 配置器全面升级

- **高级配置 Modal**（`CronBuilderModal`）：支持 6 字段（秒/分/时/日/月/周）可视化编辑，每字段支持"每个 / 每隔 N / 指定值 / 范围"四种模式；字段选择器显示当前值（蓝色激活 / 橙色自定义），实时刷新"最近 5 次执行时间"预览（绿色提示区，今天/明天/MM-DD 格式）
- **快速配置 Popover** 底部新增"高级配置"按钮，点击关闭 Popover 并打开 Modal，方便从简到繁无缝切换
- **任务列表"下次执行"列**：基于 `cron-parser` 实时计算下次运行时间，启用任务显示"今天/明天/MM-DD HH:mm:ss"，停用任务显示"已停用"
- **Cron 表达式列执行计划 Popover**：列末尾增加 `?` 图标，悬浮展示最近 5 次执行时间（Semi Design `Popover` 卡片样式，带箭头）

#### 标签页切换器（TabSwitcher）

- 标签栏最右侧新增 `▾` ChevronDown 按钮，始终固定（不随标签滚动），点击展开所有已打开标签页列表
- 支持中文拼音模糊搜索（`pinyin-pro`），支持 `↑↓` 导航、`Enter` 跳转、`Esc` 关闭
- 每个列表项显示菜单路径图标 + 标题（当前激活标签加粗 + 蓝色），hover 时右侧显示 `×` 关闭按钮
- 偏好设置新增"显示标签切换器"开关，默认开启

### Changed

#### 聊天页面

- **文件/图片发送进度**：点击发送后，上传项立即以气泡形式出现在聊天消息区底部（Virtuoso Footer），显示 `Progress` 进度条；多文件并行上传，上传完成后自动替换为真实消息
- **图片预览**：待发送区域的缩略图可点击预览（支持多图切换）
- **消息删除确认**：右键菜单"删除"改为先弹出 `Popconfirm`，防止误删；移除原有 `Modal.confirm` 双重确认
- **媒体面板文件 Tab**：支持点击预览可预览文件类型，修复文件名溢出问题（`overflow: hidden` + `flex: '1 1 0'`）；文件上传背景色改为 `bg-2`，暗色模式下对比度更好

#### 文件管理页

- 列表模式和网格模式均新增"取消选择"按钮，显示已选数量，点击清空跨页选中项
- 网格模式：移除日期行，修复文件名 Tooltip 被透明遮罩按钮遮挡的问题（`z-index: 2`）

#### 个人中心

- "操作日志" TabPane 拆分为"登录记录"和"操作记录"两个独立顶层 Tab，无需再点两次切换

#### 其他

- **QuickChat 面板** z-index 从 1001 降至 901（低于 Semi Modal 的 1000），修复文件预览 Modal 被 QuickChat 遮挡的问题
- `postForm` 新增 `onProgress` 可选参数（基于 XHR），统一替代原来独立的 `postFormWithProgress` 方法

---

## v0.52.0 - 2026-06-10

### Changed

#### UI 布局对齐优化

- **智能对话页**：右侧 detail 区域重构为 `MasterDetailLayout.Header` + `MasterDetailLayout.Body` 结构，与字典管理页保持一致的实现方式，左右顶部分割线完美对齐
- **消息中心页**：左右两侧 header 均改用 `MasterDetailLayout.Header`，body 区域改用 `MasterDetailLayout.Body`；右侧头像统一调整为 `size={24}`，确保高度与左侧等高（44px 像素级对齐）

#### 数据库管理页优化

- **表浏览左侧列表**：表格项从双行（名称+大小独占一行）改为单行显示（`tableName · size`），列表更紧凑；Schema 折叠面板内容区域 padding 清零，减少折叠标题与表格项的间距

#### 字典管理页优化

- **禁用字典标识**：左侧字典列表中，禁用状态的字典项 meta 行右侧显示"停用"标签，并降低整体 opacity 至 0.55，区分度更高

### Fixed

- **依赖冲突**：将 `@hono/node-server` 版本从 `^2.0.4` 回退至 `^1.19.14`，解决与 `@hono/node-ws@1.3.1`（peer dependency 要求 `^1.x`）的版本冲突

### Dependencies

- 更新 `@douyinfe/semi-ui`、`@douyinfe/semi-illustrations`、`dompurify`、`@types/react`、`typescript-eslint`、`electron`、`electron-builder`、`zod` 等依赖至最新版本

---

## v0.51.0 - 2026-06-10

### Added

#### AI 对话功能增强

- **消息反馈（点赞/点踩）持久化**：`ai_messages` 表新增 `feedback` 字段（1=点赞, -1=点踩, null=未反馈）；`PUT /{convId}/messages/{msgId}/feedback` 接口持久化反馈；前端 `convertApiMessage` 将 DB `feedback` 映射到 Semi `like`/`dislike` 字段，刷新后回显正确
- **重新生成**：点击消息的 redo 按钮，删除 DB 里的 assistant 回复，重新发送上一条 user 消息
- **消息编辑重发**：点击用户消息的编辑图标，进入受控编辑框（TextArea + 重新发送/取消），提交后删除该消息之后的所有 assistant 回复并以新内容重新发送（Ctrl/Cmd+Enter 快捷提交）
- **消息删除**：点击消息操作栏"更多"里的删除，UI 移除后调 `DELETE /{convId}/messages/{msgId}/cascade` 级联删除 DB 里该消息及其之后所有消息
- **AI 反馈管理页**：新增 `/ai/feedback` 页面，管理员可查看所有带反馈的 assistant 消息，支持按点赞/点踩筛选，权限 `ai:feedback:view`
- **移除 CDN 复制 Toast 重复**：Semi `AIChatDialogue` 内置复制 Toast，去掉我们额外的重复提示
- **隐藏分享按钮**：通过 `dialogueRenderConfig.renderDialogueAction` 过滤 `shareNode`，移除暂无实际功能的分享按钮
- **移除提示词（hints）**：删除"如何新增 CRUD 模块"等默认提示，保持界面简洁

#### 密码强度指示器

- 新增 `PasswordStrengthMeter` 组件，4 段渐变强度条 + 弱/一般/良好/强标签 + 最小位数提示
- 覆盖所有密码输入场景：ProfilePage 修改密码、ForceChangePasswordModal、ResetPasswordPage、UsersPage（新建/修改/批量修改密码），全部 modal 关闭时重置状态
- 强度条与最小位数提示同行显示；若有大写/特殊字符策略要求则在下方另行显示

#### 服务监控 Descriptions 改造

- 将所有 tab（总览 / CPU / 内存 / 磁盘 / Node.js / HTTP / 数据库 / Redis / WebSocket）的 key-value 信息展示从自定义 `InfoRow` + `monitor-detail-grid` 全面替换为 Semi `Descriptions` 组件（`column=2, layout="horizontal"`）；图表和明细表格保持原样
- 删除废弃的 `InfoRow` 组件及相关 CSS

### Changed

- **偏好设置排序**：「顶部栏深色模式」调整到「侧边栏深色模式」上方，更符合视觉层级
- **AI 对话会话列表**：从 Semi List 自定义样式迁移到 `NavListPanel` + `NavListItem`，与项目其他导航列表风格统一；`新建对话` 按钮移到面板标题栏右侧

### Fixed

- AI 对话页：无历史对话时直接发送消息无响应（`activeConvId === null` 直接 return），改为自动创建新对话再发送
- AI 反馈页：时间列宽度不足导致日期换行，改为 180px + `whiteSpace: nowrap`

---

## v0.50.0 - 2026-06-10

### Added

#### PDF 预览去 CDN（本地 npm 资源替代 jsDelivr / Google Fonts）

- `PDFPreviewPanel` 改用本地加载策略，彻底移除运行时对外部 CDN 的依赖：
  - `pdfium.wasm`（4.5 MB）：通过 `@embedpdf/pdfium/pdfium.wasm?url` npm 引入，Vite dev/生产均产出为本地资源；传给 `wasmUrl` 时用 `new URL(..., globalThis.location.origin).href` 转绝对路径，修复 blob worker 无法解析根相对路径的问题
  - 默认印章库（`@embedpdf/default-stamps`）：设置 `stamp: { manifests: [] }` 禁用，避免从 jsDelivr 拉取 `manifest.json` + `stamps.pdf`（只读预览不使用印章，零功能损失）
  - 查看器 UI 字体 Open Sans 和签名手写体：设置 `fonts: { ui: null, signature: null }`，回退系统字体栈，国内用户不再因 Google Fonts 被墙而遭遇工具栏渲染阻塞
- `@embedpdf/pdfium` 在 `packages/web/package.json` 中从传递依赖升级为显式声明

#### NavListPanel 深化重构（泛型 + Semi 带筛选器最佳实践）

- `NavListPanel<T>` 升级为泛型组件，支持 Semi List 原生 `dataSource: T[]` + `renderItem: (item: T, index: number) => ReactNode` API：
  - 空数组时由 List 原生 `emptyContent` 处理，无需手动 `childCount` 判断
  - 4 个调用方（DictsPage / CacheManagePage / LogFilesPage / CategorySidebar）迁移至 `dataSource` + `renderItem`，DbAdminPage（Collapse 分组）保持 `rawBody` + `children` 路径
- 对齐 Semi "带筛选器" 最佳实践：搜索 Input 进 `List header` 槽（固定不滚动）、分页进 `List footer` 槽（固定不滚动）、条目区域由 `.semi-spin` 承载 `flex:1; overflow-y:auto` 滚动
- 分页器居中：`List footer` 槽 CSS 加 `display:flex; justify-content:center`
- Skill 文档（`constraints.md`）同步更新 `NavListPanel<T>` 使用规范，明确推荐用法与 rawBody 兼容路径

### Changed

- `MasterDetailLayout` 折叠按钮 chevron 颜色改为主题色 `--semi-color-primary`（hover 改为 `--semi-color-primary-hover`），替代原来的灰色文本色

---

## v0.49.0 - 2026-06-09

### Added

#### NavListPanel / NavListItem 通用导航列表组件

- 新增 `NavListPanel` + `NavListItem` 组件（`packages/web/src/components/NavListPanel.tsx`），作为左右分栏布局中左侧平铺列表的统一实现
- `NavListPanel`：带标题栏、搜索框、加载状态、空状态、底部插槽的面板容器
- `NavListItem`：圆角卡片条目，支持左侧图标、主/副标题、元信息行、hover 可见操作区（`extra`）、`extraAlwaysVisible` 模式
- 根元素改用 `<button>` 语义元素，原生支持键盘交互，消除无障碍警告

### Changed

#### 多页面左侧列表改造（统一使用 NavListPanel + NavListItem）

- **日志文件管理**：`LogFilesPage` 左侧文件列表，hover 显示「下载/删除」Dropdown 更多菜单；修复 meta 区 `<Tag color>` 渲染多余色块的问题，改用 styled span
- **缓存管理**：`CacheManagePage` 左侧分类列表，彩色圆点图标 + 分类名 + 计数 Badge；删除按钮常驻可见；去除 `CacheManagePage.css` 中全部 master 相关手写样式
- **流程分类侧栏**：`CategorySidebar` 用 `NavListPanel` 重写，Dropdown 从 `trigger="custom"` 改为 `trigger="click"` 标准模式；「全部流程」用 `LayoutGrid` 图标，有颜色的分类用彩色圆点，无颜色的分类用 `Layers` 图标

### Fixed

#### 文件存储 bucketName 快照

- `managed_files` 表新增 `bucketName` 字段（nullable），上传时快照 bucket 标识
- `readStoredFile` / `deleteStoredFile` 优先使用快照值，修复修改 OSS/S3/COS bucket 名后旧文件无法访问的问题
- 向后兼容：旧记录 `bucketName` 为 null 时继续使用当前配置

---

## v0.48.0 - 2026-06-09

### Added

#### 文件预览扩展（5 种新格式）

- **Word (.docx)**：使用 `docx-preview` 纯前端渲染，无需后端转换，支持表格、页眉页脚、脚注
- **Markdown (.md)**：使用 `react-markdown` + GFM 渲染，支持标题、代码块语法高亮、表格、任务列表
- **纯文本 (.txt)**：等宽字体原样展示，保留换行与缩进
- **CSV**：复用 Excel 预览路径（后端 csv-to-univer 解析 → Univer 渲染），零前端改动
- **ZIP**：使用 `jszip` 解析并用 Semi Tree 展示文件树，含文件数量/大小统计

#### 文件预览全屏切换

- 所有格式（Excel / Word / Markdown / txt / ZIP / PDF）预览弹窗右上角新增 ↗/↙ 全屏切换按钮
- PDF 预览面板在 `FilePreviewModal` 上下文中支持全屏；在聊天侧边栏中独立使用时不受影响

#### AppModal 组件

- 新增 `AppModal` 组件，在 Semi Design Modal 基础上增加右上角全屏切换（↗）和关闭（✕）按钮
- 全站 30+ 个新增/编辑表单弹窗统一替换为 `AppModal`

### Changed

- 各预览 Panel（ExcelPreviewPanel / DocxPreviewPanel / MarkdownPreviewPanel / ZipPreviewPanel）重构为纯内容组件，标题栏统一由 `FilePreviewModal` 管理，提升可复用性

### Fixed

- **Excel/CSV 全屏预览空白**：Semi Modal fullscreen 模式下 `semi-modal-body-wrapper` 高度仅为 78px，改用 `height: 100vh` 绕过，配合 spinner + 360ms 延迟重建 Univer 实例，确保 canvas 在最终尺寸容器中初始化
- **Excel 行高自适应**：后端 rowData 改为 `{ ia: 1, ah? }` 模式，前端在 `LifecycleStages.Rendered` 后触发全表自适应行高命令

---

## v0.47.0 - 2026-06-08

### Added

#### Excel 文件在线预览

- 新增 Excel (.xlsx) 文件在线预览功能，基于 Univer 开源版渲染，零后端新依赖
- 后端新增 `GET /api/files/{id}/sheet-preview` 接口，使用内置 `exceljs` 将 xlsx 解析为 Univer `IWorkbookData` JSON（支持单元格值、基础样式、合并、行高列宽）
- 前端 `FilePreviewModal` 统一接入 Excel 预览分支，Univer 组件懒加载不影响首屏
- 文件管理列表视图、网格视图、存储浏览、文件附件组件、聊天页面均支持 xlsx 在线预览
- 聊天历史消息（无 fileId）的 xlsx 文件点击后自动触发下载，不显示报错
- `ChatAssetMeta` 新增 `fileId` 字段，新发送的文件消息可携带 fileId 支持预览
- 文档站新增「前端 → 文件预览组件」页面，详述组件接口、各格式实现细节及新页面接入指南

#### 标签页增强

- 标签页下拉菜单新增全屏切换功能（进入/退出全屏）

#### 用户管理

- 新增 `UserTransferSelect` 穿梭框组件，支持树形结构展示用户和部门，用于角色/岗位成员分配
- 用户头像管理：支持上传自定义头像、裁剪、选择预设头像，更新后全局头像实时同步
- 用户信息更新后通过事件机制同步 AdminLayout 头像，避免整棵 App 重渲染

#### 角色 / 岗位 / 部门

- 角色、岗位、部门列表新增用户数量与用户头像预览字段
- 角色成员分配改为 `SideSheet` 侧边栏展示，体验更流畅
- 岗位管理新增成员管理功能：支持查看和设置岗位成员

---

## v0.46.0 - 2026-06-07

### Added

#### 会话管理

- 添加用户登录地点功能：会话 DTO 新增 `location` 字段，支持展示用户登录地理位置
- 优化登录地点和 IP 地址展示：登录地点为空时显示 IP 地址

#### 用户头像

- 添加预设头像选择功能：新增头像选择 Modal，支持从预设头像中选择并更新用户头像

#### 文件管理

- 文件列表新增 MIME 类型列展示

#### 日志管理

- 添加清除登录日志和操作日志功能：支持按月份清除，需验证管理员密码
- 定时任务管理优化清除日志功能：清除日志按钮改为分组按钮，支持直接清除和按时间清除选项

#### 布局管理

- 添加在新标签页中打开功能：下拉菜单新增选项，使用 ExternalLink 图标实现页面链接在新标签页中打开
- 优化最近和收藏记录展示：使用 List 组件替代原有 div 结构

### Fixed

- 修复 `SessionInfo` 新增 `location` 字段后，`auth.ts` 和 `oauth.service.ts` 中 `registerSession` 调用缺少该字段导致的 TypeScript 编译错误

---

## v0.45.0 - 2026-06-07

### Changed

#### 状态列全面改造（Switch 直接操作）

- 全站 16 个管理页面的「状态」列统一由 `Tag` / `DictTag` 改为 `Switch` 组件，点击即可直接启用/停用，无需进入编辑弹窗
- 涉及页面：用户、部门、岗位、菜单、角色、字典（项 + 头部）、租户、地区、文件存储配置、邮件模板、短信配置、短信模板、站内信模板、标签、数据脱敏、OAuth2 应用、AI 供应商
- 停用操作统一弹 `Modal.confirm` 二次确认，防止误操作；启用操作无需确认
- 各页面 Switch 状态列统一固定（`fixed: 'right'`）紧靠操作列左侧
- 特殊逻辑：文件存储配置 / 短信配置的默认配置不可直接禁用
- MSW Demo 模式全部兼容，无需额外修改（`Object.assign` 局部更新天然支持）

### Changed（模板）

- 更新 `crud-frontend.md` 模板：状态列改为 Switch 模式，新增 `togglingIds` state 和 `handleToggleStatus` 函数标准模板

---

## v0.44.0 - 2026-06-07

### Added

#### 维护模式

- 新增维护模式功能，支持一键开启/关闭系统维护状态
- 后端中间件拦截所有 `/api/*` 请求，维护中返回 503，超级管理员自动旁路
- 前端 `request.ts` 拦截 503 响应，派发 `maintenance:enabled` 事件
- 普通用户触发全屏 `MaintenanceOverlay` 遮罩，每 30 秒自动检查是否恢复
- 超管登录后顶部显示橙色维护横幅，可直接点击关闭维护，无需进入管理页面
- 开启维护前弹出 `Modal.confirm` 二次确认，防止误操作
- 支持配置维护提示语和预计结束时间
- 管理页面与横幅状态双向联动（`maintenance:statusChanged` 事件总线）
- `/api/ws` 加入旁路列表，WebSocket 连接不受维护中间件影响
- 新增文档：[后端 → 维护模式](/backend/maintenance-mode)
- MSW Mock Handler 同步支持 Demo 演示模式
- 维护状态使用内存缓存（5 秒 TTL）+ PostgreSQL 持久化，重启服务后状态保留

---

## v0.43.0 - 2026-06-07

### Added

#### 面包屑子菜单

- 新增偏好设置「面包屑子菜单」（默认关闭），开启后悬停面包屑的目录节点弹出子菜单 Popover
- 支持无限级嵌套展开，点击叶子菜单直接跳转并关闭 Popover
- 新建 `BreadcrumbMenuPopover` 组件，通过 Context 传递关闭回调，确保跳转后立即关闭

#### Electron 标题栏改进

- `ElectronTitleBar` 移至 `App.tsx` 顶层，登录页也能显示标题栏
- 修复按钮点击报 `An object could not be cloned`：改为内联按钮 `() => api.xxx()` 包装，避免 contextBridge Proxy 函数放入对象字面量触发序列化检查
- 最大化状态改为事件驱动（主进程 `maximize/unmaximize` 事件推送）

### Changed

- 标签页标题添加 `title` 属性，悬停时显示完整标题（标题过长时的 native tooltip）
- 内容区宽度模式偏好：新增「固定宽度（1400px 居中）」选项
- 修复 `AdminLayout` 三处 lint 警告：`clearLockPassword` 依赖缺失、`currentSelectedKeys` 每次重算、收藏按钮 IIFE 改为提前计算变量

---

## v0.42.0 - 2026-06-07

### Added

#### Electron 桌面客户端

- 新增 `packages/electron/` 子包，基于 Electron 42 构建 Windows/macOS/Linux 桌面安装包
- 自定义无边框标题栏（Windows/Linux），拖拽区 + 最小/最大/关闭按钮，macOS 保留系统红绿灯
- 安全机制：`contextIsolation: true`、`nodeIntegration: false`，通过 preload 仅暴露受限窗口控制 API
- 构建脚本：`build:electron:win/mac/linux`（自动注入 `VITE_ELECTRON=true`，切换 `HashRouter` 和相对路径资源）
- 开发脚本：`dev:electron`（并发启动 web dev server + electron）

#### PWA 支持

- 通过 `VITE_PWA_ENABLED=true` 开启，生成 `sw.js` 和 `manifest.webmanifest`
- 静态资源预缓存（Cache First），API 请求 Network Only，支持"添加到主屏幕"
- 内置 192×192 和 512×512 PWA 图标（由 `favicon.svg` 生成）

### Changed

- 前端路由在 Electron 模式下切换为 `HashRouter`（支持 `file://` 协议），浏览器模式不受影响
- 文档新增独立章节 `guide/pwa.md` 和 `guide/electron.md`，从 `deployment.md` 拆出

---

## v0.41.0 - 2026-06-06

### Added

#### 菜单收藏

- 偏好设置新增「显示收藏入口」开关（默认关闭）
- 开启后：面包屑末尾出现 ⭐ 按钮（可收藏/取消收藏当前页）、顶部导航出现收藏 Popover
- 标签页右键菜单新增「收藏此页 / 取消收藏」
- 收藏数据存入 `users.favorite_menus` 字段，跨设备同步
- 收藏列表中每项右侧有 × 按钮移除单条收藏

#### 最近访问

- 顶部导航新增 🕐「最近访问」图标（悬浮弹出）
- 路由切换时自动记录，上限 20 条，最新在前
- 支持单条移除和一键清空，数据存 `localStorage`

#### 偏好设置搜索

- 偏好设置面板顶部新增搜索框，实时过滤设置项
- 支持中文全拼 / 首字母拼音匹配（基于 `pinyin-pro`）

#### 用户管理批量操作

- 工具栏新增「批量启用」和「批量停用」按钮（选中非 admin 用户时显示）

#### 文件上传安全校验

- 基于 magic bytes（`file-type`）校验上传文件的真实 MIME 类型，防止后缀欺骗
- 支持通过系统配置 `file_upload_validate_type` 开关和 `file_upload_allowed_types` 白名单配置

#### 环境变量 Zod 校验

- `config.ts` 改用 Zod schema 解析环境变量，启动时即验证，类型自动推导

---

## v0.40.0 - 2026-06-06

### Changed

#### 定时任务调度引擎迁移（node-cron → pg-boss）

- 调度引擎从进程内 `node-cron` 迁移至 **pg-boss**（PostgreSQL SKIP LOCKED 队列），原生支持多进程安全执行，无需 `NODE_APP_INSTANCE` 限制
- `cron_jobs` 表：移除 `nextRunAt` 字段；`retryInterval` 单位改为秒；新增 `retryBackoff` 字段（指数退避重试）
- 内置 7 个 Handler 迁移至 pg-boss worker 架构，处理器名称和行为不变
- 移除 `node-cron` 和 `@types/node-cron` 依赖，新增 `pg-boss`

#### 定时任务页面增强

- 概览 Tab 新增「当前运行中」指标卡片（实时读取 pg-boss WIP 数据），5 个卡片等宽一行显示
- 执行日志「清除日志」下拉菜单新增「清除全部日志」选项（`months=0`）
- Cron 表达式列、处理器列、操作列均加宽
- 统一 cron 表达式格式（`*/5 * * * *` 5 段标准格式）

### Fixed

- 窄屏下 SideSheet 宽度超出视口问题（通过 CSS media query 全局修复，`max-width: 95vw`）
- 清除日志下拉菜单点击后未自动关闭（添加 `clickToHide`）

---

## v0.39.0 - 2026-06-06

### Added

#### 多标签页增强

- 新增「超限关闭策略」偏好（FIFO / LRU），可选关闭最早或最久未使用的标签
- 新增「新标签插入位置」偏好（末尾 / 当前后方）
- 新增「双击标签行为」偏好（刷新 / 关闭 / 无），默认双击刷新当前页

#### 侧边栏增强

- 新增「悬浮展开侧边栏」偏好：折叠状态下鼠标悬浮即临时展开，移开自动收起
- 新增「菜单自动滚动定位」偏好：切换深层菜单时侧边栏自动平滑滚动使激活项可见

#### 偏好设置

- 新增「面包屑可点击」开关（默认开启），关闭后面包屑仅展示路径文字
- 新增「路由切换动画」（无 / 淡入 / 上滑 / 左滑），切换标签页时内容区播放过渡动画
- 新增「灰色模式」（国家公祭日等场景）和「色弱模式」（提升对比度）无障碍选项
- 主题颜色新增 4 种预设：珊瑚橙、金橄榄、深棕、墨黑（共 19 种）

#### 快捷键面板

- 头像菜单新增「快捷键」入口，分组展示所有全局及功能区快捷键
- 全局新增 `Alt+S`（侧边栏折叠/展开）和 `Alt+C`（内容全屏/退出）

#### 内容全屏模式

- 标签页右键菜单新增「内容全屏」：隐藏侧边栏、导航、标签栏，内容区铺满视口
- 标签页右键菜单新增「复制名称」和「复制面包屑路径」

#### 字典管理

- 字典项新增 `metadata` JSON 字段，使用 Semi Design JsonViewer 可视化编辑
- 字典项弹窗改为两列布局，新增服务端重新拉取最新数据逻辑

#### 登录日志增强

- 登录时收集设备信息（屏幕分辨率、GPU、CPU 核心数、内存），写入 `login_logs` 表
- 登录日志统计分析新增 Tab（仿操作日志）：Top 用户/IP、浏览器/OS 分布、失败 IP 告警

#### 用户管理

- 在线用户绿点指示：用户列表「用户」列显示在线状态，实时从 Redis Session 获取
- 「更多」菜单新增「强制下线」（仅对在线用户显示，需权限 `system:session:forceLogout`）
- 批量操作新增「批量修改密码」，受密码策略和 admin 保护约束

#### 文件存储

- 新增 5 种存储类型：华为云 OBS、七牛云 Kodo、百度云 BOS、Azure Blob、SFTP

### Changed

- 首次加载/刷新时的全屏等待动画改为三点跳动（Bouncing Dots），更轻量低调
- 字典右侧字典项表格移除分页（`pagination={false}`），支持完整树形结构展示

### Fixed

- 修复文件存储 DTO 中 `provider` 枚举缺少新存储类型导致的构建错误
- 修复 `DictItemDTO.metadata` 类型兼容性问题

---

## v0.38.0 - 2026-06-05

### Added

#### usePagination Hook

- 新增 `packages/web/src/hooks/usePagination.ts`，封装分页状态（`page`/`pageSize`）及 `buildPagination(total, onFetch)` 构造器
- 自动从用户偏好设置读取默认每页条数，全站一键生效
- 全站约 30 个列表页迁移使用，每处 pagination 样板代码从 8 行缩减为 1 行

#### ConfigurableTable 分页默认值注入

- 自动注入 `showTotal: true`、`showSizeChanger: true`、`pageSizeOpts: [10, 20, 50, 100]`
- 调用方无需重复声明，仍可按需覆盖

#### 偏好设置新增「默认分页大小」

- 偏好面板增加 10 / 20 / 50 / 100 下拉选项，对全站所有列表页生效
- 页面刷新后即时应用新设置

#### MasterDetailLayout 新增 Body 子组件

- `MasterDetailLayout.Body`：`flex: 1 + overflow: auto`，配合 `Header` 子组件实现固定标题 + 可滚动内容区
- `CacheManagePage`、`DictsPage`、`WorkflowDefinitionsPage` 统一改用 `Header + Body` 模式，移除手写 flex/overflow CSS 类

### Changed

- 字典右侧字典项表格改为 `pagination={false}`，支持完整树形结构展示（后端本已全量返回）
- `DbAdminPage` 表浏览数据 Tab 和查询历史 Tab 均改为 `ConfigurableTable` 内置分页，移除外置 `<Pagination>` 组件
- 查询历史 Tab 修复竖向无法滚动问题，时间列宽从 170 调整为 180

### Fixed

- 修复 8 个页面 `fetchList(ps = 10)` 硬编码绕过偏好设置的问题

---

## v0.37.0 - 2026-06-05

### Added

#### 表格刷新按钮

- `ConfigurableTable` 新增 `onRefresh` / `refreshLoading` props，工具栏显示刷新按钮
- 全站所有使用 `ConfigurableTable` 的页面统一接入刷新功能（含日志子组件、SideSheet 内嵌表格等）

#### 侧栏手风琴排他展开

- 偏好设置新增「侧栏排他展开」开关，开启后展开子菜单时自动折叠同级分组
- 路由切换时在手风琴模式下同步收起无关分组

#### 用户管理-分配角色

- 用户操作菜单新增「分配角色」入口，支持通过 Modal 多选角色后保存
- 后端新增 `PUT /api/users/:id/roles` 接口（需 `system:user:assign` 权限）

#### 表格全屏展示

- `ConfigurableTable` 工具栏新增全屏按钮（`Maximize2` / `Minimize2` 图标），支持 Esc 退出

#### 部门管理-类别字段

- 部门新增「类别」字段（集团/公司/部门），支持数据导出

### Changed

- `AdminLayout.css` 主内容区增加 `scrollbar-gutter: stable`，防止滚动条出现/消失导致工具栏换行抖动
- 文件列表搜索操作按钮组用 `flexShrink: 0` 包裹，避免按钮因容器宽度临界变化跳行
- CRUD 模板更新：`fetchXxxs` 改用 `searchParamsRef` 读取最新搜索参数，避免输入框输入触发自动搜索

### Fixed

- 修复关键字搜索转义顺序 bug：先转义 `\` 再转义 `%` / `_`，修复含下划线文件名（如 `20251213_095800.mp4`）无法搜索的问题
- 修复菜单编辑报错 `query: expected string, received null`（`query` 字段改为 `.nullish()`）
- 修复 `ConfigurableTable` 刷新按钮将 `MouseEvent` 传入 `onRefresh` 导致 `page: NaN` 的问题
- 修复 9 个列表页（用户/部门/系统配置/租户/文件/用户组/定时任务/岗位/登录日志/地区）输入框触发自动搜索的问题
- 修复 `departments.service.ts` 导出时 `category` 字段 transform 函数类型错误

---

## v0.36.0 - 2026-06-10

### Added

#### 定时任务执行概览 Dashboard

- 新增"执行概览"标签页，包含 4 个统计卡片（任务总数、今日执行次数、今日成功次数、今日成功率）
- 新增按任务维度的执行统计表格，展示总执行次数、成功/失败次数及成功率
- 新增未来执行计划预览，展示最近 30 次调度时间（按日期分组）
- 后端新增 `GET /api/cron-jobs/stats` 接口，并行查询汇总统计与逐任务统计

#### 文件管理无障碍优化

- 文件网格卡片重构：使用覆盖式透明 `<button>` 替代 `div` 上的点击事件，符合 WCAG 无障碍规范
- 右键菜单现通过覆盖按钮的 `onContextMenu` 触发，对非预览文件同样生效

### Changed

- `packages/web/tsconfig.json` lib 从 `ES2022` 升级至 `ES2023`，支持 `Array.toSorted()` 等新方法

### Fixed

- 修复文件管理页面因编辑操作产生的 JSX 结构重复导致的 Vite 编译错误
- 修复 `AdminLayout.css` 锁屏相关选择器的 CSS 对比度不足问题（SonarLint S7924）

---

## v0.35.0 - 2026-06-03

### Added

#### 公告管理增强

- 新增公告附件功能，支持在公告中上传和管理附件文件
- 新增公告接收者 DTO 定义，支持 `user` / `role` / `dept` 三种接收者类型
- 公告详情接口优化，支持并行查询收件人和附件信息
- 新增公告查看模式（只读模式），支持详情弹窗加载状态管理

#### 站内信功能

- 新增获取我的站内信详情接口和文件详情接口

#### 日志文件搜索

- 新增日志文件内容搜索功能，支持搜索匹配范围、导航索引构建和实时高亮显示匹配内容

#### 文件附件管理

- 新增通用附件 CRUD 服务，支持公告、通知、工单等模块的文件上传和管理
- 新增业务文件关联功能，支持获取和移除业务附件
- 新增文件上传数量限制功能
- 文件上传功能增强：新增上传状态管理、失败重试机制、上传结束提示和上传进度显示
- 优化文件附件组件，使用 Semi Upload 组件替换原有实现，支持自定义文件项渲染和文件预览下载

#### 登录日志

- 新增用户代理信息展示，优化登录日志详情展示（使用 Descriptions 组件）

#### 缓存管理

- 调整操作列宽度，优化界面布局

### Changed

- 文件管理：优化文件列表和网格视图的分页设置，引入常量定义页面大小和选项
- 文件管理：优化文件卡片样式和布局，调整边框、背景、内边距和字体大小，改善响应式布局
- 文件管理：优化文件预览展示逻辑，移除图片预览条件，统一显示文件类型图标
- 公告管理：更新公告修改验证模式，增加标题、内容、类型、发布状态等字段的验证

### Fixed

- 修复公告附件处理逻辑，使用 `Object.hasOwn` 方法检查 `fileIds` 属性
- 修复附件文件项类型判断和删除逻辑，增加对 null 和 undefined 的处理

---

## v0.34.0 - 2026-06-02

### Added

#### 缓存管理

- 缓存分类操作下拉菜单：支持刷新和清空全部功能，优化用户操作体验
- 缓存分类主从布局展示：新增缓存分类列表和详细信息展示，支持分类选择和搜索功能

#### 字典管理

- 字典项支持父子关系（两级结构），新增 `parentId` 字段
- 字典项创建/更新添加循环引用检测，防止无限嵌套
- 引入主从布局，重构字典列表样式，添加字典项搜索和分页功能
- 字典列表支持展开/折叠功能，支持父级字典项选择

#### 主题设置

- 新增侧边栏和顶部栏深色模式选项，支持更灵活的深色主题配置

### Changed

- 依赖管理：清理冗余依赖，优化依赖结构

---

## v0.33.0 - 2026-06-01

### Added

#### 布局与表格

- 表格样式设置功能：支持配置表格边框、斑马纹和尺寸选项，用户偏好持久化存储
- `MasterDetailLayout` 主从布局组件引入并优化工作流定义页面结构
- 路由守卫新增 403/404 页面区分逻辑，判断路径是否存在并返回相应页面

#### 部署与配置

- Nginx 配置支持 `/index` 和 `/index.html` 的 301 重定向到根路径
- 新增 `BASE_URL` 环境变量支持，适配多环境部署场景

### Changed

- 用户偏好默认表格尺寸调整为「小号」
- 表格尺寸选项中文描述优化（「默认」→「中等」，「宽松」→「大号」）
- 表格设置区域使用 `Divider` 组件替代冗余分隔线类，简化代码
- 可配置表格组件：常量 `DEFAULT_ALWAYS_VISIBLE_TITLES` 改为 `Set` 类型，存储访问统一使用 `globalThis`
- 禁止访问页面使用 `Empty` 组件替代自定义样式，简化代码
- 依赖更新：React、Semi UI 等核心依赖升级至最新版本

### Fixed

- 认证失败时正确清除所有相关 `localStorage` 数据，避免残留登录态

---

## v0.32.0 - 2026-05-31

### Added

#### 用户偏好设置

- 新增标签页风格选择功能，支持「线条」「胶囊」「卡片」三种 Tab 样式
- 新增动态浏览器标题开关，可按需控制浏览器标签页标题是否随路由动态变化
- 新增 Logo 图标显示开关，可按需隐藏侧边栏品牌 Logo
- 新增面包屑图标显示选项，默认开启

#### 布局组件增强

- `MasterDetailLayout` 新增折叠功能及状态管理，支持 `onCollapseChange` 回调和 `collapsible` 属性
- 侧边栏新增双列布局支持（`NavLayout` 类型扩展）
- 菜单搜索输入框新增展开/收起功能，宽度改为响应式

#### 主题与样式

- 新增「微信绿」主题颜色预设（亮色/暗色模式）
- 侧边栏折叠状态下选中菜单项样式优化，选中叶子菜单项背景与目录项保持一致
- 侧边栏折叠状态下的菜单项过渡效果优化，图标和文本居中对齐

#### 用户管理增强

- 用户资料新增性别字段，列表/详情/编辑均支持展示与修改
- 用户资料新增上次登录时间和 IP 字段
- 头像裁剪组件新增图片旋转功能（支持 90° 步进旋转）
- 个人资料页新增移除头像功能

#### 公告管理

- 新增定时发布功能，支持设定未来时间自动发布公告
- 定时公告自动发布 Cron Job（每 5 分钟检查一次）

#### 安全与日志

- 角色禁用与删除逻辑增强：禁止禁用超级管理员角色，删除时进行角色存在性检查
- 登录日志新增模拟数据（操作系统、用户代理、状态字段）
- 登录日志新增登录地点记录（基于 ip2region 解析 IP 地址）

### Changed

- 仪表盘欢迎横幅重构：使用 Card 组件替换原有结构，添加用户头像点击跳转功能
- 个人资料页重构：使用 Descriptions 组件替换原有布局，优化信息展示
- 仪表盘架构项展示方式更新（List → Descriptions）
- 404 页面样式与内容更新，新增返回首页和上一页按钮
- 收件箱和公告管理空状态展示图标更新为新插图组件
- 错误边界组件展示逻辑更新，使用新插图组件替换错误提示
- 侧边栏样式 lint 规则调整（禁用 `no-descending-specificity`）

### Fixed

- 用户组管理部门路径缓存优化（通过 `useMemo` 缓存部门路径）

---

## v0.31.0 - 2026-06-04

### Added

#### 菜单外链支持

- 菜单新增 `isExternal` 外链标识与 `query` 路由查询参数字段
- 外链菜单在侧边栏与顶部导航均支持新标签页打开
- 顶部导航新增 `TopNavWithOverflow` 溢出组件，超出宽度时自动折叠到下拉菜单

#### 用户权限精细化管理

- 新增用户菜单权限直接授权功能，支持查看与覆盖用户最终有效权限
- 新增用户数据权限管理功能，支持直接授权与角色继承权限对比展示

#### 数据库管理增强

- 新增 SQL 收藏夹功能（增删改查、一键加载到编辑器）
- 新增导出表结构 / 数据 SQL 功能，支持多种导出模式
- 新增 CSV 导出与截断表操作

#### HTTP 流量日志

- 新增入站（Incoming）与出站（Outgoing）HTTP 请求结构化日志记录
- 支持多种日志级别与输出格式，自动脱敏敏感字段（Authorization / Cookie 等）
- 出站日志支持独立文件 `HTTP_LOG_OUTGOING_FILE` 配置

### Changed

#### 响应式布局全面优化

- 侧边栏在所有屏幕尺寸下始终可见，窄屏自动折叠为图标模式（不再消失）
- Header 右侧操作区窄屏适配：< 992px 隐藏用户名，< 768px 收起公告/消息/主题切换到溢出「···」菜单
- Modal 窄屏最大宽度限制 95vw，SideSheet 480px 以下全屏展示
- 面包屑、标签栏、页面容器在小屏设备上减少内边距

#### CSS 主题色变量化

- `AppLogo`、登录页背景渐变、Eyebrow 徽标、按钮阴影全部替换为 `--semi-color-primary-*` 变量，切换主题色时自动跟随
- 工作流设计器节点标签色（`--fd-tag-*`）改为 `var(--semi-color-primary)` 与 `var(--semi-color-primary-light-default)`
- 通知红点阴影、侧边栏 Logo 渐变改为 CSS 变量，深色/浅色模式统一处理

### Fixed

- 修复用户数据权限弹窗获取最宽松权限逻辑，当第一个参数为空时正确回退
- 修复数据库管理截断表确认对话框类型错误

---

## v0.30.0 - 2026-05-29

### Added

#### OAuth2 应用管理

- 新增 OAuth2 应用管理页面，支持应用的增删改查
- 新增 OAuth2 授权同意页面，集成 Mock 服务以支持 OAuth2 标准流程

#### 数据脱敏

- 新增数据脱敏配置功能（增删改查接口 + 前端管理页面）
- 支持获取脱敏规则详情，编辑时正确回填数据

#### 幂等控制

- 新增幂等控制中间件，提供客户端 Token（`X-Idempotency-Key`）与服务端自动指纹两种模式，防止重复提交

#### 主题与样式

- 新增朱砂红、少女粉、琥珀金、天空蓝等主题颜色预设
- 调整卡片与模态框圆角样式，统一使用 CSS 变量

#### AI 能力

- 新增快捷聊天与用户自定义 AI API Key 配置项

### Changed

- 标签页下拉菜单（刷新、固定、关闭等操作）新增对应图标
- 表格公共列工具（`createdAtColumn` / `renderEllipsis`）推广至多个页面，禁止内联 `<Typography.Text>` 写法
- 弹窗表单布局规范更新：明确 `labelWidth` 取值规则与 Modal 宽度范围

---

## v0.29.0 - 2026-05-29

### Added

#### 文件预览

- 新增 `FilePreviewModal` 组件，支持图片、音频、视频、PDF 文件的在线预览
- 文件管理页集成 AudioPlayer / VideoPlayer / PDFPreviewPanel，可直接预览媒体文件

#### 聊天

- 聊天页支持上传并发送 PDF 文件，消息气泡渲染 PDF 卡片
- 新增 `GroupGridAvatar` 组件，展示群组成员九宫格头像

#### 响应式布局

- 移动端侧边栏自动折叠（基于 `matchMedia` 监听屏幕宽度变化）
- `MasterDetailLayout` 新增单栏模式（`showDetail` / `onBack` 属性），适配移动端主-从切换

#### 用户头像

- 新增全局 `UserAvatar` 组件，统一头像展示逻辑，支持头像图片与背景色生成

#### 错误处理

- 新增页面级 `PageErrorBoundary` 错误边界，捕获运行时错误并给出友好提示
- 新增 `useGlobalErrorHandler` 钩子，统一捕获未处理的 Promise 拒绝与运行时异常，带去重和限流机制

#### 管理员布局

- Tab 标签栏支持鼠标滚轮横向滚动

### Changed

- Tab 标签栏右键菜单由手写 DOM 实现改为 Semi Design `Dropdown` 组件（自动处理边界溢出）
- 主题切换按钮去掉外层 Tooltip，当前模式名称移至下拉菜单标题行展示
- 全屏按钮改用浏览器原生 `title` tooltip，移除 Semi Tooltip 包裹
- 公告中心、我的消息页去掉 `search-area` 容器包裹，Tabs 组件加 `flex: 1` 撑满全宽
- IP 访问控制页加 `page-container` 类，与其他页面布局统一
- 接口限流页加 `page-container` 类，修复卡片横向溢出（`minmax(min(360px, 100%), 1fr)`）
- 全局样式暗色模式颜色方案改用 Semi 设计变量
- Vite 将 `decimal.js` 加入 `optimizeDeps.include`，消除 HMR 热更新时偶发的 "not a constructor" 报错

### Fixed

- 修复公告页面标题渲染逻辑（空值合并运算符）
- 修复群组信息编辑中公告更新的默认值处理
- 修复角色管理中角色名称、编码、邮箱字段的渲染空值问题
- 修复全局错误处理重复 Toast 通知问题，忽略浏览器扩展与 ResizeObserver 警告

---

## v0.28.0 - 2026-05-29

### Added

#### 角色管理 - 数据权限

- **新增两种数据权限类型**：在原有「全部」「本部门及以下」「仅本人」基础上，新增「指定部门数据权限」（custom）和「本部门数据权限」（dept_only），共支持 5 种数据权限范围
- **指定部门选择器**：选择「指定部门」时，弹窗展示部门树供勾选，支持多选任意部门节点

#### AI 管理

- **用户自定义 AI 配置**：用户可自行配置个人 AI 服务商参数，与系统配置并行使用，支持增删改查
- **测试连接功能**：AI 服务商配置表单新增「测试连接」按钮，可验证配置是否有效
- **供应商类型折叠展示**：AI 服务商列表按供应商类型分组折叠，支持全部展开/全部折叠
- **聊天功能**：AI 聊天页面支持创建、切换、删除会话，集成 AI 服务商配置选择

#### 用户管理

- **用户删除**：管理员可删除用户（超级管理员账号不可删除），删除前有二次确认
- **登录锁定状态**：用户列表展示账号是否处于登录锁定状态

#### 菜单管理

- **新增获取详情接口**：支持 `GET /api/menus/{id}` 获取单个菜单详情，编辑时异步加载

### Changed

- **多处编辑弹窗**：部门、字典、岗位、租户、用户组、AI 服务商、工作流自动化、事件订阅等均改为点击编辑时异步获取最新详情，避免使用列表缓存数据

### Fixed

- **Auth 稳定性**：Redis 连接失败时不再返回 401，后端未启动完成时不清除前端 token
- **种子数据**：修复可能覆盖用户修改数据的种子逻辑，菜单改为仅首次初始化时插入
- **AI 接口**：修复供应商列表接口返回直接数组被错误读取为 `.list` 属性等多处 Bug

---

## v0.27.0 - 2026-05-27

### Added

#### 偏好设置

- **保存标签页**：偏好设置新增「保存标签页」开关（默认开启），启用后刷新/重启页面自动恢复上次打开的标签页及激活状态，禁用时清除持久化数据

#### 公告管理

- **未读数 Badge**：顶部栏公告图标实时展示未读公告数量，下拉菜单入口同步显示数字徽标
- **公告详情弹窗**：顶部栏可直接预览最新公告列表，点击查看详情并自动标记为已读
- **发布与撤回**：公告管理页面新增发布/撤回操作，支持公告状态流转

### Changed

- 消息通知图标由收件箱（Inbox）改为铃铛（Bell），与主流后台系统保持一致

---

## v0.26.0 - 2026-05-24

### Added

#### 工作流引擎（重大更新）

- **事件总线与 Webhook 订阅**：引入基于 EventEmitter 的工作流事件总线，覆盖 instance/node/task 12 类生命周期事件；新增 `workflow_event_subscriptions` / `workflow_event_deliveries` / `workflow_trigger_executions` 三张表；提供 Webhook 订阅 CRUD/启停/投递列表/重试 11 个端点；HMAC-SHA256 签名 + 5 段指数退避重试机制
- **触发器节点执行**：支持 updateData/deleteData 触发器类型，实现 fallbackStrategy 兜底策略
- **外部审批回调**：支持外部审批配置与回调地址查看，触发器执行记录页可查看执行历史
- **流程发起范围配置**：基础信息面板支持按用户/部门/角色配置发起范围，部门选项接口包含 parentId，树形选择展示部门层级
- **流程分类管理**：新增分类侧栏组件，支持分类的增删改查与颜色选择，集成到工作流设计页面
- **版本管理**：新增历史版本管理功能，支持查看与恢复历史版本
- **驳回到指定节点**：支持查找祖先审批/办理节点并选择驳回去向，提供驳回回退提示与高亮展示
- **表单增强**：新增格式化控件（手机号、邮箱、身份证、网址、评分、公式字段类型）及校验规则；新增舱位与往返选项配置，支持日期范围自动计算出差天数；可达节点计算与表单渲染器集成
- **节点编辑**：节点标识(key)可编辑，支持节点复制、撤销/重做、历史版本查看与恢复
- **流程监控优化**：流程管理添加分类和发起人过滤；触发器执行/事件订阅页面统一使用 page-container 布局

#### 系统功能

- **IP 访问控制拦截日志**：新增 `ip_access_logs` 表及相关 API，记录和查询 IP 拦截日志
- **布局组件**：引入 `MasterDetailLayout` 组件，统一左右分栏布局，支持可拖拽调整宽度和持久化状态

#### 其他

- 新增工作流后端文档章节，更新事件类型、字段配置、生命周期状态及节点配置文档
- OAuth 外呼增加 10s 超时与 1 次重试

### Changed

- 工作流设计器 UI 优化：工具栏样式与返回按钮、表单标签位置与宽度、画布样式与内边距
- 多个页面表格列文本展示优化（Typography.Text 组件实现省略和 Tooltip）
- 地区管理实现表格高度自适应（ResizeObserver）
- 聊天页面新增会话列表样式
- 系统页面布局调整为高度 100% 以适应不同屏幕

### Fixed

- 修复数据库迁移顺序漂移并补幂等热修迁移
- 删除冗余的工作流范围列迁移脚本
- 修复文档对源码的反向链接、VitePress 死链与模板插值问题

---

## v0.25.0 - 2026-05-22

### Added

#### 外呼 HTTP 客户端

- 新增统一外呼 HTTP 客户端 `packages/server/src/lib/http-client.ts`：基于 undici，提供 `httpRequest` / `httpGet` / `httpPost` / `httpPut` / `httpPatch` / `httpDelete` 与统一错误 `HttpClientError`
- 支持显式超时（默认无超时）、指数退避重试（默认 0 次）、按 host 维度的熔断器（连续 5 次失败开启 30s 冷却）、`baseURL` 拼接、`AbortSignal` 协作
- 代理仅由调用方代码传入 `proxy` 参数，不读取 `HTTP_PROXY` / `HTTPS_PROXY` 等环境变量，避免运维环境差异导致的行为漂移
- winston 结构化日志：自动脱敏 `authorization` / `cookie` / `*token*` / `*secret*` / `*password*` 等敏感 Header，并按 `logBodyLimit` 截断响应正文
- 全部出站调用迁移：GitHub / 钉钉 / 企业微信 OAuth 三处接口、Chat 链接预览抓取（保留 `redirect: 'manual'` + 私网 IP 拦截 SSRF 防护）
- 新增 [docs/backend/http-client.md](/backend/http-client) 文档与 zenith skill 后端硬性约束：禁止直接 `fetch()`

#### 数据库管理（DB Inspector）

- 表数据视图新增**多选 + 批量操作**：支持选中多行后批量删除、批量复制为 `INSERT` / `UPDATE` SQL；批量删除走逐行 DELETE 并复用单行接口的审计日志
- 列头筛选升级为**高级筛选**：每列可独立选择运算符 `ILIKE / = / ≠ / > / ≥ / < / ≤ / IS NULL / IS NOT NULL`，前端编码为 `op|value` 字符串、后端按白名单生成参数化 WHERE 子句
- 数据表支持**列宽拖拽**与**列显隐配置**（按 `schema.table` 维度持久化到 localStorage）
- 列头**外键标记**：对存在 FK 约束的列追加蓝色 `FK` Tag，点击可一键跳转到引用表的数据视图
- 表数据视图新增**单元格双击行内编辑**（EditableCell），适配文本 / 数值 / 布尔 / JSON / 长文本等类型
- 行级上下文菜单新增**复制行 SQL**：可复制为 `INSERT` 或 `UPDATE` 语句
- 新增 **ER 图**顶层 Tab：基于 @xyflow/react + dagre 自动布局，节点展示列信息，选中表高亮关联表；工具栏支持表/列搜索定位、隐藏孤立表、PNG / SVG 导出（PNG 通过 SVG → Canvas 2x DPI 渲染，速度与画质均显著优于截图方案）

#### 操作日志

- 操作日志新增 `response_body` 字段记录完整响应体，详情面板新增「响应详情」Tab
- 操作日志统计 DTO 扩展 `summary` / `methodStats` / `hourlyStats`，前端面板新增汇总卡片、HTTP 方法分布、24 小时分布图表
- StatCard 组件移除直接边框颜色，改为通过 `color` 参数控制主题

#### 登录日志

- 登录日志新增 `userAgent` 字段，记录并在列表中展示用户浏览器信息

### Fixed

- 表数据视图未指定排序时回退到主键 ASC 排序，避免 UPDATE 后行的物理顺序漂移
- 修复 Drizzle 操作日志迁移 `_journal.json` 时间戳错乱导致迁移未被应用的问题
- 修复 `_journal.json` 文件末尾缺少换行的格式问题
- 修复 Recharts v3 升级后 `OperationLogStatsPanel` 中 `labelFormatter` 类型不匹配导致 web 构建失败的问题

---

## v0.24.1 - 2026-05-22

### Added

#### 数据库管理（DB Inspector）

- 表数据视图支持「新增行」「双击单元格编辑」「行级删除」操作，配套后端 INSERT / UPDATE / DELETE 接口，全部走参数化 SQL 并写入审计日志
- 系统表（`pg_catalog` / `information_schema` / `audit_logs` 等）与无主键表自动只读，受 `system:db-admin:write` 权限保护
- 表浏览页支持按表中文注释搜索、按 schema 分组显示，表标题下方展示注释
- 业务表与字段补齐中文 PostgreSQL `COMMENT`，提升数据库自描述性
- SQL 控制台 CSV 导出按钮新增 loading 状态

### Fixed

- 修复 React 19 + TS 新 JSX transform 下 `JSX` 命名空间未导出导致 `build:demo` 失败的问题
- 修复表注释在表格信息区显示错乱的问题

### Changed

- 调整 PostgreSQL 类型映射顺序，新增 INTERNAL_PARSER_NAMES 集合优化数据类型解析
- 移除表格垂直滚动限制，优化大表展示体验

---

## v0.24.0 - 2026-05-21

### Added

#### 数据库管理（DB Inspector）

- 新增系统功能「数据库管理」页面（`/system/db-admin`），集成 Monaco Editor 的 SQL 控制台、表结构 / 索引 / 外键浏览、表数据分页查看与查询历史记录
- 表数据视图支持服务端排序与列筛选，采用 Semi Table 官方「带排序和过滤功能的表头」API（受控 `sortOrder` / `filteredValue` + `renderFilterDropdown`），Loading 状态走 Table 内置遮罩、工具栏与分页保持常驻
- SQL 查询 CSV 导出改为基于 postgres-js cursor 的流式响应：批大小 1000，首字节延迟接近第一批结果到达时间，内存恒定，可安全导出大表
- 所有 SQL 在 `BEGIN; SET LOCAL TRANSACTION READ ONLY; ...` 中执行，PostgreSQL 原生拒绝任何写操作；表浏览接口对 schema / table / column 名做白名单校验避免拼接注入；导出与查询均受 `statement_timeout` 保护

#### 公告管理增强

- 公告广播流程重构，新增公告更新、删除、已读事件的实时推送处理
- 用户下拉菜单新增「公告中心」入口，公告页面支持筛选与已读统计
- 顶部铃铛 badge 通过全局事件监听器实时同步

#### 站内信管理（管理员视角）

- 新增管理员视角的站内信管理 API：分页列表（多条件查询）、标记任意消息已读、删除任意消息
- 用户端站内信已读 / 删除 / 全部已读支持实时事件推送，前端组件实时刷新
- 顶部铃铛 badge 通过全局事件实时同步消息状态

#### 文档

- 新增 WebSocket 事件清单文档，涵盖公告、站内消息、会话、即时聊天等推送事件与 API

### Changed

- 聊天页面「新建对话」面板由内嵌结构改为模态框，简化交互流程
- 聊天图片转换为 PNG Blob 的逻辑提取为模块级函数，简化代码结构
- 多个组件（CronBuilderPopover、ChatPage、AddNodeButton、NodeCard）按钮增加 Tooltip 提示
- 短信 / 邮件 / 公告等多处状态标签组件 props 改为 `Readonly<...>`
- 验证模块邮箱校验改为 `z.email()` 简化写法
- ESLint 配置导出方式由 `tseslint.config()` 改为数组形式

### Fixed

- 数据库管理列筛选服务端 SQL 中 `column_name = ANY(${array}::text[])` 因 Drizzle 数组参数展开导致的 PG 错误，改为 `IN (sql.join(...))` 并合并 orderBy/filters 列名校验为单次查询
- 数据库管理数据 Tab 切换排序/筛选时整段 `<Spin />` 替换导致的视觉闪屏，改用 Table 自带 `loading` prop

---

## v0.23.0 - 2026-05-21

### Added

#### 审计字段（Audit Columns）通用化

- 新增通用审计列辅助函数 `auditColumns()`，业务主表统一展开 `...auditColumns()` 自动拥有 `created_by` / `updated_by` 字段
- `db` 实例通过 Proxy 拦截 `insert` / `update` / `insert().onConflictDoUpdate({set})` 操作，自动从审计上下文（audit-context）写入 `created_by` / `updated_by`，业务代码无需手动赋值
- 新增 `auditFields` DTO 片段（`lib/dtos/_audit.ts`），所有响应实体 DTO 通过展开 `...auditFields` 统一暴露审计字段

#### 工作流功能增强

- 工作流定义与实例新增创建者（`createdBy`）和更新者（`updatedBy`）字段，通过通用审计列自动维护

#### 多租户工具函数

- 新增 `tenantCondition(table, user)` 和 `getCreateTenantId(user)` 工具函数，简化多租户数据隔离逻辑
- 工具函数在 `MULTI_TENANT_MODE=false` 时返回 `null`/`undefined`，与单实例行为兼容

#### 用户详情懒查询

- 新增用户详情懒查询功能，支持按需获取用户角色、部门等关联信息，避免全量加载性能开销

#### 站内信管理

- 新增「站内信管理」页面，支持对站内信进行增删改查及发送管理

#### 短信功能模块

- 新增「短信配置」管理页面，支持多服务商短信配置
- 新增「短信发送日志」管理页面，记录短信发送历史
- 新增「短信模板」管理页面，支持模板创建与维护

### Changed

#### 部门管理

- 新增部门时支持设置负责人 ID（`leaderId`）字段
- 优化部门负责人相关字段逻辑与数据结构

#### 邮件/站内信模板

- 优化邮件模板表单布局，提升编辑体验
- 优化站内信模板表单布局

---

## v0.22.0 - 2026-05-19

### Added

#### 接口限流可视化与动态配置

- 新增「系统管理 → 接口限流」管理页面，支持对 `auth` / `captcha` / `sensitive` 三类限流规则进行可视化配置（时间窗口、上限、计数维度 ip/user/ip_path、启用开关、自定义拦截提示）
- 限流规则改为数据库驱动 + 内存缓存，保存后立即热更新到运行中的服务，无需重启
- 实时统计每条规则的命中次数、拦截次数、拦截率，并展示最近 100 条拦截记录（含触发 Key 与请求路径）
- 新增「近 24 小时拦截趋势」折线图（命中 / 拦截 双线），通过 Redis Hash 按小时聚合
- 支持按需「解封」单个被限流 Key 与「重置统计」操作
- 新增数据库表 `rate_limit_rules`、枚举 `rate_limit_key_type`，迁移 `0046_useful_mastermind.sql`
- 新增菜单：`系统管理 → 接口限流`（id 320/321/322），权限 `system:rate-limit:view` / `system:rate-limit:manage`
- 后端新增路由：`GET /api/rate-limit/rules`、`PATCH /api/rate-limit/rules/{id}`、`GET /api/rate-limit/stats`、`POST /api/rate-limit/unblock`、`POST /api/rate-limit/reset-stats`

#### WebSocket 连接监控

- 监控页面新增 WebSocket 在线连接数、累计连接数、断开次数等关键指标
- 展示最近 50 条 WebSocket 断开记录（含 token、断开原因、时长）

#### 聊天功能增强

- 聊天页面新增聊天记录搜索面板，支持按关键字、发送人、时间范围多条件筛选与结果定位
- 聊天消息列表改用 Semi UI `List` 组件，提升样式一致性与交互体验
- 公告历史改用 `List` 组件展示，并支持群主删除公告历史

### Changed

- 优化聊天记录定位按钮文案与样式（「定位到聊天位置」）
- 限流页面权限校验改用解构 `hasPermission`，规范用法
- 用户管理表单调整密码输入框标签宽度（72 → 90）以适配中文标签

### Fixed

- 修复 `MonitorPage` 中 `rowKey` 在 `WsDisconnect` 数据下的类型不兼容，导致构建失败的问题

---

## v0.21.0 - 2026-05-18

### Added

#### 用户偏好设置

- 新增 `PreferencesProvider` 和 `usePreferences` Hook，支持用户偏好设置（文件视图模式、主题等）的加载与保存，并增加防抖机制优化状态管理

#### 日志管理

- 新增登录日志和操作日志组件（`LoginLogsTable`、`OperationLogsTable`），在个人资料页面和相关页面中集成展示

#### 用户管理增强

- 新增 API Token 过期时间选择器，支持为 Token 设置过期时间
- 新增解锁用户功能的下拉菜单，优化操作入口

#### 通知管理

- 新增通知详情模态框组件（`NoticeDetailModal`），统一通知详情的展示逻辑

### Changed

#### UI 组件重构

- 聊天页面：使用 Semi UI 的 `List` 组件重构对话列表和搜索功能展示
- 聊天页面：使用 Semi UI 的 `List` 组件重构收藏消息列表
- 转发对话框：使用 Semi UI 的 `List` 组件重构会话列表
- 会话设备列表：使用 Semi UI 的 `List` 组件重构会话设备项
- 文件页面：使用 Semi UI 的 `List` 组件替代原有网格布局，并调整网格间距以适应不同屏幕尺寸

#### 主题与样式优化

- 主题颜色应用逻辑优化：同时设置 html 与 body 的主题色，避免默认变量覆盖
- 主题控制逻辑重构：将相关代码从 `ThemeProvider` 提取至 `theme-controller.ts`
- 标签项关闭按钮悬停效果增强，增加背景色和透明度变化
- 头像组件背景色和文本颜色根据用户头像是否存在动态设置
- 多处组件背景色统一调整为 `var(--semi-color-bg-2)`，提升暗色主题一致性
- 快速聊天按钮和通知页面按钮样式调整为主按钮

#### 其他优化

- 日志文件管理：将搜索框移至文件列表头部，提升搜索体验
- 文件存储配置页面：调整 OSS 和 S3 配置项字段位置，优化弹窗宽度（720px）和标签宽度（120px）
- 角色管理页面：操作按钮布局优化，添加下拉菜单整合用户分配与数据权限功能
- 菜单页面和部门管理：移除父级选择的展开全部功能
- 标签页动画选择逻辑重构：按钮选择器替换为单选框组件

---

## v0.20.0 - 2026-05-17

### Added

#### 标签管理

- 新增标签管理完整 CRUD 功能：支持标签的增删改查、批量删除、状态筛选
- 支持标签颜色选择器，可为标签配置自定义颜色
- 标签列表支持按分组筛选，分页展示

#### 可配置表格（ConfigurableTable）

- 新增 `ConfigurableTable` 组件，支持列显示/隐藏配置，用户偏好持久化存储
- 将所有 CRUD 列表页面的 `Table` 替换为 `ConfigurableTable`
- 新增用户偏好设置项：控制是否显示表格列设置按钮

#### 个人资料页面增强

- 资料展示新增手机号、所属部门、当前岗位信息
- 添加头像上传选择器，优化头像更换交互体验
- 更新资料接口支持手机号字段的修改与校验

#### 侧边栏优化

- 新增侧边栏分组标题滚动固定（sticky）功能
- 支持通过用户偏好设置开关该粘性效果

#### 后端架构优化

- DTO 模块按业务域拆分至 `packages/server/src/lib/dtos/` 子目录（roles / positions / users / menus / departments 等多个文件），通过统一 barrel 文件导出

### Fixed

- 修正用户 DTO 导入路径（从 `./iam` 改为 `./users`）

---

## v0.19.0 - 2026-05-17

### Added

#### 缓存管理

- 新增查看缓存值功能：支持通过 Modal + JsonViewer 格式化展示指定 key 的完整缓存值
- 接口限流计数类别标识：在缓存分类中新增 `rl`（限流）类别显示

#### 用户偏好设置

- 新增用户偏好设置功能：新增 `PreferencesProvider` 和 `usePreferences` Hook，支持文件视图模式（列表/网格）的选择与 localStorage 持久化

#### 定时任务管理

- 任务日志支持按任务 ID（jobId）过滤，便于查看单个任务的历史执行记录

#### 文件管理

- 文件上传支持显示进度条，多文件上传场景下展示每个文件的上传状态
- 文件列表网格视图优化：调整卡片布局、列宽与间距，增加文件类型标签
- 新增可执行文件（`application/x-executable` 等）图标支持

#### 文档

- 新增 Docker 部署指南，包含前置依赖、快速开始、服务拓扑及环境变量详细说明
- 新增 Docker Compose 配置文件（开发环境 + 生产环境）及 Dockerfile、`.dockerignore`
- 新增数据库事务规范文档与数据库操作规范文档

### Changed

#### 文件存储

- 文件读取接口全面改为流式返回（`ReadableStream`），替代原先一次性加载 Buffer 的方式，降低内存峰值
- 文件上传改为流式传输，提升大文件上传性能

#### 样式与布局优化

- 多个管理页面（用户、部门、定时任务、文件存储配置、租户管理、消息模板、数据库备份）表单统一改为栅格布局，标签位置和宽度保持一致

### Fixed

- 修复批量下载功能中流式接口适配问题（`readStoredFile` 改为返回 stream 后同步更新 ZIP 打包逻辑）

---

## v0.18.0 - 2026-05-16

### Added

#### 文件管理

- 新增批量下载功能：后端使用 `archiver` 流式打包 ZIP，前端调用后端接口而非在浏览器内存中压缩，显著降低大文件批量下载的内存占用
- 新增地区管理导出功能：支持将地区数据导出为 Excel 文件

#### 通知中心

- 新增消息通知中心入口：头像下拉菜单中增加「通知中心」快捷链接
- 已读消息列表：新增「已读」标签页，展示已读消息记录
- 通知详情弹窗：新增上一条/下一条导航按钮

#### 布局

- 侧边栏品牌标题字体调大至 17px

### Changed

#### 性能优化

- Excel 导出全面改为流式写入（`ExcelJS.stream.xlsx.WorkbookWriter`）：12 个导出接口不再将整个文件加载为 `ArrayBuffer` 后一次性返回，而是边生成边以 chunked transfer encoding 推送，减少内存峰值

### Fixed

- 修复 Redis 重启后在线用户列表丢失问题
- 修复 Refresh Token 过期后无法自动登出问题
- 修复程序退出时 Redis 连接与定时任务未优雅关闭的问题，新增超时保护兜底
- 修复 SonarLint / ESLint / TypeScript 静态分析警告
- 修复自定义主题色按钮点击无响应问题（移除内层 Tooltip 包裹）

---

## v0.17.0 - 2026-05-12

### Added

#### 消息中心增强

- 新增消息虚拟滚动，大量历史消息场景下渲染性能显著提升，并支持消息高亮定位
- 新增消息回复功能，支持引用回复并在气泡中展示被回复消息内容
- 新增草稿功能，切换会话时自动保存未发送内容，刷新后从 localStorage 恢复
- 新增链接消息类型支持，媒体库新增链接分类浏览
- 新增消息发送失败提示，会话列表中标记发送失败状态
- 新增上下文定位模式，查看历史消息后可一键返回最新消息
- 优化置顶消息交互，新增「取消置顶」按钮
- 在会话列表与聊天页面的 Popover 中展示用户手机、邮箱、部门及岗位信息

#### 系统增强

- 标签页最大数量限制生效，超出限制时展示一次性 Toast 提示

### Changed

- 切换媒体库 Tab 时清空旧媒体数据，避免旧数据短暂闪烁
- 用户管理页面交换「编辑」与「修改密码」按钮位置，操作逻辑更符合直觉

### Fixed

- 修复文件类型回复消息无法正确显示文件名的问题
- 修复会话处于活动状态时草稿文本未及时清空的问题
- 优化消息列表查询，过滤当前用户已删除（隐藏）的消息

### Performance

- 后端认证相关接口（登录、注册、获取/更新个人信息等）多项独立查询改为 `Promise.all` 并行执行
- 聊天服务消除 N+1 查询，改为批量并行数据库查询
- 审计日志写入与 WebSocket 广播延迟至响应后通过 `setImmediate` 异步执行，降低接口延迟

---

## v0.16.0 - 2026-05-11

### Added

#### 快捷聊天（QuickChat）

- 新增快捷聊天浮动按钮，可在任意页面快速唤起聊天面板
- 支持在系统设置中控制快捷聊天按钮的显示/隐藏
- 面板支持 Esc 关闭与关闭动画（slide-out）
- 支持通过菜单导航时自动携带当前活跃会话（onConvChange 回调）
- 全屏聊天页面支持通过 URL 参数直接激活指定会话

#### 消息中心增强

- 新增投票消息类型，支持创建和参与投票，消息气泡展示投票选项与结果
- 新增全局消息搜索功能，支持关键词搜索与分页浏览
- 新增未读 @ 我消息提示，会话列表与消息中标记 hasMentionUnread 状态
- 新增「正在输入」提示功能，实时显示正在输入的成员昵称
- 新增内联图片缩略图组件（QuickImageBubble），支持加载受保护图片 URL
- 新增图片和文件发送功能，支持上传后直接发送至聊天
- 消息获取接口改为游标分页（cursorId + hasMore），解决传统分页数据错位问题

#### WebSocket 稳定性

- 新增 WebSocket 连接状态提示，断线时显示连接断开提醒
- 断线重连成功后自动补拉会话列表与当前会话最新消息

### Fixed

- 修复游标分页场景下获取最旧消息 ID 的逻辑，避免 oldestMsgId 被错误置为 null

### Changed

- 重构快速聊天按钮与聊天页面组件，采用懒加载优化首屏性能，简化状态管理
- 优化消息追加逻辑，添加 appendMessageOnce 方法防止重复消息插入
- 移除会话项、消息气泡按钮、工作流节点、审批时间线等多处冗余左边框样式

---

## v0.15.0 - 2026-05-09

### Added

#### 消息中心增强

- 新增消息内联编辑功能，支持 24 小时内修改文本消息，含快捷键提示
- 新增 @ 提及候选项键盘导航，支持上下方向键选择与回车插入
- 新增会话免打扰功能（数据库新增 `is_muted` 字段），支持静音单个会话
- 新增媒体库面板，可按会话浏览历史图片与文件
- 新增图片预览组件（ImagePreview），替换旧版图片画廊，支持后台加载与灯箱展示
- 新增输入状态动画效果，提升「正在输入」提示的视觉体验
- 优化获取当前用户信息的方式，改用 `useAuth` Hook，移除对 localStorage 的直接解析

### Fixed

- 修复转发消息时消息类型丢失的问题，现直接沿用原消息类型

### Security

- 在通知与公告页面引入 DOMPurify，对富文本 HTML 内容进行消毒，防范 XSS 攻击
- 强化链接预览接口的私有地址检测逻辑，防范 SSRF 攻击（含重定向跳转场景）

---

## v0.14.0 - 2026-05-06

### Added

#### 消息中心增强

- 新增消息转发功能，支持逐条转发与合并转发两种模式
- 新增消息表情回应（Reaction）功能，支持 Emoji 快速反应与计数展示
- 新增文件上传与发送能力，消息气泡支持文件类型展示
- 新增批量删除消息功能（仅对自己隐藏，不影响其他成员）
- 新增收藏消息预览弹窗，支持定位至原消息
- 新增 @ 提及功能，支持快速选择会话成员插入提及

#### 标签页管理

- 新增标签右键上下文菜单：刷新、关闭、关闭其他、关闭全部标签

#### 文档 / 首页

- 新增核心能力矩阵可视化组件（FeatureMatrixFlow），支持点击跳转至对应功能模块
- 优化首页 Hero 区域描述与架构分层展示，补充功能模块文档结构

#### 用户管理

- 部门组织架构树新增「全部展开 / 全部折叠」功能
- admin 超级管理员账号新增删除与禁用保护

### Changed

#### 暗色模式背景全面修正

- 消息中心、AI 智能对话、日志文件、IP 访问控制等多个页面的黑色背景统一修正为 Semi Design `bg-1/bg-2` 色阶，消除纯黑（`bg-0`）刺眼问题
- AI 对话代码块标题栏、代码内容区、关联问题（hint）背景色统一修正为 `bg-2`
- 全局 Card 组件背景统一为 `bg-1`，修复暗色模式下卡片偏深问题

#### UI 交互统一

- 全局多个模块（系统管理、部门、用户等）的新增、查询、导出、展开/折叠等功能性按钮统一改为 `type="primary"`，提升视觉可见性

#### 依赖升级

- 升级 `@douyinfe/semi-ui`、`lucide-react`、`recharts`、`TypeScript`、`Vitest`、`@vitejs/plugin-react` 等至最新版本

---

## v0.13.0 - 2026-05-03

### Added

#### 消息中心（聊天）能力增强

- 新增完整消息中心能力：单聊/群聊、会话管理、实时消息、系统消息与消息撤回
- 新增会话置顶/星标、会话删除、未读计数显示与会话时间智能格式化
- 新增消息搜索与上下文定位能力，支持根据关键字快速回溯历史对话
- 新增输入状态通知（typing）、回复消息、图片/文件消息发送与展示能力

#### 群聊管理增强

- 新增群成员管理能力：添加成员、移除成员、群主转让、群名/群公告更新
- 新增群组头像网格展示与成员头像刷新机制，提升群聊识别度

### Changed

- 优化消息气泡、时间显示、菜单交互与消息操作体验（收藏、置顶、定位原消息等）
- 更新 README 与文档索引，补充消息中心功能说明

### Fixed

- 修复群组头像展示逻辑问题
- 修复用户相关用户名/邮箱唯一性校验边界问题（含租户隔离场景）
- 修复用户验证最小长度限制不一致问题

## v0.12.0 - 2026-05-02

### Added

#### 在线会话管理增强

- 在线用户列表标识当前浏览器会话（蓝色「当前会话」Tag），精确到 JWT tokenId 级别
- 强制下线新增模式选择弹窗：「仅下线此会话」或「下线该用户全部会话」
- 新增 `DELETE /api/sessions/user/{id}` 接口，支持一键踢出指定用户的所有在线会话

#### 文件管理增强

- 新增文件网格视图，支持图片预览、文件卡片交互
- 文件网格视图支持全选当前页、批量操作
- 新增文件操作下拉菜单（下载、详情、复制链接、删除）
- 新增批量下载功能（使用 fflate 打包为 zip）
- 新增文件类型筛选

#### 登录页面

- 实现登录重定向功能，未登录时保存来源路径，登录后自动跳回

### Fixed

- 修复 WebSocket 强制下线只踢出单个 session 而影响同用户其他连接的问题（改用 tokenId 精确管理）
- 修复用户管理选中行键类型转换问题
- 修复文件管理操作下拉菜单路由顺序问题

---

## v0.11.0 - 2026-04-30

### Added

#### 监控模块 SSE 实时推送

- 实现 SSE 差量推送机制，仅传输变化的指标数据，减少带宽占用
- 新增连接状态指示灯（连接中 / 已连接 / 断开），支持脉冲动画效果提升用户体验
- 监控页面新增趋势折线图（CPU、内存、网络），可视化历史指标变化
- 新增慢查询与慢日志展示表格

#### 文件管理增强

- 支持多文件同时上传，新增单文件上传 API 接口
- 新增批量删除文件功能，支持勾选后一键删除
- 根据文件类型动态渲染对应图标（图片、文档、压缩包等）
- 新增文件大小格式化工具函数
- 文件名称支持悬浮 Tooltip 提示，防止长名称截断无法识别

#### 登录页面优化

- 全面重构登录页视觉风格，更新背景色、Eyebrow 徽标、特性标签展示区域
- 调整底部间距与标题样式，提升整体美观度

### Changed

- 登录速率限制从「15 分钟内最多 10 次」调整为「3 分钟内最多 20 次」，优化登录频率控制策略
- 修正文件 URL 拼接逻辑，确保本地存储与对象存储场景下 URL 均正确生成

---

## v0.10.0 - 2026-04-30

### Added

#### 主题管理

- 新增 `ThemeProvider` 组件，支持「亮色 / 暗色 / 跟随系统」三种主题模式的切换与持久化
- 主题模式与主题色偏好存储于用户偏好，刷新后自动恢复
- 富文本编辑器新增暗色模式适配样式（`RichTextEditor.css`）

#### 审批时间线组件

- 将审批时间线逻辑提取为独立组件 `ApprovalTimeline`，在「我的申请」「工作流监控」「待我审批」三个页面中复用

### Changed

#### 错误处理统一

- 将 `AppError` 自定义错误类替换为 Hono 原生 `HTTPException`，统一全局错误处理链路，减少依赖层次

#### 分页规范完善

- SQL-builder 分页统一使用 `withPagination(query.$dynamic(), page, pageSize)`
- RQB 分页统一使用 `pageOffset(page, pageSize)`，全库完成迁移

#### 审计日志请求体解析

- 重构 `setAuditBeforeData` 函数，新增 `resolveAuditRequestBody` 以正确处理 multipart/JSON 等不同请求体格式

### Fixed

#### 客户端真实 IP 获取

- 修正 `getClientIP` 逻辑：优先读取 `x-forwarded-for` / `x-real-ip` 头，无反代时回退到 `getConnInfo` 获取直连 IP，解决反代场景下 IP 记录错误问题

#### 压缩中间件误压缩流式响应

- SSE 实时推送和文件下载等路由不再经过 `compress` 中间件，修复 SSE 事件流被截断的问题

#### SideSheet 内表格样式

- 修正侧边抽屉 `SideSheet` 内表格行/表头背景色，使用半透明背景色适配抽屉层级

#### 地区管理表格

- 启用虚拟滚动（`virtualized`）并设置垂直滚动高度，解决大量地区数据渲染卡顿问题

#### 工作流实例关键词搜索

- 工作流实例关键词过滤转义 LIKE 元字符，防止 SQL 通配符注入

---

## v0.9.0 - 2026-04-26

### Added

#### 操作日志前态快照（beforeData）

- 为所有主要业务模块的修改/删除操作补全 `beforeData` 快照注入，覆盖 20+ 路由文件中的 53 个审计操作点
- 新增 `getXxxBeforeAudit()` 辅助函数到所有 service 文件（users、roles、menus、departments、positions、dicts、notices、cron-jobs、system-configs、regions、message-templates、file-storage-configs、workflow-definitions、email-config、tenants、oauth-config、cache、sessions、files、db-backups、workflow-instances），使操作日志详情页的数据变更 diff 功能完整生效
- 敏感字段自动脱敏：`emailConfig.smtpPassword` 和 `oauthConfig.clientSecret` 在快照中替换为 `******`

#### 操作日志详情页增强

- 操作日志详情弹窗新增标签页布局，分为「基础信息」「请求详情」「数据变更」三个标签页，提升可读性

#### 日志文件关键词搜索

- 日志文件内容支持关键词过滤，前端和后端 API 同步支持 `keyword` 参数

### Fixed

#### 审计日志日期格式不一致

- 修复 `beforeData` 显示 ISO 8601 格式（`2026-04-25T10:00:00.000Z`）而 `afterData` 显示 `YYYY-MM-DD HH:mm:ss` 的不一致问题，所有快照现在统一通过 `mapXxx()` 格式化

#### LIKE 通配符注入防护

- 所有 `keyword` 模糊搜索参数统一转义 `%`/`_`，防止恶意 LIKE 注入

#### 跨租户数据泄露

- 修复 dicts、files、departments、importUsers、operation-logs 模块的跨租户过滤缺失问题

### Changed

#### 工作流实例状态值统一

- 工作流实例相关状态值从 `active` 统一改为 `enabled`，与系统其他模块状态枚举保持一致

---

## v0.8.0 - 2026-04-25

### Added

#### 区域选择缓存

- `RegionSelect` 组件新增缓存层（`RegionSelect.cache.ts`），区域数据首次加载后缓存，避免重复请求

#### Excel 导出

- 新增 `okExcel` / `excelBody` 响应辅助函数，多个模块支持导出 Excel 文件，日期时间统一使用 `dayjs` 格式化

### Changed

#### 时间格式规范统一

- 系统内所有日期时间字符串统一为 `YYYY-MM-DD HH:mm:ss` 格式
- 前端新增 `formatDateTime` / `formatDateTimeForApi` / `formatDateForApi` 工具函数（`packages/web/src/utils/date.ts`）
- 后端新增 `formatDateTime` / `formatNullableDateTime` / `formatDate` / `formatFileTimestamp` / `parseDateTimeInput` 等工具函数（`packages/server/src/lib/datetime.ts`）
- 禁止在业务代码中直接调用 `toISOString()` 等原生时间格式化方法

#### 响应体构造规范

- 统一使用 `okBody(data, msg?)` / `errBody(msg, code?)` 构造响应体，废弃内联字面量对象写法
- 所有路由文件完成规范迁移

#### 请求工具优化

- 下载文件错误处理增强，新增网络请求失败提示，401 状态自动尝试刷新 token

#### 监控页面

- Redis 命令总执行数使用 `Intl.NumberFormat` 格式化，符合中文数字展示习惯
- 修正进度条颜色样式选择器

### Fixed

- 修复 SonarLint 安全告警
- 修复用户管理中角色/岗位编码映射的空值安全问题
- 修复历史遗留测试失败（data-scope / auth / system-config）
- 修复工作流设计器高级设置面板重构后的编译错误

---

## v0.7.0 - 2026-04-24

### Added

#### Service 层全量提取

- 后端所有路由（21 个业务模块）完成 Service 层提取，业务逻辑从 route handler 迁移至 `packages/server/src/services/` 下独立的 `xxx.service.ts` 文件
- 新增 `AppError`（`packages/server/src/lib/errors.ts`），由全局 `onError` 统一转为标准 JSON 错误响应，route handler 不再需要手动捕获业务错误
- 数据映射函数统一以 `mapXxx` 命名（纯函数），前置校验函数统一以 `ensureXxx` 命名（抛 `AppError`）

#### 日志文件管理

- 新增「日志文件」页面（系统管理菜单下），支持日志文件列表、内容读取（最后 N 行）、实时追踪（SSE）、下载及删除
- 后端新增 `/api/log-files` 路由，含路径穿越安全防护
- 支持 `.log` 与 `.log.gz` 压缩日志文件的读取

#### 菜单搜索

- 顶部 Header 新增菜单搜索框，支持按菜单名称或面包屑路径模糊搜索，选中后自动跳转
- 偏好设置新增「显示菜单搜索框」和「显示全屏按钮」开关，可按需隐藏

### Changed

#### UI 规范统一

- 所有列表页面的状态列移至操作列左侧并设为固定列（`fixed: 'right'`），涉及：用户管理、部门管理、岗位管理、菜单管理、角色管理、字典管理、地区管理、文件存储配置、工作流、定时任务、数据库备份、消息模板、租户管理等 10+ 个页面

---

## v0.6.0 - 2026-04-23

### Added

#### 可观测性支持（OpenTelemetry + Prometheus）

- 集成 OpenTelemetry SDK，支持分布式追踪（通过环境变量 `OTEL_*` 配置）
- 集成 Prometheus 指标暴露，新增 `/metrics` 端点
- 更新 API 文档，补充健康检查与指标端点说明

### Changed

#### 数据库查询规范化

- 分页列表的 `total` 与 `list` 统一使用 `Promise.all` 并行执行，禁止串行 `await`
- 计数查询统一使用 `db.$count(table, where)` 工具方法，覆盖仪表盘统计、定时任务、通知、消息模板、角色管理等多个路由
- 新增 `pageOffset(page, pageSize)` 工具函数（`src/lib/pagination.ts`），统一分页偏移量计算，禁止手写 `(page - 1) * pageSize`
- `updatedAt` 字段通过 `.$onUpdate(() => new Date())` 自动维护，`db.update().set()` 中禁止手动传入 `updatedAt`

#### 关联查询优化

- 推荐使用 Drizzle RQB（`db.query.*`）替代手写 `LEFT JOIN`，用户角色查询、用户管理等路由已迁移

#### 事务原子性增强

- 通知接收者保存、角色菜单分配、角色用户分配、API Token 相关多步写操作统一使用 `db.transaction()` 确保原子性

---

## v0.5.0 - 2026-04-22

### Added

#### 实体 DTO 中心化架构

- 所有响应实体 DTO 按业务域拆分至 `packages/server/src/lib/dtos/`（`iam` / `auth` / `dict` / `files` / `logs` / `notices` / `system` / `workflow` / `dashboard` / `region` / `messages`）
- 通过 `src/lib/openapi-dtos.ts` 统一 re-export，各路由通过 `import { XxxDTO } from '../lib/openapi-dtos'` 导入，禁止路由内本地声明 `.openapi('EntityName')` 的 DTO

#### 统一路由定义模式

- 全面迁移至 `defineOpenAPIRoute` + `router.openapiRoutes()` 模式
- 移除 `<AuthEnv>` 泛型和全局 `router.use('*', authMiddleware)`，每个受保护路由在 `createRoute.middleware` 中显式声明鉴权
- 覆盖用户、角色、工作流实例/定义、会话管理、租户管理等核心路由

#### 统一验证失败响应（validationHook）

- 新增 `validationHook`，所有 `OpenAPIHono` 实例通过 `defaultHook: validationHook` 将 Zod 校验失败统一转为 `{ code: 400, message, data: null }` 标准格式

#### 安全防护增强

- 新增 CSRF 防护（`hono/csrf`）：通过 `ALLOWED_ORIGINS` 环境变量配置白名单
- 新增接口限流（`hono-rate-limiter` + Redis）：对高危认证接口限制请求频率，超限返回 `code: 429`

#### OpenAPI 文档升级至 3.1.0

- 使用 `app.doc31` 替代 `app.doc`，输出 OpenAPI 3.1.0 规范

#### 全量数据接口

- 用户、岗位、角色模块新增 `/get/all` 接口，支持不分页的全量数据获取

#### 服务端分页扩展

- 字典、角色、文件存储配置、操作日志、岗位、会话列表等模块支持服务端分页
- 前端对应页面新增 `pageSize` 状态，支持用户动态调整每页条目数

### Changed

- 共享层 `@zenith/shared` 升级至 Zod v4（`^4.3.6`），与 `@hono/zod-openapi@1.x` 保持一致
- 认证中间件重构：使用 Hono 官方 JWT 中间件替代自定义 JWT 验证逻辑
- 上下文管理优化：使用 `tryGetContext` 替代 `getCtx`，简化错误处理
- 路由中间件统一改用 `hono/factory` 的 `createMiddleware`

### Fixed

- 修复通知模块发布时间（`publishTime`）字段类型验证逻辑
- 修复文件存储配置更新时合并逻辑，确保状态字段正确保留
- 修复数据库备份时间戳格式化（冒号/点号替换）导致的文件名错误
- 修复邮件配置测试发送时的邮箱与 SMTP 信息校验条件

---

## v0.4.0 - 2026-04-22

### Added

#### OpenAPI 自动生成支持

- 全面迁移后端路由至 `@hono/zod-openapi`（`OpenAPIHono`），路由定义自动汇总生成 OpenAPI Spec
- 所有请求参数通过 `createRoute` + Zod schema 声明，支持请求验证与响应格式化
- 涵盖路由管理、工作流实例、缓存管理等模块的 OpenAPIHono 重构

#### 全局请求上下文存储

- 引入 `hono/context-storage` 中间件，提供 `currentUser()` / `getCtx()` 零参取值函数
- 辅助函数无需层层透传 `c` 参数，简化请求上下文访问

#### 请求防护

- 新增请求体大小限制（`REQUEST_BODY_LIMIT`）和请求超时（`REQUEST_TIMEOUT_MS`）环境变量配置
- 默认不启用，超出限制分别返回 `code: 413` / `code: 408`

#### 性能分析

- 新增 `Server-Timing` 响应头支持，可通过环境变量 `ENABLE_SERVER_TIMING` 开启

### Changed

- 切换 JWT 实现为 Hono 官方库（`hono/jwt`），移除 `jsonwebtoken` 依赖
- 参数校验统一改用 `zValidate` 中间件（`@hono/zod-validator`），覆盖用户、角色、通知、OAuth、岗位、地区、系统配置、租户、工作流等模块
- 日志中间件重构：替换自定义 `httpLogger` 为 Hono 官方 `logger`，并去除日志中的 ANSI 控制字符

---

## v0.3.2 - 2026-04-21

### Added

#### 菜单管理

- 搜索栏新增「菜单名称」文本筛选与「状态」下拉筛选，支持客户端递归过滤树形数据

#### 字典管理

- 搜索栏新增「状态」下拉筛选和「创建时间」日期范围筛选
- 字典列表新增「描述」列
- 字典项侧边抽屉加宽（700 → 900），顶部新增标签/键值文本搜索与状态下拉筛选（客户端实时过滤）

---

## v0.3.1 - 2026-05-03

### Added

#### 定时任务增强

- 定时任务配置新增「重试次数」「重试间隔（ms）」「监控超时时间（ms）」字段，支持任务失败后自动重试
- 执行日志新增「第几次执行」列，记录每次触发的累计执行次数
- 执行日志抽屉加宽，输出列固定宽度，内容不再被挤压

### Changed

- 登录页表单输入框去掉标签，改为纯 placeholder 风格，界面更简洁
- 定时任务列表「上次执行」状态由英文（success/fail/running）改为中文显示（成功/失败/运行中）
- 定时任务列表描述列固定宽度 200px，避免过窄

### Fixed

- 修复手动创建 Drizzle 迁移文件不注册到 journal 导致迁移不执行的问题

---

## v0.3.0 - 2026-04-20

### Added

#### 工作流模块

- 新增工作流设计器：基于 React Flow 的可视化流程图设计，支持节点拖拽、连接与属性配置
- 新增多种节点类型：发起人节点、审批节点、抄送节点、分支条件节点，配置各节点的审批人策略、超时处理、拒绝策略等高级设置
- 新增表单权限与操作权限配置：流程节点可独立配置字段可见性与按钮权限
- 新增飞书风格审批时间线组件，替代原 Steps 展示审批记录
- 新增「我的申请」页面：用户可发起流程申请，查看申请列表与审批详情
- 新增「待审批」页面：展示待办任务，支持审批通过/驳回并填写意见
- 新增全局流程监控页面（管理员视角）：查看所有流程实例状态及统计信息

#### AI 助手

- 新增 AI 智能助手功能，包含独立对话页面（AIChatPage）与侧边栏入口（AISidebarPage）
- 支持富文本消息内容、演示模式切换及 MCP 工具配置

#### 用户管理增强

- 用户表新增手机号码字段，支持手机号的录入、展示与搜索过滤
- 列表页左侧新增部门树面板，可点击部门节点快速筛选该部门下的用户

#### 消息模板

- 新增消息模板管理模块：支持模板的增删改查与内容预览

#### 定时任务

- 定时任务列表新增「执行日志」入口，支持以抽屉形式查看全部执行记录

#### 表单设计器

- 新增分栏（row）、分割线（divider）、分组（group）三种布局类型字段

#### 测试覆盖

- 新增多模块单元测试：权限管理、数据范围、认证中间件、认证 Hook、权限 Hook、密码策略、工作流引擎、区域选择组件等

### Changed

#### 搜索工具栏重构

- `SearchToolbar` 组件 API 简化：移除 `left`/`right` 独立区域概念，统一使用 `children` 作为工具栏内容，由 `<Space wrap>` 自动换行排列
- 全站所有列表页同步更新为新 API，搜索输入框与操作按钮统一放置在同一行

#### 表单体验优化

- 批量为各模块表单的 Select / Input 补充 `placeholder`，提升空状态引导体验
- 用户、部门管理的新增/编辑弹窗改为 Row/Col 双列布局，节省垂直空间

#### 其他

- 仪表盘新增骨架屏（Skeleton）替换原 Spin，消除空白加载态
- 侧边栏与卡片样式改用 CSS 变量，提升主题切换一致性
- 标签（Tab）支持拖拽排序

### Fixed

- 修复仪表盘饼图标签显示异常（名称与百分比渲染错误）
- 修复文件存储配置页面提供者标签颜色映射错误
- 修复用户编辑接口中日期字段格式化与头像字段处理逻辑

---

## v0.2.0 - 2026-03-31

### Added

#### 安全与访问控制

- 新增忘记密码功能：用户可通过邮件找回密码，后端生成带时效重置 Token 并发送重置邮件
- 新增 IP 访问控制：支持配置 IP 白名单与黑名单，中间件自动拦截非法请求

#### 水印功能

- 新增页面水印功能，企业后台防截图泄漏
- 水印作为系统配置项管理（`watermark_enabled`/`watermark_content`/`watermark_font_size`/`watermark_opacity`），默认关闭
- 水印内容留空时自动回退为当前登录用户的 nickname/username

#### 文件存储扩展

- 文件存储支持扩展至三种模式：本地（local）、阿里云 OSS、**AWS S3**、**腾讯云 COS**
- 更新数据库结构，新增 `provider` 枚举字段及相关配置字段

#### 通知公告增强

- 新增通知收件人机制：发布通知时可指定目标类型（全体/指定用户/指定角色/指定部门）
- 新增已读统计功能（管理员视角）：列表页展示已读人数，点击可查看详细已读/未读用户列表
- 通知详情弹窗：通知列表与铃铛入口均支持点击查看完整内容
- 通知内容展示安全优化：新增 `stripHtml` 处理，列表预览不再 `dangerouslySetInnerHTML`

#### 仪表盘图表

- 仪表盘新增三类统计图表：登录趋势折线图、操作类型分布饼图、用户活跃度排行图

#### 缓存管理

- 新增缓存管理页面，支持查看全部缓存键值、按分类删除缓存、一键清空所有缓存

#### 监控页面优化

- 系统监控页面重构为 Tabs 标签页布局，分类展示 CPU/内存/磁盘/进程等信息
- 加载阶段使用 Skeleton 骨架屏替换 Spin，提升视觉体验

#### 文档完善

- 新增多篇技术文档：定时任务与数据库备份、OAuth 第三方登录、安全体系、公共组件指南、前端路由与菜单、演示模式、项目结构等

### Changed

- 登录页视觉优化：调整品牌区背景与装饰元素，功能特性列表展示更清晰
- 系统配置种子数据写入改为幂等逻辑（先查询现有 key，仅插入缺失项，避免重复执行报错）
- 多租户模式下密码重置与用户查询逻辑优化，确保租户隔离正确性

### Fixed

- 修复系统配置中 IP 白名单/黑名单配置项结构冗余问题，简化配置管理逻辑

---

## v0.1.5 - 2026-03-27

### Added

#### 多租户支持

- 新增多租户架构支持（`MULTI_TENANT_MODE=true`），实现租户数据隔离（`tenant_id` 字段 + `tenantCondition` 查询工具函数）
- 新增租户管理 CRUD 页面（`/system/tenants`），支持租户的增删改查
- 支持超管切换租户视角，切换后系统自动过滤对应租户数据
- 新增多租户部署指南文档

#### 个人中心

- 新增 API Token 管理 Tab：支持创建、查看、删除个人 API Token，用于第三方接口调用鉴权

#### 布局与交互

- 顶部工具栏新增全屏切换按钮，支持一键全屏
- 新增面包屑导航，显示当前页面层级路径（位于标签栏下方）
- 偏好设置新增主题色选择器和标签页切换动画开关

#### 菜单管理

- 新增「全部展开 / 全部折叠」按钮，方便快速浏览多层级菜单树

#### 地区管理

- 省市选择升级为级联选择器（Cascader），交互更直观

#### 系统配置

- 新增配置类型字典（`system_config_type`），列表页支持按类型筛选配置项
- 系统管理菜单拆分为「系统管理」和「系统设置」两个独立一级菜单

#### 搜索工具栏组件

- 新增 `SearchToolbar` 公共组件，统一搜索区域布局（左侧搜索条件、右侧操作按钮），全站 CRUD 列表页面全面迁移使用

### Changed

- 路由加载方式升级为 `React.lazy` + `Suspense`，减少首屏加载体积
- 新增 `@` 路径别名（指向 `src/`），全站模块导入统一使用短路径
- 全面类型安全优化：所有页面 `Form` 的 `getFormApi` 回调统一使用 `FormApi` 类型替代 `any`

### Fixed

- 修复菜单管理页面 `onExpandedRowsChange` 回调中行数据类型不一致导致的运行时错误
- 修复用户更新接口错误写入 `passwordUpdatedAt` 的问题
- 修复管理员默认账号在重复执行 seed 时触发唯一约束冲突的问题

---

## v0.1.4 - 2026-03-26

### Added

#### 密码策略与安全

- 新增密码复杂度配置项（最小长度、是否必须大写字母/特殊字符），用户创建和密码修改接口自动校验
- 新增密码过期功能：可设置密码有效期天数，过期后登录触发强制修改密码弹窗
- 新增注册功能开关（`allow_registration`）：支持全站启停开放注册，登录页入口动态显示

#### 用户批量导入

- 新增 Excel 导入接口，支持按部门/岗位/角色编码自动关联，逐行报告失败原因
- 用户管理页新增「导入」按钮，支持模板下载、文件上传与导入结果展示

#### 邮件配置

- 新增 `email_configs` 数据库表及 SMTP 配置读写接口（支持发送测试邮件）
- 新增「邮件配置」菜单页面，涵盖 SMTP 主机、端口、加密方式、授权密码等配置

#### OAuth 第三方登录

- 支持 GitHub、钉钉、企业微信三种 OAuth 提供方，登录后自动创建或绑定账号
- 新增 OAuth 配置管理页面（`/system/oauth-config`），可配置各提供方的 Client ID / Secret
- 个人中心新增「关联账号」Tab，可查看已绑定的第三方账号

#### 数据库备份管理

- 新增数据库备份功能（基于 pg_dump），支持手动触发、下载及删除备份文件
- 新增「数据库备份」菜单页面（`/system/db-backups`）

#### 其他

- 顶部标签栏新增右键上下文菜单（关闭当前/其他/左侧/右侧/全部标签）
- 新增 Vitest 单元测试配置，覆盖密码策略、输入净化、验证码、日期格式化等工具函数

### Changed

- 侧边栏菜单支持独立滚动，滚动条改为极窄样式，子菜单添加最大高度限制
- 登录页第三方登录图标替换为 `@iconify/react` 组件
- OpenAPI Spec 补充邮件配置、用户导入、密码策略、OAuth 登录、数据库备份接口文档

---

## v0.1.3 - 2026-03-26

### Added

#### 仪表盘

- 新增仪表盘统计接口（`GET /api/dashboard/stats`），提供用户总数、在线人数、今日登录次数、今日操作次数等统计数据
- 新增仪表盘前端页面，展示系统概况卡片、通知公告列表及技术架构信息
- 通知公告区域新增「查看更多」按钮，点击跳转至通知公告管理页面

#### 用户管理

- 新增**用户解锁**功能，支持解除登录锁定状态（`POST /api/users/:id/unlock`）
- 新增**批量删除用户**接口（`DELETE /api/users/batch`）
- 新增**批量更新用户状态**接口（`PUT /api/users/batch-status`），支持批量启用 / 禁用
- 新增**重置用户密码**接口，允许管理员重置指定用户的登录密码

#### 通知中心

- 新增通知收件箱功能，用户可查看自己收到的通知列表（含分页）
- 新增「全部标记为已读」接口，一键将所有未读通知设为已读状态

#### 菜单管理

- 新增**个人中心**与**通知中心**两个系统内置隐藏菜单，支持导航路由但不显示在侧边栏

#### 个人资料页

- 新增「我的登录记录」Tab，展示当前用户的历史登录记录
- 新增「我的操作记录」Tab，展示当前用户的历史操作日志

### Changed

- 仪表盘技术架构展示区域重构，使用 List 组件替代原有列表，提升可读性
- 通知中心界面布局优化，合并重复代码，组件结构更简洁

### Fixed

- 修复顶部导航品牌区域缺少点击跳转首页功能

---

## v0.1.2 - 2026-03-25

### Added

#### 后端

- 集成 Swagger UI，新增两个无需认证的端点：
  - `GET /api/docs` — Swagger UI 交互界面
  - `GET /api/openapi.json` — OpenAPI 3.0 JSON Spec（可导入 Postman / Apifox）
- 新增 `packages/server/src/openapi.ts`，以 TypeScript 对象维护 OpenAPI 3.0 Spec，覆盖全部 API 分组

#### 操作日志

- 操作日志列表新增 **IP 地址**搜索筛选条件，支持模糊匹配

#### 文档站点

- 新增「Swagger / OpenAPI」章节，说明文档访问、鉴权、导入及 Spec 维护方式
- 新增「系统内置配置」章节，说明 5 个内置配置项的用途、类型、默认值及使用方式
- 新增「操作日志与变更记录」章节，说明 Diff 机制架构及如何为新路由添加变更快照
- 更新「Zenith Skill」章节，新增后端路由规范与前端页面规范说明

### Fixed

- 修复 CronJobsPage 使用不存在的 `Drawer` 组件导致的运行时错误（改为 `SideSheet`）
- 修复 CronJobsPage `cronExprValue` 和 `handlers` 状态变量未声明的运行时错误

---

## v0.1.1 - 2026-03-25

### Added

#### 通知管理

- 通知内容编辑器升级为富文本编辑器（基于 wangEditor），支持格式化文本与图片插入
- 富文本编辑器支持图片上传，通过 Authorization 头上传图片并自动插入到编辑器
- 通知列表支持 HTML 内容渲染（`dangerouslySetInnerHTML`），展示富文本内容
- 通知编辑界面改用 SideSheet 侧边抽屉，提升编辑体验
- 通知内容字段类型从 `varchar` 升级为 `text`，支持长文本存储
- 通知管理添加批量删除功能，后端新增 `DELETE /api/notices/batch` 接口

#### 组件与前端

- 新增省市区三级联动选择组件（`RegionSelect`），基于 Semi Design Cascader 封装，支持动态加载
- 组件示例页面新增省市区联动选择演示

### Changed

- WebSocket 连接管理优化：添加自动重连机制，使用 Map 记录最近通知时间戳，避免重复推送通知
- 岗位管理添加批量删除功能，后端新增 `DELETE /api/positions/batch` 接口

### Fixed

- 修复个人资料页密码更新接口路径错误（`/auth/password` → `/api/auth/password`）
- 修复超级管理员和普通用户角色的数据范围字段缺失问题

### Docs

- 重构部署文档，新增贡献指南与维护说明
- 更新首页文档，补充 Semi Design v2 和 lucide-react 技术栈说明

---

## v0.1.0 - 2026-03-25

首个正式版本，包含完整的后台管理基础框架。

### Added

#### 认证与账户

- 用户登录 / 登出，JWT Bearer Token 鉴权（7 天有效期）
- Access Token + Refresh Token 自动续期机制
- 登录验证码校验，降低暴力尝试风险
- 个人中心：基本资料维护、头像上传、密码修改

#### 权限体系

- 用户管理：用户 CRUD、启停用、角色分配
- 角色管理：角色 CRUD、菜单权限配置
- 菜单管理：目录 / 菜单 / 按钮三级能力模型
- 动态菜单路由：前端根据当前用户角色自动注册可访问页面

#### 组织与基础资料

- 部门管理：树形组织层级维护
- 岗位管理：岗位信息维护
- 数据字典：字典类型与字典项统一管理
- 系统配置：系统运行相关配置项维护

#### 通知、审计与安全

- 通知公告：发布、查看、已读状态管理，WebSocket 实时推送
- 登录日志：登录行为记录与安全审计
- 操作日志：关键业务操作轨迹记录
- 在线会话：查看当前在线会话，支持强制下线

#### 文件与存储

- 文件管理：上传、列表查询、下载等基础能力
- 存储配置：本地文件系统 / 阿里云 OSS 双模式，支持切换默认存储

#### 任务与运维

- 定时任务：Cron 任务管理与服务端调度执行
- 系统监控：运行状态相关信息查看
- WebSocket：支持实时通知与会话下线消息推送
- 健康检查：`/api/health` 接口，用于服务探活

#### 基础设施与工程

- npm monorepo 结构（`server` / `web` / `shared` 三包）
- Redis 会话持久化（ioredis），支持 URL 与逐项两种配置方式
- Drizzle ORM + PostgreSQL，迁移文件版本化管理
- Demo 演示模式（MSW Mock Service Worker），无需后端即可完整运行
- VitePress 文档站，自动部署到 GitHub Pages
- GitHub Actions Release 工作流：推送 tag 自动构建并发布产物
- AI 友好：`AGENTS.md` + Zenith CRUD Skill，支持 AI 辅助开发
