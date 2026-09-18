import { crc32, deflateSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../http-client', () => ({ HttpClientError: class HttpClientError extends Error {} }));

import { billMinorUnits, parseProviderBill, readBillCsv } from './bill-parsers';
import { approvedBillUrl, decodeUnionpayFile, unpackBillZip } from './bill-io';
import { ProviderBillError } from './bill-types';

const wechatHeaders = '交易时间,商户号,微信订单号,商户订单号,交易状态,货币种类,应结订单金额,微信退款单号,商户退款单号,退款金额,退款状态,手续费,订单金额,申请退款金额';
const payment = '2026-09-17 10:00:00,1900000001,WX1,ORDER1,SUCCESS,CNY,100.00,0,0,0.00,,0.60,100.00,0.00';
const refund = '2026-09-17 11:00:00,1900000001,WX1,ORDER1,REFUND,CNY,0.00,WXR1,REF1,30.00,SUCCESS,-0.18,0.00,30.00';
const processing = '2026-09-17 12:00:00,1900000001,WX1,ORDER1,REFUND,CNY,0.00,WXR2,REF2,20.00,PROCESSING,-0.12,0.00,20.00';
const wechatTotals = '总交易单数,应结订单总金额,退款总金额,手续费总金额,订单总金额,申请退款总金额';
const wechatBill = [wechatHeaders, payment, refund, processing, wechatTotals, '3,100.00,50.00,0.30,100.00,50.00'].join('\n');
const parseWechat = (text: string) => parseProviderBill('wechat', 'trade', Buffer.from(text), 'wechat.csv', '1900000001', '2026-09-17');

/** Test-side stored ZIP writer; production reads both stored and deflated central directories. */
function archive(files: Array<[string, string]>): Buffer {
  const locals: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of files) {
    const filename = Buffer.from(name);
    const bytes = Buffer.from(text);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6);
    local.writeUInt32LE(crc32(bytes), 14); local.writeUInt32LE(bytes.length, 18); local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(filename.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8);
    central.writeUInt32LE(crc32(bytes), 16); central.writeUInt32LE(bytes.length, 20); central.writeUInt32LE(bytes.length, 24);
    central.writeUInt16LE(filename.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, filename, bytes); directory.push(central, filename); offset += local.length + filename.length + bytes.length;
  }
  const cd = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

