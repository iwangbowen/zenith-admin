import { createElement, Fragment, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createHash } from 'node:crypto';
import {
  CMS_TEMPLATE_DSL_LIMITS,
  cmsTemplateDslSchema,
  type CmsTemplateDslDocument,
  type CmsTemplateDslNode,
  type CmsTemplateDslScalar,
  type CmsTemplateDslValue,
  type CmsTemplateValidationIssue,
  type CmsTemplateValidationReport,
} from '@zenith/shared';
import { sanitizeCmsHtml } from '../../services/cms/cms-html-sanitizer';
import { CmsFragmentContent } from '../themes/blocks';
import type { CmsBaseContext } from '../themes/types';

const ELEMENTS = new Set([
  'html', 'head', 'body', 'title', 'meta', 'link',
  'header', 'nav', 'main', 'section', 'article', 'aside', 'footer',
  'div', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p',
  'a', 'img', 'ul', 'ol', 'li', 'time', 'strong', 'em', 'small',
  'figure', 'figcaption', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'br', 'hr', 'code', 'pre', 'blockquote',
]);

const GLOBAL_ATTRIBUTES = new Set(['id', 'className', 'title', 'role', 'aria-label']);
const TAG_ATTRIBUTES: Record<string, Set<string>> = {
  html: new Set(['lang']),
  meta: new Set(['charSet', 'name', 'property', 'content']),
  link: new Set(['rel', 'href', 'media']),
  a: new Set(['href', 'target', 'rel']),
  img: new Set(['src', 'alt', 'width', 'height', 'loading']),
  time: new Set(['dateTime']),
  th: new Set(['colSpan', 'rowSpan', 'scope']),
  td: new Set(['colSpan', 'rowSpan']),
};

const COMPONENTS = new Set([
  'seo_head',
  'site_header',
  'site_footer',
  'breadcrumbs',
  'content_list',
  'content_detail',
  'pagination',
  'fragment',
  'page_blocks',
]);
const COMPONENT_PROPS: Record<string, Set<string>> = {
  seo_head: new Set(),
  site_header: new Set(),
  site_footer: new Set(),
  breadcrumbs: new Set(),
  content_list: new Set(['source']),
  content_detail: new Set(),
  pagination: new Set(),
  fragment: new Set(['code']),
  page_blocks: new Set(),
};

const RICH_TEXT_BINDINGS = new Set(['content.body', 'page.contentHtml', 'blocksHtml']);
const CONTENT_COLLECTIONS = new Set(['items', 'latest', 'recommended', 'hot']);
const MAX_RENDERED_NODES = CMS_TEMPLATE_DSL_LIMITS.maxNodes * 10;
const MAX_COLLECTION_ITEMS = 500;

const BASE_BINDINGS = new Set([
  'baseUrl', 'searchUrl', 'keyword', 'path',
  'site.id', 'site.code', 'site.name', 'site.title', 'site.description', 'site.logo',
  'site.favicon', 'site.icp', 'site.copyright', 'site.theme',
  'seo.title', 'seo.keywords', 'seo.description', 'seo.canonical', 'seo.ogTitle',
  'seo.ogDescription', 'seo.ogImage', 'seo.ogImageAlt', 'seo.ogType', 'seo.ogUrl',
  'seo.ogSiteName', 'seo.twitterCard', 'seo.twitterSite', 'seo.twitterCreator',
  'seo.twitterTitle', 'seo.twitterDescription', 'seo.twitterImage', 'seo.twitterImageAlt',
  'channel.id', 'channel.name', 'channel.url', 'channel.description', 'channel.image',
  'content.id', 'content.title', 'content.url', 'content.summary', 'content.coverImage',
  'content.coverThumb', 'content.author', 'content.source', 'content.publishedAt',
  'content.viewCount', 'content.likeCount', 'content.favoriteCount', 'content.body',
  'content.isTop', 'content.isRecommend', 'content.isHot', 'content.contentType',
  'page.name', 'page.slug', 'page.contentHtml',
  'tag.name', 'tag.slug', 'tag.contentCount',
  'pagination.page', 'pagination.pageSize', 'pagination.total', 'pagination.totalPages',
]);

