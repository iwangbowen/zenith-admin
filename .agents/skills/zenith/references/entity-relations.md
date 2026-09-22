# 跨对象关联视图

当需求包含“关联信息”“对象上下文”“从一个业务对象打开另一个对象”“反查来源”“详情页时间线”或“关联分组状态提示”时，先读取本参考；产品边界和已验收范围见 [跨对象关联视图](../../../docs/guide/entity-relations.md)，验收矩阵见 [跨对象关联视图验收记录](../../../docs/guide/entity-relations-qa.md)。

## 统一边界

- `packages/shared/src/platform/contracts/entity-relations.ts` 是关联查询契约的唯一真相；实体类型、对象引用、关系分组、分页响应和摘要状态都从这里派生。
- `packages/server/src/services/platform/relations/` 负责锚点解析、关系 Provider、权限、租户 / 数据范围和游标签名；关系 Provider 不得把未经授权的目标数量或摘要泄露给客户端。
- `packages/web/src/components/entity-relations/` 负责通用关联上下文和分组展示；业务详情容器内优先直接嵌入 `EntityContextView`，避免“详情 SideSheet → 关联按钮 → 第二个关联 SideSheet”的层级不一致。
- 目标对象必须通过自身详情契约再次鉴权。关系摘要只用于提示是否有内容，不替代目标详情权限。

## 新增关系的落地顺序

1. 在 Shared 的实体目录登记 source / target 类型和能力；需要跨模块搜索或详情跳转时，同时登记安全的 `entityDetailRoute`。
2. 在 Server 增加 `EntityAnchorResolver` 和 `RelationProvider`。Provider 必须声明 `sourceType`、关系 key、目标类型、权限和适用条件；`list()` 使用与锚点相同的租户、数据范围和目标权限约束。
3. 为 Provider 提供可选的 `exists()` 或 `summarize()` 快速摘要；未提供时由注册表用同权限的 `list(limit=1)` 推导。摘要只能返回 `has-data`、`empty`、`attention`、`unavailable`，不得返回数量。
4. 对写入关系、解除关系和会影响关系结果的业务 mutation，调用 `invalidateEntityRelations()` 或域内具名失效 helper；不能只刷新当前列表。
5. Web 列表使用 `entityRelationColumn()`；详情页使用 `EntityContextView` 直接展示关联分组和时间线。只有没有标准详情容器的场景才使用 `EntityRelationButton` 打开上下文抽屉。
6. 关系项点击必须通过 `entityDetailRoute()` 或 `EntityNavigationContext` 进入目标对象的精确详情深链；详情页消费 query 参数后清理 URL。带 Tab 的页面使用 `useListDeepLink` 原子消费详情参数和目标页签，避免互相覆盖。
7. Demo 模式同步 MSW 的关系分组、关系项和 `summaryState`；Mock 不得用未经权限过滤的全量数据伪造摘要。

## 分组摘要和交互

折叠分组标题只显示状态图标，不显示数量或状态文字。状态通过颜色、Tooltip 和 `aria-label` 表达：有记录、暂无记录、需处理、暂不可用分别对应四种摘要状态；不能只依赖颜色传达含义。

分组内容按需加载。刷新使用右上角浮动图标，不能占一行，也不能触发折叠切换；刷新时保留已有列表和布局，只让图标进入 loading。首次加载没有旧数据时可以显示局部加载态，重新获取已有数据时不得插入或移除内容节点。

关系来源使用 `EntityRelationItem.origin` 的受控摘要：`kind` 表示直接关联、业务推导、流程 / 事件触发或操作活动；可选 `eventType` 只传安全事件标识，不传事件 payload。RelationPanel 通过图标和 Tooltip 说明“为什么关联”，`occurredAt` 表示关联时间；来源字段由服务端 Provider 在同一权限、租户和数据范围内生成，前端不得自行推断。

## 验收要求

- Shared 契约测试覆盖实体引用、摘要状态和默认兼容值；Server 测试覆盖 Provider 的授权、租户隔离、空结果、有结果、异常 / 超时降级和不暴露数量。
- Web 测试覆盖折叠标题状态图标、Tooltip / 无障碍标签、懒加载、刷新不改变内容位置、关联项下钻和缓存失效。
- 浏览器至少验证一个有数据分组、一个空分组、一个异常分组、一个详情深链和一次刷新；确认标准详情页不会再打开多余的关联 SideSheet。
- 按项目完成标准运行 build、lint、相关测试和启动冒烟；包体预算失败时记录实际基线，不能为了关系功能直接提高预算阈值。
