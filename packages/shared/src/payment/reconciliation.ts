import type * as z from 'zod';
import type { PaymentReconCaseAction, PaymentReconCaseStatus, PaymentReconCaseType, PaymentReconDirection } from './constants';
import { paymentStatementImportEntrySchema } from './reconciliation-validation';

/** 规则版本进入每次运行记录；已发布结果始终可以定位核对算法。 */
export const PAYMENT_RECON_RULE_VERSION = '2.0.0';
export const PAYMENT_RECON_INTERNAL_PARSER_VERSION = 'internal-json/1';
export const PAYMENT_RECON_ADJUSTMENT_BIZ_TYPE = 'payment_recon_adjustment';

/** 金额保持整数最小货币单位；禁止经过浮点数进行比较和累加。 */
export function signedReconciliationAmount(amount: string, direction: PaymentReconDirection): bigint {
  const value = BigInt(amount);
  if (value < 0n) throw new Error('账单金额必须为非负整数');
  return direction === 'out' ? -value : value;
}

export function isUnresolvedReconciliationCase(status: PaymentReconCaseStatus): boolean {
  return status === 'open' || status === 'investigating' || status === 'suspended';
}

/** 案件操作不能承担调账过账；资金变更经独立调整单审批。 */
export function nextReconciliationCaseStatus(status: PaymentReconCaseStatus, action: PaymentReconCaseAction): PaymentReconCaseStatus | null {
  if (action === 'reopen') return status === 'resolved' || status === 'ignored' || status === 'suspended' ? 'open' : null;
  if (!isUnresolvedReconciliationCase(status)) return null;
  if (action === 'investigate') return 'investigating';
  if (action === 'suspend') return 'suspended';
  return 'ignored';
}

/** 精确转为主货币单位，仅用于显示，不改变持久化口径。 */
export function formatReconciliationAmount(amount: string | null | undefined, fractionDigits = 2): string {
  if (amount == null) return '—';
  const integer = BigInt(amount);
  const absolute = (integer < 0n ? -integer : integer).toString().padStart(fractionDigits + 1, '0');
  const sign = integer < 0n ? '-' : '';
  if (fractionDigits === 0) return `${sign}${absolute}`;
  return `${sign}${absolute.slice(0, -fractionDigits)}.${absolute.slice(-fractionDigits)}`;
}

/** 冻结的事实快照复用标准账单形状；仅额外关联本地业务键。 */
export type ReconciliationEntry = z.output<typeof paymentStatementImportEntrySchema> & {
  orderId?: number | null;
  refundId?: number | null;
  accountId?: number | null;
};

export interface ReconciliationDifference {
  caseKey: string;
  entryKey: string;
  type: PaymentReconCaseType;
  currency: string;
  localAmount: string | null;
  channelAmount: string | null;
  local: ReconciliationEntry | null;
  provider: ReconciliationEntry | null;
  evidence: Record<string, unknown>;
}

function identityKeys(entry: ReconciliationEntry): string[] {
  const keys: string[] = [];
  const prefix = entry.type;
  const add = (kind: string, value?: string | null) => { if (value) keys.push(`${prefix}:${kind}:${value}`); };
  if (entry.type === 'payment') {
    add('merchant', entry.merchantOrderNo);
    add('provider', entry.providerTransactionId);
  } else if (entry.type === 'refund') {
    add('merchant', entry.merchantRefundNo);
    add('provider', entry.providerRefundId);
  } else {
    add('reference', entry.reference);
  }
  if (keys.length === 0) keys.push(`${prefix}:entry:${entry.entryKey}`);
  return keys;
}

/** 同一账单重复业务键不得被 Map 覆盖；包括两个 entryKey 指向同一退款号。 */
export function assertUniqueReconciliationEntries(entries: readonly ReconciliationEntry[], source = '账单'): void {
  const entryKeys = new Set<string>();
  const businessKeys = new Set<string>();
  for (const entry of entries) {
    if (entryKeys.has(entry.entryKey)) throw new Error(`${source}存在重复明细键：${entry.entryKey}`);
    entryKeys.add(entry.entryKey);
    for (const key of identityKeys(entry)) {
      if (businessKeys.has(key)) throw new Error(`${source}存在重复业务标识：${key}`);
      businessKeys.add(key);
    }
  }
}