const COLLECTION_FIELDS: Record<string, Set<string>> = {
  nav: new Set(['id', 'name', 'url', 'target']),
  items: new Set(['id', 'title', 'url', 'summary', 'coverImage', 'coverThumb', 'author', 'source', 'publishedAt', 'viewCount', 'isTop', 'isRecommend', 'isHot', 'contentType']),
  latest: new Set(['id', 'title', 'url', 'summary', 'coverImage', 'coverThumb', 'author', 'source', 'publishedAt', 'viewCount']),
  recommended: new Set(['id', 'title', 'url', 'summary', 'coverImage', 'coverThumb', 'author', 'source', 'publishedAt', 'viewCount']),
  hot: new Set(['id', 'title', 'url', 'summary', 'coverImage', 'coverThumb', 'author', 'source', 'publishedAt', 'viewCount']),
  breadcrumbs: new Set(['name', 'url']),
  related: new Set(['title', 'url']),
  comments: new Set(['id', 'parentId', 'nickname', 'content', 'likeCount', 'isMember', 'createdAt']),
  friendLinks: new Set(['name', 'url', 'logo']),
  'pagination.pages': new Set(['page', 'url', 'current']),
  'content.tags': new Set(['name', 'slug', 'url']),
  langAlternates: new Set(['language', 'name', 'url', 'current']),
};

const SAFE_DYNAMIC_BINDING = /^(?:site\.themeConfig|content\.extend)\.[a-zA-Z][a-zA-Z0-9_]{0,63}$/;
const SAFE_CLASS_NAME = /^[A-Za-z0-9 _-]*$/;
const SAFE_ASSET_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/;

export class CmsTemplateDslError extends Error {
  readonly issues: CmsTemplateValidationIssue[];

  constructor(message: string, issues: CmsTemplateValidationIssue[] = []) {
    super(message);
    this.name = 'CmsTemplateDslError';
    this.issues = issues;
  }
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, canonicalValue((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

export function canonicalizeCmsJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

export function checksumCmsTemplateDsl(value: CmsTemplateDslDocument): string {
  return createHash('sha256').update(canonicalizeCmsJson(value)).digest('hex');
}

export function collectCmsTemplateDslAssetReferences(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectCmsTemplateDslAssetReferences(item, out);
  } else if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.asset === 'string' && Object.keys(record).length === 1) out.add(record.asset);
    for (const nested of Object.values(record)) collectCmsTemplateDslAssetReferences(nested, out);
  }
  return out;
}

function zodIssues(error: { issues: Array<{ path: PropertyKey[]; code: string; message: string }> }): CmsTemplateValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.length ? issue.path.join('.') : '$',
    code: issue.code,
    message: issue.message,
  }));
}

interface ValidationState {
  issues: CmsTemplateValidationIssue[];
  nodeCount: number;
  maxDepth: number;
}

const RAW_MAX_DEPTH = CMS_TEMPLATE_DSL_LIMITS.maxDepth * 4;
const RAW_MAX_VALUES = CMS_TEMPLATE_DSL_LIMITS.maxNodes * 20;

