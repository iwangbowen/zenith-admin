# IP 访问控制接入与验证

能力与接口语义的唯一规范见 [IP 访问控制](../../../../docs/backend/ip-access.md)。

- 策略在 settings/modules/ip-access.ts，读写与恢复走统一 Settings，不创建配置 CRUD 或独立缓存。
- 前后端、诊断与 Mock 共用 settings/ip-access-policy.ts 的解析和判定，不复制匹配实现。
- 保存和恢复在事务内检查服务端来源 IP，预检不能替代提交校验。平台门禁覆盖配置、历史、诊断与日志。
- 日志字段同步 schema、迁移、契约、页面与 Mock。路径取 safeRequestPath()，复用有界缓冲，禁止热路径逐条写库。
- 按能力规范验证关键场景，完成真实浏览器回归。文档仅维护当前行为。
