# 后端测试

Server 测试采用领域验证、跨域测试组和完整应用验证三种范围。`src/app-core.ts` 提供公共中间件、门禁、
错误处理和路由装配；生产入口 `src/app.ts` 装配全部领域，领域测试通过独立 loader 传入所需路由。
每个领域 App 持有自己的 OpenAPI 缓存，生产入口与预热线程使用生产缓存。

开发硬约束以 [Zenith Skill · 后端测试](https://github.com/iwangbowen/zenith-admin/blob/master/.agents/skills/zenith/references/constraints.md#后端测试)
为准；具体执行顺序见 [测试工作流](https://github.com/iwangbowen/zenith-admin/blob/master/.agents/skills/zenith/references/testing.md)。

## 命令

在仓库根目录执行：

```bash
npm run test:server                             # 选择器守卫 + 全量 Server Vitest
npm run test:server:domain -- identity            # 本领域用例 + 相关跨域组 + 领域契约
npm run test:server:domain -- identity workflow   # 多领域，测试文件去重
npm run test:server:domain -- --group payment-member
npm run test:server:domain -- --contract-only identity
npm run test:server:affected -- --base <commit> --dry-run
npm run test:server:affected -- --base <commit>
npm run test:server:graph                        # 选择器、文件收集与分片守卫
```

`test:domain` 是指定开发范围的命令；`test:affected` 才会根据完整 diff 计算反向依赖。需要检查计划的实际文件时，
为 dry-run 增加 `--json`；`--plan-out <path>` 将 JSON 保存在相对仓库根目录的位置。
`--full` 即使没有 Server diff 也执行完整验证。

Windows PowerShell 可用 `cmd /c npm.cmd ...` 执行上述 npm 命令。

## 测试范围

| 范围 | 执行内容 | 入口 |
| --- | --- | --- |
| 领域 | 所选域的 route、service、登记的 lib 用例及相关跨域组；每域一个契约项目 | `test:server:domain` |
| 跨域组 | 清单中引用的具体边界 / 集成用例，重叠文件只执行一次 | `--group <name>` |
| 受影响范围 | 直接域、文件级反向依赖命中的测试、相关跨域组、结构守卫及领域契约 | `test:server:affected` |
| 完整应用 | Server 全部普通测试、完整路由快照和运行时门禁；不重复执行领域契约项目 | `test:server` |

领域契约检查挂载域、JSON 操作声明、逐端点无凭证行为、权限 / 平台 / 审计 / License 门禁、错误响应、
部分更新默认值、参数路由遮蔽、404 包络和领域路径快照。完整应用还验证全部领域的组合、公开端点规模、
全局错误与认证协议、CSRF、完整路径快照和授权功能覆盖。

跨域组可以包含使用替身的边界测试，也可以引用显式启用的数据库集成测试。它是测试选择单位，
并不代表每个用例都连接了真实服务。运行结果需要同时说明用例的替身和基础设施开关。

## 领域清单与依赖图

`packages/server/src/domain-manifest.json` 是测试归属和组定义的入口：

| 字段 | 用途 |
| --- | --- |
| `domains.<name>.paths` | Server 文件归属，包括 routes、services 和登记的领域 lib |
| `domains.<name>.shared` | Shared 子目录归属，允许 `biz` 对应 `biz-demo` 等不同命名 |
| `domains.<name>.contracts` | 可选；路由组合使用的 Shared 契约模块，省略时使用 `shared` |
| `domains.<name>.dependsOn` | 允许的跨域生产依赖；新增依赖边须显式登记并审查 |
| `integrationGroups` | 涉及的领域以及实际测试文件 |
| `structuralTests` | 增量验证必须执行的租户、权限等结构守卫 |
| `fullAppTests` | 完整 App 验证文件 |

`scripts/test-graph.mjs` 用 TypeScript AST 读取 import、export、类型导入、字面量动态导入和 mock 依赖，
生成 Server、Shared、Analytics SDK 的文件图。选择器沿反向边追踪实际使用者，保留聚合模块的依赖关系。
`test:graph` 将实际跨域生产依赖与 `dependsOn` 对账，未声明的新增边会使门禁失败；循环依赖仍完整参与影响闭包。
源码文件夹和清单不匹配时，选择器不会假定它没有影响。

增量选择包括基准提交到 HEAD 的提交差异、暂存区、工作区和未跟踪文件，重命名的两端都参与计算。
根依赖文件、共享基础设施、未分类文件、删除后缺失的节点、无法取得的 Git 比较和超过四分之三测试库存的闭包
均触发完整验证。只有 Web / Docs 等非 Server 依赖改动时，Server 测试阶段可以跳过。

## 新增用例

1. 确认要验证的是纯逻辑、Service、路由协议、跨域交接还是完整应用装配。
2. 在对应模块旁创建 `*.test.ts`。已有领域和 lib 路径由清单自动收集；新的领域、lib 分组或跨域用例补充清单。
3. 复用现有上下文和基础设施 fixture，给出有意义的正常、拒绝和失败结果；涉及状态流转时覆盖重复操作与并发边界。
4. 路由用例只装配被测 router；领域契约复用 `buildDomainContractApp()`。避免让领域测试导入完整应用或全局契约目录。
5. 执行领域命令，并用 affected dry-run 核对完整变更所需的验证范围。

真实数据库用例保留显式环境开关与隔离数据，默认跳过的用例不计入已验证的数据库行为。完整领域契约不替代
真实 Service 的事务、租户隔离和并发测试。

### 路由快照

领域路径库存位于 `src/__snapshots__/domains/`，完整应用库存位于 `src/__snapshots__/app.contract.test.ts.snap`。
有意增加或删除端点时更新并审查相应快照：

```bash
npm run test:server:domain -- --contract-only identity --update
```

更新完整快照可在 `packages/server` 执行 `npx vitest run src/app.contract.test.ts --update`。
快照变更必须与端点变更一致；认证、权限、审计、租户或协议失败需要修复行为。

## CI

PR 先生成受影响计划；`master` push、手动执行和每日 UTC 19:00 的工作流使用完整计划。
计划阶段运行 `test:graph`，随后最多三个 Server 分片并行执行。每个普通测试文件和每个领域契约项目
只分配给一个分片。完整计划包含完整 App 门禁，避免重复装配全部领域契约。

`Server tests (affected / full)` 汇总门禁要求计划与全部所需分片成功；无 Server 影响时允许跳过分片。
Shared / Web 测试、lint、生产构建、bundle 预算和 Demo 启动冒烟继续独立执行。

## 基准采集

```bash
npm run test:server:benchmark -- --label candidate --suite full,identity,workflow,payment --out output/server-tests
npm run test:server:benchmark -- --label repeated --suite identity --repeat 3 --out output/server-tests
npm run test:server:benchmark -- --label feedback --suite domain-identity,domain-workflow,domain-payment --out output/server-tests
```

`identity` 等基础 profile 只收集原域的 route / service 文件，适合比较同一用例集合；
`domain-identity` 等领域 profile 使用当前领域命令的完整范围，包含登记的 lib、跨域组和领域契约。

对比固定版本时，`--server-root <directory> --source-ref <commit>` 指定不可变的 Server 源码副本。
被测版本和候选版本需要相同 Node、依赖锁文件、测试参数及 Shared/SDK 版本。
脚本固定最多 8 个 fork、文件隔离和关闭磁盘模块缓存，不加载本地 `.env`；PDF 用例固定使用源码中的完整字体并记录指纹。

每次采集保留日志、Vitest JSON、资源采样和汇总 JSON，包括文件清单、通过 / 失败 / 跳过数量、源码标识和锁文件指纹。
资源指标为已采样的协调进程与测试进程 CPU 累加，以及其中最大的单进程峰值 RSS；它不是整机内存峰值，
也不包含所有可能启动的外部子进程。可选基础设施的验证结果另行记录。

先比较范围和正确性，再比较耗时。相同用例集用于判断执行开销；affected 与全量的比较用于说明反馈范围的缩小。
重复样本报告中位数与范围，并说明缓存和机器负载；基准运行期间不并行执行 lint、build 或其它重型测试。
