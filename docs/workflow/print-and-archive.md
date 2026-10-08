# 审批单打印与存证

实例详情面板（我的申请 / 待我审批 / 我已办 / 抄送我的 / 流程监控共用）提供「打印」：服务端把实例渲染成 **PDF**，
应用内预览后可直接调用浏览器打印或下载，预览、打印、下载是同一份文件。草稿尚无审批链与流水号，不提供打印。

| 项 | 说明 |
| --- | --- |
| 接口 | `GET /api/workflows/instances/{id}/print`（`kind: file`，返回 `application/pdf`），可选 `templateId` 临时指定模板 |
| 访问口径 | 实例详情可见性（发起人 / 参与人 / 持有 `workflow:instance:monitor` 的监控管理员）**且**持有 `workflow:instance:print`；每次打印写操作日志（不记录二进制响应体） |
| 版式来源 | 流程定义绑定的打印模板（`printTemplateId`，报表打印设计器中 `sourceType=entity` / `entityKind=workflow_instance` 的实体模板）→ 未绑定时按**表单快照自动生成**版式 |
| 自动版式 | 标题（流程名称 + 审批单，右上角验真二维码）、编号 / 状态 / 发起时间副标题、基本信息、表单内容（尊重栅格 `row` 并排、`group` / `tabs` / `steps` 分段、`detail` 明细子表（数值列千分位 / 精度 / 单位格式化，勾选「明细汇总」的列出合计行）、`signature` 图片、附件文件名）、审批记录（节点 / 处理人 / 结果 / 意见 / 时间 / 手写签名）、抄送、沟通记录；页脚带每页重复「打印人 / 打印时间 / 页码」 |
| 数据集 | `instance`（主数据集）、`form`、`form_fields`、`form_<明细 key>`、`tasks`、`cc`、`comments`、`consults`、`attachments`，字段目录见 `describeWorkflowPrintDatasets()`（`@zenith/shared/workflow`） |
| 字段格式化 | 选项 → 标签、金额千分位 + 单位、人员 / 部门 / 字典 / 关联审批单 → 名称、附件 → 文件名、富文本 → 纯文本；密码与说明类字段不打印 |
| 脱敏 | 表单中的手机号 / 邮箱 / 证件号字段按「数据脱敏」策略（实体 `WorkflowForm`）打码，与接口出口同一套规则与豁免权限；超管不打码 |
| 流程级设置 | 「更多设置 → 审批单打印」：仅通过后可打印（非 `approved` 实例返回 400）、办结自动归档（见下）、打印水印（页面斜向平铺，文本支持 `{printer}` / `{time}` / `{serialNo}`，留空为「打印人 时间」） |
| 字体 | 服务端随包内置 Noto Sans SC（`packages/server/assets/fonts`），无需运维配置；发布包 / 镜像默认为覆盖 GB 2312 ∪ 通用规范汉字表的子集，人名 / 内容含繁体或生僻字时切全量字体（导出日志会列出缺字），企业自有字体经 `REPORT_PDF_FONT_PATH` 覆盖，见[部署说明 → PDF 字体](../guide/deployment.md#_7-pdf-字体-子集-全量) |

纯逻辑（版式生成、数据集构建、字段格式化）在 `@zenith/shared/workflow` 的 `print.ts`，服务端与设计器共用。

## 归档件（PDF 存证）

开启「办结自动归档」的流程，实例进入 `approved` / `rejected` 终态后由后台作业（`workflow-print-archive` 队列，
终态事件订阅投递，`singletonKey` 去重、失败重试 3 次）生成一份**不可变**的 PDF：以平台超管视角渲染全量原始数据
（不打码、无水印、打印人记为「系统归档」），存为受限托管文件，实例上记录 `archive.fileId / sha256 / templateId / archivedAt`。

| 项 | 说明 |
| --- | --- |
| 打印来源 `source` | `auto`（默认）有归档件则直接返回归档原件，否则实时渲染；`live` 强制按当前版式重渲；`archive` 只要归档件（未归档 404）。临时指定 `templateId` 时总是实时渲染。响应头 `X-Zenith-Print-Source: archive \| live` 标明来源，预览面板据此显示「归档原件」标识与「按当前版式重新生成」 |
| 脱敏边界 | 归档件是未脱敏原件：查看者对该表单存在需打码字段时，`auto` 回退实时（打码）渲染，`archive` 返回 403，不让归档绕过脱敏策略 |
| 完整性 | 每次下发归档件都重新计算 SHA-256 与记录值比对，不一致返回 500（文件损坏 / 被替换） |
| 幂等与并发 | 已归档、非终态、流程未开启自动归档的实例直接跳过；条件更新 `archive_file_id IS NULL` 保证并发只落一份，多余文件交托管文件 GC 回收 |
| 生命周期 | 删除实例时释放归档文件（`releaseManagedFiles`）；归档不受「仅通过后可打印」限制（驳回件同样存证） |

## 验真二维码

审批单标题区右上角带验真二维码（不占正文行，长单据分页时不会被孤立到新页），指向公开页 `GET /api/workflows/print-verify/{token}`（无需登录、无脚本、`noindex`）。
令牌为 HMAC 签名（`createSignedTokenCodec`，purpose `workflow-print-verify`），只证明二维码由本系统签发；
页面实时读取并只展示单据身份与终态事实：标题、单号、流程、状态、发起 / 办结时间、归档 SHA-256 与归档时间，
**不含表单内容与参与人**。令牌无法识别或实例不存在时统一显示「该二维码无效」。链接以 `PUBLIC_BASE_URL` 为前缀，
部署时必须配置为外网可达地址。

## 批量导出与移动端

- **批量导出 PDF**：「我的申请」「流程监控」勾选实例后出现「导出审批单 PDF」，走导出中心实体 `workflow.approval-sheets`
  （`formats: ['pdf']`，单次最多 200 份，≤ 10 份同步返回，更多进后台任务）。多份合并为一个 PDF 顺序拼页，每份沿用查看者的
  访问控制、脱敏、模板绑定与水印；任一实例无权查看即整批失败，不产出残缺文件。
- **移动审批**：详情页右上角「分享」拉取同一份 PDF，支持 Web Share 的浏览器直接系统分享（微信 / 邮件 / 文件），
  否则退化为保存文件；同样要求 `workflow:instance:print`。

## 相关入口

流程定义配置见[流程定义与设计器](./designer.md#更多设置)，查看与打印授权见[权限与范围控制](./permissions.md)，审批操作见[审批、任务与协作](./approval.md)。
