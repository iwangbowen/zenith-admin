# 导入中心接入流程

导入功能统一使用 `ImportDefinition`、`ImportButton`、`useImportUpload` 和任务中心，不新增页面私有上传链路。完整能力边界见[文档站导入中心](../../../../docs/backend/import-center.md)。

## 接入步骤

1. 在 `packages/server/src/services/{domain}/imports/` 定义实体列、权限、上下文校验、预载数据、`parseRow`、`insertRow` 和 `duplicateKey`。
2. 在 `packages/server/src/bootstrap/import-definitions.ts` 注册定义；不在路由模块产生注册副作用。
3. 页面使用 `ImportButton`，非标准上下文通过 `context` 和 `beforeSubmit` 传入；导入中心不承接 `requiresContext` 实体。
4. 文件由 `useImportUpload` 以受控可见性上传；预检先走 `inspect`，用户确认映射和重复策略后再提交任务。
5. 预检无失败行后由进度窗口确认正式导入；失败行下载错误文件，修正后重新上传，不修改旧任务结果。

## Definition 要求

- `columns` 是字段元数据单一来源；`required`、`enumValues`、`example` 和 `note` 同时驱动模板与映射界面。
- `parseRow` 只做归一和业务校验；`prepare` 预载查重集合、外键和策略，避免逐行重复查询。
- `duplicateKey` 返回稳定业务键，供文件内重复判断；已存在业务数据的重复错误在 `skip` 策略下标为跳过，否则进入错误文件。
- `insertRow` 的多表写入使用同一事务，并遵守租户、资源 ACL 和现有业务 Service；不要在 handler 中拼接 SQL 或绕过权限。

## 验证清单

- 表头顺序变化、规范化表头、显式字段映射、重复表头、缺少必填列、空行和行数上限。
- 预检不写库，确认后才写库；重复策略 error / skip 的行级状态准确。
- 受控文件跨租户拒绝读取；错误文件下载不经过公开文件接口；终态释放输入文件引用。
- 取消、任务执行权丢失、队列重投、错误文件修正后二次导入和列表精确失效。
- 浏览器验证上传中、表头读取成功/失败重试、映射缺失阻止提交、预检确认、错误文件下载和 390px 窄屏。
