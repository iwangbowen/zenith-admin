# 执行留痕

`rule_executions` 是规则中心四类资产的统一执行流水，服务于 trace、审计、命中分析和「谁在调用哪条规则」分析。

## 写入语义

| 资产 | 写入时机 |
| --- | --- |
| 决策表 | 每次运行时、手动、测试求值都写入 |
| 决策流 | 流本身写入一条；未跳过的步骤会以 `refKind=table` 追加步骤留痕 |
| 评分卡 | 每次运行时、手动、测试求值都写入 |
| 名单 | 仅命中时写入，未命中不写入 |

写入通过内存队列批量落盘：批量大小 50，flush 间隔 2 秒。查询执行记录前会先 flush 队列，保证刚发生的求值可见。流水写入是尽力而为，不阻断业务求值热路径。

## 字段语义

| 字段 | 说明 |
| --- | --- |
| `refKind` | `table` / `flow` / `scorecard` / `list` |
| `refId` | 资产行 ID；流步骤表留痕或快照缺失场景可为 `null` |
| `ruleKey` | 资产 key |
| `version` | 求值所用发布版本；名单和无版本场景为 `null` |
| `caller` | 调用方标识 |
| `callerName` | 查询时动态解析出的展示名，表内不落该字段 |
| `bizRef` | 调用方自定义业务关联对象，支持前缀查询 |
| `source` | `runtime` / `manual` / `test` / `open` |
| `matched` | 是否命中 |
| `hitPolicy` | 决策表命中策略；非决策表为 `null` |
| `input` | 求值输入快照 |
| `outputs` | 求值输出 |
| `matchedRowIds` | 命中的决策表行 ID；名单命中时存命中的值 |
| `createdAt` | 创建时间 |

`input` 入队前会深拷贝，避免调用方后续修改对象影响异步写入内容。

## caller 展示名

内置映射来自 `RULE_CALLER_LABELS`：

| caller | 展示名 |
| --- | --- |
| `admin.test` | 后台测试 |
| `admin.evaluate` | 后台求值 |
| `workflow.gateway` | 工作流网关 |
| `workflow.assignee` | 工作流审批人解析 |
| `member.coupon` | 优惠券资格判定 |
| `member.auth` | 会员认证风控 |
| `payment.risk` | 支付风控 |
| `cms.submit` | CMS 提交守卫 |
| `payment.dispute` | 争议智能分流 |

`open.{clientId}` 会按当前页去重后的 `clientId` 查询 OAuth2 应用名，展示为 `open.{应用名}`；应用不存在时展示截断后的 clientId。

## bizRef 约定

`bizRef` 没有全局枚举，由调用方自定语义。已使用的格式包括：

| 前缀 | 示例 | 场景 |
| --- | --- | --- |
| `workflow:` | `workflow:42#gateway_1` | 工作流网关节点 |
| `workflow:` | `workflow:42` | 工作流审批人解析 |
| `payment:` | `payment:order:1001` | 支付风控 |
| `payment:dispute:` | `payment:dispute:DSP001` | 交易投诉智能分流 |
| `member:` | `member:13800000000` | 会员认证或发券 |

执行记录查询中的 `bizRef` 是前缀匹配，适合按一次业务对象串联多条规则执行。

## 查询 API

`GET /api/rules/executions`

权限：`rule:table:list`

查询参数：

| 参数 | 说明 |
| --- | --- |
| `page` / `pageSize` | 分页 |
| `refKind` | `table` / `flow` / `scorecard` / `list` |
| `refId` | 资产行 ID |
| `caller` | 调用方标识，精确匹配 |
| `bizRef` | 业务关联对象前缀 |
| `ruleKey` | 规则 key 关键字 |
| `source` | `runtime` / `manual` / `test` / `open` |
| `matched` | `true` / `false` |
| `dateStart` / `dateEnd` | 时间范围，支持 `YYYY-MM-DD` 或 `YYYY-MM-DD HH:mm:ss` |

页面 `规则中心 / 执行记录` 支持按类型、来源、命中结果和日期范围筛选，并展示 caller、callerName、bizRef、输入、输出和命中行。

## 保留策略

保留策略定义在 `packages\server\src\lib\retention\policies.ts`：

| key | 标题 | 表 | 时间列 | 默认保留 |
| --- | --- | --- | --- | --- |
| `rule_executions` | 规则执行记录 | `rule_executions` | `created_at` | 90 天 |

描述：决策表 / 决策流 / 评分卡 / 名单命中的统一执行流水。
