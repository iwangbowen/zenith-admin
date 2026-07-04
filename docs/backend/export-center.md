# 导出中心

导出中心将后台业务导出统一收口到 `/api/export-jobs` 与 `packages/server/src/lib/export-center/`。业务列表页不新增模块私有导出下载端点，前端通过 `ExportButton` 传入实体编码、导出格式与当前筛选条件。

## 能力范围

- 支持 Excel / CSV。Excel 标准表格支持多级表头、合并单元格、列宽、表头样式、单元格样式、标题行、元信息行与冻结表头；高度定制的文件可通过 `renderMode: 'custom'` + `renderWorkbook()` 直接操作 ExcelJS。
- CSV 只输出表格叶子列，不承载合并单元格、样式和复杂布局；包含复杂布局的导出应只开放 Excel。
- 默认同步明文导出：`ExportButton` 默认 `raw=true`、`watermark=true`、`executionMode='sync'`，实体定义默认 `execution.mode='sync'`。
- 大数据或特殊敏感场景由实体定义的 `execution` 策略改为 `auto` 或 `async`，异步任务进入 `export-jobs` 队列。
- Excel 文件默认写入隐藏的「导出信息」工作表，记录任务号、实体、模块、导出人、导出时间、筛选条件、字段范围、是否明文等信息。
- 所有导出都会生成任务记录；同步导出成功后前端立即下载，异步导出在导出中心查看进度并下载。

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/export-jobs/entities` | 查询当前用户可导出的实体与字段元数据 |
| `POST` | `/api/export-jobs` | 创建导出任务，支持 `format`、`query`、`columns`、`raw`、`watermark`、`executionMode` |
| `GET` | `/api/export-jobs` | 导出任务分页列表，普通用户只看自己的任务 |
| `GET` | `/api/export-jobs/{id}` | 导出任务详情 |
| `GET` | `/api/export-jobs/{id}/download` | 下载成功状态的导出文件，并记录下载日志 |
| `GET` | `/api/export-jobs/{id}/downloads` | 查看任务下载日志 |
| `POST` | `/api/export-jobs/{id}/cancel` | 取消待执行或执行中的异步任务 |
| `POST` | `/api/export-jobs/{id}/retry` | 重试失败任务 |
| `DELETE` | `/api/export-jobs/{id}` | 删除导出任务记录 |

## 权限与可见范围

- 每个导出实体必须声明 `permissions.export`，用于控制是否可以发起该实体导出。
- 普通用户只能查看和下载自己创建的导出任务。
- 拥有 `system:export-job:tenant-manage` 的用户可查看本租户导出任务。
- 超级管理员或拥有 `system:export-job:manage` 的用户可查看全部导出任务。
- 如实体启用 `requireExportRawPermission`，明文导出还需要额外声明并校验 `permissions.exportRaw`。

## 留存与清理

导出文件按实体定义的 `retention` 策略计算 `expiresAt`：

| 类型 | 默认留存 |
| --- | --- |
| 普通导出 | 7 天 |
| 敏感字段导出 | 3 天 |
| 明文导出 | 1 天 |

`raw=true` 时优先使用明文留存天数。过期文件由系统级 pg-boss 周期任务 `export-file-cleanup` 每天 03:00 自动清理；该任务在服务启动时通过 `registerSystemRecurringJob()` 注册，不展示在后台「定时任务」列表中。清理时会删除存储文件和 `managed_files` 记录，并将导出任务标记为 `expired`，保留任务记录与下载日志用于审计。

## 后端接入

在 `packages/server/src/lib/export-center/definitions/` 新增实体定义，并在 `definitions/index.ts` 中注册。

```ts
export const xxxExportDefinition = defineExport<Record<string, unknown>, XxxExportRow>({
  entity: 'system.xxxs',
  moduleName: 'XXX 管理',
  filenamePrefix: 'XXX列表',
  sheetName: 'XXX列表',
  formats: ['xlsx', 'csv'],
  permissions: {
    export: 'system:xxx:export',
    exportRaw: 'system:xxx:export-raw',
  },
  execution: {
    mode: 'sync',
    syncMaxRows: 3000,
    forceAsyncWhenRaw: false,
    forceAsyncWhenSensitive: false,
    syncModeOverridesAsyncPolicies: true,
  },
  retention: {
    normalDays: 7,
    sensitiveDays: 3,
    rawDays: 1,
  },
  columns: [
    {
      header: '基础信息',
      children: [
        { key: 'id', header: 'ID', width: 8, type: 'number' },
        { key: 'name', header: '名称', width: 24 },
      ],
    },
  ],
  countRows: async (query, user) => {
    // 复用列表页 where 构造，返回匹配行数
    return 0;
  },
  streamRows: async function* (query, user, ctx) {
    // 复用列表查询与 DTO 映射，逐行返回导出数据
  },
});
```

多级 `columns.children` 会自动渲染为合并表头。字段级样式使用 `style` / `headerStyle`，全局样式使用 `styles.title`、`styles.meta`、`styles.header`、`styles.body`。

## 前端接入

列表页统一使用 `ExportButton` 组件。

```tsx
function buildExportQuery(): Record<string, unknown> {
  // 使用当前已提交的筛选条件（submittedParams），与列表查询保持一致
  return {
    keyword: submittedParams.keyword || undefined,
    status: submittedParams.status || undefined,
  };
}

const renderExportButtons = () => hasPermission('system:xxx:export') ? (
  <ExportButton entity="system.xxxs" query={buildExportQuery()} />
) : null;
```

`ExportButton` 默认提供 Excel / CSV 下拉导出。同步导出成功后会自动调用 `/api/export-jobs/{id}/download` 下载文件；异步导出会提示用户到导出中心查看任务进度。
