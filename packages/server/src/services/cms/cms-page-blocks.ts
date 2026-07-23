import { CMS_PAGE_BLOCK_TYPES, type CmsPageBlock, type CmsPageBlockType } from '@zenith/shared';
import { HTTPException } from 'hono/http-exception';
import { isDeepStrictEqual } from 'node:util';
import dayjs from 'dayjs';
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
    const display = block.displayCondition;
    let displayCondition: CmsPageBlock['displayCondition'];
    if (display !== undefined) {
      if (!display || typeof display !== 'object' || Array.isArray(display)) {
        throw new HTTPException(400, { message: `第 ${index + 1} 个页面区块展示条件无效` });
      }
      const rawDisplay = display as Record<string, unknown>;
      const audience = rawDisplay.audience ?? 'always';
      if (!['always', 'guest', 'member'].includes(String(audience))) {
        throw new HTTPException(400, { message: `第 ${index + 1} 个页面区块受众条件无效` });
      }
      const startAt = rawDisplay.startAt == null ? null : String(rawDisplay.startAt);
      const endAt = rawDisplay.endAt == null ? null : String(rawDisplay.endAt);
      if (startAt && !dayjs(startAt).isValid()) {
        throw new HTTPException(400, { message: `第 ${index + 1} 个页面区块开始时间无效` });
      }
      if (endAt && !dayjs(endAt).isValid()) {
        throw new HTTPException(400, { message: `第 ${index + 1} 个页面区块结束时间无效` });
      }
      if (startAt && endAt && dayjs(startAt).isAfter(dayjs(endAt))) {
        throw new HTTPException(400, { message: `第 ${index + 1} 个页面区块结束时间不能早于开始时间` });
      }
      displayCondition = {
        audience: audience as 'always' | 'guest' | 'member',
        ...(startAt ? { startAt } : {}),
        ...(endAt ? { endAt } : {}),
      };
    }
    return {
      id,
      type: block.type as CmsPageBlockType,
      props: sanitizeProps(block.props) as Record<string, unknown>,
      ...(displayCondition ? { displayCondition } : {}),
    };
  });
}

export function cmsPageRequiresDynamic(blocks: readonly CmsPageBlock[]): boolean {
  return blocks.some((block) => {
    const audience = block.displayCondition?.audience ?? 'always';
    return audience === 'guest'
      || audience === 'member'
      || !!block.displayCondition?.startAt
      || !!block.displayCondition?.endAt;
  });
}

export function isCmsPageBlockVisible(
  block: CmsPageBlock,
  viewer: { member: boolean; now?: Date | string | number },
): boolean {
  const condition = block.displayCondition;
  if (!condition) return true;
  const now = dayjs(viewer.now);
  if (condition.startAt && now.isBefore(dayjs(condition.startAt))) return false;
  if (condition.endAt && now.isAfter(dayjs(condition.endAt))) return false;
  if (condition.audience === 'guest') return !viewer.member;
  if (condition.audience === 'member') return viewer.member;
  return true;
}

export function filterCmsPageBlocksForViewer(
  blocks: readonly CmsPageBlock[],
  viewer: { member: boolean; now?: Date | string | number },
): CmsPageBlock[] {
  return blocks.filter((block) => isCmsPageBlockVisible(block, viewer));
}

export function filterCmsPageBlocksForStatic(blocks: readonly CmsPageBlock[]): CmsPageBlock[] {
  return blocks.filter((block) =>
    (block.displayCondition?.audience ?? 'always') === 'always'
    && isCmsPageBlockVisible(block, { member: false }));
}

export function assertCmsPageBlockMutationAllowed(input: {
  before: readonly CmsPageBlock[];
  after: readonly CmsPageBlock[];
  manageableBlockIds: ReadonlySet<string>;
  canCreate: boolean;
}): void {
  const beforeIds = new Set(input.before.map((block) => block.id));
  if (!input.canCreate && input.after.some((block) => !beforeIds.has(block.id))) {
    throw new HTTPException(403, { message: '无页面编辑权限，不能创建新区块' });
  }
  const immutableBefore = input.before.filter((block) => !input.manageableBlockIds.has(block.id));
  const immutableIds = new Set(immutableBefore.map((block) => block.id));
  const immutableAfter = input.after.filter((block) => immutableIds.has(block.id));
  if (
    immutableBefore.length !== immutableAfter.length
    || immutableBefore.some((block, index) => {
      const candidate = immutableAfter[index];
      return !candidate || candidate.id !== block.id || !isDeepStrictEqual(candidate, block);
    })
  ) {
    const changed = immutableBefore.find((block, index) => {
      const candidate = immutableAfter[index];
      return !candidate || candidate.id !== block.id || !isDeepStrictEqual(candidate, block);
    });
    if (changed) {
      throw new HTTPException(403, { message: `区块「${changed.id}」不可管理，禁止修改、删除、替换或重排只读区块` });
    }
    if (immutableBefore.length !== immutableAfter.length) {
      throw new HTTPException(403, { message: '不可管理区块禁止删除或替换' });
    }
  }
}
