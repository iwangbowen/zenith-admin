import * as z from 'zod';
import { PAYMENT_RECON_CASE_ACTIONS, PAYMENT_RECON_DIRECTIONS, PAYMENT_RECON_MAX_AMOUNT, PAYMENT_RECON_MAX_FILE_BYTES, PAYMENT_STATEMENT_ENTRY_TYPES, PAYMENT_STATEMENT_IMPORT_FORMATS, PAYMENT_STATEMENT_TYPES } from './constants';

export const reconciliationAmountSchema = z.string().regex(/^(0|[1-9]\d*)$/, '金额须为最小货币单位的非负整数字符串').refine((value) => /^(0|[1-9]\d*)$/.test(value) && BigInt(value) <= BigInt(PAYMENT_RECON_MAX_AMOUNT), '金额超出存储范围');
export const reconciliationPositiveAmountSchema = reconciliationAmountSchema.refine((value) => /^(0|[1-9]\d*)$/.test(value) && BigInt(value) > 0n, '金额必须大于零');
export const reconciliationSignedAmountSchema = z.string().regex(/^-?(0|[1-9]\d*)$/, '金额须为最小货币单位的整数字符串').refine((value) => { if (!/^-?(0|[1-9]\d*)$/.test(value)) return false; const amount = BigInt(value); return amount >= -BigInt(PAYMENT_RECON_MAX_AMOUNT) && amount <= BigInt(PAYMENT_RECON_MAX_AMOUNT); }, '金额超出存储范围');
export const reconciliationBillDateSchema = z.iso.date().meta({ description: '渠道账户时区内的账单日期 YYYY-MM-DD' });
export const reconciliationCurrencySchema = z.string().regex(/^[A-Z]{3}$/, '币种须为三位大写代码');

export const submitPaymentStatementSchema = z.object({
  accountId: z.int().positive(), billDate: reconciliationBillDateSchema,
  type: z.enum(['trade', 'fund']), currency: reconciliationCurrencySchema.default('CNY'),
});

export const importPaymentStatementSchema = z.object({
  accountId: z.int().positive(), billDate: reconciliationBillDateSchema,
  type: z.enum(PAYMENT_STATEMENT_TYPES), currency: reconciliationCurrencySchema.default('CNY'),
  // eslint-disable-next-line no-control-regex
  filename: z.string().min(1).max(255).refine((value) => !/[\\/\u0000-\u001f]/.test(value), '文件名不能包含路径或控制字符'),
  content: z.string().min(1).max(Math.ceil(PAYMENT_RECON_MAX_FILE_BYTES / 3) * 4).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/, '文件内容须为 Base64'),
  format: z.enum(PAYMENT_STATEMENT_IMPORT_FORMATS),
});

/** 受控导入格式，所有金额为整数最小货币单位，不接受金额浮点数。 */
export const paymentStatementImportEntrySchema = z.object({
  entryKey: z.string().min(1).max(256), type: z.enum(PAYMENT_STATEMENT_ENTRY_TYPES),
  merchantOrderNo: z.string().max(128).nullable().optional(), merchantRefundNo: z.string().max(128).nullable().optional(),
  providerTransactionId: z.string().max(128).nullable().optional(), providerRefundId: z.string().max(128).nullable().optional(),
  reference: z.string().max(256).nullable().optional(), currency: reconciliationCurrencySchema,
  amount: reconciliationAmountSchema, direction: z.enum(PAYMENT_RECON_DIRECTIONS), status: z.string().min(1).max(64),
  occurredAt: z.iso.datetime({ offset: true }), applicationId: z.int().positive().nullable().optional(),
  feeAmount: reconciliationSignedAmountSchema.nullable().optional(), netAmount: reconciliationSignedAmountSchema.nullable().optional(),
  balance: reconciliationSignedAmountSchema.nullable().optional(), raw: z.record(z.string(), z.unknown()).optional(),
});
export const paymentStatementImportDocumentSchema = z.object({
  entries: z.array(paymentStatementImportEntrySchema).max(100_000),
  summary: z.record(z.string(), z.unknown()).optional(),
});

export const handlePaymentReconCaseSchema = z.object({
  action: z.enum(PAYMENT_RECON_CASE_ACTIONS), remark: z.string().trim().min(1).max(2000),
  expectedVersion: z.int().positive(), assignedTo: z.int().positive().nullable().optional(),
});
export const createPaymentReconAdjustmentSchema = z.object({
  amount: reconciliationPositiveAmountSchema, direction: z.enum(PAYMENT_RECON_DIRECTIONS),
  applicationId: z.int().positive(), channelConfigId: z.int().positive(), reason: z.string().trim().min(1).max(2000),
});
export const submitPaymentReconAdjustmentSchema = z.object({ definitionId: z.int().positive() });
export const reversePaymentReconAdjustmentSchema = z.object({ reason: z.string().trim().min(1).max(2000) });
export const matchPaymentBankEntriesSchema = z.object({
  accountId: z.int().positive(),
  allocations: z.array(z.object({ bankEntryId: z.int().positive(), settlementEntryId: z.int().positive(), amount: reconciliationPositiveAmountSchema })).min(1).max(200),
});
