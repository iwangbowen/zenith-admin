import { Input, Space, Typography } from '@douyinfe/semi-ui';
import { ImageUploadField } from '@/components/ImageUploadField';
import { CmsAssetField } from '../components/CmsAssetField';
import type { PreparedSiteImage } from './site-image-save';

/** 未创建站点时仅准备本地文件；已有站点使用同域素材中心，不提前创建空站。 */
export default function SiteImageInput({ value, onChange, imageLabel, siteId, prepared, prepare, removePrepared, disabled, allowUpload, placeholder }: Readonly<{
  value?: string | null; onChange?: (value: string) => void; imageLabel?: string; siteId?: number;
  prepared?: PreparedSiteImage; prepare: (file: File) => string; removePrepared: () => void;
  disabled?: boolean; allowUpload: boolean; placeholder?: string;
}>) {
  const text = value ?? '';
  return <Space vertical align="start" spacing={8} style={{ width: '100%' }}>
    <Input value={text} showClear disabled={disabled} placeholder={placeholder ?? '图片地址（可选），或从素材中心选择'} onChange={(next) => { removePrepared(); onChange?.(next); }} />
    {siteId && !prepared ? <CmsAssetField siteId={siteId} type="image" value={text} onChange={(next) => onChange?.(next)} label={imageLabel} disabled={disabled} allowUpload={allowUpload} /> : <>
      <ImageUploadField value={prepared?.previewUrl ?? text} label={imageLabel} disabled={disabled || !allowUpload} uploadSuccessMessage={false}
        customUpload={async (file) => prepare(file)} onChange={(next) => { if (!next) { removePrepared(); onChange?.(''); } }} previewStyle={{ maxWidth: 240, maxHeight: 120 }} />
      {prepared ? <Typography.Text size="small" type="tertiary">{prepared.file.name} · {prepared.uploadedValue ? '图片已上传，保存后完成关联' : '已准备，保存站点后上传'}</Typography.Text>
        : <Typography.Text size="small" type="tertiary">可先选择图片。点击保存并成功创建站点后，才会上传图片。</Typography.Text>}
    </>}
  </Space>;
}
