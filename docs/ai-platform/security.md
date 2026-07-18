# 安全与合规

AI 能力涉及外部 API 调用与用户生成内容，系统内置多层安全防护。

---

## API Key 加密存储

系统服务商与个人配置的 API Key 以 **AES-256-GCM** 加密入库（`enc:v1:` 前缀）：

- 密钥来自环境变量 `FIELD_ENCRYPTION_KEY`，未配置时从 `JWT_SECRET` 派生。
- 历史明文数据兼容读取，重新保存时自动加密。
- 接口响应一律脱敏展示；提交脱敏值时服务端保留原始密钥。

## 出站 SSRF 防护

所有指向供应商 `baseUrl` 的出站请求（聊天流、连接测试、模型发现、embedding、图片生成）与 HTTP 工具执行、知识库 URL 抓取，均启用 SSRF 防护，默认拒绝解析到内网 / 保留地址的目标。

本地部署模型（如 Ollama）等合法内网地址通过环境变量放行：

```dotenv
# 逗号分隔的主机名 / IP / CIDR，默认 127.0.0.1,localhost
AI_OUTBOUND_PRIVATE_ALLOWLIST=127.0.0.1,localhost,ollama.internal
```

## 敏感词过滤

- 开关：系统配置 `ai_content_filter_enabled`（默认关闭）。
- 词库：字典「AI 敏感词」（`ai_sensitive_word`）维护。
- 行为：发送消息前检查输入内容，命中直接拒绝（400），不消耗 token。

## 限流与配额

| 规则 | 默认 | 说明 |
| --- | --- | --- |
| `ai_chat_send` | 15 次 / 分钟 | 聊天发送接口按用户限流，可在「限流规则」页调整 |
| `ai_share_view` | — | 分享只读页按 IP 限流 |
| `ai_daily_token_quota` | 0（不限） | 每用户每日 token 配额（系统配置），超限返回 429 |

## 对话分享安全

- 分享 token 为 192-bit 随机值，免登录访问 `/public/ai-chat/{token}`。
- 支持过期时间（永久 / 7 天 / 30 天）与随时撤销。
- 分享页只读，不暴露用户信息与模型配置。

## 审计

- 管理端敏感操作（服务商 / 工具 / 评测集变更、智能体审核等）写入操作日志。
- 「对话审计」页支持跨用户检索全量消息内容（权限 `ai:audit:view`），详见[运营与治理](./operations.md)。
