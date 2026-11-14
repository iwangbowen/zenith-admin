# 导出中心

导出中心统一管理业务数据文件的配置、生成、文件保存与受控下载。HTTP 契约位于 `@zenith/shared/tasks`，核心实现位于 `packages/server/src/lib/export-center/`，任务接口为 `/api/export-jobs`。

## 职责与执行链路

```text
业务页面 → ExportButton → ExportConfigHost / ExportConfigPanel
                          ↓ 预检 / 提交
                    prepareExport
                          ↓
              export_jobs + async_tasks（异步时同事务）
                          ↓
         writer / renderer → restricted managed_files
                          ↓
             当前轮次结算 → 导出中心受控下载
```

导出中心维护规格、文件、安全和留存；异步执行使用任务中心的 `data-export` 类型，复用领取、租约、心跳、自动重试和协作取消。业务模块只注册导出定义，不单独维护导出队列。任务运行机制见[任务中心](./task-center.md)。

## 配置与页面交互

列表页使用 `ExportButton`，默认 `formats={['xlsx', 'csv']}`、`raw=false`、`watermark=true`、`executionMode="auto"`。配置侧栏由布局中的 `ExportConfigHost` 稳定承载，移动端更多菜单关闭不会卸载侧栏；切换页面或账号时清理配置。

首屏展示导出标题、预计条数、脱敏模式、留存天数、数据范围和格式。格式使用 Semi UI `RadioGroup type="button"`。其余内容按以下分组默认折叠，标题保留当前配置摘要：

| 分组 | 内容 |
| --- | --- |
| 字段与顺序 | 勾选、排序、恢复默认和清空；字段列表局部滚动 |
| 数据预览与筛选 | 已提交的筛选和最多 3 条脱敏样例，可手动刷新 |
| 高级设置 | 有权限时的明文模式、Excel 元信息、分卷与预算说明 |
| 模板与定时导出 | 应用、保存、团队共享、删除及周期生成 |

规格变化后自动重新预检。样例、数量和留存必须对应已验证的当前规格，校验未完成或失败时不能提交。敏感明文警告、空字段校验和请求错误保持可见，不能被折叠隐藏。页脚仅保留右对齐的“取消 / 开始导出”；刷新预览位于预览分组内。

### 数据范围与能力

- `filtered`：当前已提交筛选的全部授权结果，默认范围。
- `page`：页面提供 `pageIds` 且服务端支持时开放。
- `selected`：页面提供非空 `selectedIds` 且服务端支持时开放。

当前页和勾选 ID 只在原授权筛选的源结果内匹配，重复身份归一；记录失效、被筛选排除或不可访问时拒绝部分成功。全部勾选 ID 命中后停止继续扫描。

前端按预检响应决定功能，不通过格式名或是否存在某列自行推断：

| 预检字段 | 含义 |
| --- | --- |
| `supportsColumns` | 普通 table 表格支持自选字段；固定版式文档不支持 |
| `supportsRowScope` | 非快照 table 表格存在 id 列时支持当前页/勾选范围 |
| `supportsPartition` | 非快照 table 表格支持分卷，不要求有 id 列 |
| `canExportRaw` | 当前账号持有该实体配置的独立明文权限 |
| `estimatedRows` / `executionMode` | 当前规格的数量估算与服务端执行判断 |
| `maxRows` / `syncMaxRows` / `retentionDays` | 生效预算和留存说明 |

即时样例只对可预览的普通表格且估算结果不超过 5000 条时提供；未知计数、快照或自定义文档可以不提供样例。预览始终脱敏，即使有明文权限且请求 `raw=true`。

## 格式、字段与渲染

- **table**：CSV / XLSX；支持列顺序、枚举格式化、敏感列、金额与日期语义。Excel 可包含分组表头、样式、标题和隐藏元信息。
- **withSnapshot**：由业务定义持有只读快照，回调内完成取数和磁盘写出，适合同一时点统计；不提供即时样例、当前页/勾选和分卷。
- **custom**：`renderFile()` 提供 PDF、DOCX 或模板文件；`renderWorkbook()` 提供固定 Excel 布局。自定义文档的字段与版式由模板决定，不能开放通用选列。

