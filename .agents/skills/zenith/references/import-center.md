# 导入中心接入流程

导入功能统一使用 `ImportDefinition`、`ImportButton`、`useImportUpload` 和任务中心，不新增页面私有上传链路。完整能力边界见[文档站导入中心](../../../../docs/backend/import-center.md)。

## 接入步骤

1. 在 `packages/server/src/services/{domain}/imports/` 定义实体列、权限、上下文校验、预载数据、`parseRow`、`insertRow` 和 `duplicateKeys`（单键实体可使用 `duplicateKey`）。
2. 在 `packages/server/src/bootstrap/import-definitions.ts` 注册定义；不在路由模块产生注册副作用。
3. 页面使用 `ImportButton`，非标准上下文通过 `context` 和 `beforeSubmit` 传入；导入中心不承接 `requiresContext` 实体。
4. 文件由 `useImportUpload` 以 `restricted` 可见性上传；通过 `onPrepared` 进入配置面板，调用 `inspect` 读取文件，用户确认映射和重复策略后调用 `submitPrepared`。选择文件时固定实体、上下文和预检模式，异步上传期间不能串用其他选择状态。
5. 预检无失败行后由进度窗口确认正式导入；失败行下载错误文件，修正后重新上传，不修改旧任务结果。

## Definition 要求

- `columns` 是字段元数据单一来源；`required`、`enumValues`、`example` 和 `note` 驱动模板，`aliases` 驱动建议映射，密码等敏感列声明 `sensitive: true`。模板的数据页不写示例记录。
- `parseRow` 只做归一和业务校验；`prepare` 预载查重集合、外键和策略，避免逐行重复查询。资源级 ACL 必须在 `prepare(context)` 中复验，该方法也会用于错误文件下载授权，不得产生业务写入或其他副作用。
- `duplicateKeys` 返回全部唯一业务键；单键实体可用 `duplicateKey`。预检、写入和恢复共用同一重复口径；重复行必须记录跳过或失败明细。
- `insertRow` 的多表写入使用同一事务，并遵守租户、资源 ACL 和现有业务 Service；框架通过 `ctx.transaction` 与 `withDbExecutor` 将业务写入、成功明细和检查点收口到同一事务，不得绕过当前执行器自行提交。
- 写入阶段的预期行拒绝使用 `HTTPException(400 / 409)`，数据库完整性约束由统一处理器识别；连接故障、超时和其他系统异常必须向上抛出，不能转换成普通行错误后继续。
- `finalize` 仅在正式导入完成逐行处理后调用，应可重复执行；外部副作用按领域事件 / Outbox 规范接入，不在行事务中发起外呼。

## 映射与任务操作

- `fieldMapping` 的 key 是目标字段 key，值是文件表头；`null` 表示明确忽略可选列，省略 key 则按标准表头匹配。别名识别结果须通过建议映射提交，不能仅依赖显示文案。
- 文件检查 `inspect` 只解析表头、行数和脱敏样例；`data-import-preview` 才执行逐行业务预检，二者不能混称。行数必须显示实际数值，不以省略号占位。
- `data-import-preview` 与 `data-import` 分别注册；只有预检状态为 `success` 且 `result.failed` 为 0 时允许原创建人确认。确认创建正式任务并重新校验，不承诺预检后业务数据保持不变。
- 恢复保留检查点；重新开始清空检查点和明细，但不会撤销已提交的业务数据。修正数据应下载错误文件后重新上传，不能用重开代替修正。详细操作语义见[导入中心](../../../../docs/backend/import-center.md#恢复重试与文件生命周期)。
- 任务关联文件统一使用任务中心事务生命周期钩子管理，业务定义不自行增减引用或删除文件；钩子契约见[任务中心](../../../../docs/backend/task-center.md#业务事务执行权与状态结算)。

## 验证清单

- 表头顺序变化、规范化表头、显式字段映射、重复表头、缺少必填列、空行和行数上限。
- 预检不写库，确认后才写库；重复策略 error / skip 的行级状态准确。
- 受控文件同时校验上传者和精确租户；原创建人确认及下载错误文件，执行前复验启用状态、租户和当前权限。输入文件引用保留至任务删除，清理同时释放错误文件；重开先释放旧错误产物。
- 业务写入、成功明细和检查点同事务且受执行权 fencing 保护；基础设施故障中止任务，不能按普通行错误吞掉。
- 模板数据页只含表头，示例放独立说明页；敏感样例脱敏，检查空行计数、源列位置、重复/未知映射和可选列显式忽略。
- 取消、任务执行权丢失、队列重投、错误文件修正后二次导入和列表精确失效。
- 浏览器验证上传中、表头读取成功/失败重试、映射缺失阻止提交、预检确认、错误文件下载和 390px 窄屏。