function preflightCmsTemplateDsl(value: unknown): { bytes: number; issues: CmsTemplateValidationIssue[] } {
  const issues: CmsTemplateValidationIssue[] = [];
  const stack: Array<{ value: unknown; depth: number; path: string }> = [{ value, depth: 0, path: '$' }];
  const ancestors = new WeakSet<object>();
  let bytes = 0;
  let values = 0;
  while (stack.length) {
    const current = stack.pop()!;
    values += 1;
    if (values > RAW_MAX_VALUES) {
      issues.push({ path: current.path, code: 'raw_too_complex', message: `原始 JSON 值不能超过 ${RAW_MAX_VALUES} 个` });
      break;
    }
    if (current.depth > RAW_MAX_DEPTH) {
      issues.push({ path: current.path, code: 'raw_too_deep', message: `原始 JSON 深度不能超过 ${RAW_MAX_DEPTH}` });
      break;
    }
    const item = current.value;
    if (typeof item === 'string') {
      bytes += Buffer.byteLength(JSON.stringify(item));
      if (item.length > CMS_TEMPLATE_DSL_LIMITS.maxStringLength) {
        issues.push({ path: current.path, code: 'string_too_long', message: `字符串长度不能超过 ${CMS_TEMPLATE_DSL_LIMITS.maxStringLength}` });
      }
      continue;
    }
    if (item === null || typeof item === 'boolean' || typeof item === 'number') {
      bytes += Buffer.byteLength(String(item));
      continue;
    }
    if (!item || typeof item !== 'object') {
      issues.push({ path: current.path, code: 'not_json_value', message: '模板只能包含 JSON 值' });
      continue;
    }
    if (ancestors.has(item)) {
      issues.push({ path: current.path, code: 'cyclic_value', message: '模板不能包含循环引用' });
      continue;
    }
    ancestors.add(item);
    if (Array.isArray(item)) {
      bytes += 2 + Math.max(0, item.length - 1);
      if (item.length > CMS_TEMPLATE_DSL_LIMITS.maxChildrenPerNode) {
        issues.push({ path: current.path, code: 'raw_array_too_large', message: `数组长度不能超过 ${CMS_TEMPLATE_DSL_LIMITS.maxChildrenPerNode}` });
      }
      if (item.length > CMS_TEMPLATE_DSL_LIMITS.maxNodes) {
        issues.push({ path: current.path, code: 'too_many_nodes', message: `节点总数不能超过 ${CMS_TEMPLATE_DSL_LIMITS.maxNodes}` });
      }
      for (let index = item.length - 1; index >= 0; index--) {
        stack.push({ value: item[index], depth: current.depth + 1, path: `${current.path}.${index}` });
      }
    } else {
      const entries = Object.entries(item as Record<string, unknown>);
      bytes += 2 + Math.max(0, entries.length - 1);
      if (entries.length > CMS_TEMPLATE_DSL_LIMITS.maxAttributesPerNode + 8) {
        issues.push({ path: current.path, code: 'raw_object_too_large', message: `对象键数量不能超过 ${CMS_TEMPLATE_DSL_LIMITS.maxAttributesPerNode + 8}` });
      }
      for (let index = entries.length - 1; index >= 0; index--) {
        const [key, nested] = entries[index];
        bytes += Buffer.byteLength(JSON.stringify(key)) + 1;
        if (key.length > CMS_TEMPLATE_DSL_LIMITS.maxStringLength) {
          issues.push({ path: current.path, code: 'key_too_long', message: '对象键过长' });
        }
        stack.push({ value: nested, depth: current.depth + 1, path: `${current.path}.${key}` });
      }
    }
    if (bytes > CMS_TEMPLATE_DSL_LIMITS.maxDocumentBytes) {
      issues.push({ path: '$', code: 'document_too_large', message: `模板不能超过 ${CMS_TEMPLATE_DSL_LIMITS.maxDocumentBytes} 字节` });
      break;
    }
  }
  if (bytes > CMS_TEMPLATE_DSL_LIMITS.maxDocumentBytes && !issues.some((item) => item.code === 'document_too_large')) {
    issues.push({ path: '$', code: 'document_too_large', message: `模板不能超过 ${CMS_TEMPLATE_DSL_LIMITS.maxDocumentBytes} 字节` });
  }
  return { bytes, issues };
}

function addIssue(state: ValidationState, path: string, code: string, message: string): void {
  state.issues.push({ path, code, message });
}

function validateString(value: string, path: string, state: ValidationState): void {
  if (value.length > CMS_TEMPLATE_DSL_LIMITS.maxStringLength) {
    addIssue(state, path, 'string_too_long', `字符串长度不能超过 ${CMS_TEMPLATE_DSL_LIMITS.maxStringLength}`);
  }
  if ([...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 && code !== 9 && code !== 10 && code !== 13;
  })) {
    addIssue(state, path, 'control_character', '字符串包含禁止的控制字符');
  }
}