`layout` 渲染模式不开放，提交时拒绝。PDF / DOCX 必须由实体明确声明支持，不能仅修改请求格式获得。

普通表格通过 `renderExportToPath` 写临时文件；XLSX 使用 ExcelJS streaming writer 逐行 commit，CSV 共享安全单元格编码，用户文本不得作为公式执行。金额列的业务值按分解释，XLSX 保持数值类型和两位小数格式；日期按应用时间工具统一格式化。

`columns` / `resolveColumns` 声明列 key、表头、类型、枚举、敏感属性及样式。预检/创建验证未知和重复列，保存当前字段集合与顺序；执行时复验字段是否仍存在及敏感性是否变化，变化时要求重新配置。

## 服务端规格准备与完整性

预检、创建和模板保存共用 `prepareExport`。业务 `prepareQuery` 负责参数校验及资源准备，应可重复调用；执行与下载均会复验。导出请求体为 JSON，布尔和数字必须按 JSON 语义处理，不能把已解析值重复传给只接受字符串的 URL query 变换。

`countRows` 与 `streamRows` 必须消费同一授权查询：关键词、状态、固定业务上下文、时间边界、租户和数据范围与业务列表一致。数据量较大时分批消费并稳定排序，可使用 `streamByDescendingId`；要求同一时点的统计使用 `withSnapshot`。

计数用于准入与进度估算，最终 `rowCount` 来自实际写入。提交和消费均受预算限制；不能以 `Math.min(total, limit)`、截取数组或“取前 N 条”伪装完整导出。超限时明确失败并提示收窄条件；创建过程中数据变化也不能产生未标识的部分成功。

### 执行策略与幂等

默认执行策略为 `auto`。服务端综合实体模式、同步阈值、敏感/明文强制后台策略及快照能力决定执行方式；显式请求 `sync` 不能绕过这些限制。

异步任务与导出记录同事务创建，由任务中心负责派发、补投、租约、心跳、重试与取消。`data-export` 注册默认 3 次尝试；具体运行时策略由任务中心管理。生成、上传、文件引用和成功状态只由当前执行轮次结算，失去执行权的轮次不能发布文件。

`idempotencyKey` 按租户/用户隔离：同键同规格返回已有任务，同键不同规格返回冲突。同一规格的请求重试保持原键；用户修改规格需要新键。重放不重复扣日配额。

运行中取消为协作式：请求后显示取消中，由取数/渲染进度检查中止；只有任务终态才显示已取消。失败的异步任务可重试；同步失败通过重新导出提交新任务。

### 分卷

非快照普通 table 的 CSV / XLSX 可设置 `splitRows`，0 表示单文件，正数为每卷行数。单次遍历源数据，生成 ZIP 与 `manifest.json`，最多 200 卷；预检按估算数量提前拒绝过多分卷，消费阶段仍有总行数/总字节预算。

清单包含格式、脱敏模式、字段顺序、总行数，以及每卷名称、行数、字节数和 SHA256，不写入原始筛选参数。ZIP 作为一个托管文件受控下载，不提供单卷独立下载入口。

## 权限、脱敏与下载

每个实体声明 `permissions.export`。敏感或动态列、以及声明了强制独立权限策略的实体，`raw=true` 必须通过 `permissions.exportRaw`；敏感实体缺少该配置时拒绝明文。

敏感列使用 `sensitive`，契约字段可绑定 `maskKey: 'User.phone'`。执行时加载数据脱敏中心的生效策略；未绑定策略的敏感列按显式类型或字段名回退打码，数字敏感值同样保护。导出不使用页面查看者的豁免权限；已停用字段策略遵循数据脱敏中心的当前口径。

Excel 隐藏元信息、表格元信息和分卷清单不能写入原始敏感筛选值。完整查询只保存在受控任务记录，不因选择关闭元信息而放宽权限或脱敏。

### 任务可见范围

