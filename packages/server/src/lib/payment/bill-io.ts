import { createHash } from 'node:crypto';
import { crc32, inflateRawSync, inflateSync } from 'node:zlib';
import { HTTPException } from 'hono/http-exception';
import { HttpClientError, type HttpResponse } from '../http-client';
import { ProviderBillError, type ProviderBillArtifact } from './bill-types';

export const MAX_BILL_BYTES = 32 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 128 * 1024 * 1024;

export async function providerBillRequest<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch (error) {
    if (error instanceof ProviderBillError) throw error;
    if (error instanceof HTTPException || error instanceof HttpClientError) {
      const retryable = !error.status || error.status >= 500 || error.status === 408 || error.status === 429;
      throw new ProviderBillError(retryable ? 'temporary' : 'permanent', '账单渠道请求失败，请检查渠道响应及配置', { cause: error });
    }
    throw new ProviderBillError('temporary', '账单渠道请求未完成', { cause: error });
  }
}

export function billArtifact(bytes: Buffer, filename: string, mimeType = 'text/csv'): ProviderBillArtifact {
  return { bytes, filename, mimeType, sha256: createHash('sha256').update(bytes).digest('hex') };
}

/** Only official HTTPS download hosts; requests additionally use socket-level SSRF protection. */
export function approvedBillUrl(raw: string, provider: 'wechat' | 'alipay'): string {
  let url: URL;
  try { url = new URL(raw); } catch { throw new ProviderBillError('integrity', '渠道账单地址无效'); }
  const allowed = provider === 'wechat'
    ? ['api.mch.weixin.qq.com', 'api.mch.weixin.qq.com.cn']
    : ['dwbillcenter.alipay.com', 'billdownload.alipay.com'];
  // Older Alipay responses contain an HTTP URL: upgrade the official host before any I/O.
  if (provider === 'alipay' && url.protocol === 'http:') url.protocol = 'https:';
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !allowed.includes(url.hostname.toLowerCase())) {
    throw new ProviderBillError('integrity', '账单下载地址不在渠道官方 HTTPS 允许列表');
  }
  return url.toString();
}

export async function readBillBytes(response: HttpResponse, maxBytes = MAX_BILL_BYTES): Promise<Buffer> {
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > maxBytes) {
    await response.raw.body?.cancel();
    throw new ProviderBillError('format', '渠道账单超过文件大小限制');
  }
  if (!response.raw.body) return Buffer.alloc(0);
  const reader = response.raw.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) throw new ProviderBillError('format', '渠道账单超过文件大小限制');
      chunks.push(next.value);
    }
    return Buffer.concat(chunks, size);
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (error instanceof ProviderBillError) throw error;
    throw new ProviderBillError('temporary', '渠道账单下载中断', { cause: error });
  } finally { reader.releaseLock(); }
}

export function decodeBillText(bytes: Buffer, encoding: 'utf-8' | 'gb18030' = 'utf-8'): string {
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
  } catch (error) {
    throw new ProviderBillError('format', `账单不是有效的 ${encoding} 文本`, { cause: error });
  }
}

/** Read a bounded ZIP in memory. No archive pathname is ever written to disk. */
export function unpackBillZip(bytes: Buffer): Array<{ filename: string; bytes: Buffer }> {
  const fail = (message: string): never => { throw new ProviderBillError('format', `账单 ZIP：${message}`); };
  if (bytes.length < 22 || bytes.length > MAX_BILL_BYTES) return fail('大小无效');
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (bytes.readUInt32LE(offset) === 0x06054b50 && offset + 22 + bytes.readUInt16LE(offset + 20) === bytes.length) { end = offset; break; }
  }
  if (end < 0) return fail('目录缺失或文件截断');
  const count = bytes.readUInt16LE(end + 10);
  const directorySize = bytes.readUInt32LE(end + 12);
  const directoryOffset = bytes.readUInt32LE(end + 16);
  if (bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6) || bytes.readUInt16LE(end + 8) !== count) return fail('不支持多卷压缩');
  if (count > 256 || directoryOffset + directorySize !== end) return fail('目录数量或长度无效');
  const files: Array<{ filename: string; bytes: Buffer }> = [];
  const names = new Set<string>();
  let offset = directoryOffset;
  let expanded = 0;
  for (let item = 0; item < count; item++) {
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50) return fail('目录损坏');
    const flags = bytes.readUInt16LE(offset + 8);
    const method = bytes.readUInt16LE(offset + 10);
    const checksum = bytes.readUInt32LE(offset + 16);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const size = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const localOffset = bytes.readUInt32LE(offset + 42);
    if (offset + 46 + nameLength + extraLength + commentLength > end) return fail('目录字段截断');
    const filename = decodeBillText(bytes.subarray(offset + 46, offset + 46 + nameLength), flags & 0x800 ? 'utf-8' : 'gb18030');
    const parts = filename.replaceAll('\\', '/').split('/');
    if (!filename || [...filename].some((char) => char.charCodeAt(0) < 32 || char === ':') || filename.startsWith('/') || parts.includes('..') || parts.includes('.') || names.has(filename.toLowerCase())) return fail('文件名无效或重复');
    names.add(filename.toLowerCase());
    if (flags & 1 || (method !== 0 && method !== 8)) return fail('不支持加密或该压缩算法');
    if ((bytes.readUInt32LE(offset + 38) >>> 16 & 0xf000) === 0xa000) return fail('禁止符号链接');
    if (localOffset + 30 > directoryOffset || bytes.readUInt32LE(localOffset) !== 0x04034b50) return fail('数据头无效');
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    if (start + compressedSize > directoryOffset || localNameLength !== nameLength || bytes.readUInt16LE(localOffset + 6) !== flags || bytes.readUInt16LE(localOffset + 8) !== method || !bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength).equals(bytes.subarray(offset + 46, offset + 46 + nameLength))) return fail('数据目录不一致');
    expanded += size;
    if (size > MAX_BILL_BYTES * 2 || expanded > MAX_EXPANDED_BYTES) return fail('解压大小超限');
    let content: Buffer;
    try {
      const compressed = bytes.subarray(start, start + compressedSize);
      content = method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: Math.max(1, size) });
    } catch { return fail('解压失败或长度不符'); }
    if (content.length !== size || crc32(content) !== checksum) return fail('长度或 CRC 校验失败');
    if (!filename.endsWith('/')) files.push({ filename, bytes: content });
    else if (size !== 0) return fail('目录含有数据');
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (offset !== end || !files.length) return fail('没有可解析文件或目录尾损坏');
  return files;
}

/** UnionPay fileContent is Base64 of a zlib-compressed ZIP (AcpService.deCodeFileContent). */
export function decodeUnionpayFile(content: string): Buffer {
  if (content.length > MAX_BILL_BYTES * 2 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(content)) {
    throw new ProviderBillError('format', '银联账单 fileContent 不是有效 Base64');
  }
  const bytes = Buffer.from(content, 'base64');
  if (bytes.subarray(0, 2).toString('ascii') === 'PK') return bytes;
  try { return inflateSync(bytes, { maxOutputLength: MAX_BILL_BYTES }); }
  catch (error) { throw new ProviderBillError('format', '银联账单解压失败', { cause: error }); }
}

export function withBillEvidence<T>(artifacts: ProviderBillArtifact[], work: () => T): T {
  try { return work(); }
  catch (error) {
    const result = error instanceof ProviderBillError ? error : new ProviderBillError('format', '账单解析失败', { cause: error });
    result.artifacts = [...artifacts, ...(result.artifacts ?? []).filter((existing) => !artifacts.some((item) => item.sha256 === existing.sha256))];
    throw result;
  }
}
