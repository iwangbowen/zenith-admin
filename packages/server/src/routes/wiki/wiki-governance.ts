import { OpenAPIHono } from '@hono/zod-openapi';
import { wikiGovernanceContract } from '@zenith/shared/wiki';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { validationHook, okBody } from '../../lib/openapi-schemas';
import {
  archiveGovernanceDocs, importWikiDocs, listGovernanceDocs, listNoResultKeywords,
  remindGovernanceOwners, setGovernanceOwner, setGovernanceReview,
} from '../../services/wiki/governance.service';

const governanceRouter = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'wiki:governance:list' })] as const;

const listRoute = defineContractRoute(wikiGovernanceContract.listDocs, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listGovernanceDocs(c.req.valid('query'))), 200),
});

const noResultRoute = defineContractRoute(wikiGovernanceContract.noResultKeywords, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listNoResultKeywords()), 200),
});

const remindRoute = defineContractRoute(wikiGovernanceContract.remind, {
  middleware: [authMiddleware, guard({
    permission: 'wiki:governance:remind',
    audit: { description: '提醒文档负责人', module: '知识中心' },
  })],
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    const sent = await remindGovernanceOwners(ids);
    return c.json(okBody(null, `已提醒 ${sent} 位负责人`), 200);
  },
});

const archiveRoute = defineContractRoute(wikiGovernanceContract.archive, {
  middleware: [authMiddleware, guard({
    permission: 'wiki:governance:archive',
    audit: { description: '归档文档', module: '知识中心' },
  })],
  handler: async (c) => {
    const { ids, archived } = c.req.valid('json');
    const count = await archiveGovernanceDocs(ids, archived);
    return c.json(okBody(null, `${archived ? '已归档' : '已取消归档'} ${count} 篇`), 200);
  },
});

const ownerRoute = defineContractRoute(wikiGovernanceContract.setOwner, {
  middleware: [authMiddleware, guard({
    permission: 'wiki:governance:edit',
    audit: { description: '指定文档负责人', module: '知识中心' },
  })],
  handler: async (c) => {
    const { ids, ownerId } = c.req.valid('json');
    const count = await setGovernanceOwner(ids, ownerId);
    return c.json(okBody(null, `已为 ${count} 篇文档指定负责人`), 200);
  },
});

const reviewRoute = defineContractRoute(wikiGovernanceContract.setReviewCycle, {
  middleware: [authMiddleware, guard({
    permission: 'wiki:governance:edit',
    audit: { description: '设置文档复审周期', module: '知识中心' },
  })],
  handler: async (c) => {
    const { ids, reviewCycleDays, expireAt } = c.req.valid('json');
    const count = await setGovernanceReview(ids, reviewCycleDays, expireAt);
    return c.json(okBody(null, `已为 ${count} 篇文档设置复审`), 200);
  },
});

const importRoute = defineContractRoute(wikiGovernanceContract.importDocs, {
  middleware: [authMiddleware, guard({
    permission: 'wiki:doc:create',
    audit: { description: '批量导入文档', module: '知识中心' },
  })],
  handler: async (c) => {
    const result = await importWikiDocs(c.req.valid('json'));
    return c.json(okBody(result, `已导入 ${result.importedCount} 篇草稿`), 200);
  },
});

governanceRouter.openapiRoutes([
  listRoute,
  noResultRoute,
  remindRoute,
  archiveRoute,
  ownerRoute,
  reviewRoute,
  importRoute,
] as const);

export default governanceRouter;