普通用户仅管理自身且当前租户可见的任务；`system:export-job:tenant-manage` 管理有效租户内任务；`system:export-job:manage` 和平台超管的管理范围仍服从当前租户视角。任务可见不等于文件可下载。

### 授权证明与资源复验

产物保存内部 `authorization` 证明，绑定创建人、有效租户、角色、功能权限和数据范围指纹。下载执行以下校验：

1. 任务可见、成功、文件存在且未过期；创建人当前有效，所属租户有效。
2. 创建人的当前权限/数据范围与证明匹配；当前源记录仍可访问。
3. 实际下载人的当前导出/明文权限、资源权限及源记录范围通过校验。

普通非快照表格记录源行身份摘要并在有界查询内复验；没有 id 的行使用内容摘要。数据、权限或范围变化时可以保守拒绝旧文件，要求重新导出；缺失授权证明直接拒绝，不提供历史文件兼容放行。快照聚合报表沿用快照、能力/数据范围及资源校验，不在下载时重新生成统计。

有资源 ACL 的定义实现 `authorizeDownload(query, user)`，只复验资源，不重新渲染文档。打印模板须检查主数据集、绑定数据集与子报表，数据集检查当前资源权限，审批单检查实例当前可见关系。管理员代下载也不能绕过原创建人的撤权。

文件通过 restricted `managed_files` 保存，不公开对象直链。缺失本地内容在建立读流前返回 410，失败请求不增加下载次数。下载日志记录服务端提供文件读流的请求，并不证明浏览器完整接收；日志随导出任务删除。

## 运行时治理与文件留存

平台级设置模块 `exports`，读权限 `system:setting:view`、写权限 `system:setting:update`：

| 设置 | 默认值 | 生效语义 |
| --- | --- | --- |
| `maxRows` | 500000 | 与实体 `execution.maxRows` 取较严值；实体默认 50000 |
| `syncMaxRows` | 5000 | 与实体同步阈值取较严值，超出转后台 |
| `maxFileMb` | 128 MiB | 产物字节预算，分卷总大小和 ZIP 同样受限 |
| `maxColumns` | 256 | 当前规格列数上限 |
| `dailyJobsPerUser` | 100 | 租户/用户/上海日期的持久化日配额；删任务不返还 |
| `schedulingEnabled` | true | 是否允许周期生成，不影响手动导出 |

默认文件留存从成功完成时起算：普通 7 天、敏感 3 天、明文 1 天，实体可声明专用策略。

`export-file-cleanup` 每天清理过期文件及 90 天前的配额计数；删除先写 `deleting` 墓碑，失败由 GC 重试。任务长期清理由 `export_jobs` 数据保留策略调用 `purgeExpiredExportJobRecords()`。异常退出临时目录由 `cleanupAbandonedExportTemps` 按自有名称、非符号链接及 24 小时年龄回收，在导出前和每日清理时执行。

## 模板与定时导出

个人模板保存当前筛选、字段与格式；应用时只替换字段/格式，保留当前页面筛选。团队成员看不到创建人的私有查询、调度错误与任务结果；`canManage` 决定管理入口，删除需要确认。

分享/管理团队模板需要 `system:export-preset:share`；定时导出需要 `system:export-preset:schedule`。cron 为 5 段、分钟精度、上海时区。通用 Cron 构建器输出 6 段，导出配置仅允许秒为 0 后在边界转换。

调度器每分钟最多领取 20 项，使用租约和槽位幂等键防重复提交。每次运行复验创建人状态、有效租户与权限，固定脱敏、后台执行并使用保存时的筛选。完成/失败通过 `platform.export.finished` 通知创建人，链接进入任务详情；不外发附件，也不提供逐份明文导出审批。删除模板停止新触发，已提交任务独立管理。

## 后端接入

定义位于 `packages/server/src/services/{domain}/exports/`，集中注册于 `bootstrap/export-definitions.ts`。以下复用岗位列表的实际过滤与稳定排序：

