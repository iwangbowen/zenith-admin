# 企业网盘架构与接口

企业网盘是面向组织内文件存放、协作共享与治理的领域模块。它以**空间**为容量与权限边界，围绕文件夹树、
四级协作角色、外链分享、版本、回收站、全文检索与治理审计形成完整闭环，并完全复用[文件与存储](../storage/index.md)模块的
`managed_files` / 多 provider / 分片上传底座，不另建一套对象存储。

本页对应独立的 `drive` 路由领域，挂载入口为 `packages\server\src\routes\drive\index.ts`。管理与匿名外链接口均声明 `feature: 'drive'`，受网盘 License 功能门禁约束；通用文件上传与存储配置由 `files` 领域负责。

---

## 架构总览

```mermaid
flowchart LR
    Web["packages\\web\\src\\pages\\drive"] --> Hooks["hooks\\queries\\drive.ts"]
    Hooks --> API["/api/drive/*"]
    API --> Routes["routes\\drive\\*"]
    Routes --> Services["services\\drive\\*"]
    Services --> DB[("drive_* tables")]
    Services --> Files["managed_files<br/>visibility = restricted"]
    Services --> Storage["文件存储 provider"]
    Services --> Config["运行时设置<br/>getSettings('drive')"]
    Services --> Tasks["任务中心<br/>打包 / 复制 / 重算 / 索引"]
    Services --> Notify["通知中心 notify()"]
    Public["/public/drive/:token"] --> PublicAPI["/api/drive/public/*"]
    PublicAPI --> Services
```

