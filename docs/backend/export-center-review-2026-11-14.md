# 导出中心全面评审与下一阶段建议

评审日期：2026-11-14。基于当前工作区代码、针对性测试和 localhost:5373 开发环境。本方案不要求兼容历史数据，可直接调整契约、数据库、权限及执行模型。

## 1. 评审结论

导出中心已有统一注册、任务记录、同步/异步生成、XLSX/CSV/PDF/DOCX、受控文件、下载审计、过期清理和结果通知。主要短板是：**安全策略没有贯穿全部出口，部分导出不等于页面查询结果，后台执行缺少可靠闭环，前端下载成功语义不准确。**

建议先修安全与数据正确性，再统一执行机制，最后增加配置面板、分卷、业务模板和定时投递。保留导出定义与产物领域模型，执行层复用既有任务中心。

## 2. 范围与验证

### 2.1 审查范围

- 注册表中的 **55 个导出实体**，覆盖身份/系统、会员、支付、工作流、报表、CMS、网盘、埋点、开放平台、聊天和 IoT。
- Shared 契约、表结构、Service、路由、注册表、writer、formatter、数据源，以及 ExportButton、runner、业务页、中心页、查询 hooks、Demo Mock。
- 关联设施：pg-boss、任务中心、身份/租户/数据范围、数据脱敏、通知、托管文件、GC、保留策略。
- 中心外出口：AI 反馈/对话、财务报表、数据库 CSV/JSON/SQL、CMS 站点包、流程定义/诊断包、决策表、回放 HTML、看板 PNG、IoT TSL。

### 2.2 验证结果与边界

| 验证 | 结果 | 说明 |
| --- | --- | --- |
| 后端聚焦测试 | 18 文件、105 项通过；1 文件、1 项跳过 | writer、formatter、部分筛选/权限、CMS 导出、打印与审批单 |
| 前端聚焦测试 | 2 文件、15 项通过 | 导出缓存失效、CMS Demo 后台导出等；文件内包含其他运维 hooks 用例 |
| 临时隔离验证 | 12 项通过 | 对本文指出的现状做行为断言，测试完成后移除临时文件 |
| 真实开发环境 | 创建并检查 16 个导出任务，现已删除测试任务记录 | 页面筛选、文件内容、后台执行、取消、动态报表、三格式打印、非法列、隐藏元信息 |
| 下载故障注入 | 模拟 410，同时出现失败原因和“下载完成” | 页面内模拟响应，不是真实文件过期 |
| HTML 隔离验证 | 合成分片、截获 Blob、DOMParser 检查 | 确认宿主结构可被注入，未执行攻击脚本 |

独立 PostgreSQL 快照集成测试因未设置 TEST_DATABASE_URL 跳过，该测试要求专用本地 zenith_review 数据库。未灌入 5 万行、未杀进程或制造对象存储故障；admin 浏览器验证不代表普通用户与跨租户权限矩阵通过。真实任务关联文件按现有删除语义交由 GC，不宣称已物理删除。

## 3. 优先问题清单

P1 表示下一阶段先修复的安全、准确性、可靠性问题；P2 表示能力、体验和工程治理改进。以下明确区分实测与代码条件风险。

### F01 · P1：部分敏感实体无需独立明文权限即可 raw 导出

**隔离测试确认。** assertExportPermission 只有定义显式声明 requireExportRawPermission 才检查明文权限。会员列表、会员充值、租户、邮件发送记录、短信发送记录均有敏感列，但只凭现有列表/导出权限即可通过 raw=true 校验。前端默认 raw=false 不能限制直接 API 调用。

位置：packages/server/src/services/tasks/export-jobs.service.ts:103；各域 exports/members.ts、member-recharges.ts、tenants.ts、email-send-logs.ts、sms-send-logs.ts。

改进：含敏感列的明文导出统一强制独立权限；缺配置默认拒绝。区分查看、脱敏导出、明文导出、下载和管理；注册阶段校验，CI 遍历所有实体。验收覆盖仅列表、仅脱敏导出、明文权限、撤权等正反例。

### F02 · P1：脱敏 XLSX 的隐藏表仍包含明文筛选值

**真实文件确认。** 任务 #10 使用 raw=false、phone=13812345678，数据行虽为 0，隐藏“导出信息”表仍保存完整手机号。metadataRows 直接 JSON.stringify(ctx.query)，隐藏工作表不是安全边界。

