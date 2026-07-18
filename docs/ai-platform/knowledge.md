# 知识库 RAG

「知识库」页菜单路径为 `/ai/knowledge`（权限 `ai:kb:*`）。个人知识库让 AI 回答优先基于你的私有资料，并展示引用溯源。

---

## 文档入库

支持三种入库方式（单知识库分块上限 5000）：

| 方式 | 说明 |
| --- | --- |
| 粘贴纯文本 | 名称 + 正文（最长 50 万字符） |
| 上传 txt / md 文件 | 前端读取文件内容填充表单（≤2MB） |
| URL 网页抓取 | `POST /{id}/documents/import-url`：服务端抓取网页（SSRF 防护、仅 text/html 与 text/*、上限 2MB），极简正文提取（去 script / style / nav 等噪音、块级标签转行、实体解码），名称留空取网页 `<title>`；文档记录 `source_url` |

入库流程：按段落分块（目标 ~500 token / 块，超长段落硬切）→ 可选向量化 → 写入 `ai_kb_chunks`。

## 向量化与 pgvector

- 配置系统参数 `ai_embedding_model` 后，入库时调用系统默认服务商的 `/embeddings` 接口批量向量化，向量存入 `embedding`（real[]）列，知识库记录所用模型快照（`embedding_model`）。
- **pgvector 加速**：迁移时探测 PostgreSQL 是否安装 `vector` 扩展，可用则创建 `ai_kb_chunks.embedding_vec`（无维度 vector 列，兼容任意 embedding 模型）；入库后以 `embedding::vector` 一次性物化。该列不进入 Drizzle schema，读写走原生 SQL；扩展不可用时静默跳过，检索回退 JS 余弦。
- 未配置 embedding 模型时知识库退化为关键词检索。

## 混合检索

检索入口 `retrieveKbContext`（对话挂载 / 智能体绑定时在生成前调用）：

1. **模型一致性校验**：仅当知识库入库所用 embedding 模型与当前 `ai_embedding_model` 配置一致时启用向量路径（更换模型后向量空间不可比，自动降级关键词）。
2. **向量路径**：优先 pgvector SQL 余弦距离（取候选池 top 20），不可用时 JS 余弦全量扫描（维度不匹配的分块跳过）。
3. **混合加权**：综合分数 = 向量相似度 × 0.7 + 关键词命中率 × 0.3，阈值 0.3，取 top 4。
4. **关键词兜底**：向量不可用 / 无命中时按查询词命中率排序。

命中分块以「请优先基于以下知识库内容回答」前缀注入用户消息，并通过 `references` SSE 事件把引用（文档名 / 片段 / 相关度）推给前端展示。

## 对话挂载

- 聊天页头部「知识库」下拉挂载 / 取消挂载（`PUT /api/ai/conversations/{id}/knowledge-base`，校验知识库归属）。
- 智能体可绑定知识库，优先级高于对话挂载。
- 删除知识库时级联删除文档与分块，并解除已挂载对话。

## 接口一览

| 方法 | 路径 | 说明 | 权限 |
| --- | --- | --- | --- |
| `GET` | `/api/ai/knowledge-bases` | 我的知识库列表 | `ai:kb:list` |
| `GET` | `/api/ai/knowledge-bases/available` | 聊天挂载选择器用 | 登录用户 |
| `POST` | `/api/ai/knowledge-bases` | 创建知识库 | `ai:kb:create` |
| `PUT` | `/api/ai/knowledge-bases/{id}` | 更新知识库 | `ai:kb:edit` |
| `DELETE` | `/api/ai/knowledge-bases/{id}` | 删除（级联文档分块） | `ai:kb:delete` |
| `GET` | `/api/ai/knowledge-bases/{id}/documents` | 文档列表 | `ai:kb:list` |
| `POST` | `/api/ai/knowledge-bases/{id}/documents` | 添加文本文档 | `ai:kb:edit` |
| `POST` | `/api/ai/knowledge-bases/{id}/documents/import-url` | URL 网页抓取入库 | `ai:kb:edit` |
| `DELETE` | `/api/ai/knowledge-bases/{id}/documents/{docId}` | 删除文档 | `ai:kb:edit` |

数据表：`ai_knowledge_bases` / `ai_kb_documents` / `ai_kb_chunks`。
