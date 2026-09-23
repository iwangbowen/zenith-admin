import DOMPurify from 'dompurify';
import type { CmsModelField } from '@zenith/shared/cms';
import { formatBytes } from '@zenith/shared/core';
import { formatDate, formatDateTimeForApi } from '@/utils/date';
import { cmsFieldDisplayText } from './cms-field-display';

const TEXT_FIELDS = {
  title: '标题', subTitle: '副标题', shortTitle: '短标题', summary: '摘要', body: '正文',
  coverImage: '封面图片', author: '作者', editor: '责任编辑', source: '来源', sourceUrl: '来源链接',
  externalLink: '跳转链接', locale: '内容语言', slug: 'URL 标识', staticPath: '静态路径', detailTemplate: '详情模板',
  seoTitle: 'SEO 标题', seoKeywords: 'SEO 关键词', seoDescription: 'SEO 描述', socialImageAlt: '社交图片说明', twitterCreator: '社交作者',
} as const;
const DATE_FIELDS = { dueAt: '审稿截止时间', scheduledAt: '计划发布时间', expireAt: '过期下线时间', topExpireAt: '置顶到期时间' } as const;
const OTHER_FIELDS = { channelId: '所属栏目', modelId: '内容模型', ownerId: '内容负责人', tagIds: '标签', extraChannelIds: '副栏目', relatedIds: '相关文章', titleStyle: '标题样式', isTop: '置顶', isRecommend: '推荐', isHot: '热门', isOriginal: '原创', topWeight: '置顶权重', sort: '排序权重', attachments: '附件', albumImages: '图集', mediaType: '媒体类型', mediaUrl: '媒体地址', mediaPoster: '媒体海报', mediaDuration: '媒体时长' } as const;

export interface CmsContentConflictRow {
  key: string;
  label: string;
  base: unknown;
  server: unknown;
  local: unknown;
  field?: CmsModelField;
  change: 'server' | 'local' | 'both' | 'same';
}

function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
const nullable = (value: unknown) => value === '' || value === undefined ? null : value;
const ids = (value: unknown, unordered = false) => {
  const result = Array.isArray(value) ? value.map(Number) : [];
  return unordered ? result.toSorted((a, b) => a - b) : result;
};
function normalize(source: Record<string, unknown>, local: boolean, contentType: unknown) {
  const values: Record<string, unknown> = {};
  for (const key of Object.keys(TEXT_FIELDS)) values[key] = nullable(source[key]);
  for (const key of Object.keys(DATE_FIELDS)) {
    const value = source[key];
    values[key] = value ? formatDateTimeForApi(value as string | Date) : null;
  }
  for (const key of ['channelId', 'modelId', 'ownerId']) values[key] = source[key] == null || source[key] === '' ? null : Number(source[key]);
  for (const key of ['isTop', 'isRecommend', 'isHot', 'isOriginal']) values[key] = !!source[key];
  values.topWeight = Number(source.topWeight ?? 0);
  values.sort = Number(source.sort ?? 0);
  values.tagIds = ids(source.tagIds, true);
  values.extraChannelIds = ids(source.extraChannelIds, true);
  values.relatedIds = ids(source.relatedIds);
  const style = object(source.titleStyle);
  values.titleStyle = { bold: local ? !!source.titleBold : !!style.bold, color: nullable(local ? source.titleColor : style.color) };
  values.attachments = (Array.isArray(source.attachments) ? source.attachments : []).map((entry) => {
    const item = object(entry);
    return { name: nullable(item.name), url: nullable(item.url), size: Number(item.size ?? 0) };
  });
  const media = object(source.mediaData);
  const album = local ? source.albumImages : media.images;
  values.albumImages = contentType === 'album' && Array.isArray(album) ? album.map((entry) => { const image = object(entry); return { url: nullable(image.url), caption: nullable(image.caption) }; }) : [];
  values.mediaType = contentType === 'media' ? (local ? source.mediaType : media.mediaType) ?? 'video' : null;
  values.mediaUrl = contentType === 'media' ? nullable(local ? source.mediaUrl : media.mediaUrl) : null;
  values.mediaPoster = contentType === 'media' ? nullable(local ? source.mediaPoster : media.poster) : null;
  values.mediaDuration = contentType === 'media' ? nullable(local ? source.mediaDuration : media.duration) : null;
  values.extend = object(source.extend);
  return values;
}
function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(formatDateTimeForApi(value));
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).toSorted(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(nullable(value)) ?? 'null';
}
type ValueField = Pick<CmsModelField, 'fieldType'> & Partial<Pick<CmsModelField, 'configuration'>>;
function normalizeModelValue(value: unknown, field: ValueField): unknown {
  if (value == null || value === '') return null;
  if (field.fieldType === 'date') return formatDate(value as Date | string);
  if (field.fieldType === 'datetime') return formatDateTimeForApi(value as Date | string);
  if (field.fieldType === 'number') return Number(value);
  if (Array.isArray(value)) return value.map((entry) => normalizeModelValue(entry, { ...field, fieldType: 'object' }));
  if (typeof value === 'object') {
    const record = object(value);
    const fields = field.configuration?.blockTypes?.find((block) => block.code === record.blockType)?.fields ?? field.configuration?.fields ?? [];
    return Object.fromEntries(Object.entries(record).map(([name, entry]) => {
      const child = fields.find((candidate) => candidate.name === name);
      return [name, child ? normalizeModelValue(entry, child) : entry];
    }));
  }
  return value;
}

