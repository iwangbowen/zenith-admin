import { useState } from 'react';
import { Button, Form, useFormApi } from '@douyinfe/semi-ui';
import { Images } from 'lucide-react';
import type { CmsModelField } from '@zenith/shared/cms';
import { MediaPickerModal } from '@/components/MediaPickerModal';

/** 模型必填属于提审/发布校验，媒体字段也允许把尚未填写的工作稿手动保存。 */
export default function CmsModelMediaField({ field, canUpload }: Readonly<{ field: CmsModelField; canUpload: boolean }>) {
  const form = useFormApi();
  const [pickerVisible, setPickerVisible] = useState(false);
  return <>
    <Form.Input field={`extend.${field.name}`} label={field.required ? `${field.label}（发布必填）` : field.label}
      placeholder={field.placeholder ?? '资源 URL（可从媒体库选择）'}
      suffix={<Button size="small" theme="borderless" icon={<Images size={14} />} disabled={!canUpload} onClick={() => setPickerVisible(true)}>媒体库</Button>} />
    <MediaPickerModal visible={pickerVisible} imageOnly={field.fieldType === 'image'} onCancel={() => setPickerVisible(false)}
      onSelect={(file) => { form.setValue(`extend.${field.name}`, file.url); setPickerVisible(false); }} />
  </>;
}
