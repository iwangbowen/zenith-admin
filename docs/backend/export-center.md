# 导出中心

导出中心将后台业务导出收口到 `/api/export-jobs` 与 `packages/server/src/lib/export-center/`。业务列表页通过 `ExportButton` / `useExportJobRunner` 创建导出任务，导出产物保存为 `managed_files` 并由导出中心负责下载审计与过期清理。

## 能力范围

- **导出格式**：`xlsx` / `csv` / `pdf` / `docx`，定义在 `@zenith/shared/tasks` 的 `EXPORT_JOB_FORMATS`。实体默认开放 `xlsx` / `csv`；`pdf` / `docx` 需要实体提供 `renderFile()`。
- **渲染模式**：
  - `table`（默认）：标准表格，支持多级表头、合并单元格、列宽、样式、标题行、元信息行、冻结表头。
  - `layout`：旧声明已不开放，提交时拒绝，不建立兼容层。
  - `custom`：通过 `renderWorkbook()` 直接操作 ExcelJS Workbook，或通过 `renderFile()` 返回任意文件。
- **CSV 限制**：CSV 只输出表格叶子列，不承载合并单元格、样式和复杂布局；非 `table` 模式请求 CSV 返回 400。
- **默认脱敏**：创建任务时 `raw` 默认 `false`，即 `masked=true`；明文导出必须显式传 `raw=true` 并通过对应权限校验。
- **同步 / 异步执行**：默认 `auto`，同步阈值默认5000行，实体策略与平台预算取较严值，显式sync也不能绕过。异步导出与`data-export`任务在同一事务创建，由统一任务中心负责租约、心跳、重试和取消；不再使用独立export-jobs消费队列。
- **行数绝对上限**：`execution.maxRows`（默认 50000，sync/async 通用）。提交时按 `countRows()` 超限直接 400；`countRows` 不准或恒为 0 的定义由 writer 渲染循环兜底中止（xlsx 与 CSV 均生效），防止无界行数进入 CSV 全量累积阻塞事件循环。
- **table 模式流式渲染**：xlsx 使用 `stream.xlsx.WorkbookWriter` 逐行 commit 增量序列化（多级表头/水印/冻结/隐藏元信息表不受影响），不再有 `writeBuffer()` 对整本 workbook 的终局序列化 CPU 连续段；`custom` 模式保留内存 Workbook 路径（定义方自带预算上限）。
- **元信息**：Excel 默认写入隐藏工作表「导出信息」，表格导出默认写标题行和元信息行；`watermark=false` 时跳过这些元信息。
- **结果管理**：所有导出都会生成 `export_jobs` 记录；成功后通过 `saveGeneratedManagedFile()` 写入 `managed_files`，并回写 `fileId`、`fileSize`、真实 `rowCount`。
- **完成通知**：异步导出完成或失败时通过通知中心事件 `platform.export.finished` 通知创建人；同步导出直接返回结果，不发送完成通知。
- **统一配置**：共享ExportButton打开配置侧栏，支持字段/顺序、格式、可用范围、最多3条脱敏样例、模板及分卷；当前页/勾选范围需要页面提供IDs。
- **分卷**：普通table实体的CSV/XLSX可传splitRows，单次读取生成ZIP与manifest.json，最多200卷，清单含每卷行数/大小/SHA256，不包含原始筛选值；快照/custom不支持分卷。
- **全局治理**：运行时设置exports提供maxRows、syncMaxRows、maxFileMb、maxColumns、dailyJobsPerUser及schedulingEnabled；配额按租户/用户/上海日期计数，幂等重放不重复计费，删除任务不退配额。

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/export-jobs/entities` | 查询当前用户可导出的实体与字段元数据 |
| `POST` | `/api/export-jobs/preview` | 只读预检、预算与脱敏样例 |
| `GET/POST` | `/api/export-jobs/presets` | 查询/保存个人或团队模板、定时导出 |
| `DELETE` | `/api/export-jobs/presets/{id}` | 删除模板并停止后续调度 |
| `POST` | `/api/export-jobs` | 创建导出任务，支持 `entity`、`format`、`query`、`columns`、`raw`、`watermark`、`executionMode` |
| `GET` | `/api/export-jobs` | 导出任务分页列表 |
| `GET` | `/api/export-jobs/{id}` | 导出任务详情 |
| `GET` | `/api/export-jobs/{id}/download` | 下载成功状态的导出文件，并记录下载日志 |
| `GET` | `/api/export-jobs/{id}/downloads` | 查看任务下载日志 |
| `POST` | `/api/export-jobs/{id}/cancel` | 取消待执行或执行中的导出任务 |
| `POST` | `/api/export-jobs/{id}/retry` | 重试失败导出任务 |
| `DELETE` | `/api/export-jobs/{id}` | 删除导出任务记录 |

创建请求 schema 来自 `@zenith/shared/tasks` 的 `createExportJobSchema`：

```ts
{
  entity: string;
  format: 'xlsx' | 'csv' | 'pdf' | 'docx';       // 默认 xlsx
  query?: Record<string, unknown>;               // 默认 {}
  columns?: string[];
  raw?: boolean;                                 // 默认 false
  watermark?: boolean;                           // 默认 true
  executionMode?: 'sync' | 'async' | 'auto';      // 默认 auto
  scope?: 'filtered' | 'page' | 'selected';        // 默认 filtered
  rowIds?: Array<string | number>;                // page/selected必填，仅在原授权筛选内匹配
  idempotencyKey?: string;                        // 相同规格复用任务，不同规格冲突
  splitRows?: number;                             // 默认0不分卷，正数最多50000
}
```

## 权限与可见范围

- 每个导出实体必须声明 `permissions.export`，用于控制 `entities` 可见性和任务创建。
- 明文导出：敏感实体或声明了独立raw策略的实体必须通过`permissions.exportRaw`，敏感实体缺少raw权限配置时拒绝；文件执行与下载仍复验身份和权限。预览样例始终脱敏。
- 任务可见范围：
  - 普通用户只能查看、下载、取消、重试、删除自己的任务；
  - 拥有 `system:export-job:tenant-manage` 的用户可管理本租户任务；
  - 平台超管或拥有 `system:export-job:manage` 的用户可管理全部任务。

## 敏感列与数据脱敏

列声明 `sensitive: true` 后，任务会根据用户选择的列计算 `sensitive` 标记。脱敏导出（`masked=true`）执行时预加载数据脱敏中心的生效策略 `getExportMaskRuleMap()`（契约声明 ⊕ 策略覆盖，键为 `Entity.field`）：

- 列带 `maskKey: 'User.phone'` 时按该契约敏感字段的生效策略打码（类型 / 自定义规则），策略停用即该列不再打码，与页面展示同一口径；
- 未绑定 `maskKey` 的敏感列按 `sensitive: 'phone'` 这类显式类型打码，或按字段名推断内置类型（推断不出时保留前后各 1 位，不放行明文）；
- 导出不考虑查看者的豁免权限（文件可能外发，统一打码）；`raw=true` 跳过脱敏，并使用明文导出留存策略。

## 留存与清理

导出文件按实体 `retention` 策略计算 `expiresAt`：

| 类型 | 默认留存 |
| --- | --- |
| 普通导出 | 7 天 |
| 敏感字段导出 | 3 天 |
| 明文导出 | 1 天 |

系统周期任务 `export-file-cleanup`（cron `0 3 * * *`）每天清理过期导出文件：先写文件deleting墓碑再删除物理文件，失败由GC重试；成功后任务标记expired，留存从完成时间起算。同一任务清理90天前日配额计数。导出任务记录本身的长期清理由数据保留策略`export_jobs`负责，调用`purgeExpiredExportJobRecords()`；当前下载记录随任务删除，不将其表述为独立长期安全审计留存。

## 后端接入

在 `packages/server/src/services/{业务域}/exports/` 新增实体定义，并在 `bootstrap/export-definitions.ts` 导入后加入注册数组。示例：

```ts
import { asc } from 'drizzle-orm';
import { COMMON_STATUS_LABELS } from '@zenith/shared/core';
import { db } from '../../../db';
import { positions } from '../../../db/schema';
import { currentUser } from '../../context';
import { tenantCondition } from '../../tenant';
import { defineExport } from '../registry';
import type { ExportColumn } from '../types';

