# 跨对象关联视图

跨对象关联能力由平台编排、领域查询和结构化主体引用组成。统一搜索仍然只负责“找到对象”；关联接口负责“查看该对象关联了什么”。

## 核心协议

- `EntityType` 是对象的规范化类型，例如 `payment.order`、`payment.refund`、`workflow.instance`。
- `EntityRef` 只有 `type` 和不透明的 `key`。租户由服务端上下文决定，客户端不能传入租户范围。
- `RelationKey` 使用命名空间，例如 `payment.order.refunds`。
- `SubjectRef` 用于审计、通知、异步任务和领域事件；`traceId` / `parentRef` 只表示因果链，不能代替对象引用。

共享实体原语位于 `packages/shared/src/core/entity-ref.ts`，平台实体注册表位于 `packages/shared/src/platform/entity-registry.ts`。

## 服务端接口

```text
GET /api/platform/entities/{type}/{key}/relations
GET /api/platform/entities/{type}/{key}/relations/{sectionKey}
GET /api/platform/entities/{type}/{key}/timeline
```

第一条接口只返回锚点和当前用户可发现的分组。分组内容按第二条接口独立加载，使用 cursor 分页。时间线使用 typed event，不把普通关联条目按时间直接拼接。

领域 Provider 位于 `packages/server/src/services/platform/relations/providers/`，只接收已解析的可见锚点和访问上下文，不能向平台层暴露 Drizzle `SQL`、表列或通用 `scopeWhere`。

接入新领域时按以下顺序完成：

1. 在实体注册表增加实体类型和能力。
2. 在领域 Service 实现锚点可见性和关联查询。
3. 注册命名空间化 Relation Provider。
4. 在通知、任务、审计或领域事件写入入口传递 `SubjectRef`。
5. 为租户、数据范围、模拟登录、目标对象权限和分页增加测试。
6. 在详情页挂载通用关联组件；保留领域自己的业务概览。

## 数据存储

- 已有 FK 和 `bizType + bizId` 是关系事实，由领域表和领域 Service 负责。
- `entity_relation_edges` 只用于真实的跨域 N:M 关系。
- `operation_log_subjects` 支持一条审计记录关联多个对象。
- `notification_outbox_subjects`、`async_task_subjects` 和 `domain_event_subjects` 保存异步副作用的业务主体。

所有主体表都按 `tenantId + entityType + entityKey` 建反向查询索引。写入必须在业务事务内完成，目标对象和租户归属由领域 Service 校验。

## 权限规则

1. 锚点不可见时统一返回 404。
2. 没有分组发现权限时不返回该分组。
3. 目标对象必须再次执行自身权限检查。
4. `items` 和 `total` 必须使用相同的可见性谓词。
5. 模拟登录按被模拟用户的权限和数据范围执行。
6. 单组预期超时可以局部降级；系统性数据库故障返回 503 并告警。

第一条生产级接入是支付订单，当前已覆盖退款、工作流和操作审计，并在支付订单详情 SideSheet 中按组懒加载展示。