function bindingAllowed(bind: string, aliases: Map<string, Set<string>>): boolean {
  if (BASE_BINDINGS.has(bind) || SAFE_DYNAMIC_BINDING.test(bind)) return true;
  const dot = bind.indexOf('.');
  if (dot <= 0) return false;
  const alias = bind.slice(0, dot);
  const field = bind.slice(dot + 1);
  return aliases.get(alias)?.has(field) === true;
}

function validateValue(value: CmsTemplateDslValue, path: string, state: ValidationState, aliases: Map<string, Set<string>>): void {
  if (typeof value === 'string') validateString(value, path, state);
  if (!value || typeof value !== 'object') return;
  if ('bind' in value) {
    if (!bindingAllowed(value.bind, aliases)) addIssue(state, path, 'binding_not_allowed', `数据绑定「${value.bind}」不在白名单`);
    if (typeof value.fallback === 'string') validateString(value.fallback, `${path}.fallback`, state);
  } else if ('asset' in value && !SAFE_ASSET_PATH.test(value.asset.replaceAll('\\', '/'))) {
    addIssue(state, path, 'asset_path_invalid', '资源路径格式无效');
  }
}

function validateNodes(
  nodes: CmsTemplateDslNode[],
  depth: number,
  path: string,
  state: ValidationState,
  aliases: Map<string, Set<string>>,
): void {
  if (nodes.length > CMS_TEMPLATE_DSL_LIMITS.maxChildrenPerNode) {
    addIssue(state, path, 'too_many_children', `单节点子节点不能超过 ${CMS_TEMPLATE_DSL_LIMITS.maxChildrenPerNode}`);
  }
  for (let index = 0; index < nodes.length; index++) {
    validateNode(nodes[index], depth, `${path}.${index}`, state, aliases);
  }
}