位置：packages/server/src/lib/export-center/writer.ts:204，尤其 :217。

改进：文件仅写白名单和脱敏后的筛选摘要；完整参数留在受控内部任务记录。验收须解压扫描全部 XML、隐藏表、共享字符串、属性，覆盖电话、邮箱、身份证、token、报表参数及自由文本。

### F03 · P1：CSV 安全处理分叉，普通路径缺公式保护

**隔离测试确认。** renderExportCsv + csvEscapeCell 只转义引号，实际产生以 =1+1 开头的单元格。磁盘快照路径另有 safeCell，导致相同输入的安全性取决于执行路径。AI 反馈复用弱保护 helper；数据库和决策表也维护独立的类似实现。

位置：server lib/excel-export.ts:22、lib/export-center/writer.ts:268/:315；services/ai/ai-conversations.service.ts:679；services/ops/db-admin.service.ts:1671；web pages/rules/tables/RuleTablesPage.tsx:118。

改进：统一 CSV 编码，文本默认字面量，覆盖公式前缀、空白/制表符/回车、引号、换行；真正的数值保持可计算。机器交换格式单独定义。所有出口共用相同边界值矩阵。

### F04 · P1：回放 HTML 的标题和事件可突破宿主结构

**合成分片与 DOMParser 验证确认。** 标题未转义即进入 title/h1；事件 JSON 只替换小写 script 结束标签，混合大小写结束标签可结束宿主 script 并插入额外节点。实际利用依赖攻击者可控的标题或分片文本进入导出。本次未执行攻击脚本。

位置：packages/web/src/utils/replay-export.ts:27/:33/:42；pages/analytics/SessionReplaysPage.tsx:304。

改进：文本上下文 HTML 编码；事件用安全 JSON 嵌入，对小于号作 Unicode 转义等。分片失败不能当空数组继续报完整成功；同时增加缺片检查和录像大小限制。

### F05 · P1：岗位、角色、字典、公告导出忽略页面筛选

四个实体展开 tenantScopedTableSource，它仅添加租户条件，不消费 query。

| 开发环境场景 | 预期 | 实际 |
| --- | --- | --- |
| 岗位搜索 developer，任务 #1 | 页面 1 条“开发工程师” | CSV 2 条，额外含“系统管理员”；任务 query 仍记录 developer |
| 角色不存在的关键词，任务 #2 | 无匹配 | CSV 3 条角色 |
| 字典不存在的关键词，任务 #3 | 无匹配 | CSV 11 条字典 |
| 公告 | 同一 helper，代码确认缺过滤 | 开发库无公告，不据空文件认定已实测复现 |

位置：packages/server/src/lib/export-center/presets.ts:23；四个实体定义。

改进：列表/导出共享授权查询构建器，涵盖关键词、状态、时间、固定上下文和排序。验收比对列表全集与导出 ID 集合，不能仅用源码正则断言接收了 query。

### F06 · P1：静默截断后仍显示成功

支付订单、退款、签约、投诉的 count 使用 Math.min(actual,50000)，再 limit(50000)，导致框架无法判断超限。隔离测试确认 actual=60000 时报告 50000。埋点相同；CMS 治理、分发用已限制 5 万的 loadRows 计算 count。AI 反馈限制 10000；报表数据集最多取 5000，没有完整导出语义。

位置：services/payment/exports/payment-*.ts；services/analytics/analytics.service.ts:1596/:1626；services/cms/exports/cms-resource-governance.ts；services/cms/cms-distributions-runs.service.ts:149；services/report/exports/report-dataset.ts:14；services/ai/ai-conversations.service.ts:679。

改进：真实总数、实际写入数分开；超限明确拒绝或自动分卷。需要“前 N 条”时显式记录 scope/limit/truncated/totalMatched。验收 49999、50000、50001、60000 及消费期间新增，不得把部分结果标完整成功。

### F07 · P1：默认 sync 绕过 auto 和同步行数阈值

创建 schema、ExportButton、runner 都默认 sync。Service 优先用请求模式，sync 分支直接返回同步，未按 syncMaxRows 判断。会员六类流水、网盘等定义 auto，页面默认请求仍覆盖。55 个定义中 34 个显式开启同步覆盖；CMS 快照另有强制异步分支。

