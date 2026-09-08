/**
 * 分片上传的纯算术：分片大小裁定与各片期望字节数。
 * 服务端用它校验客户端上传的每一片，Mock 用它模拟服务端对 init 请求的裁定。
 */
import { UPLOAD_CHUNK_MAX_BYTES, UPLOAD_CHUNK_MIN_BYTES, UPLOAD_MAX_CHUNKS } from './constants';

const MIB = 1024 * 1024;

/**
 * 裁定会话实际使用的分片大小：不低于客户端请求值与全局下限，且保证总片数不超过
 * `UPLOAD_MAX_CHUNKS`（按 MiB 向上取整）。上调后仍超过 `UPLOAD_CHUNK_MAX_BYTES` 返回 `null`，
 * 表示文件过大无法分片上传。
 */
export function resolveUploadChunkSize(fileSize: number, requestedChunkSize: number): number | null {
  const minForPartLimit = Math.ceil(Math.ceil(fileSize / UPLOAD_MAX_CHUNKS) / MIB) * MIB;
  const chunkSize = Math.max(requestedChunkSize, UPLOAD_CHUNK_MIN_BYTES, minForPartLimit);
  return chunkSize > UPLOAD_CHUNK_MAX_BYTES ? null : chunkSize;
}

/** 会话总片数；空文件也占 1 片 */
export function countUploadChunks(fileSize: number, chunkSize: number): number {
  return Math.max(1, Math.ceil(fileSize / chunkSize));
}

/** 第 `index` 片（从 0 计）应有的字节数：非末片为 `chunkSize`，末片为余量 */
export function expectedUploadChunkSize(fileSize: number, chunkSize: number, index: number): number {
  const totalChunks = countUploadChunks(fileSize, chunkSize);
  if (index < totalChunks - 1) return chunkSize;
  return fileSize - chunkSize * (totalChunks - 1);
}