function validateNode(
  node: CmsTemplateDslNode,
  depth: number,
  path: string,
  state: ValidationState,
  aliases: Map<string, Set<string>>,
): void {
  state.nodeCount += 1;
  state.maxDepth = Math.max(state.maxDepth, depth);
  if (state.nodeCount > CMS_TEMPLATE_DSL_LIMITS.maxNodes) {
    addIssue(state, path, 'too_many_nodes', `节点总数不能超过 ${CMS_TEMPLATE_DSL_LIMITS.maxNodes}`);
    return;
  }
  if (depth > CMS_TEMPLATE_DSL_LIMITS.maxDepth) {
    addIssue(state, path, 'too_deep', `模板深度不能超过 ${CMS_TEMPLATE_DSL_LIMITS.maxDepth}`);
    return;
  }

  switch (node.kind) {
    case 'element': {
      if (!ELEMENTS.has(node.tag)) addIssue(state, `${path}.tag`, 'element_not_allowed', `元素「${node.tag}」不在白名单`);
      const attrs = Object.entries(node.attrs ?? {});
      if (attrs.length > CMS_TEMPLATE_DSL_LIMITS.maxAttributesPerNode) {
        addIssue(state, `${path}.attrs`, 'too_many_attributes', `属性不能超过 ${CMS_TEMPLATE_DSL_LIMITS.maxAttributesPerNode} 个`);
      }
      for (const [name, value] of attrs) {
        if (/^on/i.test(name) || (!GLOBAL_ATTRIBUTES.has(name) && !TAG_ATTRIBUTES[node.tag]?.has(name))) {
          addIssue(state, `${path}.attrs.${name}`, 'attribute_not_allowed', `属性「${name}」不允许用于 <${node.tag}>`);
        }
        validateValue(value, `${path}.attrs.${name}`, state, aliases);
      }
      if (node.tag === 'link') {
        const rel = node.attrs?.rel;
        if (typeof rel !== 'string' || !['stylesheet', 'canonical', 'icon'].includes(rel)) {
          addIssue(state, `${path}.attrs.rel`, 'link_rel_not_allowed', 'link.rel 仅允许 stylesheet/canonical/icon');
        }
        if (rel === 'stylesheet' && (!node.attrs?.href || typeof node.attrs.href !== 'object' || !('asset' in node.attrs.href))) {
          addIssue(state, `${path}.attrs.href`, 'stylesheet_must_be_asset', '样式表只能引用主题包内受限静态资源');
        }
      }
      validateNodes(node.children ?? [], depth + 1, `${path}.children`, state, aliases);
      break;
    }
    case 'text':
      validateValue(node.value, `${path}.value`, state, aliases);
      break;
    case 'binding':
      if (!bindingAllowed(node.bind, aliases)) addIssue(state, `${path}.bind`, 'binding_not_allowed', `数据绑定「${node.bind}」不在白名单`);
      if (typeof node.fallback === 'string') validateString(node.fallback, `${path}.fallback`, state);
      break;
    case 'if':
      if (!bindingAllowed(node.bind, aliases)) addIssue(state, `${path}.bind`, 'binding_not_allowed', `数据绑定「${node.bind}」不在白名单`);
      validateNodes(node.children, depth + 1, `${path}.children`, state, aliases);
      validateNodes(node.fallback ?? [], depth + 1, `${path}.fallback`, state, aliases);
      break;
    case 'each': {
      const fields = COLLECTION_FIELDS[node.source];
      if (!fields) addIssue(state, `${path}.source`, 'collection_not_allowed', `集合「${node.source}」不在白名单`);
      const alias = node.item ?? 'item';
      const nested = new Map(aliases);
      if (fields) nested.set(alias, fields);
      validateNodes(node.children, depth + 1, `${path}.children`, state, nested);
      validateNodes(node.empty ?? [], depth + 1, `${path}.empty`, state, aliases);
      break;
    }
    case 'rich_text':
      if (!RICH_TEXT_BINDINGS.has(node.bind)) addIssue(state, `${path}.bind`, 'html_binding_not_allowed', `富文本绑定「${node.bind}」不在白名单`);
      if (node.className && !SAFE_CLASS_NAME.test(node.className)) addIssue(state, `${path}.className`, 'class_invalid', 'className 格式无效');
      break;
    case 'component': {
      if (!COMPONENTS.has(node.name)) addIssue(state, `${path}.name`, 'component_not_allowed', `组件「${node.name}」不在白名单`);
      const props = Object.entries(node.props ?? {});
      if (props.length > CMS_TEMPLATE_DSL_LIMITS.maxAttributesPerNode) {
        addIssue(state, `${path}.props`, 'too_many_properties', `组件属性不能超过 ${CMS_TEMPLATE_DSL_LIMITS.maxAttributesPerNode} 个`);
      }
      for (const [name, value] of props) {
        if (!COMPONENT_PROPS[node.name]?.has(name)) {
          addIssue(state, `${path}.props.${name}`, 'component_prop_not_allowed', `组件属性「${name}」不在白名单`);
        }
        validateValue(value, `${path}.props.${name}`, state, aliases);
      }
      break;
    }
  }
}

export function validateCmsTemplateDsl(value: unknown): CmsTemplateValidationReport {
  const preflight = preflightCmsTemplateDsl(value);
  if (preflight.issues.length) {
    return {
      valid: false,
      version: null,
      checksum: null,
      nodeCount: 0,
      maxDepth: 0,
      issues: preflight.issues,
    };
  }
  if (preflight.bytes > CMS_TEMPLATE_DSL_LIMITS.maxDocumentBytes) {
    return {
      valid: false,
      version: null,
      checksum: null,
      nodeCount: 0,
      maxDepth: 0,
      issues: [{ path: '$', code: 'document_too_large', message: `模板不能超过 ${CMS_TEMPLATE_DSL_LIMITS.maxDocumentBytes} 字节` }],
    };
  }
  const parsed = cmsTemplateDslSchema.safeParse(value);
  if (!parsed.success) {
    return {
      valid: false,
      version: typeof (value as { version?: unknown })?.version === 'number' ? Number((value as { version: number }).version) : null,
      checksum: null,
      nodeCount: 0,
      maxDepth: 0,
      issues: zodIssues(parsed.error),
    };
  }
  const dsl = parsed.data as CmsTemplateDslDocument;
  const state: ValidationState = { issues: [], nodeCount: 0, maxDepth: 0 };
  validateNode(dsl.root, 1, '$.root', state, new Map());
  return {
    valid: state.issues.length === 0,
    version: dsl.version,
    checksum: state.issues.length === 0 ? checksumCmsTemplateDsl(dsl) : null,
    nodeCount: state.nodeCount,
    maxDepth: state.maxDepth,
    issues: state.issues,
  };
}

