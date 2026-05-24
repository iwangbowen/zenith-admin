# 事件总线

工作流引擎在关键状态变化时会发出事件，你可以通过事件订阅来响应这些变化，实现与外部系统的联动。

## 事件类型

| 事件 | 触发时机 | 典型用途 |
| --- | --- | --- |
| instance.created | 流程实例创建时 | 记录流程发起日志、通知相关人 |
| instance.approved | 流程整体通过时 | 通知发起人流程已完成、归档 |
| instance.rejected | 流程整体驳回时 | 通知发起人流程被驳回 |
| instance.withdrawn | 实例发起人撤回时 | 通知相关人流程已撤回 |
| node.entered | 进入某个节点时 | 触发节点级联操作 |
| node.left | 离开某个节点时 | 清理节点相关资源 |
| task.created | 审批/办理任务创建时 | 发送待办通知 |
| task.assigned | 任务被指派给具体人时 | 发送即时消息提醒 |
| task.approved | 任务被通过时 | 记录审批日志 |
| task.rejected | 任务被拒绝时 | 记录驳回日志 |
| task.skipped | 任务被跳过时 | 记录跳过原因 |
| task.transferred | 任务被转交时 | 通知新审批人 |

## 事件订阅方式

### 1. HTTP Webhook 订阅

最常用的事件订阅方式，在「工作流 → 事件订阅」页面配置：

1. 进入「事件订阅」页面
2. 点击「新建」
3. 填写订阅名称、目标 URL、订阅的事件类型
4. 保存并启用

配置完成后，当订阅的事件发生时，系统会向配置的 URL 发送 HTTP POST 请求。

详见 [事件订阅（HTTP Webhook）](./event-subscriptions.md)。

### 2. WebSocket 实时推送

系统内置 WebSocket 推送，当事件发生时，会实时推送给在线用户。前端无需额外配置即可使用。

### 3. 代码级订阅

如果你需要在代码中响应事件，可以通过事件总线进行订阅：

```ts
import { workflowEventBus } from './lib/workflow-event-bus';

workflowEventBus.on('node.entered', (e) => {
  if (e.nodeKey === 'risk_review') {
    // 自定义副作用，如调用风控接口
  }
});
```

> 节点级别过滤通过 `e.nodeKey` 判断；前提是在设计器里给目标节点设置了稳定的 `key`，参见 [节点配置指南](./node-config.md)。

## 事件数据结构

所有事件都包含以下基础字段：

| 字段 | 说明 |
| --- | --- |
| eventId | 事件唯一标识（UUID） |
| type | 事件类型 |
| occurredAt | 发生时间 |
| instanceId | 关联的流程实例 ID |
| definitionId | 关联的流程定义 ID |
| tenantId | 租户 ID（多租户场景） |
| actor | 触发事件的用户信息 |

不同事件类型会附加不同的字段：

| 事件类型 | 附加字段 |
| --- | --- |
| instance.* | instance（完整的流程实例数据） |
| node.* | nodeKey、nodeName、nodeType |
| task.* | task（完整的任务数据）、comment（审批意见） |

## 事件订阅的签名验证

当配置 `signMode === 'hmacSha256'` 时，系统会在请求头中附带签名：

```http
X-Zenith-Signature: t={timestamp},v1={hex_hmac}
```

接收方应：

1. 校验 timestamp 与当前时间偏差（建议不超过 5 分钟）
2. 用相同密钥重算 HMAC 并比对 v1

详见 [事件订阅（HTTP Webhook）](./event-subscriptions.md#签名)。

## 常见使用场景

### 场景 1：流程完成后通知发起人

订阅 `instance.approved` 事件，收到事件后：

1. 读取事件中的 `instance` 数据
2. 获取发起人信息
3. 发送邮件/短信通知

### 场景 2：任务创建时发送待办提醒

订阅 `task.created` 事件，收到事件后：

1. 读取事件中的 `task` 数据
2. 获取审批人信息
3. 发送待办通知（App 推送、企业微信等）

### 场景 3：节点进入时触发外部系统操作

订阅 `node.entered` 事件，收到事件后：

1. 判断 `nodeKey` 是否为特定节点
2. 调用外部系统的 API
3. 如调用失败，可记录到日志或触发告警

### 场景 4：流程驳回时通知发起人

订阅 `instance.rejected` 事件，收到事件后：

1. 读取事件中的 `instance` 数据
2. 获取发起人信息
3. 发送驳回通知
