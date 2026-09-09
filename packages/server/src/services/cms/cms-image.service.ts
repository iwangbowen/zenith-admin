import { createRequire } from 'node:module';
import { HTTPException } from 'hono/http-exception';
import { assertUploadSizeAllowed, uploadManagedFile } from '../files/files.service';
import { ensureCmsSiteExists, assertSiteAccess } from './cms-sites.service';

// 惰性加载：sharp 含原生二进制、模块图大，仅在首次处理图片时加载
// （require 加载 CJS 构建，其导出即可调用函数，类型对应 d.mts 的 default）
const require = createRequire(import.meta.url);
const sharp = (...args: Parameters<typeof import('sharp')['default']>) =>
  (require('sharp') as unknown as typeof import('sharp')['default'])(...args);

/**
 * 单张图片解码后的像素上限（宽 × 高）。sharp 默认放行 0x3FFF² ≈ 2.68 亿像素（RGBA 栅格约 1 GB），
 * 一张高压缩比的「像素炸弹」就能把与 API 同进程的服务打到 OOM；5000 万像素（栅格约 200 MB）已远超 CMS 配图所需。
 */
export const IMAGE_MAX_INPUT_PIXELS = 50_000_000;

/**
 * 只读文件头取图片元数据，并在解码前按像素上限拒绝：超限一律 400，而不是让 sharp 的
 * 「Input image exceeds pixel limit」以 500 冒出。sharp 自带的 2.68 亿像素上限在读头阶段也会触发，一并映射。
 */
export async function readImageMetadataWithinLimit(input: Buffer): Promise<import('sharp').Metadata> {
  let meta: import('sharp').Metadata;
  try {
    meta = await sharp(input, { failOn: 'none' }).metadata();
  } catch (err) {
    if (err instanceof Error && err.message.includes('exceeds pixel limit')) {
      throw new HTTPException(400, { message: `图片像素超过上限（最多 ${IMAGE_MAX_INPUT_PIXELS / 1_000_000} 百万像素）` });
    }
    throw err;
  }
  if ((meta.width ?? 0) * (meta.height ?? 0) > IMAGE_MAX_INPUT_PIXELS) {
    throw new HTTPException(400, {
      message: `图片像素超过上限（${meta.width}×${meta.height}，最多 ${IMAGE_MAX_INPUT_PIXELS / 1_000_000} 百万像素）`,
    });
  }
  return meta;
}

/** 站点图片处理配置（cms_sites.settings JSONB） */
export interface CmsImageSettings {
  /** 超宽等比压缩上限（px），0 = 不限制 */
  imageMaxWidth: number;
  watermarkEnabled: boolean;
  watermarkText: string;
  /** sharp gravity 九宫格 */
  watermarkPosition: 'northwest' | 'north' | 'northeast' | 'west' | 'center' | 'east' | 'southwest' | 'south' | 'southeast';
  /** 0-100 */
  watermarkOpacity: number;
  watermarkFontSize: number;
  thumbEnabled: boolean;
  thumbWidth: number;
}

const DEFAULT_IMAGE_SETTINGS: CmsImageSettings = {
  imageMaxWidth: 1600,
  watermarkEnabled: false,
  watermarkText: '',
  watermarkPosition: 'southeast',
  watermarkOpacity: 45,
  watermarkFontSize: 22,
  thumbEnabled: false,
  thumbWidth: 400,
};

export function resolveImageSettings(settings: Record<string, unknown> | null | undefined): CmsImageSettings {
  const s = settings ?? {};
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const positions = ['northwest', 'north', 'northeast', 'west', 'center', 'east', 'southwest', 'south', 'southeast'];
  const pos = typeof s.watermarkPosition === 'string' && positions.includes(s.watermarkPosition)
    ? (s.watermarkPosition as CmsImageSettings['watermarkPosition'])
    : DEFAULT_IMAGE_SETTINGS.watermarkPosition;
  return {
    imageMaxWidth: Math.max(0, num(s.imageMaxWidth, DEFAULT_IMAGE_SETTINGS.imageMaxWidth)),
    watermarkEnabled: s.watermarkEnabled === true,
    watermarkText: typeof s.watermarkText === 'string' ? s.watermarkText.slice(0, 50) : '',
    watermarkPosition: pos,
    watermarkOpacity: Math.min(100, Math.max(0, num(s.watermarkOpacity, DEFAULT_IMAGE_SETTINGS.watermarkOpacity))),
    watermarkFontSize: Math.min(72, Math.max(10, num(s.watermarkFontSize, DEFAULT_IMAGE_SETTINGS.watermarkFontSize))),
    thumbEnabled: s.thumbEnabled === true,
    thumbWidth: Math.min(1200, Math.max(80, num(s.thumbWidth, DEFAULT_IMAGE_SETTINGS.thumbWidth))),
  };
}