function readPath(root: Record<string, unknown>, path: string): unknown {
  let value: unknown = root;
  for (const segment of path.split('.')) {
    if (!value || typeof value !== 'object' || !(segment in value)) return undefined;
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

function safeUrl(value: string): string {
  const normalized = value.trim();
  if (!normalized) return '';
  if (normalized.startsWith('/') || normalized.startsWith('#') || normalized.startsWith('./') || normalized.startsWith('../')) {
    if (normalized.includes('\\') || normalized.toLowerCase().includes('javascript:')) throw new CmsTemplateDslError('模板渲染失败：URL 不安全');
    return normalized;
  }
  try {
    const url = new URL(normalized);
    if (!['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol)) throw new Error('scheme');
    return normalized;
  } catch {
    throw new CmsTemplateDslError('模板渲染失败：URL 不安全');
  }
}

interface RenderState {
  context: Record<string, unknown>;
  aliases: Record<string, unknown>;
  assetBaseUrl: string | null;
  key: string;
  budget: { nodes: number };
}

function resolveValue(value: CmsTemplateDslValue, state: RenderState, attrName?: string): CmsTemplateDslScalar {
  let resolved: unknown = value;
  if (value && typeof value === 'object') {
    if ('bind' in value) {
      resolved = readPath({ ...state.context, ...state.aliases }, value.bind);
      if (resolved === undefined || resolved === null || resolved === '') resolved = value.fallback ?? null;
    } else if ('asset' in value) {
      if (!state.assetBaseUrl || !SAFE_ASSET_PATH.test(value.asset.replaceAll('\\', '/'))) {
        throw new CmsTemplateDslError('模板渲染失败：主题资源不可用');
      }
      resolved = `${state.assetBaseUrl}/${value.asset.replaceAll('\\', '/')}`;
    }
  }
  if (resolved === undefined) return null;
  if (!['string', 'number', 'boolean'].includes(typeof resolved) && resolved !== null) {
    throw new CmsTemplateDslError('模板渲染失败：绑定结果不是标量');
  }
  if (typeof resolved === 'string') {
    if (attrName === 'href' || attrName === 'src') return safeUrl(resolved);
    if (attrName === 'className' && !SAFE_CLASS_NAME.test(resolved)) throw new CmsTemplateDslError('模板渲染失败：className 不安全');
  }
  return resolved as CmsTemplateDslScalar;
}

function collectionFor(source: string, state: RenderState): unknown[] {
  const value = readPath(state.context, source);
  if (!Array.isArray(value)) throw new CmsTemplateDslError(`模板渲染失败：集合「${source}」不可用`);
  if (value.length > MAX_COLLECTION_ITEMS) {
    throw new CmsTemplateDslError(`模板渲染失败：集合「${source}」超过 ${MAX_COLLECTION_ITEMS} 项`);
  }
  return value;
}

function SeoHead({ ctx }: { ctx: CmsBaseContext }) {
  return (
    <>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{ctx.seo.title}</title>
      {ctx.seo.keywords ? <meta name="keywords" content={ctx.seo.keywords} /> : null}
      {ctx.seo.description ? <meta name="description" content={ctx.seo.description} /> : null}
      {ctx.seo.canonical ? <link rel="canonical" href={ctx.seo.canonical} /> : null}
      <meta property="og:title" content={ctx.seo.ogTitle} />
      {ctx.seo.ogDescription ? <meta property="og:description" content={ctx.seo.ogDescription} /> : null}
      {ctx.seo.ogImage ? <meta property="og:image" content={ctx.seo.ogImage} /> : null}
      <meta name="twitter:card" content={ctx.seo.twitterCard} />
      <meta name="twitter:title" content={ctx.seo.twitterTitle} />
      {ctx.site.favicon ? <link rel="icon" href={ctx.site.favicon} /> : null}
      <meta name="generator" content="Zenith CMS Declarative DSL" />
    </>
  );
}

function SiteHeader({ ctx, state }: { ctx: CmsBaseContext; state: RenderState }) {
  const nav = collectionFor('nav', state) as CmsBaseContext['nav'];
  return (
    <header className="cms-dsl-header">
      <a href={`${ctx.baseUrl}/`}>{ctx.site.logo ? <img src={safeUrl(ctx.site.logo)} alt={ctx.site.name} /> : null}{ctx.site.name}</a>
      <nav>{nav.map((item) => <a key={item.id} href={safeUrl(item.url)} target={item.target}>{item.name}</a>)}</nav>
    </header>
  );
}

function SiteFooter({ ctx, state }: { ctx: CmsBaseContext; state: RenderState }) {
  const friendLinks = collectionFor('friendLinks', state) as CmsBaseContext['friendLinks'];
  return (
    <footer className="cms-dsl-footer">
      <span>{ctx.site.copyright ?? ctx.site.name}</span>
      {friendLinks.map((item) => <a key={item.url} href={safeUrl(item.url)} target="_blank" rel="noopener noreferrer">{item.name}</a>)}
    </footer>
  );
}

function renderComponent(node: Extract<CmsTemplateDslNode, { kind: 'component' }>, state: RenderState): ReactNode {
  const ctx = state.context as unknown as CmsBaseContext & Record<string, unknown>;
  const prop = (name: string) => node.props?.[name] === undefined ? null : resolveValue(node.props[name], state);
  switch (node.name) {
    case 'seo_head':
      return <SeoHead ctx={ctx} />;
    case 'site_header':
      return <SiteHeader ctx={ctx} state={state} />;
    case 'site_footer':
      return <SiteFooter ctx={ctx} state={state} />;
    case 'breadcrumbs': {
      const rows = collectionFor('breadcrumbs', state) as Array<{ name: string; url: string }>;
      return <nav className="cms-dsl-breadcrumbs">{rows.map((item, index) => <Fragment key={item.url}>{index ? ' / ' : ''}<a href={safeUrl(item.url)}>{item.name}</a></Fragment>)}</nav>;
    }
    case 'content_list': {
      const source = typeof prop('source') === 'string' ? String(prop('source')) : ('items' in ctx ? 'items' : 'latest');
      if (!CONTENT_COLLECTIONS.has(source)) throw new CmsTemplateDslError('模板渲染失败：内容集合不在白名单');
      const rows = collectionFor(source, state) as Array<{ id: number; title: string; url: string; summary?: string | null; publishedAt?: string | null }>;
      return <section className="cms-dsl-list">{rows.map((item) => <article key={item.id}><h2><a href={safeUrl(item.url)}>{item.title}</a></h2>{item.summary ? <p>{item.summary}</p> : null}{item.publishedAt ? <time>{item.publishedAt}</time> : null}</article>)}</section>;
    }
    case 'content_detail': {
      const content = ctx.content as { title?: string; body?: string; author?: string | null; publishedAt?: string | null } | undefined;
      if (!content) throw new CmsTemplateDslError('模板渲染失败：详情上下文不可用');
      return <article className="cms-dsl-detail"><h1>{content.title}</h1><p>{content.author} {content.publishedAt}</p><div dangerouslySetInnerHTML={{ __html: sanitizeCmsHtml(content.body) }} /></article>;
    }
    case 'pagination': {
      const pages = collectionFor('pagination.pages', state) as Array<{ page: number; url: string; current: boolean }>;
      return <nav className="cms-dsl-pagination">{pages.map((item) => item.current ? <span key={item.page}>{item.page}</span> : <a key={item.page} href={safeUrl(item.url)}>{item.page}</a>)}</nav>;
    }
    case 'fragment': {
      const code = prop('code');
      if (typeof code !== 'string' || !/^[a-z0-9-]{1,50}$/.test(code)) throw new CmsTemplateDslError('模板渲染失败：碎片编码无效');
      return <CmsFragmentContent fragment={ctx.fragments[code]} imageAlt={code} />;
    }
    case 'page_blocks': {
      const html = typeof ctx.blocksHtml === 'string' ? ctx.blocksHtml : '';
      return <section className="cms-dsl-page-blocks" dangerouslySetInnerHTML={{ __html: sanitizeCmsHtml(html) }} />;
    }
    default:
      throw new CmsTemplateDslError(`模板渲染失败：组件「${node.name}」不可用`);
  }
}

function renderNode(node: CmsTemplateDslNode, state: RenderState): ReactNode {
  state.budget.nodes += 1;
  if (state.budget.nodes > MAX_RENDERED_NODES) {
    throw new CmsTemplateDslError(`模板渲染失败：展开后节点不能超过 ${MAX_RENDERED_NODES}`);
  }
  switch (node.kind) {
    case 'element': {
      const attrs = Object.fromEntries(
        Object.entries(node.attrs ?? {}).map(([name, value]) => [name, resolveValue(value, state, name)]),
      );
      return createElement(
        node.tag,
        { ...attrs, key: state.key },
        ...(node.children ?? []).map((child, index) => renderNode(child, { ...state, key: `${state.key}.${index}` })),
      );
    }
    case 'text':
      return resolveValue(node.value, state);
    case 'binding':
      return resolveValue({ bind: node.bind, fallback: node.fallback }, state);
    case 'if': {
      const value = readPath({ ...state.context, ...state.aliases }, node.bind);
      const children = value ? node.children : (node.fallback ?? []);
      return <Fragment key={state.key}>{children.map((child, index) => renderNode(child, { ...state, key: `${state.key}.${index}` }))}</Fragment>;
    }
    case 'each': {
      const rows = collectionFor(node.source, state);
      const children = rows.length ? node.children : (node.empty ?? []);
      if (!rows.length) return <Fragment key={state.key}>{children.map((child, index) => renderNode(child, { ...state, key: `${state.key}.empty.${index}` }))}</Fragment>;
      const alias = node.item ?? 'item';
      return <Fragment key={state.key}>{rows.flatMap((item, rowIndex) => children.map((child, index) => renderNode(child, {
        ...state,
        aliases: { ...state.aliases, [alias]: item },
        key: `${state.key}.${rowIndex}.${index}`,
      })))}</Fragment>;
    }
    case 'rich_text': {
      const value = readPath(state.context, node.bind);
      if (typeof value !== 'string') throw new CmsTemplateDslError(`模板渲染失败：富文本绑定「${node.bind}」不可用`);
      return <div key={state.key} className={node.className} dangerouslySetInnerHTML={{ __html: sanitizeCmsHtml(value) }} />;
    }
    case 'component':
      return <Fragment key={state.key}>{renderComponent(node, state)}</Fragment>;
  }
}

export function renderCmsTemplateDsl(
  dsl: CmsTemplateDslDocument,
  context: Record<string, unknown>,
  options?: { assetBaseUrl?: string | null },
): string {
  const report = validateCmsTemplateDsl(dsl);
  if (!report.valid) throw new CmsTemplateDslError('模板验证失败，拒绝渲染', report.issues);
  try {
    return '<!DOCTYPE html>' + renderToStaticMarkup(
      <>{renderNode(dsl.root, {
        context,
        aliases: {},
        assetBaseUrl: options?.assetBaseUrl ?? null,
        key: 'root',
        budget: { nodes: 0 },
      })}</>,
    );
  } catch (error) {
    if (error instanceof CmsTemplateDslError) throw error;
    throw new CmsTemplateDslError(`模板渲染失败：${error instanceof Error ? error.message : '未知错误'}`);
  }
}
