# 定时发起

定时规则仅接受标准五段 Cron（分、时、日、月、周）。发起人必须存在、启用且属于流程所在租户；规则创建、启用和手动执行时会提前校验，后台创建实例时会再次校验并与账号停用操作串行。已有实例的回执不受账号后续停用影响，恢复只复用既有实例，不再新建。

页面入口为 `工作流引擎 → 流程管理 → 定时发起`。定时发起按 Cron 表达式由指定发起人自动创建流程实例。

| 配置 | 说明 |
| --- | --- |
| 流程定义 | 必须选择已发布且非 `external` 的流程；业务系统主导流程由业务模块发起 |
| 规则名称 | 定时规则显示名 |
| Cron 表达式 | 调度周期 |
| 时区 | 可选 IANA 时区（如 `America/New_York`），Cron 按该时区计算触发时间；留空使用系统业务时区 |
| 发起人 | 必须存在、启用且属于流程租户，提供发起人组织上下文和审批人解析 |
| 标题模板 | 支持 <code v-pre>{{date}}</code> 和 <code v-pre>{{datetime}}</code>，按计划时间生成；留空使用规则名称 |
| 表单数据 | 固定表单 JSON |
| 状态 | 启用 / 禁用 |

页面支持立即执行一次（手动触发，不影响下次调度时间），操作后提示「已加入执行队列」并打开执行记录。本次入队不代表已成功发起，也不沿用上一周期的成功或失败结果。列表保留规则最近一次执行结果与下次执行时间；执行记录按周期展示计划时间、实际状态、尝试次数、失败原因和生成的审批实例，可查看每次尝试并补发失败、死信或已取消的原周期。

调度由系统任务 `workflow-schedule-tick` 每分钟扫描到期规则驱动。扫描在同一事务中登记 `workflow_jobs` 的 `schedule_launch` 作业并推进计划，以规则 ID 和原计划时间幂等去重，统一 worker 执行并在 `workflow_job_executions` 保留逐次尝试。失败以原周期冻结的标题、表单和发起人按 30 秒起的指数退避重试，总尝试上限为 5 次，随后进入死信，可人工补发；已提交的实例及事件有同事务回执，恢复尝试会复用实例，避免重复创建。

只修改名称、表单、标题、发起人等配置，或提交同值 Cron/时区/状态，不会推迟已到期周期。真正改变 Cron/时区时先登记已经到期的旧周期再重排新计划；扫描从原计划时间递进，并按规则分轮补齐积压周期，每轮最多 20 条、每次扫描最多 100 个周期且有 5 秒时间预算，避免停机后永远追不上新周期或跳过旧周期。未处理的周期保留为到期计划等待下一轮。停用停止未来周期规划，已经登记的周期保留在执行账本中，由作业平台控制取消或补发。定时表单沿用宽松必填语义。

## 配置示例与执行边界

例如为每天 09:00 发起的流程配置 `0 9 * * *`，时区为 `Asia/Shanghai`，指定启用的发起人，标题填写 <code v-pre>每日检查 {{date}}</code>，表单数据填写固定 JSON。Cron 的计算使用规则时区，标题变量通过系统业务时间格式化工具渲染计划时刻。

定时发起使用服务端指定发起人的系统入口，不执行人工发起范围校验；租户、定义发布状态及账号启用状态仍需满足，表单必填使用宽松语义。账号后续停用时，已经创建的实例回执仍可被恢复复用。

## API 与权限

| 方法 | 路径 | 权限 |
| --- | --- | --- |
| `GET` | `/api/workflows/schedules` | `workflow:schedule:list` |
| `POST` | `/api/workflows/schedules` | `workflow:schedule:create` |
| `PUT` | `/api/workflows/schedules/{id}` | `workflow:schedule:edit` |
| `DELETE` | `/api/workflows/schedules/{id}` | `workflow:schedule:delete` |
| `POST` | `/api/workflows/schedules/{id}/run` | `workflow:schedule:edit` |
| `GET` | `/api/workflows/schedules/{id}/runs` | `workflow:schedule:list` |
| `GET` | `/api/workflows/schedules/{id}/runs/{jobId}` | `workflow:schedule:list` |
| `POST` | `/api/workflows/schedules/{id}/runs/{jobId}/retry` | `workflow:schedule:edit` |

执行权、重试与作业状态见[作业执行与恢复](./jobs.md)。[流程自动化](./automations.md)由实例事件驱动，使用 `system.*` / `formData.*` 模板，与定时标题变量分别配置。