位置：shared tasks/validation.ts:12；web components/ExportButton.tsx:33、hooks/useExportJobRunner.ts:20；server services/tasks/export-jobs.service.ts:128。

改进：客户端默认 auto，服务端按行、列、单元格、字节、预计耗时决定；sync 不得绕过预算。真实页面大导出必须进入 worker。

### F08 · P1：提交、领取和自动重试不可靠

任务插入与 sendSystemJob 分步执行，未见 outbox 或 pending 补投，中间失败可能遗留无法执行的 pending。队列 retryLimit=1，但异常先把业务行置 failed，重投时 runExportJob 跳过 failed；隔离验证确认不会重执行。领取允许 running 再领取且无租约到期条件；startedAt 栅栏能拦旧执行发布，不能防重复取数与渲染。

位置：packages/server/src/services/tasks/export-jobs.service.ts:306/:349/:416/:470/:474。

改进：复用任务中心；任务和提交意图同事务，保存 taskId/attempt/lease/heartbeat/nextRunAt/errorCode，CAS 只领取 pending 或过期租约。覆盖丢交接、进程退出、重复消息、重试耗尽和重复点击。

### F09 · P1：普通导出没有持续进度，取消无法及时停工

只有 renderExportToPath 调 progress；普通 CSV/XLSX 全部消费期间不调用，隔离测试调用次数均为 0。取消能阻止最后发布，但可能继续查数/渲染。批量审批 PDF 先收集所有文档再渲染，无逐份进度。卡死检测按 startedAt 30 分钟判断，无执行心跳。

位置：server lib/export-center/writer.ts:130/:268/:302；services/tasks/export-jobs.service.ts:34/:238；services/workflow/workflow-print.service.ts:298。

改进：数据源、writer、custom renderer 共享可取消上下文；批次检查 AbortSignal、心跳和进度。分准备/查询/渲染/上传阶段，先 cancelling 再 cancelled。验收运行中取消不再读取后续批次；本次真实环境只验证排队取消与终态不反弹。

### F10 · P1：下载失败仍提示完成

**浏览器故障注入确认。** getBlob 失败返回 null，download 返回 void；runner 和中心页 await 后无条件 Toast.success。模拟 410 后同屏出现失败原因和“下载完成”，没有文件下载。聊天重复实现也受影响。

位置：web utils/request.ts:63/:79；hooks/useExportJobRunner.ts:23；pages/system/export-jobs/ExportJobsPage.tsx:115。

改进：下载明确返回结果或抛统一异常，取得有效文件后仅提示“已开始下载”；整个生成与获取文件期间保持忙碌态。覆盖 403/410/404、登录刷新失败和断网。

### F11 · P1：后台恢复身份丢失有效租户视角

**代码条件确认，未启用多租户复现。** 创建任务 tenantId 用 getCreateTenantId，可为超管选中的 viewingTenantId；执行从用户表恢复账户 tenantId，丢失 viewingTenantId，随后直接比较。多租户下平台超管在具体租户视角导出，可能被误判“创建人租户已变更”。不能简单删除比较。

身份恢复同时未加载用户状态、未过滤角色状态，应统一后台身份恢复与撤权检查，尤其防止 super_admin 快速放行绕过状态。下载历史文件对数据范围、站点、会话成员撤权也需明确复验规则。

位置：server lib/tenant.ts:27/:94；services/tasks/export-jobs.service.ts:216/:270/:457/:542。

改进：分别保存 actorId、actorTenantId、effectiveTenantId、resourceScope；执行/下载验证当前身份后恢复受控上下文。覆盖平台全局/具体租户、普通租户、账户/角色禁用、换租户和资源撤权矩阵。

### F12 · P2：列、查询、敏感策略缺少统一准备阶段

创建时用静态 columns 判断 sensitive，运行时才 resolveColumns；CMS 表单动态列无敏感定义，报表列未贯穿敏感策略。sensitive 数字值被 formatter 非字符串分支原样返回，隔离测试确认。真实任务 #6 传不存在的列，仍 success/3行，CSV 仅空行。

通用 query 为任意 record，各定义有的派生契约 schema，有的手写转换或直接信任类型。未知字段可能被忽略而扩大导出。

