# 导出中心接入流程

适用于新增/修改业务导出、配置面板、分卷、模板与定时导出。
硬约束只维护在[后端与全局规范](./constraints.md#数据导出)、[前端规范](./constraints-frontend.md#导出配置)；
契约、能力边界和运行机制见[文档站导出中心](../../../../docs/backend/export-center.md)。

## 先确定接入边界

1. 找到业务列表的契约、授权查询构建器和当前导出定义，优先修改已有定义；注册入口为 `packages/server/src/bootstrap/export-definitions.ts`。
2. 选择普通 `table`、只读快照 `withSnapshot` 或 `custom` 文档渲染；格式和功能以实际实现声明，不把表格选列能力套到固定版式文档。
3. 明确业务导出权限、敏感字段与资源 ACL；数据集、主/子打印模板、审批实例等依赖需要当前资源读取能力，不以「任务属于本人」代替资源授权。

## 后端接入

在 `packages/server/src/services/{domain}/exports/` 使用 `defineExport`：

- `prepareQuery`：复用业务契约派生的 JSON 参数校验和资源准备；URL query 中的字符串变换只在协议边界使用。
- `columns` / `resolveColumns`：复用字段/枚举/敏感元数据；列 key 稳定，动态列按真实模板版本展开。
- `countRows` / `streamRows`：复用授权过滤，稳定排序；较大结果分批消费，可使用 `streamByDescendingId`，一致性统计由 `withSnapshot` 持有快照直到 writer 消费结束。
- `authorizeDownload`：声明当前资源及依赖的访问复验，不重新渲染文件。
- `execution` / `retention`：只声明业务特殊值；平台治理设置统一由导出中心读取，不在各实体复制默认预算或运行时配置。
- `renderFile` / `renderWorkbook`：用于固定版式文档；沿用统一进度、预算、取消与受控文件发布链路。

导出定义加入 bootstrap 注册数组；权限码在业务域 `permissions.ts` 登记。无需为导出单独新增 CRUD 路由、队列或 worker，创建/预检/文件下载由 `@zenith/shared/tasks` 契约承载。

## 前端接入

标准列表页传 `page.filterQuery`；非标准页用 `useFilterQuery` 映射已提交条件。
有当前页/多选时，把列表数据的真实ID传入 `pageIds` / `selectedIds`；不构造不属于当前授权结果的ID。

```tsx
<ExportButton
  entity="system.xxxs"
  query={page.filterQuery}
  permission="system:xxx:export"
  pageIds={page.tableProps.dataSource?.map(row => row.id)}
  selectedIds={selectedRowKeys}
/>
```

`system.xxxs` 与权限码是业务接入占位，替换为当前实体注册值。
配置组件、模板/任务 hooks、runner 和 host 均使用已有公共实现；自定义页面需要命令式提交时复用 runner，页面不要持久化第二份服务端规格。

## 关联表面

修改 API 字段时同步 Shared 契约、Service、Web hooks、MSW；修改列/范围/格式时检查预检和生成一致。
修改驱动项同时检查 `export_jobs`、关联 `async_tasks`、`managed_files`、下载日志、托盘与详情深链。
模板/调度权限沿用现有权限目录，团队管理权限不授予他人私有模板的删除能力；应用模板验证当前入口格式与完整字段集合。预算设置沿用 `exports` 模块；通知使用 `platform.export.finished`。

## 验证清单

- 列表全集与导出ID/顺序一致；当前页/勾选/空结果、无效字段、JSON布尔/数字参数和重复预检覆盖。
- 普通/明文权限、跨租户、角色数据范围及资源 ACL 正反例；生成后撤权不能继续下载原文件。
- 脱敏样例、数字敏感值、CSV公式防护；解压XLSX全部成员扫描敏感测试值，不能只检查可见工作表。
- 49999/50000/50001及更大结果：完整成功或明确拒绝；分卷清单总数、每卷计数、字段顺序及SHA256一致。
- 运行中取消、重复消息、交接丢失、旧执行轮次、强杀恢复、上传/读取/GC失败与重试；失败不得发布残缺产物或误报成功。
- 桌面和390px窄屏检查折叠、格式切换、字段顺序、关键警告、菜单关闭后侧栏仍存在及详情深链；PDF/DOCX需渲染逐页检查。

按[后端测试流程](./testing.md)选择领域/全量和真实基础设施用例；替身断言、真实数据库、S3兼容协议验证和生产云验证必须区分。
性能测试记录实际规模、完整读回、RSS、事件循环与并发条件，不把单机测试数字写成通用容量保证。
