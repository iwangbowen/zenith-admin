/**
 * 分片上传算术单测：分片大小裁定（下限 / 片数上限 / 过大拒绝）与各片期望字节数。
 */
import { describe, expect, it } from 'vitest';
import { UPLOAD_CHUNK_MAX_BYTES, UPLOAD_CHUNK_MIN_BYTES, UPLOAD_MAX_CHUNKS } from './constants';
import { countUploadChunks, expectedUploadChunkSize, resolveUploadChunkSize } from './upload';

const MIB = 1024 * 1024;

describe('resolveUploadChunkSize', () => {
  it('常规文件原样采用客户端请求的分片大小', () => {
    expect(resolveUploadChunkSize(100 * MIB, UPLOAD_CHUNK_MIN_BYTES)).toBe(UPLOAD_CHUNK_MIN_BYTES);
    expect(resolveUploadChunkSize(100 * MIB, 8 * MIB)).toBe(8 * MIB);
  });

  it('低于全局下限的请求值被抬到下限', () => {
    expect(resolveUploadChunkSize(100 * MIB, 1024)).toBe(UPLOAD_CHUNK_MIN_BYTES);
  });

  it('文件超过「片数上限 × 分片大小」时按 MiB 向上调大分片，使总片数不超过上限', () => {
    const fileSize = 100 * 1024 * MIB; // 100 GiB，按 5 MiB 分片会超过 10,000 片
    const chunkSize = resolveUploadChunkSize(fileSize, UPLOAD_CHUNK_MIN_BYTES)!;
    expect(chunkSize).toBeGreaterThan(UPLOAD_CHUNK_MIN_BYTES);
    expect(chunkSize % MIB).toBe(0);
    expect(countUploadChunks(fileSize, chunkSize)).toBeLessThanOrEqual(UPLOAD_MAX_CHUNKS);
    // 再小 1 MiB 就会超过片数上限
    expect(countUploadChunks(fileSize, chunkSize - MIB)).toBeGreaterThan(UPLOAD_MAX_CHUNKS);
  });

  it('上调后仍超过单片上限时返回 null', () => {
    const tooLarge = UPLOAD_MAX_CHUNKS * UPLOAD_CHUNK_MAX_BYTES + 1;
    expect(resolveUploadChunkSize(tooLarge, UPLOAD_CHUNK_MIN_BYTES)).toBeNull();
    expect(resolveUploadChunkSize(UPLOAD_MAX_CHUNKS * UPLOAD_CHUNK_MAX_BYTES, UPLOAD_CHUNK_MIN_BYTES)).toBe(UPLOAD_CHUNK_MAX_BYTES);
  });
});

describe('countUploadChunks / expectedUploadChunkSize', () => {
  it('空文件占 1 片且期望 0 字节', () => {
    expect(countUploadChunks(0, UPLOAD_CHUNK_MIN_BYTES)).toBe(1);
    expect(expectedUploadChunkSize(0, UPLOAD_CHUNK_MIN_BYTES, 0)).toBe(0);
  });

  it('恰好整除时末片也是完整分片', () => {
    const fileSize = 3 * UPLOAD_CHUNK_MIN_BYTES;
    expect(countUploadChunks(fileSize, UPLOAD_CHUNK_MIN_BYTES)).toBe(3);
    expect(expectedUploadChunkSize(fileSize, UPLOAD_CHUNK_MIN_BYTES, 2)).toBe(UPLOAD_CHUNK_MIN_BYTES);
  });

  it('非整除时非末片为 chunkSize、末片为余量', () => {
    const fileSize = 2 * UPLOAD_CHUNK_MIN_BYTES + 1;
    expect(countUploadChunks(fileSize, UPLOAD_CHUNK_MIN_BYTES)).toBe(3);
    expect(expectedUploadChunkSize(fileSize, UPLOAD_CHUNK_MIN_BYTES, 0)).toBe(UPLOAD_CHUNK_MIN_BYTES);
    expect(expectedUploadChunkSize(fileSize, UPLOAD_CHUNK_MIN_BYTES, 1)).toBe(UPLOAD_CHUNK_MIN_BYTES);
    expect(expectedUploadChunkSize(fileSize, UPLOAD_CHUNK_MIN_BYTES, 2)).toBe(1);
  });

  it('单片文件的唯一一片期望整个文件大小', () => {
    expect(expectedUploadChunkSize(1234, UPLOAD_CHUNK_MIN_BYTES, 0)).toBe(1234);
  });
});