位置：server services/tasks/export-jobs.service.ts:120/:429；lib/export-center/writer.ts:67/:111；formatter.ts:47；services/cms/exports/cms-form-submissions.ts:18；services/report/exports/report-dataset.ts:53。

改进：prepare 一次完成 querySchema、授权、动态列、列白名单/顺序、敏感级别及预算，再分流和计算保留策略；保存不可变规格。未知/空/重复/越权列明确拒绝或规范化。

### F13 · P2：流式序列化尚非全链路有界内存

普通 XLSX 逐行 commit，但仍收集 chunks 并 Buffer.concat；CSV 累积 lines；不少 streamRows 返回完整数组。部分 countRows 完整 loadRows 后再取一次，报表重复取数也重复记录使用量/成本。offset 导出遇并发增删存在重漏风险；普通产物行数常沿用提交 count，而非真实写入。

位置：server lib/export-center/writer.ts:247/:268；services/identity/exports/users.ts:44；member/exports/members.ts；drive/exports/drive-activities.ts；report/exports/report-dataset.ts:74。

改进：通用磁盘写出/上传，键集游标+稳定排序/高水位，强一致场景快照；真实计数由消费链返回，避免 count 全量加载。增加长文本/宽表/临时磁盘预算，测 RSS、事件循环、CPU、并发和结果完整性。

### F14 · P2：过期重试与物理清理口径不闭环

expiresAt 提交时计算，成功和重试沿用，久排队/晚重试可能刚生成就过期。导出私有删除 helper 没有统一 GC 的 deleting 墓碑。长期 purge 对物理删除失败只记日志，仍删任务；文件若仍 live/refCount=1，可能失去后续回收入口。

位置：server services/tasks/export-jobs.service.ts:336/:456/:600/:646/:660；对照 services/files/file-gc.service.ts:69。

改进：文件完成起算保留期；attempt产物独立；统一删除意图/墓碑，失败保留重试记录。分别管理任务、文件和审计留存。覆盖存储故障、上传后崩溃、文件缺失和清理期间下载。

### F15 · P2：layout 声明与实现不符

types/文档声明 layout.sheets；writer 只有 custom 和 table 路径。隔离定义两张 layout sheet，实际只有一张普通表。当前 55 个实体没有依赖 layout，属于扩展契约失真。

位置：server lib/export-center/types.ts:9/:162；writer.ts:227；docs/backend/export-center.md:10。

改进：实现并测试 layout，或删未实现类型并在注册时拒绝；多 sheet/汇总表作为明确新功能。

### F16 · P2：中心页与能力、安全标签不一致

格式筛选只有 Excel/CSV，实际 PDF/DOCX 无法按格式筛选；多个 CMS 实体同名，下拉难区分。未暴露时间筛选，缺任务详情、创建人/我的/租户范围、单任务深链。来源只跳路径不还原条件；部分报表无 sourcePath。

watermark=true 统一显示“水印”，但 CSV不写元信息，custom renderFile 也不由通用 writer 加水印。真实 CSV、PDF/DOCX 任务均显示该标签，不能据此判断文件保护。查询/下载/删除权限码为 uiOnly，中心按钮也未依这些码门控，应明确产品授权语义。

位置：web pages/system/export-jobs/ExportJobsPage.tsx:46/:148/:197；shared tasks/permissions.ts。

改进：由 capability 和产物 manifest 驱动格式、操作与标签；区分元信息、可见水印、实际脱敏字段数。通知和入口直达任务详情。

### F17 · P2：批量删除、下载计数和审计口径有缺口

Promise.all 删除部分失败时其他可能已删，但 onSuccess 不执行，列表/选择集不刷新。下载计数是读取后加一，有丢更新窗口；本次并发6次实际6次，未复现丢计数。下载日志在返回流前记，只能代表开始读取，非客户端完整接收；最多返回200条。

位置：web hooks/queries/export-jobs.ts:88；server services/tasks/export-jobs.service.ts:562/:570/:581。

改进：服务端批量返回逐项结果；settled 后刷新；SQL原子递增；分页审计并区分尝试/传输完成。安全审计保留不能简单跟任务级联删除。

### F18 · P2：产物类型与业务口径不统一

