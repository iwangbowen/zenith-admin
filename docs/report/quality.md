# 数据质量

数据质量对数据集持续体检：定义规则 → 定时/手动执行 → 产出通过率与评分 → 异常闭环处置。在「报表中心 → 数据质量」（`/report/quality`）管理，页面分四个标签页：**质量规则、数据集评分、质量异常、运行历史**。也可从数据集列表的「**质量详情**」操作带着数据集上下文直达本页。

## 质量规则

每条规则绑定一个数据集，声明检查类型与阈值：

| 规则类型 | 检查内容 |
|----------|----------|
| `not_null` 非空 | 指定字段不允许为空 |
| `uniqueness` 唯一 | 指定字段值不重复 |
| `range` 范围 | 数值落在 [min, max] 区间 |
| `pattern` 格式 | 字段匹配正则表达式 |
| `freshness` 新鲜度 | 时间字段距今不超过给定时长 |
| `row_count` 行数 | 结果行数落在预期区间 |
| `custom_sql` 自定义 SQL | 用受限 SQL 返回「失败行」 |

规则支持**启用/停用**、严重度分级，可配置**执行 Cron**（提供可视化 Cron 构建器）做定时体检，或在列表点「执行」手动跑一次。执行通过**任务中心异步任务**（`report-dq-rule-run`）完成，可在任务托盘查看进度。

### `custom_sql` 受限语法

自定义 SQL 返回“失败行”，只允许如下形态：

```sql
SELECT row FROM dataset WHERE (row->>'amount')::numeric < 0
```

硬性约束：

- 必须且只能有一个 `SELECT`、一个 `FROM`，形态为 `SELECT [alias.]row FROM dataset [alias] [WHERE ...]`；
- 禁止 `WITH`、`JOIN`、`UNION`、`INTERSECT`、`EXCEPT`、`LATERAL`、`VALUES`、`TABLE`，禁止带引号标识符；
- 函数白名单仅为 `abs`、`btrim`、`cast`、`ceil`、`coalesce`、`floor`、`jsonb_array_length`、`jsonb_typeof`、`length`、`lower`、`ltrim`、`nullif`、`replace`、`round`、`rtrim`、`substring`、`trim`、`upper`；
- 服务端在只读事务中执行，超时 5 秒，最多读取/返回 10,000 行。客户端不能传真实表名或 SQL 白名单。

## 数据集评分

每次规则执行会汇入数据集的**质量评分**（按严重度加权的通过率），标签页展示各数据集的当前分值与历史走势，快速定位质量薄弱的数据资产。

## 质量异常

规则失败会产出**异常记录**，状态流转为 `open（待处理）→ acknowledged（已确认）| ignored（已忽略）| resolved（已解决）`。失败样本受行数与字节预算限制，不会保存无限结果。

## 运行历史

每次执行落一条运行记录，状态为 `pending | running | succeeded | failed | cancelled`，包含检查行数、失败行数、耗时与失败样本，便于回溯。

## 权限

| 操作 | 权限码 |
|------|--------|
| 查看规则 / 运行 / 评分 / 异常 | `report:dq:list` |
| 新增规则 | `report:dq:create` |
| 编辑规则 / 启停 / 异常处置 | `report:dq:update` |
| 删除规则 | `report:dq:delete` |
| 执行规则 | `report:dq:run` |
| 导出质量记录 | `report:dq:export` |
