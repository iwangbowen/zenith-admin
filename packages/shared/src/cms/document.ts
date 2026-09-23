import * as z from 'zod';
import { escapeHtml } from '../core/text';

export const CMS_DOCUMENT_TAGS = ['p', 'br', 'hr', 'div', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup', 'blockquote', 'pre', 'code', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'a', 'img', 'figure', 'figcaption', 'video', 'audio', 'source'] as const;
const textNodeSchema = z.object({ id: z.string().min(1).max(100), kind: z.literal('text'), text: z.string().max(2_000_000) });
const elementFieldsSchema = z.object({
  id: z.string().min(1).max(100), kind: z.literal('element'), tag: z.enum(CMS_DOCUMENT_TAGS),
  attributes: z.record(z.string().max(100), z.string().max(10_000)),
});
export type CmsDocumentNode = z.infer<typeof textNodeSchema> | (z.infer<typeof elementFieldsSchema> & { children: CmsDocumentNode[] });
export const cmsDocumentNodeSchema: z.ZodType<CmsDocumentNode> = z.union([
  textNodeSchema,
  elementFieldsSchema.extend({ get children() { return z.array(cmsDocumentNodeSchema).max(10_000); } }),
]);
export const cmsBodyDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  nodes: z.array(cmsDocumentNodeSchema).max(10_000),
}).meta({ id: 'CmsBodyDocument' });
export type CmsBodyDocument = z.infer<typeof cmsBodyDocumentSchema>;

const voidTags = new Set<string>(['br', 'hr', 'img', 'source']);
/** The server sanitizes this projection before storage; consumers never execute raw attributes. */
export function serializeCmsBodyDocument(document: CmsBodyDocument): string {
  const render = (node: CmsDocumentNode): string => {
    if (node.kind === 'text') return escapeHtml(node.text);
    const attributes = Object.entries(node.attributes)
      .filter(([key]) => /^[a-z][a-z0-9-]*$/.test(key) && !key.startsWith('on'))
      .map(([key, value]) => ` ${key}="${escapeHtml(value)}"`).join('');
    return `<${node.tag}${attributes}>${voidTags.has(node.tag) ? '' : `${node.children.map(render).join('')}</${node.tag}>`}`;
  };
  return document.nodes.map(render).join('');
}

export function cmsDocumentText(document: CmsBodyDocument): string {
  const text = (node: CmsDocumentNode): string => node.kind === 'text' ? node.text : `${node.children.map(text).join('')} `;
  return document.nodes.map(text).join('').trim();
}
