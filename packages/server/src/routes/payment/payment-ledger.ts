import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { PaginationQuery, validationHook, commonErrorResponses, ok, okPaginated, okBody } from '../../lib/openapi-schemas';
import { PaymentLedgerEntryDTO, PaymentLedgerSummaryDTO } from '../../lib/openapi-dtos';
import { listLedgerEntries, getLedgerSummary } from '../../services/payment/payment-ledger.service';

const router = new OpenAPIHono({ defaultHook: validationHook });
const channelEnum = z.enum(['wechat', 'alipay', 'unionpay']);
const directionEnum = z.enum(['in', 'out']);
const typeEnum = z.enum(['payment', 'refund', 'fee', 'settlement', 'adjust']);

const ledgerQuery = {
  keyword: z.string().optional(),
  direction: directionEnum.optional(),
  type: typeEnum.optional(),
  channel: channelEnum.optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
};

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/entries', tags: ['支付中心-资金台账'], summary: '资金流水列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:ledger:list' })] as const,
    request: { query: PaginationQuery.extend(ledgerQuery) },
    responses: { ...okPaginated(PaymentLedgerEntryDTO, '资金流水'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await listLedgerEntries(c.req.valid('query'))), 200),
});

const summaryRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/summary', tags: ['支付中心-资金台账'], summary: '资金流水汇总（收入/支出/净额）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:ledger:list' })] as const,
    request: { query: z.object(ledgerQuery) },
    responses: { ...ok(PaymentLedgerSummaryDTO, '资金汇总'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await getLedgerSummary(c.req.valid('query'))), 200),
});

router.openapiRoutes([listRoute, summaryRoute] as const);

export default router;
