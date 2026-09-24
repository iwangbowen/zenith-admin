import { withField } from '@douyinfe/semi-ui';
import type { CmsModelField, CmsResource } from '@zenith/shared/cms';
import { CmsAssetField } from './components/CmsAssetField';

const FormAsset = withField(CmsAssetField);

/** 模型必填属于提审/发布校验，媒体字段也允许把尚未填写的工作稿手动保存。 */
export default function CmsModelMediaField({ field, canUpload, siteId, onResourceChange }: Readonly<{ field: CmsModelField; canUpload: boolean; siteId?: number; onResourceChange?: (resource: CmsResource | null) => void }>) {
  return <FormAsset field={`extend.${field.name}`} label={field.required ? `${field.label}（发布必填）` : field.label}
    placeholder={field.placeholder ?? undefined} siteId={siteId} type={field.fieldType === 'image' ? 'image' : undefined} allowUpload={canUpload} onResourceChange={onResourceChange} />;
}