function escapeXml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/** 文字水印 SVG（白字黑描边，深浅背景均可读） */
function buildWatermarkSvg(text: string, fontSize: number, opacity: number): Buffer {
  const padding = Math.ceil(fontSize * 0.6);
  const width = Math.ceil(text.length * fontSize * 1.1) + padding * 2;
  const height = fontSize + padding * 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central"
    font-family="'PingFang SC','Microsoft YaHei',sans-serif" font-size="${fontSize}" font-weight="600"
    fill="#ffffff" fill-opacity="${(opacity / 100).toFixed(2)}"
    stroke="#000000" stroke-opacity="${(opacity / 200).toFixed(2)}" stroke-width="1">${escapeXml(text)}</text>
</svg>`;
  return Buffer.from(svg);
}

/** 可被 sharp 处理并保持格式输出的 mime（gif 跳过避免丢动画） */
const PROCESSABLE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);

export interface CmsProcessedImage {
  url: string;
  thumbUrl: string | null;
  fileId: string;
  width: number | null;
  height: number | null;
  watermarked: boolean;
}

/**
 * CMS 图片上传管道：压缩（超宽等比缩放）→ 文字水印 → 可选缩略图，
 * 按站点 settings 配置执行；非图片/gif/svg 原样入库。
 */
export async function processCmsImageUpload(file: File, siteId: number): Promise<CmsProcessedImage> {
  await assertSiteAccess(siteId);
  // 体积上限必须先于读入内存与解码判定：此前只由 uploadManagedFile 在末尾校验，
  // 超限图片在被拒绝前已经被 sharp 完整解码、压缩并生成过缩略图
  await assertUploadSizeAllowed(file.size);
  const site = await ensureCmsSiteExists(siteId);
  const cfg = resolveImageSettings(site.settings as Record<string, unknown>);

  if (!PROCESSABLE_MIMES.has(file.type)) {
    const raw = await uploadManagedFile(file);
    return { url: raw.url ?? '', thumbUrl: null, fileId: raw.id, width: null, height: null, watermarked: false };
  }

  const input = Buffer.from(await file.arrayBuffer());
  const meta = await readImageMetadataWithinLimit(input);
  // limitInputPixels 与上面的读头判定同值：文件头缺失尺寸时仍由 sharp 在解码阶段兜底
  let pipeline = sharp(input, { failOn: 'none', limitInputPixels: IMAGE_MAX_INPUT_PIXELS }).rotate();

  if (cfg.imageMaxWidth > 0 && (meta.width ?? 0) > cfg.imageMaxWidth) {
    pipeline = pipeline.resize({ width: cfg.imageMaxWidth, withoutEnlargement: true });
  }
  const watermarked = cfg.watermarkEnabled && cfg.watermarkText.length > 0;
  if (watermarked) {
    pipeline = pipeline.composite([{
      input: buildWatermarkSvg(cfg.watermarkText, cfg.watermarkFontSize, cfg.watermarkOpacity),
      gravity: cfg.watermarkPosition,
    }]);
  }
  if (file.type === 'image/jpeg') pipeline = pipeline.jpeg({ quality: 85 });
  else if (file.type === 'image/webp') pipeline = pipeline.webp({ quality: 85 });
  else if (file.type === 'image/avif') pipeline = pipeline.avif({ quality: 60 });

  const output = await pipeline.toBuffer({ resolveWithObject: true });
  // Buffer 本身就是合法的 BlobPart：直接交给 File，不再经 Uint8Array + Blob 多拷贝两份
  const processedFile = new File([output.data], file.name, { type: file.type });
  const main = await uploadManagedFile(processedFile);

  let thumbUrl: string | null = null;
  if (cfg.thumbEnabled) {
    const thumbBuf = await sharp(output.data, { limitInputPixels: IMAGE_MAX_INPUT_PIXELS })
      .resize({ width: cfg.thumbWidth, withoutEnlargement: true })
      .toBuffer();
    const dot = file.name.lastIndexOf('.');
    const thumbName = dot > 0 ? `${file.name.slice(0, dot)}_thumb${file.name.slice(dot)}` : `${file.name}_thumb`;
    const thumbFile = new File([thumbBuf], thumbName, { type: file.type });
    const thumb = await uploadManagedFile(thumbFile);
    thumbUrl = thumb.url ?? null;
  }

  return {
    url: main.url ?? '',
    thumbUrl,
    fileId: main.id,
    width: output.info.width ?? null,
    height: output.info.height ?? null,
    watermarked,
  };
}