money 用 toFixed 返回字符串，XLSX金额成为文本；部分枚举直接输出编码，开放API success boolean 的 enumMap仅对string生效。财务CSV缺页面笔均/退款率/环比/总计；填报记录导出主要是ID/状态元数据，没有业务字段。

位置：server lib/export-center/formatter.ts:12/:17；services/open-platform/exports/open-api-call-logs.ts:24；services/report/exports/report-fill-records.ts；web pages/payment/PaymentReportsPage.tsx:32。

改进：区分原始值/展示值/Excel numFmt，编号手机号保文本、金额日期保有效类型并定义时区。增加财务核对规格、填报业务宽表、按模板版本导出和附件清单。

### F19 · P2：测试和 Demo 未覆盖关键闭环

筛选回归只覆盖部分实体，源码形态断言未阻止四类query失效。缺任务提交失败、重试、运行中取消、租约竞争及过期重试行为测试。Mock仅列部分实体；非统计 XLSX 为普通文本“Demo export file”，PDF为头部占位，用户敏感/raw策略与服务端不一致。

位置：server lib/export-center/filtered-exports.test.ts；web mocks/handlers/export-jobs.ts。

改进：注册表派生全实体测试矩阵；Mock复用能力元数据、生成有效文件；权限/文件内容/任务履约不能由缓存单测代替。

## 4. 业务页面与关联模块改进矩阵

| 模块 | 下一阶段重点 | 优先级 |
| --- | --- | --- |
| 用户/租户/会员 | raw门禁、隐藏条件裁剪、有效租户恢复；选列与敏感字段说明 | P1 |
| 岗位/角色/字典/公告 | 修筛选；字典明确定义导出与字典项导出 | P1 |
| 支付订单/退款/签约/投诉 | 真总数、分卷、独立导出权限；补应用/商户/币种与资金核对列 | P1 |
| 会员六类流水 | auto生效，稳定游标，批次取消，交易类型/金额/关联单口径 | P1/P2 |
| 审计/邮件/短信/API日志 | CSV安全、raw门禁、时间边界、长字段预算和撤权 | P1 |
| 网盘动态/外链日志 | 保留管理端范围查询，替换offset，下载复验资源权限，加入托盘 | P1/P2 |
| CMS内容/发布/治理/分发 | 复用内容已有契约校验和上限+1检测；治理分发去截断，明细筛选语义清楚 | P1/P2 |
| CMS表单/问卷/订阅/广告 | 动态敏感列、数字标识脱敏、统一授权；统计保持快照/磁盘路径 | P1/P2 |
| 数据集/打印 | 完整导出与前N条分开，避免重复取数计费；三格式现已跑通，补预算/进度/安全标签 | P1/P2 |
| 财务报表 | 受控聚合导出，含总计/对比期/指标定义/币种/区间 | P2 |
| 填报记录 | 业务字段宽表、模板版本、附件清单、审核时间线 | P2 |
| 聊天/审批单 | 保留成员/实例校验，统一runner，审批单逐份进度，区分行/份/页 | P2 |
| AI反馈/对话 | 反馈入中心、去1万截断；对话保留MD/JSON但共享安全下载/审计 | P1/P2 |
| CMS站点包 | 现同步多表聚合JSON；后台打包、真实资源二进制、hash、依赖/可移植性及导入预检 | P2 |
| 数据库导出 | 保留只读事务，统一CSV安全、背压、取消；大导出后台化与SQL摘要/预算 | P1/P2 |
| 流程定义/决策表/IoT TSL | 保留配置包形态，统一包版本、依赖、hash、审计，CSV共用编码 | P2 |
| 回放HTML/诊断包 | HTML嵌入安全、缺片检测、离线脱敏/大小限制，诊断敏感裁剪 | P1/P2 |
| 看板PNG/二维码/模板下载 | 保留即时本地生成，共享命名/错误反馈/可选审计 | P2 |

不建议为所有本地图片下载强行创建任务；高价值数据导出进入统一治理，轻量呈现和配置包保留合理形式。

## 5. 推荐目标实现

### 5.1 三层边界

1. 业务定义：querySchema、资源授权、列/敏感元数据、查询/快照provider、formatter/renderer。
2. 执行层：复用任务中心事务交接、幂等、租约、重试、心跳、进度、取消、并发、托盘；不维护第二套运行时。
3. 产物治理：不可变规格、文件/分卷manifest、实际行/页/字节、hash、attempt、下载复验、生命周期和审计。

