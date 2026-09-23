import { Descriptions, Image, Space, Tag, Typography } from '@douyinfe/semi-ui';
import DOMPurify from 'dompurify';
import { CMS_CONTENT_STATUS_LABELS, CMS_CONTENT_TYPE_LABELS, type CmsContent, type CmsModelField } from '@zenith/shared/cms';
import { formatBytes } from '@zenith/shared/core';
import { formatDateTime } from '@/utils/date';
import { EMPTY_PLACEHOLDER } from '@/utils/table-columns';
import { cmsModelFieldOptions } from './model-field-renderer';
import './ContentRevisionViewer.css';

/** 审批、历史和业务详情共用完整稿件视图；调用方获取有权查看的确定修订。 */
export function ContentRevisionViewer({ content, fields = content.modelFields ?? [], heading = '稿件详情' }: Readonly<{
  content: CmsContent;
  fields?: readonly CmsModelField[];
  heading?: string;
}>) {
  const valueText = (value: unknown): string => {
    if (value == null || value === '') return EMPTY_PLACEHOLDER;
    if (typeof value === 'boolean') return value ? '是' : '否';
    return typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
  };
  const fieldMap = new Map(fields.map((field) => [field.name, field]));
  const safeLink = (value: string | null | undefined) => value && /^(https?:\/\/|\/(?!\/))/.test(value) ? value : undefined;
  return (
    <Space vertical align="start" spacing={20} style={{ width: '100%' }}>
      <div style={{ width: '100%' }}>
        <Typography.Title heading={5}>{heading}</Typography.Title>
        <Space wrap><Tag>{CMS_CONTENT_TYPE_LABELS[content.contentType]}</Tag><Tag>{CMS_CONTENT_STATUS_LABELS[content.status]}</Tag><Typography.Text type="tertiary">{content.revisionId ? `固定修订 #${content.revisionId}` : `工作稿 v${content.version}`}</Typography.Text></Space>
        <Typography.Title heading={4}>{content.title || '未命名内容'}</Typography.Title>
        {content.subTitle ? <Typography.Paragraph>{content.subTitle}</Typography.Paragraph> : null}
        {content.summary ? <Typography.Paragraph type="secondary">{content.summary}</Typography.Paragraph> : null}
        {content.coverImage ? <Image src={content.coverImage} alt={content.socialImageAlt || content.title} width={240} /> : null}
      </div>
      <Descriptions row data={[
        { key: '语言', value: content.locale },
        { key: '内容负责人', value: content.ownerId ? `用户 #${content.ownerId}` : EMPTY_PLACEHOLDER },
        { key: '审稿截止', value: content.dueAt ? formatDateTime(content.dueAt) : EMPTY_PLACEHOLDER },
        { key: '源修订', value: content.sourceRevisionId ? `#${content.sourceRevisionId}` : EMPTY_PLACEHOLDER },
        { key: '栏目', value: content.channelName ?? `#${content.channelId}` },
        { key: '作者 / 责任编辑', value: [content.author, content.editor].filter(Boolean).join(' / ') || EMPTY_PLACEHOLDER },
        { key: '来源', value: content.source || EMPTY_PLACEHOLDER },
        { key: '来源链接', value: safeLink(content.sourceUrl) ? <a href={safeLink(content.sourceUrl)} target="_blank" rel="noreferrer">{content.sourceUrl}</a> : valueText(content.sourceUrl) },
        { key: '标签', value: content.tags?.map((tag) => tag.name).join('、') || content.tagIds?.join('、') || EMPTY_PLACEHOLDER },
        { key: '副栏目', value: content.extraChannelIds?.join('、') || EMPTY_PLACEHOLDER },
        { key: '相关文章', value: content.relatedIds?.join('、') || EMPTY_PLACEHOLDER },
        { key: '属性', value: [content.isOriginal && '原创', content.isTop && `置顶 ${content.topWeight}`, content.isRecommend && '推荐', content.isHot && '热门'].filter(Boolean).join('、') || EMPTY_PLACEHOLDER },
      ]} />
      {content.externalLink ? <div><Typography.Text strong>跳转链接：</Typography.Text>{safeLink(content.externalLink) ? <a href={safeLink(content.externalLink)} target="_blank" rel="noreferrer">{content.externalLink}</a> : content.externalLink}</div> : null}
      {content.mediaData.images?.length ? <div style={{ width: '100%' }}><Typography.Title heading={6}>图集</Typography.Title><Space wrap align="start">{content.mediaData.images.map((item, index) => <figure key={`${item.url}-${index}`} style={{ margin: 0, maxWidth: 240 }}><Image src={item.url} alt={item.caption || `图片 ${index + 1}`} width={240} /><figcaption>{item.caption}</figcaption></figure>)}</Space></div> : null}
      {content.mediaData.mediaUrl ? <div style={{ width: '100%' }}><Typography.Title heading={6}>音视频</Typography.Title>{content.mediaData.mediaType === 'audio' ? <audio controls src={content.mediaData.mediaUrl} style={{ width: '100%' }} /> : <video controls src={content.mediaData.mediaUrl} poster={content.mediaData.poster} style={{ width: '100%', maxHeight: 420 }} />}<Typography.Text type="tertiary">{content.mediaData.duration}</Typography.Text></div> : null}
      {content.body ? <div style={{ width: '100%', overflowWrap: 'anywhere' }}><Typography.Title heading={6}>正文</Typography.Title><div className="cms-revision-body" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(content.body) }} /></div> : null}
      {content.attachments.length ? <div><Typography.Title heading={6}>附件</Typography.Title><Space vertical align="start">{content.attachments.map((item, index) => <a key={`${item.url}-${index}`} href={safeLink(item.url)} target="_blank" rel="noreferrer">{item.name}（{formatBytes(item.size)}）</a>)}</Space></div> : null}
      {Object.keys(content.extend).length ? <div style={{ width: '100%' }}><Typography.Title heading={6}>模型字段</Typography.Title><Descriptions row data={Object.entries(content.extend).map(([name, value]) => {
        const field = fieldMap.get(name);
        const options = field ? cmsModelFieldOptions(field) : [];
        const label = field?.label ?? name;
        if (field?.fieldType === 'richtext' && typeof value === 'string') return { key: label, value: <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(value) }} /> };
        if (field?.fieldType === 'image' && typeof value === 'string') return { key: label, value: <Image src={value} alt={label} width={160} /> };
        if (field?.fieldType === 'file' && typeof value === 'string' && safeLink(value)) return { key: label, value: <a href={safeLink(value)} target="_blank" rel="noreferrer">查看文件</a> };
        const display = options.length ? (Array.isArray(value) ? value : [value]).map((item) => options.find((option) => option.value === item)?.label ?? valueText(item)).join('、') : valueText(value);
        return { key: label, value: <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{display}</span> };
      })} /></div> : null}
      <div style={{ width: '100%' }}><Typography.Title heading={6}>发布与展示</Typography.Title><Descriptions row data={[
        { key: '计划发布时间', value: content.scheduledAt ? formatDateTime(content.scheduledAt) : EMPTY_PLACEHOLDER },
        { key: '过期下线', value: content.expireAt ? formatDateTime(content.expireAt) : EMPTY_PLACEHOLDER },
        { key: '置顶到期', value: content.topExpireAt ? formatDateTime(content.topExpireAt) : EMPTY_PLACEHOLDER },
        { key: 'SEO 标题', value: valueText(content.seoTitle) },
        { key: 'SEO 描述', value: valueText(content.seoDescription) },
        { key: 'SEO 关键词', value: valueText(content.seoKeywords) },
        { key: '路径 / 模板', value: [content.staticPath || content.slug, content.detailTemplate].filter(Boolean).join(' / ') || EMPTY_PLACEHOLDER },
        { key: '短标题', value: valueText(content.shortTitle) },
        { key: '标题样式', value: [content.titleStyle.bold && '加粗', content.titleStyle.color].filter(Boolean).join(' / ') || EMPTY_PLACEHOLDER },
        { key: '社交图片说明 / 作者', value: [content.socialImageAlt, content.twitterCreator].filter(Boolean).join(' / ') || EMPTY_PLACEHOLDER },
        { key: '排序', value: content.sort },
      ]} /></div>
    </Space>
  );
}
