import { CMS_PAGE_BLOCK_TYPES, type CmsPageBlock, type CmsPageBlockType } from '@zenith/shared';
import { HTTPException } from 'hono/http-exception';
import { sanitizeCmsHtml } from './cms-html-sanitizer';

const allowedTypes = new Set<CmsPageBlockType>(CMS_PAGE_BLOCK_TYPES.map((item) => item.value));

function sanitizeProps(value: unknown, key?: string): unknown {
  if (key === 'html' && typeof value === 'string') return sanitizeCmsHtml(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeProps(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([nestedKey, nested]) => [
        nestedKey,
        sanitizeProps(nested, nestedKey),
      ]),
    );
  }
  return value;
}

export function sanitizeCmsPageBlocks(value: unknown): CmsPageBlock[] {
  if (!Array.isArray(value)) {
    throw new HTTPException(400, { message: '页面区块必须是数组' });
  }
  if (value.length > 50) throw new HTTPException(400, { message: '区块数量超出上限（50）' });
  const ids = new Set<string>();
  return value.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new HTTPException(400, { message: `第 ${index + 1} 个页面区块格式无效` });
    }
    const block = raw as Record<string, unknown>;
    const id = typeof block.id === 'string' ? block.id.trim() : '';
    if (!id || id.length > 100 || ids.has(id)) {
      throw new HTTPException(400, { message: `第 ${index + 1} 个页面区块 id 无效或重复` });
    }
    if (typeof block.type !== 'string' || !allowedTypes.has(block.type as CmsPageBlockType)) {
      throw new HTTPException(400, { message: `第 ${index + 1} 个页面区块类型无效` });
    }
    if (!block.props || typeof block.props !== 'object' || Array.isArray(block.props)) {
      throw new HTTPException(400, { message: `第 ${index + 1} 个页面区块 props 格式无效` });
    }
    ids.add(id);
    return {
      id,
      type: block.type as CmsPageBlockType,
      props: sanitizeProps(block.props) as Record<string, unknown>,
    };
  });
}