同步小导出经过相同准备和执行器，sync只是等待方式，不绕过预算与安全。

### 5.2 可直接重构的数据模型

无需历史兼容，可明确拆分：

- export_jobs：entity、definitionVersion、actor/effectiveTenant/resourceScope、normalizedQuery、scope、selectedColumns、sort、format、maskingPolicy、dataAsOf、idempotencyKey/requestHash、taskId。
- 执行尝试：attemptNo、stage、心跳、预计/实际工作量、failureCode、retryable、资源统计；能由任务中心承载的直接关联，不重复状态。
- export_artifacts：managedFileId、卷号、manifest、rowCount/pageCount、bytes、sha256、generatedAt、expiresAt、GC状态。
- export_download_events：主体、权限决策、产物/attempt、请求时间、可验证传输结果和错误。

重试使用既定规格；按最新数据重新生成创建新任务并关联sourceJobId，避免重试悄悄改变列/口径/脱敏含义。

### 5.3 建议新增功能

| 功能 | 交付内容 | 前置依赖 |
| --- | --- | --- |
| 统一导出配置 | 全部筛选/当前页/勾选项；选列/顺序/格式/时区/脱敏；小样预览/数量估算 | 规格准备阶段 |
| 任务详情 | 筛选摘要、规格/范围、各阶段/attempt、错误、文件/下载历史 | 执行与产物模型 |
| 全局任务体验 | 顶栏托盘、跨页恢复、通知直达、取消/重试解释 | 任务中心 |
| 分卷清单 | CSV/XLSX按预算分卷，ZIP/manifest/hash，单卷或整包下载 | 磁盘writer/产物模型 |
| 个人/团队模板 | 列模板、财务核对、运营报表、填报业务规格 | 稳定列契约 |
| 运营策略 | 租户/用户并发、优先级、日条数/字节、临时磁盘、保留期 | 执行指标/预算 |
| 定时与审批 | 周期报表、订阅结果、受控投递、敏感明文申请审批 | 安全和可靠性先稳定 |

## 6. 实施顺序与完成标准

### 阶段A：可信导出

处理raw门禁、元信息裁剪、CSV/HTML安全、四类筛选、静默截断、auto预算、下载误报与租户上下文；补全实体安全/筛选矩阵。

验收：无权限无明文；文件任意部分无被保护测试值；列表全集与产物一致；超限明确；失败无成功提示；有效租户范围可证明。

### 阶段B：可靠执行

任务中心统一执行，事务交接、attempt/lease/heartbeat、真正取消、自动重试、幂等；生成/上传/挂接/GC可恢复，磁盘流式、真实计数与稳定游标/快照。

验收：丢交接、宕机、重复消息、慢存储、取消、晚重试及GC失败均可恢复；状态与产物一致；有并发/内存/事件循环/磁盘基准。

### 阶段C：统一体验与业务深度

配置面板、详情、托盘、全格式筛选/深链、动态列治理、分卷；财务完整指标和填报业务字段；AI反馈等高价值出口入中心；配置包/数据库/图片共享适合的安全审计能力。

验收：用户知道范围、字段、口径、进度和保留期；离页仍可跟踪，产物可验证，安全标签反映实际能力。

### 阶段D：自动化运营

再做定时报表、团队模板、明文审批、受控投递、容量与成本策略。避免在安全/准确性缺口未闭环前扩大自动投递范围。

## 7. 已验证正向能力及未覆盖项

开发环境确认：普通CSV可生成下载；显式async任务#5被worker消费并成功；会员默认脱敏CSV手机号打码；数据集XLSX生成；打印XLSX/PDF/DOCX均生成且文件签名正确；CMS统计强制后台并成功产出空结果表头；排队取消保持终态。未对所有打印文件逐页做视觉验收，不将文件签名正确等同版式完美。

本次为review，未修改功能代码/用户/角色/源业务数据/运行配置/数据库结构。临时测试移除；本次#1—#16导出任务记录已删除，列表总数恢复0，文件交GC。

后续必须补：普通用户与多租户矩阵、50k/宽表/长文本压力、进程恢复、运行中取消、真实对象存储异常、旧文件资源撤权、全文件解包扫描及小屏UI。这些是后续验收项，不是本次已通过项。
