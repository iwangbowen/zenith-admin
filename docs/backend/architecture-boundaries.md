# 模块边界与改造验收

后端继续采用共享 PostgreSQL 的模块化单体。领域拥有业务规则和状态变更，通用运行库拥有执行机制，bootstrap 显式装配实现；跨域集成依赖领域公开接口。

## 实施阶段

1. 固定基准：保守测试选择、按类型分类的依赖图、静态闭包、初始化环和固定测试集实测。
2. 拆分请求身份、任务访问/查询/监控以及多领域关系 Provider。
3. 将导入导出、监控和业务适配器注册移至显式装配，解除路由加载副作用。
4. 收口权限审批集成和工作流公开接口；迁移后台作业前保持等价的事务持有权保护。
5. 启用边界检查，复跑完整测试和真实浏览器业务流程，按同口径比较基准。

不保留历史数据适配、旧作业双轨或旧实现转发。事务、租户隔离、审批证据、业务幂等与取消语义是目标行为的一部分。

## 基准

静态基准使用 `packages/server/scripts/architecture-benchmark.mjs`，分析 Server、Shared、Analytics SDK，不导入应用、不连接数据库：

```bash
node packages/server/scripts/architecture-benchmark.mjs capture --label candidate --out docs/backend/perf/architecture-candidate.json
node packages/server/scripts/architecture-benchmark.mjs compare --baseline docs/backend/perf/architecture-baseline.json --candidate docs/backend/perf/architecture-candidate.json --out docs/backend/perf/architecture-comparison.json
```

文件移动必须使用 `--moves <json>` 显式提供旧路径到新路径的映射，capture 与 compare 使用同一映射；样本消失或被偷偷替换会失败。基准记录 Node、锁文件指纹、HEAD、源码哈希、文件清单及选择器原因。`architecture-baseline.json` 来自改动前冻结的源码输入，捕获时工作区干净。

类型、静态值、动态值依赖分别报告；测试选择仍保留所有真实依赖。测试计划数量、静态闭包源码字节、循环数量是结构指标，不代表测试耗时或产品性能。

固定测试集实测复用后端测试基准工具：

```bash
npm run test:server:benchmark -- --label boundary-after --suite identity --repeat 3 --out docs/backend/perf/architecture-tests
```

改造前原始产物为同目录的 `boundary-before-*`。先对照文件列表、通过/失败/跳过数与断言范围，再比较三轮中位数、采样 CPU 和单进程峰值 RSS。新增加的正确性测试另行报告。当前测试环境正在运行本地开发服务，实测不是生产负载测试；不得据此宣称接口延迟改善。

## 边界规则

- 请求身份叶子模块只依赖上下文和类型，不访问数据库或权限 Service。
- 通用引擎依赖端口与注册表；具体业务实现由 bootstrap 注册，运行库不反向导入 bootstrap。
- 公开入口按访问策略、查询、命令和监控拆分，避免把全部实现重新汇总进一个入口。
- 领域持有状态写入权；跨域命令可共享显式事务，必要的跨域只读模型应具有精确访问声明。
- HTTP 契约仍以 Shared 为唯一真相；服务端协作接口不泄漏 ORM 行、内部作业表或幂等键结构。
- 可靠作业在业务事务中验证持有权，取消/回收后的旧执行者不得提交业务效果；提交后才唤醒队列和处理外部副作用。

## 验证

架构工具 fixture 验证类型/动态引用、转导出、循环和移动对照。共享上下文、注册装配与执行事务变更执行全量 Server 测试；Shared、Server 类型检查、lint、核心构建和 Web 回归按实际改动执行。真实数据库集成测试须明确记录启用或跳过情况，不能用替身测试宣称已完成事务验证。

浏览器重点覆盖任务列表/访问、对象关联详情、作业监控、导入导出目录及权限审批。前后收益与验证原始结果保存在 `docs/backend/perf/`，长期规范只维护方法与约束。
