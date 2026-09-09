/**
 * 下载 / 内联响应的 `Content-Disposition` 唯一构造点。
 *
 * 文件名按 RFC 6266 / RFC 5987 同时给出两种形态：`filename="<ASCII 回退>"` 供不识别扩展参数的客户端，
 * `filename*=UTF-8''<百分号编码>` 让现代浏览器还原中文等非 ASCII 名称。
 * 所有路由 / service 拼下载头一律走这里，不得手写模板串。
 */

/**
 * 可内联渲染的 MIME 白名单（文件中心 `content`、网盘节点 `content`、公开外链共用）。
 * SVG / HTML / XML / JS 等类型可能内嵌脚本，不在白名单内的一律以 attachment 下载，防止 Stored XSS。
 */
export const SAFE_INLINE_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/ico', 'image/x-icon', 'image/avif',
  'video/mp4', 'video/webm', 'video/ogg',
  'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm',
  'application/pdf',
]);

export type DispositionType = 'attachment' | 'inline';

/** RFC 5987 的 `attr-char` 之外的字符都要百分号编码；`encodeURIComponent` 会放过 `!'()*`，这里补上 */
function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** 只保留可打印 ASCII，去掉引号 / 反斜杠 / 分号等会破坏头部语法的字符；全部被替换时退回 `download` */
function asciiFallback(filename: string): string {
  const cleaned = filename
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/["\\;]/g, '_')
    .trim();
  return cleaned.replace(/^_+$/, '') || 'download';
}

/** `attachment; filename="<ascii>"; filename*=UTF-8''<enc>`（或 `inline; …`） */
export function contentDisposition(type: DispositionType, filename: string): string {
  return `${type}; filename="${asciiFallback(filename)}"; filename*=UTF-8''${encodeRfc5987(filename)}`;
}

export function attachmentDisposition(filename: string): string {
  return contentDisposition('attachment', filename);
}

/**
 * 按 MIME 决定内联还是附件：白名单内且未强制下载 → inline，否则 attachment。
 * `Content-Type` 可能带 `; charset=…` 参数，比较前只取主类型并小写。
 */
export function inlineOrAttachmentDisposition(mimeType: string, filename: string, forceAttachment = false): string {
  const normalized = mimeType.split(';')[0].trim().toLowerCase();
  const inline = !forceAttachment && SAFE_INLINE_MIME_TYPES.has(normalized);
  return contentDisposition(inline ? 'inline' : 'attachment', filename);
}
