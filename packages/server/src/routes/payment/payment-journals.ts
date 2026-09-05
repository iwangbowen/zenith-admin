import { OpenAPIHono } from '@hono/zod-openapi';
import { paymentJournalContract } from '@zenith/shared/payment';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { idempotencyGuard } from '../../middleware/idempotency';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  captureFundReservation,
  createFundReservation,
  createLedgerAccount,
  getActiveReservationAmount,
  getJournal,
  listFundReservations,
  listJournals,
  listLedgerAccounts,
  postJournal,
  releaseFundReservation,
  reverseJournal,
} from '../../services/payment/payment-journal.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const accountListRoute = defineContractRoute(paymentJournalContract.accounts, {
  middleware: [authMiddleware, guard({ permission: 'payment:ledger:list' })],
  handler: async (c) => c.json(okBody(await listLedgerAccounts(c.req.valid('query'))), 200),
});

const accountCreateRoute = defineContractRoute(paymentJournalContract.createAccount, {
  middleware: [
    authMiddleware,
    idempotencyGuard({ ttlSeconds: 30 }),
    guard({ permission: 'payment:ledger:account:create', audit: { description: '创建支付账本账户', module: '支付中心' } }),
  ],
  handler: async (c) => c.json(okBody(await createLedgerAccount(c.req.valid('json')), '创建成功'), 200),
});

const activeReservationRoute = defineContractRoute(paymentJournalContract.activeReservation, {
  middleware: [authMiddleware, guard({ permission: 'payment:ledger:list' })],
  handler: async (c) => c.json(okBody(await getActiveReservationAmount(c.req.valid('param').id)), 200),
});

const reservationListRoute = defineContractRoute(paymentJournalContract.reservations, {
  middleware: [authMiddleware, guard({ permission: 'payment:ledger:list' })],
  handler: async (c) => c.json(okBody(await listFundReservations(c.req.valid('query'))), 200),
});

const reservationCreateRoute = defineContractRoute(paymentJournalContract.createReservation, {
  middleware: [
    authMiddleware,
    idempotencyGuard({ ttlSeconds: 30 }),
    guard({ permission: 'payment:ledger:reserve', audit: { description: '创建支付资金预占', module: '支付中心' } }),
  ],
  handler: async (c) => c.json(okBody(await createFundReservation(c.req.valid('json')), '预占成功'), 200),
});

const reservationCaptureRoute = defineContractRoute(paymentJournalContract.captureReservation, {
  middleware: [
    authMiddleware,
    idempotencyGuard({ ttlSeconds: 15 }),
    guard({ permission: 'payment:ledger:reserve', audit: { description: '核销支付资金预占', module: '支付中心' } }),
  ],
  handler: async (c) => c.json(okBody(await captureFundReservation(c.req.valid('param').id, c.req.valid('json')), '核销成功'), 200),
});

const reservationReleaseRoute = defineContractRoute(paymentJournalContract.releaseReservation, {
  middleware: [
    authMiddleware,
    idempotencyGuard({ ttlSeconds: 15 }),
    guard({ permission: 'payment:ledger:reserve', audit: { description: '释放支付资金预占', module: '支付中心' } }),
  ],
  handler: async (c) => c.json(okBody(await releaseFundReservation(c.req.valid('param').id, c.req.valid('json')), '释放成功'), 200),
});

const journalListRoute = defineContractRoute(paymentJournalContract.list, {
  middleware: [authMiddleware, guard({ permission: 'payment:ledger:list' })],
  handler: async (c) => c.json(okBody(await listJournals(c.req.valid('query'))), 200),
});

const journalPostRoute = defineContractRoute(paymentJournalContract.post, {
  middleware: [
    authMiddleware,
    idempotencyGuard({ ttlSeconds: 60 }),
    guard({ permission: 'payment:ledger:post', audit: { description: '过账支付资金凭证', module: '支付中心' } }),
  ],
  handler: async (c) => c.json(okBody(await postJournal(c.req.valid('json')), '过账成功'), 200),
});

const journalGetRoute = defineContractRoute(paymentJournalContract.detail, {
  middleware: [authMiddleware, guard({ permission: 'payment:ledger:list' })],
  handler: async (c) => c.json(okBody(await getJournal(c.req.valid('param').id)), 200),
});

const journalReverseRoute = defineContractRoute(paymentJournalContract.reverse, {
  middleware: [
    authMiddleware,
    idempotencyGuard({ ttlSeconds: 30 }),
    guard({ permission: 'payment:ledger:reverse', audit: { description: '冲正支付资金凭证', module: '支付中心' } }),
  ],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await reverseJournal(id, c.req.valid('json').reason), '冲正成功'), 200);
  },
});

router.openapiRoutes([
  accountListRoute,
  accountCreateRoute,
  activeReservationRoute,
  reservationListRoute,
  reservationCreateRoute,
  reservationCaptureRoute,
  reservationReleaseRoute,
  journalListRoute,
  journalPostRoute,
  journalReverseRoute,
  journalGetRoute,
] as const);

export default router;
