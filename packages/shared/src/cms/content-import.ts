import type { ImportColumnMeta } from '../tasks/contracts/import-jobs';
import { createCmsContentSchema } from './validation';

/** 模板、真实导入与 Demo 共用字段定义。素材使用站内引用或资源 URL。 */
export const CMS_CONTENT_IMPORT_COLUMNS: ImportColumnMeta[] = [
  { key: 'title', header: '标题', required: true, example: '街角的一天' },
  { key: 'channelCode', header: '栏目编码', note: '留空使用导入时选择的栏目' },
  { key: 'contentType', header: '内容形态', enumValues: ['article', 'album', 'media', 'link'], note: '留空为 article' },
  { key: 'slug', header: '内容标识', note: '小写字母、数字与中划线' },
  { key: 'subTitle', header: '副标题' },
  { key: 'summary', header: '摘要' },
  { key: 'body', header: '正文', note: '支持 HTML' },
  { key: 'author', header: '作者' },
  { key: 'source', header: '来源' },
  { key: 'sourceUrl', header: '来源链接' },
  { key: 'coverImage', header: '封面', note: 'cms-res://素材ID 或图片 URL；须属于当前站点' },
  { key: 'tagSlugs', header: '标签标识', note: '已有标签 slug，多个用英文逗号分隔；未知标签报错' },
  { key: 'modelCode', header: '模型编码', note: '已有模型编码；留空跟随栏目模型' },
  { key: 'extend', header: '模型字段JSON', note: 'JSON 对象，例如 {"venue":"城市书房"}' },
  { key: 'images', header: '图集JSON', note: 'JSON 数组，例如 [{"url":"cms-res://1","caption":"街角"}]' },
  { key: 'mediaType', header: '媒体类型', enumValues: ['video', 'audio'] },
  { key: 'mediaUrl', header: '媒体地址', note: 'cms-res://素材ID 或媒体 URL' },
  { key: 'poster', header: '海报地址' },
  { key: 'duration', header: '媒体时长', note: '例如 02:30' },
  { key: 'externalLink', header: '跳转链接', note: '站内路径、站内实体引用或 http(s) 外链' },
  { key: 'attachments', header: '附件JSON', note: 'JSON 数组，例如 [{"name":"观察表","url":"cms-res://2"}]' },
  { key: 'seoTitle', header: 'SEO标题' },
  { key: 'seoKeywords', header: 'SEO关键词' },
  { key: 'seoDescription', header: 'SEO描述' },
  { key: 'isTop', header: '置顶', enumValues: ['是', '否'] },
  { key: 'isRecommend', header: '推荐', enumValues: ['是', '否'] },
  { key: 'isHot', header: '热门', enumValues: ['是', '否'] },
  { key: 'isOriginal', header: '原创', enumValues: ['是', '否'] },
  { key: 'sort', header: '排序', note: '整数，留空为 0' },
];

function jsonCell(value: string | undefined, label: string, fallback: unknown): unknown {
  if (!value?.trim()) return fallback;
  try { return JSON.parse(value); } catch { throw new Error(`${label}不是有效的 JSON`); }
}

function booleanCell(value: string | undefined, label: string): boolean {
  if (!value || ['否', 'false', '0'].includes(value)) return false;
  if (['是', 'true', '1'].includes(value)) return true;
  throw new Error(`${label}仅支持是/否、true/false 或 1/0`);
}

export function parseCmsContentImportCells(cells: Record<string, string>, target: {
  siteId: number; channelId: number; modelId?: number | null; tagIds: number[];
}) {
  const textKeys = ['title', 'slug', 'subTitle', 'summary', 'body', 'author', 'source', 'sourceUrl', 'coverImage', 'externalLink', 'seoTitle', 'seoKeywords', 'seoDescription'] as const;
  const text = Object.fromEntries(textKeys.filter((key) => cells[key]?.trim()).map((key) => [key, cells[key].trim()]));
  const parsed = createCmsContentSchema.safeParse({
    ...text, ...target, contentType: cells.contentType || 'article',
    extend: jsonCell(cells.extend, '模型字段', {}), attachments: jsonCell(cells.attachments, '附件', []),
    mediaData: {
      ...(cells.images ? { images: jsonCell(cells.images, '图集', []) } : {}),
      ...Object.fromEntries(['mediaType', 'mediaUrl', 'poster', 'duration'].filter((key) => cells[key]).map((key) => [key, cells[key]])),
    },
    isTop: booleanCell(cells.isTop, '置顶'), isRecommend: booleanCell(cells.isRecommend, '推荐'),
    isHot: booleanCell(cells.isHot, '热门'), isOriginal: booleanCell(cells.isOriginal, '原创'),
    sort: cells.sort ? Number(cells.sort) : 0,
  });
  if (!parsed.success) throw new Error(parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('；'));
  const row = parsed.data;
  if (row.contentType === 'media' && (!row.mediaData.mediaType || !row.mediaData.mediaUrl)) throw new Error('音视频须填写媒体类型和媒体地址');
  if (row.contentType === 'album' && !row.mediaData.images?.length) throw new Error('图集须至少提供一张图片');
  if (row.contentType === 'link' && !row.externalLink) throw new Error('跳转内容须填写跳转链接');
  return row;
}
