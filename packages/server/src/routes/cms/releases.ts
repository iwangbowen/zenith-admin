import { OpenAPIHono } from '@hono/zod-openapi';
import { cmsReleaseContract } from '@zenith/shared/cms';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { activateCmsRelease, buildCmsRelease, cancelCmsRelease, createCmsRelease, getCmsReleaseDetail, listCmsReleases, suppressCmsContent } from '../../services/cms/cms-releases.service';

const router = new OpenAPIHono({ defaultHook: validationHook });
const routes = [
  defineContractRoute(cmsReleaseContract.list, { handler: async (c) => c.json(okBody(await listCmsReleases(c.req.valid('query'))), 200) }),
  defineContractRoute(cmsReleaseContract.detail, { handler: async (c) => c.json(okBody(await getCmsReleaseDetail(c.req.valid('param').id)), 200) }),
  defineContractRoute(cmsReleaseContract.create, { handler: async (c) => c.json(okBody(await createCmsRelease(c.req.valid('json'))), 200) }),
  defineContractRoute(cmsReleaseContract.build, { handler: async (c) => c.json(okBody(await buildCmsRelease(c.req.valid('param').id)), 200) }),
  defineContractRoute(cmsReleaseContract.activate, { handler: async (c) => c.json(okBody(await activateCmsRelease(c.req.valid('param').id, c.req.valid('json').expectedGenerationId)), 200) }),
  defineContractRoute(cmsReleaseContract.rollback, { handler: async (c) => c.json(okBody(await activateCmsRelease(c.req.valid('param').id, c.req.valid('json').expectedGenerationId, true)), 200) }),
  defineContractRoute(cmsReleaseContract.cancel, { handler: async (c) => c.json(okBody(await cancelCmsRelease(c.req.valid('param').id)), 200) }),
  defineContractRoute(cmsReleaseContract.suppress, { handler: async (c) => { await suppressCmsContent(c.req.valid('param').id, c.req.valid('json').reason, true); return c.json(okBody(null), 200); } }),
  defineContractRoute(cmsReleaseContract.unsuppress, { handler: async (c) => { await suppressCmsContent(c.req.valid('param').id, c.req.valid('json').reason, false); return c.json(okBody(null), 200); } }),
] as const;
router.openapiRoutes(routes);
export default router;
