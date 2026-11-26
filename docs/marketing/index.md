# 营销活动

营销能力面向会员运营，提供活动配置、参与规则和活动效果分析。管理端配置与会员侧参与入口由服务端分别提供，活动资格和状态以服务端判断为准。

## 当前能力

| 能力 | 说明 |
| --- | --- |
| 活动管理 | 创建和维护营销活动及其有效期、状态和参与规则 |
| 会员参与 | 会员侧查询可参与活动并提交参与请求 |
| 结果分析 | 查看活动参与情况与渠道分析 |

管理接口位于 `packages/server/src/routes/marketing/marketing-campaigns.ts`，会员侧接口位于 `member-marketing.ts`，渠道分析位于 `channel-analysis.ts`。业务服务位于 `packages/server/src/services/marketing/`，共享契约位于 `packages/shared/src/marketing/`。

## 业务边界

- 活动归属、状态、时间窗口和参与条件由服务端校验，客户端展示结果不能作为资格判定依据。
- 会员请求使用会员认证上下文，不能复用管理端身份。
- 活动涉及批量触达或后台计算时，通过通知中心和任务中心处理投递与执行状态。
- API 路径、输入和响应以共享契约及 `/api/docs` 为准。

相关文档：[会员中心](../member/)、[通知中心](../notification/)、[数据分析](../analytics/)。