const columns: ExportColumn[] = [
  { key: 'id', header: 'ID', width: 8, type: 'number' },
  { key: 'name', header: '岗位名称', width: 18 },
  { key: 'code', header: '岗位编码', width: 18 },
  { key: 'status', header: '状态', width: 10, enumMap: COMMON_STATUS_LABELS },
  { key: 'createdAt', header: '创建时间', width: 22, type: 'datetime' },
];

export const positionsExportDefinition = defineExport({
  entity: 'system.positions',
  moduleName: '岗位管理',
  filenamePrefix: '岗位列表',
  sourcePath: '/system/positions',
  sheetName: '岗位列表',
  permissions: { export: 'system:position:export' },
  execution: { mode: 'auto' },
  retention: { normalDays: 7, sensitiveDays: 7, rawDays: 7 },
  columns,
  countRows: async () => db.$count(positions, tenantCondition(positions, currentUser())),
  streamRows: async () =>
    db.select().from(positions).where(tenantCondition(positions, currentUser())).orderBy(asc(positions.sort)),
});
```

定义要点：

- `entity` 是前端传入的稳定编码，例如 `system.positions`、`payment.orders`、`report.dataset`。
- `columns` 支持 `children`、`enumMap`、`transform`、`sensitive`（`true` 或脱敏类型）、`maskKey`、`style`、`headerStyle`。
- `streamRows` 可返回数组、同步 Iterable 或 async generator；大数据量导出配合 `cursor-stream.ts` 分批产出。
- `resolveColumns(query, user)` 可按运行时数据生成动态列，适用于报表数据集、表单提交等场景。
- `execution` 与 `retention` 均为部分覆盖，缺省值来自 `DEFAULT_EXPORT_EXECUTION` / `DEFAULT_EXPORT_RETENTION`。
- `renderMode: 'custom'` 可配 `renderWorkbook()`（自定义 Excel）或 `renderFile()`（PDF / DOCX / 任意文件）。
- 导出执行器会用 `runWithCurrentUser(创建者)` 还原身份，定义内部可使用 `currentUser()`、租户过滤和权限相关工具。

`bootstrap/export-definitions.ts` 注册了系统、身份、文件、日志、会员、频道、埋点、支付、工作流、报表、CMS、监控告警等导出实体。以该注册数组作为导出实体清单来源。

## 前端接入

列表页使用 `ExportButton`，将当前已提交筛选条件传给 `query`。条件与列表查询**同源**：用 `compactParams`（`lib/query.ts`）从 `submittedParams` 映射一次得到 `filterQuery`（去掉 `undefined` / `null` / 空串、保留 `0` / `false`、键类型保留），列表与导出都用它；时间区间直接展开 `formatDateTimeRangeForApi(range)`；权限门交给组件的 `permission`：

```tsx
const filterQuery = useMemo(() => compactParams({
  keyword: submittedParams.keyword,
  status: submittedParams.status,
  ...formatDateTimeRangeForApi(submittedParams.timeRange),
}), [submittedParams]);

