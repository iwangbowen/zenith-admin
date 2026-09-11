/**
 * 链接 / 资源地址的安全判定（前后端、Electron 主进程共用）。
 *
 * `z.url()` 只校验「能被 URL 解析」，`javascript:`、`file:`、`data:` 都能通过；
 * 任何会被渲染为 href / src / window.open / shell.openExternal 目标的字段都必须过这里。
 */

const HTTP_PROTOCOLS = new Set(['http:', 'https:']);
const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);
/** URL 中的控制字符（换行 / 制表 / NUL）——浏览器会静默剔除，可能改变协议判定 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_RE = /[\u0000-\u001F\u007F]/;

function parseUrl(value: string): URL | null {
  if (typeof value !== 'string' || CONTROL_CHAR_RE.test(value)) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** 绝对 http(s) URL */
export function isHttpUrl(value: string): boolean {
  const url = parseUrl(value);
  return url != null && HTTP_PROTOCOLS.has(url.protocol);
}

/** 站内根相对路径：以单个 `/` 开头（排除 `//host` 协议相对与 `/\host` 变体） */
export function isRootRelativePath(value: string): boolean {
  return typeof value === 'string' && /^\/(?![/\\])/.test(value) && !CONTROL_CHAR_RE.test(value);
}

/** 可安全作为 href / src 渲染的地址：绝对 http(s) URL 或站内根相对路径 */
export function isSafeLinkUrl(value: string): boolean {
  return isHttpUrl(value) || isRootRelativePath(value);
}

/** 可交给系统 / 新窗口打开的外部地址：http(s) / mailto / tel */
export function isSafeExternalUrl(value: string): boolean {
  const url = parseUrl(value);
  return url != null && EXTERNAL_PROTOCOLS.has(url.protocol);
}

/**
 * 带占位符的 http(s) URL 模板（如报表下钻 `https://x/{value}`、`${filter}`）：
 * 先把占位符替换成字面量再判定，避免占位符本身影响解析。
 */
export function isHttpUrlTemplate(value: string): boolean {
  if (typeof value !== 'string') return false;
  return isHttpUrl(value.replace(/\$\{\w+\}|\{\w+\}/g, 'x'));
}

/** 同 isHttpUrlTemplate，但同时接受站内根相对路径模板 */
export function isSafeLinkUrlTemplate(value: string): boolean {
  if (typeof value !== 'string') return false;
  return isSafeLinkUrl(value.replace(/\$\{\w+\}|\{\w+\}/g, 'x'));
}

/** 判定 URL 是否与给定 origin 同源（相对路径视为同源） */
export function isSameOriginUrl(value: string, origin: string): boolean {
  if (isRootRelativePath(value)) return true;
  const url = parseUrl(value);
  return url != null && url.origin === origin;
}

/** 去掉末尾全部 `/`，供 `${base}/${path}` 拼接前归一 base URL / 根路径（`'/'` → `''`）。 */
export function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}
