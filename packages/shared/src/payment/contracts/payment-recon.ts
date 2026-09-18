import * as z from 'zod';
import { auditFieldsSchema, dateRangeBound, idParam, idQuery, paginated, paginationQuery, queryEnum } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { asyncTaskSchema } from '../../tasks/contracts/async-tasks';
import { workflowBusinessApprovalQuery, workflowBusinessContextQuery, workflowBusinessContextSchema, workflowBusinessPreviewSchema } from '../../workflow/contracts/business';
import {
  PAYMENT_CHANNELS, PAYMENT_RECON_ADJUSTMENT_STATUSES, PAYMENT_RECON_ADJUSTMENT_STATUS_OPTIONS,
  PAYMENT_RECON_CASE_STATUSES, PAYMENT_RECON_CASE_STATUS_OPTIONS, PAYMENT_RECON_CASE_TYPES, PAYMENT_RECON_CASE_TYPE_OPTIONS,
  PAYMENT_RECON_DIRECTIONS, PAYMENT_RECON_RUN_STATUSES, PAYMENT_RECON_RUN_STATUS_OPTIONS,
  PAYMENT_STATEMENT_ENTRY_TYPES, PAYMENT_STATEMENT_ENTRY_TYPE_OPTIONS, PAYMENT_STATEMENT_PERIOD_STATUSES,
  PAYMENT_STATEMENT_PERIOD_STATUS_OPTIONS, PAYMENT_STATEMENT_SOURCES, PAYMENT_STATEMENT_STATUSES,
  PAYMENT_STATEMENT_TYPES, PAYMENT_STATEMENT_TYPE_OPTIONS,
} from '../constants';
import {
  createPaymentReconAdjustmentSchema, handlePaymentReconCaseSchema, importPaymentStatementSchema,
  matchPaymentBankEntriesSchema, reconciliationAmountSchema, reconciliationSignedAmountSchema,
  reversePaymentReconAdjustmentSchema, submitPaymentReconAdjustmentSchema, submitPaymentStatementSchema,
} from '../reconciliation-validation';

const evidenceSchema = z.record(z.string(), z.unknown());
const entityFields = { id: z.int(), tenantId: z.int().nullable(), createdAt: z.string(), updatedAt: z.string(), ...auditFieldsSchema };

export const paymentStatementPeriodSchema = z.object({
  ...entityFields,
  accountId: z.int(), billDate: z.string(), type: z.enum(PAYMENT_STATEMENT_TYPES), currency: z.string(),
  status: z.enum(PAYMENT_STATEMENT_PERIOD_STATUSES), nextAttemptAt: z.string().nullable(), deadlineAt: z.string().nullable(),
  lastError: z.string().nullable(), currentStatementId: z.int().nullable(), taskId: z.int().nullable(), generation: z.int(), completedAt: z.string().nullable(),
}).meta({ id: 'PaymentStatementPeriod' });
export type PaymentStatementPeriod = z.infer<typeof paymentStatementPeriodSchema>;

export const paymentStatementSchema = z.object({
  ...entityFields,
  periodId: z.int(), version: z.int(), source: z.enum(PAYMENT_STATEMENT_SOURCES), contentHash: z.string(),
  parserVersion: z.string(), status: z.enum(PAYMENT_STATEMENT_STATUSES), summary: evidenceSchema, verification: evidenceSchema,
}).meta({ id: 'PaymentStatement' });
export type PaymentStatement = z.infer<typeof paymentStatementSchema>;

/** 下载地址只经授权接口提供，不向浏览器暴露存储凭据或物理路径。 */
export const paymentStatementFileSchema = z.object({
  id: z.int(), statementId: z.int(), filename: z.string(), mimeType: z.string(), sha256: z.string(),
  providerHash: z.string().nullable(), byteLength: z.int(), createdAt: z.string(),
}).meta({ id: 'PaymentStatementFile' });
export type PaymentStatementFile = z.infer<typeof paymentStatementFileSchema>;
export const paymentStatementDetailSchema = paymentStatementSchema.extend({ files: z.array(paymentStatementFileSchema) }).meta({ id: 'PaymentStatementDetail' });
export type PaymentStatementDetail = z.infer<typeof paymentStatementDetailSchema>;

