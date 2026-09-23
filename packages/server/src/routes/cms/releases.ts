import { OpenAPIHono } from '@hono/zod-openapi';
import { cmsReleaseContract } from '@zenith/shared/cms';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { activateCmsRelease, buildCmsRelease, cancelCmsRelease, createCmsRelease, getCmsReleaseDetail, listCmsReleases, previewCmsRelease, suppressCmsContent } from '../../services/cms/cms-releases.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });
const routes = [
  defineContractRoute(cmsReleaseContract.preview, { handler: async (c) => { c.header('Cache-Control', 'private, no-store'); return c.json(okBody(await previewCmsRelease(c.req.valid('param').id, c.req.valid('query').path)), 200); } }),
  defineContractRoute(cmsReleaseContract.build, { handler: async (c) => c.json(okBody(await buildCmsRelease(c.req.valid('param').id)), 200) }),
  defineContractRoute(cmsReleaseContract.activate, { handler: async (c) => c.json(okBody(await activateCmsRelease(c.req.valid('param').id, c.req.valid('json').expectedGenerationId)), 200) }),
  defineContractRoute(cmsReleaseContract.rollback, { handler: async (c) => c.json(okBody(await activateCmsRelease(c.req.valid('param').id, c.req.valid('json').expectedGenerationId, true)), 200) }),
  defineContractRoute(cmsReleaseContract.cancel, { handler: async (c) => c.json(okBody(await cancelCmsRelease(c.req.valid('param').id)), 200) }),
  defineContractRoute(cmsReleaseContract.suppress, { handler: async (c) => { await suppressCmsContent(c.req.valid('param').id, c.req.valid('json').reason, true); return c.json(okBody(null), 200); } }),
  defineContractRoute(cmsReleaseContract.unsuppress, { handler: async (c) => { await suppressCmsContent(c.req.valid('param').id, c.req.valid('json').reason, false); return c.json(okBody(null), 200); } }),
] as const;
mountCrud(router, cmsReleaseContract, { list: listCmsReleases, get: getCmsReleaseDetail, create: createCmsRelease }, {}, routes);
export default router;
