import { lazy, Suspense } from 'react';
import { Form, Spin, withField } from '@douyinfe/semi-ui';
import { CmsAssetField } from './components/CmsAssetField';
import { cmsImageUploadUrl } from '@/hooks/queries/cms-upload';
import { config } from '@/config';
import { usePermission } from '@/hooks/usePermission';
import { FormCmsLinkField } from './CmsLinkInput';

const RichTextEditor = lazy(() => import('@/components/RichTextEditor'));
const FormAssetField = withField(CmsAssetField);
const FormRichText = withField(({ value, onChange, siteId }: { value?: string; onChange?: (value: string) => void; siteId?: number }) => (
  <Suspense fallback={<Spin />}><RichTextEditor value={value} onChange={onChange} height={320}
    uploadServer={siteId ? `${config.apiBaseUrl}${cmsImageUploadUrl(siteId)}` : undefined} placeholder="在这里编排文字、图片和链接" /></Suspense>
));

/** 页面区块媒体与正文统一使用已有选择器和可视编辑器，参数仍随页面一次保存。 */
export default function CmsPageBlockFields({ type, siteId }: Readonly<{ type: 'hero' | 'image' | 'richtext'; siteId?: number }>) {
  const { hasPermission } = usePermission();
  const allowUpload = hasPermission('cms:resource:upload');
  if (type === 'richtext') return <FormRichText field="html" label="正文内容" siteId={siteId} />;
  if (type === 'hero') return <>
    <Form.Input field="title" label="主标题" rules={[{ required: true, message: '请输入主标题' }]} />
    <Form.Input field="subtitle" label="副标题" />
    <FormAssetField field="image" label="背景图" siteId={siteId} type="image" allowUpload={allowUpload} />
    <Form.Input field="buttonText" label="按钮文字" />
    <FormCmsLinkField field="buttonUrl" label="按钮链接" siteId={siteId} />
  </>;
  return <>
    <FormAssetField field="src" label="图片" siteId={siteId} type="image" allowUpload={allowUpload} rules={[{ required: true, message: '请选择图片' }]} />
    <Form.Input field="alt" label="替代文本" />
    <FormCmsLinkField field="linkUrl" label="点击链接" siteId={siteId} />
  </>;
}
