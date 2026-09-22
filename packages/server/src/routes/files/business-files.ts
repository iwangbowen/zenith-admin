import { OpenAPIHono } from '@hono/zod-openapi';
import { businessFileContract } from '@zenith/shared/platform';
import { setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { listBusinessFiles, removeBusinessFile, type BusinessFileType } from '../../services/files/business-files.service';
import { requireVisibleManagedBusinessFile } from '../../services/files/business-file-access.service';
import { getRestrictedFileForRead } from '../../services/files/files.service';
import { readStoredFile } from '../../lib/file-storage';
import { inlineOrAttachmentDisposition } from '../../lib/content-disposition';
import { parseRangeHeader, rangeContentHeaders, rangeNotSatisfiable, supportsRange } from '../../lib/http-range';
import { formatDateTime } from '../../lib/datetime';

const businessFilesRouter = new OpenAPIHono({ defaultHook: validationHook });

const managedDetailRoute = defineContractRoute(businessFileContract.managedDetail, {
  handler: async (c) => {
    const file = await requireVisibleManagedBusinessFile(c.req.valid('param').fileId);
    return c.json(okBody({ id: file.id, originalName: file.originalName, size: file.size, mimeType: file.mimeType,
      extension: file.extension, createdAt: formatDateTime(file.createdAt),
      url: `${businessFileContract.basePath}/managed/${encodeURIComponent(file.id)}/content` }), 200);
  },
});
const managedContentRoute = defineContractRoute(businessFileContract.managedContent, {
  handler: async (c) => {
    const authorized = await requireVisibleManagedBusinessFile(c.req.valid('param').fileId);
    const { file, storageConfig } = await getRestrictedFileForRead(authorized.id);
    const range = supportsRange(file.provider) ? parseRangeHeader(c.req.header('range'), file.size) : null;
    if (range === 'invalid') return rangeNotSatisfiable(file.size, { 'Cache-Control': 'private, no-store' });
    const stored = await readStoredFile(file, storageConfig, range ?? undefined);
    return new Response(stored.stream, { status: range ? 206 : 200, headers: {
      'Content-Type': stored.contentType, 'Content-Disposition': inlineOrAttachmentDisposition(stored.contentType, stored.fileName),
      'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store', ...rangeContentHeaders(range, file.size),
    } });
  },
});

function assertBusinessType(value: string): BusinessFileType {
  return value as BusinessFileType;
}

const listRoute = defineContractRoute(businessFileContract.list, {
  handler: async (c) => {
    const { businessType, businessId } = c.req.valid('param');
    return c.json(okBody(await listBusinessFiles(assertBusinessType(businessType), businessId)), 200);
  },
});

const removeRoute = defineContractRoute(businessFileContract.remove, {
  handler: async (c) => {
    const { businessType, businessId, fileId } = c.req.valid('param');
    const type = assertBusinessType(businessType);
    const beforeFiles = await listBusinessFiles(type, businessId);
    setAuditBeforeData(c, beforeFiles.find((item) => item.fileId === fileId) ?? { businessType, businessId, fileId });
    await removeBusinessFile(type, businessId, fileId);
    setAuditAfterData(c, { businessType, businessId, fileId, removed: true });
    return c.json(okBody(null, '移除成功'), 200);
  },
});

businessFilesRouter.openapiRoutes([managedDetailRoute, managedContentRoute, listRoute, removeRoute] as const);

export default businessFilesRouter;
