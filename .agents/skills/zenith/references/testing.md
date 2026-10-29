# 后端测试工作流

硬约束见 [constraints.md → 后端测试](./constraints.md#后端测试)。命令、测试层次、领域清单和 CI 的说明见
[后端测试](../../../../docs/backend/testing.md)。

## 选择验证范围

1. 修改前确认业务域、契约、跨域调用和所需基础设施；用 `npm run test:server:affected -- --dry-run --base <commit>` 查看影响计划。
2. 领域内的纯函数、Service 和单路由行为用就近的 `*.test.ts`；涉及跨域交接的断言加入
   `packages/server/src/domain-manifest.json` 对应 `integrationGroups`。
3. 开发反馈用 `npm run test:server:domain -- <domain>`；确认整个变更范围时用
   `npm run test:server:affected -- --base <commit>`。工具选择全量时不要手工缩小结果。
4. 共享基础设施、路由装配、认证授权、租户隔离、测试工具和依赖变更执行 `npm run test:server`；
   变更测试选择器时还要核对 dry-run、实际文件收集和 CI 分片的覆盖。
5. 需要真实数据库的行为按用例声明的环境开关运行，并单独报告启用的集成测试与默认跳过项。

## 新增或调整测试

- 沿用当前领域已有的 fixture 和请求上下文工具。共享 fixture 放 `src/test-utils/`，只收口重复的基础设施准备，
  业务规则和预期结果留在用例内。
- 路由行为测试优先只装配被测 router；领域契约测试复用 `buildDomainContractApp()` 和当前契约断言，
  在加载 App 之前调用 `mockServerInfra()`。不要复制一套精简认证链。
- 域清单的 `paths` 管 Server 文件归属，`shared` 管 Shared 文件归属，`contracts` 在挂载契约来自多个 Shared 域时列出模块。
  新增领域时同时维护路由 loader、生产装配、清单与对应断言。
- 清单的 `dependsOn` 声明允许的跨域生产依赖。引入新的依赖边前确认协作边界，显式登记并运行 `test:server:graph`；
  现有依赖环保持可见，不能从选择器中排除。
- 域内通常就近放测试；跨域组引用的是实际测试文件，支持带替身的边界测试和显式启用的数据库集成测试。
  报告必须说明替身覆盖范围，不能把调用映射单测写成真实履约或端到端验证。
- 端点变化后用 `npm run test:server:domain -- --contract-only <domain> --update` 更新领域路径快照并审查差异；
  完整路径快照仍由 `src/app.contract.test.ts` 维护。不要用更新快照消除认证、权限或数据隔离失败。

## 性能验证

使用 `npm run test:server:benchmark -- --label candidate --suite full,identity,workflow,payment --out output/server-tests`。
同一标签的样本不覆盖；聚焦用例的稳定性比较可加 `--repeat 3`。比较既定版本时传入不可变源码副本
`--server-root <directory> --source-ref <commit>`，复用相同版本的依赖和运行配置。

基础 `identity` profile 用于相同 route / service 用例集合的比较，`domain-identity` profile 用于包含契约和相关组的实际领域反馈。

先确认测试文件清单、通过 / 失败 / 跳过数量和断言范围，再比较墙钟、采样的测试进程 CPU 与单进程峰值 RSS。
基准脚本固定 8 个 fork 上限、文件隔离、关闭磁盘模块缓存并使用完整 PDF 字体，不加载本地 `.env`；不要并行运行其它重型校验。
测试缩小、缓存热度和机器负载变化分别说明。数据留在独立基准产物，长期规范不保存某次运行的前后数字。
