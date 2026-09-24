import { OpenAPIHono } from '@hono/zod-openapi';
import { cmsWorkbenchContract } from '@zenith/shared/cms';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { getCmsConfigurationDraftLink, renderCmsWorkbenchPreview } from '../../services/cms/cms-workbench-preview.service';
const router = new OpenAPIHono({ defaultHook: validationHook });
router.openapiRoutes([
  defineContractRoute(cmsWorkbenchContract.preview, { handler: async (c) => { c.header('Cache-Control', 'private, no-store'); return c.json(okBody(await renderCmsWorkbenchPreview(c.req.valid('json'))), 200); } }),
  defineContractRoute(cmsWorkbenchContract.configurationDraft, { handler: async (c) => c.json(okBody(await getCmsConfigurationDraftLink(c.req.valid('query').siteId)), 200) }),
]);
export default router;