const listQuery = useXxxList({ page, pageSize, ...filterQuery });

<ExportButton entity="system.xxxs" query={filterQuery} permission="system:xxx:export" />
```

导出定义侧的 `countRows` / `streamRows` 必须消费这个 `query`（复用 service 导出的 `buildXxxWhere(filter)`），否则页面上的筛选对导出无效。

`ExportButton` 默认 `formats={['xlsx', 'csv']}`、`raw=false`、`watermark=true`、`executionMode="auto"`，点击后打开配置侧栏。同步成功后自动下载；异步可在任务托盘与导出中心跟踪，详情支持`?jobId=`深链和校验和。页面提供`pageIds`、`selectedIds`后才开放相应范围；不提供时保留完整筛选范围。

## 模板与定时导出

模板保存当前筛选、字段和格式。应用模板仅替换字段/格式，保留当前页面筛选；团队成员看不到创建人的筛选值。分享团队模板需要`system:export-preset:share`，定时需要`system:export-preset:schedule`。cron为5段、分钟精度、上海时区，系统每分钟领取最多20项，槽位幂等键防重复提交。每次运行复验创建人状态、租户和权限，固定脱敏，失败写回模板状态。删除模板停止新触发，已提交任务独立管理。当前只通知创建人并提供受控下载，不发送附件、不提供逐份明文审批。

阶段交付与未验收专项见[实施记录](./export-center-implementation.md)。
