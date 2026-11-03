import { OpenAPIHono } from '@hono/zod-openapi';
import { apiAccessLogContract } from '@zenith/shared/platform';
import { validationHook } from '../../lib/openapi-schemas';
import { getApiAccessLog, listApiAccessLogs } from '../../services/platform/api-access-logs.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

mountCrud(router, apiAccessLogContract, { list: listApiAccessLogs, get: getApiAccessLog });

export default router;

