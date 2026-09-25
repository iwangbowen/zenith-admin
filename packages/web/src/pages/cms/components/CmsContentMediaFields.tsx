import { useState } from 'react';
import { Form, Radio, RadioGroup, Typography, useFormApi, useFormState, withField } from '@douyinfe/semi-ui';
import { useCmsResourceSelection } from '@/hooks/queries/cms-resources';
import { usePermission } from '@/hooks/usePermission';
import { CmsAssetField } from './CmsAssetField';
import { cmsMediaDurationFromMetadata, isExternalCmsMediaUrl } from './cms-media';
import type { CmsResource } from '@zenith/shared/cms';

const FormAsset = withField(CmsAssetField);

export default function CmsContentMediaFields({ siteId, disabled, allowUpload, onResourceChange }: Readonly<{ siteId?: number; disabled: boolean; allowUpload: boolean; onResourceChange?: (resource: CmsResource | null) => void }>) {
  const form = useFormApi();
  const state = useFormState();
  const { hasPermission } = usePermission();
  const values = state.values as Record<string, unknown>;
  const type = values.mediaType === 'audio' ? 'audio' : 'video';
  const value = String(values.mediaUrl ?? '').trim();
  const [chosenMode, setChosenMode] = useState<'library' | 'external' | null>(null);
  const [failedPreview, setFailedPreview] = useState<string | null>(null);
  const resource = useCmsResourceSelection(siteId, value, type, hasPermission('cms:resource:list'));
  const sourceMode = chosenMode ?? (resource.data || !isExternalCmsMediaUrl(value) ? 'library' : 'external');
  const clearDuration = () => form.setValue('mediaDuration', '');
  const readDuration = (seconds: number, loadedValue: string) => {
    const duration = cmsMediaDurationFromMetadata(seconds, loadedValue, form.getValue('mediaUrl'), form.getValue('mediaDuration'));
    if (duration && !disabled) form.setValue('mediaDuration', duration);
  };
  return <Form.Slot noLabel>
    <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>音视频</Typography.Text>
    <Form.RadioGroup field="mediaType" label="媒体类型" disabled={disabled} onChange={() => { form.setValue('mediaUrl', ''); clearDuration(); }}>
      <Form.Radio value="video">视频</Form.Radio><Form.Radio value="audio">音频</Form.Radio>
    </Form.RadioGroup>
    <Form.Slot label="媒体来源">
      <RadioGroup type="button" value={sourceMode} disabled={disabled} onChange={(event) => {
        setChosenMode(event.target.value as 'library' | 'external');
        form.setValue('mediaUrl', '');
        clearDuration();
      }}><Radio value="library">本站素材</Radio><Radio value="external">外部地址</Radio></RadioGroup>
    </Form.Slot>
    {sourceMode === 'library' ? <FormAsset field="mediaUrl" label={type === 'audio' ? '音频素材' : '视频素材'} siteId={siteId} type={type}
      disabled={disabled} allowUpload={allowUpload} onResourceChange={(selected) => {
        if (!selected || selected.url !== (resource.data?.url ?? value)) clearDuration();
        onResourceChange?.(selected);
      }} onDuration={readDuration} /> : <>
      <Form.Input field="mediaUrl" label="外部媒体地址" disabled={disabled} placeholder="https://example.com/media.mp4" showClear onChange={clearDuration}
        rules={[{ validator: (_rule, next) => !next || isExternalCmsMediaUrl(String(next)), message: '请输入完整的 HTTP 或 HTTPS 媒体地址' }]} />
      {isExternalCmsMediaUrl(value) ? <Form.Slot noLabel>
        <div className="cms-asset-field__player">
          {type === 'audio' ? <audio key={value} aria-label="外部音频预览" controls preload="metadata" src={value} onLoadedMetadata={(event) => readDuration(event.currentTarget.duration, value)} onError={() => setFailedPreview(value)} />
            : <video key={value} aria-label="外部视频预览" controls preload="metadata" src={value} onLoadedMetadata={(event) => readDuration(event.currentTarget.duration, value)} onError={() => setFailedPreview(value)} />}
        </div>
        {failedPreview === value ? <Typography.Text type="warning" size="small">无法加载媒体预览，请确认地址能直接播放；时长可手动填写。</Typography.Text> : null}
      </Form.Slot> : null}
    </>}
    <Form.Input field="mediaDuration" label="时长" disabled={disabled} placeholder="读取媒体后自动填写，也可输入 03:45" />
    <FormAsset field="mediaPoster" label="媒体海报" siteId={siteId} type="image" disabled={disabled} allowUpload={allowUpload} onResourceChange={onResourceChange} placeholder="可选择或上传图片，留空时使用内容封面" />
  </Form.Slot>;
}
