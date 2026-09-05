# 知识库 RAG

知识库页面菜单路径为 `/ai/knowledge`。检索链路基于 Mastra RAG：MDocument 分块 + PgVector 向量检索。

---

## 入库方式

| 方式 | 说明 |
| --- | --- |
| 文本 / 文件 | 直接粘贴文本或导入 txt / md 内容（单文档上限 50 万字） |
| URL 抓取 | 输入网页地址，服务端抓取并提取正文入库（出站请求经 SSRF 防护） |

文档状态流转 `processing → ready / failed`，支持失败重建（`POST /{id}/rebuild` 重新分块向量化）。文档管理表可**查看分块内容**（逐块展示文本与 token 数）。

## 分块与向量化

- 文档经 MDocument 自动分块，分块文本落 `ai_kb_chunks`（含 token 计数）；
- 向量落 `mastra` schema 的 PgVector，**每个知识库独立索引**（`kb_{kbId}`），metadata 随向量存储、检索零回表；
- embedding 模型由运行时设置 `ai.embeddingModel` 指定（配合系统默认服务商端点）。

## 检索与退化

- 配置 embedding 模型时走**向量语义检索**；
- 未配置时自动**退化为关键词检索**（分块内容模糊匹配），功能不中断；
- 检索命中经 SSE `references` 事件注入回答下方的引用溯源（文档名 / 片段 / 相关度），并随 assistant 消息持久化到 `ai_messages.kb_references`。

## 对话挂载

- 聊天输入区选择知识库后，提问先检索知识库，命中内容注入上下文；
- 智能体可绑定知识库，随智能体会话自动生效；
- 知识中心（Wiki）已发布文档会自动同步到 AI 知识库，详见[知识中心](../product/features.md)。

## 接口一览

| 方法 | 路径 | 说明 | 权限 |
| --- | --- | --- | --- |
| `GET` | `/api/ai/knowledge-bases` | 知识库列表 | `ai:kb:list` |
| `POST` | `/api/ai/knowledge-bases` | 创建 | `ai:kb:create` |
| `PUT` | `/api/ai/knowledge-bases/{id}` | 更新 | `ai:kb:edit` |
| `DELETE` | `/api/ai/knowledge-bases/{id}` | 删除 | `ai:kb:delete` |
| `POST` | `/api/ai/knowledge-bases/{id}/documents` | 添加文档 / URL 导入 | `ai:kb:edit` |
| `DELETE` | `/api/ai/knowledge-bases/{id}/documents/{docId}` | 删除文档 | `ai:kb:edit` |
| `POST` | `/api/ai/knowledge-bases/{id}/rebuild` | 重建向量化 | `ai:kb:edit` |
