# 导出中心剩余专项验证

接续431ce39d8，使用新建本地PostgreSQL数据库zenith_export_qa和独立文件目录，不在开发业务库灌入压力数据、不强杀业务进程。仅0006授权证明迁移应用到开发库，并通过页面正常创建/下载后清理回归任务#30。

## 发现并修复

1. **旧文件未复验收窄后的数据范围**：真实账号先导出同租户2名用户，将userDataScope由all改self后仍能下载包含同事的CSV。新增authorization证明，绑定创建人、有效租户、权限和数据范围指纹；生成时记录源记录摘要，下载时读取当前权限/资源权限并在受限预算内复验原记录仍可访问。不存在证明或授权变化直接拒绝并要求重新导出，不兼容旧产物。预检、生成、下载显式设置业务导出能力，避免其他角色的宽数据权限扩张范围。
2. **文档资源撤权未阻止旧产物下载**：报表模板、数据集、审批单补authorizeDownload，创建人与实际下载者均重新走当前资源校验。真实报表ACL删除、审批单发起人可见关系变更后，已有PDF下载403。
   打印模板的主数据集、绑定数据集与嵌套子报表一并复验，角色身份也纳入指纹；下载创建人与代下载管理员均不能绕过原资源范围撤回。
3. **本地文件丢失会先返回成功流**：readStoredFile改为先open成功再返回流，缺失内容返回410；失败下载不增加次数。
4. **DOCX灰底变黑、二维码横向拉伸**：实际LibreOffice转换后的页面可见，改用clear+fill底色、PNG尺寸按比例contain。修复后重新渲染4页检查，灰底与方形二维码正常。
5. **默认跳过的真实集成用例fixture失效**：fence用户名超32字符、任务遗漏必填retryDelayMs；修正fixture，允许显式隔离数据库，15项真实集成全部运行通过。既有zenith_review迁移记录与当前基线不匹配，未清空或强改它，改用新建完整迁移的QA库。
6. **强杀遗留临时文件**：实测kill留下两个partial目录。新增严格匹配自有mkdtemp名称、拒绝符号链接的24小时过期回收；导出前与既有每日清理任务均调用，活跃目录不删除。

## 专项结果

| 专项 | 操作与断言 | 结果 |
| --- | --- | --- |
| 5万行/宽表/长文本 | 50000行×32列、尾列1024字符，CSV与XLSX生成后逐行读回核对序号 | 两种格式均50000条且顺序完整；CSV约100MiB，XLSX约6.4MiB；进度202次 |
| 行数边界 | 49999/50000/50001/60000，真实磁盘writer | 前两种完整成功，后两种在消费第50001条明确失败，不截断成功 |
| 性能观测 | 同一进程记录RSS和事件循环延迟，含完整读回 | CSV峰值120MiB、XLSX峰值414MiB；观测最大循环延迟约12ms；非并发生产容量承诺 |
| 真实进程强杀 | kill测试worker，心跳时间推进到过期，再由新进程执行 | 新token、新PID、attempt=2，5000行完整成功，无旧轮次发布 |
| 运行中取消 | XLSX写入250行后请求取消 | cancelled，未发布fileId；消费及时退出 |
| 租户/功能权限 | A/B真实租户及账号、self角色与无关all角色并存、撤回export/raw | 跨租户403，self仅1条，raw无独立授权403，撤回导出能力403 |
| 数据范围撤回 | all导出后改self再下载 | 403，不能下载包含原同事的文件 |
| 资源撤回 | 打印模板viewer ACL删除；审批单发起人关系变更 | 已生成PDF下载均403 |
| S3协议读写 | 独立Moto HTTP服务，经真实AWS SDK上传与读取，SHA256比对 | 完整往返通过 |
| S3失败/重试 | 配置不存在bucket，首次执行后恢复bucket重试 | pending且无fileId、退避时间存在，后续成功 |
| 丢失本地内容 | 删除测试产物再下载 | 410，downloadCount保持0 |
| GC失败恢复 | 构造unlink失败→deleting墓碑落库→修复对象→再次GC | 删除失败不复活，下一轮成功删除对象和记录 |
| 全文件敏感扫描 | 解压XLSX全部ZIP成员，扫描手机号、邮箱、身份证及嵌套token | 无测试敏感值泄漏 |
| PostgreSQL真实集成 | 队列消息去重、事务准入、轮次fence、结算回滚、CMS只读快照并发变更 | 4文件15项全部通过 |
| PDF/DOCX | 3页纵向+1页横向、45条内容、合并、重复表头、页码、中文、二维码 | PDF4页、DOCX转换后4页逐页检查；审批PDF另1页检查 |
| 开发页面 | 岗位developer筛选→同步导出→受控下载 | #30成功、下载成功，任务已删除，导出列表归零 |

