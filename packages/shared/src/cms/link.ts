/**
 * CMS 链接协议 —— 对齐 Drupal Link 字段的 URI scheme 分层。
 *
 * 内链与外链共用一列存储（`cms_contents.external_link` / `cms_channels.link_url`），
 * 靠协议前缀区分，渲染时由服务端 `cms-link.service.ts` 解析成真实 URL：
 *
 * ```
 * entity:channel@news    站内栏目（按栏目标识引用，站点复制/导入后依然有效，推荐）
 * entity:content/123     站内内容（稳定引用，目标改 slug / 换栏目自动跟随）
 * entity:channel/45      站内栏目（按数值 id 引用）
 * internal:/news/        手填站内路径
 * https://example.com    站外链接
 * ```
 *
 * 之所以不拆成 `link_type` + `link_target_id` 两列：链接字段天然要同时装内链和外链，
 * 现有大量代码只关心「有没有链接」（有就跳过静态化 / 详情页 302），单列仍作为持久化载体；
 * 任何进入该载体的值必须先经过本文件的严格语法校验。
 */

export const CMS_LINK_ENTITY_TYPES = ['content', 'channel'] as const;
export type CmsLinkEntityType = (typeof CMS_LINK_ENTITY_TYPES)[number];

export const CMS_LINK_ENTITY_LABELS: Record<CmsLinkEntityType, string> = {
  content: '内容',
  channel: '栏目',
};

export type CmsLinkRef =
  /** 站内实体引用（按数值 id） */
  | { kind: 'entity'; entityType: CmsLinkEntityType; id: number; code: null }
  /** 站内栏目引用（按站内唯一的栏目标识，跨站点/导入后依然有效） */
  | { kind: 'entity'; entityType: 'channel'; id: null; code: string }
  /** 站内路径（用户手填或历史数据里的相对路径） */
  | { kind: 'internal'; path: string }
  /** 站外链接（http/https/mailto/tel 等原样透传） */
  | { kind: 'external'; url: string };

const ENTITY_LINK_RE = /^entity:(content|channel)\/(\d+)$/;
const ENTITY_CODE_LINK_RE = /^entity:channel@([a-z0-9-]+)$/;
const INTERNAL_PREFIX = 'internal:';
const ENCODED_CONTROL_RE = /%0[0-9a-f]|%1[0-9a-f]|%7f/i;
const BACKSLASH_RE = /\\/;
const PATH_TRAVERSAL_RE = /(?:^|\/)(?:\.|\.\.|%2e|%2f|%5c)(?:\/|$)/i;
const PERCENT_ENCODED_DOT_RE = /%2e/i;
const PERCENT_ENCODED_SEPARATOR_RE = /%2f|%5c/i;
const EXTERNAL_PROTOCOL_RE = /^[a-z][a-z0-9+.-]*:/i;
const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

function hasUnsafeControlOrBidi(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (
      codePoint <= 0x1f
      || codePoint === 0x7f
      || codePoint === 0x2028
      || codePoint === 0x2029
      || codePoint === 0x200e
      || codePoint === 0x200f
      || (codePoint >= 0x202a && codePoint <= 0x202e)
      || (codePoint >= 0x2066 && codePoint <= 0x2069)
    ) return true;
  }
  return false;
}

/**
 * 站内路径只能是相对当前站点的 URL 路径。
 *
 * URL 解析器会把反斜杠和编码后的分隔符解释成路径分隔符，
 * 所以这些值必须在解码前拒绝，而不能依赖 `new URL()` 归一化后再判断。
 */
function isSafeInternalPath(path: string): boolean {
  if (!path.startsWith('/') || path.startsWith('//')) return false;
  if (hasUnsafeControlOrBidi(path) || BACKSLASH_RE.test(path)) return false;
  if (PERCENT_ENCODED_DOT_RE.test(path) || PERCENT_ENCODED_SEPARATOR_RE.test(path) || ENCODED_CONTROL_RE.test(path) || PATH_TRAVERSAL_RE.test(path)) return false;
  return !path.split('?')[0].split('#')[0].split('/').some((segment) => segment === '.' || segment === '..');
}

/** 严格校验可输出到 href 的站外地址，但保留调用方传入的文本以避免无意改写展示值。 */
function isSafeExternalUrl(raw: string): boolean {
  if (!raw || hasUnsafeControlOrBidi(raw) || ENCODED_CONTROL_RE.test(raw) || BACKSLASH_RE.test(raw) || /\s/.test(raw)) return false;
  if (raw.startsWith('//') || !EXTERNAL_PROTOCOL_RE.test(raw)) return false;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (!ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol.toLowerCase())) return false;
  // Credentials in a link are almost always a phishing/secret-leak mistake and
  // make redirects and link checks harder to reason about.
  if (parsed.username || parsed.password) return false;
  if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && !parsed.hostname) return false;
  if (parsed.protocol === 'mailto:' && !parsed.pathname.includes('@')) return false;
  return true;
}

/**
 * 解析链接值。
 *
 * - 空值返回 `null`
 * - `entity:` / `internal:` 前缀格式非法时返回 `null`（供 Zod 校验拒绝）
 * - 只接受明确允许的外链协议；未知协议、协议相对地址和自由文本返回 `null`
 */
