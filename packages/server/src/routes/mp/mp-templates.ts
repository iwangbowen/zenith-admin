import { OpenAPIHono } from '@hono/zod-openapi';
import { mpTemplateContract } from '@zenith/shared/mp';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listMpTemplates, deleteMpTemplate, syncMpTemplates, sendMpTemplate, listMpTemplateSendLogs,
  setMpTemplateIndustry, getMpTemplateIndustry, batchSendMpTemplate, getMpTemplateBeforeAudit, getMpTemplateIndustryBeforeAudit,
} from '../../services/mp/mp-template.service';

const mpTemplatesRouter = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'mp:template:list' })] as const;

async function getTemplateIndustryAuditSafe(accountId: number) {
  try {
    return await getMpTemplateIndustryBeforeAudit(accountId);
  } catch (err) {
    return {
      accountId,
      industry: null,
      auditError: err instanceof Error ? err.message : '获取行业信息失败',
    };
  }
}

const listRoute = defineContractRoute(mpTemplateContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listMpTemplates(c.req.valid('query'))), 200),
});

const logsRoute = defineContractRoute(mpTemplateContract.logs, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listMpTemplateSendLogs(c.req.valid('query'))), 200),
});

const syncRoute = defineContractRoute(mpTemplateContract.sync, {
  middleware: [authMiddleware, guard({ permission: 'mp:template:sync', audit: { description: '同步模板消息', module: '公众号模板消息' } })],
  handler: async (c) => c.json(okBody(await syncMpTemplates(c.req.valid('json').accountId), '同步完成'), 200),
});

const sendRoute = defineContractRoute(mpTemplateContract.send, {
  middleware: [authMiddleware, guard({ permission: 'mp:template:send', audit: { description: '发送模板消息', module: '公众号模板消息' } })],
  handler: async (c) => c.json(okBody(await sendMpTemplate(c.req.valid('json')), '发送成功'), 200),
});

const deleteRoute = defineContractRoute(mpTemplateContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'mp:template:delete', audit: { description: '删除模板', module: '公众号模板消息' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMpTemplateBeforeAudit(id));
    await deleteMpTemplate(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const industryGetRoute = defineContractRoute(mpTemplateContract.industry, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getMpTemplateIndustry(c.req.valid('query').accountId)), 200),
});

const industrySetRoute = defineContractRoute(mpTemplateContract.setIndustry, {
  middleware: [authMiddleware, guard({ permission: 'mp:template:sync', audit: { description: '设置模板行业', module: '公众号模板消息' } })],
  handler: async (c) => {
    const b = c.req.valid('json');
    setAuditBeforeData(c, await getTemplateIndustryAuditSafe(b.accountId));
    await setMpTemplateIndustry(b.accountId, b.industryId1, b.industryId2);
    setAuditAfterData(c, await getTemplateIndustryAuditSafe(b.accountId));
    return c.json(okBody(null, '设置成功'), 200);
  },
});

const batchSendRoute = defineContractRoute(mpTemplateContract.batchSend, {
  middleware: [authMiddleware, guard({ permission: 'mp:template:send', audit: { description: '批量发送模板消息', module: '公众号模板消息' } })],
  handler: async (c) => c.json(okBody(await batchSendMpTemplate(c.req.valid('json')), '已提交批量发送'), 200),
});

mpTemplatesRouter.openapiRoutes([logsRoute, industryGetRoute, industrySetRoute, batchSendRoute, listRoute, syncRoute, sendRoute, deleteRoute] as const);

export default mpTemplatesRouter;