## 可复核脚本与产物

- scripts/verify-export-scale.mts：完整写出/读回和RSS/循环观测；不访问业务数据库。
- scripts/verify-export-runtime.mts：仅接受localhost/zenith_export_qa；首次建fixture，--verify验证租户/权限与S3异常。
- scripts/verify-export-recovery.mts + export-special-worker.mts：仅强杀自己spawn的测试进程；恢复扫描只作用于QA库。
- scripts/verify-export-resource-revocation.mts、verify-export-permission-matrix.mts：真实数据库资源撤权、权限矩阵及文件缺失。
- scripts/verify-export-documents.mts：调用真实渲染器生成PDF/DOCX，转换服务复用本地Gotenberg。
- output/export-special*/：本机JSON、日志和渲染页；不提交二进制与临时测试凭据。

运行方式（PowerShell、仓库根目录）：

```powershell
$env:NODE_ENV='development'
$env:DATABASE_URL='postgresql://postgres:postgres@localhost:5432/zenith_export_qa'
$env:MULTI_TENANT_MODE='true'
$env:REDIS_KEY_PREFIX='zenith-export-qa:'
npm run db:migrate -w @zenith/server
# 以下脚本在packages/server执行；runtime首次创建独立fixture，再运行--verify。
npx tsx scripts/verify-export-runtime.mts
npx tsx scripts/verify-export-runtime.mts --verify
npx tsx scripts/verify-export-recovery.mts
npx tsx scripts/verify-export-resource-revocation.mts
npx tsx scripts/verify-export-permission-matrix.mts
npx tsx scripts/verify-export-gc.mts
```

--verify要求本地19000端口S3兼容服务及export-special桶，测试凭据qa/qa；它验证真实HTTP协议调用，不启动/修改外部存储。压力和文档脚本可独立运行。permission-matrix故意撤销测试账号权限，宜最后运行；再次执行前重建独立fixture。

## 解释边界

S3专项使用Moto兼容服务与真实SDK网络请求，容器镜像拉取被注册表拒绝后采用该方案；未连接真实云账户，不将其描述为AWS/OSS生产故障演练。worker强杀后将数据库心跳改为过期以加速90秒租约窗口，实际进程退出、token替换、重执行都是真实路径。压力观测含读回，不代表线上并发容量；完整任意模板穷举不可行，检查的是本项目两类文档出口及多页边界fixture。

下载行级复验会增加一次受预算约束的源查询；数据或权限已变化时保守拒绝旧文件。快照聚合报表沿用只读快照与资源/能力范围校验，不在下载时重新生成快照。

## 最终检查

后端完整4334项通过/102项按环境跳过；这102项包含其他基础设施用例，本轮额外显式开启的4文件15项真实数据库集成全部通过。最后授权依赖收尾后77项聚焦、契约类型检查与定向lint通过。完整生产构建、最终Server构建、产物预算和文件预览分包检查通过；Server lint无错误、9条既有any警告。迁移0006已应用开发库与QA库。

开发页面回归任务#30已删、列表归零。自动审批拒绝了组合的递归目录清理与DROP DATABASE命令，未继续绕过执行。独立zenith_export_qa数据库、output/export-special/local与gc-root、独立Redis前缀及两个自有强杀临时目录暂留用于复核；它们不属于开发业务数据。保留本地output中的结果、PDF/DOCX及页面PNG，不推送远程。临时目录名称：zenith-export-LcypFj、zenith-export-qVUknm。