| 层 | 位置 | 职责 |
| --- | --- | --- |
| 共享契约 | `packages\shared\src\drive\` | 实体 schema 与 API 契约（`contracts/`）、空间类型、角色、主体类型、Zod 入参；全局设置模块在 `packages\shared\src\settings\modules\drive.ts` |
| 数据模型 | `packages\server\src\db\schema\drive.ts` | 空间、成员、节点树、授权、版本、外链、访问日志、动态、收藏、最近、标签、评论、正文索引 |
| API 路由 | `packages\server\src\routes\drive\` | 由契约派生的 `/api/drive/*` 路由与权限门控；`/api/drive/public/*` 匿名外链 |
| 业务服务 | `packages\server\src\services\drive\` | ACL 解析、目录树操作、上传 / 秒传 / 版本、外链会话、回收站、检索、治理、任务处理器 |
| 前端页面 | `packages\web\src\pages\drive\` | 工作台、共享空间、治理页、公开外链页 |
| 菜单权限 | `packages\shared\src\seed\menus\drive.ts` | `19000` 段企业网盘菜单与 `drive:*` 权限 |
| 演示数据 | `packages\web\src\mocks\{data,handlers}\drive.ts` | Demo 模式内存实现 |

## 能力总览

| 能力 | 当前实现 |
| --- | --- |
| 空间 | `personal` 个人空间（首次访问自动创建）、`department` 部门空间（管理员创建或按设置自动创建）、`team` 协作空间（用户自建）；每个空间有独立配额、版本上限与外链开关 |
| 权限模型 | 有效角色 = 菜单 RBAC ∧ max(空间角色, 节点授权)；四级角色 `viewer` 仅预览 → `downloader` 可下载 → `editor` 可编辑 → `manager` 管理者 |
| 授权主体 | 用户、部门（含子部门成员）、角色、用户组四类主体，空间成员与节点授权共用同一套编辑器 |
| 节点授权继承 | 授权沿目录树向下继承；`inheritPermissions=false` 可在任意文件夹断开继承，重新定义访问边界 |
| 目录浏览 | 列表 / 网格双视图、面包屑、排序、目录内搜索、右键菜单、多选批量、拖拽上传、缩略图 |
| 上传 | 不超过分片阈值（运行时设置 `files.chunkThresholdMb`，默认 5MB）的文件单请求上传，更大的文件分片断点续传（含新版本面板）、SHA-256 秒传、同名冲突策略（保留两者 / 覆盖为新版本 / 跳过）、扩展名黑名单 + 可执行文件头识别、配额原子预留 |
| 版本 | 覆盖上传或手动上传新版本；历史版本可下载、回滚（生成新版本）、删除；超出空间上限自动清理最早版本并释放容量 |
| 外链分享 | 令牌 SHA-256 存储；可选密码、有效期、访问次数、IP / CIDR 白名单、仅预览 / 可下载、预览水印；公开页密码门 → Redis 访问会话；访问 / 下载留痕；二维码与短链；到期前提醒创建者；登录用户可转存到自己的网盘 |
| 文件收集 | 建立在文件夹上的收集链接：单文件上限、扩展名、是否要求姓名、累计上限；匿名提交以创建者身份落盘并自动重命名，提交记录可查，创建者收通知 |
| 访问申请 | 无权限用户申请指定角色，节点管理者审批通过 / 拒绝并可设置到期时间；申请人可撤回；临时授权到期前提醒 |
| 在线状态 | 详情抽屉心跳上报，显示正在查看同一节点的用户（Redis 汇聚） |
| 回收站 | 删除进入回收站，保留期后由治理任务彻底清除；支持还原（原目录不存在回落到空间根）、彻底删除、清空 |
| 个人视图 | 与我共享、我的收藏、最近访问、我的外链、回收站 |
| 检索 | 文件名检索；开启「包含正文」后同时检索文本文件正文（tsvector；CJK 关键词自动改用子串匹配），返回命中片段 |
| 协作 | 签出锁定（防止并发覆盖）、标签、评论、节点动态时间线 |
| 批量与异步 | 打包下载：小于阈值同步返回 zip，超阈值转任务中心并通知；跨空间复制、容量重算、索引补建走任务中心 |
| 通知 | 节点共享、空间加入、配额预警、打包完成、访问申请与审批结果、外链 / 临时授权到期、收集到新文件、扩容申请与结果、法律保留变更、异常行为告警通过通知中心触达 |
| 治理 | 统计概览（空间 / 文件 / 占用 / 趋势 / 类型分布）、空间治理（配额 / 状态 / 所有者 / 部门空间 / 30 天增速与预计用满天数 / 归档筛选）、外链治理与访问记录、动态审计（按当前筛选导出 Excel，走导出中心）、全局设置 |
| 合规治理 | 法律保留（冻结删除 / 彻底删除 / 删版本 / 跨空间移动，自动清理跳过）、空间归档（只读，可恢复，默认隐藏）、扩容申请审批（通过即写入显式配额）、全部外链访问日志（筛选 + 导出中心 `drive.share_access_logs`）、异常行为告警（批量下载 / 外链爆破，内置规则）、开放应用空间授权 |
| 开放平台 | `/api/open/v1/drive/*` 只读 / 上传开放 API（scope `drive:read` / `drive:write`，按空间授权裁剪）；文件变更事件 `drive.node.*` / `drive.share.*` / `drive.collect.received` 经开放平台 Webhook 投递（HMAC 必选，仅被授权空间） |
| 站内互通 | 文件 / 文件夹以卡片消息发送到聊天会话（只带链接，按网盘 ACL 访问）；Wiki 编辑器「插入网盘文件」写入站内链接；工作流表单可用 `url` 字段引用网盘链接 |
| 数据保留 | `drive_activities`、`drive_share_access_logs` 按保留策略清理；`drive_nodes` 回收站超期项目按设置天数彻底清除（法律保留项跳过） |

## 权限模型详解

```text
有效角色(user, node)
  = RBAC(菜单权限码通过)
  ∧ (空间 manager ? manager
     : max(acl_open ? 空间角色 : 无角色, 自身授权, acl_chain_ids 上的授权))
```

| 空间类型 | 空间角色来源 |
| --- | --- |
| 个人空间 | 所有者 = `manager`；其他人无空间角色，只能通过节点授权访问 |
| 部门空间 | 部门负责人 = `manager`；部门及子部门成员 = 空间 `defaultMemberRole`；`drive_space_members` 可为个别主体提升角色 |
| 协作空间 | 所有者 = `manager`；`defaultMemberRole` 为全体登录用户的默认角色（为空则仅成员可访问）；成员表按主体授予角色 |

超级管理员与持有 `drive:admin:space:edit` 的管理员对所有空间视为 `manager`。

| 角色 | 允许操作 |
| --- | --- |
| `viewer` | 浏览目录、在线预览（内容接口拒绝 `?download=true`） |
| `downloader` | 预览 + 下载、打包下载 |
| `editor` | 下载 + 上传、新建、重命名、移动、复制、删除到回收站、上传新版本、创建外链、签出锁定 |
| `manager` | 编辑 + 管理协作者授权、断开 / 恢复继承、彻底删除、管理他人外链、成员管理 |

## 存储集成

- 网盘文件是 `managed_files` 记录，`visibility = 'restricted'`：通用的 `GET /api/files/{id}/content` 对其返回 404，
  内容只能经 `GET /api/drive/nodes/{id}/content` 读取，由网盘 ACL 校验后流式代理（支持 Range / ETag）。
- 上传绕过通用 MIME 白名单（`skipTypeCheck`），改由网盘自己的扩展名黑名单与可执行文件头识别把关。
- 秒传候选还必须由当前用户有下载权限的未删除节点引用，不能仅凭哈希认领他人的文件。
- 客户端声明的 `contentHash` 只是预检输入：简单上传由服务端对请求体计算 SHA-256，分片上传在 complete 时由服务端按
  实际落地内容重算并比对（见[存储：分片上传](../storage/index.md#分片上传)），不一致即中止会话；因此 `managed_files.contentHash`
  永远是服务端核验过的值，不能被用来给错误内容挂上别人的哈希。
- 版本与渲染产物在事务内维护 `managed_files.ref_count`；归零后标记 `orphaned_at`，
  超过 24 小时由 `files-gc` 回收。`gc_state=deleting` 的对象不可再次引用，失败删除会在下一轮重试。
- 缩略图与正文提取通过持久化 `drive-renditions` 队列执行，产物表记录版本、状态与错误；
  定期补投任务恢复提交中断，旧版本任务不能覆盖新版本。

## 页面入口

| 菜单 | 路径 | 组件 |
| --- | --- | --- |
| 我的网盘 | `/drive` | `drive/DriveWorkbenchPage` |
| 共享空间 | `/drive/spaces` | `drive/spaces/DriveSpacesPage` |
| 空间治理 | `/drive/admin/spaces` | `drive/admin/DriveAdminSpacesPage` |
| 外链治理 | `/drive/admin/share-links` | `drive/admin/DriveAdminShareLinksPage` |
| 动态审计 | `/drive/admin/activities` | `drive/admin/DriveAdminActivitiesPage` |
| 合规治理 | `/drive/admin/governance?tab=holds|quota|logs|open` | `drive/admin/DriveAdminGovernancePage` |
| 网盘设置 | `/drive/admin/settings` | `drive/admin/DriveAdminSettingsPage` |
| 公开外链页 | `/public/drive/:token` | `drive/public/PublicSharePage`（无需登录） |

工作台 URL 参数：`?space={id}&folder={id}` 定位目录，`?node={id}` 打开文件详情，
`?view=shared|starred|recent|links|recycle` 打开个人视图。

## 数据模型

| 表 | 说明 |
| --- | --- |
| `drive_spaces` | 空间；类型、所有者 / 部门、默认成员角色、配额、已用容量、版本上限、外链开关、`archived_at`（归档只读） |
| `drive_space_members` | 空间成员；`(space, subjectType, subjectId)` 唯一 |
| `drive_nodes` | 节点树；`ancestor_ids` 与 `acl_chain_ids`（GIN）、`acl_open`、父节点、软删除、锁定字段；同级同名唯一 |
| `drive_node_permissions` | 节点直接授权；主体 × 角色，可选过期时间 |
| `drive_file_versions` | 文件历史版本；指向 `managed_files` |
| `drive_share_links` | 外链；`token` 保存 SHA-256、加密副本、密码哈希、`kind`、`capabilities[]`、有效期、访问 / 下载次数上限、`allowed_ips[]`、`watermark`、`collect_policy`、`session_version` |
| `drive_collect_submissions` | 文件收集提交记录：文件、提交人姓名 / 备注、IP；文件彻底删除后记录保留 |
| `drive_access_requests` | 访问申请：申请角色、状态、审批人、实际授予角色与到期时间；同一人同一节点仅一条待审批（部分唯一索引） |
| `drive_legal_holds` | 法律保留：节点、原因、是否生效、解除人 / 时间 / 说明；同一节点仅一条生效中的保留 |
| `drive_quota_requests` | 扩容申请：申请时配额与用量、申请 / 批准 GB、状态、审批人；同一空间仅一条待审批 |
| `drive_open_app_grants` | 开放应用 → 空间授权：`client_id`、空间、角色（viewer / downloader / editor）、状态 |
| `drive_share_access_logs` | 外链访问 / 下载 / 上传 / 密码错误留痕，按 UTC 月分区 |
| `drive_activities` | 节点动态与审计，按 UTC 月分区 |
| `drive_node_stars` / `drive_recent_access` | 收藏与最近访问 |
| `drive_upload_bindings` | 分片上传会话与目标目录 / 节点的绑定 |
| `drive_tags` / `drive_node_tags` | 空间级标签及节点关联 |
| `drive_node_comments` | 节点评论 |
| `drive_node_texts` | 正文全文索引（`tsvector`） |
| `drive_node_renditions` | 当前版本的缩略图 / 正文等产物状态；`(node_id, kind)` 唯一 |

## 设置项（运行时设置模块 `drive`）

全局设置是[运行时设置](../backend/settings.md)的 `drive` 模块（**租户作用域**：租户可在平台值之上覆盖；License 特性 `drive`，权限 `drive:setting:view` / `drive:setting:edit`），读写 `GET/PUT /api/settings/drive`。服务端经 `getDriveSettings()` 读取：有请求上下文时按当前用户的有效租户解析；后台任务、渲染 worker 与匿名外链入口没有请求上下文，必须以数据行上的 `tenantId` 显式传入（`getDriveSettings({ tenantId })`），否则退回平台值：

| 字段 | 含义 |
| --- | --- |
| `personalQuotaGb` / `departmentQuotaGb` / `teamQuotaGb` | 各类空间默认配额，0 = 不限；空间显式配额优先 |
| `departmentSpaceAutoCreate` | 用户首次访问时自动创建其部门空间 |
| `recycleRetentionDays` | 回收站保留天数，0 = 永久保留 |
| `maxVersions` | 默认最多保留版本数 |
| `quotaWarningPercent` | 配额预警阈值（%） |
| `externalShareEnabled` / `externalShareMaxDays` / `externalShareRequirePassword` | 外链总开关、最长有效期、是否强制密码 |
| `collectMaxFileSizeMb` | 文件收集单文件上限（MB）；收集链接可在此上限内单独收紧 |
| `shareExpiryReminderHours` | 外链与临时授权到期前多少小时提醒，0 = 关闭 |
| `previewWatermarkEnabled` | 站内预览水印（对登录用户按 `authenticated` 可见性投影到 `GET /api/settings/me`） |
| `blockedExtensions` | 禁止上传的扩展名数组（不区分大小写，可带前导点） |
| `thumbnailEnabled` / `textIndexEnabled` | 缩略图与正文索引开关 |
| `alertWindowMinutes` / `alertBulkDownloadCount` / `alertShareFailureCount` | 异常行为告警的统计窗口与阈值（0 = 关闭）；告警任务全局扫描，只取平台值 |

上传、复制、版本裁剪等事务先在事务外读取设置再以参数传入事务函数（`appendVersion` / `copySubtree` / `reserveSpaceQuota`），事务回调内不调用 `getSettings`；`services/drive/drive-transactions.test.ts` 以静态扫描守住该约定。

## 接口速查

| 前缀 | 说明 |
| --- | --- |
| `GET/POST/PUT/DELETE /api/drive/spaces*` | 我的空间、空间 CRUD、成员、转让 |
| `GET /api/drive/nodes` | 目录内容（`spaceId` 或 `parentId`） |
| `POST /api/drive/nodes/{folder,move,copy,precheck,upload,upload/init,upload/chunk,upload/complete,batch-download}` | 目录写操作与上传 |
| `DELETE /api/drive/nodes/batch` · `/api/drive/nodes/recycle*` | 删除到回收站、还原、彻底删除、清空 |
| `GET /api/drive/nodes/{starred,recent,shared-with-me,search}` | 个人视图与检索 |
| `/api/drive/nodes/{id}/{content,thumbnail,rename,star,permissions,inherit,versions,activities,comments,tags,lock,share-links,presence}` | 单节点资源（`presence` 为在线状态心跳） |
| `/api/drive/share-links*` | 我的外链、修改、撤销、访问记录、收集记录、短链 |
| `/api/drive/access-requests*` | 访问申请：待我审批 / 我提交的、目标信息、发起、审批、撤回 |
| `/api/drive/public/shares/{token}/*` | 匿名外链：元信息、密码校验、浏览、内容、文件收集提交、转存 |
| `/api/drive/tags*` | 空间标签 |
| `POST /api/drive/spaces/{id}/{archive,unarchive,quota-requests}` | 空间归档 / 恢复、扩容申请（空间 manager） |
| `POST /api/drive/nodes/{id}/send-to-chat` | 以卡片消息发送到聊天会话 |
| `/api/drive/admin/*` | 统计、空间治理、部门空间、容量重算、索引补建、外链治理、外链访问日志、动态审计、法律保留、扩容审批、开放应用授权（全局设置走 `/api/settings/drive`） |
| `/api/open/v1/drive/{spaces,nodes,nodes/{id},nodes/{id}/content}` | 开放 API：被授权空间、目录 / 搜索、元数据、内容下载、上传（`POST /api/open/v1/drive/nodes`） |

完整参数与响应以 `packages\shared\src\drive\contracts\` 中的契约为准（`driveSpaceContract` / `driveNodeContract` / `driveShareLinkContract` /
`driveTagContract` / `driveAdminContract` / `drivePublicShareContract` / `driveCollaborationContract` / `driveAccessRequestContract` / `openDriveContract`），服务端路由、前端 hooks、MSW mock 与运行中的 `/api/docs`（`企业网盘-*` 标签）均由其派生。
