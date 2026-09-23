import { OpenAPIHono } from '@hono/zod-openapi';
import { cmsEditorialContract } from '@zenith/shared/cms';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { addCmsEditorialNote, checkCmsWorkingQuality, createCmsTranslation, getCmsEditorialMetrics, listCmsEditorialNotes, listCmsTranslations, resolveCmsEditorialNote, getCmsDistributionConflict, resolveCmsDistributionConflict, previewCmsTypeConversion, convertCmsContentType } from '../../services/cms/cms-editorial.service';

const router = new OpenAPIHono({ defaultHook: validationHook });
router.openapiRoutes([
  defineContractRoute(cmsEditorialContract.previewConversion, { handler: async (c) => c.json(okBody(await previewCmsTypeConversion(c.req.valid('param').id, c.req.valid('json'))), 200) }),
  defineContractRoute(cmsEditorialContract.convertType, { handler: async (c) => c.json(okBody(await convertCmsContentType(c.req.valid('param').id, c.req.valid('json'))), 200) }),
  defineContractRoute(cmsEditorialContract.distributionConflict, { handler: async (c) => c.json(okBody(await getCmsDistributionConflict(c.req.valid('param').id)), 200) }),
  defineContractRoute(cmsEditorialContract.resolveDistribution, { handler: async (c) => c.json(okBody(await resolveCmsDistributionConflict(c.req.valid('param').id, c.req.valid('json'))), 200) }),
  defineContractRoute(cmsEditorialContract.metrics, { handler: async (c) => c.json(okBody(await getCmsEditorialMetrics(c.req.valid('query').siteId)), 200) }),
  defineContractRoute(cmsEditorialContract.notes, { handler: async (c) => c.json(okBody(await listCmsEditorialNotes(c.req.valid('param').id)), 200) }),
  defineContractRoute(cmsEditorialContract.addNote, { handler: async (c) => c.json(okBody(await addCmsEditorialNote(c.req.valid('param').id, c.req.valid('json'))), 200) }),
  defineContractRoute(cmsEditorialContract.resolveNote, { handler: async (c) => c.json(okBody(await resolveCmsEditorialNote(c.req.valid('param').id, c.req.valid('param').noteId, c.req.valid('json'))), 200) }),
  defineContractRoute(cmsEditorialContract.quality, { handler: async (c) => c.json(okBody(await checkCmsWorkingQuality(c.req.valid('param').id)), 200) }),
  defineContractRoute(cmsEditorialContract.translations, { handler: async (c) => c.json(okBody(await listCmsTranslations(c.req.valid('param').id)), 200) }),
  defineContractRoute(cmsEditorialContract.createTranslation, { handler: async (c) => c.json(okBody(await createCmsTranslation(c.req.valid('param').id, c.req.valid('json'))), 200) }),
]);
export default router;
