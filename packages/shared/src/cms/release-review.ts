import { stableStringify } from '../core/json';

const AUDIT_FIELDS = new Set(['createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'created_at', 'updated_at', 'created_by', 'updated_by', 'version', 'viewCount', 'likeCount', 'favoriteCount', 'view_count', 'like_count', 'favorite_count', 'publicRevision', 'public_revision', 'template_refs_revision', 'theme_revision']);

const FIELD_LABELS: Record<string, string> = {
  title: '标题', subTitle: '副标题', shortTitle: '短标题', titleStyle: '标题样式', summary: '摘要', body: '正文', bodyDocument: '正文结构', coverImage: '封面图片',
  mediaData: '音视频与图集', attachments: '附件', assetVersions: '固定素材版本', media: '固定媒体产物', modelId: '内容模型', modelVersionId: '模型版本', extend: '扩展字段',
  seoTitle: 'SEO 标题', seoKeywords: 'SEO 关键词', seoDescription: 'SEO 描述', slug: '访问标识', staticPath: '自定义地址', externalLink: '跳转链接',
  name: '名称', code: '标识', path: '访问路径', channelId: '所属栏目', parentId: '父栏目', extraChannelIds: '附加栏目', tagIds: '标签', relatedIds: '关联内容',
  logo: '品牌标志', favicon: '站点图标', theme: '主题', settings: '站点配置', blocks: '页面区块', isHome: '首页接管', items: '部件内容', publishedData: '部件内容', publishedName: '部件名称',
  status: '状态', visible: '导航可见', sort: '排序', defaultRendererKey: '部件样式', widgetId: '页面部件', field: '引用位置', rendererKey: '展示样式',
  pageContent: '栏目单页正文', pageSize: '每页条数', listTemplate: '列表模板', detailTemplate: '详情模板', detailPathRule: '详情地址规则', staticMode: '渲染方式',
  author: '作者', editor: '责任编辑', source: '来源', sourceUrl: '来源链接', isOriginal: '原创', ownerId: '负责人', dueAt: '截止时间',
  keywords: '关键词', description: '描述', url: '文件地址', thumbUrl: '缩略图', width: '宽度', height: '高度', size: '文件大小', mimeType: '文件类型',
};
export function cmsReleaseFieldLabel(path: string): string {
  const camel = path.replace(/_([a-z])/g, (_match, char: string) => char.toUpperCase());
  return FIELD_LABELS[camel] ?? path;
}
/** Only business fields are compared; array ordering remains meaningful for navigation and blocks. */
export function cmsReleaseFieldDiffs(before: Record<string, unknown> | null, after: Record<string, unknown> | null) {
  const fields: { path: string; before: unknown; after: unknown }[] = [];
  for (const key of [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].sort()) {
    if (AUDIT_FIELDS.has(key)) continue;
    const left = before?.[key] ?? null; const right = after?.[key] ?? null;
    if (stableStringify(left) !== stableStringify(right)) fields.push({ path: key, before: left, after: right });
  }
  return fields;
}
