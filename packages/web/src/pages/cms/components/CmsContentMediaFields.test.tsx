import { fireEvent, render, screen } from '@testing-library/react';
import { Form } from '@douyinfe/semi-ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CmsResource } from '@zenith/shared/cms';
import type { CmsAssetFieldProps } from './CmsAssetField';
import CmsContentMediaFields from './CmsContentMediaFields';

const state = vi.hoisted(() => ({ resource: null as CmsResource | null }));
const original = { id: 7, siteId: 3, type: 'video', name: '已有视频', url: '/api/files/original/content' } as CmsResource;
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ hasPermission: () => true }) }));
vi.mock('@/hooks/queries/cms-resources', () => ({ useCmsResourceSelection: () => ({ data: state.resource }) }));
vi.mock('./CmsAssetField', () => ({ CmsAssetField: ({ type, value, onChange, onResourceChange, onDuration }: CmsAssetFieldProps) => {
  if (type === 'image') return null;
  const choose = (resource: CmsResource | null) => {
    onChange?.(resource ? `cms-res://${resource.id}` : '');
    onResourceChange?.(resource);
  };
  return <>
    <button type="button" onClick={() => choose({ ...original, id: 8 })}>重选相同文件</button>
    <button type="button" onClick={() => choose({ ...original, url: '/api/files/replacement/content' })}>同素材替换二进制</button>
    <button type="button" onClick={() => choose(null)}>清除视频</button>
    <button type="button" onClick={() => onDuration?.(45, value ?? '')}>新文件元数据就绪</button>
  </>;
} }));

beforeEach(() => { state.resource = original; });
const durationInput = () => screen.getByPlaceholderText('读取媒体后自动填写，也可输入 03:45');
function mount(mediaUrl = 'cms-res://7') {
  render(<Form initValues={{ mediaType: 'video', mediaUrl, mediaDuration: '00:20' }}>
    <CmsContentMediaFields siteId={3} disabled={false} allowUpload />
  </Form>);
}

describe('音视频重新选择与时长', () => {
  it('preserves a manual duration when another resource handle points to the same binary URL', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: '重选相同文件' }));
    expect(durationInput()).toHaveValue('00:20');
  });

  it('compares a retained direct URL before changing the form to the selected resource handle', () => {
    state.resource = null;
    mount(original.url);
    fireEvent.click(screen.getByRole('button', { name: '重选相同文件' }));
    expect(durationInput()).toHaveValue('00:20');
  });

  it('clears duration for a different binary on the same resource and reads its new metadata', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: '同素材替换二进制' }));
    expect(durationInput()).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: '新文件元数据就绪' }));
    expect(durationInput()).toHaveValue('00:45');
  });

  it('clears duration when the media is removed', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: '清除视频' }));
    expect(durationInput()).toHaveValue('');
  });
});
