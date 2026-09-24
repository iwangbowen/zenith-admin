import { useState } from 'react';
import { Button, Space, Spin, Typography } from '@douyinfe/semi-ui';
import { Images } from 'lucide-react';
import { CMS_RESOURCE_URI_PREFIX, isValidCmsAssetUrl, type CmsResource, type CmsResourceType } from '@zenith/shared/cms';
import { ImageUploadField } from '@/components/ImageUploadField';
import { usePermission } from '@/hooks/usePermission';
import { useCmsResourceSelection, useRememberCmsResourceSelection, useUploadCmsResource } from '@/hooks/queries/cms-resources';
import { CMS_ASSET_LABELS, CmsResourcePicker, CmsResourcePreview } from './CmsResourcePicker';
import './cms-assets.css';

export interface CmsAssetFieldProps {
  siteId?: number;
  type?: CmsResourceType;
  value?: string | null;
  onChange?: (value: string) => void;
  disabled?: boolean;
  allowUpload?: boolean;
  placeholder?: string;
  label?: string;
  onResourceChange?: (resource: CmsResource | null) => void;
  onDuration?: (seconds: number, value: string) => void;
}

/** Stores resource identity; readable names and playable URLs are resolved within the selected site. */
export function CmsAssetField({ siteId, type, value, onChange, disabled = false, allowUpload = true, placeholder, label, onResourceChange, onDuration }: Readonly<CmsAssetFieldProps>) {
  const { hasPermission } = usePermission();
  const canRead = hasPermission('cms:resource:list');
  const canUpload = allowUpload && hasPermission('cms:resource:upload');
  const selectedValue = value?.trim() ?? '';
  const name = label ?? CMS_ASSET_LABELS[type ?? 'other'];
  const [visible, setVisible] = useState(false);
  const [picked, setPicked] = useState<{ value: string; resource: CmsResource } | null>(null);
  const query = useCmsResourceSelection(siteId, selectedValue, type, canRead);
  const resource = picked?.value === selectedValue && picked.resource.siteId === siteId ? picked.resource : query.data;
  const rawUrl = selectedValue && !selectedValue.startsWith(CMS_RESOURCE_URI_PREFIX) && isValidCmsAssetUrl(selectedValue) ? selectedValue : '';
  const previewUrl = resource?.url ?? rawUrl;
  const upload = useUploadCmsResource();
  const rememberSelection = useRememberCmsResourceSelection();
  const choose = (next: CmsResource) => {
    if (disabled || next.siteId !== siteId || (type && next.type !== type)) return;
    const nextValue = `${CMS_RESOURCE_URI_PREFIX}${next.id}`;
    setPicked({ value: nextValue, resource: next });
    rememberSelection(next, type);
    onChange?.(nextValue);
    onResourceChange?.(next);
    setVisible(false);
  };
  const clear = () => { setPicked(null); onChange?.(''); onResourceChange?.(null); };
  return <div className="cms-asset-field">
    {type === 'image' ? <ImageUploadField value={previewUrl} label={name} disabled={disabled || (!previewUrl && (!siteId || !canUpload))}
      customUpload={async (file) => {
        if (!siteId || !canUpload || disabled) throw new Error('当前无法上传本站素材');
        const next = await upload.mutateAsync({ siteId, file });
        if (next.type !== 'image') throw new Error('请选择图片文件');
        const nextValue = `${CMS_RESOURCE_URI_PREFIX}${next.id}`;
        setPicked({ value: nextValue, resource: next });
        rememberSelection(next, type);
        onResourceChange?.(next);
        return nextValue;
      }} onChange={(next) => next ? onChange?.(next) : clear()} /> : previewUrl ? <div className="cms-asset-field__player"><CmsResourcePreview resource={{ type: type ?? resource?.type ?? 'other', url: previewUrl, thumbUrl: null, name: resource?.name ?? name }} onDuration={(seconds) => onDuration?.(seconds, selectedValue)} /></div> : null}
    <Space wrap>
      <Button size="small" icon={<Images size={14} />} disabled={disabled || !siteId || !canRead} onClick={() => setVisible(true)}>选择{name}</Button>
      {selectedValue && (type !== 'image' || !previewUrl) ? <Button size="small" theme="borderless" disabled={disabled} onClick={clear}>清除{name}</Button> : null}
      {query.isFetching ? <Spin size="small" /> : null}
    </Space>
    {resource ? <Typography.Text size="small" ellipsis={{ showTooltip: true }}>{resource.name}</Typography.Text>
      : !siteId ? <Typography.Text type="tertiary" size="small">请先确定所属站点</Typography.Text>
      : !canRead && selectedValue ? <Typography.Text type="tertiary" size="small">没有查看素材详情的权限</Typography.Text>
      : query.isError ? <Typography.Text type="warning" size="small">素材信息加载失败，可重新选择或稍后重试</Typography.Text>
      : selectedValue && query.isSuccess ? <Typography.Text type="warning" size="small">{selectedValue.startsWith(CMS_RESOURCE_URI_PREFIX) ? '素材不可用：可能已删除、不属于本站或类型不匹配' : '此地址未登记为本站素材，请确认地址可用，或重新选择本站素材'}</Typography.Text>
      : !selectedValue ? <Typography.Text type="tertiary" size="small">{placeholder ?? `从本站素材库选择${name}`}</Typography.Text> : null}
    <CmsResourcePicker siteId={siteId} visible={visible} type={type} title={`选择${name}`} disabled={disabled} allowUpload={canUpload} onCancel={() => setVisible(false)} onSelect={choose} />
  </div>;
}

export default CmsAssetField;
