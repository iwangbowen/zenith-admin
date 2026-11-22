import { OpenAPIHono } from '@hono/zod-openapi';
import { paymentJournalContract } from '@zenith/shared/payment';
import { idempotencyGuard } from '../../middleware/idempotency';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  captureFundReservation,
  createFundReservation,
  createLedgerAccount,
  getActiveReservationAmount,
  getJournal,
  getLedgerAccountBalance,
  listFundReservations,
  listJournals,
  listLedgerAccounts,
  postJournal,
  releaseFundReservation,
  reverseJournal,
} from '../../services/payment/payment-journal.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

const accountListRoute = defineContractRoute(paymentJournalContract.accounts, {
  handler: async (c) => c.json(okBody(await listLedgerAccounts(c.req.valid('query'))), 200),
});

const accountCreateRoute = defineContractRoute(paymentJournalContract.createAccount, {
  middleware: [idempotencyGuard({ ttlSeconds: 30 })],
  handler: async (c) => c.json(okBody(await createLedgerAccount(c.req.valid('json')), '创建成功'), 200),
});

const activeReservationRoute = defineContractRoute(paymentJournalContract.activeReservation, {
  handler: async (c) => c.json(okBody(await getActiveReservationAmount(c.req.valid('param').id)), 200),
});

const accountBalanceRoute = defineContractRoute(paymentJournalContract.accountBalance, {
  handler: async (c) => c.json(okBody(await getLedgerAccountBalance(c.req.valid('param').id)), 200),
});

const reservationListRoute = defineContractRoute(paymentJournalContract.reservations, {
  handler: async (c) => c.json(okBody(await listFundReservations(c.req.valid('query'))), 200),
});

const reservationCreateRoute = defineContractRoute(paymentJournalContract.createReservation, {
  middleware: [idempotencyGuard({ ttlSeconds: 30 })],
  handler: async (c) => c.json(okBody(await createFundReservation(c.req.valid('json')), '预占成功'), 200),
});

const reservationCaptureRoute = defineContractRoute(paymentJournalContract.captureReservation, {
  middleware: [idempotencyGuard({ ttlSeconds: 15 })],
  handler: async (c) => c.json(okBody(await captureFundReservation(c.req.valid('param').id, c.req.valid('json')), '核销成功'), 200),
});

const reservationReleaseRoute = defineContractRoute(paymentJournalContract.releaseReservation, {
  middleware: [idempotencyGuard({ ttlSeconds: 15 })],
  handler: async (c) => c.json(okBody(await releaseFundReservation(c.req.valid('param').id, c.req.valid('json')), '释放成功'), 200),
});
const journalPostRoute = defineContractRoute(paymentJournalContract.post, {
  middleware: [idempotencyGuard({ ttlSeconds: 60 })],
  handler: async (c) => c.json(okBody(await postJournal(c.req.valid('json')), '过账成功'), 200),
});
const journalReverseRoute = defineContractRoute(paymentJournalContract.reverse, {
  middleware: [idempotencyGuard({ ttlSeconds: 30 })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await reverseJournal(id, c.req.valid('json').reason), '冲正成功'), 200);
  },
});

mountCrud(router, paymentJournalContract,
  { list: listJournals, get: getJournal },
  {},
  [
    accountListRoute,
    accountCreateRoute,
    activeReservationRoute,
    accountBalanceRoute,
    reservationListRoute,
    reservationCreateRoute,
    reservationCaptureRoute,
    reservationReleaseRoute,
    journalPostRoute,
    journalReverseRoute,
  ],
);

export default router;
