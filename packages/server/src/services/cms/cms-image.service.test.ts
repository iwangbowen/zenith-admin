import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { HTTPException } from 'hono/http-exception';

vi.mock('../files/files.service', () => ({
  assertUploadSizeAllowed: vi.fn(async () => undefined),
  uploadManagedFile: vi.fn(async () => ({ id: 'f1', url: 'https://cdn/f1.png' })),
}));
vi.mock('./cms-sites.service', () => ({
  assertSiteAccess: vi.fn(async () => undefined),
  ensureCmsSiteExists: vi.fn(async () => ({ id: 1, settings: {} })),
}));

import { assertUploadSizeAllowed, uploadManagedFile } from '../files/files.service';
import { ensureCmsSiteExists } from './cms-sites.service';
import { IMAGE_MAX_INPUT_PIXELS, processCmsImageUpload, readImageMetadataWithinLimit } from './cms-image.service';

const require = createRequire(import.meta.url);
const sharp = require('sharp') as typeof import('sharp');

/** 16×16 真实 JPEG；可选把 SOF0 段声明的宽高改写成任意值，制造「文件极小、像素巨大」的像素炸弹头部 */
async function jpegDeclaring(width?: number, height?: number): Promise<Buffer> {
  const buf = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#336699' } }).jpeg().toBuffer();
  if (width === undefined || height === undefined) return buf;
  let i = 2;
  while (i < buf.length - 1) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker === 0xc0 || marker === 0xc2) {
      buf.writeUInt16BE(height, i + 5);
      buf.writeUInt16BE(width, i + 7);
      return buf;
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  throw new Error('SOF marker not found');
}

/** 只关心是否被读入内存：arrayBuffer 一旦被调用就意味着整张图已进入 sharp 管线 */
function trackedFile(type: string, size: number): { file: File; arrayBuffer: ReturnType<typeof vi.fn> } {
  const arrayBuffer = vi.fn(async () => new ArrayBuffer(size));
  const file = { name: 'pic.png', type, size, arrayBuffer } as unknown as File;
  return { file, arrayBuffer };
}

describe('processCmsImageUpload 体积校验先于解码', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects an oversized image before reading it into memory or touching the site config', async () => {
    vi.mocked(assertUploadSizeAllowed).mockRejectedValueOnce(new HTTPException(400, { message: '文件大小超过上限（10MB）' }));
    const { file, arrayBuffer } = trackedFile('image/png', 50 * 1024 * 1024);

    await expect(processCmsImageUpload(file, 1)).rejects.toMatchObject({ status: 400 });

    expect(assertUploadSizeAllowed).toHaveBeenCalledWith(file.size);
    // 此前体积校验藏在 uploadManagedFile 末尾：超限图片被拒绝前已被完整解码、压缩并生成缩略图
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(ensureCmsSiteExists).not.toHaveBeenCalled();
    expect(uploadManagedFile).not.toHaveBeenCalled();
  });

  it('still forwards non-processable uploads untouched once the size check passes', async () => {
    const { file, arrayBuffer } = trackedFile('image/gif', 1024);

    const result = await processCmsImageUpload(file, 1);

    expect(assertUploadSizeAllowed).toHaveBeenCalledWith(1024);
    expect(uploadManagedFile).toHaveBeenCalledWith(file);
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(result).toEqual({ url: 'https://cdn/f1.png', thumbUrl: null, fileId: 'f1', width: null, height: null, watermarked: false });
  });
});

describe('readImageMetadataWithinLimit 像素上限', () => {
  it('rejects a pixel bomb from its header alone with a 400, before any decode', async () => {
    // 8000×8000 = 6400 万像素：超过本项目 5000 万上限，但低于 sharp 自带的 2.68 亿默认上限，证明生效的是本项目的限制
    const bomb = await jpegDeclaring(8000, 8000);
    expect(bomb.length).toBeLessThan(1024);
    expect(8000 * 8000).toBeGreaterThan(IMAGE_MAX_INPUT_PIXELS);

    await expect(readImageMetadataWithinLimit(bomb)).rejects.toMatchObject({ status: 400 });
  });

  it('maps sharp own pixel-limit error (beyond 0x3FFF²) to a 400 as well', async () => {
    const bomb = await jpegDeclaring(20000, 20000);
    await expect(readImageMetadataWithinLimit(bomb)).rejects.toMatchObject({ status: 400 });
  });

  it('returns metadata for a normal image', async () => {
    const meta = await readImageMetadataWithinLimit(await jpegDeclaring());
    expect(meta).toMatchObject({ width: 16, height: 16, format: 'jpeg' });
  });
});