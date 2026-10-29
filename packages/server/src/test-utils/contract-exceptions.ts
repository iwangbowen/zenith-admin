/** Full-replacement operations whose creation defaults also apply to PUT. */
export const PROTOCOL_OPERATIONS = new Map([
  ['POST /api/oauth2/token', 'RFC 6749 form endpoint with a top-level token response'],
  ['POST /api/oauth2/token/revoke', 'RFC 7009 token revocation endpoint'],
  ['POST /api/oauth2/token/introspect', 'RFC 7662 token introspection endpoint'],
  ['GET /api/oauth2/userinfo', 'OIDC UserInfo claims without a business envelope'],
]);

export const FULL_REPLACE_OPERATIONS = new Map<string, string>([
    ['PUT /api/broadcasts/{id}', '群发活动编辑复用创建 schema，标题 / 内容 / 渠道 / 受众类型必填'],
    ['PUT /api/channels/admin/messages/{id}', '草稿 / 定时消息编辑即整体重写消息内容与投递配置'],
    ['PUT /api/cms/deployment-retention/deployments/{id}/pin', '保留 / 解除重要版本时客户端整体提交标记与原因（原因可为 null），服务端按提交值整字段写入'],
    ['PUT /api/cms/sites/{id}/open-grants', '按 clientId upsert 开放应用授权记录'],
    ['PUT /api/cms/widgets/slots/{slotKey}', '绑定 / 清空主题插槽，siteId 与 widgetId 必填'],
    ['PUT /api/data-mask/fields/{entity}/{field}', '按契约敏感字段 upsert 脱敏策略，每次提交完整策略（类型 / 规则 / 豁免 / 启用）'],
    ['PUT /api/email-config', '单例邮件配置表单整体保存（upsert）'],
    ['PUT /api/marketing/campaigns/{campaignId}/prizes/{prizeId}', '奖品保存与创建共用 schema，名称 / 类型必填'],
    ['PUT /api/notification-policies/overrides', '按 eventKey + channel upsert 渠道覆盖记录'],
    ['PUT /api/system-scheduler/tasks/{name}/config', '任务策略表单整体保存，开关 / 保留策略 / 阈值必填'],
  ]);