```ts
import { asc } from 'drizzle-orm';
import { positionListQuery } from '@zenith/shared/identity';
import { db } from '../../../db';
import { positions } from '../../../db/schema';
import { defineExport } from '../../../lib/export-center/registry';
import { buildPositionsWhere } from '../positions.service';

export const positionsExportDefinition = defineExport({
  entity: 'system.positions',
  moduleName: '岗位管理',
  filenamePrefix: '岗位列表',
  sourcePath: '/system/positions',
  permissions: { export: 'system:position:list' },
  columns: [
    { key: 'id', header: 'ID', type: 'number' },
    { key: 'name', header: '岗位名称' },
    { key: 'code', header: '岗位编码' },
  ],
  prepareQuery: async query => positionListQuery.omit({ page: true, pageSize: true }).parse(query),
  countRows: async query => db.$count(positions, buildPositionsWhere(query)),
  streamRows: async query => db.select().from(positions)
    .where(buildPositionsWhere(query))
    .orderBy(asc(positions.sort), asc(positions.id)),
});
```

查询 schema 应与传入 JSON 值兼容；含 queryBool 等字符串变换时，派生 JSON 校验，而非重复 parse 同一 URL query schema。资源型定义同时实现 `authorizeDownload`。权限码先在业务域 `permissions.ts` 登记，注册表与 Mock 共用 Shared 契约。

## 前端接入

标准页使用 `useListPage` 的 `filterQuery`，非标准页使用 `useFilterQuery`。不从未提交草稿导出，不在页面手写 `useMemo(() => compactParams(...))`，查询归一化见[数据获取](../frontend/data-fetching.md)。

```tsx
<ExportButton
  entity="system.positions"
  query={page.filterQuery}
  permission="system:position:list"
  pageIds={page.tableProps.dataSource?.map(row => row.id)}
  selectedIds={selectedRowKeys}
/>
```

`pageIds` / `selectedIds` 由页面真实数据与选择状态提供；没有相应能力可省略。命令式业务入口复用 `useExportJobRunner`。下载通过 `request.download` 并等待成功后提示，不直接拼下载 URL 或绕过认证上下文。

取消/重试更新目标任务详情与列表，删除移除目标详情/下载日志缓存；批量删除等待全部请求结束，逐项处理成功与失败。详情链接为 `/system/export-jobs?jobId={id}`，可在已挂载页面消费后续任务深链；成功态显示文件已生成，不保留运行阶段备注。

## API 与验证

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/export-jobs/entities` | 当前可导出实体元数据 |
| POST | `/api/export-jobs/preview` | 准备规格、能力、预算和脱敏样例 |
| POST / GET | `/api/export-jobs` | 创建 / 分页查询任务 |
| GET / DELETE | `/api/export-jobs/{id}` | 详情 / 删除 |
| GET | `/api/export-jobs/{id}/download` | 受控下载 |
| GET | `/api/export-jobs/{id}/downloads` | 下载请求记录 |
| POST | `/api/export-jobs/{id}/cancel`、`/api/export-jobs/{id}/retry` | 取消 / 重试 |
| GET / POST | `/api/export-jobs/presets` | 查询 / 保存模板 |
| DELETE | `/api/export-jobs/presets/{id}` | 删除模板与后续调度 |

请求字段以 `createExportJobSchema` 为准：`entity`、`format`、`query`、`columns`、`scope`、`rowIds`、`raw`、`watermark`、`executionMode`、`splitRows`、`idempotencyKey`。`rowIds` 最多 50000 个、`columns` 最多 512 个且受平台列预算限制、`splitRows` 为 0..50000。前端/hooks/Mock 使用契约操作，不手写同形请求 DTO。

接入验收应覆盖筛选/顺序与列表一致、行数预算边界、分卷计数与哈希、敏感值全文件扫描、生成后撤权、跨租户、运行中取消、旧轮次/强杀恢复、存储与 GC 失败重试，以及桌面/窄屏配置。PDF/DOCX 需要渲染逐页检查；真实基础设施测试与替身测试分开报告，不能以 HTTP 200 或文件签名代替完整产物验收。