function normalizedStatus(entry: ReconciliationEntry): string {
  const status = entry.status.toLowerCase();
  if (entry.type === 'payment' && ['success', 'paid', 'refunding', 'refunded', 'trade_success', 'trade_finished'].includes(status)) return 'success';
  if (entry.type === 'refund' && ['success', 'refunded', 'refund_success'].includes(status)) return 'success';
  return status;
}

function conflictingIdentity(local: ReconciliationEntry, provider: ReconciliationEntry): boolean {
  if (local.type !== provider.type || local.currency !== provider.currency || local.direction !== provider.direction) return true;
  if (local.accountId != null && provider.accountId != null && local.accountId !== provider.accountId) return true;
  if (local.applicationId != null && provider.applicationId != null && local.applicationId !== provider.applicationId) return true;
  const fields = local.type === 'refund'
    ? ['merchantOrderNo', 'merchantRefundNo', 'providerTransactionId', 'providerRefundId'] as const
    : ['merchantOrderNo', 'providerTransactionId', 'reference'] as const;
  return fields.some((field) => local[field] && provider[field] && local[field] !== provider[field]);
}

/**
 * 金额核对只用 BigInt。成功后的退款状态不会令已发生收款消失；退款有自己的独立身份。
 * 每个业务事实最多产生一个案件；案件键不带差异类型，差异演变仍连接同一案件。
 */
export function reconcileEntries(local: readonly ReconciliationEntry[], provider: readonly ReconciliationEntry[]) {
  assertUniqueReconciliationEntries(local, '本地事实');
  assertUniqueReconciliationEntries(provider, '渠道账单');
  const localByIdentity = new Map<string, ReconciliationEntry>();
  for (const entry of local) for (const key of identityKeys(entry)) localByIdentity.set(key, entry);
  const consumed = new Set<ReconciliationEntry>();
  const differences: ReconciliationDifference[] = [];
  let matchedCount = 0;
  const addDifference = (type: PaymentReconCaseType, localEntry: ReconciliationEntry | null, providerEntry: ReconciliationEntry | null, additional: Record<string, unknown> = {}) => {
    const primary = localEntry ?? providerEntry!;
    const canonicalKey = identityKeys(primary)[0]!;
    differences.push({
      caseKey: canonicalKey,
      entryKey: primary.entryKey,
      type,
      currency: primary.currency,
      localAmount: localEntry ? signedReconciliationAmount(localEntry.amount, localEntry.direction).toString() : null,
      channelAmount: providerEntry ? signedReconciliationAmount(providerEntry.amount, providerEntry.direction).toString() : null,
      local: localEntry,
      provider: providerEntry,
      evidence: { local: localEntry, provider: providerEntry, ...additional },
    });
  };
  for (const providerEntry of provider) {
    const candidates = new Set(identityKeys(providerEntry).map((key) => localByIdentity.get(key)).filter((entry): entry is ReconciliationEntry => Boolean(entry)));
    if (candidates.size > 1) {
      for (const candidate of candidates) consumed.add(candidate);
      addDifference('identity_diff', null, providerEntry, { candidates: [...candidates], reason: '多个业务标识指向不同本地记录' });
      continue;
    }
    const localEntry = [...candidates][0];
    if (!localEntry) {
      addDifference('channel_only', null, providerEntry);
      continue;
    }
    if (consumed.has(localEntry)) throw new Error(`渠道账单多笔记录指向同一本地事实：${localEntry.entryKey}`);
    consumed.add(localEntry);
    if (conflictingIdentity(localEntry, providerEntry)) addDifference('identity_diff', localEntry, providerEntry);
    else if (BigInt(localEntry.amount) !== BigInt(providerEntry.amount)
      || (localEntry.feeAmount != null && providerEntry.feeAmount != null && BigInt(localEntry.feeAmount) !== BigInt(providerEntry.feeAmount))
      || (localEntry.netAmount != null && providerEntry.netAmount != null && BigInt(localEntry.netAmount) !== BigInt(providerEntry.netAmount))) addDifference('amount_diff', localEntry, providerEntry);
    else if (normalizedStatus(localEntry) !== normalizedStatus(providerEntry)) addDifference('status_diff', localEntry, providerEntry);
    else matchedCount += 1;
  }
  for (const localEntry of local) if (!consumed.has(localEntry)) addDifference('local_only', localEntry, null);
  return { matchedCount, totalCount: matchedCount + differences.length, differences };
}

