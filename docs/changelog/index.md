# Changelog

> 按版本倒序记录 Zenith Admin 的功能更新与变更历史。

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

- 修复 `escapeLike` 转义顺序 bug：先转义 `\` 再转义 `%` / `_`，修复含下划线文件名（如 `20251213_095800.mp4`）无法搜索的问题
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
- 新增文件大小格式化工具函数（`formatFileSize`）
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

- 工作流实例关键词过滤使用 `escapeLike` 转义，防止 SQL 通配符注入

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

- 所有 `keyword` 模糊搜索参数通过 `escapeLike()` helper 转义 `%`/`_`，防止恶意 LIKE 注入

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
