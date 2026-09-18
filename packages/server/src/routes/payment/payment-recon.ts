import { OpenAPIHono } from '@hono/zod-openapi';
import { paymentReconContract } from '@zenith/shared/payment';
import { defineContractRoute } from '../../lib/contract-route';
import { attachmentDisposition } from '../../lib/content-disposition';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { getReconCase, getReconSummary, getStatement, getStatementPeriod, handleReconCase, listReconAdjustments, listReconCases, listReconRuns, listStatementEntries, listStatementPeriods, listStatements } from '../../services/payment/payment-recon.service';
import { retryStatementPeriod, submitCompensation, submitReconRun, submitStatementDownload, submitStatementImport } from '../../services/payment/payment-recon-tasks';
import { downloadStatementFile } from '../../services/payment/payment-statement-storage.service';
import { matchBankEntries } from '../../services/payment/payment-recon-funds.service';
import { createReconAdjustment, executeReconAdjustment, getReconAdjustmentApprovalDetail, getReconAdjustmentWorkflowContext, previewReconAdjustmentWorkflow, reverseReconAdjustment, submitReconAdjustment } from '../../services/payment/payment-recon-adjustment.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });
const routes = [
  defineContractRoute(paymentReconContract.submit, { handler: async (c) => c.json(okBody(await submitStatementDownload(c.req.valid('json'))), 200) }),
  defineContractRoute(paymentReconContract.retry, { handler: async (c) => c.json(okBody(await retryStatementPeriod(c.req.valid('param').id)), 200) }),
  defineContractRoute(paymentReconContract.importBill, { handler: async (c) => c.json(okBody(await submitStatementImport(c.req.valid('json'))), 200) }),
  defineContractRoute(paymentReconContract.statements, { handler: async (c) => c.json(okBody(await listStatements(c.req.valid('param').id)), 200) }),
  defineContractRoute(paymentReconContract.statement, { handler: async (c) => c.json(okBody(await getStatement(c.req.valid('param').id)), 200) }),
  defineContractRoute(paymentReconContract.entries, { handler: async (c) => c.json(okBody(await listStatementEntries(c.req.valid('param').id, c.req.valid('query'))), 200) }),
  defineContractRoute(paymentReconContract.download, { handler: async (c) => {
    const { file, bytes } = await downloadStatementFile(c.req.valid('param').id);
    c.header('Content-Type', file.mimeType);
    c.header('Content-Disposition', attachmentDisposition(file.filename));
    c.header('Cache-Control', 'private, no-store');
    c.header('X-Content-Type-Options', 'nosniff');
    return c.body(new Uint8Array(bytes));
  } }),
  defineContractRoute(paymentReconContract.reconcile, { handler: async (c) => c.json(okBody(await submitReconRun(c.req.valid('param').id)), 200) }),
  defineContractRoute(paymentReconContract.runs, { handler: async (c) => c.json(okBody(await listReconRuns(c.req.valid('query'))), 200) }),
  defineContractRoute(paymentReconContract.cases, { handler: async (c) => c.json(okBody(await listReconCases(c.req.valid('query'))), 200) }),
  defineContractRoute(paymentReconContract.caseDetail, { handler: async (c) => c.json(okBody(await getReconCase(c.req.valid('param').id)), 200) }),
  defineContractRoute(paymentReconContract.handleCase, { handler: async (c) => c.json(okBody(await handleReconCase(c.req.valid('param').id, c.req.valid('json'))), 200) }),
  defineContractRoute(paymentReconContract.compensate, { handler: async (c) => c.json(okBody(await submitCompensation(c.req.valid('param').id)), 200) }),
  defineContractRoute(paymentReconContract.adjustments, { handler: async (c) => c.json(okBody(await listReconAdjustments(c.req.valid('query'))), 200) }),
  defineContractRoute(paymentReconContract.createAdjustment, { handler: async (c) => c.json(okBody(await createReconAdjustment(c.req.valid('param').id, c.req.valid('json'))), 200) }),
  defineContractRoute(paymentReconContract.submitAdjustment, { handler: async (c) => c.json(okBody(await submitReconAdjustment(c.req.valid('param').id, c.req.valid('json'))), 200) }),
  defineContractRoute(paymentReconContract.executeAdjustment, { handler: async (c) => c.json(okBody(await executeReconAdjustment(c.req.valid('param').id)), 200) }),
  defineContractRoute(paymentReconContract.reverseAdjustment, { handler: async (c) => c.json(okBody(await reverseReconAdjustment(c.req.valid('param').id, c.req.valid('json'))), 200) }),
  defineContractRoute(paymentReconContract.workflowPreview, { handler: async (c) => c.json(okBody(await previewReconAdjustmentWorkflow(c.req.valid('param').id, c.req.valid('json'))), 200) }),
  defineContractRoute(paymentReconContract.workflowContext, { handler: async (c) => c.json(okBody(await getReconAdjustmentWorkflowContext(c.req.valid('param').id, c.req.valid('query').instanceId)), 200) }),
  defineContractRoute(paymentReconContract.approvalDetail, { handler: async (c) => c.json(okBody(await getReconAdjustmentApprovalDetail(c.req.valid('param').id, c.req.valid('query').instanceId)), 200) }),
  defineContractRoute(paymentReconContract.matchBank, { handler: async (c) => c.json(okBody(await matchBankEntries(c.req.valid('json'))), 200) }),
  defineContractRoute(paymentReconContract.summary, { handler: async (c) => c.json(okBody(await getReconSummary(c.req.valid('query'))), 200) }),
];
mountCrud(router, paymentReconContract, { list: listStatementPeriods, get: getStatementPeriod }, {}, routes);
export default router;
