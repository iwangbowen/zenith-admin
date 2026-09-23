import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import type { AnyNode } from 'domhandler';
import { CMS_DOCUMENT_TAGS, serializeCmsBodyDocument, type CmsBodyDocument, type CmsDocumentNode, type CmsFieldConfiguration } from '@zenith/shared/cms';
import { sanitizeCmsHtml } from './cms-html-sanitizer';

const require = createRequire(import.meta.url);
const tags = new Set<string>(CMS_DOCUMENT_TAGS);

/** HTML is an import boundary. Stored documents use a sanitized, editor-independent tree. */
export function normalizeCmsContentDocument(html: string, previous?: CmsBodyDocument): CmsBodyDocument {
  const { load } = require('cheerio') as typeof import('cheerio');
  const $ = load(sanitizeCmsHtml(html), {}, false);
  const existing = new Map<string, CmsDocumentNode[]>();
  const fingerprint = (node: CmsDocumentNode): string => node.kind === 'text'
    ? `text:${node.text}` : `${node.tag}:${JSON.stringify(node.attributes)}:${node.children.map(fingerprint).join('|')}`;
  const remember = (node: CmsDocumentNode) => {
    const key = fingerprint(node);
    existing.set(key, [...(existing.get(key) ?? []), node]);
    if (node.kind === 'element') node.children.forEach(remember);
  };
  previous?.nodes.forEach(remember);
  let count = 0;
  const walk = (node: AnyNode, depth: number, prior?: CmsDocumentNode): CmsDocumentNode[] => {
    if (++count > 20_000 || depth > 64) throw new Error('正文结构超过最大深度或节点数量');
    let result: CmsDocumentNode;
    if (node.type === 'text') result = { id: randomUUID(), kind: 'text', text: node.data };
    else if ('name' in node && 'children' in node && tags.has(node.name)) {
      result = { id: randomUUID(), kind: 'element', tag: node.name as (typeof CMS_DOCUMENT_TAGS)[number], attributes: { ...node.attribs },
        children: node.children.flatMap((child, index) => walk(child, depth + 1, prior?.kind === 'element' ? prior.children[index] : undefined)) };
    } else return [];
    const matches = existing.get(fingerprint(result));
    const exact = matches?.shift();
    // Unchanged nodes survive reorder; edited nodes retain their structural position identity.
    if (exact) result.id = exact.id;
    else if (prior?.kind === result.kind && (prior.kind === 'text' || (result.kind === 'element' && prior.tag === result.tag))) result.id = prior.id;
    return [result];
  };
  const nodes = $.root().contents().toArray().flatMap((node, index) => walk(node, 0, previous?.nodes[index]));
  const used = new Set<string>();
  const deduplicate = (node: CmsDocumentNode) => {
    if (used.has(node.id)) node.id = randomUUID();
    used.add(node.id);
    if (node.kind === 'element') node.children.forEach(deduplicate);
  };
  nodes.forEach(deduplicate);
  return { schemaVersion: 1, nodes };
}

export function renderCmsContentDocument(document: CmsBodyDocument): string {
  return sanitizeCmsHtml(serializeCmsBodyDocument(document));
}

export function sanitizeCmsModelValues(fields: readonly { name: string; fieldType: string; configuration?: CmsFieldConfiguration | null }[], values: Record<string, unknown>): Record<string, unknown> {
  const result = { ...values };
  for (const field of fields) {
    const value = result[field.name];
    if (field.fieldType === 'richtext' && typeof value === 'string') result[field.name] = sanitizeCmsHtml(value);
    if (field.fieldType === 'object' && value && typeof value === 'object' && !Array.isArray(value)) result[field.name] = sanitizeCmsModelValues(field.configuration?.fields ?? [], value as Record<string, unknown>);
    if (['array', 'blocks'].includes(field.fieldType) && Array.isArray(value)) result[field.name] = value.map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
      const children = field.fieldType === 'blocks' ? field.configuration?.blockTypes?.find((block) => block.code === item.blockType)?.fields : field.configuration?.fields;
      return sanitizeCmsModelValues(children ?? [], item);
    });
  }
  return result;
}
