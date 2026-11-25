# Mastra Studio 与可观测性

系统经官方 `@mastra/hono` 适配器挂载 **Mastra 标准 API**（`/api/mastra/*`），Mastra Studio 可直接对接本系统，覆盖 agents / datasets / experiments / scorers / traces / memory 等全部端点。

---

## 挂载与鉴权

- 标准 API 以**懒加载子 app** 形式挂载：首次访问才初始化，零冷启动成本；
- 鉴权：上游系统 authMiddleware + `ai:studio:access` 操作权限门控（绑定「智能体」页面）；
- CORS：`/api/mastra/*` 单独反射 Origin 并允许凭据（Studio 请求携带 credentials）。

| 环境变量 | 说明 |
| --- | --- |
| `MASTRA_STUDIO_ALLOW_ANONYMOUS` | 开发环境免鉴权开关；**生产环境强制失效** |

## 开发与生产部署

| 场景 | 方式 |
| --- | --- |
| 开发 | `npm run dev:studio`（端口 5380 直连后端 3300）；VS Code 提供「Mastra Studio」/「Full Stack + Studio」运行配置 |
| 生产 | `npm run build:studio` 产出同源自适应静态产物；Docker 镜像内置 `/studio` 入口 |

## 可观测性

- **Traces**：对话 / 智能体 / 评测 / 工作流每次执行的完整调用链（模型调用 / 工具 / Memory 操作）落 `mastra` schema，Studio 追踪页可查；SensitiveDataFilter 自动脱敏敏感字段。
- **日志**：Mastra 实例配 PinoLogger 双路分发——控制台保持 info 级干净输出，观测存储收 debug 全量（含 usage tokens 等结构化数据），Studio 日志页展示运行日志。
- 业务侧另有生成调用链 `trace`（检索 / 工具 / LLM 轮次 / failover 耗时）随消息落库，见[运营与治理](./operations.md)。

## 相关文档

- [智能体](./agents.md) — 注册到 Mastra 的业务智能体可在 Studio 调试
- [模型评测](./eval.md) — Datasets / Experiments 在 Studio 同样可见