/** 仅枚举业务白名单和模型字段；临时表单键先归一，不把版本/AST/审计元数据混入对照。 */
export function buildCmsContentConflictRows(base: Record<string, unknown>, server: Record<string, unknown>, local: Record<string, unknown>, fields: readonly CmsModelField[] = []): CmsContentConflictRow[] {
  const kind = base.contentType ?? server.contentType;
  const before = normalize(base, false, kind);
  const remote = normalize(server, false, kind);
  const working = normalize(local, true, kind);
  const definitions = new Map<string, CmsModelField>();
  for (const field of [...(Array.isArray(base.modelFields) ? base.modelFields as CmsModelField[] : []), ...(Array.isArray(server.modelFields) ? server.modelFields as CmsModelField[] : []), ...fields]) definitions.set(field.name, field);
  const rows: CmsContentConflictRow[] = [];
  const add = (key: string, label: string, a: unknown, b: unknown, c: unknown, field?: CmsModelField) => {
    const remoteChanged = canonical(a) !== canonical(b);
    const localChanged = canonical(a) !== canonical(c);
    if (!remoteChanged && !localChanged) return;
    rows.push({ key, label, base: a, server: b, local: c, field, change: remoteChanged && localChanged ? canonical(b) === canonical(c) ? 'same' : 'both' : remoteChanged ? 'server' : 'local' });
  };
  for (const [key, label] of Object.entries({ ...TEXT_FIELDS, ...DATE_FIELDS, ...OTHER_FIELDS })) add(key, label, before[key], remote[key], working[key]);
  for (const field of definitions.values()) add(`extend.${field.name}`, field.label,
    normalizeModelValue(object(before.extend)[field.name], field), normalizeModelValue(object(remote.extend)[field.name], field), normalizeModelValue(object(working.extend)[field.name], field), field);
  return rows;
}

export function cmsConflictValueText(row: CmsContentConflictRow, value: unknown, names: { channels?: ReadonlyMap<number, string>; models?: ReadonlyMap<number, string>; users?: ReadonlyMap<number, string>; tags?: ReadonlyMap<number, string> } = {}): string {
  if (value == null || value === '') return '（空）';
  if (row.field) return cmsFieldDisplayText(value, row.field);
  if (row.key === 'body') return DOMPurify.sanitize(String(value).replace(/<\/(?:p|div|h[1-6]|li|blockquote|tr)>|<br\s*\/?>/gi, '\n'), { ALLOWED_TAGS: [] }).trim() || '（空）';
  const lookup = row.key === 'channelId' ? names.channels : row.key === 'modelId' ? names.models : row.key === 'ownerId' ? names.users : undefined;
  if (lookup) return lookup.get(Number(value)) ?? `#${String(value)}`;
  if (['tagIds', 'extraChannelIds', 'relatedIds'].includes(row.key) && Array.isArray(value)) {
    const options = row.key === 'tagIds' ? names.tags : row.key === 'extraChannelIds' ? names.channels : undefined;
    return value.length ? value.map((id) => options?.get(Number(id)) ?? `${row.key === 'relatedIds' ? '内容 ' : ''}#${id}`).join('、') : '（空）';
  }
  if (row.key === 'titleStyle') { const style = object(value); return [style.bold ? '加粗' : '常规字重', style.color ? `颜色 ${style.color}` : '默认颜色'].join('，'); }
  if (row.key === 'mediaType') return value === 'audio' ? '音频' : '视频';
  if (row.key === 'attachments' && Array.isArray(value)) return value.length ? value.map((entry) => { const item = object(entry); return `${item.name || '未命名附件'}（${formatBytes(Number(item.size ?? 0))}）\n${item.url || ''}`; }).join('\n\n') : '（空）';
  if (row.key === 'albumImages' && Array.isArray(value)) return value.length ? value.map((entry, index) => { const item = object(entry); return `图片 ${index + 1}：${item.caption || '无说明'}\n${item.url || ''}`; }).join('\n\n') : '（空）';
  return cmsFieldDisplayText(value);
}