export const paymentStatementEntrySchema = z.object({
  id: z.int(), statementId: z.int(), entryKey: z.string(), type: z.enum(PAYMENT_STATEMENT_ENTRY_TYPES),
  merchantOrderNo: z.string().nullable(), merchantRefundNo: z.string().nullable(),
  providerTransactionId: z.string().nullable(), providerRefundId: z.string().nullable(), reference: z.string().nullable(),
  currency: z.string(), amount: reconciliationAmountSchema, direction: z.enum(PAYMENT_RECON_DIRECTIONS), status: z.string(),
  occurredAt: z.string(), applicationId: z.int().nullable(), raw: evidenceSchema, lineNo: z.int(),
  feeAmount: reconciliationSignedAmountSchema.nullable(), netAmount: reconciliationSignedAmountSchema.nullable(), balance: reconciliationSignedAmountSchema.nullable(),
  createdAt: z.string(), tenantId: z.int().nullable(),
}).meta({ id: 'PaymentStatementEntry' });
export type PaymentStatementEntry = z.infer<typeof paymentStatementEntrySchema>;

export const paymentReconRunSchema = z.object({
  ...entityFields,
  statementId: z.int(), ruleVersion: z.string(), status: z.enum(PAYMENT_RECON_RUN_STATUSES),
  matchedCount: z.int(), diffCount: z.int(), totalCount: z.int(), taskId: z.int().nullable(),
  startedAt: z.string().nullable(), finishedAt: z.string().nullable(), error: z.string().nullable(),
}).meta({ id: 'PaymentReconRun' });
export type PaymentReconRun = z.infer<typeof paymentReconRunSchema>;

export const paymentReconCaseSchema = z.object({
  ...entityFields,
  accountId: z.int(), periodId: z.int(), caseKey: z.string(), entryKey: z.string(), type: z.enum(PAYMENT_RECON_CASE_TYPES),
  stage: z.enum(PAYMENT_STATEMENT_TYPES), status: z.enum(PAYMENT_RECON_CASE_STATUSES), version: z.int(), lastRunId: z.int(),
  applicationId: z.int().nullable(), orderId: z.int().nullable(), refundId: z.int().nullable(),
  localAmount: reconciliationSignedAmountSchema.nullable(), channelAmount: reconciliationSignedAmountSchema.nullable(), currency: z.string(),
  evidence: evidenceSchema, assignedTo: z.int().nullable(), dueAt: z.string().nullable(), resolution: z.string().nullable(),
}).meta({ id: 'PaymentReconCase' });
export type PaymentReconCase = z.infer<typeof paymentReconCaseSchema>;

export const paymentReconCaseEventSchema = z.object({
  id: z.int(), caseId: z.int(), action: z.string(), actorId: z.int().nullable(), remark: z.string().nullable(),
  before: evidenceSchema.nullable(), after: evidenceSchema.nullable(), createdAt: z.string(), tenantId: z.int().nullable(),
}).meta({ id: 'PaymentReconCaseEvent' });
export type PaymentReconCaseEvent = z.infer<typeof paymentReconCaseEventSchema>;

export const paymentReconAdjustmentSchema = z.object({
  ...entityFields,
  caseId: z.int(), caseVersion: z.int(), applicationId: z.int(), channelConfigId: z.int(), amount: reconciliationAmountSchema,
  direction: z.enum(PAYMENT_RECON_DIRECTIONS), reason: z.string(), evidence: evidenceSchema,
  status: z.enum(PAYMENT_RECON_ADJUSTMENT_STATUSES), workflowInstanceId: z.int().nullable(), journalId: z.int().nullable(), reversalOfId: z.int().nullable(),
  applicantId: z.int(), approverId: z.int().nullable(), approvedAt: z.string().nullable(), executedAt: z.string().nullable(),
}).meta({ id: 'PaymentReconAdjustment' });
export type PaymentReconAdjustment = z.infer<typeof paymentReconAdjustmentSchema>;
export const paymentReconCaseDetailSchema = paymentReconCaseSchema.extend({
  events: z.array(paymentReconCaseEventSchema), adjustments: z.array(paymentReconAdjustmentSchema),
}).meta({ id: 'PaymentReconCaseDetail' });
export type PaymentReconCaseDetail = z.infer<typeof paymentReconCaseDetailSchema>;

export const paymentBankMatchSchema = z.object({
  ...entityFields,
  accountId: z.int(), bankEntryId: z.int(), settlementEntryId: z.int(), amount: reconciliationAmountSchema,
}).meta({ id: 'PaymentBankMatch' });
export type PaymentBankMatch = z.infer<typeof paymentBankMatchSchema>;