export function parseCmsLink(raw: string | null | undefined): CmsLinkRef | null {
  const value = raw?.trim();
  if (!value) return null;
  if (hasUnsafeControlOrBidi(value) || BACKSLASH_RE.test(value)) return null;

  const entity = ENTITY_LINK_RE.exec(value);
  if (entity) {
    const id = Number(entity[2]);
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    return { kind: 'entity', entityType: entity[1] as CmsLinkEntityType, id, code: null };
  }
  const entityCode = ENTITY_CODE_LINK_RE.exec(value);
  if (entityCode) {
    return { kind: 'entity', entityType: 'channel', id: null, code: entityCode[1] };
  }
  // 前缀对了但整体不合法（如 entity:foo/1、entity:content/abc）→ 判为非法，不要降级成外链
  if (value.startsWith('entity:')) return null;

  if (value.startsWith(INTERNAL_PREFIX)) {
    const path = value.slice(INTERNAL_PREFIX.length);
    return isSafeInternalPath(path) ? { kind: 'internal', path } : null;
  }

  // 协议相对地址必须拒绝；否则浏览器会按当前协议加载攻击者域名。
  if (value.startsWith('//')) return null;
  if (value.startsWith('/')) return isSafeInternalPath(value) ? { kind: 'internal', path: value } : null;

  return isSafeExternalUrl(value) ? { kind: 'external', url: value } : null;
}

/** 构造实体链接：`entity:content/123` */
export function buildCmsEntityLink(entityType: CmsLinkEntityType, id: number): string {
  return `entity:${entityType}/${id}`;
}

/** 构造栏目标识链接：`entity:channel@news`（站点复制后依然有效，选择器优先产出这种） */
export function buildCmsChannelCodeLink(code: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(code)) throw new Error('栏目标识格式无效');
  return `entity:channel@${code}`;
}

/** 构造站内路径链接：`internal:/news/` */
export function buildCmsInternalLink(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  if (!isSafeInternalPath(normalized)) throw new Error('站内路径格式无效');
  return `${INTERNAL_PREFIX}${normalized}`;
}

/** 是否为站内链接（实体引用或站内路径） */
export function isCmsSiteLink(raw: string | null | undefined): boolean {
  const ref = parseCmsLink(raw);
  return ref !== null && ref.kind !== 'external';
}

/** 复制的本站预览路径还原为站点相对路径；不把其他站点的路径冒充本站链接。 */
export function cmsSiteRelativePath(path: string, siteCode?: string | null): string | null {
  if (!isSafeInternalPath(path)) return null;
  const preview = /^\/__cms\/([^/?#]+)(?=\/|[?#]|$)/.exec(path);
  if (!preview) return path;
  if (!siteCode || preview[1] !== siteCode) return null;
  const tail = path.slice(preview[0].length);
  const relative = tail.startsWith('/') ? tail : `/${tail}`;
  return relative.startsWith('/__cms/') ? null : relative;
}

/** 是否为实体引用链接 */
export function isCmsEntityLink(raw: string | null | undefined): boolean {
  return parseCmsLink(raw)?.kind === 'entity';
}

/** Zod 校验用：空值放行，非空时格式必须合法 */
export function isValidCmsLink(raw: string | null | undefined): boolean {
  const value = raw?.trim();
  if (!value) return true;
  return parseCmsLink(value) !== null;
}

/** 已可直接写入 href 的地址；entity 引用必须先经服务端 resolver。 */
export function isDirectCmsHref(raw: string | null | undefined): boolean {
  const ref = parseCmsLink(raw);
  return ref?.kind === 'internal' || ref?.kind === 'external';
}

/** 可直接用于 img/video/audio/source 等资源属性的 URL；不接受 entity/mailto/tel。 */
export function isValidCmsAssetUrl(raw: string | null | undefined): boolean {
  const value = raw?.trim();
  if (!value) return true;
  if (/^cms-res:\/\/\d+$/.test(value)) {
    const id = Number(value.slice('cms-res://'.length));
    return Number.isSafeInteger(id) && id > 0;
  }
  const ref = parseCmsLink(value);
  if (!ref) return false;
  if (ref.kind === 'internal') return value.startsWith('/');
  return ref.kind === 'external' && /^https?:$/i.test(new URL(ref.url).protocol);
}

/** 校验失败提示文案（前后端共用，避免两处各写一份） */
export const CMS_LINK_FORMAT_MESSAGE =
  '链接格式不合法：请填写 http(s):// 开头的外链、/ 开头的站内路径，或通过选择器选择站内内容/栏目';

/** 链接目标描述（后台编辑页把 `entity:content/123` 回显成可读标题） */
export interface CmsLinkTarget {
  kind: 'entity-content' | 'entity-channel' | 'internal' | 'external' | 'invalid';
  /** 实体链接为目标标题/栏目名；其余为原值 */
  label: string;
  /** 实体链接的目标 id；按 code 引用且目标不存在时为 null */
  targetId: number | null;
  /** 按栏目标识引用时回显该标识；其余为 null */
  targetCode: string | null;
  /** 目标是否仍存在（false 时前端提示链接已失效） */
  exists: boolean;
}

/**
 * 改写实体链接中的 id（站点导入 / 复制时 id 会重排）。
 *
 * 按 code 引用的栏目链接**无需改写**（这正是 code 的价值），原样返回；
 * 非实体链接同样原样返回。
 */
export function remapCmsEntityLink(
  raw: string | null | undefined,
  remap: (entityType: CmsLinkEntityType, id: number) => number | undefined,
): string | null {
  const value = raw?.trim() || null;
  const ref = parseCmsLink(value);
  if (value && !ref) return null;
  if (ref?.kind !== 'entity') return value;
  if (ref.code !== null) return value;
  const nextId = remap(ref.entityType, ref.id);
  // 目标未随包导入（映射缺失）时置空，避免指向导入站点里不相干的同 id 记录
  return nextId === undefined ? null : buildCmsEntityLink(ref.entityType, nextId);
}