/** 标准 CSV 使用字符串整数金额和带偏移量的 ISO 时间；可直接用作财务导入模板。 */
export const RECONCILIATION_CSV_COLUMNS = [
  'entryKey', 'type', 'merchantOrderNo', 'merchantRefundNo', 'providerTransactionId', 'providerRefundId',
  'reference', 'currency', 'amount', 'direction', 'status', 'occurredAt', 'applicationId', 'feeAmount', 'netAmount', 'balance',
] as const;

/** RFC 4180：支持引号、转义引号、CRLF 与引号内换行，不静默吞掉损坏行。 */
function readCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let afterQuote = false;
  const source = text.replace(/^\uFEFF/, '');
  const appendCell = () => { row.push(cell); cell = ''; afterQuote = false; };
  const appendRow = () => { appendCell(); if (row.some((value) => value.length > 0)) rows.push(row); row = []; };
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]!;
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') { cell += '"'; i += 1; }
        else { quoted = false; afterQuote = true; }
      } else cell += char;
      continue;
    }
    if (char === ',') { appendCell(); continue; }
    if (char === '\r' || char === '\n') {
      if (char === '\r' && source[i + 1] === '\n') i += 1;
      appendRow();
      continue;
    }
    if (afterQuote) throw new Error('CSV 闭合引号后存在非法字符');
    if (char === '"') {
      if (cell.length > 0) throw new Error('CSV 未转义的引号');
      quoted = true;
    } else cell += char;
  }
  if (quoted) throw new Error('CSV 引号未闭合');
  if (cell || row.length || afterQuote) appendRow();
  return rows;
}

export function parseReconciliationCsv(text: string): ReconciliationEntry[] {
  const [header, ...rows] = readCsvRows(text);
  if (!header) throw new Error('账单缺少表头');
  if (new Set(header).size !== header.length) throw new Error('账单表头存在重复列');
  const required = ['entryKey', 'type', 'currency', 'amount', 'direction', 'status', 'occurredAt'];
  for (const key of required) if (!header.includes(key)) throw new Error(`账单缺少必填列：${key}`);
  for (const key of header) if (!(RECONCILIATION_CSV_COLUMNS as readonly string[]).includes(key)) throw new Error(`账单包含未知列：${key}`);
  if (rows.length > 100_000) throw new Error('账单明细不能超过 100000 行');
  const entries = rows.map((values, index) => {
    if (values.length !== header.length) throw new Error(`账单第 ${index + 2} 行列数与表头不一致`);
    const raw = Object.fromEntries(header.map((key, column) => [key, values[column]!]));
    const fields: Record<string, unknown> = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, value === '' && !required.includes(key) ? null : value]));
    if (fields.applicationId != null) {
      if (!/^\d+$/.test(String(fields.applicationId))) throw new Error(`账单第 ${index + 2} 行应用 ID 无效`);
      fields.applicationId = Number(fields.applicationId);
    }
    const parsed = paymentStatementImportEntrySchema.safeParse({ ...fields, raw: { ...raw, lineNo: index + 2 } });
    if (!parsed.success) throw new Error(`账单第 ${index + 2} 行格式错误：${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('；')}`);
    return parsed.data;
  });
  assertUniqueReconciliationEntries(entries);
  return entries;
}

export function serializeReconciliationCsv(entries: readonly ReconciliationEntry[]): string {
  const escape = (value: unknown) => {
    const cell = value == null ? '' : String(value);
    return /[",\r\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;
  };
  return `${RECONCILIATION_CSV_COLUMNS.join(',')}\r\n${entries.map((entry) => RECONCILIATION_CSV_COLUMNS.map((column) => escape(entry[column])).join(',')).join('\r\n')}\r\n`;
}
