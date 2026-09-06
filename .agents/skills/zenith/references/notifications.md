# 通知中心接入（notify 事件规范）

任何「某件事发生了 → 通知相关的人」都按本文接入通知中心，业务域**禁止**直接调用邮件 / 短信 / 站内信 / Webhook /
聊天卡片的底层发送函数；硬约束（含 ESLint 封禁与豁免清单位置）见 [constraints.md → 通知发送](./constraints.md#通知发送)。

**不属于事件通知、不走本流程的场景**：登录验证码 / 密码重置等事务性发信（`auth.service` / `member-sms`）、
用户在流程画布里显式编排的发信节点（workflow connectors / compensation）、
按订阅配置投递的报表推送与 CMS 表单转发——这些的收件人与内容由各自配置决定，保持直调。

## 架构速览

```text
业务域: notify('wiki.doc.commented', { recipients, vars, ... })
   ↓ 与业务同事务落 notification_outbox（可靠投递：崩溃不丢、回滚不发）
派发层: 事件默认 → 租户/平台覆盖(locked) → 用户偏好 → 全局静音 → 免打扰/摘要延后 → 频控 → 幂等
   ↓ 渠道适配器 fan-out（inapp / email / sms / webhook / chat，失败互不影响）
留痕: notification_dispatches 记录每个「收件人×渠道」的 decision + reasonCode
```

偏好、免打扰、摘要、锁定全部由派发层处理，**业务侧一行都不用写**；
「为什么没收到」查 系统设置 → 通知管理 → 通知策略 → 投递日志。

## Step 1：注册事件（`packages/shared/src/messaging/notification-events.ts`）

事件目录的唯一定义源是这份代码，新增事件**无需迁移、无需种子**：

```ts
'wiki.doc.commented': {                    // key：{域}.{对象}.{动作}，点分小写
  group: 'wiki',                           // 偏好矩阵折叠分组（NOTIFICATION_EVENT_GROUPS）
  label: '文档收到新评论',                    // 矩阵与策略中心展示名
  severity: 'normal',                      // normal | important | critical（critical 自动穿透免打扰）
  defaultChannels: ['inapp'],              // 用户未配置时实际发送的渠道
  availableChannels: ['inapp', 'email'],   // 用户可自行开关的渠道全集；省略 = defaultChannels
  rateLimit: { limit: 10, windowMinutes: 60 },  // 可选：评论/提及类防风暴
  vars: eventVars<{ docId: number; docTitle: string; summary: string }>(),
  title: '知识文档有新评论',                  // {{var}} 占位渲染
  content: '《{{docTitle}}》收到新评论：{{summary}}',
},
```

字段判定：

| 字段 | 何时使用 |
| --- | --- |
| `mandatory: true` | 账号安全 / 告警必达事件（用户不可关闭，矩阵显示锁定）；业务提醒不加 |
| `bypassQuietHours: true` | 待办、催办、告警等不该等到早上的事件；`critical` 已自动穿透 |
| `availableChannels` | 用户可自行开关的渠道全集，只列有投递支撑的渠道——用户勾了却永远收不到，比没有开关更糟 |
| `hidden: true` | 派发层自身触发的元事件（如摘要），不进偏好矩阵 |
| `rateLimit` | 同一收件人可能被短时间轰炸的事件；告警必达事件不要配 |

## Step 2：业务侧调用

```ts
import { notify, notifyWithin } from '../messaging/notification-outbox.service';

// 常规：落库后 setImmediate 异步派发，绝不拖慢业务请求
await notify('wiki.doc.commented', {
  recipients: userIds.map((id) => ({ type: 'user', id })),
  vars: { docId: doc.id, docTitle: doc.title, summary },  // 类型由事件定义约束，缺传编译不过
  tenantId: doc.tenantId ?? null,
  link: `/wiki/docs/${doc.id}`,                            // 站内信深链，点击跳转
  dedupeKey: `wiki-comment:${comment.id}`,                 // 幂等：定时任务/重放场景必传
});

// 事务内：与业务写入原子提交（回滚则不发），提交后由 cron 兜底派发
await db.transaction(async (tx) => {
  const [row] = await tx.insert(...).returning();
  await notifyWithin(tx, 'xxx.yyy.zzz', { ... });
});
```

要点：

- `notify()` 幂等键命中返回 `null`（已入队过），据此决定是否计数
- 收件人三种形态：`{ type: 'user', id }`（管理端用户，参与偏好）、`{ type: 'member', id }`（会员）、
  `{ type: 'external', channel, address }`（告警规则里的裸邮箱 / Webhook URL，无偏好直投；Webhook 地址只能用这一形态）
- 失败处理：调用点通常 `catch` 记日志不阻断业务主流程（参考 `services/wiki/notifications.service.ts`）

## 管理员配置层（可选参数）

配置开关（如流程设置、告警规则的渠道选择）不要自己实现渠道分发，翻译成两个参数：

```ts
await notify('workflow.task.created', {
  ...,
  // 渠道策略：决定「渠道是否开放」，用户偏好在其之后决定「要不要收」
  channelPolicy: { enable: ['email', 'sms'] },   // only=白名单 / enable=追加 / disable=强制关
  // 渠道参数：渠道自身需要的配置
  channelOptions: {
    // 短信按位置映射参数：必须显式传有序变量（依赖事件 vars 会被 jsonb 键序重排打乱）
    sms: { templateId, variables: { title: label, node: task.nodeName } },
    email: { subject: `【待办】${label}`, html },  // html 里插入用户输入必须先经 @zenith/shared/core 的 escapeHtml 转义
    webhook: { url, body },
  },
});
```

告警域（需要把「到底通知到人没有」回写到规则运行态）复用 `lib/alert-dispatch.ts` 的
`dispatchAlertChannels`——它是 notify 之上的同步薄层，返回逐渠道成败摘要；新告警事件同样先注册进事件目录。

## 验收清单

- [ ] 事件已注册且 `label` / 分组在偏好矩阵、策略中心显示正确
- [ ] `npm run lint -w @zenith/server` 通过（未触发直调渠道封禁）
- [ ] 触发一次业务动作：站内信收到、深链可跳转；投递日志出现对应 decision 记录
- [ ] 关闭该事件渠道偏好后再触发：不再送达，日志记 `suppressed / preference_off`
- [ ] 用了 `dedupeKey` 的场景重复触发不产生重复消息
