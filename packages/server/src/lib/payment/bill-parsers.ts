import type { PaymentChannel } from '@zenith/shared/payment';
import { billArtifact, decodeBillText, unpackBillZip, withBillEvidence } from './bill-io';
import { ProviderBillError, type ProviderBillEntry, type ProviderBillKind, type ProviderBillResult } from './bill-types';

const PARSER_VERSION = '2026-09-18.1';
const invalid = (message: string): never => { throw new ProviderBillError('format', message); };
const integrity = (message: string): never => { throw new ProviderBillError('integrity', message); };

/** No floating-point conversion: 90071992547409.93 yuan remains exact. */
export function billMinorUnits(value: string, allowNegative = false): string {
  const match = /^([+-]?)(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match || (!allowNegative && match[1] === '-')) return invalid(`账单金额格式无效：${value}`);
  const amount = BigInt(match[2]) * 100n + BigInt((match[3] ?? '').padEnd(2, '0'));
  return (match[1] === '-' ? -amount : amount).toString();
}

function integer(value: string): string {
  if (!/^\d+(?:\.0+)?$/.test(value)) return invalid(`账单整数格式无效：${value}`);
  return BigInt(value.split('.')[0]).toString();
}

/** CSV supports escaped quotes and embedded newlines; malformed rows are never silently dropped. */
export function readBillCsv(text: string): Array<{ lineNo: number; cells: string[] }> {
  const rows: Array<{ lineNo: number; cells: string[] }> = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let closed = false;
  let lineNo = 1;
  let rowStart = 1;
  const pushCell = () => { cells.push(cell.trim().replace(/^`/, '').trim()); cell = ''; closed = false; };
  const pushRow = () => { pushCell(); if (cells.some(Boolean)) rows.push({ lineNo: rowStart, cells }); cells = []; };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else { cell += char; if (char === '\n') lineNo++; }
    } else if (char === '"' && !cell.trim()) { quoted = true; cell = ''; }
    else if (char === ',') pushCell();
    else if (char === '\r' || char === '\n') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      pushRow(); lineNo++; rowStart = lineNo;
    } else if (closed && char.trim()) return invalid(`账单第 ${lineNo} 行引号后有非法字符`);
    else cell += char;
  }
  if (quoted) return invalid(`账单第 ${rowStart} 行引号未闭合`);
  if (cell || cells.length) pushRow();
  return rows;
}

function key(value: string): string { return value.replace(/[\s()（）]/g, ''); }
function rowRecord(headers: string[], cells: string[], lineNo: number): Record<string, string> {
  // Provider exports sometimes have one trailing comma on every line.
  if (cells.length === headers.length + 1 && cells.at(-1) === '') cells = cells.slice(0, -1);
  if (cells.length !== headers.length) return invalid(`账单第 ${lineNo} 行列数不符`);
  return Object.fromEntries(headers.map((header, index) => [key(header), cells[index]]));
}
function field(row: Record<string, string>, ...names: string[]): string {
  for (const name of names) { if (row[key(name)] !== undefined) return row[key(name)]; }
  return '';
}
function required(row: Record<string, string>, ...names: string[]): string {
  return field(row, ...names) || invalid(`账单缺少 ${names[0]}`);
}
function abs(value: string): string { return (BigInt(value) < 0n ? -BigInt(value) : BigInt(value)).toString(); }
function sum(entries: ProviderBillEntry[], predicate: (entry: ProviderBillEntry) => boolean, column: 'amount' | 'feeAmount' = 'amount'): string {
  return entries.filter(predicate).reduce((total, entry) => total + BigInt(entry[column] ?? '0'), 0n).toString();
}
function equal(actual: string | number, expected: string, name: string): void {
  if (String(actual) !== expected) integrity(`账单 ${name} 校验不符（明细 ${actual}，汇总 ${expected}）`);
}
function validateHeaders(headers: string[]): void {
  const nonempty = headers.filter(Boolean).map(key);
  if (new Set(nonempty).size !== nonempty.length) invalid('账单存在重复列名');
}

function normalizeTimestamp(value: string): string | undefined {
  if (!value) return undefined;
  const compact = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(value);
  if (compact) value = `${compact[1]}-${compact[2]}-${compact[3]} ${compact[4]}:${compact[5]}:${compact[6]}`;
  const parts = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!parts) return invalid(`账单时间格式无效：${value}`);
  const [, year, month, day, hour, minute, second] = parts.map(Number);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) return invalid(`账单时间无效：${value}`);
  return value;
}

function parseWechat(text: string, kind: ProviderBillKind, merchantId: string): { entries: ProviderBillEntry[]; totals: Record<string, string> } {
  const rows = readBillCsv(text);
  if (rows.length < 3) return invalid('微信账单缺少明细表头或汇总');
  const headers = rows[0].cells;
  validateHeaders(headers);
  const totalLabel = kind === 'trade' ? '总交易单数' : '资金流水总笔数';
  const totalIndex = rows.findIndex((row) => row.cells[0] === totalLabel);
  if (totalIndex < 1 || totalIndex !== rows.length - 2) return invalid('微信账单缺少完整汇总或汇总后存在额外明细');
  const totals = rowRecord(rows[totalIndex].cells, rows[totalIndex + 1].cells, rows[totalIndex + 1].lineNo);
  const entries = rows.slice(1, totalIndex).map(({ cells, lineNo }): ProviderBillEntry => {
    const raw = rowRecord(headers, cells, lineNo);
    if (kind === 'fund') {
      const directionText = required(raw, '收支类型');
      if (!['收入', '支出'].includes(directionText)) return invalid(`微信资金账单第 ${lineNo} 行收支类型无效`);
      const business = required(raw, '业务名称', '业务类型');
      const type = /手续费/.test(business) ? 'fee' : /退款/.test(business) ? 'refund' : /结算|提现/.test(business) ? 'settlement' : /转账|划拨|充值/.test(business) ? 'transfer' : /交易|收款/.test(business) ? 'payment' : 'adjustment';
      const amount = billMinorUnits(required(raw, '收支金额元', '收支金额'));
      const direction = directionText === '收入' ? 'in' : 'out';
      return {
        entryKey: `fund:${required(raw, '资金流水单号')}`, type, currency: 'CNY', amount, direction,
        status: 'success', providerTransactionId: field(raw, '微信支付业务单号') || undefined,
        reference: field(raw, '业务凭证号') || undefined,
        occurredAt: normalizeTimestamp(required(raw, '记账时间')),
        balance: billMinorUnits(required(raw, '账户结余元', '账户结余'), true),
        feeAmount: type === 'fee' ? (direction === 'out' ? amount : `-${amount}`) : undefined,
        lineNo, raw,
      };
    }
    if (required(raw, '商户号') !== merchantId) return integrity(`微信账单第 ${lineNo} 行商户身份不匹配`);
    const currency = required(raw, '货币种类');
    if (currency !== 'CNY') return invalid(`微信账单不支持币种 ${currency}`);
    const transactionStatus = required(raw, '交易状态');
    const refundId = field(raw, '微信退款单号');
    const isRefund = !!refundId && refundId !== '0';
    if (!isRefund && transactionStatus !== 'SUCCESS') return invalid(`微信账单第 ${lineNo} 行交易状态 ${transactionStatus} 无法归类`);
    const statusText = isRefund ? required(raw, '退款状态') : transactionStatus;
    const status = statusText === 'SUCCESS' ? 'success' : statusText === 'PROCESSING' ? 'processing' : ['FAIL', 'CHANGE', 'CLOSED'].includes(statusText) ? 'failed' : invalid(`微信退款状态 ${statusText} 未支持`);
    const amount = billMinorUnits(required(raw, ...(isRefund ? ['申请退款金额', '退款金额'] : ['订单金额', '应结订单金额', '总金额'])));
    const fee = billMinorUnits(required(raw, '手续费'), true);
    const settlement = billMinorUnits(required(raw, ...(isRefund ? ['退款金额'] : ['应结订单金额', '总金额', '订单金额'])));
    return {
      entryKey: `${isRefund ? 'refund' : 'payment'}:${isRefund ? refundId : required(raw, '微信订单号')}`,
      type: isRefund ? 'refund' : 'payment', merchantOrderNo: required(raw, '商户订单号'),
      merchantRefundNo: isRefund ? required(raw, '商户退款单号') : undefined,
      providerTransactionId: required(raw, '微信订单号'), providerRefundId: isRefund ? refundId : undefined,
      currency, amount, direction: isRefund ? 'out' : 'in', status,
      occurredAt: normalizeTimestamp(required(raw, '交易时间')), feeAmount: fee,
      netAmount: ((isRefund ? -BigInt(settlement) : BigInt(settlement)) - BigInt(fee)).toString(), lineNo, raw,
    };
  });
  equal(entries.length, integer(required(totals, totalLabel)), '笔数');
  if (kind === 'fund') {
    equal(entries.filter((e) => e.direction === 'in').length, integer(required(totals, '收入笔数')), '收入笔数');
    equal(entries.filter((e) => e.direction === 'out').length, integer(required(totals, '支出笔数')), '支出笔数');
    equal(sum(entries, (e) => e.direction === 'in'), billMinorUnits(required(totals, '收入金额')), '收入金额');
    equal(sum(entries, (e) => e.direction === 'out'), billMinorUnits(required(totals, '支出金额')), '支出金额');
  } else {
    const rawTotal = (names: string[]) => entries.reduce((n, e) => n + BigInt(billMinorUnits(required(e.raw, ...names), true)), 0n).toString();
    equal(rawTotal(['应结订单金额', '总金额']), billMinorUnits(required(totals, '应结订单总金额', '总交易额'), true), '应结订单金额');
    equal(rawTotal(['退款金额']), billMinorUnits(required(totals, '退款总金额', '总退款金额'), true), '退款金额');
    equal(sum(entries, () => true, 'feeAmount'), billMinorUnits(required(totals, '手续费总金额'), true), '手续费');
    if (field(totals, '订单总金额')) equal(sum(entries, (e) => e.type === 'payment'), billMinorUnits(required(totals, '订单总金额')), '订单金额');
    if (field(totals, '申请退款总金额')) equal(sum(entries, (e) => e.type === 'refund'), billMinorUnits(required(totals, '申请退款总金额')), '申请退款金额');
  }
  return { entries, totals };
}

function decodeAlipay(bytes: Buffer): string {
  try { return decodeBillText(bytes); } catch { return decodeBillText(bytes, 'gb18030'); }
}

function parseAlipay(text: string, filename: string, kind: ProviderBillKind, merchantId: string): { entries: ProviderBillEntry[]; totals: Record<string, string> } {
  const fileMerchant = /(?:^|\/)(\d{16})[_-]/.exec(filename)?.[1];
  const statedMerchant = /(?:商户号|商户ID|商户编号|支付宝用户号)[：:\s]+(\d{16})/.exec(text)?.[1];
  if ((fileMerchant && fileMerchant !== merchantId) || (statedMerchant && statedMerchant !== merchantId)) return integrity('支付宝账单商户身份不匹配');
  if (!fileMerchant && !statedMerchant) return integrity('支付宝账单缺少可核验的商户身份，请保留渠道原始文件名');
  const rows = readBillCsv(text);
  const headerIndex = rows.findIndex(({ cells }) => kind === 'trade'
    ? cells.includes('支付宝交易号') && cells.includes('商户订单号') && cells.includes('业务类型')
    : cells.some((c) => ['账务流水号', '资金流水号'].includes(c)) && cells.some((c) => key(c).startsWith('收入')));
  if (headerIndex < 0) return invalid(`支付宝 ${kind === 'trade' ? '交易' : '资金'} 账单表头不支持`);
  const headers = rows[headerIndex].cells;
  validateHeaders(headers);
  const entries: ProviderBillEntry[] = [];
  const totals: Record<string, string> = {};
  for (const { cells, lineNo } of rows.slice(headerIndex + 1)) {
    if (cells[0].startsWith('#')) {
      const count = /(?:总笔数|总计笔数)[：:\s]+(\d+)/.exec(cells.join(','));
      if (count) totals.count = count[1];
      const tradeCount = /交易总笔数[：:\s]+(\d+)/.exec(cells.join(','));
      const refundCount = /退款总笔数[：:\s]+(\d+)/.exec(cells.join(','));
      if (tradeCount) totals.paymentCount = tradeCount[1];
      if (refundCount) totals.refundCount = refundCount[1];
      const tradeAmount = /交易总金额[：:\s]+([+-]?\d+(?:\.\d{1,2})?)/.exec(cells.join(','));
      const refundAmount = /退款总金额[：:\s]+([+-]?\d+(?:\.\d{1,2})?)/.exec(cells.join(','));
      if (tradeAmount) totals.paymentAmount = billMinorUnits(tradeAmount[1], true);
      if (refundAmount) totals.refundAmount = abs(billMinorUnits(refundAmount[1], true));
      continue;
    }
    const raw = rowRecord(headers, cells, lineNo);
    if (cells[0] === '合计' || cells[0] === '总计') { Object.assign(totals, raw); continue; }
    if (kind === 'trade') {
      const business = required(raw, '业务类型');
      if (!['交易', '退款'].includes(business)) return invalid(`支付宝业务类型 ${business} 未支持`);
      const refund = business === '退款';
      const id = required(raw, '支付宝交易号');
      const refundId = refund ? required(raw, '退款批次号/请求号', '退款批次号', '商户退款单号', '退款请求号') : undefined;
      const signedAmount = billMinorUnits(required(raw, '订单金额元', '订单金额'), true);
      const fee = field(raw, '服务费元', '服务费') ? billMinorUnits(required(raw, '服务费元', '服务费'), true) : '0';
      const received = field(raw, '商家实收元', '商家实收');
      entries.push({
        entryKey: refund ? `refund:${id}:${refundId}` : `payment:${id}`,
        type: refund ? 'refund' : 'payment', merchantOrderNo: required(raw, '商户订单号'), merchantRefundNo: refundId,
        providerTransactionId: id, currency: 'CNY', amount: abs(signedAmount), direction: refund ? 'out' : 'in', status: 'success',
        feeAmount: refund ? (-BigInt(abs(fee))).toString() : abs(fee),
        netAmount: received ? (refund ? -BigInt(abs(billMinorUnits(received, true))) : BigInt(billMinorUnits(received, true))).toString() : undefined,
        occurredAt: normalizeTimestamp(required(raw, '完成时间', '创建时间')), lineNo, raw,
      });
    } else {
      const income = billMinorUnits(field(raw, '收入金额+元', '收入金额元', '收入元', '收入金额') || '0');
      const expense = billMinorUnits(field(raw, '支出金额-元', '支出金额元', '支出元', '支出金额') || '0');
      if ((BigInt(income) > 0n) === (BigInt(expense) > 0n)) return invalid(`支付宝资金账单第 ${lineNo} 行收支金额无效`);
      const direction = BigInt(income) > 0n ? 'in' : 'out';
      const business = required(raw, '账务类型', '业务类型');
      const type = /服务费|手续费/.test(business) ? 'fee' : /退款/.test(business) ? 'refund' : /提现|结算/.test(business) ? 'settlement' : /转账|充值|划拨/.test(business) ? 'transfer' : /交易|收款/.test(business) ? 'payment' : 'adjustment';
      const amount = direction === 'in' ? income : expense;
      entries.push({
        entryKey: `fund:${required(raw, '账务流水号', '资金流水号')}`, type,
        reference: field(raw, '业务流水号') || undefined,
        merchantOrderNo: field(raw, '商户订单号') || undefined, providerTransactionId: field(raw, '支付宝交易号') || undefined,
        currency: 'CNY', amount, direction, status: 'success',
        occurredAt: normalizeTimestamp(required(raw, '发生时间', '入账时间', '账务时间', '时间')),
        balance: billMinorUnits(required(raw, '账户余额元', '账户余额'), true),
        feeAmount: type === 'fee' ? (direction === 'out' ? amount : `-${amount}`) : undefined, lineNo, raw,
      });
    }
  }
  if (totals.count) equal(entries.length, integer(totals.count), '支付宝总笔数');
  if (totals.paymentCount) equal(entries.filter((e) => e.type === 'payment').length, integer(totals.paymentCount), '支付宝交易笔数');
  if (totals.refundCount) equal(entries.filter((e) => e.type === 'refund').length, integer(totals.refundCount), '支付宝退款笔数');
  if (totals.paymentAmount) equal(sum(entries, (e) => e.type === 'payment'), totals.paymentAmount, '支付宝交易总金额');
  if (totals.refundAmount) equal(sum(entries, (e) => e.type === 'refund'), totals.refundAmount, '支付宝退款总金额');
  for (const [names, value] of [
    [['收入金额+元', '收入金额元', '收入元', '收入金额'], sum(entries, (e) => e.direction === 'in')],
    [['支出金额-元', '支出金额元', '支出元', '支出金额'], sum(entries, (e) => e.direction === 'out')],
  ] as const) {
    if (field(totals, ...names)) equal(value, billMinorUnits(required(totals, ...names)), names[0]);
  }
  return { entries, totals };
}

/** Cross-check the separate Alipay summary CSV instead of treating it as another transaction file. */
function validateAlipaySummary(text: string, entries: ProviderBillEntry[], kind: ProviderBillKind): Record<string, string> {
  const rows = readBillCsv(text).filter((row) => !row.cells[0].startsWith('#'));
  const headerIndex = rows.findIndex(({ cells }) => cells.some((cell) => /交易.*(?:笔数|数量)|收入.*元|收入.*金额/.test(cell)));
  if (headerIndex < 0 || !rows[headerIndex + 1]) return invalid('支付宝汇总文件表头或数据缺失');
  const headers = rows[headerIndex].cells;
  validateHeaders(headers);
  const data = rows.slice(headerIndex + 1).map((row) => rowRecord(headers, row.cells, row.lineNo));
  // Daily bills must contain a single daily total. Multi-period/multi-currency files need a dedicated parser.
  if (data.length !== 1) return invalid('支付宝日账单汇总文件包含多个账期或分组');
  const totals = data[0];
  if (kind === 'trade') {
    equal(entries.filter((e) => e.type === 'payment').length, integer(required(totals, '交易总笔数', '交易订单总笔数', '交易订单数量', '交易笔数')), '支付宝汇总交易笔数');
    equal(entries.filter((e) => e.type === 'refund').length, integer(required(totals, '退款总笔数', '退款订单总笔数', '退款订单数量', '退款笔数')), '支付宝汇总退款笔数');
    equal(sum(entries, (e) => e.type === 'payment'), billMinorUnits(required(totals, '交易总金额元', '交易订单总金额元', '订单金额元')), '支付宝汇总交易金额');
    equal(sum(entries, (e) => e.type === 'refund'), abs(billMinorUnits(required(totals, '退款总金额元', '退款订单总金额元', '退款金额元'), true)), '支付宝汇总退款金额');
  } else {
    equal(sum(entries, (e) => e.direction === 'in'), billMinorUnits(required(totals, '收入金额+元', '收入金额元', '收入总金额元', '收入元')), '支付宝汇总收入');
    equal(sum(entries, (e) => e.direction === 'out'), billMinorUnits(required(totals, '支出金额-元', '支出金额元', '支出总金额元', '支出元')), '支付宝汇总支出');
  }
  return totals;
}

/** UnionPay V2.5 fixed-width files use byte offsets, never JS character offsets. */
const ZM_FIELDS: Array<[string, number]> = [
  ['code', 3], ['acqInsCode', 11], ['sendInsCode', 11], ['traceNo', 6], ['txnTime', 10], ['maskedAccount', 19],
  ['txnAmt', 12], ['merCatCode', 4], ['termType', 2], ['queryId', 21], ['oldPayType', 2], ['orderId', 32],
  ['payCardType', 2], ['origTraceNo', 6], ['origTxnTime', 10], ['fee', 13], ['settlement', 13], ['payType', 4],
  ['groupMerchant', 15], ['txnType', 2], ['txnSubType', 2], ['bizType', 6], ['accType', 2], ['billType', 4],
  ['billNo', 32], ['interactMode', 1], ['origQryId', 21], ['merId', 15], ['shareMode', 1], ['subMerId', 15],
  ['subMerName', 32], ['subMerAmount', 13], ['net', 13], ['termId', 8], ['merReserved', 32], ['discount', 13],
  ['invoice', 13], ['installmentFee', 12], ['installments', 2], ['medium', 1], ['origOrderId', 32],
  ['clearingAmount', 13], ['posEntryMode', 2], ['mobileProduct', 1], ['reference', 12], ['campaign', 20], ['reserved', 45],
];
const ZME_FIELDS: Array<[string, number]> = [
  ['code', 3], ['acqInsCode', 11], ['sendInsCode', 11], ['traceNo', 6], ['txnTime', 10], ['maskedAccount', 19],
  ['txnAmt', 12], ['merCatCode', 4], ['termType', 2], ['payCardType', 2], ['origTraceNo', 6], ['origTxnTime', 10],
  ['origSettleDate', 4], ['origTxnAmt', 12], ['fee', 13], ['settlement', 13], ['groupMerchant', 15], ['merId', 15],
  ['shareMode', 1], ['installmentFee', 12], ['installments', 2], ['reserved', 135],
];
function unionpaySigned(value: string, optional = false): string {
  if (!value && optional) return '0';
  if (!/^[CD]\d{11,12}$/.test(value)) return invalid(`银联账单借贷金额无效：${value}`);
  return ((value[0] === 'D' ? -1n : 1n) * BigInt(value.slice(1))).toString();
}
function fixedRecord(bytes: Buffer, fields: Array<[string, number]>): Record<string, string> {
  let offset = 0;
  return Object.fromEntries(fields.map(([name, size]) => {
    const value = decodeBillText(bytes.subarray(offset, offset + size), 'gb18030').trim(); offset += size;
    return [name, value];
  }));
}
function parseUnionpay(bytes: Buffer, filename: string, merchantId: string, billDate: string): ProviderBillEntry[] {
  const name = /(?:^|\/)(?:INN)(\d{6})\w{2}(ZME|ZM)_(\d{15})(?:\.[^/]*)?$/.exec(filename);
  if (!name) return invalid(`银联账单文件名不支持：${filename}`);
  if (name[3] !== merchantId || name[1] !== billDate.replaceAll('-', '').slice(2)) return integrity('银联账单商户或账期不匹配');
  const correction = name[2] === 'ZME';
  const fields = correction ? ZME_FIELDS : ZM_FIELDS;
  const normalSize = fields.reduce((n, [, size]) => n + size, 0);
  const lines: Buffer[] = [];
  let start = 0;
  for (let index = 0; index < bytes.length; index++) {
    if (bytes[index] !== 10) continue;
    const end = bytes[index - 1] === 13 ? index - 1 : index;
    lines.push(bytes.subarray(start, end)); start = index + 1;
  }
  if (start < bytes.length) lines.push(bytes.subarray(start));
  return lines.map((line, index) => {
    const lineNo = index + 1;
    // 20-character query IDs exist in the official protocol alongside 21-character IDs.
    const shape = !correction && line.length === normalSize - 2 ? fields.map(([n, l]): [string, number] => [n, ['queryId', 'origQryId'].includes(n) ? 20 : l]) : fields;
    if (line.length !== shape.reduce((n, [, size]) => n + size, 0)) return invalid(`银联第 ${lineNo} 行长度 ${line.length} 不符合 V2.5 文件规范`);
    const raw = fixedRecord(line, shape);
    if (raw.merId !== merchantId) return integrity(`银联账单第 ${lineNo} 行商户不匹配`);
    const amount = integer(required(raw, 'txnAmt'));
    const settlement = unionpaySigned(required(raw, 'settlement'));
    const fee = (-BigInt(unionpaySigned(raw.fee, true))).toString();
    const direction = BigInt(settlement) < 0n ? 'out' : 'in';
    let type: ProviderBillEntry['type'] = 'adjustment';
    if (!correction) {
      if (['01', '03', '11'].includes(raw.txnType)) type = 'payment';
      else if (['04', '31', '32'].includes(raw.txnType)) type = 'refund';
      else if (['12', '13'].includes(raw.txnType)) type = 'transfer';
      else return invalid(`银联账单交易类型 ${raw.txnType} 尚未定义核对口径`);
      if ((type === 'payment' && direction !== 'in') || (type === 'refund' && direction !== 'out')) return integrity(`银联账单第 ${lineNo} 行交易方向与借贷标志矛盾`);
    }
    const id = correction ? `${raw.code}:${raw.traceNo}:${raw.txnTime}` : required(raw, 'queryId');
    const monthDay = required(raw, 'txnTime');
    if (!/^\d{10}$/.test(monthDay)) return invalid('银联交易日期无效');
    // A December transaction can settle on January 1; derive the nearest past year.
    const year = Number(billDate.slice(0, 4)) - (monthDay.slice(0, 4) > billDate.replaceAll('-', '').slice(4) ? 1 : 0);
    return {
      entryKey: `${correction ? 'adjustment' : type}:${id}`, type, currency: 'CNY', amount, direction, status: 'success',
      merchantOrderNo: correction ? undefined : type === 'refund' ? required(raw, 'origOrderId') : required(raw, 'orderId'),
      merchantRefundNo: type === 'refund' ? required(raw, 'orderId') : undefined,
      providerTransactionId: correction ? undefined : type === 'refund' ? required(raw, 'origQryId') : id,
      providerRefundId: type === 'refund' ? id : undefined, reference: raw.reference || (correction ? id : undefined),
      feeAmount: fee, netAmount: raw.net ? unionpaySigned(raw.net) : settlement,
      occurredAt: normalizeTimestamp(`${year}${monthDay}`), lineNo, raw,
    };
  });
}

/** Shared by automatic acquisition and manual imports. The original archive is always retained. */
export function parseProviderBill(channel: PaymentChannel, kind: ProviderBillKind, bytes: Buffer, filename: string, merchantId: string, billDate: string): ProviderBillResult {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(billDate)) return invalid('账期必须为 YYYY-MM-DD');
  normalizeTimestamp(`${billDate} 00:00:00`);
  const isZip = bytes.subarray(0, 2).toString('ascii') === 'PK';
  const artifacts = [billArtifact(bytes, filename, isZip ? 'application/zip' : 'text/csv')];
  return withBillEvidence(artifacts, () => {
    const files = isZip ? unpackBillZip(bytes) : [{ filename, bytes }];
    const entries: ProviderBillEntry[] = [];
    const totals: Record<string, string> = {};
    let parsedFiles = 0;
    for (const file of files) {
      const startIndex = entries.length;
      if (channel === 'unionpay') {
        if (kind !== 'trade') return invalid('银联全渠道文件接口提供交易及差错账单，独立资金余额账单需签约产品接口');
        if (/ZME?_/.test(file.filename)) {
          entries.push(...parseUnionpay(file.bytes, file.filename, merchantId, billDate)); parsedFiles++;
        } else if (!/(?:RD|RN)(?:G)?2010/.test(file.filename) && !/PED_/.test(file.filename)) return invalid(`银联账单包含未识别文件：${file.filename}`);
      } else if (channel === 'wechat') {
        const parsed = parseWechat(decodeBillText(file.bytes), kind, merchantId);
        entries.push(...parsed.entries); Object.assign(totals, parsed.totals); parsedFiles++;
      } else {
        if (/汇总/.test(file.filename)) continue;
        if (!/\.csv$/i.test(file.filename)) return invalid(`支付宝账单包含未识别文件：${file.filename}`);
        const parsed = parseAlipay(decodeAlipay(file.bytes), file.filename, kind, merchantId);
        entries.push(...parsed.entries); Object.assign(totals, parsed.totals); parsedFiles++;
      }
      for (const entry of entries.slice(startIndex)) entry.raw._sourceFile = file.filename;
    }
    if (channel === 'alipay') {
      const summaries = files.filter((file) => /汇总/.test(file.filename));
      if (summaries.length > 1) return invalid('支付宝账单包含重复汇总文件');
      for (const file of summaries) Object.assign(totals, validateAlipaySummary(decodeAlipay(file.bytes), entries, kind));
    }
    if (!parsedFiles) return invalid('渠道账单没有所需类型的明细文件');
    const keys = new Set<string>();
    for (const entry of entries) {
      if (keys.has(entry.entryKey)) return integrity(`渠道账单出现重复流水 ${entry.entryKey}`);
      keys.add(entry.entryKey);
    }
    return {
      artifacts, entries, parserVersion: `${channel}:${PARSER_VERSION}`, merchantId, billDate, kind,
      summary: {
        entryCount: entries.length, paymentAmount: sum(entries, (e) => e.type === 'payment'),
        refundAmount: sum(entries, (e) => e.type === 'refund'), incomeAmount: sum(entries, (e) => e.direction === 'in'),
        expenseAmount: sum(entries, (e) => e.direction === 'out'), feeAmount: sum(entries, () => true, 'feeAmount'), providerTotals: totals,
      },
    };
  });
}