describe('provider bill normalization', () => {
  it('preserves cents beyond floating point precision and rejects unsupported fractional cents', () => {
    expect(billMinorUnits('90071992547409.93')).toBe('9007199254740993');
    expect(billMinorUnits('-0.01', true)).toBe('-1');
    expect(() => billMinorUnits('1.005')).toThrow('格式无效');
    expect(() => billMinorUnits('1e3')).toThrow('格式无效');
  });

  it('retains two partial refunds and their distinct lifecycle states for one payment', () => {
    const result = parseWechat(wechatBill);
    expect(result.entries.map((entry) => [entry.entryKey, entry.amount, entry.status])).toEqual([
      ['payment:WX1', '10000', 'success'], ['refund:WXR1', '3000', 'success'], ['refund:WXR2', '2000', 'processing'],
    ]);
    expect(result.summary).toMatchObject({ paymentAmount: '10000', refundAmount: '5000', feeAmount: '30' });
    expect(result.artifacts[0].bytes.toString()).toBe(wechatBill);
  });

  it('rejects partial files, bad totals, wrong merchant identity and duplicate provider keys with raw evidence', () => {
    expect(() => parseWechat(wechatBill.replace('3,100.00,50.00', '4,100.00,50.00'))).toThrow('笔数');
    expect(() => parseWechat(wechatBill.replace('1900000001', '1900000002'))).toThrow('商户身份');
    expect(() => parseWechat(wechatBill.replace('WXR2', 'WXR1'))).toThrow('重复流水');
    try { parseWechat(wechatBill.replace(processing, 'malformed')); }
    catch (error) {
      expect(error).toBeInstanceOf(ProviderBillError);
      expect((error as ProviderBillError).artifacts?.[0].bytes.toString()).toContain('malformed');
      return;
    }
    throw new Error('Malformed row was accepted');
  });

  it('preserves quoted comma/newline fields and rejects unterminated CSV', () => {
    expect(readBillCsv('id,note\n1,"quoted,\nline"\n2,last')).toEqual([
      { lineNo: 1, cells: ['id', 'note'] }, { lineNo: 2, cells: ['1', 'quoted,\nline'] }, { lineNo: 4, cells: ['2', 'last'] },
    ]);
    expect(() => readBillCsv('id,note\n1,"unterminated')).toThrow('引号未闭合');
  });

  it('parses Alipay archive and verifies its independent summary without duplicating rows', () => {
    const merchant = '2088000000000001';
    const detail = [
      '支付宝交易号,商户订单号,业务类型,完成时间,订单金额(元),商家实收(元),退款批次号/请求号,服务费(元)',
      'ALI1,ORDER1,交易,2026-09-17 10:00:00,100.00,99.40,,0.60',
      'ALI1,ORDER1,退款,2026-09-17 11:00:00,-30.00,-29.82,REF1,-0.18',
    ].join('\n');
    const summary = '交易订单总笔数,退款订单总笔数,交易订单总金额(元),退款订单总金额(元)\n1,1,100.00,30.00';
    const zip = archive([[`${merchant}_20260917_业务明细.csv`, detail], [`${merchant}_20260917_业务明细(汇总).csv`, summary]]);
    const result = parseProviderBill('alipay', 'trade', zip, 'bill.zip', merchant, '2026-09-17');
    expect(result.entries).toHaveLength(2);
    expect(result.entries[1]).toMatchObject({ merchantRefundNo: 'REF1', amount: '3000', feeAmount: '-18', direction: 'out' });
    expect(() => parseProviderBill('alipay', 'trade', archive([[`${merchant}_业务明细.csv`, detail], [`${merchant}_汇总.csv`, summary.replace('1,1,', '2,1,')]]), 'bill.zip', merchant, '2026-09-17')).toThrow('汇总交易笔数');
  });

  it('validates WeChat funds totals and keeps settlement references and running balance', () => {
    const content = [
      '记账时间,微信支付业务单号,资金流水单号,业务名称,业务类型,收支类型,收支金额（元）,账户结余（元）,业务凭证号',
      '2026-09-17 10:00:00,P1,F1,交易收款,交易,收入,100.00,100.00,P1',
      '2026-09-17 11:00:00,S1,F2,提现,结算,支出,90.00,10.00,SETTLE1',
      '资金流水总笔数,收入笔数,收入金额,支出笔数,支出金额', '2.0,1.0,100.00,1.0,90.00',
    ].join('\n');
    const result = parseProviderBill('wechat', 'fund', Buffer.from(content), 'fund.csv', '1900000001', '2026-09-17');
    expect(result.entries[1]).toMatchObject({ type: 'settlement', reference: 'SETTLE1', amount: '9000', balance: '1000' });
  });

  it('reads the UnionPay V2.5 fixed-width byte record and validates merchant, date and signed fees', () => {
    // Field widths are the public V2.5 ZM protocol, including the 21-byte query IDs.
    const fixed = (value: string, width: number) => value.padEnd(width, ' ');
    const row = [
      'S22', fixed('123', 11), fixed('456', 11), '000001', '0917100000', fixed('6222******1234', 19),
      '000000010000', '5812', '08', fixed('202609170000000000001', 21), '00', fixed('ORDER1', 32), '01',
      fixed('', 6), fixed('', 10), 'D000000000060', 'C000000009940', '0001', fixed('', 15), '01', '07', '000000', '01',
      fixed('', 4), fixed('', 32), '0', fixed('', 21), '700000000000001', ' ', fixed('', 15), fixed('', 32),
      fixed('', 13), 'C000000009940', fixed('', 8), fixed('', 32), fixed('', 13), fixed('', 13), fixed('', 12),
      fixed('', 2), '1', fixed('', 32), 'C000000010000', '01', 'Y', '123456000001', fixed('', 20), fixed('', 45),
    ].join('');
    const filename = 'INN26091700ZM_700000000000001';
    const result = parseProviderBill('unionpay', 'trade', Buffer.from(`${row}\r\n`), filename, '700000000000001', '2026-09-17');
    expect(result.entries[0]).toMatchObject({ type: 'payment', merchantOrderNo: 'ORDER1', amount: '10000', feeAmount: '60', netAmount: '9940', occurredAt: '2026-09-17 10:00:00' });
    expect(() => parseProviderBill('unionpay', 'trade', Buffer.from(row), filename, '700000000000002', '2026-09-17')).toThrow('商户或账期');
    expect(() => parseProviderBill('unionpay', 'trade', Buffer.from(row.slice(1)), filename, '700000000000001', '2026-09-17')).toThrow('长度');
  });
});

describe('bill file security and error semantics', () => {
  it('rejects traversal, duplicate filenames and CRC corruption', () => {
    expect(() => unpackBillZip(archive([['../escape.csv', 'data']]))).toThrow('文件名');
    expect(() => unpackBillZip(archive([['bill.csv', 'a'], ['bill.csv', 'b']]))).toThrow('重复');
    const zip = archive([['bill.csv', 'data']]);
    zip[38] ^= 1;
    expect(() => unpackBillZip(zip)).toThrow('CRC');
  });

  it('decodes UnionPay Base64 + zlib + ZIP without dropping or extracting files', () => {
    const zip = archive([['INN26091700ZM_700000000000001', 'fixed-width-data']]);
    const decoded = decodeUnionpayFile(deflateSync(zip).toString('base64'));
    expect(decoded.equals(zip)).toBe(true);
    expect(unpackBillZip(decoded)[0].bytes.toString()).toBe('fixed-width-data');
    expect(() => decodeUnionpayFile('not-base64')).toThrow('Base64');
  });

  it('only permits official HTTPS download destinations and never classifies missing bill as zero transactions', () => {
    expect(approvedBillUrl('http://dwbillcenter.alipay.com/download?token=test', 'alipay')).toBe('https://dwbillcenter.alipay.com/download?token=test');
    expect(() => approvedBillUrl('https://dwbillcenter.alipay.com.evil.test/bill', 'alipay')).toThrow('允许列表');
    expect(() => approvedBillUrl('https://user:pass@api.mch.weixin.qq.com/bill', 'wechat')).toThrow('允许列表');
    expect(new ProviderBillError('no_bill', 'missing').retryable).toBe(false);
    expect(new ProviderBillError('waiting', 'building').retryable).toBe(true);
    expect(new ProviderBillError('integrity', 'bad hash').retryable).toBe(false);
  });
});
