import sharp from 'sharp';
import { uploadManagedFile } from '../files/files.service';
import { ensureCmsSiteExists, assertSiteAccess } from './cms-sites.service';

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
  const site = await ensureCmsSiteExists(siteId);
  const cfg = resolveImageSettings(site.settings as Record<string, unknown>);

  if (!PROCESSABLE_MIMES.has(file.type)) {
    const raw = await uploadManagedFile(file);
    return { url: raw.url ?? '', thumbUrl: null, fileId: raw.id, width: null, height: null, watermarked: false };
  }

  const input = Buffer.from(await file.arrayBuffer());
  let pipeline = sharp(input, { failOn: 'none' }).rotate();
  const meta = await pipeline.metadata();

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
  const processedFile = new File([new Blob([new Uint8Array(output.data)], { type: file.type })], file.name, { type: file.type });
  const main = await uploadManagedFile(processedFile);

  let thumbUrl: string | null = null;
  if (cfg.thumbEnabled) {
    const thumbBuf = await sharp(output.data).resize({ width: cfg.thumbWidth, withoutEnlargement: true }).toBuffer();
    const dot = file.name.lastIndexOf('.');
    const thumbName = dot > 0 ? `${file.name.slice(0, dot)}_thumb${file.name.slice(dot)}` : `${file.name}_thumb`;
    const thumbFile = new File([new Blob([new Uint8Array(thumbBuf)], { type: file.type })], thumbName, { type: file.type });
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
