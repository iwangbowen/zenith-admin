import type { CmsFragmentType } from '@zenith/shared';
import { HTTPException } from 'hono/http-exception';
import { sanitizeCmsHtml } from './cms-html-sanitizer';

const fragmentTypes = new Set<CmsFragmentType>(['html', 'text', 'image', 'json']);

export function sanitizeCmsFragmentContent(
  type: CmsFragmentType | string,
  content: unknown,
): string | null {
  if (!fragmentTypes.has(type as CmsFragmentType)) {
    throw new HTTPException(400, { message: '碎片类型无效' });
  }
  if (content === null || content === undefined) return null;
  if (typeof content !== 'string') {
    throw new HTTPException(400, { message: '碎片内容必须是字符串或 null' });
  }
  if (type === 'html') return sanitizeCmsHtml(content);
  if (type !== 'json') return content;
  try {
    return JSON.stringify(JSON.parse(content));
  } catch {
    throw new HTTPException(400, { message: 'JSON 碎片内容格式无效' });
  }
}

export const sanitizeCmsImportedFragment = sanitizeCmsFragmentContent;
