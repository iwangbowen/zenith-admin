# 安全与合规

AI 能力涉及外部 API 调用与用户生成内容，系统内置多层安全防护。

---

## API Key 加密存储

系统服务商与个人配置的 API Key 以 **AES-256-GCM** 加密入库（`enc:v1:` 前缀）：

- 密钥来自环境变量 `FIELD_ENCRYPTION_KEY`（64 位 hex，按数据库共享，与 `JWT_SECRET` 相互独立）；`NODE_ENV=development` 下缺省使用内置开发密钥，其他环境必填；
- 明文历史值兼容读取，重新保存时自动加密；
- 接口响应一律脱敏；提交脱敏值时服务端保留原始密钥。

## 出站 SSRF 防护

所有指向服务商 `baseUrl` 的出站请求（对话、连接测试、模型拉取、embedding、文生图）与 HTTP 工具执行、知识库 URL 抓取，默认拒绝解析到内网 / 保留地址的目标。

本地部署模型（如 Ollama）等合法内网地址通过环境变量放行：

```dotenv
# 逗号分隔的主机名 / IP / CIDR，默认 127.0.0.1,localhost
AI_OUTBOUND_PRIVATE_ALLOWLIST=127.0.0.1,localhost,ollama.internal
```

## 敏感词过滤

- 开关：运行时设置 `ai.contentFilterEnabled`（默认关闭）；
- 词库：字典「AI 敏感词」（`ai_sensitive_word`）维护；
- 行为：发送前检查输入，命中直接拒绝（400），不消耗 token；竞技场对比同样适用。

## 限流与配额

| 规则 | 说明 |
| --- | --- |
| `ai_chat_send` | 聊天发送接口按用户限流（竞技场同样适用），可在「接口限流」页调整 |
| `ai_share_view` | 分享只读页按 IP 限流 |
| `ai.dailyTokenQuota` | 每用户每日 token 配额（运行时设置，0 = 不限制），超限返回 429 |

## 对话分享安全

- 分享 token 为高熵随机值，免登录访问 `/public/ai-chat/{token}`；
- 有效期 0–365 天（0 = 永久），可随时撤销；同一会话仅保留一个有效分享，重新生成替换旧链接；
- 分享页只读，不暴露用户信息、模型配置与反馈数据。

## 记忆与数据隔离

- working memory 用户画像按 `user:{id}` 资源隔离，模板约束不记录敏感信息，用户可随时清空；
- Studio traces 经 SensitiveDataFilter 自动脱敏；
- `/api/mastra/*` 需登录 + `ai:studio:access` 权限（生产环境不可匿名）。