export const paymentReconSummarySchema = z.object({
  activeRuns: z.int(), runRevision: z.string(),
  expectedPeriods: z.int(), waitingPeriods: z.int(), readyPeriods: z.int(), failedPeriods: z.int(),
  openCases: z.int(), suspendedCases: z.int(), overdueCases: z.int(), pendingAdjustments: z.int(),
  unmatchedBankEntries: z.int(), unmatchedSettlementEntries: z.int(),
  differenceAmounts: z.array(z.object({ currency: z.string(), amount: reconciliationSignedAmountSchema })),
}).meta({ id: 'PaymentReconSummary' });
export type PaymentReconSummary = z.infer<typeof paymentReconSummarySchema>;

export const paymentStatementPeriodListQuery = paginationQuery.extend({
  accountId: idQuery('渠道账户'), channel: queryEnum(PAYMENT_CHANNELS),
  status: queryEnum(PAYMENT_STATEMENT_PERIOD_STATUSES, { options: PAYMENT_STATEMENT_PERIOD_STATUS_OPTIONS }),
  type: queryEnum(PAYMENT_STATEMENT_TYPES, { options: PAYMENT_STATEMENT_TYPE_OPTIONS }), billDate: dateRangeBound('账单日期'),
});
export const paymentStatementEntryListQuery = paginationQuery.extend({
  type: queryEnum(PAYMENT_STATEMENT_ENTRY_TYPES, { options: PAYMENT_STATEMENT_ENTRY_TYPE_OPTIONS }), applicationId: idQuery('支付应用'),
});
export const paymentReconRunListQuery = paginationQuery.extend({
  statementId: idQuery('账单'), accountId: idQuery('渠道账户'), status: queryEnum(PAYMENT_RECON_RUN_STATUSES, { options: PAYMENT_RECON_RUN_STATUS_OPTIONS }),
});
export const paymentReconCaseListQuery = paginationQuery.extend({
  accountId: idQuery('渠道账户'), periodId: idQuery('账期'), assignedTo: idQuery('责任人'), applicationId: idQuery('支付应用'),
  type: queryEnum(PAYMENT_RECON_CASE_TYPES, { options: PAYMENT_RECON_CASE_TYPE_OPTIONS }),
  stage: queryEnum(PAYMENT_STATEMENT_TYPES, { options: PAYMENT_STATEMENT_TYPE_OPTIONS }),
  status: queryEnum(PAYMENT_RECON_CASE_STATUSES, { options: PAYMENT_RECON_CASE_STATUS_OPTIONS }),
});
export const paymentReconAdjustmentListQuery = paginationQuery.extend({
  caseId: idQuery('差异案件'), status: queryEnum(PAYMENT_RECON_ADJUSTMENT_STATUSES, { options: PAYMENT_RECON_ADJUSTMENT_STATUS_OPTIONS }),
});

export const paymentReconContract = defineContract('/api/payment/recon', {
  list: op.get('/periods', { access: { permission: 'payment:recon:list' }, query: paymentStatementPeriodListQuery, response: paginated(paymentStatementPeriodSchema), summary: '渠道账户账期列表' }),
  detail: op.get('/periods/{id}', { access: { permission: 'payment:recon:list' }, params: idParam, response: paymentStatementPeriodSchema, summary: '账期详情' }),
  submit: op.post('/periods', { access: { permission: 'payment:recon:create' }, audit: '申请下载渠道账单', body: submitPaymentStatementSchema, response: asyncTaskSchema, summary: '提交渠道账单下载任务' }),
  retry: op.post('/periods/{id}/retry', { access: { permission: 'payment:recon:create' }, audit: '补跑支付账期', params: idParam, response: asyncTaskSchema, summary: '重新获取账单并核对' }),
  importBill: op.post('/imports', { access: { permission: 'payment:recon:import' }, audit: { description: '导入渠道或银行原始账单', recordBody: false }, body: importPaymentStatementSchema, response: asyncTaskSchema, summary: '归档并解析人工上传账单' }),
  statements: op.get('/periods/{id}/statements', { access: { permission: 'payment:recon:list' }, params: idParam, response: z.array(paymentStatementSchema), summary: '账期全部账单版本' }),
  statement: op.get('/statements/{id}', { access: { permission: 'payment:recon:list' }, params: idParam, response: paymentStatementDetailSchema, summary: '账单证据详情' }),
  entries: op.get('/statements/{id}/entries', { access: { permission: 'payment:recon:list' }, params: idParam, query: paymentStatementEntryListQuery, response: paginated(paymentStatementEntrySchema), summary: '标准化账单明细' }),
  download: op.get('/files/{id}', { access: { permission: 'payment:recon:download' }, audit: '下载支付账单原件', params: idParam, kind: 'file', summary: '下载归档原件并留存访问审计' }),
  reconcile: op.post('/statements/{id}/reconcile', { access: { permission: 'payment:recon:create' }, audit: '重新核对支付账单', params: idParam, response: asyncTaskSchema, summary: '冻结事实快照并提交核对任务' }),
  runs: op.get('/runs', { access: { permission: 'payment:recon:list' }, query: paymentReconRunListQuery, response: paginated(paymentReconRunSchema), summary: '核对运行历史' }),
  cases: op.get('/cases', { access: { permission: 'payment:recon:list' }, query: paymentReconCaseListQuery, response: paginated(paymentReconCaseSchema), summary: '差异案件列表' }),
  caseDetail: op.get('/cases/{id}', { access: { permission: 'payment:recon:list' }, params: idParam, response: paymentReconCaseDetailSchema, summary: '差异案件与追加处理历史' }),
  handleCase: op.patch('/cases/{id}', { access: { permission: 'payment:recon:handle' }, audit: '处理支付对账案件', params: idParam, body: handlePaymentReconCaseSchema, response: paymentReconCaseSchema, summary: '调查、挂账、忽略或重新打开差异案件' }),
  compensate: op.post('/cases/{id}/compensate', { access: { permission: 'payment:recon:compensate' }, audit: '查单补偿支付差异', params: idParam, response: asyncTaskSchema, summary: '渠道查单后通过原支付链路安全补偿' }),
  adjustments: op.get('/adjustments', { access: { permission: 'payment:recon:list' }, query: paymentReconAdjustmentListQuery, response: paginated(paymentReconAdjustmentSchema), summary: '审批调整单列表' }),
  createAdjustment: op.post('/cases/{id}/adjustments', { access: { permission: 'payment:recon:adjust' }, audit: '创建支付对账调整单', params: idParam, body: createPaymentReconAdjustmentSchema, response: paymentReconAdjustmentSchema, summary: '冻结案件证据并创建调整草稿' }),
  submitAdjustment: op.post('/adjustments/{id}/submit', { access: { permission: 'payment:recon:adjust' }, audit: '提交支付调账审批', params: idParam, body: submitPaymentReconAdjustmentSchema, response: paymentReconAdjustmentSchema, summary: '发起独立审批并冻结调整内容' }),
  executeAdjustment: op.post('/adjustments/{id}/execute', { access: { permission: 'payment:recon:execute' }, audit: '执行已审批支付调整', params: idParam, response: paymentReconAdjustmentSchema, summary: '复核差异版本并原子过账双分录凭证' }),
  reverseAdjustment: op.post('/adjustments/{id}/reverse', { access: { permission: 'payment:recon:adjust' }, audit: '申请冲正支付调整', params: idParam, body: reversePaymentReconAdjustmentSchema, response: paymentReconAdjustmentSchema, summary: '创建关联原调整的冲正审批草稿' }),
  workflowPreview: op.post('/adjustments/{id}/workflow-preview', { access: { permission: 'payment:recon:adjust' }, params: idParam, body: submitPaymentReconAdjustmentSchema, response: workflowBusinessPreviewSchema, summary: '调整单审批链路预览' }),
  workflowContext: op.get('/adjustments/{id}/workflow', { access: 'authenticated', params: idParam, query: workflowBusinessContextQuery, response: workflowBusinessContextSchema, summary: '调整单审批轮次与流程上下文' }),
  approvalDetail: op.get('/adjustments/{id}/approval-detail', { access: 'authenticated', params: idParam, query: workflowBusinessApprovalQuery, response: paymentReconAdjustmentSchema, summary: '指定审批轮次的冻结调整资料' }),
  matchBank: op.post('/bank-matches', { access: { permission: 'payment:recon:bank-match' }, audit: '分配银行到账与渠道结算', body: matchPaymentBankEntriesSchema, response: z.array(paymentBankMatchSchema), summary: '按金额分配银行流水和渠道结算' }),
  summary: op.get('/summary', { access: { permission: 'payment:recon:list' }, query: z.object({ accountId: idQuery('渠道账户') }), response: paymentReconSummarySchema, summary: '对账运营总览与未核验到账' }),
}, { auditModule: '支付中心', tags: ['支付中心-对账'] });
